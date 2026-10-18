# SPDX-License-Identifier: GPL-3.0-only
"""Compute what the nodes output, the way the app's compiler does.

The reference is packages/presets (compile.ts and dimensions.ts): the tables below are copies
of theirs, and tests/test_params.py compares them, and every output, with the app's own code.
One difference is on purpose: the app trims a job to what the chosen model can render (duration,
fps, resolutions); the node does not, since the workflow it sits in decides that.
"""
import math
from dataclasses import dataclass

# CAMERA_POSE_VALUES of compile.ts: what the camera node receives (a value of wan.WAN_CAMERA_POSES)
POSE_VALUES = {
    "static": "Static",
    "pan_left": "Pan Left",
    "pan_right": "Pan Right",
    "pan_up": "Pan Up",
    "pan_down": "Pan Down",
    "zoom_in": "Zoom In",
    "zoom_out": "Zoom Out",
    "roll_ccw": "Anti Clockwise (ACW)",
    "roll_cw": "ClockWise (CW)",
}

# CAMERA_POSE_PROMPTS of compile.ts: the same moves in words, for a model without camera control
POSE_PROMPTS = {
    "static": "static locked-off camera",
    "pan_left": "the camera pans left",
    "pan_right": "the camera pans right",
    "pan_up": "the camera tilts up",
    "pan_down": "the camera tilts down",
    "zoom_in": "the camera pushes in toward the subject",
    "zoom_out": "the camera pulls back from the subject",
    "roll_ccw": "the camera rolls counterclockwise",
    "roll_cw": "the camera rolls clockwise",
}

ASPECTS = ("16:9", "9:16", "1:1")
AUTO = "auto"  # "pick the aspect from the start image"
CAMERA_MODES = ("parametric", "prompt")

# resolution -> aspect -> (width, height), as in dimensions.ts
DIMENSIONS = {
    "480p": {"16:9": (832, 480), "9:16": (480, 832), "1:1": (640, 640)},
    "720p": {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (960, 960)},
}

_DEFAULT_ASPECT = "16:9"  # with no start image to look at

# What String.prototype.trim removes in JavaScript (WhiteSpace and LineTerminator). It is not the
# set of str.strip(): that one also drops U+001C..U+001F and U+0085 and keeps U+FEFF.
# The 25 characters, written as escapes so that none is invisible: the five ASCII controls, the
# space, no-break space, ogham space mark, U+2000..U+200A (en quad to hair space), line and
# paragraph separators, narrow no-break space, medium mathematical space, ideographic space, BOM.
_JS_WHITE_SPACE = (
    "\t\n\x0b\x0c\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


class ParamsError(ValueError):
    """The preset or a choice cannot be turned into node outputs; the message says why."""


@dataclass(frozen=True)
class NodeParams:
    camera_pose: str
    speed: float
    width: int
    height: int
    length: int  # frames
    fps: float
    prompt: str
    negative: str
    duration_s: int
    resolution: str
    info: str


def frame_count(duration_s, fps):
    """Wan models expect 4n+1 frames; rounds half up like JavaScript's Math.round (not to even like round())."""
    return 4 * math.floor(duration_s * fps / 4 + 0.5) + 1


def pick_aspect(width, height):
    """The closest aspect the video models render natively, for an image of this size."""
    if width < 1 or height < 1:
        raise ParamsError(f"cannot pick an aspect for an image of {width}x{height}")
    ratio = width / height
    if ratio >= 1.4:
        return "16:9"
    if ratio <= 0.71:
        return "9:16"
    return "1:1"


def resolve_aspect(choice, image_size):
    """A concrete aspect from the user's choice; image_size is (width, height), or None without an image."""
    if choice == AUTO:
        return _DEFAULT_ASPECT if image_size is None else pick_aspect(*image_size)
    if choice not in ASPECTS:
        raise ParamsError(f'aspect "{choice}" is not one of {", ".join(ASPECTS)} or "{AUTO}"')
    return choice


def _trim(text):
    return text.strip(_JS_WHITE_SPACE)


def compute_params(preset, *, aspect, resolution=None, prompt="", camera_mode="parametric"):
    """Outputs of the nodes for a preset (as parse_preset returns it); aspect is already a concrete ratio."""
    if camera_mode not in CAMERA_MODES:
        raise ParamsError(f'camera_mode "{camera_mode}" is not one of {", ".join(CAMERA_MODES)}')
    if aspect not in ASPECTS:
        raise ParamsError(f'aspect "{aspect}" is not one of {", ".join(ASPECTS)}')
    defaults = preset["defaults"]
    resolution = defaults["resolution"] if resolution is None else resolution
    if resolution not in DIMENSIONS:
        raise ParamsError(f'resolution "{resolution}" is not one of {", ".join(DIMENSIONS)}')
    if preset["loras"]:
        # never drop a LoRA silently: the clip would not be what the preset promises
        raise ParamsError(f"preset {preset['id']} uses LoRAs, which are not supported yet")

    poses = preset["camera"]["poses"]
    one_after_the_other = preset["camera"]["combine"] == "then"
    parts = [_trim(prompt), _trim(preset["prompt"]["suffix"])]
    if camera_mode == "prompt":
        camera_pose, speed = "Static", 1.0  # the camera is only in the words of the prompt
        parts.append((", then " if one_after_the_other else ", ").join(POSE_PROMPTS[pose] for pose in poses))
    else:
        values = [POSE_VALUES[pose] for pose in poses]
        if len(values) > 1:
            # the app sends both moves to Montagio Camera Embedding; these nodes have one camera_pose output
            raise ParamsError(
                f"preset {preset['id']} combines {len(values)} camera moves "
                f"({(', then ' if one_after_the_other else ' + ').join(values)}); WanCameraEmbedding takes one move. "
                'Use camera_mode "prompt", or the Montagio Camera Embedding node with the second move set by hand.'
            )
        camera_pose, speed = values[0], float(preset["camera"]["speed"])

    width, height = DIMENSIONS[resolution][aspect]
    return NodeParams(
        camera_pose=camera_pose,
        speed=speed,
        width=width,
        height=height,
        length=frame_count(defaults["duration_s"], defaults["fps"]),
        fps=float(defaults["fps"]),
        prompt=", ".join(part for part in parts if part),
        negative=preset["prompt"]["negative"],
        duration_s=defaults["duration_s"],
        resolution=resolution,
        info=f"{preset['name']} ({preset['id']}) — by {preset['author']} — {preset['license']}",
    )
