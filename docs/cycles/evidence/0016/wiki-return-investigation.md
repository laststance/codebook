# Installed Wiki Return location investigation

Date: 2026-09-21
Scope: Cycle 0016 P07; exact observation/recording return in all three presentations.
Status: DONE_WITH_CONCERNS; [installed v14](installed-validation-v14.md) demonstrates the original and restart cases separately in both hosts.

## Original installed result

The additional six-case schedule used the exact v13 VSIX `36461d58a04d5acc861005404c03db6a4d7d853921d29e0e40f3ef2747c1bb1d`, clean source `4d997687604dbbe818e9f5e25f550ce5bc7d8c57`, ordinary VS Code 1.138.0 (1440×900) and Cursor 3.21.16 (1280×800), dark theme. Each mode opened the same current article, then its observation and recording, and returned with identical article/revision/citation/understanding/focus and a control position within 3 px. The predeclared public authoring amendment created a separate linked book because the original v7 book had no observation links. It preserved the original book and learner decision; no application execution was added.

VS Code passes 6/6 with zero pixel displacement. Cursor passes 5/6, then Guided recording returns the correct control at y=605 instead of y=341: a 264 px displacement. Exact item identity is insufficient to pass reading-position retention. The failed schedule restores Study during cleanup; that cleanup does not clear the failure. Both hosts close normally and retain exact saved/unsaved unrelated drafts, zero owned processes and zero descriptors.

Private root: `artifacts/cycle-0016/`. The frozen schedule/authoring amendment and driver hashes are under `wiki-v13/`; original receipts, 18 VS Code screenshots, Cursor failure screenshots and 12 fps native recordings are under `native/{host}/wiki-v13-r2-*`. The original Wiki snapshot used `#error` instead of `#errors`, so its empty error field is not proof of no Wiki errors; the new schedule corrects that selector. Study errors were checked with the correct selector. Original complete console counts remain qualified: VS Code 2 errors / 31 warnings; Cursor 18 errors / 17 warnings. No new extension-disabled attribution control was run.

## Root cause and disconfirming control

A slower Cursor diagnostic with 16 post-return samples passes 6/6. It does not clear the original fast-sequence failure. A second diagnostic preserves the original sequence and captures actual message/scroll handlers: Study recording remains displaced by -72 px for 1.6 seconds; Guided recording remains displaced by -9.5 px. The host sends the correct explicit original reading location, but the reconstructed webview prefers `getState()` location saved during native pane movement. This is stale presentation-cache precedence, not an incorrect saved Study origin or merely unfinished scrolling.

The second trace contains 139 events. For Study recording, the incoming focus viewport fraction 0.667420814479638 and 442 px inner height predict local y=295 (native y=365); the renderer restores local y=223 (native y=293). Private diagnostic traces, plans, driver freezes and separate videos are retained under `wiki-v13/` and `native/cursor/wiki-v13-diag*`. Diagnostic instrumentation is removed by closing the owned editor; the installed v13 bundle remains unchanged. Final diagnostic shutdown records exit 0, eight owned processes retired, zero descriptors and one exact draft backup. Its complete console has 23 errors / 27 warnings and is not attributed solely to Codebook.

## Minimal repair and renderer regression

`extension/src/ui/repositoryHtml.ts` now gives explicit host `selection.location` priority when reconstructing an article. Same-article cached reading remains the fallback when no explicit location exists; a different article ignores that cache. Existing capture/restore functions and public contracts are reused.

`extension/scripts/repository-return-qa.mjs` drives the actual compiled renderer through Playwright CLI in Chromium, with controlled host messages and cached webview state. Before the repair, observation and recording Return use y=110.5 rather than expected y=221; both fail, while same-article fallback and foreign-article isolation pass. After the repair all four pass, with explicit returns at y=220.5 (within the fixed 1 px tolerance), cached fallback y=110.5 and foreign-article scroll 0. All cases preserve unchecked understanding. Reports, screenshots and 1.4-second 25 fps videos are under `wiki-v13/renderer-{red,green}/`. Three sampled frames from each were inspected: the 326×442 reader occupies part of an 800×450 video with gray padding and rapid case transitions. This renderer test is separate from actual-host motion proof.

Commands: `pnpm --dir extension build`; `node extension/scripts/repository-return-qa.mjs red artifacts/cycle-0016/wiki-v13/renderer-red` before repair; `node extension/scripts/repository-return-qa.mjs verify artifacts/cycle-0016/wiki-v13/renderer-green` afterward. The red command expects the two reproduced failures and two passing controls; it is not a product PASS.

## Next evidence

Freeze a new clean v14 candidate, run complete product/shared and package suites, compare its archive with v13, and install/reinstall the same archive in each ordinary host. Repeat the original six cases without diagnostic hooks, with the corrected Wiki error selector; inspect native motion, confirm saved replay/1-of-4 understanding and zero runs, then close/restart and repeat. Preserve any failure separately. Product runtime bytes changed, so the prior runtime-byte-equivalence chain does not qualify v14; the old full fixture result retains its own source identity. Current review, CI, merge and final main archive comparison remain separate gates. Goal #1 stays open; final reviews remain 0/10.

## DEBUG REPORT

- Symptom: Cursor Guided recording Return restores the correct control 264 px away from the original reading location.
- Root cause: reconstructed article preferred stale cached viewport state over the correct explicit host origin.
- Fix: `extension/src/ui/repositoryHtml.ts:105` prioritizes explicit `selection.location`, preserving cache-only fallback.
- Evidence: two real-renderer red cases become 4/4; fresh 680/680 + 96/96 suites; exact v14 archive installed/reinstalled in both hosts; original/restarted native schedules each pass 6/6 with zero x/y displacement.
- Regression: `extension/scripts/repository-return-qa.mjs`; controlled host/cache inputs in actual Chromium, separate from native evidence.
- Related: D016/D017 exact reading return; earlier source-focus investigations remain separate.
- Status: DONE_WITH_CONCERNS. Repair demonstrated; native intermediate motion, constrained reading and console attribution retain the limitations in v14.

Durable project finding: when reconstructing a native webview after pane movement, explicit navigation state must outrank presentation cache. A slower diagnostic pass can hide the original sequence; preserve both schedules and bind traces to the actual document's handlers.
