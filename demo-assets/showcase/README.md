# Showcase assets

What the free demo link (the static "showcase", see [docs/VITRINE.md](../../docs/VITRINE.md)) shows:

- `manifest.yaml` lists the sample photos and the clips really rendered for them, each with its seed, its sha256 and the sha256 of the workflow that rendered it. A clip rendered from its own description of the photo or its own negative prompt keeps them (`description`, `negative`); a clip restored to 1080p by SeedVR2 records that pass under `hd` (the 480p clip it took, by name and sha256, and the pass's seed and workflow). `withheld` lists renders kept out of the showcase for what they show: ingest skips them.
- `samples/` holds the three sample photos: `landscape-a` (a fishing harbour at golden hour), `landscape-b` (a red convertible on a coastal road) and `portrait-a` (a yellow raincoat on a rainy night, 9:16). Z-Image-Turbo (Apache-2.0) made them from a text, with no real person; `manifest.yaml` keeps each one's seed, prompt and credit (`status: final`).
- `clips/` holds the rendered camera clips, named `<preset>--<sample>.mp4`, re-encoded in the showcase encoding with the `AI-generated` MP4 mention: the 11 presets on the 3 photos, 33 clips, rendered at 480p in 20 steps by Wan 2.2 Fun Camera. Since 2026-10-24 every clip, effect and hook is in 1080p (1920×1080, or 1080×1920 for the portrait), about 5 MB each.
- `effects/`, `hooks/` and `workflows/` hold the effect and hook examples and the workflow of each (camera clips get theirs compiled at build time): 9 effect examples (the six effects on `landscape-b`; Frozen Moment, Full Circle and Snap Zoom on `portrait-a`) and the Ignite hook on `landscape-b`. Cake-ify, Explode and Squish on `portrait-a` are under `withheld`, for what they show.

- `features/` holds the feature examples, the functions the showcase cannot run, each shown by a clip Montagio rendered on a GPU from the showcase's own pictures and clips (the examples page, `/examples`): the trend remix, Restyle, the object swap, the motion transfer, the talking avatar, its translations with lip-sync and its karaoke captions in 9:16. `features/<id>.mp4` is the clip, in 1080p at 32 fps after the HD pass with RIFE (a speaking clip keeps its sound, in AAC); `features/inputs/` holds what it started from (the photo, the reference clip as smoke.ts prepared it, the restyled first frame); `workflows/feature-<id>--<n>-<model>.json` the workflow of each job of its chain. The manifest's `features` section ties each one to its seed, its texts, its starting face, the example it was made from, and its HD pass.

Every preset × sample pair has a rendered clip, so the showcase has no placeholder today. A pair without one would get a **placeholder** at build time: FFmpeg moves a window over the photo to imitate the camera move. Placeholders are never committed, carry the MP4 comment `Montagio showcase placeholder` (never `AI-generated`), and the showcase labels them on screen; `verify --strict` counts one as an error.

## How the clips were rendered (GPU session S3, 2026-10-21; the full procedure is in docs/VITRINE.md, part 6)

1. The three photos were generated with Z-Image-Turbo (SFW, no real person) and saved under their ids, with `title`, `credit` (model, seed, prompt), `prompt` (the exact text) and `status: final` in the manifest.
2. For each photo: `npm run smoke -w @montagio/infra-runpod -- --preset all --image demo-assets/showcase/samples/<id>.jpg --prompt "<its prompt, or a description of the photo>" --out s3-results/<id>`. Without a description of the photo before the preset's text, the camera move turns ghostly (docs/S2_RESULTATS.md, part 3), and `ingest` skips the run; a description other than the photo's prompt (and a `--negative`) is kept in the clip's entry.
3. On the GPU machine, archive `s3-results/` and the photos; download the archive and check that it opens before stopping the machine (`s3-results/` is git-ignored).
4. On the PC, same commit: `npm run showcase -- ingest s3-results/<id> --sample <id>` (add `--pick <preset>=<run>` when a preset was rendered more than once). The effect and hook examples go through `npm run showcase -- ingest --examples <folder> --sample <id>`.
5. `npm run showcase -- verify --strict`, then rebuild the showcase.

On 2026-10-24, 15 of the 33 camera clips were rendered again at 480p, each from the exact sample photo with a description of its own and a targeted negative prompt, before the 1080p pass.

## The 1080p pass (2026-10-24; the full procedure is in docs/VITRINE.md, part 7)

1. Upscale each 480p clip with `smoke.ts --extension upscale --clip <clip>`: the showcase's own file, or the output of a new camera run.
2. Download the clips the runs loaded (`modal volume get montagio-results /inputs <dir>`): `smoke.jsonl` names each one without its sha256.
3. `npm run showcase -- ingest --hd <upscale results folder> --inputs <dir>/inputs --renders <camera results folder> ...`, one upscale folder per call. It traces each pass to a clip of the showcase or to a camera run of `--renders`, re-encodes the 1080p output and writes the `hd` pass into the entry.
4. `npm run showcase -- verify --strict`.
