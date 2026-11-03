# codebook agent instructions

Single entry point for every coding agent; Codex and Claude Code (v2.1.281+) load it as project instructions. Keep agent instructions here: a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the repo or any directory above makes Claude Code read that file instead.

## Mandatory entry

Before planning, implementation or runtime trials:

1. New session, or PRODUCT_GOAL.md changed: read [PRODUCT_GOAL.md](PRODUCT_GOAL.md) fully except `## Final acceptance protocol`; open [the approved PNG](assets/codebook-product-spec-v9.png) with image tool; read active cycle Issue (open, label `cycle`) with comments (`gh issue view <N> --comments`).
2. After every context compaction, before any other work, whatever task: read PRODUCT_GOAL.md fully, every line; open PNG with image tool, check identity; then read active cycle Issue with comments. This file already loaded as project instructions: reread from disk only when text not in context or changed on disk since session began. Top rule: goal and image = final product every token spent for; plan or change made without them = waste. Compacted summary, restore hook text or earlier read = no substitute.
3. Final acceptance selected: read [`## Final acceptance protocol`](PRODUCT_GOAL.md#final-acceptance-protocol).

PNG = product to build:

- View it; match to identity (file, size, SHA-256) in [Design target](PRODUCT_GOAL.md#design-target); find live, replay, DeepWiki, shortcut regions. Filename, prompt or alt text don't count.
- Then verify branch, dirty files, tools, runtime, PR state; record reads and image inspection in Issue.
- Missing read, image check or gap audit = entry incomplete: continue independent preparation, report it.

## Where things live

- **Cycle Issue** (label `cycle`, title `Cycle NNNN: <outcome>`) = state. Body: Outcome, Tasks, Owner decisions, Next action; edit when state changes.
  - Tasks: numbered checklist, one line each (source, defect, what closes it); close with "fixed in <sha>" or "evidence: <one line>". Finding during bug-fix cycle = one more task.
  - Near GitHub's 65,536-character limit: continue list in one pinned comment.
- **PR** = results (gate, CI, native QA summary) + Issue reference.
- **Issue closing comment** = outcome + every carried defect; next bug-fix Issue copies that list and comes before other work. Bug-fix cycle states nothing carried (`/spec` starts feature cycle); defects ship review limit records are named, next cycle is bug-fix.
- **CHANGELOG.md** = what each version changes for users.
- **Tag `docs-archive-2026-10-20`** = every record and document removed here.

Read archived docs before work each governs (other records, prompts, external references: only when needed):

- [behavioral design](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/designs/codebook.md): live, capture, replay, runtime, storage, evidence ownership, cross-feature architecture.
- [UI state and interaction review](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/cycle-0029-product-design.md): UI implementation, visual verification.
- [G12 bundled skill plan](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/bundled-codebook-skill.md): shared skill, onboarding.
- [Wiki generation skill plan](https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/plans/deepwiki-generation-skill.md): Wiki generation, update.
- Bring relevant GStack cache findings into Issue; needed evidence never only in chat or cache.

## Cycle rule

Fix every carried defect in next cycle; sole exception: [ship review limit](#delivery). No planning choice, review outcome or skill default overrides this; feature cycle starts clean.

- **Dependencies first**, every cycle (both kinds), before other work.
  - Run `pnpm --dir extension update --latest '!@types/vscode' '!@vscode/*' '!@types/node' '!typescript'`, then move `@types/node` to newest version of pinned Node major and `typescript` to newest 6.x.
  - No TypeScript 7: native port has no JS API for ESLint.
  - Fallow always follows latest release, majors included: catching up later costs more than scoring small step.
  - VS Code packages, `engines` and Node pins stay as they are: newer VS Code API than Cursor's breaks extension in Cursor.
  - Keep exact pins, fix breakages, pass checks, commit on cycle branch.
  - Fallow or c8 version change follows [Fallow](#commands-and-checks) retake rules.
  - Small steps keep breaking changes cheap, security fixes immediate. High `pnpm audit` advisory found mid-cycle = defect of that cycle.
- **Defect** = Critical or Major finding (review marks critical, major, high, blocking, P0 or P1) or failed gate, CI or native check. Medium, Minor, Low, informational findings, test gaps, doc debt = no defects: fixed when cheap and in scope, else answered Skip and named once in PR or short later-candidate list; never start bug-fix cycle.
- **Feature cycle**: increment of final product. Starts only with nothing carried in; planned from final product alone (`/spec` + plan reviews, from PRODUCT_GOAL.md and gap audit). Defects left unfixed are carried.
- **Bug-fix cycle**: follows any cycle that left defect; fixes those, nothing else.
  - Issue: each defect a task (source: cycle + finding label; closing fix or evidence; test failing without fix). No increment; nothing selected, dropped or reduced.
  - Carries nothing: defects found in it (implementation, review, delegated review, native check, audit) fixed in it, except Critical/Major ones ship review limit records.
  - Closes when every carried and found defect closed → feature cycle, or another bug-fix cycle for defects that limit recorded.
- Defect closes by fix + test failing without it, or recorded evidence it is no defect / no longer applies.
- Carried defects live in bug-fix cycle's Issue as tasks; TODOS file, backlog or ledger of them forbidden (list that only records lets work end at recording). Later candidate increments: short list at most, never holding carried defect.
- Delivery: feature cycle fixes Critical findings before merge, carries Major; bug-fix cycle fixes every Critical/Major before merge, except as ship review limit allows. Same for every source (`/review`, `/ship`, local CodeRabbit CLI, delegated review, native check, audit) and failed gate, CI or native check; below Major per defect rule.

## Working loop

Goal and visual target → gap audit → one observable increment → implementation and proof → updated gaps. One active cycle, in authorized phase.

1. **Audit** (Issue = gap ledger).
   - All [acceptance map](PRODUCT_GOAL.md#product-acceptance-map) rows at new cycle, goal/design change or unassessed source change; else verify baseline and changed paths, inspect affected rows, justify carrying rest (docs-only commit may keep product-source baseline, said so).
   - Per row, from source and evidence: **implementation** (match, concrete mismatch, or UNKNOWN + next inspection; existing file, symbol or spec proves no behavior); **proof** (result, host, OS, identity, level, link; absent/stale = unverified; source mismatch and missing runtime evidence = separate gaps); **next action** (change or bounded experiment + verifying observation; UNKNOWN = investigate, never "implemented"/"absent").
   - Gate: all rows and active goals covered; baseline and affected IDs recorded. Read receipt, goal-link list, linked goal ID or old PASS proves nothing.
2. **Select** smallest connected behavior or bounded experiment closing gap or settling highest-impact unknown that could invalidate later work; core-experience blockers before polish; plan only that.
   - Inspect existing code, then freeze in Issue: AC IDs (primary, dependency, regression); gap and why now; starting action → expected result, failure behavior, modules, falsifying observation; procedure, target, host, evidence level, result location.
   - Changed assumption = new expectation version; keep old attempts.
   - Gate: action follows from audit; checkable outcome. Open product gap overrides no documentation-only assignment. Repeated inconclusive attempts → smaller question or new hypothesis, never silent loss of required behavior.
3. **Prove** normal user entry through its result, recovery and preservation included.
   - Reuse modules and real package scripts; mechanism tests for logic, declared native checks for product claims.
   - Record identities, actions, expected/actual results, artifacts, limits as NOT RUN, PARTIAL, FAIL or PASS; listed command = no execution evidence.
   - Gate: evidence supports outcome at declared level. Failed/inconclusive experiment names next hypothesis, proves nothing; code resolving uncertainty = experiment; increments need regression evidence; plan grows only with its question; build alone completes no live, replay or Wiki outcome.
4. **Reassess** changed and dependent rows and regressions.
   - Keep unaffected evidence only with impact reason; compare gaps before/after, keeping missing implementation, missing proof and UNKNOWN; nothing advances because checkbox, skill, image or PR done.
   - Keep, revise or replace approach; update Issue with results + one executable next action; check route still reaches every goal and next candidate hits largest blocker.
   - Gate: rows, checks, UI comparisons recorded; fresh agent recovers product, gaps, proof, phase, failed approaches and next step from repo + Issue, never chat (`/context-save` only speeds this). Markdown = auditable procedure, not proof of comprehension.

## Delivery

Driving agent owns state, cycle selection, completion claims; GStack supplies workflows.

**Chain.**

- One bounded cycle at a time toward complete product; after each merge `/spec` (+ plan reviews scope needs) writes next cycle's Issue.
- Work on `codex/` branch; keep existing edits; reuse fitting checkout.
- Per cycle: one **review round** (4 local CodeRabbit CLI passes on cycle's final range + 4 `open-code-review-delegate` (OCR) reviews, all parallel) → its fixes → `/ship` as PR (native checks: [Native QA](#native-qa)) → required CI → separate exact-HEAD gate → merge as own step with `--match-head-commit`.
- One round only: after fixes go straight to `/ship`; no second round to recheck (`/ship` review catches what they break).
- Parallel reviews: start every review reading no other review's result at once, never sequentially; review waits only for result or tree it reads (`/autoplan` phases stay in order, each reviewing previous phase's amendments; fix-check waits for its fix).
  - Examples: round's 4 CodeRabbit CLI passes (one worktree each, within included hourly reviews, never `--use-credits`) with its 4 OCR delegates (split by review lens when few files qualify); `/ship` pass 1's reviews (Codex structured review, red team, specialists); plan-review phase's native and outside voices (outside one in background shell, then native agent).
- Parallel fixers: pick fixer count and item split finishing soonest, cost no object. Independent items needing no knowledge of each other → one subagent each (100 items → 100 subagents, each own worktree from branch head); only items sharing file region or depending on another's result share subagent or run in order. Integrate by cherry-pick, then one full suite.
- Large cycle may use up to three PRs (`cycle100-pt1`, `cycle100-pt2`, …), each passing reviews, CI, gate alone, merged in order; Issue closes after last.
- Codex automatic review off (no Codex cloud step).
- Hosted CodeRabbit off from Cycle 0057: `.coderabbit.yaml` keeps `reviews.auto_review.enabled: false` (CodeRabbit reads PR branch's file); never post `@coderabbitai review`, no `@coderabbitai ignore` in PR bodies. Merge waits for no hosted review or approval; hosted review still appearing → report in PR, findings follow cycle rule like local review's; run local CodeRabbit CLI on PR's final range before merge.
- Outside review early: `/ship` Step 9 pass 1 also runs Step 11's Codex structured review (`codex review --base main`) on whole diff, findings part of pass 1; plan changing process signalling, process identity or stop/kill path also gets Codex review before implementation. Fix-range pass (pass 2 on) under 300 changed lines dispatches red team and specialists whose area range changes.

**Delivery parameters.**

- Merge: `node extension/scripts/merge-pr.mjs <n>` after exact-HEAD gate in this checkout at PR head (`--help` lists enforced checks): squash with `--match-head-commit <head>`, then fast-forward local `main`; `CodeRabbit` never gates. Hand fallback, only for defect of script itself (named in PR): `gh pr merge <n> --squash --match-head-commit <sha>`.
- Cycle time report: right after each merge, comment on merged PR with cycle's start (Issue creation) and completion (this merge) times and time per work phase and step (spec, each /autoplan phase, implementation, each review and fix round, `/ship` with native checks, CI, gate, merge). Times from recorded timestamps (Issue, commits, logs, `timing.json`); keep running timeline while cycle works; multi-PR cycle reports cycle so far on each.
- `/ship` documentation candidate (`gstack-docs-candidate snapshot`) `--docs` roots: AGENTS.md, CHANGELOG.md, PRODUCT_GOAL.md, README.md, `extension/README.md`, `extension/skills/codebook/SKILL.md`, v9 PNG.
- CI packages via `node extension/scripts/package.mjs --out artifacts/packages/codebook.vsix`, checks via `node extension/scripts/check-package.mjs artifacts/packages/codebook.vsix` (`package.yml`).
- Release commit: besides version files and CHANGELOG.md, one test line (expected version in `extension/scripts/tests/package.test.mjs`); `/ship` Step 16 counts it as release metadata, not reviewed-tree change. Order: `/ship` Step 12 writes `VERSION` and CHANGELOG heading → `node extension/scripts/bump-version.mjs <VERSION>` writes three three-part places → Step 13 writes entry → `bump-version.mjs --check` exits 0 (`test:package` fails any commit whose five places disagree).

**Pre-gate:** `/ship` pre-gate = Stage 1 only: `gstack-pregate --stage preflight --allow-repo-commands`, secrets scan every time. Test lanes (Stage 2) = `pnpm --dir extension test` on final tree + required CI.

**Background work.**

- `node extension/scripts/watch-background.mjs` (from Claude Code's start directory, else `--project <it>`) lists this session's (`CLAUDE_CODE_SESSION_ID`) background tasks and subagents with last-output time; marks silent > 20 min, never marks finished/stopped subagents; shell's row stays marked after end (task notification authoritative).
- Review subagent silent 20 min → stop, redispatch on narrower scope.
- Subagent stopped by API safety filter → redispatch at once, same brief, fallback model.
- Waiting more than few minutes → tell owner what awaited and since when.

**Ship review limit.**

- Installed `/ship`: max three fixing cycles; no fourth, no counter reset after handoff, no round relabeled repair. Limit is `/ship`'s alone (one round is long; full convergence would stall delivery).
- Third cycle still has findings (`converged:false`) → feature and bug-fix cycles alike, per defect rule:
  - fix every last-round Critical/Major finding and cheap in-scope lower ones; Critical never merges open (one the PR cannot close holds the merge until fixed); answer rest Skip, named once in PR;
  - record only still-open Critical/Major defects in GitHub Issue (next cycle's tasks): defects of `/ship` rounds the PR cannot close (e.g. Major finding whose fix/proof needs unknown root cause or native check); overrides no-carry for those only;
  - merge after required CI + exact-HEAD gate, reporting `converged:false` in PR.

**Skills** (read each installed SKILL.md at invocation; map guides, copies no workflow):

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
- Merge/deploy → `/land-and-deploy` if available, else established extension delivery.
- Changed public behavior → `/document-release`.
- Pause/handoff → `/context-save`, then `/context-restore`, reconciled with repo and Issue.
- Ordinary coding = agent's work; docs-only changes need only applicable reviews; failed experiment may inform next cycle before release.
- Browser QA alone (Reader DOM included) proves no native behavior, e.g. pixels, DAP targeting, MCP integration, installed VSIX behavior; missing tool → report as missing coverage.

**Skills under the cycle rule** (each runs as installed):

- `/spec`: plans feature increment from PRODUCT_GOAL.md + gap audit, or writes bug-fix Issue from previous closing comment (one task + acceptance criterion per carried defect, nothing ranked or selected).
- Plan reviews may change how carried defect fixed; never remove, merge away or defer one.
- `/review`, `/ship` review steps follow [Cycle rule](#cycle-rule)'s Delivery bullet; no automatic fixes of informational findings.
- `/ship`: commit coverage audit's tests; plan completion audit counts open bug-fix task NOT DONE and stops (no ship anyway, defer or drop); TODOS step writes no TODOS.md; fix documentation-audit blockers before commit.
- Test gap, deferral, non-blocking doc debt, skill follow-up: later candidates, no carried defects.

**Invocation.**

- Pass Issue, phase, bounded scope explicitly; PRODUCT_GOAL.md = destination, not permission to build everything.
- Retired G08/G09 never return via old prompt.
- Give design skills `## Design target` and PNG.
- Honor scope gates, passing no agent-chosen target off as user's; keep required reports; one approved recommendation authorizes no unrelated change.
- Shared-skill and Wiki-generation scope → DX + engineering review; discovery, loaded identity, runtime connection, AI-owned results = separate checks; Wiki works without runtime/debug MCP.

**CodeRabbit and OCR.**

- [.coderabbit.yaml](.coderabbit.yaml) = policy + exclusions: keep guidelines current; validate with `coderabbit config validate .coderabbit.yaml`; pass via `--config` beside extra context.
  - CLI 0.9.1 exits 1 on every file with `unknown keyword: "x-undocumented"` (own schema defect): record that line as validation result; review with `-c` still applies file.
- Required: local CodeRabbit CLI, findings triage, CI, OCR (picks files and rules, host reviews; each eligible file reviewed or skipped with reason; default exclusions reported apart; no independent external review).
- Review against implementation base; record completion, source cut, covered files, findings.
- Missing/private provider context = coverage limit.
- Every user-visible behavior a CHANGELOG entry names needs sentence in packaged README (`extension/README.md`), as `.coderabbit.yaml`'s `CHANGELOG.md` instruction checks; fix changing user-visible behavior changes that README in same commit; fixers' briefs say so.
- Claude Code CLI review: skipped; no native chat acceptance.

**States** (independent):

- Status: ready → planning → implementing → validating → closed, or blocked with condition + unblocking action (say why work moves back).
- Result: pending, demonstrated, falsified, inconclusive.
- Delivery: not-applicable, local-only, committed, PR-open, merged, packaged, published, installed-verified.

**Closure.** Name next cycle's kind; after clean bug-fix cycle, at most one candidate increment. Run integrated checks once capabilities depend on each other. Shipping task stays open until authorized gates finish.

**GitHub.**

- [laststance/codebook](https://github.com/laststance/codebook) public: everything pushed (Issues, PRs) world-readable, security defect before fix too.
- Goal Issue [#1](https://github.com/laststance/codebook/issues/1) stays open until full acceptance + owner approval.
- Use `goal` and `cycle` labels; link PRs and evidence; choose Issues from evidence, never speculative roadmap or planning tool's need; closed Issue alone proves nothing.
- Close cycle Issue only for demonstrated or falsified outcome with complete delivery (inconclusive investigation may stop with outcome open).
- GitHub unreachable → keep Issue edit pending.
- Tracking authorized; production deployment, publication, recurring automations need user's authorization.

## Standing directions

No decision log; delivery chain and ship limit: [Delivery](#delivery).

- **Fallow scores application code only:** `extension/src` without `src/tests`, plus `extension/skills`; tests and `extension/scripts` excluded ([checks](#commands-and-checks)).
- **Everything for the product:** all resources to fastest, highest-quality build of PRODUCT_GOAL.md's application.
  - Skip rule, convention or skill step plainly adding nothing to product instead of following by habit.
  - Docs unrelated to application ride on current work branch: no separate PR, no wait on CI with obvious result.
  - Still forbidden: spending money without owner's permission; anything illegal. Irreversible steps under **Never without the owner** still wait for owner.
- **Every agent rule in AGENTS.md:** every agent rule and procedure lives in this file. Never create `docs/` folder or another rule or procedure document, even when review suggests one. Assets like approved PNG live in `assets/`.
- **Process feedback:** development-flow step wasting much time, or step rules lack for completing product, once noticed → post in repo's [GitHub Discussions](https://github.com/laststance/codebook/discussions) (category Ideas): observation, evidence, cost, proposal. Public: no private paths or secrets. Current cycle continues meanwhile.
- **The owner cannot answer:** every decision point → recommended option, named in Issue's Owner decisions. Owner-directed pause → stop at once; only owner's explicit message lifts it. Conditional pause ("when X is done, stop") not immediate.
- **Dedicated Windows development machine:** setup and repair (IME settings, QA reinstall/reset, needed data removal) need no new permission. Spend time on live explanation, save, synchronized replay. Remedy truly needing owner → research it, finish independent preparation, give concrete verified steps. Outcomes and gates still govern.
- **Never without the owner:** buying credits, subscription or billing changes, new or changed credentials, permanent deletion, security settings, repository visibility.
  - Signing in with owner's existing sessions to what work needs = agent's job, no asking.
  - Preserve owner's and others' edits, profiles, extensions, skills, settings, tabs, drafts, learning, target source, credentials.
- **Varied questions; learning fits the question:** learners study many processes in many codebases.
  - Trials, evaluations, examples ask natural questions about different code paths and processes of target, varied across rounds and hosts; never one fixed prompt (cart, login or invoice example) round after round.
  - v9 PNG fixes screen hierarchy and interactions, not learning content: summaries, sequence diagrams, explanations generated per question as clear, graphical learning resources from what actually ran.
  - Never shape skill, generation, help examples or acceptance to reproduce image's sample flow, participants or text.
- **Who operates a native check:** driving agent itself (chat submissions, replay checks, every native check a row owes), never subagent; implementation may run in subagents.
- **Trial coordination:** dedicated VS Code and isolated-profile Cursor trials need no screen-time slot; on Mac they run in [macOS Space](#native-qa), never on owner's desktop. Ask only when real interference with owner's work blocks trial (possible focus change isn't that). Report recording truly needing exclusive foreground.
- **Hosts:** development on Mac or Windows machine with WSL2; owner moves it back to Mac when free. Target systems: [Product constraints](PRODUCT_GOAL.md#product-constraints).
  - Mac: macOS native checks and OBS recordings run in Cua Space `local:codebook-qa` (macOS VM) so owner keeps using Mac ([Native QA](#native-qa)); Mac's own desktop only when owner directs, with its procedures (protected Mac settings hashes, Computer Use grants).
  - `/Users/ryotamurakami` paths = Mac.
  - Native check on another host freezes own procedure and identities in Issue, reports what it couldn't run.
  - Evidence depending on Mac's private `artifacts/`, Space, QA profiles or local branches never carries over by assumption.
- **Final acceptance:** nine fixed projects in two ordered stages per [protocol](PRODUCT_GOAL.md#final-acceptance-protocol): Stage 1, then nine independent junior-developer Stage 2 evaluators, each PASS with confidence ≥9/10, no consecutive-pass counter; ten-reviewer, random-pool, consecutive-pass gates retired. Completion also needs owner acceptance.

## Authority and completion

- PRODUCT_GOAL.md owns outcomes, its contracts the details, its [Design target](PRODUCT_GOAL.md#design-target) the visual target; cycle Issue = gaps, cycle decisions, plan, next action; PR = results. Later explicit owner direction wins.
- Write owner rule as rule itself into required read it governs.
- PRODUCT_GOAL.md changes only on explicit owner direction, with evidence and concrete alternative; then raise goal version, say why. Route within goal = agent's.
- Keep all active goals while selecting one increment. Change accepted behavior only on explicit owner direction. Routine choices in authorized phase need no repeated permission; open gap doesn't authorize leaving it.
- Keep evidence apart per host (VS Code, Cursor, independent browser) and per OS (macOS, Windows, Ubuntu): one verifies no other. Keep runtime and library coverage and stage order.
- Complete authorized cycle, update Issue, recommend one next action; go further only within owner authorization. These instructions create no background jobs, separate tasks or automations.
- Changed UI needs mapped evidence + current image comparison before review-complete.
- Keep distinct, report apart: implementation, live validation, review, CI, merge, packaging, publication, installed verification, owner acceptance. Missing required check blocks completion claim; unperformed work stays unverified.
- Recordings and sensitive runtime data stay in ignored or other durable private storage, out of public changes; link sanitized evidence (manifests) by stable location, hash, source identity. Before handoff or checkout deletion, make required evidence reachable, update location and hash; missing artifact voids its proof until revalidated.

## Development target

- Until nine-project final acceptance starts, actual-editor trials use `nextjs-dashboard` (same repo and revision): Mac **`/Users/ryotamurakami/repository/nextjs-dashboard`**; its macOS Space **`/Users/lume/repository/nextjs-dashboard`**; Windows host **`/home/murakami/laststance/nextjs-dashboard`**.
- Exception: Node server execution form, which `nextjs-dashboard` lacks, trialled on pinned clone of P08 `laststance/switch-time` in Space (`/Users/lume/qa/c57/switch-time`, revision recorded in cycle Issue), with documented local stack.
- Exception (Cycle 0073 decision D2, Issue #188; owner may revoke): Pages Router server-side forms (`getServerSideProps`, `getStaticProps`), which `nextjs-dashboard` lacks, trialled on pinned clone of P02 `TanStack/query`'s `examples/react/nextjs` in Space (`/Users/lume/qa/c73/tanstack-query`, revision recorded in cycle Issue).
- Never easier repo, never tenth acceptance target. Recheck revision, settings, dirty state; tell owner before occupying desktop; record unsupported behavior and missing setup. Docs-only work needs no native launch.
- All development results, two exceptions included, = development evidence only: no nine-project credit, no final row filled; fixture results likewise. Final acceptance freezes own targets and candidate; Stage 1 starts only when prerequisites hold.
- Use real opened repos; isolated inputs verify mechanisms only, never as bundled demos or practical trials. Retired local trial resources removed; old records in Git = no current proof.
- Development chats: VS Code = Copilot Chat, model **GPT-6.1 Terra** (replaces GPT6 Luna; listed in Space's VS Code 1.142.0, GPT-6.1 Luna not); before each VS Code trial search picker for `6.1` and `luna` → switch to GPT-6.1 Luna, cheaper, if it appears; Cursor = Agent, model **Grok 4.6 high**, Fast on allowed; after observed credit exhaustion (either host) = installed **Codex Extension** (Claude Code extension fallback retired).
  - Model missing from picker → that host's trial NOT RUN, picker list recorded.
  - Record actual chat and fallback reason; buy no credits; never label fallback evidence Copilot.
  - QA profiles run chat tools with full access (owner 2026-11-03), so no trial spends steps on per-tool approval clicks: VS Code QA profile `chat.permissions.default: "autoApprove"` (Allow all); Cursor Settings → Agents → Run Mode **Run Everything (Unsandboxed)**. Check before each trial; record it as a trial identity. Cursor's theme is **Cursor Dark** (`window.autoDetectColorScheme: false`; owner preference).
  - Final acceptance has own standard-chat rules. Historical Claude extension observations keep identities.

## Commands and checks

- Node per `.node-version` (mirrored in `extension/.node-version`: version manager's shim reads nearest package's `engines` there), pnpm per extension's `packageManager`, Bun per `.bun-version`.
  - `pnpm install` doesn't provide Bun: install that version, e.g. `curl -fsSL https://bun.com/install | bash -s "bun-v$(cat .bun-version)"`, else commit hook and format check fail.
  - Put that Node's own `bin` first in `PATH`; run from repo root.

Delivery commands (`--help` prints usage, exit codes, `E_…` codes; refusal's first line = code, last line `Fix:`):

| Command | When |
| --- | --- |
| `node extension/scripts/bump-version.mjs <v>` / `--check` | release commit, after `/ship` Step 12 |
| `node extension/scripts/qa-build.mjs` (`--status`) | on clean commit whose VSIX native check installs |
| `node extension/scripts/post-trial-evidence.mjs <run-log.md> --manifest artifacts/<cycle>/<host>-<run>` | after native check |
| `node extension/scripts/merge-pr.mjs <n>` (`--dry-run`) | merge, after CI and exact-HEAD gate |

Formatting: `pnpm --dir extension format` / `format:check` and lint-staged hook run `bun fmt` (Bun of `.bun-version` on `PATH`, installed by `format.yml`, checked by gate; reads `.prettierrc.json` and `.prettierignore`; gives Prettier 3.9.8 result on this tree). Never format README with it: hand-edit README sentences.

**Gate and focused runs.**

- Exact-HEAD gate: `pnpm --dir extension gate` = sixteen delivery checks in order (static checks incl. import-cycle check, suite, five Reader DOM checks, package tests, measured health, compaction-hook test), one log each under `artifacts/gate/<HEAD>`; refuses Node, pnpm or Bun off pins and checkout with changes; exits 0 only when every check passed on unmoved HEAD.
- `pnpm --dir extension test` = build + Node's isolated runner (files parallel, tests in file serial; never same-process concurrency globally: workspace cases mock shared prototypes and timers). `pnpm --dir extension test:package` = package tests.
- CI failures: `node extension/scripts/ci-failures.mjs <PR>` (or `--run <id>`) prints each failed job's failing tests + first error line, also mid-run.
- Focused replay/workspace work: `pnpm --dir extension build` once, then `node --test extension/dist/tests/studyWorkspace*.test.js extension/dist/tests/playbackController.test.js` (every partition; `studyWorkspace.test.js` alone is one); reuse current build.
- `studyWorkspaceHarness.ts` = fixtures only; each harness makes own temp repo. Related race steps in one test; await each observable result before next action. Keep real timeouts, production deadlines, assertions.

**Order and isolation.**

- Build before any `extension/dist` reader; context-hook test needs no `dist`.
- Package regressions (≤ 4 isolated processes; one package producer per checkout) start after every extension test process or shard ends: they rebuild `dist` (live readers fail with missing modules; separate checkout isolates, another VSIX path doesn't).
- `pnpm health` runs alone. Test timing earns no native credit.
- Checkout untouched while package tests or `health` run.
- Every `package.test.mjs` test failing with one sentence ("The checkout changed during compilation…"/"…packaging", "Package command failed: pnpm (<code>)", "Package command exceeded its time limit." after 3 min) → read first failure; no package defect; rerun on stable checkout.

**Local shards.** Split whole files (one big file gains nothing): after build, `node --test --test-concurrency=4 --test-shard=1/4 extension/dist/tests/*.test.js` for all four indices, one file set and source, every exit 0; read-only shards may share build. Each shard own concurrency (4 × 4 = 16 processes): no unrestricted shards. Single runner stays default; measure before adding workers or CI jobs; keep Node's file isolation.

**CI Test shards.** `pnpm --dir extension test:shard --shard 3/14 --lanes 2`; `--list` prints plan.

- Each file runs once; new partition needs no workflow change. Each job < 1 min; GitHub's shown time includes runner wait repo can't shorten.
- Test job (`test.yml`) restores `extension/node_modules` cache, calls `node` directly (no `pnpm install --frozen-lockfile`); cache miss → shared `prepare` action.
- `extension/test-timings.json` records every file + every test of file slower than 8 s. Unknown tests still run once; later-added test runs in its file's complement part until timings re-recorded.
- Change `matrix.shard` (`.github/workflows/test.yml`) and both `after_n_builds` (`codecov.yml`) together.
- Near 60 s: compare planned vs measured seconds in log (`▶ … (planned … s)`); re-record drifted timings (`test:shard --record`, on its machine's scale) or add shard. Org runs 20 jobs at once; new shard/job uses that margin.
- Failed Codecov upload never fails job (`continue-on-error: true`); prints warning `Coverage upload failed` (pinned by `workflowPins.test.mjs`).
- Split files run with `--test-force-exit` by top-level test name (errors after part's last test unreported there). Whole-file runs, local run and `split-files` job (after `main` push whose shards passed: `test-shard.mjs --whole-split-files`, Node's default exit) still report them → register tests synchronously; no subtest/suite member named like recorded top-level test, no recorded name with line break (each breaks split); else leave file unsplit.
- Silence: call printing nothing for 120 s (`--silence-seconds`) has whole process tree ended (SIGTERM, SIGKILL after 5 s; `taskkill /T /F` on Windows) and named, shard fails whatever exit code. Pre-gate runner (`run-pregate-tests.mjs`) does same, gives run holding `package.test.mjs` 180 s extra unless `--silence-seconds` given (that test's build logs progress every 30 s), ends build's tree after 300 s (`--build-seconds`). SIGINT/SIGTERM/SIGHUP to either runner ends every live child's tree (exit 128 + signal: 130/143/129). Limits: `--shard` total and `--lanes` ≤ 1,000; last 4,000,000 characters of call's output kept; `--record` stops at silence limit + 5 s (max 2,147,483.647 s). `FORCE_COLOR` stripped, option and timings-file refusals name way out, `main` push keeps its Test run; details in headers and docstrings of `extension/scripts/test-shard.mjs`, `extension/scripts/run-pregate-tests.mjs`, `extension/scripts/utils/` and `concurrency` comment of `.github/workflows/test.yml`.
- Package-workflow VSIX ≠ Test jobs passed: that workflow runs no product suite, only compaction hook test, compiler build, `build:fast --check` emit comparison, `test:package` and VSIX. `build:fast` needs `isolatedModules`.

**Windows job** (`storage-locks-windows.yml`).

- One test file at a time (`--test-concurrency=1`; product bounds PowerShell process-start reads at 3 s); new test of a kind the job runs joins its run command, path filter and `workflowPins.test.mjs` pin (script tests as `scripts/<name>`).
- Path filter omits `extension/src/constants.ts` and `extension/src/runtimeSupport/constants.ts` on purpose; weekly run (Mondays 05:17 UTC, default branch) and manual runs cover them.

**Reader DOM** (`reader-dom.yml`).

- Five checks: `study-bootstrap-qa.mjs`, `wiki-reader-dom-qa.mjs` (Wiki reader rail with end sentences, 640–1200 px; at 960 × 600 they fit rail ≤ 45vh), `study-reading-pose-qa.mjs`, `understanding-focus-qa.mjs`, `repository-return-qa.mjs`. Each `extension/scripts/*-qa.mjs` runs in workflow or listed retired in `workflowPins.test.mjs`.
- Setup once per checkout or worktree, before gate (its five Reader DOM checks) or Reader DOM check runs there (`npm ci` again after lockfile changes): `(cd .github/reader-dom && npm ci --ignore-scripts)` (pins `playwright-cli` 0.1.22); `export PATH="$PWD/.github/reader-dom/node_modules/.bin:$PATH"`; `playwright-cli install-browser ffmpeg`; installed Chrome (or `PLAYWRIGHT_MCP_EXECUTABLE_PATH`).
- Run `node extension/scripts/<check>-qa.mjs verify <folder>` after build, one folder per concurrent run. Check passes flow to browser CLI as file (arguments > 131,072 bytes fail with `spawn E2BIG`).
- New case: uses only `page`, `options` and own definitions (no import; `page.evaluate` takes values as arguments); writes revisions as `revisionAt(n)` (Saved studies: `savedRevision`); fails first under `red <folder>` (all five checks take it).

**Fallow.**

- **Lower the scores actively**, any cycle. Finding behaviour-neutral refactor can remove = refactored: tests unchanged and green, native path rechecked when natively verified. Fixed findings then dropped from baseline. Prefer hotspots and targets `fallow health --hotspots --targets` ranks, and `fallow fix --dry-run` for dead code.
- `pnpm --dir extension dupes` / `dead-code` fail on clones or dead code beyond `fallow-dupes-baseline.json` / `fallow-dead-code-baseline.json` (Fallow 3.38.1). `.fallowrc.json` also keeps excluded tests and scripts as entry points (`ignoreFindings`), so code they call counts as used.
- `pnpm --dir extension health` (`scripts/checkHealth.mjs`, 20-min job; header: exit codes, one option `--format json`, never writes baseline) scores health with this run's coverage against `fallow-health-measured-baseline.json` (cyclomatic 20, cognitive 15, CRAP 30). Exit 2 = refused/no verdict (e.g. pins differing from `fallow-health-reference.json`, runner option in `NODE_OPTIONS`).
  - Baselines = current codebase at retake, not one fixed old revision: fix findings above committed baseline in source.
  - Changing pinned producer or one of three settings → retake on current code in separate worktree with new pins, record revision and hashes in reference (`health.test.mjs` pins it), state in PR.
  - Never rename callback or add test only to move its static estimate.
- `pnpm --dir extension health:static` (~2 s; in `check` after `lint`, before tests): cyclomatic/cognitive limits of `pnpm health` without coverage, per function (`--baseline-mode identity`), against `fallow-health-baseline.json`. CRAP needs coverage → stays with `pnpm health`.
  - Fixers run it after every change, before full gate.
  - Fix new findings in source; re-save baseline (`fallow health --complexity --max-crap inf --baseline-mode identity --save-baseline fallow-health-baseline.json`) only to drop fixed findings, never to absorb one.
- `pnpm --dir extension architecture` (~1 s; own CI job): `fallow-architecture-baseline.json` holds no cycle, so new import cycle fails.
- **Every free local Fallow analysis runs in CI.**
  - Today also `audit`, `flags`, `security`, `similar-code`, `mutation` (changed code vs base) and `suppressions`.
  - Command a Fallow update adds gets CI step in that cycle's dependency step.
  - Deterministic pass/fail results gate, against baseline where command has one.
  - Candidate or discovery output (`security`, `similar-code`, `flags`, `suppressions`) goes to job summary without gating.
  - `mutation` checks tests fail without code they test, which delegated fixer may skip. Runs in own job with `--time-budget 10m` (~10 min limit; 30 too long), gates with `--min-score` once measured run sets level. Surviving mutant raises test that only walks branch into one failing on real bug in real application state; when that state hard to reach, function too complex: simplify (lower scores, above).
  - Prefer `parallel:` steps in one job over new jobs: 20 concurrent jobs on Free plan.
  - Fallow Cloud runtime coverage stays out: paid.

## Native QA

- Native checks part of `/ship`, not own phase: VS Code and Cursor checks cycle owes run as `/ship` Step 9.2.1's required plan checks (QA step), beside smoke probes.
- Build and evidence: build VSIX with `qa-build.mjs` from clean commit `/ship` reviews, install in each host; build gets no own review. Critical/Major finding of check fixed in that `/ship` pass (new commit, new build, check repeated). Post each run's log with `post-trial-evidence.mjs --manifest`, quoting exit line.
- UI changes: view PNG again; compare real screenshots with its region at normal desktop baseline; record differences and interaction.
- Motion needs recorded interaction + inspected frames; generated pixels or renderer assertions prove no native behavior.
- All work on WSL desktop or in macOS Space (setup, repair, native check, recording, moving evidence to Mac) follows rules below.

**Observing a native check** (Cua Space `local:codebook-qa` or desktop). `computer_screenshot` answers ~600,000 characters; in Cycles 0056 to 0058 screenshots were 85% of all tool output and forced most context compactions → check state with **text** first, spend **pictures** on visual evidence.

- Text for every step only needing to know what's there (window, dialog, label, value, process, file):
  - windows and focus: `computer_window_list` (filter with `app`), `computer_get_current_window`;
  - controls and labels (buttons, dialog titles, picker entries, chat's input text): `computer_get_accessibility_tree` with window's `window_id` and `max_depth`;
  - acting on control: `computer_accessibility_act` with tree's `snapshot_id` and `element_id` (`press`, `focus`, `set_value`), no coordinates, so no screenshot to find them;
  - processes, ports, files, logs in Space: `space_bash`, e.g. `lsof -nP -iTCP:4100 -sTCP:LISTEN`, `pgrep -fl 'Visual Studio Code'`, `osascript -e 'tell application "System Events" to get name of every window of process "Code"'`, or `tail` of file a step writes;
  - verify action's result same way (tree, process or file).
- Pictures for claim about what learner sees (layout against v9 PNG, rendering, motion frame): capture region in Space, shrink, then `download` `/tmp/shot.jpg` and Read it:

```sh
screencapture -x -R<x>,<y>,<width>,<height> /tmp/shot.png
sips -s format jpeg -s formatOptions 70 -Z 1000 /tmp/shot.png --out /tmp/shot.jpg
```

- Evidence stills: keep full-size PNG as evidence file (downloaded per macOS Space rules below); Read only reduced copy.
- Coordinates: `computer_screenshot` when click needs coordinates accessibility tree can't give (canvas, webview without accessible names); its pixel space = one clicks use.
- Motion: recordings and frames follow OBS rules below; Read reduced frames (`ffmpeg … -vf scale=1000:-1`).

**WSL desktop (WSLg on Windows).**

- At most one window each for browser, VS Code, Cursor across QA profiles (child processes excluded); reuse windows and tabs; preserve drafts, unsaved files, settings before closing extra owned windows; keep limit when reopening or following editor links.
- Layout: supervising terminal left; active app (browser and editors take turns), Ubuntu windows too, in larger right region via supported move/resize, normal zoom.
- Before testing: check current screenshot of layout; record display size, window and viewport geometry, scaling, host, theme; take coordinates from current screen.
- After each switch: confirm visible app and focus before input (activation success not enough); verified input still failing → report so owner can minimize terminal.
- Yield while owner uses desktop; then find window again.
- Screenshot proves placement only; PNG, both hosts, every acceptance condition still govern.

**macOS Space (`local:codebook-qa`).**

- macOS 26 VM from `ghcr.io/trycua/macos:26`, run by Cua Spaces on Mac with own Lume (Apple Virtualization framework): 8 CPUs, 16 GB, 150 GB disk, display 1920 × 1080, account `lume`.
- Setup and repair inside (tools, target clone, QA profiles, OBS) need no new permission; treat its settings, profiles, data as owner's.
- Keep Space's VS Code and Cursor current:
  - `update.mode` stays `default` in both;
  - before each native check, check each host's update feed, install newer release (notarized, same Team ID as installed app); record versions in Issue;
  - during final acceptance update changes frozen host identity ([Final acceptance](PRODUCT_GOAL.md#final-acceptance) 1): record old and new versions, retest rows it affects ([Retesting](PRODUCT_GOAL.md#retesting-and-final-artifact-validity)).
- Drive via `cua` MCP (`space_bash`, `computer_screenshot`, `computer_click`, `computer_type`, `download`) or `cua sb exec`. Guest's Cua Driver refuses background keys (foreground delivery inside VM fine); `type_text` reports less than delivered → check screen.
- Start with `cua doctor local:codebook-qa`. `No route to host` = daemon lost Local Network access → restart (`cua daemon start` from Terminal when Cua Spaces app not running).
- Sign in to what native checks need (Copilot, Cursor, GitHub):
  - `cua teleport push --app com.google.Chrome --scope full --include ".config/google-chrome/Default/Cookies" --url http://<Space address>:3211 --no-launch` (`CUA_ENV_TOKEN` from `~/.cua/spaces-credentials.json`) copies Mac Chrome's cookies into Space's Chrome;
  - keep only needed sites; make Chrome default browser; click through each app's sign-in;
  - only Mac's Chrome Safe Storage prompt waits for owner.
- Guest sign-ins can be lost at next VM boot (login keychain re-keyed every boot; teleported cookies stay) → restart VM only when needed.
- Evidence leaves Space (`download`) for Mac's ignored `artifacts/` with matching SHA-256 both sides (`shasum -a 256` in Space); Space keeps no only copy.

**macOS video: OBS Window Capture in the Space.**

- Records chosen window behind other windows, no exclusive foreground hold; gathers evidence, changes nothing in Codebook's own recording or replay.
- One-take comparison in Space (identities, limits, evidence hashes: [#108](https://github.com/laststance/codebook/issues/108)): OBS kept 30 fps, new frame every 33 ms, sharper text; Space's own window stream lost 69–271 ms at each window change; Cua Driver's recorder has no guest video backend → neither of those two records evidence.
- Never QuickTime/Screenshot (blocks interaction). `screencapture -v -l <window-id>` gave black background frames → needs new passing pixel and motion preflight first.
- Working recorder doesn't prove input reached target.

OBS steps:

1. Install [official OBS](https://obsproject.com/download) in Space (version and architecture checked), never in extension, build graph or VSIX.
   - Keep existing profiles and scenes; use named QA profile and scene collection; record actual active name.
   - Renderer Metal (`global.ini`, `[Video] Renderer=Metal`): OpenGL renders in software at ~6 fps, recording doesn't start.
   - Keep editor settings, unrelated windows, drafts, debugger sessions, learner data.
   - Grant screen recording only (no camera, microphone, input monitoring, remote control) in Space's System Settings; reopen OBS when asked; allow macOS's direct window capture prompt.
   - Turn global audio devices off before starting; check silent take's tracks.
2. Per host, identify exact editor window, repo and profile (never first similar name); recheck title, host version, source and dirty state, VSIX, runtime and skill identities, display and window size, zoom, theme.
3. Add **macOS Screen Capture**. Before every take, check Properties:
   - **Method: Window Capture** (Display/Application Capture records other windows);
   - **Window:** exact QA window (`[Code] … (Workspace) — <QA profile>`); name never shows mode;
   - **Show fullscreen and hidden windows** only widens window list; no deprecated Window Capture source, no display crop;
   - minimizing pauses stream (occlusion and another desktop differ);
   - switching hosts: pick other window, redo steps 4–6.
4. **Edit → Transform → Reset Transform**; check size, position, rotation, four crops.
   - Pixel comparisons: Base (Canvas) and Output (Scaled) resolution = source, even pixels (H.264 needs even sizes: resize odd window first); recheck after canvas/window changes; label scaled overview, keep unscaled evidence.
   - Check preview's corners (title, Activity Bar or debugger, source, summary or chat, transport or status bar): cropped = not ready.
   - Verify frame rate in saved file; claim no finer timing (30 fps proven, not 60).
5. Preflight, before take counts:
   - start; see **Stop Recording** with running timer;
   - make reversible visible change; confirm painted pixels change (titles or AX values can lead); restore it;
   - another app in front without minimizing: target keeps updating, other stays out;
   - before native input (brief activation allowed): check focus and stale-target errors; never type into unverified palette or submit terminal draft;
   - stop; check metadata and frames; reject black, frozen, wrong-window or cropped output; tell input from recorder failures; diagnose no product from them.
6. Take: new recording; stable source, host, VSIX build, geometry; action times logged; whole transition with loading and gaps; finalization confirmed. Recreated target needs reselection + new preflight.

OBS control and evidence:

- Use OBS's public controls: its window via Space's tools, or obs-websocket in Space (`StartRecord`, `GetRecordStatus`, `StopRecord`); [`--startrecording`](https://obsproject.com/kb/launch-parameters) only with prepared profile whose active configuration and output path you verify.
- No blind duplicate launch; `--multi` only as bounded retry with old processes verified as owned.
- Copy each recording to Mac as evidence (above); inspect without overwriting; originals stay private.
- Extract metadata, 10 fps frames (make folder first), hash, every native frame of transition for temporal defects, and silent copy keeping original (set audio before recording):

```sh
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate,nb_frames -of json "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -i "$QA_VIDEO" -vf fps=10 "$QA_FRAMES/frame-%05d.png"
shasum -a 256 "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -ss "$QA_TRANSITION_START" -i "$QA_VIDEO" -t "$QA_TRANSITION_SECONDS" -fps_mode passthrough "$QA_TRANSITION_FRAMES/frame-%05d.png"
ffmpeg -hide_banner -loglevel error -i "$QA_ORIGINAL_VIDEO" -map 0:v:0 -c copy -an "$QA_SILENT_VIDEO"
```

- Keep failed attempts and failed takes as evidence.
- Tested OBS takes verified window recording and visible updates (Space, VS Code behind Safari); not Cursor, minimized or locked-screen operation, child dialogs, exact update latency or replay synchronization.
- Open frames with image tool: target identity, full edges, content changes, gaps and clearing, correspondence.
- Record beside [loop](#working-loop)'s fields: real fps and duration, inspected frames, hashes, inspected file. Picture, AX dump, filename, frame count or green indicator replaces nothing.
- Black/frozen → recheck identity, minimization, permission, redraw; never substitute desktop or stale frame.
- Wrong input target → refresh state, verify window and control, retry only reversible action (connection errors prove no recorder or product failure).
- Finish: confirm finalization; restore tabs and panels; close only sessions check started; verify owned PIDs before any signal, never terminate unknown or owner processes or kill all OBS/editor processes; keep evidence and reusable QA configuration; never reset permissions or settings broadly.
- Preflight stays mandatory whatever [upstream docs](https://obsproject.com/kb/macos-screen-capture-source) say.

## External validation targets

- Never embed demo or validation application in extension, its runtime dependencies, build graph, commands or VSIX; open owner-designated real repo as external workspace.
- Keep isolated unit-test data out of production imports and package assets; packaging must reject application fixtures and experiment dependencies.

## Working conventions

- Japanese chat; English code, comments, documents (except quoted user requests).
- Context7 for third-party library/API docs; Serena symbols for substantial code understanding or refactoring when available.
- Before TypeScript work read `/Users/ryotamurakami/.claude/rules/ts-rules.md`; for React also `/Users/ryotamurakami/.claude/rules/react-rules.md`.
- Check for existing utilities, hooks, components, types before adding one. Reusable functions and classes: short purpose, trigger and caller docs with example; workspace symbols as JSDoc links; brief notes on non-obvious branches and loops.
- DAMP behavior tests, hard-coded expectations, Arrange/Act/Assert, `test`; `toBeVisible` for displayed UI.

## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues on laststance/codebook, via `gh` CLI for every operation. This file's [Where things live](#where-things-live), [Cycle rule](#cycle-rule) and GitHub paragraph of [Delivery](#delivery) win (cycle Issue, goal Issue #1, labels, Issues from evidence, public repo).

- Create: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies). Skill's "publish to the issue tracker" = create GitHub issue.
- Read: `gh issue view <number> --json number,title,body,labels,comments`; skill's "fetch the relevant ticket" = this.
- List: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with fitting `--label` and `--state` filters.
- Sub-issue of parent: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in Blocking below). Without sub-issues: `Part of #<parent>` at top of child body.
- Comment: `gh issue comment <number> --body "..."`. Labels: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`. Close: `gh issue close <number> --comment "..."`.
- PRs as request surface: **no** (`/triage` reads this flag; `yes` would make external PRs feature requests). When `yes`, PRs take issues' labels and states through `gh pr`: read `gh pr view <number> --comments` and `gh pr diff <number>`; list external PRs `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`; comment, label, close with `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.
- Issues and PRs share one number space: resolve bare `#42` with `gh pr view 42`, fall back to `gh issue view 42`.
- Wayfinding (`/wayfinder`): **map** = one issue labelled `wayfinder:map` holding Notes / Decisions-so-far / Fog body (`gh issue create --label wayfinder:map`); its **child** issues = tickets.
  - Child ticket: linked to map as GitHub sub-issue (above); where sub-issues not enabled, entry in map body's task list + `Part of #<map>` at top of child body. Labels `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Claimed ticket assigned to driving dev.
  - Blocking: GitHub's native issue dependencies, canonical, UI-visible form: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, `<blocker-db-id>` = blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not `#number` or `node_id`). `issue_dependencies_summary.blocked_by` counts open blockers only (live gate). Without dependencies: `Blocked by: #<n>, #<n>` line at top of child body. Ticket unblocked when every blocker closed.
  - Frontier query: map's open children (`gh issue list --state open`, scoped to map's sub-issues / task list), minus any with open blocker (`issue_dependencies_summary.blocked_by > 0`, or open issue in `Blocked by` line) or assignee; first in map order wins.
  - Claim: `gh issue edit <n> --add-assignee @me`, session's first write.
  - Resolve: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append context pointer (gist + link) to map's Decisions-so-far.

### Triage labels

Five canonical triage roles skills (mattpocock/skills) speak of, each label named after role (all five exist on GitHub); skill naming role (e.g. "apply the AFK-ready triage label") → use its label. Changed label vocabulary edited here.

- `needs-triage`: maintainer needs to evaluate issue.
- `needs-info`: waiting on reporter for more info.
- `ready-for-agent`: fully specified, ready for AFK agent.
- `ready-for-human`: requires human implementation.
- `wontfix`: won't be actioned.

### Domain docs

Single-context: one root `GLOSSARY.md`, created lazily. Product outcomes live in PRODUCT_GOAL.md and owner rules in this file, stated as rules; glossary entry never restates or overrides either.

- Before exploring, read root `GLOSSARY.md`, or, when root `GLOSSARY-MAP.md` exists, each per-context `GLOSSARY.md` it points at relevant to topic.
- Absent → proceed silently: never flag absence or suggest creating upfront. `mattpocock-skills:domain-modeling` (reached via `mattpocock-skills:grilling` and `mattpocock-skills:codebase-design`) creates it lazily when terms actually resolved.
- Name domain concept (issue title, refactor proposal, hypothesis, test name) with glossary's term; no synonym it avoids. Concept it lacks = invented language (reconsider) or real gap (note for `mattpocock-skills:domain-modeling`).
- No ADRs, no `docs/adr/`: no decision log ([Standing directions](#standing-directions)).
- Output contradicting recorded owner decision (cycle Issue's Owner decisions) names conflict explicitly instead of silently overriding.

## Codex compaction hook

[`.codex/hooks.json`](.codex/hooks.json) registers only `SessionStart` with `^compact$` (startup, resume ignored); Claude Code runs same command from `.claude/settings.json`, only shared Claude file.

- Command (`.codex/restore-product-context.mjs`; Node, Git, POSIX shell) prints ≤ 10,000 characters: re-entry rule first ([Mandatory entry](#mandatory-entry) 2), scope and pause sentence, then this file's `## Mandatory entry` and `## Standing directions` verbatim. Why: Claude Code injects longer hook context only as 2,000-character preview + file path.
  - Sections outgrowing limit → prints rule, points to AGENTS.md.
  - Missing or renamed section (CRLF line ends, trailing spaces after heading tolerated) → rule still printed; names what's missing on stderr; exit 0.
  - Restores no editing gate or Stop continuation.
- Collaborators: each enables hooks, trusts project, reviews hook in Codex [`/hooks`](https://learn.chatgpt.com/docs/hooks) after every definition change (may disable it alone there), checks fresh `/compact` shows `CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION` (proves delivery, not reading or understanding).
- Files alone establish no activation; repo changes no global Codex setting; Codex observation verifies no Claude Code delivery.
- Test: `node --test .codex/restore-product-context.test.mjs` (CI too): rule within first 2,000 characters, whole output ≤ 10,000 (~1,500 tokens, under Codex's `additionalContextLimit` of 4,000), both sections verbatim; missing/renamed section = no error (exit 0, above); any other failure (e.g. unreadable AGENTS.md, malformed hook input) exits nonzero with stderr, no fail-closed guarantee.
