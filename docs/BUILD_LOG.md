# Build log

A dated record of how Montagio is built during the challenge window.

## 2026-10-17

- Repository created. Monorepo scaffold (npm workspaces, TypeScript, Vitest), licenses (AGPL-3.0 / Apache-2.0 / CC-BY-4.0), DCO contribution rules, CI.
- Preset format v0.1, model registry and weight lock, preset → ComfyUI workflow compiler.
- Library content: 3 provisional presets (Crash Push, Slow Push, Pan Left), 3 models (Wan 2.2 Fun Camera, Wan 2.2 5B, Z-Image Turbo).
- **Provisional:** `workflows/*.api.json` are hand-written templates and `registry/models.lock.yaml` holds repository-level URLs. Both are replaced after GPU session S1 by workflows exported from a running ComfyUI and by exact file URLs + sha256, with every license re-read at the source.
- Studio screen (monitor with viewfinder marks, camera-move glyphs, model picker with licenses, REC tally accent), open-stack page, EN/FR, demo mode end to end with Playwright.
- Sequence package: FFmpeg helpers for the last frame, the montage and the 9:16 cut.
- Sequences API: 2-3 shots chained from each shot's last frame (poll-driven state machine, resumable montage), 16:9 film and 9:16 cut.
- Sequence mode in the Studio: pick 2-3 camera moves in order, watch shot-by-shot progress, download the 16:9 film or the 9:16 cut.
- GPU session tooling (`infra/runpod/`): pod bootstrap (ComfyUI v0.41.0 with `--disable-partner-nodes`, comfy-api-proxy 0.1.6, pinned PyTorch and Node.js), weight downloader that resolves exact Hugging Face files, checks sha256 and proposes a lock patch, and an SDK smoke test with timing and VRAM. `check-open-stack` now scans `infra/` and catches the SDK's Router namespace (`comfy.models.*`). Session guide: `docs/S1_CHECKLIST.md`.
- ComfyUI node pack (`comfy-nodes/`, GPL-3.0-only): "Load Montagio Preset" and "Montagio Preset from YAML" turn a preset into the inputs of `WanCameraEmbedding`, `CLIPTextEncode` and `CreateVideo`. Tests run in CI and compare the pack with the app's own `parsePreset`/`compileJob`. Registry publishing is a manual workflow only; `PublisherId` and `Repository` are still TODO.
- Preset check on the command line: `npm run montagio -- preset validate <file|folder>` checks the schema, the models a preset names, the license of its LoRAs and a dry compile on its preferred and fallback models (`validatePreset`, also meant for the Studio remix).
- Twelve launch presets (spec §6): 9 drafts join Crash Push, Slow Push and Pan Left. Names and settings are provisional, chosen and tasted in GPU session S2; the combined moves and the tilts wait on session S1 (the core camera node takes one translation pose). The gallery follows the families of the spec with Crash Push first, and the Generate button stays in view however long the gallery gets.
