# SPDX-License-Identifier: GPL-3.0-only
import sys
from pathlib import Path

import pytest

from tests.bridge import BridgeUnavailable, find_monorepo, require_parity, run_bridge
from tests.parity_cases import CASES, COMPILE

# The nodes import comfy_api and folder_paths, which only ComfyUI provides: the tests get the small
# stand-ins of tests/fakes. They come first, so that they win over any real copy on the machine.
FAKES = Path(__file__).resolve().parent / "fakes"
if str(FAKES) not in sys.path:
    sys.path.insert(0, str(FAKES))

PACK_DIR = Path(__file__).resolve().parent.parent


class PackFolderIsNotATestPackage:
    """Keeps pytest from taking the pack folder (comfy-nodes/) for a package of tests.

    comfy-nodes/__init__.py is the entry point ComfyUI loads: it imports the nodes with a relative
    import, which only works when the folder is loaded as a package. pytest imports the __init__.py
    of every package it collects, under a name it makes from the path, and it does not take a folder
    whose name is not a valid Python name for a package: the import then fails with "attempted
    relative import with no known parent package". A plain directory collector gives the folder back
    the part it had before it got an __init__.py. tests/ is still a package.

    It is a plugin of its own, registered in pytest_configure, because the hooks of a conftest.py
    do not run for the folder the conftest.py sits in.
    """

    @pytest.hookimpl(tryfirst=True)
    def pytest_collect_directory(self, path, parent):
        if Path(path).resolve() == PACK_DIR:
            return pytest.Dir.from_parent(parent, path=path)
        return None


def pytest_configure(config):
    config.pluginmanager.register(PackFolderIsNotATestPackage(), "montagio-pack-folder")


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


def ts_compile(ts, request):
    """The app's compileJob answer for one request of COMPILE: its params, or {"error": message}."""
    try:
        return ts["compile"][COMPILE.index(request)]
    except ValueError:
        raise KeyError("this request is not in tests/parity_cases.COMPILE, so the bridge did not run it") from None


@pytest.fixture
def fake_models_dir(tmp_path, monkeypatch):
    """A models folder of its own and no registered folder, for the fake folder_paths: a fresh ComfyUI."""
    import folder_paths

    models = tmp_path / "models"
    monkeypatch.setattr(folder_paths, "models_dir", str(models))
    monkeypatch.setattr(folder_paths, "folder_names_and_paths", {})
    return models
