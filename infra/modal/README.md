# GPU session tooling (Modal)

The Runpod pod of [`infra/runpod`](../runpod/README.md), rebuilt on [Modal](https://modal.com), for a GPU session without renting a machine: Modal's Starter plan includes 30 $ of compute a month. The step-by-step guide is the Modal part of [docs/S2_CHECKLIST.md](../../docs/S2_CHECKLIST.md) (in French).

Nothing new is installed on the GPU side. The image runs the functions of `infra/runpod/bootstrap.sh` with the versions of `infra/runpod/versions.env`: ComfyUI v0.41.0 (commit verified) started with `--disable-partner-nodes`, PyTorch, comfy-api-proxy 0.1.6 on `127.0.0.1:8189`, Node.js 22, the patched voice node, the repository and its node pack. `fetch-weights.ts` and `smoke.ts` run unchanged.

| File | What it does |
|---|---|
| `montagio_s2.py` | The Modal app `montagio-s2`: the image, two volumes, and the functions below. |
| `start.sh` | Prepares a container (weights, results and photos from the volumes), then `bootstrap.sh start`. |
| `s2lib.py` | Pure helpers (repository archive, batch split, run folders), tested by `test_s2lib.py` without the `modal` package. |
| `requirements.txt` | The pinned `modal` package, for a virtual environment of its own. |

## Volumes

| Volume | Mounted at | Holds |
|---|---|---|
| `montagio-weights` | `/weights` | the lock's weights; `/workspace/ComfyUI/models` links to `/weights/models` |
| `montagio-results` | `/results` | `s1-results/` (manual runs, `fetch-weights` report, `env/`), `runs/<date>-<label>/` (one folder per smoke run: `smoke.jsonl`, `clips/`, `logs/`), `inputs/` (your photos and clips) |

Each file of `inputs/` is linked into `/workspace` at start, so the checklist's `/workspace/start.png` works as written. Up to 1 TiB of volumes is free on Modal.

## Functions

From the repository root, with the venv's CLI (`..\.venv-modal\Scripts\modal.exe` on Windows):

```bash
modal run infra/modal/montagio_s2.py::weights --args "--extensions none"      # presets' weights, CPU only
modal run infra/modal/montagio_s2.py::check                                   # part 3 of the checklist on the GPU
modal volume put montagio-results start.png inputs/start.png                  # a photo, seen as /workspace/start.png
modal run --detach infra/modal/montagio_s2.py::smoke --args "--image /workspace/start.png --runs 2" --label fun-camera
modal run --detach infra/modal/montagio_s2.py::batch --common "--image /workspace/start.png" \
  --jobs "--preset crash-push,slow-push,pan-left; --preset pan-right,tilt-up,tilt-down" --label presets
modal run infra/modal/montagio_s2.py::cmd --cmd "nvidia-smi"                  # any command, services started
modal volume get montagio-results runs .                                      # every run, to judge on the PC
```

- `smoke` takes the arguments of `npm run smoke -w @montagio/infra-runpod --` from the checklist, and sets `--out` itself, to `/results/runs/<date>-<label>`. It adds `--timeout-min 120` unless you give one: an L4 renders about three times slower than the RTX 4090 the checklist was timed on.
- `batch` runs several `smoke` calls at once, one container each: the cost is about the same, the wait is shorter. Each container loads its models again, so group short jobs. At most 4 run at once.
- `ui` opens ComfyUI's interface through a `modal.forward` tunnel, for the checks the checklist does by hand. **ComfyUI has no login, and the URL is public while the function runs.** Keep it to yourself, and stop the function with Ctrl+C as soon as you are done: the GPU is billed meanwhile.
- With `--detach`, a run goes on if the PC disconnects. `modal app list` shows what still runs, and `modal app stop montagio-s2` stops it.

`modal shell` is not supported on Windows: the modal client refuses it. A shell is also billed at Sandbox rates, about 3x a function's for CPU and memory. On Linux or macOS, `modal shell infra/modal/montagio_s2.py::cmd` opens one on the same image, GPU and volumes. In Git Bash, set `MSYS_NO_PATHCONV=1`: otherwise a volume path such as `/inputs/start.png` is rewritten into a Windows path.

## Cost

Every function stops on its own, with a timeout: weights 5 h, `smoke` 3 h, `check` 30 min, `cmd` and `ui` 1 h. Modal bills by the second, CPU and memory on top of the GPU, each on the larger of what is requested and what is used.

| | Rate (October 2026) |
|---|---|
| L4 (24 GB), default | 0.80 $/h |
| A10 (24 GB) | 1.10 $/h |
| L40S (48 GB) | 1.95 $/h |
| CPU core, memory GiB | 0.047 $/h, 0.008 $/h |

An L4 container with its 2 cores and 16 GiB is about 1.10 to 1.30 $/h. `MONTAGIO_MODAL_GPU=A10` or `L40S` picks another GPU; the image does not change. The 24 GB of the L4 match the RTX 4090 the app targets: a 48 GB card would not tell whether a job fits.

Set a usage limit in Settings → Usage & Billing before the first run: with a usage limit of 30 $ and a spend limit of 0 $, Modal stops any work the free credits no longer cover.

## Open-stack guarantees

The guarantees of `infra/runpod` hold, since the same scripts run: ComfyUI with `--disable-partner-nodes` and the check that no partner node is loaded, `smoke.ts` restricted to the local proxy, weights only from the lock with their sha256. Modal is the machine, not a model API: no model runs outside the container, and `check-open-stack` scans this folder like the rest of `infra/`.
