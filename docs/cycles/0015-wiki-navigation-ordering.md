# Cycle 0015 — Native Wiki navigation ordering

Type: experiment\
Status: validating\
Result: inconclusive\
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
- Both native hosts completed the frozen 35-case schedule without a mismatch; actual native calls overlapped in 20 VS Code and 23 Cursor cases, but never completed in the modeled reverse order. See [the bounded investigation](evidence/0015/native-ordering-20260921.md) and [artifact manifest](evidence/0015/manifest.json). No product repair was made.

## Result and decision

The pre-execution schedule narrowed O01/O02 to real in-process reader entry points rather than concurrent end-to-end public MCP commands. Range measurement covers the last native fulfillment, while the later drained result covers URI/article identity; that part of the original range-after-drain contract remains partial. O04 checks in-session preservation only, not restart persistence.

Keep the approved shared ownership model. The modeled late effect was not reproduced; the finite diagnostic does not establish a general native ordering guarantee. Retain V3-I1 as a qualified concern with explicit reopening triggers. Advance packaged installation and integrated acceptance after this cycle's review and PR delivery; preserve all final obligations.

## Handoff

Complete bounded review, coderabbit-cli and PR delivery with Closes #17. Both owned hosts exited 0, settings match their original bytes, and owned profile processes are absent. The next candidate is packaged installation and integrated acceptance. Final reviews remain 0/10.

## Frozen native schedule v1 (before execution)

The current-task transcript's `item_completed` event records the schedule append and bootstrap syntax check completed with exit 0 at `2026-09-20T16:43:50.660Z`, before the first host launch directory timestamp `16:43:50.786Z`. This is a completion-event timestamp, not a command-start timestamp. The manifest links the extracted `freeze-proof.json`. The schedule was frozen in the working tree, not included in planning commit `0cbbaa8`.

- Candidate: clean product bytes from merged 11c2b05, rebuilt under planning commit 0cbbaa8; only private diagnostic helpers differ.
- Hosts: installed VS Code 1.138.0 and Cursor 3.21.16 (API 1.128.0), macOS arm64. Launch manifests must verify their actual bundle commits.
- Fresh isolated test profiles; use the real tracked Codebook source files to publish two distinct cited articles through public MCP. Authoring/readback is external; diagnostic races invoke the actual reader entry points through a captured instance.
- The private bootstrap may wrap the real codebook extension API showTextDocument method only if writable. It calls the original immediately, records its real promise settlement and submits the next actual reader operation while that promise is pending. It never sleeps, gates or substitutes a simulated display completion. If observation cannot be installed, report that limitation and revise the setup before running a replacement schedule.
- Per host: ten immutable A-to-B overlaps, ten current-file-to-B overlaps, five source-to-Close overlaps and ten direct native A/B pairs. Capture final URI/range after all promises settle plus a native layout barrier. Any mismatch or inaccessible schedule is a failed/inconclusive attempt, not a pass.
- Preserve an explicit test-profile learner decision and unrelated dirty draft across all cases. No application or debug run is started. Restore profile settings and record owned editor exit.
- Installed workbench snapshots contain editor-operation cancellation and current-operation checks in both hosts. These are a candidate explanation, not yet native proof or a public API ordering guarantee.

### Post-run audit of the frozen harness

The pre-existing bootstrap additionally primed `source-ab` with article B; other scenarios first opened A. Direct probes then opened B to obtain its URI and opened both documents before their A/B calls, using column One, preserveFocus true and preview false. These priming details were present in the frozen executable but omitted from the original prose. They can affect caching and overlap; they do not establish why VS Code's immutable-source native calls did not overlap. The [report's excerpt](evidence/0015/native-ordering-20260921.md#harness-details-and-detector-control) makes that limitation inspectable. A separate offline control rechecks all 70 outcomes and detects deliberately wrong source/Close outcomes and reversed timestamps; synthetic controls are not native cases.
