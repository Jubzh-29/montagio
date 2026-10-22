---
title: Montagio
emoji: 🎬
colorFrom: gray
colorTo: green
sdk: static
app_file: index.html
pinned: false
license: agpl-3.0
short_description: Camera-move presets on open-weights video models
models:
  - Comfy-Org/Wan_2.2_ComfyUI_Repackaged
  - Comfy-Org/Wan_2.1_ComfyUI_repackaged
  - Comfy-Org/z_image_turbo
tags:
  - video-generation
  - comfyui
  - open-weights
---

# Montagio — online showcase

Montagio is an open-source studio for cinematic camera moves: a photo plus a camera preset give a clip, and every preset compiles into a ComfyUI workflow you can open, remix and run yourself.

This Space is a **static showcase**. Its clips were pre-generated with Montagio on open-weights models (Wan 2.2 Fun Camera, Apache-2.0); the films of the Sequence mode are assembled in your browser by FFmpeg (ffmpeg.wasm). It renders nothing on a GPU and collects nothing: no account, no cookie, no analytics.

To animate your own photo, run Montagio on your machine or on a GPU you rent: the source code, the presets and the instructions are in the project repository, linked at the bottom of the showcase page.

Licenses: app AGPL-3.0, presets CC-BY-4.0, ffmpeg.wasm core GPL-2.0-or-later (served unmodified under `ffmpeg/`). Model weights keep their own licenses (Apache-2.0 or MIT).
