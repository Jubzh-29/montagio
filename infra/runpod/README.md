# GPU session tooling (Runpod)

Scripts that turn a rented GPU pod (RTX 4090, 24 GB) into a Montagio backend: ComfyUI started with `--disable-partner-nodes`, the [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) (MIT) in front of it, the open weights of `registry/models.lock.yaml`, and a smoke test that goes through the Comfy SDK. The step-by-step guide of GPU session S2, the first one, is [docs/S2_CHECKLIST.md](../../docs/S2_CHECKLIST.md) (in French); session S1 became an analysis without GPU, [docs/S1_ANALYSE.md](../../docs/S1_ANALYSE.md).

| File | What it does |
|---|---|
| `bootstrap.sh` | Installs under `$MONTAGIO_WORKSPACE` (default `/workspace`): ComfyUI (pinned tag, commit verified) with PyTorch in a venv, comfy-api-proxy in another, Node.js 22 (checksum verified) and the repository's npm dependencies, then, last and only warning if they fail, the avatar's voice node (wildminder/ComfyUI-Chatterbox, pinned and patched) and the object swap's SAM 2 node (kijai/ComfyUI-segment-anything-2, pinned, unpatched). Links the Montagio node pack (`comfy-nodes`) as `custom_nodes/montagio`; starts ComfyUI on `:8188`, offline for Hugging Face, and the proxy on `127.0.0.1:8189`; fails if any partner node is loaded, and warns if a node of its list is missing (`MontagioCameraEmbedding`, the voice node's `ChatterboxMTLTTS`, and core nodes of the camera, effect, transition and motion workflows). |
| `fetch-weights.ts` | Resolves the exact Hugging Face file of every lock entry (`resolve/main/…`), downloads it into ComfyUI's `models/` with resume, checks the sha256 Hugging Face publishes, and writes a lock patch to review. Licenses are never edited. |
| `smoke.ts` | Compiles presets with `@montagio/presets`, submits them through `@comfyorg/sdk` to the proxy, downloads the clips, and records wall time, execution time and peak VRAM in `s1-results/smoke.jsonl`. Also runs the extension jobs and text to image (below). |
| `lib/` | The helpers of `smoke.ts` and `fetch-weights.ts`: the extension jobs, the ComfyUI checks, the weight download, the `.safetensors` header reader. |
| `versions.env` | Every pinned version and checksum, also read by the local installer (`infra/local`). |
| `patches/comfyui-chatterbox-no-routes.patch` | Removes the voice node's `/chatterbox/*` HTTP routes; its tokenizer reads the Chinese table (`Cangjie5_TC.json`, in the lock) from the model folder. Kept in LF and applied with `git apply --ignore-whitespace`: that tokenizer is CRLF upstream. |
| `requirements-chatterbox.txt` | The voice node's Python packages, pinned and hashed, installed with `--no-deps --require-hashes`. |
| `test/` | Vitest tests, among them the offline check of every workflow (`test/workflows.test.ts`). |

Without a rented pod, [`infra/modal`](../modal/README.md) builds the same install as a Modal image (the functions of `bootstrap.sh`, these versions) and runs `fetch-weights.ts` and `smoke.ts` unchanged, on an L4 and two volumes.

```bash
bash infra/runpod/bootstrap.sh --expose-ui
source /workspace/montagio.env
npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models
npm run smoke -w @montagio/infra-runpod -- --runs 2
bash infra/runpod/bootstrap.sh collect
```

`bootstrap.sh` without a command installs what is missing, then starts both services. The commands are `install` (no start), `start`, `stop`, `status` and `collect`, which packs the results folder into `$MONTAGIO_WORKSPACE/s1-results-<UTC date and time>.tgz` to download before stopping the pod: what the runs wrote there, the logs, `env/` (`nvidia-smi`, the ComfyUI commit, the pip freezes, `system_stats` and `object_info`), the workflows saved from the ComfyUI interface and ComfyUI's output folder. `--expose-ui` puts ComfyUI on 0.0.0.0 for the Runpod HTTP proxy (port 8188); `-h` prints the usage. The preflight wants git, curl, python3 (3.10 or newer), tar, gzip, sha256sum and nvidia-smi, as a Runpod PyTorch template ships them. PyTorch is 2.14.1 for CUDA 13.0, or 2.11.0 for CUDA 12.8 when the driver stops below 13.

| Variable | Default | What it sets |
|---|---|---|
| `MONTAGIO_WORKSPACE` | `/workspace` | where ComfyUI, the venvs, Node.js, the logs and `montagio.env` go (the Modal image sets it too) |
| `MONTAGIO_RESULTS` | `<repo>/s1-results` | the folder `collect` packs; `smoke.ts` and `fetch-weights.ts` write to `<repo>/s1-results` unless given `--out` |
| `MONTAGIO_PROXY_TOKEN` | a random 32-byte token, generated once | the proxy's bearer token, kept in `/workspace/run/proxy-token` and `/workspace/montagio.env` with owner-only permissions; set the same value in the app-only install's environment |

The proxy refuses every request without its token, apart from `/api/v2/health`. The token is never printed in the logs. A remote app reaches the loopback proxy through an SSH tunnel, or through HTTPS with the same token; plain HTTP is refused beyond loopback.

Give the pod's volume disk room for the weights: 72.1 GB for the camera presets alone (`--extensions none`), 254 GB for every extension, the default of `fetch-weights` (sizes of the lock, in GB of 10^9 bytes). ComfyUI, its venvs and Node.js come on top.

## Open-stack guarantees

- ComfyUI always runs with `--disable-partner-nodes`; `bootstrap.sh` reads `/object_info` and stops if a node is flagged `api_node` or comes from `comfy_api_nodes`.
- `@comfyorg/sdk` falls back to Comfy Cloud when `COMFY_BASE_URL` is blank. `smoke.ts` sets it explicitly (default `http://127.0.0.1:8189`), refuses every `comfy.org` / `comfy.app` host, drops any `COMFY_API_KEY`, and gives the SDK a `fetch` that refuses requests outside the proxy's origin. No Router method is used, and `check-open-stack` scans `infra/` for one.
- Weights come only from `registry/models.lock.yaml`, and `check-open-stack` checks the repository each of them is fetched from (`tools/check-open-stack/allowed-sources.yaml`: allowed mirrors and sources, refused repositories such as `Kijai/WanVideo_comfy`). Files fetched with `--extra` (evaluation of a candidate whose license is still being read) are hashed and reported but never added to the lock patch.
- The weights of the extensions (edit, effects, transitions, avatar, music, upscale, motion, restyle, swap) carry `extension:` in the lock; the trend remix has no weights of its own. `fetch-weights` takes them all by default (`--extensions all`, what a GPU session needs); `--extensions none`, `validated` (the extensions dated in `registry/extensions.yaml`) or a list such as `edit,transitions` narrows it. A lock entry may also name its folder under `models/` (`folder: loras`, `folder: tts/chatterbox/<pack>`, `folder: whisper/whisper-large-v3-turbo`, `folder: sam2`) when its URL does not end in `<folder>/<file>`.

Without a GPU, `npm run smoke -w @montagio/infra-runpod -- --dry-run` and `npm run weights -w @montagio/infra-runpod -- --dry-run` show what a session would run and download.

## Smoke options

For the camera presets: `--preset ID[,ID]` or `all` (default `crash-push`), `--model ID` (default: each preset's preferred model), `--image PATH` (default `demo-assets/images/sample-16x9.png`), `--resolution 480p|720p`, `--seed N` (default 42, +1 per run), `--runs N`, `--camera-pose` and `--camera-speed` (a value, a comma list, or `all` for the pose), `--prompt` (what the photo shows) and `--negative` (`wan` for the official Wan templates' default). For every mode: `--out DIR` (default `s1-results`), `--timeout-min N` (default 30), `--vram auto|comfyui|none`, `--base-url` (the proxy) and `--comfyui` (for `/object_info` and `/system_stats`, `none` to skip). `--t2i NAME[@ASPECT][#SEED]=TEXT` makes test photos with Z-Image-Turbo instead, one per `--t2i`. `npm run smoke -w @montagio/infra-runpod -- --help` lists them all.

The extensions have their own smoke mode: `--extension` takes a comma list of the 19 jobs below (`hook` stands for `hook-edit,transition`), or `all` for every one of them; they run in this order. Each job is checked against the running ComfyUI's `/object_info` first, timed, with its peak VRAM, and its output downloaded into `s1-results/clips/`; the compiled workflows go to `workflows/`, the definitions of their nodes to `object_info-extensions.json`. A file a job needs and was not given fails before anything runs. `--input` defaults to `demo-assets/images/sample-16x9.png`.

| Job | Model | Needs, and its options |
|---|---|---|
| `edit` | Qwen-Image-Edit-2511 | `--input`; `--look infl8\|action\|angles`, `--mask` (inpaint) or `--ref` (a second image) |
| `compose` | Qwen-Image-Edit-2511 | `--input` (the place) and `--input2` (the character), `--input3` (the product); `--outfit` replaces the place. With `effect` or `motion` in the run, those animate the composed photo |
| `effect` | Wan 2.1 I2V and an effect LoRA | `--input`; `--effect squish,explode` (default every effect) |
| `hook-edit` | Qwen-Image-Edit-2511 | `--input`, `--hook ID` (default `iris-dive`), `--input2` for a two-reference hook (the outfit of `wardrobe-swap`) |
| `transition` | Wan 2.2 FLF2V | `--input` and `--end`; without `--end`, the hook's edit runs first and its output is the end frame |
| `voice` | Chatterbox Multilingual V3 | `--language en\|fr` (default `en`), `--voice` (a consented sample, mono FLAC) |
| `translate` | Gemma 4 E4B, then Chatterbox | `--audio`; `--to` (default `fr`: `en`, `fr`, `es`, `de`, `it`, `pt`, `ja` or `zh`). With `avatar` in the run, the avatar speaks the translation |
| `avatar` | Wan 2.2 S2V | `--input`; `--audio`, or else the voice job runs first and the avatar speaks its output |
| `music` | ACE-Step 1.5 | `--duration` (default 10 s) |
| `upscale` | SeedVR2 3B, RIFE | `--clip`; `--smooth` (RIFE frames in between, twice the frame rate) |
| `upscale-image` | SeedVR2 3B | `--input` |
| `voice-change` | Chatterbox VC | `--audio` (the speech) and `--voice` (the sample) |
| `transcribe` | Whisper large-v3 turbo | `--audio` (a clip or a sound that speaks, 60 s at most) |
| `motion` | Wan2.2-Animate-2 | `--input` and `--motion` (the reference video, 30 s at most) |
| `restyle-edit` | Qwen-Image-Edit-2511 | `--motion`: restyles the clip's first frame, which `restyle` then keeps |
| `restyle` | Wan 2.1 VACE 14B | `--motion`; run without `restyle-edit`, `--input` is a look to follow |
| `swap` | Wan 2.1 VACE 14B, SAM 2.1 | `--motion` and `--points "X,Y X,Y"` (fractions of the first frame); `--exclude`, and `--input` for the new object's photo |
| `remix-skeleton` | Gemma 4 E4B | `--motion` (the trend): Gemma reads the sheet of its shots' first frames and writes the post in `--language` |
| `remix` | Wan2.2-Animate-2 | `--input` and `--motion` (the trend, 60 s at most): each shot made again with the photo and the same seed, then put back on the trend's frames and cut to 9:16; `--cuts F,F` (default: FFmpeg's scene cuts), `--keep-sound` |

`--text [JOB=]TEXT` gives the edit instruction, the effects' subject, the words to say, the music description, the motion's description, the restyle's new look, the swap's new object or the remix's character to the one job of the run that reads a text; when several do, each text names its job (`--text edit=… --text music=…`). `--quality` drops the 4-step LoRAs of the edit, the effects and the transition. Preparing the clips and reading the speech's length need FFmpeg and ffprobe (`apt-get install -y ffmpeg`).

`npm run weights -w @montagio/infra-runpod -- --lock-from-hf` writes the lock patch (exact `resolve/main/…` URL, size, and the sha256 Hugging Face stores as the LFS object id) from Hugging Face's metadata alone, without downloading a byte of weights. In every mode, a lock entry whose pinned sha256 or size no longer matches what Hugging Face serves fails before any download.
