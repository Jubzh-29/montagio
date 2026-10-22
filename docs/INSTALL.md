# Run Montagio on your own machine

One command checks your machine, installs everything Montagio needs and opens it in your browser:

- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) v0.41.0, in its own Python environment, with a pinned CUDA build of PyTorch, started with `--disable-partner-nodes`;
- [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) 0.1.6 (MIT), which gives the app the Comfy API in front of that ComfyUI;
- the Montagio node pack (`comfy-nodes`), linked into ComfyUI;
- the open weights of [`registry/models.lock.yaml`](../registry/models.lock.yaml), about 70 GB, all Apache-2.0, each checked against its sha256;
- the Montagio app, built and served on `127.0.0.1`.

The install downloads from GitHub, PyPI, the PyTorch index, npm and Hugging Face. Once installed, Montagio runs on your machine: every service listens on `127.0.0.1` only, there is no account, no key and no paid API, and your images and clips never leave it.

If you just want to see Montagio, the demo link needs no install at all.

## Requirements

| | Needed |
|---|---|
| System | Windows 10 or 11 (x64), or Linux x64 (Ubuntu 22.04 or newer, other distributions should work) |
| GPU | NVIDIA with 24 GB of VRAM (RTX 3090, RTX 4090, L4, A10, A5000, …) |
| NVIDIA driver | R580 or newer (CUDA 13.0); R570 (CUDA 12.8) works with an older PyTorch |
| RAM | 32 GB or more recommended |
| Disk | about 110 GB free by default: 70 GB of weights for the camera presets, 21 GB for the effects pack, ComfyUI and PyTorch, the app; about 90 GB with `--extensions none`, about 200 GB with `--extensions all` |
| Node.js | 22.18 or newer |
| Python | 3.10 to 3.13, with `venv` (3.12 is preferred; 3.14 is not used yet) |
| git and FFmpeg | `git`, `ffmpeg` and `ffprobe` on the `PATH` |

Install what is missing:

| | Windows (winget) | Ubuntu / Debian |
|---|---|---|
| Node.js | `winget install OpenJS.NodeJS.LTS` | from [nodejs.org](https://nodejs.org), or `nvm install 22` |
| Python | `winget install Python.Python.3.12` | `sudo apt install python3.12-venv` |
| git | `winget install Git.Git` | `sudo apt install git` |
| FFmpeg | `winget install Gyan.FFmpeg` | `sudo apt install ffmpeg` |

Open a new terminal after installing, so that it sees the new programs.

You do not need to check all this by hand: the installer does, and prints the command that fixes whatever is missing.

## Install

Clone the repository (or unpack a release), go into its folder, then run one command.

Linux:

```bash
./montagio.sh install
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\montagio.ps1 install
```

`-ExecutionPolicy Bypass` applies to this one command only: Windows blocks scripts by default, and this lets the Montagio script run without changing any setting. If your policy already allows local scripts, `.\montagio.ps1 install` is enough.

To see what would happen first, add `--dry-run`: the installer checks the machine and prints every step with its exact commands, and changes nothing.

The first install takes a while. Most of it is the download of the weights: 64.9 GiB for the camera presets and 19.2 GiB for the effects pack, about 30 minutes at 50 MB/s. `--extensions all` adds the other extensions, about 87 GiB more. PyTorch is about 3 GB more. Then it starts ComfyUI, comfy-api-proxy and the app, and opens `http://127.0.0.1:3000`.

A download that stops (network, Ctrl+C, a closed window) resumes where it was: run the same command again.

### Below 24 GB of VRAM

The video models need a 24 GB card. On a smaller GPU, or without an NVIDIA GPU, the installer says so and offers the app alone (see [App only](#app-only)). `--ignore-vram` installs everything anyway, for people who want to try with `MONTAGIO_COMFYUI_ARGS=--lowvram`; renders may then fail for lack of memory.

## What gets installed, and where

Everything except the app goes into one folder:

| System | Default folder |
|---|---|
| Windows | `%LOCALAPPDATA%\Montagio` |
| Linux | `~/.local/share/montagio` (or `$XDG_DATA_HOME/montagio`) |

`--dir <folder>`, or the `MONTAGIO_HOME` variable, puts it elsewhere, for example on a bigger drive. Use the same `--dir` with `start`, `stop` and `status`.

| Inside the folder | What |
|---|---|
| `ComfyUI/` | ComfyUI v0.41.0 (commit `98cc0bf8`), checked after the clone |
| `ComfyUI/models/` | the weights |
| `ComfyUI/custom_nodes/montagio` | a link (a junction on Windows) to the repository's `comfy-nodes` |
| `venvs/comfyui/` | Python for ComfyUI, with PyTorch 2.14.1 (CUDA 13.0) or 2.11.0 (CUDA 12.8) |
| `venvs/comfy-api-proxy/` | Python for comfy-api-proxy |
| `logs/` | `comfyui.log`, `proxy.log`, `app.log`, and the download report |
| `install-state.json` | what was installed, the ports and the GPU |

The app stays in the repository folder (its dependencies in `node_modules/`, its build in `apps/web/.next/`). Your clips go to the repository's `data/` folder.

## Everyday use

| | Linux | Windows |
|---|---|---|
| Start, then open the browser | `./montagio.sh start` | `powershell -ExecutionPolicy Bypass -File .\montagio.ps1 start` |
| Stop | `./montagio.sh stop` | `… .\montagio.ps1 stop` |
| What runs, and where | `./montagio.sh status` | `… .\montagio.ps1 status` |

The services keep running when you close the terminal: stop them with `stop`. ComfyUI's own interface stays available at `http://127.0.0.1:8188`.

## Update

```bash
git pull
./montagio.sh install
```

Running `install` again only does what changed: a new ComfyUI or PyTorch version, a new weight in the lock, new npm dependencies, new app code. Running services are stopped first and started again at the end. A weight that leaves the lock stays on the disk; delete it from `ComfyUI/models/` if you need the space.

## App only

Without a 24 GB GPU, `install --app-only` installs the app alone: no ComfyUI, no PyTorch, no weights.

- By default the app runs in demo mode, with pre-rendered clips.
- With `--proxy-url <url>`, it renders on a GPU elsewhere, through that machine's comfy-api-proxy. For example, a rented GPU that runs Montagio, reached through an SSH tunnel:

  ```bash
  ssh -N -L 9189:127.0.0.1:8189 user@gpu-host     # in another terminal
  ./montagio.sh install --app-only --proxy-url http://127.0.0.1:9189
  ```

  The URL is kept: the next `install --app-only` uses it again. `install --app-only --demo` forgets it and goes back to demo mode.

## Options and environment

| Option | Meaning |
|---|---|
| `--dry-run` | check and print the plan, change nothing |
| `--app-only` | the app alone (see above) |
| `--proxy-url URL` | with `--app-only`: a remote comfy-api-proxy, kept for the next runs |
| `--demo` | with `--app-only`: forget a saved `--proxy-url`, run the demo mode |
| `--ignore-vram` | install on a GPU under 24 GB anyway |
| `--dir DIR` | install folder |
| `--comfy-port N`, `--proxy-port N`, `--app-port N` | ports (defaults 8188, 8189, 3000), kept for the next runs |
| `--no-start` | install without starting |
| `--no-browser` | `install` and `start`: do not open the browser |
| `--extensions LIST` | `install`: the extensions whose weights to fetch too: `all` (the seven), `validated` (those a GPU session validated: all seven since 2026-10-21), `none`, or a list such as `edit,transitions`, which must name what each one requires (see below). By default, the effects pack alone |

| Variable | Meaning |
|---|---|
| `MONTAGIO_HOME` | install folder |
| `MONTAGIO_EXTENSIONS` | the default of `--extensions`; the app reads it too |
| `MONTAGIO_COMFYUI_ARGS` | extra ComfyUI arguments, separated by spaces, for example `--lowvram`; `--listen` and `--port` are refused, ComfyUI stays on 127.0.0.1 and the install's port |
| `HF_TOKEN` | a Hugging Face token; not needed for the files of the lock |
| `MONTAGIO_FFMPEG`, `MONTAGIO_FFPROBE` | FFmpeg and ffprobe outside the `PATH` |

### Extensions

Seven extensions run models of their own, beyond the camera presets, in their order of priority: photo edit (Qwen-Image-Edit-2511, 4 steps with a Lightning LoRA, three looks and a second image), a pack of six one-photo effects (Wan 2.1 I2V 480p with effect LoRAs), keyframe transitions (Wan 2.2 FLF2V; the edit makes their end frame, so `transitions` requires `edit`), the talking avatar (Wan 2.2 S2V and a Chatterbox voice), film music (ACE-Step 1.5) HD upscale (SeedVR2) and, last, motion transfer (Wan2.2-Animate-2 distilled: the character of a photo moves like a short reference video). Their weights are in the lock, marked with their extension, and the installer fetches them only for the extensions asked for. By default that is the ones a GPU session validated, listed with a date in `registry/extensions.yaml` (GPU session S2 dated all seven on 2026-10-21). A plain install takes the **effects pack** alone, the most shareable one and among the lightest; `--extensions all` takes the seven, about 114 GB more (the avatar aside, see below), and `--extensions none` keeps the 70 GB of the camera presets. Extra disk space, all Apache-2.0 or MIT (the effect LoRAs declare it in their card metadata only):

| Extension | Weights |
|---|---|
| `edit` | 31.9 GB |
| `effects` | 20.6 GB |
| `transitions` | 31.0 GB |
| `avatar` | 23.6 GB |
| `music` | 10.0 GB |
| `upscale` | 4.0 GB |
| `motion` | 16.7 GB |

The avatar is left out by this installer for now: its voice runs on a custom node (pinned and patched) that only the GPU session's `infra/runpod/bootstrap.sh` installs. Details: [EXTENSIONS_ANALYSE.md](EXTENSIONS_ANALYSE.md) (in French).

A full install starts the app with the extensions whose weights it fetched, so the Studio shows only what this machine can run. With `--app-only` (the demo, or a remote GPU with `--proxy-url`), or when you start the app yourself, `MONTAGIO_EXTENSIONS` decides what the Studio shows. An effect or a hook also needs its own date in its preset file (`gpu_validated`), unless `MONTAGIO_EXTENSIONS=all`. `--extensions all` at install time fetches every weight but starts the app with that list, not with `all`: undated effects and hooks stay hidden until you start the app with `MONTAGIO_EXTENSIONS=all`.

What each shown extension adds to the Studio: `edit`, the Edit button of the start photo; `effects`, the Effects tab and its wall; `transitions`, the hooks on that wall; `avatar`, the Avatar tab; `music`, "Add music" under a finished film; `upscale`, "HD 1080p" under a finished clip of 121 frames at most. A workflow ComfyUI refuses (a missing node or file) hides its extension until the app restarts, and the log says which.

## Troubleshooting

| What you see | What to do |
|---|---|
| `port 8188 (ComfyUI) is already in use` | another ComfyUI, or another program, uses the port: stop it, or install with `--comfy-port 8288` (same for `--proxy-port` and `--app-port`) |
| `running scripts is disabled on this system` | start the script with `powershell -ExecutionPolicy Bypass -File .\montagio.ps1 …` |
| `no Python 3.10 to 3.13 found`, or `python` opens the Microsoft Store | install Python 3.12 (`winget install Python.Python.3.12`); in Settings → Apps → Advanced app settings → App execution aliases, turn off `python.exe` and `python3.exe` |
| `cannot make a venv` (Linux) | `sudo apt install python3.12-venv` |
| `the driver supports CUDA 12.x: PyTorch needs 12.8 or newer` | update the NVIDIA driver (R580 or newer) |
| `torch sees no CUDA device` | the driver is too old for the PyTorch build, or the GPU is busy elsewhere: update the driver, reboot, run `install` again |
| `partner nodes are loaded` | Montagio refuses to run a ComfyUI that loads partner (paid API) nodes. It always starts ComfyUI with `--disable-partner-nodes`; if you see this, check `MONTAGIO_COMFYUI_ARGS` and `logs/comfyui.log` |
| `the Montagio node pack did not load` | read its import error in `logs/comfyui.log`, then run `install` again (it relinks the pack) |
| a download stopped | run `install` again: it resumes |
| `sha256 mismatch` | a download did not give the bytes the lock pins: the partial file is deleted, run again; if it persists, the upstream file changed, report it. A weight the lock pins with a new sha256 after an update is not an error: `install` removes the old file and downloads the pinned one |
| `EPERM` during `npm ci` (Windows) | a program still uses `node_modules` (often a `next dev` you started): stop it, run again |
| `<folder>\ComfyUI exists and was not installed by Montagio` | `--dir` points to a folder with your own ComfyUI: choose an empty folder, Montagio never touches a ComfyUI it did not install |
| pip is very slow on Windows | an antivirus scans each of the many files PyTorch unpacks; it gets there, give it time |
| on Windows, `start` (or `install`) does not return when its output is piped or redirected (`\| Tee-Object`, a CI job) | the services inherit the pipe from PowerShell, so it stays open until `stop`. In a terminal the prompt comes back at once; in a script, install with `--no-start`, then run `start` without redirecting its output |
| `comfyui exited during startup with code …` | read the end of `logs/comfyui.log`: the error is there |

The logs of the three services are in `<install folder>/logs/`.

## Uninstall

1. Stop Montagio: `./montagio.sh stop` (or `… .\montagio.ps1 stop`).
2. Remove the link to the node pack first, so that nothing deletes the repository's `comfy-nodes` through it. On Windows: `cmd /c rmdir "%LOCALAPPDATA%\Montagio\ComfyUI\custom_nodes\montagio"` (`rmdir` without `/s` removes the junction only; Windows PowerShell 5.1's `Remove-Item -Recurse` may follow it into the repository). On Linux: `rm ~/.local/share/montagio/ComfyUI/custom_nodes/montagio`. Adapt the path if you installed with `--dir`.
3. Delete the install folder (see [where](#what-gets-installed-and-where)). It holds the weights: about 65 GiB for the camera presets, 84 GiB with the effects pack, about 170 GiB with every extension.
4. Delete the repository folder. Keep its `data/` folder first if you want your clips.

Nothing else is changed on your machine: no service, no setting, no file outside these two folders, apart from pip's and npm's download caches.

## Why not comfy-cli

[comfy-cli](https://github.com/Comfy-Org/comfy-cli) can install and launch ComfyUI. Montagio does not use it for the install (checked on 2026-10-18, comfy-cli 1.22.0 on PyPI):

- it depends on two telemetry SDKs (`mixpanel`, `posthog`), plus `uv`, `ruff`, `cookiecutter`, `gitpython` and `imageio-ffmpeg`, for a job that needs `git`, `venv` and `pip`;
- `comfy install` adds ComfyUI-Manager by default, which can fetch more nodes;
- it chooses PyTorch itself, while Montagio pins one build per CUDA version.

Its license, GPL-3.0, is not the issue. The repository uses comfy-cli only to publish the node pack to the Comfy Registry.

## Open-stack guarantees

- ComfyUI runs with `--disable-partner-nodes`. At each start, the installer reads `/object_info` and stops everything if a partner node is loaded.
- ComfyUI, comfy-api-proxy and the app listen on `127.0.0.1` only.
- The app talks to the local proxy through an explicit `COMFY_BASE_URL` (the Comfy SDK would otherwise target Comfy Cloud), and no `COMFY_API_KEY` reaches it.
- Weights come only from `registry/models.lock.yaml`; each file is checked against the sha256 the lock pins.
- `check-open-stack` runs on every install and writes the report behind the app's "open weights" badge.

## For contributors

The installer is `infra/local` (TypeScript run by Node.js without any npm package, so it works before `npm ci`). Its tests: `npm test -w @montagio/infra-local`. The GPU pod tooling it shares its pinned versions and weight downloader with is `infra/runpod`.
