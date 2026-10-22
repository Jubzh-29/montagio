# Demo assets

Files the `demo` backend (`MONTAGIO_BACKEND=demo`, no GPU) hands out instead of a render. None is a model output, except the sample photos below.

| File | What it is | Made with |
|---|---|---|
| `clips/<preset>.mp4`, `clips/_default.mp4` | the clip of a camera move or an effect | pre-rendered placeholders |
| `images/_default.png` | the image of a text-to-image or edit job | `ffmpeg -f lavfi -i "gradients=s=1280x720:c0=0x1d2b3a:c1=0x6b3a2a:x0=0:y0=0:x1=1280:y1=720:speed=0" -frames:v 1 _default.png` |
| `audio/_default.flac` | the sound of a music or voice job | `ffmpeg -f lavfi -i "sine=frequency=440:duration=5:sample_rate=24000" -ac 1 -c:a flac _default.flac` |
| `images/sample-16x9.png` | the sample photo of the Studio: a fishing harbour at golden hour, the showcase's `landscape-a` (the camera previews show it), 1280×720, tagged AI-generated | Z-Image-Turbo (Apache-2.0), seed 42, from the prompt in `showcase/manifest.yaml`; a fictional scene, no real person |
| `images/sample-subject.png`, `images/sample-portrait.png`, `images/sample-character.png` | the sample photos of the Effects, Avatar and Motion tabs: a golden retriever on a lawn, a woman's portrait, a cartoon boy at full length; tagged AI-generated | Z-Image-Turbo (Apache-2.0), the GPU session S2's test photos (`s2-inputs/animal.png`, `face.png`, `character.png`); fictional, no real person |
| `showcase/` | the static showcase's manifest, sample photos and clips | see `showcase/README.md` |

A file named after a preset or an effect (`images/<id>.png`, `audio/<id>.flac`) replaces the default for that job. `MONTAGIO_DEMO_CLIPS`, `MONTAGIO_DEMO_IMAGES` and `MONTAGIO_DEMO_AUDIO` point the backend elsewhere.
