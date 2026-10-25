# SPDX-License-Identifier: GPL-3.0-only
"""The two ComfyUI nodes and the pack's entry point.

They run against tests/fakes: a small comfy_api.latest and folder_paths that keep the constructor
signatures and the rules of ComfyUI v0.41.0. Where a test says "like ComfyUI", it copies what
ComfyUI's loader and executor do (execution.py, nodes.py::load_custom_node).
"""
import ast
import asyncio
import hashlib
import importlib.util
import inspect
import json
import logging
import os
import subprocess
import sys
from dataclasses import fields
from pathlib import Path

import folder_paths
import pytest
from comfy_api.latest import ComfyExtension

from montagio_nodes import nodes
from montagio_nodes.catalog import BUNDLED_DIR
from montagio_nodes.nodes import (
    MontagioCameraEmbedding,
    MontagioExtension,
    MontagioLoadPreset,
    MontagioPresetFromYAML,
    MontagioTranscribeWords,
    comfy_entrypoint,
    preset_dirs,
)
from montagio_nodes.params import NodeParams, ParamsError
from montagio_nodes.preset import PresetError

# every test gets a models folder of its own: define_schema, execute and fingerprint_inputs all look in it
pytestmark = pytest.mark.usefixtures("fake_models_dir")

PACK_DIR = Path(__file__).resolve().parent.parent
FAKES_DIR = Path(__file__).resolve().parent / "fakes"
CRASH_PUSH = (BUNDLED_DIR / "crash-push.yaml").read_text(encoding="utf-8")
SPDX = "# SPDX-License-Identifier: GPL-3.0-only"

OUTPUT_NAMES = [
    "camera_pose", "speed", "width", "height", "length", "fps", "prompt", "negative", "duration_s", "resolution", "info",
    "camera_pose_2", "combine",  # added last, so that the links of a graph saved before keep their indexes
]
OUTPUT_TYPES = ["COMBO", "FLOAT", "INT", "INT", "INT", "FLOAT", "STRING", "STRING", "INT", "STRING", "STRING", "COMBO", "COMBO"]
# after the input each node has of its own: (id, io_type, optional)
COMMON_INPUTS = [
    ("prompt", "STRING", True),
    ("aspect", "COMBO", False),
    ("image", "IMAGE", True),
    ("resolution", "COMBO", False),
    ("camera_mode", "COMBO", False),
]
NODES = [
    pytest.param(MontagioLoadPreset, "MontagioLoadPreset", "Load Montagio Preset", ("preset", "COMBO", False), id="load"),
    pytest.param(MontagioPresetFromYAML, "MontagioPresetFromYAML", "Montagio Preset from YAML", ("yaml", "STRING", False), id="yaml"),
]
CHOICES = {"aspect": "16:9", "resolution": "preset", "camera_mode": "parametric"}
# the bundled presets that combine two moves: (camera_pose, camera_pose_2, combine) in combined mode
TWO_MOVE_PRESETS = {
    "breathing.yaml": ("Zoom In", "Zoom Out", "then"),
    "drift-left-push.yaml": ("Pan Left", "Zoom In", "together"),
    "pull-back-tilt-up.yaml": ("Zoom Out", "Pan Up", "together"),
    "push-and-settle.yaml": ("Zoom In", "Static", "then"),
    "rise-and-push.yaml": ("Pan Up", "Zoom In", "together"),
}


class FakeImage:
    """An IMAGE input: a [batch, height, width, channels] tensor, of which the nodes only read the shape."""

    def __init__(self, shape):
        self.shape = shape


def run_load(preset="crash-push.yaml", **inputs):
    return MontagioLoadPreset.execute(preset=preset, **{**CHOICES, **inputs})


def run_yaml(text=CRASH_PUSH, **inputs):
    return MontagioPresetFromYAML.execute(yaml=text, **{**CHOICES, **inputs})


def write_user_preset(models, name, text=CRASH_PUSH):
    path = models / "montagio_presets" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def own_input(node, input_id):
    return next(item for item in node.define_schema().inputs if item.id == input_id)


def menu():
    return own_input(MontagioLoadPreset, "preset").options


def call_like_comfyui(node, method, **inputs):
    """ComfyUI runs getattr(node, method).__func__(a clone of node, **inputs): the inputs it cannot read yet are None."""
    clone = type(node.__name__, (node,), {})
    return getattr(node, method).__func__(clone, **inputs)


# --- schema -------------------------------------------------------------------------


@pytest.mark.parametrize("node, node_id, display_name, own", NODES)
def test_schema_ids_and_output_order(node, node_id, display_name, own):
    schema = node.GET_SCHEMA()  # like ComfyUI: define, finalize, validate
    assert (schema.node_id, schema.display_name, schema.category) == (node_id, display_name, "Montagio")
    assert [output.display_name for output in schema.outputs] == OUTPUT_NAMES
    assert [output.io_type for output in schema.outputs] == OUTPUT_TYPES


def test_outputs_follow_the_fields_of_node_params():
    assert OUTPUT_NAMES == [field.name for field in fields(NodeParams)]


@pytest.mark.parametrize("node, node_id, display_name, own", NODES)
def test_inputs(node, node_id, display_name, own):
    schema = node.define_schema()
    assert [(item.id, item.io_type, item.optional) for item in schema.inputs] == [own, *COMMON_INPUTS]


@pytest.mark.parametrize("node, node_id, display_name, own", NODES)
def test_common_input_choices(node, node_id, display_name, own):
    prompt, aspect, _image, resolution, camera_mode = node.define_schema().inputs[1:]
    assert (prompt.multiline, prompt.default) == (True, "")
    assert (aspect.options, aspect.default) == (["auto", "16:9", "9:16", "1:1"], "auto")
    assert (resolution.options, resolution.default) == (["preset", "480p", "720p"], "preset")
    assert (camera_mode.options, camera_mode.default) == (["parametric", "prompt", "combined"], "parametric")


def test_load_menu_lists_bundled_and_user_presets(fake_models_dir):
    assert {"crash-push.yaml", "pan-left.yaml", "slow-push.yaml"} <= set(menu())
    assert "x.yaml" not in menu()
    write_user_preset(fake_models_dir, "x.yaml")
    write_user_preset(fake_models_dir, "sub/y.yml")
    assert {"x.yaml", "sub/y.yml", "crash-push.yaml"} <= set(menu())  # the next define_schema sees them


def test_from_yaml_starts_with_the_crash_push_preset():
    assert own_input(MontagioPresetFromYAML, "yaml").multiline is True
    assert own_input(MontagioPresetFromYAML, "yaml").default == CRASH_PUSH


# --- preset_dirs --------------------------------------------------------------------


def test_preset_dirs_puts_the_user_folder_first_and_the_bundled_one_last():
    user = os.path.join(folder_paths.models_dir, "montagio_presets")
    assert not os.path.exists(user)
    assert preset_dirs() == [user, str(BUNDLED_DIR)]
    assert os.path.isdir(user)
    assert folder_paths.get_folder_paths("montagio_presets") == [user, str(BUNDLED_DIR)]


def test_preset_dirs_keeps_extra_folders_between_the_two(tmp_path):
    # extra_model_paths.yaml is read before the custom nodes load, so its folder is there first
    extra = str(tmp_path / "shared")
    folder_paths.add_model_folder_path("montagio_presets", extra)
    user = os.path.join(folder_paths.models_dir, "montagio_presets")
    assert preset_dirs() == [user, extra, str(BUNDLED_DIR)]


def test_preset_dirs_is_idempotent():
    first = preset_dirs()
    assert preset_dirs() == first == preset_dirs()
    registered = folder_paths.folder_names_and_paths["montagio_presets"][0]
    assert registered == first and len(set(registered)) == len(registered)


def test_preset_dirs_follows_a_changed_models_dir(tmp_path, monkeypatch):
    # no global flag: the second call must still register the user folder of the new models_dir
    old = preset_dirs()[0]
    monkeypatch.setattr(folder_paths, "models_dir", str(tmp_path / "other"))
    new = os.path.join(str(tmp_path / "other"), "montagio_presets")
    assert preset_dirs() == [new, old, str(BUNDLED_DIR)]


def test_preset_dirs_still_works_when_the_user_folder_cannot_be_created(monkeypatch, caplog):
    real_makedirs = os.makedirs

    def makedirs(path, *args, **kwargs):
        if str(path).endswith("montagio_presets"):
            raise PermissionError("read-only file system")
        return real_makedirs(path, *args, **kwargs)

    monkeypatch.setattr(nodes.os, "makedirs", makedirs)
    with caplog.at_level(logging.WARNING):
        dirs = preset_dirs()
    assert dirs[-1] == str(BUNDLED_DIR)
    assert "crash-push.yaml" in menu()  # the bundled presets are still there
    assert "read-only" in caplog.text


# --- execute ------------------------------------------------------------------------


def test_execute_crash_push_with_portrait_image():
    out = MontagioLoadPreset.execute(
        preset="crash-push.yaml", aspect="auto", resolution="preset", camera_mode="parametric", prompt="",
        image=FakeImage(shape=(1, 1920, 1080, 3)),
    )
    assert out.args[:5] == ("Zoom In", 1.5, 480, 832, 81)


def test_execute_gives_every_output_in_order():
    out = run_load(prompt="a cat")
    assert out.args == (
        "Zoom In", 1.5, 832, 480, 81, 16.0,
        "a cat, dynamic camera push-in, cinematic, sharp focus on subject",
        "blurry, distorted, warped faces, extra limbs, flicker, low quality",
        5, "480p", "Crash Push (crash-push) — by montagio-community — CC-BY-4.0",
        "Static", "together",
    )
    assert [type(value) for value in out.args[:6]] == [str, float, int, int, int, float]  # what the linked nodes take
    assert [type(value) for value in out.args[11:]] == [str, str]


@pytest.mark.parametrize(
    "shape, aspect, size",
    [
        ((1, 1080, 1920, 3), "auto", (832, 480)),  # landscape
        ((1, 1920, 1080, 3), "auto", (480, 832)),  # portrait
        ((4, 1024, 1024, 3), "auto", (640, 640)),  # square, a batch of four
        ((1, 1920, 1080, 3), "16:9", (832, 480)),  # an explicit choice wins over the image
        (None, "auto", (832, 480)),  # no image: 16:9
        (None, "9:16", (480, 832)),
    ],
)
def test_aspect_comes_from_the_choice_or_the_image(shape, aspect, size):
    image = None if shape is None else FakeImage(shape)
    out = run_load(aspect=aspect, image=image)
    assert out.args[2:4] == size


def test_resolution_choice_overrides_the_preset():
    assert run_load(resolution="720p").args[2:4] == (1280, 720)
    assert run_load(resolution="720p").args[9] == "720p"
    assert run_load(resolution="preset").args[9] == "480p"  # the preset's own


def test_camera_mode_prompt_moves_the_camera_into_the_prompt():
    out = run_load(camera_mode="prompt", prompt="a cat")
    assert out.args[:2] == ("Static", 1.0)
    assert out.args[6].startswith("a cat, ") and out.args[6].endswith("the camera pushes in toward the subject")


def test_optional_inputs_may_be_missing_or_empty():
    # ComfyUI leaves an unconnected optional input out of the call
    assert run_load().args == run_load(prompt="", image=None).args == run_load(prompt=None).args


@pytest.mark.parametrize("shape", [(1920, 1080), (1, 1920, 1080), (1, 0, 0, 3)])
def test_an_image_that_is_not_bhwc_is_refused(shape):
    with pytest.raises(ParamsError):
        run_load(aspect="auto", image=FakeImage(shape))


@pytest.mark.parametrize(
    "choices, message",
    [
        ({"aspect": "4:3"}, "aspect"),
        ({"resolution": "1080p"}, "resolution"),
        ({"camera_mode": "orbit"}, "camera_mode"),
    ],
)
def test_a_bad_choice_is_a_params_error(choices, message):
    with pytest.raises(ParamsError, match=message):
        run_load(**choices)
    with pytest.raises(ParamsError, match=message):
        run_yaml(**choices)


def test_a_preset_that_needs_two_camera_moves_is_a_params_error_until_the_mode_is_combined_or_prompt():
    two_moves = CRASH_PUSH.replace("poses: [zoom_in]", "poses: [zoom_in, pan_left]")
    assert two_moves != CRASH_PUSH
    with pytest.raises(ParamsError, match='combines 2 camera moves.*camera_mode "combined"'):
        run_yaml(two_moves)
    out = run_yaml(two_moves, camera_mode="combined")
    assert (out.args[0], out.args[1], out.args[11], out.args[12]) == ("Zoom In", 1.5, "Pan Left", "together")
    assert run_yaml(two_moves, camera_mode="prompt").args[0] == "Static"


def test_bundled_presets_with_two_moves_run_in_combined_mode_only():
    bundled = sorted(path.name for path in BUNDLED_DIR.glob("*.yaml"))
    assert set(TWO_MOVE_PRESETS) < set(bundled)
    for name in bundled:
        out = run_load(name, camera_mode="combined")
        moves = (out.args[0], out.args[11], out.args[12])
        if name in TWO_MOVE_PRESETS:
            assert moves == TWO_MOVE_PRESETS[name], name
            with pytest.raises(ParamsError, match='combines 2 camera moves.*camera_mode "combined"'):
                run_load(name)  # parametric mode feeds the core WanCameraEmbedding, which would drop one
        else:
            assert moves[1:] == ("Static", "together"), name
            assert run_load(name).args == out.args  # a one-move preset runs the same in both modes


def test_combined_outputs_are_what_montagio_camera_embedding_takes():
    """In combined mode the outputs link into Montagio Camera Embedding: same names, values among its options."""
    embedding = {item.id: item for item in MontagioCameraEmbedding.define_schema().inputs}
    linked = ["camera_pose", "speed", "width", "height", "length", "camera_pose_2", "combine"]
    assert set(linked) <= set(embedding) and set(linked) <= set(OUTPUT_NAMES)
    assert {item_id for item_id, item in embedding.items() if not item.optional} <= set(linked)  # nothing left unset
    for name in sorted(path.name for path in BUNDLED_DIR.glob("*.yaml")):
        out = dict(zip(OUTPUT_NAMES, run_load(name, camera_mode="combined").args))
        for combo in ("camera_pose", "camera_pose_2", "combine"):
            assert out[combo] in embedding[combo].options, (name, combo)


def test_from_yaml_default_runs_and_bad_yaml_names_the_input():
    default = own_input(MontagioPresetFromYAML, "yaml").default
    assert run_yaml(default).args[:5] == ("Zoom In", 1.5, 832, 480, 81)
    with pytest.raises(PresetError, match="yaml input"):
        MontagioPresetFromYAML.execute(yaml="id: [", aspect="16:9", resolution="preset", camera_mode="parametric")
    with pytest.raises(PresetError, match="yaml input: .*speed"):  # a valid YAML that is not a valid preset
        run_yaml(CRASH_PUSH.replace("speed: 1.5", "speed: fast"))


def test_from_yaml_uses_the_text_it_is_given():
    assert run_yaml(CRASH_PUSH.replace("speed: 1.5", "speed: 2.5")).args[1] == 2.5


# --- the preset file ----------------------------------------------------------------


def test_a_preset_edited_on_disk_is_read_again_on_the_next_run(fake_models_dir):
    path = write_user_preset(fake_models_dir, "x.yaml")
    assert run_load("x.yaml").args[1] == 1.5
    path.write_text(CRASH_PUSH.replace("speed: 1.5", "speed: 2.5"), encoding="utf-8")
    assert run_load("x.yaml").args[1] == 2.5


def test_a_user_preset_wins_over_the_bundled_one_of_the_same_name(fake_models_dir):
    write_user_preset(fake_models_dir, "crash-push.yaml", CRASH_PUSH.replace("speed: 1.5", "speed: 2.5"))
    assert run_load("crash-push.yaml").args[1] == 2.5
    assert run_load("pan-left.yaml").args[0] == "Pan Left"  # the others are still the bundled ones


def test_a_preset_in_a_subfolder_is_reached_by_its_menu_name(fake_models_dir):
    write_user_preset(fake_models_dir, "sub/y.yml")
    assert "sub/y.yml" in menu()
    assert run_load("sub/y.yml").args[0] == "Zoom In"


def test_an_unknown_or_escaping_preset_is_a_preset_error(fake_models_dir):
    write_user_preset(fake_models_dir, "x.yaml")
    (fake_models_dir / "secret.yaml").write_text(CRASH_PUSH, encoding="utf-8")  # beside the user folder
    for name in ("nope.yaml", "../secret.yaml", "..\\secret.yaml", "notes.txt", "", None):
        with pytest.raises(PresetError):
            run_load(name)


def test_a_broken_preset_file_is_a_preset_error_that_names_the_preset(fake_models_dir):
    write_user_preset(fake_models_dir, "broken.yaml", "id: [")
    with pytest.raises(PresetError, match="^broken.yaml: "):
        run_load("broken.yaml")


def test_a_preset_file_that_is_not_utf8_is_a_preset_error(fake_models_dir):
    path = write_user_preset(fake_models_dir, "latin.yaml")
    path.write_bytes(CRASH_PUSH.replace("Crash Push", "Poussée").encode("latin-1"))
    with pytest.raises(PresetError, match="^latin.yaml: cannot read"):
        run_load("latin.yaml")


# --- fingerprint_inputs -------------------------------------------------------------


def test_fingerprint_changes_when_the_file_changes(fake_models_dir):
    path = write_user_preset(fake_models_dir, "x.yaml")
    first = MontagioLoadPreset.fingerprint_inputs(preset="x.yaml")
    assert first == MontagioLoadPreset.fingerprint_inputs(preset="x.yaml")
    assert first == hashlib.sha256(path.read_bytes()).hexdigest()
    path.write_text(CRASH_PUSH + "# edited\n", encoding="utf-8")
    assert MontagioLoadPreset.fingerprint_inputs(preset="x.yaml") != first


def test_fingerprint_follows_the_file_the_name_reaches(fake_models_dir):
    bundled = MontagioLoadPreset.fingerprint_inputs(preset="crash-push.yaml")
    assert bundled == hashlib.sha256((BUNDLED_DIR / "crash-push.yaml").read_bytes()).hexdigest()
    write_user_preset(fake_models_dir, "crash-push.yaml", CRASH_PUSH + "# remix\n")  # shadows the bundled one
    assert MontagioLoadPreset.fingerprint_inputs(preset="crash-push.yaml") != bundled


def test_fingerprint_of_a_missing_file_is_missing_and_never_raises(fake_models_dir, monkeypatch):
    for name in ("nope.yaml", "../x.yaml", "", "notes.txt", None, 42):
        assert MontagioLoadPreset.fingerprint_inputs(preset=name) == "missing"
    write_user_preset(fake_models_dir, "x.yaml")

    def unreadable(self):
        raise PermissionError("denied")

    monkeypatch.setattr(Path, "read_bytes", unreadable)
    assert MontagioLoadPreset.fingerprint_inputs(preset="x.yaml") == "missing"


def test_comfyui_calls_the_node_methods_as_classmethods_with_keywords():
    choices = {"aspect": "auto", "resolution": "preset", "camera_mode": "parametric", "prompt": ""}
    out = call_like_comfyui(MontagioLoadPreset, "execute", preset="crash-push.yaml", image=FakeImage((1, 832, 480, 3)), **choices)
    assert out.args[:5] == ("Zoom In", 1.5, 480, 832, 81)
    out = call_like_comfyui(MontagioPresetFromYAML, "execute", yaml=CRASH_PUSH, **choices)
    assert out.args[:5] == ("Zoom In", 1.5, 832, 480, 81)
    # asked for its fingerprint before its links are known, the inputs that come from links are None
    unknown = dict.fromkeys(("aspect", "resolution", "camera_mode", "prompt", "image"))
    fingerprint = call_like_comfyui(MontagioLoadPreset, "fingerprint_inputs", preset="crash-push.yaml", **unknown)
    assert fingerprint == MontagioLoadPreset.fingerprint_inputs(preset="crash-push.yaml")
    assert call_like_comfyui(MontagioLoadPreset, "fingerprint_inputs", preset=None, **unknown) == "missing"
    # ComfyUI only uses a fingerprint when the node class itself defines one
    assert "fingerprint_inputs" in vars(MontagioLoadPreset)
    assert "fingerprint_inputs" not in vars(MontagioPresetFromYAML)


# --- the entry point ----------------------------------------------------------------


@pytest.fixture
def pack():
    """The pack loaded the way ComfyUI loads a custom node folder: its __init__.py, as a package of its own."""
    name = "montagio_pack"
    spec = importlib.util.spec_from_file_location(name, PACK_DIR / "__init__.py", submodule_search_locations=[str(PACK_DIR)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
        yield module
    finally:
        for key in [key for key in sys.modules if key == name or key.startswith(name + ".")]:
            del sys.modules[key]


def test_package_entrypoint_is_v3_only(pack):
    # with a NODE_CLASS_MAPPINGS, ComfyUI would stop there and never call comfy_entrypoint
    assert hasattr(pack, "comfy_entrypoint") and not hasattr(pack, "NODE_CLASS_MAPPINGS")
    ext = asyncio.run(pack.comfy_entrypoint())
    assert {n.__name__ for n in asyncio.run(ext.get_node_list())} == {"MontagioLoadPreset", "MontagioPresetFromYAML", "MontagioCameraEmbedding", "MontagioTranscribeWords"}


def test_the_extension_is_what_the_comfyui_loader_accepts():
    assert inspect.iscoroutinefunction(comfy_entrypoint)  # the loader awaits it
    extension = asyncio.run(comfy_entrypoint())
    assert isinstance(extension, MontagioExtension) and isinstance(extension, ComfyExtension)
    node_list = asyncio.run(extension.get_node_list())
    assert node_list == [MontagioLoadPreset, MontagioPresetFromYAML, MontagioCameraEmbedding, MontagioTranscribeWords]
    assert sorted(node.GET_SCHEMA().node_id for node in node_list) == ["MontagioCameraEmbedding", "MontagioLoadPreset", "MontagioPresetFromYAML", "MontagioTranscribeWords"]
    asyncio.run(extension.on_load())


# what nodes.py::load_custom_node does, with only the fakes beside it
LOAD_LIKE_COMFYUI = """
import asyncio, importlib.util, inspect, json, os, sys

pack, fakes, models = sys.argv[1:4]
sys.path.insert(0, fakes)  # stands for ComfyUI's own modules: comfy_api, folder_paths
import folder_paths
from comfy_api.latest import ComfyExtension

folder_paths.models_dir = models
name = pack.replace(".", "_x_")  # sys_module_name = module_path.replace(".", "_x_")
spec = importlib.util.spec_from_file_location(name, os.path.join(pack, "__init__.py"))
module = importlib.util.module_from_spec(spec)
sys.modules[name] = module
spec.loader.exec_module(module)

assert not hasattr(module, "NODE_CLASS_MAPPINGS") and callable(module.comfy_entrypoint)
entrypoint = module.comfy_entrypoint
extension = asyncio.run(entrypoint()) if inspect.iscoroutinefunction(entrypoint) else entrypoint()
assert isinstance(extension, ComfyExtension)
node_list = asyncio.run(extension.get_node_list())
print(json.dumps({
    "ids": sorted(node.GET_SCHEMA().node_id for node in node_list),
    "pack_dir_on_sys_path": any(entry and os.path.abspath(entry) == os.path.abspath(pack) for entry in sys.path),
}))
"""


def test_the_pack_loads_when_its_folder_is_not_on_sys_path(tmp_path):
    # ComfyUI does not put a custom node folder on sys.path, and only the pack's relative imports then work
    done = subprocess.run(
        [sys.executable, "-E", "-c", LOAD_LIKE_COMFYUI, str(PACK_DIR), str(FAKES_DIR), str(tmp_path)],
        cwd=tmp_path, capture_output=True, text=True, timeout=120, check=False,
    )
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout.strip().splitlines()[-1]) == {
        "ids": ["MontagioCameraEmbedding", "MontagioLoadPreset", "MontagioPresetFromYAML", "MontagioTranscribeWords"],
        "pack_dir_on_sys_path": False,
    }


# --- what the pack may import -------------------------------------------------------

# nothing that reaches the network or starts a process, whatever the standard library offers
FORBIDDEN_MODULES = {
    "subprocess", "socket", "ssl", "urllib", "http", "ftplib", "smtplib", "poplib", "imaplib", "telnetlib", "xmlrpc",
}
FORBIDDEN_CALLS = {"eval", "exec", "__import__"}


def pack_sources():
    return sorted(path for path in (PACK_DIR / "montagio_nodes").glob("*.py"))


@pytest.mark.parametrize("path", pack_sources(), ids=lambda path: path.name)
def test_pack_modules_import_only_what_they_may(path):
    allowed = set(sys.stdlib_module_names) - FORBIDDEN_MODULES | {"yaml", "numpy"}
    if path.name == "nodes.py":  # the only module that talks to ComfyUI (and to torch and transformers, which come with it)
        allowed |= {"comfy_api", "folder_paths", "comfy", "torch", "transformers"}
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported, called = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0:  # a relative import stays in the pack
            imported.add(node.module.split(".")[0])
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            called.add(node.func.id)
    assert imported <= allowed, f"{path.name} imports {sorted(imported - allowed)}"
    assert not called & FORBIDDEN_CALLS


def test_every_python_file_of_the_pack_has_the_license_header():
    files = [path for path in PACK_DIR.rglob("*.py") if "__pycache__" not in path.parts]
    assert PACK_DIR / "__init__.py" in files and FAKES_DIR / "folder_paths.py" in files
    assert [path for path in files if path.read_text(encoding="utf-8").splitlines()[:1] != [SPDX]] == []


# --- Montagio Transcribe Words (Whisper) ---------------------------------------------------


def whisper_model(models, name="whisper-large-v3-turbo"):
    folder = models / "whisper" / name
    folder.mkdir(parents=True)
    (folder / "config.json").write_text("{}")
    return folder


def test_transcribe_words_schema():
    schema = MontagioTranscribeWords.GET_SCHEMA()
    assert (schema.node_id, schema.display_name, schema.category) == ("MontagioTranscribeWords", "Montagio Transcribe Words", "Montagio")
    assert [(item.id, item.io_type, item.optional) for item in schema.inputs] == [("audio", "AUDIO", False), ("model", "COMBO", False), ("language", "COMBO", False)]
    assert [(output.display_name, output.io_type) for output in schema.outputs] == [("words_json", "STRING")]
    language = schema.inputs[2]
    assert language.default == "auto" and language.options[0] == "auto" and "fr" in language.options


def test_transcribe_words_lists_the_models_of_the_whisper_folder(fake_models_dir):
    whisper_model(fake_models_dir)
    (fake_models_dir / "whisper" / "not-a-model").mkdir()
    model = MontagioTranscribeWords.define_schema().inputs[1]
    assert model.options == ["whisper-large-v3-turbo"] and model.default == "whisper-large-v3-turbo"


def test_transcribe_words_offers_no_model_before_it_is_downloaded():
    # an empty menu: ComfyUI refuses the workflow at once, and the app hides its captions
    model = MontagioTranscribeWords.define_schema().inputs[1]
    assert model.options == [] and model.default is None


def test_transcribe_words_runs_whisper_on_16k_mono_and_returns_the_document(fake_models_dir, monkeypatch):
    import numpy as np
    from comfy import model_management

    folder = whisper_model(fake_models_dir)
    seen = {}

    def fake_run(model_dir, samples, *, language, device):
        seen.update(model_dir=model_dir, samples=samples, language=language, device=device)
        return {"text": " Hi there", "chunks": [{"text": " Hi", "timestamp": (0.0, 0.4)}, {"text": " there", "timestamp": (0.4, None)}]}, "en", True

    monkeypatch.setattr(nodes, "_run_whisper", fake_run)
    model_management.calls.clear()

    class Waveform:  # what LoadAudio gives: a [batch, channels, samples] tensor, here stereo at 24 kHz
        def __init__(self, array):
            self.array = array

        def __getitem__(self, index):
            return Waveform(self.array[index])

        def cpu(self):
            return self

        def float(self):
            return self

        def numpy(self):
            return self.array

    waveform = Waveform(np.zeros((1, 2, 24000), dtype=np.float32))
    out = MontagioTranscribeWords.execute(audio={"waveform": waveform, "sample_rate": 24000}, model="whisper-large-v3-turbo", language="auto")
    doc = json.loads(out.args[0])
    assert doc == {
        "schema": "montagio/words@1",
        "model": "whisper-large-v3-turbo",
        "language": "en",
        "detected": True,
        "duration_s": 1.0,
        "text": " Hi there",
        "chunks": [{"text": " Hi", "start": 0.0, "end": 0.4}, {"text": " there", "start": 0.4, "end": None}],
    }
    assert seen["model_dir"] == str(folder) and seen["language"] == "auto" and seen["device"] == "cpu"
    assert seen["samples"].shape == (16000,)
    names = [call[0] for call in model_management.calls]
    assert names.index("free_memory") < names.index("soft_empty_cache")


def test_transcribe_words_refuses_a_model_that_is_not_in_the_folder(fake_models_dir):
    with pytest.raises(ValueError, match="whisper-large-v3-turbo"):
        MontagioTranscribeWords.execute(audio={"waveform": None, "sample_rate": 16000}, model="whisper-large-v3-turbo", language="auto")
    whisper_model(fake_models_dir)
    with pytest.raises(ValueError, match="language"):
        MontagioTranscribeWords.execute(audio={"waveform": None, "sample_rate": 16000}, model="whisper-large-v3-turbo", language="klingon")
