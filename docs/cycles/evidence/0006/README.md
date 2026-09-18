# Cycle 0006 evidence

Clean implementation: [`c873b43`](https://github.com/laststance/codebook/commit/c873b43a0d744c539b4fff8d5ea4080aa3146bda). Source fingerprint: `f9836a7d23a8b9cdacb0b6babfcd0927aa443b2808969640e53e8d13b9345d46`. Both host matrices launched with an empty working tree. [Verification](verification.json), [provenance](provenance.json) and [file checksums](SHA256SUMS) identify the candidate and the derived shared artifacts.

The connected reader and durable learning mechanisms are demonstrated on `paired-cart-demo`. The complete native usability hypothesis remains **inconclusive**: an independently observed editor window was unavailable while the desktop was locked. Native API assertions, renderer acknowledgments, browser-tested webview HTML and page PNGs are distinct evidence; none substitutes for that missing check.

| Check | VS Code 1.138.0 | Cursor 3.21.12 / API 1.128.0 |
| --- | --- | --- |
| Learner normal | [PASS](vscode/normal/result.json); runtime demonstrated | [PASS](cursor/normal/result.json); runtime demonstrated |
| History / personal check | [PASS](vscode/history/result.json); deliberately partial capture | [PASS](cursor/history/result.json); deliberately partial capture |
| MCP normal / 40-second hold / source drift | [3/3 PASS](mcp-regressions/vscode/results.json) | [3/3 PASS](mcp-regressions/cursor/results.json) |
| Hold / control response | 40004.86 / 2.86 ms | 40005.64 / 3.00 ms |
| Independent native pixels / constrained window | Unverified | Unverified |

The learner cases exercise MCP-first attachment, active captured source after moving its group, outline selection, historical inspection without continuing another pause, exact source/value/explanation correspondence, closing without losing an unrelated dirty draft, final archival checkpoint and reload without a running application. Normal runs have two observed items, two grounded interpretations and no automatically checked item. History runs retain one explicit learner decision; hiding the live page deliberately prevents a pause-frame visibility receipt, so their outcome stays partial.

Local validation: **63 product, 44 shared and 28 paired tests** in [tests](tests/); **27 actual webview interaction checks** and five theme/size/scale configurations in [webview QA](webview-qa/report.md). Browser-driver acknowledgment ordering was diagnosed separately from product behavior. The browser tests do not establish native editor layout or installed-extension acceptance.

Three implementation fixing passes repaired **23 distinct findings**, with zero confirmed unresolved findings. [Review summary](review-summary.json) and [per-pass records](review/) retain the limitations: the three-pass limit was reached without convergence; only the first testing specialist had fresh context, later lenses reused named agents after the thread limit; no outside-provider result exists. These are development reviews, **not any of the final ten reviews**. Final-product gate remains **0/10, not started**.

[Attempts](attempts.json) preserves unsuccessful and intermediate runs with their dirty revisions. The final clean matrix supersedes their success claims without deleting their history. Raw evidence remains under ignored `artifacts/cycle-0006/` and `artifacts/cycle-0005/`. Shared results redact local paths/endpoints and exclude authentication descriptors, profiles and native logs. PNG bytes are extracted unchanged from hash-verified resource data. Raw and shared JSON hashes differ when sanitization changes their bytes.

Reproduce from the implementation revision using the commands in [the extension README](../../../../extension/README.md). Cycle 0006 used runner Node 24.21.0; extension-host Node 24.18.1 / Electron 42.10.0, Chrome 153.0.8010.50, VS Code js-debug 1.117.0 and Cursor js-debug 1.93.0 on macOS arm64. No CI, PR approval, VSIX, installed-product, real-repository, recording/replay or publication result is claimed.
