# GPU session tooling (Modal)

The Runpod pod of [`infra/runpod`](../runpod/README.md), rebuilt on [Modal](https://modal.com), for a GPU session without renting a machine: Modal's Starter plan includes 30 $ of compute a month. The step-by-step guide is the Modal part of [docs/S2_CHECKLIST.md](../../docs/S2_CHECKLIST.md) (in French); the results are in [docs/S2_RESULTATS.md](../../docs/S2_RESULTATS.md) (in French).

Nothing new is installed on the GPU side. The image runs the functions of `infra/runpod/bootstrap.sh` with the versions of `infra/runpod/versions.env`: ComfyUI v0.41.0 (commit verified) started with `--disable-partner-nodes`, PyTorch, comfy-api-proxy 0.1.6 on `127.0.0.1:8189`, Node.js 22, the patched voice node (wildminder/ComfyUI-Chatterbox), the object swap's SAM 2 node (kijai/ComfyUI-segment-anything-2), the repository and its node pack. The proxy uses the same owner-only bearer token as the Runpod bootstrap; `source /workspace/montagio.env` exports it for the tools. `fetch-weights.ts` and `smoke.ts` run unchanged.

The image starts from Debian slim with Python 3.12, plus git, curl, ca-certificates, FFmpeg and procps. The install step (`preflight`, Node.js, ComfyUI, the proxy, the voice node, then the SAM 2 node, each of the last two only warning if it fails) is built on an L4 whatever `MONTAGIO_MODAL_GPU` says, and only `bootstrap.sh`, `versions.env`, `requirements-chatterbox.txt` and `patches/` go in before it, so a change elsewhere in the repository keeps that layer. The repository follows as a tar of the files git would commit, with fixed dates, then its npm dependencies and `/workspace/montagio.env`.

| File | What it does |
|---|---|
| `montagio_s2.py` | The Modal app `montagio-s2`: the image, two volumes, and the functions below. |
| `start.sh` | Prepares a container (weights, results and photos from the volumes), then `bootstrap.sh start`; `--expose-ui` puts ComfyUI on 0.0.0.0 for the `ui` tunnel. |
| `s2lib.py` | Pure helpers (repository archive, batch split, run folders, the smoke command with its `--out` and `--timeout-min`), without the `modal` package. |
| `test_s2lib.py` | Tests of `s2lib.py`, without the `modal` package: `npm run test:modal` (`python -m pytest infra/modal -q`). |
| `vram_cap.py` | Holds the GPU's memory until a given amount stays free (11.5 GiB for the 12 GB profile), writes what it holds to a ready file, then waits, 3 h at most (`--hold-s`). `lowvram` runs it with the Python of ComfyUI's venv, before ComfyUI starts. |
| `motion_library.py` | Renders the clips of the Motion library (listed in `presets/motions/library.yaml`) in a `cmd` container, from fictional characters only: Z-Image-Turbo draws six characters full body (the smoke's `--t2i`), Wan 2.1 I2V 480p 14B with its 4-step lightx2v LoRA and no effect LoRA animates each one for 81 frames at 16 fps, camera locked off, and a 30 s dance is chained from six clips, each starting on the last frame of the one before. Writes `results.jsonl`, `clips/`, `long/` and a sheet per clip; `--only` and `--no-long` narrow it. |
| `spike_restyle.py` | The Restyle spike of 2026-10-24, outside the app, in a `cmd` container: Wan 2.1 VACE 14B on a reference clip with a Canny or depth control, and a reference image that the app's edit job can make from the clip's first frame; core nodes only. `--validate-only` posts each graph, then interrupts it. `motion_library.py` reuses its helpers. |
| `requirements.txt` | The pinned `modal` package (`modal==1.6.2`), for a virtual environment of its own. |
| `LICENSE` | Apache-2.0. |

## Volumes

| Volume | Mounted at | Holds |
|---|---|---|
| `montagio-weights` | `/weights` | the lock's weights; `/workspace/ComfyUI/models` links to `/weights/models` |
| `montagio-results` | `/results` | `s1-results/` (manual runs, `fetch-weights` report, `env/`), `runs/<UTC date and time>-<label>/` (one folder per call of every function but `weights`, such as `runs/20261025-193044-remix`; a smoke run's holds `smoke.jsonl`, `clips/`, `logs/`), `inputs/` (your photos and clips) |

Each file of `inputs/` is linked into `/workspace` at start, so the checklist's `/workspace/start.png` works as written. Up to 1 TiB of volumes is free on Modal. When ComfyUI or the proxy fails to start, their logs go to `runs/failed-start-<time>/`.

## Functions

From the repository root, with the venv's CLI (`..\.venv-modal\Scripts\modal.exe` on Windows):

```bash
modal run infra/modal/montagio_s2.py::weights --args "--extensions none"      # presets' weights, CPU only
modal run infra/modal/montagio_s2.py::weights                                 # every extension's weights too
modal run infra/modal/montagio_s2.py::check                                   # part 3 of the checklist on the GPU
modal volume put montagio-results start.png inputs/start.png                  # a photo, seen as /workspace/start.png
modal run --detach infra/modal/montagio_s2.py::smoke --args "--image /workspace/start.png --runs 2" --label fun-camera
modal run --detach infra/modal/montagio_s2.py::batch --common "--image /workspace/start.png" \
  --jobs "--preset crash-push,slow-push,pan-left; --preset pan-right,crane-up" --label presets
modal run --detach infra/modal/montagio_s2.py::series --jobs "--extension edit; --extension edit --look infl8" --label edit
modal run --detach infra/modal/montagio_s2.py::lowvram --jobs "--preset crash-push --model wan22-ti2v-5b" --label twelve-gb
modal run infra/modal/montagio_s2.py::cmd --cmd "nvidia-smi"                  # any command, services started
modal run infra/modal/montagio_s2.py::cmd --no-services --cmd "nvidia-smi"    # the same, without ComfyUI and the proxy
modal volume get montagio-results runs .                                      # every run, to judge on the PC
```

- `weights` runs `npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models` with your `--args`, on 4 CPU cores and 4 GiB without a GPU, then prints the volume's use. Without `--args`, `fetch-weights` takes every extension (`--extensions all`): the 65 entries of the lock, 254 GB. `--extensions none` keeps the camera presets' 11 entries, 72.1 GB; `validated` or a list such as `edit,music` sits between (sizes of the lock, in GB of 10^9 bytes).
- `check` starts the services, then runs `nvidia-smi`, `comfy-nodes/scripts/smoke_comfyui.py`, reads `MontagioCameraEmbedding` from `/object_info`, runs the pack's `comfy-nodes/tests/test_camera.py` against that ComfyUI, saves the voice node's definition to `s1-results/object_info-chatterbox.json`, and ends with `bootstrap.sh collect` (`env/`). It returns the number of steps that failed.
- `smoke` takes the arguments of `npm run smoke -w @montagio/infra-runpod --` from the checklist, and sets `--out` itself, to `/results/runs/<UTC date and time>-<label>`; an `--out` of yours is refused. It adds `--timeout-min 120` unless you give one: an L4 renders about half as fast as the RTX 4090 the checklist was timed on (`docs/S2_RESULTATS.md`).
- `batch` runs several `smoke` calls at once, one container each, labelled `<label>-1`, `<label>-2`…, with `--common` added to each job (jobs apart by `;`; a `;` inside quotes stays in its text). The cost is about the same, the wait is shorter. Each container loads its models again, so group short jobs. At most 4 run at once.
- `series` runs several `smoke` calls one after the other in one container, into one folder: the models load once. Use it for short jobs on one model (edits, music, voice). It returns the number of runs that failed.
- `lowvram` is a `series` on the machine of the 12 GB profile. Before ComfyUI starts, `vram_cap.py` holds the L4's memory until 11.5 GiB stay free (its `free_gib` parameter), a 12 GB card whose desktop keeps about half a gigabyte; the container's RAM has a hard limit of 32 GiB. Beside the runs it writes `vram-cap.json` (the memory held) and `memory.txt` (the RAM peaks); the VRAM peaks of `smoke.jsonl` include the memory held. The 12 GB profile's times in the registry were measured with it on 2026-10-25.
- `cmd` runs one shell command in the repository, on the GPU, with ComfyUI and the proxy started; `--no-services` leaves them stopped. `motion_library.py` and `spike_restyle.py` run this way.
- `ui` opens ComfyUI's interface through a `modal.forward` tunnel, for the checks the checklist does by hand. **ComfyUI has no login, and the URL is public while the function runs.** Keep it to yourself, and stop the function with Ctrl+C as soon as you are done: the GPU is billed meanwhile.
- Modal may preempt a container; it then restarts the function with the same input, from the start. Give a long render a container of its own (one preset per `batch` job), so that a preemption costs that clip only.
- With `--detach`, a run goes on if the PC disconnects. `modal app list` shows what still runs, and `modal app stop montagio-s2` stops it. `smoke`, `series` and `lowvram` print the `modal volume get` line of their folder.

`modal shell` is not supported on Windows: the modal client refuses it. A shell is also billed at Sandbox rates, about 3x a function's for CPU and memory. On Linux or macOS, `modal shell infra/modal/montagio_s2.py::cmd` opens one on the same image, GPU and volumes. In Git Bash, set `MSYS_NO_PATHCONV=1`: otherwise a volume path such as `/inputs/start.png` is rewritten into a Windows path.

## Cost

Every function stops on its own, with a timeout: `weights` 5 h, `smoke`, `series` and `lowvram` 3 h, `check` 30 min, `cmd` and `ui` 1 h. Modal bills by the second, CPU and memory on top of the GPU, each on the larger of what is requested and what is used. The GPU functions request 2 cores and 16 GiB of memory.

| | Rate (October 2026) |
|---|---|
| L4 (24 GB), default | 0.80 $/h |
| A10 (24 GB) | 1.10 $/h |
| L40S (48 GB) | 1.95 $/h |
| CPU core, memory GiB | 0.047 $/h, 0.008 $/h |

An L4 container with its 2 cores and 16 GiB is about 1.02 $/h at the rates above, more when ComfyUI uses more memory. `MONTAGIO_MODAL_GPU=A10` or `L40S` picks another GPU; the image does not change. The 24 GB of the L4 match the RTX 4090 the app targets: a 48 GB card would not tell whether a job fits.

Set a usage limit in Settings → Usage & Billing before the first run: with a usage limit of 30 $ and a spend limit of 0 $, Modal stops any work the free credits no longer cover.

## Open-stack guarantees

The guarantees of `infra/runpod` hold, since the same scripts run: ComfyUI with `--disable-partner-nodes` and the check that no partner node is loaded, `smoke.ts` restricted to the local proxy, weights only from the lock with their sha256. Modal is the machine, not a model API: no model runs outside the container, and `check-open-stack` scans this folder like the rest of `infra/`.
