# Shared presentation design review

Status: **DONE_WITH_CONCERNS**. Two medium findings were repaired and verified in the bounded compiled webview. The host-native evidence has separate source/environment qualifications. Outside Claude Code design review timed out; full installed-product UX acceptance remains open.

Design score: **A → A** (weighted rounding). AI slop score: **A → A**. The two affected categories each improve **A− → A**; the aggregate letter conceals that small improvement. This grade applies only to the inspected presentation controls and states, not every final product requirement.

| Category | Weight | Before | Final |
| --- | --- | --- | --- |
| Visual hierarchy | 15% | A | A |
| Typography | 15% | A | A |
| Spacing and layout | 15% | A | A |
| Color and contrast | 10% | A | A |
| Interaction states | 10% | A− | A |
| Responsive | 10% | A | A |
| Content quality | 10% | A− | A |
| AI slop | 5% | A | A |
| Motion | 5% | A | A |
| Performance feel | 5% | A | A |

First impression: the selected subject, paused-runtime control and useful explanation are legible before secondary controls. Study and Guided emphasize operating; Living emphasizes reading. Overview, Live and Recording remain independent from presentation geometry. Native theme tokens and the approved DESIGN.md hierarchy supply the visual baseline.

## Findings

**FINDING-001 — medium, content quality.** A pending or failed recording was hidden inside a collapsed Evidence disclosure whose summary could report observation success. Commit `c7cb14c` moves recording persistence status outside that disclosure. Before/after rendered screenshots verify visible recovery information without opening Evidence. File changed: `extension/src/ui/studyHtml.ts`. Fix status: verified. Private images: `screenshots/finding-001-before.png` and `screenshots/finding-001-after.png` in the project audit directory.

**FINDING-002 — medium, interaction.** Disabling the focused native mode selector dropped keyboard focus, and a saved earlier focus could overwrite a later learner choice. Commit `fc3d1b5` keeps the busy selector focusable with ARIA state and retains later focus choices. The request guard still rejects repeated pending input. Rendered interaction recordings and before/after contact sheets verify the fix; native source/reading focus and selector checks have separately versioned receipts. File changed: `extension/src/ui/studyHtml.ts`. Fix status: verified. Private images: `screenshots/finding-002-before-contact.png` and `screenshots/finding-002-after-contact.png`.

Total confirmed findings: 2. Verified fixes: 2; best-effort: 0; reverted: 0; deferred confirmed design findings: 0. No target mockup was generated, so image-to-mockup verification is not applicable. No repository TODOS.md exists to update.

## Browser, detector and native evidence

The existing loopback adapter at `http://127.0.0.1:62814/` renders the compiled product UI with a synthetic controller. GStack's own browser is the declared fallback because Aside is unavailable. Responsive views cover 375, 768 and 1440px; final functional QA passes **118/118** assertions in 24 mode/theme/geometry cells. The adapter cannot certify debugger, storage or native placement. Its captured wall-clock deadline is synthetic, not an observed expired live run.

Detector: **36 → 36 raw hits**, engine 0.1.3, one low-contrast rule; **zero confirmed product defects** from those rows. The scanner treats a `#aaaaaa` fallback as white-background text. Rendered adapter text is `rgb(85,85,85)`, and actual VS Code Light Modern uses the injected native theme values. This is a static scan of the rendered DOM; cross-origin CSS is not resolved. The three final DOM files passed redaction, then were deleted as required. Raw scan JSON and receipts remain. The previous Cycle 0009 baseline has no detector scan and a different surface; no cross-cycle detector delta is claimed.

Native configured runs in both editors verify all three live/replay transfers and 15 theme/zoom cells each, plus source and reading focus. Root inspected recorded frame sequences. Cursor's final 200% screencast is cropped/padded, so those frames are not full-window motion proof. A background-window focus expectation also failed, then passed with an actual native click and explicit focused-document preconditions. These limitations and retained earlier attempts are detailed in [native validation](native-validation-20260921.md).

The in-host design source review completed. The separate Claude Code design invocation timed out after 300000ms; no outside score or PASS exists. This missing coverage remains visible in the review log. Native host console errors are not relabeled as an error-free application console merely because Codebook's own Study errors are empty.

## Artifacts and regression

Primary local report: `~/.gstack/projects/codebook/designs/design-audit-20260920/design-audit-codebook-cycle0014.md`; mirrored under `.gstack/design-reports/`. Run ID: `cycle14-1418`. Responsive screenshots, rendered metrics, both finding pairs, detector JSON, per-run baseline and index pointer remain there. The manifest hashes the portable subset and private evidence receipts. The two old Cycle 0009 findings sets retain their prior scope; the current baseline does not rewrite them.

PR summary: Design review found two issues and verified both fixes; design score A → A and AI slop A → A within the bounded UI, with outside review and full-window 200% motion coverage qualified.
