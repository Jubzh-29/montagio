# Text Content Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse explicit sexual text throughout Montagio with a default-on, locally optional `blocked-term` guardrail.

**Architecture:** Extend the existing server guard module with a second cached registry list and a unified `assertAllowedText` assertion. Replace the existing text checkpoints, propagate the new stable error through the Studio and MCP, then document the exact local-only opt-out.

**Tech Stack:** TypeScript, Next.js server routes, Vitest, JSON dictionaries, Markdown; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-27-content-filter-design.md`

## Global Constraints

- Work in `montagio-audit` on `fix/content-filter`, based on `main` at `6ff7de7`; keep `main` fast-forward only.
- No image classifier, model download, GPU spend, adult imagery, new dependency, publication, or push.
- `MONTAGIO_CONTENT_FILTER=off` disables only the term filter, only with `MONTAGIO_BACKEND=local`; every other guard stays active.
- Use whole normalized words or phrases, preserving ordinary words that merely contain a listed string.
- Run one heavy suite at a time and check for other test, FFmpeg, or render processes first.
- Do not run Prettier; use the existing ESLint and TypeScript checks.
- No tool or assistant attribution in files or commits.

## Review Focus

- Ordinary text such as `a historic house in Sussex` must not match the term `sex`; pin it in Task 1.
- `MONTAGIO_CONTENT_FILTER=off` in demo mode must still refuse a listed term; pin it in Task 1.
- Local opt-out must not allow a well-known name; pin the error precedence in Task 1.
- A film whose next shot contains a listed term must fail with `blocked-term`, not a polling 500; pin it in Task 3.
- A share file must be checked at import rather than trusted as data; pin a listed term in its title and shot prompt in Task 3.

---

### Task 1: Registry List and Unified Text Guard

**Files:**
- Create: `registry/blocked-terms.txt`
- Modify: `apps/web/src/server/guards.ts`
- Test: `apps/web/test/guards.test.ts`

**Interfaces:**
- Consumes: existing `normalizeForMatch(text: string): string`, `getEnv().root`, and `JobError`.
- Produces: `findBlockedTerm(text: string, terms: readonly string[]): string | null`, `blockedTerms(): Promise<readonly string[]>`, `assertNoBlockedTerm(...texts: (string | undefined)[]): Promise<void>`, and `assertAllowedText(...texts: (string | undefined)[]): Promise<void>`.

- [ ] **Step 1: Write failing matcher and environment tests**

Add tests equivalent to:

```ts
expect(findBlockedTerm('EXPLICIT, SEXUAL content', ['explicit sexual content'])).toBe('explicit sexual content');
expect(findBlockedTerm('a historic house in Sussex', ['sex'])).toBeNull();
expect(findBlockedTerm('un renard roux dans la neige', ['nu', 'nue'])).toBeNull();
```

Test that the repository list is cached per root and excludes comments. Test `assertAllowedText` for ordinary text, `blocked-name`, and `blocked-term`. With `MONTAGIO_BACKEND=local` and `MONTAGIO_CONTENT_FILTER=off`, a listed term passes but `Taylor Swift` still returns `blocked-name`; with backend `demo`, the same `off` value still returns `blocked-term`. Restore both variables after each test.

- [ ] **Step 2: Run the tests and confirm the new API is missing**

Run: `npm test -w @montagio/web -- test/guards.test.ts`
Expected: FAIL because the term matcher/assertions are not exported.

- [ ] **Step 3: Implement the registry and guards**

Add direct English and French explicit sexual terms and common variants, one per line, including the fixtures `sex`, `nu`, `nue`, and `explicit sexual content`; use the existing comment style without claiming completeness. Reuse `normalizeForMatch` for whole-term matching. Cache `blocked-terms.txt` per repository root like the name list. Read the opt-out at call time with an exact trimmed `off` value. `assertAllowedText` calls `assertNoBlockedName` first, then `assertNoBlockedTerm`.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -w @montagio/web -- test/guards.test.ts`
Expected: PASS, including all pre-existing consent and blocked-name tests.

- [ ] **Step 5: Commit Task 1 after plan approval**

```bash
git add registry/blocked-terms.txt apps/web/src/server/guards.ts apps/web/test/guards.test.ts docs/superpowers/specs/2026-10-27-content-filter-design.md docs/superpowers/plans/2026-10-27-content-filter.md
git commit -m "feat: add a unified text content guard"
```

### Task 2: Stable Refusal Across Server, Studio, and MCP

**Files:**
- Modify: `apps/web/src/server/errors.ts`
- Modify: `apps/web/src/server/jobs.ts:476-489`
- Modify: `apps/web/src/lib/refusals.ts`
- Modify: `apps/web/src/i18n/en.json:194`
- Modify: `apps/web/src/i18n/fr.json:194`
- Modify: `packages/mcp/src/errors.ts:12`
- Test: `apps/web/test/refusals.test.ts`
- Create: `packages/mcp/test/errors.test.ts`

**Interfaces:**
- Consumes: `JobError('blocked-term')` from Task 1.
- Produces: HTTP 400 `{ error: 'blocked-term' }`, Studio key `errorBlockedTerm`, and a readable `messageFor('blocked-term')`.

- [ ] **Step 1: Write failing refusal tests**

Add `'blocked-term': 'errorBlockedTerm'` to the photo/effect refusal cases and assert both dictionaries contain the key. Add an MCP test asserting that `messageFor('blocked-term')` explains that explicit sexual text is refused and does not fall back to the generic `The app refused the request` message.

- [ ] **Step 2: Run the tests and confirm the missing mappings**

Run: `npm test -w @montagio/web -- test/refusals.test.ts`
Run: `npm test -w @montagio/mcp -- test/errors.test.ts`
Expected: both FAIL because `blocked-term` has no specific mapping.

- [ ] **Step 3: Add the stable error and messages**

Add `blocked-term` to `JobErrorCode` and the 400 status map. Map it to `errorBlockedTerm`. English: `This text asks for explicit sexual content. Montagio refuses this request.` French: `Ce texte demande un contenu sexuel explicite. Montagio refuse cette demande.` Add the equivalent actionable MCP sentence.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -w @montagio/web -- test/refusals.test.ts`
Run: `npm test -w @montagio/mcp -- test/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/web/src/server/errors.ts apps/web/src/server/jobs.ts apps/web/src/lib/refusals.ts apps/web/src/i18n/en.json apps/web/src/i18n/fr.json apps/web/test/refusals.test.ts packages/mcp/src/errors.ts packages/mcp/test/errors.test.ts
git commit -m "feat: explain blocked-term refusals"
```

### Task 3: Apply the Unified Guard to Every Text Checkpoint

**Files:**
- Modify: every current `assertNoBlockedName` consumer under `apps/web/src/server/`, except its definition in `guards.ts`: `captions.ts`, `characters.ts`, `community.ts`, `generations.ts`, and all listed consumers under `server/tasks/`
- Create: `apps/web/test/blocked-terms.test.ts`
- Modify: `apps/web/test/sequences.test.ts:194-229`

**Interfaces:**
- Consumes: `assertAllowedText(...texts)` from Task 1 and the HTTP/error mappings from Task 2.
- Produces: the existing text checkpoints refuse both blocked names and blocked terms without changing their inputs or timing.

- [ ] **Step 1: Write failing direct-route and share-import tests**

Following `blocked-names.test.ts`, create a sample image and assert that a camera request with `userPrompt: 'explicit sexual content'` returns status 400 and `{ error: 'blocked-term' }`. Add a second test with the normal prompt `a historic house in Sussex` and assert it is not refused with `blocked-term`. For share imports, test the same refusal in the title and separately in a film shot's prompt.

- [ ] **Step 2: Write the failing delayed-sequence test**

Mirror the existing next-shot blocked-name test with a different sequence id and `userPrompt: 'explicit sexual content'`; assert repeated polling leaves the sequence `{ state: 'failed', error: 'blocked-term' }`, never a 500.

- [ ] **Step 3: Run the route tests and confirm terms still pass**

Run: `npm test -w @montagio/web -- test/blocked-terms.test.ts test/sequences.test.ts`
Expected: the new `blocked-term` cases FAIL; existing tests remain green.

- [ ] **Step 4: Replace all checkpoint calls**

Rename every consumer import and call from `assertNoBlockedName` to `assertAllowedText`, preserving argument order. Keep `assertNoBlockedName` exported for its focused tests and for `assertAllowedText`. Confirm no old consumer remains with `Grep` for `assertNoBlockedName` under `apps/web/src/server`; only `guards.ts` may remain.

- [ ] **Step 5: Run route and existing blocked-name coverage**

Run: `npm test -w @montagio/web -- test/blocked-terms.test.ts test/blocked-names.test.ts test/sequences.test.ts`
Expected: PASS, including the normal Sussex prompt and repeated sequence polling.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/web/src/server apps/web/test/blocked-terms.test.ts apps/web/test/sequences.test.ts
git commit -m "feat: filter explicit text across render requests"
```

### Task 4: Document Behavior and Limits

**Files:**
- Modify: `README.md:291-303`
- Modify: `SECURITY.md:70-78`
- Modify: `docs/INSTALL.md:224-237`

**Interfaces:**
- Consumes: the implemented behavior from Tasks 1–3.
- Produces: user-facing documentation of the default filter, exact opt-out, and good-faith limitation.

- [ ] **Step 1: Update responsible-use and security text**

In the README, describe the term list beside the name list and replace `No content filter is imposed on your own machine` with the default-on behavior and local-only opt-out. In `SECURITY.md`, document `registry/blocked-terms.txt`, all existing text checkpoints, HTTP 400 `blocked-term`, and the fact that disabling it leaves every other guard unchanged. Keep the good-faith limitation explicit.

- [ ] **Step 2: Document the environment variable**

Add `MONTAGIO_CONTENT_FILTER` to the install variable table: exact lowercase `off`, effective only when `MONTAGIO_BACKEND=local`, ignored in demo, and no effect on name, consent, rights, host, or file checks.

- [ ] **Step 3: Check the documentation diff**

Run: `git diff --check && git diff --stat`
Expected: no whitespace errors; only intended filter files and documents are changed.

- [ ] **Step 4: Commit Task 4**

```bash
git add README.md SECURITY.md docs/INSTALL.md
git commit -m "docs: describe the text content filter"
```

### Task 5: Full Verification and Delivery Review

**Files:**
- Review: all changes on `fix/content-filter` against `main`

**Interfaces:**
- Consumes: the complete Task 1–4 branch.
- Produces: a verified branch ready for a separate fast-forward decision; no push or merge is performed by this task.

- [ ] **Step 1: Run static and focused checks sequentially**

Confirm no other heavy suite or render is running. From the worktree root, run `npm run typecheck`, then `npm run lint -w @montagio/web`, then the focused web and MCP tests from Tasks 1–3. Expected: all PASS.

- [ ] **Step 2: Run the repository suites one at a time**

Run, in order: `npm test`, `npm run test:nodes`, `npm run check:open-stack`, and `npm run showcase -- verify --strict`. Expected: all PASS; record the test counts rather than assuming the previous counts.

- [ ] **Step 3: Run browser suites one at a time**

Run `npm run e2e -w @montagio/web`, then `npm run e2e:local -w @montagio/web`. Expected: all PASS. If a known load-sensitive test fails, inspect its trace and rerun only that test alone before deciding whether it is a regression.

- [ ] **Step 4: Inspect the final branch**

Run `git status --short --branch`, `git diff --check main...HEAD`, `git diff --stat main...HEAD`, and review `git log --oneline main..HEAD`. Expected: clean worktree, no whitespace errors, only the approved filter changes, and no attribution or unrelated launch edits. Report verification evidence and leave the fast-forward to `main` for explicit approval.
