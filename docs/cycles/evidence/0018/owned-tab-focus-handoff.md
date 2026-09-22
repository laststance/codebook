# Cycle 0018 — Focus delivery boundary and message handoff

Date: 2026-09-22. Follow-up to the [native/inner-focus investigation](owned-tab-focus-investigation.md). Base product source is still `92b3a29f7a65829ac2a5f9e5c780f034bfa98ebd`; these are private instrumented installations, not repaired product candidates. T3 resumes a bounded implementation plan; T4 remains FAIL and T5 incomplete.

## Identity and method

Each of G, H and I starts with a fresh protected profile copy and an ordinary CLI installation of the same v17 VSIX, SHA-256 `edd2ecb967b8ee089f6cccfbb17fc75c1d465cd37576625ae48554fe4d8e70ee`. All 29 installed files match before the private bundle/manifest instrumentation. The original bundle hash is `fdee6b0f8ed4c51c8cb2f507434d847790c75c22ec65f1fe785ab95aaa4de5dc`. Private schedules, helper hashes, actual modified identities and results are in the [separate manifest](owned-tab-focus-handoff-manifest.json); the earlier manifest is unchanged.

All three use ordinary VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`) on macOS 26.6.2 (25G83), arm64, with 1280 × 800, 25 fps native recordings. The familiar Laststance.io checkout remains `43d039938287ed494a66f4fad198da2464a9e7b0`. Dedicated windows run direct-MCP development controls, not AI-chat or random-repository acceptance. No Cursor or G12 result follows.

Observers record native window focus, top-level document focus, outer/inner focus events and host delayed-focus guard values. False conditional debugger logpoints resolve against the exact loaded workbench, SHA-256 `0473f6505c5e547a4c484fa586678ce824a7910784f2d1060be4cb5b4010fe27`, equal to the installed file. Logging may affect timing. The frozen rapid schedule stops at the first failure and never retries a failed transition.

## G — Minimal control passes; original failure retains window focus

Root: `artifacts/cycle-0018/owned-tab-nativefocus-v17`. Modified bundle SHA-256: `2b2fe75f1fc16cc0a1a042d36d330eda97aee0f3e41a5386f398d4bb130a01a4`.

Fifty minimal source-to-Context restores pass at 05:52:20.487–05:52:28.982 UTC. All fifty delayed host guards permit the inner focus message. This isolates a working control without grid movement; it does not falsify the full transition failure.

The subsequent public mode loop completes 48 transitions, then Study-to-Living fails with the original owned-tab-active timeout. At 05:53:11.175 Application is revealed. Its delayed focus message is sent at .231, after Keep finishes and Context reveal starts at .229. Context becomes natively active at .233, but Application becomes active again at .239 without another Codebook reveal. Context's .284 delayed guard observes both `isFocused=false` and `activeIsElement=false`, and sends no inner focus message. The wait expires at 05:53:16.234.

The native window and top-level document stay focused throughout that failure. Whole-window blur therefore does not explain this reproduction. The original candidate remains failed. A keyboard shortcut for saving the trace also times out because of Webview routing; a later read-only Open Quick Access toolbar command saves it. That capture fallback was added after the helper inventory, and is neither a retry nor a repair of the product transition.

## H — Waiting cannot repair a suppressed inner focus message

Root: `artifacts/cycle-0018/owned-tab-focusbarrier-observed-v17`. Modified bundle SHA-256: `6ef75a4c8ad2454c38d9c3946dbda2e3a5e769a800a41d7b8e79c2cf2af3ec9b`.

This repeats the earlier private receipt-wait intervention with the missing window/host observations added. Twenty-six public transitions pass; Guided-to-Study then fails with `Timed out waiting for diagnostic inner document focus`.

At 05:59:26.553 Context's inner document blurs while source receives focus. Final Context reveal occurs at .687; native activation follows at .689 and outer-frame focus at .692. At .743 the host's delayed guard has `isFocused=false` **while `activeIsElement=true`**. No inner focus message is sent. The inner document remains unfocused for the five-second wait, while the native window, top-level document and outer frame remain focused.

The exact host implementation's `isFocused` getter checks its private focus flag, window and active element. With the latter two conditions satisfied, the false flag explains the suppressed send. A delayed `did-blur` from the earlier inner blur is consistent with the source and timing, but that callback was not directly instrumented in H; it remains a causal inference. Unlike the earlier F trial, whole-window focus loss is excluded for this observed failure. Merely waiting for receipt does not repair it.

## I — Bounded public-message intervention passes

Root: `artifacts/cycle-0018/owned-tab-messagefocus-v17`. Modified bundle SHA-256: `397bde7271f05f6c61fbcf80b16a67c2777be4942f9a0426e444d1031bf70ed0`.

Only the two owned presentation-focus operations change: reveal with `preserveFocus=true`, then send one public Webview message that asks the intended inner document to call `window.focus()` once. Completion requires the matching document-focus receipt and actual owned native-tab activation. The original deadline, placement guards and native-window-focus requirement remain; there is no focus retry.

All ninety public transitions pass: thirty Living/Guided/Study triplets, 06:07:07.534–06:08:07.939 UTC. All 210 message-focus starts have corresponding completions. None of the original host `_doFocus` request, delayed-guard or send-focus logpoints fires during this loop. The 4,059-event extension trace is below its 4,096-event limit. End state is confirmed Study with saved preference, the same exact paused replay and zero runtime runs. Post-trial installed equality confirms the diagnostic bundle/manifest remain unchanged and the other 27 packaged files still match the original.

This is a promising **diagnostic PASS only**. Its prototype covers live/replay and Context renderers, but not static captured/empty/error Application HTML. It lacks the production request/document-lifetime protocol, complete cancellation/learner-focus controls and both-host installed evidence. Do not copy it into the product without those checks or promote it into T4/final acceptance.

## Preserved state and inspected video

All three initial entries restore exact paused replay at `11405.3895 ms`, observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, frame `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`. G/H retain the previous mode/preference after failure and mark the requested placement unconfirmed. No corrective retry, seek or new execution follows a failure.

| Trial | Video duration | Visually inspected one-second sheets | Other sheets |
| --- | --- | --- | --- |
| G | 287.08 s | 60–71 s minimal control; 108–119 s visible owned-tab timeout | 22 uninspected |
| H | 318.20 s | 84–95 s changing layouts; 96–107 s visible inner-focus timeout | 25 uninspected |
| I | 298.28 s | 72–83 s changing layouts; 120–131 s final triplets and stable Study | 23 uninspected |

These sparse samples preserve visible transition/failure evidence; they do not prove every animation frame, complete constrained-layout readability or final usability. All three windows close normally with exit 0. Each preserves all 115 original profile files byte-for-byte and mtime-for-mtime, and retains the unsaved draft backup. Cleanup verifies zero owned editor PIDs and connection descriptors, terminating only the exact owned idle background app after normal close and backup checks. User work remains protected.

## Next action

Implement the [reviewed bounded focus handoff](../../../plans/cycle-0018-owned-focus-handoff.md), first retaining failing-before public-method tests for the optimistic native acknowledgment and suppressed inner delivery. Use one renderer protocol across live, replay, static, empty and error pages; distinguish its acknowledgment from a frame-paint receipt. Bind request and document lifetimes, stop on native-window blur/cancellation and preserve prior focus/preview/source ownership guards. Then run appropriate full tests, current-source CodeRabbit review and a new unchanged VSIX schedule separately in VS Code and Cursor.

No new product test run, release, PR, merge or G12 implementation is claimed here. The prior 785/785 plus 96/96 source checks retain their original cut. Claude Code CLI remains owner-skipped. Issue #23 and Issue #1 stay open; final acceptance remains **0/10 reviewers and 0/at least 20 editor trials, not started**.
