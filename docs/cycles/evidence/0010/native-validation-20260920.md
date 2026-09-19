# Cycle 0010 native validation — 2026-09-20

The bounded real-repository hypothesis is **demonstrated separately in VS Code and Cursor**. The unchanged Laststance.io ThemeToggle handler pauses at its exact TSX statement, exposes actual closure values, remains responsive through a 70-second hold, and continues once to the expected dark page. This is the private experiment; it does not establish the public MCP, installed product, arbitrary repository support or final acceptance.

## Candidate and environment

- Working base: `621a63f9399be579de1c806dc15e331522adbf02`, with reviewed uncommitted changes. Source fingerprint: `1856f0d6ec52086aa2df9ad06deefa320c8dd3ba50b3810817717ac9fa27b5fb` over 60 Cycle 0001/0010 source/test files. [Manifest](manifest.json) lists all individual hashes, launcher/controller hashes and per-run source inventories. The clean implementation commit `9bfe1e8d91eef28a8a889ad1fba8f316af0089d0` was verified against all 60 hashes and the launcher hash; all match, with a clean working tree. No source change or test rerun occurred during this reconciliation.
- Target: detached private Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`, `next dev --webpack`, Next 16.3.4 / React 19.2.8 / next-themes 0.4.6. The initial frozen production build passed but removed its browser maps; that approach remains falsified. The application was not rewritten into a fixture.
- VS Code 1.138.0, API 1.138.0, js-debug 1.117.0. Cursor 3.21.13, API 1.128.0, js-debug 1.93.0. Both extension hosts: Node 24.18.1 / Electron 42.10.0; external runner Node 24.21.0; Chrome 153.0.8010.53; macOS arm64.
- [Expectation v3](expectations.json) was frozen before this matrix. Source/value requirements remain the earlier v2 requirements; v3 adds actual decoy, external CDP resume and preparation cancellation. Normal runs intentionally hold for 70 seconds, exceeding the 40-second minimum.
- Final build and experiment suite: **38 passed, 0 failed/skipped/cancelled**. No shared/product runtime source changed. [Implementation review](implementation-review-20260920.md): three fixing passes, R1–R17 repaired, no remaining confirmed finding, **non-converged at the fixing cap**, outside coverage unavailable. These are development reviews; final sequential reviews remain 0/10.

## Actual action, source and values

The private bootstrap accepts one input intent and sends a real owned Chrome CDP mouse press/release at the existing “Switch to dark theme” button. Playwright CLI records the same isolated editor renderer; it does not invoke the application handler or provide the Chrome input. Required observation: initial DOM light, a selected DAP/CDP stop at `src/components/Header/ThemeToggle.tsx:19:5`, `otherTheme = "dark"`, `typeof setTheme = "function"`, one owned continue, final DOM dark and button “Switch to light theme.” All final normal and decoy runs satisfy this correspondence.

Exact source SHA-256: `3699d15e3fe8d763dabf615e75d40d014003495df4b9c510d5c6da64d2a1e012`; executed JavaScript: `496aecf54e63ca8b350ba846c68a1fd8bc9d004235a5b0f89b54bbef22001b94`; map: `db1dee78cff9c3a19bcc46f6e9a7b359ddafdfa82cc2b4b992b8858b146a4717`. DAP frame, selected CDP script, map original and current file agree. Optimized surrounding render locals remain explicitly unavailable in the raw evaluation responses; no source/DOM inference replaces them.

## Final matrix

| Case | VS Code | Cursor | Observable result |
| --- | --- | --- | --- |
| Normal hold | PASS | PASS | One input/stop/accepted continue; before/paused/after file hashes equal renderer receipts; final dark DOM |
| Manual DAP resume | PASS | PASS | Live authority invalidated; stale continue rejected; failed history retained and cleaned |
| External CDP resume | PASS | PASS | Unowned continuation detected; stale continue rejected; no accepted owned continue |
| Source drift | PASS | PASS | Changed source rejects continue; failed history retained; exact isolated source restored |
| Held cancel | PASS, 230.05 ms | PASS, 303.07 ms | Pending input can end; no accepted continue; zero owned resources |
| Actual unrelated decoy | PASS | PASS | Foreign real session/thread rejected; own continue once; independently owned debugger remains paused and stack-readable after primary cleanup; its QA owner then closes it |
| Cancel preparation | PASS, 55.29 ms | PASS, 102.76 ms | Cancel after actual app acquisition; zero input/stop/continue, finite cleanup |

| Normal measurement | VS Code | Cursor |
| --- | ---: | ---: |
| Paused hold | 70,050.79 ms | 70,072.21 ms |
| State query | 43.48 ms | 61.39 ms |
| Continue command | 61.16 ms | 59.29 ms |
| Video duration | 81.76 s | 84.64 s |

Every editor exited 0; every unrelated dirty draft retained its content/dirty flag. Native events verify application-group/listener closure, no managed Chrome processes, no owned tabs, no active selected debug sessions and closed CDP. A separate post-run PID check confirmed **136 recorded editor/app/browser PID occurrences absent**. Playwright CLI reports no browsers. These are observations on this machine, not general latency guarantees.

## Inspected native video frames

The primary agent extracted frames with ffmpeg and inspected them directly:

- VS Code: `artifacts/cycle-0010/native/vscode/2026-09-19T16-34-08.971Z-75f9210d/native-normal.webm`. At **8 s** the embedded app is live and light; **20 s** shows the light app and source line 19 highlighted as paused; **79.76 s** shows the dark app after continuation. Recorded native editor UI, not a browser-only screenshot.
- Cursor: `artifacts/cycle-0010/native/cursor/2026-09-19T16-36-29.044Z-a60efc14/native-normal.webm`. At **11 s** the embedded app is live and light; **12/20 s** show the light app and highlighted source pause; **82.64 s** shows the dark app after continuation. The **8/10 s** frames show “Connecting” and are retained only as loading evidence, not before-app proof.

`frame-extraction.json` records offsets and inspection qualifications. The target disables animation during its theme change; this video proves the observed state transition and corresponding source stop, not a smooth theme animation or the product Study layout. Individual captured page images also match their renderer ACK hashes, but those receipts alone are not substituted for the inspected editor video.

## Failed and superseded attempts

The manifest retains **19 historical cuts** separately from the final 14 cases. In particular:

- Production maps were deleted by the frozen Sentry build path. The independent no-credential probe supports that specific diagnosis; the successful dev path does not make the original production hypothesis pass.
- Early native cuts failed before input because Chrome normalized a dot segment in the webpack script URL. Full normalized URL identity plus exact source hashes repaired it.
- VS Code `2026-09-19T15-05-50.796Z-21a918b3` reached a correct source/value stop and dark DOM/saved page image, but its after-frame renderer ACK timed out after a roughly 55.66-second hold. The video remained paused/light. It is **partial**, even though the file is named `native-normal.webm`.
- The later instrumented 45-second renderer diagnostic is excluded from clean acceptance. Successful uninstrumented 70-second runs in both hosts do not establish the cause of the earlier failure or general phase-ACK reliability. That concern remains open; no visibility/lock cause is asserted.
- The first expanded VS Code matrix on fingerprint `4aef7d…` stopped at decoy QA focus. Parent-console selection is valid but the helper required the stopped child's ID. Preserve the failed cut and its source, then the focused red/green test and successful native repro. Only the final fingerprint above supplies this matrix's acceptance.

Original Laststance.io remains clean on `main` at the frozen commit; both original/isolated ThemeToggle bytes match the expected hash after drift tests. All seven original Cycle 0009 handoff backups were rehashed and match (7/7).

## Availability and conclusion

Raw videos, transcripts, source captures, command receipts and logs remain ignored/local under `artifacts/cycle-0010/`. The tracked manifest contains hashes and stable relative locations, including historical failure metadata; it contains no credential payloads. Copy required evidence to an accessible durable store before deleting or moving this checkout. Missing artifacts make affected claims need revalidation.

Keep the bounded source verifier, explicit target/pause authority, independent control and owned cleanup. The next selected question is how to connect a configured ordinary-repository browser action to the existing public MCP, Study observations, book evidence and recording model without hard-coding this target. Packaging, the three intended uses, both later layouts, integrated acceptance, owner acceptance and ten final reviews remain open.
