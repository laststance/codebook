# Cycle 0043 — A stop the debugger binds on the next line is accepted there instead of ending the run

Type: product-increment with a bounded native experiment\
Status: implementing\
Result: pending\
Delivery: local-only\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/80 \
Goal issue: https://github.com/laststance/codebook/issues/1 \
Goal links: G01, G03, G11\
Source state: [Cycle 0042 result and decision](0042-adapter-resumed-pause.md#result-and-decision), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:

- [D047](../../DECISIONS.md#d047--resume-with-cycle-0043-on-a-windows-wsl-host-2026-10-03) (owner, 2026-10-03): the pause of D046 is lifted. The owner named this cycle ("まずはこちらのサイクルから着手して" with Issue #80), set the goal again ("Codebookを完成させてください、VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください") and said that this machine is Windows with WSL and that the dashboard checkout is at `~/laststance/nextjs-dashboard`.
- D045: every decision point takes the recommended option and this record names it.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.
- Owner statements of 2026-10-02 and 2026-10-03 that stay in force: only a critical review finding is fixed, the others are recorded and carried; Codex automatic review is off; Cursor trials use Composer 2.5.

## Question and authorized scope

When the agent declares a stop on a line where the debugger cannot pause, the debugger binds it on the next line and Codebook ends the run. Can Codebook accept that binding without ever claiming a place the program did not reach?

Why now: it ended the first admitted run of the frozen natural request in both hosts in Cycle 0042's N11-c (`login-form.tsx` 22:3 bound at 23:5 in VS Code, 74:11 bound at 75:13 in Cursor) and in Cycle 0036's N5-b. It is the first blocker of a natural request that passes on its first run (PRODUCT_GOAL, "Defining live-to-learning experience"; AC-LIVE; G11).

## Hypothesis and scope

- Hypothesis: in every observed case the debugger moved the breakpoint forward to the first place it can pause. A verified binding on a later line is the declared stop when it lies within the stop's citation and no line with a mapped position lies between the declared and the bound line. The paused native top frame is still compared with the bound place, so an accepted binding cannot claim a place the program did not reach.
- Smallest observable outcome: Issue #80 acceptance criteria 1 to 22, as amended below (criterion 7b, DX1 to DX6, ER1 to ER12).
- In scope: L (the rule and its sites, tests, controls), N12 (native, as far as this host allows; see "Host"), T (test timings).
- Out of scope (still in PRODUCT_GOAL): SR21 and SR24 of the Cycle 0042 delivery review; a click target that matches nothing; a required inspection of the binding the stopped line assigns; F1 and F2 of Cycle 0041; a declared line without a mapped position; Node test stops; Cursor's setup after an update; the Saved studies control (D1 to D5); the Cycle 0031 replay-screen items; the Wiki rows; the bundled skill's text; final acceptance.
- The approach is falsified if a native run's paused top frame differs from an accepted moved binding, or if the rule needs a stored-format, schema or tool-shape change.

## Plan and selected skills

The spec is Issue #80 (written through `/spec` on the Mac at the end of Cycle 0042). Order, as the issue fixes it:

```
DX review ──> engineering review ──> L (rule, sites, tests, controls) ──> gates ──> candidate ──> N12 ──> records ──> local reviews ──> T ──> /ship
```

- `/plan-devex-review`: the help sentence, the deadline texts and what the agent cites are what an agent reads and acts on.
- `/plan-eng-review`: where the rule lives, the server's pending case, the seams.
- `/plan-design-review` is skipped (the issue's decision): no element, layout or learner sentence changes.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`, then `/ship`, CI, the separate exact-HEAD gate and the merge in its own step (D039, D044).

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-LIVE. Dependency: AC-SAVE (a study with a moved line is saved and reopened), AC-SKILL (the help resource an agent reads). Regression: AC-REPLAY, AC-ENTRY, AC-GAPS, AC-LEARNING (the full suite).
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-03; owner-approved under D036.
- Image-viewing action, 2026-10-03: the PNG was opened with the image viewer in this session. Observed:
  - **1. Live explanation.** Native Run and Debug on the left (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the Create Invoice application above the stopped `actions.ts` with one highlighted line (`await db.insert(invoices).values({`), the standard chat on the right with a `/codebook` request and the agent's explanation, and the bottom status "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram and "I understand this step", and one transport at 00:42 / 02:18 with "Unrecorded interval".
  - **3. LLM Wiki — Reproduce DeepWiki.** The chapter list, the article with "Relevant source files" and the flow diagram, the Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Output: project folder / Change location".
  - **Shortcut discovery.** The "Keyboard shortcuts ?" control and the searchable dialog.
- Relevant difference: region 1 is this cycle's target. The board shows one stopped line that the chat explains. Today a stop declared one line above the place the debugger can pause ends the run instead of stopping there. No element changes in this cycle.
- Contracts: PRODUCT_GOAL G01, G03, G11; `docs/designs/codebook.md`, "Correctness and causal links" ("The debugger's actual bound source location is authoritative. Report unbound or missed breakpoints.") and "Architecture and evidence ownership" (a pause snapshot holds the "actual bound source/version"); D031, D040.

## Host

This cycle is the first on another machine than the development Mac.

- Windows 11 (build 26200) with WSL2, kernel 6.18.40.1; the repository is on the WSL file system at `/home/murakami/laststance/codebook`. `code` and `cursor` on the path are the Windows installations.
- The checkout had been cloned by Windows Git: 521 tracked files differed from the index by carriage returns only (`git diff --ignore-cr-at-eol` empty), with `core.filemode=false`, `core.symlinks=false`, `core.ignorecase=true`. The three settings were set to the Linux values and the working tree was checked out again; no content was lost. `main` was then fast-forwarded from `db8d188` to `origin/main` `f9ac394`.
- Not on this machine: the Mac's ignored `artifacts/` (the N11 declarations in `runtime.json`, the frozen natural prompt, earlier videos), the two QA editor profiles with their protected settings hashes, the OBS scenes, the gstack state of earlier cycles, and the local branch `3ee1206` that holds Cycle 0042's closure records (Issue #80 names it; it is not on `origin`). Cycle 0042's closure is therefore recorded here from what is public: PR #79 merged as `f9ac394` on 2026-10-03T05:11:39Z, CI on `main` at `f9ac394` succeeded (Format, Build, Fallow, Lint, Test, TypeCheck), and Issue #78 was closed by hand at 05:14:41Z with its outcome table. When the Mac's branch is pushed later, its records take precedence over this paragraph.
- The designated dashboard is at `/home/murakami/laststance/nextjs-dashboard`, `main` at `1936e41913729663cc99081e3224db89bb2d8e56`, clean (no `.codebook/` yet), remote `ryota-murakami/nextjs-dashboard`.
- Tools: Node 24.21.0, pnpm 12.4.2 (`corepack install -g pnpm@12.4.2`; without it `pnpm --dir extension` from the root fetched 12.8.1 and stopped with `ERR_PNPM_BAD_PM_VERSION`), gh as `ryota-murakami`, Codex CLI 0.160.0, Docker; no `coderabbit`, `psql`, `pg_isready` or `ffmpeg` yet.
- Desktop control: Claude Code's built-in computer use does not exist on Linux or Windows. With the owner's choice of 2026-10-03 the third-party Windows-MCP server (4.0.10, telemetry off) is registered for this user; it drives the Windows desktop from WSL.

## Entry evidence, 2026-10-03

- Read in full in this working context, between about 15:10 and 15:35 JST, before any source change: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, DEVELOPMENT, DECISIONS D039 to D046, the behavioral design, the test execution guide, the cycle template, the local TS rules (`/home/murakami/.claude/rules/ts-rules.md`; AGENTS.md names the Mac path) and Issue #80. Of the Cycle 0042 record: its header, scope and plan, "Accepted product and design" to the gap audit, "Native check N11" and "Result and decision" to the end; not its implementation, review and delivery sections. Not read, because nothing here needs them yet: the native recording procedure (macOS OBS; it is read before N12), the bundled-skill plan, the Cycle 0029 state and interaction review, the React rules.
- The approved PNG was opened with the image viewer and its hash verified (above).
- Checkout: `codex/cycle-0043-next-line-binding`, created from `main` `f9ac394`, clean. No pull request open; Goal Issue #1 and Issue #80 open.
- Baseline on this host: `pnpm --dir extension test` 1,818 of 1,818, 0 failed, 89 s of tests (98 s with the build).
- After a context compaction at about 16:15 JST the mandatory entry was done again before any native trial: PRODUCT_GOAL, the three feature contracts, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN and this record were read in full from disk, DEVELOPMENT was read again before the reviews, and the approved PNG was opened with the image viewer (hash `f189ee82…` verified; the four regions as described above). Branch `codex/cycle-0043-next-line-binding` at `79593a8`, clean; no pull request open.
- Source read before the reviews: `configuredBrowserRun.ts` 90-130, 400-680, 740-870, 1080-1180, 1218-1375, 1420-1785, 1855-1915, 2355-2402; `ownedRepositoryBreakpoint.ts`; `utils/isPauseAtStop.ts`, `isFrameAtPosition.ts`, `isRefreshedFrameAtStop.ts`, `createBundleVerifier.ts`, `sourceMapMappedPositions.ts` 1-60, `validateConfiguredStudyEvidence.ts`, `assertConfiguredDescriptor.ts` 55-80; `resources.ts` 130-160; `tests/utils/configuredRuntimeHarness.ts`, `createConfiguredStudy.ts`; `tests/configuredRuntime.test.ts` 900-1000, `configuredService.test.ts` 690-720, `pendingRepositoryBreakpoint.test.ts` 170-235.

## Source-gap audit and selected increment

Baseline: `main` `f9ac394` (0.2.26.0). Goal version 9 and the PNG have not changed since the Cycle 0042 audit, and no product source changed since its delivery. Every row is accounted for; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `f9ac394`) |
| --- | --- | --- |
| AC-LIVE | Primary | A verified binding on another line than declared is refused at five places: the browser's arming poll (`configuredBrowserRun.ts:557`), the server owner's reply check (`ownedRepositoryBreakpoint.ts:178-193`), the server's binding at its pause (`configuredBrowserRun.ts:1655`), the position test of every pause (`utils/isPauseAtStop.ts:41`) and the saved study's source check (`utils/validateConfiguredStudyEvidence.ts:101`). The help says so (`resources.ts:144`). Proof gap: no natural request passes on its first run in either host. |
| AC-SAVE | Dependency | `validateConfiguredStudyEvidence` rejects a saved observation on another line than declared; a study with an accepted moved line must decode and reopen. |
| AC-SKILL | Dependency | The help resource an agent reads states the rule; the bundled skill is not touched. |
| AC-REPLAY, AC-ENTRY, AC-GAPS, AC-LEARNING | Regression | Not touched; the full suite must keep passing. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. No shortcut is assigned. |

Whole-goal route check: all thirteen rows stay short of integrated acceptance. This cycle takes the first blocker of the defining live-to-replay path. After it, in the order of Cycle 0042's closure: SR21 and SR24, then a click target that matches nothing, a required inspection of the binding the stopped line assigns, F1 and F2 of Cycle 0041, Cursor's setup after an update, D1 to D5 on the Saved studies control and the Cycle 0031 UI items.

## Validation contract

Issue #80, criteria 1 to 22, with these changes from the plan reviews:

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| Criteria 1, 2, 4, 5 | As in the issue | Run-level tests, red on `f9ac394` | Test output on base and branch |
| Criterion 3 (ER3) | The pause at the accepted bound place is captured while the run's wait for the accepted stop's own pause is held open by the harness | Run-level test; no wall-clock bound | Test, and its control failing |
| Criteria 4 and 5 (ER5) | A moved server stop is captured without the adoption wait, for a loaded module and for a pending registration | Run-level tests with the wait held open | Tests, and the control failing |
| Criterion 7 (DX2) | `Repository continuation reached no next declared pause: declared stop <path>:1 (bound at 2:1) was not hit within 20 s; the bound line, not the declared one, must execute after the preceding continuation` | Mock clock | Exact text |
| Criterion 7b (DX3) | `Repository input reached no verified pause: declared stop <path>:1 (bound at 2:1) was not hit within 20 s of the accepted action; the bound line, not the declared one, must execute after the input`, only when the input was dispatched | Mock clock | Exact text; red on base by the binding text |
| Criterion 9 (DX1) | The help holds DX1's sentences | `configuredService.test.ts:705`, the one changed assertion | Test |
| ER6 | A stack refresh that arrives before a moved server stop's binding is read keeps the run | Run-level test with the binding lookup held | Test, and its control failing |
| Criterion 12 (ER10) | Nine control rows fail their named tests with the part removed from `dist`, and `dist` is byte-identical afterwards | Compiled output edited and restored | Table |
| N12 (ER12, DX6) | Frozen on this host before the first submission | See "Native check N12" | Journals, video if a recorder is available |

## Plan review, 2026-10-03

Both reviews ran in this session before any source change. The owner cannot answer, so every decision took the recommended option (D045). Their full reports with the outside voices are in the private gstack state of this machine (`cycle-0043-dx-review.md`, `cycle-0043-eng-review.md`); the amendments are complete here and on Issue #80.

### Developer-experience review

`/plan-devex-review` in DX POLISH mode. Persona: the editor's chat agent, which reads the help once, cannot see the source map and has one run before the application's action repeats. Journey traced against the source on `f9ac394`. Peer practice: the Debug Adapter Protocol's `setBreakpoints` returns the actual breakpoint and the Chrome DevTools Protocol answers `actualLocation`; both report a moved breakpoint instead of refusing it. Outside voice: Codex CLI 0.160.0, read-only, three findings, all confirmed on the quoted lines and applied. Score 6/10 before, 7/10 after (the help is still one long paragraph without a worked example). 6 amendments, 0 unresolved.

- **DX1 (help rule sentence).** `A verified binding on another line fails at once.` is replaced by: `When the debugger cannot pause on the declared line it binds the first place after it. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the two has a mapped position, and uses it like a moved column: the inspection's source names the bound line, so cite and explain source. Let the citation cover every line of the statement the stop is in, so that a moved binding stays inside it. A moved binding can lie in a branch the action skips; the stop then fails at the 20 second deadline, whose text names the bound place. Any other binding on another line fails at once; declare the bound place instead, in a citation that covers it.` The issue's default wording stated the rule in map terms only; it did not say what makes the rule apply or what a skipped branch looks like.
- **DX2 (deadline of a moved later stop).** `Repository continuation reached no next declared pause: declared stop <path>:<line> (bound at <line>:<column>) was not hit within 20 s; the bound line, not the declared one, must execute after the preceding continuation`. The issue's text ended "its line must execute…": for 74 bound at 75 the declared line does execute and the bound one does not, so that clause pointed at the wrong line. With no moved binding the text is unchanged.
- **DX3 (deadline of a moved first stop).** A moved first stop that is not reached ended with `Repository input reached no verified pause`, which names no stop and no place. With a moved binding and the input dispatched, the text is `Repository input reached no verified pause: declared stop <path>:<line> (bound at <line>:<column>) was not hit within 20 s of the accepted action; the bound line, not the declared one, must execute after the input`. The deadline starts when the action is accepted, before the input is sent (Codex), so the text names that origin and an expiry before the input keeps today's text. New criterion 7b.
- **DX4 (citation advice).** The sentence about the citation in DX1, recorded apart because it can be judged apart: an agent that cites only its declared line still gets today's refusal.
- **DX5 (refusal texts).** Unchanged, as the issue says. A refusal names the bound place, not which condition failed. Declaring that place is the fix when the citation covers it; a bound place outside the citation also needs an article revision whose citation covers it, because a stop outside its citation is refused before the run (`Configured position differs from its selected citation.`, `utils/assertConfiguredDescriptor.ts:77`; Codex). The help's last sentence says so. Naming the failed condition is carried.
- **DX6 (what the explanation names).** `codebook_explain` checks the source hash and the fact keys, not the line an explanation talks about (`service.ts:872`; Codex). N12 records, for every stop whose binding moved, which line the saved explanation names; an explanation that names the declared line is a finding about the help's wording, not a failure of L.

### Engineering review

`/plan-eng-review`. Scope accepted as-is; structure: the original arrangement (one rule utility asked at the existing sites; the complexity gate tripped on eight product files, none of them a new class). Outside voice: Codex CLI, read-only, three findings, all confirmed and applied; they changed the pending case, the receipt handling and the seam of criterion 3. 12 amendments, 0 unresolved, 0 critical gaps.

```
agent declares stop S = (path, line D, column) with citation [a..b]
            │
            ▼
   debugger verifies S's breakpoint at line B
            │
   ┌────────┴──────────────────────────────────────────────────────────┐
   │ isBindingLineAccepted(D, B, [a..b], sealed map)                   │
   │   B == D                         → accepted (as today)            │
   │   B <  D or B > b                → refused                        │
   │   B == D + 1                     → accepted (nothing lies between)│
   │   scan(D+1 .. B-1) complete, empty → accepted                     │
   │   otherwise (a mapped line, or a partial scan) → refused          │
   └────────┬──────────────────────────────────────────────────────────┘
            │ the run asks through one method, acceptsBoundLine(stop, B)
   ┌────────┼───────────────┬──────────────────────┬─────────────────────┐
   ▼        ▼               ▼                      ▼                     ▼
browser   server, loaded   server at its pause  stack refresh        saved study
armStop   owner's reply    (inspect)            before the binding   (no sealed map:
poll      (rule passed                          is read              later line within
          to the owner)                                              the citation and
                                                                     the native top frame)

position test of every pause (isPauseAtStop):
   binding known   → the pause's sealed-map line == bound line
   binding unknown → == D, or a line the rule accepts (at most one: the first mapped line after D)
```

- **ER1 (the rule's home).** `extension/src/utils/isBindingLineAccepted.ts`. The run asks through one private method `acceptsBoundLine(stop, line)`, which supplies `descriptor.anchors[stop.anchorIndex]` and `stop.verifier.mappedPositions`.
- **ER2 (browser arming).** The poll in `armStop` refuses a binding the rule refuses and records `stop.bound` and `breakpoint.bound` as today.
- **ER3 (position test).** `PauseStopTarget` gains `bound?: { line }` and `acceptsBoundLine?: (line) => boolean`. Once the binding is known the pause's sealed-map line is compared with the bound line. While it is not known (a server stop before its pause is inspected) the pause is at the stop on the declared line or on a line the rule accepts; the sealed map only yields lines with a mapped position, so that is at most one line. Criterion 3's seam: the harness holds the run's wait for the accepted stop's own pause open and the test sees the snapshot while it is held; no wall-clock bound (Codex: a bound of one second would have measured the host).
- **ER4 (server, module loaded).** `OwnedRepositoryBreakpoint` takes an optional fifth argument `acceptsLaterLine?: (line: number) => boolean`, consulted only under `'declared-line'` for a verified reply on another line. The receipt gains `movedTo: { line, column }` only for such an accepted reply that names a column; every other receipt keeps today's shape. The run does not copy that place into `stop.bound` (Codex: a copy would miss the synchronous registration check before the input and go stale after a replacement acknowledgement); the owner offers a synchronous, non-throwing read of the current registration's `movedTo` for the deadline texts. An owner without the argument, and every `'declared-column'` owner, refuses as today.
- **ER5 (no adoption wait for a moved server stop).** `inspect` accepts the paused binding under the rule, and the pause itself is admitted at once by the position test (ER3), for a pending registration and for a loaded module. This replaces the issue's default (the 3 s adoption wait) without reading the adapter's `breakpoint` events. Reason (Codex): during that wait the pause is held as nobody's, and a stack refresh that arrives then ends the run (`Unowned continuation invalidated live pause`, `configuredBrowserRun.ts:1353`); a pending registration is the case in which the module and its source map have just loaded. The adoption wait stays for every pause elsewhere in the stop's module.
- **ER6 (stack refresh before the binding is read).** `isRefreshedFrameAtStop` takes an optional `acceptsBoundLine` predicate: while nothing is bound, the frame must be in the cited file on the declared line or on a line the rule accepts. One test and one control row.
- **ER7 (deadline texts).** `progressDeadline` accepts a text or a function that is read at expiry. Both deadlines read the stop's moved place at expiry: `stop.bound` when it is on another line than declared, otherwise the owner's current `movedTo`. DX3 also reads `operation.inputDispatched`.
- **ER8 (saved study).** A new predicate in `extension/src/utils/` decides whether a saved observation's source is at its stop: the declared line with today's column rule, or a later line within the stop's citation when the observation has a debugger snapshot. The existing top-frame comparison then requires the native frame at that exact line and column. `validateConfiguredStudyEvidence` keeps one condition and its text.
- **ER9 (fixture).** The two harnesses take an opt-in fixture (source text, citation end line, declared line, generated code, mappings, where the declared pause is reported); `createConfiguredStudy` takes the citation's end line as an optional argument. Defaults are today's values, so the existing refusal tests (line 2 outside the one-line citation) stay green without an edit.
- **ER10 (controls).** Nine rows: the browser acceptance at arming (criteria 1, 2); the bound line in the position test (3); the owner's rule (4); the acceptance at the pause (5); the rule's line in the position test while the binding is unknown (4 and 5 without the adoption wait); the refresh rule (ER6); the moved place in the continuation deadline (7); in the input deadline (7b); the saved-study acceptance (8a).
- **ER11 (limit, no code).** A pause the adapter makes for itself on the stop's line at another column, resumed unannounced, is admitted as the stop's pause and its resume ends the run. That is today's limit for the declared line (SR21 and SR24 of Cycle 0042); it now also holds for the bound line and, while a server stop's binding is unknown, for the first mapped line after the declared one. The issue's case "the bound place is also where js-debug's module entry breakpoint pauses" is not this limit: that pause hits the owned breakpoint too, so the adapter announces it, and the retirement runs only from a resume (`configuredBrowserRun.ts:1476`).
- **ER12 (native host).** N12's expectations are frozen on this host before its first submission and say which parts of the issue's N12 can run here; a part that cannot is NOT RUN with its reason. L's mechanism proof does not depend on it.

Test plan after the reviews: the rule's unit table (8 cases); `isPauseAtStop` and `isRefreshedFrameAtStop` unit cases for the bound line and the predicate; the owner (+2); browser-only run level (+7: criteria 1, 3, 7, 7b and three refusals); server and mixed run level (+7: criteria 2, 4, 5, ER6 and three refusals at the pause); the saved study (+3); one changed help assertion; nine controls.

## Attempts and evidence

### Implementation of L, 2026-10-03

Source `f234179` (tree `295e7a8e`); product files changed against `f9ac394`:

| File | Change |
| --- | --- |
| `extension/src/utils/isBindingLineAccepted.ts` (new) | The rule (ER1): the declared line; or a later line up to the citation's last line with no mapped line strictly between, by a complete scan; the next line needs no scan. |
| `extension/src/configuredBrowserRun.ts` | Every prepared stop carries `acceptsBoundLine`, built once from its citation and its sealed map. `armStop` passes it to the owned breakpoint and refuses a browser binding only when it refuses the line (ER2). `inspect` accepts the paused server binding under it (ER5). `verifyStackRefresh` passes it on (ER6). `progressDeadline` takes a text or a function read at expiry; `unreachedFirstStopReason` and `unreachedNextStopReason` word the two deadlines and `movedPlace` reads the stop's moved place (ER7, DX2, DX3). |
| `extension/src/utils/isPauseAtStop.ts` | The bound line once known; before, the declared line or a line the stop's rule accepts (ER3). |
| `extension/src/ownedRepositoryBreakpoint.ts` | An optional fifth argument `acceptsLaterLine`; a verified reply on a line it accepts is acknowledged under `'declared-line'`; the receipt gains `movedTo` only for such a reply that names its column; `movedTo(session)` reads the current one without throwing (ER4). |
| `extension/src/utils/isRefreshedFrameAtStop.ts` | An optional `acceptsBoundLine`, used while nothing is bound (ER6). |
| `extension/src/utils/isSavedSourceAtStop.ts` (new), `validateConfiguredStudyEvidence.ts` | The saved observation's position: the declared one, or another column or a later line within the citation when the debugger state was saved (ER8). |
| `extension/src/resources.ts` | DX1's sentences in `sourceBinding`. |

One difference from the engineering review's wording, with the same behavior: the run has no private `acceptsBoundLine(stop, line)` method; each prepared stop holds its own predicate, so the owner, the position test and the refresh check receive it without a reference to the run.

The server's `stop.bound` is still set only when its pause is inspected (ER4): nothing is copied from the owner's receipt.

### Tests: 38 added, one assertion changed

| File | Added | What |
| --- | --- | --- |
| `tests/isBindingLineAccepted.test.ts` (new) | 8 | Criterion 10's table, and that only the lines strictly between are asked of the map |
| `tests/isSavedSourceAtStop.test.ts` (new) | 3 | The predicate's table (ER8) |
| `tests/isPauseAtStop.test.ts` | 2 | The bound line once known; the rule's line while it is not (ER3) |
| `tests/isRefreshedFrameAtStop.test.ts` | 2 | The predicate before the binding; exactness after it (ER6) |
| `tests/pendingRepositoryBreakpoint.test.ts` | 4 | The rule accepts a later line and the receipt names it; a line the rule refuses; a `'declared-column'` owner ignores the rule; no `movedTo` on the declared line, while pending, or without a column (ER4) |
| `tests/configuredRuntime.test.ts` | 8 | Criteria 1, 3, 7, 7b (and the expiry before the click), three refusals of criterion 6 |
| `tests/nativeParticipants.test.ts` | 7 | Criteria 2, 4, 5, ER6, three refusals at the pause |
| `tests/crossRuntimeHistory.test.ts` | 3 | Criterion 8 a, b, d |
| `tests/configuredService.test.ts` | 1, and the one changed assertion | The inspection resource reports the bound line as `source` beside `requestedSource`; criterion 9 (DX1's sentences) |

Harnesses (ER9): `configuredRuntimeHarness` and `nativeParticipantsHarness` take an opt-in `fixture` (source text, citation end line, declared line), report later stops' bindings and hold the wait for an accepted stop's own pause open; `createConfiguredStudy` takes the citation's end line. Defaults are unchanged. Criterion 11: `git diff f9ac394 -- 'extension/src/tests/*.test.ts'` removes one line, the old help assertion.

### Red on `f9ac394`, green on the branch

The six changed product files were restored to `f9ac394`, the output was emitted with `build:fast` (the new tests name members the base does not have) and the nine touched test files were run: 225 tests, 207 passed, 18 failed. On the branch the same files: 225 of 225.

| Test (criterion) | On `f9ac394` |
| --- | --- |
| Browser stop bound on the next line is armed and commits there (1) | `Declared stop src/theme.ts:1 bound at 2:1, not on its declared line. Frozen source map positions in the selected citation: 1:1, 2:1. …` |
| Its pause is captured without the adoption wait (3) | the same text, at arming |
| Later stop moved and not reached names the bound place (7) | the same text, as the continuation's arming error |
| First stop moved and not reached names the bound place (7b); the expiry before the click keeps its text | the same text, at arming |
| Later browser stop armed inside the continuation (2) | `Declared stop src/theme.ts:1 bound at 2:1, not on its declared line. …` |
| Server stop acknowledged on the next line (4) | `Declared stop src/mode.ts:1 was not registered: Selected adapter did not acknowledge the exact breakpoint registration: {…"selectedLine":2,"selectedColumn":1…}` |
| Server stop with a pending registration bound on the next line (5) | With the adoption wait held open the stop is never captured (the test's own wait ends after 2 s). With the wait ended, the base text is `Declared stop src/mode.ts:1 bound at 2:1, not on its declared line`, which the existing test at `nativeParticipants.test.ts:1582` pins for a one-line citation |
| Stack refresh before the moved binding is read (ER6) | `Native stack refresh changed the captured source location` |
| Owner: rule accepts a later line (ER4) | `Selected adapter did not acknowledge the exact breakpoint registration: {…"selectedLine":21,"selectedColumn":7…}` |
| Owner: a refused line has no moved place; no `movedTo` on unmoved receipts | `breakpoint.movedTo is not a function` (the member is new) |
| Saved stop on a later line reopens (8a) | `Configured observation source differs from its sealed definition.` |
| Saved stop on a later line whose frame names another line (8b, second half) | `Configured observation source differs from its sealed definition.` instead of `Historical debugger differs from its verified source stop.` |
| Position test: bound line; rule's line while unknown (ER3) | the bound and the accepted line answer `false` |
| Refresh predicate (ER6) | the accepted line answers `false` |
| Help (9) | the old sentence |

Guards that pass on base and branch (10): the three browser refusals and the three server refusals of criterion 6, the `'declared-column'` owner, criterion 8d, the inspection resource, and the exact bound position of a refresh. Criterion 8b's first half (no debugger state) is a guard; its test is red on base only by its second half. The 11 unit tests of the two new utilities have no base.

### Disabled-fix controls (criterion 12, ER10)

Each part was removed from the compiled `extension/dist`, the named tests were run (green before, red with the part removed) and the file was restored. 13 of 13 checks held in 9 rows; `dist` hashed the same before and after (`0f7161ae…`).

| Row | Part removed | Tests that fail |
| --- | --- | --- |
| C1 | The rule in the browser's arming poll | criterion 1, criterion 2 |
| C2 | The bound line in the position test | criterion 3 |
| C3 | The owner's rule | criterion 4, the owner's acceptance test |
| C4 | The rule at the pause (`inspect`) | criteria 4 and 5 |
| C5 | The rule's line in the position test while the binding is unknown | criteria 4 and 5 (not captured while the wait is held) |
| C6 | The predicate of the refresh check | ER6 |
| C7 | The moved place in the continuation deadline | criterion 7 |
| C8 | The moved place in the input deadline | criterion 7b |
| C9 | The later line in the saved-study predicate | criterion 8a |

### Gates on `f234179` (criterion 13)

On this host (WSL2, Node 24.21.0, pnpm 12.4.2), in this order, each exit 0:

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,856 of 1,856 (1,818 before), 86 s of tests |
| `pnpm --dir extension test:package`, after every test process had ended | 192 of 192 |
| `node --test .codex/restore-product-context.test.mjs` | 4 of 4 |
| `typecheck`, `format:check` | passed |
| `lint` | passed with `eslint . --concurrency=2 --max-warnings=0`. The package script's `--concurrency=auto` was killed by the kernel on this host (16 processors, 7.3 GB of memory, exit 137); CI runs the script as written |
| full `build`, then `dead-code`, `dupes`, `health` | passed |
| `node extension/scripts/build-fast.mjs --check` | 684 files, 0 differences |

Criterion 14: `extension/fallow-health-baseline.json`, every `extension/src/*Schemas.ts`, the manifest's `contributes` and `extension/skills/` (bundled skill `39f03be0`) are unchanged against `f9ac394`. Health findings: 519 on base and 519 on the branch, none new; no function added by this cycle is among them. Touched functions that were findings before, cyclomatic and cognitive on base and branch: `armStop` 11/12 and 11/12, `inspect` 21/25 and 21/25, `beginAfter` 10/7 and 10/7, `action` 8/4 and 8/4, `prepareOwned` 20/19 and 20/19, the owner's `onResponse` 42/31 and 42/31, `validateConfiguredStudyEvidence` 96/103 and 94/102. `isRefreshedFrameAtStop` reached cyclomatic 5 in a first cut and was split.

### Candidate 1 and the native preparation on the Windows host, 2026-10-03

- Candidate 1: `artifacts/packages/codebook-0.2.26.vsix` (ignored), SHA-256 `b8da1251c19e88f0aedc1613a67feeb68b73a2224b7b8c42251803b4bd4ccd74`, 29 entries, isolated load passed, built from `50ced47` (product source `f234179`), 0.2.26 metadata; `codebook_status` reports build revision `50ced477`, not dirty, sourceHash `72ed8e6b…`.
- Private QA folder outside every repository: `/home/murakami/codebook-qa` (WSL).
  - Database: this user cannot use Docker (not in the `docker` group, `sudo` asks for a password), so the dashboard's `docker compose` service was not used. A user-space PostgreSQL 18.4 (`embedded-postgres` binaries, data in `codebook-qa/pgdata`) listened on `localhost:54320` with the compose file's user, password and database; `pnpm db:seed` created and filled the four tables. The compose file names PostgreSQL 16. Start: `pg_ctl -D pgdata -o "-p 54320 -c listen_addresses=localhost" -l pg.log -w start` with the binaries under `node_modules/@embedded-postgres/linux-x64/native/bin`; stop with `pg_ctl -D pgdata stop`.
  - Dashboard: dependencies installed with its own pnpm 12.6.0; an ignored `.env.local` holds `POSTGRES_URL`, a generated `AUTH_SECRET` and `AUTH_TRUST_HOST=true`. The checkout is at `1936e41` and clean. Its `.node-version` names 26.10.0; this host has 24.21.0.
  - Chrome: no Chrome on Windows (Edge only). Chrome for Testing 154.0.8037.92 for Linux is unpacked at `codebook-qa/chrome-linux64/chrome`; `codebook.chromeExecutable` points at it (its default is the macOS path).
  - Desktop control: `node wmcp.mjs <Tool> '<json>'` calls the Windows-MCP server once (stills of the 3840 × 2160 display at half size). Its typed text does not reach a WSLg window; `x.sh` runs `xdotool` (unpacked from the Ubuntu packages, no root) against the WSLg X display for keys and clicks.
- Editors found on this host (read from key names of their state stores, no secret read): VS Code 1.140.0 for Windows has no GitHub session, no user extension and has never connected to WSL. Cursor 3.23.12 for Windows is signed in and has its WSL remote server (`~/.cursor-server`).
- **Cursor through its WSL remote: refused by the product.** Candidate 1 was installed into Cursor's WSL remote (`cursor-server --install-extension`) and activated there (`remoteexthost.log`: `laststance.codebook`, 287 ms). "Codebook: Set Up AI Chat" from the Command Palette answered `Open a trusted local file workspace; remote and virtual workspaces are not supported.` (`environment.ts:55`, `requireWorkspace` refuses any `vscode.env.remoteName`). So neither Windows editor can run Codebook on a repository inside WSL: this is a product limit, not a setup step, and it is the first candidate after this cycle (see "Next action").
- **A Linux editor shown through WSLg: works.** VS Code 1.140.0 for Linux x64 (tarball, commit `07f806f9`, SHA-256 of the archive `d32031e9…`) was unpacked into the QA folder and started with its own `--user-data-dir` and `--extensions-dir` there (`DONT_PROMPT_WSL_INSTALL=1`, `--password-store=basic`), not signed in. The dashboard opened as a local file workspace and was trusted through the editor's page; candidate 1 installed with `--install-extension`; "Codebook: Set Up AI Chat" answered "Codebook AI chat is ready for this workspace."; `codebook_status` reports host `vscode` 1.140.0 and every prerequisite of `repository-browser` and `node-test` ready. The project's records hold no earlier run of the extension on Linux.
- No editor chat on this host: Copilot Chat needs the owner's GitHub sign-in and a Cursor for Linux would need the owner's sign-in; both are credentials and outside D045/D047. The checks below were therefore submitted by this agent as the driver, through the public MCP protocol of the window's Codebook server (`drive.mjs`, `n12.mjs` in the QA folder; the connection descriptor is read from the QA profile and never printed). `extension/src/client.ts` and `extension/scripts/native-repository-session.mjs` name this route ("the driving agent supplies every authored article through public MCP").

### Native check N12 on the Windows host, 2026-10-03

Level: development-native, driver-submitted, Linux. It is **not** N12-a, N12-b or N12-c as Issue #80 specifies them (an editor chat in the two QA profiles on macOS); those are NOT RUN on this host for the reasons above. Expectations were frozen before the first submission in the ignored `artifacts/cycle-0043/native/n12-expectations-v1.json` (SHA-256 `c88f1076…`, 16:26 JST) and, for the one repeated check, `n12-expectations-v2.json` (`c3476d75…`, 16:37 JST). The Mac's private `runtime.json` files are not here, so the stops and citations are the issue's and the entry path (`/login`), the two inputs (`#email`, `#password` with a wrong password), the click target (`form button`), the conditions (before: `#email` visible; after: `form p.text-red-500` holds "Invalid credentials") and the inspections are the driver's, listed in the expectation files. The article is a driver-authored source-only book (`n12-failed-login`, revision 1). Before every submission the database was checked (`pg_ctl status`, a TCP connect to 54320); the application logs hold no `ECONNREFUSED` and no "Failed to fetch user".

| Run | Check and declaration | Expected (frozen) | Actual | Outcome |
| --- | --- | --- | --- | --- |
| 1, `1cfa9c65` | N12-a′ v1: server `auth.ts` 42:11, server `actions.ts` 35:5, browser `login-form.tsx` 22:3 (citation 17-84) | All three stops; the browser stop accepted at 23:5; demonstrated | Ended 20 s after the click with `Repository input reached no verified pause`: the first stop stayed pending, no pause was reported, and the application log shows the action held for 20.0 s (`POST /login 200 in 20.0s`) and running on when the debugger was released. It was the first run after the application's `.next` was created | FAIL before the moved stop's turn, outside L (outcome policy, second case) |
| 2, `e66e4f52` | N12-d′ (optional): server `actions.ts` 32:5 and 33:5 (citation 21-41) | If the second stop binds on line 35 it is accepted and captured there | Stop 1 captured at 32:11. The adapter verified stop 2 at 35:5 and Codebook refused it: `Declared stop app/lib/actions.ts:33 was not registered: … "selectedVerified":true … "selectedLine":35,"selectedColumn":5 … Frozen source map positions in the selected citation: … 33:3, 34:5, 35:5 …`. Line 34 is a comment, and the sealed map has a position on it: the generated module keeps the comment (`original 34:5 <- generated 35:9 "// Auth.js error messages…"`) | FAIL against its expectation; the rule did what it says. Optional, does not block (see the finding below) |
| 3, `e0127774` | N12-b′: server `actions.ts` 32:5, server `auth.ts` 42:11, server `actions.ts` 36:7, browser `login-form.tsx` 74:11 (citation 74-78) | All four stops on the first run; the browser stop accepted at 75:13; after condition; demonstrated | Four stops (32:11, 42:11, 36:7, then the browser stop). Journal: `breakpoint.bound {"verified":true,"line":75,"column":13,"requested":{"line":74,"column":11}}`; inspection `source` 75:13 beside `requestedSource` 74:11, `value:state` "CredentialsSignin"; the editor's Call Stack shows `LoginForm … 75:13`, "Paused On Breakpoint", line 75 highlighted in the captured source. After condition verified, outcome `demonstrated`, capture complete, history saved, recording finalized (911 frames). Reopened through the public playback tool at 64.70 s: "Recorded pause · 64.70 s", top frame `LoginForm 75:13`, `state = 'CredentialsSignin'`, "Captured source · line 75" | PASS at this level |
| 4, `1434bb95` | N12-a′ v2: a first server stop at `actions.ts` 32:5 put before v1's three stops (the changed choice, named in the v2 file) | All four stops; the browser stop accepted at 23:5; demonstrated; reopened at line 23 | Four stops (32:11, 42:11, 35:5, then the browser stop). Journal: `breakpoint.bound {"verified":true,"line":23,"column":5,"requested":{"line":22,"column":3}}`; inspection `source` 23:5 beside `requestedSource` 22:3; Call Stack `LoginForm … 23:5`, line 23 (`<form action={dispatch} …>`) highlighted under `return (`. After condition verified, `demonstrated`, history saved, recording finalized. Reopened at 57.06 s: "Recorded pause · 57.06 s", top frame `LoginForm 23:5`, `state = 'CredentialsSignin'`, `callbackUrl = '/dashboard'`, "Captured source · line 23" | PASS at this level |
| 5, `0e30b428` | Diagnostic, not a check: run 1's declaration again, to see where the server is held | none frozen | Reached its three stops (42:11, 35:5, browser 23:5 with `breakpoint.bound … "requested":{"line":22,"column":3}`), after condition verified, `demonstrated`. Run 1's failure did not repeat | Shows that the issue's N12-a declaration passes here on a warm application; not counted |

- **Falsifier: did not fire.** In the three runs with a moved stop the paused native top frame is the accepted bound place (75:13 once, 23:5 twice), read from the editor's Call Stack in the stills and from the run's own top-frame comparison, which commits a stop only when it holds.
- **Criterion 2 natively** (a later browser stop armed inside a continuation, bound on the next line): runs 3, 4 and 5. **Criterion 8a natively** (a saved stop on a later line reopens with its native values): runs 3 and 4. Criteria 1 and 3 (a moved *first* stop), 4 and 5 (a moved *server* stop) and 7, 7b (the deadline texts) have no native observation: the only server binding that moved natively was refused by the rule (run 2).
- Cycle 0042's F is also seen on Linux: in runs 3 and 4 the adapter's own pause in `getUser` (`auth.ts:18`, 50 and 53 ms) was retired when `auth.ts` 42:11 was armed (`cdp.adapter-pause-retired`), and the run went on.
- Time from the click to the first committed stop: 5.8 s in runs 2 to 5 (a pending server stop); more than 20 s in run 1.
- DX6 (which line a saved explanation names): NOT RUN. The explanations were written by the driver and say nothing about how an editor agent reads the help.
- Image comparison with region 1 and 2 of the approved PNG (stills, 1920 × 1080 at half scale of the display): live, the application stream sits above the captured source with one highlighted line, Run and Debug on the left shows the stop's values, the Study pane beside it, and the status bar says "Recording explanation · Save learning replay"; reopened, "Recorded application" above "Captured-login-form.tsx", "(Recorded pause …)" in the Call Stack, the Learning summary on the right and one transport with striped unrecorded intervals. No element changed in this cycle. Differences seen and not part of L: the right-hand chat is VS Code's empty "Build with Agent" (not signed in); after a return from Recording to the live run the Study pane was in the bottom panel and the Learning summary view said "Open saved learning from Codebook to view its summary."; once the pane said "The Study arrangement is not confirmed." while a debugger-opened `login-form.tsx` preview tab was in the source column; captured-source tabs pile up across runs (known, AC-ENTRY).
- Evidence (all private): the five run journals under the QA profile's `globalStorage/laststance.codebook/agent/4088d8bd-…/<run>/` (`events.jsonl` SHA-256 prefixes `ab0b38ac`, `7e2d230b`, `649724e1`, `66053270`, `7f1ea193`), the MCP transcripts, inspections, manifests and stills under `artifacts/cycle-0043/native/n12-*/` (for example `n12-b/stop-4.png` `f4c327f6…`, `n12-b/reopen-2.png` `42ae96af…`, `n12-a-v2/stop-4.png` `e906df8f…`, `n12-a-v2/reopen.png` `b4174c67…`, `n12-d/06-after-refusal.png` `99c33037…`). No video: this host has no recorder, and the checks make no claim about motion.
- Cleanup: the editor was closed with its own quit, no application, Chrome or debugger process remained, PostgreSQL was stopped, and the dashboard is clean at `1936e41` (ignored only: `.env.local`, `.next/`, `next-env.d.ts`, `node_modules/`, `.husky/_/`). The QA folder stays for the next cycle. Cursor for Windows was closed after the refusal; candidate 1 is still installed in its WSL remote (`~/.cursor-server/extensions/laststance.codebook-0.2.26`) with two machine settings.

Findings of N12, none fixed in this cycle (owner, 2026-10-02: only a critical finding is fixed):

1. **N-1, a remote workspace is refused.** Codebook cannot run from VS Code or Cursor for Windows on a repository in WSL. On this host that leaves no route to an editor chat without the owner's sign-in in a Linux editor.
2. **N-2, a comment line between the declared and the bound line refuses the binding.** The sealed map of Next 16.1.4's webpack development build has a position on a comment line, because the generated module keeps the comment. Rule L counts it as a line that could run. The refusal is safe and names the bound place and the mapped positions, so declaring 35:5 is the remedy; Issue #80's N12-d expected acceptance. A rule that tells a comment from code needs a decision (the generated text at the mapped position, or the debugger's possible break locations) and its own plan review.
3. **N-3, the first server stop of the first run after a cold start is not reached within 20 s** on this host (run 1; not repeated in run 5, and the same stop was reached as a later stop in runs 3 and 4). The run ends with `Repository input reached no verified pause`, which names neither the stop nor that the action was still held. Cause not verified (the first compilation of the action, or the adapter's handling of the newly loaded scripts).
4. **N-4, a driver's first eight calls exhaust the server's sessions** when each call opens a session and only closes its transport: `MCP session limit exceeded; close idle clients.` for five minutes. The driver now ends its session (`terminateSession`); an editor's MCP client keeps one session, so this did not show before.
5. **N-5, `inspectionUri` is no MCP resource.** A `resources/read` of it answers "Resource … not found"; it is readable only through `codebook_read_resource`. The help says "Read inspectionUri"; the resource templates do not list it.
6. The extension's defaults name macOS paths (`codebook.chromeExecutable`), and the trust, Trash and process-group routes are verified on macOS only; on Linux the live path, the save and the replay worked in these five runs, nothing else was tried.

## Result and decision

- Result: pending

## Handoff

## Next action

- Exact next action: L is implemented and its gates passed on `f234179` (see "Attempts and evidence"). Continue the native preparation on the Windows host from "Candidate 1 and the native preparation": install candidate 1 into Cursor's WSL remote, open the private QA workspace, run the public setup, freeze N12's expectations for this host and run what the host allows (VS Code's Copilot Chat needs the owner's GitHub sign-in and is NOT RUN until then). Then the records (PROJECT_STATE's AC-LIVE row), the local reviews (CodeRabbit CLI is not installed on this host yet; `open-code-review-delegate` is not among this host's skills), the test timings (T) and `/ship` as 0.2.27.0.
- Changed files / branch / active processes: this record, D047 and PROJECT_STATE on `codex/cycle-0043-next-line-binding`. No editor, recorder, development server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, the assignment (D047), the checkout and the development target's path on this host.
- Durable decisions updated: D047.
