# Security policy

Montagio is a community project. Security reports are handled on a best-effort basis by volunteers.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest release | Yes, once v0.1 is released |
| Older releases | No: please upgrade |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please include:

- the affected component: the web app (`apps/web`) and the libraries it uses (`packages/*`), the MCP server (`packages/mcp`), the ComfyUI node pack (`comfy-nodes`), the installer (`infra/local`, `montagio.sh`, `montagio.ps1`), the GPU-session tooling (`infra/runpod`, `infra/modal`), or `tools/check-open-stack`;
- the version or commit;
- the steps to reproduce, and what an attacker gains.

We aim to acknowledge a report within 7 days, and we will tell you how we plan to fix it. Once a fix ships, we credit you in the advisory unless you prefer to stay anonymous.

### Out of scope

- **ComfyUI itself.** Report its vulnerabilities to the ComfyUI project.
- **Third-party model weights**, including what a model can be made to generate.
- **Uses of Montagio that break the law or someone else's rights**, such as animating a real person without their consent. These are misuse, not vulnerabilities.

## How Montagio limits its attack surface

- **Local by default.** The installer's start (`montagio.sh start`, `montagio.ps1 start`) binds ComfyUI, comfy-api-proxy and the web app to `127.0.0.1` only. It starts ComfyUI with `--disable-partner-nodes` and `--offline` (a Content-Security-Policy that keeps ComfyUI's own page off the internet: no node registry, no sign-in, no version check), removes `COMFY_API_KEY` and `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD` from the services' environment, sets `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` and `HF_HUB_DISABLE_TELEMETRY` for ComfyUI and the proxy, and turns off Next.js telemetry. With `install --app-only --proxy-url <url>`, the app sends its renders, input files included, to the comfy-api-proxy at that URL.
- **`npm run dev` and `npm start` answer this machine only.** Both pass `-H 127.0.0.1`. `next dev` or `next start` run by hand without `-H` listen on every address of the machine (Next.js's default host, `0.0.0.0`), and use the demo backend unless `MONTAGIO_BACKEND` is set: the pages then answer on the local network, while `/api` and `/media` still refuse a host that is not allowed (see below).
- **No closed services.** Montagio ships no connector to a proprietary generation API and does not use the Comfy Router. The ComfyUI client refuses a base URL on `comfy.org` or `comfy.app`, and every request it makes stays on that base URL's origin. `check-open-stack` fails the build if a closed service appears, as a code pattern or as a package.
- **Verified weights.** Every model file is pinned in `registry/models.lock.yaml` by exact URL and sha256. `fetch-weights` (used by the installer, the Runpod bootstrap and the Modal tooling) refuses a lock entry whose sha256 or size no longer matches what Hugging Face publishes before downloading anything, hashes the bytes as they arrive, and moves a file into place only once its sha256 matches. A file already on disk is hashed again, and the install stops if it differs.
- **Checked origins.** `check-open-stack` also refuses a weight whose repository is not listed in `tools/check-open-stack/allowed-sources.yaml`. Each listed repository comes with the license read at its source. Only Apache-2.0 or MIT weights are accepted.
- **No upload in the online showcase.** The online showcase is a static site with no server code. It plays pre-generated clips, so it never receives a visitor's photo.

### The app's local API

The app's API (`/api/...`) and its files (`/media/...`) have no login. These checks keep other sites out:

- **Its own address only** (`apps/web/src/proxy.ts`, on every request but the build's scripts and styles under `/_next/static`: the API, the files and the pages, which also take Next's Server Action and React Server Components requests, whose decoding is where Next's and React's gravest flaws have been). The `Host` header must be `localhost`, `127.0.0.1` or `[::1]` on the port the app serves, or a host listed in `MONTAGIO_ALLOWED_HOSTS` (comma-separated; an entry without a port takes any port; a scheme and a trailing `/` are dropped). An `Origin` header, when the browser sends one, must pass the same test, and `Origin: null` never does. Anything else gets 403 `host-not-allowed`, and the app logs each refused host and origin once, 50 lines at most. A page open elsewhere in the browser cannot drive the app, even by pointing its domain at 127.0.0.1 (DNS rebinding): the browser still names that domain in `Host`. Next's own Server Action check compares `Origin` with `Host`, which a rebound domain passes; this one does not.
- **An `Idempotency-Key` header** on every route that starts a render (images, edits, moodboards, effects, hooks, avatars, camera clips, films, motion transfers, restyles, object swaps, trend remixes and their skeletons, ads, a film's music, captions, HD copies, translations, voice changes). Without it, the app answers 400 `missing-idempotency-key`. Another site cannot add this header without the browser asking first, and that request carries the other site's `Origin`, which the host check refuses.
- **Cross-site refusals** on the other routes that change something (uploads, cancels, characters, community presets, captions export and preview, remix shots, import by link). When the browser sends `Sec-Fetch-Site`, it must be `same-origin` or `none`, otherwise the app answers 403 `cross-site`. The routes among them that take JSON also refuse another content type, so a form or plain text sent by another site is refused. A test (`apps/web/test/route-guards.test.ts`) fails if a route that changes something has none of these checks.
- `POST /api/presets/validate` has neither check: it only checks a preset text and saves nothing.
- **No frame, no embedding.** Every answer carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, so another site cannot show the app in a hidden frame and have the user click in it. `/api` and `/media` answer with `Cross-Origin-Resource-Policy: same-origin`, so another site cannot even embed a file of the app in an `<img>` or a `<video>`. Every answer also carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Next's image optimizer (`/_next/image`) is turned off: the app does not use it.

**What a script gets.** curl, a script or the MCP server sends no `Sec-Fetch-Site` and no `Origin`. With an allowed `Host`, such a request passes every check above and can use the whole API (with an `Idempotency-Key` to start a render). Any program on the machine that can reach the app's port can drive it, and so can any device that reaches it under a host listed in `MONTAGIO_ALLOWED_HOSTS`.

### Uploads and request bodies

A body is refused as soon as its declared length, or the bytes read so far, pass the limit, before it is parsed.

| What | Limit |
|---|---|
| A photo (`POST /api/uploads`) | 10 MB, PNG, JPEG or WebP, its content checked against its type |
| A video: a motion or restyle reference, a video for a voice change or a translation, a trend to remix | 50 MB, MP4, WebM or QuickTime |
| A voice sample | 10 MB, WAV, MP3, M4A, FLAC, OGG or WebM |
| A JSON body | 128 KB |
| A shared preset imported (`POST /api/community/import`) | 80 KB |
| A camera preset's YAML | 16 KB |

A multipart upload may add 64 KB for the form around its file.

- **Files by reference only.** A request names an uploaded file by its ref (`uploads/<uuid>.png`, `videos/<uuid>.mp4`…), checked against a strict pattern before it becomes a path; record and job ids are checked the same way, and `Idempotency-Key` values are hashed before they name a file. `/media` serves three folders only, one plain name per path segment (no `..`, separator, drive colon or NUL).
- **FFmpeg.** It never runs through a shell, reads a sent file with `-protocol_whitelist file`, and converts a sent video or sound only from a real media container (`-format_whitelist`), so a playlist or an `ffconcat` list named `.mp4` cannot make it read other files into a result. It probes and decodes a sent file with the decoders phones, browsers and the trends' platforms use only (`-codec_whitelist`: H.264, HEVC, VP8, VP9, AV1, MPEG-4, Motion JPEG, a cover's PNG; AAC, MP3, Opus, Vorbis, FLAC, ALAC, PCM): FFmpeg's rarer decoders, where its memory flaws keep turning up (MagicYUV, CVE-2026-8461), never open on a file someone sent, whatever FFmpeg the machine has. ComfyUI's PyAV only ever reads the H.264 that FFmpeg wrote from it. Every video and sound it writes drops its source's metadata (`-map_metadata -1`), a phone's GPS position included. Captions and an ad's tagline reach FFmpeg as files with plain names, never inside the filter graph.

### Files shared by others

Recipes (`montagio/recipe@1`, in a `.json` file or in the tags of a Montagio MP4 or PNG), share files of the community gallery (`montagio/share@0.1`) and preset YAML files come from anyone. None of them sends a workflow to ComfyUI:

- **Presets** are declarative: a strict schema (`packages/presets/src/schema.ts`) of known fields, ids and bounded texts. The workflow is the app's own template for the model, with the preset's values bound to known inputs. A preset with LoRAs is refused, and the YAML parser keeps its alias limit.
- **A recipe replayed** (`npm run reproduce`, the MCP tool `reproduce`) sends only its `request` to the app, never its workflows: one of the app's creation routes from a closed list, at most one follow-up from another closed list, without any file ref, composition, other render, consent or rights it may carry. Its files are the ones the user gives. The app then checks that body as any other request.
- **A share file** keeps only known fields, each checked (ids, texts of bounded length, a preset text of 64 KB at most): never a photo, a file, a URL or an id of the machine. A preset text it carries is validated when it is rendered.
- **The list of well-known names** (`registry/blocked-names.txt`) is checked in every text typed in the app: prompts, descriptions of a photo (a camera clip, every shot of a film), negative prompts, the texts of a remixed move, edit instructions, effects' subjects, the avatar's text, a film's music, captions, ads, characters, the trend remix, the gallery's titles and authors, and every text of a share file. A request that names a listed person gets 400 `blocked-name`.

### Import by link

The trend remix can import a video from its link with yt-dlp (`apps/web/src/server/link-import.ts`).

- **Only in an app of your own.** The route exists only when the backend is not the demo (`MONTAGIO_BACKEND=local`: the full install, or `install --app-only --proxy-url`), and only while the remix extension is shown. Otherwise `/api/remix/import` answers 404. The demo and the online showcase have no such route.
- **The user's word first.** A request must pass the cross-site check (JSON only) and carry `rights: true`, the user's word that they may use the video. Without it, nothing is fetched (400 `rights-required`).
- **Links checked by name.** Before any process starts, the link must be at most 500 characters, http or https, with no user name, password or port, on one of these hosts:

  | Host | Paths taken |
  |---|---|
  | `tiktok.com`, `www.tiktok.com`, `m.tiktok.com` | `/@<user>/video/<id>`, `/embed/<id>`, `/t/<code>` (sent to yt-dlp on `www.tiktok.com`) |
  | `vm.tiktok.com`, `vt.tiktok.com` | `/<code>` |
  | `instagram.com`, `www.instagram.com` | `/reel/<id>`, `/reels/<id>`, `/p/<id>`, `/tv/<id>` |
  | `youtube.com`, `www.youtube.com`, `m.youtube.com` | `/shorts/<id>` |
  | `youtu.be` | `/<id>` |

  Any other host, an IP address or `localhost` among them, is refused by name, and so is any other page of these sites (TikTok's `/link/v2` redirect page among them). The fragment is dropped.
- **One import at a time.** A second import while one runs gets 429 `link-busy`.
- **yt-dlp held short.** It runs without a shell, with its own configuration ignored (`--ignore-config`), its site extractors only (`--use-extractors default,-generic`: the generic extractor, which reads whatever page a link leads to, never runs), no playlist, the link after `--`, files of 50 MB at most (`--max-filesize`) and clips of 60 s at most (`--match-filters`, checked again on yt-dlp's info file afterwards). A run that has not ended after 180 s is killed. Its working folder is deleted whatever happens.
- **Which yt-dlp.** The app runs `MONTAGIO_YTDLP`, or else `yt-dlp` from the `PATH`. The installer downloads the release binary into memory, checks it against the sha256 pinned in `infra/runpod/versions.env`, and only then writes it into its `tools` folder and hands it to the app as `MONTAGIO_YTDLP`. A `MONTAGIO_YTDLP` you set yourself, or a yt-dlp on the `PATH`, runs as it is.
- **After the link.** The host check applies to the link given. What an extractor fetches next (the platform's API, its media servers, a redirect it serves) is yt-dlp's decision: the app does not check those addresses. A TikTok short link (`vm.`, `vt.`, `/t/`) is resolved by following TikTok's redirect, and the page it leads to goes to whichever of yt-dlp's site extractors takes it.

### Model weights and node packs

- **One pickle.** Every weight of the lock is a `.safetensors` file, except the avatar voice's `conds.pt` (Chatterbox, 107 KB), for which no safetensors version exists in an allowed repository. Its sha256 is checked at download like every weight, Chatterbox loads it with `torch.load(..., weights_only=True)`, PyTorch 2.14 does the same by default for its other `torch.load` call, and the installer removes `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD` from ComfyUI's environment. The RIFE and SAM 2.1 weights are the safetensors repackagings of their pickled originals, tensor for tensor.
- **Third-party node packs** (the avatar's voice, wildminder/ComfyUI-Chatterbox; the object swap's tracker, kijai/ComfyUI-segment-anything-2) are cloned, checked out at the commit of `infra/runpod/versions.env`, and that commit is verified before use. The voice pack is patched (`infra/runpod/patches/comfyui-chatterbox-no-routes.patch`) to remove its `/chatterbox/*` HTTP routes, which read any absolute path; its Python packages are installed with `--no-deps --require-hashes`. The local installer builds each pack in a folder of its own and moves it into `custom_nodes` only once it is complete; the GPU-session bootstrap removes a pack whose install failed half way, so ComfyUI never loads an unpatched or unchecked pack.
- **Reviewed** (2026-10-26, at the pinned commits): neither pack runs `exec`, `eval` or a process of its own, sends telemetry, or reaches the network at import. With Hugging Face offline, the voice pack does not fetch a missing file (it would otherwise download a whole repository) nor its Chinese tokenizer table, which it fetched at every load, unpinned (without that table, the voice does not speak Chinese), and the tracker does not fetch a missing weight. Montagio's own pack (`comfy-nodes`) opens no route and makes no network call; its Whisper loads local files only.

### Privacy

- **Nothing leaves the machine while the app runs**, except the downloads you start (the installer's, the weights) and a link you import. Next.js, Hugging Face and ComfyUI's page send no telemetry (see above).
- **A recipe never holds a photo, a clip or a path of the machine.** Each input file is named by where it came from and by its sha256: `buildRecipe` refuses to write a recipe that holds a local path, and the link a trend was imported from is never written. The sha256 lets anyone who has the same file confirm it was the input, nothing more.
- **No EXIF in what Montagio hands out.** A photo you send is kept as sent in `MONTAGIO_DATA/uploads` on your machine, and reaches ComfyUI from there; it is never handed out as it is. The images Montagio delivers are written from pixels, and their PNG text and EXIF chunks are replaced by the AI mention and the recipe; the videos and sounds drop their source's metadata. A reference video, a voice sample and a trend are converted at upload, without their metadata.

### The MCP server

`packages/mcp` lets an MCP client drive the app.

- It speaks MCP over stdio only: the client starts it, and it opens no port. It logs to stderr only.
- It talks to the app at `MONTAGIO_URL` (default `http://127.0.0.1:3000`). Any http(s) URL is accepted, a remote one included, and its requests carry no key. It downloads files only from that URL's origin.
- It reads the local files a tool call names, at any path: photos (`.png`, `.jpg`, `.jpeg`, `.webp`, 10 MB at most), videos (`.mp4`, `.webm`, `.mov`, 50 MB) and, for `reproduce`, voice samples (`.wav`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.webm`, 10 MB). They are checked by extension and size only, then uploaded to the app. A recipe is read from the tags of an `.mp4`, `.mov`, `.m4v` or `.png` file, or else from the file as JSON. So a client can have any file of these kinds that the server's user can read sent to the app.
- It writes only into `MONTAGIO_MCP_OUT`, when it is set. A finished render is saved there as `montagio-<task>-<id>.<ext>` and overwrites a file of the same name. `get_workflow` with `save: true` writes a new `.json` file and never overwrites one.
- `consent`, `rights`, `voiceConsent` and `faceConsent` default to `false`, and the server never sets them on its own. `motion_transfer`, `restyle_video` and `swap_object` refuse without `rights: true` before anything is uploaded. `reproduce` drops these flags from a recipe, sends only the app's creation routes, and runs one follow-up render at most.

### GPU sessions

The GPU-session tooling (`infra/runpod`, `infra/modal`) starts ComfyUI with `--disable-partner-nodes --offline` on `127.0.0.1`, offline for Hugging Face, and comfy-api-proxy on `127.0.0.1`. Two options make ComfyUI, which has no login, reachable from the internet while they run: `bootstrap.sh --expose-ui` on Runpod (ComfyUI on `0.0.0.0`, behind the pod's public proxy URL) and the `ui` function on Modal (a public Modal tunnel).

## Known remaining risks

What Montagio does not protect against today, and why:

| Risk | Why it is accepted |
|---|---|
| Any program of the machine can drive the API (no login). | The app is a local, single-user tool. A program that already runs as you can do more than drive it. |
| The list of names is a good-faith guardrail. | It cannot know every name, and it cannot see who is in a photo: the consent boxes cover photos. |
| `conds.pt` is a pickle. | Its sha256 is pinned and it is loaded with `weights_only=True`; no safetensors version exists in an allowed repository. |
| FFmpeg parses the files you send, with the common decoders. | It is your FFmpeg (`MONTAGIO_FFMPEG` or the `PATH`): keep it up to date, 9.0.2 or 8.1.3, or the newest release of your branch (8.0.3, 7.1.5, 6.1.6). Ubuntu's `apt` FFmpeg (4.4.2 on 22.04, 6.1.1 on 24.04) gets its fixes only through Ubuntu Pro, Debian 12's through its LTS. Two flaws of the MP4 demuxer have no fix in any release yet (CVE-2026-107678, a stack exhaustion; CVE-2026-107676, a 3-byte read): a crafted file can stop the conversion, nothing more is known. |
| ComfyUI (port 8188) and comfy-api-proxy (8189) do not check `Host`. | Their own guard compares `Origin` with `Host`, which a domain rebound to 127.0.0.1 passes: a page open in a browser without local network protection (Chrome 141 and newer asks first) could send them workflows and read their files. The app's own port is protected (above). |
| The Python of the Windows installer (`winget install Python.Python.3.12`, 3.12.10) lacks the CPython fixes released as source code only since then. | Montagio's Python code unpacks no archive and serves no HTTP; pip unpacks the packages it installs from PyPI over https, at install time. |
| ComfyUI's and comfy-api-proxy's Python packages, other than PyTorch, torchvision and the voice pack's, are not pinned by hash. | They come from PyPI as ComfyUI v0.41.0 and comfy-api-proxy 0.1.6 ask for them; their audit is part of each release (below). |
| yt-dlp follows what a platform serves after the link (a short link's redirect among it), and a yt-dlp you name yourself is not checked. | The link is checked by name, and the generic extractor never runs. |
| A photo you send keeps its metadata on your disk. | It never leaves the machine; delete `MONTAGIO_DATA/uploads` to remove it. |
| `--expose-ui` (Runpod) and the `ui` tunnel (Modal) make ComfyUI public without a login while they run. | They are opt-in, for a GPU session you rent and stop. |

## Dependency audits

Before each release:

- JavaScript: `npm audit` (development tools included) and `npm audit --omit=dev` (what the app ships). On 2026-10-26 both report 0 vulnerabilities, after `body-parser` 2.4.0 (GHSA-27r3-jxmh-p828, through `@modelcontextprotocol/sdk` → `express`; the MCP server speaks stdio and never parsed an HTTP body). The advisory on `braces` (GHSA-vfj7-8cjw-p6xm) that was accepted here was withdrawn on 2026-10-23.
- Runtimes and tools, on 2026-10-26: Next.js 16.4.2 is past every published advisory, its own copy of React (`next/dist/compiled`, 19.3.0 canary of 2026-10-02) carries the Server Components fix of 2026-10-14 (GHSA-xqc2-xf4c-x3h3, GHSA-h3gv-c5rc-p453), and the app has no Server Action. Node.js must hold the security release of 2026-10-20 (22.23.4, 24.22.1, 26.12.1: Brotli, DNS, TLS); the installer refuses an older one, the GPU pod pins 22.23.4, CI takes the newest 22.x. ComfyUI v0.41.0 and its frontend 1.55.17 are past every published advisory, yt-dlp 2026.10.21 is the newest release (it drops the compromised emSign roots). Python 3.10 is out of support since 2026-10-01 and no longer taken.
- Python: ComfyUI's requirements at the pinned commit, comfy-api-proxy and its dependencies, the voice pack's packages (`infra/runpod/requirements-chatterbox.txt`), the node pack's development packages (`comfy-nodes/requirements-dev.txt`) and the Modal tooling's (`infra/modal/requirements.txt`) are checked with pip-audit against PyPI's and [OSV](https://osv.dev)'s databases, and against what the installer really installs (the PyTorch index brings its own Pillow, hence the floor in `infra/runpod/versions.env`). On 2026-10-26: no advisory once Pillow is 13.0.0 or newer, which Python 3.11 and newer get. The Modal tooling's environment pins floors for what modal brings (certifi without the compromised emSign roots, protobuf, h2, cbor2). PyTorch 2.11.0, the build for drivers that stop at CUDA 12.8, carries PYSEC-2025-194 (`torch.jit.script`), which Montagio never calls.
