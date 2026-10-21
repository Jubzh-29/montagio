"""Tests of the Modal tooling's pure helpers: python -m pytest infra/modal -q (no modal package needed)."""

from __future__ import annotations

import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import s2lib  # noqa: E402


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "core.autocrlf", "false")
    (tmp_path / ".gitignore").write_text("node_modules/\ns1-results/\n")
    (tmp_path / "infra").mkdir()
    (tmp_path / "infra" / "run.sh").write_text("#!/usr/bin/env bash\necho ok\n")
    (tmp_path / "README.md").write_text("# repo\n")
    (tmp_path / "gone.txt").write_text("deleted later\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "update-index", "--chmod=+x", "infra/run.sh")
    (tmp_path / "gone.txt").unlink()
    (tmp_path / "new.py").write_text("print('untracked')\n")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "dep.js").write_text("ignored\n")
    (tmp_path / "s1-results").mkdir()
    (tmp_path / "s1-results" / "clip.mp4").write_bytes(b"\0")
    return tmp_path


def test_repo_files_follow_gitignore_and_the_index_modes(repo: Path) -> None:
    assert s2lib.repo_files(repo) == [
        (".gitignore", 0o644),
        ("README.md", 0o644),
        ("infra/run.sh", 0o755),
        ("new.py", 0o644),
    ]


def test_repo_tar_is_byte_identical_when_nothing_changed(repo: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    out = tmp_path_factory.mktemp("tar")
    files = s2lib.repo_files(repo)
    s2lib.write_repo_tar(repo, files, out / "a.tar")
    s2lib.write_repo_tar(repo, files, out / "b.tar")
    assert (out / "a.tar").read_bytes() == (out / "b.tar").read_bytes()
    with tarfile.open(out / "a.tar") as tar:
        members = {member.name: member for member in tar.getmembers()}
    assert sorted(members) == [path for path, _ in files]
    assert members["infra/run.sh"].mode == 0o755
    assert all(member.mtime == 0 and member.uid == 0 for member in members.values())


def test_repo_tar_changes_with_a_file(repo: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    out = tmp_path_factory.mktemp("tar")
    s2lib.write_repo_tar(repo, s2lib.repo_files(repo), out / "repo.tar")
    before = (out / "repo.tar").read_bytes()
    (repo / "README.md").write_text("# repo, edited\n")
    s2lib.write_repo_tar(repo, s2lib.repo_files(repo), out / "repo.tar")
    assert (out / "repo.tar").read_bytes() != before


def test_split_jobs() -> None:
    assert s2lib.split_jobs(" --preset crash-push ;; --preset crane-up --runs 2; ") == [
        "--preset crash-push",
        "--preset crane-up --runs 2",
    ]
    with pytest.raises(ValueError, match="no job"):
        s2lib.split_jobs(" ; ")
    with pytest.raises(ValueError):
        s2lib.split_jobs('--text "unbalanced')


def test_run_dir_is_dated_in_utc_and_slugged() -> None:
    now = datetime(2026, 10, 21, 7, 30, 5, tzinfo=timezone.utc)
    assert s2lib.run_dir("Presets 1/3", now) == "/results/runs/20261021-073005-presets-1-3"
    assert s2lib.run_dir("***", now) == "/results/runs/20261021-073005-smoke"


def test_smoke_command_quotes_and_owns_out() -> None:
    command = s2lib.smoke_command('--extension edit --text "ajoute de la neige"', "/results/runs/x")
    assert command == (
        "npm run smoke -w @montagio/infra-runpod -- --extension edit --text 'ajoute de la neige'"
        " --timeout-min 120 --out /results/runs/x"
    )
    kept = s2lib.smoke_command("--preset all --timeout-min 45", "/results/runs/x")
    assert kept.endswith("--preset all --timeout-min 45 --out /results/runs/x")
    with pytest.raises(ValueError, match="--out"):
        s2lib.smoke_command("--preset all --out /tmp/x", "/results/runs/x")
    with pytest.raises(ValueError, match="--out"):
        s2lib.smoke_command("--out=/tmp/x", "/results/runs/x")
