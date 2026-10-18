# SPDX-License-Identifier: GPL-3.0-only
"""Read Montagio preset files exactly like the app does.

The app (packages/presets: a zod schema behind the npm `yaml` library) is the
reference. A preset it refuses is refused here, a preset it accepts comes out with
the same values and the same defaults, and a bad preset is reported as
"<source>: <path>: <message>".

The parser is PyYAML. Small overrides of its scanner make a tab separate tokens like a space,
as in the npm library, and never indent a line. A few rare corners of YAML text are still
PyYAML's:

- refused here, accepted by the app: a tab right after a tag ("!!str<TAB>x") or inside a
  directive line, control characters, and NEL/LS/PS line breaks;
- accepted here, refused by the app: continuation lines of a quoted scalar or of a flow
  collection that are not indented past their block (PyYAML does not check it; in a
  quoted scalar, a tab alone before such a line passes too), a lone CR taken for a line
  break, and a document whose aliases expand about 100 times or more (the npm library
  refuses it, a guard against alias bombs; PyYAML does not count them);
- a "%YAML 1.1" directive is not read like the npm library reads it, and a bare "!" tag
  written right before a "," "]" or "}" of a flow collection is taken for part of the tag.
"""
import math
import re

import yaml

CAMERA_POSES = ("static", "pan_left", "pan_right", "pan_up", "pan_down", "zoom_in", "zoom_out", "roll_ccw", "roll_cw")
CAMERA_COMBINES = ("together", "then")  # how two moves combine: at once, or one after the other
LICENSES = ("CC-BY-4.0", "CC0-1.0", "Apache-2.0", "MIT")
RESOLUTIONS = ("480p", "720p")
FPS_VALUES = (16, 24)
SCHEMA_ID = "montagio/preset@0.1"


class PresetError(ValueError):
    """The preset is not readable or is not valid; the message names the file."""


# --- YAML 1.2 (core schema), as the npm `yaml` library reads it -------------------


def _to_int(text):
    if text.startswith("0o"):
        return int(text[2:], 8)
    if text.startswith("0x"):
        return int(text[2:], 16)
    return int(text)  # leading zeros stay decimal


def _to_float(text):
    lowered = text.lower()
    if lowered.endswith(".inf"):
        return -math.inf if lowered.startswith("-") else math.inf
    if lowered.endswith(".nan"):
        return math.nan
    return float(text)


# (tag, what the whole scalar must match, its first characters, conversion). A float needs a
# dot or an exponent: the bare integers matched by the YAML 1.2 float pattern are ints anyway.
_CORE_SCALARS = (
    ("null", r"~|null|Null|NULL|", ["~", "n", "N", ""], lambda text: None),  # or nothing at all
    ("bool", r"true|True|TRUE|false|False|FALSE", list("tTfF"), lambda text: text[0] in "tT"),
    ("int", r"[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+", list("-+0123456789"), _to_int),
    (
        "float",
        r"[-+]?(\.[0-9]+|[0-9]+\.[0-9]*)|[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)[eE][-+]?[0-9]+"
        r"|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN)",
        list("-+.0123456789"),
        _to_float,
    ),
)


def _join_surrogates(text):
    return text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def _core_scalar_constructor(regexp, convert):
    def construct(loader, node):
        text = loader.construct_scalar(node)
        # a tag written by hand on text that does not fit it keeps the text, as the npm library does
        return convert(text) if regexp.match(text) else text

    return construct


def _construct_unresolved(loader, node):
    # the npm library warns about a tag it does not know and keeps the plain value
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_yaml_seq(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_yaml_map(node)
    return loader.construct_scalar(node)


_MERGE_TAG = "tag:yaml.org,2002:merge"


class _Symbol:
    """What the npm library makes of a value tagged !!merge: a JavaScript symbol, which no field accepts."""


def _construct_merge_tagged(loader, node):
    return _Symbol() if isinstance(node, yaml.ScalarNode) else _construct_unresolved(loader, node)


_BREAKS = "\r\n\x85\u2028\u2029"  # what PyYAML reads as a line break
_END_OF_LINE = "\0" + _BREAKS  # "\0" is the end of the text for PyYAML's reader
_BLOCK_SCALAR = "while scanning a block scalar"


class _CoreLoader(yaml.SafeLoader):
    """SafeLoader without PyYAML's YAML 1.1 extras (yes/no, dates, sexagesimals, implicit "<<" merge).

    Only a key that is explicitly tagged !!merge merges its mapping(s) into the parent, exactly
    as in the npm library (PyYAML's own flatten_mapping does that).
    """

    yaml_implicit_resolvers = {}

    # --- tabs. PyYAML skips only spaces between tokens. The npm library, like YAML 1.2, also
    # takes a tab for white space, but never for indentation. The overrides of PyYAML's
    # scanner do the same; the "tab:" cases of tests/parity_cases.py pin them against the app.

    def _tab_is_white_space(self):
        """Whether the tab at the reading position separates tokens, rather than indenting a line."""
        # back to the start of its line (load_yaml gives the loader a str: PyYAML keeps it whole in buffer)
        before = self.pointer - 1
        while before >= 0 and self.buffer[before] not in _BREAKS:
            if self.buffer[before] not in " \t\uFEFF":
                return True  # something comes before it on its line
            before -= 1
        length = 0
        while self.peek(length) in " \t":
            length += 1
        after = self.peek(length)
        if after in "#" + _END_OF_LINE:
            return True  # a blank line, or a comment line
        if not self.flow_level:
            return False  # in a block, a tab that starts a line is indentation
        # in a flow collection, the spaces before the tab must indent the line past the block the
        # collection sits in; the line of its closing bracket may stay at that block's level
        return self.column > self.indent or (self.column == self.indent and self.flow_level == 1 and after in "]}")

    def scan_to_next_token(self):
        # PyYAML's loop, where a run of white space may also hold tabs. After such a tab the line
        # cannot start a block key or a "-" entry: the npm library takes that tab for indentation,
        # and PyYAML's own TODO in this method gives the same rule.
        if self.index == 0 and self.peek() == "\uFEFF":
            self.forward()
        while True:
            while self.peek() == " ":
                self.forward()
            if self.peek() == "\t" and self._tab_is_white_space():  # then so is the rest of the run
                if not self.flow_level:
                    self.allow_simple_key = False
                while self.peek() in " \t":
                    self.forward()
            if self.peek() == "#":
                while self.peek() not in _END_OF_LINE:
                    self.forward()
            if not self.scan_line_break():
                return
            if not self.flow_level:
                self.allow_simple_key = True

    def _at_document_marker(self):
        return self.prefix(3) in ("---", "...") and self.peek(3) in " \t" + _END_OF_LINE

    def scan_plain_spaces(self, indent, start_mark):
        # PyYAML's, with tabs as white space: inside a line, before its end, and after the
        # indentation of a continuation line (never as that indentation)
        length = 0
        while self.peek(length) in " \t":
            length += 1
        whitespaces = self.prefix(length)
        self.forward(length)
        if self.peek() not in _BREAKS:
            return [whitespaces] if whitespaces else []
        line_break = self.scan_line_break()
        self.allow_simple_key = True
        if self._at_document_marker():
            return None
        breaks = []
        while self.peek() in " " + _BREAKS or (self.peek() == "\t" and self.column >= indent):
            if self.peek() in " \t":
                self.forward()
            else:
                breaks.append(self.scan_line_break())
                if self._at_document_marker():
                    return None
        if line_break != "\n":
            return [line_break] + breaks
        return breaks or [" "]

    def scan_block_scalar_indicators(self, start_mark):
        # PyYAML's: "+" or "-" and an indentation digit, in either order, then white space,
        # which may be a tab, or the end of the line
        chomping = increment = None
        for _ in range(2):
            ch = self.peek()
            if ch in "+-" and chomping is None:
                chomping = ch == "+"
            elif ch in "0123456789" and increment is None:
                if ch == "0":
                    problem = "expected indentation indicator in the range 1-9, but found 0"
                    raise yaml.scanner.ScannerError(_BLOCK_SCALAR, start_mark, problem, self.get_mark())
                increment = int(ch)
            else:
                break
            self.forward()
        ch = self.peek()
        if ch not in " \t" + _END_OF_LINE:
            problem = f"expected chomping or indentation indicators, but found {ch!r}"
            raise yaml.scanner.ScannerError(_BLOCK_SCALAR, start_mark, problem, self.get_mark())
        return chomping, increment

    def scan_block_scalar_ignored_line(self, start_mark):
        # PyYAML's, with tabs as white space before the comment or the end of the header line
        while self.peek() in " \t":
            self.forward()
        if self.peek() == "#":
            while self.peek() not in _END_OF_LINE:
                self.forward()
        ch = self.peek()
        if ch not in _END_OF_LINE:
            problem = f"expected a comment or a line break, but found {ch!r}"
            raise yaml.scanner.ScannerError(_BLOCK_SCALAR, start_mark, problem, self.get_mark())
        self.scan_line_break()

    def scan_block_scalar(self, style):
        token = super().scan_block_scalar(style)
        # PyYAML stops at the first line indented less than the scalar. The npm library reads a
        # tab that starts that line (after its spaces) as a line of the scalar, and refuses it.
        if self.peek() == "\t":
            problem = "found a tab in a line less indented than the block scalar"
            raise yaml.scanner.ScannerError(_BLOCK_SCALAR, token.start_mark, problem, self.get_mark())
        return token

    # --- composing and constructing

    def compose_node(self, parent, index):
        # an anchor may be defined again, an alias meaning the nearest definition before it (PyYAML refuses)
        if not self.check_event(yaml.AliasEvent):
            self.anchors.pop(self.peek_event().anchor, None)
        return super().compose_node(parent, index)

    def compose_scalar_node(self, anchor):
        # a bare "!" tag means "a string" (YAML 1.2), whereas PyYAML still resolves the text by its look
        if self.peek_event().tag == "!":
            self.peek_event().tag = "tag:yaml.org,2002:str"
        return super().compose_scalar_node(anchor)

    def flatten_mapping(self, node):
        # several merge keys: the npm library lets the first one win, PyYAML the last one
        merges = [pair for pair in node.value if pair[0].tag == _MERGE_TAG]
        node.value = merges[::-1] + [pair for pair in node.value if pair[0].tag != _MERGE_TAG]
        super().flatten_mapping(node)

    def construct_scalar(self, node):
        # JavaScript strings are UTF-16: the two halves of a pair written as two escapes
        # ("\ud83d\ude00") make one character there, not two lone surrogates
        return _join_surrogates(super().construct_scalar(node))

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value if isinstance(node, yaml.MappingNode) else ():
            if key_node.tag == _MERGE_TAG:  # never a duplicate: the npm library makes a new symbol of each
                if not isinstance(key_node, yaml.ScalarNode):
                    problem = "a merge key must be a scalar"
                    raise yaml.constructor.ConstructorError(None, None, problem, key_node.start_mark)
                continue
            key = self.construct_object(key_node, deep=True)
            try:
                duplicate = key in seen
                seen.add(key)
            except TypeError:  # unhashable key, reported by the base class
                continue
            if duplicate:
                problem = "Map keys must be unique"
                raise yaml.constructor.ConstructorError(None, None, problem, key_node.start_mark)
        return super().construct_mapping(node, deep=deep)


def _install_core_schema(loader):
    for name, pattern, first, convert in _CORE_SCALARS:
        tag = f"tag:yaml.org,2002:{name}"
        regexp = re.compile(rf"(?:{pattern})\Z")
        loader.add_implicit_resolver(tag, regexp, first)
        loader.add_constructor(tag, _core_scalar_constructor(regexp, convert))
    loader.add_constructor(_MERGE_TAG, _construct_merge_tagged)
    loader.add_constructor(None, _construct_unresolved)


_install_core_schema(_CoreLoader)


def _describe(error):
    if isinstance(error, yaml.MarkedYAMLError):
        mark = error.problem_mark or error.context_mark
        problem = error.problem or error.context or "syntax error"
        return f"{problem} at line {mark.line + 1}, column {mark.column + 1}" if mark else problem
    return " ".join(str(error).split()) or type(error).__name__


def load_yaml(text, source):
    """Parse one YAML document with the same scalar rules as the npm `yaml` library."""
    loader = None
    try:
        if not text.endswith(("\n", "\r")):
            text += "\n"  # the npm library reads a missing last line break as present (a block scalar then ends with one)
        loader = _CoreLoader(text)  # already rejects characters YAML does not allow
        return loader.get_single_data()
    except Exception as error:  # PyYAML's rarer tags (!!timestamp...) can fail with plain Python errors
        raise PresetError(f"{source}: invalid YAML ({_describe(error)})") from error
    finally:
        if loader is not None:
            loader.dispose()


# --- validation, a mirror of PresetSchema (packages/presets/src/schema.ts) ---------

_MISSING = object()  # a key that is absent; None is a key that is present but null
_KEBAB = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
_PREVIEW = re.compile(r"previews/[a-z0-9-]+\.(mp4|webm)")
_SAFETENSORS = re.compile(r".*\.safetensors", re.DOTALL)


def _type_name(value):
    if value is _MISSING:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, _Symbol):
        return "symbol"
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    if isinstance(value, float) and math.isinf(value):
        return "Infinity"
    if isinstance(value, (int, float)):
        return "number"
    return {str: "string", list: "array", dict: "object"}.get(type(value), "unknown")


def _length(text):
    """Length as zod counts it: in code points (the surrogate pairs were joined when the text was read)."""
    return len(text)


def _string(min_len=0, max_len=None, pattern=None, hint=""):
    def parse(value, path, issues):
        if not isinstance(value, str):
            issues.append((path, f"Invalid input: expected string, received {_type_name(value)}"))
            return None
        length = _length(value)
        if length < min_len:
            issues.append((path, f"Too small: expected string to have >={min_len} characters"))
        if max_len is not None and length > max_len:
            issues.append((path, f"Too big: expected string to have <={max_len} characters"))
        if pattern is not None and not pattern.fullmatch(value):
            issues.append((path, hint))
        return value

    return parse


def _literal(expected):
    def parse(value, path, issues):
        if value != expected or not isinstance(value, str):
            issues.append((path, f'Invalid input: expected "{expected}"'))
            return None
        return value

    return parse


def _enum(options):
    def parse(value, path, issues):
        if not isinstance(value, str) or value not in options:
            choices = "|".join(f'"{option}"' for option in options)
            issues.append((path, f"Invalid option: expected one of {choices}"))
            return None
        return value

    return parse


def _number(low, high, integer=False):
    def parse(value, path, issues):
        finite = not isinstance(value, float) or math.isfinite(value)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not finite:
            issues.append((path, f"Invalid input: expected number, received {_type_name(value)}"))
            return None
        if integer and isinstance(value, float) and value.is_integer():
            value = int(value)  # 5.0 and 1e1 are whole numbers
        if integer and not isinstance(value, int):
            issues.append((path, "Invalid input: expected int, received number"))
            return None
        if value < low:
            issues.append((path, f"Too small: expected number to be >={low}"))
        if value > high:
            issues.append((path, f"Too big: expected number to be <={high}"))
        return value

    return parse


def _fps(value, path, issues):
    if not isinstance(value, bool) and isinstance(value, (int, float)) and value in FPS_VALUES:
        return int(value)
    issues.append((path, "Invalid input"))
    return None


def _array(item, min_len=0, max_len=None):
    def parse(value, path, issues):
        if not isinstance(value, list):
            issues.append((path, f"Invalid input: expected array, received {_type_name(value)}"))
            return None
        if len(value) < min_len:
            issues.append((path, f"Too small: expected array to have >={min_len} items"))
        if max_len is not None and len(value) > max_len:
            issues.append((path, f"Too big: expected array to have <={max_len} items"))
        return [item(entry, path + (index,), issues) for index, entry in enumerate(value)]

    return parse


def _object(value, path, issues, keys):
    """The mapping to read the fields from (None if it is not one); unknown keys are refused."""
    if not isinstance(value, dict):
        issues.append((path, f"Invalid input: expected object, received {_type_name(value)}"))
        return None
    unknown = [str(key) for key in value if key not in keys]
    if unknown:
        label = "key" if len(unknown) == 1 else "keys"
        quoted = ", ".join(f'"{key}"' for key in unknown)
        issues.append(((path or ("(root)",)) + (",".join(unknown),), f"Unrecognized {label}: {quoted}"))
    return value


def _field(obj, key, path, issues, parse, default=_MISSING):
    # zod applies a default only to a key that is absent, never to one that is null
    return parse(obj.get(key, default), path + (key,), issues)


_PRESET_KEYS = (
    "schema",
    "id",
    "name",
    "description",
    "preview",
    "license",
    "author",
    "capability",
    "camera",
    "prompt",
    "defaults",
    "models",
    "loras",
)
_KEBAB_ID = _string(max_len=48, pattern=_KEBAB, hint="must be kebab-case (a-z, 0-9, -)")
_PREVIEW_PATH = _string(pattern=_PREVIEW, hint="must look like previews/<id>.mp4")
_SAFETENSORS_FILE = _string(pattern=_SAFETENSORS, hint="must be a .safetensors file")


def _camera(value, path, issues):
    obj = _object(value, path, issues, ("poses", "speed", "combine"))
    if obj is None:
        return None
    poses = _field(obj, "poses", path, issues, _array(_enum(CAMERA_POSES), 1, 2))
    speed = _field(obj, "speed", path, issues, _number(0.1, 3), default=1)
    combine = _field(obj, "combine", path, issues, _enum(CAMERA_COMBINES), default="together")
    if poses is not None and None not in poses:
        if len(set(poses)) != len(poses):
            issues.append((path + ("poses",), "poses must not repeat"))
        # "static" at the same time as a move adds nothing; before or after one, it is a hold
        if "static" in poses and len(poses) > 1 and combine is not None and combine != "then":
            issues.append((path + ("poses",), '"static" can only be combined with another pose when combine is "then"'))
    return {"poses": poses, "speed": speed, "combine": combine}


def _prompt(value, path, issues):
    obj = _object(value, path, issues, ("suffix", "negative"))
    if obj is None:
        return None
    text = _string(max_len=300)
    return {
        "suffix": _field(obj, "suffix", path, issues, text, default=""),
        "negative": _field(obj, "negative", path, issues, text, default=""),
    }


def _defaults(value, path, issues):
    obj = _object(value, path, issues, ("duration_s", "resolution", "fps"))
    if obj is None:
        return None
    return {
        "duration_s": _field(obj, "duration_s", path, issues, _number(2, 10, integer=True), default=5),
        "resolution": _field(obj, "resolution", path, issues, _enum(RESOLUTIONS), default="480p"),
        "fps": _field(obj, "fps", path, issues, _fps, default=16),
    }


def _models(value, path, issues):
    obj = _object(value, path, issues, ("preferred", "fallback"))
    if obj is None:
        return None
    models = {"preferred": _field(obj, "preferred", path, issues, _KEBAB_ID)}
    if "fallback" in obj:
        models["fallback"] = _field(obj, "fallback", path, issues, _KEBAB_ID)
    return models


def _lora(value, path, issues):
    obj = _object(value, path, issues, ("file", "strength"))
    if obj is None:
        return None
    return {
        "file": _field(obj, "file", path, issues, _SAFETENSORS_FILE),
        "strength": _field(obj, "strength", path, issues, _number(0, 2)),
    }


def _preset(value, path, issues):
    obj = _object(value, path, issues, _PRESET_KEYS)
    if obj is None:
        return None
    return {
        "schema": _field(obj, "schema", path, issues, _literal(SCHEMA_ID)),
        "id": _field(obj, "id", path, issues, _KEBAB_ID),
        "name": _field(obj, "name", path, issues, _string(min_len=1, max_len=40)),
        "description": _field(obj, "description", path, issues, _string(max_len=140), default=""),
        "preview": _field(obj, "preview", path, issues, _PREVIEW_PATH),
        "license": _field(obj, "license", path, issues, _enum(LICENSES)),
        "author": _field(obj, "author", path, issues, _string(min_len=1, max_len=60)),
        "capability": _field(obj, "capability", path, issues, _literal("i2v-camera")),
        "camera": _field(obj, "camera", path, issues, _camera),
        "prompt": _field(obj, "prompt", path, issues, _prompt, default={}),
        "defaults": _field(obj, "defaults", path, issues, _defaults, default={}),
        "models": _field(obj, "models", path, issues, _models),
        "loras": _field(obj, "loras", path, issues, _array(_lora, max_len=3), default=[]),
    }


def parse_preset(text, source):
    """Parse and validate a preset; returns it normalized, with every default filled in."""
    raw = load_yaml(text, source)
    issues = []
    preset = _preset(raw, (), issues)
    if issues:
        details = "; ".join(f"{'.'.join(map(str, path)) or '(root)'}: {message}" for path, message in issues)
        raise PresetError(f"{source}: {details}")
    return preset
