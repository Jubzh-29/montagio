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

- the affected component: the web app (`apps/web`), the ComfyUI node pack (`comfy-nodes`), the installer (`infra/local`, `montagio.sh`, `montagio.ps1`), the GPU pod tooling (`infra/runpod`), or `check-open-stack`;
- the version or commit;
- the steps to reproduce, and what an attacker gains.

We aim to acknowledge a report within 7 days, and we will tell you how we plan to fix it. Once a fix ships, we credit you in the advisory unless you prefer to stay anonymous.

### Out of scope

- **ComfyUI itself.** Report its vulnerabilities to the ComfyUI project.
- **Third-party model weights**, including what a model can be made to generate.
- **Uses of Montagio that break the law or someone else's rights**, such as animating a real person without their consent. These are misuse, not vulnerabilities.

## How Montagio limits its attack surface

- **Local by default.** The installer's start script binds ComfyUI, comfy-api-proxy and the web app to `127.0.0.1` only. It starts ComfyUI with `--disable-partner-nodes` and turns off Next.js telemetry.
- **Its own address only.** The app's API and files answer only a request for `localhost`, `127.0.0.1` or `[::1]` on its port, or for a host listed in `MONTAGIO_ALLOWED_HOSTS`. They refuse an `Origin` of another site, and a file, a form or plain text that another site sends. A page open elsewhere in the browser cannot drive the app, even by pointing its domain at 127.0.0.1 (DNS rebinding).
- **Links fetched by name only.** The trend remix's import by link exists only in the app on your machine, never in the demo nor the showcase. A link is checked before any process starts: http(s) only, no user nor port, and a host of a short list (TikTok, Instagram, YouTube for a Short, youtu.be), so a link can never make the server read its own network. yt-dlp, pinned by its sha256, then runs without a shell, its own configuration ignored, the link after `--`, 60 s and 50 MB at most.
- **No closed services.** Montagio ships no connector to a proprietary generation API and does not use the Comfy Router. `check-open-stack` fails the build if one appears, as a code pattern or as a package.
- **Verified weights.** Every model file is pinned in `registry/models.lock.yaml` by exact URL and sha256. A download must match its hash before it is used.
- **Checked origins.** `check-open-stack` also refuses a weight whose repository is not listed in `tools/check-open-stack/allowed-sources.yaml`. Each listed repository comes with the license read at its source. Only Apache-2.0 or MIT weights are accepted.
- **No upload in the online showcase.** The online showcase is a static site with no server code. It plays pre-generated clips, so it never receives a visitor's photo.

## Dependency audits

Before each release:

- JavaScript: `npm audit --omit=dev` covers what the app ships. `npm audit` covers the development tools too.
- Python: the node pack's dependencies (`comfy-nodes/requirements-dev.txt`) and the ComfyUI environment that the installer creates are checked against the [OSV](https://osv.dev) database.

## Known advisories we accept

These advisories appear in `npm audit` but do not affect what Montagio ships. Each is reviewed again when a fix is published.

| Advisory | Package | Where it comes from | Why it is accepted | Status |
|---|---|---|---|---|
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high): stack exhaustion through deeply nested brace patterns | `braces` ≤ 3.0.3 | `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. Development only: the linter. | `npm audit --omit=dev` reports 0 vulnerabilities. The linter only expands glob patterns written in this repository, never input from users or the network, so an attacker has no way to feed it a crafted pattern. npm's suggested "fix" would downgrade `eslint-config-next` to 14.2.35, an older major version than the Next.js 16 the app uses. We do not apply it. | No patched version of `braces` exists as of 2026-10-19 (latest: 3.0.3). Update the lockfile once one is published. |
