# Text content filter design

## Intent

Add the requested first content-filter lot before publication: refuse explicit sexual text throughout Montagio while preserving ordinary prompts and the existing consent and well-known-person guardrails. This is a good-faith textual guardrail, not a claim of complete moderation.

## Goals

- Add `registry/blocked-terms.txt`, with one term or phrase per line and support for comments.
- Apply the same normalized, whole-word or whole-phrase matching used by `blocked-names.txt`.
- Return HTTP 400 with the stable code `blocked-term`, translated in the Studio and understood by the MCP client.
- Cover every text currently checked by `assertNoBlockedName`, including delayed task checks and imported share files.
- Keep the filter enabled by default. `MONTAGIO_CONTENT_FILTER=off` disables only this term filter when `MONTAGIO_BACKEND=local`; it is ignored otherwise.
- Document the behavior and its limits in `README.md`, `SECURITY.md`, and `docs/INSTALL.md`.

## Non-goals and anti-goals

- No image classifier, model download, GPU spend, or adult test imagery in this lot.
- No new UI beyond the refusal message, no new feature, and no publication.
- No claim that a text list detects every explicit request or makes generated media safe.
- No false positives from a blocked term merely appearing inside a longer ordinary word.
- Disabling the term filter must not disable consent, rights, well-known-name, host, or file checks.

## Constraints

- Work on `fix/content-filter` in `montagio-audit`, based on `main` at `6ff7de7`.
- Reuse the existing server guard path and project conventions; add no dependency.
- Keep `main` fast-forward only and run one heavy verification suite at a time.
- Do not push, publish, commit, or change launch URLs without explicit approval.

## Approaches

1. **Chosen: unified text guard.** Keep the focused name and term matchers, add `assertAllowedText` that runs both, and use it at every existing text checkpoint. This preserves clear names and makes route coverage explicit. Name checks run first, so existing `blocked-name` behavior remains stable.
2. Extend `assertNoBlockedName` to include terms. This has the smallest diff but leaves a misleading function name.
3. Inspect all HTTP bodies in middleware. This is broader than prompt text, risks unrelated false positives, and does not naturally cover later task checkpoints.

## Design

- `guards.ts` owns both cached registry lists, normalized matching, the local-only opt-out, and the unified assertion. The opt-out is read at request time so tests and restarts observe the current environment.
- Existing call sites move from `assertNoBlockedName` to `assertAllowedText` without changing their inputs or timing.
- `blocked-term` joins the server error union, HTTP status mapping, Studio refusal mapping, English and French messages, and MCP error mapping.
- Unit tests cover matching boundaries, ordinary text, registry loading, both error codes, and local versus demo opt-out behavior. Route tests cover representative direct, delayed-task, and share-import paths; existing blocked-name route coverage verifies that every checkpoint uses the shared guard.
- Documentation describes the default filter, exact local opt-out, whole-text scope, and good-faith limitation. The previous statement that no content filter exists is removed.

Left to the builder: the exact registry entries and normal-language fixtures, provided they exercise explicit terms, punctuation, accents, case, multiword phrases, and substring false positives without using adult imagery.
