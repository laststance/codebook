# codebook agent instructions

Single operational entry point for every coding agent; Codex and Claude Code (v2.1.281+) load it as project instructions. Keep agent instructions here: a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the repo or any directory above it makes Claude Code read that file instead.

## Mandatory entry

Before planning, implementation or runtime trials:

1. New session, or PRODUCT_GOAL.md changed: read [PRODUCT_GOAL.md](PRODUCT_GOAL.md) in full except `## Final acceptance protocol`; open [the approved PNG](docs/designs/assets/codebook-product-spec-v9.png) with an image tool; read the active cycle Issue (open, label `cycle`) with comments (`gh issue view <N> --comments`).
2. After every context compaction, before any other work, whatever the task: read PRODUCT_GOAL.md in full, every line; open the PNG with an image tool and check its identity; then read the active cycle Issue with comments. This file is loaded into context automatically as project instructions (Claude Code and Codex): read it from disk again only when its text is not in your context or it changed on disk since the session began (owner, 2026-10-26). Owner's most important rule (2026-10-21): the goal and the image are the final product every token is spent for; a plan or change made without them is waste. A compacted summary, the restore hook's text or an earlier read is no substitute.
3. Final acceptance selected: read [`## Final acceptance protocol`](PRODUCT_GOAL.md#final-acceptance-protocol).

The PNG is the product to build:

- View it; match it to the identity (file, size, SHA-256) in [Design target](PRODUCT_GOAL.md#design-target); find its live, replay, DeepWiki and shortcut regions. A filename, prompt or alt text does not count.
- Then verify branch, dirty files, tools, runtime, PR state; record the reads and image inspection in the Issue.
- A missing read, image check or gap audit = entry incomplete: continue independent preparation and report it.

## Where things live

- **Cycle Issue** (label `cycle`, title `Cycle NNNN: <outcome>`) = state. Body: Outcome, Tasks, Owner decisions, Next action; edit it when the state changes.
  - Tasks: numbered checklist, one line each (source, defect, what closes it); closed with "fixed in <sha>" or "evidence: <one line>". A finding during a bug-fix cycle = one more task.
  - Near GitHub's 65,536-character limit: continue the list in one pinned comment.
- **PR** = results (gate, CI, native QA summary) + Issue reference.
- **Issue closing comment** = outcome + every carried defect; the next bug-fix Issue copies that list.
- **CHANGELOG.md** = what each version changes for users.
- **Tag `docs-archive-2026-10-20`** = every record and document removed here.

Read the archived docs before the work each governs (other records, prompts, external references: only when needed):

- [behavioral design](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/designs/codebook.md): live, capture, replay, runtime, storage, evidence ownership, cross-feature architecture.
- [UI state and interaction review](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/cycle-0029-product-design.md): UI implementation, visual verification.
- [G12 bundled skill plan](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/bundled-codebook-skill.md): shared skill, onboarding.
- [Wiki generation skill plan](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/deepwiki-generation-skill.md): Wiki generation, update.
- Bring relevant GStack cache findings into the Issue; needed evidence never only in chat or a cache.

## Cycle rule

Fix every carried defect in the next cycle. Sole exception: the [ship review limit](#delivery) (owner, 2026-10-23). No planning choice, review outcome or skill default overrides this, so a feature cycle starts clean.

- **Defect** = a Critical or Major finding (a review marks it critical, major, high, blocking, P0 or P1) or a failed gate, CI or native check. Medium, Minor, Low and informational findings, test gaps and doc debt are no defects: fixed when cheap and in scope, else answered Skip and named once in the PR or a short later-candidate list; they never start a bug-fix cycle (owner, 2026-10-31: 「レビューツールを複数回して、全部持ち越して直すっていうのが過剰」).

- **Feature cycle**: an increment of the final product. Starts only with nothing carried in; planned from the final product alone (`/spec` + plan reviews, from PRODUCT_GOAL.md and the gap audit). Defects it leaves unfixed are carried.
- **Bug-fix cycle**: follows any cycle that left a defect; fixes those, nothing else.
  - Issue: each defect a task (source: cycle + finding label; closing fix or evidence; the test failing without the fix). No increment; nothing selected, dropped or reduced.
  - Carries nothing: defects found in it (implementation, review, delegated review, native trial, audit) are fixed in it, except Critical/Major ones the ship review limit records.
  - Closes when every carried and found defect is closed → feature cycle, or another bug-fix cycle for defects that limit recorded.
- A defect closes by a fix + a test failing without it, or recorded evidence it is no defect / no longer applies.
- Carried defects live in the bug-fix cycle's Issue as tasks; a TODOS file, backlog or ledger of them is forbidden (a list that only records lets work end at the recording). Later candidate increments: a short list at most, never holding a carried defect.
- Delivery: feature cycle fixes Critical findings before merge, carries Major ones (review, delegated review, native trial, audit); bug-fix cycle fixes every Critical/Major finding before merge, except as the ship review limit allows.

## Working loop

Goal and visual target → gap audit → one observable increment → implementation and proof → updated gaps. One active cycle, in its authorized phase.

1. **Audit** (Issue = gap ledger).
   - All [acceptance map](PRODUCT_GOAL.md#product-acceptance-map) rows at a new cycle, a goal/design change or an unassessed source change; else verify baseline and changed paths, inspect affected rows, justify carrying the rest (a docs-only commit may keep the product-source baseline, said so).
   - Per row, from source and evidence: **implementation** (match, concrete mismatch, or UNKNOWN + next inspection; an existing file, symbol or spec proves no behavior); **proof** (result, host, OS, identity, level, link; absent/stale = unverified; source mismatch and missing runtime evidence are separate gaps); **next action** (change or bounded experiment + verifying observation; UNKNOWN = investigate, never "implemented"/"absent").
   - Gate: all rows and active goals covered; baseline and affected IDs recorded. A read receipt, goal-link list, linked goal ID or old PASS proves nothing.
2. **Select** the smallest connected behavior or bounded experiment closing a gap or settling the highest-impact unknown that could invalidate later work; core-experience blockers before polish; plan only that.
   - Inspect existing code, then freeze in the Issue: AC IDs (primary, dependency, regression); gap and why now; starting action → expected result, failure behavior, modules, falsifying observation; procedure, target, host, evidence level, result location.
   - Changed assumption = new expectation version; keep old attempts.
   - Gate: action follows from the audit; checkable outcome. An open product gap does not override a documentation-only assignment. Repeated inconclusive attempts → smaller question or new hypothesis, never silent loss of required behavior.
3. **Prove** the normal user entry through its result, recovery and preservation included.
   - Reuse modules and real package scripts; mechanism tests for logic, declared native checks for product claims.
   - Record identities, actions, expected/actual results, artifacts, limits as NOT RUN, PARTIAL, FAIL or PASS; a listed command is no execution evidence.
   - Gate: evidence supports the outcome at its declared level. A failed/inconclusive experiment names the next hypothesis, proves nothing; code resolving uncertainty is an experiment; increments need regression evidence; a plan grows only with its question; a build alone completes no live, replay or Wiki outcome.
4. **Reassess** changed and dependent rows and regressions.
   - Keep unaffected evidence only with an impact reason; compare gaps before/after, keeping missing implementation, missing proof and UNKNOWN; nothing advances because a checkbox, skill, image or PR is done.
   - Keep, revise or replace the approach; update the Issue with results + one executable next action; check the route still reaches every goal and the next candidate hits the largest blocker.
   - Gate: rows, checks, UI comparisons recorded; a fresh agent recovers product, gaps, proof, phase, failed approaches and next step from repo + Issue, never chat (`/context-save` only speeds this). Markdown = auditable procedure, not proof of comprehension.

## Delivery

Driving agent owns state, cycle selection, completion claims; GStack supplies workflows.

**Chain.**

- One bounded cycle at a time toward the complete product; after each merge `/spec` (+ the plan reviews the scope needs) writes the next cycle's Issue.
- Work on a `codex/` branch; keep existing edits; reuse a fitting checkout.
- Per cycle: local CodeRabbit CLI + `open-code-review-delegate` → `/ship` as PR → required CI → separate exact-HEAD gate → merge as its own step with `--match-head-commit`.
- Parallel reviews (owner, 2026-10-31: 「並列化できるレビューは必ず並列で行うというルールを追加してください。」): start every review that reads no other review's result at the same time, never one after another. Examples: the local CodeRabbit CLI with `open-code-review-delegate`; `/ship` pass 1's reviews (Codex structured review, red team, specialists); a plan-review phase's native and outside voices (outside one in a background shell, then the native agent). A review waits only for a result or tree it reads: `/autoplan` phases stay in order (each reviews the previous phase's amendments); a fix-check waits for its fix.
- A large cycle may use up to three PRs (`cycle100-pt1`, `cycle100-pt2`, …), each passing reviews, CI and gate alone, merged in order; the Issue closes after the last.
- Codex automatic review off (no Codex cloud step). No `@coderabbitai ignore` in PR bodies (owner, 2026-10-05).
- Hosted CodeRabbit off from Cycle 0057 (owner, 2026-10-27: 「次のサイクルからGitHubのコード、Rabbitのレビューはトリガーさせないでください。」): `.coderabbit.yaml` keeps `reviews.auto_review.enabled: false` (CodeRabbit reads the PR branch's file); never post `@coderabbitai review`.
- Outside review early (owner, 2026-10-28): `/ship` Step 9 pass 1 also runs Step 11's Codex structured review (`codex review --base main`) on the whole diff, its findings part of pass 1; a plan that changes process signalling, process identity or a stop/kill path also gets a Codex review before implementation. A fix-range pass (pass 2 on) under 300 changed lines dispatches the red team and the specialists whose area the range changes.

**Delivery parameters.**

- Merge: `node extension/scripts/merge-pr.mjs <n>` after the exact-HEAD gate in this checkout: it merges with `--squash --match-head-commit <head>` only when this checkout is at the PR head, the gate summary (`Checkout: clean`, every check `exit=0`, `GATE: pass on <head>`) and every workflow run, check run and status of that head passed (`CodeRabbit` never gates), and every workflow of the checkout's `.github/workflows` that runs on each pull request (no `paths` filter) has a successful run on the head, then fast-forwards the local `main`. Hand fallback, only for a defect of the script itself (named in the PR): `gh pr merge <n> --squash --match-head-commit <sha>`.
- `/ship` documentation candidate (`gstack-docs-candidate snapshot`) `--docs` roots: AGENTS.md, CHANGELOG.md, PRODUCT_GOAL.md, README.md, `extension/README.md`, `extension/skills/codebook/SKILL.md`, the v9 PNG.
- CI packages via `node extension/scripts/package.mjs --out artifacts/packages/codebook.vsix`, checks via `node extension/scripts/check-package.mjs artifacts/packages/codebook.vsix` (`package.yml`).
- Release commit: besides version files and CHANGELOG.md, one test line (expected version in `extension/scripts/tests/package.test.mjs`); `/ship` Step 16 counts it as release metadata, not a reviewed-tree change. Order: `/ship` Step 12 writes `VERSION` and the CHANGELOG heading, `node extension/scripts/bump-version.mjs <VERSION>` writes the three three-part places, Step 13 writes the entry, `bump-version.mjs --check` exits 0 (`test:package` fails any commit whose five places disagree).

**Pre-gate (owner, 2026-10-22):** `/ship` pre-gate = Stage 1 only: `gstack-pregate --stage preflight --allow-repo-commands`, secrets scan every time. Test lanes (Stage 2) = `pnpm --dir extension test` on the final tree + required CI.

**Background work.**

- `node extension/scripts/watch-background.mjs` (from Claude Code's start directory, else `--project <it>`) lists this session's (`CLAUDE_CODE_SESSION_ID`) background tasks and subagents with last-output time; marks those silent > 20 min. Finished/stopped subagents are never marked; a shell's row stays marked after it ends (its task notification is authoritative).
- Review subagent silent 20 min → stop it, redispatch on a narrower scope.
- Subagent stopped by the API safety filter → redispatch at once, same brief, fallback model.
- Waiting more than a few minutes → tell the owner what is awaited and since when.

**Ship review limit (owner, 2026-10-18; 2026-10-23).**

- Installed `/ship`: max three fixing cycles; no fourth, no counter reset after a handoff, no round relabeled a repair.
- Third cycle still has findings (`converged:false`) → the owner's 2026-10-23 rule, feature and bug-fix cycles alike, with the 2026-10-31 defect rule: fix every last-round Critical/Major finding (Critical always fixed before merge, per the delivery rules) and the lower ones that are cheap and in scope, the rest answered Skip and named once in the PR; record only still-open Critical/Major defects in a GitHub Issue (next cycle's tasks); merge after required CI + exact-HEAD gate, reporting `converged:false` in the PR. This overrides no-carry for those recorded defects only.
- The limit is `/ship`'s alone (owner, 2026-10-23): one round is long; full convergence would stall delivery. It records defects of `/ship` rounds the PR cannot close (e.g. a Major finding whose fix/proof needs an unknown root cause or a native check).
- A Critical finding never merges open: one the PR cannot close holds the merge until fixed (cycle + delivery rules).
- Local CodeRabbit CLI and OCR delegate: their Critical/Major findings follow the cycle rule, as do gate, CI and native-check failures; findings below Major per the defect rule. CodeRabbit CLI: once on the PR's final range, more only after a fix it must recheck.

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
- Browser QA (Reader DOM included) proves no native pixels, DAP targeting, MCP integration or installed VSIX behavior. Missing tool → report as missing coverage.

**Skills under the cycle rule** (each runs as installed):

- `/spec`: plans a feature increment from PRODUCT_GOAL.md + gap audit, or writes a bug-fix Issue from the previous closing comment (one task + acceptance criterion per carried defect, nothing ranked or selected).
- Plan reviews may change how a carried defect is fixed; never remove, merge away or defer one.
- `/review`, `/ship` review steps: Critical fixed; Major fixed in a bug-fix cycle, carried from a feature cycle; findings below Major per the defect rule in both kinds (fixed when cheap and in scope, else answered Skip; no automatic fixes of informational findings).
- `/ship`: commit the coverage audit's tests; plan completion audit counts an open bug-fix task NOT DONE and stops (no ship anyway, defer or drop); TODOS step writes no TODOS.md; fix documentation-audit blockers before commit.
- Test gap, deferral, non-blocking doc debt, skill follow-up: later candidates, no carried defects.
- Closing comment: feature cycle names every carried defect (bug-fix Issue comes before other work); bug-fix cycle states nothing is carried (`/spec` starts a feature cycle); defects recorded by the ship review limit → named, next cycle is bug-fix.

**Invocation.**

- Pass Issue, phase and bounded scope explicitly. PRODUCT_GOAL.md is the destination, not permission to build everything.
- Retired G08/G09 never return via an old prompt.
- Give design skills `## Design target` and the PNG.
- Honor scope gates without re-asking authorized routine choices or passing agent-chosen targets off as the user's; keep required reports; one approved recommendation authorizes no unrelated change.
- Shared-skill and Wiki-generation scope → DX + engineering review; discovery, loaded identity, runtime connection, AI-owned results are separate checks; Wiki works without runtime/debug MCP.

**CodeRabbit and OCR.**

- [.coderabbit.yaml](.coderabbit.yaml) = policy + exclusions: keep its guidelines current; validate with `coderabbit config validate .coderabbit.yaml`; pass it via `--config` beside extra context.
  - CLI 0.9.1 (latest on 2026-10-28) exits 1 on every file with `unknown keyword: "x-undocumented"`, a defect of its own schema: record that line as the validation result; a review with `-c` still applies the file.
- Required: local CodeRabbit CLI, findings triage, CI, `open-code-review-delegate` (OCR picks files and rules, the host reviews; each eligible file reviewed or skipped with a reason; default exclusions reported apart; no independent external review).
- Review against the implementation base; record completion, source cut, covered files, findings.
- Hosted CodeRabbit is not triggered (owner, 2026-10-27; [Delivery](#delivery)): merge waits for no hosted review or approval. A hosted review that still appears is reported in the PR; its findings follow the cycle rule like the local review's. Run the local CodeRabbit CLI on the PR's final range before merge.
- Missing/private provider context = coverage limit.
- Every user-visible behavior a CHANGELOG entry names needs a sentence in the packaged README (`extension/README.md`), as `.coderabbit.yaml`'s `CHANGELOG.md` instruction checks. A fix changing user-visible behavior changes that README in the same commit; fixers' briefs say so.
- Claude Code CLI review: owner-skipped; no native chat acceptance.

**States** (independent):

- Status: ready → planning → implementing → validating → closed, or blocked with condition + unblocking action (say why work moves back).
- Result: pending, demonstrated, falsified, inconclusive.
- Delivery: not-applicable, local-only, committed, PR-open, merged, packaged, published, installed-verified.

**Closure.** Write any new owner rule into the required read it governs. Name the next cycle's kind; after a clean bug-fix cycle, at most one candidate increment. Run integrated checks once capabilities depend on each other. A shipping task stays open until its authorized gates finish.

**GitHub.**

- [laststance/codebook](https://github.com/laststance/codebook) is public: everything pushed (Issues, PRs) is world-readable, a security defect before its fix too.
- Goal Issue [#1](https://github.com/laststance/codebook/issues/1) stays open until full acceptance + owner approval.
- Use `goal` and `cycle` labels; link PRs and evidence; choose Issues from evidence, never a speculative roadmap or a planning tool's need. A closed Issue alone proves nothing.
- Close a cycle Issue only for a demonstrated or falsified outcome with complete delivery (an inconclusive investigation may stop with its outcome open).
- GitHub unreachable → keep the Issue edit pending.
- Tracking is authorized; production deployment, publication and recurring automations need the user's authorization.

## Owner directions in force

Standing rules, stated as rules (no decision log); delivery chain and ship limit: [Delivery](#delivery).

- **Fallow scores application code only (2026-10-19):** `extension/src` without `src/tests`, plus `extension/skills`; tests and `extension/scripts` excluded ([checks](#commands-and-checks)).
- **Everything for the product (owner, 2026-10-22):** 「お金を勝手に使うことと犯罪行為以外は禁止しないからPRODUCT_GOAL.mdの成果物/アプリケーションを最速/最高品質で作成する事に全リソースを捧げろ」.
  - Skip a rule, convention or skill step that plainly adds nothing to the product instead of following it by habit.
  - Docs unrelated to the application ride on the current work branch: no separate PR, no wait on CI with an obvious result.
  - Still forbidden: spending money without the owner's permission; anything illegal. Irreversible steps under **Never without the owner** still wait for the owner.
- **The owner cannot answer:** every decision point takes the recommended option, named in the Issue's Owner decisions. An owner-directed pause stops work at once; only the owner's explicit message lifts it. A conditional pause ("when X is done, stop") is not immediate.
- **Dedicated Windows development machine (2026-10-14):** setup and repair (IME settings, QA reinstall/reset, needed data removal) need no new permission. Spend the time on live explanation, save and synchronized replay. A remedy truly needing the owner: research it, finish independent preparation, give concrete verified steps. Outcomes and gates still govern.
- **Never without the owner:** buying credits, subscription or billing changes, new or changed credentials, permanent deletion, security settings, repository visibility.
  - Signing in with the owner's existing sessions to what the work needs = the agent's job, without asking (2026-10-22).
  - Preserve the owner's and others' edits, profiles, extensions, skills, settings, tabs, drafts, learning, target source, credentials.
- **Varied questions; learning fits the question (2026-10-21):** learners study many processes in many codebases.
  - Trials, evaluations and examples ask natural questions about different code paths and processes of the target, varied across rounds and hosts; never one fixed prompt (a cart, login or invoice example) round after round.
  - The v9 PNG fixes screen hierarchy and interactions, not learning content: summaries, sequence diagrams and explanations are generated per question as clear, graphical learning resources from what actually ran.
  - Never shape the skill, the generation, help examples or acceptance to reproduce the image's sample flow, participants or text.
- **Who operates a native trial:** the driving agent itself (chat submissions, replay checks, every native check a row owes), never a subagent; implementation may run in subagents.
- **Trial coordination:** dedicated VS Code and isolated-profile Cursor trials need no screen-time slot; on the Mac they run in the [macOS Space](#native-qa), never on the owner's desktop. Ask only when real interference with the owner's work blocks a trial (a possible focus change is not that). Report a recording that truly needs exclusive foreground.
- **Hosts:** development on the Mac or a Windows machine with WSL2; the owner moves it back to the Mac when free. Target systems: [Product constraints](PRODUCT_GOAL.md#product-constraints).
  - Mac: macOS native trials and their OBS recordings run in the Cua Space `local:codebook-qa` (macOS VM) so the owner keeps using the Mac (owner, 2026-10-21; [Native QA](#native-qa)); the Mac's own desktop only when the owner directs it, with its procedures (protected Mac settings hashes, Computer Use grants).
  - `/Users/ryotamurakami` paths = the Mac.
  - A native check on another host freezes its own procedure and identities in the Issue and reports what it could not run.
  - Evidence depending on the Mac's private `artifacts/`, the Space, QA profiles or local branches never carries over by assumption.
- **Final acceptance:** the nine fixed projects in two ordered stages per the [protocol](PRODUCT_GOAL.md#final-acceptance-protocol): Stage 1, then nine independent junior-developer Stage 2 evaluators, each PASS with confidence ≥9/10, no consecutive-pass counter; ten-reviewer, random-pool and consecutive-pass gates retired. Completion also needs owner acceptance.

## Authority and completion

- PRODUCT_GOAL.md owns outcomes, its contracts the details, its [Design target](PRODUCT_GOAL.md#design-target) the visual target; the cycle Issue owns gaps, cycle decisions, plan, next action; the PR owns results. Later explicit owner direction wins.
- Write an owner rule as the rule itself into the required read it governs.
- PRODUCT_GOAL.md changes only on explicit owner direction, with evidence and a concrete alternative; then raise the goal version and say why. The route within the goal is the agent's.
- Keep all active goals while selecting one increment. Change accepted behavior only on explicit owner direction. Routine choices in the authorized phase need no repeated permission; an open gap does not authorize leaving it.
- Keep evidence apart per host (VS Code, Cursor, independent browser) and per OS (macOS, Windows, Ubuntu): one verifies no other. Keep runtime and library coverage and stage order; fixture or development passes earn no acceptance credit.
- Complete the authorized cycle, update the Issue, recommend one next action; go further only within owner authorization. These instructions create no background jobs, separate tasks or automations.
- Changed UI needs mapped evidence + a current image comparison before review-complete.
- Keep distinct and report apart: implementation, live validation, review, CI, merge, packaging, publication, installed verification, owner acceptance. A missing required check blocks a completion claim; unperformed work stays unverified.
- Recordings and sensitive runtime data stay in ignored or other durable private storage, out of public changes; link sanitized evidence (manifests) by stable location, hash and source identity. Before a handoff or checkout deletion, make required evidence reachable and update its location and hash; a missing artifact voids its proof until revalidated.

## Development target

- Until nine-project final acceptance starts, actual-editor trials use the owner-designated `nextjs-dashboard` (same repository and revision): Mac **`/Users/ryotamurakami/repository/nextjs-dashboard`**; its macOS Space **`/Users/lume/repository/nextjs-dashboard`**; Windows host **`/home/murakami/laststance/nextjs-dashboard`**.
- Exception (owner, 2026-10-27): the Node server execution form, which `nextjs-dashboard` lacks, is trialled on a pinned clone of P08 `laststance/switch-time` in the Space (`/Users/lume/qa/c57/switch-time`, revision recorded in the cycle Issue), with its documented local stack. Development evidence only; no final-row credit.
- Never an easier repository, never a tenth acceptance target. Recheck its revision, settings, dirty state; tell the owner before occupying the desktop; record unsupported behavior and missing setup. Docs-only work needs no native launch.
- Development results earn no nine-project credit, fill no final row. Final acceptance freezes its own targets and candidate; Stage 1 starts only when its prerequisites hold.
- Use real opened repositories; isolated inputs verify mechanisms only, never as bundled demos or practical trials. Retired local trial resources are removed; old records in Git are no current proof.
- Development chats: VS Code = Copilot Chat, model **GPT-6.1 Terra** (owner, 2026-10-27: switch from GPT6 Luna to GPT-6.1 Terra or GPT-6.1 Luna once the picker lists one; GPT-6.1 Terra listed in the Space's VS Code 1.142.0 on 2026-10-28 JST, GPT-6.1 Luna not; before each VS Code trial search the picker for `6.1` and `luna`, and switch to GPT-6.1 Luna, the cheaper one, if it appears); Cursor = Agent, model **Grok 4.6 high**, Fast on allowed (owner, 2026-10-24 JST: 「これからGrok4.6Hiのファストオンで大丈夫ですよ。」); after observed credit exhaustion (either host) = the installed **Codex Extension** (Claude Code extension fallback retired).
  - Model missing from the picker → that host's trial is NOT RUN, picker list recorded.
  - Record the actual chat and fallback reason; buy no credits; never label fallback evidence Copilot.
  - Final acceptance has its own standard-chat rules. Historical Claude extension observations keep their identities.

## Commands and checks

Node as `.node-version` pins it (mirrored in `extension/.node-version`, since a version manager's shim reads the nearest package's `engines` there), pnpm as the extension's `packageManager` pins it, and Bun as `.bun-version` pins it (`pnpm install` does not provide it; install that version, e.g. `curl -fsSL https://bun.com/install | bash -s "bun-v$(cat .bun-version)"`, or the commit hook and the format check fail); put that Node's own `bin` first in `PATH`; run from the repo root.

Delivery commands (each prints usage, exit codes 0/1/2/3/4/64 (`post-trial-evidence.mjs` also 10/11/12 for `gstack-post` results) and `E_…` codes with `--help`; a refusal's first line is its code, its last line `Fix:`):

| Command | When |
| --- | --- |
| `node extension/scripts/bump-version.mjs <v>` / `--check` | release commit, after `/ship` Step 12 |
| `node extension/scripts/qa-candidate.mjs` (`--status`, `--clean`) | on the clean commit a native trial installs |
| `node extension/scripts/post-trial-evidence.mjs <run-log.md> --manifest artifacts/<cycle>/<host>-<run>` | after a native trial, once the candidate review is read |
| `node extension/scripts/merge-pr.mjs <n>` (`--dry-run`) | merge, after CI and the exact-HEAD gate |

Formatting: `pnpm --dir extension format` / `format:check` and the lint-staged hook run `bun fmt` (the Bun of `.bun-version` on `PATH`, which `format.yml` installs and the gate checks; it reads `.prettierrc.json` and `.prettierignore`, and gives the Prettier 3.9.8 result on this tree, Cycle 0062 task 24). Never format a README with it: hand-edit README sentences.

**Gate and focused runs.**

- Exact-HEAD gate: `pnpm --dir extension gate`: the sixteen delivery checks in order (static checks with the import-cycle check, the suite, the five Reader DOM checks, package tests, measured health, the compaction-hook test), one log each under `artifacts/gate/<HEAD>`; it refuses a Node, pnpm or Bun off the pins and a checkout with changes, and exits 0 only when every check passed on an unmoved HEAD.
- `pnpm --dir extension test` = build + Node's isolated runner (files parallel, tests in a file serial; never same-process concurrency globally: workspace cases mock shared prototypes and timers). `pnpm --dir extension test:package` = package tests.
- CI failures: `node extension/scripts/ci-failures.mjs <PR>` (or `--run <id>`) prints each failed job's failing tests with their first error line, also while the run goes on.
- Focused replay/workspace work: `pnpm --dir extension build` once, then `node --test extension/dist/tests/studyWorkspace*.test.js extension/dist/tests/playbackController.test.js` (every partition; `studyWorkspace.test.js` alone is one); reuse a current build.
- `studyWorkspaceHarness.ts` = fixtures only; each harness makes its own temp repo. Related race steps in one test; await each observable result before the next action. Keep real timeouts, production deadlines and assertions.

**Order and isolation.**

- Build before any `extension/dist` reader; the context-hook test needs no `dist`.
- Package regressions (≤ 4 isolated processes; one package producer per checkout) start after every extension test process or shard ends: they rebuild `dist` (live readers fail with missing modules; a separate checkout isolates, another VSIX path does not).
- `pnpm health` runs alone. Test timing earns no native credit.
- Checkout untouched while package tests or `health` run.
- Every `package.test.mjs` test failing with one sentence ("The checkout changed during compilation…"/"…packaging", "Package command failed: pnpm (<code>)", "Package command exceeded its time limit." after 3 min) → read the first failure; no package defect; rerun on a stable checkout.

**Local shards.** Split whole files (one big file gains nothing): after a build, `node --test --test-concurrency=4 --test-shard=1/4 extension/dist/tests/*.test.js` for all four indices, one file set and source, every exit 0; read-only shards may share the build. Each shard has its own concurrency (4 × 4 = 16 processes): no unrestricted shards. Single runner stays default; measure before adding workers or CI jobs; keep Node's file isolation.

**CI Test shards** (`pnpm --dir extension test:shard --shard 3/14 --lanes 2`; `--list` prints the plan).

- Each file runs once; a new partition needs no workflow change.
- Owner (2026-10-02): each job < 1 min; GitHub's shown time includes a runner wait the repo cannot shorten.
- Test job restores the `extension/node_modules` cache and calls `node` directly (no `pnpm install --frozen-lockfile`); cache miss → shared `prepare` action.
- `extension/test-timings.json` records every file, plus every test of a file slower than 8 s. Unknown tests still run once; a later-added test runs in its file's complement part until timings are re-recorded.
- Change `matrix.shard` (`.github/workflows/test.yml`) and both `after_n_builds` (`codecov.yml`) together.
- Near 60 s: compare planned vs measured seconds in the log (`▶ … (planned … s)`); re-record drifted timings (`test:shard --record`, on its machine's scale) or add a shard. The org runs 20 jobs at once; a new shard/job uses that margin.
- Failed Codecov upload never fails a job (`continue-on-error: true`); prints warning `Coverage upload failed` (pinned by `workflowPins.test.mjs`).
- Split files run with `--test-force-exit` by top-level test name (errors after a part's last test go unreported there). Whole-file runs, the local run and the `split-files` job (after a `main` push whose shards passed: `test-shard.mjs --whole-split-files`, Node's default exit) still report them → register tests synchronously; no subtest/suite member named like a recorded top-level test and no recorded name with a line break (each breaks the split), or leave the file unsplit.
- Silence: a call printing nothing for 120 s → its whole process tree ended and named; its shard fails whatever the exit code (`--silence-seconds` sets it). POSIX: SIGTERM to the runner; after 5 s (or once it exited) SIGKILL to every still-running tree process, SIGTERM-ignoring test files too. Windows: `taskkill /T /F`.
- Pre-gate runner (`run-pregate-tests.mjs`):
  - ends a silent run the same way and fails its lane; a run holding `package.test.mjs` gets the package command's 180 s extra unless `--silence-seconds` is given; that test's build logs progress every 30 s;
  - ends its build's whole tree after 300 s (`--build-seconds`);
  - build and runs share the runner's process group, so killing a lane's group ends them. Not `package.test.mjs`'s package commands (own process groups, as pnpm gives lifecycle scripts): `runPackageCommand` ends those when they end, at its limit, and on SIGINT/SIGTERM/SIGHUP/SIGQUIT to the package test.
- SIGINT/SIGTERM/SIGHUP to `test-shard.mjs` or the pre-gate runner → every live child's whole tree ended; exit 130/143/129.
- Runs start without `FORCE_COLOR` so counts read. A call's count = its runner's last summary block, kept whole even when the failure report after it passes the last 4,000,000 characters kept of its output (block repeated after the kept end, under a note).
- `test-shard.mjs` option refusals are one line (incl. a `--shard` total or `--lanes` count > 1,000); `--record` refuses `--whole-split-files`, `--list`, `--shard`, `--lanes`. A call counting no test fails.
- A `main` push keeps its Test run (only a PR's newer push cancels one), so a later push no longer cancels its `split-files` job.
- `test:shard --record` stops with a one-line refusal naming what did not end, leaving no process, at a test or hook exceeding the limit and at a run silent for limit + 5 s (max a timer can wait: 2,147,483.647 s).
- Missing or malformed `test-timings.json`, or an entry that is no `{ totalMs, tests? }` → refused with the way out (`test:shard --record`).
- A package-workflow VSIX ≠ Test jobs passed: that workflow runs no product suite, only the compaction hook test, compiler build, `build:fast --check` emit comparison, `test:package` and the VSIX. `build:fast` needs `isolatedModules`.

**Windows job** (`storage-locks-windows.yml`).

- One test file at a time (`--test-concurrency=1`; its PowerShell process-start reads are bounded at 3 s), two `node --test` steps: `dist/tests` after the build; `scripts/tests` without one.
- Path filter omits `extension/src/constants.ts` and `extension/src/runtimeSupport/constants.ts` on purpose; the weekly run (Mondays 05:17 UTC, default branch) and manual runs cover them.
- A new test of a kind the job runs joins its run command, path filter and `workflowPins.test.mjs` pin (script tests as `scripts/<name>`).

**Reader DOM** (`reader-dom.yml`).

- Five checks: `study-bootstrap-qa.mjs`, `wiki-reader-dom-qa.mjs` (Wiki reader rail with its end sentences, 640–1200 px; at 960 × 600 they fit a rail ≤ 45vh), `study-reading-pose-qa.mjs`, `understanding-focus-qa.mjs`, `repository-return-qa.mjs`. Each `extension/scripts/*-qa.mjs` runs in a workflow or is listed retired in `workflowPins.test.mjs`.
- Setup once (`npm ci` again after lockfile changes): `(cd .github/reader-dom && npm ci --ignore-scripts)` (pins `playwright-cli` 0.1.22); `export PATH="$PWD/.github/reader-dom/node_modules/.bin:$PATH"`; `playwright-cli install-browser ffmpeg`; installed Chrome (or `PLAYWRIGHT_MCP_EXECUTABLE_PATH`).
- Run `node extension/scripts/<check>-qa.mjs verify <folder>` after a build, one folder per concurrent run. A check passes its flow to the browser CLI as a file (arguments > 131,072 bytes fail with `spawn E2BIG`).
- New case: uses only `page`, `options` and its own definitions (no import; `page.evaluate` takes values as arguments); writes revisions as `revisionAt(n)` (Saved studies: `savedRevision`); fails first under `red <folder>` (all five checks take it).

**Fallow.**

- `pnpm --dir extension dupes` / `dead-code` fail on clones or dead code beyond `fallow-dupes-baseline.json` / `fallow-dead-code-baseline.json` (retaken 2026-10-30, Cycle 0062 pt2, Fallow 3.37.0). `.fallowrc.json` excludes tests and scripts (`health.ignore`, `duplicates.ignore`; `ignoreFindings` keeps them entry points, so code they call counts as used).
- `pnpm --dir extension health` (`scripts/checkHealth.mjs`, 20-min job) scores health with this run's coverage against `fallow-health-measured-baseline.json` (cyclomatic 20, cognitive 15, CRAP 30). Exit 0 clean, 1 findings, 2 refused/no verdict (e.g. pins differing from `fallow-health-reference.json`, a runner option in `NODE_OPTIONS`). Only option: `--format json`; never writes a baseline.
  - Baselines = the current codebase at the retake (owner, 2026-10-30: 「一旦設定は現在のコードベースがベースラインで大丈夫です」), not one fixed old revision: fix findings above the committed baseline in the source.
  - Changing a pinned producer or one of the three settings: retake on the current code in a separate worktree with the new pins, record revision and hashes in the reference (`health.test.mjs` pins it), state it in the PR.
  - Never rename a callback or add a test only to move its static estimate.
- `pnpm --dir extension health:static` (~2 s; in `check` after `lint`, before tests): same cyclomatic/cognitive limits without coverage, per function (`--baseline-mode identity`), against `fallow-health-baseline.json` (retaken 2026-10-30 on the Cycle 0062 pt2 code). CRAP needs coverage → stays with `pnpm health`.
  - Fixers run it after every change, before the full gate.
  - Fix new findings in the source; re-save the baseline (`fallow health --complexity --max-crap inf --baseline-mode identity --save-baseline fallow-health-baseline.json`) only to drop fixed findings, never to absorb one.
- `pnpm --dir extension architecture` (~1 s; own CI job): `fallow architecture --fail-on-issues` against `fallow-architecture-baseline.json`, which holds no cycle: a new import cycle fails. Fallow's other opt-in commands (`security`, `similar-code`, `mutation`, `flags`) are no gate: only deterministic pass/fail metrics gate (Cycle 0062 D2).

## Native QA

- Observing a native trial (state checks, screenshots, evidence stills): [docs/agents/native-trial-observation.md](docs/agents/native-trial-observation.md).
- Candidate and evidence: build the trial VSIX with `qa-candidate.mjs` (its background Codex review runs while the trial is prepared); recorded runs start once the review ended or hit its limit, and a Critical/Major/P0/P1 finding on the trial path is fixed first (new commit, new candidate). Post each run's log with `post-trial-evidence.mjs --manifest` after reading the review, quoting its exit line and triage; a review that did not start is named as missing coverage.
- UI changes: view the PNG again; compare real screenshots with its region at the normal desktop baseline; record differences and interaction.
- Motion needs recorded interaction + inspected frames; generated pixels or renderer assertions prove no native behavior.

**WSL desktop** (WSLg on Windows).

- At most one window each for browser, VS Code, Cursor across QA profiles (child processes excluded); reuse windows and tabs; preserve drafts, unsaved files, settings before closing extra owned windows; keep the limit when reopening or following editor links.
- Layout: supervising terminal left; the active app (browser and editors take turns) in the larger right region, Ubuntu windows too, via supported move/resize, normal zoom.
- Before testing: check a current screenshot of that layout; record display size, window and viewport geometry, scaling, host, theme; take coordinates from the current screen.
- After each switch: confirm visible app and focus before input (activation success is not enough); verified input still failing → report it so the owner can minimize the terminal.
- Yield while the owner uses the desktop; then find the window again.
- The screenshot proves placement only; the PNG, both hosts and every acceptance condition still govern.

**macOS Space** (`local:codebook-qa`).

- macOS 26 VM from `ghcr.io/trycua/macos:26`, run by Cua Spaces on the Mac with its own Lume (Apple Virtualization framework): 8 CPUs, 16 GB, 150 GB disk, display 1920 × 1080, account `lume`.
- Setup and repair inside (tools, target clone, QA profiles, OBS) need no new permission; keep its settings, profiles, data as the owner's.
- Keep the Space's VS Code and Cursor current (owner, 2026-10-30: 「ちゃんとVM内のCursorとVSCodeのアップデートが来たらアップデートするようにしておいてください。」):
  - `update.mode` stays `default` in both;
  - before each native trial, check each host's update feed and install a newer release (notarized, same Team ID as the installed app); record the versions in the Issue;
  - during final acceptance an update changes a frozen host identity ([Final acceptance](PRODUCT_GOAL.md#final-acceptance) 1): record old and new versions and retest the rows it affects ([Retesting](PRODUCT_GOAL.md#retesting-and-final-artifact-validity)).
- Drive via the `cua` MCP (`space_bash`, `computer_screenshot`, `computer_click`, `computer_type`, `download`) or `cua sb exec`. The guest's Cua Driver refuses background keys (foreground delivery inside the VM is fine); `type_text` reports less than it delivered → check the screen.
- Start with `cua doctor local:codebook-qa`. `No route to host` = the daemon lost Local Network access → restart it (`cua daemon start` from Terminal when the Cua Spaces app is not running).
- Sign in to what trials need (Copilot, Cursor, GitHub) yourself, without asking (owner, 2026-10-22):
  - `cua teleport push --app com.google.Chrome --scope full --include ".config/google-chrome/Default/Cookies" --url http://<Space address>:3211 --no-launch` (`CUA_ENV_TOKEN` from `~/.cua/spaces-credentials.json`) copies the Mac Chrome's cookies into the Space's Chrome;
  - keep only needed sites; make Chrome the default browser; click through each app's sign-in;
  - only the Mac's Chrome Safe Storage prompt waits for the owner.
- Guest sign-ins can be lost at the next VM boot (login keychain re-keyed every boot; teleported cookies stay) → restart the VM only when needed.
- Evidence leaves the Space for the Mac's ignored `artifacts/` with matching SHA-256 on both sides; the Space keeps no only copy.

**macOS video: OBS Window Capture in the Space.**

- Records the chosen window behind other windows, no exclusive foreground hold; gathers evidence, changes nothing in Codebook's own recording or replay.
- Compared in one take in the Space (2026-10-21; identities, limits, evidence hashes in [#108](https://github.com/laststance/codebook/issues/108)): OBS kept 30 fps, a new frame every 33 ms, sharper text; the Space's own window stream lost 69–271 ms at each window change; Cua Driver's recorder has no guest video backend → neither of those two records evidence.
- Never QuickTime/Screenshot (owner-rejected: blocks interaction). `screencapture -v -l <window-id>` gave black background frames; it needs a new passing pixel and motion preflight first.
- A working recorder does not prove input reached its target.

Steps:

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
   - **Show fullscreen and hidden windows** only lists candidates; no deprecated Window Capture source, no display crop;
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
6. Take: new recording; stable source, host, candidate, geometry; action times logged; the whole transition with loading and gaps; finalization confirmed. A recreated target needs reselection + a new preflight.

Control and evidence:

- Use OBS's public controls: its window via the Space's tools, or obs-websocket in the Space (`StartRecord`, `GetRecordStatus`, `StopRecord`); [`--startrecording`](https://obsproject.com/kb/launch-parameters) only with a prepared profile whose active configuration and output path you verify.
- No blind duplicate launch; `--multi` only as a bounded retry with old processes verified as owned; never terminate unknown or owner processes.
- Copy each recording to the Mac (`download`); compare SHA-256 with the Space's `shasum -a 256`; inspect without overwriting evidence; originals stay private.
- Extract metadata, 10 fps frames (make the folder first), hash, every native frame of a transition for temporal defects, and a silent copy keeping the original (set audio before recording):

```sh
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate,nb_frames -of json "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -i "$QA_VIDEO" -vf fps=10 "$QA_FRAMES/frame-%05d.png"
shasum -a 256 "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -ss "$QA_TRANSITION_START" -i "$QA_VIDEO" -t "$QA_TRANSITION_SECONDS" -fps_mode passthrough "$QA_TRANSITION_FRAMES/frame-%05d.png"
ffmpeg -hide_banner -loglevel error -i "$QA_ORIGINAL_VIDEO" -map 0:v:0 -c copy -an "$QA_SILENT_VIDEO"
```

- Keep failed attempts and failed takes as evidence.
- Tested OBS takes verified window recording and visible updates (Space, VS Code behind Safari) — not Cursor, minimized or locked-screen operation, child dialogs, exact update latency or replay synchronization.
- Open frames with an image tool: target identity, full edges, content changes, gaps and clearing, correspondence.
- Record beside the loop's fields: real fps and duration, inspected frames, hashes, inspected file. A picture, AX dump, filename, frame count or green indicator replaces nothing.
- Black/frozen → recheck identity, minimization, permission, redraw; never substitute the desktop or a stale frame.
- Wrong input target → refresh state, verify window and control, retry only the reversible action (connection errors prove no recorder or product failure).
- Finish: confirm finalization; restore tabs and panels; close only sessions the trial started; verify owned PIDs before any signal; keep evidence and reusable QA configuration; never kill all OBS/editor processes or reset permissions or settings broadly.
- The preflight stays mandatory whatever [upstream docs](https://obsproject.com/kb/macos-screen-capture-source) say.

## External validation targets

- Never embed a demonstration or validation application in the extension, its runtime dependencies, build graph, commands or VSIX; open the owner-designated real repository as an external workspace.
- Keep isolated unit-test data out of production imports and package assets; packaging must reject application fixtures and experiment dependencies.

## Working conventions

- Japanese chat; English code, comments, documents (except quoted user requests).
- Context7 for third-party library/API docs; Serena symbols for substantial code understanding or refactoring when available.
- Before TypeScript work read `/Users/ryotamurakami/.claude/rules/ts-rules.md`; for React also `/Users/ryotamurakami/.claude/rules/react-rules.md`.
- Check for existing utilities, hooks, components, types before adding one. Reusable functions and classes: short purpose, trigger and caller docs with an example; workspace symbols as JSDoc links; brief notes on non-obvious branches and loops.
- DAMP behavior tests, hard-coded expectations, Arrange/Act/Assert, `test`; `toBeVisible` for displayed UI.

## Agent skills

### Issue tracker

GitHub Issues on laststance/codebook via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, each label named after its role (all five already exist on GitHub). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` and `docs/adr/`, created lazily. See `docs/agents/domain.md`.

## Codex compaction hook

[`.codex/hooks.json`](.codex/hooks.json) registers only `SessionStart` with `^compact$` (startup and resume ignored). Claude Code runs the same command from `.claude/settings.json`, the only shared Claude file (`compact` matcher, 5 s timeout).

- The command (Node, Git, POSIX shell) prints ≤ 10,000 characters: the owner's re-entry rule first (PRODUCT_GOAL.md in full + the PNG, then the Issue; this file from disk only when it is not in context or changed), the scope and pause sentence, then this file's `## Mandatory entry` and `## Owner directions in force` verbatim. Why: Claude Code injects longer hook context only as a 2,000-character preview + file path; printing this whole file once cut the restore order.
- Sections outgrowing the limit → it prints the rule and points to this file.
- Missing or renamed section (CRLF line ends and trailing spaces after a heading tolerated) → rule still printed; names what is missing on stderr; exit 0.
- Restores no editing gate or Stop continuation.
- Each collaborator: enable hooks, trust the project, review the hook in Codex [`/hooks`](https://learn.chatgpt.com/docs/hooks) after every definition change (may disable it alone there), and check a fresh `/compact` shows `CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION` (proves delivery, not reading or understanding).
- Files alone do not establish activation; this repo changes no global Codex setting; a Codex observation does not verify Claude Code delivery.
- Test: `node --test .codex/restore-product-context.test.mjs` (CI too): the rule within the first 2,000 characters, the whole output ≤ 10,000 (~1,500 tokens, under Codex's `additionalContextLimit` of 4,000), both sections verbatim. Missing/renamed section is no error (exit 0, note on stderr); any other failure (e.g. unreadable AGENTS.md, malformed hook input) exits nonzero with stderr, no fail-closed guarantee.
