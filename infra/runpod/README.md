# GPU session tooling (Runpod)

Scripts that turn a rented GPU pod (RTX 4090, 24 GB) into a Montagio backend: ComfyUI started with `--disable-partner-nodes`, the [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) (MIT) in front of it, the open weights of `registry/models.lock.yaml`, and a smoke test that goes through the Comfy SDK. The step-by-step session guide is [docs/S1_CHECKLIST.md](../../docs/S1_CHECKLIST.md) (in French).

| File | What it does |
|---|---|
| `bootstrap.sh` | Installs ComfyUI (pinned tag, commit verified), PyTorch, comfy-api-proxy and Node.js 22 under `/workspace`; starts ComfyUI on `:8188` and the proxy on `127.0.0.1:8189`; fails if any partner node is loaded. Subcommands: `install`, `start`, `stop`, `status`, `collect`. |
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
- Weights come only from `registry/models.lock.yaml`. Files fetched with `--extra` (evaluation of a candidate whose license is still being read) are hashed and reported but never added to the lock patch.

Without a GPU, `npm run smoke -w @montagio/infra-runpod -- --dry-run` and `npm run weights -w @montagio/infra-runpod -- --dry-run` show what a session would run and download.

`npm run weights -w @montagio/infra-runpod -- --lock-from-hf` writes the lock patch (exact `resolve/main/…` URL, size, and the sha256 Hugging Face stores as the LFS object id) from Hugging Face's metadata alone, without downloading a byte of weights. In every mode, a lock entry whose pinned sha256 or size no longer matches what Hugging Face serves fails before any download.
