# Neutral study bootstrap and current-candidate preparation

Date: 2026-09-23 JST. Scope: Cycle 0018 T6, preceding integration. This is source/renderer verification, not final acceptance or ordinary-installed verification of the new 0.2.2 candidate.

## Observed defect and repair

The [unchanged v28 report](installed-v28-validation.md) retains both-host functional PASS at clean `82c8ea386adf14fa969cd068275460b882b25d94`, VSIX `ef5f57872f4d5a9d084846d6f47b31ed2f60c3928c8e092357c0e96e47468300`. Inspection of Cursor's actual replacement frames reveals `Study the checkout flow`, `No running study` and premature controls before the actual Theme/recording snapshot. The initial HTML exposes hard-coded placeholders while the host-to-renderer handshake is pending. Functional success does not excuse that misleading visible state.

`studyHtml.ts` now exposes a neutral `Loading study…` status while keeping the complete reader hidden and inert. Only the end of a complete typed study render reveals the content, after source, values, recording, controls and actual title have been populated. The empty-selection title is `Codebook study`. The existing ready/rendered handshake, timeouts, focus ownership, runtime and storage contracts are unchanged. No repository answer, expected value or final-review recipe is added to the product.

## Renderer and timeout evidence

- `study-bootstrap-qa.mjs` exercises Context and Observed moments, first paint without JavaScript, initial/replacement documents with a deliberately delayed host snapshot, keyboard input before readiness, the actual Theme article, disabled stopped continuation, revision-bound explicit source actions and empty-selection fallback. Original compiled code passes 4/13 and fails 9/13 checks; repaired code passes **13/13**. The final script with repaired error handling also passes 13/13.
- `study-reading-pose-qa.mjs` retains the original seven semantic-state and newer-input controls and adds real overflowing-value reading with summary/table focus through fresh document replacement. **9/9 pass**. The two preparatory attempts demanded 96px where the actual 330px viewport provides only 14px overflow; these are retained harness failures, not product failures or passes. The corrected preregistered offset is **12px**, and actual table overflow is required before capture. Capture/restore preserves that exact offset, opened disclosure, focus and unchecked understanding with zero runtime/understanding writes.
- All original red/green/reading-pose contact sheets, both expanded reading-pose sheets and the dedicated summary-before/after screenshots were inspected. These use real Chromium and compiled product HTML with simulated host messages. They do not establish ordinary editor behavior. Navigation/replacement blank intervals remain visible; 2fps contact sheets do not prove every intermediate frame or animation smoothness.
- CodeRabbit's first supplement reproduces a valid QA problem: a signal-only `execFile` error has `code: null` and was converted to exit 0. Both affected QA helpers now preserve the full error, log it and reject every non-null error, while keeping the CLI error-marker check. A real Node timeout control produces `SIGTERM`, `killed: true`, `code: null`: the original guard accepts it and both repaired guards reject it. Timeouts cannot provide PASS evidence.

## Checks and review limits

The initial full run passes 909 product/shared tests but package creation rejects the newly bumped 0.2.2 manifest against the old 0.2.1 runtime constant. The runtime constant and real-package expectation are now 0.2.2; synthetic package fixtures remain unchanged. The failed run is retained.

The repaired unchanged cut passes **909 product/shared + 96 package checks**, two builds and all four TypeScript checks. Its **276 selected inputs** have SHA-256 `8258522d45f429934c906cd9155106deefab0a466e5b240d0b59e11438001ee8` before and after all eight steps. A subsequent packaged-README-only update is tracked separately: 275 inputs remain byte-identical, and a fresh **96/96 package suite** passes. The current documented candidate input hash is `bdb8f28bc2ff800a36191b5388ca8996953d8f62b351d111ae7d10b4015827b2`; explicit comparison permits only this README delta before freeze. Product tests are not repeated for prose-only changes; the new candidate/CI record must identify its actual resulting input hash.

CodeRabbit's initial unchanged-cut review completes in 166.183 seconds with one valid finding, repaired later. Its six-file final supplement completes in 143.104 seconds with two duplicate requests to move the QA artifacts into supposedly active Cycle 0017. Current `PROJECT_STATE.md`, the Cycle 0018 record and Issue #23 establish that premise as false; retain the raw findings and rejected triage. **Zero actionable findings remain in that supplement**, not zero raw findings or complete independent acceptance.

The primary ship review's first pass also identifies the version mismatch and timeout guard; it is a fixing pass. Historical H6's three fixing passes remain non-converged. Fresh adversarial dispatches fail with `agent thread limit reached`; this is missing coverage, not a clean review. The separate coverage audit assesses 28/30 bounded behavior groups, not instrumented line coverage; its renderer gap is now tested, while current-candidate installed proof remains pending. Claude Code CLI review stays owner-skipped. No development review is included in the final ten.

## Next gate

Freeze a clean 0.2.2 candidate and its VSIX/schedule/helper hashes, normally install the same archive into fresh protected Cursor and VS Code profiles, then run the existing expanded functional schedule sequentially. Inspect loading/replacement video frames, retain failed attempts and verify original files/drafts plus complete owned-resource cleanup. Do not merge this initial-state repair based only on the renderer fixture. G12 remains unimplemented; final counts remain **0/10 reviewers, 0/at least 20 editor trials, not started**, with all owner acceptance and Issue #1 requirements intact.

## Private artifacts

The [sanitized manifest](bootstrap-loading-manifest.json) lists immutable paths, byte counts and SHA-256 identities under `artifacts/cycle-0018/bootstrap-renderer/`. Product/source checks, browser videos, provider raw/triage records and timeout controls remain separate. No connection credentials or native profile contents are included in public changes.
