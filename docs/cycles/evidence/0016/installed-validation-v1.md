# Ordinary installed validation — schedule v1

Date: 2026-09-21 JST. Scope: [Cycle 0016](../../0016-packaged-installation.md), [frozen schedule v1](installed-schedule.md). Result: **VS Code bounded workflow demonstrated; Cursor incomplete after a native presentation failure**. This does not verify the complete product.

## Candidate and distribution

- Extension 0.2.1 / API 1.5, clean revision `daa008703a4b7ac4c94611fa10086e403328998b`.
- Source hash `4454ff590610329b0fe210fe63bb8b87909a8f4b40445ccefc24c9ad16cc5a40`.
- Same 587,006-byte VSIX installed and reinstalled in both editors; SHA-256 `3a01ea528e155dc035dced736a6acfdf4e86f63d99059e02848cab2b437eb8fe`.
- All 29 installed extension entries match; `package.json` comparison excludes only installer-added `__metadata`. No development-extension/test flags or repository imports inside either host.
- [CI 35529938105](https://github.com/laststance/codebook/actions/runs/35529938105) and [current-head CI 35530217589](https://github.com/laststance/codebook/actions/runs/35530217589) succeed. The first downloaded artifact independently passes archive verification, SHA-256 `7effa4c493b0155b1ea297989322e1a647719c6c5224f60a1114aa8f70193484`; its source hash matches the installed candidate. CI uses a PR merge revision, so its artifact bytes are distinct from the local installed artifact.
- Existing regression result remains 664 product/shared plus 39 package/asset tests. Tests/CI do not override a native failure.

## Host results

| Evidence | VS Code 1.138.0 | Cursor 3.21.16 / API 1.128.0 |
| --- | --- | --- |
| Ordinary install/reinstall, public MCP identity | Pass | Pass |
| Exact source read, cited two-article Wiki and native source | Pass | Pass |
| Declared checkout | Four observations and explanations; all 11 links observed | Stopped after first correct server-cart observation/explanation |
| Live Living → Guided → Study | All three confirmed | First two confirmed; Study fails |
| Explicit learner understanding | Exactly 1/4, persists | Not reached |
| Offline recording | Four corresponding source/value/explanation/image moments; 33 frames, 200840.197375 ms | Five-frame recording sealed after deliberate stop; walkthrough not-demonstrated |
| Paused replay mode transfer | Three confirmed, same 198316.665458 ms and observation | Not reached |
| Motion | Native replay frames show confirmation appearing/moving to final state | Not reached |
| Ordinary window/extension-host restart | Fresh descriptor/instance, zero runs, saved Wiki/recording/progress/mode | Not reached |
| Unrelated draft / cleanup | Exact unsaved text and hot-exit backup survive; disk unchanged; two ordinary exits 0; zero owned profile processes after shell cleanup | Draft retained in failure images; runtime released; owned editor/service retained for diagnosis |

Both use macOS 26.6.2 arm64, external Node 24.21.0 and Chrome 153.0.8010.53. Native capture sizes are 1440×900 and 1280×800 respectively. Cursor's Open Chat as Editor Tabs is visibly off. A preliminary Cursor viewport-size probe was restored before acceptance. Aside is unavailable; the project-required native Playwright CLI and public MCP are the explicit driver adaptation.

## C16-QA-001 — Cursor presentation failure

The installed Cursor reader starts from a cited Wiki with an unrelated dirty draft. While checkout is held at the server cart mutation, Living book and Guided walkthrough select successfully. Study workspace selection then fails after 5226.999 ms with `PRESENTATION_UNAVAILABLE`: `Timed out waiting for owned presentation tab active`. The logical mode and saved preference remain Guided; `layoutConfirmed` is false. The observed frame remains the selected cart pause.

After explicit runtime stop reports `cleaned` and `resourcesReleased`, one fresh-revision retry tests a changed condition: no active debugger/capture. It also fails, after 329.373 ms, with `Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.` Physical geometry changes while the logical mode remains Guided/unconfirmed. Their shared root cause is not yet established. No product fix or repeated checkout was attempted during qa-only.

The finite acceptance stops at I07. I08–I16 cannot be credited to Cursor. The sealed five-frame recording honestly retains a not-demonstrated walkthrough; it is not a completed checkout. Investigate the exact native tab/focus acquisition before selecting a repair or revised verification schedule.

## Qualifications and retained artifacts

- VS Code's normal window close retires its extension host and descriptor; the macOS application shell remains across window reopening. Final cleanup sends SIGTERM only to that owned shell after ordinary window exit; no owned profile process remains. This is not a claim that the application shell was replaced during restart.
- The explicit understanding checkbox uses asynchronous persistence/rerender: Playwright's immediate `check` assertion failed, while subsequent UI and restart verify exactly one decision. No duplicate click was sent.
- VS Code emits one `Unexpected SIGPIPE` exception twice at runtime teardown. Runtime, recording and cleanup results succeed; origin/repro remain to investigate. Startup deprecation warnings are separate.
- Cursor has extensive signed-out host transport/account/analytics errors before Codebook operations. Baseline and full logs are preserved; raw console totals are not attributed to Codebook or treated as independent defects.
- Full design/accessibility/geometry matrices, all-mode Wiki Return, real-repository usefulness, owner feedback, broad review convergence and final acceptance remain outstanding. Final reviews are 0/10.

Private durable evidence root: `artifacts/cycle-0016/`. Candidate/install receipts: `installed-candidate.json`, `installations.json`, `installed-environment.json`, `ci-initial-independent-check.json`. Per-host subdirectories: `native/vscode/` and `native/cursor/`; each contains credential-free public MCP transcripts and native PNG/WebM files. Do not publish descriptors, local recordings or full private runtime data.

VS Code key receipts: `agent-34-completed.json`, `offline-verification.json`, `restart-verification.json`, `final-disk-verification.json`, `final-process-cleanup.json`. Motion: `05-replay-animation.webm`, inspected `animation-frame-001/004/006/009/012.png`. Cursor key receipts: `agent-17-live-study.json`, `agent-17d-presentation.json`, `agent-20-stopped-study-retry.json`, `agent-21-retry-state.json`, `agent-19-stopped-attempt.json`. Failure images/videos: `17-live-study.png`, `20-stopped-study-retry.png`, `02-live-checkout.webm`, `03-stopped-recovery.webm`.

The complete local qa-only report is `.gstack/qa-reports/cycle-0016/qa-report-installed-20260921.md`, with a project-scoped test outcome under `~/.gstack/projects/codebook/`. Its provisional 90/100 uses only limited functional/visual coverage; it is not ship readiness. No artifact relocation/deletion is authorized by this report.
