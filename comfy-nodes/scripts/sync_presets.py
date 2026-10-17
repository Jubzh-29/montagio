# SPDX-License-Identifier: GPL-3.0-only
"""Copy the monorepo's presets into the pack, byte for byte.

The Comfy Registry publishes only the pack folder, so the pack ships its own copy of
presets/*.yaml and *.yml (CC-BY-4.0) and of presets/LICENSE. The copy is made by this script and
never by hand: tests/test_catalog.py fails when the bundled folder differs from the
monorepo's.

    python comfy-nodes/scripts/sync_presets.py            # monorepo presets/ -> comfy-nodes/presets/
    python comfy-nodes/scripts/sync_presets.py --check    # only list the differences, exit 1 if any
    python comfy-nodes/scripts/sync_presets.py SRC DST    # other folders
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

PACK_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SRC = PACK_DIR.parent / "presets"
DEFAULT_DST = PACK_DIR / "presets"
LICENSE_NAME = "LICENSE"
# the preset files the app's loadLibrary reads (packages/presets/src/library.ts): /\.ya?ml$/, lowercase only
PRESET_FILE = re.compile(r"\.ya?ml\Z")


def _yaml_files(folder):
    """The preset files directly in `folder` (*.yaml and *.yml, as the app reads them), by name."""
    if not folder.is_dir():
        return {}
    return {path.name: path for path in sorted(folder.iterdir()) if PRESET_FILE.search(path.name) and path.is_file()}


def sync(src, dst, *, dry_run=False):
    """Make `dst` hold the same preset files and the same LICENSE as `src`, and return the changes.

    The changes are strings ("add x.yaml", "update x.yml", "remove x.yaml"). A preset file of
    `dst` that `src` does not have is removed; any other file of `dst` is left alone. With
    `dry_run` nothing is written, the changes are only listed.
    """
    src, dst = Path(src), Path(dst)
    if not src.is_dir():  # an unreachable source must not look like "every preset was deleted"
        raise FileNotFoundError(f"{src} is not a folder")
    wanted = _yaml_files(src)
    license_file = src / LICENSE_NAME
    if license_file.is_file():
        wanted[LICENSE_NAME] = license_file
    changes = []
    for name, source in wanted.items():
        target = dst / name
        if not target.is_file():
            changes.append(f"add {name}")
        elif target.read_bytes() != source.read_bytes():
            changes.append(f"update {name}")
        else:
            continue
        if not dry_run:
            dst.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    for name, stale in _yaml_files(dst).items():
        if name not in wanted:
            changes.append(f"remove {name}")
            if not dry_run:
                stale.unlink()
    return changes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Copy the monorepo's presets into the pack, byte for byte.")
    parser.add_argument("src", nargs="?", type=Path, default=DEFAULT_SRC, help=f"default: {DEFAULT_SRC}")
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST, help=f"default: {DEFAULT_DST}")
    parser.add_argument("--check", action="store_true", help="only list the differences; exit 1 if there are any")
    args = parser.parse_args(argv)
    try:
        changes = sync(args.src, args.dst, dry_run=args.check)
    except FileNotFoundError as error:
        print(f"sync_presets: {error}", file=sys.stderr)
        return 2
    for change in changes:
        print(change)
    if not changes:
        print("bundled presets are up to date")
    return 1 if (args.check and changes) else 0


if __name__ == "__main__":
    sys.exit(main())
