# SPDX-License-Identifier: GPL-3.0-only
"""The pack reads presets exactly like the app does.

The cases mirror packages/presets/test/schema.test.ts (zod schema + the npm `yaml`
parser, YAML 1.2 core schema). Whatever the TypeScript side accepts or rejects, and
every default it applies, must come out identically here.
"""
import math
import re

import pytest

from montagio_nodes.preset import PresetError, load_yaml, parse_preset
from tests.parity_cases import ACCEPTED, BASE, MINIMAL, MODELS_BLOCK, NO_DEFAULTS_NO_SPEED, REJECTED, SURROGATE_PAIR, edit


def test_parses_crash_push_with_defaults():
    p = parse_preset(BASE, "crash-push.yaml")
    assert p["camera"] == {"poses": ["zoom_in"], "speed": 1.5}
    assert p["defaults"] == {"duration_s": 5, "resolution": "480p", "fps": 16}
    assert p["loras"] == [] and "fallback" in p["models"]


def test_missing_optional_blocks_get_defaults():  # no defaults block, no speed
    p = parse_preset(NO_DEFAULTS_NO_SPEED, "m.yaml")
    assert p["defaults"] == {"duration_s": 5, "resolution": "480p", "fps": 16} and p["camera"]["speed"] == 1


def test_every_optional_field_gets_its_default():
    assert parse_preset(MINIMAL, "minimal.yaml") == {
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


@pytest.mark.parametrize("a,b,where", REJECTED)
def test_rejects(a, b, where):
    with pytest.raises(PresetError) as caught:
        parse_preset(edit(a, b), "crash-push.yaml")
    assert str(caught.value).startswith(f"crash-push.yaml: {where}")


@pytest.mark.parametrize("a,b,path,expected", ACCEPTED)
def test_accepts(a, b, path, expected):
    value = parse_preset(edit(a, b), "crash-push.yaml")
    for step in path:
        value = value[step]
    assert value == expected and type(value) is type(expected)


@pytest.mark.parametrize("escapes,ok", [(40, True), (41, False)])
def test_surrogate_pair_escapes_count_as_one_code_point(escapes, ok):
    text = edit("name: Crash Push", 'name: "' + SURROGATE_PAIR * escapes + '"')
    if ok:
        assert parse_preset(text, "s.yaml")["name"] == "😀" * escapes
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


def test_explicit_merge_tag_merges_like_the_npm_yaml_library():
    # only the explicit tag merges (the npm library resolves "<<" to a merge key by tag, never by its text)
    assert load_yaml("b: &x {c: 1}\na:\n  !!merge <<: *x", "t") == {"b": {"c": 1}, "a": {"c": 1}}
    assert load_yaml("a:\n  !!merge foo: {c: 1}", "t") == {"a": {"c": 1}}


@pytest.mark.parametrize(
    "text,expected",
    [
        ("a:\n  !!merge <<: {c: 1}\n  c: 2", {"c": 2}),  # a key of the mapping itself beats the merged one,
        ("a:\n  c: 2\n  !!merge <<: {c: 1}", {"c": 2}),  # wherever it is written
        ("a:\n  !!merge <<: [{c: 1}, {c: 2, d: 3}]", {"c": 1, "d": 3}),  # the earlier mapping wins
        ("a:\n  !!merge <<: {!!merge <<: {z: 1}, c: 1}", {"z": 1, "c": 1}),
        ("a:\n  !!merge <<: {c: 1}\n  !!merge <<: {d: 2}", {"c": 1, "d": 2}),  # not a duplicate key
        ("a:\n  !!merge <<: {c: 1}\n  !!merge <<: {c: 2}", {"c": 1}),  # the first merge key wins
    ],
)
def test_explicit_merge_details(text, expected):
    assert load_yaml(text, "t") == {"a": expected}


@pytest.mark.parametrize("text,expected", [("k: |\n  a\n  b", "a\nb\n"), (">\n  a\n  b", "a b\n"), ("k: |-\n  a", "a")])
def test_a_missing_last_line_break_counts_as_present(text, expected):  # so a block scalar at the end of the file
    value = load_yaml(text, "t")
    assert (value["k"] if isinstance(value, dict) else value) == expected


def test_a_bare_exclamation_mark_tag_makes_a_string():
    assert load_yaml("a: !\nb: ! 5\nc: ! true\nd: ! ~\ne: ! x", "t") == {"a": "", "b": "5", "c": "true", "d": "~", "e": "x"}


def test_an_anchor_can_be_defined_again():  # an alias means the nearest definition before it
    assert load_yaml("a: &x 1\nb: *x\nc: &x 2\nd: *x", "t") == {"a": 1, "b": 1, "c": 2, "d": 2}


@pytest.mark.parametrize("text", ["a:\n  !!merge <<: 5", "a:\n  !!merge <<: [1]", "a:\n  !!merge <<:", "? !!merge [a]\n: {c: 1}"])
def test_explicit_merge_of_something_else_than_mappings_is_refused(text):
    with pytest.raises(PresetError, match=r"^t: invalid YAML"):
        load_yaml(text, "t")


def test_a_value_tagged_merge_is_not_a_string():  # the npm library makes a JavaScript symbol of it
    with pytest.raises(PresetError, match=r"name: Invalid input: expected string, received symbol"):
        parse_preset(edit("name: Crash Push", "name: !!merge x"), "s.yaml")


def test_escaped_surrogate_halves_join_into_one_character():
    assert load_yaml('a: "' + SURROGATE_PAIR + '"', "t") == {"a": "😀"}
    assert load_yaml('a: "' + SURROGATE_PAIR[:6] + '"', "t")["a"] == chr(0xD83D)  # a lone half stays what it is


def test_invalid_yaml_names_file():
    with pytest.raises(PresetError, match=r"broken\.yaml"):
        parse_preset("id: [unclosed", "broken.yaml")


def test_invalid_yaml_message_is_one_line_with_position():
    with pytest.raises(PresetError) as caught:
        parse_preset("id: a: b", "broken.yaml")  # (the end of a file is on the line after its last line break)
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
