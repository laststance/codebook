# Empty and opaque primary editor diagnostics

Date: 2026-09-21. Scope: Cycle 0018 development diagnostics, not repaired-product validation or final end-user acceptance.

## Identity and isolation

Both runs used ordinary Cursor 3.21.16 / extension API 1.128.0, an isolated copy of the existing validation profile and the unchanged installed Codebook VSIX `6abd3c665e7f3610040860ff45c22eecf1947499f5cd08654a7b3f5ba5f9a0dc`. The installed product belongs to source `8e2665489a48103d3bf60b1906397bf0b6883ccc`, not the current uncommitted repair. A separate read-only observer collected public editor state. No AI chat question, hidden MCP assistance or final reviewer was involved.

The target remained Laststance.io `43d03993`, with the unrelated unsaved validation draft preserved. All 62 original-profile files retained their exact bytes and modification times. The copied editor runs exited with code 0, retained the draft backup, and left zero owned profile processes or connection descriptors. Original work windows were not modified.

## Observations

| Control | Main editor state | While separate chat has focus | After public Focus First Editor Group |
| --- | --- | --- | --- |
| Blank primary group | Empty One, dirty draft in Two; global collection order `[2, 1, 3]` | Layout describes chat, but active TabGroup remains empty One; active text editor is absent | Layout describes the two main leaves; active text editor is still absent |
| Settings primary editor | Settings and the retained dirty draft share main One | Layout leaf size is 743, but the same opaque Settings tab remains the reported active TabGroup; active text editor is absent | Layout leaf size returns to 477; active text editor is still absent |

The planned Welcome command was unavailable in the installed host. Only the reset-walkthrough command appeared; it was not executed. The second run used the public Open Settings UI command instead. The previously empty main group did not persist across the diagnostic close/reopen, so this second control had one main group. These procedure changes are not evidence that the repaired product works.

The public focus command changes the active editor part, but an opaque or empty active TabGroup cannot by itself prove keyboard focus. Global collection order also cannot define main-group membership.

## Repair decision and limits

An owned Wiki focus anchor was considered and rejected before implementation. Official and installed host source show that revealing the only Wiki tab in another group closes its original input. With `closeEmptyGroups` enabled, this can delete the pre-existing empty group. Leaving that Wiki in place also exposes the same issue on Close. No temporary Wiki, dummy document, settings mutation or group relocation was added to work around this behavior. Sources: [webview open/reveal](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.ts), [webview transfer](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webviewPanel/browser/webviewPanel.contribution.ts), [editor close handling](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorGroupView.ts).

The revised repair uses an already validated article's actual immutable citation as an optional cold-Wiki focus anchor. It opens that pinned source in main One only when ordinary focus cannot identify the part, retains a real active native text receipt, and creates Wiki directly in reserved Two. Catalog/article validation precedes native effects; observable manual focus changes retire the pending operation. A new Study panel's optimistic wrapper flags must also match its actual native webview tab before establishing scope.

This is a bounded implementation hypothesis requiring normal installed validation. An ambiguous empty library without a selected citation still has no safe anchor and cannot count as successful recovery. Opaque-to-chat focus changes with identical public observations cannot be claimed fully observable. No support matrix, final candidate or reviewer count changes follow from these diagnostics.

## Private evidence and qualifications

Stable local root: `artifacts/cycle-0018/blank-primary-probe/`. [Sanitized manifest](opaque-primary-probe-manifest.json) records artifact identities without copying runtime contents into the repository.

- Blank run: `blank-first`, `blank-chat-v2`, `blank-restored-v3` JSON/PNG receipts; `blank-scope.webm` (367.080 s, 800×600, nominal 25 fps); inspected contact sheet with 12 frames sampled every 30 s.
- Settings run: `settings-primary`, `settings-chat`, `settings-restored` JSON/PNG receipts; `welcome-scope.webm` (154.920 s, 800×600, nominal 25 fps; filename retained despite the changed control); inspected `settings-contact-sheet.png` with 10 frames sampled every 15 s.
- Cleanup: separate `initial-*` and `restart-*` exit/shutdown receipts. Original-profile preservation was checked after both runs.

Sparse contact sheets establish observed states, not complete motion quality. Palette-selection timeouts, a clipboard timeout with subsequent fresh accessibility confirmation, one overlapping earlier diagnostic attempt and native console errors/warnings remain retained. Failed attempts are not passing observations. All later repaired-source evidence must identify its own source cut and VSIX.
