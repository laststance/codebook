# codebook agent instructions

## Mandatory entry

Before implementation or runtime trials, complete this sequence at each new session, after context compaction and after a controlling specification changes:

1. Read **in full** [PRODUCT_GOAL.md](PRODUCT_GOAL.md) and its normative [replay](docs/specs/learning-replay.md), [DeepWiki](docs/specs/llm-wiki.md) and [shortcut](docs/specs/keyboard-shortcuts.md) contracts.
2. Read **in full** [IMPLEMENTATION.md](IMPLEMENTATION.md), [PROJECT_STATE.md](PROJECT_STATE.md), its active cycle and [DESIGN.md](DESIGN.md). Verify the actual branch, dirty files, tools and relevant runtime/PR state.
3. **Open [the approved PNG](docs/designs/assets/codebook-product-spec-v9.png) with an image-viewing tool. This is the product to build.** Match DESIGN.md's identity; record observed live, replay, DeepWiki and shortcut regions. Reading a filename, prompt or alt text does not count.
4. Follow IMPLEMENTATION.md's **gap audit → selected increment → proof → updated gaps** loop. Record entry evidence in the cycle. Missing reads, visual inspection or required gap analysis keep the implementation-entry gate incomplete; continue independent preparation and report the missing item.

Reading is preparation. Reconcile every acceptance row with current source and evidence as required by the gap audit. Each selected increment must name the gap it closes, the source to change and an observable verification procedure. At closure, update affected rows with expected/actual results and the next action. Unperformed work stays unverified.


## Load when taking the branch

| Work | Read before acting |
| --- | --- |
| Select/start/close a cycle; choose skills; review or deliver changes | [DEVELOPMENT.md](DEVELOPMENT.md), controlling [DECISIONS.md](DECISIONS.md) entries |
| Live/capture/replay, runtime, storage, evidence ownership or cross-feature architecture | [Behavioral design](docs/designs/codebook.md) |
| Shared skill or onboarding | [Bundled skill contract](docs/plans/bundled-codebook-skill.md) |
| Wiki generation/update | [Generation skill contract](docs/plans/deepwiki-generation-skill.md) |
| UI implementation or visual verification | [GStack state/interaction review](docs/plans/cycle-0029-product-design.md) |
| Native editor video / motion evidence | [OBS window-recording procedure](docs/qa/native-recording.md) |
| Test execution / performance | [Parallel test and package ordering](docs/qa/test-execution.md) |
| Final acceptance | Full [protocol](docs/acceptance/FINAL_REVIEW.md) and [fixed nine-project matrix](docs/acceptance/ACCEPTANCE_MATRIX.md) |

Historical cycles, generation prompts and external references are evidence consulted when needed, not recursive mandatory reads. Local requirements and the next action must be recoverable without Issues or this chat.

## Authority and completion

- PRODUCT_GOAL owns outcomes; its feature contracts own details; DESIGN owns the approved visual target; PROJECT_STATE owns current gaps; the active cycle owns the bounded plan/results. DECISIONS records durable changes. Later explicit owner direction takes precedence; record its effect.
- Preserve all active goals while selecting one increment. Change accepted behavior only on explicit owner direction. Routine implementation choices within the authorized phase need no repeated permission. An open gap does not authorize leaving that phase.
- Keep VS Code and Cursor evidence separate. Use the designated dashboard for development and the fixed nine-project protocol for final acceptance. Preserve runtime/library coverage and stage order; fixture or development passes earn no acceptance credit.
- Complete the authorized cycle, update records and recommend one next action. Continue further cycles only within owner authorization. These instructions do not create background jobs, separate tasks or automations.
- Require mapped evidence and a current image comparison for changed UI before declaring work review-complete. Keep implementation, live validation, review, merge, packaging, publication, installed verification and owner acceptance distinct. Missing required checks prevent completion claims.
- Preserve other people's edits and existing skills/settings/learning. Keep private recordings and sensitive runtime data outside public changes; link sanitized evidence with stable locations and source identities.

## External validation targets

Never embed a demonstration or validation application in the extension, its runtime dependencies, build graph, commands, or VSIX. Open the owner-designated real repository as an external workspace. Keep isolated unit-test data outside production imports and package assets. Packaging must reject application fixtures or experiment dependencies.

## Working conventions

- Japanese chat; English code, comments and documents except quoted user requests.
- Use Context7 for third-party library/API documentation and Serena symbols for substantial codebase understanding/refactoring when available.
- Before TypeScript work, read `/Users/ryotamurakami/.claude/rules/ts-rules.md`; for React also read `/Users/ryotamurakami/.claude/rules/react-rules.md`.
- Check for existing utilities, hooks, components and types before adding them. Reusable functions/classes need concise purpose/trigger/caller documentation and an example; reference workspace symbols with JSDoc links. Explain non-obvious branches/loops briefly.
- Prefer DAMP behavior tests, hard-coded expectations, Arrange/Act/Assert and `test`; use `toBeVisible` for displayed UI. Verify motion through recorded interaction and inspected frames.
- Follow [test execution boundaries](docs/qa/test-execution.md): independent files run in isolated parallel processes; build before readers and wait for every extension test/shard before package cleanup. Focused workspace runs include all `studyWorkspace*.test.js` partitions.
- For native macOS QA, follow the [tested OBS Window Capture procedure](docs/qa/native-recording.md): exact owned window, silent audio setup, full-frame transform check, changing-content preflight, video and inspected frames. Do not use QuickTime/Screenshot for this workflow or require an exclusive foreground hold. A working recorder does not prove that native input reached its target.
