"""Montagio GPU session S2 on Modal: the Runpod pod of infra/runpod, rebuilt as a Modal image.

Same pinned stack as the pod (infra/runpod/versions.env), installed by the functions of
infra/runpod/bootstrap.sh: ComfyUI v0.41.0 (commit verified) started with --disable-partner-nodes,
PyTorch, comfy-api-proxy 0.1.6 on 127.0.0.1:8189, Node.js 22, the patched voice node, the
repository and its Montagio node pack. Weights and results live in two Modal volumes:

  montagio-weights   /weights   the lock's weights, filled inside Modal by fetch-weights (sha256 checked)
  montagio-results   /results   s1-results/ and runs/ (smoke.jsonl, clips, logs), the photos in inputs/

From the repository root, with the modal CLI of the project's venv:

  modal run infra/modal/montagio_s2.py::weights --args "--extensions none"     presets' weights (CPU, no GPU)
  modal run infra/modal/montagio_s2.py::check                                  install check on the GPU
  modal run --detach infra/modal/montagio_s2.py::smoke --args "--image /workspace/start.png --runs 2"
  modal run --detach infra/modal/montagio_s2.py::batch --common "--image /workspace/start.png" \
      --jobs "--preset crash-push,slow-push;--preset crane-up"     one container per job, in parallel
  modal run --detach infra/modal/montagio_s2.py::series --jobs "--extension edit;--extension edit --look infl8" \
      --label edit                                                          one container, the jobs in a row
  modal run infra/modal/montagio_s2.py::cmd --cmd "…"                          any command, services started

Every function stops on its own when its work is done. There is no long-lived GPU terminal: `modal shell`
is not supported on Windows, and a shell is billed at Sandbox rates (CPU and memory about 3x a function's).
On Linux or macOS, `modal shell infra/modal/montagio_s2.py::cmd` opens one on the same image, GPU and volumes.

MONTAGIO_MODAL_GPU picks the GPU of the functions (default L4, 24 GB: the VRAM of the RTX 4090 the
app targets). The step-by-step guide is docs/S2_CHECKLIST.md, part "Sur Modal".
"""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
WORKSPACE = "/workspace"
REMOTE_REPO = f"{WORKSPACE}/montagio"
for candidate in (HERE, Path(REMOTE_REPO) / "infra" / "modal"):
    if (candidate / "s2lib.py").is_file():
        sys.path.insert(0, str(candidate))
        break
import s2lib  # noqa: E402

# Every function stops on its own; the timeouts bound what a stuck container can cost
# (an L4 container is about 1.1 to 1.3 $/h with its CPU and memory). Split longer work with `batch`.
GPU = os.environ.get("MONTAGIO_MODAL_GPU", "L4")
BUILD_GPU = "L4"  # the GPU of the install step: changing MONTAGIO_MODAL_GPU must not rebuild the image
SMOKE_TIMEOUT_S = 3 * 3600
CMD_TIMEOUT_S = 3600
UI_TIMEOUT_S = 3600
WEIGHTS_TIMEOUT_S = 5 * 3600

weights_volume = modal.Volume.from_name("montagio-weights", create_if_missing=True)
results_volume = modal.Volume.from_name("montagio-results", create_if_missing=True)
VOLUMES = {"/weights": weights_volume, "/results": results_volume}

BOOTSTRAP = "source infra/runpod/bootstrap.sh"


def _image() -> modal.Image:
    runpod = HERE.parent / "runpod"
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("git", "curl", "ca-certificates", "ffmpeg", "procps")
        .env({"MONTAGIO_WORKSPACE": WORKSPACE, "NEXT_TELEMETRY_DISABLED": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
        # Only what the install step reads, so that a change elsewhere in the repository keeps
        # the (GPU-built) layer with PyTorch and ComfyUI.
        .add_local_file(runpod / "bootstrap.sh", f"{REMOTE_REPO}/infra/runpod/bootstrap.sh", copy=True)
        .add_local_file(runpod / "versions.env", f"{REMOTE_REPO}/infra/runpod/versions.env", copy=True)
        .add_local_file(
            runpod / "requirements-chatterbox.txt", f"{REMOTE_REPO}/infra/runpod/requirements-chatterbox.txt", copy=True
        )
        .add_local_dir(runpod / "patches", f"{REMOTE_REPO}/infra/runpod/patches", copy=True)
        # The pod's install, on a GPU: bootstrap.sh picks the PyTorch build from the driver and checks
        # that torch sees CUDA. Node.js, ComfyUI, PyTorch, the proxy, then the voice node (a warning if it fails).
        .run_commands(
            f"cd {REMOTE_REPO} && bash -c '{BOOTSTRAP} && preflight && install_node && install_comfyui"
            " && install_proxy && install_voice_node'",
            gpu=BUILD_GPU,
        )
    )
    if modal.is_local():
        tar = Path(tempfile.gettempdir()) / "montagio-modal-repo.tar"
        s2lib.write_repo_tar(HERE.parents[1], s2lib.repo_files(HERE.parents[1]), tar)
        image = image.add_local_file(tar, "/tmp/montagio-repo.tar", copy=True)
    return image.run_commands(
        f"tar -xf /tmp/montagio-repo.tar -C {REMOTE_REPO} && rm /tmp/montagio-repo.tar",
        f"cd {REMOTE_REPO} && bash -c '{BOOTSTRAP} && install_npm && write_env'",
        # Weights and results on the volumes; the checklist's paths stay valid.
        f"rm -rf {WORKSPACE}/ComfyUI/models && ln -s /weights/models {WORKSPACE}/ComfyUI/models",
        f"ln -sfn /results/s1-results {REMOTE_REPO}/s1-results",
        f"echo 'source {WORKSPACE}/montagio.env && cd {REMOTE_REPO}' >> /root/.bashrc",
    )


image = _image()
app = modal.App("montagio-s2", image=image)

# Billed on max(requested, used): ComfyUI mostly waits on the GPU, so 2 cores; the RAM request covers a
# 14B model on its way to the GPU, and the edit's text encoder unloaded beside it may use more (billed then).
GPU_OPTIONS = dict(gpu=GPU, volumes=VOLUMES, cpu=2.0, memory=16384)
# At most 4 smoke containers at once: Modal advises 5 writers at most on a volume, and it caps the spend rate.
MAX_PARALLEL = 4


def _sh(command: str) -> int:
    """Runs a command in the repository, with Node.js on the PATH (montagio.env).

    The volumes' folders are made first: on an empty volume, /workspace/ComfyUI/models and s1-results
    are links to nothing yet, and fetch-weights or smoke.ts could not create a folder under them.
    """
    script = (
        "mkdir -p /weights/models /results/s1-results /results/inputs /results/runs"
        f" && source {WORKSPACE}/montagio.env && cd {REMOTE_REPO} && {command}"
    )
    return subprocess.run(["bash", "-c", script]).returncode


def _start_services(expose_ui: bool = False) -> None:
    code = _sh("bash infra/modal/start.sh" + (" --expose-ui" if expose_ui else ""))
    if code != 0:
        _keep_logs(f"/results/runs/failed-start-{int(time.time())}")
        raise SystemExit(f"ComfyUI or the proxy did not start (code {code}): see the logs under /results/runs")


def _keep_logs(folder: str) -> None:
    _sh(f"mkdir -p {shlex.quote(folder)}/logs && cp {WORKSPACE}/logs/*.log {shlex.quote(folder)}/logs/ 2>/dev/null || true")
    results_volume.commit()


@app.function(volumes=VOLUMES, cpu=4.0, memory=4096, timeout=WEIGHTS_TIMEOUT_S)
def weights(args: str = "") -> int:
    """fetch-weights into the montagio-weights volume (no GPU). `--extensions none` takes the presets' only."""
    command = shlex.join(
        ["npm", "run", "weights", "-w", "@montagio/infra-runpod", "--", "--models-dir", f"{WORKSPACE}/ComfyUI/models"]
        + shlex.split(args)
    )
    code = _sh(command)
    weights_volume.commit()
    results_volume.commit()
    _sh("df -h /weights | tail -1; du -sh /weights/models 2>/dev/null")
    return code


@app.function(**GPU_OPTIONS, timeout=30 * 60)
def check() -> int:
    """Part 3 of the checklist on the GPU: services, partner nodes, the Montagio pack, its heavy test."""
    _start_services()
    steps = [
        "nvidia-smi",
        "python3 comfy-nodes/scripts/smoke_comfyui.py http://127.0.0.1:8188",
        "curl -s http://127.0.0.1:8188/object_info/MontagioCameraEmbedding | head -c 200; echo",
        "python3 -m pip install -q pytest PyYAML numpy"
        f" && MONTAGIO_COMFYUI_DIR={WORKSPACE}/ComfyUI MONTAGIO_COMFYUI_PYTHON={WORKSPACE}/venvs/comfyui/bin/python"
        " python3 -m pytest comfy-nodes/tests/test_camera.py -q -p no:cacheprovider",
        # Part 6.8, step 9: the voice node's real definition, to replace the fixture written by hand.
        "curl -fsS http://127.0.0.1:8188/object_info/ChatterboxMTLTTS > s1-results/object_info-chatterbox.json"
        " && head -c 160 s1-results/object_info-chatterbox.json; echo",
        "bash infra/runpod/bootstrap.sh collect >/dev/null && echo 'env/ written to s1-results'",
    ]
    failed = 0
    for step in steps:
        print(f"\n$ {step}", flush=True)
        if _sh(step) != 0:
            failed += 1
            print(f"✗ exit code not 0: {step}", flush=True)
    _keep_logs(s2lib.run_dir("check"))
    return failed


@app.function(**GPU_OPTIONS, timeout=SMOKE_TIMEOUT_S, max_containers=MAX_PARALLEL)
def smoke(args: str, label: str = "smoke") -> int:
    """One `npm run smoke` of the checklist, its results in /results/runs/<date>-<label>."""
    out = s2lib.run_dir(label)
    command = s2lib.smoke_command(args, out)
    _start_services()
    print(f"$ {command}", flush=True)
    code = _sh(command)
    _keep_logs(out)
    print(f"results: modal volume get montagio-results {out.removeprefix('/results/')} .", flush=True)
    return code


@app.function(**GPU_OPTIONS, timeout=SMOKE_TIMEOUT_S, max_containers=MAX_PARALLEL)
def series(jobs: str, label: str = "series") -> int:
    """Several smoke runs one after the other in one container, into one folder: the models stay loaded.

    For jobs on the same model (the checklist groups them so): --jobs "--extension edit --text …; --extension edit --look infl8 …".
    Returns the number of runs that failed.
    """
    items = s2lib.split_jobs(jobs)
    out = s2lib.run_dir(label)
    commands = [s2lib.smoke_command(item, out) for item in items]  # a bad argument fails before the GPU starts
    _start_services()
    failed = 0
    for index, command in enumerate(commands, 1):
        print(f"\n[{index}/{len(commands)}] $ {command}", flush=True)
        if _sh(command) != 0:
            failed += 1
    _keep_logs(out)
    print(f"results: modal volume get montagio-results {out.removeprefix('/results/')} .", flush=True)
    return failed


@app.function(**GPU_OPTIONS, timeout=CMD_TIMEOUT_S)
def cmd(cmd: str, services: bool = True) -> int:
    """One shell command in the repository, on the GPU, ComfyUI and the proxy started (--no-services: not).

    What the pod's terminal did, one command at a time: the container stops when the command ends.
    """
    if services:
        _start_services()
    print(f"$ {cmd}", flush=True)
    code = _sh(cmd)
    _keep_logs(s2lib.run_dir("cmd"))
    return code


@app.function(**GPU_OPTIONS, timeout=UI_TIMEOUT_S)
def ui() -> None:
    """ComfyUI's interface through a Modal tunnel, for the checks the checklist does by hand.

    Warning: ComfyUI has no login and the tunnel URL is public while this function runs. Do not share it,
    and stop the function (Ctrl+C, or modal app stop) as soon as you are done: the GPU is billed meanwhile.
    """
    _start_services(expose_ui=True)
    with modal.forward(8188) as tunnel:
        print(f"ComfyUI: {tunnel.url}  (public, no login: stop with Ctrl+C when done)", flush=True)
        while _sh("curl -fsS -o /dev/null http://127.0.0.1:8188/system_stats") == 0:
            time.sleep(30)
    _keep_logs(s2lib.run_dir("ui"))


@app.local_entrypoint()
def batch(jobs: str, common: str = "", label: str = "batch") -> None:
    """Several smoke runs at once, one container each: same cost, less waiting.

    --jobs "--preset crash-push,slow-push; --preset crane-up" (separated by ';'), --common added to each.
    Each container loads its models again (a few minutes): group the short jobs.
    """
    items = s2lib.split_jobs(jobs)
    calls = [(f"{common} {item}".strip(), f"{label}-{index}") for index, item in enumerate(items, 1)]
    print(f"{len(calls)} container(s) on {GPU}:", flush=True)
    for args, name in calls:
        print(f"  {name}: {args}", flush=True)
    codes = list(smoke.starmap(calls, return_exceptions=True))
    for (args, name), code in zip(calls, codes):
        print(f"{'✓' if code == 0 else '✗'} {name} ({code}): {args}", flush=True)
