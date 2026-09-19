# Cycle 0010 — Real-repository browser runtime feasibility

Type: experiment  
Status: ready  
Result: pending  
Delivery: not-applicable; bounded plan and target preflight only  
Goal version: 3  
Tracking issue: https://github.com/laststance/codebook/issues/11  
Goal issue: https://github.com/laststance/codebook/issues/1  
Goal links: G01, G03, G06, G10, G11; supports later G04  
Source state: [Cycle 0009](0009-repository-learning-book.md), implementation `1bd10b3`, closure records `0313c33`, remote reconciliation `a210a56`

## Question and expected value

Can the existing owned-browser/debugger mechanisms bind one real Next.js application's browser pause to its exact TSX source and captured values, then resume to the expected visible result in both required editors, without rewriting that application into a prepared Codebook fixture?

Authority: agent-selected under D008/D018 and the active continuous product goal. The target is **agent-selected**, not a newly supplied owner choice. This experiment removes one high-impact source/debugger uncertainty before selecting a lasting general-runtime API. Cycle 0009 establishes real-repository source reading; its runtime remains fixed-profile.

## Hypothesis and scope

- Target: a detached private clone of actual `laststance/laststance.io` commit `43d039938287ed494a66f4fad198da2464a9e7b0`, inspected at `/Users/ryotamurakami/laststance/laststance.io`. The original checkout is clean on `main` and will only be read. Codebook remains in its current checkout/branch.
- Smallest observable path: seed an isolated browser's theme to `light`, load the existing page, click its existing “Switch to dark theme” button once, pause before `setTheme(otherTheme)` in `src/components/Header/ThemeToggle.tsx:19`, capture the actual closure state and source, then continue once. The DOM root becomes dark and the button offers switching to light. Input is a real browser click, not direct invocation of the application handler.
- Hypothesis: reuse owned Chrome/DAP target lifecycle and pause generations; replace only the fixture-specific source acquisition assumption in a private experiment. Verify emitted JS, actual source-map entry and its original TSX bytes against the frozen repository source. Current compiled file names and variable names must be observed, not assumed.
- In scope: one browser participant, one action/stop, retained exact source/value/pixel evidence, wrong-target/stale-source/manual-resume rejection, finite teardown, host-separated execution. Prototype code belongs under `experiments/cycle-0010/`; source/version/evidence records belong here. Reuse existing utilities before adding them.
- Out of scope: a new public MCP contract, generic launch UI, backend async correlation, checkout acceptance, new layouts, target-app feature changes, installed extension, real-use feedback and final review gate. These remain required product work. A direct experiment success is not G06 product-interface proof.
- Falsify or narrow if the actual executed source cannot be bound without target rewriting, the mapped values cannot be captured honestly, unrelated browser activity acquires pause authority, continuation needs guessed identity, or owned cleanup cannot preserve the user's existing processes.

## Plan and selected skills

1. Complete `/plan-eng-review` on this file's bounded experiment. Read the actual skill, current shared runtime/source/debugger code and the installed target/framework documentation before implementation. The full product is context, not today's scope. Keep D016/D017 choices fixed. A later lasting API or user-flow change would separately trigger DX/design review; this private experiment does not preselect those APIs.
2. Create an ignored detached target clone from the frozen commit, install its lockfile independently and run its production build before browser QA as its AGENTS.md requires. Do not reuse the original checkout's dependencies: installed Next is 16.3.3, while package/lockfile require 16.3.4. Do not copy private environment files or normal browser profiles. Record versions and commands from the actual isolated build.
3. Inspect produced source maps before choosing a breakpoint method. Start the owned loopback application on a free port. Its existing `productionBrowserSourceMaps: true` makes the production webpack build the first hypothesis. Freeze actual build/map hashes and exact expected values before the first click. If production mapping disproves the hypothesis, record that failed cut before selecting a documented development-mode alternative.
4. Implement the smallest experiment with existing lifecycle/evidence primitives; review target/source identity and teardown paths. Run each host serially. After source-backed pause capture, keep control available during a 40-second learner hold; continue using the current identity and inspect the visible result.
5. Probe wrong target, source drift and manual resume only after the normal mechanism exists, with separate expected outcomes. Record the interaction using Playwright CLI, extract and inspect frames, and distinguish native host pixels, browser screenshots and debug protocol receipts. Use `/investigate` for an unexplained failure and `/review` for the meaningful experiment diff; report missing skill coverage rather than inferring approval.
6. Update this result and PROJECT_STATE.md; keep/revise/replace the mechanism, then select at most one next increment from the observed constraint. Preserve Codebook's previous fixed-profile/source-book behavior; this cycle may close falsified or inconclusive without marking product capabilities verified.

No owner decision is pending. Build outputs, source-map format and capture feasibility are the experiment's unanswered technical questions.

## Validation contract

Expectation version: draft 1, **freeze after isolated build/source inspection and before runtime input**. Framework/runtime versions below are preflight observations, not an executed matrix.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Target identity | Exact frozen target source; original checkout unchanged | Detached clone and pre/post source inventory | Commit, tracked-file hashes, original branch/status |
| Environment | Lockfile-consistent isolated Next 16.3.4 / React 19.2.8 / next-themes 0.4.6, external Node 24+ | Frozen install/build and actual process/version receipts | Commands, versions, build/map hashes; no credentials |
| Required hosts | VS Code and Cursor tested separately with owned Chrome | Reuse declared js-debug/managed-browser lifecycle, serial hosts | Actual host/API/debugger/Chrome versions and target/session IDs |
| One real action | Exactly one button click; one intended application handler stop | Seed fresh theme before load, click existing accessible button | Before/paused/after screen and input receipt |
| Grounded pause | Executed JS/map resolve to frozen ThemeToggle TSX; actual light/dark values are inspectable | Observe script/map identities and capture paused closure values | JS/map/TSX hashes, source location, actual captured values; unresolved optimized values stay unknown |
| Hold and continue | At least 40 seconds paused with responsive control; exactly one accepted continue | Timed hold, read-only state query, exact identity continue | Timings, generation, no duplicate input, final DOM dark/button light |
| Interference | Wrong target/source drift/manual resume cannot present a valid current pause | Separate finite negative cases | Explicit failure/recovery, no stale resume or fabricated source |
| Presentation | Recorded interaction shows real source/app changes | Playwright CLI recording plus extracted frame inspection | Host-separated video/frames and measured render availability |
| Teardown | Owned app/browser/debug sessions released, unrelated editor state intact | Finite stop and process/registration inspection | Exit codes, remaining owned resources zero, original target status |

## Attempts and evidence

Read-only target selection on 2026-09-19:

- Codebook clean at `a210a564c449ba00a2df565268c98347c1ed398c`; Cycle 0009 is closed with pushed evidence. Its final source fingerprint is unchanged from `1bd10b3`.
- Laststance.io clean `main` at `43d039938287ed494a66f4fad198da2464a9e7b0`; its existing ThemeToggle closure has `resolvedTheme`, `otherTheme` and a single `setTheme` call. The provider uses a class attribute and `disableTransitionOnChange`. No target source was edited and no target runtime was started.
- `next.config.mjs` already enables production browser source maps. The documented build is `next build --webpack`. Its installed Next dependency is stale (16.3.3 versus locked 16.3.4); independent installation is necessary.
- The selected target has optional GitHub credentials according to its AGENTS.md. No environment file or credential was read. Codebook's current `createEnvironment` always constructs `PairedRun` against `experiments/cycle-0004`; its runtime interface inherits that concrete fixed-profile contract. This is a verified current boundary, not ordinary-repository support.
- [Official Next.js debugging guidance](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/debugging.mdx), retrieved through Context7, documents client Chrome debugging and source maps. This informs the experiment; it is not proof for the frozen target build or Cursor.

Frozen input hashes:

| Target path | SHA-256 |
| --- | --- |
| `src/components/Header/ThemeToggle.tsx` | `3699d15e3fe8d763dabf615e75d40d014003495df4b9c510d5c6da64d2a1e012` |
| `src/app/providers.client.tsx` | `9b98c545741ec13430bbed439fd0e0b3c67533a73da32d18536e35a100de5625` |
| `package.json` | `1ba131ad50114e7a81419ff133472ebe10fde2f00a910ae1bbc6e5c52991b947` |
| `pnpm-lock.yaml` | `1af8ae891d32eddab01ee985799597df219757aceacbf00325c51111452d94c1` |
| `next.config.mjs` | `d8025166c1b471ab64500654fe4c3be3f1aa891d98cb376ad641f5d1d61194b1` |
| `AGENTS.md` | `f67a039c96cd06d972f3a89fca65d1cd5c8d3ce91ee2d1829c82fd3c135db900` |

No isolated clone, experiment implementation, native run or product capability is demonstrated by this preflight.

## Result and decision

Result: pending. Select this one-action source-map/identity question before designing a general repository launch API. Keep the verified Cycle 0009 reader and all fixed-profile behavior. No capability status advances yet; no package, release, owner or final-review approval is claimed.

## Handoff

Exact next action: read `/Users/ryotamurakami/.agents/skills/gstack/plan-eng-review/SKILL.md` and review only this experiment, then freeze the build-specific expectation contract. Stay on `codex/cycle-0009-repository-learning-book` in the same Codebook checkout. Cycle 0009's isolated editor sessions and root browser adapter have stopped; no run needs resuming. D018 records the selected route. No separate task, recurring automation or background job is created. The final goal remains active with 0/10 final reviews.
