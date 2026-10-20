"""Pure helpers of the Modal tooling (no `modal` import, so the tests run without it).

montagio_s2.py imports this module on the PC (to pack the repository into the image, to split a batch)
and in the containers (to name a run's folder).
"""

from __future__ import annotations

import io
import re
import shlex
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

RUNS_DIR = "/results/runs"


def repo_files(root: Path) -> list[tuple[str, int]]:
    """The files git would commit from `root`: tracked ones and untracked ones .gitignore lets through.

    Returns (path, mode) pairs, paths with "/", sorted. The mode comes from the index for a tracked
    file (Windows checkouts lose the executable bit), 0o644 for an untracked one. A tracked file
    deleted from the working tree is left out.
    """
    tracked = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-s", "-z"], capture_output=True, check=True
    ).stdout.decode("utf-8")
    untracked = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--others", "--exclude-standard"],
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")
    files: dict[str, int] = {}
    for entry in filter(None, tracked.split("\0")):
        meta, path = entry.split("\t", 1)
        mode = meta.split(" ", 1)[0]
        if mode == "160000":  # a submodule: no file to send
            continue
        files[path] = 0o755 if mode == "100755" else 0o644
    for path in filter(None, untracked.split("\0")):
        files.setdefault(path, 0o644)
    return sorted((path, mode) for path, mode in files.items() if (root / path).is_file())


def write_repo_tar(root: Path, files: list[tuple[str, int]], dest: Path) -> None:
    """Packs `files` into an uncompressed tar that only changes when their content or mode does.

    Modal caches an image layer by the hash of the files it adds: fixed dates and owners keep that
    layer, and the npm install after it, from being rebuilt when nothing changed.
    """
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for path, mode in files:
            data = (root / path).read_bytes()
            info = tarfile.TarInfo(path)
            info.size = len(data)
            info.mode = mode
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tar.addfile(info, io.BytesIO(data))
    content = buffer.getvalue()
    if not dest.exists() or dest.read_bytes() != content:
        dest.write_bytes(content)


def split_jobs(jobs: str) -> list[str]:
    """`--preset crash-push; --preset tilt-up` → one smoke argument string per container."""
    items = [item.strip() for item in jobs.split(";")]
    items = [item for item in items if item]
    if not items:
        raise ValueError("no job: give smoke arguments separated by ';'")
    for item in items:
        shlex.split(item)  # an unbalanced quote fails here, on the PC, not in a container
    return items


def run_dir(label: str, now: datetime | None = None) -> str:
    """The volume folder of one smoke run: /results/runs/20261021-0930-<label>, in UTC."""
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:40] or "smoke"
    return f"{RUNS_DIR}/{stamp}-{slug}"


def smoke_command(args: str, out: str, timeout_min: int = 120) -> str:
    """The shell command a smoke container runs: the checklist's `npm run smoke`, into its own folder.

    Every run gets its own --out: two containers appending to one smoke.jsonl on a volume would lose
    lines (the last commit of a file wins). An L4 renders about three times slower than the RTX 4090
    the checklist was timed on, so a job gets `timeout_min` minutes unless the arguments say otherwise
    (smoke.ts gives up after 30 by default).
    """
    words = shlex.split(args)
    if "--out" in words or any(word.startswith("--out=") for word in words):
        raise ValueError("--out is set by the Modal function (one folder per run under /results/runs)")
    if not any(word == "--timeout-min" or word.startswith("--timeout-min=") for word in words):
        words += ["--timeout-min", str(timeout_min)]
    return shlex.join(["npm", "run", "smoke", "-w", "@montagio/infra-runpod", "--", *words, "--out", out])
