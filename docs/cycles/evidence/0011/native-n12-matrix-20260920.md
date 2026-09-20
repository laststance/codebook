# Native N12 matrix and v25 repair — in progress

This report continues the [bounded v23/v24 repair](native-n12-20260920.md). Cycle 0011 remains validating; display cells, individual fixes and whole-product acceptance are separate. The [new matrix manifest](native-n12-matrix-manifest-20260920.json) preserves these artifacts without changing the previously frozen 115-item manifest.

## Source and saved validation

- v24: inventory `44a2f18783e6429615f8d01bb0c5cb504079b7e7b2a848e68c2e7681fa30e55a`, source-equivalent to `e3a98de`; VS Code executed 12 display cells. These are historical evidence for that source, not additional v25 coverage.
- v25: dirty base `f5fffa425edd54910909fad7caba74c5b1db9208`, inventory `01ab8314623fbd15fe2126575c4ebcf6bffe01a6a8862caff6a219447193705e`, 232 entries. Only `extension/src/ui/constants.ts` and `extension/src/ui/studyHtml.ts` differ from HEAD: 10 insertions / 3 deletions. All 232 hashes and the compiled manifest were rechecked on restore.
- Saved v25 test log: 464 passed, zero failed/cancelled/skipped/todo, 29614.655083 ms; saved typecheck exit 0. No new test run is implied by re-reading these records.
- CodeRabbit CLI completed the two-file repair review with zero findings. OCR reviewed both eligible files, skipped none and found no additional issue; OCR is a host-agent review, not another external provider. A reused independent static reviewer found no actionable issue and explicitly retained native contrast/focus gates. None counts toward final-product reviews, which remain 0/10.

## Findings and bounded repair

| Finding | Observed failure | v25 change | Current evidence |
| --- | --- | --- | --- |
| ISSUE-N12-003 | Actual Light Modern error text used `#f85149` on white, 3.3522381389977385:1 at 16px. | Use the editor error foreground, falling back to normal foreground. | Actual visible text still requires measured 4.5:1 in all four themes and both hosts; choosing a token does not prove contrast. |
| ISSUE-N12-004 | Actual Tab reached the native scroll container, but its header at y132–169 was entirely behind the sticky strip at y0–169. Horizontal ArrowRight worked; two ArrowUp presses revealed the header. | Reserve measured sticky height plus a 4px focus margin with root scroll padding; static/hidden/moments controls reserve only the margin. | Four v25 VS Code constrained cells show the header below the strip and horizontal movement 0 → 18 → 0. Wide, 200%, Cursor and static/hidden transitions remain open. |
| ISSUE-N12-005, investigation pending | Restored v25 video inspection shows `The editor could not restore the saved reading layout` during observation entry; captured app and context occupy the visible editor groups while source is hidden in a tab. | No fix claimed. | Present in the four saved constrained flows. Reproduce on a fresh owned profile and distinguish recovery from manually retained layout before accepting app/source correspondence. The matrix helper's `passed: true` does not cover this failure. |

## Native observations

v24 directory: `artifacts/cycle-0011/native/vscode/2026-09-20T05-46-41.726Z-e47266eb`. Four themes × wide/constrained/200% produced 12 cells; saved root and independent image reviews identified 003/004. The status-only secondary-citation mutation preserved focused DOM/rectangle/scroll/tabs/facts/checked state and the exact ledger through change/restoration. Its screenshots caught transient outline state, so they do not prove settled whole-window recovery. Failed navigation, detached-frame, theme-name and overlapping-command probes remain diagnostic artifacts, not product passes.

v25 directory: `artifacts/cycle-0011/native/vscode/2026-09-20T06-15-21.785Z-e0b0f0a1`. VS Code 1.138.0 / API 1.138.0 / js-debug 1.117.0, Electron 42.10.0, Node 24.18.1. Four constrained cells use 1000×900 CSS with a 326×508 Context webview. Their table header y216.5–253.5 lies below the sticky strip y0–169; root scroll padding is 173px. The earlier 306px setup probe is not a fifth qualifying cell.

On restore the driving agent extracted eight frames from each of the four v25 matrix videos (4.00–4.04s), inspected all four contact sheets and the full-size Light table-focus image. The focused table and retained checked Wiki return are visible. The same images expose 005 and do not establish app-above-source layout or exact reader pose. Wide/200% and all Cursor v25 cells remain unexecuted. Current v25 execution count is 4/24, not a pass count.

## Environment preservation and restore

The source inventory, 16 critical evidence hashes and all seven original Cycle 0009 backup hashes match the handoff. Both saved editor sessions have exit-code-0 receipts; saved owned PIDs and matching launch processes are absent. The two former native profiles `/tmp/codebook-mcp-71BxQK` and `/tmp/codebook-mcp-0Krbwj` no longer exist. This invalidates the old reload commands as a ready-to-use environment, not the retained videos or measurements. No current persisted learner-library continuity is claimed from a missing profile.

The disposable target repository, v25 expectations, recordings/images and VS Code settings backup remain available. Create a fresh owned profile and source-grounded book/run through the public API; record its new identities and preserve its storage in a durable ignored directory before finishing. Do not fabricate a saved archive or conflate recreated learner history with the earlier ledger. One host and one completed UI command at a time; no product edits/builds during native execution.

## Remaining gates

1. Reproduce and resolve or qualify 005 before accepting the display matrix. Preserve explicit Arrange/manual-layout semantics and exact Wiki return.
2. Complete the remaining v25 geometry/theme cells, actual visible error contrast and sticky/static/hidden offsets. Inspect native screenshots and video frames.
3. Repeat status-only focus/drift/recovery in both hosts; exercise Tab/ShiftTab/arrows/Enter/Space, selectable facts, visited state and reduced motion. Keep intentional learner toggles separately accounted for.
4. Use authentic public runs for missing long-value/title and partial/empty states; never inject DOM or archive values.
5. Reconcile N01–N14 and independent pause-image correspondence; freeze source/reviews/evidence, commit, synchronize Issue #12 and then select the next cycle. G01–G11, both later layouts, packaged installation, intended-use acceptance and ten fresh sequential final reviews remain required.
