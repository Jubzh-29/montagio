# SPDX-License-Identifier: GPL-3.0-only
"""The pack reads presets exactly like the app does.

The cases mirror packages/presets/test/schema.test.ts (zod schema + the npm `yaml`
parser, YAML 1.2 core schema). Whatever the TypeScript side accepts or rejects, and
every default it applies, must come out identically here.
"""
import math
import re
from pathlib import Path

import pytest

from montagio_nodes.preset import PresetError, load_yaml, parse_preset

BASE = (Path(__file__).parent / "fixtures" / "crash-push.yaml").read_text(encoding="utf-8")


def edit(a, b):
    if a not in BASE:
        raise AssertionError(f'fixture does not contain "{a}"')
    return BASE.replace(a, b, 1)


MODELS_BLOCK = "models:\n"
LORA_OK = "{file: a.safetensors, strength: 1}"
DEFAULTS_BLOCK = "defaults:\n  duration_s: 5\n  resolution: 480p\n  fps: 16\n"
DESCRIPTION = "description: Fast push toward the subject, ending tight."


def test_parses_crash_push_with_defaults():
    p = parse_preset(BASE, "crash-push.yaml")
    assert p["camera"] == {"poses": ["zoom_in"], "speed": 1.5}
    assert p["defaults"] == {"duration_s": 5, "resolution": "480p", "fps": 16}
    assert p["loras"] == [] and "fallback" in p["models"]


def test_missing_optional_blocks_get_defaults():  # no defaults block, no speed
    p = parse_preset(re.sub(r"defaults:\n(  .*\n)+", "", BASE).replace("  speed: 1.5\n", ""), "m.yaml")
    assert p["defaults"] == {"duration_s": 5, "resolution": "480p", "fps": 16} and p["camera"]["speed"] == 1


def test_every_optional_field_gets_its_default():
    minimal = "\n".join(
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
    assert parse_preset(minimal, "minimal.yaml") == {
        "schema": "montagio/preset@0.1",
        "id": "minimal",
        "name": "Minimal",
        "description": "",
        "preview": "previews/minimal.webm",
        "license": "MIT",
        "author": "me",
        "capability": "i2v-camera",
        "camera": {"poses": ["static"], "speed": 1},
        "prompt": {"suffix": "", "negative": ""},
        "defaults": {"duration_s": 5, "resolution": "480p", "fps": 16},
        "models": {"preferred": "some-model"},
        "loras": [],
    }


def test_crlf_parses_identically():
    assert parse_preset(BASE.replace("\n", "\r\n"), "x") == parse_preset(BASE, "x")


def test_unknown_key_names_file_and_path():
    with pytest.raises(PresetError, match=r"crash-push\.yaml: camera.*sped"):
        parse_preset(edit("speed: 1.5", "sped: 1.5"), "crash-push.yaml")


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
]


@pytest.mark.parametrize("a,b,where", REJECTED)
def test_rejects(a, b, where):
    with pytest.raises(PresetError) as caught:
        parse_preset(edit(a, b), "crash-push.yaml")
    assert str(caught.value).startswith(f"crash-push.yaml: {where}")


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
]


@pytest.mark.parametrize("a,b,path,expected", ACCEPTED)
def test_accepts(a, b, path, expected):
    value = parse_preset(edit(a, b), "crash-push.yaml")
    for step in path:
        value = value[step]
    assert value == expected and type(value) is type(expected)


@pytest.mark.parametrize("escapes,ok", [(40, True), (41, False)])
def test_surrogate_pair_escapes_count_as_one_code_point(escapes, ok):
    backslash = chr(92)  # a surrogate pair written as two YAML escapes spells one emoji
    emoji = backslash + "ud83d" + backslash + "ude00"
    text = edit("name: Crash Push", 'name: "' + emoji * escapes + '"')
    if ok:
        parse_preset(text, "s.yaml")
    else:
        with pytest.raises(PresetError, match="name"):
            parse_preset(text, "s.yaml")


@pytest.mark.parametrize("text,where", [("", "(root)"), ("- a", "(root)"), ("just text", "(root)"), ("5", "(root)")])
def test_root_must_be_a_mapping(text, where):
    with pytest.raises(PresetError, match=re.escape(f"r.yaml: {where}: ")):
        parse_preset(text, "r.yaml")


def test_every_problem_is_reported_once_per_path():
    text = edit(MODELS_BLOCK, "loras: [{file: a.ckpt, strength: 3, x: 1}]\n" + MODELS_BLOCK)
    with pytest.raises(PresetError) as caught:
        parse_preset(text, "p.yaml")
    message = str(caught.value)
    assert message.startswith("p.yaml: ")
    for path in ("loras.0.file: ", "loras.0.strength: ", "loras.0.x: "):
        assert path in message


def test_yaml_12_scalars():
    assert load_yaml("a: yes\nb: on\nc: 1:30\nd: 2026-10-17\ne: 0755\nf: 0o17\ng: 0x1F\nh: 1e3\ni: ~", "t") == \
        {"a": "yes", "b": "on", "c": "1:30", "d": "2026-10-17", "e": 755, "f": 15, "g": 31, "h": 1000.0, "i": None}


@pytest.mark.parametrize(
    "scalar,expected",
    [
        ("~", None), ("null", None), ("Null", None), ("NULL", None), ("", None), ("nUll", "nUll"),
        ("true", True), ("True", True), ("TRUE", True), ("false", False), ("False", False), ("FALSE", False),
        ("Yes", "Yes"), ("NO", "NO"), ("y", "y"), ("off", "off"), ("tRue", "tRue"),
        ("5", 5), ("+5", 5), ("-5", -5), ("-007", -7), ("0o17", 15), ("0x1f", 31), ("0xFF", 255),
        ("-0x1F", "-0x1F"), ("+0o7", "+0o7"), ("0o8", "0o8"), ("0b11", "0b11"), ("1_000", "1_000"), ("1,000", "1,000"),
        ("1.5", 1.5), (".5", 0.5), ("5.", 5.0), ("1E3", 1000.0), ("-1.5e-2", -0.015), ("1e", "1e"), ("1.2.3", "1.2.3"),
        (".inf", math.inf), ("-.Inf", -math.inf), ("+.INF", math.inf), (".inf0", ".inf0"), ("inf", "inf"),
        ("= ", "="), ("12:30:45", "12:30:45"), ("2026-10-17 12:30:00", "2026-10-17 12:30:00"),
    ],
)
def test_scalar_resolution_follows_the_core_schema(scalar, expected):
    value = load_yaml(f"k: {scalar}", "t")["k"]
    assert value == expected and type(value) is type(expected)


def test_nan_scalars():
    assert all(math.isnan(load_yaml(f"k: {nan}", "t")["k"]) for nan in (".nan", ".NaN", ".NAN"))
    assert load_yaml("k: .nAn", "t") == {"k": ".nAn"}


def test_quoted_scalars_are_always_strings():
    assert load_yaml("a: 'yes'\nb: \"5\"\nc: 'null'\nd: \"true\"", "t") == {"a": "yes", "b": "5", "c": "null", "d": "true"}


def test_explicit_tags_resolve_like_the_npm_yaml_library():
    text = "a: !!str 5\nb: !!int 0x1F\nc: !!bool yes\nd: !!null x\ne: !!float 5\nf: !custom text\ng: !custom [1, 2]"
    assert load_yaml(text, "t") == {"a": "5", "b": 31, "c": "yes", "d": "x", "e": "5", "f": "text", "g": [1, 2]}


def test_duplicate_key_rejected():
    with pytest.raises(PresetError, match="t.yaml"):
        load_yaml("a: 1\na: 2", "t.yaml")


def test_duplicate_key_rejected_when_written_differently():
    with pytest.raises(PresetError, match="t.yaml"):
        load_yaml('a: 1\n"a": 2', "t.yaml")


def test_merge_key_is_a_plain_key():
    assert load_yaml("b: &x {c: 1}\na:\n  <<: *x", "t") == {"b": {"c": 1}, "a": {"<<": {"c": 1}}}


def test_explicit_merge_tag_is_not_a_merge_either():
    assert load_yaml("b: &x {c: 1}\na:\n  !!merge <<: *x", "t") == {"b": {"c": 1}, "a": {"<<": {"c": 1}}}


def test_invalid_yaml_names_file():
    with pytest.raises(PresetError, match=r"broken\.yaml"):
        parse_preset("id: [unclosed", "broken.yaml")


def test_invalid_yaml_message_is_one_line_with_position():
    with pytest.raises(PresetError) as caught:
        parse_preset("id: [unclosed", "broken.yaml")
    message = str(caught.value)
    assert message.startswith("broken.yaml: invalid YAML (") and "line 1" in message and "\n" not in message


def test_several_documents_are_rejected():
    with pytest.raises(PresetError, match=r"multi\.yaml: invalid YAML"):
        parse_preset("a: 1\n---\nb: 2", "multi.yaml")


@pytest.mark.parametrize("text", ["name: bad\x01", "name: !!timestamp not-a-date", "name: !!binary '!'", "a: !!set [x]"])
def test_exotic_yaml_is_a_preset_error_not_a_crash(text):
    with pytest.raises(PresetError, match=r"^u\.yaml: "):
        parse_preset(text, "u.yaml")


def test_python_object_tags_are_never_executed():
    with pytest.raises(PresetError):
        parse_preset("id: !!python/object/apply:os.system ['echo no']", "evil.yaml")
