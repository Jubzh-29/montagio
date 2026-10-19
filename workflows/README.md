# Workflows

ComfyUI workflows in the API format, one per model of `registry/models/`. The compiler (`packages/presets/src/compile.ts`) fills the inputs named by each model's `bindings` (image, prompt, seed, size, frames, fps, camera move) and leaves everything else as it is here.

They are converted from the official ComfyUI templates of [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates), MIT License, Copyright (c) 2023-present Comfy Org (full text in [LICENSE.workflow_templates](LICENSE.workflow_templates)), at commit `59a3b48bf369c5a15f29a1308bae3e279fa15505` (2026-10-18):

| Workflow | Template | Model |
|---|---|---|
| `wan22-fun-camera.api.json` | `templates/video_wan2_2_14B_fun_camera.json` | Wan 2.2 Fun Camera 14B (high and low noise) |
| `wan22-ti2v-5b.api.json` | `templates/video_wan2_2_5B_ti2v.json` | Wan 2.2 TI2V 5B |
| `z-image-turbo.api.json` | `templates/image_z_image_turbo.json` | Z-Image-Turbo |

## How they were converted

The node ids are the template's, so each node can be found in the template. The input names and the order of the widget values come from the `/object_info` of ComfyUI v0.41.0 (commit `98cc0bf8`):
- the values in `widgets_values` follow the widget inputs in `input_order` (required, then optional);
- a widget fed by a link keeps its slot, but the link wins;
- `control_after_generate` adds one value after a seed, and `image_upload` one after an image;
- a dynamic combo (the `format` of `SaveVideo`) is followed by the widgets of its selected option, written `format.codec`.

Only active nodes are kept: notes are left out, as are bypassed nodes. The Z-Image-Turbo template wraps its nodes in a subgraph, whose widgets are proxies of the inner nodes. The workflow keeps the inner nodes with their own ids and values.

Each workflow was then checked by `POST /prompt` on that ComfyUI v0.41.0, with empty model files named as in the lock. All three passed validation with no node error, and the run was interrupted before anything loaded. `infra/runpod/test/workflows.test.ts` repeats the check offline, on these files and on every preset compiled with them.

## Changes from the templates

All models:
- the prompt texts are empty (the compiler writes them);
- the seeds are 0;
- `LoadImage` loads `start.png`, a placeholder that the app replaces with the uploaded image;
- the size is 832×480 (the compiler writes the size of the job);
- `SaveVideo` writes `montagio/clip` as an MP4 in H.264 (`format` `mp4`, `format.codec` `h264`; the template has `auto` for both, which also gives an MP4). `SaveImage` writes `montagio/image`.

Wan 2.2 Fun Camera:
- only the 20-step group is kept: two `KSamplerAdvanced`, 10 steps on the high-noise model then 10 on the low-noise model, cfg 3.5, euler/simple, and `ModelSamplingSD3` with shift 8 on both models;
- the template's second group (4 steps, with the LightX2V LoRAs) is left out until GPU session S2 has checked that the camera move survives it (see `docs/S1_ANALYSE.md`). Its own note says these LoRAs lose some of the motion.
- The template's negative prompt is the default Wan negative (Chinese text, node 99 of the template). The compiler replaces the negative with the preset's, so it is not kept here. GPU session S2 compares the two.

Wan 2.2 5B:
- the template ships `LoadImage` bypassed (text to video); here it is active and feeds `start_image` of `Wan22ImageToVideoLatent` (image to video);
- `ModelSamplingSD3` with shift 8, `KSampler` 20 steps, cfg 5, uni_pc/simple, 24 fps. The template renders at 1280×704. `Wan22ImageToVideoLatent` asks for multiples of 32 in its widget, while the app's 720p table gives 1280×720: GPU session S2 checks 720p on this model.

Z-Image-Turbo:
- the negative is `ConditioningZeroOut` of the positive, as in the template. At cfg 1 there is no negative prompt, so the model has no `negative` binding;
- `ModelSamplingAuraFlow` with shift 3, `KSampler` 8 steps, cfg 1, res_multistep/simple.

## Combined camera moves

A preset with two moves needs the Montagio Camera Embedding node (`comfy-nodes/`, GPL-3.0). The compiler switches node 108 of the Fun Camera workflow from `WanCameraEmbedding` to `MontagioCameraEmbedding` and adds `camera_pose_2` and `combine`. A preset with one move keeps the core node.

## Extension workflows

The four extensions decided on 2026-10-19 (music, upscale, image edit, talking avatar) run their own workflows, described by `registry/extensions/*.yaml` and compiled by `packages/presets/src/extensions.ts`. They come from the same templates repository and commit, with the same rules; the choices behind them are in `docs/EXTENSIONS_ANALYSE.md`.

| Workflow | Template | Model | Output |
|---|---|---|---|
| `ace-step15-music.api.json` | `templates/audio_ace_step_1_5_split.json` | ACE-Step 1.5 turbo (2B) | node 107, FLAC |
| `seedvr2-upscale.api.json` | `templates/utility_seedvr2_3b_int8_upscale_video.json` | SeedVR2 3B int8 | node 76, MP4 |

### ace-step15-music

- The template was saved by ComfyUI 0.11.1. The six inputs of `TextEncodeAceStepAudio1.5` that v0.41.0 requires and the template lacks take their defaults: `generate_audio_codes` true, `cfg_scale` 2, `temperature` 0.85, `top_p` 0.9, `top_k` 0, `min_p` 0.
- `SaveAudioMP3`, deprecated in v0.41.0, becomes `SaveAudioAdvanced` writing FLAC (lossless for the mix), `montagio/music`.
- The template's two frontend primitives ("Song Duration", "seed") are gone: their values go to the inputs they fed, which is why `duration_s` and `seed` are each bound to two inputs.
- `lyrics` is `[Instrumental]`, as ACE-Step's documentation says for a track without vocals; the compiler also ends the description with "instrumental". `timesignature` 4, `language` en and `keyscale` E minor are the template's.
- Unchanged: shift 3 (`ModelSamplingAuraFlow`), 8 steps, cfg 1, euler/simple, negative = `ConditioningZeroOut` of the positive.

### seedvr2-upscale

- The template's subgraph is flattened with its inner ids; its notes, the trim nodes (79, 81) and the "Split Latent" switches (102, 103, 105) are gone.
- `ResizeImageMaskNode` 57: `scale by multiplier` 2 becomes `scale dimensions` to the 1080p size of the clip's aspect (bound), crop `center`, lanczos. SeedVR2 has no size input: it restores at the size it receives.
- The temporal chunking is wired in, in `manual` mode: chunks of 33 frames, overlap 3 (a real crossfade). Unchunked, 81 frames at 1080p need about 35 GiB; `auto` mode would cut by the free VRAM of the moment, so its seams would move from run to run.
- `SeedVR2PostProcessing` corrects colours with `lab` (the node's default) instead of the template's `none`; GPU session S2 compares `none`, `lab` and `wavelet`.
- `CreateVideo` takes the frame rate, the audio and the bit depth of the source clip (node 74), so a 16 fps clip stays 16 fps. `SaveVideo` writes `montagio/upscale`, MP4 in H.264. The seed is 0, one step, cfg 1, euler/simple, as in the template.

## Bindings

| Model | image | prompt | negative | seed | width / height / frames | fps | camera_pose / camera_speed |
|---|---|---|---|---|---|---|---|
| `wan22-i2v-a14b-fun-camera` | 97.image | 107.text | 99.text | 102.noise_seed | 108.width / height / length | 105.fps | 108.camera_pose / speed |
| `wan22-ti2v-5b` | 56.image | 6.text | 7.text | 3.seed | 55.width / height / length | 57.fps | (camera in the prompt) |
| `z-image-turbo` | | 27.text | | 3.seed | 13.width / height | | |

Extension models (a binding with several inputs gets the same value in each):

| Model | Bindings | Output |
|---|---|---|
| `ace-step15-music` | prompt 94.tags; duration_s 98.seconds + 94.duration; seed 3.seed + 94.seed; bpm 94.bpm | 107 (audio) |
| `seedvr2-upscale` | video 73.file; width / height 57.resize_type.width / 57.resize_type.height; seed 54.seed | 76 (video) |
