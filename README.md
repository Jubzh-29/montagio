# Montagio

**Click like a one-click video app. Open the hood like ComfyUI.**

Montagio is an open-source studio for cinematic camera moves: drop a photo, pick a camera preset, get a clip. Every preset is an open, versioned file that compiles into a ComfyUI workflow you can inspect, remix and run anywhere.

The [ComfyUI node pack](comfy-nodes/README.md) loads the same preset files in a ComfyUI graph and in ComfyUI's App Mode.

> Status: **pre-alpha** — under active construction (October 2026).

## Online showcase

The demo link is a **static showcase** of the real Studio: pick a sample photo and a camera preset to play a clip pre-generated with Montagio on open weights, assemble a 2–3 shot film in your browser (FFmpeg compiled to WebAssembly), remix and check a preset, download its ComfyUI workflow. It renders nothing on a GPU, costs nothing to host and collects nothing. Build it with `npm run showcase:build -w @montagio/web`; how it is built, deployed and updated after a GPU session is in [docs/VITRINE.md](docs/VITRINE.md) (French).

## Principles

- **Open weights only.** The official distribution ships only models whose weights are licensed Apache-2.0 or MIT. No closed API, no partner node, no proprietary connector — and a CI check (`check-open-stack`) proves it on every commit.
- **Local first.** Runs on your own GPU (24 GB VRAM recommended) or on a GPU you rent. Nothing leaves your machine unless you decide so.
- **Presets are a format, not a lock-in.** Presets are YAML files under CC-BY-4.0; share them, fork them, load them in ComfyUI.

## Licenses

| Part | License |
|---|---|
| App and server (`apps/`, root) | AGPL-3.0-only |
| Libraries (`packages/*`, `tools/*`) | Apache-2.0 |
| GPU session tooling (`infra/*`) | Apache-2.0 |
| ComfyUI node pack (`comfy-nodes/`) | GPL-3.0-only |
| Preset library (`presets/`) | CC-BY-4.0 |

Model weights keep their own licenses (Apache-2.0 or MIT for everything the official distribution references) and are downloaded from their official repositories, never bundled.

## Contributing

Contributions are welcome under the Developer Certificate of Origin — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Context

Montagio is being built for the Comfy "Open Source Higgsfield" challenge (October 2026), using the Comfy SDK against a local ComfyUI. It is an independent community project, not affiliated with any company whose product it is compared to.
