# Implement the Codebook product

This is the local execution guide reached from AGENTS.md. Use it to turn the accepted product into working behavior. GitHub issues mirror this guide and the linked contracts; the next action must be recoverable from this checkout alone.

## 1. Establish the current assignment

Read [PRODUCT_GOAL.md](PRODUCT_GOAL.md), the **Current assignment** and **Current acceptance authority and gaps** in [PROJECT_STATE.md](PROJECT_STATE.md), and its active cycle. Verify the branch, dirty files and relevant runtime state. Preserve existing work. Read [DEVELOPMENT.md](DEVELOPMENT.md) for cycle and delivery rules.

**Done when:** you can name the active cycle, authorized phase, next observable outcome, relevant goal/check IDs and missing proof. An open implementation gap is not authorization to bypass the active phase. Once implementation is authorized, carry the selected work through its checks and state update; routine choices within that scope need no repeated product approval.

AGENTS.md's mandatory reading list is the entry gate. Record the actual files/sections read, full-read completion and image inspection before source changes. Summaries alone do not substitute for required full contracts. Load the relevant extra contract when taking its branch; historical/reference links do not create an unbounded recursive reading task. This is a procedural gate with a reviewable receipt, not a claim that Markdown can mechanically detect whether an agent understood an image.

## 2. Open and visually inspect the product target

1. Read [DESIGN.md](DESIGN.md), [the visual-target record](docs/designs/visual-target.json) and [the image companion](docs/designs/codebook-product-spec-v9.md).
2. **Open the actual PNG with an image-viewing tool and inspect its pixels:** [Codebook product specification v9](docs/designs/assets/codebook-product-spec-v9.png). Reading its filename, alt text, prompt or metadata does not satisfy this step. Use the repository-relative path from the record so a different checkout works too.
3. Identify the four regions: live native chat/app/source/debugger; replay with synchronized recorded state and summary replacing chat; independent DeepWiki; shortcut tooltip/list. Read the matching feature contract before changing that feature.
4. Record the file, SHA-256, approval status, image-viewing action and concrete observed layout in the active cycle using [the evidence template](#evidence-template). Repeat after the target changes or a new session lacks the inspected image context.

**This is the product to build.** Match its approved hierarchy and interactions while using each editor's real native surfaces. The companion distinguishes required behavior from illustrative sample values and host chrome. A candidate's whole-image approval stays pending until the owner explicitly adopts it; individually accepted behavior remains authoritative. If the image cannot be opened, report that exact limitation and continue independent nonvisual work without claiming visual inspection.

**Done when:** the cycle contains actual visual observations and the image identity, with any mismatch against the written contract identified. If there is a conflict, apply the latest explicit owner decision and record the discrepancy before changing the target; do not silently simplify the feature.

## 3. Select one observable increment

Read [the product acceptance map](#product-acceptance-map). It covers every active goal and links the full local specifications. Compare the relevant row with current source and evidence in PROJECT_STATE.md. Historical passes are useful starting evidence, not proof of the revised product.

Continue the active cycle's selected outcome. For an authorized implementation phase, select the smallest missing end-to-end behavior or the bounded experiment that resolves its main blocker. Write the user's starting action, expected visible result, required failure behavior and proof procedure in [the cycle template](docs/cycles/TEMPLATE.md) before editing. Use existing modules and the actual package scripts; inspect them rather than inventing commands. Record source/host/runtime constraints. Select GStack review by the change using DEVELOPMENT.md.

**Done when:** the active cycle has one observable target, acceptance-map IDs, expected observations, a concrete procedure and a next action. Keep other gaps in the local map/state. A flat acceptance inventory is not a schedule for implementing the whole product in one change.

## 4. Implement and verify the selected behavior

- Complete the path from the user's normal entry to its result, including the specified unavailable/error states and preservation of their work.
- Use mechanism tests for changed logic. For actual-editor development trials before final acceptance, open **`/Users/ryotamurakami/repository/nextjs-dashboard`** and preserve its source/settings. Notify the owner before occupying the desktop. Keep VS Code and Cursor evidence separate.
- Use the ordinary expanded desktop window at normal/default zoom (D034). Check native themes, focus and keyboard behavior. Apply [the shortcut contract](docs/specs/keyboard-shortcuts.md) whenever adding or changing a shortcut or control.
- For UI work, open the product PNG again and compare the actual host screenshot with the relevant region. Check function and hierarchy; generated mockups and host-renderer assertions do not establish installed native pixels. Verify motion through recorded interaction and inspected frames.
- Capture source/candidate identity, exact actions, expected/actual outcomes and artifact locations using the evidence template. Record unavailable checks as NOT RUN, failures as FAIL and incomplete coverage as PARTIAL.

**Done when:** the selected expected observations have evidence at their declared level, or a falsified/inconclusive approach is documented with a changed next hypothesis. Build success alone does not finish a live/replay/Wiki outcome.

## 5. Update the local handoff and deliver

Update the active cycle and PROJECT_STATE.md with what changed, what passed, what failed, remaining acceptance IDs and **one exact next action**. Record changed product decisions only when directed by the owner. Keep goal, feature contracts, image identity/status and acceptance map consistent. Link evidence; preserve historical results with their source cut.

Follow DEVELOPMENT.md for current-change review, PR/CI and authorized delivery. Mirror the committed local outcome and remaining work to Issues #1 and the cycle issue. An unavailable or stale issue does not erase local instructions or block otherwise authorized local progress; record pending synchronization. Keep the goal issue open until final acceptance and owner acceptance.

**Done when:** a fresh agent following AGENTS.md can identify the target image, current phase, proven/unproven behavior and executable next step without this chat or an issue body. Report implementation, validation, review, merge, packaging, publication and installed verification separately.

## 6. Apply final acceptance when the complete candidate is ready

Use [FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) and [the fixed nine-project matrix](docs/acceptance/ACCEPTANCE_MATRIX.md). First the main agent completes Stage 1 for all projects, both hosts and applicable use cases. Only then run the nine independent project evaluators in Stage 2 under that protocol. Preserve library tests and Examples, Node and Chrome Extension coverage, exact candidate/skill/setup identities, failures and required retests. The dashboard development target earns no matrix credit.

**Product done means:** every active goal and required assessment is supported for the final fixed packaged candidate, required confidence is met, and owner acceptance is recorded. A completed cycle, task list, image, test suite or PR is one piece of that result.

## Product acceptance map

Authority: [PRODUCT_GOAL version 9](PRODUCT_GOAL.md), D029–D035 and the linked feature contracts. This is a complete local navigation/check inventory for the active goals, not evidence that they pass. G08/G09 are retired IDs. Current proof and the next selected work live in [PROJECT_STATE.md](PROJECT_STATE.md) and its active cycle.

Before each affected implementation, read the row's local contract and visually inspect [the product image](docs/designs/assets/codebook-product-spec-v9.png) through [IMPLEMENTATION.md](IMPLEMENTATION.md). Reconcile this map whenever an accepted contract changes. Where a row summarizes a requirement, the linked authority supplies its full details.

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

### How to record progress

For each selected row, record separate **VS Code**, **Cursor** and, where applicable, **independent browser** observations in the active cycle. Use NOT RUN / PARTIAL / FAIL / PASS for each observation with its candidate/source identity and evidence link. A PASS applies only to that procedure, host, revision and validation level. This map stays an inventory; its absence of checkmarks prevents plans from looking like shipped behavior.

Before claiming product completion, the final protocol must cover every row's applicable behavior plus all project-specific mappings. One host, one runtime, one successful negative control or one development repository never fills another required assessment. Keep Stage 1, Stage 2 and owner acceptance separate.

## Evidence template

Copy the relevant sections into the active cycle or a linked sanitized evidence manifest. Replace placeholders with observed facts; use **NOT RUN** where appropriate. Keep large/private recordings in durable private storage and record sanitized paths, hashes, source identity and availability. A command listed here is not evidence that it ran.

### Assignment and visual inspection

- Cycle / authorized phase:
- Product goal version / selected acceptance-map IDs:
- Source branch / commit / dirty files:
- Next observable outcome:
- Visual-target PNG path / SHA-256 / approval status:
- Image-viewing tool/action actually used:
- Observed live-screen relationship:
- Observed replay relationship and historical-state controls:
- Observed independent DeepWiki relationship:
- Observed shortcut tooltip/list:
- Relevant required differences from the current implementation:
- Written/visual conflict, if any, and controlling owner decision:

### One observation per host, candidate and validation level

| Field | Observation |
| --- | --- |
| Acceptance-map ID / exact behavior | |
| Level | mechanism test / development native trial / Stage 1 / Stage 2 / visual check |
| Editor/browser, version and standard chat/model used | |
| Source commit / dirty state / VSIX, skill and setup identities | |
| Real target repository / revision / runtime / use case | |
| Display/window/zoom/theme | |
| Exact user action and procedure | |
| Expected result, frozen before execution | |
| Actual result | |
| Result | NOT RUN / PARTIAL / FAIL / PASS |
| Artifact location / checksum / availability | |
| Source/execution/capture/recording identity, where relevant | |
| Visual comparison to target region / differences | |
| Motion recording and inspected frames, where relevant | |
| Preserved files/settings/work and cleanup | |
| What this evidence does not establish | |

### Handoff

- Requirements advanced and remaining gaps:
- Changed hypothesis after a failed/inconclusive attempt:
- Current-source review / CI / merge / package / publication / installed proof (separate):
- Exact next executable action and required input, if any:
- Updated active cycle and PROJECT_STATE.md:
- Issue synchronization status:
