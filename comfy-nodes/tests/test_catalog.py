# SPDX-License-Identifier: GPL-3.0-only
"""The preset catalog: what the node menu lists, which file a name reaches, and the bundled copies.

The menu lists several folders; the user's folder comes first and wins on a name clash (the
"remix" gesture), the bundled folder comes last. A name that reaches a file outside those
folders is refused, whatever the operating system the pack runs on.
"""
import importlib.util
import os
import subprocess
from pathlib import Path

import pytest

from montagio_nodes.catalog import BUNDLED_DIR, PRESET_EXTENSIONS, _parts, list_presets, resolve_preset
from montagio_nodes.preset import PresetError, parse_preset
from tests.bridge import find_monorepo, require_parity

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "sync_presets.py"


def load_sync_module():
    """scripts/ is not a package: load the script by its path."""
    spec = importlib.util.spec_from_file_location("sync_presets", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def touch(path, text="x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


@pytest.fixture
def folders(tmp_path):
    """user/: a.yaml, sub/b.yml, notes.txt. bundled/: a.yaml, c.YAML. Beside them, a secret."""
    user, bundled = tmp_path / "user", tmp_path / "bundled"
    touch(user / "a.yaml", "user")
    touch(user / "sub" / "b.yml")
    touch(user / "notes.txt")
    touch(bundled / "a.yaml", "bundled")
    touch(bundled / "c.YAML")
    touch(tmp_path / "secret.yaml", "secret")
    return user, bundled


def remove_link(link):
    try:
        link.unlink()
    except OSError:  # a directory link on Windows
        os.rmdir(link)


@pytest.fixture
def dir_link():
    """link(path, target): `path` becomes a link to the folder `target`, and goes away with the test.

    A symbolic link where the system allows it, else (Windows without the right to make one) a
    junction, which the standard library follows the same way.
    """
    made = []

    def link(path, target):
        try:
            path.symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError):
            if os.name != "nt":
                pytest.skip("this system does not let the tests create symbolic links")
            done = subprocess.run(["cmd", "/c", "mklink", "/J", str(path), str(target)], capture_output=True)
            if done.returncode != 0:
                pytest.skip("this system does not let the tests create links")
        made.append(path)

    yield link
    for path in made:
        remove_link(path)


# --- listing --------------------------------------------------------------------


def test_extensions():
    assert PRESET_EXTENSIONS == (".yaml", ".yml")


def test_lists_sorted_unique_posix_names(folders):
    user, bundled = folders
    assert list_presets([user, bundled]) == ["a.yaml", "c.YAML", "sub/b.yml"]


def test_lists_whatever_the_folder_order(folders):
    user, bundled = folders
    assert list_presets([bundled, user]) == ["a.yaml", "c.YAML", "sub/b.yml"]


def test_accepts_strings_and_paths(folders):
    user, bundled = folders
    assert list_presets([str(user), bundled]) == ["a.yaml", "c.YAML", "sub/b.yml"]


def test_missing_dir_is_ignored(tmp_path):
    assert list_presets([tmp_path / "nope"]) == []


def test_missing_dir_does_not_hide_the_others(folders, tmp_path):
    user, _ = folders
    assert list_presets([tmp_path / "nope", user]) == ["a.yaml", "sub/b.yml"]


def test_no_dir_lists_nothing():
    assert list_presets([]) == []


def test_extension_filter_is_case_insensitive_and_needs_a_name(tmp_path):
    for name in ("lower.yaml", "upper.YML", "mixed.Yaml"):
        touch(tmp_path / name)
    for name in (".yaml", "yaml", "a.yaml.bak", "b.json", "c"):
        touch(tmp_path / name)
    assert list_presets([tmp_path]) == ["lower.yaml", "mixed.Yaml", "upper.YML"]


def test_a_folder_named_like_a_preset_is_not_a_preset(tmp_path):
    (tmp_path / "dir.yaml").mkdir()
    touch(tmp_path / "dir.yaml" / "inner.yaml")
    assert list_presets([tmp_path]) == ["dir.yaml/inner.yaml"]


# --- resolving ------------------------------------------------------------------


def test_user_file_wins_over_bundled(folders):
    user, bundled = folders
    assert resolve_preset("a.yaml", [user, bundled]) == user / "a.yaml"


def test_folder_order_is_the_priority(folders):
    user, bundled = folders
    assert resolve_preset("a.yaml", [bundled, user]) == bundled / "a.yaml"


def test_falls_back_to_the_next_folder(folders):
    user, bundled = folders
    assert resolve_preset("c.YAML", [user, bundled]) == bundled / "c.YAML"


def test_resolves_a_nested_name(folders):
    user, bundled = folders
    assert resolve_preset("sub/b.yml", [user, bundled]) == user / "sub" / "b.yml"


def test_both_slashes_are_separators(folders):
    user, bundled = folders
    assert resolve_preset("sub\\b.yml", [user, bundled]) == user / "sub" / "b.yml"
    assert resolve_preset("sub//b.yml", [user, bundled]) == user / "sub" / "b.yml"
    assert resolve_preset("./sub/./b.yml", [user, bundled]) == user / "sub" / "b.yml"


def test_every_listed_name_resolves_to_an_existing_file(folders):
    dirs = list(folders)
    for name in list_presets(dirs):
        assert resolve_preset(name, dirs).is_file()


def test_accepts_strings_and_paths_when_resolving(folders):
    user, bundled = folders
    assert resolve_preset("a.yaml", [str(user), bundled]) == user / "a.yaml"


# Names that are not a plain relative path to a preset, whichever system the pack runs on.
NOT_PLAIN_NAMES = [
    "../secret.yaml",
    "sub/../../secret.yaml",
    "sub/../secret.yaml",
    "sub\\..\\..\\secret.yaml",
    "..\\secret.yaml",
    "sub/..",
    "..",
    "...",
    "sub/.../x.yaml",
    "C:/x.yaml",
    "C:\\x.yaml",
    "C:x.yaml",
    "c:x.yaml",
    "sub/C:x.yaml",
    "/etc/x.yaml",
    "/a.yaml",
    "\\a.yaml",
    "\\\\server\\share\\x.yaml",
    "//server/share/x.yaml",
    "//a.yaml",
    "notes.txt",
    "sub/notes.txt",
    "sub",
    "",
    ".",
    "./",
    "   ",
    "a.yaml\0",
    "a\0.yaml",
]


@pytest.mark.parametrize("name", NOT_PLAIN_NAMES)
def test_the_name_alone_is_refused_on_every_system(name):
    # decided on the text of the name, not on what the system running the test does with it
    assert _parts(name) is None


@pytest.mark.parametrize(
    ("name", "parts"),
    [
        ("a.yaml", ["a.yaml"]),
        ("sub/b.yml", ["sub", "b.yml"]),
        ("sub\\b.yml", ["sub", "b.yml"]),
        ("sub\\deep/b.YAML", ["sub", "deep", "b.YAML"]),
        ("./sub//b.yml", ["sub", "b.yml"]),
        ("my preset.yaml", ["my preset.yaml"]),
        ("..a.yaml", ["..a.yaml"]),
    ],
)
def test_the_name_alone_is_accepted_on_every_system(name, parts):
    assert _parts(name) == parts


@pytest.mark.parametrize("name", [*NOT_PLAIN_NAMES, "missing.yaml", "sub/missing.yaml"])
def test_refuses_escape_and_unknown(folders, name):
    with pytest.raises(PresetError) as error:
        resolve_preset(name, list(folders))
    assert str(error.value) == f"{name}: preset not found or outside the preset folders"


def test_refuses_the_absolute_path_of_an_existing_preset(folders):
    user, bundled = folders
    for existing in (user / "a.yaml", user / "sub" / "b.yml", user.parent / "secret.yaml"):
        with pytest.raises(PresetError):
            resolve_preset(str(existing), [user, bundled])
        with pytest.raises(PresetError):
            resolve_preset(existing.as_posix(), [user, bundled])


def test_refuses_every_name_with_no_folder_at_all():
    with pytest.raises(PresetError):
        resolve_preset("a.yaml", [])


def test_a_missing_folder_does_not_break_the_search(folders, tmp_path):
    user, _ = folders
    assert resolve_preset("a.yaml", [tmp_path / "nope", user]) == user / "a.yaml"


def test_refuses_a_name_through_a_link_that_leaves_its_folder(folders, tmp_path, dir_link):
    user, bundled = folders
    touch(tmp_path / "outside" / "x.yaml")
    dir_link(user / "linked", tmp_path / "outside")
    with pytest.raises(PresetError):
        resolve_preset("linked/x.yaml", [user, bundled])
    assert not any(name.startswith("linked/") for name in list_presets([user, bundled]))


def test_an_escaping_link_does_not_hide_the_next_folder(folders, tmp_path, dir_link):
    user, bundled = folders
    touch(tmp_path / "outside" / "c.yaml")
    touch(bundled / "shared" / "c.yaml")
    dir_link(user / "shared", tmp_path / "outside")
    assert resolve_preset("shared/c.yaml", [user, bundled]) == bundled / "shared" / "c.yaml"
    assert "shared/c.yaml" in list_presets([user, bundled])


def test_a_link_that_stays_inside_its_folder_is_fine(folders, dir_link):
    user, bundled = folders
    dir_link(user / "alias", user / "sub")
    assert resolve_preset("alias/b.yml", [user, bundled]) == user / "alias" / "b.yml"


def test_a_preset_folder_may_itself_be_a_link(folders, tmp_path, dir_link):
    user, bundled = folders
    dir_link(tmp_path / "user_link", user)
    assert resolve_preset("sub/b.yml", [tmp_path / "user_link", bundled]) == tmp_path / "user_link" / "sub" / "b.yml"
    assert list_presets([tmp_path / "user_link"]) == ["a.yaml", "sub/b.yml"]


# --- the bundled folder ----------------------------------------------------------


def test_bundled_dir_is_the_presets_folder_of_the_pack():
    assert BUNDLED_DIR.is_dir()
    assert BUNDLED_DIR == Path(__file__).resolve().parent.parent / "presets"


def test_bundled_folder_ships_the_license():
    assert (BUNDLED_DIR / "LICENSE").is_file()


def test_bundled_folder_has_presets():
    assert list_presets([BUNDLED_DIR]) != []


def test_every_bundled_preset_parses():
    for name in list_presets([BUNDLED_DIR]):
        parse_preset(resolve_preset(name, [BUNDLED_DIR]).read_text("utf-8"), name)


def test_bundled_copies_match_monorepo_presets():
    monorepo = find_monorepo()
    if monorepo is None:
        message = "the montagio monorepo is not above this folder, so there is nothing to compare the copies with"
        if require_parity():
            pytest.fail(message, pytrace=False)
        pytest.skip(message)
    drift = load_sync_module().sync(monorepo / "presets", BUNDLED_DIR, dry_run=True)
    assert drift == [], "run python comfy-nodes/scripts/sync_presets.py"


# --- scripts/sync_presets.py -----------------------------------------------------


@pytest.fixture
def sync():
    return load_sync_module().sync


def test_sync_copies_yaml_and_license_byte_for_byte(tmp_path, sync):
    src, dst = tmp_path / "src", tmp_path / "dst"
    crlf = b"id: a\r\nname: \xc3\xa9\r\n"
    src.mkdir()
    (src / "a.yaml").write_bytes(crlf)
    (src / "b.yaml").write_bytes(b"id: b\n")
    (src / "LICENSE").write_bytes(b"licence\r\ntext")
    (src / "notes.txt").write_bytes(b"left behind")
    (src / "c.yml").write_bytes(b"left behind")
    changes = sync(src, dst)
    assert sorted(path.name for path in dst.iterdir()) == ["LICENSE", "a.yaml", "b.yaml"]
    assert (dst / "a.yaml").read_bytes() == crlf
    assert (dst / "LICENSE").read_bytes() == b"licence\r\ntext"
    assert len(changes) == 3 and all(isinstance(change, str) for change in changes)
    assert all(any(name in change for change in changes) for name in ("a.yaml", "b.yaml", "LICENSE"))


def test_sync_twice_changes_nothing_the_second_time(tmp_path, sync):
    src = tmp_path / "src"
    touch(src / "a.yaml")
    touch(src / "LICENSE")
    assert sync(src, tmp_path / "dst") != []
    assert sync(src, tmp_path / "dst") == []


def test_sync_updates_a_changed_file_and_only_that_one(tmp_path, sync):
    src, dst = tmp_path / "src", tmp_path / "dst"
    touch(src / "a.yaml", "new")
    touch(src / "b.yaml", "same")
    touch(dst / "a.yaml", "old")
    touch(dst / "b.yaml", "same")
    changes = sync(src, dst)
    assert (dst / "a.yaml").read_text("utf-8") == "new"
    assert len(changes) == 1 and "a.yaml" in changes[0]


def test_sync_removes_yaml_that_the_source_no_longer_has_and_keeps_the_rest(tmp_path, sync):
    src, dst = tmp_path / "src", tmp_path / "dst"
    touch(src / "keep.yaml")
    touch(dst / "keep.yaml")
    touch(dst / "gone.yaml")
    touch(dst / "other.txt")
    changes = sync(src, dst)
    assert not (dst / "gone.yaml").exists()
    assert (dst / "keep.yaml").exists() and (dst / "other.txt").exists()
    assert len(changes) == 1 and "gone.yaml" in changes[0]


def test_sync_dry_run_lists_the_changes_and_touches_nothing(tmp_path, sync):
    src, dst = tmp_path / "src", tmp_path / "dst"
    touch(src / "new.yaml")
    touch(src / "edited.yaml", "new")
    touch(src / "LICENSE")
    touch(dst / "edited.yaml", "old")
    touch(dst / "gone.yaml")
    before = {path.name: path.read_bytes() for path in dst.iterdir()}
    listed = sync(src, dst, dry_run=True)
    assert {path.name: path.read_bytes() for path in dst.iterdir()} == before
    assert len(listed) == 4
    assert listed == sync(src, dst)  # a real run does exactly what the dry run announced
    assert sync(src, dst, dry_run=True) == []


def test_sync_dry_run_does_not_create_the_destination(tmp_path, sync):
    src = tmp_path / "src"
    touch(src / "a.yaml")
    assert sync(src, tmp_path / "dst", dry_run=True) != []
    assert not (tmp_path / "dst").exists()


def test_sync_refuses_a_missing_source_and_keeps_the_destination(tmp_path, sync):
    dst = tmp_path / "dst"
    touch(dst / "a.yaml")
    with pytest.raises(FileNotFoundError):
        sync(tmp_path / "nope", dst)
    assert (dst / "a.yaml").exists()


def test_sync_script_defaults_to_the_monorepo_presets():
    module = load_sync_module()
    assert module.DEFAULT_SRC == SCRIPT.parent.parent.parent / "presets"
    assert module.DEFAULT_DST == BUNDLED_DIR
