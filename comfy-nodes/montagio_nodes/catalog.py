# SPDX-License-Identifier: GPL-3.0-only
"""Which presets the node menu lists and which file a preset name reaches.

The menu lists several folders. Their order is their priority: the user's folder
(ComfyUI/models/montagio_presets) comes first and wins on a name clash, which is how a
bundled preset gets remixed; the folder shipped with the pack (BUNDLED_DIR) comes last.

A preset name arrives from a workflow file, so it is untrusted. It must be a plain
relative path: no drive, no root, no ".." and nothing that leads out of its folder, on
whatever system the pack runs on (a workflow written on Windows runs on a Linux pod and
the other way round). Both "/" and "\\" separate the parts of a name, and the names the
menu lists always use "/". Folders whose name starts with a dot (.git, .github) are
neither listed nor reached.
"""
import os
from pathlib import Path, PurePosixPath, PureWindowsPath

from .preset import PresetError

PRESET_EXTENSIONS = (".yaml", ".yml")
BUNDLED_DIR = Path(__file__).resolve().parent.parent / "presets"


def _parts(name):
    """The folders and the file name of a preset name, or None when it is not a plain relative path."""
    if not isinstance(name, str) or "\0" in name:
        return None
    # one reading with "\" kept as a character (Linux), one with "\" as a separator (Windows)
    for text in (name, name.replace("\\", "/")):
        for flavour in (PurePosixPath, PureWindowsPath):
            path = flavour(text)
            if path.drive or path.root:  # "C:x", "C:/x", "//host/share/x", but also "/x" and "\x"
                return None
    parts = [part for part in name.replace("\\", "/").split("/") if part not in ("", ".")]
    # "..", and what Windows reads like it ("... " loses its trailing dots and spaces)
    if not parts or any(not part.strip(" .") for part in parts):
        return None
    if any(PureWindowsPath(part).drive for part in parts):  # "sub/C:x.yaml"
        return None
    if any(part.startswith(".") for part in parts[:-1]):  # ".git/x.yaml": a dot folder, which the menu skips
        return None
    if PurePosixPath(parts[-1]).suffix.lower() not in PRESET_EXTENSIONS:
        return None
    return parts


def _locate(parts, folder):
    """The preset file at `parts` in `folder`, or None when there is none or it leaves the folder."""
    candidate = Path(folder).joinpath(*parts)
    try:
        if not candidate.is_file():
            return None
        candidate.resolve().relative_to(Path(folder).resolve())  # symbolic links are followed
    except (OSError, RuntimeError, ValueError):  # ValueError: not inside the folder
        return None
    return candidate


def list_presets(dirs):
    """The names of the presets found in `dirs`: "/"-separated, without duplicates, sorted.

    A folder that does not exist is ignored. Only the names `resolve_preset` accepts are listed.
    """
    names = set()
    for folder in dirs:
        root = Path(folder)
        if not root.is_dir():
            continue
        for current, subfolders, files in os.walk(root):
            # a preset folder may be the clone of a repository: its .git, .github... hold no presets
            # (ComfyUI's own file lists skip .git too)
            subfolders[:] = [sub for sub in subfolders if not sub.startswith(".")]
            for file_name in files:
                name = "/".join(Path(current, file_name).relative_to(root).parts)
                parts = _parts(name)
                if parts is not None and _locate(parts, root) is not None:
                    names.add(name)
    return sorted(names)


def resolve_preset(name, dirs):
    """The file of the preset `name`: the first folder of `dirs` that holds it wins.

    A file whose link leads out of its folder is as good as absent from that folder, so the
    next folder is tried. Raises PresetError for a name that is not a plain relative path
    and for a name no folder holds.
    """
    parts = _parts(name)
    if parts is not None:
        for folder in dirs:
            found = _locate(parts, folder)
            if found is not None:
                return found
    raise PresetError(f"{name}: preset not found or outside the preset folders")
