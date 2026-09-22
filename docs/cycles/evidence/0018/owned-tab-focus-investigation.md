# Cycle 0018 — Native and inner-Webview focus ordering

Date: 2026-09-22. Development investigation of the [v17 installed failure](installed-v17-validation.md). Product source remains `92b3a29f7a65829ac2a5f9e5c780f034bfa98ebd`; no production repair, new release or final acceptance result is established by these diagnostic copies. T3 remains open, T4 remains failed and T5 remains stopped before PR/merge.

## Identity and limits

Every native diagnostic starts with a fresh copy of the same protected VS Code profile and a normal CLI installation of the original v17 VSIX. All 29 packaged files match before instrumentation. The archive SHA-256 is `edd2ecb967b8ee089f6cccfbb17fc75c1d465cd37576625ae48554fe4d8e70ee`; the original installed extension bundle SHA-256 is `fdee6b0f8ed4c51c8cb2f507434d847790c75c22ec65f1fe785ab95aaa4de5dc`.

Instrumentation then changes the private installed bundle, and later copies also add a diagnostic command to the installed manifest. Their original embedded build metadata does **not** make those modified bytes an unchanged candidate. Each actual bundle/manifest identity is recorded in its `diagnostic-bundle.json` and the [artifact manifest](owned-tab-focus-manifest.json). The final intervention changes ordering as well as adding observation; it is separately identified below.

Host: ordinary VS Code 1.138.0, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, macOS 26.6.2 (25G83), arm64, 1280 × 800 native video at 25 fps. Target: the familiar Laststance.io repository at `43d039938287ed494a66f4fad198da2464a9e7b0`, in its dedicated work window. These are direct-MCP development diagnostics, with no new runtime runs. They are not Cursor results, random-repository trials, actual AI-chat workflows or G12 verification. The final campaign remains **0/10 reviewers and 0/at least 20 editor trials, not started**.

## Experiments and unsuccessful observers

Private roots below are under `artifacts/cycle-0018/`. Each contains its schedule, helpers, source/install identity, receipts and cleanup evidence.

| Root | Observation | Interpretation |
| --- | --- | --- |
| `owned-tab-investigation-v17` | Synchronous native-event logging; initial/restarted exact replay, twelve Wiki Returns and twelve Living/Guided pairs pass. | Original intermittent failure not reproduced. Logging may affect timing; a modified-copy pass does not repair or validate v17. |
| `renderer-focus-probe-v17` | Two Chromium iframe controls retain outside focus after a flow/moment button loses focus and another model arrives. | Proposed Study renderer focus theft is not reproduced. This is a renderer probe, not native-editor proof. |
| `owned-tab-buffered-v17` | Initial entry and two Study Wiki Returns pass; Study-to-Living fails with the original owned-tab timeout. Buffered console trace is not recovered. | Failure reproduced, but this observer does not establish event order. Remaining schedule is unexecuted. |
| `owned-tab-filetrace-v17` | Six initial Wiki Returns, twelve normal mode pairs and a native moment-to-source focus control pass. Rapid requests complete 42 transitions, then fail a native pane/group/focus ownership guard. | Keep this distinct from the original timeout. First-load instrumentation receipt exists, but automatic disposal trace is absent. |
| `owned-tab-commandtrace-v17` | Explicit diagnostic command proves a 39-event buffer before the trial. Six Wiki Returns pass; four rapid transitions complete before the next Guided selection times out. A 461-event trace is recovered. | Confirms a late Application activation after the Context reveal, with no intervening Codebook reveal. |
| `owned-tab-domtrace-v17` | Initial Open shows `Unsupported reader message` because diagnostic DOM messages also reach the strict product receiver. | Invalid diagnostic. Stop before replay/returns; do not classify the observer's interference as a product failure. |
| `owned-tab-domtrace2-v17` | Diagnostic messages are filtered before product receivers. Exact entry and six Wiki Returns pass. Sixty rapid transitions complete; the next Living selection reproduces the original timeout. A 2,970-event native/DOM trace is recovered. | Separates native activation from actual inner-document focus; detailed sequence below. |

The file-trace rapid schedule manifest was written after launch because its pre-run writer had a syntax error. Its executable helper already specified the 30-cycle bound, expectations and stop-on-first-failure behavior, but the later manifest is **not** claimed as a correct pre-launch freeze. The explicit-save helper in the first command-trace experiment was added after that helper inventory, before first use; the command operation and installed instrumentation were already frozen. Both deviations are retained. Later DOM/intervention schedules include the save helper before launch.

## Observed failed handoff

In `owned-tab-domtrace2-v17`, presentation revision 64 requests Study-to-Living. UTC times on 2026-09-22:

| Time | Observed event |
| --- | --- |
| 05:23:21.639 | Codebook requests Application focus before Keep Editor. |
| .641 | Native API reports Application active. |
| .647 and .692 | Application's own message probes report `document.hasFocus() === false`. |
| .692 | Keep Editor finishes; the Application tab is retained. |
| .693 / .695 | Codebook reveals Context; native API reports Context active. |
| .698 | Native API switches back to Application, without another Codebook reveal. |
| .746 | Context's inner document receives focus. Subsequent probes remain true while the native API still reports Application active. |
| 05:23:26.745 | The Context owned-tab-active wait times out. |

The first explicit command trace independently records the same native ordering: Context active at 05:08:51.790, Application active again at .794, then the five-second timeout. The DOM evidence establishes that a native active flag alone is not a completed inner-focus handoff. It also establishes that simply waiting longer after the failed handoff would not correct the observed disagreement within the existing window.

The exact host revision's [Webview element implementation](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vs/workbench/contrib/webview/browser/webviewElement.ts) separates programmatic focus notification from a delayed inner-focus message. Its [Webview prelude](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vs/workbench/contrib/webview/browser/pre/index.html) polls focus for host notification. These mechanisms support the asynchronous-boundary explanation; the host's internal callbacks were not instrumented directly. Retrieved source bytes and hashes are retained privately. Do not turn that source-level inference into a claim that every host callback has been causally traced.

Every reproduced original timeout retains the prior saved/current mode, an unconfirmed moved grid, the same paused recording at `11358.763459 ms`, observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, and frame `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`. There is no corrective retry, restore or seek after failure and no new runtime run.

## Bounded intervention

`owned-tab-focusbarrier-v17` tests an additional request-matched `document.hasFocus()` receipt after native owned-tab activation, before Keep Editor and after final panel-focus restoration. It keeps the original deadline and ownership guards, sends read-only probes and adds no focus retry. Its installed bundle SHA-256 is `a735a5ba45a138821d542e416e5b09630c05fca14abf78a3beabcd351e7bff24`; this is a private behavior-changing experiment, not an unchanged v17 candidate or a production fix.

The pre-launch schedule requires initial exact replay, six Wiki Returns and up to thirty sequential Living/Guided/Study triplets, stopping on the first failure. Exact replay and all six Returns pass. Thirty-five rapid transitions then complete before Guided-to-Study fails at final Context restoration with `Timed out waiting for diagnostic inner document focus`. Revision 39 reveals Context at 05:29:45.257 UTC; the native API marks it active at .259, but request-matched inner-document probes remain false from .309 through 05:29:50.260. No new reveal or retry occurs. Prior Guided mode/preference and the exact paused replay remain; the requested Study layout is unconfirmed. The 2,550-event trace, read-only failure capture and inspected video retain this different failure.

**The intervention does not establish a repair.** It fails the observed schedule at a second boundary where native activation succeeds but inner focus is not received. Top-level workbench/native-window focus was not sampled at that exact handoff: the later focused/visible snapshot cannot prove that focus was retained throughout the wait. Therefore dropped inner-focus delivery and whole-window focus loss are not yet distinguished. Do not promote the receipt wait into production, claim that it fixes the original timeout, increase the wait or retry focus blindly. No product source is changed.

## Decision and next observation

Keep the original failures and both native/DOM discrepancies as regressions. The root-cause investigation has narrowed the boundary but has not established a safe correction. The next bounded probe should isolate final Context reveal after source focus, recording native-window focus, the workbench active element, outer and inner frame focus, and the host's delayed-focus delivery/guard. This distinguishes whole-window focus loss, a stale activation notification and an inner-focus message that is skipped or arrives at the wrong frame. Reduce the probe to that transition before another complete candidate schedule. A different native command route is an experiment requiring the same ownership and foreign-focus protection, not an assumed fix.

Only after causal evidence and a failing-before regression justify a product change should T3 resume implementation. Then run the full source/package checks, freeze a new unchanged VSIX and complete T4 separately in both ordinary hosts. Keep Issue #23 open until the required reviewed PR/CI/merge; keep Issue #1 open until full acceptance. After this cycle, select the required G12 skill/onboarding increment. No final reviewer is started by these diagnostics.

## Evidence and preservation

Native recordings are retained with extracted one-second samples. Visually inspected ranges: synchronous logging initial 36–47 s and 60–71 s, restart 84–95 s and 96–107 s; buffered logging 96–107 s and 108–119 s; file trace 180–191 s and 288–299 s; command trace 132–143 s and 144–155 s; filtered DOM trace 96–107 s and 108–119 s; focus-wait intervention 108–119 s and 120–131 s. Other sheets are explicitly uninspected. Samples show rearrangement/loading and retained replay with the visible failure, but do not prove whole-video motion, constrained-layout readability or final usability. The invalid first DOM observer's video and the separate Chromium probe's recording are retained but not frame-inspected.

Every completed diagnostic window closes normally with exit 0. Its 115 original profile files retain exact bytes/mtimes, the pre-existing unsaved draft remains backed up, and cleanup confirms zero owned editor PIDs and zero connection descriptors. Only the exact owned idle background app may be terminated after normal window exit and backup verification. Ordinary user profiles/windows remain outside these diagnostics. Private recordings, transcripts and connection material stay outside Git; only this sanitized report and checksummed artifact inventory are committed.

Product source has not changed, so the existing 785/785 product/shared and 96/96 package checks remain the last source-test checkpoint; they are not a new run and do not override the native failure. G12 is still specified only. Claude Code CLI long review remains owner-skipped.
