# Workflows

ComfyUI workflows in the API format, one per model of `registry/models/`. The compiler (`packages/presets/src/compile.ts`) fills the inputs named by each model's `bindings` (image, prompt, seed, size, frames, fps, camera move) and leaves everything else as it is here.

They are converted from the official ComfyUI templates of [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates), MIT License, Copyright (c) 2023-present Comfy Org (full text in [LICENSE.workflow_templates](LICENSE.workflow_templates)), at commit `59a3b48bf369c5a15f29a1308bae3e279fa15505` (2026-10-18):

| Workflow | Template | Model |
|---|---|---|
| `wan22-fun-camera.api.json` | `templates/video_wan2_2_14B_fun_camera.json` | Wan 2.2 Fun Camera 14B (high and low noise) |
| `wan22-fun-camera-turbo.api.json` | `templates/video_wan2_2_14B_fun_camera.json`, its 4-step group | Wan 2.2 Fun Camera 14B with the 4-step LoRAs of lightx2v |
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
- the template's second group (4 steps, with the LightX2V LoRAs) is the Turbo workflow, `wan22-fun-camera-turbo.api.json` (below). Its own note says these LoRAs lose some of the motion.
- The template's negative prompt is the default Wan negative (Chinese text, node 99 of the template). The compiler replaces the negative with the preset's, so it is not kept here. GPU session S2 compares the two.

Wan 2.2 5B:
- the template ships `LoadImage` bypassed (text to video); here it is active and feeds `start_image` of `Wan22ImageToVideoLatent` (image to video);
- `ModelSamplingSD3` with shift 8, `KSampler` 20 steps, cfg 5, uni_pc/simple, 24 fps. The template renders at 1280×704. `Wan22ImageToVideoLatent` asks for multiples of 32 in its widget, while the app's 720p table gives 1280×720: GPU session S2 checks 720p on this model.

Z-Image-Turbo:
- the negative is `ConditioningZeroOut` of the positive, as in the template. At cfg 1 there is no negative prompt, so the model has no `negative` binding;
- `ModelSamplingAuraFlow` with shift 3, `KSampler` 8 steps, cfg 1, res_multistep/simple.

Wan 2.2 Fun Camera Turbo (2026-10-24), the template's 4-step group:
- `LoraLoaderModelOnly` 88 and 90 (the template's ids) put `wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise` at strength 1 on the high- and low-noise models, before `ModelSamplingSD3` (shift 8 on both, as in the group);
- two `KSamplerAdvanced`, 4 steps at cfg 1, euler/simple, split at step 2;
- every other node keeps the id it has in `wan22-fun-camera.api.json` (the template's 20-step group), so both models share their bindings, and the changes listed above for the 20-step workflow apply as well. The template measures 536 s at 20 steps and 71 s warm at 4 steps on an RTX 4090D (640×640).

## Combined camera moves

A preset with two moves needs the Montagio Camera Embedding node (`comfy-nodes/`, GPL-3.0). The compiler switches node 108 of the Fun Camera workflow from `WanCameraEmbedding` to `MontagioCameraEmbedding` and adds `camera_pose_2` and `combine`. A preset with one move keeps the core node.

## Extension workflows

The extensions decided on 2026-10-19 (image edit, one-photo effects, keyframe transitions, talking avatar, music, upscale) run their own workflows, described by `registry/extensions/*.yaml` and compiled by `packages/presets/src/{extensions,effects,transitions}.ts`. They come from the same templates repository and commit, with the same rules; the choices behind them are in `docs/EXTENSIONS_ANALYSE.md`.

| Workflow | Template | Model | Output |
|---|---|---|---|
| `ace-step15-music.api.json` | `templates/audio_ace_step_1_5_split.json` | ACE-Step 1.5 turbo (2B) | node 107, FLAC |
| `seedvr2-upscale.api.json` | `templates/utility_seedvr2_3b_int8_upscale_video.json`, then RIFE written for Montagio | SeedVR2 3B int8, RIFE 4.26 | node 76, MP4 |
| `qwen-image-edit-2511.api.json` | `templates/image_qwen_image_edit_2511.json` | Qwen-Image-Edit-2511 fp8mixed | node 9, PNG |
| `chatterbox-mtl-voice.api.json` | none (no official template: ComfyUI has no local text-to-speech node) | Chatterbox Multilingual V3 | node 3, FLAC |
| `chatterbox-vc.api.json` | none (no official template: ComfyUI has no local voice conversion node) | Chatterbox VC (S3Gen) | node 3, FLAC |
| `wan22-s2v-avatar.api.json` | `templates/video_wan2_2_14B_s2v.json` | Wan 2.2 S2V 14B fp8 | node 113, MP4 with the speech |
| `wan21-i2v-effect.api.json` | `templates/image_to_video_wan.json` | Wan 2.1 I2V 14B 480p fp8, an effect LoRA | node 56, MP4 |
| `wan22-flf2v-transition.api.json` | `templates/video_wan2_2_14B_flf2v.json` | Wan 2.2 I2V A14B fp8 (high and low noise) | node 61, MP4 |
| `wan-animate2-motion.api.json` | `templates/video_wan_animate2_distilled.json` | Wan2.2-Animate-2 distilled, int8 | node 246, MP4 |

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
- Smooth motion (2026-10-24), written for Montagio on three core nodes of v0.41.0: `FrameInterpolationModelLoader` (101) loads `rife_v4.26.safetensors`, the file `templates/utility_video_frame_interpolation.json` lists from `Comfy-Org/Frame-Interpolation`; `FrameInterpolate` (102) puts one RIFE frame between each two restored ones (multiplier 2, so 81 frames become 161); `ComfyMathExpression` (103, `a * 2` on the clip's frame rate, `values.a` = 74.2) gives `CreateVideo` twice the frame rate, so the length and the sound stay. RIFE runs after SeedVR2, on the 1080p frames, and the clip is encoded once. `compileUpscale` keeps these nodes with `smooth`, and otherwise removes them and gives `CreateVideo` the restored frames (59) at the clip's frame rate (74.2).

### qwen-image-edit-2511

- The template's subgraph is flattened with its inner ids. Its "Lightning" group becomes a `LoraLoaderModelOnly` (171, the 4-step LoRA of lightx2v) between the model and `ModelSamplingAuraFlow`, after a second one for a look (170: INFL8 by default, ACTION or fal's Multiple-Angles); a second `LoadImage` (42, `start2.png`) feeds `image2` of both encoders. `compileEdit` removes and rewires the nodes a job does not use, and sets the template's two settings: 4 steps at cfg 1 with Lightning (its default), 40 steps at cfg 4 without. The rest of the path: `ModelSamplingAuraFlow` shift 3.1, `CFGNorm` 1, euler/simple.
- `FluxKontextMultiReferenceLatentMethod` (147, 148) says `index_timestep_zero` on both encoders: the node has no default and would otherwise take `offset`, which is wrong for 2511.
- The negative encoder (149) keeps an empty prompt and the same image, as in the template; only the positive one (151) is bound.
- `FluxKontextImageScale` (160) is kept: it center-crops the photo to one of 17 sizes of about 1 megapixel (16:9 gives 1392×752), which is also the size of the edited PNG. Replacing it with `ImageScaleToTotalPixels` (no crop) is a GPU session S2 comparison.
- The text encoder file is the template's, but the lock downloads it from `Comfy-Org/Qwen-Image_ComfyUI` (Apache-2.0 card) instead of `Comfy-Org/HunyuanVideo_1.5_repackaged` (territory-restricted card): same file, same sha256. `SaveImage` writes `montagio/edit`.

### chatterbox-mtl-voice

- Written for Montagio: `ChatterboxMTLTTS` from `wildminder/ComfyUI-Chatterbox` (pinned at `4597af8f`, patched, installed by `infra/runpod/bootstrap.sh`), then the core `SaveAudioAdvanced` in FLAC, `montagio/voice`.
- The voice pack is the folder `models/tts/chatterbox/resembleai-mtl-v3` (`model_pack_name`), with `t3_mtl23ls_v3.safetensors`. `s3gen_v3.safetensors` is deliberately absent: the loader would prefer it, while the official V3 code pairs V3 with `s3gen`.
- No `audio_prompt`: the built-in voice speaks (no cloned voice, and none left in the node's cache). `crash_protection_template` is empty (by default a text under 21 characters is wrapped in "hmm"); the watermark is off (`resemble-perth` is not installed).
- The compiler writes `cfg_weight` 0 in French (the model card's advice when the voice is of another language) and 0.5 in English, removes square brackets (read as tags), and never sends seed 0 (random to this node).

### chatterbox-vc

- Written for Montagio: `ChatterboxVC` from the same pinned `wildminder/ComfyUI-Chatterbox` pack, between two core `LoadAudio` (node 1, the speech; node 4, the voice sample) and `SaveAudioAdvanced` in FLAC. The words and the delivery of the speech stay; only the voice changes, to the sample's.
- It reads the `resembleai-mtl-v3` pack folder. The node's classic loader builds the English TTS beside the converter, so the folder also holds `t3_cfg.safetensors` and `tokenizer.json` (2.1 GB, MIT, the same Resemble AI repository); the multilingual voice still picks its own T3 by name. It runs 10 flow steps with one refinement pass and cuts the speech into 30 s chunks at most (the app keeps 30 s). The watermark is off, as for the avatar's voice.
- The app asks for the speaker's consent on the sample, and the rights on a video sent here; the clip comes back with the AI mention.

### wan22-s2v-avatar

- The template's active "4 steps" path, flattened: its two "Video S2V Extend" subgraphs become nodes `79076`–`79078` and `85076`–`85078` (numeric ids for the template's `79:76`…), its bypassed third extension and its 20-step group are gone.
- Each chunk renders 77 frames and covers 5 s of audio: an extension reads the accumulated latent (`LatentConcat`), whose length sets its audio offset (`comfy_extras/nodes_wan.py:1018`). The compiler keeps 1, 2 or 3 chunks for the speech's length and rewires the first-frame fix (94, 95) to the last chunk kept.
- `ImageFromBatch` (96) drops the first 4 decoded frames, the alignment of the original Wan code; the template drops one frame per chunk, which leaves the picture 63 to 188 ms behind the speech. GPU session S2 compares.
- Size of the photo's aspect at 480p (832×480, 480×832 or 640×640) instead of the template's 640×640; 16 fps (S2V's own rate); the speech is muxed by `CreateVideo`.
- The 4-step LightX2V LoRA (107) is kept and is in the lock: without it, 15 s of speech take 50 to 80 minutes (20 steps, cfg 6). It is a text-to-video LoRA, not trained for S2V; S2 compares it with 20 steps. The negative (7) is Wan's default; at cfg 1 it is not used.

### wan21-i2v-effect

- Converted from `image_to_video_wan` (core nodes only) with its node ids. Two `LoraLoaderModelOnly` go between the model and `ModelSamplingSD3`: the effect LoRA (200, Squish by default; `compileEffect` writes the preset's) and the 4-step LoRA of lightx2v (201), which `compileEffect` removes for the 20-step path.
- `wan2.1_i2v_480p_14B_fp8_scaled` instead of the template's fp16 (32.8 GB). Shift 5 instead of 8, as the effect cards advise (flow shift 5); 4 steps at cfg 1 (euler) with lightx2v, 20 steps at cfg 6 (uni_pc, the template's) without. Size of the photo's aspect at 480p, 81 frames at 16 fps, instead of the template's 512×512 and 33 frames. The negative (7) is Wan's default; an effect preset may replace it. `SaveVideo` writes `montagio/effect`.

### wan22-flf2v-transition

- The template's 4-step group (LoRAs 91 and 92 on the high- and low-noise experts, shift 5, two `KSamplerAdvanced` split at step 2, cfg 1), switched on, with its node ids; the template ships it bypassed, behind the 20-step path. `compileTransition` takes that 20-step path when asked (LoRAs removed, shift 8, cfg 4, split at step 10).
- The template's 4-step group loads the end image into the start input and the reverse: fixed (68 is the start, 62 the end).
- Size of the photo's aspect at 480p instead of 640×640; 16 fps; `SaveVideo` writes `montagio/transition`.

### wan-animate2-motion

- The template's active subgraph, flattened with its inner ids (`672:587` becomes `587`), as one 81-frame window; its bypassed copy for chaining windows is left out (the v0.1 clip lasts 5 s at most, prepared at 16 fps by `prepareMotionClip`).
- The raw frames of the clip feed `WanAnimate2ToVideo.pose_video` (no pose extractor, no mask, no LoRA): 10 steps, cfg 1, lcm, shift 5, as the template.
- `VAELoader` (584) loads the lock's `wan_2.1_vae` instead of the template's `Wan2_1_VAE_bf16` (a copy of Kijai's file); `WanAnimate2Cache` (594) runs on the CPU instead of the GPU, as the template's note advises against VRAM spikes; `CreateVideo` (245) writes 16 fps without the reference clip's sound.
- The size follows the clip's aspect at 480p (bound on the clip's `ResizeImageMaskNode`, 600); the photo is cropped to it through `GetImageSize` (596).

## Bindings

| Model | image | prompt | negative | seed | width / height / frames | fps | camera_pose / camera_speed |
|---|---|---|---|---|---|---|---|
| `wan22-i2v-a14b-fun-camera` | 97.image | 107.text | 99.text | 102.noise_seed | 108.width / height / length | 105.fps | 108.camera_pose / speed |
| `wan22-i2v-a14b-fun-camera-turbo` | 97.image | 107.text | 99.text | 102.noise_seed | 108.width / height / length | 105.fps | 108.camera_pose / speed |
| `wan22-ti2v-5b` | 56.image | 6.text | 7.text | 3.seed | 55.width / height / length | 57.fps | (camera in the prompt) |
| `z-image-turbo` | | 27.text | | 3.seed | 13.width / height | | |

Extension models (a binding with several inputs gets the same value in each):

| Model | Bindings | Output |
|---|---|---|
| `ace-step15-music` | prompt 94.tags; duration_s 98.seconds + 94.duration; seed 3.seed + 94.seed; bpm 94.bpm | 107 (audio) |
| `seedvr2-upscale` | video 73.file; width / height 57.resize_type.width / 57.resize_type.height; seed 54.seed | 76 (video) |
| `qwen-image-edit-2511` | image 41.image; image2 42.image; prompt 151.prompt; seed 169.seed | 9 (image) |
| `chatterbox-mtl-voice` | text 2.text; language 2.language; seed 2.seed; cfg 2.cfg_weight | 3 (audio) |
| `chatterbox-vc` | audio 1.audio; voice 4.audio | 3 (audio) |
| `wan22-s2v-avatar` | image 52.image; audio 58.audio; prompt 6.text; seed 3.seed (+1, +2 on the extension samplers); width / height 93.width / 93.height; frames 96.length | 113 (video) |
| `wan21-i2v-effects` | image 52.image; prompt 6.text; negative 7.text; seed 3.seed; width / height / frames 50.width / height / length; lora 200.lora_name; lora_strength 200.strength_model | 56 (video) |
| `wan22-flf2v-transition` | image 68.image; end_image 62.image; prompt 6.text; negative 7.text; seed 57.noise_seed; width / height / frames 67.width / height / length | 61 (video) |
| `wan-animate2-motion` | image 189.image; video 240.file; prompt 582.text; motion_prompt 585.text; negative 581.text; seed 597.noise_seed; width / height 600.resize_type.width / height; frames 587.length | 246 (video) |
