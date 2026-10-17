# SPDX-License-Identifier: GPL-3.0-only
"""Run the app's own preset code on the pack's test inputs.

tests/ts_bridge.ts imports `@montagio/presets` (the TypeScript library the app is built on) and
answers a JSON request on stdout; tsx, from the monorepo's node_modules, runs it. Everything
here is test tooling: the pack itself never starts a process.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
BRIDGE_FROM_ROOT = "comfy-nodes/tests/ts_bridge.ts"
TIMEOUT_S = 120


class BridgeUnavailable(RuntimeError):
    """The monorepo, node or tsx is missing: there is nothing to compare the pack with."""


class BridgeFailed(RuntimeError):
    """The bridge started but did not answer: a bug in the bridge or in the app's code."""


def find_monorepo():
    """The folder above comfy-nodes/ whose package.json is named "montagio", or None."""
    for folder in TESTS_DIR.parents:
        try:
            manifest = json.loads((folder / "package.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(manifest, dict) and manifest.get("name") == "montagio":
            return folder
    return None


def require_parity():
    return os.environ.get("MONTAGIO_REQUIRE_TS_PARITY") == "1"


def run_bridge(request):
    root = find_monorepo()
    if root is None:
        raise BridgeUnavailable("the montagio monorepo is not above this folder")
    node = shutil.which("node")
    if node is None:
        raise BridgeUnavailable("node is not on PATH")
    tsx = root / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if not tsx.is_file():
        raise BridgeUnavailable(f"{tsx} is missing (run npm ci in the monorepo)")
    try:
        done = subprocess.run(
            [node, str(tsx), BRIDGE_FROM_ROOT],
            cwd=root,
            input=json.dumps(request).encode("utf-8"),
            capture_output=True,
            timeout=TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as error:
        raise BridgeFailed(f"the bridge did not answer within {TIMEOUT_S} s") from error
    if done.returncode != 0:
        raise BridgeFailed(f"the bridge exited with {done.returncode}:\n{done.stderr.decode('utf-8', 'replace')}")
    try:
        return json.loads(done.stdout.decode("utf-8"))
    except ValueError as error:
        raise BridgeFailed(f"the bridge printed something else than JSON: {done.stdout[:200]!r}") from error
