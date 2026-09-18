# Durable decisions

Record the date, source, reason, and affected goal/cycle. Link superseded decisions rather than silently deleting their context. These are decisions, not a task backlog.

## D001 — Product baseline, 2026-09-18

Source: explicit user approval in office hours.\
Decision: architecture B; Study workspace default; Living book and Guided walkthrough later; shared learning items/evidence/progress; agent-observed execution separate from user-marked understanding.\
Reason: connect the screen and code in a coherent, recorded learning experience.\
Reference: [approved design](docs/designs/codebook.md). Status: active.

## D002 — Adaptive cycles and repository-owned continuity, 2026-09-18

Source: explicit user request to construct a progression method to the final product without deciding every implementation step now.\
Decision: PRODUCT_GOAL.md owns the full destination; PROJECT_STATE.md owns observed progress; one cycle at a time owns the near-term plan; relevant GStack skills operate within that cycle. AGENTS.md connects these across chats.\
Reason: future technical results must be allowed to change implementation order and approach without losing the approved product.\
Effect on D001: preserves the product and all three layouts; supersedes the approved design's original suggestion to prove the entire checkout as the first implementation assignment. Full checkout is a destination to reach through evidence-driven increments, not the mandatory size of cycle 0001. Status: active.

## D003 — Initial experiment candidate, 2026-09-18

Source: agent-selected implementation route within D002; not a new product requirement.\
Decision: begin with one click → real debugger pause → captured source/values → continue → changed application screen, including basic capture correspondence.\
Reason: this tests the hardest coupling with less code and setup than full checkout or any polished layout.\
Revisit: the candidate was implemented as Cycle 0001 under D005. Its demonstrated result and follow-up decision are recorded in D006. This did not remove any final capability. Status: completed experiment.

## D004 — Private GitHub persistence with two initial issues, 2026-09-18

Source: explicit user authorization to create a Laststance repository if GitHub issues or repository persistence help the process.\
Decision: create private laststance/codebook, preserve project records in Git, and start with one final-goal issue and one current-cycle issue. Agent entry documents are intentionally tracked through project-local ignore exceptions; global ignore settings remain unchanged.\
Reason: cross-session and off-machine continuity without a premature backlog or a second source of truth. More issues follow evidence; no complete waterfall task tree is created. Status: active.

## D005 — Approved Cycle 0001 implementation contract, 2026-09-18

Source: explicit user answers D1–D5 and request to implement the reviewed plan.\
Decision: isolated experimental HTTP extension and tiny TypeScript fixture; verify actually executed JS, explicit targets and pause generations; multiplex CDP and test continuation conflicts. No production MCP contract is selected.\
Reason: test the live browser/debugger coupling and its correctness limits before committing to product APIs.\
Reference: [Cycle 0001](docs/cycles/0001-click-pause-resume.md). Status: active for this experiment.

## D006 — Keep the proven runtime core; next test one async boundary, 2026-09-18

Source: [Cycle 0001 native execution and review](docs/cycles/0001-click-pause-resume.md), within the approved adaptive process.\
Decision: keep explicit session/thread/pause identity, independent input/control lifetimes, multiplexed CDP, and immutable source/value/frame evidence. Revise integrated-browser lifecycle handling to make owned-tab visibility/layout explicit. The temporary HTTP bridge is not a production MCP decision.\
Evidence: 12 unit tests and 15 final native scenarios passed; one synchronous fixture has matching source, values, and before/pause/after images. Earlier layout/capture failures remain recorded.\
Next candidate: one asynchronous browser-to-backend boundary with request correlation and an unrelated concurrent request. Plan only that bounded question next; do not start it as part of Cycle 0001.\
Limits: no arbitrary-repository, checkout, LLM orchestration, recording/replay, product MCP, layout, packaging, or release proof. All final capabilities remain unchanged. Status: active; revalidate on environment or control-lifecycle changes.
