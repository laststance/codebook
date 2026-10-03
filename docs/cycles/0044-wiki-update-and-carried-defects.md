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

### Entry repeated after a second compaction, 2026-10-03

The working context was compacted again while Part 2 ran. Before any further source change the mandatory entry was repeated from the files on disk: PRODUCT_GOAL (v9), the three feature contracts, IMPLEMENTATION, DESIGN and DEVELOPMENT in full; PROJECT_STATE's header table, assignment, all thirteen gap rows and its "One next action" paragraph in full (the historical checkpoints between them by their first lines only); this record in full. The approved PNG was opened with the image viewer again (SHA-256 unchanged, `f189ee82…`): region 3's right rail shows "Source changed · Update available" above the **Update LLM Wiki** button, then "On this page", "Open in VS Code" and "Output: project folder / Change location". Checkout at that point: this branch at `908e3f4`, clean.

### Part 1 mechanism (`908e3f4`)

One extension-owned run state, `WikiUpdateRun` (`extension/src/utils/wikiUpdateRun.ts`), is shared by the command, the `/update` link and the browser button and is served by the reader at `api/update-status` (GET only, the same token and loopback rules as `api/freshness`).

- VS Code has no chat result API. After the chat opens, the extension watches the owned manifest: an identity that changed (manifest revision plus a digest of the sorted sources) with freshness `current` is `succeeded`; the watch ends as `timed-out` after 15 minutes (`WIKI_UPDATE_WATCH_TIMEOUT_MS`), as `cancelled` when the extension stops it, and as `conflict` when a learner-owned file in the output folder collides with a page or asset of a candidate staged after the run began.
- Cursor keeps its CLI run and maps its result to the same states (`succeeded`, `cancelled` through its cancellation token, `conflict`, `failed` with the reason).
- A second start while a run is active is refused in all three entries ("Codebook is already updating this project’s LLM Wiki."); a start on a site that already matches the source records `already-current` and starts nothing.
- The page shows the state under the freshness label (`role="status"`, polite), polls every 2 s while a run is active and on load, and holds the update link back while running. Its wording is one function (`describeWikiUpdate`) that the page script embeds, so the tests read the wording the page uses.

Tests: 44 in eight new files (`wikiUpdateRun` 7, `wikiManifestIdentity` 3, `waitForWikiPublish` 7, `describeWikiUpdate` 4, `describeUpdateFailure` 3, `detectWikiPublishConflicts` 6, `deepWikiReaderUpdateStatus` 5, `wikiUpdateFlow` 9), and two changed tests in `extension.test.ts` (a second VS Code start is refused; the Cursor update starts from a stale site).

| Criterion (Issue #83, Part 1)              | Test                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1 exactly one result, shown without reload | `wikiUpdateFlow`: VS Code running then succeeded; chat failure; `waitForWikiPublish`: timed-out with a manual clock |
| 2 Cursor reports the same states           | `wikiUpdateFlow`: Cursor success, failure, cancel                                                                   |
| 3 no second run                            | `wikiUpdateRun`: `begin` refuses; `extension.test`: second start refused with its notice                            |
| 4 new identity and `current`               | `wikiUpdateFlow`: succeeded carries the new identity; `describeWikiUpdate`: "Updated to …"                          |
| 5 byte-identical after cancel or failure   | `wikiUpdateFlow`: cancel with a directory hash before and after                                                     |
| 6 configured output                        | `wikiUpdateFlow`: relocation                                                                                        |
| 7 survives a reader reload                 | `deepWikiReaderUpdateStatus`: the route answers the running state to a new request                                  |
| 8 manual-file conflict                     | `detectWikiPublishConflicts` (6), `wikiUpdateFlow`: conflict names the path                                         |

Disabled-fix controls (the compiled file is patched, the named test is run, the file is restored and its hash compared; all nine failed as expected and every restore matched):

| Control | Disabled                                         | Test that fails                                  |
| ------- | ------------------------------------------------ | ------------------------------------------------ |
| C1      | the running check in `updateDeepWiki`            | `extension.test`: second start refused           |
| C2      | the already-aborted return of the watch's sleep  | `waitForWikiPublish`: cancel returns at once     |
| C3      | the cancellation mapping of the Cursor branch    | `wikiUpdateFlow`: Cursor cancel                  |
| C4      | the already-current return                       | `wikiUpdateFlow`: already-current starts nothing |
| C5      | the conflict probe of the watch                  | `wikiUpdateFlow`: conflict                       |
| C6      | the `api/update-status` route                    | `deepWikiReaderUpdateStatus`                     |
| C7      | `begin`'s refusal                                | `wikiUpdateRun`                                  |
| C8      | `#finish`'s running check                        | `wikiUpdateRun`: a late result is ignored        |
| C9      | the native-error test of `describeUpdateFailure` | `describeUpdateFailure`: no `Error:` prefix      |

Limits of this level: the page wording is tested through the served script run in a vm, not in a browser DOM; the conflict probe reads the publisher's sibling `<output>.stage-<id>` folders; criterion 9 (both hosts, natively) is run on the final candidate and recorded below.

### Plan reviews of Part 1, 2026-10-03

Run after the mechanism was written, so each reviewed the plan and its implementation at `908e3f4`; each was read-only and non-interactive (the owner cannot answer: every decision point took the recommended option). None had a Codex outside voice (skipped for run time on a shared CPU; that coverage is missing, not clean). None read the 440 carried rows; none removes, merges or defers one.

| Review                | Amendments  | Critical | What the critical ones are                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/plan-eng-review`    | ER1 to ER19 |        7 | The page reads the state once, 2 s after the click (ER1); a publish with unchanged sources and revision is never seen (ER2, confirmed with the real publisher); "the last usable site is kept" after the site was replaced (ER3); permanent claims after cancel, timeout or conflict while the VS Code chat keeps working (ER4); a hand-edited generated page makes the publisher refuse at `--prepare`, so the run times out instead of naming a conflict (ER5, confirmed); a publish landing inside the conflict probe (ER6, read from code); a reader that goes away leaves a dead button (ER7) |
| `/plan-devex-review`  | DX1 to DX19 |        6 | DX1 (= ER1), DX2 (= ER3), "Update cancelled" while the chat still works (DX3), the editor says "could not start" for a Cursor run that ran and says nothing for four VS Code endings (DX4), DX5 (= ER7), DX6 (= ER2)                                                                                                                                                                                                                                                                                                                                                                               |
| `/plan-design-review` | DR1 to DR16 |        4 | DR1 (= ER1), the held-back button looks enabled and says nothing (DR2), DR3 (= ER7), a result never ages and contradicts the freshness label (DR4). Scores: 4/10 as built, 8/10 with the amendments (capped until a screen reader and both hosts are observed)                                                                                                                                                                                                                                                                                                                                     |

All 54 amendments are applied in this cycle. Where the reviews disagree the decision is: a publish is detected by the manifest's bytes and inode, the displayed identity stays (ER2 over DX6's stamp); a conflict names three paths and counts the rest (DR7 over DX10's five); the page polls slowly when idle and on window focus (DR1 and ER4 over DX1's focus-only); a reader that stops answering is retried three times before the page says so, and the page keeps looking (ER7, DR3 over DX5's stop after five); a candidate is found by the publisher's own receipt and baseline, and is blamed for a conflict only when written after the run began (ER9, keeping the abandoned-candidate case); the start guard against another window's run applies only to a candidate written after this window's last run ended (ER10, so a retry after an own failure is not refused); the reload is a button and an update that removed the page being read lands on the index (DR9, ER14); the shared skill text is not changed, the watch contract goes into the update prompt (DX17). The state contract after the amendments: every ended state names its host, a state that is not a success says whether the site on disk was kept or replaced, a conflict says what kind (a learner's file, a hand-edited page, an unfinished earlier publish), and the page and the editor notification read the same sentence.

Both review findings DX19 and ER17 are about this record: the criterion table above credited page behaviour (criteria 1, 3, 4 and 7) to tests of the extension state, and called two file reads a directory hash. Until the amendments' page tests and real-publisher fixture are merged, criteria 1, 3, 4 and 7 are proven for the state only and criterion 5 for two files of a fixture nothing writes to.

### Entry repeated after a third compaction, 2026-10-03

The working context was compacted a third time, after the page side of Part 1 was merged (`feb24c4`). Before any further merge or source change the mandatory entry was repeated from the files on disk: PRODUCT_GOAL (v9), the three feature contracts, IMPLEMENTATION, DESIGN, DEVELOPMENT, the local TypeScript rules and this record in full; PROJECT_STATE's header table, its assignment paragraphs, the AC-WIKI-UPDATE row and the "One next action" paragraph in full, and the other twelve gap rows by their first 3,200 characters each (the historical checkpoints between them were not read again). The approved PNG was opened with the image viewer again (SHA-256 unchanged, `f189ee82…`): region 3's right rail shows, top to bottom, "Source changed · Update available" with an icon on a tinted panel, the filled **Update LLM Wiki** button, "On this page", "Open in VS Code" and "Output: project folder / Change location"; regions 1 and 2 and the shortcut strip are as recorded under "Accepted product and design". Checkout at that point: this branch at `feb24c4`, clean.

### Part 1 after the plan reviews (`4d3230a`, `feb24c4`, `47e6810`, `e8917f7`)

The 54 amendments were applied in three steps: the state contract and the one wording (`4d3230a`), then the page side (14 items, `feb24c4`) and the extension side (16 items, `47e6810`) in two worktrees, then what the two sides left open against each other (`e8917f7`).

What the learner reads, per state. The rail order is: freshness label, **Update LLM Wiki**, status line (`role="status"`, atomic, written only when its sentence changes); after the status line come the disclosure, the reload button and the output line, outside the announced region.

| State on the page              | Decided by                                                                                                                                                 | Sentence (its first words are strong)                                                                                                                                                                 | Button                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| idle                           | extension                                                                                                                                                  | nothing                                                                                                                                                                                               | Update LLM Wiki                                                                |
| awaiting                       | page, at the press                                                                                                                                         | "Confirm the update in your editor to start it."                                                                                                                                                      | Update LLM Wiki                                                                |
| not-started                    | page, two minutes after a press that changed nothing                                                                                                       | "No update started. Confirm it in the editor, or press Update LLM Wiki again."                                                                                                                        | Update LLM Wiki                                                                |
| running                        | extension                                                                                                                                                  | "Updating LLM Wiki… The request went to the VS Code chat at 21:03. …" or "… Cursor Agent started at 21:03 and may take up to 15 minutes. …"; "… is preparing a new site …" once a candidate is staged | "Updating…", held back (`aria-disabled`, dashed, described by the status line) |
| succeeded                      | extension: the publish token changed and the new manifest matches the source                                                                               | "Updated at 21:10 to revision a1b2c3d4e5f6 (index 0f9e8d7c)."; a **Reload to read the new pages** button when the page was loaded before it; gone once the source changed again                       | Update LLM Wiki                                                                |
| already-current                | extension, at the start                                                                                                                                    | "Already current (checked 21:10): this Wiki matches the source, so no update started."; gone once the source changed                                                                                  | Update LLM Wiki                                                                |
| failed, site kept              | extension                                                                                                                                                  | "Update failed at 21:10: <reason> The last usable site is kept."                                                                                                                                      | Update LLM Wiki                                                                |
| failed, site replaced          | extension: a publish happened but does not match the source, or cannot be checked                                                                          | "Update needs another run (21:10): <reason> This run replaced the site on disk."; gone once the source matches that site again                                                                        | Update LLM Wiki                                                                |
| cancelled                      | extension                                                                                                                                                  | VS Code: "Stopped watching at 21:10. The VS Code chat may still be working and can still publish; …"; Cursor: "Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept."    | Update LLM Wiki                                                                |
| timed-out                      | extension, after 15 minutes                                                                                                                                | VS Code: "No new site appeared within 15 minutes, so Codebook stopped watching at 21:18. …"; Cursor: "Update timed out: Cursor Agent did not finish within 15 minutes and was stopped at 21:18. …"    | Update LLM Wiki                                                                |
| conflict, learner's file       | extension, from the publisher's own receipt of a candidate written during the run                                                                          | "Update stopped at 21:10: it would overwrite your own file(s) in the Wiki folder (a, b, c and 2 more). Nothing was replaced. …"; every path behind "Show all N files"                                 | Update LLM Wiki                                                                |
| conflict before the start      | extension, before any agent is asked: a generated page edited by hand, the manifest changed after its publish, or an earlier publish that left its journal | "Update not started (21:10): …" with the remedy that fits                                                                                                                                             | Update LLM Wiki                                                                |
| late-publish                   | page: a run ended without success, the source matches the site, and the site was published after that run ended                                            | "A new site was published after this run ended and matches the source."; the reload button when the page was loaded before that publish                                                               | Update LLM Wiki                                                                |
| unreachable                    | page: the fourth failed read in a row during a run, or the first with a result on screen                                                                   | "Lost contact with the editor, so the update status is unknown. Reopen this Wiki with “Codebook: Open DeepWiki in Browser” to see it. The pages you are reading are unchanged."                       | Update LLM Wiki                                                                |
| a state the page does not know | page                                                                                                                                                       | "Update status unknown."                                                                                                                                                                              | Update LLM Wiki                                                                |

The editor shows the same sentence as a notification when a run ends (information for a success or a cancel, a warning for a timeout or a conflict, an error for a failure; none for the run a closing window stops), with the whole reason.

The criteria, with the tests that now prove them at mechanism level (this replaces the table under "Part 1 mechanism", which credited page behaviour to tests of the state and called two file reads a directory hash):

| Criterion (Issue #83, Part 1)                                                    | Page (the served script run against a fake page with a manual clock)                                                                                                                                                                                             | Extension and real publisher                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 exactly one result, shown without reload                                       | `wikiUpdatePage`: "the page shows the running update and then its result when the learner confirms in the editor thirty seconds after pressing the button", "a run that ends while the page is open shows its result without a reload and frees the update link" | `wikiUpdateFlow` (22): success, chat failure, cancel; `wikiUpdatePublisherFlow`: "a watched run in which nothing is published ends as timed out when its fifteen minutes have passed, warns in the editor and leaves the Wiki folder byte-identical"                                          |
| 2 Cursor reports the same states                                                 | the page words every state for both hosts (`describeWikiUpdate`, 22)                                                                                                                                                                                             | `wikiUpdateFlow`: Cursor success, failure, cancel, "a Cursor agent that publishes and then fails is shown as a failure that replaced the site…", "a Cursor update that runs past its bound ends as timed out…"; `classifyWikiUpdateEnd` (13); `runCursorWikiUpdate` with a real child process |
| 3 no second run                                                                  | "a page loaded during a run shows the running sentence and holds the update link back", "while an update runs the button reads Updating… …"                                                                                                                      | `wikiUpdateRun`: `begin` refuses; `wikiUpdateFlow`: "a second start from the browser link is refused before the confirmation is shown and says where the progress is"; `wikiUpdatePublisherFlow`: a candidate that exists before the click refuses the start                                  |
| 4 new identity and `current`                                                     | "an Updated line is gone once the source changed again after that update"                                                                                                                                                                                        | `wikiUpdateFlow`: "a VS Code update that publishes the same sources and revision again still ends as succeeded", "a publish that no longer matches the source says the site was replaced and how many files changed"                                                                          |
| 5 the last usable site is byte-identical after a refusal, a cancel and a timeout | —                                                                                                                                                                                                                                                                | `wikiUpdatePublisherFlow` (16) on a site the bundled `publish-wiki.mjs` published, with a learner's file beside it and a hash over every file of the output: refused publish, cancel with a candidate staged, timeout                                                                         |
| 6 configured output                                                              | the output line                                                                                                                                                                                                                                                  | `wikiUpdatePublisherFlow`: "a publish into a configured Wiki folder is seen there…"; `wikiOutputLabel` (4)                                                                                                                                                                                    |
| 7 survives a reader reload                                                       | the on-load test of criterion 3                                                                                                                                                                                                                                  | `deepWikiReaderUpdateStatus` (9): the route answers the running state to a new request, also "while a publish has left the manifest unreadable"                                                                                                                                               |
| 8 manual-file conflict                                                           | "a conflict over twelve files names three in the sentence and lists all twelve behind a disclosure"                                                                                                                                                              | `detectWikiPublishConflicts` (11); `wikiUpdatePublisherFlow`: "a publish the real publisher refuses over the learner’s file ends the watched run as a conflict, and the previous site, its manifest, its receipt and the learner’s files are byte-identical"; `findWikiUpdateStartBlock` (6)  |

Disabled-fix controls: 58 for the page side, 53 for the extension side and 9 for the integration step; in each the compiled file is patched, the named test fails, the file is restored and compared byte for byte. The nine controls C1 to C9 above were written for `908e3f4`; the amended code is covered by these 120.

Decisions the reviews left open, each the recommended option:

- "Succeeded" needs a publish: the publish token (hash and inode of the manifest file) must have changed and the new manifest must match the source. A Cursor agent that ends without publishing is a failure that kept the site.
- The page claims a later publish only when the manifest on disk is newer than the run's end (`api/update-status` answers `sitePublishedAt`); a source that went back by itself leaves the failure sentence standing. The same time gates the freshness read of an idle page, so the sources are not hashed every 15 seconds.
- A failure reason is shown up to 400 characters, so the two long sentences Codebook writes itself (another window is updating; a publish it cannot check) keep their next step; longer text is behind "Show the full message". The editor notification is never cut.
- A manifest changed after its publish is refused at the start, as the publisher refuses it at `--prepare` (the extension-side review named only edited pages and the journal; without this such a VS Code run ended as a timeout).
- The late-publish line offers the reload only to a page loaded before that publish; the narrow layout bounds the group at 18rem and lets it keep its own height.
- A closing window stops the Cursor agent and waits at most the termination grace for either host's run; it shows no notification.

Limits of this level: the state lives in one editor window, so a second window on the same project learns of a run only through the candidate on disk (the start guard), and a window reload ends a run without a stored result (the page then says it lost contact). A learner's file added while a run is active is noticed at the next look that a manifest write triggers. A site published before this cycle keeps its old markup on disk until its next publish; served through the reader it is regrouped by the script. No browser, screen reader or editor has shown any of this yet: criterion 9 is below.

Remaining differences from region 3 of the approved PNG, by decision of the design review: the group is a neutral bordered panel instead of the tinted one, with no icon before the freshness label; the button sits under the label as in the PNG; "On this page", "Open in VS Code" and the output block predate this cycle and are unchanged.

Full suite on the merged tree `3644cd5` (this branch with Groups 1 to 3 and both sides of Part 1): 2,236 of 2,236 reported, ten of them from compiled files of test sources this cycle deleted (`continuationReceipts`, `isBindingLineAccepted`) that were still in `dist`; the count that closes the cycle is taken from a clean build.

### Part 2

Five groups were closed in parallel in five worktrees branched from `908e3f4`, one per section of [the carried-defects file](0044-carried-defects.md), each row by a fix with a test that is red without it or by evidence read against the current source. Their results are merged into this branch and recorded in that file's **Closed** column.

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
