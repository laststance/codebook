# Cycle 0044 — Update LLM Wiki ends with a visible result in both hosts, and every carried defect is fixed

Type: product-increment with the carried defects of Cycles 0031 to 0043\
Status: implementing\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/83 \
Goal issue: https://github.com/laststance/codebook/issues/1 \
Goal links: G02, G11 (increment); G01, G03, G04, G05, G07, G11, G12 (carried defects)\
Source state: [Cycle 0043 result and decision](0043-next-line-binding.md#result-and-decision), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:

- The goal of 2026-10-03: "Codebookを完成させてください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください". Every decision point takes the recommended option and this record names it.
- The cycle rule of 2026-10-03 ([AGENTS.md](../../AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle), [DEVELOPMENT.md](../../DEVELOPMENT.md#carried-defects-in-the-skills)): this is the first cycle under it. The increment was planned from the goal and the gap audit alone; every defect the earlier cycles left is a task here, none selected, none dropped.
- Standing owner direction in [DEVELOPMENT.md](../../DEVELOPMENT.md): VS Code trials use Copilot Chat Auto (Codex Extension only after observed credit exhaustion); Cursor trials use Composer 2.5 with Fast off; local CodeRabbit never with `--use-credits`.

## Question and authorized scope

When a learner presses **Update LLM Wiki** (browser button, `/update` link or command), can they see the update run, its result and its failure, in both VS Code and Cursor, with the last usable site kept on failure, cancellation or timeout?

Why now: AC-WIKI-UPDATE's open gap in PROJECT_STATE is exactly "Browser-button generation/failure/cancellation/manual-conflict flows and configured output relocation remain open". The VS Code path only opens the chat and returns (`extension/src/extension.ts`, `updateDeepWiki`); the Cursor path verifies its result in the extension but the browser page never learns it; the page script (`extension/src/deepWikiReader.ts`) knows only the freshness labels. The wiki contract requires "Show progress and a clear result" (`docs/specs/llm-wiki.md`, Generation and update flow).

## Hypothesis and scope

- Hypothesis: one extension-owned update-run state, fed by a manifest watch for VS Code and by the CLI run for Cursor and served at `api/update-status`, lets the page show running, succeeded, failed, cancelled, timed-out, already-current and conflict results without a chat API.
- Smallest observable outcome: Issue #83 Part 1, acceptance criteria 1 to 9.
- In scope: Part 1 (the increment) and Part 2 ([the 440 carried rows](0044-carried-defects.md)).
- Out of scope (still in PRODUCT_GOAL): generation quality and the shared skill, automatic background regeneration, final acceptance.
- Conditions that falsify the approach: a published site that is not complete when a run ends in any state; a result the page shows that the manifest does not support.

## Plan and selected skills

Order: record → Part 1 (mechanism tests, then native checks in both hosts) → Part 2 in groups, each closed by a test that fails without the fix or by recorded evidence → local reviews → `/ship`, CI, the separate exact-HEAD gate, merge, closure.

- `/plan-eng-review` and `/plan-devex-review` for Part 1 (state machine, `api/update-status` contract, the text an agent or learner reads). `/plan-design-review`: the page gains states in the existing right-rail region; it compares against region 3 of the approved PNG.
- Local CodeRabbit CLI is NOT RUN while the owner has not run `coderabbit auth login`; `open-code-review-delegate` runs.
- Authority for delivery: D039/D044 as restated in DEVELOPMENT.md (review, PR through `/ship`, CI, separate gate, merge in its own step).

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-WIKI-UPDATE. Dependency: AC-WIKI (reader), AC-SOURCE-LINKS (update link scheme), AC-DESKTOP. Regression: every other row (full suite). Part 2 touches AC-LIVE, AC-SAVE, AC-REPLAY, AC-GAPS, AC-LEARNING, AC-ENTRY, AC-SKILL, AC-SHORTCUTS and AC-DESKTOP rows through its labels.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa` (verified 2026-10-03), owner-approved under D036.
- Image-viewing action, 2026-10-03: the PNG was opened with the image viewer. Observed: **1. Live explanation** (native Run and Debug with Variables, Watch, Call Stack and Breakpoints; the Create Invoice application above `actions.ts` with one highlighted line; the standard chat on the right; bottom "Recording explanation · Save learning replay"); **2. Learning replay · Time-travel debugging** (the same composition, "(recorded state)" values, "Recorded application · 00:42", Learning summary with sequence diagram and "I understand this step", one transport at 00:42 / 02:18 with "Unrecorded interval"); **3. LLM Wiki, Reproduce DeepWiki** (chapter list, article with "Relevant source files" and flow diagram, Ask composer; right rail with "Source changed · Update available", the **Update LLM Wiki** button, "On this page", "Open in VS Code" and "Output: project folder / Change location"); **Shortcut discovery** (the "Keyboard shortcuts ?" control and the searchable dialog).
- Relevant difference: region 3's right rail shows "Source changed · Update available" and the button; the product has the button and the freshness label but no running or result state under it. This cycle's increment adds those states in that rail.
- Contracts: PRODUCT_GOAL G02, G11; `docs/specs/llm-wiki.md`; `docs/plans/deepwiki-generation-skill.md` step 8.

## Entry evidence, 2026-10-03

- Read in full in this working context after the compaction that followed the `/spec` intake and before any source change: PRODUCT_GOAL (v9), `docs/specs/llm-wiki.md`, `learning-replay.md`, `keyboard-shortcuts.md`, IMPLEMENTATION and DESIGN; PROJECT_STATE's assignment, all thirteen gap-table rows and the resume section (its 126 lines hold about 527 KB; the historical paragraphs between the table and the resume section are the part read by their first 700 characters only); the Cycle 0043 record's header, scope, host and entry sections, its findings and its result and closure. The approved PNG was opened with the image viewer and its hash verified (above).
- Checkout: `codex/cycle-0044-wiki-update-and-carried-defects` created from `main` `c549da6`, clean at creation. Issue #83 filed through `/spec` (body plus five comments); archive in `~/.gstack/projects/laststance-codebook/specs/`.
- Intake of the carried defects: five read-only passes of 2026-10-03 against `main` `c549da6`: [440 rows](0044-carried-defects.md) (OPEN 262, UNKNOWN 35, CLOSED 109, NOT-A-DEFECT 34). Cycle 0042's SR28 to SR34 exist only in PR #79's body (its closure branch `3ee1206` was never pushed).
- Semantic review of the Issue: clean; redaction scan of body and comments: clean (private repository). The Codex quality gate scored the Issue body 7 of 10; its ambiguities (bound, cancel, late publish, identity, one run, Part 2 closure) were answered in the body before filing.

## Source-gap audit and selected increment

Baseline: `main` `c549da6` (0.2.27.0 source plus docs-only commits). Goal version 9 and the PNG are unchanged. All thirteen rows are accounted for in PROJECT_STATE; rows this cycle's source paths do not touch carry forward with their limits.

| AC                                   | Affected?              | Implementation / proof gap (source inspected on `c549da6`)                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-WIKI-UPDATE                       | Primary                | `extension.ts` `updateDeepWiki` (VS Code branch) opens `workbench.action.chat.open` and returns; the Cursor branch (`runCursorWikiUpdate`) checks the manifest and `inspectDeepWikiFreshness`; the reader has `api/freshness` only. Proof gap: no update observed from the browser button; no failure, cancellation, timeout or conflict observation. |
| AC-WIKI, AC-SOURCE-LINKS, AC-DESKTOP | Dependency             | Reader script and `/update` link. Default-zoom and motion checks stay open.                                                                                                                                                                                                                                                                           |
| All others                           | Carry forward / Part 2 | Part 2 touches them through the carried labels.                                                                                                                                                                                                                                                                                                       |

Whole-goal route check: all thirteen rows stay short of integrated acceptance. After this cycle the Wiki update flow is observable; the first blocker of the live-to-replay path (N-7 of Cycle 0043) is a Part 2 task here.

## Carried defects

All 440 rows, with their source evidence and closing criterion, are in [0044-carried-defects.md](0044-carried-defects.md). This cycle closes only when its **Closed** column names the fix and its test, or the evidence, on every row.

| Group | Cycles           | Rows | OPEN | UNKNOWN | CLOSED at intake | NOT-A-DEFECT at intake |
| ----- | ---------------- | ---: | ---: | ------: | ---------------: | ---------------------: |
| 1     | 0043             |   40 |   39 |       0 |                1 |                      0 |
| 2     | 0041, 0042       |   66 |   51 |       3 |                8 |                      4 |
| 3     | 0038, 0039, 0040 |  121 |   80 |      10 |               25 |                      6 |
| 4     | 0035, 0036, 0037 |  102 |   63 |      10 |               16 |                     13 |
| 5     | 0031 to 0034     |  111 |   29 |      12 |               59 |                     11 |

## Validation contract

| Check                  | Expected observable result                                                                                          | Real procedure                                                                                                                                             | Evidence required                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Part 1 criteria 1 to 8 | As in Issue #83                                                                                                     | Mechanism tests (state machine with a manual clock, reader contract, publisher failure and cancel, relocation, conflict), each with a disabled-fix control | Test output on base and branch, control table        |
| Part 1 criterion 9     | Update started from the browser button shows running then a result in each host; one failure or cancel in each host | Linux VS Code (Copilot Chat Auto) and Cursor (Composer 2.5, Fast off) in `/home/murakami/codebook-qa`, on the dashboard, one host at a time                | Journals, video frames, comparison with PNG region 3 |
| Part 2                 | Every row closed                                                                                                    | Group by group, as the table's closing column says                                                                                                         | Tests, evidence, the Closed column                   |

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending
- Findings:
- Keep / revise / replace:
- Evidence that can update goal state:
- Acceptance-map IDs advanced / actual UI compared with the approved image:
- Before/after source and proof gaps for every affected AC; regressions and unaffected-evidence rationale:
- Delivery state and proof:

## Handoff

## Next action

- Exact next action: plan reviews for Part 1, then the mechanism tests and the update-run state (Part 1), then Part 2 group by group.
- Changed files / branch / active processes: branch `codex/cycle-0044-wiki-update-and-carried-defects`; no editor or database process running.
- State updated in PROJECT_STATE.md: not yet.
- Owner rules stated in the required reads: the cycle rule (AGENTS.md, DEVELOPMENT.md); nothing new this cycle.
- Defects this cycle leaves unfixed (all go to the next cycle's Issue):
- At most one next candidate and why (after evidence):
