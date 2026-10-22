# Demo assets

Files the `demo` backend (`MONTAGIO_BACKEND=demo`, no GPU) hands out instead of a render. None is a model output, except the sample photos and the examples below.

Before these files, the Studio tries two things (`apps/web/src/server/demo-render.ts`; `MONTAGIO_DEMO_RENDER=off` skips them, as the unit tests do):

1. a sample photo (byte for byte) with a preset GPU session S2 rendered on that photo gets that render: a camera move on the harbour (`presets/previews/`), Squish or Frozen Moment on the dog (`presets/effects/previews/`), the avatar on the portrait, the motion on the character with the sample dance (`examples/`). The caption says a GPU made the clip from the same sample photo;
2. any other photo, for a job that makes a video, is moved by FFmpeg along the preset (a slow push-in for an effect, a hook, an avatar or a motion), at 480p, kept under `data/demo-renders/` and tagged `Montagio demo render`, not AI-generated. The caption says FFmpeg moved it.

| File | What it is | Made with |
|---|---|---|
| `clips/<preset>.mp4`, `clips/_default.mp4` | the clip of a camera move or an effect | pre-rendered placeholders |
| `images/_default.png` | the image of a text-to-image or edit job | `ffmpeg -f lavfi -i "gradients=s=1280x720:c0=0x1d2b3a:c1=0x6b3a2a:x0=0:y0=0:x1=1280:y1=720:speed=0" -frames:v 1 _default.png` |
| `audio/_default.flac` | the sound of a music or voice job | `ffmpeg -f lavfi -i "sine=frequency=440:duration=5:sample_rate=24000" -ac 1 -c:a flac _default.flac` |
| `images/sample-16x9.png` | the sample photo of the Studio: a fishing harbour at golden hour, the showcase's `landscape-a` (the camera previews show it), 1280×720, tagged AI-generated | Z-Image-Turbo (Apache-2.0), seed 42, from the prompt in `showcase/manifest.yaml`; a fictional scene, no real person |
| `images/sample-subject.png`, `images/sample-portrait.png`, `images/sample-character.png` | the sample photos of the Effects, Avatar and Motion tabs: a golden retriever on a lawn, a woman's portrait, a cartoon boy at full length; tagged AI-generated | Z-Image-Turbo (Apache-2.0), the GPU session S2's test photos (`s2-inputs/animal.png`, `face.png`, `character.png`); fictional, no real person |
| `videos/sample-dance.mp4` | the sample reference clip of the Motion tab, copied as it is (already 5 s, 16 fps, silent, like an imported clip once prepared); with a photo nobody imported, no rights to confirm; tagged AI-generated | Wan 2.2 TI2V 5B (Apache-2.0) from a Z-Image-Turbo photo, the dance of GPU session S2 (`20261021-131540-motion/inputs/motion.mp4`); no real person |
| `examples/avatar.mp4`, `examples/motion.mp4` | the full renders of GPU session S2 behind the muted previews of the Avatar and Motion cards: the portrait saying "Hello, this is a test of the Montagio avatar." in its voice, and the character performing the sample dance; tagged AI-generated | Wan 2.2 S2V (Apache-2.0) with the voice of Chatterbox Multilingual V3 (MIT), and Wan2.2-Animate-2 distilled (Apache-2.0), S2 runs `20261021-124523-avatar` and `20261021-131540-motion`; no real person |
| `showcase/` | the static showcase's manifest, sample photos and clips | see `showcase/README.md` |

A file named after a preset or an effect (`images/<id>.png`, `audio/<id>.flac`) replaces the default for that job. `MONTAGIO_DEMO_CLIPS`, `MONTAGIO_DEMO_IMAGES` and `MONTAGIO_DEMO_AUDIO` point the backend elsewhere.
