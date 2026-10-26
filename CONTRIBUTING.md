# Contributing to Montagio

Thanks for helping. A few rules keep the project open for everyone, everywhere.

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "feat: my change"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line. There is no CLA: you keep the copyright on your contributions.

The sign-off is asked for, but no workflow checks it: `.github/workflows/` holds `ci.yml` and the manual `publish-comfy-nodes.yml` only.

## Open-stack rule

- Only models whose weights are licensed **Apache-2.0 or MIT** may be referenced by the official registry.
- No closed API, no partner node, no proprietary connector in the code path.
- `npm run check:open-stack` must pass.

## Development

You need:

- **Node.js 22.23.4 or newer** (or 24.22.1 or newer, the LTS): the security release of 2026-10-20. The root `package.json` says `>=22`, `montagio.sh` and `montagio.ps1` refuse a Node.js older than 22.18, which cannot run the installer, and the installer refuses one without that security release, and `npm test` runs `montagio.sh help` when bash is available (`infra/local/test/entry.test.ts`).
- **FFmpeg with ffprobe** on your `PATH`, or `MONTAGIO_FFMPEG` / `MONTAGIO_FFPROBE` set to their full paths: the app tags every clip and assembles sequences with it, and refuses to render without it. Some tests (the MCP server's among them) call `ffmpeg` from the `PATH` to make their test files.
- **Python** for the node pack's tests: the pack needs 3.10 or newer, CI uses 3.12.

```bash
npm ci
npm run typecheck
npm run lint -w @montagio/web
npm test
```

### What CI runs

`.github/workflows/ci.yml` runs on every push and pull request, on `ubuntu-latest` with Node.js 22 and FFmpeg from apt. Run the same commands before you open a pull request.

Job `test`:

| Step | What it checks |
|---|---|
| `npm ci` | installs from `package-lock.json` |
| `npm run typecheck` | every workspace's `typecheck` (the web app runs `next typegen` first) |
| `npm run lint -w @montagio/web` | ESLint on the web app |
| `npm test` | every workspace's Vitest suite |
| `python -m pip install -r comfy-nodes/requirements-dev.txt`, then `npm run test:nodes` with `MONTAGIO_REQUIRE_TS_PARITY=1`, on Python 3.12 | the node pack's pytest suite (`python -m pytest comfy-nodes -q`). With the variable, the tests that compare the pack with the app's TypeScript code fail instead of being skipped when the monorepo, node or tsx is missing. |
| `npm run check:open-stack` | the open-stack rule; it writes `apps/web/public/open-stack-report.json`, which CI keeps as an artifact |
| `npm run showcase -- verify` | the showcase manifest, its sample photos and its rendered clips |

Job `e2e`, after `npx playwright install --with-deps chromium` in `apps/web`:

| Step | What it checks |
|---|---|
| `npm run e2e -w @montagio/web` | the Studio on the demo backend with every extension shown (port 3100), then the static showcase build (port 3101) |
| `npm run e2e:local -w @montagio/web` | the Studio on the local backend, against a fake comfy-api-proxy (`packages/comfy-adapter/scripts/fake-proxy.ts`, port 8190; the app on port 3101) |

The `e2e:local` spec (`apps/web/e2e-local/local.spec.ts`) still clicks a "Try with a sample photo" button and a "Sequence" button that the Studio no longer shows, so expect that step to fail until the spec is updated.

`npm run test:modal` (the Modal tooling's helpers, `python -m pytest infra/modal -q`, no `modal` package needed) is not run by CI.

### Other scripts

| Command | What it does |
|---|---|
| `npm run montagio -- preset validate <file or folder>` | checks camera preset YAML files |
| `npm run showcase -- verify \| ingest \| prepare` | the showcase's manifest and files (`packages/showcase/src/cli.ts` lists the options) |
| `npm run previews:posters` | makes the still image of each new preview clip under `presets/**/previews` (`--force` remakes them all) |
| `npm run mcp` | starts the MCP server on stdio ([packages/mcp](packages/mcp/README.md)) |
| `npm run reproduce -- <recipe> --photo <file>` | renders a recipe again on the running app |
| `npm run dev -w @montagio/web` | the app in development mode: the demo backend unless `MONTAGIO_BACKEND` is set, on `127.0.0.1` only (see [SECURITY.md](SECURITY.md)) |
| `npm run showcase:build -w @montagio/web` | builds the static showcase into `apps/web/out` |
| `python comfy-nodes/scripts/sync_presets.py` | copies `presets/` into the node pack after a preset changes; `test:nodes` fails while the copies differ |
| `./montagio.sh`, `montagio.ps1` | the installer: see [docs/INSTALL.md](docs/INSTALL.md) |

The Python tests find the monorepo by the root `package.json`'s `name`, `montagio`: keep that name, or `test:nodes` fails under `MONTAGIO_REQUIRE_TS_PARITY=1`.
