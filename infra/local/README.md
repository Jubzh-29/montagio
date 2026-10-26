# Local installer

`montagio.sh` and `montagio.ps1`, at the root of the repository, check that Node.js 22.18 or newer is there and hand over to `src/cli.ts`. `montagio.ps1` passes the arguments as JSON in `MONTAGIO_ARGV`, since Windows PowerShell 5.1 splits an argument that starts with `-` and holds a space. The guide for people who install Montagio is [docs/INSTALL.md](../../docs/INSTALL.md).

The code is TypeScript with no npm dependency: Node.js runs it as it is (type stripping), before `npm ci`. Only `node:` modules and relative `.ts` imports are allowed in `src/`; `test/purity.test.ts` checks it, and `tsconfig.src.json` (`erasableSyntaxOnly`) keeps the syntax strippable. The steps after the installer's own `npm-ci` step use `node_modules`: `tsx` runs the weight download and `check-open-stack`, `next` builds and serves the app.

| File | What it does |
|---|---|
| `src/cli.ts` | Arguments and commands: `install`, `start`, `stop`, `status`, `help` (also `--help`); an option a command does not take is refused |
| `src/pins.ts` | Versions from `infra/runpod/versions.env`, weights from `registry/models.lock.yaml`, extensions from `registry/extensions.yaml`, and which extensions an install fetches (the same rule as `@montagio/registry`) |
| `src/platform.ts` | Install folder per system, and the paths inside it |
| `src/exec.ts` | Running programs without a shell (a shell only for the last-resort `npm`); finding npm, tsx and next |
| `src/probe.ts` | What the machine has: GPU, driver, Pythons, tools, disk, RAM, ports |
| `src/checks.ts` | Verdicts with their fix, choice of PyTorch and Python, and the decision: full install, the 12 GB profile, or the app alone |
| `src/state.ts` | `install-state.json`: mode, ports, GPU, remote proxy URL, extensions asked for and fetched, memory profile, one stamp per finished step, verified weights |
| `src/plan.ts` | The steps, whether each runs and why, and the disk they need |
| `src/install.ts` | Runs the plan, or prints it with `--dry-run`; asks before the 12 GB profile or the app alone, when there is a terminal |
| `src/services.ts` | Start, stop and status of ComfyUI, comfy-api-proxy and the app, and the environment `start` gives the app |

The steps, in this order: `stop-services`, `npm-ci`, then for the full install `comfyui`, `comfyui-env`, `proxy`, `node-pack`, `extension-nodes` (the voice pack for `avatar`, the SAM 2 pack for `swap`) and `weights`, then in both modes `yt-dlp`, `open-stack`, `app-build`, `save-state` and `start`. A step runs when its stamp in `install-state.json` no longer matches what it would install. A node pack that fails leaves its extension out, with its weights, and the run goes on.

The next runs keep the ports, `--proxy-url` and the 12 GB profile (dropped when a GPU of 22 GiB or more is found, unless `--low-vram` is passed again). They keep `--extensions` too (`MONTAGIO_EXTENSIONS` when the command line has none), until another value or `--extensions default`, which goes back to the effects pack; `--ignore-vram` counts for the run it is given to only. `save-state` records the extensions asked for and those fetched; `start` passes them to the app as `MONTAGIO_EXTENSIONS`, with `MONTAGIO_VRAM_PROFILE=12gb` in the 12 GB profile.

Shared with `infra/runpod`, used as they are: `versions.env` (pinned versions), `fetch-weights.ts` (weight download with resume and sha256), `patches/comfyui-chatterbox-no-routes.patch` and `requirements-chatterbox.txt` (the avatar's voice pack). The `open-stack` step runs `tools/check-open-stack/src/cli.ts`.

```bash
npm test -w @montagio/infra-local
npm run typecheck -w @montagio/infra-local
node infra/local/src/cli.ts install --dry-run
```

`test/pins.test.ts` compares the readers of the lock and of the extensions with those of `@montagio/registry`. That package and `@montagio/presets` are development dependencies, for the tests only.
