# Implement the Codebook product

Follow this loop after [AGENTS.md](AGENTS.md)'s mandatory reads and actual image inspection:

**Goal + visual target → current-source gap audit → one observable increment → implementation and proof → updated gaps.**

Compaction recovery: [.codex/hooks.json](.codex/hooks.json) registers only `SessionStart` with `^compact$`. Its [command](.codex/restore-product-context.mjs) injects the current AGENTS.md and requires its full document reads, active-cycle lookup and actual PNG inspection again before implementation/trials. It supplies instructions, not proof of reading or comprehension. Review/trust this definition through Codex `/hooks` on each installation; changed definitions require renewed trust. Disable that individual hook there if recovery is needed. Verify locally with `node --test .codex/restore-product-context.test.mjs`. [Official lifecycle and trust contract](https://learn.chatgpt.com/docs/hooks).

## 1. Audit gaps before selecting work

Use [PROJECT_STATE.md](PROJECT_STATE.md)'s gap table as the current ledger. At a new cycle, changed goal/design, or source change without an impact assessment, reconcile **every row** of [the acceptance map](#product-acceptance-map). On other resumes, verify the baseline identity and changed paths, then inspect every affected row; justify carry-forward for the rest. A docs-only commit may retain an unchanged product-source baseline explicitly.

For each row, inspect its actual source entry/symbol and available evidence. Record:

- **Implementation:** matching behavior, a concrete mismatch/missing behavior, or UNKNOWN with the next source inspection. A file/symbol's existence alone cannot establish behavior.
- **Proof:** result, host, source/candidate identity, validation level and evidence link. Absent/stale proof remains unverified. A source mismatch and missing runtime evidence are different gaps.
- **Next action:** the source change or bounded experiment needed, with the observation that will verify it. UNKNOWN becomes an investigation; it cannot be treated as implemented or absent.

**Gate:** every row is accounted for, no active goal is omitted, and the cycle records the baseline and affected IDs. A read receipt, goal-link inventory or old PASS cannot satisfy this audit. PROJECT_STATE holds the latest assessment; closed cycles retain supporting history.

## 2. Select the increment from those gaps

Continue the active cycle's authorized phase. Within an implementation phase, choose the smallest connected user behavior that closes an identified gap, or investigate the highest-impact unknown blocking it. Prefer core-experience blockers over polishing a proven layer. Keep planning bounded to that increment.

Before editing, record in the cycle:

1. Primary AC ID and dependency/regression IDs; current source/evidence gap and why it matters now.
2. User starting action → expected result, required failure behavior, source modules to change and falsifying observation.
3. Exact verification procedure, target/host and required evidence level; freeze expectations before execution.

**Gate:** the selected action follows from the audit and has a checkable outcome. An open product gap does not override a documentation-only assignment. Load applicable contracts through AGENTS.md; select skills/delivery rules through [DEVELOPMENT.md](DEVELOPMENT.md).

## 3. Implement and prove the outcome

Complete the normal user entry through its result, including specified recovery and preservation. Reuse existing modules and actual package scripts. Use focused mechanism tests for changed logic and the declared native checks for product claims.

Before final acceptance, actual-editor development trials use **`/Users/ryotamurakami/repository/nextjs-dashboard`**. Recheck its revision/dirty state, preserve its work and notify the owner before occupying the desktop. Keep VS Code, Cursor and independent browser evidence separate. Dashboard development cannot fill final acceptance rows.

For UI changes, view the approved PNG again and compare real screenshots with its relevant region at the normal desktop baseline. Record differences and interaction. Verify motion with video and inspected frames; generated pixels or renderer assertions cannot establish native behavior.

Acquire native macOS editor video through [the OBS Window Capture procedure](docs/qa/native-recording.md). Its window-identity, full-frame and changing-content preflight are prerequisites to using a clip as evidence. Recorder success and native-input/product success retain separate outcomes.

**Gate:** expected/actual evidence supports the outcome at its declared level. Use NOT RUN / PARTIAL / FAIL / PASS for observations. Failed/inconclusive experiments record a changed next hypothesis without verifying the missing capability. Build success alone cannot complete a live/replay/Wiki outcome.

## 4. Reassess before closure

Reconcile every changed/dependent AC row against new source and evidence, including regressions. Preserve unaffected evidence only with a source/behavior impact rationale. Compare before/after gaps; retain missing implementation, missing proof and UNKNOWN. No status advances because a checkbox, skill, image or PR is complete.

Update the cycle and PROJECT_STATE with results and **one executable next action**. Check that the route still reaches every active goal and the next candidate addresses the largest remaining blocker. Follow DEVELOPMENT.md for reviews, authorized delivery and issue mirrors; unavailable tracking leaves a pending sync, not missing local instructions.

**Closure gate:** a fresh agent can recover the accepted product, concrete code gaps, actual proof, authorized phase and next step locally. All affected rows, required checks and UI comparisons are recorded. Markdown supplies an auditable procedure; it cannot mechanically prove comprehension.

Final completion requires the full [protocol](docs/acceptance/FINAL_REVIEW.md), [fixed nine-project matrix](docs/acceptance/ACCEPTANCE_MATRIX.md) and owner acceptance. Stage 1 precedes nine Stage 2 evaluators; preserve both hosts, runtime/library coverage, failures, candidate identity and required retests.

## Product acceptance map

This inventory covers G01–G07 and G10–G12 under [goal version 9](PRODUCT_GOAL.md); G08/G09 are retired. Linked contracts control details. The map defines outcomes; [PROJECT_STATE.md](PROJECT_STATE.md#current-product-gaps) records implementation/proof/next actions. Keep all 13 rows when updating either document.

### Observable completion checks

| Check ID / goals | User-visible outcome to implement and verify | Required failure / preservation checks | Local contract / image region |
| --- | --- | --- | --- |
| AC-LIVE — G01, G03, G06, G11, G12 | A natural `/codebook` request in ordinary Copilot Chat and Cursor Agent drives a real project path: app/runtime operation, meaningful actual source stops, grounded explanation, continuation and observed result. Native source/debugger remain usable beside the application. | Wrong/background target, stale pause, manual resume, unavailable connection and missing causal links remain explicit. Distinguish observation, inference and unknowns; a line before a request is not proof that it was sent. | [Goal: defining experience](PRODUCT_GOAL.md#defining-live-to-learning-experience), [runtime ownership](docs/designs/codebook.md#architecture-and-evidence-ownership); image 1 |
| AC-SAVE — G04, G05, G07, G11 | Bottom capture status and Save learning replay save the explained session with recording, source/history identity, explanations, processing summary and sequence diagram. Saved items open through Codebook's learning library. | Empty/loading/finalizing/failure/partial states are truthful; failed saves do not claim durable completion. Existing saved material and manual edits survive. Saving does not mark understanding. | [Replay contract](docs/specs/learning-replay.md), [review state table](docs/plans/cycle-0029-product-design.md#pass-2--interaction-states-complete); image 1 bottom and image 2 |
| AC-REPLAY — G03, G04, G06, G07, G11 | After the original app/debugger/chat exits, repeat playback, step and seek backward/forward. Video, the source executing then and inspectable historical native-debugger values/scopes/stack identify the same moment. Learning summary replaces the live chat area. | No repeated target side effects; no current source/values substituted for history; source drift is visible. Preserve the selected moment during summary collapse/reopen (5A). A video-plus-document reader does not satisfy this row. | [Replay contract](docs/specs/learning-replay.md), D032/D034; image 2 |
| AC-GAPS — G03, G04 | Available video continues across an uncaptured source/debugger interval. Timeline identifies the gap; affected views show **Not recorded at this moment**. The correct state returns at the next recorded point. | Direct seeking and repeated traversal clear another moment's highlight/values/stack. Required positive-flow history gaps still fail acceptance; the negative-control pass only proves truthful handling. | [Replay contract](docs/specs/learning-replay.md), accepted 4A; image 2 timeline/caption |
| AC-LEARNING — G05 | Learner understanding/progress decisions survive reopening independently of execution success. Summary and sequence explain the saved logic, with source references and return to the reading context. | AI execution, successful save and Wiki update never auto-mark understanding or rewrite past learning. Source changes indicate review without erasing history. | [Replay contract](docs/specs/learning-replay.md); image 2 summary |
| AC-WIKI — G02, G06, G11, G12 | Reproduce DeepWiki itself: meaningful chapters, architecture/module/process articles, diagrams, relevant-source/inline citations, chapter/outline navigation and source-grounded repository Q&A. The editor AI generates this through the shared generation skill. | Prove generation/update with runtime/debug MCP unavailable. Wiki needs no live execution or replay; saved pages remain readable after editor/agent exit. An outline, stub Q&A or generic Markdown viewer cannot pass. | [Wiki contract](docs/specs/llm-wiki.md), [generation skill](docs/plans/deepwiki-generation-skill.md); image 3 |
| AC-WIKI-UPDATE — G02, G11 | Default output is within the project; settings can change it. Chat update and browser **Update LLM Wiki** invoke the same generation procedure in the correct editor without prompt re-entry. Show source/index identity, freshness and result. | Interrupted/failed update retains the last usable site and unrelated/manual files. Source changes disclose staleness. Normal reading does not require a running editor/debugger. | [Wiki contract](docs/specs/llm-wiki.md), [generation skill](docs/plans/deepwiki-generation-skill.md); image 3 update/output |
| AC-SOURCE-LINKS — G02, G03, G11 | Wiki citations open the correct repository, file and location in the local editor being used. Replay citations retain their recorded-source context. Reading return restores the originating location. | Missing/moved files, wrong checkout/editor and source drift get truthful recovery. Reading remains usable if opening the editor fails. | [Wiki contract](docs/specs/llm-wiki.md), [behavioral design](docs/designs/codebook.md); image 2/3 source references |
| AC-ENTRY — G07, G11 | Left Codebook Activity Bar icon exposes feature navigation: learning library/replay and independent Wiki. One coherent design includes these distinct screens. Native chat/source/debugger remain native. | Preserve unrelated editor groups, focus and reading state. Remove old theme-selection/product flows and duplicate Codebook runtime-value UI while preserving recorded native value inspection. | [Behavioral design](docs/designs/codebook.md), [review](docs/plans/cycle-0029-product-design.md); images 1–3 |
| AC-DESKTOP — G07, G11 | At ordinary expanded desktop/default zoom in both hosts and Wiki browser, controls/text are usable; focus, keyboard, themes/contrast and reduced-motion behavior are verified. Summary collapse/open retains learning context. | No required extreme-small-window or 200% test. Record actual host/display/window/theme/zoom. Visual comparison and motion evidence apply to real UI; the PNG is the target, not the test result. | D034, [design entry](DESIGN.md), [final review](docs/acceptance/FINAL_REVIEW.md) |
| AC-SHORTCUTS — G07, G11 | Every assigned Codebook shortcut is shown in its action tooltip. **?** opens a discoverable searchable shortcut list showing actual action/context/platform keys; it is keyboard-usable and restores focus on close. | Preserve `?` entry in text/chat/source/terminal/IME; native keys retain behavior. Tooltips/list/bindings agree; help does not change replay time. Independent Wiki follows the same rule. | [Shortcut contract](docs/specs/keyboard-shortcuts.md), D035; bottom shortcut strip |
| AC-SKILL — G06, G11, G12 | One thin versioned bundled `codebook` skill is discoverable and explicitly invoked in both standard chats through ordinary setup. Verify the actual loaded body, correct live/replay connection, AI-owned results and restart/reconnection. Wiki routes to shared generation guidance before runtime status checks. | Preserve existing same-name skills and later manual edits through conflict, owned update/removal/restoration. Packaging/discovery/loaded guidance alone is not workflow success. No repository answer key or hidden assistance. | [Bundled skill contract](docs/plans/bundled-codebook-skill.md), [goal onboarding](PRODUCT_GOAL.md#bundled-thin-skill-and-explicit-chat-entry) |
| AC-REAL-PROJECTS — G10, G11 | Remove the active cart project, packaged copies/assets and entry points. Use the exact owner-designated dashboard for development; execute the fixed nine projects and both hosts at final acceptance, including every applicable runtime, library tests and Examples. | Inspect final VSIX contents. Preserve historical evidence and unrelated projects. Isolated test inputs cannot replace real-project trials; dashboard development results cannot fill final rows. | [Development target](DEVELOPMENT.md#required-development-target-before-acceptance), [final protocol](docs/acceptance/FINAL_REVIEW.md), [nine projects](docs/acceptance/ACCEPTANCE_MATRIX.md) |

## Evidence template

Use [the cycle template](docs/cycles/TEMPLATE.md); fill these fields in the cycle or a linked sanitized manifest. Store private artifacts durably. Missing artifacts make their claims need revalidation; a listed command is not execution evidence.

**Entry:** cycle/authorized phase; goal version; full reads completed; branch/commit/dirty paths; PNG path/hash/approval and actual viewing action; observed live/replay/Wiki/shortcut relationships; written/visual conflicts and controlling decision; gap-audit source identity, affected/all IDs and carry-forward rationale.

**Selected increment:** primary/dependency AC IDs; current symbols/behavior and separate proof gap; next change/experiment; frozen starting action, expected result, failure behavior and procedure.

**One observation per host/candidate/level:** AC behavior; mechanism/development-native/Stage 1/Stage 2/visual level; host/version/chat/model; source/dirty/VSIX/skill/setup identity; target revision/runtime/use case; display/window/zoom/theme; exact action, expected/actual result and NOT RUN/PARTIAL/FAIL/PASS; artifact path/hash/availability; source/execution/capture/recording correspondence; image comparison and motion frames; preserved work/cleanup; limits.

**Handoff:** before/after affected gaps and regressions; changed hypothesis on failure; separate review/CI/merge/package/publication/installed status; exact next action/prerequisite; cycle/state updated; issue synchronization status.
