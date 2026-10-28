# Privacy hardening design

## Intent and why

Prepare Montagio for publication of the open-source repository and the static competition showcase. The public deployment remains the repository plus the upload-free static showcase; the full Studio remains a local, single-user application. The work fixes the privacy risks found in the audit without adding accounts or turning the Studio into a hosted multi-user service.

## Goals

- Update yt-dlp to a release carrying the current Brotli and certificate fixes, in the installer pins and on the maintainer's machine.
- Stop retaining uploaded photo metadata: normalize new raster uploads to pixels without EXIF or other source metadata instead of storing the original bytes.
- Add an explicit, guarded purge of the local Studio's uploads, history, generated files, gallery, characters, shares and caches, including remote assets whose deletion can be verified.
- Require authentication on every comfy-api-proxy used by the app and require HTTPS for a non-loopback proxy URL; keep HTTP only for loopback tunnels and local services.
- Keep the export recipe feature, while making its prompts and input hashes visible to the user before download and publication.
- Update the security and installation documentation to describe the actual behavior and remaining single-user boundaries.

## Non-goals and anti-goals

- No hosted multi-user Studio, account system, per-user authorization model or public ComfyUI deployment.
- No change to the static showcase: it still accepts no upload and keeps its visit history only in memory.
- No removal of recipes, reproducibility, community share files or the 9:16 export feature.
- No silent best-effort purge reported as complete. A purge that cannot verify remote deletion fails visibly and keeps enough local state to retry or finish manually.
- No deletion of model weights, application code, ComfyUI itself or arbitrary paths outside the documented data locations.
- No new runtime dependency when the existing FFmpeg and Comfy SDK provide the required operations.
- No commit, merge, push, deployment or contest submission without explicit approval.

## Constraints

- Reuse Next.js server routes, the existing cross-site guards, FFmpeg wrappers and `@comfyorg/sdk` asset deletion.
- Preserve the existing `127.0.0.1` default, host/origin checks and local single-user workflow.
- Every mutating route added here must be covered by the route-guard test.
- Use test-driven development and the existing Vitest/pytest suites. Run one heavy suite at a time.
- A previous install may hold remote assets for which local records are incomplete. This case must produce a visible incomplete-purge result and manual instructions, never a success claim.

## Approaches

1. **Chosen: targeted hardening.** Fix the concrete risks while preserving the local product and reproducible exports. This fits the repository-plus-static-showcase publication selected for the deadline.
2. **Maximum lockdown.** Remove `MONTAGIO_ALLOWED_HOSTS`, disable embedded recipes by default and restrict existing network features further. Rejected: it breaks useful existing behavior and weakens a competition feature without being necessary for the selected deployment.
3. **Hosted multi-user conversion.** Add accounts and per-user storage now. Rejected by the selected deployment and disproportionate to the deadline.

## Design

### 1. yt-dlp update

- Move `YTDLP_VERSION` and the Windows/Linux SHA-256 pins to the verified current release, `2026.10.26`, using the official release checksums rather than calculating a pin from an unverified binary.
- Update the installer tests and every documented version reference.
- Update the maintainer's PATH binary separately and verify `yt-dlp --version`; the repository must not rely on that global update because the installer uses its pinned copy.
- Keep the existing host allowlist, disabled generic extractor, size/duration limits and no-shell execution.

### 2. Photo metadata removal at upload

- Keep the current 10 MB input limit and PNG/JPEG/WebP content sniffing.
- After sniffing, decode a user-sent image through the existing FFmpeg tool wrapper, with shell-free arguments, local-file protocol restrictions, autorotation and `-map_metadata -1`; encode the stored copy as PNG.
- Store only this normalized PNG and its metadata JSON. The original uploaded bytes remain only in the short-lived request/temporary file and are removed on success and failure.
- Bound decoded dimensions before FFmpeg and reject decompression bombs or outputs above a documented normalized-file limit. Server-generated images keep their current path because their delivered metadata is already replaced by the tagging code.
- Tests cover EXIF removal, orientation, PNG/JPEG/WebP inputs, invalid images, cleanup after failure and the fact that the stored bytes are not the source bytes.

### 3. Complete data purge

Add a local-only `POST /api/data/purge` protected by the same-site JSON guard and a two-step confirmation in History. It is absent from the static showcase.

The purge covers only these known locations under `MONTAGIO_DATA`: `uploads`, `generations`, `sequences`, `jobs`, `community`, `characters`, `shares`, `comfy-outputs`, `demo-renders`, `tmp`, and Montagio's temporary `remix-link-*` / `remix-sample-*` directories. It does not recursively delete the data root itself or an unlisted directory.

- A single process-wide purge state prevents new uploads/renders and concurrent purges. Creation paths return a stable 409 while a purge runs.
- If any generation, sequence, job, caption export, share render or link import is active, the route returns `data-busy` and deletes nothing. The user waits or cancels first.
- Remote deletion runs before local deletion. The Comfy backend gathers the asset ids attached to recorded backend jobs, including uploaded `core/ASSET` references and job outputs, and calls the SDK's authenticated asset deletion. Missing assets count as already gone; unreachable proxies, unsupported deletion and unreadable legacy records do not.
- If any remote asset cannot be checked or deleted, the purge returns `remote-purge-incomplete`, leaves local records intact for retry and tells the user how to finish on the remote machine. It never prints a success message.
- Only after remote success does the server remove the listed local directories. The UI clears its state and shows an empty History. A second purge on an empty install succeeds.
- Tests prove that active work blocks the operation, cross-site requests fail, remote failure preserves local data, all listed folders are removed, unlisted folders survive, ids cannot select arbitrary paths, and a restart leaves no purged history.

### 4. Authenticated and encrypted proxy channel

- `MONTAGIO_BACKEND=local` requires a non-empty `MONTAGIO_PROXY_TOKEN`; no local or remote proxy is contacted without it.
- A loopback `COMFY_BASE_URL` may use HTTP, supporting a local proxy or SSH tunnel. A non-loopback URL must use HTTPS.
- The CLI validates the same rules at install/start and gives an actionable error before any file is uploaded.
- The Runpod/Modal bootstrap accepts or generates a strong proxy token, stores it with owner-only permissions where applicable, starts comfy-api-proxy with `--token` and tells the user to configure the same token on the app. Existing public `--expose-ui` development options remain explicitly outside the supported private-data workflow.
- The origin-restricted fetch continues to send the bearer token only to the configured proxy origin.
- Tests cover missing tokens, remote HTTP refusal, HTTPS acceptance, loopback HTTP with token, redirect token containment and startup validation.

### 5. Export privacy notice and docs

- Keep recipes enabled. Add a short bilingual notice near download/share controls: exports carry the recipe, including entered text and SHA-256 input hashes, but not source media or local paths.
- Update `README.md`, `SECURITY.md`, `docs/INSTALL.md` and relevant launch notes: metadata is stripped at upload, purge semantics and limitations, proxy requirements, single-user boundary and export contents.
- Remove fixed items from the accepted-risk list and add only the remaining truthful limitations. No claim of zero risk or guaranteed secure deletion from SSD snapshots, filesystem journals, backups or a remote provider's own copies.

## Left to the builder

- Exact function/module names for the purge coordinator and backend asset collection.
- The precise decoded-pixel and normalized-PNG limits, within a range suitable for current phone images and the existing models.
- The exact UI placement and styling, using the existing History and SharePanel components and translation files.
- Whether legacy remote records can be enumerated through the installed SDK version; if they cannot, use the documented incomplete-purge path rather than guessing.
