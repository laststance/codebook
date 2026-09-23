# Cycle 0018 — v22 native focus-departure investigation

Date: 2026-09-22. Result: **reproduced; the native-only retention intervention is falsified as a sufficient repair**. Product source is unchanged. T3 diagnosis remains open, T4 remains FAIL and T5 remains pending. These five sequential Cursor diagnostics are separate from the earlier v21 inner-focus A–E investigation and from final acceptance.

## Identity and evidence boundary

All attempts begin by normally installing the same v22 VSIX: source `64c762939ea3c03f6f6cea2b18f3b1ce618ebd77`, archive SHA-256 `2a656c6e90d05c9d027fca741c8e30350d2e4af5b78ff9a89e99843a46805358`, 601,579 bytes. The 273 product inputs retain SHA-256 `f6c3d17c2d6ee2ad2d70a00f8b7a849e93c085c40347d53deae354edac35d1cd`. Each installation verifies all 29 archive files before modifying only its private installed `dist/extension.js`. Before/after checks verify that modified file's declared hash, the other 28 files and every product input. The bundle's embedded clean-source metadata is not proof of unmodified installed bytes.

The host is ordinary Cursor 3.21.16 / API 1.128.0 on macOS 26.6.2 arm64. The development target remains Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`; no random final target is selected. Each attempt uses a new copy of the protected dedicated profile and retains its own frozen helper schedule, private recordings, receipts and modified-bundle diff. [The evidence manifest](native-departure-manifest.json) identifies those files and their hashes.

| Attempt / UTC interval | Installed modification | Actual result | Video / inspected 1 fps sheets |
| --- | --- | --- | --- |
| A, 12:47–12:48 | Buffered per-handoff logging | Six initial Wiki Returns and final Study restoration complete; original departure is not reproduced. **INCONCLUSIVE**, not a product pass. | 41.84 s / 4 of 4 |
| B, 12:53–12:54 | Workspace-lifetime native/effect journal | Six initial Returns complete. Rapid transfer 1 passes; transfer 2, Living → Guided, reproduces owned focus departure. | 45.56 s / 4 of 4 |
| C, 12:57–12:58 | Journal plus native-only activation for internal Keep Editor | Initial entry completes, but native window-focus admission rejects the first presentation request before the intervention. Zero Returns. **INCONCLUSIVE prerequisite failure.** | 11.12 s / 1 of 1 |
| D, 13:00–13:01 | Same intervention plus passive native-focus pulse | Actual native focus is true at admission. Two Study Returns complete, then native window focus is false before Living selection. Intervention remains unexercised. **INCONCLUSIVE prerequisite failure.** | 22.12 s / 2 of 2 |
| E, 13:08–13:10 | Same intervention and pulse, with the owner's quiet-window interval | Actual native focus is true at admission and failure. Six Returns and 51 rapid transfers complete; transfer 52, Study → Living, reproduces the departure. **FAIL for this intervention.** | 73.96 s / 7 of 7 |

A/B are logging-only modifications, which can still affect timing. C/D/E are functional diagnostics. Some copied verifier receipts and C/D runner labels retain the old words `logging-only`; these labels are incorrect for their functional bundles. Their prelaunch schedules, intervention diffs, modified-bundle hashes and this report preserve the actual classification. No modified installation establishes unchanged-VSIX acceptance.

## Observed native ordering

B records 533 events and 12 completed/failed handoffs. At 12:54:46.800 UTC, Context acquires native column 3. At .805, Application acquires native column 1 without another recorded Codebook focus request between those events. The preceding Application handoff had completed its current inner-document focus protocol at .795, immediately before Keep Editor and the Context reveal. Window focus remains true. The public notification alone does not identify who caused the return to Application.

C tests whether the extra inner-document focus request used merely to retain a preview tab causes that return. It skips prepare/commit only for internal Keep Editor; final learner-reading restoration retains the full native/current-document protocol. Existing ownership guards, deadline, cancellation and failure policy remain. C and D cannot judge this hypothesis because native window-focus admission stops them before the modified handoff. D's initial true pulse does not establish continuous focus. The lack of a flushed handoff journal is not evidence that no native events occurred, and the cause of those window-focus losses is unknown.

E reaches the intervention after Computer Use raises the exact dedicated window and clicks its observed draft tab. The fresh extension-host snapshot confirms the focused work window, draft and repository. Its 2,424 events contain 128 handoffs and one departure rejection. At 13:10:40.039 UTC, the native-only Application handoff finishes and Keep Editor runs. Context's reveal follows at .040; Context acquires column 1 at .043. Application reacquires column 2 at .046 with no intervening owned focus request. The guard rejects at .091. Window focus is true throughout this failure sequence.

This falsifies the claim that removing the internal inner-focus protocol is sufficient. It does not prove that the protocol never affects timing. Delayed host focus delivery remains a hypothesis; Keep Editor, native reveal and host message processing have not been causally distinguished. Do not promote the intervention to product source or weaken the guard to accept an unexplained departure.

## Preserved state and visual limits

B retains the prior Living preference; E retains the prior Study preference. Both failures report `layoutConfirmed: false` after panes have moved. E's actual app/source/context columns are 2/3/1, while the previous Study selection and error remain visible. Exact paused replay survives at 11429.631958 ms, with the same observation and frame SHA-256 `df07b0674ff55aaea34831e2ae6604611072bd4aa1c9378b04833a5a7b11b575`. Runtime run count remains zero. No corrective restore or retry follows either failure.

All 18 extracted contact sheets are inspected. They show the separate initial navigation, mode transfers and visible failure states described above. E includes rapid intermediate rearrangements and transient replay-loading states before its final rejection. Narrow reading areas and 1 fps sampling limit conclusions about readability and every intervening animation frame; these are not full usability or editor-chat acceptance results.

Each owned window closes normally with exit 0. The original 62 profile files retain exact bytes and modification times; the unsaved draft backup remains. Every attempt has zero owned editor processes and connection descriptors. All frozen helpers remain unchanged: 35 in A, 36 in B and 37 each in C/D/E. Product source, the original VSIX and user work remain unchanged.

## Next bounded question

Attribute the native return to its actual host message before testing another behavioral change. Read-only inspection of the installed Cursor host finds a delayed webview-focus send and polling-based `did-focus`/`did-blur` delivery; this identifies a plausible path, not the cause of E. The official [Keep Editor handler](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorCommands.ts) calls group pinning; its name alone does not prove a focus effect.

Prepare a separately identified diagnostic that correlates the owned outer-webview focus messages, inner focus/blur and host native events without changing their arguments, order, guards or deadlines. Keep raw message contents and connection details private; collect only focus event names, target identities and timing. Stop on missing native focus or the first failed assertion. An attributable sequence and meaningful failing-before regression must precede a source repair, fresh unchanged packaging and complete both-host T4 verification.

Independent development review remains non-converged at three fixing passes; current-head delivery review, CI/artifact correspondence and PR/merge are outstanding. G12 is still specified only. The final campaign remains **0/10 reviewers, 0/at least 20 editor trials, not started**. Issues #23 and #1 remain open; Claude Code CLI long reviews remain owner-skipped.
