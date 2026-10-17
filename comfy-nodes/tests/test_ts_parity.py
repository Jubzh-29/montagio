# SPDX-License-Identifier: GPL-3.0-only
"""The pack reads every preset exactly like the app's own parser.

The same texts go through `@montagio/presets` (zod 4 + the npm `yaml` library, run by tsx
through tests/ts_bridge.ts) and through `parse_preset`: same verdict, same values.
Without the monorepo (a standalone checkout of the pack) these tests are skipped; CI sets
MONTAGIO_REQUIRE_TS_PARITY=1 so that a missing bridge fails instead of passing silently.
"""
import pytest

from montagio_nodes.preset import CAMERA_POSES, PresetError, parse_preset
from tests import bridge
from tests.bridge import BridgeUnavailable, require_parity, run_bridge
from tests.conftest import ts_case
from tests.parity_cases import CASES


def test_constants_match(ts):
    assert list(CAMERA_POSES) == ts["constants"]["CAMERA_POSES"]


def test_constants_task_3_will_compare_are_exported(ts):
    constants = ts["constants"]
    assert set(constants["CAMERA_POSE_VALUES"]) == set(CAMERA_POSES) == set(constants["CAMERA_POSE_PROMPTS"])
    assert {aspect: sorted(by_resolution) for aspect, by_resolution in constants["dimensions"].items()} == {
        "16:9": ["480p", "720p"], "9:16": ["480p", "720p"], "1:1": ["480p", "720p"],
    }
    assert constants["dimensions"]["16:9"]["480p"] == {"width": 832, "height": 480}
    assert constants["frameCount"]["5"]["16"] == 81 and len(constants["frameCount"]) == 9
    assert all(set(by_fps) == {"16", "24"} for by_fps in constants["frameCount"].values())
    assert {"width": 1920, "height": 1080, "aspect": "16:9"} in constants["pickAspect"]


def test_case_names_are_unique():  # the bridge answers by name
    assert len({name for name, _ in CASES}) == len(CASES)


@pytest.mark.parametrize("name,text", CASES, ids=[c[0] for c in CASES])
def test_parse_parity(ts, name, text):
    expected = ts_case(ts, name)
    try:
        got = {"ok": True, "preset": parse_preset(text, name)}
    except PresetError:
        got = {"ok": False}
    assert got["ok"] == expected["ok"], expected.get("error")
    if got["ok"]:
        assert got["preset"] == expected["preset"]


def test_bridge_unavailable_without_node(monkeypatch):
    monkeypatch.setenv("PATH", "")
    with pytest.raises(BridgeUnavailable):
        run_bridge({"root": "x", "cases": [], "compile": []})


def test_bridge_unavailable_without_monorepo(monkeypatch):
    monkeypatch.setattr(bridge, "find_monorepo", lambda: None)
    with pytest.raises(BridgeUnavailable):
        run_bridge({"root": "x", "cases": [], "compile": []})


def test_bridge_unavailable_without_tsx(monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "find_monorepo", lambda: tmp_path)
    with pytest.raises(BridgeUnavailable):
        run_bridge({"root": "x", "cases": [], "compile": []})


@pytest.mark.parametrize("value,required", [("1", True), ("0", False), ("", False), ("true", False)])
def test_require_parity_reads_the_environment(monkeypatch, value, required):
    monkeypatch.setenv("MONTAGIO_REQUIRE_TS_PARITY", value)
    assert require_parity() is required
