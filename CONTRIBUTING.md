# Contributing to Montagio

Thanks for helping! A few rules keep the project open for everyone, everywhere.

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "feat: my change"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line. There is no CLA: you keep the copyright on your contributions.

## Open-stack rule

- Only models whose weights are licensed **Apache-2.0 or MIT** may be referenced by the official registry.
- No closed API, no partner node, no proprietary connector in the code path.
- `npm run check:open-stack` must pass.

## Development

You need Node.js 22 or later and FFmpeg (with ffprobe) on your `PATH`, or `MONTAGIO_FFMPEG` / `MONTAGIO_FFPROBE` set to their full paths: the app tags every clip and assembles sequences with it, and refuses to render without it.

```bash
npm install
npm run typecheck
npm test
```
