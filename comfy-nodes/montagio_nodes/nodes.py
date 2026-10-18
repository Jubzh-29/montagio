# SPDX-License-Identifier: GPL-3.0-only
"""The Montagio nodes for ComfyUI (V3 node API) and the pack's entry point.

This is the only module that talks to ComfyUI (comfy_api and folder_paths); the others are
plain Python and run anywhere. The modules of the pack import one another with relative
imports: ComfyUI loads the pack folder as a package of its own and does not put the folder on
sys.path, so "from montagio_nodes.preset import ..." would fail there.

Two nodes turn a Montagio preset into the values ComfyUI's own nodes take:
camera_pose, speed, width, height and length go to WanCameraEmbedding, prompt and negative to
CLIPTextEncode, fps to CreateVideo. In camera_mode "combined" they go with camera_pose_2 and
combine to Montagio Camera Embedding instead, which takes the presets with two moves; "parametric"
refuses those, since the core node would drop the second move without a word. "Load Montagio
Preset" reads a preset file chosen in a menu; "Montagio Preset from YAML" reads the text written
in the node.

Where the presets are: ComfyUI/models/montagio_presets (the user's folder, which comes first and
wins on a name clash), any folder that extra_model_paths.yaml adds under the name
"montagio_presets", and the presets shipped with the pack (last).
"""
import hashlib
import importlib
import logging
import os
from dataclasses import astuple

import folder_paths
from comfy_api.latest import ComfyExtension, io

from .camera import COMBINE_MODES, camera_rows, check_length, trajectory
from .catalog import BUNDLED_DIR, list_presets, resolve_preset
from .params import ASPECTS, AUTO, CAMERA_MODES, DIMENSIONS, ParamsError, compute_params, resolve_aspect
from .preset import PresetError, parse_preset
from .wan import WAN_CAMERA_POSES

FOLDER_KEY = "montagio_presets"  # the name of the preset folders in folder_paths
CATEGORY = "Montagio"
RESOLUTION_FROM_PRESET = "preset"  # the resolution choice that keeps the preset's own

_log = logging.getLogger(__name__)


def preset_dirs():
    """The preset folders, by priority: the user's, those added with extra_model_paths.yaml, the pack's.

    Registers them in folder_paths on the first call (the user's folder is created), and does
    nothing when they are already there. It looks at what is registered rather than at a flag
    of its own, so that a changed models_dir is taken into account.
    """
    user_dir = os.path.join(folder_paths.models_dir, FOLDER_KEY)
    try:
        os.makedirs(user_dir, exist_ok=True)
    except OSError as error:  # a read-only models folder must not keep the bundled presets from loading
        _log.warning("Montagio: cannot create the preset folder %s (%s)", user_dir, error)

    def registered():
        return folder_paths.folder_names_and_paths.get(FOLDER_KEY, ([], set()))[0]

    if str(BUNDLED_DIR) not in registered():
        folder_paths.add_model_folder_path(FOLDER_KEY, str(BUNDLED_DIR))
    if user_dir not in registered():
        folder_paths.add_model_folder_path(FOLDER_KEY, user_dir, is_default=True)
    return folder_paths.get_folder_paths(FOLDER_KEY)


def _read_preset_text(name):
    """The text of the preset `name` (a menu entry), from the first folder that holds it."""
    path = resolve_preset(name, preset_dirs())
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise PresetError(f"{name}: cannot read the file ({error})") from error


def _image_size(image):
    """(width, height) of an IMAGE input, a [batch, height, width, channels] tensor; None without an image."""
    if image is None:
        return None
    shape = tuple(image.shape)
    if len(shape) != 4:
        raise ParamsError(f"image must have the shape [batch, height, width, channels], not {list(shape)}")
    return (shape[2], shape[1])


def _node_output(preset, *, aspect, resolution, camera_mode, prompt, image):
    """What both nodes return for a parsed preset and their common inputs."""
    params = compute_params(
        preset,
        aspect=resolve_aspect(aspect, _image_size(image)),
        resolution=None if resolution == RESOLUTION_FROM_PRESET else resolution,
        prompt="" if prompt is None else prompt,
        camera_mode=camera_mode,
    )
    return io.NodeOutput(*astuple(params))  # the fields of NodeParams are in the order of the outputs


def _common_inputs():
    return [
        io.String.Input("prompt", multiline=True, default="", optional=True),
        io.Combo.Input("aspect", options=[AUTO, *ASPECTS], default=AUTO),
        io.Image.Input("image", optional=True),
        io.Combo.Input("resolution", options=[RESOLUTION_FROM_PRESET, *DIMENSIONS], default=RESOLUTION_FROM_PRESET),
        io.Combo.Input("camera_mode", options=list(CAMERA_MODES), default=CAMERA_MODES[0]),
    ]


def _declared_outputs():
    # display_name=: the first positional argument of an Output is its id, not the name of its socket
    return [
        io.Combo.Output(display_name="camera_pose"),
        io.Float.Output(display_name="speed"),
        io.Int.Output(display_name="width"),
        io.Int.Output(display_name="height"),
        io.Int.Output(display_name="length"),
        io.Float.Output(display_name="fps"),
        io.String.Output(display_name="prompt"),
        io.String.Output(display_name="negative"),
        io.Int.Output(display_name="duration_s"),
        io.String.Output(display_name="resolution"),
        io.String.Output(display_name="info"),
        # added after info, so that the links of a graph saved before keep their indexes
        io.Combo.Output(display_name="camera_pose_2"),
        io.Combo.Output(display_name="combine"),
    ]


class MontagioLoadPreset(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MontagioLoadPreset",
            display_name="Load Montagio Preset",
            category=CATEGORY,
            # ComfyUI asks for the schema again each time the node list is refreshed, so a preset
            # file added to a folder shows up in the menu without restarting
            inputs=[io.Combo.Input("preset", options=list_presets(preset_dirs())), *_common_inputs()],
            outputs=_declared_outputs(),
        )

    @classmethod
    def execute(cls, preset, aspect, resolution, camera_mode, prompt="", image=None):
        # an optional input that is not connected is left out of the call, hence the defaults
        parsed = parse_preset(_read_preset_text(preset), preset)
        return _node_output(parsed, aspect=aspect, resolution=resolution, camera_mode=camera_mode, prompt=prompt, image=image)

    @classmethod
    def fingerprint_inputs(cls, preset=None, **_):
        """ComfyUI runs the node again when this changes: a preset file edited on disk is read again.

        Asked before the links are known, so `preset` may be None; it never raises.
        """
        try:
            return hashlib.sha256(resolve_preset(preset, preset_dirs()).read_bytes()).hexdigest()
        except (PresetError, OSError):
            return "missing"


class MontagioPresetFromYAML(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MontagioPresetFromYAML",
            display_name="Montagio Preset from YAML",
            category=CATEGORY,
            inputs=[
                io.String.Input("yaml", multiline=True, default=(BUNDLED_DIR / "crash-push.yaml").read_text(encoding="utf-8")),
                *_common_inputs(),
            ],
            outputs=_declared_outputs(),
        )

    @classmethod
    def execute(cls, yaml, aspect, resolution, camera_mode, prompt="", image=None):
        parsed = parse_preset(yaml, "yaml input")
        return _node_output(parsed, aspect=aspect, resolution=resolution, camera_mode=camera_mode, prompt=prompt, image=image)


CORE_CAMERA_MODULE = "comfy_extras.nodes_camera_trajectory"  # where WanCameraEmbedding and its helpers live
MAX_RESOLUTION = 16384  # nodes.MAX_RESOLUTION of ComfyUI v0.41.0


def wan_layout(plucker):
    """The embedding in the layout WanCameraImageToVideo takes.

    The same steps as the end of WanCameraEmbedding.execute in ComfyUI v0.41.0
    (comfy_extras/nodes_camera_trajectory.py, GPL-3.0): channels first, the first frame
    repeated 4 times, then frames grouped by 4 into 24 channels.
    """
    import comfy.model_management  # ComfyUI's, imported when the node runs
    import torch

    video = plucker.permute([3, 0, 1, 2]).unsqueeze(0).to(device=comfy.model_management.intermediate_device())
    video = torch.concat([torch.repeat_interleave(video[:, :, 0:1], repeats=4, dim=2), video[:, :, 1:]], dim=2).transpose(1, 2)
    b, f, c, h, w = video.shape
    video = video.contiguous().view(b, f // 4, 4, c, h, w).transpose(2, 3)
    return video.contiguous().view(b, f // 4, c * 4, h, w).transpose(1, 2)


class MontagioCameraEmbedding(io.ComfyNode):
    """WanCameraEmbedding with a second move: both at once ("together") or one after the other ("then").

    Its inputs keep the names and bounds of the core node and its outputs are the same, so it
    replaces WanCameraEmbedding in a workflow without changing a link. The Plücker embedding is
    computed by the core's own process_pose_params, from the path camera.py builds.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MontagioCameraEmbedding",
            display_name="Montagio Camera Embedding",
            category=CATEGORY,
            description='Two camera moves of WanCameraEmbedding at once ("together") or one after the other ("then").',
            inputs=[
                io.Combo.Input("camera_pose", options=list(WAN_CAMERA_POSES), default="Static"),
                io.Combo.Input("camera_pose_2", options=list(WAN_CAMERA_POSES), default="Static"),
                io.Combo.Input("combine", options=list(COMBINE_MODES), default=COMBINE_MODES[0]),
                io.Int.Input("width", default=832, min=16, max=MAX_RESOLUTION, step=16),
                io.Int.Input("height", default=480, min=16, max=MAX_RESOLUTION, step=16),
                io.Int.Input("length", default=81, min=1, max=MAX_RESOLUTION, step=4),
                io.Float.Input("speed", default=1.0, min=0, max=10.0, step=0.1, optional=True),
                io.Float.Input("fx", default=0.5, min=0, max=1, step=0.000000001, optional=True, advanced=True),
                io.Float.Input("fy", default=0.5, min=0, max=1, step=0.000000001, optional=True, advanced=True),
                io.Float.Input("cx", default=0.5, min=0, max=1, step=0.01, optional=True, advanced=True),
                io.Float.Input("cy", default=0.5, min=0, max=1, step=0.01, optional=True, advanced=True),
            ],
            outputs=[
                io.WanCameraEmbedding.Output(display_name="camera_embedding"),
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height"),
                io.Int.Output(display_name="length"),
            ],
        )

    @classmethod
    def execute(cls, camera_pose, camera_pose_2, combine, width, height, length, speed=1.0, fx=0.5, fy=0.5, cx=0.5, cy=0.5):
        check_length(length)
        core = importlib.import_module(CORE_CAMERA_MODULE)
        poses = core.CAMERA_DICT

        def motion(pose):
            return poses[pose]["angle"], poses[pose]["T"]

        path = trajectory(
            motion(camera_pose), motion(camera_pose_2), combine, speed, length,
            base_angle=poses["base_angle"], base_t=poses["base_T_norm"],
        )
        plucker = core.process_pose_params(camera_rows(path, fx, fy, cx, cy), width=width, height=height)
        return io.NodeOutput(wan_layout(plucker), width, height, length)


class MontagioExtension(ComfyExtension):
    async def get_node_list(self):
        return [MontagioLoadPreset, MontagioPresetFromYAML, MontagioCameraEmbedding]


async def comfy_entrypoint() -> MontagioExtension:
    return MontagioExtension()
