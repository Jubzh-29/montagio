# SPDX-License-Identifier: GPL-3.0-only
"""The Montagio Camera Embedding node: the camera path of one move, of two at once, or of one then the other.

The reference is ComfyUI v0.41.0, comfy_extras/nodes_camera_trajectory.py: get_camera_motion builds
the path of WanCameraEmbedding, and execute lays its rows out for process_pose_params. The light
tests below compare camera.py with an independent, frame-by-frame rewrite of that formula in plain
Python (math, no numpy). The heavy test at the end runs the real core node next to ours, in the
Python of a ComfyUI install, and wants the same tensor; it is skipped unless MONTAGIO_COMFYUI_DIR
names a ComfyUI v0.41.0 checkout, whose Python (with torch) is MONTAGIO_COMFYUI_PYTHON or a .venv
inside the checkout.
"""
import json
import math
import os
import subprocess
import sys
import types
from pathlib import Path

import numpy as np
import pytest

from montagio_nodes import nodes
from montagio_nodes.camera import COMBINE_MODES, camera_rows, check_length, trajectory
from montagio_nodes.nodes import MontagioCameraEmbedding, MontagioExtension
from montagio_nodes.wan import WAN_CAMERA_POSES

PACK_DIR = Path(__file__).resolve().parent.parent

# CAMERA_DICT of ComfyUI v0.41.0 (comfy_extras/nodes_camera_trajectory.py), copied for the tests
BASE_T = 1.5
BASE_ANGLE = math.pi / 3
CORE_POSES = {
    "Static": ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
    "Pan Up": ([0.0, 0.0, 0.0], [0.0, -1.0, 0.0]),
    "Pan Down": ([0.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    "Pan Left": ([0.0, 0.0, 0.0], [-1.0, 0.0, 0.0]),
    "Pan Right": ([0.0, 0.0, 0.0], [1.0, 0.0, 0.0]),
    "Zoom In": ([0.0, 0.0, 0.0], [0.0, 0.0, 2.0]),
    "Zoom Out": ([0.0, 0.0, 0.0], [0.0, 0.0, -2.0]),
    "Anti Clockwise (ACW)": ([0.0, 0.0, -1.0], [0.0, 0.0, 0.0]),
    "ClockWise (CW)": ([0.0, 0.0, 1.0], [0.0, 0.0, 0.0]),
}


def motion(pose):
    angle, t = CORE_POSES[pose]
    return np.array(angle), np.array(t)


def path(pose_a, pose_b="Static", combine="together", speed=1.0, length=81):
    return trajectory(motion(pose_a), motion(pose_b), combine, speed, length, base_angle=BASE_ANGLE, base_t=BASE_T)


def _matmul(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(3)) for c in range(3)] for r in range(3)]


def reference_frame(angle, t):
    """One [R|T] of get_camera_motion for an already scaled angle and translation; R = Rz.Ry.Rx."""
    x, y, z = angle
    rx = [[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]]
    ry = [[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]]
    rz = [[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]]
    r = _matmul(rz, _matmul(ry, rx))
    return [r[row] + [t[row]] for row in range(3)]


def reference_motion(angle, t, speed, n):
    """get_camera_motion(angle, T, speed, n) of the core, frame by frame."""
    return [
        reference_frame([(i / n) * speed * BASE_ANGLE * a for a in angle], [(i / n) * speed * BASE_T * v for v in t])
        for i in range(n)
    ]


def add(u, v):
    return [a + b for a, b in zip(u, v)]


# --- the path --------------------------------------------------------------------------------


@pytest.mark.parametrize("pose", WAN_CAMERA_POSES)
@pytest.mark.parametrize("speed", [0.5, 1.0, 3.0])
@pytest.mark.parametrize("length", [1, 5, 81])
def test_together_with_static_is_the_core_trajectory(pose, speed, length):
    angle, t = CORE_POSES[pose]
    expected = reference_motion(angle, t, speed, length)
    assert path(pose, speed=speed, length=length).shape == (length, 3, 4)
    assert np.allclose(path(pose, speed=speed, length=length), expected, rtol=0, atol=1e-12)


def test_together_adds_the_two_moves():
    (a1, t1), (a2, t2) = CORE_POSES["Pan Up"], CORE_POSES["Zoom In"]
    expected = reference_motion(add(a1, a2), add(t1, t2), 1.0, 81)
    assert np.allclose(path("Pan Up", "Zoom In"), expected, rtol=0, atol=1e-12)


def test_together_adds_a_roll_and_a_move():
    (a1, t1), (a2, t2) = CORE_POSES["ClockWise (CW)"], CORE_POSES["Pan Left"]
    expected = reference_motion(add(a1, a2), add(t1, t2), 0.5, 81)
    assert np.allclose(path("ClockWise (CW)", "Pan Left", speed=0.5), expected, rtol=0, atol=1e-12)


def test_together_does_not_depend_on_the_order():
    assert np.allclose(path("Pan Left", "Zoom In"), path("Zoom In", "Pan Left"), rtol=0, atol=1e-12)


def test_then_moves_a_over_the_first_half_then_b():
    length = 81
    then = path("Zoom In", "Pan Left", "then", speed=2.0, length=length)
    a_angle, a_t = CORE_POSES["Zoom In"]
    b_angle, b_t = CORE_POSES["Pan Left"]
    assert np.allclose(then[0], reference_frame([0, 0, 0], [0, 0, 0]), rtol=0, atol=1e-12)  # the first frame does not move
    for i in range(length):
        p = i / length
        w_a, w_b = min(1.0, 2 * p), max(0.0, 2 * p - 1)
        t = [2.0 * BASE_T * (w_a * a + w_b * b) for a, b in zip(a_t, b_t)]
        angle = [2.0 * BASE_ANGLE * (w_a * a + w_b * b) for a, b in zip(a_angle, b_angle)]
        assert np.allclose(then[i], reference_frame(angle, t), rtol=0, atol=1e-12), f"frame {i}"
    # by the middle of the clip A is complete and B has not started
    middle = then[(length + 1) // 2]
    assert middle[2][3] == pytest.approx(2.0 * BASE_T * 2.0) and middle[0][3] == pytest.approx(-2.0 * BASE_T * (2 * (41 / 81) - 1))


def test_then_with_static_holds_the_end_of_a():
    # Push & Settle: push in over the first half, then hold
    then = path("Zoom In", "Static", "then", speed=0.7)
    second_half = then[41:]
    assert np.allclose(second_half, second_half[0], rtol=0, atol=1e-12)
    assert then[40][2][3] < then[41][2][3]


def test_zoom_in_then_zoom_out_comes_back_near_the_start():
    # Breathing: in, then out by the same amount
    then = path("Zoom In", "Zoom Out", "then", speed=0.2)
    depth = [frame[2][3] for frame in then]
    full_push = 0.2 * BASE_T * 2.0
    # no frame falls exactly on the middle of the clip, hence the 2 %
    assert max(depth) == pytest.approx(full_push, rel=0.02)
    assert abs(depth[-1]) < 0.03 * full_push


def test_then_with_static_first_waits_before_moving():
    then = path("Static", "Zoom In", "then", length=81)
    assert np.allclose(then[:41], then[0], rtol=0, atol=1e-12)
    assert then[-1][2][3] > 0


def test_an_unknown_combine_mode_is_refused():
    assert COMBINE_MODES == ("together", "then")
    with pytest.raises(ValueError, match='combine "sideways" is not one of together, then'):
        path("Zoom In", "Pan Left", "sideways")


# --- the rows given to process_pose_params ---------------------------------------------------


def reference_rows(rt, fx, fy, cx, cy):
    """What WanCameraEmbedding.execute of the core builds from a path before process_pose_params."""
    trajs = []
    for cp in np.asarray(rt).tolist():
        traj = [fx, fy, cx, cy, 0, 0]
        traj.extend(cp[0])
        traj.extend(cp[1])
        traj.extend(cp[2])
        traj.extend([0, 0, 0, 1])
        trajs.append(traj)
    cam_params = np.array([[float(x) for x in pose] for pose in trajs])
    return np.concatenate([np.zeros_like(cam_params[:, :1]), cam_params], 1)


def test_camera_rows_match_the_layout_of_the_core():
    rt = path("Pan Up", "ClockWise (CW)", speed=1.3, length=9)
    rows = camera_rows(rt, 0.5, 0.45, 0.5, 0.52)
    assert rows.shape == (9, 23)
    assert np.array_equal(rows, reference_rows(rt, 0.5, 0.45, 0.5, 0.52))


@pytest.mark.parametrize("length", [1, 5, 81, 16381])
def test_a_length_of_the_form_4n_plus_1_is_accepted(length):
    check_length(length)


@pytest.mark.parametrize("length", [0, 2, 4, 80, -3])
def test_a_length_that_is_not_4n_plus_1_is_refused(length):
    with pytest.raises(ValueError, match=r"length must be 4n\+1 \(1, 5, \.\.\., 81\)"):
        check_length(length)


# --- the node --------------------------------------------------------------------------------


def test_the_node_schema():
    schema = MontagioCameraEmbedding.GET_SCHEMA()
    assert (schema.node_id, schema.display_name, schema.category) == ("MontagioCameraEmbedding", "Montagio Camera Embedding", "Montagio")
    inputs = {item.id: item for item in schema.inputs}
    assert list(inputs) == ["camera_pose", "camera_pose_2", "combine", "width", "height", "length", "speed", "fx", "fy", "cx", "cy"]
    for name in ("camera_pose", "camera_pose_2"):
        assert (inputs[name].io_type, inputs[name].options, inputs[name].default) == ("COMBO", list(WAN_CAMERA_POSES), "Static")
    assert (inputs["combine"].options, inputs["combine"].default) == (["together", "then"], "together")
    # the same bounds as WanCameraEmbedding, so the node can stand in for it
    assert [(inputs[n].default, inputs[n].min, inputs[n].step) for n in ("width", "height", "length")] == [(832, 16, 16), (480, 16, 16), (81, 1, 4)]
    assert all(inputs[n].max == 16384 for n in ("width", "height", "length"))
    assert (inputs["speed"].default, inputs["speed"].min, inputs["speed"].max, inputs["speed"].step, inputs["speed"].optional) == (1.0, 0, 10.0, 0.1, True)
    assert [(inputs[n].default, inputs[n].optional, inputs[n].advanced) for n in ("fx", "fy", "cx", "cy")] == [(0.5, True, True)] * 4
    assert [o.io_type for o in schema.outputs] == ["WAN_CAMERA_EMBEDDING", "INT", "INT", "INT"]
    assert [o.display_name for o in schema.outputs] == ["camera_embedding", "width", "height", "length"]


def test_the_node_is_in_the_extension():
    import asyncio

    assert MontagioCameraEmbedding in asyncio.run(MontagioExtension().get_node_list())


@pytest.fixture
def fake_core(monkeypatch):
    """comfy_extras.nodes_camera_trajectory as the node uses it: CAMERA_DICT and process_pose_params."""
    calls = []
    core = types.ModuleType("comfy_extras.nodes_camera_trajectory")
    core.CAMERA_DICT = {"base_T_norm": BASE_T, "base_angle": BASE_ANGLE, **{k: {"angle": a, "T": t} for k, (a, t) in CORE_POSES.items()}}

    def process_pose_params(cam_params, width=672, height=384, original_pose_width=1280, original_pose_height=720, device="cpu"):
        calls.append({"cam_params": cam_params, "width": width, "height": height})
        return "plucker"

    core.process_pose_params = process_pose_params
    package = types.ModuleType("comfy_extras")
    package.nodes_camera_trajectory = core
    monkeypatch.setitem(sys.modules, "comfy_extras", package)
    monkeypatch.setitem(sys.modules, "comfy_extras.nodes_camera_trajectory", core)
    monkeypatch.setattr(nodes, "wan_layout", lambda plucker: f"layout of {plucker}")
    return calls


def test_execute_passes_the_rows_of_the_combined_move_to_process_pose_params(fake_core):
    out = MontagioCameraEmbedding.execute(
        camera_pose="Pan Up", camera_pose_2="Zoom In", combine="together", width=832, height=480, length=9, speed=1.5,
    )
    assert out.args == ("layout of plucker", 832, 480, 9)
    [call] = fake_core
    assert (call["width"], call["height"]) == (832, 480)
    expected = reference_rows(path("Pan Up", "Zoom In", speed=1.5, length=9), 0.5, 0.5, 0.5, 0.5)
    assert np.allclose(call["cam_params"], expected, rtol=0, atol=1e-12)


def test_execute_chains_the_moves_with_then(fake_core):
    MontagioCameraEmbedding.execute(camera_pose="Zoom In", camera_pose_2="Static", combine="then", width=64, height=48, length=5)
    expected = reference_rows(path("Zoom In", "Static", "then", length=5), 0.5, 0.5, 0.5, 0.5)
    assert np.allclose(fake_core[0]["cam_params"], expected, rtol=0, atol=1e-12)


def test_a_length_that_is_not_4n_plus_1_is_refused_before_any_work(fake_core):
    with pytest.raises(ValueError, match=r"4n\+1"):
        MontagioCameraEmbedding.execute(camera_pose="Zoom In", camera_pose_2="Static", combine="together", width=832, height=480, length=80)
    assert fake_core == []



OBJECT_INFO = PACK_DIR.parent / "infra" / "runpod" / "test" / "fixtures" / "object_info-v0.41.0.json"


def test_the_object_info_fixture_of_the_app_describes_this_node():
    # the app checks its compiled workflows against that fixture (infra/runpod/test/workflows.test.ts):
    # change the node, then take the fixture again from a ComfyUI that loads the pack
    if not OBJECT_INFO.exists():
        pytest.skip("the object_info fixture is part of the monorepo")
    fixture = json.loads(OBJECT_INFO.read_text(encoding="utf-8"))["MontagioCameraEmbedding"]
    schema = MontagioCameraEmbedding.GET_SCHEMA()
    split = {"required": [i.id for i in schema.inputs if not i.optional], "optional": [i.id for i in schema.inputs if i.optional]}
    assert fixture["input_order"] == split
    for item in schema.inputs:
        spec = fixture["input"]["optional" if item.optional else "required"][item.id]
        assert spec[0] == item.io_type, item.id
        assert spec[1].get("default") == item.default, item.id
        if item.io_type == "COMBO":
            assert spec[1]["options"] == item.options, item.id
        else:
            assert (spec[1].get("min"), spec[1].get("max"), spec[1].get("step")) == (item.min, item.max, item.step), item.id
    assert fixture["output"] == [o.io_type for o in schema.outputs]
    assert fixture["output_name"] == [o.display_name for o in schema.outputs]


# --- against the real core node, in a ComfyUI install ------------------------------------------

COMFYUI_DIR = os.environ.get("MONTAGIO_COMFYUI_DIR")

AGAINST_CORE = r"""
import importlib.util, json, sys
comfy_dir, pack_dir = sys.argv[1:3]
sys.path.insert(0, comfy_dir)
from comfy.cli_args import args
args.cpu = True  # imported as a library ComfyUI parses no flags: never ask for CUDA here
import torch
from comfy_extras import nodes_camera_trajectory as core

spec = importlib.util.spec_from_file_location("montagio_pack", pack_dir + "/__init__.py", submodule_search_locations=[pack_dir])
pack = importlib.util.module_from_spec(spec)
sys.modules["montagio_pack"] = pack
spec.loader.exec_module(pack)
from montagio_pack.montagio_nodes.nodes import MontagioCameraEmbedding

result = {"camera_dict": {k: v for k, v in core.CAMERA_DICT.items()}, "equal": {}}
for pose in json.loads(sys.argv[3]):
    args = dict(width=64, height=48, length=9, speed=1.7, fx=0.5, fy=0.45, cx=0.5, cy=0.5)
    theirs = core.WanCameraEmbedding.execute(camera_pose=pose, **args)
    ours = MontagioCameraEmbedding.execute(camera_pose=pose, camera_pose_2="Static", combine="together", **args)
    result["equal"][pose] = bool(torch.equal(theirs.args[0], ours.args[0])) and theirs.args[1:] == ours.args[1:]
    result["shape"] = list(theirs.args[0].shape)
result["combined"] = {}
for combine in ("together", "then"):
    out = MontagioCameraEmbedding.execute(camera_pose="Pan Up", camera_pose_2="Zoom In", combine=combine, width=64, height=48, length=9, speed=1.7)
    result["combined"][combine] = {"shape": list(out.args[0].shape), "finite": bool(torch.isfinite(out.args[0]).all())}
print(json.dumps(result))
"""


def comfyui_python():
    """MONTAGIO_COMFYUI_PYTHON (the pod's /workspace/venvs/comfyui/bin/python), else a .venv inside the checkout."""
    explicit = os.environ.get("MONTAGIO_COMFYUI_PYTHON")
    if explicit:
        return explicit
    for candidate in (Path(COMFYUI_DIR) / ".venv" / "Scripts" / "python.exe", Path(COMFYUI_DIR) / ".venv" / "bin" / "python"):
        if candidate.exists():
            return str(candidate)
    pytest.fail(f"MONTAGIO_COMFYUI_DIR={COMFYUI_DIR} has no .venv with a Python: set MONTAGIO_COMFYUI_PYTHON", pytrace=False)


@pytest.fixture(scope="module")
def against_core():
    if not COMFYUI_DIR:
        pytest.skip("set MONTAGIO_COMFYUI_DIR to a ComfyUI v0.41.0 checkout with a .venv to compare with the core node")
    done = subprocess.run(
        [comfyui_python(), "-c", AGAINST_CORE, COMFYUI_DIR, str(PACK_DIR), json.dumps(list(WAN_CAMERA_POSES))],
        cwd=COMFYUI_DIR, capture_output=True, text=True, timeout=600, check=False,
    )
    assert done.returncode == 0, done.stderr[-3000:]
    return json.loads(done.stdout.strip().splitlines()[-1])


def test_matches_wan_camera_embedding_for_every_single_pose(against_core):
    assert against_core["equal"] == {pose: True for pose in WAN_CAMERA_POSES}


def test_two_moves_give_an_embedding_of_the_shape_the_core_gives(against_core):
    # [batch, 24 channels, (length + 3) // 4 frame groups, height, width]
    assert against_core["shape"] == [1, 24, 3, 48, 64]
    assert against_core["combined"] == {mode: {"shape": [1, 24, 3, 48, 64], "finite": True} for mode in ("together", "then")}


def test_camera_dict_of_the_core_is_the_test_constant(against_core):
    core = against_core["camera_dict"]
    assert (core["base_T_norm"], core["base_angle"]) == (BASE_T, BASE_ANGLE)
    assert {k: (v["angle"], v["T"]) for k, v in core.items() if k not in ("base_T_norm", "base_angle")} == CORE_POSES
