# SPDX-License-Identifier: GPL-3.0-only
"""A stand-in for ComfyUI's comfy_api.latest (the V3 node API), for tests that run without ComfyUI.

It keeps the constructor signatures of ComfyUI v0.41.0 (comfy_api/latest/_io.py): the same
argument names, in the same order, with the same defaults, so that a call the real API would
refuse (an unknown argument, a missing id) fails here too. The classes keep what they are given
as attributes, and only the behavior the pack's tests look at is copied:

- an Output without an id gets "_<index>_<io_type>_" in Schema.finalize, and
  Output.display_name falls back to the id;
- NodeOutput keeps its values in .args (and gives them back through .result and indexing);
- ComfyNode.GET_SCHEMA runs define_schema, finalize and validate, like ComfyUI does when it
  registers a node;
- ComfyNode.fingerprint_inputs and validate_inputs raise NotImplementedError until a node
  overrides them, and execute and the others are classmethods, since ComfyUI calls them as
  getattr(cls, name).__func__(locked_clone_of_cls, **inputs).

Everything else the real module does (V1 info, dynamic inputs, hidden inputs...) is left out.
"""
from abc import ABC, abstractmethod
from collections import Counter
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Literal


class _IO:
    """Base of the inputs and outputs: io_type comes from the type they were made for (Parent)."""

    Parent = None

    @property
    def io_type(self):
        return self.Parent.io_type

    def validate(self):
        pass


class Input(_IO):
    def __init__(self, id: str, display_name: str = None, optional=False, tooltip: str = None, lazy: bool = None, extra_dict=None, raw_link: bool = None, advanced: bool = None):
        self.id = id
        self.display_name = display_name
        self.optional = optional
        self.tooltip = tooltip
        self.lazy = lazy
        self.extra_dict = extra_dict if extra_dict is not None else {}
        self.rawLink = raw_link
        self.advanced = advanced


class WidgetInput(Input):
    def __init__(self, id: str, display_name: str = None, optional=False, tooltip: str = None, lazy: bool = None,
                 default: Any = None,
                 socketless: bool = None, widget_type: str = None, force_input: bool = None, extra_dict=None, raw_link: bool = None, advanced: bool = None):
        super().__init__(id, display_name, optional, tooltip, lazy, extra_dict, raw_link, advanced)
        self.default = default
        self.socketless = socketless
        self.widget_type = widget_type
        self.force_input = force_input


class Output(_IO):
    def __init__(self, id: str = None, display_name: str = None, tooltip: str = None, is_output_list=False):
        self.id = id
        self.display_name = display_name if display_name else id
        self.tooltip = tooltip
        self.is_output_list = is_output_list


class _ComfyType:
    io_type: str = None


def _comfytype(io_type):
    """Binds io_type to a type and the type to its Input and Output classes (like comfytype in ComfyUI)."""

    def decorator(cls):
        cls.io_type = io_type
        for name in ("Input", "Output"):
            nested = getattr(cls, name, None)
            if nested is not None:
                nested.Parent = cls
        return cls

    return decorator


@_comfytype("INT")
class Int(_ComfyType):
    class Input(WidgetInput):
        def __init__(self, id: str, display_name: str = None, optional=False, tooltip: str = None, lazy: bool = None,
                     default: int = None, min: int = None, max: int = None, step: int = None, control_after_generate=None,
                     display_mode=None, socketless: bool = None, force_input: bool = None, extra_dict=None, raw_link: bool = None, advanced: bool = None):
            super().__init__(id, display_name, optional, tooltip, lazy, default, socketless, None, force_input, extra_dict, raw_link, advanced)
            self.min = min
            self.max = max
            self.step = step
            self.control_after_generate = control_after_generate
            self.display_mode = display_mode

    class Output(Output):
        pass


@_comfytype("FLOAT")
class Float(_ComfyType):
    class Input(WidgetInput):
        def __init__(self, id: str, display_name: str = None, optional=False, tooltip: str = None, lazy: bool = None,
                     default: float = None, min: float = None, max: float = None, step: float = None, round: float = None,
                     display_mode=None, gradient_stops: list = None,
                     socketless: bool = None, force_input: bool = None, extra_dict=None, raw_link: bool = None, advanced: bool = None):
            super().__init__(id, display_name, optional, tooltip, lazy, default, socketless, None, force_input, extra_dict, raw_link, advanced)
            self.min = min
            self.max = max
            self.step = step
            self.round = round
            self.display_mode = display_mode
            self.gradient_stops = gradient_stops

    class Output(Output):
        pass


@_comfytype("STRING")
class String(_ComfyType):
    class Input(WidgetInput):
        def __init__(self, id: str, display_name: str = None, optional=False, tooltip: str = None, lazy: bool = None,
                     multiline=False, placeholder: str = None, default: str = None, dynamic_prompts: bool = None,
                     socketless: bool = None, force_input: bool = None, extra_dict=None, raw_link: bool = None, advanced: bool = None):
            super().__init__(id, display_name, optional, tooltip, lazy, default, socketless, None, force_input, extra_dict, raw_link, advanced)
            self.multiline = multiline
            self.placeholder = placeholder
            self.dynamic_prompts = dynamic_prompts

    class Output(Output):
        pass


@_comfytype("COMBO")
class Combo(_ComfyType):
    class Input(WidgetInput):
        def __init__(self, id: str, options: list = None, display_name: str = None, optional=False, tooltip: str = None, lazy: bool = None,
                     default: Any = None, control_after_generate=None, upload=None, image_folder=None, remote=None,
                     socketless: bool = None, extra_dict=None, raw_link: bool = None, advanced: bool = None):
            super().__init__(id, display_name, optional, tooltip, lazy, default, socketless, None, None, extra_dict, raw_link, advanced)
            self.multiselect = False
            self.options = options
            self.control_after_generate = control_after_generate
            self.upload = upload
            self.image_folder = image_folder
            self.remote = remote

    class Output(Output):
        def __init__(self, id: str = None, display_name: str = None, options: list = None, tooltip: str = None, is_output_list=False):
            super().__init__(id, display_name, tooltip, is_output_list)
            self.options = options if options is not None else []


@_comfytype("IMAGE")
class Image(_ComfyType):
    class Input(Input):
        pass

    class Output(Output):
        pass


@_comfytype("AUDIO")
class Audio(_ComfyType):
    class Input(Input):
        pass

    class Output(Output):
        pass


@_comfytype("WAN_CAMERA_EMBEDDING")
class WanCameraEmbedding(_ComfyType):
    class Input(Input):
        pass

    class Output(Output):
        pass


@dataclass
class Schema:
    node_id: str
    display_name: str = None
    category: str = "sd"
    inputs: list = field(default_factory=list)
    outputs: list = field(default_factory=list)
    hidden: list = field(default_factory=list)
    description: str = ""
    search_aliases: list = field(default_factory=list)
    is_input_list: bool = False
    is_output_node: bool = False
    is_deprecated: bool = False
    is_experimental: bool = False
    is_dev_only: bool = False
    is_api_node: bool = False
    price_badge: Any = None
    not_idempotent: bool = False
    enable_expand: bool = False
    accept_all_inputs: bool = False
    essentials_category: str = None
    has_intermediate_output: bool = False
    loop_boundary: Literal["start", "end"] | None = None

    def validate(self):
        """The ids of the inputs must be unique, and so must the ids of the outputs."""
        input_ids = [i.id for i in self.inputs]
        output_ids = [o.id for o in self.outputs]
        issues = []
        if len(set(input_ids)) != len(input_ids):
            issues.append(f"Input ids must be unique, but {[i for i, n in Counter(input_ids).items() if n > 1]} are not.")
        if len(set(output_ids)) != len(output_ids):
            issues.append(f"Output ids must be unique, but {[i for i, n in Counter(output_ids).items() if n > 1]} are not.")
        if issues:
            raise ValueError("\n".join(issues))
        for item in (*self.inputs, *self.outputs):
            item.validate()

    def finalize(self):
        """Gives the outputs that have no id a default one."""
        for index, output in enumerate(self.outputs):
            if output.id is None:
                output.id = f"_{index}_{output.io_type}_"


class NodeOutput:
    def __init__(self, *args: Any, ui=None, expand: dict = None, block_execution: str = None):
        self.args = args
        self.ui = ui
        self.expand = expand
        self.block_execution = block_execution

    @property
    def result(self):
        return self.args if len(self.args) > 0 else None

    def __getitem__(self, index) -> Any:
        return self.args[index]


class ComfyNode:
    @classmethod
    def define_schema(cls) -> Schema:
        raise NotImplementedError

    @classmethod
    def execute(cls, **kwargs) -> NodeOutput:
        raise NotImplementedError

    @classmethod
    def validate_inputs(cls, **kwargs):
        raise NotImplementedError

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        raise NotImplementedError

    @classmethod
    def check_lazy_status(cls, **kwargs) -> list[str]:
        return [name for name in kwargs if kwargs[name] is None]

    @classmethod
    def GET_SCHEMA(cls) -> Schema:
        """What ComfyUI does for every node it registers: define the schema, finalize it, validate it."""
        schema = cls.define_schema()
        schema.finalize()
        schema.validate()
        return schema


class ComfyExtension(ABC):
    async def on_load(self) -> None:
        """Called when an extension is loaded."""

    @abstractmethod
    async def get_node_list(self) -> list[type[ComfyNode]]:
        """The nodes this extension provides."""


io = SimpleNamespace(
    ComfyNode=ComfyNode,
    Schema=Schema,
    NodeOutput=NodeOutput,
    Input=Input,
    Output=Output,
    Combo=Combo,
    String=String,
    Int=Int,
    Float=Float,
    Image=Image,
    Audio=Audio,
    WanCameraEmbedding=WanCameraEmbedding,
)
