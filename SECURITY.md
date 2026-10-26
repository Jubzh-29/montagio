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

- **Local by default.** The installer's start (`montagio.sh start`, `montagio.ps1 start`) binds ComfyUI, comfy-api-proxy and the web app to `127.0.0.1` only. It starts ComfyUI with `--disable-partner-nodes`, removes `COMFY_API_KEY` from the services' environment and turns off Next.js telemetry. With `install --app-only --proxy-url <url>`, the app sends its renders, input files included, to the comfy-api-proxy at that URL.
- **`npm run dev` is not the installer's start.** `next dev`, and `next start` run by hand, listen on every address of the machine (Next.js's default host, `0.0.0.0`), and use the demo backend unless `MONTAGIO_BACKEND` is set. The pages then answer on the local network. `/api` and `/media` still refuse a host that is not allowed (see below).
- **No closed services.** Montagio ships no connector to a proprietary generation API and does not use the Comfy Router. The ComfyUI client refuses a base URL on `comfy.org` or `comfy.app`, and every request it makes stays on that base URL's origin. `check-open-stack` fails the build if a closed service appears, as a code pattern or as a package.
- **Verified weights.** Every model file is pinned in `registry/models.lock.yaml` by exact URL and sha256. A download must match its hash before it is used.
- **Checked origins.** `check-open-stack` also refuses a weight whose repository is not listed in `tools/check-open-stack/allowed-sources.yaml`. Each listed repository comes with the license read at its source. Only Apache-2.0 or MIT weights are accepted.
- **No upload in the online showcase.** The online showcase is a static site with no server code. It plays pre-generated clips, so it never receives a visitor's photo.

### The app's local API

The app's API (`/api/...`) and its files (`/media/...`) have no login. These checks keep other sites out:

- **Its own address only** (`apps/web/src/proxy.ts`, on every request to `/api` and `/media`). The `Host` header must be `localhost`, `127.0.0.1` or `[::1]` on the port the app serves, or a host listed in `MONTAGIO_ALLOWED_HOSTS` (comma-separated; an entry without a port takes any port; a scheme and a trailing `/` are dropped). An `Origin` header, when the browser sends one, must pass the same test, and `Origin: null` never does. Anything else gets 403 `host-not-allowed`, and the app logs each refused host and origin once, 50 lines at most. A page open elsewhere in the browser cannot drive the app, even by pointing its domain at 127.0.0.1 (DNS rebinding): the browser still names that domain in `Host`.
- **An `Idempotency-Key` header** on every route that starts a render (images, edits, moodboards, effects, hooks, avatars, camera clips, films, motion transfers, restyles, object swaps, trend remixes and their skeletons, ads, a film's music, captions, HD copies, translations, voice changes). Without it, the app answers 400 `missing-idempotency-key`. Another site cannot add this header without the browser asking first, and that request carries the other site's `Origin`, which the host check refuses.
- **Cross-site refusals** on the other routes that change something (uploads, cancels, characters, community presets, captions export and preview, remix shots, import by link). When the browser sends `Sec-Fetch-Site`, it must be `same-origin` or `none`, otherwise the app answers 403 `cross-site`. The routes among them that take JSON also refuse another content type, so a form or plain text sent by another site is refused.
- `POST /api/presets/validate` has neither check: it only checks a preset text and saves nothing.

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

A multipart upload may add 64 KB for the form around its file. Two routes read their JSON body without the 128 KB limit: `POST /api/sequences` and `POST /api/uploads/video/library`.

### Import by link

The trend remix can import a video from its link with yt-dlp (`apps/web/src/server/link-import.ts`).

- **Only in an app of your own.** The route exists only when the backend is not the demo (`MONTAGIO_BACKEND=local`: the full install, or `install --app-only --proxy-url`), and only while the remix extension is shown. Otherwise `/api/remix/import` answers 404. The demo and the online showcase have no such route.
- **The user's word first.** A request must pass the cross-site check (JSON only) and carry `rights: true`, the user's word that they may use the video. Without it, nothing is fetched (400 `rights-required`).
- **Links checked by name.** Before any process starts, the link must be at most 500 characters, http or https, with no user name, password or port, on one of these hosts:

  | Host | Paths taken |
  |---|---|
  | `tiktok.com`, `www.tiktok.com`, `m.tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com` | any |
  | `instagram.com`, `www.instagram.com` | `/reel/<id>`, `/reels/<id>`, `/p/<id>`, `/tv/<id>` |
  | `youtube.com`, `www.youtube.com`, `m.youtube.com` | `/shorts/<id>` |
  | `youtu.be` | `/<id>` |

  Any other host, an IP address or `localhost` among them, is refused by name. The fragment is dropped.
- **One import at a time.** A second import while one runs gets 429 `link-busy`.
- **yt-dlp held short.** It runs without a shell, with its own configuration ignored (`--ignore-config`), no playlist, the link after `--`, files of 50 MB at most (`--max-filesize`) and clips of 60 s at most (`--match-filters`, checked again on yt-dlp's info file afterwards). A run that has not ended after 180 s is killed. Its working folder is deleted whatever happens.
- **Which yt-dlp.** The app runs `MONTAGIO_YTDLP`, or else `yt-dlp` from the `PATH`. Only the copy the installer downloads into its `tools` folder, and hands to the app as `MONTAGIO_YTDLP`, is checked against a pinned sha256 (`infra/runpod/versions.env`). A `MONTAGIO_YTDLP` you set yourself, or a yt-dlp on the `PATH`, runs as it is.
- **After the link.** The host check applies to the link given. What yt-dlp fetches next (redirects, the platform's media servers) is yt-dlp's decision: the app does not check those addresses.

### The MCP server

`packages/mcp` lets an MCP client drive the app.

- It speaks MCP over stdio only: the client starts it, and it opens no port. It logs to stderr only.
- It talks to the app at `MONTAGIO_URL` (default `http://127.0.0.1:3000`). Any http(s) URL is accepted, a remote one included, and its requests carry no key. It downloads files only from that URL's origin.
- It reads the local files a tool call names, at any path: photos (`.png`, `.jpg`, `.jpeg`, `.webp`, 10 MB at most), videos (`.mp4`, `.webm`, `.mov`, 50 MB) and, for `reproduce`, voice samples (`.wav`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.webm`, 10 MB). They are checked by extension and size only, then uploaded to the app. A recipe is read from the tags of an `.mp4`, `.mov`, `.m4v` or `.png` file, or else from the file as JSON. So a client can have any file of these kinds that the server's user can read sent to the app.
- It writes only into `MONTAGIO_MCP_OUT`, when it is set. A finished render is saved there as `montagio-<task>-<id>.<ext>` and overwrites a file of the same name. `get_workflow` with `save: true` writes a new `.json` file and never overwrites one.
- `consent`, `rights`, `voiceConsent` and `faceConsent` default to `false`, and the server never sets them on its own. `motion_transfer`, `restyle_video` and `swap_object` refuse without `rights: true` before anything is uploaded. `reproduce` drops these flags from a recipe, sends only the app's creation routes, and runs one follow-up render at most.

### GPU sessions

The GPU-session tooling (`infra/runpod`, `infra/modal`) starts ComfyUI with `--disable-partner-nodes` on `127.0.0.1`, and comfy-api-proxy on `127.0.0.1`. Two options make ComfyUI, which has no login, reachable from the internet while they run: `bootstrap.sh --expose-ui` on Runpod (ComfyUI on `0.0.0.0`, behind the pod's public proxy URL) and the `ui` function on Modal (a public Modal tunnel).

## Dependency audits

Before each release:

- JavaScript: `npm audit --omit=dev` covers what the app ships. `npm audit` covers the development tools too.
- Python: the node pack's dependencies (`comfy-nodes/requirements-dev.txt`), the two environments the installer creates (ComfyUI's and comfy-api-proxy's), and the avatar voice pack's packages installed into ComfyUI's environment with `--no-deps --require-hashes` (`infra/runpod/requirements-chatterbox.txt`: s3tokenizer, onnx, protobuf, ml_dtypes, torchaudio) are checked against the [OSV](https://osv.dev) database.

## Known advisories we accept

These advisories appear in `npm audit` but do not affect what Montagio ships. Each is reviewed again when a fix is published.

| Advisory | Package | Where it comes from | Why it is accepted | Status |
|---|---|---|---|---|
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high): stack exhaustion through deeply nested brace patterns | `braces` ≤ 3.0.3 | `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. Development only: the linter. | `npm audit --omit=dev` reports 0 vulnerabilities. The linter only expands glob patterns written in this repository, never input from users or the network, so an attacker has no way to feed it a crafted pattern. npm's suggested "fix" would downgrade `eslint-config-next` to 14.2.35, an older major version than the Next.js 16 the app uses. We do not apply it. | No patched version of `braces` exists as of 2026-10-19 (latest: 3.0.3). Update the lockfile once one is published. |
