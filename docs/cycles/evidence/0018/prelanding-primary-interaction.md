# Cycle 0018 — Borrowed primary focus and newer learner interaction

Development review and regression evidence, 2026-09-22. The earlier [v20 installed pass](installed-v20-validation.md) retains its exact source/archive identity; it does not certify this later repair. G12 remains unimplemented and final acceptance remains unstarted.

Checkpoint provenance: dirty working tree on `6d134c52bf2ec5a3fc1f801100feee7c3effb2c5`. The first repair has 273 selected inputs with SHA-256 `6a4a5cc0dd4f108e317ffda97b1f50dc29ae24f4f8fa31c849e0f8d8751d731f` (`repaired-inputs.json`); the subsequent restoration repair has SHA-256 `fcbbb5351dab8223bcfe783bfddc3b4e49f9a825870d6e74293d977f1b64be18` (`restoration-repaired-inputs.json`). The final pre-command baseline repair below has SHA-256 `a76bbfb6cffd6321645786e86cf3a7642f1207f04dd931f4d0d7fd625c62d211` across the same 273 inputs (`primary-response-repaired-inputs.json`). Source/package checks run on macOS 26.6.2 arm64. No archive is built or frozen for these repairs yet. Prepared but unlaunched v21 profiles target VS Code 1.138.0 and Cursor 3.21.16 / API 1.128.0. Source/package checks do not substitute for native evidence on those hosts.

## Reproduced finding

Pre-landing review of `6d134c52bf2ec5a3fc1f801100feee7c3effb2c5` against `c3cee826ea6e7c25e835b381a320bcd39ec477d9` identified one additional ownership race. Cold Wiki scope measurement temporarily focuses the primary editor, awaits the native layout read, then restores the original editor. The existing retained-placement check identifies the same file/group, but cannot distinguish a newer selection or edit within that file. Consequently restoration can take focus away from the learner's newer interaction.

A fresh in-host adversarial reviewer executed an extracted production-method probe; the driving agent independently repeated it. Ordinary restoration and a different-tab preservation control pass, while a same-file selection incorrectly restores the old editor. This establishes the asynchronous mechanism, not its frequency in a native host. Production-method SHA-256 before repair: `79eedf759a4baed3626ae7c1027bfaa5791b2e20ebad5e6973ab12b5099917a9` for `extension/src/studyWorkspace.ts`.

## Narrow repair and checks

Scope measurement now captures the borrowed primary text editor's document version and selections. Before any restoration it rejects changed content or selection, clears obsolete focus ownership and leaves the learner's primary editor active. The normal unchanged-editor path still restores the original focus. Existing pane/group/tab guards, deadlines and cancellation behavior remain.

The public cold-Wiki regression holds the actual layout-read boundary, changes either the selection or document, and verifies preserved focus/content, unchanged separate-part layout, no layout mutation and no application run. Its unchanged-editor counterpart verifies normal restoration. Before repair the two interruption cases fail and the ordinary counterpart passes. After repair the focused six-case group and complete suites pass.

| Check | Result | Private artifact |
| --- | --- | --- |
| Independent production-method reproduction | New same-file interaction loses focus before repair | `artifacts/cycle-0018/v20-prelanding-native-focus-repro.json` |
| Driving-agent reproduction | Same failure independently repeated | `artifacts/cycle-0018/v20-prelanding/native-focus-red-reproduced.json` |
| Public-method regressions before repair | 2 expected failures, 1 passing ordinary-restoration control | `artifacts/cycle-0018/v20-prelanding/primary-interaction-red.tap` |
| Focused repaired and interruption checks | 6/6 PASS | `artifacts/cycle-0018/v20-prelanding/primary-interaction-green.tap` |
| Complete product/shared tests | 819/819 PASS; zero skipped/cancelled | `artifacts/cycle-0018/v20-prelanding/product-fixed.log` |
| Serial package regressions | 96/96 PASS; zero skipped/cancelled | `artifacts/cycle-0018/v20-prelanding/package-fixed.log` |

`fixed-checks.json` records exact commands, timestamps and exit codes. Product tests completed at 09:33:54 UTC and package checks at 09:34:14 UTC. The related README correction distinguishes the older Cursor restart failure from v20's bounded successful recovery and this new repair's pending installed verification.

## Second review: restoration response boundary

A second fresh in-host reviewer finds a later boundary in the same new scope helper. `showTextDocument` can apply the focus effect before its asynchronous response arrives. A learner selection during that interval is subsequently overwritten by the captured selection setter. Its independent public `arrangeRepository` probe observes line 20 → learner line 99 → stale line 20, with successful completion. The unchanged counterpart retains line 20. Exact installed VS Code 1.138.0 and Cursor 3.21.16 API bundles corroborate a separate asynchronous display request and selection RPC; native incidence remains unexecuted, not inferred as an observed host result.

The repair verifies the active editor identity and both active/returned selections before issuing any later selection or reading-position restoration. A changed selection or a newly focused editor retires recovery ownership and remains untouched. It does not attempt to undo a focus effect already accepted before the learner's input.

Three public-method controls exercise newer selection, another focused editor and ordinary restoration. The two interruption controls fail before repair while the ordinary counterpart passes. After repair all twelve related focus/edit/cancellation checks pass. The driving agent reruns the second reviewer's unchanged production-method probe with only result filenames and expected outcomes adjusted: the interrupted case now preserves line 99 and rejects; the normal case preserves line 20 and succeeds. This green reuse is not another independent reviewer. An initial test-only TypeScript annotation mismatch prevented the first red run; its corrected build supplies the two expected product failures. Both logs are retained.

Private evidence: `pass2-review.md`, `pass2-source-inventory.json`, `pass2-native-api-source-evidence.json`, the red `pass2-scope-restoration-*-result.json`, `restoration-red.tap`, `restoration-green.tap` and green `restoration-fixed-*-result.json` under `artifacts/cycle-0018/v20-prelanding/`. The complete second-repair suites pass **822/822 product/shared + 96/96 package** with zero skipped/cancelled checks. Exact commands and timestamps are in `restoration-fixed-checks.json`; logs are `product-restoration-fixed.log` and `package-restoration-fixed.log`.

## Third review: primary command response boundary

A third fresh in-host reviewer finds the corresponding earlier boundary: the primary version/selection baseline was captured only after `focusFirstEditorGroup` returned. A same-file selection or edit after its focus effect but before its response therefore became the operation's baseline, permitting restoration of obsolete secondary focus. The independent public-method probe demonstrates selection line 7 and edit version 2 / line 9, each followed by an old-focus restoration and successful completion. A different-tab control already rejects; the unchanged control correctly restores. These are controlled API-boundary results, not native timing observations or lost file content.

The final repair captures the already visible primary text editor before issuing the focus command. If that receipt is unavailable it refuses before the effect. The captured version/selections now cover both focus-command and layout-read awaits. Two public interruption tests fail before this change; the ordinary control passes. Afterward, **23 related checks pass**. Reusing the independent probe with only its output filename changed verifies three preserving rejections, zero stale restorations, and one normal unchanged restoration. The complete final-source suites pass **825/825 product/shared + 96/96 package**, with zero failures/skips/cancellations. Logs are `product-primary-response-fixed.log` and `package-primary-response-fixed.log`; the command/timestamp receipt is `primary-response-fixed-checks.json`.

Evidence under the same private directory: `pass3-review.md`, `pass3-source-manifest.json`, `pass3-focus-command-probe.json`, `primary-response-red.tap`, `primary-response-green.tap`, `primary-response-fixed-probe.json` and `primary-response-fixed-checks.json`. The parent's green probe reuse is distinct from the independent red review.

## Review and remaining gates

CodeRabbit's first completed review covers 86 branch files with zero findings, but predates the repair. Its diff SHA-256 is `9d973e344504e383ad2b88c5429f194afdf15bf79f5ae708bd86e658b209b04e`. The native review found the race above; its fixtures were reviewed in summary mode, while the driving agent read the changed test diff. The first structured/adversarial passes are recorded as completed, finding-bearing and non-converged. Their result must not be described as a clean review of the repaired tree. Claude Code CLI remains explicitly owner-skipped.

The first CodeRabbit repair supplement completes on seven changed files with two minor comments describing one documentation-provenance topic in PROJECT_STATE. The second seven-file supplement repeats that topic for the bounded plan. Explicit source fingerprints, host targets and unavailable archive are now retained in each current checkpoint; neither supplement reports a product-source defect, and both predate the third repair.

All three native/structured passes complete with a fixing finding. This `/review` workflow reaches its three-fixing-pass limit and ends **non-converged**. The final repaired-source CodeRabbit supplement completes on seven files with one major comment about the test boundary. It is declined against the actual aliasing: in the primary-response case `measured` is exactly `firstRead`; its `started` promise is awaited before interaction and its release happens afterward. The red/green controls and independent public-method probe establish that ordering. `coderabbit-final-triage.json` preserves the comment and reason; zero actionable provider findings remain. This supplement does not certify a clean whole-branch native pass. Neither the earlier reviews nor the green regression probes do so. Claude Code CLI remains owner-skipped. T4 is reopened for a new frozen VSIX and both ordinary-host schedules before T5 current-head review, CI/artifact correspondence and PR/merge. Preserve the earlier failed attempts and original profile/draft protection. No new archive is claimed here. Final counts remain **0/10 reviewers and 0/at least 20 editor trials, not started**.

The [sanitized artifact manifest](prelanding-primary-interaction-manifest.json) records checksums and availability for each private proof. It preserves the dirty tested checkpoint independently of any later clean commit/archive.
