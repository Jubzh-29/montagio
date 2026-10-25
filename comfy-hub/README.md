# Montagio workflows for ComfyUI

The main Montagio pipelines as plain ComfyUI graphs: drag one onto the canvas, put the model files in place, run it. Each comes with build notes in the format of Comfy's example apps: the models and where they go, the node map, the time and VRAM measured on a 24 GB GPU, an example, the limits and the licenses. Nothing here needs a partner node, an API key or a weight under a license other than Apache-2.0 or MIT.

| | Workflow | What it makes | Time on an L4 (24 GB) |
|---|---|---|---|
| <img src="thumbnails/montagio-camera-presets-1.jpg" width="160" alt=""> | [Camera presets: two moves in one clip](montagio-camera-presets.md) | a photo and a camera preset → a 5 s clip; needs the [Montagio node pack](../comfy-nodes/README.md) | 1,110–1,170 s |
| <img src="thumbnails/montagio-one-photo-effect-1.jpg" width="160" alt=""> | [One-photo effect](montagio-one-photo-effect.md) | a photo → Squish, Cake-ify, Explode, Snap Zoom, Frozen Moment or Full Circle | 156 s |
| <img src="thumbnails/montagio-keyframe-hook-1.jpg" width="160" alt=""> | [Keyframe hook](montagio-keyframe-hook.md) | the edit makes the end frame, the video model gets there (Ignite) | 20–25 s, then 134–157 s |
| <img src="thumbnails/montagio-talking-avatar-1.jpg" width="160" alt=""> | [Talking avatar](montagio-talking-avatar.md) | a portrait and a speech → a talking clip | 127–145 s |
| <img src="thumbnails/montagio-motion-transfer-1.jpg" width="160" alt=""> | [Motion transfer](montagio-motion-transfer.md) | a character moves like a reference video | 391–415 s |
| <img src="thumbnails/montagio-hd-smooth-1.jpg" width="160" alt=""> | [HD 1080p with smooth motion](montagio-hd-smooth.md) | 480p at 16 fps → 1080p at 32 fps | 410 s |
| <img src="thumbnails/montagio-film-music-1.jpg" width="160" alt=""> | [Film music](montagio-film-music.md) | an instrumental track for a film | 9.5 s for 60 s |

An RTX 4090 is about twice as fast as the L4.

## What is in this folder

| Path | What |
|---|---|
| `workflows/*.json` | the graphs, in ComfyUI's own workflow format, each with a note that lists its model files |
| `*.md` | the build notes, one per graph |
| `graphs/*.jpg` | a picture of each graph |
| `thumbnails/*-1.jpg` | a frame of a real render (the graph itself for the music) |
| `index.json` | the same seven entries in the index format of ComfyUI's Template Browser (`name`, `title`, `description`, `tags`, `models`, `size`, `io`, `thumbnail`), plus the build notes of each |

The camera graph is also the example workflow of the node pack ([`comfy-nodes/example_workflows/`](../comfy-nodes/example_workflows)): ComfyUI lists it under Templates once the pack is installed.

## How they were made, and checked

- Each graph is a job of the Montagio app: the app's own compiler wrote it, with the example inputs, from the official [Comfy-Org workflow templates](https://github.com/Comfy-Org/workflow_templates) the app's workflows are converted from ([`workflows/README.md`](../workflows/README.md)). The keyframe hook joins the app's two jobs, the edit then the transition, into one graph.
- Each one passed ComfyUI's own validation (`POST /prompt`, no node error) on ComfyUI v0.41.0, as API JSON and again after it was turned into a graph and back. That check ran on a CPU install with empty model files: it proves the graph, not the render.
- The renders were made on an NVIDIA L4 (24 GB) by the app's compiled jobs: GPU session S2 on 2026-10-21 and the runs of 2026-10-22 and 2026-10-24. The graphs are those jobs node for node, with two differences: the hook runs its two jobs in one graph, and in the camera graph the preset node computes the values the app writes into the camera node itself (the pack's tests compare both). Every measure is in [`docs/BUILD_NOTES.md`](../docs/BUILD_NOTES.md).

The inputs the graphs name are files of this repository: the showcase's sample photos (`demo-assets/showcase/samples/`, made by Z-Image-Turbo, no real person) and gallery clips. `speech.flac` and `reference-dance.mp4` stand for files of your own.

## Publishing on the Comfy Hub

Publishing is up to the maintainer of the repository. The Hub lists a workflow with a title, a thumbnail and tags; the entries of `index.json` hold them for each graph, with the build notes to paste as its description.
