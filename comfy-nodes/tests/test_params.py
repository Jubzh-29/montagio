# SPDX-License-Identifier: GPL-3.0-only
"""The node outputs are computed like the app's compiler does.

packages/presets/src/compile.ts and dimensions.ts are the reference: the tables of the pack are
compared with the app's own (through the bridge), and compute_params is compared with the params
of the app's compileJob for every preset of the monorepo. One check matters most: the value the
node sends to WanCameraEmbedding for each pose is one of the 9 `camera_pose` values of that node.

The node does not apply the limits of a model (spec section 4: the app trims the duration and
picks the fps a model can render, the pack leaves that to the workflow), so the requests that
compare duration, fps and frames give compileJob a copy of the model with its limits out of the
way (wide_limits in tests/ts_bridge.ts). Then any preset the schema accepts must agree with the
app: the same numbers, or the same refusal (two moves for the camera node, LoRAs).
"""
import dataclasses

import pytest

from montagio_nodes.params import (
    ASPECTS,
    AUTO,
    DIMENSIONS,
    POSE_PROMPTS,
    POSE_VALUES,
    NodeParams,
    ParamsError,
    compute_params,
    frame_count,
    pick_aspect,
    resolve_aspect,
)
from montagio_nodes.preset import CAMERA_POSES, parse_preset
from montagio_nodes.wan import WAN_CAMERA_POSES
from tests.bridge import find_monorepo
from tests.conftest import ts_compile
from tests.parity_cases import (
    ALL_JS_WHITE_SPACE,
    ASPECT_CHOICES,
    BASE,
    BEYOND_PRESETS,
    DRIVEN_PRESETS,
    FUN_CAMERA,
    LORA_BLOCK,
    MINIMAL,
    MONOREPO_PRESETS,
    POSE_PAIRS,
    THEN_PAIRS,
    PRESET_VARIANTS,
    RESOLUTION_CHOICES,
    USER_PROMPT,
    USER_PROMPTS,
    WAN_5B,
    compile_request,
    edit,
    fun_camera_request,
    prompt_mode_request,
    then_preset,
)

CRASH = parse_preset(BASE, "crash-push.yaml")
TWO_POSES = parse_preset(edit("poses: [zoom_in]", "poses: [pan_up, zoom_in]"), "two-poses.yaml")


# --- the tables -----------------------------------------------------------------------------


def test_wan_camera_poses_are_the_nine_of_comfyui():
    # ComfyUI v0.41.0, comfy_extras/nodes_camera_trajectory.py, WanCameraEmbedding.camera_pose
    assert WAN_CAMERA_POSES == (
        "Static",
        "Pan Up",
        "Pan Down",
        "Pan Left",
        "Pan Right",
        "Zoom In",
        "Zoom Out",
        "Anti Clockwise (ACW)",
        "ClockWise (CW)",
    )


def test_every_app_pose_value_is_a_wan_value():
    assert set(POSE_VALUES.values()) <= set(WAN_CAMERA_POSES)


def test_every_pose_of_a_preset_reaches_the_camera_node_as_a_wan_value():
    for pose in CAMERA_POSES:
        preset = parse_preset(edit("poses: [zoom_in]", f"poses: [{pose}]"), f"{pose}.yaml")
        assert compute_params(preset, aspect="16:9").camera_pose in WAN_CAMERA_POSES


def test_pose_tables_match_typescript(ts):
    assert POSE_VALUES == ts["constants"]["CAMERA_POSE_VALUES"]
    assert POSE_PROMPTS == ts["constants"]["CAMERA_POSE_PROMPTS"]
    assert set(POSE_VALUES) == set(CAMERA_POSES)


def test_dimensions_frames_aspect_match_typescript(ts):
    constants = ts["constants"]
    app_dimensions = {}  # the app indexes by aspect then resolution, the pack by resolution then aspect
    for aspect, by_resolution in constants["dimensions"].items():
        for resolution, size in by_resolution.items():
            app_dimensions.setdefault(resolution, {})[aspect] = (size["width"], size["height"])
    assert DIMENSIONS == app_dimensions
    assert set(ASPECTS) == set(constants["dimensions"])
    assert all(set(by_aspect) == set(ASPECTS) for by_aspect in DIMENSIONS.values())

    frames = [(int(duration), int(fps), expected) for duration, by_fps in constants["frameCount"].items() for fps, expected in by_fps.items()]
    assert frames
    for duration, fps, expected in frames:
        assert frame_count(duration, fps) == expected, (duration, fps)

    assert constants["pickAspect"]
    for entry in constants["pickAspect"]:
        assert pick_aspect(entry["width"], entry["height"]) == entry["aspect"], entry


# --- frame_count, pick_aspect, resolve_aspect ------------------------------------------------


def test_frame_count_rounds_half_up_like_math_round():
    # 18 fps for 1 s is 4.5 groups of 4 frames: Math.round gives 5 (so 21), Python's round gives 4 (so 17)
    assert frame_count(1, 18) == 21
    assert frame_count(5, 18) == 93  # 22.5 groups: 23 for Math.round, 22 for round()


@pytest.mark.parametrize(
    "width,height,expected",
    [(1920, 1080, "16:9"), (1080, 1920, "9:16"), (1000, 1000, "1:1"), (1400, 1000, "16:9"), (1399, 1000, "1:1"), (710, 1000, "9:16"), (711, 1000, "1:1")],
)
def test_pick_aspect_thresholds(width, height, expected):
    assert pick_aspect(width, height) == expected


@pytest.mark.parametrize("size", [(0, 1080), (1920, 0), (-1, -1)])
def test_pick_aspect_refuses_an_empty_image(size):
    with pytest.raises(ParamsError, match="image"):
        pick_aspect(*size)


@pytest.mark.parametrize(
    "choice,size,expected",
    [("auto", None, "16:9"), ("auto", (1080, 1920), "9:16"), ("auto", (1300, 1000), "1:1"), ("9:16", (1920, 1080), "9:16"), ("1:1", None, "1:1")],
)
def test_resolve_aspect(choice, size, expected):
    assert resolve_aspect(choice, size) == expected


def test_auto_is_not_an_aspect():
    assert AUTO == "auto" and AUTO not in ASPECTS and ASPECTS == ("16:9", "9:16", "1:1")


def test_resolve_aspect_refuses_an_unknown_choice():
    with pytest.raises(ParamsError, match="4:3"):
        resolve_aspect("4:3", (1920, 1080))


# --- compute_params ---------------------------------------------------------------------------


def test_crash_push_parametric():
    p = compute_params(CRASH, aspect="16:9", prompt="a cat on a sofa")
    assert (p.camera_pose, p.speed, p.width, p.height, p.length, p.fps) == ("Zoom In", 1.5, 832, 480, 81, 16.0)
    assert p.prompt == "a cat on a sofa, dynamic camera push-in, cinematic, sharp focus on subject"
    assert p.negative == "blurry, distorted, warped faces, extra limbs, flicker, low quality"
    assert (p.duration_s, p.resolution) == (5, "480p")
    assert p.info == "Crash Push (crash-push) — by montagio-community — CC-BY-4.0"
    assert isinstance(p.speed, float) and isinstance(p.fps, float)


def test_params_are_frozen():
    p = compute_params(CRASH, aspect="16:9")
    assert [field.name for field in dataclasses.fields(NodeParams)] == [
        "camera_pose", "speed", "width", "height", "length", "fps", "prompt", "negative", "duration_s", "resolution", "info",
    ]
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.width = 1


def test_prompt_mode_is_camera_neutral():
    p = compute_params(CRASH, aspect="1:1", camera_mode="prompt")
    assert (p.camera_pose, p.speed, p.width, p.height) == ("Static", 1.0, 640, 640)
    assert isinstance(p.speed, float)
    assert p.prompt == "dynamic camera push-in, cinematic, sharp focus on subject, the camera pushes in toward the subject"


def test_two_poses_refused_in_parametric_but_phrased_in_prompt_mode():
    with pytest.raises(ParamsError, match=r"Pan Up \+ Zoom In"):
        compute_params(TWO_POSES, aspect="16:9")
    assert compute_params(TWO_POSES, aspect="16:9", camera_mode="prompt").prompt.endswith(
        "the camera tilts up, the camera pushes in toward the subject"
    )


def test_two_poses_message():
    with pytest.raises(ParamsError) as caught:
        compute_params(TWO_POSES, aspect="16:9")
    assert str(caught.value) == (
        "preset crash-push combines 2 camera moves (Pan Up + Zoom In); WanCameraEmbedding takes one move. "
        'Use camera_mode "prompt", or the Montagio Camera Embedding node with the second move set by hand.'
    )


def test_two_poses_one_after_the_other_message():
    preset = parse_preset(edit("poses: [zoom_in]", "poses: [zoom_in, static]\n  combine: then"), "settle.yaml")
    with pytest.raises(ParamsError, match=r"combines 2 camera moves \(Zoom In, then Static\);"):
        compute_params(preset, aspect="16:9")


def test_prompt_mode_chains_moves_that_come_one_after_the_other():
    preset = parse_preset(edit("poses: [zoom_in]", "poses: [zoom_in, static]\n  combine: then"), "settle.yaml")
    assert compute_params(preset, aspect="16:9", camera_mode="prompt").prompt.endswith(
        "the camera pushes in toward the subject, then static locked-off camera"
    )


def test_loras_refused():
    preset = parse_preset(BASE + LORA_BLOCK, "lora.yaml")
    for mode in ("parametric", "prompt"):
        with pytest.raises(ParamsError) as caught:
            compute_params(preset, aspect="16:9", camera_mode=mode)
        assert str(caught.value) == "preset crash-push uses LoRAs, which are not supported yet"


def test_resolution_override_720p():
    p = compute_params(CRASH, aspect="9:16", resolution="720p")
    assert (p.width, p.height, p.resolution) == (720, 1280, "720p")


def test_resolution_defaults_to_the_one_of_the_preset():
    preset = parse_preset(edit("resolution: 480p", "resolution: 720p"), "hd.yaml")
    assert compute_params(preset, aspect="1:1").resolution == "720p"
    assert compute_params(preset, aspect="1:1", resolution="480p").resolution == "480p"


def test_duration_and_fps_come_from_the_preset():
    preset = parse_preset(edit("duration_s: 5", "duration_s: 8").replace("fps: 16", "fps: 24"), "long.yaml")
    p = compute_params(preset, aspect="16:9")
    assert (p.duration_s, p.fps, p.length) == (8, 24.0, 4 * 48 + 1)


def test_blank_parts_are_left_out():
    assert compute_params(CRASH, aspect="16:9", prompt="  \n").prompt == "dynamic camera push-in, cinematic, sharp focus on subject"
    assert compute_params(parse_preset(MINIMAL, "minimal.yaml"), aspect="16:9").prompt == ""
    assert compute_params(parse_preset(MINIMAL, "minimal.yaml"), aspect="16:9", camera_mode="prompt").prompt == "static locked-off camera"


def test_trim_is_the_one_of_javascript():
    # U+FEFF is trimmed by JavaScript (not by str.strip), U+001C and U+0085 are kept (str.strip drops them)
    p = compute_params(CRASH, aspect="16:9", prompt="\ufeff\x85a cat\x1c\ufeff")
    assert p.prompt == "\x85a cat\x1c, dynamic camera push-in, cinematic, sharp focus on subject"


def test_trim_removes_every_white_space_of_javascript_and_keeps_the_inner_ones():
    assert len(set(ALL_JS_WHITE_SPACE)) == 25
    spaced = ALL_JS_WHITE_SPACE + "a cat" + ALL_JS_WHITE_SPACE + "on a sofa" + ALL_JS_WHITE_SPACE
    p = compute_params(CRASH, aspect="16:9", prompt=spaced)
    assert p.prompt == "a cat" + ALL_JS_WHITE_SPACE + "on a sofa, dynamic camera push-in, cinematic, sharp focus on subject"


@pytest.mark.parametrize(
    "kwargs",
    [{"aspect": "auto"}, {"aspect": "4:3"}, {"aspect": "16:9", "resolution": "1080p"}, {"aspect": "16:9", "camera_mode": "both"}],
)
def test_bad_arguments_are_refused(kwargs):
    with pytest.raises(ParamsError):
        compute_params(CRASH, **kwargs)


# --- parity with the app's compileJob -------------------------------------------------------


def assert_same_as_compile_job(p, expected, *, camera=True):
    assert "error" not in expected, expected.get("error")
    assert (p.width, p.height, p.length, p.fps) == (expected["width"], expected["height"], expected["frames"], expected["fps"])
    assert (p.resolution, p.duration_s) == (expected["resolution"], expected["duration_s"])
    assert (p.prompt, p.negative) == (expected["prompt"], expected["negative"])
    if camera:
        assert (p.camera_pose, p.speed) == (expected["cameraPose"], expected["cameraSpeed"])


def assert_parametric_parity(ts, name, text, *, aspect="16:9", resolution=None, prompt=None):
    """The node in parametric mode against compileJob for the camera model, limits out of the way.

    Whatever the preset holds, the pack and the app agree: the same numbers, or the same refusal.
    """
    preset = parse_preset(text, name)
    expected = ts_compile(ts, fun_camera_request(text, aspect, resolution, prompt))
    arguments = {"aspect": aspect, "resolution": resolution, "prompt": prompt or ""}
    if preset["loras"]:
        # the app refuses the job and the pack does too, in the same words
        with pytest.raises(ParamsError) as caught:
            compute_params(preset, **arguments)
        assert str(caught.value) == expected["error"]
        return
    assert "error" not in expected, expected.get("error")
    assert expected["cameraMode"] == "parametric"
    if len(preset["camera"]["poses"]) > 1:
        # the app sends the two moves to Montagio Camera Embedding; the pack's nodes have one camera_pose
        # output, so they refuse and name the same pair
        with pytest.raises(ParamsError) as caught:
            compute_params(preset, **arguments)
        joiner = ", then " if expected["cameraCombine"] == "then" else " + "
        assert f"({expected['cameraPose']}{joiner}{expected['cameraPose2']});" in str(caught.value)
        return
    assert_same_as_compile_job(compute_params(preset, **arguments), expected)


def assert_prompt_mode_parity(ts, name, text, *, prompt=None):
    """The node in prompt mode against compileJob for the model without camera control.

    The prompt is what this mode changes (its camera is Static and 1.0, the app's are null), and the numbers
    are compared above, with the camera model.
    """
    preset = parse_preset(text, name)
    expected = ts_compile(ts, prompt_mode_request(text, "1:1", prompt))
    arguments = {"aspect": "1:1", "prompt": prompt or "", "camera_mode": "prompt"}
    if preset["loras"]:
        with pytest.raises(ParamsError) as caught:
            compute_params(preset, **arguments)
        assert str(caught.value) == expected["error"]
        return
    assert "error" not in expected, expected.get("error")
    assert expected["cameraMode"] == "prompt" and expected["cameraPose"] is None
    p = compute_params(preset, **arguments)
    assert p.prompt == expected["prompt"]
    assert (p.camera_pose, p.speed) == ("Static", 1.0)


def test_in_memory_presets_cover_what_the_monorepo_may_never_hold():
    presets = [parse_preset(text, title) for title, text in BEYOND_PRESETS]
    assert any(preset["defaults"]["duration_s"] > 5 for preset in presets)
    assert any(preset["defaults"]["fps"] == 24 for preset in presets)
    assert any(len(preset["camera"]["poses"]) > 1 for preset in presets)
    assert any(preset["loras"] for preset in presets)


@pytest.mark.parametrize("name,text", DRIVEN_PRESETS, ids=[name for name, _ in DRIVEN_PRESETS])
@pytest.mark.parametrize("aspect", ASPECT_CHOICES)
@pytest.mark.parametrize("resolution", RESOLUTION_CHOICES)
def test_compile_parity_fun_camera(ts, name, text, aspect, resolution):
    # compileJob(preset, wan22-i2v-a14b-fun-camera, template, {imageRef: "x.png", seed: 1, aspect, resolution, userPrompt: "a cat"}).params
    assert_parametric_parity(ts, name, text, aspect=aspect, resolution=resolution, prompt="a cat")


def test_monorepo_presets_were_found(ts):  # `ts` skips this test without the monorepo
    assert find_monorepo() is not None
    assert MONOREPO_PRESETS, "the monorepo has no presets/*.yaml to compare with"


@pytest.mark.parametrize("title,text", PRESET_VARIANTS, ids=[title for title, _ in PRESET_VARIANTS])
def test_compile_parity_variants(ts, title, text):
    assert_parametric_parity(ts, title, text, prompt=USER_PROMPT)


@pytest.mark.parametrize("title,prompt", USER_PROMPTS, ids=[title for title, _ in USER_PROMPTS])
@pytest.mark.parametrize("text", [BASE, MINIMAL], ids=["crash-push", "minimal"])
def test_compile_parity_user_prompts(ts, title, prompt, text):
    assert_parametric_parity(ts, "preset.yaml", text, prompt=prompt)
    # and in prompt mode: the prompt only
    expected = ts_compile(ts, compile_request(text, WAN_5B, user_prompt=prompt))
    preset = parse_preset(text, "preset.yaml")
    assert compute_params(preset, aspect="16:9", prompt=prompt, camera_mode="prompt").prompt == expected["prompt"]


def test_compile_parity_without_user_prompt(ts):
    assert_parametric_parity(ts, "crash-push.yaml", BASE)
    expected = ts_compile(ts, compile_request(BASE, WAN_5B))
    preset = parse_preset(BASE, "crash-push.yaml")
    assert compute_params(preset, aspect="16:9", camera_mode="prompt").prompt == expected["prompt"]


@pytest.mark.parametrize("name,text", DRIVEN_PRESETS + PRESET_VARIANTS, ids=[name for name, _ in DRIVEN_PRESETS + PRESET_VARIANTS])
def test_compile_parity_prompt_mode_5b(ts, name, text):
    assert_prompt_mode_parity(ts, name, text, prompt=USER_PROMPT)


@pytest.mark.parametrize("pair", POSE_PAIRS, ids=[f"{a}+{b}" for a, b in POSE_PAIRS])
def test_two_poses_parity(ts, pair):
    text = edit("poses: [zoom_in]", f"poses: [{pair[0]}, {pair[1]}]")
    preset = parse_preset(text, "pair.yaml")
    # the app sends both values to Montagio Camera Embedding, together: the pack names them in its refusal
    app = ts_compile(ts, compile_request(text, FUN_CAMERA, user_prompt=USER_PROMPT))
    assert (app["cameraPose"], app["cameraPose2"], app["cameraCombine"]) == (POSE_VALUES[pair[0]], POSE_VALUES[pair[1]], "together")
    with pytest.raises(ParamsError) as caught:
        compute_params(preset, aspect="16:9", prompt=USER_PROMPT)
    assert f"({app['cameraPose']} + {app['cameraPose2']});" in str(caught.value)
    # prompt mode phrases both moves, like the app does for a model without camera control
    expected = ts_compile(ts, compile_request(text, WAN_5B, user_prompt=USER_PROMPT))
    assert compute_params(preset, aspect="16:9", prompt=USER_PROMPT, camera_mode="prompt").prompt == expected["prompt"]


@pytest.mark.parametrize("pair", THEN_PAIRS, ids=[f"{a}-then-{b}" for a, b in THEN_PAIRS])
def test_then_pairs_parity(ts, pair):
    text = then_preset(*pair)
    preset = parse_preset(text, "then.yaml")
    app = ts_compile(ts, compile_request(text, FUN_CAMERA, user_prompt=USER_PROMPT))
    assert (app["cameraPose"], app["cameraPose2"], app["cameraCombine"]) == (POSE_VALUES[pair[0]], POSE_VALUES[pair[1]], "then")
    with pytest.raises(ParamsError) as caught:
        compute_params(preset, aspect="16:9", prompt=USER_PROMPT)
    assert f"({app['cameraPose']}, then {app['cameraPose2']});" in str(caught.value)
    # prompt mode chains the words with "then", like the app
    expected = ts_compile(ts, compile_request(text, WAN_5B, user_prompt=USER_PROMPT))
    assert compute_params(preset, aspect="16:9", prompt=USER_PROMPT, camera_mode="prompt").prompt == expected["prompt"]


def test_loras_parity(ts):
    preset = parse_preset(BASE + LORA_BLOCK, "lora.yaml")
    for model in (FUN_CAMERA, WAN_5B):
        expected = ts_compile(ts, compile_request(BASE + LORA_BLOCK, model, user_prompt=USER_PROMPT))
        with pytest.raises(ParamsError) as caught:
            compute_params(preset, aspect="16:9", prompt=USER_PROMPT, camera_mode="parametric" if model == FUN_CAMERA else "prompt")
        assert str(caught.value) == expected["error"]
