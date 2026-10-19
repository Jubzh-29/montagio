# Local installer

`montagio.sh` and `montagio.ps1`, at the root of the repository, check that Node.js 22.18 or newer is there and hand over to `src/cli.ts`. The guide for people who install Montagio is [docs/INSTALL.md](../../docs/INSTALL.md).

The code is TypeScript with no npm dependency: Node.js runs it as it is (type stripping), before `npm ci`. Only `node:` modules and relative `.ts` imports are allowed in `src/`; `test/purity.test.ts` checks it, and `tsconfig.src.json` (`erasableSyntaxOnly`) keeps the syntax strippable.

| File | What it does |
|---|---|
| `src/cli.ts` | Arguments and commands: `install`, `start`, `stop`, `status`, `help` |
| `src/pins.ts` | Versions from `infra/runpod/versions.env`, weights from `registry/models.lock.yaml` |
| `src/platform.ts` | Install folder per system, and the paths inside it |
| `src/exec.ts` | Running programs, always without a shell; finding npm, tsx and next |
| `src/probe.ts` | What the machine has: GPU, driver, Pythons, tools, disk, RAM, ports |
| `src/checks.ts` | Verdicts with their fix, choice of PyTorch and Python, full install or app alone |
| `src/state.ts` | `install-state.json`: mode, ports, GPU, one stamp per finished step, verified weights |
| `src/plan.ts` | The steps, whether each runs and why, and the disk they need |
| `src/install.ts` | Runs the plan, or prints it with `--dry-run` |
| `src/services.ts` | Start, stop and status of ComfyUI, comfy-api-proxy and the app |

Shared with `infra/runpod`: `versions.env` (pinned versions) and `fetch-weights.ts` (weight download with resume and sha256), called as they are.

```bash
npm test -w @montagio/infra-local
npm run typecheck -w @montagio/infra-local
node infra/local/src/cli.ts install --dry-run
```
