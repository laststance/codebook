# Cycle 0031 — Preserve the first replay command

Type: product-increment\
Status: closed (reviews, local checks, PR/CI, exact-HEAD gate and separate merge complete)\
Result: demonstrated (first-command ownership, visible-time paint budget and the soft inspection gate at mechanism level, plus bounded both-host development video on the f95562ba cut; native behavior of the soft gate and final product acceptance remain open)\
Delivery: merged (PR #54 squash-merged as `58f2fa6`; private 0.2.15 VSIX checked; not published or final-installed)\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/53\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G03, G04, G05, G07, G11\
Source state: [Cycle 0030 closure](0030-node-run-integrity.md#corrective-delivery-closure-2026-09-30), [PROJECT_STATE](../../PROJECT_STATE.md)

Current owner authorization: [D043](https://github.com/laststance/codebook/blob/e32add3a723888166383a951d202d7d62d509d88/DECISIONS.md#d043--resume-completion-and-authorize-protected-mac-use-2026-09-30) explicitly revokes D042's conditional stop. Continue the current ACK repair/proof and then the existing completion workflow, including reviews/PR/CI/merge and later bounded cycles. Protected Mac use while the owner sleeps is authorized. D042 stop statements in earlier receipts/review plans below are historical, not current next actions; all product/evidence/preservation gates remain.

## Viewport ACK compaction entry and new failure, 2026-09-30

Fresh full current-disk mandatory reads completed after compaction, including the full active cycle; DEVELOPMENT, controlling D025–D042, behavioral design, complete interaction review, both QA guides and TypeScript rules also read. Actually opened the approved PNG: live application/source/native debugger/standard chat with bottom capture/save; replay substitutes summary/sequence at a shared gap-marked playhead; independent DeepWiki includes chapters/article/outline/update/output/citations/Q&A; shortcuts include keyed tooltips/searchable help. D036 image identity unchanged.

Branch/head remain codex/cycle-0031-replay-transport/ce89dbd; preserved dirty work and external dashboard1936e419 with only existing.codebook/. Serena LSP ready. Primary AC-REPLAY: native-client retrieval wait is implemented, but a new native trial again reaches viewport delivery and fails its paint ACK. AC-ENTRY/GAPS/SAVE/LEARNING/DESKTOP retain separate unverified native/preservation/image boundaries. Other seven product-source paths are unchanged and carry their prior limits; all13 integrated rows remain open. D042 limits continuation to this ACK investigation/repair/necessary proof, then pause; no PR/merge/new increment.

Native input became usable; the previous lock prerequisite is superseded. OBS exact QA target was reselected, transform verified2880×1800/position0/rotation0/allcrop0 and canvas/output2880×1800/30fps, both audio mutes1. New silent preflight146.033333s/4381frames/SHA93041c18…: actually viewed full frames2/50/90/135 verify changing sidebar content and exact full-window capture while OBS is in front. Acquisition PASS only, no replay PASS.

New main take on installed runtimea01a78f2:413.133333s/12394frames/H.2642880×1800/30fps, SHA49757d4321a2f014b774cc22bcd0a99e8d57389bdc54c6f78ed085a449e310a2. Actually viewed full frames15/35/50/54/60/70/400. Early samples remain painted120.54s despite native actions; late400s shows capturedsource75 and playback unavailable with Presented still120.54s. Thus this take does not verify first-command navigation or native-readiness ordering. Exact public diagnostics: first#2 and retry#3 each received(hidden,area), decoded, paint-queued, then ACK timeout; panel visible. This reproduces the original failure, not the native-inspection deadline. Post-action AX index changes alone did not establish a mis-targeted click; that premature hypothesis is withdrawn. No production fix yet.

Private receipts: native-readiness-vscode-preflight-01.json, native-readiness-vscode-main-01.json, frozen main-expectations and action timestamps under artifacts/cycle-0031/native-replay/. Originals retained; OBS recording stopped/finalized. Selected next experiment: correlate actual document visibility/paint availability with the extension wall-clock deadline and public native activation before selecting a remedy. Source trace: BrowserViewport accepts hidden ready/stage messages; viewportHtml queues two animation callbacks; FrameDelivery expires after3000ms independently. Context7 official Electron documentation confirms macOS occlusion can mark documents hidden; simple OBS covering previously did not reproduce the failure, so its exact native trigger remains unconfirmed.

ACK engineering review: unchanged-source serialized renderer probe reproduces the deadline mismatch while animation callbacks are withheld; late restored paint is ignored after timeout. This establishes the mechanism, not the exact native occluder. Bounded plan: actual current-epoch visibility reports control a monotonic recording-only visible clock; FrameDelivery retains each original3000ms deadline and reschedules its existing timers on visibility changes. Hidden work stays loading/cancellable, never confirmed. Visible unresponsive and unknown renderers still timeout; LIVE keeps wall-clock capture deadlines. Gap paint uses the same clock and existing revision/epoch/closed/abort guards. No fabricated ACK, timeout extension, forced focus, target action or new class/dependency.

Selected sources: browserViewport.ts/frameDelivery.ts/utils/viewportHtml.ts and existing runtime-browserViewport/runtime-frameDelivery tests, plus cycle/state records(7 paths). Primary AC-REPLAY; dependencies ENTRY/GAPS/SAVE/LEARNING/DESKTOP. Existing cancellation, stale receipts, confirmed preference and source/native readiness remain required. T1 actual serialized-renderer red cases(initial hidden, hide after decode, hidden gap) before product edits; T2 minimal repair/green/disabled-fix control; T3 focused/all-workspace/full/package after readers, new checked private VSIX and separate both-host OBS native frames, then stop/pause underD042. Native/exact-trigger/final work remains unverified until performed.

Host `/plan-eng-review` completed Scope Challenge, Architecture2/Quality1/Test6/Performance0;9 mapped obligations,0 critical silent gaps,0 unresolved choices. Scope accepted as-is; routine mechanism/regression choices under ownerD042/D032 authority, no repeated permission or product cut. Claude CLI owner-skipped; declared native fallback unavailable, no outside reviewer coverage. Full saved review/QA/task artifacts: private ack-eng-review-paths.json. Review log/read-back passed; status ISSUES OPEN names implementation/proof obligations. Sequential implementation; independent test files retain isolated parallel execution.

## Question and authorized scope

Can one replay command retain the learner's requested recorded moment when it reveals a hidden Application tab, without restoring an older moment or changing unrelated work?

Cycle 0029 observed that the first transport command after hiding Application only re-revealed it and dropped navigation. This blocks the central synchronized time-travel experience. Cycle 0030 and its late-review repairs are delivered through PR #52; exact merge `ce89dbdc21250d8085391f0d83eae5fb0c762789` and post-merge main CI 36646491256 are verified. D026/D039 authorize continued bounded product work; no product-scope or design change is proposed.

## Hypothesis and scope

- **Confirmed root cause:** {@link StudyWorkspace.presentPlayback} calls {@link StudyWorkspace.ensureReplayViewport}; revealing Application fires its visibility callback, which calls {@link PlaybackController.reveal}. Before this increment, it queued the old committed bundle while the requested seek was loading, invalidating the new request. Three red tests below reproduce the 100 ms request returning to 0 ms; the loading ownership guard fixes those mechanism cases.
- **Smallest observable outcome:** hide Application, issue one Next/Previous/seek from the retained replay controls, and get exactly the requested application/source/native-debugger moment without a second click. A passive reveal without a new command still restores the committed moment.
- **In scope:** investigate this ownership boundary; if confirmed, retain the active request through passive visibility notification using the existing controller state/queue. Add focused regression and integrated workspace checks; verify the existing saved dashboard replay separately in installed VS Code and Cursor.
- **Retained outside this increment:** retired presentation commands, Wiki/theme/offline-help work, natural multi-stop chat, Node saved-learning completion and nine-project final acceptance. These remain active gaps, not removed requirements.
- **Falsifiers:** the controller test does not reproduce the dropped command; native first-click failure remains after the mechanism fix; passive reveal still cancels a newer seek; explicit Pause/hide, initial-load recovery, gaps or stale-command protection regress. Investigate evidence before choosing another source change.

## Plan and selected skills

1. Complete fresh mandatory entry, actual PNG inspection and all-row current-source audit; record the result below before implementation/runtime.
2. Use `/investigate`: trace the recorded failure, prior history and current visibility/request path, then reproduce it with the existing real-controller harness. No production fix before root cause is confirmed.
3. Use `/plan-eng-review` to review the bounded ownership rule and regression/native proof. Reuse approved replay outcomes and D026 routine implementation authority; no scope/contract choice is reopened.
4. Add red behavior tests, implement the proven smallest change, run focused tests and an independent disabled-fix control. Run full extension and package suites sequentially.
5. Build/check a private VSIX, then run the saved dashboard replay via public native UI in VS Code and Cursor. Record video and inspect frames; compare the replay region with the approved PNG. Preserve unrelated tabs/debug sessions, source, skills, settings, learner decisions and drafts.
6. Update affected gaps/results; OCR plus local CodeRabbit, `/ship`, latest post-Ready Codex review, exact-HEAD CI and separate root gate/merge under D039. Keep all final acceptance stages and owner acceptance open.

## Accepted product and design

- Phase: planning under D026/D039. Primary AC-REPLAY; regressions AC-ENTRY, AC-GAPS, AC-SAVE and AC-LEARNING.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, D036 approved. Fresh Cycle 0031 image-viewing action completed with the image tool and matching SHA; current full-read/entry receipt is below.
- Relevant target: replay reuses the live application/source/native-debugger composition with Learning summary/sequence replacing chat and one gap-marked timeline. This increment proposes no new screen or controls.
- Authority: full replay/shortcut contracts, D032 shared historical moment, D034 ordinary desktop/default zoom and context-preserving summary behavior; existing goal 9 and nine-project matrix are unchanged.

## Source-gap audit and selected increment

Baseline: merged `ce89dbd`, tree `c567d6d62cb1105ae3a51df4277448f1e5532bec`, byte-identical to reviewed `53563ab`; full 1,365/1,365, package 175/175, focused 29/29 and hook 4/4 PASS. Final 0.2.14 package is checked but not installed/native-verified. Original native proof remains `fb7f472`/.2.12 and its own receipts. No Stage 1/Stage 2 PASS.

Preparation inspected current controller/visibility/presentation and the existing test harness, plus source entries below. This is an all-row reconciliation, not a claim that any row passes. Fresh full-read/image/branch entry is recorded below. Generation outcomes and actual desktop fidelity remain UNKNOWN with named later inspections/trials; they are not implementation PASS.

| AC | Current source assessment / separate proof gap | Next action or carry-forward |
| --- | --- | --- |
| AC-LIVE | {@link OwnedNodeTestRun.complete} refuses contradictory failed-report/exit-0 success and preserves real failed exit 1; canonical report aliases identify only the cited file. Current mechanism/CI proof is complete. Natural both-host/all-runtime execution remains unverified; native receipts are on the original .2.12 cut. | Carry those exact bounded receipts; natural multi-stop execution remains a later required trial. |
| AC-SAVE | {@link LearningLibrary.saveStudy} checks owned capacity and prior checkpoint, writes archive then metadata; {@link LearningLibrary.readCheckpoint} distinguishes incomplete metadata. Complete Node journal does not prove saved/reopened synchronized learning. | Preserve existing archives; save/reopen and failure status remain regression checks and later Node proof. |
| AC-REPLAY | {@link PlaybackController.command}, queue/pump/hide/reveal and {@link StudyWorkspace.presentPlayback} expose the visibility replacement hypothesis. Frame/source/debugger readiness is checked before the playhead commits. Existing tests cover cancellation but not a reveal during the new request. | Selected increment: red reproduction, retained request and both-host one-command saved replay video. |
| AC-GAPS | {@link projectRecording} exposes debugger state only at a captured point or sealed pause interval; {@link StudyWorkspace.presentPlayback} clears/retires old native values and presents missing history. Existing bounded proof is older and same-candidate motion remains open. | Regression: one seek into a gap clears old source/values and a recorded point restores matching state. |
| AC-LEARNING | {@link LearningLibrary.decide} persists explicit idempotent decisions separately from save; source references show calls from reader/workspace learner actions, not runtime completion. Summary/progress/native restart/drift proof remains incomplete. | Preserve decisions; new transport only saves a confirmed playhead, never marks understanding. |
| AC-WIKI | {@link startDeepWikiReader} validates the manifest, serves owned pages and invokes source-grounded Q&A independently of runtime. Prior reader/Q&A evidence is bounded; fresh full generation/update and final reference fidelity remain open. | Unchanged reader/generation paths carry their exact prior limits; broader generation source/quality audit remains required after core replay. |
| AC-WIKI-UPDATE | {@link resolveDeepWikiDirectory} bounds relative output to the project and permits explicit absolute settings. The current reader re-reads its manifest/freshness per request. Generation/update failure/manual-conflict and relocated-output outcomes remain unverified. | Carry previous settings-link proof; inspect the generation/publisher contract and run those flows when selected. |
| AC-SOURCE-LINKS | {@link rebindDeepWikiEditorLinks} binds source/update/settings links to the serving host; prior real citation/settings clicks are host-attributed. Wrong checkout/moved file/drift and final same-candidate proof remain open. | Source-link routes unchanged; retain prior proof and later wrong-root/drift controls. |
| AC-ENTRY | Activity Bar navigation exists; {@link StudyWorkspace.bindApplicationPanel} calls hide/reveal on actual visibility changes outside placement. Select Presentation still exposes retired layouts. First-click/focus and both-host visual proof remain open. | Selected transport visibility regression; preserve native groups/focus. Retired command removal is separate retained work. |
| AC-DESKTOP | Current `STUDY_STYLES` uses host font/color/contrast/focus variables and retains replay transport/summary composition; the independent Wiki has a reduced-motion media rule. Actual default-zoom/theme/contrast/reduced-motion behavior remains UNKNOWN at final native level; previous reader/layout observations are bounded. | Source style check completed; perform ordinary desktop screenshot/video comparison and later theme/reduced-motion interaction checks. |
| AC-SHORTCUTS | {@link installShortcutHelp} filters actual available bindings, preserves editable/IME typing, avoids duplicate dialogs and returns focus. Current connected proof is bounded; offline/native/rebinding/motion proof remains open. | Shortcut source untouched; verify the transport/help regression without changing bindings or playhead on help close. |
| AC-SKILL | {@link verifyManagedCursorSkill} checks receipt ownership, inode and bytes against the package before use; common skill remains 1.0.41. Loaded/discovered skill does not prove all workflows or restart/unavailable routes. | No shared-skill edit; carry exact bodies/receipts and preserve future restart/unavailable/generation gates. |
| AC-REAL-PROJECTS | The checked .2.14 VSIX has 29 allowlisted entries and isolated load; 175 package regressions passed. No bundled validation app is introduced. No fixed-project final cells have passed. | Dashboard-only development, then frozen Stage 1 and nine Stage 2 assessments in both hosts when the complete product is ready. |

Selected source: `extension/src/playbackController.ts` and existing `extension/src/tests/playbackController.test.ts`; integrated visibility coverage may use existing `studyWorkspace.test.ts` without changing production workspace code unless a reproduction requires it. Reuse {@link playbackHarness}; no new fixture application, helper, state machine or dependency.

Frozen starting action: commit a moment, hide Application, issue one new seek/transport command, then receive the native visibility notification while that requested presentation is pending. Expected: the new requested moment commits once with matching recorded projection; passive reveal cannot replace it with the old bundle. Explicit Pause/hide, newer commands and context/version ownership still control cancellation.

## Validation contract

| Check | Expected observable result | Procedure / evidence |
| --- | --- | --- |
| First command while Application hidden | One requested seek reaches that recorded moment, not the old committed bundle | Real existing controller harness reproduces reveal during presentation; red/green log and disabled-fix control |
| Visibility while frame is loading | Reveal does not abort or replace the latest request | Delayed existing frame port and visibility notification; requested/presented revision assertions |
| Existing explicit controls | Pause/hide restore the committed point; initial interrupted load reopens; newer seek/study wins; failed frame stays truthful | Existing controller/workspace cancellation/revision/error tests; focused suite |
| Integrated native visibility | Public transport handler and Application view-state event keep one requested selection | Existing workspace harness, then public installed native controls |
| Native saved replay, each host | Hidden Application + one Next/Previous/seek settles matching frame/source/native values; no second click or target rerun | Dashboard `1936e419…`, same saved study `…e4906307`; ordinary desktop/default zoom, separate source/VSIX/host identities; native video and inspected frames |
| Gap/regression ownership | Gap clears stale source/native values; return restores state; unrelated live session/tabs/draft/skills/settings and learner decisions survive | Same installed candidate, independently recorded each host; current PNG comparison and preservation receipt |
| Suites/package | Focused/full/package pass; no application fixture ships | Full extension then package sequentially; checked private VSIX/provenance |

Native details are frozen before each trial from the actual returned saved-study timeline, not fabricated values. Existing 17.29 s and 55.87 s observations guide development only. The saved recording is replayed; no new target submission or database mutation is required. Video-only or static screenshots cannot verify native historical synchronization.

## Attempts and evidence

- Review checkpoint: OCR host reviewed eligible 2/2 and all eight material default exclusions, no supported findings. Local CodeRabbit terminal `review_completed`, 10 changed files, zero findings, exit 0; `.coderabbit.yaml` validates and maps this cycle. Private receipts: `ocr-host-review.json`, `coderabbit-result.json`, `debug-report.json`. Review is tied to the dirty mechanism cut, not a later release commit or GitHub approval.
- Both existing QA installations now match the same checked VSIX runtime `20d00d5b…`: VS Code Clean profile (shares Default extensions) and Cursor `Codebook QA 0029 Settings`. No native replay PASS; Cursor profile install is preparation only. Existing managed skill/settings hashes match the preflight.
- During unreliable palette targeting, one own unsaved source input appeared in the isolated QA editor. It was undone; latest paired native AX/screenshot shows the normal login-form preview with no unsaved-file indicator. Target disk source remains unchanged. Do not continue blind command typing or submit the owner terminal draft. At that checkpoint the foreground question was pending; the recorder comparison below supersedes it. Source/installation/check work was complete while native control/video remained blocked on reliable UI targeting. No publication or PR/merge is performed before that cycle proof.

- Fresh full 1,368/1,368 and then package 175/175 PASS, exit 0, zero failures/cancellations/skips; hook 4/4 PASS. Private exact log hashes and counts: `artifacts/cycle-0031/mechanism-receipt.json`. Package lanes were sequential; a private pinned pnpm 12.4.2 wrapper supplies package subprocesses without changing global tooling.
- Checked development package `artifacts/packages/codebook-0.2.14-c31-replay-transport-20260930.vsix`: SHA `a752afde47625b022372ce11b74447bd45dd27b5992fadaa29c7c54d787cef00`, runtime `20d00d5b6dd9e529c53392288ca9aa5a6e795232750672b3597cfa06d2f573a3`, sourceHash `69e95db4e5593a08705e4d0249c2f8f5d14375c3bf44a2c453c7406cbf6be904`, HEAD ce89dbd with explicit dirty inputs, 29 entries and isolated load PASS. Runtime bytes match the newly installed VS Code 0.2.14; shared skill 1.0.41 is unchanged. This is distinct from the clean Cycle 0030 .2.14 archive and earns no final acceptance credit.
- Native preparation only: reused the existing isolated dashboard workspace file, without target-source/settings/DB edits. Its initial window ran the previous .2.12 cut; close/reopen through the official Code CLI loads the newly installed extension. CUA showed the saved study e4906307 and Copilot Auto, but then lost action targeting (noWindowsAvailable; two getApp reconnections timed out). No same-candidate playback/video/current-image PASS is claimed. Asked the owner to foreground the dedicated window while independent review continues. Owner tabs/draft are not typed or submitted. Private identity/preservation baseline: `artifacts/cycle-0031/native-preflight.json`.

- Mechanism result: focused real-controller/workspace suite **496/496 PASS**, zero failures/cancellations/skips, exit 0; `artifacts/cycle-0031/focused-green.log`. The new public workspace case requires one bottom playback command plus a real modeled hidden-to-visible panel notification, matching captured observation/image/preference and unchanged target dispatch count. Native pixels remain a separate mocked boundary.
- Independent disabled-fix control: removed only the compiled loading guard while preserving all authored source and tests; all three new cases FAIL with actual 0 ms versus expected 100 ms, exit 1. Compiled bytes restored and hash-checked in `finally`; `artifacts/cycle-0031/disabled-fix.log` and `disabled-fix-receipt.json`. Full suite is running; packaging/native work remains NOT RUN at this checkpoint.
- Fix is confined to {@link PlaybackController.reveal}: passive visibility returns while the existing controller owns loading. No new state, retry, timer, app action or learner decision; explicit Pause/hide, initial idle recovery and committed restoration remain on existing paths. Purpose/trigger/caller documentation updated. Freeze unavailable; no token acquired.

- Resume entry, 2026-09-30 after the owner's explicit A selection: reread the full current PRODUCT_GOAL, replay/Wiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this cycle and DESIGN; read DEVELOPMENT, controlling D025–D039, behavioral design and TypeScript rules. Actually opened the approved PNG with the image tool: live app/source/native debugger with standard chat and bottom capture/save; replay substitutes Learning summary/sequence at one gap-marked playhead; independent DeepWiki shows chapter/article/outline, update/output/citations/Q&A; shortcut strip supplies tooltips and searchable help. D036 identity unchanged. No image content is runtime proof.
- Current baseline rechecked: branch `codex/cycle-0031-replay-transport`, HEAD `ce89dbdc21250d8085391f0d83eae5fb0c762789`, tree `c567d6d62cb1105ae3a51df4277448f1e5532bec`; saved four document hashes matched before these authorized record updates. PR #52 is MERGED at that SHA, #50 CLOSED, Goal #1 OPEN. Dashboard remains `1936e41913729663cc99081e3224db89bb2d8e56` with only existing `.codebook/`. Serena TypeScript LSP is ready. The freeze script is unavailable; no boundary token was acquired. No target/runtime/native input or new test has run at entry.
- Affected-gap audit: freshly inspected the real controller command/queue/pump/reveal and workspace presentation/viewport/visibility callback. A new seek owns loading presentation, while passive reveal currently queues the committed bundle and invalidates that ownership. AC-REPLAY/ENTRY remain a source-derived hypothesis until red reproduction; GAP/SAVE/LEARNING retain their existing cancellation/context/confirmed-save regressions. The other eight AC rows above carry forward because the complete product-source tree is unchanged; none gains new proof. Native .2.14, both-host correspondence and final stages remain NOT RUN.
- Latest owner chat fallback is D040: Copilot Auto, then Codex Extension after observed credit exhaustion. Record updates add administrative paths to the prior seven-path estimate; the bounded bug source remains one existing controller and two existing test files. No scope/architecture change or new helper/dependency is selected.

- Preparation only: actual current source inspected, hypothesis not yet executed. No Cycle 0031 source/test edit, runtime trial, installed candidate or acceptance observation.
- Fresh entry (2026-09-30): full current-disk PRODUCT_GOAL, all three normative contracts, IMPLEMENTATION, PROJECT_STATE, this active cycle and DESIGN reads completed. DEVELOPMENT, controlling D025–D039, behavioral design, TS rules were read earlier in the same current session; the full design interaction review was freshly reread for this cycle; their paths remain unchanged through `ce89dbd`. Serena is active/ready and symbol inspection was used for the large workspace. Context7 remains quota-exhausted from verified prior probes; this increment uses existing first-party code and supported native APIs, not a new third-party integration.
- Approved PNG was actually opened again with the image tool and SHA verified: live app above stopped source beside native debugger/chat plus bottom capture/save; replay keeps recorded app/source/native state and replaces chat with summary/sequence and a gap-marked timeline; independent three-column DeepWiki has update/output/source links/Q&A; shortcut strip has keyed tooltips and searchable help. Native screenshots/video remain future proof, not inferred from the raster.
- Branch `codex/cycle-0031-replay-transport`, HEAD `ce89dbdc21250d8085391f0d83eae5fb0c762789`; only state, closed Cycle 0030 and this new cycle are dirty. Dashboard `1936e41913729663cc99081e3224db89bb2d8e56`, only pre-existing `.codebook/`. PR #52 merged with identical reviewed tree and successful exact-merge main CI; #50 closed, #1 open. No native trial or product source/test changed.
- All thirteen source/proof/next rows above reconciled. Primary AC-REPLAY has a concrete source-derived visibility/request mismatch; AC-ENTRY/GAPS/SAVE/LEARNING are regression dependencies. Other eight rows retain unchanged source paths and original-candidate proof limits. Broader generation/desktop/skill/final-project unknowns retain explicit later actions. Implementation-entry gate complete; engineering plan/root-cause reproduction remain prerequisites to a production fix.

## Recorder comparison entry, 2026-09-30

Owner steering: actually try the three researched capture routes and document the most suitable recording procedure in AGENTS.md and the work flow. Routes: Screenshot Record Selected Window; OBS macOS Screen Capture / Window Capture; screencapture window-ID video. This bounded preparation increment precedes the saved-replay trial; it does not change product behavior or waive remaining proof.

Fresh compaction entry: full current PRODUCT_GOAL and replay/Wiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this cycle, DESIGN, DEVELOPMENT, D025–D040, behavioral design and complete Cycle 0029 interaction review read. Actual image tool opened the approved 1024 × 1536 PNG; SHA f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa matches. Observed live app/source/native debugger plus normal chat and bottom capture/save; replay substitutes Learning summary/sequence with a shared gap-marked timeline; independent DeepWiki chapter/article/outline/update/output/citations/Q&A; shortcut tooltips and searchable list. No visual proof inferred.

Baseline verified: codex/cycle-0031-replay-transport at ce89dbdc21250d8085391f0d83eae5fb0c762789; same ten dirty paths, no branch PR. Controller SHA 07a0ca7b927e9430c88bbdc916627a6213b05cd358424a1133fef6bd90565562; installed VS Code runtime 20d00d5b6dd9e529c53392288ca9aa5a6e795232750672b3597cfa06d2f573a3. Dashboard stays 1936e41913729663cc99081e3224db89bb2d8e56 with only pre-existing .codebook/. Native CUA documentation refreshed; ffmpeg/ffprobe, Swift, screencapture and gh available. macOS 26.7; OBS absent from standard application locations at research preflight.

Affected gap audit: existing loading guard and Application visibility callback retain the reviewed source; no new product edit. AC-REPLAY/ENTRY/GAPS/SAVE/LEARNING native proof remains open. This comparison selects an evidence-acquisition procedure for those checks and AC-DESKTOP, not a product PASS. All other acceptance rows carry forward with unchanged source and exact existing proof limits. No Stage 1/2 or Cursor claim.

Frozen comparison: bind only the owned dashboard QA window; capture a short foreground baseline, cover it with a separately identified window without minimizing, and inspect target identity, video duration/dimensions and changing native content. Assess start/stop automation, occlusion, focus disturbance and cleanup; record failed attempts. A file alone cannot pass frozen-frame or wrong-window checks. Store recordings privately under artifacts/cycle-0031/recorder-comparison/. Preserve owner drafts/tabs/settings and target disk source. Documentation edits only: AGENTS.md, DEVELOPMENT.md, a linked recording guide and cycle/state receipts as needed. No recorder dependency enters the extension or VSIX.

## Engineering review, 2026-09-30

Scope accepted as-is. Selected implementation/test paths: existing controller, its tests and existing workspace test; records: current cycle/state plus closed-cycle/README delivery facts. Seven expected authored paths, zero new classes/services/helpers/dependencies. The complexity selector does not apply. No feature cut, timeout, binding, storage policy or accepted design is changed. Prior D026/D039 authorize routine implementation; the required behavior and regression proof reuse D032/D034 and the full replay contract.

### Architecture

- **A1 (P2, 9/10, source-derived):** `reveal` queues the old bundle while `queue/pump` owns a newer presentation. Native visibility is a receipt, not a new learner command. Reproduce this path before fixing it; preserve the currently loading request rather than creating another queue/clock/generation owner. No new concurrency pattern or external-library surface; reuse the existing AbortController/revision queue (Layer 1, existing implementation).
- **A2 (P1 regression obligation, 9/10):** explicit Pause/hide cancel pending work and restore the committed point; an initial interrupted load has no committed bundle and must reopen. The remedy must distinguish passive visibility from these explicit controls. Those accepted contracts and existing behavior tests are fixed requirements, not optional depth.

```text
public replay seek -> validated control revision -> queue requested moment B
  -> invalidate A / load captured frame B -> presentPlayback(B)
    -> ensureReplayViewport -> native Application becomes visible
      -> bindApplicationPanel -> reveal
        current: queue committed A -> abort B -> commit A [candidate defect]
        proposed: active loading request owns presentation -> retain B
  -> source/history/paint receipts -> commit B -> save confirmed B

passive reveal with no active request -> restore committed A
explicit hide/Pause -> cancel B -> retain/restore A
first load hidden before commit -> idle -> explicit reveal restarts captured read
new seek/study/close -> existing revision/abort ownership wins
```

### Code quality

- **Q1 (P2, 9/10):** use the existing loading/request ownership; do not add another flag, helper or retry action that could drift from queue state. Update {@link PlaybackController.reveal}'s purpose/trigger/caller documentation if semantics change. Preserve existing errors and returned state.
- **Q2 (P2 regression obligation, 8/10):** the workspace renderer test port's `reveal` currently does not reveal its native panel. A dedicated integration case must model that real notification using existing exposed panel/viewport objects. Do not globally change every fixture or create a new application/harness.

### Tests

Dedicated current reads covered the whole controller/test file, workspace visibility/presentation methods and existing recording/viewport harness. Existing evidence proves several branches but not this reentrant visibility path. These are qualitative path assessments, not instrumented line coverage.

```text
CODE PATHS                                USER FLOWS
controller command/queue/pump             hidden Application -> one seek
  revision/wrong study [★★★ TESTED]         native visibility -> requested B [GAP ->E2E]
  newer late read wins [★★★ TESTED]        hidden Application -> Previous/Next
  frame failure [★★★ TESTED]                same recorded frame/source/values [GAP ->E2E]
reveal during requested present [GAP]     gap -> recorded stop
reveal during frame loading [GAP]           clear then restore exact state [older proof ->E2E]
passive restore after hide [★★★ TESTED]    learner decisions/foreign sessions
initial hidden load recovery [★★★ TESTED]   unchanged through controls [existing tests ->E2E]
explicit Pause/hide [★★★ TESTED]
workspace panel notification [GAP]
```

Required red tests: (1) reveal during first requested presentation after hide retains 100 ms instead of reverting to 0; (2) reveal during a delayed latest frame cannot replace the requested point; (3) public workspace playback message plus actual hidden-to-visible panel notification reaches 100 ms without another command or target dispatch. Existing Pause/hide/first-load/newer-seek/study/error/confirmed-save tests remain critical regression guards. Hard-coded observable expectations and AAA, no implementation-shaped branch assertion. Native tests remain separate: installed VS Code and Cursor, same saved dashboard recording, one command after hide, Next/Previous/seek/gap, preserved foreign live session/work and inspected video/current-image correspondence. No prompt/LLM file changes or eval scope.

### Performance

No issue found in the bounded plan: no extra reads, timers, provider requests or stored state; the proposed ownership guard is constant-time. Existing frame/source I/O and visible loading wait remain unchanged. The known native blank/readiness interval is not solved or relabeled atomic paint.

### Outside voice and decisions

Claude Code CLI remains owner-skipped under the product authority. The installed skill's native fallback requires declared Plan/TaskOutput/TaskStop capabilities; this host has none, so no substitute agent was dispatched and no outside coverage is claimed. Missing outside coverage is non-blocking in that workflow. The host reviewed Architecture, Code quality, Tests and Performance; independent implementation review remains required at delivery.

No pending choice: fixed outcome/necessary proof reuse D032/D034, existing cancellation/version/learner ownership contracts and D026/D039 routine implementation authority. No new guarantee, timeout, feature cut or optional policy is selected. Approval readiness: complete for the bounded plan; implementation remains conditional on a reproduced root cause.

### Implementation tasks

- **T1 (P1; human ~2 h / agent ~15 min):** add the two controller regressions and one existing workspace visibility regression; observe the predicted failure before production edits. Files: controller tests and workspace tests.
- **T2 (P1; human ~1 h / agent ~10 min):** if T1 confirms the hypothesis, retain active requested presentation through passive reveal with the smallest existing-controller change/JSDoc; focused green and disabled-fix control. Otherwise update the hypothesis, not the source.
- **T3 (P1; human ~2 h / agent ~30 min):** sequential full/package and checked private VSIX; no fixture app or new dependency.
- **T4 (P1; human ~4 h / agent ~60 min):** installed dashboard saved-replay proof in both hosts with video/frames, current PNG comparison and preserved owner work; update all affected gaps before reviews/delivery.

Completion: scope as-is; Architecture 2, Code quality 2, Tests 3 new mechanism/integration gaps plus native proof, Performance no issues. Existing solutions and retained out-of-scope gaps recorded. No unresolved decisions. No production edit or successful reproduction claimed by this review.

## Result and decision

- Cycle result: pending until installed saved-replay validation completes. The request-ownership mechanism is verified by three red regressions, focused/full/package green results and the disabled-fix control. The separate OBS recorder procedure is demonstrated; no current-candidate replay, Cursor or final acceptance PASS is claimed.
- Current Cycle 0030 receipts remain separate; original incident and failed experiments are preserved.

## Recorder workflow result, 2026-09-30

The owner requested three actual recording-method trials and adoption in the work-flow documents. During the standard-recorder attempts, the owner explicitly rejected QuickTime/macOS Screenshot because it prevents interaction. The added D041 and [native recording procedure](../qa/native-recording.md) retain this direction without changing the accepted product.

| Experiment | Expected | Actual / disposition |
| --- | --- | --- |
| Screenshot / QuickTime selected-window capture | Start a chosen-window video while QA remains operable | Launcher/toolbar/QuickTime menu attempted; native automation timed out or failed to launch the UI agent. No verified selected-window video. Owner independently rejected its interaction blocking. Excluded from QA, not a capture PASS. |
| Window-ID CLI video | Chosen QA pixels and updates despite another foreground application | Completed 15/30 s H.264 files, 2880 × 1800; inspected samples black. FAIL for this background scenario; no blanket claim about all CLI modes. |
| OBS ScreenCaptureKit Window Capture | Exact QA window, changing pixels, complete edges, saved/finalized output without an exclusive foreground hold | First two videos recorded but scene scale/offset cropped edges. Reset Transform confirmed 2880 × 1800, position0/0, rotation0 and all crops0. Corrected video:181.5 s, 5,445 decoded frames, 30 fps. Viewed 5/60/120/175 s contact sheet and the full 175 s frame; complete native window edges/status bar/chat/panel remain, panel geometry and login-form/auth source change. First sample is inactive; later focus is not inferred from the macOS sharing indicator. Recorder-level PASS, no replay/acceptance PASS. |

Private evidence: `artifacts/cycle-0031/recorder-comparison/comparison.json` binds each video/contact-sheet hash and actual metadata, official OBS32.2.2 notarized-DMG identity and declared dirty source/runtime. Corrected video `obs-window-03.mov`; full late frame `obs-window-03-frame-175.png`; original failures retained. Reviewed clips are silent remuxes; early acquisition used initial audio defaults before mutes, so originals stay private. Follow the guide's pre-start audio check on future takes.

Startup investigation under `/investigate`: captured the actual duplicate-instance alert, verified only run-owned OBS PIDs, and used the official --multi flag for a bounded retry; no product fix or permission bypass. Native menu/input actions can return stale IDs, 1-pixel screenshots, noWindowsAvailable or an immediate title change ahead of painted content. The guide requires actual saved-frame inspection and separates recorder from input results. Shutdown signals affected only proven trial-owned PIDs; the final OBS shutdown exited139 after every video was already stopped/finalized and checked. This is a cleanup concern, not a normal Quit recipe; no recorder remains running.

Preservation: target tracked disk source unchanged (only existing .codebook/ remains); editor settings and managed skill hashes still match the preflight; QA panel visibility restored and login-form tab selected after a second restoration action. QuickTime exited, DMG unmounted, clips moved from Movies into ignored private evidence. The foreground question is superseded/withdrawn; no exclusive desktop hold is requested. Normal recorder setup/configuration remains outside extension imports/build/package assets.

Docs: AGENTS.md and DEVELOPMENT.md now require the linked OBS procedure; IMPLEMENTATION.md maps acquisition to its existing evidence gate; D041 records the owner direction. The guide includes exact-window selection, native geometry, transform/crop, changing-content preflight, source/fps/frame/hash receipts and cleanup. No TypeScript, test, packaged runtime or skill bytes changed in this subtask; existing mechanism suite/package results retain their original source identity and are not new tests.

Affected AC-REPLAY/ENTRY/GAPS/SAVE/LEARNING and AC-DESKTOP now have a validated recorder route. Their required current-candidate native replay/visual proof is still NOT RUN. Other rows retain unchanged source and existing proof limits; all thirteen rows/final stages stay open. One next action: use this procedure for the installed saved-study one-command hidden-Application replay in VS Code, then Cursor, with separate actual product and current-image results.

Workflow-document verification: OCR eligible2/2 reviewed, skipped0, coverage100%; all11 material default exclusions accounted, with unchanged source/test hashes and direct host review of the new workflow. Local CodeRabbit first completed on13 files with2 minor state-record findings; both corrected. The rerun completed on13 files with0 findings, exit0. One factual dependency correction was applied during that workspace rerun and independently host-audited; later result-only record receipts are not a frozen-release review. Seven documents' local links and git diff --check PASS. Guide commands produced10 sampled and30 native frames for a1-second interval, with a native frame actually viewed; media metadata/hash match. Fresh context-hook4/4 PASS, exit0. Private review receipts live beside comparison.json. Issue53 mirrored without closing it; Goal1 remains open.


## Historical recorder-checkpoint next action

This describes the earlier recorder checkpoint and is superseded by the latest result/review sections below. At that checkpoint: use the documented OBS Window Capture preflight for the dedicated dashboard QA window and record one-command hidden-Application navigation on the checked dirty candidate, then repeat in Cursor with separate host proof. Three red regressions confirmed the root cause; focused/full/package checks and the disabled-fix control pass. Source changes remain one controller and two existing tests. Recorder pixels/updates are verified separately; installed saved-replay validation is NOT RUN, and its current-image comparison and delivery remain pending. Branch `codex/cycle-0031-replay-transport` from `ce89dbd`; Issue #53 open, Goal #1 open.

## Review recovery outputs and confirmed hypothesis, 2026-09-30

The owner resumed this exact selected Cycle 0031 plan after save. Complete the prior missing outputs under plan-eng-review recovery routing; retain the four reviewed sections and T1–T4, with no new scope/remedy. The current-disk controller, presentation/visibility methods and existing test harness were rechecked. Test review now has three observed red failures: the controller's reveal-during-presentation and delayed-frame cases (14 old PASS, 2 new FAIL), plus the public bottom-playback workspace case (1 FAIL); each actual 0 ms versus expected 100 ms. Logs: private `artifacts/cycle-0031/controller-red.log` and `workspace-red.log`. No production edit preceded them. The confirmed request replacement is a reentrant visibility ownership error, not a failed image receipt.

- QA test artifact: `/Users/ryotamurakami/.gstack/projects/codebook/ryotamurakami-codex-cycle-0031-replay-transport-eng-review-test-plan-20260930-094939.md`.
- Task JSONL: `/Users/ryotamurakami/.gstack/projects/codebook/tasks-eng-review-20260930-094939.jsonl`; four tasks serialized by jq, original priorities and estimates retained.
- Formal review provenance: host analysis only; prior session aborted at owner save. This recovery supplies missing artifacts/report/log; it does not invent outside coverage or claim any native acceptance.
- Product source scope: one controller, two existing tests. Existing dirty closure/README records plus current cycle/state and D040 records are administrative; no adjacent feature or new dependency/helper is added.

## Decision ledger

| ID | Remedy/required proof | State | Actual authority |
| --- | --- | --- | --- |
| A1/Q1 | Passive visibility retains the active requested presentation using existing ownership | Accepted routine implementation; red hypothesis confirmed | D026/D039 complete replay scope; owner's explicit resume A; D032 shared historical moment |
| A2 | Retain explicit Pause/hide, first-load recovery, newer seek/study, failure and confirmed-position saving | Exact prior required regression contract | Replay contract and existing behavior tests; no new accepted behavior |
| Q2/Test | Existing real-controller and public workspace reproduction; separate installed both-host video/gap/preservation proof | Required verification, not an optional guarantee | D032/D034 and full replay contract; no fixture/native substitution |
| D040 | Copilot Auto then Codex Extension after observed credit exhaustion | Explicit owner direction | Updated Goal and resume A |

Approval readiness: PASS for A1/Q1, A2 and Q2/Test under the cited existing contracts and explicit owner implementation/resume direction; D040 is recorded verbatim. No new product decision, timeout, feature cut or optional policy. No TODO proposal. No critical silent failure without a mapped test/error path.

## Reuse, failure modes and execution order

Reuse PlaybackController's loading/readiness, AbortController/revision ownership and playbackHarness; the workspace case overrides only its existing viewport's native reveal receipt. No new service/type/helper. Sequential implementation, no parallelization opportunity.

| Failure mode | Test/error coverage | Observable outcome |
| --- | --- | --- |
| Passive reveal replaces requested B with committed A | Three observed red regressions | One seek reaches B after the minimal ownership repair |
| Explicit Pause/hide stops B | Existing cancellation tests | Previous confirmed A restores, stays paused |
| First load canceled without committed state | Existing pause/hide recovery tests | Explicit reopen reads history without target execution |
| Late frame/newer study or disposal | Existing revision/study guards | Old completion cannot change selected history |
| Missing frame or paint receipt | Existing controller/workspace error tests | Truthful failed state; no advance of saved playhead |
| Native focus/paint still differs | Installed both-host video/frames required | Remains unverified or FAIL; no acceptance claim from mechanism green |

## Completion summary

Scope accepted as-is; Architecture 2, Code Quality 2, Tests 3 mapped gaps, Performance 0 findings: 7 total. Critical unhandled silent paths 0; unresolved choices 0. Tests/native work retain T1–T4. No new tasks from Performance. No LLM/prompt changes or eval scope. Outside CLI is owner-skipped; Plan/TaskOutput/TaskStop native fallback unavailable, no substitute agent. The owner already chose resume A, so no repeated navigation/implementation question. All thirteen product rows remain open.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | Not selected | Existing owner product scope | 0 | Not run | No scope change |
| Outside Review | Claude Code CLI / native plan fallback | Independent plan challenge | 0 | Owner-skipped / unavailable | No external or substitute-agent coverage |
| Eng Review | /plan-eng-review recovery | Architecture and tests | 1 | ISSUES OPEN, mapped implementation work | 7 findings; 0 critical unhandled paths; 0 unresolved choices |
| Design Review | Approved D032/D034/D036 | Existing replay composition | 0 new | Retained approved specification | Actual current image inspected; native proof pending |
| DX Review | Not selected | No public API/setup change | 0 | Not run | Existing contracts retained |

**OUTSIDE COVERAGE:** host Codex; provider Claude Code CLI; plan-review phase owner-skipped. Required native fallback tools unavailable; no outside or cross-model completion claimed.

**VERDICT:** Bounded plan and required outputs complete; seven mapped implementation/test obligations remain. Root cause reproduced before production edits; native and full product acceptance remain pending. Eng review findings require the planned implementation/proof.

NO UNRESOLVED DECISIONS

## Test execution performance entry, 2026-09-30

Owner steering: shorten development verification through parallel execution or sharding wherever ordering is unnecessary. This supporting increment keeps Cycle 0031 active; installed replay and every final acceptance row remain pending.

Fresh compaction entry completed: full current PRODUCT_GOAL, replay/Wiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this cycle and DESIGN; DEVELOPMENT, controlling D025–D041, behavioral design and local TypeScript rules. The image tool actually opened the approved PNG and its SHA matches D036. Observed live application/source/native debugger with standard chat and bottom capture/save; replay substitutes summary/sequence with a shared gap-marked playhead; independent DeepWiki has chapters/article/outline/update/output/citations/Q&A; shortcuts have tooltip keys and searchable discovery. No UI change or new native proof is selected.

Baseline: branch codex/cycle-0031-replay-transport, HEAD ce89dbdc21250d8085391f0d83eae5fb0c762789 and thirteen existing dirty paths preserved. Controller SHA 07a0ca7b927e9430c88bbdc916627a6213b05cd358424a1133fef6bd90565562 is unchanged. Dashboard stays 1936e41913729663cc99081e3224db89bb2d8e56 with existing .codebook/ only. Node 24.21.0 reports 16 available CPUs; branch PR list is empty. Serena is active; Context7 supplied current Node24 runner documentation.

Affected-gap audit: the loading guard and Application visibility path retain the prior mechanism/source assessment. AC-REPLAY/ENTRY/GAPS/SAVE/LEARNING depend on preserving their existing regression coverage; AC-REAL-PROJECTS retains the package exclusion boundary. All thirteen rows carry forward their exact product-source and native-proof limits. This increment addresses slow feedback, not a missing accepted product behavior; no row earns acceptance credit.

Selected bounded experiment: measure the unchanged full suite, identify the long serial file, and partition independent workspace tests into process-isolated files if that bottleneck is confirmed. Node already runs files in parallel (default availableParallelism minus1); --test-shard distributes files and cannot divide a single large file. Keep tests within each file serial because prototype/timer mocks can affect peers. Build before readers; retain package/build cleanup after all extension test readers finish. Reuse the existing harness, assertions and actual runner; add no dependency or validation application.

Frozen verification: baseline and candidate use identical Node/version/CPU/runner options and all 1,368 existing test cases. Compare per-test name multisets, pass/fail/cancel/skip counts and wall duration. A missing, duplicated, skipped, cancelled or changed assertion falsifies the partition. Build/typecheck, full-suite and sequential package regressions must pass; package assets must still exclude test inputs. Record machine-specific timing privately under artifacts/cycle-0031/test-performance/. Separate sharding is considered only after the single-file bottleneck is resolved and measured.

### Performance result and retained boundaries

The unchanged baseline passed 1,368 cases in 189.32 s (build separately 4.24 s); the workspace file accounted for 480 cases and 182.84 s of serial case duration. Its tests are now in nine behavior-focused files with one shared fixture module. Node's existing complete glob picks them up in development and CI. Cases remain serial inside each isolated process; production deadlines, fixture operations and all 2,254 assertion calls are unchanged. AST comparison confirms 310 registration statements, 309 unchanged and one with stronger public-result waits; all six helper bodies match the original exactly. No new dependency, runner or application is added.

First partition trial: 1,367 PASS/1 FAIL in 54.02 s. The Node-history test waited for debugger presentation, which precedes the awaited durable cursor save and reader publication. Under concurrent I/O it saw sequence 23 while expecting 25. A private compiled-test injection delayed only cursor persistence 150 ms and reproduced 23-versus 25; original compiled bytes were restored in finally. After the test waits for both presentation and published cursor at its three stop selections, the same injection passes. Assertions and timeouts are retained; no production behavior changed. This is test synchronization, not a replay bug fix or new native proof. `/investigate` scope is this one test; freeze helper unavailable, no token acquired. Prior Node scope-capture learning concerns a different failure and is not applied.

Corrected normal runner: 1,368/1,368 PASS in 54.34 s, about 71.3% less wall time (3.48x throughput). Four read-only shards, each concurrency 4: 325/285/364/394 PASS, all 1,368 names exactly match the baseline multiset; slowest/combined wall 55.55 s. The ordinary local runner is faster and simpler, so no CI matrix or custom shard runner is introduced. Existing CI includes every new file.

Package ownership was inspected separately: only package.test.mjs builds/cleans the real checkout; the other five files use owned temporary inputs and scripts. After all extension readers exited, the same 175 cases passed at concurrency 1 in 19.53 s and concurrency 4 in 7.97 s. Adopt concurrency 4 for test:package; preserve serial ordering between extension readers and package cleanup and between separate package producers. Context-hook 4/4 PASS concurrently with this independent package lane. Real VSIX regression still verifies 29 allowlisted entries, isolated load and exclusion of all test/fixture inputs. This supporting test/doc/manifest increment does not rebuild or install a new public/native candidate.

Private receipts: baseline/parallel/shard/package logs and timing JSON, coverage-equivalence.json, assertion-equivalence.json, position-wait-red.log and position-wait-green.log under artifacts/cycle-0031/test-performance/. Source is the declared dirty ce89dbd checkout on Node 24.21.0/16 available CPUs; these timings are local observations, not CI guarantees. Build, assertions, all names and zero fail/cancel/skip counts remain required. Product controller hash stays 07a0ca7b…; all thirteen AC rows retain the preceding implementation/native-proof limits. Review and final package-command verification follow below. Next product action remains the installed OBS-recorded hidden-Application trial in each host.

Final adopted package command: `pnpm --dir extension test:package`, 175/175 PASS, zero failures/cancellations/skips, exit 0, 7.63 s. The documented all-partition workspace/controller command passed 496/496 in 44.28 s after package cleanup rebuilt the current source. OCR host review covers 4/4 eligible `(path,status)` entries, skipped 0, coverage 100%; all 20 material default exclusions are separately accounted. Shared-fixture body equality, process-local state/import/path ownership, preserved assertions and the strengthened cursor wait were reviewed. Two duplicate fixture docblocks found in host review were consolidated; comments alone changed after mechanism tests. Local CodeRabbit completed three runs on all 24 files each: two record-clarity findings, two further documentation issues (spacing and stale AC-REPLAY/ENTRY next actions), then one missing D041 provenance link. All five minor findings are corrected and host-checked. The final run's one finding is retained; the link and later result-only receipts were corrected through host review, without claiming a zero-finding external rerun or frozen-release review. Receipts: ocr-preview.json, ocr-rules.json, ocr-host-review.json, coderabbit.jsonl, coderabbit-final.jsonl, coderabbit-incremental.jsonl and package-command/focused-command JSON/logs. All thirteen product gaps retain their original native/final limits; next action remains the two-host installed hidden-Application trial.

Supporting increment complete, local-only. Six documents' local links, final host record review and git diff --check PASS. Issue53 was mirrored without closing it; a fresh read verifies the performance section (REST field-body retry after GraphQL/input-body transport errors). All writes used ryota-murakami credentials scoped to the command, preserving the other project's active account. Private handoff and result.json retain source/test/timing/review identities. No test/package/recorder process remains; original edits and target source/settings/skills are preserved. Cycle0031 remains validating for its required installed replay proof and delivery.

## Installed replay resume entry, 2026-09-30

The preceding goal turn made progress: supporting test execution is implemented, verified and documented. Resume the original Cycle 0031 T4; do not close the product cycle on test-speed work. The same-session full mandatory entry remains recorded above; current state/cycle changes, native-recording guide and full design interaction review were rechecked. The approved PNG was actually opened again with the image tool: recorded app above historical source, native debugger alongside, summary/sequence replacing chat, one gap-marked playhead; independent Wiki and shortcut regions remain unchanged.

Current branch/head are unchanged (codex/cycle-0031-replay-transport, ce89dbd), with24 declared dirty paths including the test partitions. Source recheck confirms the loading guard in PlaybackController.reveal and the Application visibility callback; no further product source edit since the original mechanism candidate. Both installed runtime files still match20d00d5b… / checked C31 VSIXa752afde…. Later support changes are tests/package-test command/docs, kept separate from that installed candidate's provenance. Dashboard remains1936e419… with existing .codebook/ only. VS Code CLI reports1.139.1/arm64. Settings and managed skill hashes match native-preflight.json. App inventory and process inspection show VS Code, Cursor and OBS closed, so old window1657 is invalid; reopen the existing isolated QA workspace and reselect its actual new OBS target.

Affected source/proof audit: AC-REPLAY/ENTRY ownership is mechanism-verified; first-click focus and installed one-command outcome remain unverified. GAPS/SAVE/LEARNING regression correspondence and AC-DESKTOP image/motion require this installed take. Other AC rows retain unchanged product source and prior proof limits. No final matrix credit is selected.

Frozen action: reopen the existing saved browser study through normal library/reader controls; read its actual current timeline before declaring expected target. With the original runtime/debugger/chat exited, hide Application via an existing source tab, then issue one Next/Previous/seek through retained public playback controls. Expected: requested recorded frame/source/native values settle without a second click; gap controls clear stale state, explicit Pause and summary collapse preserve confirmed history/learner decisions, and no target runtime is rerun. Record per-host OBS changing-content/full-frame/audio preflight, actual input outcome, native video/frames and approved-image comparison. A launch, stale AX title or recorder-only success earns no product PASS. Public replay controls need no new AI message; preserve Copilot Auto and owner drafts. Private receipt: artifacts/cycle-0031/native-replay/entry.json. Next after VS Code: repeat the same installed candidate/scenario in Cursor, then required reviews/delivery.

Native preparation/recorder result: the existing saved study e4906307 reopened via public Open Study Workspace and Recording. An initial source-not-ready warning was observed; later the single Recording request settled at the previously saved110.15 s with Captured-login-form.tsx:75 and recorded pause55.87 s. No second Recording click was used; this is startup preparation, not the frozen hidden-Application test. Native Run and Debug/Local expansion exposes state CredentialsSignin and callbackUrl /dashboard. Preserve the initial warning as a usability concern, without treating its immediate AX snapshot as a terminal product failure.

OBS target was reselected through its native candidate menu. Coordinate/menu attempts returned AX failure and an app-changed error; the subsequent paired state proved the exact QA target had actually been selected, so no duplicate selection was sent. Reset/Edit Transform verified2880×1800, position0/0, rotation0 and crop0; both audio sources were muted before recording; actual active profile/collection are Untitled,30 fps. The new silent preflight is241.166667 s/7,235 video frames after remux. Image tool actually viewed2 s and235 s: full window edges/status, inactive sample and changing native sidebar/scope content; original full-resolution frames/video and private raw original are retained. Recorder-level PASS, main replay test NOT RUN. Receipt: artifacts/cycle-0031/native-replay/preflight-acquisition.json.

Primary expectations now frozen from the actual public timeline:110149.1 ms → hide Recorded application via the existing login-form tab → one Previous recorded stop →55.87 s (rounded UI), matching source/native state. Then Previous17.29/Next55.87, gap recovery and summary preservation. Native values at initial110.15 s belong to the recorded55.87 s pause interval, not a newly executed application. Expected/failed observations and action timestamps belong in separate main-take receipts; no Stage1/2 claim. Private expectations: vscode-expectations.json alongside the preflight.

## Installed replay compaction entry, 2026-09-30 14:09 JST

Full current-disk mandatory contracts, IMPLEMENTATION, PROJECT_STATE, this cycle and DESIGN were reread after compaction; DEVELOPMENT, controlling D025–D041, behavioral design, native recording guide and full interaction review also read. The image tool actually opened the approved PNG: live application/source/native debugger/chat and bottom capture/save; replay replaces chat with summary/sequence and shares a gap-marked playhead; independent DeepWiki retains chapters/article/outline/update/output/citations/Q&A; shortcuts expose tooltip keys and searchable help. SHA and approval remain D036.

Branch/head remain codex/cycle-0031-replay-transport/ce89dbd with the same declared support/source paths. Fresh source inspection confirms PlaybackController.reveal's existing loading guard and StudyWorkspace.bindApplicationPanel's real visibility callback. Both installed runtimes still match20d00d5b…; dashboard tracked source is unchanged at1936e419… with only pre-existing .codebook/. Issues1/53 remain open; branch PR is absent. AC-REPLAY/ENTRY remain mechanism-verified with native motion proof pending; GAPS/SAVE/LEARNING and DESKTOP depend on this take. Other rows retain unchanged product source and prior proof limits; no final matrix credit. Entry receipt: artifacts/cycle-0031/native-replay/compaction-entry-20260930-1409.json.

Owned main OBS take was stopped/finalized as independent preparation; original and silent remux are preserved. Native action timestamps were exported before further input. The existing one-command Previous55.87/Previous17.29/Next55.87 observations and one-millisecond gap decrement are not yet video-verified. Inspect saved frames before assigning outcomes; then finish gap recovery/summary preservation and separately repeat in Cursor.

## Installed VS Code video result, 2026-09-30

Candidate remains the original dirty C31 VSIX a752afde…/runtime 20d00d5b…, with no additional product source edits. Public replay controls on the existing dashboard study e4906307 require no new chat request; Copilot Auto and the original exited runtime/chat remain separate. Two silent, finalized OBS takes retain the exact QA window at2880×1800/30 fps. Main:935.066667 s/28,052 frames/SHA35d11ac3…; supplemental:245.566992 s/7,368 frames/SHAdc2fff42…. Private originals, native action timestamps, metadata and inspected-frame hashes remain under artifacts/cycle-0031/native-replay/.

| Frozen check | Actual observation / scope | Result |
| --- | --- | --- |
| Hidden Application at 110.15 s + one Previous | Main60 s shows source tab/hidden Application;74 s shows55.87 s application, captured75:13 and recorded LoginForm/CredentialsSignin | Bounded VS Code development PASS |
| Hidden Application at 55.87 s + one Previous |115 s shows hidden Application;129 s shows17.29 s, captured90:5 and LoginButton/pendingtrue | Bounded VS Code development PASS |
| Hidden Application at 17.29 s + one Next |265 s shows hidden Application;277 s shows55.87 s, captured75:13 and matching recorded LoginForm state | Bounded VS Code development PASS |
| Seek into missing history | Main572 s and supplemental 130 s retain recorded application while showing the source placeholder and empty Variables/Call Stack; one hidden-Application Decrement reveals this gap | Bounded sampled negative control PASS |
| Summary hide/reopen | Supplemental 72/84 s show native secondary sidebar hidden/reopened while55.87 s source/native context and top reading location remain | Bounded native sidebar preservation PASS; dedicated fallback button, scrolled context and focus remain unverified |
| Play across gap / explicit Pause | Play restores the55.87 s native state and advances, then fails at Presented64.09 s before Pause; error remains and native highlight/values/stack clear | FAIL for continuous playback; Pause not verified by this attempt |
| Native atomic paint / both hosts |178 native frames around the four main transitions are extracted; the ROI sheets are prepared but not all inspected. Cursor remains not running/NOT RUN | PARTIAL / NOT RUN |

No second Previous/Next command was sent in the three primary cases. Read-only observations waited for completion. Native Raise established input focus before the main take; this does not close cold first-click focus. The17.29 s captured enabled button is consistent with a pause before the pending JSX commits;55.87 s captures the pending spinner while LoginForm is paused before the error DOM commit. Do not diagnose these as stale pairing merely from pending/state values.

Approved-image comparison: the real replay has native debugger left, recorded application above captured source, Learning summary right and a gap-marked bottom timeline, matching the v9 hierarchy. The narrow existing summary wraps its title across many lines and leaves the sequence below the fold; source/native rows also truncate horizontally. Preserve manual geometry; compact summary density, focus and complete desktop fidelity remain open. No current-image/full product acceptance PASS.

### Recurrent viewport paint failure

Public Recording error details: `Viewport frame acknowledgement timed out again after one same-frame retry`. Both attempts 90/91 report `received (hidden, area); decoded; paint-queued`, no first-frame/paint receipt, with native panel visible. This is materially different evidence from a missing/decode-failed image and remains a required replay gap. `/investigate` session1-1790745400-e496f6ec traced StudyWorkspace.presentPlayback → BrowserViewport.present → FrameDelivery deadline and the renderer's two requestAnimationFrame callbacks. Prior learning codebook-replay-viewport-ack applies: retain exact stage receipts; reload is recovery, not a fix. Freeze helper unavailable; no lock acquired.

Root-cause hypothesis: document visibility becomes hidden while the native panel stays visible; requestAnimationFrame stops but the wall-clock paint deadline expires. Electron's official BrowserWindow Page visibility documentation, retrieved through Context7, documents macOS occlusion visibility. Actual covering-window identity and a controlled foreground/occlusion reproduction are not yet confirmed. No timeout change, fabricated paint acknowledgement or production fix was made. Private investigation receipt: ack-investigation.json.

Public reload recovered64.09 s/recorded55.87 s source/native context. Initial recovery inputs were inconclusive while native painted state lagged; same-workspace reuse through the official Code CLI restored painted controls, then the actual visible Reload operation settled. Temporary maximized panel was restored (Maximize Panel 0), summary remains visible, understanding 0 unchanged. Source/settings/managed-skill hashes match the entry; dashboard retains only its pre-existing .codebook/. OBS stopped/finalized and public Quit succeeded; inventory confirms no recorder or Cursor process. QA remains paused64.09 s, rather than silently resetting the original110.15 s preference through blind input.

Cycle remains validating and local-only. Primary one-command ownership has bounded VS Code proof; continuous replay FAIL, every-frame inspection, first-click/focus, exact range-value update, Cursor and delivery remain open. Other product rows retain unchanged source and original limits; no Stage 1/2 credit. One next action: confirm the hidden-document paint hypothesis with a controlled public replay/occlusion trial before a source fix, then repeat the current-candidate scenario in Cursor and complete reviews/delivery. Issue #53 native-result section synchronized and fresh-read verified without closing it; Goal #1 stays open.


## Visibility control and Cursor entry, 2026-09-30

Fresh post-compaction mandatory full reads completed from current disk: PRODUCT_GOAL, replay/Wiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, active cycle and DESIGN; DEVELOPMENT, controlling D025–D041, behavioral design, full interaction review and native recording guide. The image tool opened the approved PNG again: live app above source with native debugger/chat and bottom capture/save; replay replaces chat with summary/sequence and a shared gap-marked timeline; independent DeepWiki chapter/article/outline, update/output/citations/Q&A; keyed tooltips and searchable shortcut help. D036 identity unchanged.

Fresh branch/head remain codex/cycle-0031-replay-transport/ce89dbd with preserved24 authored dirty paths. Controller07a0ca7b and both installed runtime20d00d5b hashes match. Actual source confirms reveal retains an active loading request; bindApplicationPanel still reports real visibility transitions. Dashboard1936e419 remains unchanged with existing.codebook/ only. Issues1/53 OPEN, branch PR absent. AC-REPLAY/ENTRY retain the fixed ownership mechanism; GAPS/SAVE/LEARNING/DESKTOP need separate native correspondence/preservation/visual evidence. Other seven AC rows retain unchanged source and original proof limits; all thirteen integrated rows and final stages remain open.

Controlled VS Code take uses the original candidate and study e4906307. A new silent changing-content preflight passed on full2880×1800/30fps frames2/125/165; public Restore Study workspace layout then restored application above source before the product comparison. Native model preceded painted geometry until official same-workspace Code CLI reuse activated the owned window. No product source or owner settings changed.

Main visibility-control video:425.366667s,12,761frames,H.264,2880×1800/30fps, SHAe949c046ff8daced34ee41b7bb3c9ce2e6bd9c70456edde6f0404f0f98ae02b5. Actual foreground Play from64.09 advanced to105.71 and explicit Pause retained it. After one Previous to55.87, Play continued while the owned zoomed OBS window covered VS Code and reached end120.54. Saved full frames50/83/235/275 were actually viewed: playing75.66, paused105.71, covered playing92.30, final120.54 with last available application frame120.25/Invalid credentials and explicit missing-history source/empty native values/stack. Bounded Play/Pause and end-gap traversal PASS; no every-frame atomicity or latency PASS. Action spans42.161/57.44s include tool/model overhead, not merely the requested12s sleeps. Private receipt: artifacts/cycle-0031/native-replay/vscode-visibility-control.json.

The simple OBS-covering hypothesis did not reproduce the original hidden-document paint timeout. Preserve the earlier continuous-playback FAIL and exact90/91 diagnostics; its triggering condition remains unresolved. No speculative timeout/paint-ACK change or production fix. OBS is running, recording stopped/finalized; source remains VS Code until explicitly reselected for Cursor. Original clips retained privately.

Cursor now reports3.23.5/arm64, commita34aa15953a79dfe2ada63f5460efa79005dfbb0, runtime20d00d5b. Official CLI opened the existing isolated dashboard workspace/profile; public Open Study Workspace opened default study57bbb9ae, not the frozen e4906307. No new Agent message sent; visible blank Agent modelGrok4.7HighFast is preparation only, not Cursor Auto AI proof. One next action: select e4906307 through Saved study, freeze actual timeline/native expectations, then reselect the exact Cursor OBS window and run its separate changing-content preflight/product video. Cursor replay NOT RUN; review/delivery pending.


Cursor expectation amendment before the hidden-Application trial: the public Saved study menu contains22 Cursor archives and no VS Code e4906307. Do not manually copy storage to make that exact-archive check pass. Version2 uses existing real Cursor study57bbb9ae, independently observed stops40.98s (captured actions.ts36:7, authenticate catch/error CredentialsSignin) and74.59s (login-form77:15, LoginForm state CredentialsSignin/callbackUrl /dashboard), duration99.32s. The ownership behavior is unchanged; archive/source/time proof stays host-specific, exact shared-archive original remains NOT RUN. Freeze Previous/Next/gap-return/Play-Pause expectations in private cursor-expectations.json before main input.

Cursor recorder preflight passed:68.033984s/2,042frames at2880×1800/30fps, SHAfa0e71b6e15935811ccff7d6cf458a1a517beb17c4911c4b1bf71c50a5ec20d3. Exact QA Cursor source3456×2168 is intentionally fitted to2880×1800 bounds after Reset; position0/0, rotation0,allcrop0, both audio mutes1. Actual full saved frames2/42/66 viewed; inactive74.59→40.98 actions/native→74.59 login-form/native update, allwindowedges retained. Scaled overview cannot claim unscaled pixel/latency/atomicity. New right Agent remains visible and Learning summary stays in the left Explorer section; public Show Learning Summary/Restore did not produce approved right-summary geometry. Retain this AC-ENTRY/DESKTOP mismatch; do not call composition PASS. OBS dropdown clicks failedAX; reconnection and native Down/Return selected exact Cursor QA, verified in Properties/preview before recording. Recording stopped/finalized; no blind source/terminal typing or owner settings edits.


## Installed Cursor video result, 2026-09-30

Original C31 VSIXa752afde/runtime20d00d5b, Cursor3.23.5/arm64 QA0029Settings, actual saved study57bbb9ae under expectation version2. Silent finalized main212.233984s/6,368frames,H.2642880×1800/30fps, SHA833e95df68a81e9edcefcfadcca3ee693907ab2c68d1c506f078624e7d5ccb86. This intentionally scales the entire3456×2168 source into2880×1800 Fit bounds, allcrop0; it earns no unscaled pixel/latency/atomicity claim. Actual full saved frames53/65/79/95/120/169/184/198 were viewed; hashes/action times in private cursor-main-acquisition.json. No second navigation command, new runtime or target submission.

| Frozen Cursor check | Actual saved-video observation | Outcome |
| --- | --- | --- |
| Hidden Application74.59 + one Previous |53s source-tab covers Application;65s recorded40.98, captured actions36:7, native authenticate/CredentialsSignin catch | Bounded development PASS |
| Hidden Application40.98 + one Next |79s source covers Application;95s recorded74.59, captured login-form77:15, native LoginForm.state CredentialsSignin/callbackUrl /dashboard | Bounded development PASS |
| Gap and return |120s sourceplaceholder/empty native state;169s corresponding74.59 source/native restored | Sampled negative-control PASS; range AX stayed74587.2 across1ms decrement, exact update unresolved |
| Play and Pause |184s playing83.15 (application83.10);198s paused90.90 with historical74.59 native interval | Bounded development PASS; no every-frame synchronization claim |
| Approved-image composition | App above capturedsource/native debugger left; right remains blank Agent and summary is in left Explorer | PARTIAL; required right-summary/layout/focus mismatch remains |

Fresh Cursor settings, installed runtime and managed skill hashes still match its preflight; dashboard tracked source unchanged at1936e419, only existing.codebook/. Public UI never typed in source/terminal and no AI message was sent. Original expected exact VSCode e4906307 archive is NOT RUN in Cursor; the different real archive/time/source is explicitly retained. Cold focus, every-frame transition inspection, summary reading/focus preservation, original recurrent VS Code paint failure and delivery remain open. No Stage1/2 or full product acceptance.

Current next action: inspect the remaining recorded native transitions and the public summary placement/focus path on the unchanged candidate; narrow the intermittent paint-failure condition before any source remedy. The reproduced one-command ownership repair now has separate bounded installed proof in both hosts, without converting unresolved adjacent issues into PASS. Record these outcomes in Issue53 without closing it; required reviews/delivery follow only the cycle's completed validation gate.

Cleanup/tracking: OBS public Quit completed; exact private-application process absent after finalized outputs. Cursor remains paused90.90s and VS Code at120.54s as intentional trial selections. Native/source/terminal drafts were not edited. Cursor-preservation.json hashes and dashboard status verify unchanged work. Current controlled/Cursor section mirrored in Issue53 and fresh-read verified OPEN; local record links and git diff --check PASS. No product source/test/package change in this turn; previous mechanism/performance tests are not rerun or relabeled. Review/delivery still pending.


## Summary verification compaction entry, 2026-09-30

Fresh current-disk full mandatory reads completed, including this active cycle; DEVELOPMENT, D025–D041, behavioral design, full interaction review and both QA guides were reread. The image tool opened the approved PNG and its SHA matches D036. Observed live application/source/native debugger/chat with bottom capture/save; replay replaces chat with summary/sequence at one gap-marked playhead; independent DeepWiki has chapters/article/outline/update/output/citations/Q&A; shortcut strip has key tooltips and searchable help. No image-derived runtime proof.

Fresh branch/head remain codex/cycle-0031-replay-transport/ce89dbd, all24 authored dirty paths preserved. Serena symbols confirm the loading guard and native Application visibility callback. Both installed runtime hashes match20d00d5b; dashboard1936e419 remains unchanged with existing.codebook/ only. Issues1/53 OPEN, branch PR absent. AC-REPLAY/ENTRY retain the verified mechanism and separate bounded host proofs; GAPS/SAVE/LEARNING/DESKTOP depend on video/preservation/image inspection. The other seven rows carry unchanged product source and original proof limits; all13 integrated rows remain open. Private entry: artifacts/cycle-0031/native-replay/compaction-entry-20260930-1621.json.

The owned Cursor-summary main take was stopped before these reads as independent safe preparation; OBS returned to Start Recording and the finalized output was identified from its actual log. Selected next action: inspect its frozen scrolled-summary cover/public-reopen result, then retain host placement root cause and unresolved frame/focus/paint obligations before delivery. No new source remedy is selected.


## Cursor summary placement and reading result, 2026-09-30

Read-only installed vendor inspection confirms the host difference: Cursor 3.23.5 explicitly rejects `viewsContainers.secondarySidebar`, while VS Code 1.139.1 registers that contribution. Codebook declares its owned `codebookLearning` container there; an orphaned child view falls back to Explorer in Cursor. `StudyWorkspace.showLearningSummary` focuses the view and awaits visibility, but does not establish its location. Private receipt `artifacts/cycle-0031/native-replay/summary-placement-investigation.json` retains both exact vendor-file hashes, code offsets/snippets and source paths. Context7 supplied the official sidebar guide; that guide's older direct-contribution restriction does not describe the observed VS Code 1.139.1 implementation. This is a confirmed target-version compatibility defect, not a product fix.

For a diagnostic only, public native **View: Move View → Learning summary → New Secondary Side Bar Entry** moved the owned summary to the right. The existing blank Agent tab remained. Public **Codebook: Show Learning Summary** then reopened it without another placement command. This persists an owned QA layout choice; it does not prove default placement on a fresh Cursor install. No internal workbench DOM/API, unrelated view move, product source or settings-file edit was used.

The separate silent changing-content preflight is 90.366667 s / 2,711 frames at 2880 × 1800 / 30 fps; saved full frames 3/76/89/90.1 were actually viewed. The main take is 491.366992 s / 14,742 frames, SHA `a32584a0df8577fda853fd0b6fffa97ba7198e18fb5675bbfdfc336976166d76`. Both mute values were 1 before recording; exact Cursor QA source 3456 × 2168 is intentionally fitted into 2880 × 1800, position 0/0, rotation 0, all crops 0. Original and silent clips remain private. Frozen expectations and action timestamps are retained in `cursor-summary-expectations.json` and `cursor-summary-main.json`.

| Frozen check | Actual saved-video observation | Result / limits |
| --- | --- | --- |
| Scroll, cover summary, one public reopen | Frame 3 shows section 2 Cross-runtime handoff at the selected reading location; frame 40 shows the blank Agent surface and the selected public command in the palette; 58/75 show the same summary sections 2/3/4 after one command | Bounded reading-preservation PASS after manual diagnostic placement |
| Preserve historical context and learner decision | All sampled frames retain Presented 90.90 s, captured login-form line 77, recorded pause 74.59 s and native LoginForm/CredentialsSignin; reopened learner checkbox remains unchecked | Bounded context-preservation PASS; no target rerun or understanding mutation |
| Approved composition / default placement | Right summary beside application above captured source and native debugger resembles the v9 hierarchy after the public manual move | PARTIAL: automatic Cursor placement remains defective; cold focus, invoking-control focus return and complete image fidelity remain open |

The native scroll wrapper made no painted change in preflight; keyboard Page Down successfully established the frozen reading position before the main take. No Agent message or source/terminal draft was submitted. No new AI-owned workflow, final acceptance, unscaled pixel or atomicity claim. Runtime remains the original C31 `20d00d5b…`; separate host archive `57bbb9ae` remains explicit.

## Corrected native transition inspection, 2026-09-30

The earlier 178-frame ROI preparation is not atomicity evidence: its `appClock` crop contains source minimap pixels while Application is hidden, and its timeline crop omits the actual Presented clock. Original full-resolution frames and failed sheets are preserved. New geometrically checked crops include native Variables/Call Stack, captured source, actual Presented status and Application/header; hidden header pixels are explicitly labeled as source, not a clock.

All 45 native frames for VS Code Previous 110.15 → 55.87 were actually inspected on corrected pages 1–12, plus full original frames 1/17/20/30/45. Frame 16 shows Loading; 17 shows application 55.87 and source line 75 with native state empty and old Presented 110.15, while the full control explicitly says Loading matching image, source and values / Requested 55.87. Frame 18 restores recorded Call Stack LoginForm 75:13; frame 20 reports Presented 55.87 / Paused finalized while Variables remain empty. Local LoginForm rows first appear at frame 30 and remain through 45. No old values were paired with the new frame in this inspected interval, and settled correspondence is verified. Native readiness is **PARTIAL**: the control settles 10 video intervals (about 0.333 s at 30 fps) before inspectable Variables rows appear; the image-to-values separation is 13 intervals (about 0.433 s). These are video-frame separations, not input or renderer latency measurements.

Private corrected receipt: `artifacts/cycle-0031/native-replay/vscode-corrected-roi-previous-second.json`. The other 133 original transition frames and Cursor transitions still lack every-frame inspection. No all-frame/atomicity PASS or production remedy is inferred. This sharpens the previously recorded blank-readiness gap without changing the bounded one-command result.

Closure audit: T1–T3 mechanism/package work and the owner-requested recorder/parallel-test increments are complete at their recorded cuts. T4 has separate bounded one-command/gap/Play-Pause and preservation results in both hosts; it remains incomplete for the declared focus/transition/composition validation, with the original intermittent ACK failure still unresolved. Cycle remains validating/local-only. One executable next action: inspect the remaining VS Code Previous/Next/gap native frames with corrected, geometry-verified crops, separating stale correspondence from the confirmed blank Variables interval; use that evidence to select the smallest replay readiness repair. Keep the Cursor placement root cause as a separate retained compatibility gap. Reviews, PR, CI and merge remain pending; all 13 integrated product rows and final stages remain open.

Cleanup: main output stopped/finalized before entry reads, originals retained, OBS public Quit completed and exact private OBS process is absent. Cursor remains paused 90.90 s with intentionally moved right summary; VS Code remains paused 120.54 s. Existing drafts, tracked target source, skills and settings remain preserved; no new product/test change or rerun is claimed.

Tracking/preservation verification: Issue 53 summary/frame section was mirrored and fresh-read verified OPEN. Fresh hashes of Cursor runtime, user settings and managed skill match cursor-preservation.json; dashboard remains1936e419 with only existing.codebook/. Local record links and git diff --check PASS. Private current receipt: summary-frame-preservation.json. No release-level review or CI claim.


## Native readiness investigation entry, 2026-09-30

Fresh post-compaction full mandatory reads and applicable DEVELOPMENT/D025–D041/behavioral-design/interaction-review/QA-guide reads completed. The image tool actually opened the approved v9 PNG with matching SHA: live app/source/native debugger/chat and bottom capture/save; replay substitutes summary/sequence at one gap-marked playhead; independent DeepWiki includes chapter/article/outline/update/output/citations/Q&A; shortcut strip supplies tooltip keys/searchable help. Branch/head and all 24 authored dirty paths remain preserved; controller07a0ca7b and both installed runtime20d00d5b match. Dashboard1936e419 retains only existing.codebook/. Issue53 is OPEN, branch PR absent, owned OBS process absent. Private entry: artifacts/cycle-0031/native-replay/compaction-entry-readiness-20260930.json.

Affected audit: AC-REPLAY/ENTRY source still retains the fixed passive-reveal ownership. Fresh Serena/source inspection of {@link ReplayDebugger.present} confirms it returns immediately after {@link ReplayDebugAdapter.select}, before any current native-client stack/scopes/variables retrieval; {@link StudyWorkspace.presentPlayback} then delivers the image and permits commit. AC-GAPS/SAVE/LEARNING/DESKTOP retain their exact candidate/negative-control/preservation limits. The other seven rows retain unchanged product source and original proof limits; all thirteen integrated rows remain open.

Selected investigation, not a source remedy: complete the corrected existing-video intervals and inspect installed host Variables scheduling; then run a private controlled probe reusing the existing replayDebugger.test.ts editor harness against unchanged compiled source. Frozen expectation: when native startup completes but the editor has not requested the recorded stack/scopes/variables, history presentation must not be treated as confirmed native readiness. Predicted current mismatch: present resolves while no inspection request/response exists. Record this as a boundary reproduction, not a native-pixel test or the future repair contract. Preserve cancellation/termination/foreign-session/collapsed-view ownership; no fixed delay or fabricated paint ACK is authorized by this experiment. A meaningful readiness remedy requires a bounded engineering plan and actual both-host video before acceptance.


### Completed frame inspection and reproduced readiness boundary

The exact native-frame inventory is **45 + 45 + 44 + 45 = 179**. Earlier178 and remaining133 statements were arithmetic errors; the earlier read/inspection limits still describe those checkpoints. All four original corrected intervals are now actually inspected. The old faulty ROI sheets remain failed preparation. Private four corrected receipts record actual viewed pages and geometry; no claim covers all28,052 frames of the main video.

| VS Code transition | Actually inspected result | Outcome / limitation |
| --- | --- | --- |
| Previous110.15→55.87 | Original45 frames: app/source17, Call Stack18, Paused finalized20, Variables30 | Settled correspondence PASS; readiness PARTIAL:10 intervals (~333ms) after finalized |
| Previous55.87→17.29 | Original45 plus42 extended frames: app35, Stack36, finalized37; first matching LoginButton/pendingtrue at combined48 | Settled correspondence PASS; readiness PARTIAL:11 intervals (~367ms) after finalized |
| Next17.29→55.87 | Original44 plus42 extended frames: app34, Stack35, finalized37; first matching LoginForm at combined47 | Settled correspondence PASS; readiness PARTIAL:10 intervals (~333ms) after finalized |
| One-millisecond gap |45 frames: Loading/Variables clear21, Stack clears30, source missing placeholder39, app41, finalized/Not recorded42 | Bounded negative-control PASS; earlier stack21–29 exists only during explicit Loading, before app; no earlier execution highlight/Variables afterLoading |

All84 extended frames were actually viewed. Their first decoded full RGB frame exactly matches the respective original interval's final frame, proving the join (one duplicate per boundary). Private vscode-native-arrival.json retains exact extraction commands, crop/hash/page identities and this comparison. Separations are video intervals at30fps, not input or renderer latency. No stale earlier Variables pairing was found in these windows; blank readiness remains a real mismatch. Cursor transitions, cold focus, automatic Cursor summary placement and the intermittent viewport ACK failure retain their separate open limits.

`/investigate` session2422-1790754697-331b6006: read-only installed vendor inspection identifies the VariablesView400ms scheduler in **both** VS Code1.139.1 and Cursor3.23.5. Non-explicit stack-frame focus schedules the default delay; hidden bodies retain needsRefresh. Exact vendor hashes/offsets and scheduling snippets are in native-variables-vendor-scheduler.json. The [upstream VariablesView source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts) corroborates the same scheduler; installed version bytes own target-version proof. Context7 returned unrelated DAP roadmap excerpts, so it supplies no readiness API contract.

The private controlled probe reuses the unchanged existing TestEmitter/harness declarations, transpiled against unchanged compiled ReplayDebugger. It intentionally reproduces red:1 test,0 pass,1 fail,exit1, `Presentation completed with zero native client inspection responses` (actualtrue, expectedfalse). Startup/configurationDone completes; present resolves and permits image/commit without stackTrace/scopes/variables inspection. This confirms the missing readiness boundary, while native video demonstrates its visible effect. Native-client retrieval and actual painted rows are distinct; response delivery alone must not be called a paint ACK. Receipt/log/script: native-readiness-boundary-probe.json/.log/.cjs. No product/test source change, green remedy or full-suite rerun. Freeze helper unavailable; no lock token. TODOS.md absent; no relevant replayDebugger learning found. The earlier Node cursor-publication race is a separate boundary, not this diagnosis.

**Next executable action:** review a bounded native-readiness plan for ReplayDebugger/ReplayDebugAdapter and existing replay debugger/workspace tests. Establish current-generation supported-client inspection receipts and truthful waiting/error/cancellation behavior before implementing; explicitly handle hidden/collapsed native views without an indefinite wait, same-stop video frames, gaps, superseded requests, learner termination and foreign sessions. No fixed400ms sleep, internal workbench mutation, duplicate Variables UI or fabricated paint ACK. Red/green and disabled-fix tests must precede both-host installed video proving the chosen readiness boundary; any remaining paint interval stays disclosed. T4/cycle/delivery and all13 integrated rows remain open.

Preservation: no desktop input, new runtime, chat message, target/settings/skill edit or package producer in this investigation. OBS remains absent; installed hashes and dashboard source matched fresh entry. Existing recordings/failed probes stay private. Investigation progressed through boundary reproduction; remedy engineering/implementation remains the next authorized step.


## Native readiness engineering plan, 2026-09-30

`/plan-eng-review` completed on the confirmed existing native presentation boundary. Scope accepted as-is: four production/test paths (replayDebugger.ts/replayDebugAdapter.ts and their existing tests), cycle/state records; zero new classes/services/dependencies. Current full entry from the preceding turn remains valid, current branch/dirty/source and selected tests rechecked. No controlling specification changed. Primary AC-REPLAY; AC-ENTRY/GAPS/SAVE/LEARNING/DESKTOP regressions, other seven source paths/proof limits unchanged. All13 integrated rows stay open.

Architecture2/quality1/test6/performance0 findings are mapped to implementation/proof; no critical silent unhandled path or unresolved choice. Routine mechanism/deadline/test choices use existing owner product completion/resume authority and D026/D032/D039; no repeated navigation permission. Claude Code CLI owner-skipped; native fallback Plan/TaskOutput/TaskStop unavailable. No outside-provider approval/coverage. Brain/Aside unavailable, local current goal/design/decisions supply scope; Context7 returned the official DAP request waterfall and current-handle semantics. DAP responses are client retrieval, not native pixel ACKs.

Selected plan:
1. In existing ReplayDebugAdapter, reset three inspection flags at select/dispose. A valid current-thread stackTrace includes the selected top frame; only successful top-frame scopes and first-root variables from start0 complete recorded-state inspection. Later/caller/nested/retired/wrong-thread/paged-after0 requests cannot satisfy readiness. A gap requires its current empty stack response; an empty-scopes frame requires stack/scopes only.
2. ReplayDebugger.present waits on that existing adapter through existing cancellable waitUntil before setting hasPresented/lastPresentedSnapshot. Keep a duplicate same-stop call on the wait, never an early return; a confirmed same stop reuses receipts. Abort/revision/changed adapter/learner Stop/dispose reject, preserving foreign sessions. The existing named5000ms native capture deadline bounds nonretrieving clients with actionable Run and Debug guidance; no indefinite wait, automatic pane activation, fixed400ms sleep, fake request or paint ACK.
3. Existing owner harness models Threads→StackTrace→Scopes→Variables by default, with controlled delayed-client cases. Add meaningful red tests before source edits, then green/disabled-fix; protocol handles/paging/empty/gap/reset/dispose, owner pending/duplicate/newer seek/cancel/termination/foreign/same stop/real timeout/recovery all covered. Existing assertions preserved, no global fake timers.
4. Build before parallel test readers; focused protocol/owner and all workspace/controller partitions, full suite, package175 after all readers, checked new private VSIX/provenance. Separately installed both-host OBS video and inspected native frames must verify values before finalized/new app; keep remaining pixel interval/failure disclosed. Prior runtime20d00d5b proof is not relabeled new.

T1 red tests → T2 receipt/wait mechanism → T3 suites/package → T4 new both-host native proof. Sequential implementation, independent test files use existing parallel runner. Cursor default placement, cold focus and intermittent paint ACK remain separate retained gaps; no cycle closure/release/final claim. Full private report/QA/task paths are retained in artifacts/cycle-0031/native-replay/readiness-eng-review-paths.json; local steps above recover the complete next action without that cache. Review session2422-1790755586-dbc024fd; saved report read-back and review-log gate passed. Status ISSUES OPEN means nine mapped obligations, no unanswered choice. Next actionT1.

Native readiness red result: build/typecheck PASS after repairing only the test port's opaque VS Code message typing. Existing50 cases PASS, all12 new cases FAIL, exit1, zero cancellation/skip; production source remained unchanged before red. Private native-readiness-red.log/.json. The implementation adds three response flags plus a selection-valid guard, so malformed selection cannot become ready via its finally-emitted empty stack. This is necessary for the already planned tamper/reset case; no new policy/dependency. Getter tests now use the actual typed property; assertion expectations stay unchanged.


## Native readiness mechanism result, 2026-09-30

The selected repair is implemented in the two existing native-history modules only. ReplayDebugAdapter records successful current-thread/top-frame scopes/first-root-page variables retrieval, resets it on selection, and refuses readiness after invalid selection or disposal. Gaps need an empty stack receipt; frames without scopes need no variable request. ReplayDebugger.present awaits this getter through the existing named5000ms observation deadline before confirming history. Duplicate/current-stop calls cannot bypass pending inspection; confirmed same stops reuse it. Abort/newer revision/changed adapter/learner Stop/close reject obsolete confirmation. A nonretrieving client gets actionable Run and Debug guidance, without a forced native-pane move or silent restart. No fixed400ms delay, fake client query, renderer/native paint ACK or target action.

Observed tests: existing50 and new12 yielded50PASS/12FAIL before product edits. The final protocol/owner suite adds three explicit newer-stop/closure/inspected-value-reuse cases:65/65PASS, zero fail/cancel/skip,5.54s. Disabling only the compiled readiness wait gives56PASS/9FAIL,exit1; exact compiled bytes restored in finally and hash-verified. No source edit in that control. Full current-source1,383/1,383PASS, zero failure/cancellation/skip,57.37s runner/61.55s including build; package175/175PASS at concurrency4,8.07s only after every extension reader exited; hook4/4PASS independently. Actual Node24.21.0 and pinned wrapper pnpm12.4.2 verified. Existing assertions and the original passive-reveal guard07a0ca7b remain. Private red/green/full/package/control/source receipts under artifacts/cycle-0031/native-replay/.

Checked new private development VSIX: artifacts/packages/codebook-0.2.14-c31-native-readiness-20260930.vsix, SHA 2b9fc79ad29e4583f575896e1785afd3a6d3528ba081a956c0c1166ed23d0c16, runtime a01a78f2a42d489c52c12d1880cdd2d0ba866ac27e524e9d734038b33a7140e9, sourceHash 6ab5e1b5ee89360621c7f996aa764ee7b867dc6de5f05166d0c19c47d5080abf, HEADce89dbd with declared dirty28 author paths. Clean build/allowlist29 entries/isolated module load and explicit package:check PASS. This is a new runtime, distinct from the old installed20d00d5b and its prior native videos. Both existing QA installations still match20d00d5b; **new candidate installation/native verification NOT RUN**. Common skill unchanged. No source/dependency/fixture app enters package scope.

Affected-gap reassessment: AC-REPLAY now has a reproduced and tested native-client readiness boundary; painted native rows remain unverified on the new runtime. AC-ENTRY/GAPS/SAVE/LEARNING/DESKTOP retain their exact source/version/preservation/visual limits. The same owner also serves saved Node-history selection; source inspection confirms its native-inspection wait precedes durable cursor/publication, so include a bounded saved-Node inspection regression without rerunning target code. Other seven product-source paths remain unchanged and keep earlier proof limits. All13 integrated rows, fixed-nine stages and owner acceptance stay open. Engineering report is host-only with9 mapped findings, no unresolved choice; prior OCR/CodeRabbit cuts do not review these new modules/tests. Required final review/PR/CI/merge remain pending.

**One next action:** install this exact checked VSIX through the supported official CLIs in the existing isolated VS Code/Cursor QA profiles, verify their runtime hashes, then perform separate OBS silent/full-frame/changing-content preflights and frozen one-command Previous/Next/gap/Play-Pause native-frame inspection on each actual saved archive. Confirm native Variables before finalized/new app; preserve all settings/skills/drafts/learner decisions and existing layout. Include the saved-Node native-inspection regression where an existing verified archive is available, with frozen public expectations first. Old videos may guide the scenario but cannot verify this candidate. Cursor automatic summary placement, cold focus and original intermittent paint failure retain separate open gaps.

Preservation/cleanup: full test and package/VSIX producer handles are terminal; no recorder or new desktop action in this mechanism turn. Fresh installed runtime hashes remain20d00d5b and dashboard1936e419 retains only existing.codebook/. No shared skill, target source, settings, AI message, DB/runtime or learner decision changed. Investigation phase4 mechanism proof progressed; phase5 native verification remains. Cycle0031 validating/local-only.

## Native-readiness installation resume entry, 2026-09-30

Fresh post-compaction full reads completed from current disk: PRODUCT_GOAL and all three normative contracts, IMPLEMENTATION, PROJECT_STATE, this active cycle and DESIGN; DEVELOPMENT, controlling D025–D041, behavioral design, complete interaction review and both QA guides. The image tool actually opened the approved v9 PNG; its SHA matches D036. Observed live app above stopped source beside native debugger and standard chat with bottom capture/save; replay substitutes summary/sequence at one gap-marked playhead; independent DeepWiki has chapter/article/outline, update/output/citations/Q&A; shortcut strip has keyed tooltips and searchable help. No runtime proof follows from the image.

Branch/head remain codex/cycle-0031-replay-transport/ce89dbd, with all28 authored dirty paths preserved. Fresh hashes match the recorded adapter9720ee3a, debugger3dcfeb98 and controller07a0ca7b. Dashboard1936e419 retains only existing.codebook/. Issue53 is OPEN and no branch PR exists. Official CLI installation receipts now verify runtimea01a78f2 in both existing QA extension directories; actual loaded extension-host code and native pixels remain unverified. Earlier20d00d5b videos retain their original identity. VS Code QA was closed through File → Close Window and reopened through the official CLI with the same isolated workspace/profile; source tabs and saved library remain. Its Extensions badge requests one restart, whose owning extension must be inspected before further replay input. No recorder is running at this checkpoint.

Affected source audit: ReplayDebugAdapter.inspectionReady requires valid current stack/top scopes/first-root variables; ReplayDebugger.present now waits before confirmation. StudyWorkspace.presentPlayback and saved Node-history selection share that owner. AC-REPLAY/ENTRY/GAPS/SAVE/LEARNING/DESKTOP require new-candidate native/preservation/image proof. The other seven rows retain unchanged source and earlier proof limits; all13 integrated rows remain open. The already completed test-speed work is confirmed in the execution guide and scripts, without rerunning equivalent tests. Selected next action: identify the QA restart requirement through public Extensions UI, establish the loaded candidate, then repeat the OBS preflight and frozen browser/Node-history trials. No new product remedy, acceptance or delivery claim.


### Installation preparation and current review result

Public Extensions identifies the restart requirement as Claude Code, while Codebook0.2.14 is activated56ms. Fresh QA window3 extension host34688 started/activated Codebook17:55:36 JST, after official installation17:49 JST; both installed runtime hashes still matcha01a78f2. Public Open Study Workspace and Recording reopened the existing e4906307 at120.54s with the missing-history source placeholder and empty native stack. The initial source-not-ready warning is retained. No new target/runtime/chat submission or learner decision. These static preparation observations earn no new native-video PASS; Cursor was not launched this turn.

The owned private OBS32.2.2 was launched, active Untitled profile/collection observed, and both mute values verified1 before recording. Exact source reselection did not complete: CUA returned “The Mac is locked and automatic unlock is paused because physical input was detected.” Manual unlock was requested; no bypass or exclusive foreground hold. Owned OBS PID39672 remains open, recording never started. Its previous Cursor source must be replaced with the exact new VS Code QA window and transform/preflight reverified after unlock. Private checkpoint: artifacts/cycle-0031/native-replay/native-readiness-installation-checkpoint.json.

OCR current workspace:5/6 eligible files reviewed,1 unchanged harness skipped with concrete prior hash/review binding,22 material default exclusions accounted separately. Fresh review covers the new adapter/owner and both excluded readiness-test diffs. Local CodeRabbit completed28 files/exit0 with2 minor findings: stale state-header counts and setup-failure cleanup in presentation tests. Both corrected and host-reviewed; no zero-finding external rerun or frozen-release review is claimed. The three ordinary-chat cases now acquire harness/reader/server/client inside try and unwind initialized resources through nested finally; held preference setup likewise belongs inside try. Assertions, names and deadlines remain unchanged. The modified presentation partition supersedes only its previous byte-identity carry-forward, not the original performance experiment. No production/installed runtime changed in these corrections.

Fresh correction cut: full1,383/1,383PASS, zero failure/cancellation/skip,59.77s including build; package175/175PASS,7.60s only after every extension reader exited. Existing hook4/4 and checked candidate29/isolated-load proof retain their original cut; no redundant hook or VSIX rerun. New logs: readiness-review-full.log/.json and readiness-review-package.log/.json. Review receipts: readiness-ocr-preview.json, readiness-ocr-rules.json, readiness-ocr-host-review.json and readiness-coderabbit.jsonl. Current host post-finding review and private metadata bind corrections separately from the provider cut.

Affected AC-REPLAY/ENTRY/GAPS/SAVE/LEARNING/DESKTOP remain awaiting new runtime native frames and preservation/image proof; all13 integrated rows/final stages remain open. Source adapters/controller, both installed runtimes, Cursor settings/managed-skill hashes and dashboard tracked source are unchanged. No owned test/package/provider process remains. No PR/CI/merge/publication. One executable next action: after manual unlock, reselect the exact QA recorder source and complete preflight, then frozen browser and saved-Node native-inspection trials in both hosts. The original intermittent paint ACK, default Cursor summary placement and cold focus keep their separate unresolved limits.


## Recording paint-clock mechanism checkpoint, 2026-09-30

Owner D043 explicitly revoked D042 before its stopping condition was reached. Continue the current repair/proof and then existing review/delivery/product cycles; protected Mac use authorized. Goal/design/feature contracts are unchanged. Previous stop clauses retain their historical scope only.

Three authored serialized-renderer cases(initial hidden, hide after decode, gap) failed before production edits; actual exits1,0PASS/3FAIL. Recording-only current-epoch visibility now supplies accumulated monotonic available paint time to FrameDelivery's existing slots; each original3000ms deadline is retained/rescheduled, never reset. Matching real ACK remains required; hidden ACKs are refused. Gap clearing uses that same explicit visible-time deadline plus existing revision/epoch/closed/AbortSignal guards. LIVE capture/CDP timing and unknown/replaced renderer timeouts remain wall-clock bounded. No forced focus, target execution, fake ACK, new class/helper/dependency or native internal mutation.

Initial focused31/31PASS. Disabling only the compiled visibility update reproduces all3 failures; exact original bytes restored in finally. A newly tested hidden-placement drain lacked prompt signal cancellation:1 redFAIL before correction. Reuse existing awaitResponse around renderer-operation draining, keeping the named20,000ms active/native bound; cancellation releases only placement reservation, not another owned frame. New regression verifies frame can still paint after that cancellation.

First full1,396 cases:1,395PASS/1FAIL, zero cancelled/skipped; failure was the new gap-cancellation assertion expecting the inner reason while Node's timer emits outerAbortError. Assertion corrected to the actual cancellation contract; no product cancellation behavior changed. Final full1,397/1,397PASS, zero fail/cancel/skip,59.887s including build(55.864s runner). Includes all14 new cases and all workspace partitions; original1383 cases retained. Package producer starts only after readers exit. Logs/receipts: ack-visibility-red, green-initial, disabled, full, full-final and ack-placement-red under private artifacts/cycle-0031/native-replay/. Native new repair remains NOT RUN, so no viewport/native-readiness/full-product PASS is claimed.

Affected AC-REPLAY/GAPS have mechanism repair evidence; ENTRY/SAVE/LEARNING/DESKTOP retain preservation/current-image/native proof limits. Other7 product paths unchanged, all13 integrated rows open. One next action: sequential package/checked private VSIX, normal installation/fresh host identity, separate both-host OBS preflight/native frames; then required reviews/delivery underD043.


ACK package/installation checkpoint: new checked private0.2.14 VSIX2a76e7525fb051143ce246f119f53ca2366714b9e41905f5a9628063be9d7e38/runtimef95562ba478e592fb28faa0984564d83974b9908711ba7113bca608395267604/sourceHash6825523ee84c77d422b75052f26eba653f810f9abb1cf321a9b87f50aa72edda;29 allowlisted entries/isolated load/explicit package:check PASS. Full1397/1397 and sequential package175/175PASS(7.49s). Official CLIs installed exact runtime bytes in both existing QA profiles; VS Code QA still shares Default extensions. VS Code fresh window1 extension host46123 started20:02:20 JST and activated Codebook20:02:20.262, after installation20:02:01 JST. Public Open Study Workspace then one Recording action eventually reopened e4906307/120.54s with missing-source placeholder/empty native stack and summary right; initial source-readiness warning preserved. Static preparation only: new-runtime native video/transition proof NOT RUN. Cursor loaded-host identity NOT RUN. OBS remains running/stopped, and its old window target must be reselected for the new VS Code window before any new preflight/take. No target/settings/skill/chat/learner edit; dashboard1936e419 retains only existing.codebook/. D043 authorizes continuing the full product workflow. Next: exact new-window silent/full-frame/changing-content OBS preflight, freeze new native actions/expectations, then separate two-host native proof; retain prior a01a78f2 FAIL as its own candidate.

### Paint-budget native verification resume, 2026-09-30

After compaction, stopped the already-started owned preflight before preparation; OBS confirmed Start Recording and its log confirms finalization. Full current mandatory documents, complete active cycle, DEVELOPMENT, controlling D025–D043, behavioral design, interaction review, both QA guides and TS rules were read. Actually viewed the approved PNG with its unchanged D036 hash: live app/source/native debugger/chat and bottom capture/save; replay summary/sequence/shared timeline/gaps; independent DeepWiki chapters/article/outline/update/output/citations/Q&A; shortcut tooltips/search.

Fresh branch/head remain codex/cycle-0031-replay-transport/ce89dbd with33 authored dirty paths preserved. Both installed runtime hashes matchf95562ba; loaded VS Code host46123 is alive. Current visibility/paint-clock/epoch/ACK source and controller loading ownership match the checked candidate. Serena LSP ready. Dashboard1936e419 retains only existing.codebook/; Issue53 OPEN, branch PR absent. AC-REPLAY/GAPS have mechanism proof and await this candidate's native video; ENTRY/SAVE/LEARNING/DESKTOP retain preservation/layout/focus boundaries. The other7 source paths are unchanged and keep prior limits; all13 integrated rows remain open. Continue D043: inspect the stopped preflight, restore its sidebar, freeze and record one-command/gap/Play-Pause proof separately in both hosts. Recorder acquisition does not prove input or replay readiness.

### New candidate VS Code video result, 2026-09-30

Runtimef95562ba, study e4906307, VS Code1.139.1/QA0029Clean, checked VSIX2a76e752. Preflight432.466667s/12,974frames/SHAe93dc663: actual2/40/420 full frames verify changing sidebar/full window; restored afterward. Main398.333333s/11,950frames/SHA6566238e: actually viewed30/50/115/145/180/220/280/340/395. One hidden-Application Previous120.54→55.87→17.29 and Next→55.87 show matching75:13/CredentialsSignin and90:5/pendingtrue. Gap clears source/native state; return restores55.87. Foreground Play/Pause retains109.09; OBS-covered Play reaches120.54/end-gap. Bounded installed development PASS; no ACK error this take, no exact-trigger/blanket recurrence guarantee.

Actually inspected every native frame of first Previous and Next through60+30 each(180 extracted,178 unique; both one-frame joins match decoded RGB). First Previous: Loading31, stack52, values63, newapp64, finalized66. Next: Loading30, stack49, values61, newapp62, finalized64. Matching Variables precede new Application by1 and finalized by3 intervals at30fps; earlier empty values remain explicitly Loading. Thus the old333–367ms post-finalization blank interval is absent in these windows. These are frame separations, not latency or all-playback atomicity. Full tailframes corroborate geometry; hidden header crops are source minimap, never clocks. SecondPrevious/gap prepared60-frame intervals remain unviewed; their settled/sample checks are separate.

Private receipts: ack-budget-vscode-preflight-01.json, main-expectations.json, main-01.json and transitions.json under artifacts/cycle-0031/native-replay/. Originals retained. v9 composition remains app above historical source, native debugger left, summary right and bottom timeline; narrow summary density remains a mismatch. Recording stopped/finalized, no target/settings/skill/chat/learner edit. AC-REPLAY/GAPS gain bounded current-candidate VS Code proof; all13 integrated rows stay open. Next: fresh loaded Cursor host, exact-window preflight and separately frozen native proof; retain default Cursor placement, cold focus, saved Node and final gates.


### Cursor paint-budget verification entry after compaction, 2026-09-30

Stopped the already-started Cursor take before mandatory preparation; no product action had been sent. OBS finalized the setup-only original at21:08:26JST; private ack-budget-cursor-setup-only-01.json binds actual path, metadata/hash and two actions. No main-product result is inferred. Full current mandatory documents including complete active cycle were read again, plus DEVELOPMENT/D025–D043/behavioral design/full interaction review/both QA guides. The image tool actually opened the unchanged approved PNG: native live app/source/debugger/chat and bottom capture/save; replay summary/sequence/shared gap timeline; independent DeepWiki chapters/article/outline/update/output/citations/Q&A; shortcut tooltip keys/search.

Fresh branch/head remain codex/cycle-0031-replay-transport/ce89dbd,33 authored dirty paths preserved. BrowserViewport72b35541/FrameDeliverydb0c9a04/viewportHtmlba58e4f9 and controller07a0ca7b match the checked candidate. Both installed runtimes matchf95562ba; actual VSCode46123/Cursor55814 hosts and owned OBS49158 are alive. Dashboard1936e419 retains only existing.codebook/. Issue53OPEN, branch PR absent. AC-REPLAY/GAPS current mechanism and bounded VSCode proof remain separate from missing Cursor frames; ENTRY/SAVE/LEARNING/DESKTOP retain preservation/layout/focus/Node limits. Other7 source paths unchanged, no proof promoted; all13 integrated rows remain open. Continue D043: same existing Cursor57bbb9ae and pre-frozen expectations, fresh main take after stopped/setup output; no new product remedy selected.


### New candidate Cursor video result, 2026-09-30

Fresh Cursor3.23.5 host55814 activated the installed f95562ba runtime after installation, preserving QA0029Settings and its existing real57bbb9ae archive. Exact-window silent preflight32.466667s/974frames/SHAb9b93f1a: actual0.5/15/32.166667 fullframes inspect changing sidebar/restoration/allcorners. Source3456×2168 intentionally Fit2880×1800, position/rotation/allcrop0. Both mutes1. Setup-only take before compaction preserved separately; main take02 is354.533333s/10,636decodedframes/H.2642880×1800/30fps/SHAd016b7e56bd3a28a4e3adb587917df87996f01d9154ebd2c586c6a4f5aae15fe. Original retained.

Actually viewed full10/25/55/90/120/145/215/270/345 samples. Hidden Application plus one Previous90.90→74.59, secondPrevious→40.98(actions36:7/authenticate/CredentialsSignin), Next→74.59(login-form77:15/LoginForm state) settle correctly without a second transport action. FirstPrevious shares the same74.59historical snapshot, separately limited. Gap1ms clears source/native state, actual AX74587.2→74586.2; oneNext restores74.59. Play reachesend99.32; actual correct Pause playback action during a later shortPlay retains75.30(sample270). Early readonly attempts searched the wrong Pause recording label; no blind input, and one late click after autoend is notPause proof. OBS-covered Play74.59→99.32 ends with lastavailableapp98.43/Invalidcredentials and sourcegap/nativeempty(sample345), noACKerror in this take. Bounded installed dashboard PASS only; exact native occluder/universal recurrence guarantee remains unproven.

Actually inspected180native frames(two3second windows), represented by147exact RGB-equal defined-ROI groups on49pages; complete frame-to-group map preserved. SecondPrevious: Loading49,source69,stack72,Variables84,newapp84,finalized86. Next: Loading49,source66,stack69,Variables80,newapp82,finalized84. Matching values precede finalized by2/4intervals(~67/133ms); Previous values/app share one30fpsframe, Next values precede app2intervals. No old Variables/new application pair or old post-finalization blank in these windows. These are scaled-video frame separations, not inputlatency, unscaledpixel or globalatomicity. Defined crops/full criticalframes retain geometry; hidden header is source, not clock.

Private receipts: ack-budget-cursor-loaded-host.json, preflight-01.json, main-expectations.json, main-02.json/actions and transitions.json under artifacts/cycle-0031/native-replay/. Approved composition app/source/nativeleft/summaryright is present after retained manual summary placement; automatic Cursor placement remains a known separate defect, no fullvisualPASS. No target/runtime/DB/newAIchat/settings/skill/learner change. OBS stopped/finalized, both hosts retain intentional end selections. AC-REPLAY/GAPS now have separate current-candidate bounded video proof; all13 integrated rows remain open. Next: savedNode native-inspection regression and cold-first-operation proof, then current-cut reviews/delivery; retained layout/final gaps remain.

### Saved-history verification entry after compaction, 2026-09-30

Stopped/finalized the owned VS Code cold take before mandatory preparation and retained original/silent video plus exported action timestamps. One Previous was already sent without a separate editor Raise and AX settled at55.87; saved frames remain uninspected at this entry. The public Saved study menu was opened, but Node selection was not sent. Do not duplicate that cold input or credit the unfinished Node trial.

Full current-disk mandatory reads completed again, including the entire active cycle and approved PNG opened with the image tool; DEVELOPMENT, controlling D025–D043, behavioral design, complete interaction review and both QA guides also read. Observed live app/source/native debugger/standard chat and bottom capture/save, replay summary/sequence/shared gap timeline, independent DeepWiki chapters/article/outline/update/output/citations/Q&A, and shortcut tooltips/searchable help. D036 bytes/approval unchanged.

Fresh branch/head remain codex/cycle-0031-replay-transport/ce89dbd,33 authored dirty paths preserved. Source and both installed runtime hashes match the checked f95562ba candidate; VSCode46123/Cursor55814 and owned OBS49158 remain alive, recorder stopped. Serena ready; dashboard1936e419 retains only existing.codebook/. Issues1/53 OPEN; no branch PR. Actual readiness getter/wait and visible paint-clock/deadline paths remain the previously tested source. AC-REPLAY/GAPS carry separate bounded current-host proof; ENTRY/SAVE/LEARNING/DESKTOP require remaining cold/Node/preservation evidence. The other7 product paths are unchanged and retain prior limits; all13 integrated rows stay open.

Selected unchanged-source proof: inspect the frozen cold frames, then use the already-frozen ack-budget-node-expectations.json public Saved study scenario in a fresh VS Code take. Exact existing archive3dc33834-b523-486c-ab6d-50ca8779267a_1ddfc1eb-bb15-476b-9497-daa44b47ab09 appears publicly as4b47ab09. Require captured data217:21 and Block/Local inspection at stop5, truthful output/empty state at result14, then browser55.87 restoration; no new target run. Confirm archive hashes/settings/skills/learner preservation. D043 continues to current-cut reviews/delivery and later gaps, without reopening accepted design or final acceptance gates.

### Cold operation and saved Node-history result, 2026-09-30

Both current f95562ba hosts have bounded cold-first-input proof. Cursor44.866667s/1346frames/SHAa00035c5: actual full2/40s samples show inactive99.32 with Application hidden, then one Previous without a separate Cursor Raise reaches74.59/login-form77:15/CredentialsSignin. VSCode482.466667s/14474frames/SHA8e4243a8: actual full2/40s samples show inactive120.54 with Application hidden, then one Previous without a separate Code Raise reaches55.87/login-form75:13/CredentialsSignin. The longer VSCode take was stopped before compaction reads; its subsequent Node menu opening is preparation only. Neither result asserts that CUA never activates on click or guarantees background OS input. Both video copies are silent2880×1800/30fps; original files/actions retained.

Separate VSCode saved-Node take:309.133333s/9274frames/SHA869f38ea15902ad86f5a898f60319dc679aa63045f895fe09e0511225ad77910. Actually viewed full30/125/165/185/230/303s. The initial public selection while browser playback was active was safely refused with Close browser replay guidance; the browser/native context stayed intact. Public Return to Current Pause, then the same Saved study selection opened the complete existing4b47ab09 archive.125s shows truthful no-video Node output/empty native state.165s shows captured data217:21, native Module.fetchInvoiceById, Blockdata(1)[{…}] and Localid invoice-456 after the learner expanded Local.185s shows result selection and cleared historical highlight/variables/stack. Public AX plus the sealed journal confirm result14/exit0/onepass13skips; those output counts are not claimed visibly readable in the sampled scrolled panel.230s shows browser selection retires the unpinned Node preview; public Open Study Workspace and one Recording action restore matching browser55.87/app/source/native context at303s. No Node target rerun, save workflow, every-frame Node confirmation ordering or final acceptance claim. Local expansion happened after initial selection; it does not prove all collapsed scopes paint before confirmation.

The historical refusal message remains visible after later successful navigation; retain this reader-error recovery concern for the next product audit. AX range value130.5627 also remained while selected-time text changed198.63→334.46; this accessibility discrepancy is separately retained. These do not falsify the inspected captured-source/native-history correspondence. Required browser/native transition ordering is covered by the preceding both-host windows, not inferred from this Node clip. Private cold/node expectations, actions, metadata, hashes and inspected samples are under artifacts/cycle-0031/native-replay/ack-budget-*.json/.mov; ack-budget-final-preservation.json verifies unchanged settings/managed skill and all three Node archive files against the frozen baseline. Explicit understanding remains unchecked; dashboard1936e419 keeps only existing.codebook/.

Bounded cycle validation is complete for retained first-command ownership, supported-client readiness and visible paint-time budgeting: red/green/disabled-fix controls, full1397/package175 and checked installed candidate, separate both-host browser video/transitions/cold input, and saved-Node inspection regression. The exact native occluder and universal recurrence freedom are not established; old candidate failures remain failures. No integrated AC/final row is promoted. Cursor automatic summary placement, summary density/focus, reader recovery/accessibility and full product acceptance remain separate required increments. Next: fresh OCR and local CodeRabbit on this complete33-path cut, then /ship and exact-release review/CI/root-gated merge under D039/D043; only afterward select the next bounded product cycle.

### Review-discovered hidden-clock polling guard

Host OCR traced a remaining performance mismatch in FrameDelivery.armDeadline: a stopped clock with0.1ms budget re-arms that tiny wall timer indefinitely. An unchanged compiled-source probe observed95 clock polls in120ms while still hidden; the authored observable budget/cancellation regression also fails before production edits. This violates the reviewed no-busy-polling boundary, without fabricating a paint receipt or changing the already demonstrated visible deadline.

Supplemental bounded engineering review: retain each immutable deadline and existing visibility refresh. A timer that observes no available-clock progress schedules its next observation at the original timeout budget; explicit visibility refresh immediately restores the exact remaining deadline. Live monotonic clocks always progress and keep ordinary timing. Reuse the existing timer/closure, one descriptive optional private argument, no new stored state/class/API/dependency or timeout constant. Required proof: red/green and disabled-guard control; quiet hidden wait still pending, immediate expiry on consumed budget, queued/stale/disposal and visible/live regressions; full suite/package after readers. Native f95562ba clips retain their exact identity; any carry-forward must explicitly limit this later timer-frequency-only change. Final package/release proof is separate. Current phase remains validating until these checks finish; next action is the minimal existing timer remedy.

### Quiet guard and review-cleanup result, 2026-09-30

The minimal timer remedy is implemented in {@link FrameDelivery.armDeadline}: a timer that observes no clock progress re-arms at the original timeout budget, while visibility refresh still applies the exact remaining deadline. The earlier private probe observed 95 clock reads in 120 ms before the repair; the authored red case and the disabled-guard control failed as expected, and exact compiled bytes were restored. No new stored state, class, API, dependency or timeout constant.

`/ship` Step 7 coverage audit (read-only child report, retained unchanged at its original 93%, 26/28 paths, two gaps) found C16 (hidden recorded gap released by new selection, renderer replacement or closure without an AbortSignal) and C23 (MCP discovery test setup leaked acquired resources on failure). Generation pass 1 of 2 authored three C16 lifecycle cases in `runtime-browserViewport.test.ts`; root execution: 3/3 PASS (`ack-hidden-gap-lifecycle-green.log`). Root moved the C23 setup inside `try` with nested `finally`; assertions unchanged, 1/1 PASS. A private forced-connect control shows the repaired test closes its one created HTTP server, while disabling the setup guard leaves it open (1 created/0 closed, 4 s timeout); exact compiled bytes restored (`ack-presentation-cleanup-control.json`). Current reassessment: 28/28 assessed paths have behavior tests; this supplements, and does not rewrite, the original report.

Fresh current cut (session host Claude Code, Node 24.21.0, pinned pnpm 12.4.2): full **1,401/1,401 PASS**, zero fail/cancel/skip, 57.04 s runner, including build; package **175/175 PASS**, 7.73 s, started after every extension reader exited; hook 4/4 PASS. Logs `ack-review-final-full.log` (SHA `c29e46f9…`) and `ack-review-final-package.log` (SHA `03861959…`). All nine workspace partitions are included.

Native carry-forward boundary: the f95562ba both-host clips remain bound to their exact cut. The quiet guard changes only the timer frequency while the recording clock is stopped; visible paint timing, consumed budget, ownership and native ordering are unchanged, so those bounded observations carry forward with that explicit limit. No new VSIX, installed candidate or native take exists for this cut. All 13 integrated rows and final stages remain open. Next: local CodeRabbit CLI and OCR on this complete cut, then `/ship`, exact-HEAD review/CI and merge under D039/D043/D044.

Current-cut reviews (host Claude Code): OCR delegate v1.12.11 workspace preview, 9/9 eligible files reviewed, 0 skipped, coverage 100%; 24 default exclusions (10 documents, 14 tests) accounted separately. The two material test changes (C16 lifecycle cases, C23 cleanup) were host-reviewed; the other excluded tests are unchanged since their readiness/ACK OCR receipts. No supported finding. The known accepted boundary stays disclosed: a hidden or collapsed native Variables view reaches the 5,000 ms inspection deadline with Run and Debug guidance. Local CodeRabbit CLI 0.8.2 (`--uncommitted --include-untracked --fresh`, included usage, no credits) completed on all 33 files, exit 0, one minor finding: the README Cycle 0031 sentence still called the quiet guard pending. Corrected. Receipts: `ack-current-cut-ocr-host-review.json`, `ack-current-cut-coderabbit.jsonl`. Host review is not an independent external-provider review; hosted CodeRabbit and Claude Code CLI outside review remain owner-skipped.

### Ship review entry after compaction and soft inspection gate, 2026-10-01

Fresh post-compaction full reads from current disk: PRODUCT_GOAL, the replay/Wiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this complete active cycle and DESIGN. The image tool actually opened the approved PNG; SHA `f189ee82…` matches D036. Observed live app above stopped source beside the native debugger and standard chat with bottom capture/save; replay substitutes Learning summary/sequence at one gap-marked playhead; independent DeepWiki has chapters/article/outline/update/output/citations/Q&A; shortcut strip has keyed tooltips and searchable help. Branch/head remain codex/cycle-0031-replay-transport/ce89dbd with 36 status entries (review fixes included); dashboard `1936e419` retains only existing `.codebook/`; no branch PR; Issues 1/53 open.

`/ship` progress on this host: Step 7 coverage PASS (40/40 paths, 0 gaps after three added and one extended test). Step 8 plan completion PASS (43 items: 42 DONE, 1 CHANGED; scope clean). Step 9 pass 1 dispatched testing, maintainability, security, performance, design and Red Team (data-migration/API out of scope, simplification gated): 3 critical and 16 informational specialist findings, plus the owner-requested `/code-review --fix` (three findings scored ≥80). Design-lite litmus was not applicable; its detector hit a pre-existing reader file unchanged against `origin/main`; the Codex design voice completed with one recovery-copy finding. Exploratory QA smoke passed.

**Design amendment (routine, D032/D043):** the earlier boundary failed a replay moment when native Run and Debug did not retrieve its values within 5,000 ms. Red Team showed this is the common case, not an edge: Variables collapsed or hidden during outline navigation, or another stopped debug session holding native focus, never request values, so ordinary playback would fail. {@link ReplayDebugger.present} now waits at most `REPLAY_DEBUG_INSPECTION_GRACE_MS` (1,000 ms), then commits the recorded moment as `'uninspected'`. Later frames of that stop do not wait again, and inspection once the learner opens Run and Debug turns the next presentation `'inspected'`. {@link StudyWorkspace} shows a visible Study hint naming Run and Debug, the Codebook recorded session in Call Stack and Variables. No values are fabricated, no native pane is forced open and closure/supersession/abort keep their own errors. A learner-stopped session now also clears the owner's selection, so a retried stop is selected again in the restarted adapter. Other fixes: superseded Node-history stops no longer report an error, placement cancellation reports the learner's reason, constants/error strings/JSDoc cleanup.

Proof: red-before-green controls disable each repair in compiled output and fail as expected (7/7), with exact bytes restored. Current cut: full **1,410/1,410**, package **175/175** after every extension reader exited, hook 4/4. QA report: `.gstack/qa-reports/c31-ship-step9-pass1-20261001T000214/qa-report.md` (local, uncommitted). Review log: pass 1 `issues_found` with five informational items explicitly skipped (two bounded 50 ms polls, the performance settle wait deferred with retired presentation work, the hidden-receipt comment-only item and the real 20 s drain bound), completed, not converged, one fix cycle.

Step 7 repeat for the fixes: 16 of 18 changed paths have behavior tests (89%). A recorded-replay workspace test now attaches captured debugger state and proves the Study message flags an uninspected moment and clears it after values load; another proves a still-selected Node stop reports its native failure. Limits at that checkpoint: the webview's rendering of that flag had host review only. That note wrongly said no DOM harness exists; the existing `extension/scripts/study-bootstrap-qa.mjs` Chromium harness now covers it (pass 2 below). No new VSIX, installed candidate or native take exists for this cut. The f95562ba both-host clips carry forward only where native retrieval completed within the grace, as observed; a slower or hidden Variables view now commits with the hint instead of failing, which is not natively verified. All 13 integrated rows and final stages remain open.

Owner direction queued for after this cycle merges: configure ESLint (ts-prefixer), Prettier (code/config only), fallow (health baseline) with husky/lint-staged like `laststance/switch-time`, plus pnpm GitHub Actions CI with Codecov (organization token). It is a separate PR from a separate worktree; it does not change Cycle 0031 scope.

Next: repeat `/ship` Steps 7–8 for the fixes and a fresh Step 9 pass 2, then Steps 10–21 under D039/D043/D044.

### Ship review pass 2 fixes, 2026-10-01

Step 9 pass 2 (fresh review token; diff scope against `origin/main`) dispatched testing, maintainability, security, performance and Red Team; Design ran by parent judgment because the Study copy and markup changed although the frontend scope flag was false. It found 2 critical and 21 informational items. All were fixed except two informational performance items, which are skipped with reasons below.

- **Hidden gap wait (performance, critical).** {@link BrowserViewport.presentMissingNow} polled every 50 ms without limit while the recording document was hidden. It now sleeps until a gap receipt, a visibility change, a new epoch or selection, closure or abort wakes it. A remaining-budget timer runs only while the document is visible. Timers are imported explicitly, like `performance`, so the module also runs in the VM test harness.
- **Hint lost during Play (Red Team, critical).** The hint was keyed on the committed bundle object, and Play ticks inside a sealed pause replace that object without presenting again. It is now keyed on the recorded stop snapshot, and the Run and Debug hint stays until values load.
- **Session-level soft gate (design/performance).** After one moment commits without values, later stops commit at once while native Run and Debug still requests none. They do not wait 1 s per stop. When the adapter reports that the client retrieved a recorded Variables page, waiting resumes and {@link StudyWorkspace} drops the hint without a new seek. An empty gap stack or a scope-less frame proves only that Call Stack is open, so it does not count. An ended owned session also notifies the reader.
- **Red Team informational.** A stop whose presentation was interrupted is recorded as shown right after selection, so retrying it no longer restarts the session. A browser recording opened while a Node stop still loads supersedes that stop without reporting an error.
- **Copy and accessibility.** The hint moved to a dedicated muted `role="status"` region. It shares the session-name constant with the debugger and explains what to do when Call Stack lists several sessions. Saved Node stops show the same hint beside their position. The unused startup visibility field was removed.
- **Skipped.** The 20 Hz Play tick while a hidden recording stays pending is the playback clock itself; pausing on occlusion is a product decision. The hidden placement drain keeps its real 20 s bound (confidence 4).

Proof on the current tree: 11 compiled plus 2 DOM disabled-fix controls; the 11 compiled controls each fail their named tests, with exact bytes restored and SHA-checked. The Chromium DOM control fails the visible-hint case when rendering is disabled. Full **1,420/1,420**; package **175/175** after every extension reader exited; hook 4/4. The DOM harness passes the four new hint cases (replay status shown, cleared and hidden when failed; Node position), and a second DOM control covers the Node text. Its one failing case, wide-sequence page overflow, fails identically on unmodified HEAD `ce89dbd`, so it predates this cut. QA report: `.gstack/qa-reports/c31-ship-step9-pass2-20261001T010103/qa-report.md` (local). Review log pass 2 is persisted with cycles 2, converged false and two informational items skipped. Native behavior of the session-level gate and the hint is NOT RUN; the f95562ba clips keep their earlier carry-forward limit. Next: Step 7/8 repeat for these fixes and Step 9 pass 3 (cap 3), then Steps 10–21.

### Ship review pass 3 fixes (third fix cycle), 2026-10-01

Step 9 pass 3 (fresh review token) dispatched testing, maintainability, security, performance, Design (by judgment) and Red Team. Security returned no findings. The session-level gate from pass 2 did not hold on the real Play path, for two reasons:

- **Codebook's own restart forgot unrequested values (performance, critical; Design confirmed).** {@link StudyWorkspace.presentPlayback} retires the owned session before each different stop. The termination handler then reset the flag and notified the reader, so real Play still waited 1 s per stop and the hint blinked. Codebook's own retirement now keeps the flag and sends no notification; only a learner-ended session clears them.
- **Gap frames counted as loaded values (testing, critical).** A repeated gap frame whose empty stack Call Stack had already fetched returned `'inspected'` and cleared the flag. Now only the adapter's loaded-Variables report clears it.

Further fixes:
- Values that load during the last poll of the grace now commit as inspected, so no stale hint follows the notification.
- Closing the reader abandons a loading Node stop and drops every hint.
- `openRecording` supersedes the Node selection only after its own admission checks.
- Opening another Node history resets its hint flag.
- Node Play no longer counts the native presentation wait as recorded test time.
- The saved Node hint moved into its own muted status row.
- Docs and tests:
  - The timers import is commented, and stale callback examples are corrected.
  - A scope-less adapter test is added.
  - The no-poll test now also counts callback timers.

Proof: 8 compiled plus 1 DOM disabled-fix controls fail their named cases, and exact bytes were restored. Full **1,427/1,427**, package **175/175** after every reader exited, hook 4/4. The DOM harness passes its 4 hint cases; the pre-existing wide-sequence case is unchanged. QA report: `.gstack/qa-reports/` pass 3 directory (local).

This was the third fix cycle, so `/ship` stops here for an owner decision instead of running a fourth. Five judgment items remain open:
- Harness options object and test Value headers.
- Event-driven native inspection wait.
- One-click Show Variables.
- Typed supersession in the Node controller.

Appendix (confidence 4 or lower, not actioned): hint copy order, live-region presence while empty, the grace length on remote hosts, and notification inside the DAP handler. Native behavior of the gate and hint remains NOT RUN.

### Ship owner direction, review-only pass and adversarial review, 2026-10-01

**Owner direction after the pass 3 stop.** The owner chose the recommended option for each open item:
- D1: continue past the three-cycle cap to Steps 10–21 without a fourth fix cycle.
- D2: skip the harness options object and the test Value headers.
- D3: defer the event-driven native inspection wait to the next cycle.
- D4: defer one-click Show Variables and typed supersession in the Node controller to the next cycle.

Later the owner deferred every informational finding from the review-only pass to the next cycle. From then on only critical findings may be fixed, recommended options are accepted, and the workflow continues to merge and the next `/spec` without stopping.

**Step 9 pass 4 (review-only, fresh token).** The reviewed tree was unchanged since pass 3. Results:
- Checklist: 0 findings. Security: 0.
- Testing: 2 informational.
- Maintainability and Design: 1 informational, found by both.
- Performance: 1 informational.
- Red Team: 3 informational.
- Exploratory QA smoke: 8/8 passed.

There were no critical findings. All seven informational items are explicitly skipped. The review record is `issues_found`, completed and converged, with three fix cycles and binding `verified` on `fd59c5eb`. Design-lite is also verified.

**Step 10.** No pull request existed yet, so there were no Greptile comments.

**Step 11.** The diff is 8,805 lines and Codex was ready.
- **Claude adversarial review:** completed with 0 critical and 6 informational findings, all skipped. Its record is verified on `fd59c5eb`.
- **Codex adversarial challenge:** completed with one P3 finding, skipped.
- **Codex structured review, attempt 1:** ended with a Japanese free-text no-findings conclusion.
- **Codex structured review, attempt 2:** was forced to English and ended with "No actionable regressions were identified…".
- Both structured attempts lack the severity or no-findings markers the result validator requires. They are therefore recorded as missing coverage, not as a pass. Neither reported a P1.

**Step 11.5.** The final Step 9 record and the native adversarial record both bind to reviewed tree `fd59c5eb`.

**Release.** The patch bump follows this project's per-cycle convention and the queue is clean. VERSION, the manifest, {@link EXTENSION_VERSION}, the package-test expectation and the extension README VSIX name now read 0.2.15. Native behavior of the soft inspection gate and its hint remains NOT RUN.

**Deferred review backlog for the next cycle.** None of these is critical; each is a candidate for the next `/spec`.

Replay hint and native inspection:
- A replay moment can show a hint it can never clear:
  - The stop is scope-less (Codex P3).
  - The top recorded frame lacks captured source while VS Code shows a caller's Variables (Claude).
- `selectedNodeHistoryDebugAvailable` is not reset when the session ends or the reader closes, so both stop buttons stay disabled.
- `openRecording` during an in-flight Node Play stop leaves:
  - the Node controller's selected index out of step with the selection;
  - a stale Node hint.
- A Node Play tick during `close()` can set the hint again after reopening.
- A throwing adapter selection leaves `ReplayDebugger.selected` stale, so the next visit keeps Run and Debug empty.
- `inspected()` runs inside the adapter's request `try`; a failing callback can send a second DAP response.
- The 1 s grace is measured from selection. Browser replay restarts the session for every stop, so on a slow host each stop may overrun it; measure this and consider starting the grace at `configurationDone`.
- Event-driven native inspection wait (D3), one-click Show Variables (D4) and typed Node supersession (D4).

Hidden recording waits:
- Hidden-recording waits no longer expire.
- `playback.settle()` ignores the transition signal, so a presentation change can stay busy until the window is visible. Decide the intended bound.

Tests:
- The viewport tests include about 30 s of real sleeps.
- No test covers:
  - the panel-dispose gap wake;
  - the replay close reset.
- `test:package` concurrency 4 may be flaky on small CI runners.

## Delivery closure, 2026-10-01

**Final checks.** Final commits `de92f0c`, `68a1a25`, `af14b84` and `369884e` preserve the Step 16 content tree `3f0c858d`. Against the reviewed tree `fd59c5eb`, only authored docs and version strings changed. Results:
- Build passed.
- Full suite:
  - First run: 1,426/1,427. The one intermittent failure is the pre-existing race described below.
  - Rerun: 1,427/1,427.
- Package: 175/175, run after every extension reader exited.
- Hook: 4/4.
- Chromium DOM harness: 54/55. The one failure is the wide-sequence case, which also fails on `ce89dbd`.

**Intermittent failure.** `a missing explicit replay-focus receipt rejects once…` threw `EVIDENCE_UNAVAILABLE` from a background refresh checkpoint once, under full parallel load. Its test body and harness path match `main`, and the failing code path (`captureStudy`, `resources.ts`) is unchanged. It passed:
- 6/6 isolated runs;
- 16 parallel single-test runs;
- 18 parallel whole-partition runs.

A fix needs a production change, and the owner's direction excludes a fourth fix cycle for a non-critical item. It is the next cycle's P0: a background checkpoint racing live runtime release.

**Documentation.** The ship-owned documentation audit returned `updated` and its hashes held through the final commits.

**PR #54.** The PR was opened Ready and its body carries the DOM-harness screenshot of the hint. An `@codex review` on exact HEAD `369884e1a1` returned 2 [P2] and 1 [P3], and no P1. All three duplicate backlog items above; each thread was answered and resolved. Required checks passed on `369884e`: package, plus both Socket checks.

**Merge.** The read-only exact-HEAD gate passed on:
- OPEN, MERGEABLE, CLEAN;
- the same HEAD locally, remotely and in the PR;
- an unchanged base `ce89dbd`;
- zero unresolved threads.

A separate call then squash-merged PR #54 at 20:45:49 UTC as `58f2fa6065a9dcaa277cef5a6537d85703030381`. The merged tree is byte-identical to the verified candidate. Post-merge main CI run 36774901521 succeeded on that SHA.

**Package.** The checked private VSIX is `artifacts/packages/codebook-0.2.15.vsix`:
- SHA `367723e22149d7066cf9b18ecb97ea76319ce58c285294d1acc3c8d3303a7486`;
- clean revision `58f2fa6`;
- sourceHash `3b2749e2a03b8de05c95bb1bfc6ea23ce2f40c23d7cc2d4b0a6aa515eef35342`;
- 29 entries;
- independent checker exit 0.

It is not installed, published or natively verified.

**Open items.** Issue #53 closes with this record; Goal #1 stays open. All thirteen integrated and final AC rows remain open.

**Next.** Plan Cycle 0032 through `/spec` from the updated gap ledger. Its candidates:
- the deferred review backlog above;
- the intermittent checkpoint race (P0);
- native verification of the soft gate;
- Cursor automatic summary placement and density;
- reader recovery and accessibility.

After that come the owner's queued lint, format and CI tooling PR, and final acceptance.
