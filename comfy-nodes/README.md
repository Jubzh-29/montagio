# Montagio nodes for ComfyUI

**Camera presets as files, and two camera moves in one clip, for Wan 2.2 Fun Camera. And the words of a speech with their timing, for captions.**

![The Montagio nodes in a Wan 2.2 Fun Camera graph: Load Montagio Preset feeds Montagio Camera Embedding, the prompts and the video size](docs/graph-pack.jpg)

The core `WanCameraEmbedding` node takes one camera move. This pack adds three camera nodes, and one for captions:

- **Montagio Camera Embedding** takes two moves, run **at once** (a crane that rises while it pushes in) or **one after the other** (push in, then hold; zoom in, then out). It is a drop-in for `WanCameraEmbedding`: same inputs, same outputs, and the same tensor when the second move is `Static` and `combine` is `together`.
- **Load Montagio Preset** turns a camera preset, a small YAML file, into everything the graph needs: the moves and their speed, the video size and frame count, the fps, the prompt and the negative prompt. Pick a preset in its menu instead of rewiring the graph.
- **Montagio Preset from YAML** does the same from a text field: paste a preset remixed in the Montagio app.
- **Montagio Transcribe Words** gives the words of a speech with the moment each one is said ([below](#montagio-transcribe-words)): the source of the app's word-by-word captions.

The preset files are the ones the [Montagio app](../README.md) renders, under CC-BY-4.0: the same file gives the same clip in the app and in a ComfyUI graph, and in ComfyUI's App Mode a whole graph becomes a preset menu, an image and a prompt. The 11 presets bundled here were rendered on a 24 GB GPU (an NVIDIA L4) on 2026-10-21, five of them with two moves.

In the app, each preset names the model it starts on (`models.preferred`). Seven start on the Turbo model, the same Fun Camera with the 4-step LoRAs of lightx2v: Crash Push, Slow Push, Pull Back Reveal, Crane Up, Pull Back & Tilt Up, Push & Settle and Breathing. The other four start on the 20-step Quality model: Pan Left, Pan Right and Drift Left Push, which share a side move, because in 4 steps a person doubled into a ghost on Pan Left; and Rise & Push, which lost its subject out of the frame. The nodes do not read this field: the graph sets the model.

The nodes use the V3 node API, so they need ComfyUI 0.41.0 or newer. The three camera nodes are light: they read a file and compute a camera path. On an NVIDIA L4, the 20-step graph of the example peaked at 18 to 21 GB of VRAM; the Turbo graph of the same model ran within 11.5 GiB, on an L4 held to that much free memory (2026-10-25). The 20-step graph has not been tried within 12 GB. Montagio Transcribe Words loads Whisper for its job and frees it after: 4.9 GB at most on the L4.

## Install

Once the pack is on the Comfy Registry, install it with the ComfyUI Manager (search "Montagio") or with `comfy node install montagio`. Until then, copy the `comfy-nodes` folder of this repository to `ComfyUI/custom_nodes/montagio` and restart ComfyUI. Its two dependencies, PyYAML and numpy, come with ComfyUI, as do `torch` and `transformers`, which Montagio Transcribe Words uses. The nodes appear in the `Montagio` category.

## Example workflow

The pack ships one example, [`example_workflows/montagio-camera-presets.json`](example_workflows/montagio-camera-presets.json). ComfyUI lists it under **Templates**, in the pack's own category, with its thumbnail. It is the Wan 2.2 Fun Camera 14B graph of the official template (20 steps), set to 832×480, with Load Montagio Preset on Rise & Push (two moves at once) feeding Montagio Camera Embedding, the two prompts and `CreateVideo`. A note in the graph lists the model files.

![The whole example graph, with its note](docs/graph-full.jpg)

| File | Put under `ComfyUI/models/` | License, source |
|---|---|---|
| `wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors` | `diffusion_models/` | Apache-2.0, [alibaba-pai/Wan2.2-Fun-A14B-Control-Camera](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera) |
| `wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors` | `diffusion_models/` | Apache-2.0, same |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders/` | Apache-2.0, [google/umt5-xxl](https://huggingface.co/google/umt5-xxl) |
| `wan_2.1_vae.safetensors` | `vae/` | Apache-2.0, [Wan-AI/Wan2.1-I2V-14B-480P](https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P) |

The files are Comfy-Org's repackagings in [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) and [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged); their exact URLs and sha256 are in the repository's [`registry/models.lock.yaml`](../registry/models.lock.yaml). On the L4, a 5 s clip at 480p took 1,110 to 1,170 s, with a peak of 18 to 21 GB of VRAM; an RTX 4090 is about twice as fast.

The pack ships no Turbo example. The app's Turbo model is the official template's 4-step group, in API format in the repository ([`workflows/wan22-fun-camera-turbo.api.json`](../workflows/wan22-fun-camera-turbo.api.json)): the same files plus `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` and `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` (Apache-2.0, [lightx2v/Wan2.2-Lightning](https://huggingface.co/lightx2v/Wan2.2-Lightning), 1.2 GB each, under `loras/`), 4 steps at cfg 1. On the L4 it took 156 s cold, then 136 to 138 s a clip, 8.3 times faster than 20 steps, with a little less fine detail.

Two rules from those renders:

- **Say what the photo shows.** Write it in the preset node's `prompt`, before the preset's own text. Without it, Fun Camera invents what it cannot see and the clip turns ghostly.
- **Push-ins, pull-backs and side moves work best.** Vertical moves and rolls barely show on Fun Camera, which is why the library has Crane Up (Pan Up at speed 2) and no tilt or Dutch preset.

Six other Montagio workflows (one-photo effect, keyframe hook, talking avatar, motion transfer, HD with smooth motion, film music), in the same format, are in [`comfy-hub/`](../comfy-hub/README.md). The app's captions workflow, Montagio Transcribe Words then the core Save Text, is [`workflows/whisper-words.api.json`](../workflows/whisper-words.api.json), in API format.

## Nodes

| Node | Id | Where the preset comes from |
|---|---|---|
| Load Montagio Preset | `MontagioLoadPreset` | the `preset` menu, which lists the `.yaml` and `.yml` files of the [preset folders](#preset-folders) |
| Montagio Preset from YAML | `MontagioPresetFromYAML` | the `yaml` text field: paste a preset, for example one remixed in the Montagio app (it starts with the text of Crash Push) |

Both nodes have the same other inputs and the same 13 outputs. A third node, [Montagio Camera Embedding](#montagio-camera-embedding), combines two camera moves. A fourth, [Montagio Transcribe Words](#montagio-transcribe-words) (`MontagioTranscribeWords`), takes no preset: it transcribes a speech.

### Inputs

| Input | Type | Default | Meaning |
|---|---|---|---|
| `preset` (Load node) | COMBO | first of the menu | the preset file |
| `yaml` (YAML node) | STRING, multiline | Crash Push | the preset text |
| `prompt` | STRING, multiline, optional | empty | the scene text; it goes before the preset's own prompt suffix |
| `aspect` | COMBO: `auto`, `16:9`, `9:16`, `1:1` | `auto` | `auto` picks the aspect from `image` (16:9 wide, 9:16 tall, 1:1 near square), or 16:9 when no image is connected |
| `image` | IMAGE, optional | none | only read to pick the aspect; the node has no image output |
| `resolution` | COMBO: `preset`, `480p`, `720p` | `preset` | `preset` keeps the resolution written in the file |
| `camera_mode` | COMBO: `parametric`, `prompt`, `combined` | `parametric` | `parametric`: one move, for the core `WanCameraEmbedding`; a preset with two moves is refused. `combined`: up to two moves, for [Montagio Camera Embedding](#montagio-camera-embedding). `prompt`: the moves in words, for a model without camera control. See [Wiring](#wiring) and [Differences with the Montagio app](#differences-with-the-montagio-app) |

### Outputs

In this order:

| Output | Type | Value |
|---|---|---|
| `camera_pose` | COMBO | `parametric` and `combined`: the (first) move, spelled as `WanCameraEmbedding` spells it (for example `Zoom In`). `prompt`: `Static` |
| `speed` | FLOAT | `camera.speed` of the preset. `prompt`: 1.0 |
| `width` | INT | from `aspect` and `resolution`, see the sizes below |
| `height` | INT | same |
| `length` | INT | number of frames, of the form 4n+1 as Wan models expect, for `duration_s` seconds at `fps` |
| `fps` | FLOAT | `defaults.fps` of the preset |
| `prompt` | STRING | your `prompt`, the preset's prompt suffix and, in `prompt` mode, the camera move in words; empty parts are left out and the rest is joined with ", " |
| `negative` | STRING | the preset's negative prompt |
| `duration_s` | INT | `defaults.duration_s` of the preset |
| `resolution` | STRING | `480p` or `720p` |
| `info` | STRING | name, id, author and license, for example `Crash Push (crash-push) — by montagio-community — CC-BY-4.0` |
| `camera_pose_2` | COMBO | `combined`, for a preset with two moves: the second move (for example `Zoom Out`). Otherwise `Static` |
| `combine` | COMBO | `combined`, for a preset with two moves: `together` or `then`, as the preset says. Otherwise `together` |

`camera_pose_2` and `combine` come last, after `info`, so a graph saved with the first 11 outputs keeps its links. `Static` and `together` mean "no second move": with them, Montagio Camera Embedding computes what `WanCameraEmbedding` computes. A preset with one move gives them in every mode, even when it says `combine: then`.

Sizes, width x height: 480p is 832x480 (16:9), 480x832 (9:16) or 640x640 (1:1); 720p is 1280x720, 720x1280 or 960x960.

The node reads a preset with the same rules as the app, apart from a few rare YAML spellings (see [Differences with the Montagio app](#differences-with-the-montagio-app)). A preset the app refuses for its content, such as a value out of range or an unknown key, stops the run with an error that names the file and the field.

## Wiring

| Output | Goes to |
|---|---|
| `camera_pose`, `speed`, `width`, `height`, `length` | `parametric` mode: the inputs of the same names on the core `WanCameraEmbedding` node |
| `camera_pose`, `camera_pose_2`, `combine`, `speed`, `width`, `height`, `length` | `combined` mode: the inputs of the same names on [Montagio Camera Embedding](#montagio-camera-embedding) |
| `prompt` | the `text` of the `CLIPTextEncode` node for the positive prompt |
| `negative` | the `text` of the `CLIPTextEncode` node for the negative prompt |
| `fps` | the `fps` of the `CreateVideo` node |

`camera_pose`, `camera_pose_2` and `combine` are COMBO outputs, so they link straight into the combos of the same names. Connect your start image to the rest of the workflow as usual; the `image` input of the Montagio node is only there to pick the aspect.

To run every preset, those with two moves included, set `camera_mode` to `combined` and use Montagio Camera Embedding in place of `WanCameraEmbedding`: its other links (`camera_embedding` to `WanCameraImageToVideo`, and `width`, `height`, `length`) stay the same. Do not set `combined` on a graph that keeps the core `WanCameraEmbedding`: it has no second move, so it would run the first one alone, without an error. In `parametric` mode the node refuses a preset with two moves for that reason.

`duration_s`, `resolution` and `info` are for your own use, for example to name the saved file or to keep the credit with the clip.

## Montagio Camera Embedding

`MontagioCameraEmbedding` is the core `WanCameraEmbedding` node with a second move. It takes the same inputs, with the same names and bounds, plus two more:

| Input | Type | Default | Meaning |
|---|---|---|---|
| `camera_pose_2` | COMBO, the 9 poses of `WanCameraEmbedding` | `Static` | the second move |
| `combine` | COMBO: `together`, `then` | `together` | `together`: both moves at once, over the whole clip (their vectors add up). `then`: the first move over the first half of the clip, then the second one from where the first ended |

Its outputs are the core node's: `camera_embedding`, `width`, `height`, `length`. It therefore takes the place of `WanCameraEmbedding` in a Wan 2.2 Fun Camera workflow without any link changing: its `camera_embedding` goes to `camera_conditions` of `WanCameraImageToVideo`, and `width`, `height` and `length` go to the inputs of the same names.

With `camera_pose_2` set to `Static` and `combine` set to `together`, it computes exactly what `WanCameraEmbedding` computes (a test compares both tensors on a ComfyUI install). `then` with `Static` second gives a move that stops halfway; `Zoom In` then `Zoom Out` breathes in and out. `length` must be of the form 4n+1 (1, 5, …, 81), as the core node assumes; any other length is refused with a message.

The node builds the camera path itself, and the Plücker embedding comes from ComfyUI's own `process_pose_params` (`comfy_extras/nodes_camera_trajectory.py`). It is written against ComfyUI v0.41.0. numpy, which it uses, comes with ComfyUI.

The preset nodes of this pack feed it in `camera_mode` `combined` (see [Wiring](#wiring)): `camera_pose_2` and `combine` come from the preset, or are `Static` and `together` for a preset with one move.

The Montagio app sends this node only for presets that combine two moves. A preset with one move uses the core node, so it runs on a ComfyUI that does not have this pack.

## Montagio Transcribe Words

`MontagioTranscribeWords` runs Whisper on an `AUDIO` input and returns a JSON string (`words_json`, schema `montagio/words@1`):
- the language, detected or imposed;
- the duration and the text;
- Whisper's pieces of words, each with its `start` and `end` in seconds.

Wire it to the core **Save Text** node, format `json`, to get a file.

| Input | Type | Default | Meaning |
|---|---|---|---|
| `audio` | AUDIO | | the speech; resampled to 16 kHz mono if needed |
| `model` | COMBO, the folders of `models/whisper/` that hold a `config.json` | `whisper-large-v3-turbo` | a Hugging Face Whisper folder |
| `language` | COMBO: `auto` and Whisper's 100 language codes | `auto` | `auto` detects the language on the first 30 s |

The model loads for the job and is freed after it:
- fp16 on CUDA, fp32 elsewhere;
- read from its folder only, never downloaded.

It runs on `transformers`, which ComfyUI already needs: the pack adds no dependency. The Montagio app uses `openai/whisper-large-v3-turbo` (MIT, 1.6 GB), with the 11 files of its lock, in `models/whisper/whisper-large-v3-turbo/`. A ComfyUI without that folder offers no model, so it refuses the workflow, and the app then hides its captions. On an NVIDIA L4, 2.9 s of speech took 10.5 s, the model's loading included, with a peak of 4.9 GB (2026-10-25); on a laptop CPU, 95.7 s.

## App Mode

App Mode needs ComfyUI frontend 1.41.13 or newer (ComfyUI v0.41.0 ships 1.55.17).

1. Wire the graph as above, with the `Load Montagio Preset` node feeding the camera, the text encoders and `CreateVideo`. For a menu where every preset works, the five with two moves included, set `camera_mode` to `combined` and feed Montagio Camera Embedding (its `camera_pose_2` and `combine` linked too). With the core `WanCameraEmbedding` and `parametric`, a preset with two moves picked in the app stops the run with an error that says so.
2. Open the App Builder. As app inputs, pick the `preset` widget of the Load node, plus the start image and the `prompt` widget of the Load node if you want them. Leave `camera_mode` out: it goes with the wiring.
3. As output, pick the save node.

Widgets that are fed by a link are hidden in the app panel. This is intended: the person who runs the app sees the preset menu, the image and the prompt, and nothing else.

## Preset folders

The `preset` menu lists three kinds of folders, in this order of priority:

1. The user folder, `ComfyUI/models/montagio_presets/`. The pack creates it on first load.
2. Folders added with `extra_model_paths.yaml`, under the key `montagio_presets`:

   ```yaml
   my_presets:
       base_path: /home/me/
       montagio_presets: montagio-presets/
   ```

3. The presets bundled with the pack (`presets/`), last.

When two folders hold a file with the same name, the first folder wins. A user file with the same name as a bundled preset replaces it in the menu: copy a bundled preset into the user folder and edit it to remix it.

Files in sub-folders are listed with their relative path, such as `mine/slow-push.yaml`. Folders whose name starts with a dot, such as `.git` and `.github` in a cloned repository, are skipped. A name that leads outside the preset folders, or into a dot folder, is refused.

Links (symbolic links, junctions) inside a preset folder that point outside it are not followed: the presets they lead to are not listed. To use presets kept elsewhere, add their folder with `extra_model_paths.yaml`, or link the whole `montagio_presets` folder.

A new file shows up in the menu when the frontend refreshes the node definitions, with no restart. An edit to a preset file is picked up on the next run when the `preset` menu of the Load node is used directly.

## Differences with the Montagio app

The node accepts the presets the app accepts, and its values are the app's own (tests compare both with the app's code), with these exceptions:

- **Model limits are not applied.** The app trims a job to what its model can render, such as the allowed fps and the maximum duration. The node does not know which model follows, so it outputs the preset's values as they are.
- **A preset with two camera moves is refused in `parametric` mode.** This mode feeds the core `WanCameraEmbedding`, which takes one move: the second one would be lost without a word. The error says so and suggests `camera_mode` `combined` with [Montagio Camera Embedding](#montagio-camera-embedding), or `camera_mode` `prompt`. The app has no such mode: it picks the camera node itself.
- **`prompt` mode gives a neutral camera.** For models without camera control, such as Wan 2.2 5B, `camera_pose` is `Static`, `speed` is 1.0, `camera_pose_2` is `Static` and `combine` is `together`, and the moves go into the `prompt` output as words. The node cannot see the graph, so it does not know whether `camera_pose` is linked: in this mode, do not link `camera_pose` if you want a driven camera.
- **Presets with LoRAs are refused**, as in the app. A clip that dropped the LoRA would not be what the preset promises.
- **A few rare YAML spellings with tabs.** A tab works as a separator, as in the app: after a colon, before a comment, at the end of a line, inside a value, or on a blank line. A tab used as indentation is refused, as in the app. Two spellings still differ: a tab right after a tag (`!!str<TAB>text`) or inside a `%YAML` directive line is refused by the node but accepted by the app, and a quoted text that goes on over lines indented with a tab alone is accepted by the node but refused by the app. Indent with spaces and a file reads the same in both. The other rare corners are listed at the top of `montagio_nodes/preset.py`.
- **Combined moves in the app.** For a preset with two moves, the app's compiler (`packages/presets/src/compile.ts`) turns the camera node of its workflow into Montagio Camera Embedding and fills `camera_pose_2` and `combine` (`together` by default, `then` when the preset says `combine: then`). `combined` mode outputs the same values, for you to link into that node. For a preset with one move, the app keeps the core node and sends no second move; `combined` mode gives `Static` and `together`, the same path on Montagio Camera Embedding.
- **Presets may say how two moves combine.** `camera.combine` is `together` (the default) or `then`. `static` can be one of two moves only with `then`: before a move it waits, after one it holds. Two opposite moves (`zoom_in` and `zoom_out`, `pan_left` and `pan_right`, `pan_up` and `pan_down`, `roll_ccw` and `roll_cw`) also need `then`: together they would cancel out to a still camera. In `prompt` mode the two moves are joined with ", then " instead of ", ".
- **Bundled presets with two moves.** Rise & Push, Drift Left Push, Pull Back & Tilt Up, Push & Settle and Breathing combine two moves. Run them with `camera_mode` `combined` and Montagio Camera Embedding (see [Wiring](#wiring)), or with `prompt` for a model without camera control. `parametric` mode refuses them (see above). The other six bundled presets have one move and give the same outputs in `parametric` and `combined`.

## Development

From the root of the Montagio repository:

```sh
npm ci                                              # once; the TypeScript parity tests need it
pip install -r comfy-nodes/requirements-dev.txt
npm run test:nodes                                  # python -m pytest comfy-nodes -q
```

The tests do not need ComfyUI or a GPU: a small fake of `comfy_api` stands in for it. The parity suite compares the Python reader and the Python outputs with the app's real `parsePreset` and `compileJob`, which it runs through a `tsx` bridge. Without the repository around the pack (a standalone checkout), these tests are skipped. `MONTAGIO_REQUIRE_TS_PARITY=1` turns a skip into a failure, which is how CI runs them.

Three tests of `tests/test_camera.py` run Montagio Camera Embedding beside the core `WanCameraEmbedding` in a real ComfyUI v0.41.0 and compare them: the same tensor for each single pose, the same shape for two moves, the same `CAMERA_DICT`. They are skipped unless `MONTAGIO_COMFYUI_DIR` names a ComfyUI checkout; its Python (with torch, a CPU build is enough) is `MONTAGIO_COMFYUI_PYTHON` or a `.venv` inside the checkout. Example on a GPU pod: `MONTAGIO_COMFYUI_DIR=/workspace/ComfyUI MONTAGIO_COMFYUI_PYTHON=/workspace/venvs/comfyui/bin/python npm run test:nodes`.

`presets/` holds copies of the repository's `presets/*.yaml` and `presets/*.yml`, because the Registry publishes only this folder. Refresh them with `python comfy-nodes/scripts/sync_presets.py` (add `--check` to only list the differences). A test fails when the copies differ from the originals.

## Publishing

Nothing is published automatically. `pyproject.toml` holds two placeholders, and the publish workflow refuses to run while either is left:

- `PublisherId = "YOUR-PUBLISHER-ID"` in `[tool.comfy]`;
- `OWNER` in the `Repository`, `Documentation` and `"Bug Tracker"` URLs of `[project.urls]` and in the `Icon` URL.

To publish:

1. Push the repository to GitHub, then replace `OWNER` with its account in `pyproject.toml`.
2. On [registry.comfy.org](https://registry.comfy.org), sign in, create a publisher and put its id in `PublisherId`. Create an API key for that publisher.
3. In the GitHub repository's settings, add the key as the secret `REGISTRY_ACCESS_TOKEN`.
4. From the Actions tab, run **Publish ComfyUI node pack** (`.github/workflows/publish-comfy-nodes.yml`, `workflow_dispatch` only). It checks the placeholders, then runs `comfy node publish` from the `comfy-nodes` folder with comfy-cli 1.22.0, telemetry off.

`.comfyignore` keeps `tests/`, `scripts/` and `requirements-dev.txt` out of the published folder; `example_workflows/`, the bundled presets and the images of this README go with it. Bump `version` (three-part semantic version) for each new release.

## Licenses

- The code of the pack is GPL-3.0-only (`LICENSE`).
- The bundled presets in `presets/` are CC-BY-4.0 (`presets/LICENSE`). CC-BY-4.0 asks for credit, and the `info` output carries it: preset name, id, author and license. Keep it with the clips you share.
