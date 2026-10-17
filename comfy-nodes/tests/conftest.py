# SPDX-License-Identifier: GPL-3.0-only
import pytest

from tests.bridge import BridgeUnavailable, find_monorepo, require_parity, run_bridge
from tests.parity_cases import CASES, COMPILE


@pytest.fixture(scope="session")
def ts():
    """What the app's TypeScript code answers for every shared case, computed once per run."""
    request = {
        "root": str(find_monorepo()),
        "cases": [{"name": name, "yaml": text} for name, text in CASES],
        "compile": COMPILE,
    }
    try:
        return run_bridge(request)
    except BridgeUnavailable as error:
        message = f"TypeScript parity needs the monorepo (npm ci): {error}"
        if require_parity():
            pytest.fail(message, pytrace=False)
        pytest.skip(message)


def ts_case(ts, name):
    """The app's answer for one case: {"name", "ok", "preset"?, "error"?}."""
    for answer in ts["cases"]:
        if answer["name"] == name:
            return answer
    raise KeyError(f"the bridge sent no answer for case {name!r}")
