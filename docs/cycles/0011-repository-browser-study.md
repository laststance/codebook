# Cycle 0011 — Configurable repository browser study

Type: product-increment
Status: planning
Result: pending
Delivery: not-applicable
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/12
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G01, G02, G03, G04, G06, G07, G10, G11
Source state: [Cycle 0010](0010-real-repository-runtime.md), clean implementation `9bfe1e8`, pushed closure `c91af0e`

## Question and expected value

Can an external agent configure and drive one ordinary repository browser action through Codebook's existing MCP service, then use the same source-bound stop as a Study observation, repository-book evidence and replayable recording in both VS Code and Cursor?

Authority: agent-selected under D008/D019 and the active continuous final-product goal. Recommended routine choices are delegated; accepted product/design choices, D016/D017 and the original checkout/branch remain fixed. This is the next bounded integration question, not permission to replace the full goal with one theme-toggle demonstration.

## Hypothesis and scope

- Hypothesis: retain Cycle 0010's proven source/target/pause boundaries behind a configurable browser runtime, and introduce the smallest shared product-facing contract needed by existing Study/MCP/recording consumers. Existing fixed profiles remain supported.
- Smallest learner-visible outcome: one natural-language request leads the agent to select a real source-backed browser operation, start a run, click once, inspect and explain actual values, save the interpretation, continue, then revisit that evidence from a repository learning item and replay it after the application/debugger exits.
- In scope: discoverable MCP prerequisites/configuration, workspace-bound source and map identity, one configurable local browser action/stop, immutable source/value/frame observations, current Study presentation, linked book evidence and existing recording/replay. Demonstrate the configured path with the frozen Laststance.io target without embedding its repository name, component, selector, expression names or expected values in runtime implementation.
- Preserve: checkout profiles, source-reading/authoring APIs, full-citation learner history, exact repository-reader returns, interruption/ownership behavior and both required hosts. Configuration and selected evidence must remain distinct from observed execution.
- Out of scope for this cycle, still required by PRODUCT_GOAL.md: arbitrary frameworks/languages, a general backend causal-link engine, the complete checkout scenario on an ordinary repository, both additional layouts, packaged/installed acceptance, all three intended-use examples and the final ten reviews. Do not infer global success from this one configured path.
- Falsify or narrow if the product must pretend a browser-only stop has a server participant or invent a causal link; if configuration bypasses workspace/source bounds; if a failed input/ACK can report a complete observation; if record/replay cannot retain the exact source and partial state; or if preserving checkout/reader behavior requires silently rewriting their historical contracts.

## Plan and selected skills

1. Audit current runtime/MCP/Study/recording dependencies, errors, docs and tests. Inventory reusable types and utilities; use Serena symbol tools where available, retaining their missing-language-server limitation honestly. Use Context7 for third-party API decisions.
2. Run `/plan-devex-review` on this file only: persona, first external-agent success, configuration/ownership surface, discovery, error/retry semantics and compatibility. The final product is context. Adopt evidence-backed recommended choices under existing delegation, documenting them rather than requesting the approved design again.
3. Run `/plan-design-review` for any changed current-Study flow/state presentation, preserving approved D016/D017. Then `/plan-eng-review` for the concrete runtime/model migration, source acquisition, recording compatibility and failure tests. Do not begin implementation before these bounded reviews produce an executable contract.
4. Implement the smallest connected product path with regression protection for the existing checkout and repository reader. Review the actual diff with `/review`; use `/investigate` for unexplained failures. Report missing independent/outside coverage separately from passing checks.
5. Freeze actual targets, source versions, both host environments and expected observations before native acceptance. Exercise a real external client in each host, record the native interaction, inspect motion frames, replay after exit and prove ownership/error behavior. Keep partial attempts.
6. Update the cycle, state and issue from evidence; keep/revise/replace, then select at most one next question. Goal #1 remains open.

## Validation contract

The review will refine configuration and exact payloads before implementation; this is a proposed observable contract, not a frozen native expectation table.

| Check | Expected result | Required evidence |
| --- | --- | --- |
| API discovery | Client can identify the configured browser capability and prerequisites without knowing a private bootstrap | Real MCP discovery/SDK transcript per host; documented version/error contract |
| Configuration | Target/source/action belong to the trusted selected workspace; unsupported maps/environment fail before input | Typed validation, source-bound config receipt, negative path/size/version cases |
| Agent run | One request drives one click, meaningful actual pause, captured values, interpretation and one continuation | Real external-client receipt, executed JS/map/source tuple and native app/source video |
| Study correspondence | Same item and observation appear in current Study and repository-book evidence; understanding is never inferred | Exact item/source/reference identities and retained reader/progress state |
| Recording/replay | Exact source/value/explanation/frame correspondence remains after runtime and debugger stop | Restart/replay/seek evidence in both hosts; partial/ACK/drift cases remain qualified |
| Failure/ownership | Stale/manual/foreign resume, missing maps/source, timeout and cancellation cannot fabricate success or affect another run | Focused regressions plus finite native interference controls |
| Regression | Existing checkout and D016/D017 repository reader remain operational | Relevant full suites and actual integrated smoke, with host evidence separate |

## Attempts and evidence

Selection baseline: Cycle 0010's final experiment passed 38 tests and seven native cases in each required editor; original Laststance.io stays clean, all seven handoff backups match, and no owned native process remains. The public product `createEnvironment` still constructs `PairedRun`; `StudyRuntime` aliases its view/action/continue/source contracts. These current couplings motivate review before implementation. The earlier native phase-ACK failure remains unresolved and must not be hidden by the successful final experiment.

## Result and decision

Result: pending. No new implementation or product capability is verified by selecting this cycle. One active cycle only. The full destination and all final acceptance requirements remain unchanged.

## Handoff

Exact next action: complete `/plan-devex-review` using this file as the bounded scope, then conditional design and engineering review. Preserve branch `codex/cycle-0009-repository-learning-book`. No background task, automation, native runtime or new worktree was created by selecting this cycle. Final sequential reviews remain 0/10.
