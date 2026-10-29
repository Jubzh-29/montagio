---
title: Montagio
emoji: 🎬
colorFrom: gray
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: agpl-3.0
short_description: Montagio, the open-source Higgsfield alternative
models:
  - Comfy-Org/Wan_2.2_ComfyUI_Repackaged
  - Comfy-Org/Wan_2.1_ComfyUI_repackaged
  - Comfy-Org/Wan-Animate-2
  - Comfy-Org/Qwen-Image-Edit_ComfyUI
  - Comfy-Org/z_image_turbo
  - Comfy-Org/SeedVR2
  - Comfy-Org/Depth-Anything-3
  - Comfy-Org/gemma-4
  - Kijai/sam2-safetensors
  - ResembleAI/chatterbox
  - openai/whisper-large-v3-turbo
  - Remade-AI/Squish
  - Remade-AI/Cakeify
  - Remade-AI/Explode
  - Remade-AI/Crash-zoom-in
  - Remade-AI/matrix-shot
  - Remade-AI/360-Orbit
tags:
  - video-generation
  - image-to-video
  - comfyui
  - open-weights
  - open-source
---

# Montagio — online showcase

Montagio is an open-source AI video studio that runs on your own GPU, on open weights only: one photo becomes a viral effect, a camera move or a short film, a talking avatar, or a trend remade with your character. Every preset compiles into a ComfyUI workflow you can open, remix and run yourself.

This Space is a **static showcase** of the Studio. Everything it plays was rendered beforehand by Montagio, on open-weights models under Apache-2.0 or MIT, then restored to 1080p by its HD pass (SeedVR2), except the captions, exported at 1080×1920 directly:
- 43 clips in the Studio: the 11 camera moves on three sample photos (Wan 2.2 Fun Camera), which the Film tab assembles into a 2–3 shot film in your browser with FFmpeg (ffmpeg.wasm); nine clips of the six one-photo effects (Wan 2.1 I2V with Remade-AI LoRAs); the Ignite hook (Qwen-Image-Edit-2511, then Wan 2.2 FLF2V);
- a page of examples for the functions that need an upload: a trend remix, a motion transfer, two restyles, an object swap, a talking avatar, its translation into Chinese and Spanish, and captions in English and Spanish, each with what it started from and the models that made it.

Each clip comes with its ComfyUI workflow, and each camera clip with its recipe. The showcase renders nothing on a GPU, takes no upload and collects nothing: no account, no cookie, no analytics.

To animate your own photo, run Montagio on your machine or on a GPU you rent: the source code, the presets and the instructions are in the project repository, linked at the bottom of the showcase page.

Licenses: app AGPL-3.0, presets CC-BY-4.0, ffmpeg.wasm core GPL-2.0-or-later (served unmodified under `ffmpeg/`). Model weights keep their own licenses (Apache-2.0 or MIT).
