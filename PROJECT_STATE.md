# Current project state

Updated: 2026-09-18  
Product stage: design approved; development loop established; runtime feasibility unverified  
Active cycle: [0001 — Click, pause, inspect, continue](docs/cycles/0001-click-pause-resume.md)  
Active cycle status: ready  
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open  
Active cycle issue: [#2](https://github.com/laststance/codebook/issues/2) — open  
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main  
Current authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 1

## Facts at handoff

- Architecture B and Study workspace as the default are approved. Living book and Guided walkthrough remain required later modes.
- The approved design and all three mockups are stored in this project. Its two-round specification review resolved two findings and ended at 9/10 with no remaining specification-review findings.
- No extension implementation or combined browser/debugger/recording proof exists in this project yet. The images are design references.
- Read-only inspection identified reuse candidates in Entrance, deep-trace-extension, and vscode-debug-mcp. Recheck their current source and dirty state before reuse; this project does not own their existing edits.
- The private laststance/codebook repository stores the process and approved references. Goal issue #1 and cycle issue #2 are open. There is no detailed future issue backlog.
- No publication pipeline or supported-version matrix exists yet; neither is required to begin the bounded experiment.

## Capability evidence

Update a row only when the linked evidence establishes its exact scope. Use unverified, partial, verified, or needs-revalidation. Fixture-only proof remains partial for a goal requiring real-product evidence.

| Goal | State | Evidence and limits |
| --- | --- | --- |
| G01 | unverified | Full natural-language checkout has not run. |
| G02 | unverified | Shared-learning-item design only. |
| G03 | unverified | Correctness contracts reviewed; runtime proof pending. |
| G04 | unverified | Recording/replay design only. |
| G05 | unverified | Progress behavior specified; no implementation. |
| G06 | unverified | Existing tool/API research, not an embedded-service proof. |
| G07 | unverified | Approved Study workspace concept only. |
| G08 | unverified | Approved Living book concept; later implementation required. |
| G09 | unverified | Approved Guided walkthrough concept; later implementation required. |
| G10 | unverified | No package or real-repository validation. |

## Current uncertainty

| Question | Why it matters | Next evidence |
| --- | --- | --- |
| Can one real browser action coexist with a pending debugger pause, inspection, and continuation? | This is the smallest connected behavior behind the final experience. | Cycle 0001; do not gate it on building the whole UI. |
| Can frames be associated with the actual pause and its captured values? | Recording must preserve correspondence. | Capture basic before/pause/after evidence in 0001; retain unknown recording limits. |
| How are async/backend boundaries and unrelated calls distinguished? | Full checkout cannot be called verified with ambiguous causal links. | Select a bounded follow-up after the kernel result. |
| Which APIs/versions support native layout, browser control, capture, and external-client recovery together? | A public API's existence is not integration proof. | Pin versions and record observed capabilities as each is tested. |

## Now, next, later

**Now:** advance cycle 0001 through planning and real execution evidence. It is an experiment, not a promise to ship the complete extension.

**Next candidates, not commitments:** resolve whichever part of 0001 failed; or extend the proven kernel with one asynchronous/backend boundary; or prove replay of one captured stop. Select only after reading the result. These candidates are alternatives, not a mandatory sequence.

**Later capability areas, without task breakdown:** full checkout orchestration; wiki/codemap/progress integration; default-layout usability and recovery; both additional layouts; packaged and real-repository validation. Their order depends on evidence and dependencies. None can disappear from final acceptance without an explicit product-goal decision.

## Exact resume action

Read cycle 0001. Inspect the current reusable tools and choose the smallest reproducible fixture. Write only that cycle's executable plan, then invoke /plan-eng-review with the cycle file path as its bounded target. Add /plan-devex-review if the cycle introduces a lasting MCP contract. Fill real versions, targets, expected source binding, and capture procedure before claiming any validation result.

## Session handoff

Last completed work: project progression structure, portable approved references, and private GitHub repository/issue tracking.  
Current experiment result: pending; no runtime attempts yet.  
Next executable action: bounded cycle-0001 planning as described above.  
Uncommitted/runtime state: verify with git and the actual environment when resuming.  
Goal changes pending: none.
