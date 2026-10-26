---
title: Montagio
emoji: 🎬
colorFrom: gray
colorTo: green
sdk: static
app_file: index.html
pinned: false
license: agpl-3.0
short_description: Montagio, the open-source Higgsfield alternative
models:
  - Comfy-Org/Wan_2.2_ComfyUI_Repackaged
  - Comfy-Org/Wan_2.1_ComfyUI_repackaged
  - Comfy-Org/Qwen-Image-Edit_ComfyUI
  - Comfy-Org/z_image_turbo
  - Comfy-Org/SeedVR2
  - Remade-AI/Squish
  - Remade-AI/Cakeify
  - Remade-AI/Explode
  - Remade-AI/Crash-zoom-in
  - Remade-AI/matrix-shot
  - Remade-AI/360-Orbit
tags:
  - video-generation
  - comfyui
  - open-weights
---

# Montagio — online showcase

Montagio is an open-source AI video studio that runs on your own GPU, on open weights only: one photo becomes a viral effect, a camera move or a short film, and every preset compiles into a ComfyUI workflow you can open, remix and run yourself.

This Space is a **static showcase** of the Studio. It plays 43 clips pre-generated with Montagio on open-weights models, under Apache-2.0 or MIT, and restored to 1080p by Montagio's HD pass (SeedVR2):
- one-photo effects (Wan 2.1 I2V with Remade-AI effect LoRAs) and the Ignite hook (Qwen-Image-Edit-2511, then Wan 2.2 FLF2V);
- the 11 camera moves on three sample photos (Wan 2.2 Fun Camera), which the Film tab assembles into a 2–3 shot film in your browser with FFmpeg (ffmpeg.wasm).

Each clip comes with its ComfyUI workflow, and each camera clip with its recipe. The showcase renders nothing on a GPU, takes no upload and collects nothing: no account, no cookie, no analytics.

To animate your own photo, and for the avatar, the motion transfer, the restyle, the object swap, the characters, the ads and the trend remix, run Montagio on your machine or on a GPU you rent: the source code, the presets and the instructions are in the project repository, linked at the bottom of the showcase page.

Licenses: app AGPL-3.0, presets CC-BY-4.0, ffmpeg.wasm core GPL-2.0-or-later (served unmodified under `ffmpeg/`). Model weights keep their own licenses (Apache-2.0 or MIT).
