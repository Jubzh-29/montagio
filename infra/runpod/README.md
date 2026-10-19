# GPU session tooling (Runpod)

Scripts that turn a rented GPU pod (RTX 4090, 24 GB) into a Montagio backend: ComfyUI started with `--disable-partner-nodes`, the [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) (MIT) in front of it, the open weights of `registry/models.lock.yaml`, and a smoke test that goes through the Comfy SDK. The step-by-step guide of GPU session S2, the first one, is [docs/S2_CHECKLIST.md](../../docs/S2_CHECKLIST.md) (in French); session S1 became an analysis without GPU, [docs/S1_ANALYSE.md](../../docs/S1_ANALYSE.md).

| File | What it does |
|---|---|
| `bootstrap.sh` | Installs ComfyUI (pinned tag, commit verified), PyTorch, comfy-api-proxy and Node.js 22 under `/workspace`; links the Montagio node pack (`comfy-nodes`) as `custom_nodes/montagio`; starts ComfyUI on `:8188` and the proxy on `127.0.0.1:8189`; fails if any partner node is loaded, and warns if `MontagioCameraEmbedding` or a core node it needs is missing. Subcommands: `install`, `start`, `stop`, `status`, `collect`. |
| `fetch-weights.ts` | Resolves the exact Hugging Face file of every lock entry (`resolve/main/…`), downloads it into ComfyUI's `models/` with resume, checks the sha256 Hugging Face publishes, and writes a lock patch to review. Licenses are never edited. |
| `smoke.ts` | Compiles presets with `@montagio/presets`, submits them through `@comfyorg/sdk` to the proxy, downloads the clips, and records wall time, execution time and peak VRAM in `s1-results/smoke.jsonl`. |
| `versions.env` | Every pinned version and checksum. |

```bash
bash infra/runpod/bootstrap.sh --expose-ui
source /workspace/montagio.env
npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models
npm run smoke -w @montagio/infra-runpod -- --runs 2
bash infra/runpod/bootstrap.sh collect
```

## Open-stack guarantees

- ComfyUI always runs with `--disable-partner-nodes`; `bootstrap.sh` reads `/object_info` and stops if a node is flagged `api_node` or comes from `comfy_api_nodes`.
- `@comfyorg/sdk` falls back to Comfy Cloud when `COMFY_BASE_URL` is blank. `smoke.ts` sets it explicitly (default `http://127.0.0.1:8189`), refuses every `comfy.org` / `comfy.app` host, drops any `COMFY_API_KEY`, and gives the SDK a `fetch` that refuses requests outside the proxy's origin. No Router method is used, and `check-open-stack` scans `infra/` for one.
- Weights come only from `registry/models.lock.yaml`, and `check-open-stack` checks the repository each of them is fetched from (`tools/check-open-stack/allowed-sources.yaml`: allowed mirrors and sources, refused repositories such as `Kijai/WanVideo_comfy`). Files fetched with `--extra` (evaluation of a candidate whose license is still being read) are hashed and reported but never added to the lock patch.
- The weights of the extensions (edit, effects, transitions, avatar, music, upscale) carry `extension:` in the lock. `fetch-weights` takes them all by default (`--extensions all`, what a GPU session needs); `--extensions none`, `validated` (the extensions dated in `registry/extensions.yaml`) or a list such as `edit,transitions` narrows it. A lock entry may also name its folder under `models/` (`folder: loras`, `folder: tts/chatterbox/<pack>`) when its URL does not end in `<folder>/<file>`.

Without a GPU, `npm run smoke -w @montagio/infra-runpod -- --dry-run` and `npm run weights -w @montagio/infra-runpod -- --dry-run` show what a session would run and download.

The extensions have their own smoke mode: `npm run smoke -w @montagio/infra-runpod -- --extension all --input <photo> --clip <clip.mp4> --language fr` runs the edit, every effect, a hook (its edit, then the transition to the edit's output), the voice and the avatar, the music and the upscale one after the other (or a comma list of `edit`, `effect`, `hook`, `voice`, `avatar`, `music`, `upscale`), each checked against the running ComfyUI's `/object_info` first, timed, with its peak VRAM, and its output downloaded into `s1-results/clips/`. `--effect squish,explode` picks effects, `--hook outfit-morph --input2 <outfit>` a hook and its second image, `--end <frame>` runs a transition alone, `--quality` drops the 4-step LoRAs, `--look infl8|action|angles` runs a look of the edit. Without `--audio`, the avatar speaks the voice job's output; `--text` gives the music description, the edit instruction, the effect's subject or the words to say. Reading the speech's length needs `ffprobe` (`apt-get install -y ffmpeg`). `bootstrap.sh` also installs the avatar's voice node, pinned and patched (see `versions.env`), last and without stopping on a failure, and starts ComfyUI offline for Hugging Face.

`npm run weights -w @montagio/infra-runpod -- --lock-from-hf` writes the lock patch (exact `resolve/main/…` URL, size, and the sha256 Hugging Face stores as the LFS object id) from Hugging Face's metadata alone, without downloading a byte of weights. In every mode, a lock entry whose pinned sha256 or size no longer matches what Hugging Face serves fails before any download.
