# Run Montagio on your own machine

One command checks your machine, installs everything Montagio needs and opens it in your browser:

- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) v0.41.0, in its own Python environment, with a pinned CUDA build of PyTorch, started with `--disable-partner-nodes --offline`;
- [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) 0.1.6 (MIT), which gives the app the Comfy API in front of that ComfyUI;
- the Montagio node pack (`comfy-nodes`), linked into ComfyUI;
- the open weights of [`registry/models.lock.yaml`](../registry/models.lock.yaml), each checked against its sha256: by default those of the camera presets (about 72 GB, all Apache-2.0) and of the effects pack (about 21 GB, Apache-2.0 and MIT), more with [`--extensions`](#extensions);
- yt-dlp 2026.10.21, checked against its sha256, for the trend remix's import by link;
- the Montagio app, built and served on `127.0.0.1`.

The install downloads from GitHub, PyPI, the PyTorch index, npm and Hugging Face. Once installed, Montagio runs on your machine: every service listens on `127.0.0.1` only, there is no account, no key and no paid API, and your images and clips never leave it (unless you render on a remote GPU with `--proxy-url`: they then go to that GPU). The app sends one kind of request outside your machine, and only when you ask for it: the trend remix's import by link, where yt-dlp fetches the video you pasted from TikTok, Instagram or YouTube.

If you just want to see Montagio, the showcase linked from the [README](../README.md) plays in your browser and needs no install.

## Requirements

| | Needed |
|---|---|
| System | Windows 10 or 11 (x64), or Linux x64 (Ubuntu 22.04 or newer, other distributions should work). macOS is refused, `--app-only` included. On an ARM64 machine, only `--app-only` installs |
| GPU | NVIDIA with 24 GB of VRAM (RTX 3090, RTX 4090, L4, A10, A5000, …); 12 to 20 GB for the [12 GB profile](#below-24-gb-of-vram-the-12-gb-profile) |
| NVIDIA driver | R580 or newer (CUDA 13.0); R570 (CUDA 12.8) works with an older PyTorch |
| RAM | 32 GB or more recommended |
| Disk | about 114 GB free by default: 72 GB of weights for the camera presets (their Turbo LoRAs included), 21 GB for the effects pack, ComfyUI and PyTorch, the app; about 93 GB with `--extensions none`, about 275 GB with `--extensions all`. These are the amounts the installer's own check asks for on a first install, with the install folder and the repository on one drive |
| Node.js | 22.23.4 or newer on the 22 line, 24.22.1 or newer on the 24 line (LTS), or 26.12.1 or newer: the security releases of 2026-10-20 and 21. Lines 23 and 25 no longer get security fixes and are refused |
| Python | full install only: 3.11 to 3.13, with `venv` (3.12 is preferred; 3.14 is not used yet; 3.10, out of support since 2026-10-01, is refused). On Windows, the avatar's voice needs 3.12 |
| git | full install only |
| FFmpeg | `ffmpeg` and `ffprobe` on the `PATH`, in both modes. Keep it up to date: 9.0.2 or 8.1.3, or the newest release of your branch (`winget upgrade Gyan.FFmpeg`); see [SECURITY.md](../SECURITY.md) |

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

Clone the repository, go into its folder, then run one command.

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

The first install takes a while. Most of it is the download of the weights: 67.2 GiB for the camera presets and 19.2 GiB for the effects pack, about 30 minutes at 50 MB/s. `--extensions all` adds the other extensions, about 149 GiB more. PyTorch is about 3 GB more. Then it starts ComfyUI, comfy-api-proxy and the app, and opens `http://127.0.0.1:3000`.

A download that stops (network, Ctrl+C, a closed window) resumes where it was: run the same command again.

### Below 24 GB of VRAM: the 12 GB profile

Every model runs on a 24 GB card. On a card of 12 to 20 GB (RTX 3060 12 GB, RTX 4070, RTX 4080…), the installer offers its **12 GB profile** instead of the app alone; `--low-vram` asks for it directly. The offer is a yes or no question: without a terminal (a script, a CI job) or with `--dry-run`, the installer stops there instead, so pass `--low-vram` (or `--app-only`) yourself.

The profile installs the same weights: ComfyUI v0.41.0 streams the part of an fp8 model that does not fit (its dynamic VRAM). `start` passes the profile to the app (`MONTAGIO_VRAM_PROFILE=12gb`), and the app offers only the models a GPU session ran on a GPU held to 12 GB, with the times measured there:

| What | 12 GB profile | 24 GB card |
|---|---|---|
| Camera moves and films, Turbo (4 steps) | about 2.5 min | about 1 min |
| Camera moves and films, Fast (Wan 2.2 5B) | about 3 min | about 1.5 min |
| Effects | about 3 min | about 1.5 min |
| Text to image | about 15 s | about 5 s |
| Camera moves, Quality (20 steps) | not offered | yes |
| The other extensions | not installed by default (see below) | yes |

By default, and with `--extensions validated`, the profile installs and shows only the extensions a GPU session ran within 12 GB: today, the effects pack. An explicit list (`--extensions all`, `--extensions edit,transitions`) is taken as it is: those extensions are installed and shown, although none of them was run on a GPU held to 12 GB. The camera models stay filtered either way.

The profile is kept for the next runs. It ends by itself when the installer finds a GPU of 22 GiB or more (a new card): every model comes back, unless you pass `--low-vram` again.

The times of the 12 GB profile were measured on 2026-10-25 on an NVIDIA L4 held to 11.5 GiB of free VRAM (the rest taken before ComfyUI started) and 32 GiB of RAM: a card in the class of an RTX 4070, as fast with 12 GB as with 24 (the weights stream between two steps, the computing is the same). A slower card, such as an RTX 3060, takes longer. Keep 32 GB of RAM: ComfyUI holds there the part of a model the card does not.

Under 12 GB, or without an NVIDIA GPU, the installer offers the app alone (see [App only](#app-only)). `--ignore-vram` installs anyway, for people who want to try; renders may then fail for lack of memory. It is not kept: pass it again with each `install`.

## What gets installed, and where

Everything except the app goes into one folder:

| System | Default folder |
|---|---|
| Windows | `%LOCALAPPDATA%\Montagio` |
| Linux | `~/.local/share/montagio` (or `$XDG_DATA_HOME/montagio`) |

`--dir <folder>`, or the `MONTAGIO_HOME` variable, puts it elsewhere, for example on a bigger drive. Use the same `--dir` with `start`, `stop` and `status`.

| Inside the folder | What |
|---|---|
| `ComfyUI/` | ComfyUI v0.41.0 (commit `98cc0bf8`), cloned into `ComfyUI.tmp/` first and renamed once its commit is checked |
| `ComfyUI/.montagio` | a marker that says this ComfyUI was installed by Montagio (it keeps the project's former name) |
| `ComfyUI/models/` | the weights |
| `ComfyUI/custom_nodes/montagio` | a link (a junction on Windows) to the repository's `comfy-nodes` |
| `ComfyUI/custom_nodes/ComfyUI-Chatterbox` | with `avatar`: the voice node pack, patched (see [Extensions](#extensions)) |
| `ComfyUI/custom_nodes/ComfyUI-segment-anything-2` | with `swap`: the SAM 2 node pack |
| `ComfyUI/.montagio-build/` | where a node pack is made before it moves into `custom_nodes/` whole |
| `venvs/comfyui/` | Python for ComfyUI, with PyTorch 2.14.1 (CUDA 13.0) or 2.11.0 (CUDA 12.8), and the voice pack's packages with `avatar` |
| `venvs/comfy-api-proxy/` | Python for comfy-api-proxy |
| `tools/yt-dlp` (`yt-dlp.exe` on Windows) | yt-dlp 2026.10.21 (Unlicense), the release binary checked by its sha256, for the trend remix's import by link; installed in both modes, handed to the app as `MONTAGIO_YTDLP` unless you set that variable |
| `logs/` | `comfyui.log`, `proxy.log`, `app.log`, and the download report `weights/weights-report.json` |
| `run/` | the pid file of each service started |
| `cache/` | `torch-constraints.txt`, which keeps pip from replacing the CUDA build of PyTorch |
| `install-state.json` | what was installed: the mode, the ports, the GPU, the remote proxy URL, the extensions asked for and those fetched, and the memory profile |

With `--app-only`, the folder holds only `tools/`, `logs/`, `run/` and `install-state.json`.

The app stays in the repository folder (its dependencies in `node_modules/`, its build in `apps/web/.next/`). Your clips go to the repository's `data/` folder, or to the folder the `MONTAGIO_DATA` variable names.

### An install made before the name Montagio

Montagio was first called Montagio. An install made under that name lives in `%LOCALAPPDATA%\Montagio` on Windows, or `~/.local/share/montagio` (or `$XDG_DATA_HOME/montagio`) on Linux, and its link to the node pack is `ComfyUI/custom_nodes/montagio`. The installer does not look there and moves nothing: a plain `install` makes a new install in the new folder, and downloads the weights again.

To keep using the old folder, remove its old link first, the way step 2 of [Uninstall](#uninstall) does: `cmd /c rmdir "%LOCALAPPDATA%\Montagio\ComfyUI\custom_nodes\montagio"` on Windows, `rm ~/.local/share/montagio/ComfyUI/custom_nodes/montagio` on Linux. Otherwise it stays beside the new `custom_nodes/montagio` link, and ComfyUI loads the node pack twice. Then give the folder to every command, for example `./montagio.sh install --dir ~/.local/share/montagio`, and the same `--dir` with `start`, `stop` and `status`. The installer recognises the folder as one it installed.

To remove the old install instead: stop it (`./montagio.sh stop --dir <old folder>`), remove the old link as above, then delete the folder.

## Everyday use

| | Linux | Windows |
|---|---|---|
| Start, then open the browser | `./montagio.sh start` | `powershell -ExecutionPolicy Bypass -File .\montagio.ps1 start` |
| Stop | `./montagio.sh stop` | `… .\montagio.ps1 stop` |
| What runs, and where | `./montagio.sh status` | `… .\montagio.ps1 status` |
| Every command and option | `./montagio.sh help` | `… .\montagio.ps1 help` |

The services keep running when you close the terminal: stop them with `stop`. ComfyUI's own interface stays available at `http://127.0.0.1:8188`.

`start` gives the app what the last `install` recorded: the extensions whose weights it fetched, the 12 GB profile, or the remote proxy of `--proxy-url`.

## Update

```bash
git pull
./montagio.sh install
```

Running `install` again only does what changed: a new ComfyUI or PyTorch version, a new weight in the lock, new npm dependencies, new app code. Running services are stopped first and started again at the end. A weight that leaves the lock stays on the disk; delete it from `ComfyUI/models/` if you need the space.

The next runs keep the ports, `--proxy-url`, `--low-vram` (until a GPU of 22 GiB or more, see above) and `--extensions`: an install made with `--extensions all` is updated with a plain `./montagio.sh install`, and `start` opens the Studio with every extension. The report's `Extensions:` line says which ones the run takes, and why. A `MONTAGIO_EXTENSIONS` set in your environment counts as `--extensions` when the command line has none, and is kept the same way. `--extensions default` forgets the choice and goes back to the effects pack alone: the weights and node packs of the other extensions stay on the disk, and the Studio hides them. A run with `--app-only` leaves the choice for the next full install. `--ignore-vram` is not kept: pass it again.

## Reproduce a recipe

Every result carries its recipe. It sits in the Recipe panel under the result, in the Studio and in History. The panel downloads it as JSON. A clip, a photo or a film Montagio exports holds a compact copy beside the `AI-generated` mention: the `synopsis` tag of an MP4, the `Montagio-Recipe` text chunk of a PNG. An ad, a film's music and a voice change keep theirs in the panel only. A recipe holds:

- the preset, or the remix YAML;
- the exact ComfyUI workflow of each step, and its sha256;
- the weight files it loads, with the lock's sha256, source and licence;
- the seed, the texts, the resolution, the steps, the frame rate, the HD and RIFE passes;
- the sha256 of each input file;
- the versions of Montagio, ComfyUI and the node packs.

It never holds the photo, nor a path of your machine.

To render a recipe again on this install, with Montagio started:

```bash
npm run reproduce -- montagio-recipe-camera-<id>.json --photo photo.jpg
```

The recipe can also be the exported clip (`.mp4`) or image (`.png`). The command sends the same request, with the same seed, to your local ComfyUI. It then says whether your photo has the sha256 the recipe noted, and whether the workflow made here has the recipe's sha256, step by step. Other input files go with `--input field=file` (`--input videoRef=dance.mp4`); `--out folder` saves the result. The command talks to the app at `MONTAGIO_URL` (`http://127.0.0.1:3000` by default).

A recipe never holds a consent or a right: the command says yes to none, and gives the app only what you pass.

| Option | What you state |
|---|---|
| `--consent` | the person in the photo is you, or agreed; the app refuses an imported photo without it (the sample photo and the images made in the app do not need it) |
| `--rights` | you hold the rights on the photo and the clip (a motion transfer, a restyle, an object swap, a trend remix) |
| `--voice-consent` | for an avatar in someone's own voice: that person agreed |
| `--face-consent` | for a trend remix with a photo: the person in it is you, agreed, or is fictional |

An agent does the same through the MCP server, with `get_recipe` and `reproduce` (see `packages/mcp/README.md`). In the Studio, Reproduce reopens the tab with the same choices and the same seed.

Same recipe, same stack: identical result on the same setup, very close elsewhere (diffusion is not always bit-exact from one graphics card to another). A recipe made by another version of Montagio may compile to another workflow; the command says so.

Without Montagio, `ffprobe -v error -show_entries format_tags=synopsis -of default=nw=1:nk=1 clip.mp4` prints a clip's recipe. The workflow of a full recipe loads in ComfyUI as it is: each input file reads `<imageRef>` (or the field it came from), so pick your own file in that node.

## App only

Without a GPU of 12 GB at least, `install --app-only` installs the app alone: no ComfyUI, no PyTorch, no weights. It needs Node.js and FFmpeg, not git nor Python, and it also installs on an ARM64 machine.

- By default the app runs in demo mode, and no model runs. A video job on a sample photo of the Studio gets the clip a GPU session rendered from that photo, when there is one for its preset. Any other photo is moved by FFmpeg along the preset's camera move (a slow push-in for an effect, a hook, an avatar or a motion), and the clip says that no model made it. The demo mode has no import by link.
- With `--proxy-url <url>`, it renders on a GPU elsewhere, through that machine's comfy-api-proxy. For example, a rented GPU that runs Montagio, reached through an SSH tunnel:

  ```bash
  ssh -N -L 9189:127.0.0.1:8189 user@gpu-host     # in another terminal
  ./montagio.sh install --app-only --proxy-url http://127.0.0.1:9189
  ```

  The URL is kept: the next `install --app-only` uses it again. `install --app-only --demo` forgets it and goes back to demo mode. The rented GPU's comfy-api-proxy has no token: keep the tunnel open for the time you render (see [SECURITY.md](../SECURITY.md)).

With `--app-only`, `start` sets no extension list: `MONTAGIO_EXTENSIONS` decides what the Studio shows (unset: every extension a GPU session validated), and `MONTAGIO_VRAM_PROFILE=12gb` gives the choices of the 12 GB profile, for a remote GPU of 12 GB.

## Options and environment

| Option | Meaning |
|---|---|
| `--dry-run` | check and print the plan, change nothing |
| `--app-only` | the app alone (see above) |
| `--proxy-url URL` | with `--app-only`: a remote comfy-api-proxy, kept for the next runs |
| `--demo` | with `--app-only`: forget a saved `--proxy-url`, run the demo mode |
| `--low-vram` | the 12 GB profile (see above), kept for the next runs until a GPU of 22 GiB or more is found |
| `--ignore-vram` | install on a GPU under 12 GB, or every model under 24 GB, anyway; not kept |
| `--dir DIR` | install folder |
| `--comfy-port N`, `--proxy-port N`, `--app-port N` | ports (defaults 8188, 8189, 3000), kept for the next runs |
| `--no-start` | install without starting |
| `--no-browser` | `install` and `start`: do not open the browser |
| `--extensions LIST` | `install`: the extensions whose weights to fetch too: `all` (the ten), `validated` (those a GPU session validated: all ten since 2026-10-25; in the 12 GB profile, the effects pack), `none`, a list such as `edit,transitions`, which must name what each one requires (see below), or `default`: the effects pack alone, as on a first install. Kept for the next runs, until another `--extensions` |

`help` (or `--help`) prints every command and option. An option a command does not take is refused, not ignored.

| Variable | Meaning |
|---|---|
| `MONTAGIO_HOME` | install folder (`--dir` wins over it) |
| `MONTAGIO_EXTENSIONS` | `install`: the default of `--extensions`, kept the same way. The app reads it too, but `start` on a full install replaces it with the list the install fetched: it decides what the Studio shows only with `--app-only`, or for an app you start yourself. There, `all` also shows the effects and hooks no GPU session dated |
| `MONTAGIO_VRAM_PROFILE` | the app's memory profile: `standard` (the default) or `12gb`. `start` sets `12gb` on an install in the 12 GB profile. The app reads an unknown value as `12gb` |
| `MONTAGIO_EXPERIMENTAL` | features no GPU session validated, shown anyway (comma list): `moodboard` (a picture that takes the colours and mood of reference pictures) and `palette-photo` (a palette taken from a photo). They are hidden because, on the GPU session of 2026-10-24, the photo edit did not carry a style over from a reference image |
| `MONTAGIO_COMFYUI_ARGS` | extra ComfyUI arguments, separated by spaces, for example `--reserve-vram 1` (ComfyUI v0.41.0's dynamic VRAM makes `--lowvram` a no-op); `--listen` and `--port` are refused, ComfyUI stays on 127.0.0.1 and the install's port. Read by `start` on a full install |
| `HF_TOKEN` | a Hugging Face token; not needed for the files of the lock |
| `MONTAGIO_FFMPEG`, `MONTAGIO_FFPROBE` | FFmpeg and ffprobe outside the `PATH`, for the installer's check and the app |
| `MONTAGIO_YTDLP` | another yt-dlp for the trend remix's import by link than the one the installer pins; without either, the link field says yt-dlp is missing and a file can still be sent |
| `MONTAGIO_ALLOWED_HOSTS` | other addresses the app answers at, comma list: `192.168.1.20:8080` (that port only), `studio.example` (any port); see [Open the app at another address](#open-the-app-at-another-address) |
| `MONTAGIO_DATA` | the folder of your clips and of the app's other files, instead of the repository's `data/` |
| `MONTAGIO_BACKEND` | for an app you start yourself: `demo` (the default) or `local`, which renders through the comfy-api-proxy at `COMFY_BASE_URL` (required with `local`). `start` sets them itself |
| `MONTAGIO_CONTENT_FILTER` | the explicit-term text filter is on by default. Exact lowercase `off` disables only that filter when `MONTAGIO_BACKEND=local`; it is ignored in demo. Name, consent, rights, host and file checks stay active |
| `MONTAGIO_URL` | `npm run reproduce` and the MCP server: the app's address, `http://127.0.0.1:3000` by default |

### Open the app at another address

The app's API and files (`/api`, `/media`) answer only a request for `localhost`, `127.0.0.1` or `[::1]` on the app's port (3000 by default). A page you have open on another site cannot use them. If that site points its domain at 127.0.0.1 (DNS rebinding), the request still names that domain, and the app refuses it with 403 `host-not-allowed`. A request whose `Origin` is another site, or another port, is refused the same way. A file, a form or plain text that another site sends is refused too: 403 `cross-site`, or 400 `missing-idempotency-key` on a route that starts a render.

The start script keeps the app on 127.0.0.1. To open it from another device, put a reverse proxy in front of it (Caddy, nginx, `tailscale serve`). Then list the address you type in the browser before `start`:

```bash
MONTAGIO_ALLOWED_HOSTS=studio.example,192.168.1.20:8080 ./montagio.sh start
```

On Windows, set `$env:MONTAGIO_ALLOWED_HOSTS = 'studio.example,192.168.1.20:8080'` in PowerShell first. A name with a port allows that port only; a name alone allows every port. A leading `http://` and a trailing `/` are ignored, so a pasted URL works. An SSH tunnel that keeps the port (`ssh -L 3000:127.0.0.1:3000 …`) needs nothing; a tunnel to another local port needs it listed (`localhost:9000`). The app's log names each refused address once.

### Extensions

Ten extensions add to the Studio, beyond the camera presets. Their weights are in the lock, marked with their extension, and the installer fetches them only for the extensions asked for:

- a first `install` takes the **effects pack** alone, the most shareable one and among the lightest, and so does `--extensions default`;
- `--extensions validated` takes those a GPU session validated, listed with a date in `registry/extensions.yaml`: all ten, dated from 2026-10-21 to 2026-10-25 (in the 12 GB profile, only those run within 12 GB: the effects pack);
- `--extensions all` takes the ten: about 253 GB of weights on disk with those of the camera presets (the avatar and the object swap with their node packs, see below);
- `--extensions none` keeps the 72 GB of the camera presets;
- a list such as `edit,transitions` takes those extensions, and must name what each one requires.

The choice is kept: the next `install` takes the same extensions until you pass another `--extensions` (see [Update](#update)).

In their order of priority, with their extra disk space, all Apache-2.0 or MIT (the effect LoRAs declare it in their card metadata only):

| Extension | What it adds to the Studio | Weights |
|---|---|---|
| `edit` | photo edit (Qwen-Image-Edit-2511, 4 steps with a Lightning LoRA, three looks and a second image): the Edit button of the start photo | 31.9 GB |
| `effects` | six one-photo effects (Wan 2.1 I2V 480p with effect LoRAs): the Effects tab and its wall | 20.6 GB |
| `transitions` | keyframe transitions (Wan 2.2 FLF2V): the hooks on the Effects wall. The edit makes their end frame, so `transitions` requires `edit` | 28.6 GB (its two 4-step LoRAs come with the camera presets) |
| `avatar` | the talking avatar (Wan 2.2 S2V and a Chatterbox voice): the Avatar tab; the Voice change and Translate pages (the translation by Gemma 4 E4B); "Captions 9:16" under a talking clip (Whisper) | 33.3 GB, of which 8.1 GB is Gemma 4 E4B and 1.6 GB Whisper large-v3 turbo (MIT, in `models/whisper/whisper-large-v3-turbo/`) |
| `music` | film music (ACE-Step 1.5): "Add music" under a finished film | 10.0 GB |
| `upscale` | HD (SeedVR2): "HD 1080p" under a finished clip of 121 frames at most, with an option that doubles the frame rate (RIFE), and "HD 2560 px" under a photo made in the app | 4.0 GB |
| `motion` | motion transfer (Wan2.2-Animate-2 distilled): the Motion tab, where the character of a photo moves like a short reference video, yours or one of the Motion library | 17.9 GB (16.7 GB when `effects` is installed too: they share `clip_vision_h`) |
| `restyle` | restyle (Wan 2.1 VACE 14B): "Restyle the clip" in the Motion tab, the scene of a clip rebuilt around its motion and camera move. With `edit`, the edit restyles the clip's first frame first | 35.4 GB |
| `swap` | object swap: "Swap an object" in the Motion tab. SAM 2.1 follows an object painted on the clip's first frame, and VACE redraws it from a text and an optional photo. It runs on the restyle's weights, so `swap` requires `restyle` | 0.2 GB |
| `remix` | the Trend remix page, from Explore: a short clip of several shots made again shot by shot with your character on the motion transfer, put back on the same frames, then cut as a 9:16. With `swap`, it can replace one object in each shot instead; with `avatar`, Gemma 4 E4B reads the shots and writes the post. `remix` requires `motion` | none of its own |

The Motion tab shows with `motion` or `restyle`, with one mode for each of `motion`, `restyle` and `swap`. The Ads page (the Ad studio) needs `edit`, `music` and an effect of `effects`. The Voice change and Translate pages are also reached from an avatar's result.

The avatar and the object swap each run on a third-party custom node, which the installer clones into `ComfyUI/custom_nodes/` when the extension is asked for, at the commit `infra/runpod/versions.env` pins (both Apache-2.0, listed in `tools/check-open-stack/allowed-nodes.yaml`, and `check-open-stack` fails if the two disagree):

- `avatar`: wildminder/ComfyUI-Chatterbox, the voice. It is patched to remove its `/chatterbox/*` HTTP routes, and its Python packages are installed from `infra/runpod/requirements-chatterbox.txt`, pinned by hash and without their dependencies. Those packages exist for Python 3.12 on Windows, and 3.10 to 3.13 on Linux. On Windows with another Python, the installer leaves `avatar` out with a warning, and with it the voice change, the translation and the captions.
- `swap`: kijai/ComfyUI-segment-anything-2, the SAM 2 tracker, unchanged.

The captions need no third-party node: Whisper runs in Montagio's own node pack, on weights of the `avatar` extension.

A node that fails to install (a missing wheel, a patch that no longer applies, a folder of yours already in its place, which is left as it is) is removed, and its extension is left out with its weights: the rest of the install goes on, and the log says why. Details: [EXTENSIONS_ANALYSE.md](EXTENSIONS_ANALYSE.md) (in French).

`start` passes the app the extensions the last `install` fetched, so the Studio shows only what this machine can run: an extension whose node failed is not among them. It replaces a `MONTAGIO_EXTENSIONS` of yours, so `MONTAGIO_EXTENSIONS=all ./montagio.sh start` changes nothing on a full install. With `--app-only` (the demo, or a remote GPU with `--proxy-url`), or for an app you start yourself, `MONTAGIO_EXTENSIONS` decides what the Studio shows, by the same rules as `--extensions` (unset: those a GPU session validated). An effect or a hook also needs its own date in its preset file (`gpu_validated`), unless `MONTAGIO_EXTENSIONS=all`: `--extensions all` at install time fetches every weight, but the effects and hooks no GPU session dated stay hidden in the Studio that `start` opens.

A workflow ComfyUI refuses (a missing node or file) hides its extension until the app restarts, and the log says which; a ComfyUI without Whisper's node or folder hides the captions alone.

## Troubleshooting

| What you see | What to do |
|---|---|
| `port 8188 (ComfyUI) is already in use` | another ComfyUI, or another program, uses the port: stop it, or install with `--comfy-port 8288` (same for `--proxy-port` and `--app-port`) |
| `port N is given to both … and …` | two services would share a port (a saved one and a new option, for example): pick another with `--comfy-port`, `--proxy-port` or `--app-port` |
| `running scripts is disabled on this system` | start the script with `powershell -ExecutionPolicy Bypass -File .\montagio.ps1 …` |
| `darwin is not supported: Montagio installs on Windows or Linux, with an NVIDIA GPU` | macOS is not supported, not even for the app alone: see the showcase linked from the [README](../README.md) |
| `arm64 is not supported: the full install needs an x64 machine` | install the app alone with `--app-only` |
| `no Python 3.11 to 3.13 found`, or `python` opens the Microsoft Store | install Python 3.12 (`winget install Python.Python.3.12`); in Settings → Apps → Advanced app settings → App execution aliases, turn off `python.exe` and `python3.exe` |
| `Python 3.x cannot make a venv (no venv or ensurepip module)` | Linux: `sudo apt install python3.12-venv`. Windows: reinstall Python 3.12 with `winget install Python.Python.3.12` |
| `FFmpeg is missing` or `ffprobe is missing: the app needs both to tag clips and cut films` | install FFmpeg (`winget install Gyan.FFmpeg`, or `sudo apt install ffmpeg`) and open a new terminal, or name the binaries with `MONTAGIO_FFMPEG` and `MONTAGIO_FFPROBE`. The app alone needs them too |
| `… free for the install folder, … needed` (or `… needed for both`, when the install folder and the repository share a drive) | free some space, or install on another drive with `--dir <folder>`; [Requirements](#requirements) gives the space each choice needs |
| `the driver supports CUDA 12.x: PyTorch needs 12.8 or newer` | update the NVIDIA driver (R580 or newer) |
| `torch sees no CUDA device` | the driver is too old for the PyTorch build, or the GPU is busy elsewhere: update the driver, reboot, run `install` again |
| `warning: the avatar's voice node has its packages for Python 3.12 on Windows (3.11 to 3.13 on Linux), not 3.x; the avatar extension is left out` | install Python 3.12 (`winget install Python.Python.3.12`), which the installer prefers, then run `install` again (it keeps your `--extensions`): it makes ComfyUI's Python environment again with 3.12 |
| `warning: … is a folder Montagio did not clone: move it away …; the … extension is left out` | a folder of yours sits where a node pack goes (`custom_nodes/ComfyUI-Chatterbox` or `custom_nodes/ComfyUI-segment-anything-2`): move it, then run `install` again |
| `… has local changes: move them away` | the ComfyUI folder holds changes (`git status` is not empty): move them out of it, then run again |
| `git status failed in …` | git cannot read the ComfyUI folder; git's own reason follows (a folder owned by another user, a broken `.git`) |
| `…custom_nodes/montagio is a folder, not a link to …` | a real folder sits where the link to the node pack goes: move it away, then run again |
| `--extensions: unknown extension …`, or `--extensions: X requires Y; add it to the list` | name extensions of the [Extensions](#extensions) table, with what each requires: `transitions` needs `edit`, `swap` needs `restyle`, `remix` needs `motion`. When the message says `kept from the last install`, the choice comes from an older install: pass a new `--extensions`, or `--extensions default` to forget it |
| `yt-dlp: the file downloaded has the sha256 …, not the pinned …: nothing was written` | run again; if it persists, the release file changed upstream, report it |
| `Montagio is not installed in <folder>: run the install command first` | `start` found no install in that folder: run `install`, or give the `--dir` you installed with |
| `port N (<service>) is used by another program` (at `start`) | stop that program, or `install` again with `--comfy-port`, `--proxy-port` or `--app-port` |
| `<service>: cannot read the command line of pid N (started from an elevated terminal?): left running` | run `stop` from the same kind of terminal (administrator or not), or end the process in the Task Manager |
| `MONTAGIO_COMFYUI_ARGS cannot set --listen` (or `--port`) | remove that option, or its abbreviation, from the variable: ComfyUI stays on 127.0.0.1 and the install's port |
| `partner nodes are loaded` | Montagio refuses to run a ComfyUI that loads partner (paid API) nodes. It always starts ComfyUI with `--disable-partner-nodes`; if you see this, check `MONTAGIO_COMFYUI_ARGS` and `logs/comfyui.log` |
| `warning: nodes missing: …` | ComfyUI lacks a node the camera workflows need: read `logs/comfyui.log` |
| `the Montagio node pack did not load` | read its import error in `logs/comfyui.log`, fix it, then run `start` again (`install` relinks the pack only when its link is missing or points elsewhere) |
| a download stopped | run `install` again: it resumes |
| `sha256 mismatch` | a download did not give the bytes the lock pins: the partial file is deleted, run again; if it persists, the upstream file changed, report it. A weight the lock pins with a new sha256 after an update is not an error: `install` removes the old file and downloads the pinned one |
| `EPERM` during `npm ci` (Windows) | a program still uses `node_modules` (often a `next dev` you started): stop it, run again |
| `<folder>\ComfyUI exists and was not installed by Montagio` | `--dir` points to a folder with your own ComfyUI: choose an empty folder, Montagio never touches a ComfyUI it did not install |
| `MONTAGIO_EXTENSIONS is invalid, no extension is shown` (in `logs/app.log`) | the app's variable breaks the same rules as `--extensions`: fix it or unset it, then `start` again |
| `MONTAGIO_VRAM_PROFILE: unknown profile …` (in `logs/app.log`) | the app applies the 12 GB profile: set `standard` or `12gb`, or unset the variable |
| pip is very slow on Windows | an antivirus scans each of the many files PyTorch unpacks; it gets there, give it time |
| on Windows, `start` (or `install`) does not return when its output is piped or redirected (`\| Tee-Object`, a CI job) | the services inherit the pipe from PowerShell, so it stays open until `stop`. In a terminal the prompt comes back at once; in a script, install with `--no-start`, then run `start` without redirecting its output |
| `comfyui exited during startup with code …` | read the end of `logs/comfyui.log`: the error is there |

The logs of the three services are in `<install folder>/logs/`.

## Uninstall

1. Stop Montagio: `./montagio.sh stop` (or `… .\montagio.ps1 stop`).
2. Remove the link to the node pack first, so that nothing deletes the repository's `comfy-nodes` through it. On Windows: `cmd /c rmdir "%LOCALAPPDATA%\Montagio\ComfyUI\custom_nodes\montagio"` (`rmdir` without `/s` removes the junction only; Windows PowerShell 5.1's `Remove-Item -Recurse` may follow it into the repository). On Linux: `rm ~/.local/share/montagio/ComfyUI/custom_nodes/montagio`. Adapt the path if you installed with `--dir`. An install made before the name Montagio has its link at `custom_nodes/montagio` (see [An install made before the name Montagio](#an-install-made-before-the-name-montagio)).
3. Delete the install folder (see [where](#what-gets-installed-and-where)). It holds the weights: about 67 GiB for the camera presets, 86 GiB with the effects pack, about 235 GiB with every extension.
4. Delete the repository folder. Keep its `data/` folder first (or the folder `MONTAGIO_DATA` names) if you want your clips.

Nothing else is changed on your machine: no service, no setting, no file outside these two folders, apart from pip's and npm's download caches.

## Why not comfy-cli

[comfy-cli](https://github.com/Comfy-Org/comfy-cli) can install and launch ComfyUI. Montagio does not use it for the install (checked on 2026-10-18, comfy-cli 1.22.0 on PyPI):

- it depends on two telemetry SDKs (`mixpanel`, `posthog`), plus `uv`, `ruff`, `cookiecutter`, `gitpython` and `imageio-ffmpeg`, for a job that needs `git`, `venv` and `pip`;
- `comfy install` adds ComfyUI-Manager by default, which can fetch more nodes;
- it chooses PyTorch itself, while Montagio pins one build per CUDA version.

Its license, GPL-3.0, is not the issue. The repository uses comfy-cli only to publish the node pack to the Comfy Registry.

## Open-stack guarantees

- ComfyUI runs with `--disable-partner-nodes` and `--offline` (its own page cannot reach the internet). At each start, the installer reads `/object_info` and stops everything if a partner node is loaded.
- ComfyUI and the proxy run offline for Hugging Face (`HF_HUB_OFFLINE`), without its telemetry: a node pack cannot download a file the lock does not pin.
- ComfyUI, comfy-api-proxy and the app listen on `127.0.0.1` only, and refuse another site's page: the app and ComfyUI answer only requests that name this machine (or a host of `MONTAGIO_ALLOWED_HOSTS`), and the proxy asks for a random token the install keeps in `install-state.json` and gives the app.
- The app talks to the local proxy through an explicit `COMFY_BASE_URL` (the Comfy SDK would otherwise target Comfy Cloud), and no `COMFY_API_KEY` reaches it.
- Weights come only from `registry/models.lock.yaml`; each file is checked against the sha256 the lock pins.
- `check-open-stack` runs on every install and writes the report behind the app's "open weights" badge.

## For contributors

The installer is `infra/local`: TypeScript run by Node.js without any npm package, so it starts before `npm ci`. Its own `npm ci` step comes early, right after stopping the running services; the steps after it (the weights, `check-open-stack`, the build) run `tsx` and `next` from `node_modules`. Its tests: `npm test -w @montagio/infra-local`. The GPU pod tooling it shares its pinned versions and weight downloader with is `infra/runpod`.
