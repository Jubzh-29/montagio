# Showcase assets

What the free demo link (the static "showcase", see [docs/VITRINE.md](../../docs/VITRINE.md)) shows:

- `manifest.yaml` lists the sample photos and the clips really rendered for them, each with its seed, its sha256 and the sha256 of the workflow that rendered it.
- `samples/` holds the sample photos.
- `clips/` holds the rendered clips, named `<preset>--<sample>.mp4`, re-encoded in the showcase encoding with the `AI-generated` MP4 mention.

Every preset × sample pair without a rendered clip gets a **placeholder** at build time: FFmpeg moves a window over the photo to imitate the camera move. Placeholders are never committed, carry the MP4 comment `Montagio showcase placeholder` (never `AI-generated`), and the showcase labels them on screen.

## Until GPU session S3

The three photos are placeholders too: Mandelbrot crops made with FFmpeg, textured so that a pan shows. They were made with:

```bash
ffmpeg -f lavfi -i "mandelbrot=size=1664x960:start_x=-0.7436447860:start_y=0.1318252536:start_scale=0.0005:end_scale=0.0005:maxiter=900:outer=normalized_iteration_count" -frames:v 1 -vf "gblur=sigma=2" -q:v 7 landscape-a.jpg
```

```bash
ffmpeg -f lavfi -i "mandelbrot=size=1664x960:start_x=-0.1011:start_y=0.9563:start_scale=0.02:end_scale=0.02:maxiter=600:outer=normalized_iteration_count" -frames:v 1 -vf "hue=h=140:s=1.2" -q:v 4 landscape-b.jpg
```

```bash
ffmpeg -f lavfi -i "mandelbrot=size=960x1664:start_x=-1.25066:start_y=0.02012:start_scale=0.0018:end_scale=0.0018:maxiter=800:outer=normalized_iteration_count" -frames:v 1 -vf "hue=h=260" -q:v 4 portrait-a.jpg
```

## In GPU session S3 (summary; the full procedure is in docs/VITRINE.md)

1. Generate the three photos with Z-Image-Turbo (Apache-2.0; SFW, no real person), save them under the same names (or new ids), and update `title`, `credit` (model, seed, prompt) and `status: final`.
2. For each photo: `npm run smoke -w @montagio/infra-runpod -- --preset all --image demo-assets/showcase/samples/<id>.jpg --out s3-results/<id>`.
3. On the pod, archive `s3-results/` and the photos; download the archive and check that it opens before stopping the pod (`s3-results/` is git-ignored).
4. On the PC, same commit: `npm run showcase -- ingest s3-results/<id> --sample <id>` (add `--pick <preset>=<run>` when a preset was rendered more than once).
5. `npm run showcase -- verify --strict`, then rebuild the showcase.
