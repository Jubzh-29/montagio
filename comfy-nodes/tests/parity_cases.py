# SPDX-License-Identifier: GPL-3.0-only
"""The preset cases shared by the unit tests and the TypeScript parity tests.

test_preset.py checks what the pack makes of each case; test_ts_parity.py gives the same
texts to the app's own parser (through the bridge) and requires the same verdict and the
same values. The edit tables apply to tests/fixtures/crash-push.yaml and mirror
packages/presets/test/schema.test.ts. A case that differs between the pack and the app is a
bug in the pack: fix preset.py, never the tables.
"""
import re
from pathlib import Path

from montagio_nodes.preset import CAMERA_POSES
from tests.bridge import find_monorepo

BASE = (Path(__file__).parent / "fixtures" / "crash-push.yaml").read_text(encoding="utf-8")


def edit(a, b):
    if a not in BASE:
        raise AssertionError(f'fixture does not contain "{a}"')
    return BASE.replace(a, b, 1)


MODELS_BLOCK = "models:\n"
LORA_OK = "{file: a.safetensors, strength: 1}"
DEFAULTS_BLOCK = "defaults:\n  duration_s: 5\n  resolution: 480p\n  fps: 16\n"
DESCRIPTION = "description: Fast push toward the subject, ending tight."


# (replace, with, start of the message after the file name)
REJECTED = [
    # the 7 refusals of schema.test.ts
    ("id: crash-push", "id: Crash Push", "id"),
    ("poses: [zoom_in]", "poses: [static, zoom_in]", "camera.poses"),
    ("poses: [zoom_in]", "poses: [zoom_in, zoom_in]", "camera.poses"),
    ("poses: [zoom_in]", "poses: [zoom_in, pan_left, pan_up]", "camera.poses"),
    ("license: CC-BY-4.0", "license: CC-BY-NC-4.0", "license"),
    ("duration_s: 5", "duration_s: 11", "defaults.duration_s"),
    ("duration_s: 5", "duration_s: 1", "defaults.duration_s"),
    # numbers: a boolean is never a number, nothing non finite, integers stay integers
    ("speed: 1.5", "speed: true", "camera.speed"),
    ("speed: 1.5", "speed: 0.05", "camera.speed"),
    ("speed: 1.5", "speed: 3.5", "camera.speed"),
    ("speed: 1.5", "speed: .inf", "camera.speed"),
    ("speed: 1.5", "speed: .nan", "camera.speed"),
    ("duration_s: 5", "duration_s: 5.5", "defaults.duration_s"),
    ("duration_s: 5", "duration_s: true", "defaults.duration_s"),
    ("duration_s: 5", "duration_s: 0755", "defaults.duration_s"),
    ("duration_s: 5", "duration_s: 1" + "0" * 400, "defaults.duration_s"),
    ("duration_s: 5", "duration_s: " + "9" * 5000, "invalid YAML"),
    ("fps: 16", "fps: 30", "defaults.fps"),
    ("fps: 16", "fps: true", "defaults.fps"),
    ("resolution: 480p", "resolution: 1080p", "defaults.resolution"),
    # strings and patterns (fullmatch: a trailing newline is not accepted)
    ("id: crash-push", r'id: "crash-push\n"', "id"),
    ("name: Crash Push", "name: ''", "name"),
    ("name: Crash Push", "name: 123", "name"),
    ("name: Crash Push", "name: " + "😀" * 41, "name"),
    ("preview: previews/crash-push.mp4", "preview: previews/crash-push.mov", "preview"),
    ("poses: [zoom_in]", "poses: []", "camera.poses"),
    ("capability: i2v-camera", "capability: t2v", "capability"),
    ("schema: montagio/preset@0.1", "schema: montagio/preset@0.2", "schema"),
    # keys: unknown ones, duplicates, and "<<" is a plain key (no merge)
    ("capability: i2v-camera", "capability: i2v-camera\nextra: 1", "(root).extra"),
    ("license: CC-BY-4.0", "license: CC-BY-4.0\nlicense: MIT", "invalid YAML"),
    ("prompt:\n", "prompt:\n  <<: {suffix: x}\n", "prompt.<<"),
    # a key that is present but null is refused, the default only applies when it is absent
    (DEFAULTS_BLOCK, "defaults:\n", "defaults"),
    (DESCRIPTION, "description:", "description"),
    ("fallback: wan22-ti2v-5b", "fallback:", "models.fallback"),
    # loras
    (MODELS_BLOCK, "loras: [{file: a.safetensors, strength: 3}]\n" + MODELS_BLOCK, "loras.0.strength"),
    (MODELS_BLOCK, "loras: [{file: a.ckpt, strength: 1}]\n" + MODELS_BLOCK, "loras.0.file"),
    (MODELS_BLOCK, "loras: [{file: a.safetensors, strength: 1, x: 1}]\n" + MODELS_BLOCK, "loras.0.x"),
    (MODELS_BLOCK, "loras: [" + ", ".join([LORA_OK] * 4) + "]\n" + MODELS_BLOCK, "loras"),
    (MODELS_BLOCK, "loras: " + LORA_OK + "\n" + MODELS_BLOCK, "loras"),
    # one past each limit, and an empty required string
    ("name: Crash Push", "name: " + "x" * 41, "name"),
    ("author: montagio-community", "author: " + "x" * 61, "author"),
    ("author: montagio-community", "author: ''", "author"),
    (DESCRIPTION, "description: " + "x" * 141, "description"),
    ('"dynamic camera push-in, cinematic, sharp focus on subject"', '"' + "x" * 301 + '"', "prompt.suffix"),
    ('"blurry, distorted, warped faces, extra limbs, flicker, low quality"', '"' + "x" * 301 + '"', "prompt.negative"),
    ("id: crash-push", "id: " + "a" * 49, "id"),
    ("preferred: wan22-i2v-a14b-fun-camera", "preferred: " + "a" * 49, "models.preferred"),
    (MODELS_BLOCK, "loras: [{file: a.safetensors, strength: -0.1}]\n" + MODELS_BLOCK, "loras.0.strength"),
]


# (replace, with, path into the parsed preset, expected value)
ACCEPTED = [
    # the 3 acceptances of schema.test.ts
    ("duration_s: 5", "duration_s: 2", ("defaults", "duration_s"), 2),
    ("duration_s: 5", "duration_s: 10", ("defaults", "duration_s"), 10),
    ("poses: [zoom_in]", "poses: [pan_up, zoom_in]", ("camera", "poses"), ["pan_up", "zoom_in"]),
    # a whole number written as a float or with leading zeros is an int
    ("duration_s: 5", "duration_s: 5.0", ("defaults", "duration_s"), 5),
    ("duration_s: 5", "duration_s: 1e1", ("defaults", "duration_s"), 10),
    ("duration_s: 5", "duration_s: 0010", ("defaults", "duration_s"), 10),
    ("fps: 16", "fps: 24.0", ("defaults", "fps"), 24),
    ("speed: 1.5", "speed: 0.1", ("camera", "speed"), 0.1),
    ("speed: 1.5", "speed: 3", ("camera", "speed"), 3),
    ("poses: [zoom_in]", "poses: [static]", ("camera", "poses"), ["static"]),
    ("resolution: 480p", "resolution: 720p", ("defaults", "resolution"), "720p"),
    # lengths count code points, like the zod version the app runs (an emoji is 1, not 2)
    ("name: Crash Push", "name: " + "😀" * 20, ("name",), "😀" * 20),
    ("name: Crash Push", "name: " + "😀" * 21, ("name",), "😀" * 21),
    ("name: Crash Push", "name: " + "😀" * 40, ("name",), "😀" * 40),
    (MODELS_BLOCK, "loras: [" + LORA_OK + "]\n" + MODELS_BLOCK, ("loras",), [{"file": "a.safetensors", "strength": 1}]),
    (MODELS_BLOCK, "loras: [" + ", ".join([LORA_OK] * 3) + "]\n" + MODELS_BLOCK, ("loras", 2, "strength"), 1),
    # YAML 1.2: strings the app keeps as strings, whereas PyYAML alone would turn them into bool/date/int
    ("name: Crash Push", "name: yes", ("name",), "yes"),
    ("author: montagio-community", "author: 2026-10-17", ("author",), "2026-10-17"),
    (DESCRIPTION, "description: 1:30", ("description",), "1:30"),
    # every allowed value of the closed sets, and every limit exactly
    ("license: CC-BY-4.0", "license: CC0-1.0", ("license",), "CC0-1.0"),
    ("license: CC-BY-4.0", "license: Apache-2.0", ("license",), "Apache-2.0"),
    ("license: CC-BY-4.0", "license: MIT", ("license",), "MIT"),
    ("fps: 16", "fps: 24", ("defaults", "fps"), 24),
    ("poses: [zoom_in]", "poses: [pan_left, pan_right]", ("camera", "poses"), ["pan_left", "pan_right"]),
    ("poses: [zoom_in]", "poses: [pan_down, zoom_out]", ("camera", "poses"), ["pan_down", "zoom_out"]),
    (MODELS_BLOCK, "loras: [{file: a.safetensors, strength: 0}]\n" + MODELS_BLOCK, ("loras", 0, "strength"), 0),
    (MODELS_BLOCK, "loras: [{file: a.safetensors, strength: 2}]\n" + MODELS_BLOCK, ("loras", 0, "strength"), 2),
    ("name: Crash Push", "name: " + "x" * 40, ("name",), "x" * 40),
    ("author: montagio-community", "author: " + "x" * 60, ("author",), "x" * 60),
    (DESCRIPTION, "description: " + "x" * 140, ("description",), "x" * 140),
    ('"dynamic camera push-in, cinematic, sharp focus on subject"', '"' + "x" * 300 + '"', ("prompt", "suffix"), "x" * 300),
    ('"blurry, distorted, warped faces, extra limbs, flicker, low quality"', '"' + "x" * 300 + '"', ("prompt", "negative"), "x" * 300),
    ("id: crash-push", "id: " + "a" * 48, ("id",), "a" * 48),
]


MINIMAL = "\n".join(
    [
        "schema: montagio/preset@0.1",
        "id: minimal",
        "name: Minimal",
        "preview: previews/minimal.webm",
        "license: MIT",
        "author: me",
        "capability: i2v-camera",
        "camera:",
        "  poses: [static]",
        "models:",
        "  preferred: some-model",
    ]
)
NO_DEFAULTS_NO_SPEED = re.sub(r"defaults:\n(  .*\n)+", "", BASE).replace("  speed: 1.5\n", "")
BACKSLASH = chr(92)
SURROGATE_PAIR = BACKSLASH + "ud83d" + BACKSLASH + "ude00"  # two YAML escapes that spell one emoji

# (title, yaml text): shapes of YAML that are not a one line edit of the fixture
SHAPES = [
    ("minimal preset, every optional field absent", MINIMAL),
    ("no defaults block and no speed", NO_DEFAULTS_NO_SPEED),
    ("CRLF line endings", BASE.replace("\n", "\r\n")),
    ("literal block scalar ending the file without a line break", MINIMAL + "\nprompt:\n  suffix: |\n    block text"),
    ("folded block scalar ending the file without a line break", MINIMAL + "\nprompt:\n  suffix: >\n    block\n    text"),
    ("empty file", ""),
    ("root is a list", "- a"),
    ("root is text", "just text"),
    ("root is a number", "5"),
    ("40 escaped surrogate pairs in a name", edit("name: Crash Push", 'name: "' + SURROGATE_PAIR * 40 + '"')),
    ("41 escaped surrogate pairs in a name", edit("name: Crash Push", 'name: "' + SURROGATE_PAIR * 41 + '"')),
    ("!!str tag", edit("name: Crash Push", "name: !!str 5")),
    ("!!int tag", edit("name: Crash Push", "name: !!int 0x1F")),
    ("!!bool tag on yes", edit("name: Crash Push", "name: !!bool yes")),
    ("unknown tag on a scalar", edit("name: Crash Push", "name: !custom text")),
    ("bare ! tag on a number", edit(DESCRIPTION, "description: ! 5")),
    ("bare ! tag on nothing", edit(DESCRIPTION, "description: !")),
    ("unknown tag on a sequence", edit("poses: [zoom_in]", "poses: !custom [zoom_in]")),
    ("anchor and alias", BASE.replace("name: Crash Push", "name: &n Crash Push").replace("author: montagio-community", "author: *n")),
    (
        "an anchor defined twice",
        BASE.replace("name: Crash Push", "name: &n First")
        .replace("author: montagio-community", "author: &n Second")
        .replace('suffix: "dynamic camera push-in, cinematic, sharp focus on subject"', "suffix: *n"),
    ),
    ("same key written twice in two ways", edit("license: CC-BY-4.0", 'license: CC-BY-4.0\n"license": MIT')),
    ("explicit merge tag merges a mapping", MINIMAL + "\nprompt:\n  !!merge <<: {suffix: merged}"),
    ("explicit merge tag, the key itself wins", MINIMAL + "\nprompt:\n  suffix: own\n  !!merge <<: {suffix: merged, negative: merged}"),
    ("explicit merge tag, the earlier mapping wins", MINIMAL + "\nprompt:\n  !!merge <<: [{suffix: first}, {suffix: second, negative: second}]"),
    ("explicit merge tag twice in a mapping", MINIMAL + "\nprompt:\n  !!merge <<: {suffix: a}\n  !!merge <<: {negative: b}"),
    ("explicit merge tag twice, the first wins", MINIMAL + "\nprompt:\n  !!merge <<: {suffix: first}\n  !!merge <<: {suffix: second}"),
    ("explicit merge tag on text", MINIMAL + "\nprompt:\n  !!merge <<: x"),
    ("explicit merge tag on a collection key", MINIMAL + "\n? !!merge [a]\n: {x: 1}"),
    ("a value tagged merge", edit("name: Crash Push", "name: !!merge x")),
    ("several documents", BASE + "---\n" + BASE),
    ("unclosed flow sequence", edit("poses: [zoom_in]", "poses: [zoom_in")),
    ("!!timestamp tag on text", edit("name: Crash Push", "name: !!timestamp not-a-date")),
    ("!!binary tag on text", edit("name: Crash Push", "name: !!binary '!'")),
    ("!!set tag", edit("name: Crash Push", "name: !!set [x]")),
    ("python object tag", edit("id: crash-push", "id: !!python/object/apply:os.system ['echo no']")),
]


def _short(text):
    shown = repr(text)
    return shown if len(shown) <= 60 else shown[:57] + "..."


def _monorepo_presets():
    """Every preset file of the monorepo, as is; none when the pack is checked out alone."""
    root = find_monorepo()
    if root is None:
        return []
    files = sorted(file for file in (root / "presets").glob("*") if file.suffix in (".yaml", ".yml"))
    return [(f"presets/{file.name}", file.read_bytes().decode("utf-8")) for file in files]


# (file name, yaml text) of every preset the monorepo ships; the compiler parity tests run on each
MONOREPO_PRESETS = _monorepo_presets()

# (name, yaml text); the bridge answers by name
CASES: list[tuple[str, str]] = (
    [(f"reject {n:02d} {where}: {_short(b)}", edit(a, b)) for n, (a, b, where) in enumerate(REJECTED)]
    + [(f"accept {n:02d} {'.'.join(map(str, path))}: {_short(b)}", edit(a, b)) for n, (a, b, path, _) in enumerate(ACCEPTED)]
    + [(f"shape: {title}", text) for title, text in SHAPES]
    + MONOREPO_PRESETS
)


# --- compiler parity (test_params.py) --------------------------------------------------
# The bridge runs the app's compileJob on each request of COMPILE, and test_params.py compares
# what comes out with what the pack computes. The requests are built here and the tests build
# the same ones again: conftest.ts_compile finds the answer by equality and fails on a request
# that is not listed. The pack does not apply the model limits (spec section 4) whereas the app
# trims a job to its model (an 8 s preset becomes 5 s, 24 fps becomes 16): the requests that
# compare duration and fps are made with wide_limits, which gives the real compileJob a copy of
# the model with the limits out of the way. Then every preset the schema accepts must give the
# same numbers in the pack and in the app, whatever presets/ holds now or later.

FUN_CAMERA = "wan22-i2v-a14b-fun-camera"  # has a camera node: the pack's parametric mode
WAN_5B = "wan22-ti2v-5b"  # no camera control: the pack's prompt mode (and it renders at 24 fps)
ASPECT_CHOICES = ("16:9", "9:16", "1:1")
RESOLUTION_CHOICES = ("480p", "720p")
USER_PROMPT = "a cat on a sofa"

# every ordered pair of distinct moves the schema accepts (a pair never holds "static")
POSE_PAIRS = [(a, b) for a in CAMERA_POSES for b in CAMERA_POSES if a != b and "static" not in (a, b)]

SUFFIX = '"dynamic camera push-in, cinematic, sharp focus on subject"'
NEGATIVE = '"blurry, distorted, warped faces, extra limbs, flicker, low quality"'
# YAML escapes: U+001C and U+0085 are white space for Python's str.strip() but not for the
# trim() of JavaScript, and U+FEFF is the other way round
ODD_SPACES = r"\x1c\x85﻿"

# (title, yaml text): presets that each exercise one input of the compiler
PRESET_VARIANTS = (
    [(f"single pose {pose}", edit("poses: [zoom_in]", f"poses: [{pose}]")) for pose in CAMERA_POSES]
    + [(f"duration {seconds} s", edit("duration_s: 5", f"duration_s: {seconds}")) for seconds in (2, 3, 4, 5)]
    + [(f"speed {speed}", edit("speed: 1.5", f"speed: {speed}")) for speed in (0.1, 1, 3)]
    + [
        ("default resolution 720p", edit("resolution: 480p", "resolution: 720p")),
        ("minimal preset (static, no prompt block)", MINIMAL),
        ("empty suffix", edit(SUFFIX, '""')),
        ("blank suffix", edit(SUFFIX, r'"  \t "')),
        ("padded suffix", edit(SUFFIX, r'"  padded suffix \n "')),
        ("suffix between odd spaces", edit(SUFFIX, f'"{ODD_SPACES}suffix{ODD_SPACES}"')),
        ("empty negative", edit(NEGATIVE, '""')),
        ("padded negative", edit(NEGATIVE, r'"  keep my spaces \n"')),
    ]
)

# (title, what the user typed in the prompt box)
USER_PROMPTS = [
    ("plain", USER_PROMPT),
    ("padded", "  a cat on a sofa \n"),
    ("empty", ""),
    ("blank", " \t\n "),
    ("unicode spaces", " 　 a cat  "),
    ("line separators", " a cat "),
    ("byte order mark", "﻿a cat﻿"),
    ("file separators", "\x1ca cat\x1f"),
    ("next line", "\x85a cat\x85"),
    ("inner commas", "a cat, a dog,"),
]

LORA_BLOCK = "loras:\n  - { file: style.safetensors, strength: 0.8 }\n"


# (title, yaml text): presets the schema accepts that no file of presets/ is today, but one could be
# tomorrow: beyond the limits of the models, with two moves, with LoRAs. Written in memory, never added to presets/.
BEYOND_PRESETS = [
    ("in memory: 8 s", edit("duration_s: 5", "duration_s: 8")),
    ("in memory: 24 fps", edit("fps: 16", "fps: 24")),
    ("in memory: 10 s at 24 fps, 720p", edit("duration_s: 5", "duration_s: 10").replace("fps: 16", "fps: 24").replace("resolution: 480p", "resolution: 720p")),
    ("in memory: two moves", edit("poses: [zoom_in]", "poses: [pan_up, zoom_in]")),
    ("in memory: LoRAs", BASE + LORA_BLOCK),
    ("in memory: two moves and LoRAs", edit("poses: [zoom_in]", "poses: [pan_up, zoom_in]") + LORA_BLOCK),
]
# what test_compile_parity_fun_camera and test_compile_parity_prompt_mode_5b run on
DRIVEN_PRESETS = MONOREPO_PRESETS + BEYOND_PRESETS


def compile_request(preset_yaml, model, aspect="16:9", resolution=None, user_prompt=None, wide_limits=False):
    """One request for the bridge; a resolution or a prompt left out is an input left unset."""
    request = {"preset_yaml": preset_yaml, "model": model, "aspect": aspect}
    if resolution is not None:
        request["resolution"] = resolution
    if user_prompt is not None:
        request["userPrompt"] = user_prompt
    if wide_limits:
        request["wide_limits"] = True
    return request


def fun_camera_request(preset_yaml, aspect="16:9", resolution=None, user_prompt=None):
    """The camera model, its limits out of the way, for the tests that compare duration, fps and frames."""
    return compile_request(preset_yaml, FUN_CAMERA, aspect, resolution, user_prompt, wide_limits=True)


def prompt_mode_request(preset_yaml, aspect="1:1", user_prompt=None):
    """The model without camera control (the pack's prompt mode), its limits out of the way."""
    return compile_request(preset_yaml, WAN_5B, aspect, None, user_prompt, wide_limits=True)


COMPILE: list[dict] = (
    # test_compile_parity_fun_camera: every preset of the monorepo and the in-memory ones, every aspect, every resolution
    [
        fun_camera_request(text, aspect, resolution, "a cat")
        for _, text in DRIVEN_PRESETS
        for aspect in ASPECT_CHOICES
        for resolution in RESOLUTION_CHOICES
    ]
    # test_compile_parity_prompt_mode_5b and test_compile_parity_variants
    + [prompt_mode_request(text, user_prompt=USER_PROMPT) for _, text in DRIVEN_PRESETS + PRESET_VARIANTS]
    + [fun_camera_request(text, user_prompt=USER_PROMPT) for _, text in PRESET_VARIANTS]
    # test_compile_parity_user_prompts and test_compile_parity_without_user_prompt
    + [fun_camera_request(text, user_prompt=prompt) for _, prompt in USER_PROMPTS for text in (BASE, MINIMAL)]
    + [compile_request(text, WAN_5B, user_prompt=prompt) for _, prompt in USER_PROMPTS for text in (BASE, MINIMAL)]
    + [fun_camera_request(BASE), compile_request(BASE, WAN_5B)]
    # test_two_poses_parity
    + [
        compile_request(edit("poses: [zoom_in]", f"poses: [{a}, {b}]"), model, user_prompt=USER_PROMPT)
        for a, b in POSE_PAIRS
        for model in (FUN_CAMERA, WAN_5B)
    ]
    # test_loras_parity
    + [compile_request(BASE + LORA_BLOCK, model, user_prompt=USER_PROMPT) for model in (FUN_CAMERA, WAN_5B)]
)
