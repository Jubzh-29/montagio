# SPDX-License-Identifier: GPL-3.0-only
"""A stand-in for ComfyUI's folder_paths, for tests that run without ComfyUI.

It copies what ComfyUI v0.41.0 does in folder_paths.py: the same names, and the same rules in
add_model_folder_path (a new name starts a list with that one path; for a known name, a path
that is already listed is not added again, and is_default puts the path first) and in
get_folder_paths (a copy of the list, a KeyError for an unknown name). Nothing else is copied.

The `fake_models_dir` fixture of tests/conftest.py gives each test its own models_dir and an
empty folder_names_and_paths. models_dir has no usable value here: a test that forgets the
fixture fails on it instead of writing next to the fakes.
"""

models_dir = None

# name -> (paths, extensions), as in ComfyUI
folder_names_and_paths: dict[str, tuple[list[str], set[str]]] = {}


def add_model_folder_path(folder_name: str, full_folder_path: str, is_default: bool = False) -> None:
    if folder_name in folder_names_and_paths:
        paths, _exts = folder_names_and_paths[folder_name]
        if full_folder_path in paths:
            if is_default and paths[0] != full_folder_path:
                paths.remove(full_folder_path)
                paths.insert(0, full_folder_path)
        else:
            if is_default:
                paths.insert(0, full_folder_path)
            else:
                paths.append(full_folder_path)
    else:
        folder_names_and_paths[folder_name] = ([full_folder_path], set())


def get_folder_paths(folder_name: str) -> list[str]:
    return folder_names_and_paths[folder_name][0][:]
