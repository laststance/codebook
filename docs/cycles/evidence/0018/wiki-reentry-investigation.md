# Installed v4 Wiki-to-Study reentry failure and repair

Scope: Cycle 0018 development validation and investigation, not final editor-AI acceptance. The [isolated first-Study results](installed-first-study-v4.md) remain valid for their bounded action in both hosts. This report records the subsequent Cursor failure; it does not extend those results to replay, restart or the full product. G12 remains required and unimplemented. Final reviewers remain 0/10.

## Original ordinary-install failure

The phase-2 schedule was frozen before execution in `artifacts/cycle-0018/installed-development-v4/schedule-full.json`. The same clean source `fbbde6973d4284ce029ef6739de47c0dd3b28b57`, source fingerprint `1eab35b089c167c82f781c753a1eaab1c5c5c1f731bc2dbd38f04ba479c6da54`, and 597,084-byte VSIX SHA-256 `2c85867930461d7ea2eb49e5030ab6939352f4029825c54231e74da97a20b05f` were normally installed in a new copy of the original dedicated profile. All 29 installed files and loaded build identity match. Cursor is 3.21.16 / API 1.128.0; the unchanged Laststance.io target remains `43d039938287ed494a66f4fad198da2464a9e7b0`.

At 15:57:58.720 UTC on 2026-09-21, one Open Study command completes with confirmed app/source/context 1/2/3. After both the public state and visible reader confirm completion, public `codebook_open_book` opens saved revision 2 of `installed-theme-study`, article `theme-switching`, citation 0. The article is visible and its source hashes match. A subsequent Open Study command at 15:58:02.636 completes with unconfirmed layout; the bounded observer still reports false at 15:58:13.246. The native screen retains the three side-by-side Wiki reading groups, with citation and article covering the Application and captured-source tabs. No corrective command, seek or runtime execution follows.

**FAIL.** Replay was not opened, so exact paused restoration, modes, six Wiki returns and restart remain unexecuted for this phase. VS Code phase 2 has not installed or executed this archive. The 63.440-second, 1280×800, 25-fps native video and inspected 16-frame contact sheet (10.5–18.5 seconds, 2 fps) show the successful initial Study, Wiki entry and failed reentry. They do not certify complete motion quality. The original receipt, screenshot, video and cleanup remain under `cursor-full/`; mixed orchestration command history is not used as the trial's authority.

## Root-cause evidence

Two fresh copied profiles install the same archive, then receive separately hashed logging-only bundles. Their metadata still names the original build, but their modified bytes are explicitly **diagnostic only** and cannot pass ordinary unchanged-VSIX validation:

| Diagnostic | Modified bundle SHA-256 | Finding |
| --- | --- | --- |
| `cursor-reentry-trace` | `7203451d0c2092124a5ecdaff68130802b94ff701bd5a7624c08ea7561bbf1f6` | The owned Wiki receipt exists, then the Study entry rejects group identity before changing layout. |
| `cursor-reentry-trace2` | `792ec7187e888bd9c12687854202904b66359e36328e24979ae44e9211e828f6` | Main groups 1–3 retain their identities; only the unchanged empty separate group at column 4 loses identity. |

Both repeat the same failure without rescue. The second trace shows the Wiki receipt's exact 326/326/328-pixel layout and unchanged app/source/context columns. The three main groups retain their logical identities after citation/Wiki insertion. Cursor replaces the empty extra-part wrapper, which has no tab-content key; the existing content-matching rule assigns it a new identity. The global ownership check therefore releases an otherwise unchanged main layout.

Inspection of the exact installed host's full-tab-model handler confirms that it creates new wrappers for retained internal group IDs and emits them as `changed`, with actual additions/removals separately reported as `opened`/`closed`. This is private diagnostic evidence; the repair uses the public event and measured layout, not private IDs or a Cursor-name special case. Existing main empty/unknown/ambiguous group protections remain required.

A second source-level control reproduces the independently visible fronting problem: unchanged selection lets explicit Open Study skip a covered captured source, and existing Application is only fronted for observation entry. Layout restoration alone would leave the learning surfaces behind reading tabs. Both controls fail against unchanged product code before repair.

## Bounded repair and remaining verification

`StudyWorkspace` recognizes a wrapper refresh for one uniquely matching empty group outside the already measured main grid only when total count and column are unchanged, the new wrapper is reported changed, and no group was opened or closed. It never adopts main empty groups as owned or discards foreign groups. Existing group/tab/layout checks still reject ambiguity, manual changes and replacement. Explicit Study entry fronts the retained Application and an already loaded covered captured source in their existing columns, preserving reading tabs and drafts.

The first source-fronting predicate also queued behind a deliberately held Wiki source load. The combined suite stalled; a separate diagnostic identifies the existing pending-source test timing out at 15 seconds. Both interrupted runs remain failed evidence. The predicate now leaves an in-flight source load alone. The wider run then finishes 270/271: its one existing superseded-observation control shows that the newer Open must also leave a still-loading Application alone. That restriction now applies to fronting both surfaces, without weakening the old assertion. The final 21-case focused selection passes, including pending-source and superseded-observation controls, both new regressions, four empty-other-part rejection cases and existing identity/manual-layout protections. Full source/package suites remain pending at this checkpoint, as do a newly frozen VSIX and the original sequence in both hosts. No logging-only result is credited to the repair.

All three owned windows close normally with exit 0. Each cleanup verifies the original 62 files' exact bytes and modification times, retained unsaved draft, zero owned editor processes and zero connection descriptors. The two diagnostic videos also have inspected targeted transition contact sheets; console warnings/errors and temporary loading states remain qualified. The [manifest](wiki-reentry-manifest.json) binds private artifacts; retain them before moving or deleting this workspace.
