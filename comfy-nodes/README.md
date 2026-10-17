# Montagio nodes for ComfyUI

Two nodes that read a Montagio camera preset (a YAML file) and output the values ComfyUI's own nodes take: camera move and speed, size, frame count, fps, prompt and negative prompt. The same preset file drives a clip in the Montagio app and in a ComfyUI graph.

The nodes use the V3 node API, so they need ComfyUI 0.41.0 or newer.

## Install

The pack is not on the Comfy Registry yet (see [Publishing](#publishing)). For now, copy the `comfy-nodes` folder of this repository to `ComfyUI/custom_nodes/montagio` and restart ComfyUI. The only dependency is PyYAML, which ComfyUI already installs. The nodes appear in the `Montagio` category.

Once the pack is published, `comfy node install montagio` will install it.

No example workflow ships with the pack yet.

## Nodes

| Node | Id | Where the preset comes from |
|---|---|---|
| Load Montagio Preset | `MontagioLoadPreset` | the `preset` menu, which lists the `.yaml` and `.yml` files of the [preset folders](#preset-folders) |
| Montagio Preset from YAML | `MontagioPresetFromYAML` | the `yaml` text field: paste a preset, for example one remixed in the Montagio app (it starts with the text of Crash Push) |

Both nodes have the same other inputs and the same 11 outputs.

### Inputs

| Input | Type | Default | Meaning |
|---|---|---|---|
| `preset` (Load node) | COMBO | first of the menu | the preset file |
| `yaml` (YAML node) | STRING, multiline | Crash Push | the preset text |
| `prompt` | STRING, multiline, optional | empty | the scene text; it goes before the preset's own prompt suffix |
| `aspect` | COMBO: `auto`, `16:9`, `9:16`, `1:1` | `auto` | `auto` picks the aspect from `image` (16:9 wide, 9:16 tall, 1:1 near square), or 16:9 when no image is connected |
| `image` | IMAGE, optional | none | only read to pick the aspect; the node has no image output |
| `resolution` | COMBO: `preset`, `480p`, `720p` | `preset` | `preset` keeps the resolution written in the file |
| `camera_mode` | COMBO: `parametric`, `prompt` | `parametric` | see [Differences with the Montagio app](#differences-with-the-montagio-app) |

### Outputs

In this order:

| Output | Type | Value |
|---|---|---|
| `camera_pose` | COMBO | `parametric`: the move, spelled as `WanCameraEmbedding` spells it (for example `Zoom In`). `prompt`: `Static` |
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

Sizes, width x height: 480p is 832x480 (16:9), 480x832 (9:16) or 640x640 (1:1); 720p is 1280x720, 720x1280 or 960x960.

The node reads a preset with the same rules as the app, apart from a few rare YAML spellings (see [Differences with the Montagio app](#differences-with-the-montagio-app)). A preset the app refuses for its content, such as a value out of range or an unknown key, stops the run with an error that names the file and the field.

## Wiring

| Output | Goes to |
|---|---|
| `camera_pose`, `speed`, `width`, `height`, `length` | the inputs of the same names on the core `WanCameraEmbedding` node |
| `prompt` | the `text` of the `CLIPTextEncode` node for the positive prompt |
| `negative` | the `text` of the `CLIPTextEncode` node for the negative prompt |
| `fps` | the `fps` of the `CreateVideo` node |

`camera_pose` is a COMBO output, so it links straight into the `camera_pose` combo of `WanCameraEmbedding`. Connect your start image to the rest of the workflow as usual; the `image` input of the Montagio node is only there to pick the aspect.

`duration_s`, `resolution` and `info` are for your own use, for example to name the saved file or to keep the credit with the clip.

## App Mode

App Mode needs ComfyUI frontend 1.41.13 or newer (ComfyUI v0.41.0 ships 1.55.17).

1. Wire the graph as above, with the `Load Montagio Preset` node feeding the camera, the text encoders and `CreateVideo`.
2. Open the App Builder. As app inputs, pick the `preset` widget of the Load node, plus the start image and the `prompt` widget of the Load node if you want them.
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

Files in sub-folders are listed with their relative path, such as `mine/slow-push.yaml`. A name that leads outside the preset folders is refused.

A new file shows up in the menu when the frontend refreshes the node definitions, with no restart. An edit to a preset file is picked up on the next run when the `preset` menu of the Load node is used directly.

## Differences with the Montagio app

The node accepts the presets the app accepts, and its values are the app's own (tests compare both with the app's code), with these exceptions:

- **Model limits are not applied.** The app trims a job to what its model can render, such as the allowed fps and the maximum duration. The node does not know which model follows, so it outputs the preset's values as they are.
- **A preset with two camera moves is refused in `parametric` mode.** `WanCameraEmbedding` takes one move. The error says so and suggests `camera_mode` `prompt`. A node for combined moves is planned.
- **`prompt` mode gives a neutral camera.** For models without camera control, such as Wan 2.2 5B, `camera_pose` is `Static` and `speed` is 1.0, and the moves go into the `prompt` output as words. The node cannot see the graph, so it does not know whether `camera_pose` is linked: in this mode, do not link `camera_pose` if you want a driven camera.
- **Presets with LoRAs are refused**, as in the app. A clip that dropped the LoRA would not be what the preset promises.
- **A few rare YAML spellings with tabs.** A tab works as a separator, as in the app: after a colon, before a comment, at the end of a line, inside a value, or on a blank line. A tab used as indentation is refused, as in the app. Two spellings still differ: a tab right after a tag (`!!str<TAB>text`) or inside a `%YAML` directive line is refused by the node but accepted by the app, and a quoted text that goes on over lines indented with a tab alone is accepted by the node but refused by the app. Indent with spaces and a file reads the same in both. The other rare corners are listed at the top of `montagio_nodes/preset.py`.
- **Known gap on the app side.** The app's compiler (`packages/presets/src/compile.ts`) currently joins two moves as `Pan Up + Zoom In`, a value `WanCameraEmbedding` would reject. It is tracked separately and the node does not copy it.

## Development

From the root of the Montagio repository:

```sh
npm ci                                              # once; the TypeScript parity tests need it
pip install -r comfy-nodes/requirements-dev.txt
npm run test:nodes                                  # python -m pytest comfy-nodes -q
```

The tests do not need ComfyUI or a GPU: a small fake of `comfy_api` stands in for it. The parity suite compares the Python reader and the Python outputs with the app's real `parsePreset` and `compileJob`, which it runs through a `tsx` bridge. Without the repository around the pack (a standalone checkout), these tests are skipped. `MONTAGIO_REQUIRE_TS_PARITY=1` turns a skip into a failure, which is how CI runs them.

`presets/` holds copies of the repository's `presets/*.yaml`, because the Registry publishes only this folder. Refresh them with `python comfy-nodes/scripts/sync_presets.py` (add `--check` to only list the differences). A test fails when the copies differ from the originals.

## Publishing

`PublisherId` in the `[tool.comfy]` table and `Repository` in `[project.urls]` of `pyproject.toml` are marked TODO. Fill them in once the GitHub repository and the Registry publisher exist.

The workflow `.github/workflows/publish-comfy-nodes.yml` runs `comfy node publish` from the `comfy-nodes` folder. It starts only by hand (`workflow_dispatch`, from the Actions tab) and needs a Registry API key in the repository secret `REGISTRY_ACCESS_TOKEN`. `.comfyignore` keeps `tests/`, `scripts/` and `requirements-dev.txt` out of the published folder. Nothing is published automatically.

## Licenses

- The code of the pack is GPL-3.0-only (`LICENSE`).
- The bundled presets in `presets/` are CC-BY-4.0 (`presets/LICENSE`). CC-BY-4.0 asks for credit, and the `info` output carries it: preset name, id, author and license. Keep it with the clips you share.
