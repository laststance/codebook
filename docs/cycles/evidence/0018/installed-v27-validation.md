# Cycle 0018 — Unchanged v27 and Cursor overlap diagnosis

Recorded: 2026-09-23 JST. Development verification, not a final end-user trial. **Overall FAIL:** VS Code completes the expanded schedule; Cursor refuses the final initial Guided-to-Study transfer. No final-reviewer credit.

## Fixed candidate and scope

- Clean source: `9c697c997d45f698ee23b1ee7ab7bee784ef3b31`.
- VSIX: `artifacts/cycle-0018/installed-development-v27/codebook-cycle0018-v27.vsix`, 606,535 bytes; SHA-256 `73730ab2ff100288256072aabdab5880fdc138069dea5790314f3065cdad73a3`.
- Extension 0.2.1 / API 1.5; 275 source inputs, SHA-256 `ab1a9f75f382a15dc6a95abee37b7601d39bb7b24eac18780192888f26c9ccbe`.
- VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`, debugger 1.117); Cursor 3.21.16 / API 1.128.0 (`8ae78e8eee1e63479c7e0504b664bc0a80c68000`, debugger 1.93); macOS 26.6.2 arm64.
- Known development target Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`; ordinary CLI installations into fresh owned profile copies. All 29 installed files per profile are compared with the archive. This is neither randomized target selection nor editor-AI acceptance.

The 35-helper schedule is frozen before launch (combined SHA-256 `fabb4a2246f3fa60c910edebd50a0d8a7e1d6cae04f581c1de30555554c1014c`). Four failure-sensitive harness controls pass. Sequence: Cursor scope-negative, VS Code full, Cursor full, with sequential screen use and no failed-action correction/retry. The original schedule is extended by 60 Guided/Study pairs (120 transfers) and twelve explicit same-mode Study Restores per host, each preserving exact paused study, time, observation and frame without another runtime execution.

Before the first Cursor full launch, a separate amendment increases only the new retained-pairs subprocess budget from 180 to 300 seconds. Prior unchanged Cursor replacement measurements predict approximately 208 seconds for its 132 operations. `cursor-budget-amendment.json` records the prior measurements, calculation, candidate and wrapper hash `3e841af7ce41fcbdb7e4a3185d3bff23e02f808cf7386b1b701740833346f815`. The original frozen helpers remain unchanged. No product deadline, predicate, action or retry changes. Cursor fails in the initial phase, before that amended step is reached.

## Actual host results

| Host/phase | Result and boundary |
| --- | --- |
| Cursor scope-negative | PASS. Separate chat, Settings and learner draft survive the refused entry. |
| VS Code full | PASS. Cold entry, saved Wiki/exact paused replay, normal restart before any seek, twelve Wiki Returns, 24 Living/Guided transfers and Study restoration, 90 rapid transfers, the added 120 Guided/Study transfers and twelve explicit Restores, ordinary-file tab/document retention and fourth-group refusal all complete. |
| Cursor initial | Cold entry, saved Wiki/exact paused replay and six observation/recording Wiki Returns pass. The final Guided-to-Study restoration FAILS at 20:30:22.843 UTC after approximately 291 ms with `Native editor groups changed during pane creation; the learner arrangement was preserved.` |
| Cursor remaining | Restart, twelve Wiki/Study pairs, later mode/focus/stress transfers, file retention and fourth-group control are unexecuted. |

Cursor retains the prior Guided mode/preference and exact paused replay, reports the requested layout unconfirmed, and does not silently succeed. It is a product guard failure, not an AI-service timeout or Mac lock. The original 115 VS Code and 62 Cursor profile files, their timestamps and unsaved drafts survive; normal closure leaves zero owned editor processes and connection descriptors. The archive, 29-file installations and 275 source inputs remain unchanged throughout the native schedule.

All four initial and 21 restarted VS Code contact sheets, all four Cursor initial sheets and both scope-negative sheets are inspected. VS Code recordings last 37.0/245.84 seconds; Cursor initial lasts 46.72 seconds, at 1280×800 and 25 fps. Two additional VS Code three-second clips sampled at 10 fps (140 and 222 seconds) and the full Cursor failure screenshot are inspected. Replacement has visible transient blank/loading panels before the retained frame/source returns. One-second overview sampling and selected motion clips do not establish every frame, complete explanation accuracy or final reading usability. Test understanding does not represent owner understanding or acceptance.

## Source review and CI are separate

The final retained-document CodeRabbit supplement completes on its unchanged two-file diff in 377 seconds. Its one finding alleges missing production `BrowserViewport.rebindPanel`; the existing shared implementation, listener transfer and renderer restoration refute it. Triage records the shared file hash and symbol locations; zero actionable findings remain on that cut. The prior accepted wrapper-registration finding and its failing-before regressions remain recorded. Earlier H6 three fixing passes remain non-converged; this provider supplement does not rewrite that history.

[Actions run 35779952737](https://github.com/laststance/codebook/actions/runs/35779952737) succeeds on the same commit with 903 product/shared and 96 package checks. The downloaded artifact has the same 275 source inputs and all 31 unpacked entries are byte-identical. Its ZIP SHA-256 is `33d14499010be570f99f19a66ac0f0ba3aba4a439fc6793ad4fd046fe15f1dce`, different from the installed archive. CI cannot supersede Cursor's native failure.

## Logging-only Cursor diagnosis and bounded repair

A fresh private Cursor copy first normally installs v27, then instruments only the installed extension bundle to record group objects, logical identities, columns, tab inputs and active state. Original bundle SHA-256 `0c5e9fa9a2b3b4b6e5309e74080b1d2d2003077f3b1dfe49d31526285df22d9a` becomes `c32ad6a5c9c983fc349261b515eb1aed14fd8755449db6e694b4e0d90a3eee0a`; all other installed files and source/archive identity remain fixed. Logging can change timing. No action, predicate or deadline is changed, and the result is not unchanged-VSIX acceptance.

The initial sequence reproduces the same failure. Trace lines 193–196 show:

1. Before same-column app creation, group columns 1–4 have logical identities 1/10/8/9. The fourth is the previously verified empty separate part.
2. The temporary predecessor/successor pair adds a second owned app tab to column one.
3. Cursor replaces all four wrappers in a changed-only event, with no opened/closed group and no column or tab-order change. Other identities survive.
4. `retainsEditorTabs` rejects the duplicated app view type even though it is an owned handoff. Column one receives identity 11, so `sameEditorGroups` refuses pane creation.

The native window remains focused. The 45.36-second diagnostic recording has four inspected sheets; the retained Guided explanation, captured source and recorded application remain visible after refusal. Normal cleanup preserves all original files/draft and removes owned processes/descriptors.

The source repair registers a narrowly scoped same-column overlap only after the current role is globally unique. During the current transition/lifetime, an exact ordered tab signature with the expected pinned predecessor/successor count may survive a wrapper refresh in its unchanged column. Additional tabs, unknown inputs, changed order, moved/opened/unannounced groups, stale/aborted scope and unrelated duplicate inputs remain unowned. The overlap allowance is cleared on exit; lease and final unique-tab checks remain unchanged. Both app/context group-refresh regressions fail before repair with the observed native error. The six new cases and existing wrapper/ownership controls pass: **27 focused checks**. Full checks pass **909/909 product/shared + 96/96 package**, both builds and four typechecks on 275 unchanged inputs (`9db57af7b0093a4247830f50d3bf4b28bb17a11ebd7432d69952cbc1d5d5673e`). The exact two-file CodeRabbit supplement completes in 319.0 seconds with zero findings and unchanged diff. The [repair manifest](overlap-group-repair-manifest.json) binds its checked inputs and results. A new clean normally installed both-host candidate remains pending; v27 remains FAIL.

Private evidence: `artifacts/cycle-0018/installed-development-v27/`, `pane-handoff-trace-v27-a/`, `overlap-group-repair/` and the final retained-document supplement. The [v27 manifest](installed-v27-manifest.json) binds concluded native, diagnostic, provider and CI artifacts. No permanent Mac settings or credentials change; process-bound sleep inhibition ends with each native runner. T3/T4 remain open, T5 delivery pending. G12 and the carried Wiki storage-wait focus race remain unfinished. Final gate: **0/10 reviewers, 0/at least 20 editor trials, not started**. Claude Code CLI reviews remain owner-skipped.
