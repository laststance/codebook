# Cycle 0015 — Native Wiki navigation ordering

Type: experiment\
Status: planning\
Result: pending\
Delivery: local-only\
Goal version: 3\
Tracking issue: https://github.com/laststance/codebook/issues/17\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G03, G06, G07, G11\
Implementation base: `11c2b050d61b7bb3041cc4f61352a75f13c4b82b`\
Branch: `codex/cycle-0015-wiki-navigation-ordering`\
Source state: [Cycle 0014](0014-shared-presentation-controls.md), merged through [PR #16](https://github.com/laststance/codebook/pull/16)

## Question and expected value

Can an accepted native source-display operation from an obsolete Wiki navigation overwrite a newer successful article/source receipt in either supported host? Resolve the modeled V3-I1 race before treating integrated Wiki/source/observation/replay navigation as acceptance evidence.

## Goal and design refresh

On 2026-09-21 JST the driving agent freshly read Issue #1, PRODUCT_GOAL.md, PROJECT_STATE.md, DEVELOPMENT.md, DESIGN.md, the approved product design and D016/D017/D021. All three approved images were visually inspected and matched their pinned 5294d56 bytes. Study workspace keeps application above source beside context; Living book prioritizes reading with source/runtime beside it; Guided walkthrough prioritizes application/source with explanation below. Every view must retain the selected learning item and keep observed execution separate from learner understanding. This experiment preserves that behavior; it does not reinterpret the concept images as runtime evidence.

## Hypothesis and scope

- Hypothesis: generation checks reject obsolete JavaScript continuations, but an already submitted asynchronous native showTextDocument effect can still commit after a newer navigation. The modeled schedule is not yet proven reachable in a real host.
- Smallest observable outcome: a reproducible native mismatch, or a bounded supported-host ordering result with exact observations and limitations.
- In scope: immutable citation source navigation, current-file navigation, superseding article requests, Close/disposal, unrelated dirty draft preservation and stable learner progress. Trace host implementation and actual public commands/MCP before deciding on serialization.
- Other Cycle 0014 partial plan items, final UI copy, complete layout matrix, packaging, three real-repository intended uses and ten final reviews remain obligations outside this one experiment.
- Falsification: actual host behavior rejects/supersedes the old effect or preserves the newest source in every frozen schedule, with an identified ordering mechanism. A finite passing stress run alone cannot prove all timing orders.

## Plan and selected skills

1. /investigate: trace V3-I1 model, actual reader callers and installed host/API code. Preserve any unavailable Context7 coverage; do not infer an ordering guarantee from types alone.
2. Freeze a finite native schedule in VS Code and Cursor, reuse isolated profiles and existing launch/cleanup helpers, record submitted operations, completed effects and actual source identity.
3. If a native defect is reproduced, /plan-eng-review the narrow repair, add a failing behavioral regression, implement the shared ownership fix, and rerun affected/full checks plus the original native case. No speculative product edit.
4. /review and coderabbit-cli on the bounded result; /ship then /land-and-deploy through a PR containing @coderabbitai ignore and Closes #17. Owner D021 authorizes cycle delivery and delegates recommended workflow choices; no invented user reply.

## Validation contract

Freeze schedule details and host versions before execution. Keep unmodified native runs, instrumented diagnostic runs and in-memory models separate.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| O01 immutable A then B | B's successful receipt agrees with the final displayed URI/range after all accepted work drains; A cannot silently win | Distinct actual cited sources, concurrent public opens; observe host calls and final native editor | Exact source/version, invocation/settlement trace, selected article, native URI/range and final settled state |
| O02 current-file then newer article | Later accepted selection keeps its intended source; outdated work is rejected or visibly bounded | Actual current-file command competing with a later immutable citation open | Disk/native source hash, dirty-state guard and drained result |
| O03 accepted source then Close | No stale continuation reports a current reader or reopens its disposed Wiki panel; record any already accepted source effect honestly | Close at observed native submission boundary, drain accepted work | Panel lifetime, open receipts, remaining native source and errors |
| O04 isolation and persistence | Unrelated dirty draft bytes and learner decisions remain unchanged; no application/debug execution | Compare before/after each native schedule | Draft checksum/dirty flag, progress ledger, run count and owned cleanup |
| O05 both required hosts | Outcomes recorded separately under declared versions and source bytes | Run the finite schedule in actual VS Code and Cursor profiles | Independent host manifests; any unavailable or inconclusive result remains explicit |

## Attempts and evidence

- Baseline: Cycle 0014 merged tree equals reviewed PR head 0264e42 byte-for-byte; 245 source hashes match its fresh 647-test cut. Historical modeled V3-I1 artifacts remain under ignored artifacts/cycle-0014/review/adversarial-v3-probes.*.
- Context7 resolution returned its monthly-quota error on 2026-09-21; Serena is absent from the current tool inventory. Use installed native implementation and official primary references, retaining this limitation.
- No native ordering experiment or product repair has run yet.

## Result and decision

Pending. Keep the approved shared ownership model and all final obligations. An inconclusive investigation may close this cycle but cannot verify a capability.

## Handoff

Trace exact native showTextDocument ordering and prepare a finite diagnostic that observes real effects without substituting mocked display ordering. No product edit yet. No owned native session running at cycle start. Final reviews remain 0/10.
