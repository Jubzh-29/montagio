# Build log

A dated record of how Montagio is built during the challenge window.

## 2026-10-17

- Repository created. Monorepo scaffold (npm workspaces, TypeScript, Vitest), licenses (AGPL-3.0 / Apache-2.0 / CC-BY-4.0), DCO contribution rules, CI.
- Preset format v0.1, model registry and weight lock, preset → ComfyUI workflow compiler.
- Library content: 3 provisional presets (Crash Push, Slow Push, Pan Left), 3 models (Wan 2.2 Fun Camera, Wan 2.2 5B, Z-Image Turbo).
- **Provisional:** `workflows/*.api.json` are hand-written templates and `registry/models.lock.yaml` holds repository-level URLs. Both are replaced after GPU session S1 by workflows exported from a running ComfyUI and by exact file URLs + sha256, with every license re-read at the source.
- Studio screen (monitor with viewfinder marks, camera-move glyphs, model picker with licenses, REC tally accent), open-stack page, EN/FR, demo mode end to end with Playwright.
- GPU session tooling (`infra/runpod/`): pod bootstrap (ComfyUI v0.41.0 with `--disable-partner-nodes`, comfy-api-proxy 0.1.6, pinned PyTorch and Node.js), weight downloader that resolves exact Hugging Face files, checks sha256 and proposes a lock patch, and an SDK smoke test with timing and VRAM. `check-open-stack` now scans `infra/` and catches the SDK's Router namespace (`comfy.models.*`). Session guide: `docs/S1_CHECKLIST.md`.
