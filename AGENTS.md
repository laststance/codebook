# codebook agent instructions

Single entry point for every coding agent; Codex and Claude Code (v2.1.281+) load it as project instructions. Keep agent instructions here: a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the repo or any directory above would replace this file for Claude Code.

## Mandatory entry

Before planning, implementation or runtime trials:

1. New session, or PRODUCT_GOAL.md changed: read [PRODUCT_GOAL.md](PRODUCT_GOAL.md) in full except `## Final acceptance protocol`; open [the approved PNG](assets/codebook-product-spec-v9.png) with an image tool; read the active cycle Issue (open, label `cycle`) with comments (`gh issue view <N> --comments`).
2. After every context compaction, before any other work, whatever the task: read PRODUCT_GOAL.md in full, every line; open the PNG with an image tool and check its identity; then read the active cycle Issue with comments. This file is already loaded as project instructions: reread it from disk only when its text is not in context or it changed on disk since the session began. Top rule: the goal and the image are the final product every token is spent for; a plan or change made without them is waste. A compacted summary, the restore hook's text or an earlier read is no substitute.
3. Final acceptance selected: read [`## Final acceptance protocol`](PRODUCT_GOAL.md#final-acceptance-protocol).

The PNG is the product to build:

- View it; match it to the identity (file, size, SHA-256) in [Design target](PRODUCT_GOAL.md#design-target); find its live, replay, DeepWiki and shortcut regions. A filename, prompt or alt text does not count.
- Then verify branch, dirty files, tools, runtime, PR state; record the reads and image inspection in the Issue.
- A missing read, image check or gap audit = entry incomplete: continue independent preparation and report it.

## Where things live

- **Cycle Issue** (label `cycle`, title `Cycle NNNN: <outcome>`) = state. Body: Outcome, Tasks, Owner decisions, Next action; edit it when state changes.
  - Tasks: numbered checklist, one line each (source, defect, what closes it); close with "fixed in <sha>" or "evidence: <one line>". A finding during a bug-fix cycle = one more task.
  - Near GitHub's 65,536-character limit: continue the list in one pinned comment.
- **PR** = results (gate, CI, native QA summary) + Issue reference.
- **Issue closing comment** = outcome + every carried defect; the next bug-fix Issue, written before other work, copies that list. A bug-fix cycle states nothing is carried (`/spec` starts a feature cycle); defects the ship review limit records are named, and the next cycle is bug-fix.
- **CHANGELOG.md** = what each version changes for users.
- **Tag `docs-archive-2026-10-20`** = every record and document removed here.

Read the archived docs before the work each governs (other records, prompts, external references: only when needed):

- [behavioral design](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/designs/codebook.md): live, capture, replay, runtime, storage, evidence ownership, cross-feature architecture.
- [UI state and interaction review](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/cycle-0029-product-design.md): UI implementation, visual verification.
- [G12 bundled skill plan](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/bundled-codebook-skill.md): shared skill, onboarding.
- [Wiki generation skill plan](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/deepwiki-generation-skill.md): Wiki generation, update.
- Bring relevant GStack cache findings into the Issue; needed evidence never only in chat or a cache.

## Cycle rule

Fix every carried defect in the next cycle; sole exception: the [ship review limit](#delivery). No planning choice, review outcome or skill default overrides this; a feature cycle starts clean.

- **Dependencies first**, every cycle (both kinds), before other work.
  - Run `pnpm --dir extension update --latest '!@types/vscode' '!@vscode/*' '!@types/node' '!typescript'`, then move `@types/node` to the newest version of the pinned Node major and `typescript` to the newest 6.x.
  - No TypeScript 7: the native port has no JS API for ESLint.
  - Fallow always follows its latest release, majors included: catching up later is costlier than scoring a small step.
  - VS Code packages, `engines` and the Node pins stay as they are: a newer VS Code API than Cursor's breaks the extension in Cursor.
  - Keep exact pins, fix breakages, pass the checks, commit on the cycle branch.
  - A Fallow or c8 version change follows the [Fallow](#commands-and-checks) retake rules.
  - Small steps keep breaking changes cheap and security fixes immediate. A high `pnpm audit` advisory found mid-cycle is a defect of that cycle.
- **Defect** = a Critical or Major finding (a review marks it critical, major, high, blocking, P0 or P1) or a failed gate, CI or native check. Medium, Minor, Low and informational findings, test gaps and doc debt are no defects: fixed when cheap and in scope, else answered Skip and named once in the PR or a short later-candidate list; they never start a bug-fix cycle.
- **Feature cycle**: an increment of the final product. Starts only with nothing carried in; planned from the final product alone (`/spec` + plan reviews, from PRODUCT_GOAL.md and the gap audit). Defects it leaves unfixed are carried.
- **Bug-fix cycle**: follows any cycle that left a defect; fixes those, nothing else.
  - Issue: each defect a task (source: cycle + finding label; closing fix or evidence; the test failing without the fix). No increment; nothing selected, dropped or reduced.
  - Carries nothing: defects found in it (implementation, review, delegated review, native check, audit) are fixed in it, except Critical/Major ones the ship review limit records.
  - Closes when every carried and found defect is closed → feature cycle, or another bug-fix cycle for defects that limit recorded.
- A defect closes by a fix + a test failing without it, or recorded evidence it is no defect / no longer applies.
- Carried defects live in the bug-fix cycle's Issue as tasks; a TODOS file, backlog or ledger of them is forbidden (a list that only records lets work end at the recording). Later candidate increments: a short list at most, never holding a carried defect.
- Delivery: feature cycle fixes Critical findings before merge, carries Major ones; bug-fix cycle fixes every Critical/Major finding before merge, except as the ship review limit allows. Same for every source (`/review`, `/ship`, local CodeRabbit CLI, delegated review, native check, audit) and for a failed gate, CI or native check; below Major per the defect rule.

## Working loop

Goal and visual target → gap audit → one observable increment → implementation and proof → updated gaps. One active cycle, in its authorized phase.

1. **Audit** (Issue = gap ledger).
   - All [acceptance map](PRODUCT_GOAL.md#product-acceptance-map) rows at a new cycle, goal/design change or unassessed source change; else verify baseline and changed paths, inspect affected rows, justify carrying the rest (a docs-only commit may keep the product-source baseline, said so).
   - Per row, from source and evidence: **implementation** (match, concrete mismatch, or UNKNOWN + next inspection; an existing file, symbol or spec proves no behavior); **proof** (result, host, OS, identity, level, link; absent/stale = unverified; source mismatch and missing runtime evidence = separate gaps); **next action** (change or bounded experiment + verifying observation; UNKNOWN = investigate, never "implemented"/"absent").
   - Gate: all rows and active goals covered; baseline and affected IDs recorded. A read receipt, goal-link list, linked goal ID or old PASS proves nothing.
2. **Select** the smallest connected behavior or bounded experiment closing a gap or settling the highest-impact unknown that could invalidate later work; core-experience blockers before polish; plan only that.
   - Inspect existing code, then freeze in the Issue: AC IDs (primary, dependency, regression); gap and why now; starting action → expected result, failure behavior, modules, falsifying observation; procedure, target, host, evidence level, result location.
   - Changed assumption = new expectation version; keep old attempts.
   - Gate: action follows from the audit; checkable outcome. An open product gap overrides no documentation-only assignment. Repeated inconclusive attempts → smaller question or new hypothesis, never silent loss of required behavior.
3. **Prove** the normal user entry through its result, recovery and preservation included.
   - Reuse modules and real package scripts; mechanism tests for logic, declared native checks for product claims.
   - Record identities, actions, expected/actual results, artifacts, limits as NOT RUN, PARTIAL, FAIL or PASS; a listed command is no execution evidence.
   - Gate: evidence supports the outcome at its declared level. A failed/inconclusive experiment names the next hypothesis, proves nothing; code resolving uncertainty = an experiment; increments need regression evidence; a plan grows only with its question; a build alone completes no live, replay or Wiki outcome.
4. **Reassess** changed and dependent rows and regressions.
   - Keep unaffected evidence only with an impact reason; compare gaps before/after, keeping missing implementation, missing proof and UNKNOWN; nothing advances because a checkbox, skill, image or PR is done.
   - Keep, revise or replace the approach; update the Issue with results + one executable next action; check the route still reaches every goal and the next candidate hits the largest blocker.
   - Gate: rows, checks, UI comparisons recorded; a fresh agent recovers product, gaps, proof, phase, failed approaches and next step from repo + Issue, never chat (`/context-save` only speeds this). Markdown = auditable procedure, not proof of comprehension.

## Delivery

Driving agent owns state, cycle selection, completion claims; GStack supplies workflows.

**Chain.**

- One bounded cycle at a time toward the complete product; after each merge `/spec` (+ the plan reviews the scope needs) writes the next cycle's Issue.
- Work on a `codex/` branch; keep existing edits; reuse a fitting checkout.
- Per cycle: one **review round** (4 local CodeRabbit CLI passes on the cycle's final range + 4 `open-code-review-delegate` (OCR) reviews, all in parallel) → its fixes → `/ship` as PR (native checks: [Native QA](#native-qa)) → required CI → separate exact-HEAD gate → merge as its own step with `--match-head-commit`.
- One round only: after its fixes go straight to `/ship`; no second round to recheck them (the `/ship` review catches what they break).
- Parallel reviews: start every review that reads no other review's result at once, never one after another; a review waits only for a result or tree it reads (`/autoplan` phases stay in order, each reviewing the previous phase's amendments; a fix-check waits for its fix).
  - Examples: the round's 4 CodeRabbit CLI passes (one worktree each, within the included hourly reviews, never `--use-credits`) with its 4 OCR delegates (split by review lens when few files qualify); `/ship` pass 1's reviews (Codex structured review, red team, specialists); a plan-review phase's native and outside voices (outside one in a background shell, then the native agent).
- Parallel fixers: choose the fixer count and item split that finishes soonest, cost no object. Independent items needing no knowledge of each other → one subagent each (100 such items → 100 subagents, each in its own worktree from the branch head); only items sharing a file region or depending on another's result share a subagent or run in order. Integrate by cherry-pick, then one full suite.
- A large cycle may use up to three PRs (`cycle100-pt1`, `cycle100-pt2`, …), each passing reviews, CI and gate alone, merged in order; the Issue closes after the last.
- Codex automatic review off (no Codex cloud step).
- Hosted CodeRabbit off from Cycle 0057: `.coderabbit.yaml` keeps `reviews.auto_review.enabled: false` (CodeRabbit reads the PR branch's file); never post `@coderabbitai review`, no `@coderabbitai ignore` in PR bodies. Merge waits for no hosted review or approval; a hosted review that still appears → report it in the PR, its findings follow the cycle rule like the local review's; run the local CodeRabbit CLI on the PR's final range before merge.
- Outside review early: `/ship` Step 9 pass 1 also runs Step 11's Codex structured review (`codex review --base main`) on the whole diff, its findings part of pass 1; a plan changing process signalling, process identity or a stop/kill path also gets a Codex review before implementation. A fix-range pass (pass 2 on) under 300 changed lines dispatches the red team and the specialists whose area the range changes.

**Delivery parameters.**

- Merge: `node extension/scripts/merge-pr.mjs <n>` after the exact-HEAD gate in this checkout at the PR head (`--help` lists the checks it enforces): squash with `--match-head-commit <head>`, then fast-forward the local `main`; `CodeRabbit` never gates. Hand fallback, only for a defect of the script itself (named in the PR): `gh pr merge <n> --squash --match-head-commit <sha>`.
- Cycle time report: right after each merge, comment on the merged PR with the cycle's start (its Issue's creation) and completion (this merge) times and the time per work phase and step (spec, each /autoplan phase, implementation, each review and fix round, `/ship` with its native checks, CI, the gate, merge). Take times from recorded timestamps (Issue, commits, logs, `timing.json`); keep a running timeline in the cycle while it works; a cycle of several PRs reports the cycle so far on each.
- `/ship` documentation candidate (`gstack-docs-candidate snapshot`) `--docs` roots: AGENTS.md, CHANGELOG.md, PRODUCT_GOAL.md, README.md, `extension/README.md`, `extension/skills/codebook/SKILL.md`, the v9 PNG.
- CI packages via `node extension/scripts/package.mjs --out artifacts/packages/codebook.vsix`, checks via `node extension/scripts/check-package.mjs artifacts/packages/codebook.vsix` (`package.yml`).
- Release commit: besides version files and CHANGELOG.md, one test line (expected version in `extension/scripts/tests/package.test.mjs`); `/ship` Step 16 counts it as release metadata, not a reviewed-tree change. Order: `/ship` Step 12 writes `VERSION` and the CHANGELOG heading → `node extension/scripts/bump-version.mjs <VERSION>` writes the three three-part places → Step 13 writes the entry → `bump-version.mjs --check` exits 0 (`test:package` fails any commit whose five places disagree).

**Pre-gate:** `/ship` pre-gate = Stage 1 only: `gstack-pregate --stage preflight --allow-repo-commands`, secrets scan every time. Test lanes (Stage 2) = `pnpm --dir extension test` on the final tree + required CI.

**Background work.**

- `node extension/scripts/watch-background.mjs` (from Claude Code's start directory, else `--project <it>`) lists this session's (`CLAUDE_CODE_SESSION_ID`) background tasks and subagents with last-output time; marks those silent > 20 min, never finished/stopped subagents; a shell's row stays marked after it ends (its task notification is authoritative).
- Review subagent silent 20 min → stop it, redispatch on a narrower scope.
- Subagent stopped by the API safety filter → redispatch at once, same brief, fallback model.
- Waiting more than a few minutes → tell the owner what is awaited and since when.

**Ship review limit.**

- Installed `/ship`: max three fixing cycles; no fourth, no counter reset after a handoff, no round relabeled a repair. The limit is `/ship`'s alone (one round is long; full convergence would stall delivery).
- Third cycle still has findings (`converged:false`) → feature and bug-fix cycles alike, per the defect rule:
  - fix every last-round Critical/Major finding and the cheap in-scope lower ones; a Critical never merges open (one the PR cannot close holds the merge until fixed); answer the rest Skip, named once in the PR;
  - record only still-open Critical/Major defects in a GitHub Issue (next cycle's tasks): defects of `/ship` rounds the PR cannot close (e.g. a Major finding whose fix/proof needs an unknown root cause or a native check); this overrides no-carry for those only;
  - merge after required CI + exact-HEAD gate, reporting `converged:false` in the PR.

**Skills** (read each installed SKILL.md at invocation; this map guides, copies no workflow):

- Premise/final behavior → `/office-hours` or `/plan-ceo-review` (owner decision).
- Lasting API, MCP or integration change → `/plan-devex-review` (capability, error, lifecycle contract).
- Flow, layout, hierarchy, interaction → `/plan-design-review` (UX and state decisions).
- Architecture, concurrency, storage, meaningful code → `/plan-eng-review` after UX/API amendments (bounded implementation and test plan).
- Combined review on owner request → `/autoplan` (CEO → conditional Design → conditional DX → Eng).
- Unexplained failure → `/investigate` (root cause, new hypothesis).
- Working browser/webview flow → `/qa` or `/qa-only` (observed behavior, fixes).
- Implemented UI → `/design-review` (real visual and interaction evidence).
- Ready diff → `/review` (revision-bound findings, coverage limits).
- Releasable PR → `/ship` (actual commit, PR, checks).
- Merge/deploy → `/land-and-deploy` if available, else the established extension delivery.
- Changed public behavior → `/document-release`.
- Pause/handoff → `/context-save`, then `/context-restore`, reconciled with repo and Issue.
- Ordinary coding = agent's work; docs-only changes need only the applicable reviews; a failed experiment may inform the next cycle before release.
- Browser QA (Reader DOM included) proves no native pixels, DAP targeting, MCP integration or installed VSIX behavior; missing tool → report as missing coverage.

**Skills under the cycle rule** (each runs as installed):

- `/spec`: plans a feature increment from PRODUCT_GOAL.md + gap audit, or writes a bug-fix Issue from the previous closing comment (one task + acceptance criterion per carried defect, nothing ranked or selected).
- Plan reviews may change how a carried defect is fixed; never remove, merge away or defer one.
- `/review`, `/ship` review steps follow the [Cycle rule](#cycle-rule)'s Delivery bullet; no automatic fixes of informational findings.
- `/ship`: commit the coverage audit's tests; plan completion audit counts an open bug-fix task NOT DONE and stops (no ship anyway, defer or drop); TODOS step writes no TODOS.md; fix documentation-audit blockers before commit.
- Test gap, deferral, non-blocking doc debt, skill follow-up: later candidates, no carried defects.

**Invocation.**

- Pass Issue, phase, bounded scope explicitly; PRODUCT_GOAL.md = destination, not permission to build everything.
- Retired G08/G09 never return via an old prompt.
- Give design skills `## Design target` and the PNG.
- Honor scope gates, passing no agent-chosen target off as the user's; keep required reports; one approved recommendation authorizes no unrelated change.
- Shared-skill and Wiki-generation scope → DX + engineering review; discovery, loaded identity, runtime connection, AI-owned results are separate checks; Wiki works without runtime/debug MCP.

**CodeRabbit and OCR.**

- [.coderabbit.yaml](.coderabbit.yaml) = policy + exclusions: keep its guidelines current; validate with `coderabbit config validate .coderabbit.yaml`; pass it via `--config` beside extra context.
  - CLI 0.9.1 exits 1 on every file with `unknown keyword: "x-undocumented"` (its own schema defect): record that line as the validation result; a review with `-c` still applies the file.
- Required: local CodeRabbit CLI, findings triage, CI, OCR (it picks files and rules, the host reviews; each eligible file reviewed or skipped with a reason; default exclusions reported apart; no independent external review).
- Review against the implementation base; record completion, source cut, covered files, findings.
- Missing/private provider context = coverage limit.
- Every user-visible behavior a CHANGELOG entry names needs a sentence in the packaged README (`extension/README.md`), as `.coderabbit.yaml`'s `CHANGELOG.md` instruction checks; a fix changing user-visible behavior changes that README in the same commit; fixers' briefs say so.
- Claude Code CLI review: skipped; no native chat acceptance.

**States** (independent):

- Status: ready → planning → implementing → validating → closed, or blocked with condition + unblocking action (say why work moves back).
- Result: pending, demonstrated, falsified, inconclusive.
- Delivery: not-applicable, local-only, committed, PR-open, merged, packaged, published, installed-verified.

**Closure.** Name the next cycle's kind; after a clean bug-fix cycle, at most one candidate increment. Run integrated checks once capabilities depend on each other. A shipping task stays open until its authorized gates finish.

**GitHub.**

- [laststance/codebook](https://github.com/laststance/codebook) is public: everything pushed (Issues, PRs) is world-readable, a security defect before its fix too.
- Goal Issue [#1](https://github.com/laststance/codebook/issues/1) stays open until full acceptance + owner approval.
- Use `goal` and `cycle` labels; link PRs and evidence; choose Issues from evidence, never a speculative roadmap or a planning tool's need; a closed Issue alone proves nothing.
- Close a cycle Issue only for a demonstrated or falsified outcome with complete delivery (an inconclusive investigation may stop with its outcome open).
- GitHub unreachable → keep the Issue edit pending.
- Tracking is authorized; production deployment, publication and recurring automations need the user's authorization.

## Standing directions

No decision log; delivery chain and ship limit: [Delivery](#delivery).

- **Fallow scores application code only:** `extension/src` without `src/tests`, plus `extension/skills`; tests and `extension/scripts` excluded ([checks](#commands-and-checks)).
- **Everything for the product:** all resources to the fastest, highest-quality build of PRODUCT_GOAL.md's application.
  - Skip a rule, convention or skill step that plainly adds nothing to the product instead of following it by habit.
  - Docs unrelated to the application ride on the current work branch: no separate PR, no wait on CI with an obvious result.
  - Still forbidden: spending money without the owner's permission; anything illegal. Irreversible steps under **Never without the owner** still wait for the owner.
- **Every agent rule in AGENTS.md:** every agent rule and procedure lives in this file. Never create a `docs/` folder or another rule or procedure document, even when a review suggests one. Assets such as the approved PNG live in `assets/`.
- **Process feedback:** a development-flow step that wastes much time, or a step the rules lack for completing the product, once noticed → a post in the repository's [GitHub Discussions](https://github.com/laststance/codebook/discussions) (category Ideas): observation, evidence, cost, proposal. Public: no private paths or secrets. The current cycle continues meanwhile.
- **The owner cannot answer:** every decision point → the recommended option, named in the Issue's Owner decisions. Owner-directed pause → stop at once; only the owner's explicit message lifts it. A conditional pause ("when X is done, stop") is not immediate.
- **Dedicated Windows development machine:** setup and repair (IME settings, QA reinstall/reset, needed data removal) need no new permission. Spend the time on live explanation, save and synchronized replay. Remedy truly needing the owner → research it, finish independent preparation, give concrete verified steps. Outcomes and gates still govern.
- **Never without the owner:** buying credits, subscription or billing changes, new or changed credentials, permanent deletion, security settings, repository visibility.
  - Signing in with the owner's existing sessions to what the work needs = the agent's job, without asking.
  - Preserve the owner's and others' edits, profiles, extensions, skills, settings, tabs, drafts, learning, target source, credentials.
- **Varied questions; learning fits the question:** learners study many processes in many codebases.
  - Trials, evaluations and examples ask natural questions about different code paths and processes of the target, varied across rounds and hosts; never one fixed prompt (a cart, login or invoice example) round after round.
  - The v9 PNG fixes screen hierarchy and interactions, not learning content: summaries, sequence diagrams and explanations are generated per question as clear, graphical learning resources from what actually ran.
  - Never shape the skill, the generation, help examples or acceptance to reproduce the image's sample flow, participants or text.
- **Who operates a native check:** the driving agent itself (chat submissions, replay checks, every native check a row owes), never a subagent; implementation may run in subagents.
- **Trial coordination:** dedicated VS Code and isolated-profile Cursor trials need no screen-time slot; on the Mac they run in the [macOS Space](#native-qa), never on the owner's desktop. Ask only when real interference with the owner's work blocks a trial (a possible focus change is not that). Report a recording that truly needs exclusive foreground.
- **Hosts:** development on the Mac or a Windows machine with WSL2; the owner moves it back to the Mac when free. Target systems: [Product constraints](PRODUCT_GOAL.md#product-constraints).
  - Mac: macOS native checks and their OBS recordings run in the Cua Space `local:codebook-qa` (macOS VM) so the owner keeps using the Mac ([Native QA](#native-qa)); the Mac's own desktop only when the owner directs it, with its procedures (protected Mac settings hashes, Computer Use grants).
  - `/Users/ryotamurakami` paths = the Mac.
  - A native check on another host freezes its own procedure and identities in the Issue and reports what it could not run.
  - Evidence depending on the Mac's private `artifacts/`, the Space, QA profiles or local branches never carries over by assumption.
- **Final acceptance:** the nine fixed projects in two ordered stages per the [protocol](PRODUCT_GOAL.md#final-acceptance-protocol): Stage 1, then nine independent junior-developer Stage 2 evaluators, each PASS with confidence ≥9/10, no consecutive-pass counter; ten-reviewer, random-pool and consecutive-pass gates retired. Completion also needs owner acceptance.

## Authority and completion

- PRODUCT_GOAL.md owns outcomes, its contracts the details, its [Design target](PRODUCT_GOAL.md#design-target) the visual target; cycle Issue = gaps, cycle decisions, plan, next action; PR = results. Later explicit owner direction wins.
- Write an owner rule as the rule itself into the required read it governs.
- PRODUCT_GOAL.md changes only on explicit owner direction, with evidence and a concrete alternative; then raise the goal version and say why. The route within the goal is the agent's.
- Keep all active goals while selecting one increment. Change accepted behavior only on explicit owner direction. Routine choices in the authorized phase need no repeated permission; an open gap does not authorize leaving it.
- Keep evidence apart per host (VS Code, Cursor, independent browser) and per OS (macOS, Windows, Ubuntu): one verifies no other. Keep runtime and library coverage and stage order.
- Complete the authorized cycle, update the Issue, recommend one next action; go further only within owner authorization. These instructions create no background jobs, separate tasks or automations.
- Changed UI needs mapped evidence + a current image comparison before review-complete.
- Keep distinct, report apart: implementation, live validation, review, CI, merge, packaging, publication, installed verification, owner acceptance. A missing required check blocks a completion claim; unperformed work stays unverified.
- Recordings and sensitive runtime data stay in ignored or other durable private storage, out of public changes; link sanitized evidence (manifests) by stable location, hash and source identity. Before a handoff or checkout deletion, make required evidence reachable and update its location and hash; a missing artifact voids its proof until revalidated.

## Development target

- Until nine-project final acceptance starts, actual-editor trials use `nextjs-dashboard` (same repository and revision): Mac **`/Users/ryotamurakami/repository/nextjs-dashboard`**; its macOS Space **`/Users/lume/repository/nextjs-dashboard`**; Windows host **`/home/murakami/laststance/nextjs-dashboard`**.
- Exception: the Node server execution form, which `nextjs-dashboard` lacks, is trialled on a pinned clone of P08 `laststance/switch-time` in the Space (`/Users/lume/qa/c57/switch-time`, revision recorded in the cycle Issue), with its documented local stack.
- Exception (Cycle 0073 decision D2, Issue #188; the owner may revoke it): Pages Router server-side forms (`getServerSideProps`, `getStaticProps`), which `nextjs-dashboard` lacks, are trialled on a pinned clone of P02 `TanStack/query`'s `examples/react/nextjs` in the Space (`/Users/lume/qa/c73/tanstack-query`, revision recorded in the cycle Issue).
- Never an easier repository, never a tenth acceptance target. Recheck its revision, settings, dirty state; tell the owner before occupying the desktop; record unsupported behavior and missing setup. Docs-only work needs no native launch.
- All development results, the two exceptions included, are development evidence only: no nine-project credit, no final row filled; fixture results likewise. Final acceptance freezes its own targets and candidate; Stage 1 starts only when its prerequisites hold.
- Use real opened repositories; isolated inputs verify mechanisms only, never as bundled demos or practical trials. Retired local trial resources are removed; old records in Git are no current proof.
- Development chats: VS Code = Copilot Chat, model **GPT-6.1 Terra** (replaces GPT6 Luna; listed in the Space's VS Code 1.142.0, GPT-6.1 Luna not); before each VS Code trial search the picker for `6.1` and `luna` → switch to GPT-6.1 Luna, the cheaper one, if it appears; Cursor = Agent, model **Grok 4.6 high**, Fast on allowed; after observed credit exhaustion (either host) = the installed **Codex Extension** (Claude Code extension fallback retired).
  - Model missing from the picker → that host's trial is NOT RUN, picker list recorded.
  - Record the actual chat and fallback reason; buy no credits; never label fallback evidence Copilot.
  - Final acceptance has its own standard-chat rules. Historical Claude extension observations keep their identities.

## Commands and checks

- Node per `.node-version` (mirrored in `extension/.node-version`: a version manager's shim reads the nearest package's `engines` there), pnpm per the extension's `packageManager`, Bun per `.bun-version`.
  - `pnpm install` does not provide Bun: install that version, e.g. `curl -fsSL https://bun.com/install | bash -s "bun-v$(cat .bun-version)"`, else the commit hook and the format check fail.
  - Put that Node's own `bin` first in `PATH`; run from the repo root.

Delivery commands (`--help` prints usage, exit codes and `E_…` codes; a refusal's first line = its code, last line `Fix:`):

| Command | When |
| --- | --- |
| `node extension/scripts/bump-version.mjs <v>` / `--check` | release commit, after `/ship` Step 12 |
| `node extension/scripts/qa-build.mjs` (`--status`) | on the clean commit whose VSIX a native check installs |
| `node extension/scripts/post-trial-evidence.mjs <run-log.md> --manifest artifacts/<cycle>/<host>-<run>` | after a native check |
| `node extension/scripts/merge-pr.mjs <n>` (`--dry-run`) | merge, after CI and the exact-HEAD gate |

Formatting: `pnpm --dir extension format` / `format:check` and the lint-staged hook run `bun fmt` (the Bun of `.bun-version` on `PATH`, installed by `format.yml`, checked by the gate; gives the Prettier 3.9.8 result on this tree). Never format a README with it: hand-edit README sentences.

**Gate and focused runs.**

- Exact-HEAD gate: `pnpm --dir extension gate` = sixteen delivery checks in order (static checks incl. the import-cycle check, suite, five Reader DOM checks, package tests, measured health, compaction-hook test), one log each under `artifacts/gate/<HEAD>`; refuses a Node, pnpm or Bun off the pins and a checkout with changes; exits 0 only when every check passed on an unmoved HEAD.
- `pnpm --dir extension test` = build + Node's isolated runner (files parallel, tests in a file serial; never same-process concurrency globally: workspace cases mock shared prototypes and timers). `pnpm --dir extension test:package` = package tests.
- CI failures: `node extension/scripts/ci-failures.mjs <PR>` (or `--run <id>`) prints each failed job's failing tests + first error line, also mid-run.
- Focused replay/workspace work: `pnpm --dir extension build` once, then `node --test extension/dist/tests/studyWorkspace*.test.js extension/dist/tests/playbackController.test.js` (every partition; `studyWorkspace.test.js` alone is one); reuse a current build.
- `studyWorkspaceHarness.ts` = fixtures only; each harness makes its own temp repo. Related race steps in one test; await each observable result before the next action. Keep real timeouts, production deadlines, assertions.

**Order and isolation.**

- Build before any `extension/dist` reader; the context-hook test needs no `dist`.
- Package regressions (≤ 4 isolated processes; one package producer per checkout) start after every extension test process or shard ends: they rebuild `dist` (live readers fail with missing modules; a separate checkout isolates, another VSIX path does not).
- `pnpm health` runs alone. Test timing earns no native credit.
- Checkout untouched while package tests or `health` run.
- Every `package.test.mjs` test failing with one sentence ("The checkout changed during compilation…"/"…packaging", "Package command failed: pnpm (<code>)", "Package command exceeded its time limit." after 3 min) → read the first failure; no package defect; rerun on a stable checkout.

**Local shards.** Split whole files (one big file gains nothing): after a build, `node --test --test-concurrency=4 --test-shard=1/4 extension/dist/tests/*.test.js` for all four indices, one file set and source, every exit 0; read-only shards may share the build. Each shard has its own concurrency (4 × 4 = 16 processes): no unrestricted shards. Single runner stays default; measure before adding workers or CI jobs; keep Node's file isolation.

**CI Test shards.** `pnpm --dir extension test:shard --shard 3/14 --lanes 2`; `--list` prints the plan.

- Each file runs once; a new partition needs no workflow change. Each job < 1 min; GitHub's shown time includes a runner wait the repo cannot shorten.
- Test job (`test.yml`) restores the `extension/node_modules` cache and calls `node` directly (no `pnpm install --frozen-lockfile`); cache miss → shared `prepare` action.
- `extension/test-timings.json` records every file + every test of a file slower than 8 s. Unknown tests still run once; a later-added test runs in its file's complement part until timings are re-recorded.
- Change `matrix.shard` (`.github/workflows/test.yml`) and both `after_n_builds` (`codecov.yml`) together.
- Near 60 s: compare planned vs measured seconds in the log (`▶ … (planned … s)`); re-record drifted timings (`test:shard --record`, on its machine's scale) or add a shard. Org runs 20 jobs at once; a new shard/job uses that margin.
- Failed Codecov upload never fails a job (`continue-on-error: true`); prints warning `Coverage upload failed` (pinned by `workflowPins.test.mjs`).
- Split files run with `--test-force-exit` by top-level test name (errors after a part's last test go unreported there). Whole-file runs, the local run and the `split-files` job (after a `main` push whose shards passed: `test-shard.mjs --whole-split-files`, Node's default exit) still report them → register tests synchronously; no subtest/suite member named like a recorded top-level test, no recorded name with a line break (each breaks the split); else leave the file unsplit.
- Silence: a call printing nothing for 120 s (`--silence-seconds`) has its whole process tree ended (SIGTERM, SIGKILL after 5 s; `taskkill /T /F` on Windows) and named, and its shard fails whatever the exit code. The pre-gate runner (`run-pregate-tests.mjs`) does the same, gives a run holding `package.test.mjs` 180 s extra unless `--silence-seconds` is given (that test's build logs progress every 30 s) and ends its build's tree after 300 s (`--build-seconds`). SIGINT/SIGTERM/SIGHUP to either runner ends every live child's tree (exit 128 + signal: 130/143/129). Limits: `--shard` total and `--lanes` ≤ 1,000; the last 4,000,000 characters of a call's output kept; `--record` stops at the silence limit + 5 s (max 2,147,483.647 s). `FORCE_COLOR` is stripped, option and timings-file refusals name their way out, a `main` push keeps its Test run; details in the headers and docstrings of `extension/scripts/test-shard.mjs`, `extension/scripts/run-pregate-tests.mjs`, `extension/scripts/utils/` and the `concurrency` comment of `.github/workflows/test.yml`.
- A package-workflow VSIX ≠ Test jobs passed: that workflow runs no product suite, only the compaction hook test, compiler build, `build:fast --check` emit comparison, `test:package` and the VSIX. `build:fast` needs `isolatedModules`.

**Windows job** (`storage-locks-windows.yml`).

- One test file at a time (`--test-concurrency=1`; the product bounds its PowerShell process-start reads at 3 s); a new test of a kind the job runs joins its run command, path filter and `workflowPins.test.mjs` pin (script tests as `scripts/<name>`).
- Path filter omits `extension/src/constants.ts` and `extension/src/runtimeSupport/constants.ts` on purpose; the weekly run (Mondays 05:17 UTC, default branch) and manual runs cover them.

**Reader DOM** (`reader-dom.yml`).

- Five checks: `study-bootstrap-qa.mjs`, `wiki-reader-dom-qa.mjs` (Wiki reader rail with its end sentences, 640–1200 px; at 960 × 600 they fit a rail ≤ 45vh), `study-reading-pose-qa.mjs`, `understanding-focus-qa.mjs`, `repository-return-qa.mjs`. Each `extension/scripts/*-qa.mjs` runs in a workflow or is listed retired in `workflowPins.test.mjs`.
- Setup once per checkout or worktree, before the gate (its five Reader DOM checks) or a Reader DOM check runs there (`npm ci` again after lockfile changes): `(cd .github/reader-dom && npm ci --ignore-scripts)` (pins `playwright-cli` 0.1.22); `export PATH="$PWD/.github/reader-dom/node_modules/.bin:$PATH"`; `playwright-cli install-browser ffmpeg`; installed Chrome (or `PLAYWRIGHT_MCP_EXECUTABLE_PATH`).
- Run `node extension/scripts/<check>-qa.mjs verify <folder>` after a build, one folder per concurrent run. A check passes its flow to the browser CLI as a file (arguments > 131,072 bytes fail with `spawn E2BIG`).
- New case: uses only `page`, `options` and its own definitions (no import; `page.evaluate` takes values as arguments); writes revisions as `revisionAt(n)` (Saved studies: `savedRevision`); fails first under `red <folder>` (all five checks take it).

**Fallow.**

- **Lower the scores actively**, in any cycle. A finding a behaviour-neutral refactor can remove is refactored: tests unchanged and green, and the native path rechecked when it is natively verified. The fixed findings are then dropped from their baseline. Prefer the hotspots and targets `fallow health --hotspots --targets` ranks, and `fallow fix --dry-run` for dead code.
- `pnpm --dir extension dupes` / `dead-code` fail on clones or dead code beyond `fallow-dupes-baseline.json` / `fallow-dead-code-baseline.json` (Fallow 3.38.1). `.fallowrc.json` also keeps the excluded tests and scripts as entry points (`ignoreFindings`), so code they call counts as used.
- `pnpm --dir extension health` (`scripts/checkHealth.mjs`, 20-min job; header: exit codes, the one option `--format json`, never writes a baseline) scores health with this run's coverage against `fallow-health-measured-baseline.json` (cyclomatic 20, cognitive 15, CRAP 30). Exit 2 = refused/no verdict (e.g. pins differing from `fallow-health-reference.json`, a runner option in `NODE_OPTIONS`).
  - Baselines = the current codebase at the retake, not one fixed old revision: fix findings above the committed baseline in the source.
  - Changing a pinned producer or one of the three settings → retake on the current code in a separate worktree with the new pins, record revision and hashes in the reference (`health.test.mjs` pins it), state it in the PR.
  - Never rename a callback or add a test only to move its static estimate.
- `pnpm --dir extension health:static` (~2 s; in `check` after `lint`, before tests): the cyclomatic/cognitive limits of `pnpm health` without coverage, per function (`--baseline-mode identity`), against `fallow-health-baseline.json`. CRAP needs coverage → stays with `pnpm health`.
  - Fixers run it after every change, before the full gate.
  - Fix new findings in the source; re-save the baseline (`fallow health --complexity --max-crap inf --baseline-mode identity --save-baseline fallow-health-baseline.json`) only to drop fixed findings, never to absorb one.
- `pnpm --dir extension architecture` (~1 s; own CI job): `fallow-architecture-baseline.json` holds no cycle, so a new import cycle fails.
- **Every free local Fallow analysis runs in CI.**
  - Today that also means `audit`, `flags`, `security`, `similar-code`, `mutation` (changed code vs base) and `suppressions`.
  - A command a Fallow update adds gets its CI step in that cycle's dependency step.
  - Deterministic pass/fail results gate, against a baseline where the command has one.
  - Candidate or discovery output (`security`, `similar-code`, `flags`, `suppressions`) goes to the job summary without gating.
  - `mutation` checks that tests fail without the code they test, which a delegated fixer may skip. It runs in its own job with `--time-budget 10m` (about 10 minutes is the limit; 30 is too long) and gates with `--min-score` once a measured run sets the level. A surviving mutant raises a test that only walks a branch into one that fails on a real bug in real application state; when that state is hard to reach, the function is too complex: simplify it (lower the scores, above).
  - Prefer `parallel:` steps in one job over new jobs: 20 concurrent jobs on the Free plan.
  - Fallow Cloud runtime coverage stays out: it is paid.

## Native QA

- Native checks are part of `/ship`, not a phase of their own: the VS Code and Cursor checks a cycle owes run as `/ship` Step 9.2.1's required plan checks (its QA step), beside its smoke probes.
- Build and evidence: build the VSIX with `qa-build.mjs` from the clean commit `/ship` reviews and install it in each host; the build gets no review of its own. A Critical/Major finding of a check is fixed in that `/ship` pass (new commit, new build, check repeated). Post each run's log with `post-trial-evidence.mjs --manifest`, quoting its exit line.
- UI changes: view the PNG again; compare real screenshots with its region at the normal desktop baseline; record differences and interaction.
- Motion needs recorded interaction + inspected frames; generated pixels or renderer assertions prove no native behavior.
- All work on the WSL desktop or in the macOS Space (setup, repair, a native check, its recording, moving its evidence to the Mac) follows the rules below.

**Observing a native check** (Cua Space `local:codebook-qa` or a desktop). A `computer_screenshot` answers about 600,000 characters; in Cycles 0056 to 0058 screenshots were 85% of all tool output and forced most of the context compactions → check state with **text** first, spend **pictures** on visual evidence.

- Text for every step that only needs to know what is there (a window, dialog, label, value, process, file):
  - windows and focus: `computer_window_list` (filter with `app`), `computer_get_current_window`;
  - controls and labels (buttons, dialog titles, picker entries, the chat's input text): `computer_get_accessibility_tree` with the window's `window_id` and a `max_depth`;
  - acting on a control: `computer_accessibility_act` with the tree's `snapshot_id` and `element_id` (`press`, `focus`, `set_value`), no coordinates, so no screenshot to find them;
  - processes, ports, files and logs in the Space: `space_bash`, e.g. `lsof -nP -iTCP:4100 -sTCP:LISTEN`, `pgrep -fl 'Visual Studio Code'`, `osascript -e 'tell application "System Events" to get name of every window of process "Code"'`, or a `tail` of the file a step writes;
  - verify an action's result the same way (tree, process or file).
- Pictures for a claim about what the learner sees (layout against the v9 PNG, rendering, a frame of motion): capture a region in the Space, shrink it, then `download` `/tmp/shot.jpg` and Read it:

```sh
screencapture -x -R<x>,<y>,<width>,<height> /tmp/shot.png
sips -s format jpeg -s formatOptions 70 -Z 1000 /tmp/shot.png --out /tmp/shot.jpg
```

- Evidence stills: keep the full-size PNG as the evidence file (downloaded per the macOS Space rules below); Read only the reduced copy.
- Coordinates: `computer_screenshot` when a click needs coordinates the accessibility tree cannot give (a canvas, a webview without accessible names); its pixel space is the one clicks use.
- Motion: recordings and their frames follow the OBS rules below; Read reduced frames (`ffmpeg … -vf scale=1000:-1`).

**WSL desktop (WSLg on Windows).**

- At most one window each for browser, VS Code, Cursor across QA profiles (child processes excluded); reuse windows and tabs; preserve drafts, unsaved files, settings before closing extra owned windows; keep the limit when reopening or following editor links.
- Layout: supervising terminal left; active app (browser and editors take turns), Ubuntu windows too, in the larger right region via supported move/resize, normal zoom.
- Before testing: check a current screenshot of that layout; record display size, window and viewport geometry, scaling, host, theme; take coordinates from the current screen.
- After each switch: confirm visible app and focus before input (activation success is not enough); verified input still failing → report it so the owner can minimize the terminal.
- Yield while the owner uses the desktop; then find the window again.
- The screenshot proves placement only; the PNG, both hosts and every acceptance condition still govern.

**macOS Space (`local:codebook-qa`).**

- macOS 26 VM from `ghcr.io/trycua/macos:26`, run by Cua Spaces on the Mac with its own Lume (Apple Virtualization framework): 8 CPUs, 16 GB, 150 GB disk, display 1920 × 1080, account `lume`.
- Setup and repair inside (tools, target clone, QA profiles, OBS) need no new permission; keep its settings, profiles, data as the owner's.
- Keep the Space's VS Code and Cursor current:
  - `update.mode` stays `default` in both;
  - before each native check, check each host's update feed and install a newer release (notarized, same Team ID as the installed app); record the versions in the Issue;
  - during final acceptance an update changes a frozen host identity ([Final acceptance](PRODUCT_GOAL.md#final-acceptance) 1): record old and new versions and retest the rows it affects ([Retesting](PRODUCT_GOAL.md#retesting-and-final-artifact-validity)).
- Drive via the `cua` MCP (`space_bash`, `computer_screenshot`, `computer_click`, `computer_type`, `download`) or `cua sb exec`. The guest's Cua Driver refuses background keys (foreground delivery inside the VM is fine); `type_text` reports less than it delivered → check the screen.
- Start with `cua doctor local:codebook-qa`. `No route to host` = the daemon lost Local Network access → restart it (`cua daemon start` from Terminal when the Cua Spaces app is not running).
- Sign in to what native checks need (Copilot, Cursor, GitHub):
  - `cua teleport push --app com.google.Chrome --scope full --include ".config/google-chrome/Default/Cookies" --url http://<Space address>:3211 --no-launch` (`CUA_ENV_TOKEN` from `~/.cua/spaces-credentials.json`) copies the Mac Chrome's cookies into the Space's Chrome;
  - keep only needed sites; make Chrome the default browser; click through each app's sign-in;
  - only the Mac's Chrome Safe Storage prompt waits for the owner.
- Guest sign-ins can be lost at the next VM boot (login keychain re-keyed every boot; teleported cookies stay) → restart the VM only when needed.
- Evidence leaves the Space (`download`) for the Mac's ignored `artifacts/` with matching SHA-256 on both sides (`shasum -a 256` in the Space); the Space keeps no only copy.

**macOS video: OBS Window Capture in the Space.**

- Records the chosen window behind other windows, no exclusive foreground hold; gathers evidence, changes nothing in Codebook's own recording or replay.
- One-take comparison in the Space (identities, limits, evidence hashes: [#108](https://github.com/laststance/codebook/issues/108)): OBS kept 30 fps, a new frame every 33 ms, sharper text; the Space's own window stream lost 69–271 ms at each window change; Cua Driver's recorder has no guest video backend → neither of those two records evidence.
- Never QuickTime/Screenshot (blocks interaction). `screencapture -v -l <window-id>` gave black background frames → needs a new passing pixel and motion preflight first.
- A working recorder does not prove input reached its target.

OBS steps:

1. Install [official OBS](https://obsproject.com/download) in the Space (version and architecture checked), never in the extension, build graph or VSIX.
   - Keep existing profiles and scenes; use a named QA profile and scene collection; record its actual active name.
   - Renderer Metal (`global.ini`, `[Video] Renderer=Metal`): OpenGL renders in software at ~6 fps and the recording does not start.
   - Keep editor settings, unrelated windows, drafts, debugger sessions, learner data.
   - Grant screen recording only (no camera, microphone, input monitoring, remote control) in the Space's System Settings; reopen OBS when asked; allow macOS's direct window capture prompt.
   - Turn global audio devices off before starting; check a silent take's tracks.
2. Per host, identify the exact editor window, repository and profile (never the first similar name); recheck title, host version, source and dirty state, VSIX, runtime and skill identities, display and window size, zoom, theme.
3. Add **macOS Screen Capture**. Before every take, check Properties:
   - **Method: Window Capture** (Display/Application Capture records other windows);
   - **Window:** the exact QA window (`[Code] … (Workspace) — <QA profile>`); the name never shows the mode;
   - **Show fullscreen and hidden windows** only widens the window list; no deprecated Window Capture source, no display crop;
   - minimizing pauses the stream (occlusion and another desktop differ);
   - switching hosts: pick the other window, redo steps 4–6.
4. **Edit → Transform → Reset Transform**; check size, position, rotation, four crops.
   - Pixel comparisons: Base (Canvas) and Output (Scaled) resolution = the source, even pixels (H.264 needs even sizes: resize an odd window first); recheck after canvas/window changes; label a scaled overview, keep unscaled evidence.
   - Check the preview's corners (title, Activity Bar or debugger, source, summary or chat, transport or status bar): cropped = not ready.
   - Verify the frame rate in the saved file; claim no finer timing (30 fps proven, not 60).
5. Preflight, before a take counts:
   - start; see **Stop Recording** with a running timer;
   - make a reversible visible change; confirm painted pixels change (titles or AX values can lead); restore it;
   - another app in front without minimizing: the target keeps updating, the other stays out;
   - before native input (brief activation allowed): check focus and stale-target errors; never type into an unverified palette or submit a terminal draft;
   - stop; check metadata and frames; reject black, frozen, wrong-window or cropped output; tell input from recorder failures; diagnose no product from them.
6. Take: new recording; stable source, host, VSIX build, geometry; action times logged; the whole transition with loading and gaps; finalization confirmed. A recreated target needs reselection + a new preflight.

OBS control and evidence:

- Use OBS's public controls: its window via the Space's tools, or obs-websocket in the Space (`StartRecord`, `GetRecordStatus`, `StopRecord`); [`--startrecording`](https://obsproject.com/kb/launch-parameters) only with a prepared profile whose active configuration and output path you verify.
- No blind duplicate launch; `--multi` only as a bounded retry with old processes verified as owned.
- Copy each recording to the Mac as evidence (above); inspect without overwriting it; originals stay private.
- Extract metadata, 10 fps frames (make the folder first), hash, every native frame of a transition for temporal defects, and a silent copy keeping the original (set audio before recording):

```sh
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate,nb_frames -of json "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -i "$QA_VIDEO" -vf fps=10 "$QA_FRAMES/frame-%05d.png"
shasum -a 256 "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -ss "$QA_TRANSITION_START" -i "$QA_VIDEO" -t "$QA_TRANSITION_SECONDS" -fps_mode passthrough "$QA_TRANSITION_FRAMES/frame-%05d.png"
ffmpeg -hide_banner -loglevel error -i "$QA_ORIGINAL_VIDEO" -map 0:v:0 -c copy -an "$QA_SILENT_VIDEO"
```

- Keep failed attempts and failed takes as evidence.
- Tested OBS takes verified window recording and visible updates (Space, VS Code behind Safari); not Cursor, minimized or locked-screen operation, child dialogs, exact update latency or replay synchronization.
- Open frames with an image tool: target identity, full edges, content changes, gaps and clearing, correspondence.
- Record beside the [loop](#working-loop)'s fields: real fps and duration, inspected frames, hashes, inspected file. A picture, AX dump, filename, frame count or green indicator replaces nothing.
- Black/frozen → recheck identity, minimization, permission, redraw; never substitute the desktop or a stale frame.
- Wrong input target → refresh state, verify window and control, retry only the reversible action (connection errors prove no recorder or product failure).
- Finish: confirm finalization; restore tabs and panels; close only sessions the check started; verify owned PIDs before any signal, never terminate unknown or owner processes or kill all OBS/editor processes; keep evidence and reusable QA configuration; never reset permissions or settings broadly.
- The preflight stays mandatory whatever [upstream docs](https://obsproject.com/kb/macos-screen-capture-source) say.

## External validation targets

- Never embed a demo or validation application in the extension, its runtime dependencies, build graph, commands or VSIX; open the owner-designated real repository as an external workspace.
- Keep isolated unit-test data out of production imports and package assets; packaging must reject application fixtures and experiment dependencies.

## Working conventions

- Japanese chat; English code, comments, documents (except quoted user requests).
- Context7 for third-party library/API docs; Serena symbols for substantial code understanding or refactoring when available.
- Before TypeScript work read `/Users/ryotamurakami/.claude/rules/ts-rules.md`; for React also `/Users/ryotamurakami/.claude/rules/react-rules.md`.
- Check for existing utilities, hooks, components, types before adding one. Reusable functions and classes: short purpose, trigger and caller docs with an example; workspace symbols as JSDoc links; brief notes on non-obvious branches and loops.
- DAMP behavior tests, hard-coded expectations, Arrange/Act/Assert, `test`; `toBeVisible` for displayed UI.

## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues on laststance/codebook, via the `gh` CLI for every operation. This file's [Where things live](#where-things-live), [Cycle rule](#cycle-rule) and GitHub paragraph of [Delivery](#delivery) win (cycle Issue, goal Issue #1, labels, Issues from evidence, public repository).

- Create: `gh issue create --title "..." --body "..."` (a heredoc for multi-line bodies). A skill's "publish to the issue tracker" = create a GitHub issue.
- Read: `gh issue view <number> --json number,title,body,labels,comments`; a skill's "fetch the relevant ticket" = this.
- List: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with the fitting `--label` and `--state` filters.
- Sub-issue of a parent: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in Blocking below). Without sub-issues: `Part of #<parent>` at the top of the child body.
- Comment: `gh issue comment <number> --body "..."`. Labels: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`. Close: `gh issue close <number> --comment "..."`.
- PRs as a request surface: **no** (`/triage` reads this flag; `yes` would make external PRs feature requests). When `yes`, PRs take the issues' labels and states through `gh pr`: read `gh pr view <number> --comments` and `gh pr diff <number>`; list external PRs `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`; comment, label, close with `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.
- Issues and PRs share one number space: resolve a bare `#42` with `gh pr view 42`, fall back to `gh issue view 42`.
- Wayfinding (`/wayfinder`): the **map** is one issue labelled `wayfinder:map` holding the Notes / Decisions-so-far / Fog body (`gh issue create --label wayfinder:map`); its **child** issues are the tickets.
  - Child ticket: linked to the map as a GitHub sub-issue (above); where sub-issues are not enabled, an entry in the map body's task list + `Part of #<map>` at the top of the child body. Labels `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). A claimed ticket is assigned to the driving dev.
  - Blocking: GitHub's native issue dependencies, the canonical, UI-visible form: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, `<blocker-db-id>` = the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the `#number` or `node_id`). `issue_dependencies_summary.blocked_by` counts open blockers only (the live gate). Without dependencies: a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
  - Frontier query: the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), minus any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
  - Claim: `gh issue edit <n> --add-assignee @me`, the session's first write.
  - Resolve: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

### Triage labels

Five canonical triage roles the skills (mattpocock/skills) speak of, each label named after its role (all five exist on GitHub); a skill naming a role (e.g. "apply the AFK-ready triage label") → use its label. A changed label vocabulary is edited here.

- `needs-triage`: maintainer needs to evaluate this issue.
- `needs-info`: waiting on reporter for more information.
- `ready-for-agent`: fully specified, ready for an AFK agent.
- `ready-for-human`: requires human implementation.
- `wontfix`: will not be actioned.

### Domain docs

Single-context: one root `GLOSSARY.md`, created lazily. Product outcomes live in PRODUCT_GOAL.md and owner rules in this file, stated as rules; a glossary entry never restates or overrides either.

- Before exploring, read the root `GLOSSARY.md`, or, when a root `GLOSSARY-MAP.md` exists, each per-context `GLOSSARY.md` it points at that is relevant to the topic.
- Absent → proceed silently: never flag the absence or suggest creating it upfront. `mattpocock-skills:domain-modeling` (reached via `mattpocock-skills:grilling` and `mattpocock-skills:codebase-design`) creates it lazily when terms actually get resolved.
- Name a domain concept (issue title, refactor proposal, hypothesis, test name) with the glossary's term; no synonym it avoids. A concept it lacks = invented language (reconsider) or a real gap (note it for `mattpocock-skills:domain-modeling`).
- No ADRs and no `docs/adr/`: no decision log ([Standing directions](#standing-directions)).
- Output contradicting a recorded owner decision (a cycle Issue's Owner decisions) names the conflict explicitly instead of silently overriding it.

## Codex compaction hook

[`.codex/hooks.json`](.codex/hooks.json) registers only `SessionStart` with `^compact$` (startup, resume ignored); Claude Code runs the same command from `.claude/settings.json`, the only shared Claude file.

- The command (`.codex/restore-product-context.mjs`; Node, Git, POSIX shell) prints ≤ 10,000 characters: the re-entry rule first ([Mandatory entry](#mandatory-entry) 2), the scope and pause sentence, then this file's `## Mandatory entry` and `## Standing directions` verbatim. Why: Claude Code injects longer hook context only as a 2,000-character preview + file path.
  - Sections outgrowing the limit → prints the rule and points to AGENTS.md.
  - Missing or renamed section (CRLF line ends, trailing spaces after a heading tolerated) → rule still printed; names what is missing on stderr; exit 0.
- Collaborators: each enables hooks, trusts the project, reviews the hook in Codex [`/hooks`](https://learn.chatgpt.com/docs/hooks) after every definition change (may disable it alone there), and checks that a fresh `/compact` shows `CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION` (proves delivery, not reading or understanding).
- Files alone establish no activation; this repo changes no global Codex setting; a Codex observation verifies no Claude Code delivery.
- Test: `node --test .codex/restore-product-context.test.mjs` (CI too): rule within the first 2,000 characters, whole output ≤ 10,000 (~1,500 tokens, under Codex's `additionalContextLimit` of 4,000), both sections verbatim; any other failure (e.g. unreadable AGENTS.md, malformed hook input) exits nonzero with stderr, no fail-closed guarantee.
