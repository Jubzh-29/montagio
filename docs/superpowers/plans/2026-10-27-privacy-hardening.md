# Privacy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the local Studio's media lifecycle and remote-proxy privacy before publishing the repository and static showcase.

**Architecture:** FFmpeg normalizes new photo uploads, the Comfy adapter owns authenticated remote asset deletion, and a web purge coordinator blocks active work before deleting remote assets and known local data directories. The existing static showcase and recipe format remain unchanged.

**Tech Stack:** TypeScript, Next.js route handlers, Vitest, FFmpeg, `@comfyorg/sdk`, Bash bootstrap scripts, yt-dlp release pins.

**Spec:** `docs/superpowers/specs/2026-10-27-privacy-hardening-design.md`

## Global Constraints

- Public deployment is the repository plus the static, upload-free showcase; no accounts or hosted multi-user Studio.
- No new runtime dependency, no change to recipe schema, no arbitrary recursive deletion and no purge reported as successful after an unchecked remote failure.
- Keep loopback HTTP only with a token; non-loopback proxy URLs require HTTPS and a token.
- Every added mutating route uses the existing same-site guard and is covered by `route-guards.test.ts`.
- Use TDD and run one heavy suite at a time.
- No commit, merge, push, deployment or contest submission without explicit approval.

## Review Focus

- A rotated JPEG carrying GPS EXIF must become upright PNG pixels with no source metadata (`image-upload.test.ts`, Task 3).
- A tiny compressed image with excessive decoded dimensions must be refused before FFmpeg decode (`image-upload.test.ts`, Task 3).
- A remote 404 means an asset/job is already gone; a 500, timeout or 405 aborts the purge without local deletion (`comfy.test.ts`, `data-purge.test.ts`, Tasks 4–5).
- Active work or a second purge must leave every file untouched, and a cross-site purge must be refused (`data-purge.test.ts`, `route-guards.test.ts`, Task 5).
- Unlisted directories and files outside `MONTAGIO_DATA` must survive a successful purge (`data-purge.test.ts`, Task 5).
- A non-loopback HTTP proxy, missing token or cross-origin redirect must be rejected before media or credentials are sent (`demo.test.ts`, `comfy.test.ts`, Task 2).

---

### Task 1: yt-dlp security release

**Files:**
- Modify: `infra/runpod/versions.env:48-53`
- Modify: `infra/local/test/pins.test.ts`
- Modify: `SECURITY.md`, `docs/INSTALL.md`
- Test: `infra/local/test/pins.test.ts`

**Interfaces:**
- Consumes: official yt-dlp `2026.10.26` release and `SHA2-256SUMS`.
- Produces: matching `YTDLP_VERSION`, `YTDLP_SHA256_WINDOWS` and `YTDLP_SHA256_LINUX` pins.

- [ ] **Step 1: Write the failing pin test**

Add `the pinned yt-dlp carries the 2026.10.26 security fixes`, asserting version `2026.10.26` and the two official hashes read from the release checksums.

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run --globals test/pins.test.ts` from `infra/local`.
Expected: FAIL on the old `2026.10.21` pin.

- [ ] **Step 3: Update the pins and docs**

Download the official release checksums, independently match the Windows and Linux binary hashes, update `versions.env` and replace documented yt-dlp version claims. Do not derive a pin from an unverified local binary.

- [ ] **Step 4: Verify the pins and installer tests**

Run: `npx vitest run --globals test/pins.test.ts test/install.test.ts` from `infra/local`.
Expected: PASS.

- [ ] **Step 5: Update the maintainer binary**

Run `yt-dlp -U` only after repository pins pass, then `yt-dlp --version`.
Expected: `2026.10.26`; if the binary cannot self-update, report the remaining manual update rather than changing the result.

### Task 2: Authenticated proxy channel

**Files:**
- Modify: `packages/comfy-adapter/src/factory.ts`
- Modify: `packages/comfy-adapter/test/demo.test.ts`
- Modify: `packages/comfy-adapter/test/comfy.test.ts`
- Modify: `infra/local/src/cli.ts:133-143`
- Modify: `infra/local/test/cli.test.ts`
- Modify: `infra/runpod/bootstrap.sh:298-312`
- Modify: `infra/runpod/test/bootstrap.test.ts`
- Modify: `infra/runpod/README.md`, `infra/modal/README.md`

**Interfaces:**
- Consumes: `COMFY_BASE_URL`, `MONTAGIO_PROXY_TOKEN`, `assertLocalBaseUrl(raw)`.
- Produces: `createBackend(...)` rejects a missing token and non-loopback HTTP before constructing `ComfyBackend`; bootstrap starts the proxy with the same token.

- [ ] **Step 1: Write failing adapter and CLI tests**

Cover: local backend without token throws `/MONTAGIO_PROXY_TOKEN/`; remote `http://` throws even with a token; remote `https://` with a token is accepted; loopback HTTP with a token remains accepted. Add the equivalent `--proxy-url` CLI validation tests and a bootstrap assertion for `--token "$MONTAGIO_PROXY_TOKEN"`.

- [ ] **Step 2: Verify the new tests fail**

Run: `npx vitest run --globals test/demo.test.ts` from `packages/comfy-adapter`, `npx vitest run --globals test/cli.test.ts` from `infra/local`, and `npx vitest run --globals test/bootstrap.test.ts` from `infra/runpod`.
Expected: FAIL on missing-token and remote-HTTP cases.

- [ ] **Step 3: Enforce the rules centrally**

In `createBackend`, trim the token, require it for every local backend and reject `target.url.protocol === 'http:' && !target.loopback`. Mirror actionable validation in the CLI. In bootstrap, require or generate a 32-byte random token, store it under `$RUN_DIR` with mode 600, pass it to `comfy-api-proxy --token`, and document how the app-only install receives it. Never log the token.

- [ ] **Step 4: Verify channel tests**

Run adapter, infra-local and infra-runpod targeted tests.
Expected: PASS; existing origin and redirect tests still prove the token stays on the configured origin.

### Task 3: Metadata-free photo uploads

**Files:**
- Create: `packages/sequence/src/image-upload.ts`
- Modify: `packages/sequence/src/index.ts`
- Create: `packages/sequence/test/image-upload.test.ts`
- Modify: `apps/web/src/server/uploads.ts:40-80`
- Modify: `apps/web/test/api.test.ts` and image-upload fixtures as needed

**Interfaces:**
- Consumes: existing FFmpeg tool wrapper conventions and a sniffed source image.
- Produces: `normalizeUploadedImage(input: string, output: string): Promise<void>`; `MAX_IMAGE_PIXELS = 40_000_000`; `MAX_NORMALIZED_IMAGE_BYTES = 25 * 1024 * 1024`.

- [ ] **Step 1: Write failing normalization tests**

Use real FFmpeg-generated PNG/JPEG/WebP fixtures. Assert: rotated JPEG with EXIF/GPS becomes upright PNG without EXIF/text tags; stored bytes differ from source; PNG and WebP remain readable; invalid input and 40,000,001+ pixels fail; output over 25 MiB and FFmpeg failure leave no output.

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run --globals test/image-upload.test.ts` from `packages/sequence`.
Expected: FAIL because `normalizeUploadedImage` does not exist.

- [ ] **Step 3: Implement bounded FFmpeg normalization**

Export a shell-free helper using `-protocol_whitelist file`, only the necessary image demuxers/decoders, one frame, autorotation, `-map_metadata -1` and PNG output. Refuse dimensions before decoding, remove partial output on every failure and enforce the normalized-size cap.

- [ ] **Step 4: Route only user uploads through normalization**

In `saveUpload`, validate/sniff first, normalize into the uploads directory, then read final dimensions from the normalized PNG and store `uploads/<uuid>.png` plus its JSON. Keep `saveUploadFromFile` on the existing server-generated path and clean temporary files in `finally`.

- [ ] **Step 5: Verify image and web tests**

Run the new sequence test and web tests covering `/api/uploads`.
Expected: PASS; existing type/size/cross-site checks remain intact.

### Task 4: Remote asset deletion in the adapter

**Files:**
- Modify: `packages/comfy-adapter/src/backend.ts:42-51`
- Modify: `packages/comfy-adapter/src/demo.ts`
- Modify: `packages/comfy-adapter/src/comfy.ts`
- Modify: `packages/comfy-adapter/src/testing/fake-proxy.ts`
- Modify: `packages/comfy-adapter/test/comfy.test.ts`

**Interfaces:**
- Consumes: recorded backend job ids and authenticated `Comfy` client.
- Produces: `GenerationBackend.purge(backendJobIds: readonly string[]): Promise<void>` and `RemotePurgeError extends Error`.

- [ ] **Step 1: Write failing backend purge tests**

Seed fake jobs with uploaded `core/ASSET` references and output asset ids. Assert both are deleted, duplicate ids are deleted once, job/asset 404 is ignored, and 405/500/network failure throws `RemotePurgeError`. Demo purge resolves without changing demo behavior.

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run --globals test/comfy.test.ts` from `packages/comfy-adapter`.
Expected: FAIL because `purge` is not implemented.

- [ ] **Step 3: Implement recursive asset collection and deletion**

For each id, call `client.jobs.get(id)`, recursively collect every `core/ASSET` id from `job.getWorkflow()` and add `job.outputs.map(output => output.id)`. Delete each unique id through `client.assets.delete(id)`. Treat only missing job/asset as already gone; wrap every other failure in `RemotePurgeError` without leaking tokens or local paths.

- [ ] **Step 4: Verify adapter tests**

Run the full `packages/comfy-adapter` test suite.
Expected: PASS, including existing submission, download and token-containment tests.

### Task 5: Coordinated purge route and History UI

**Files:**
- Create: `apps/web/src/server/data-purge.ts`
- Create: `apps/web/src/app/api/data/purge/route.ts`
- Create: `apps/web/test/data-purge.test.ts`
- Modify: `apps/web/src/server/job-route.ts`, creation/upload entry points, `share.ts`, `link-import.ts`
- Modify: `apps/web/src/components/HistoryPage.tsx`, `history.module.css`
- Modify: `apps/web/src/i18n/en.json`, `fr.json`
- Modify: `apps/web/test/route-guards.test.ts`

**Interfaces:**
- Consumes: `GenerationBackend.purge(...)`, stored generations/jobs/sequences and active work states.
- Produces: `purgeStudioData(): Promise<void>`, `assertDataWritable(): void`, `DataPurgeError` codes `data-busy | data-purging | remote-purge-incomplete`; `POST /api/data/purge` returns 204 on success, 409 for busy/concurrent, 403 cross-site and 502 for unchecked remote failure.

- [ ] **Step 1: Write failing purge coordinator tests**

Seed every listed directory plus an unlisted `keep.txt` and outside file. Cover: successful purge removes exactly `uploads`, `generations`, `sequences`, `jobs`, `community`, `characters`, `shares`, `comfy-outputs`, `demo-renders`, `tmp`, `remix-link-*` and `remix-sample-*`; empty purge succeeds; outside/unlisted files survive; active work and concurrent purge leave everything; remote failure leaves local state; all backend ids reach the adapter.

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run --globals test/data-purge.test.ts` from `apps/web`.
Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement the two-phase coordinator**

Use a `globalThis` purge promise/state. Reject active generations, sequences, jobs, running shares and link imports before remote deletion. Gather generation backend ids and all job-step backend ids, await `backend.purge(ids)`, then remove only the named paths. Call `assertDataWritable()` at every data-creating entry point, including `jobCreationRoute`, generation/sequence creation, uploads, character/community creation, caption exports and shares.

- [ ] **Step 4: Add the guarded route and failing UI test**

Implement JSON-only `namesThisSite`/`fromThisSite` protection and stable error mapping. Extend `route-guards.test.ts` to cover the new route. Add the History test for a two-step exact-phrase confirmation, busy/error display and cleared list after success; verify it fails before the UI.

- [ ] **Step 5: Implement the History control**

Add a non-showcase “Delete my data” control requiring the exact `DELETE`/`EFFACER` confirmation phrase. Disable it during the request, show the returned refusal, and clear local History/community state only after 204. Reuse existing styles and add only the necessary layout rule.

- [ ] **Step 6: Verify web purge tests**

Run `data-purge.test.ts`, `route-guards.test.ts`, `history.test.ts` and relevant upload/community/share suites.
Expected: PASS; no creation path can recreate data during the purge.

### Task 6: Export notices, documentation and release verification

**Files:**
- Modify: `apps/web/src/components/SharePanel.tsx`
- Modify: `apps/web/src/components/HistoryPage.tsx`
- Modify: `apps/web/src/i18n/en.json`, `fr.json`
- Modify: `README.md`, `SECURITY.md`, `docs/INSTALL.md`
- Modify: `apps/web/test/headers.test.ts` or focused UI/copy tests as appropriate

**Interfaces:**
- Consumes: completed upload, purge and proxy behavior.
- Produces: bilingual notice that exports include entered text and SHA-256 input hashes, never source media or local paths; documentation matching the implementation.

- [ ] **Step 1: Add failing copy assertions**

Assert both translation files contain the export-recipe warning and purge confirmation/error strings, and that the non-showcase SharePanel renders the warning while the static showcase does not add a server-only purge control.

- [ ] **Step 2: Implement the notices and documentation**

Add concise bilingual notices near download/share controls. Document metadata normalization, exact purge semantics, remote-incomplete behavior, token/HTTPS requirements, export contents and the remaining SSD/backup/provider-copy limitations. Remove fixed accepted risks without claiming zero risk.

- [ ] **Step 3: Run focused checks**

Run translation/UI tests, `npm run typecheck`, `npm run lint -w @montagio/web`, `npm audit` and `npm audit --omit=dev`.
Expected: PASS and zero known npm advisories.

- [ ] **Step 4: Run complete verification sequentially**

Run `npm test`, `npm run test:nodes`, `npm run test:modal`, `npm run check:open-stack`, and the existing showcase build/test commands needed for publication.
Expected: all PASS. Do not publish. Report any unrun Python `pip-audit` or real-proxy deletion test explicitly.

- [ ] **Step 5: Inspect the final diff**

Run `git diff --check`, `git status --short` and review every changed file against the spec. Verify no token, personal media, local path or generated build output was added, and leave the working tree uncommitted for the user's publication decision.
