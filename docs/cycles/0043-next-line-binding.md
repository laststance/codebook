# Cycle 0043 — A stop the debugger binds on the next line is accepted there instead of ending the run

Type: product-increment with a bounded native experiment\
Status: validating\
Result: demonstrated\
Delivery: committed\
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
- After a second context compaction at about 17:10 JST, before the chat-submitted native check: PRODUCT_GOAL, the three feature contracts, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN and this record were read in full from disk again and the approved PNG was opened with the image viewer (hash `f189ee82…` verified; live explanation, learning replay with its transport and summary, the DeepWiki reader and the shortcut strip as described above). Branch `codex/cycle-0043-next-line-binding` at `26f2c31` with the uncommitted release, record and test edits; no pull request open; PostgreSQL listening on 54320 and the signed-in QA editor open.
- After a third context compaction at about 18:30 JST, during `/ship` (between its documentation audit and its commits; no implementation or native trial followed before the reads): PRODUCT_GOAL, the three feature contracts, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN and this record were read in full from disk again and the approved PNG was opened with the image viewer (hash `f189ee82…` verified; the same four regions). Branch `codex/cycle-0043-next-line-binding` at `26f2c31` with 13 uncommitted files (the release, the records, the audit's test and the documentation edits); no pull request open.
- After the session had ended at about 19:47 JST and WSL was started again at 20:41 JST (during the second `/ship` invocation, while its documentation audit was running; no implementation or native trial followed before the reads): the state was restored from the saved context, and PRODUCT_GOAL, the three feature contracts, IMPLEMENTATION, PROJECT_STATE (all of it, in four reads), DESIGN, DEVELOPMENT and this record were read in full from disk again and the approved PNG was opened with the image viewer (hash `f189ee82…` verified; the same four regions). Branch `codex/cycle-0043-next-line-binding` at `26f2c31` with 17 uncommitted files, the working tree equal to the audit's candidate (`e10b0965`); no pull request open; no editor, application or PostgreSQL process running.
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
- **Cursor through its WSL remote: refused by the product.** Candidate 1 was installed into Cursor's WSL remote (`cursor-server --install-extension`) and activated there (`remoteexthost.log`: `laststance.codebook`, 287 ms). "Codebook: Set Up AI Chat" from the Command Palette answered `Open a trusted local file workspace; remote and virtual workspaces are not supported.` (`environment.ts:55`, `requireWorkspace` refuses any `vscode.env.remoteName`). So neither Windows editor can run Codebook on a repository inside WSL: this is a product limit, not a setup step, and it is carried as finding N-1 (see "Next action").
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
6. **N-6.** The extension's defaults name macOS paths (`codebook.chromeExecutable`), and the trust, Trash and process-group routes are verified on macOS only; on Linux the live path, the save and the replay worked in these five runs, nothing else was tried.

### Native check N12 through Copilot Chat, 2026-10-03

The owner wrote "サインインするから実機チェックして" at about 17:03 JST and signed the Linux QA editor in to GitHub (the editor's authentication log shows one session from 17:06:59; no token was read or printed). The editor could not open a browser from WSL; a private `xdg-open` shim in the QA folder hands the sign-in URL to the Windows browser. Expectations version 3 was frozen before the first submission (`n12-expectations-v3.json`, SHA-256 `9a02f2ea…`, 17:07:58 JST): N12-a with the prepared declaration and N12-c with the frozen natural prompt (`586aea5696fc09d4…`), each submitted once in VS Code 1.140.0 for Linux, Copilot Chat, Agent mode, model **Auto**, Local session, candidate 1 (`b8da1251`, build `50ced477`). Level: development-native through an editor chat on Linux; Issue #80 names the macOS QA profile. N12-b (Cursor) stays NOT RUN on this host.

| Check | Expected (frozen) | Actual | Outcome |
| --- | --- | --- | --- |
| N12-a, run `9ffe5c92` | The first run reaches all three stops; the browser stop declared at `login-form.tsx` 22:3 is accepted at 23:5; after condition; demonstrated; saved from the status bar and reopened through Recording at line 23 with its native values | One submission (17:14:53), one run. `/codebook` was shown as the slash command and the chat said "Loaded the codebook tools"; Auto routed the task to Claude Opus 5.5. Stops: server `auth.ts` 42:11 (pending registration), server `actions.ts` 35:5, then `breakpoint.bound {"verified":true,"line":23,"column":5,"requested":{"line":22,"column":3}}` and the browser snapshot at 23:5 with top frame `LoginForm 23:5`, `callbackUrl = '/dashboard'`, `state = 'CredentialsSignin'`. After condition verified, `demonstrated`, recording finalized (2,886 frames, 214.4 s), four explanations saved (one per stop and a final revision). "Save learning replay" in the status bar answered "Learning saved · Open replay"; the replay's third recorded stop shows "Recorded pause · 168.29 s", Call Stack `LoginForm … 23:5`, the two values, `Captured-login-form.tsx` with line 23 highlighted and the Learning summary in place of the chat | PASS at this level |
| N12-c, runs `da149a58`, `6388a4f6`, `a081e0fa` | (1) `/codebook` loads the skill; (2) the first Codebook call is `codebook_status`; (3) the first admitted run reaches every declared stop and the observed result | One submission (17:29:41). (1) and (2) as expected. Two starts were refused before any input: `INVALID_CONFIGURATION: configuration.source and configuration.book.anchorIndex must identify a valid position in the same captured citation.` (the agent had counted the anchors per node; it republished the article with every citation in one node). The third start was admitted with five stops (server `actions.ts` 32:5, server `auth.ts` 35:9 with required `value:credentials`, server `auth.ts` 42:11, server `actions.ts` 35:5, browser `login-form.tsx` 21:3) and an invented address as input. Stop 1 was committed at 32:11 and explained; stop 2 paused at `auth.ts` 35:35 with top frame `Object.authorize 35:35` and the run ended: `Required inspection value:credentials is unavailable; captured facts remain readable.` (`credentials` is an object; the snapshot says "No bounded primitive value is available at this exact frame."). The agent started no further run and reported what was and was not observed | (1) PASS, (2) PASS, (3) FAIL, outside L |

- **Falsifier: did not fire.** In N12-a the paused top frame is the accepted bound place, in the journal's snapshot and in the editor's Call Stack (stills).
- **DX6 (N12-a).** The saved explanation of the moved stop names the bound line: "the browser paused in LoginForm at the bound position app/ui/login-form.tsx 23:5 (the `<form action={dispatch}>` JSX element; requested 22:3 `return (` was moved by the debugger to the next mapped line)", and its sequence step says "Observed LoginForm re-render at login-form.tsx:23". The agent read the help's sentence as written. N12-c has no observation: no moved stop got its turn.
- Times from the submission to the first saved explanation: 5 min 19 s (N12-a), 9 min 15 s (N12-c).
- Driver: N12-a, seven confirmations approved one at a time ("Allow" for one terminal read of the saved help, "Allow Once" for publish, two presentation calls, the return to the current run, the start and the action's result), one click for the save and one for the replay, three presses of the next-stop control. During the run the owner, who was using the editor, set the session to "Allow all" and the Auto preference to "Efficiency"; the later calls ran without a click. N12-c: no confirmation click (the owner set "Allow all" in that session about a minute after the submission), one click on Copilot's "Continue to iterate?" and one Enter in the chat's terminal, which had waited more than three minutes after bash refused its command (`!user\: event not found`).
- Driver errors, both without an effect on a result: `code chat -m agent -r` ignores `--user-data-dir`, so the first placement opened a second editor on the default profile (not signed in); it was closed and its newly created profile directory removed, and the prompts were then pasted into the QA window's chat input and compared byte for byte before Enter. One confirmation click also opened a file from a Debug Console link; its tab was closed at once.
- Before each submission the database answered on 54320; the run journals hold no `ECONNREFUSED`.
- Evidence (private): `artifacts/cycle-0043/native/n12-a-chat/` and `n12-c-chat/` (result notes, stills, the copied journals with SHA-256 prefixes `9937d28b` and `48649847`; for N12-a the prefix `3db5d0a2` noted during the check is the journal before its last event, the final saved explanation, was written, the saved explanations). No video.

Findings of the chat check, none fixed in this cycle:

7. **N-7, a required `value` inspection of an object ends the run at its pause** (`Required inspection value:credentials is unavailable`). The stop was reached and its top frame is right; the agent asked for a value the capture does not bound. It is the "required inspection" candidate of Cycles 0041 and 0042 in a new form, and it ended the only admitted run of the natural request.
8. **N-8, the anchor index is counted over the selected node's citations**, and two starts were refused until the agent republished its article. The refusal text names the rule, not the index range that would be valid.
9. **N-9, the first presentation selection was refused** (N12-a): "A destination group contains a foreign preview. Keep or move that editor explicitly before switching." with a `login-form.tsx` preview tab in the source column; the agent ran `restore` once and went on (known, AC-ENTRY).
10. **N-10, "Open replay" clicked while another window has the desktop focus** answers "Recorded playback unavailable … Error: Focus the Codebook work window before reading the learning summary."; the same click with the editor focused opened the recording.
11. **N-13, two tool answers an agent got were not examined** (labelled after the Cursor check's N-11 and N-12, which were named first). In N12-a the agent called `codebook_reveal` and `codebook_continue` for stop 2 together and the reveal answered `EVIDENCE_UNAVAILABLE`; in N12-c the image resource of the first stop answered `NOT_FOUND` for the agent.

### Native check N12-b through Cursor Agent, 2026-10-03

The owner asked at about 17:55 JST whether the Cursor trial had run ("cursorの実機試験はできましたか？"). A Cursor 3.23.12 for Linux (the AppImage unpacked into the private QA folder, its own profile and extensions directory, candidate 1 installed with `--install-extension`) was started through WSLg; the owner signed it in and directed the IDE window ("まずIDEモードにしないと") and the model without its Fast option ("fastは値段が倍以上なので、fastをはずしてください"; a first Enter with Fast on had not reached the editor, so nothing ran with it). "Codebook: Set Up AI Chat" from the Command Palette answered "Codebook skill and workspace setup saved." Expectations version 4 was frozen before the submission (`n12-expectations-v4.json`, SHA-256 `49d855d1…`, 18:00:33 JST): the declaration of N11-c's Cursor run 1 as Issue #80 lists it, submitted once in Agent with Composer 2.5. Level: development-native through Cursor Agent on Linux; Issue #80 names the macOS Cursor QA profile.

| Check | Expected (frozen) | Actual | Outcome |
| --- | --- | --- | --- |
| N12-b, run `856da254` | The first run reaches all four stops; the browser stop declared at `login-form.tsx` 74:11 (citation 74-78) is accepted at 75:13; after condition; demonstrated; saved from the status bar and reopened through Recording at line 75 with its native values | One submission (18:04:47), one run, no tool confirmation asked and no driver click during the run. Stops: server `actions.ts` 32:5 (pending, bound 32:11), server `auth.ts` 42:11 (with the adapter's own pause in `getUser`, `auth.ts:18`, retired after 43 ms), server `actions.ts` 36:7, then `breakpoint.bound {"verified":true,"line":75,"column":13,"requested":{"line":74,"column":11}}` and the browser snapshot at 75:13 with top frame `LoginForm 75:13`, `state = 'CredentialsSignin'`, `callbackUrl = '/dashboard'`. Outcome `demonstrated`, capture complete, four explanations saved, 2 min 15 s to the first one. "Save learning replay" answered "Learning saved · Open replay" after about 30 s. Two clicks on "Open replay" answered "Recorded playback unavailable … Error: Timed out waiting for identifiable primary editor focus" while a `login-form.tsx` preview tab was in the editor group; with that tab closed the third click opened the recording, and a seek through the public playback tool presented the moved stop: "Recorded · 122.82 s", `Captured-login-form.tsx` with line 75 highlighted | Run PASS at this level; reopen PARTIAL (third click, the stop reached by a driver seek, the native Variables view not opened in a still) |

- **Falsifier: did not fire.** The paused top frame is the accepted bound place (the journal's snapshot).
- **DX6.** The saved explanation of the moved stop names no line ("Stop 4 is LoginForm re-render when state equals CredentialsSignin. …").
- Explicit invocation is not judged: the sent text began "baii/codebook …", four stray characters in the input before the pasted prompt (source not identified), so it was not a slash invocation; the agent used the Codebook tools from the text. The byte comparison by copy-back did not work in Cursor's input.
- The agent reported that the Study presentation could not be opened (`PRESENTATION_UNAVAILABLE`) and ran without it; a seek to 122,822 ms, 0.02 ms before the recorded stop, shows the truthful "Not recorded at this moment".
- Evidence (private): `artifacts/cycle-0043/native/n12-b-chat/` (result note, stills, the copied journal with SHA-256 prefix `9e00a3fe`, the saved explanations, the playback answers).

Findings of the Cursor check, none fixed in this cycle:

12. **N-11, "Open replay" fails in Cursor while a foreign preview tab is open**: "Timed out waiting for identifiable primary editor focus"; the message names neither the tab nor a remedy (with N-9 and N-10: three texts for one kind of obstacle).
13. **N-12, a seek one fraction of a millisecond before a recorded stop lands in the gap.** The playback answer lists interval ends as floating-point milliseconds; a driver that rounds down misses the stop.

### Test timings (T) and the release tree, 2026-10-03

- `pnpm --dir extension test:shard --record` rewrote `extension/test-timings.json` for the 1,856 tests (112 s on this host), again for the 1,857 tests after the delivery's coverage audit had added one, and again for the 1,860 tests after the second `/ship` invocation's audit had added three. With the new file every one of the twelve CI shards plans 17.7 to 20.5 s per lane on this machine's scale (two lanes each); the absolute scale is this host's, the balance is what the plan uses.
- Release tree (0.2.27.0: `VERSION`, `extension/package.json`, `EXTENSION_VERSION`, the package test's literal, the README's package path; the CHANGELOG entry; the extension README's binding paragraph, which now states the rule and that a kept comment counts as a mapped line): `pnpm --dir extension test` 1,856 of 1,856 (85 s), `test:package` 192 of 192 after every test process had ended, the hook test 4 of 4, `typecheck`, `format:check`, `eslint . --concurrency=2 --max-warnings=0`, the full `build`, `dead-code`, `dupes`, `health` and `build-fast.mjs --check` (684 files, 0 differences), each exit 0.

### Local reviews, 2026-10-03

| Review | Coverage | Result |
| --- | --- | --- |
| Local CodeRabbit CLI | NOT RUN on this host. CLI 0.8.2 was installed into the private QA folder (with a throwaway home, so the owner's shell profile is untouched); `coderabbit review --agent --committed --base-commit f9ac394` stops at `awaiting_browser_auth`: it needs the owner's CodeRabbit sign-in, a credential (D045, D047). `coderabbit config validate .coderabbit.yaml` answered valid | Missing coverage, recorded. The owner can sign in with `coderabbit auth login` and run it on the merged range |
| `open-code-review-delegate` | `ocr` 1.12.11 (`@alibaba-group/open-code-review`, installed into the private QA folder), range mode `f9ac394..26f2c31`. `ocr delegate preview` selected 12 of 25 files; a host subagent that was given the diff and the tool's rules, not this record, reviewed 12 of 12 and skipped 0. Excluded by default and reported apart: 4 Markdown files and 9 test files. Not an independent provider | 0 critical, 0 high, 1 medium, 7 low; none fixed (owner, 2026-10-02), all carried as O1 to O8 below |

Carried from the delegated review (read from code, none reproduced):

- O1 (medium). A server stop that was registered as pending and binds on a later line when its module loads has no `movedTo`: that place comes only from a `setBreakpoints` reply, and nothing reads the adapter's `breakpoint` events (ER5 chose that). If such a stop is then not reached, the 20 s deadline keeps today's text without the bound place, while the help says the deadline's text names it. The deadline tests cover a browser stop and a loaded module.
- O2 (low). While a server stop's binding is unknown, a pause of the adapter's own on the first mapped line after the declared one is taken as the stop's and its resume ends the run (ER11 names this limit).
- O3 (low). The saved-study check accepts any later line up to the citation's end when the debugger state was saved; it has no sealed map to repeat the "no mapped line between" rule, and the study does not record that the run applied it (ER8).
- O4 (low). Three refusal texts still say "not on its declared line" and do not say which condition refused the binding (DX5 kept them); four comments carry the same wording.
- O5 (low). `verifiedPlaceSchema` repeats `bindingSchema` of the run, and `movedPlace` parses an entry the response schema already parsed.
- O6 (low). A nested conditional expression in `configuredRuntimeHarness.ts` (`reported`).
- O7 (low). The held-wait loop, `holdSourceBoundWait` and the fixture option are written twice, once per harness; without an abort signal an unreleased wait would spin.
- O8 (low). Every `acceptsBoundLine` call for a line two or more below the declared one decodes the mappings again (up to 4 MB), also inside the pause handler; the first mapped line after the declared one could be computed once at preparation.

### Delivery review through `/ship`, 2026-10-03

- **Coverage audit.** 97% of the changed paths have a test, one gap (the pending server registration of O1). The audit added one run-level test (a later server stop in a loaded module, acknowledged on the next line and not reached, names the bound place at its deadline) and an opt-in manual clock in the native harness; a read-only rating placed it at two stars, value-weighted coverage 97%. Its disabled-fix control holds (C10: with the owner's moved place removed from the compiled run the text is "… was not hit within 20 s; its line must execute after the preceding continuation"; `dist` restored byte for byte).
- **Tree and gates.** Full 1,857 of 1,857, package 192 of 192, hook 4 of 4, `typecheck`, `format:check`, `eslint . --concurrency=2`, the full `build`, `dead-code`, `dupes`, `health`, `build-fast.mjs --check`, each exit 0, twice: once as a chain and once as the plan checks of the exploratory pass.
- **Review passes.** The first specialist pass started before `extension/test-timings.json` was recorded again, so its tree snapshot could not be bound; its findings are kept and a second complete pass ran on the frozen tree (testing, maintainability, security, performance, simplification, then a red team), with the checklist by the parent. An exploratory pass asked the built rule about the real sealed maps of the dashboard (six probes: the next line accepted without the map; a kept comment on `actions.ts` 34 and a closing brace on `auth.ts` 45 refuse a later line; an earlier line and a line after the citation refused; a blank line between accepted after a complete scan). A Claude adversarial pass and a Codex adversarial pass completed; the Codex structured review answered that it found no defect to report, in a form its result checker did not accept, so it counts as missing coverage.
- **Result: nothing critical.** No reviewer found a way for a run to report a stop at a place the program did not pause at; the live path still commits a stop only at the exact bound frame. Not fixed (owner, 2026-10-02) and carried as R1 to R12:
  - R1 (Codex adversarial P1, the Claude pass, ER11, O2). While a server stop's binding is not known to the run, a pause of the adapter's own on the first acceptable later line is taken as the stop's pause and its automatic resume ends the run, also when the owned breakpoint is bound on the declared line. A false failure in a narrow coincidence, a regression against 0.2.26.0 there. Remedy: let the position test read the owner's current receipt (bound on the declared line: only that line; moved: only the moved line).
  - R2 (security, Claude pass). `isBindingLineAccepted` answers true for a line that is not a whole number; reachable only from an unvalidated `stackTrace` frame in the refresh check, and the commit still needs the exact bound position. Remedy: refuse a non-integer line.
  - R3 (Claude pass). With a map over the scan limit the preparation check for a declared line without a mapped position is skipped, so a stop declared on a blank or comment line and moved to the next line is accepted where a small bundle refuses it before the input.
  - R4 (Claude pass). Two declared stops can end on the same bound place (22 moved to 23, and 23): a re-render then commits one statement twice as two stops, or the second stop's deadline says its line must execute although it ran as the first.
  - R5 (testing, Claude pass). The owner's retirement check compares the declared line in its fallback without ids, so a moved owned breakpoint still listed without ids would count as retired; js-debug sends ids.
  - R6 (testing). No run-level acceptance two or more lines below the declared line with the real map reader; no owner test for a pending reply that names an accepted later line, nor for a replacement that clears the moved place.
  - R7 (maintainability). Comments that still say "on its declared line" (`configuredBrowserRun.ts` 114, 578, 845, 1590; `isFrameAtPosition.ts`; `resources.ts` 475; `isPauseInScript.ts`; `createBundleVerifier.ts`), a test name in `configuredService.test.ts`, "Today's text" in a `@returns`.
  - R8 (maintainability, Claude pass; O1). The help says the deadline text names the bound place; a pending server registration, a reply without a column and an unsent input give the plain text.
  - R9 (testing, simplification). The `release()` handle of the held wait is unused in both harnesses; two low-value tests (the map-argument test of the rule, the declared-line study test).
  - R10 (performance; O8). The rule decodes the whole map again for every question about a line two or more below the declared one.
  - R11 (simplification, advisory). `movedPlace` and `movedPlaceOf`, a second schema, one-caller helpers, an optional `acceptsBoundLine` that production always supplies.
  - R12 (Claude pass). A study with a moved line cannot be read by 0.2.26.0 and older ("Configured observation source differs from its sealed definition"); the rule does not check that the declared line itself cannot pause, so a later column on an executable line can slide to the next line and be accepted.
- Red team (two informational findings, also carried): R4 again (two declared stops on one bound place are not detected), and R13: a pause that is admitted as the expected stop but never announced by the debugger and never resumed is not named at the deadline, so the text says the bound line "was not hit" while the runtime is paused on it (the gap existed for the declared line; it now also covers the bound line and, while a server binding is unknown, the first acceptable later line).
- Local CodeRabbit CLI stays NOT RUN (the owner's sign-in); the pull request starts with `@coderabbitai ignore` as in the earlier cycles.

### Documentation gate and the end of the first `/ship` invocation, 2026-10-03

The documentation audit has two attempts per `/ship` invocation, never a third. Both returned `blocked`, each for statements in records that only the parent edits:

- Attempt 1 corrected `README.md` (the 0.2.26 delivery sentence), `extension/README.md` and `docs/qa/test-execution.md` (13 split files, 798 recorded names) and named six items: no Cycle 0043 passage in the README's status paragraph, this record's `Result: pending`, PROJECT_STATE's `implementing` and its figures of the earlier checkpoint only, a reference to N-13 while no finding had that label, and the CHANGELOG's "in both editors in the last two cycles" (Cycle 0042: both editors; Cycle 0036: VS Code only). All six were corrected by the parent.
- Attempt 2 added one sentence to `extension/README.md` (a server stop that was still registered as pending when the debugger bound it keeps the deadline text without the bound place; the same limit as O1 and R8) and named three more: PROJECT_STATE's "Exact resume action" still called Cycle 0042 the active cycle; "39 tests, 18 of them fail on 0.2.26" was not what was measured (the red run on `f9ac394` covered the 38 tests of `f234179`; the 39th asserts a text the base cannot produce, which is a reading of the code, not a run); and PROJECT_STATE ordered the candidates after N-7 and N-8 differently from this record. All three were corrected by the parent after the attempt, together with the wording "a preview tab of another file" (the tab was the workspace's own `login-form.tsx`, opened by the debugger, not by Codebook).

A blocked attempt is not an accepted audit, and corrections made after the last attempt have no audit at all. With no attempt left, the skill stops the invocation before any commit or publication and offers two options: stop for repair (recommended), or ship with the named documentation risk, which only the owner's own word can accept. **Decision: stop for repair** (recommended option; the owner cannot answer; no question was sent), as in Cycle 0042.

- In this invocation nothing was committed and nothing was pushed. The release tree (0.2.27.0, the CHANGELOG entry, the records, the audit's test, the timings) is in the working tree.
- The repair: a new `/ship` invocation repeats Steps 1 to 16 with its reviews and a new audit budget, on the tree that now holds every correction above.

### Second `/ship` invocation, 2026-10-03

It started at about 18:40 JST on `26f2c31` with the release work of the first invocation and every documentation correction in the working tree. An update of the delivery tool that was offered at its start (gstack 1.91.13.0 to 1.91.15.0) was postponed, so that the tool does not change between two invocations of one release.

| Step | Result |
| --- | --- |
| Tests before the coverage audit | full 1,857 of 1,857, package 192 of 192 after every test process had ended, hook 4 of 4 |
| Coverage audit (one generation pass of two) | 29 changed paths, 28 with a test, one gap (O1: the contract of a pending server stop's deadline text is undecided, so no test). Three tests added, each rated two or three stars by a read-only pass, value-weighted coverage 97%: `configuredRuntime.test.ts`, a browser stop bound two lines below across a line the sealed map has no position on is armed, pauses there and commits at the bound line (the first run-level acceptance that reads the real map; part of R6); `pendingRepositoryBreakpoint.test.ts`, a pending reply that names a later line the owner's rule accepts still blocks the input, and a breakpoint replacement after a moved acknowledgement clears the moved place (the other parts of R6) |
| Controls for the three tests | C11: with the scan acceptance removed from the compiled rule the first fails with "bound at 3:1, not on its declared line". C12: with the `verified` condition removed from the owner's later-line check the second fails with "Missing expected rejection". C13: with the moved place kept beside the registration the third fails (`{ line: 21, column: 7 }` instead of none). `dist` restored byte for byte. A mutant that only drops the failure check of `movedTo` leaves the third test green (R14 below) |
| Timings | `extension/test-timings.json` recorded again for 1,860 tests (13 split files, 799 recorded names) |
| Tests after the coverage audit | full 1,860 of 1,860, package 192 of 192, hook 4 of 4 |
| Plan audit (read-only) | 45 items: 35 done, 4 changed (the per-stop predicate instead of one run method; N12-a, N12-b and N12-d′ on Linux editors instead of the macOS profiles), 2 partial (N12-c not run in Cursor; the QA editors and PostgreSQL still running during the delivery), 1 not done (local CodeRabbit CLI: the owner's sign-in), 3 not verifiable from this host (the longest Test job after CI; the Mac's protected state; the pull request, CI, gate, merge and closure, which this delivery performs next). It also found that the recorded hash prefix of the N12-a journal had been taken before its last event; corrected above |
| Pre-landing review on the frozen tree `b3fe9db4` | The checklist by the parent; five specialists (testing 10, maintainability 7, security none, performance 1, simplification 1 advisory) and a red team (2): nothing critical |
| Exploratory pass | Six probes of the built rule on the dashboard's real sealed maps, as in the first invocation, all as the contract says; the eleven gate commands of criterion 13, each exit 0 (lint with two workers, 397 s) |
| Adversarial passes | Claude subagent completed: no way found for a run to commit a stop where the debugger did not pause; recommendation to ship. Codex structured review completed: no P1, one P2 (R1). Codex adversarial challenge: ended by its 9-minute limit with no output, missing coverage |
| Review binding | The review record, the native adversarial record and the working tree agree on `b3fe9db4578f591f72e5add146d2dd3a57c35ec3` |

Decisions (recommended options; the owner did not have to answer):

- The local CodeRabbit review stays not done and the delivery goes on; it needs the owner's `coderabbit auth login`.
- The three items that cannot be verified from this host are recorded as they are: two are performed by this delivery after the audit, and the Mac's protected state is not confirmed by anyone, because this cycle ran nothing on the Mac.
- No finding is critical, so none is fixed in this delivery.

Findings of the second invocation that the first did not have, added to R1 to R13:

- R14 (testing). The failure check in the owner's `movedTo` has no test in which a moved receipt and a failure exist together; removing it leaves every test green.
- R15 (testing). The manual clock of both test harnesses fires due timers from a snapshot: a timer cleared by an earlier callback still fires, and timers fire in insertion order, not by due time. No current test advances past two due timers.
- R16 (testing, low confidence). Three new tests cap their wait for the capture at 2,000 ms of real time.
- R17 (Claude pass). `progressDeadline` reads a reason given as a function inside the timer callback before it fails the run; if that function threw, the deadline would be lost. No current reason function throws.
- R18 (red team). The help says "Any other binding on another line fails at once". For a server stop that was still pending, a refused line is only seen at its pause, about 3 s after it, or never when that line does not run; the extension README has the qualifier, the help does not.
- R19 (red team, low confidence, read from the editor's code, not reproduced). The editor removes duplicates of breakpoints by their verified position, so an owned breakpoint the adapter moved onto a line where the learner has a breakpoint can make the editor drop the learner's one at the next breakpoint change. The same holds for a moved column on the declared line.
- R7 gains two places: the `@throws` of `registeredStop` ("by acknowledging another line") at `configuredBrowserRun.ts` 606 and "Today's text" at 661.

### Owner direction on carried defects, 2026-10-03

During the second invocation the owner asked whether carried problems are all fixed in the next cycle. They were not: each cycle took the first blockers, and the rest stayed in the cycle records. The owner then set an absolute rule, in two messages:

> 持ち越した不具合は次のサイクルで強制的にすべて修正してください。サイクルのプランニングは手順通り持ち越し不具合を一切考慮せず、最終製品を作るために必要な作業を計画してください。それに加え持ち越し不具合の全修正タスクが自動的に追加されます。これはこのサイクル式開発フローの絶対的なルールです。スキルはこのフローにアレンジして適合させてください。

> DECISIONSファイルも不要。意思決定で制定されたルールをそれぞれ適切な必読ファイルに宣言的に記述してください。specに関してはok、記録してそれで終わりになってしまうのでTODOSのようなファイルで持ち越しを記録するのも禁止です。

Effect, in this delivery: the rule is stated in AGENTS.md ("Cycle rule") and DEVELOPMENT.md (the two-part Issue, the arrangement of each skill, the sources of truth); the cycle template has a carried-defect section; DECISIONS.md takes no new entry, its header says so, and no TODOS file or ledger of unfixed defects is created. This delivery itself is unchanged: nothing found is critical. Every finding this cycle leaves unfixed is a task of Cycle 0044. The rule applies from Cycle 0044 on: Cycle 0043 was planned before it and closes with what earlier cycles had left open (SR21 and SR24 of Cycle 0042 among them), and Cycle 0044 takes those as well.

### Documentation gate of the second invocation, 2026-10-03

The first documentation audit of this invocation started at about 19:35 JST on the candidate tree `e10b0965` and did not return: its last recorded step is at 19:46:49 JST, the session ended there, and WSL was started again at 20:41 JST. It made no edit and gave no result. An audit that exits without output is a blocked attempt, so one attempt was left.

Its saved transcript shows what it was about to name, every item a statement in a document:

- DEVELOPMENT.md said that no ledger exists while it and IMPLEMENTATION.md call PROJECT_STATE's gap table a ledger; it kept "at most a short list of follow-ups" beside a rule under which no carried defect is reduced; and its table of skills had no arrangement for the two audits of `/ship`, although AGENTS.md counts an audit's findings among the carried defects.
- AGENTS.md did not say from which cycle the rule holds, while this cycle closes with SR21 and SR24 of Cycle 0042 open.
- The cycle template still had "Durable decisions updated" and no place for carried defects; the header of DECISIONS.md still told the reader to record decisions there.
- PROJECT_STATE named an order "in the cycle record's order" that this record does not state; this record called the refused remote workspace "the first candidate after this cycle" and said that the commits are in the `/ship` sections, where none is listed.
- The extension README said that a refused binding of a server stop fails about 3 seconds after its pause; that holds for a stop that was still registered as pending, and a stop in a loaded module is refused at its registration.

All of them were corrected before the second and last attempt. The parent corrected this record, PROJECT_STATE and the extension README's sentence, and two clock times in this record that were an hour late (the third compaction, about 18:30 JST, and the start of this invocation, about 18:40 JST; the session's own timestamps). The owner read the proposed wording for the rule's documents after the restart and approved it (2026-10-03, about 20:50 JST): AGENTS.md says that the rule is in force from Cycle 0044; DEVELOPMENT.md says "ledger of unfixed defects", separates candidate increments from carried defects and has a row for the coverage audit and one for the documentation audit; the cycle template has a carried-defect section and "Owner rules stated in the required reads"; the header of DECISIONS.md says that the log is closed; the README's link reads "closed decision log". No product source, test or build input changed: the tree differs from the reviewed tree `b3fe9db4` in authored documents only.

The delivery's scratch files (the commit script, the pull request text, the closing comment) were in `/tmp`, which did not survive; they were rebuilt from the session's transcript and are now kept in the private gstack state of this machine.

## Result and decision

- Result: demonstrated, with the limits below. A verified binding on a later line is accepted under rule L at every site that refused it, and an accepted binding never claimed a place the program did not reach: in every native run with a moved stop the paused top frame is the bound place, and the falsifier did not fire. The rule needed no stored-format, schema or tool-shape change.
- Level reached: mechanism (38 tests, 18 red on `f9ac394`, nine control rows, every gate; four more tests from the delivery's two coverage audits with control rows C10 to C13) and development-native on a Linux VS Code: with this agent as the driver (runs 3 and 4: a later browser stop bound on the next line, accepted, demonstrated, saved and reopened there) and, after the owner's sign-in, through Copilot Chat Auto (N12-a: the declaration that ended N11-c's first run in VS Code passes on its first run, the stop is accepted at 23:5, saved and reopened there, and the agent's explanation names the bound line, DX6).
- Also reached after the owner signed a Cursor for Linux in: N12-b, the declaration that ended N11-c's first run in Cursor, passes on its first run in Cursor Agent (Composer 2.5) with the stop accepted at 75:13 and saved; its reopen is PARTIAL (N-11).
- Not reached: N12-a and N12-b ran on Linux, not in the macOS QA profiles the issue names; the natural request was not run in Cursor. The reason for the latter (a decision of this agent when expectations version 4 was frozen, written down here afterwards): the two things that ended the natural request in VS Code are Codebook's own answers to what an agent declares (N-7, N-8), not a property of the host, so a Cursor submission would most likely have ended on the same two before any moved stop, and the owner had just asked to keep the Cursor trial's cost down. It is carried to the cycle that takes N-7 and N-8. N12-c, the natural request, is FAIL in its run part: the only admitted run ended at its second stop on a required inspection of an object (N-7), after two starts refused for the anchor index (N-8); no moved stop got its turn, so it says nothing about L. A moved first stop, a moved server stop and the two deadline texts have no native observation; N12-d′ failed against its expectation (N-2). A natural request that passes on its first run is still not seen.
- Decisions taken without the owner (D045, the recommended option each time):
  - The plan reviews' amendments DX1 to DX6 and ER1 to ER12, each with its outside voice's findings applied.
  - On this host the native check runs through a Linux VS Code and the public MCP protocol, frozen as its own expectations, instead of stopping at "no editor chat".
  - N-2 (a comment line with a mapped position) is not fixed here: N12-d never blocks the delivery, the refusal is safe and names the remedy, and telling a comment from code is a rule change that needs its own review.
  - The delegated review's medium finding O1 and its seven low findings are carried, not fixed (owner, 2026-10-02).
  - `/ship`'s plan audit named two plan items as not done (N12-c, DX6) while no editor chat was available; after the owner's sign-in both ran (N12-c with a FAIL outside L, which is a result under the issue's outcome policy), and the delivery goes on. N12-b ran after the owner's Cursor sign-in.
  - The delivery review's findings R1 to R12 and the red team's R13 are carried; R1 is judged not critical because it is an explicit failure in a narrow coincidence that the engineering review named (ER11), not a stop reported where the program did not pause.
  - The chat check was submitted once per prompt, as frozen; the natural request was not repeated after its FAIL.
  - The chat findings N-7 to N-13 are carried, not fixed.
  - The second invocation's findings R14 to R19 are carried too; under the owner's rule of the same day every carried finding of this cycle is fixed in Cycle 0044.
  - Local CodeRabbit is recorded as missing coverage instead of signing in.
- Keep: rule L, its sites and its texts. Fixed next, all of them (the owner's cycle rule): R1 to R19, O1 to O8 and N-1 to N-13, among them a required inspection the capture cannot bound that ends an admitted run (N-7, now the first blocker of the natural request), the anchor index refusal (N-8), what counts as "a line that could run" between the declared and the bound line (N-2), and the deadline text of a pending server stop (O1).

## Handoff

- Gaps before and after. AC-LIVE: before, a stop the debugger binds on the next line ended the first admitted run of the natural request in both hosts; after, such a binding is accepted (mechanism, and natively for a later browser stop on Linux, driver-submitted, through Copilot Chat Auto in VS Code and through Cursor Agent with Composer 2.5). Still open in AC-LIVE: a natural request that passes on its first run in an editor chat, in either host; its first blocker is now N-7. AC-SAVE: a saved stop on a later line reopens (mechanism and native on Linux, also from the chat run). AC-SKILL: the help states the rule and an agent explained the bound line from it; `/codebook` loads the skill and the first call is `codebook_status` on Linux VS Code; a remote workspace refuses the setup (N-1). No regression seen: the full suite passes and the replays of the saved studies presented their recorded moments.
- Changed hypothesis: none for L. For the route: the Linux VS Code of the QA folder is signed in since 2026-10-03, and a Cursor 3.23.12 for Linux in the same private folder is signed in too, so both chats can run on this host; the Windows editors still cannot (N-1).
- Review, CI, merge, package, publication, installed status: the reviews are in the two `/ship` sections above; the release commits follow the documentation audit and are listed on the pull request. CI on the pull request head and on `main`, the gate, the merge and the closure are recorded on the pull request and in Issue #80's closing comment, and carried into this repository by the next cycle's branch, as for the earlier cycles. 0.2.27.0 is not packaged for installation, installed or published; the native runs used candidate 1 (0.2.26 metadata, product source `f234179`).

## Next action

- Exact next action: finish the delivery of 0.2.27.0 (`/ship`: the documentation audit, the commits, the pull request with `@coderabbitai ignore`, CI on the head, the separate exact-HEAD gate, the merge in its own step with `--match-head-commit`, CI on `main`), then close Issue #80 by hand with the outcomes that are not PASS and every carried defect named. Then Cycle 0044 under the cycle rule of AGENTS.md: `/spec` plans its increment from the goal and the gap audit alone, and the Issue receives, in full and without selection, every defect this cycle leaves unfixed (R1 to R19, O1 to O8, N-1 to N-13). The findings that Cycles 0031 to 0042 left in their records (among them SR1 to SR34, F1 to F10, D1 to D14, the numbered findings of Cycles 0038 and 0039 and the Cycle 0031 UI items) were never fixed in a next cycle either; Cycle 0044's Issue takes those that are still open in the same way, each read against the current source first.
- Prerequisite the owner can give at any time: `coderabbit auth login` lets the local CodeRabbit review run.
- Changed files / branch / active processes: branch `codex/cycle-0043-next-line-binding`. The two signed-in QA editors (VS Code and Cursor for Linux) had been left open because the owner was using them (the owner installed the Codex extension into the VS Code profile during the check); they and the user-space PostgreSQL ended with WSL at about 19:47 JST (it was started again at 20:41 JST), and their signed-in profiles stay in the private QA folder. No development server, Chrome or debugger process of a run remains.
- State updated in PROJECT_STATE.md: the active cycle, the assignment (D047), the checkout, the development target's path on this host, the AC-LIVE, AC-SAVE and AC-SKILL rows and the one next action.
- Owner rules stated in the required reads: the cycle rule of 2026-10-03, in AGENTS.md and DEVELOPMENT.md, with the cycle template's carried-defect section and the closed-log header of DECISIONS.md (the owner's direction). D047, written at this cycle's start, is the last entry of that log.
- Defects this cycle leaves unfixed (all go to the next cycle's Issue): R1 to R19, O1 to O8, N-1 to N-13.
