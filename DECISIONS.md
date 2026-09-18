# Durable decisions

Record the date, source, reason, and affected goal/cycle. Link superseded decisions rather than silently deleting their context. These are decisions, not a task backlog.

## D001 — Product baseline, 2026-09-18

Source: explicit user approval in office hours.  
Decision: architecture B; Study workspace default; Living book and Guided walkthrough later; shared learning items/evidence/progress; agent-observed execution separate from user-marked understanding.  
Reason: connect the screen and code in a coherent, recorded learning experience.  
Reference: [approved design](docs/designs/codebook.md). Status: active.

## D002 — Adaptive cycles and repository-owned continuity, 2026-09-18

Source: explicit user request to construct a progression method to the final product without deciding every implementation step now.  
Decision: PRODUCT_GOAL.md owns the full destination; PROJECT_STATE.md owns observed progress; one cycle at a time owns the near-term plan; relevant GStack skills operate within that cycle. AGENTS.md connects these across chats.  
Reason: future technical results must be allowed to change implementation order and approach without losing the approved product.  
Effect on D001: preserves the product and all three layouts; supersedes the approved design's original suggestion to prove the entire checkout as the first implementation assignment. Full checkout is a destination to reach through evidence-driven increments, not the mandatory size of cycle 0001. Status: active.

## D003 — Initial experiment candidate, 2026-09-18

Source: agent-selected implementation route within D002; not a new product requirement.  
Decision: begin with one click → real debugger pause → captured source/values → continue → changed application screen, including basic capture correspondence.  
Reason: this tests the hardest coupling with less code and setup than full checkout or any polished layout.  
Revisit: if current-source inspection shows a smaller experiment resolves the same uncertainty better, update the still-unstarted cycle with the reason. This is not permission to remove final capabilities. Status: active candidate.

## D004 — Private GitHub persistence with two initial issues, 2026-09-18

Source: explicit user authorization to create a Laststance repository if GitHub issues or repository persistence help the process.  
Decision: create private laststance/codebook, preserve project records in Git, and start with one final-goal issue and one current-cycle issue. Agent entry documents are intentionally tracked through project-local ignore exceptions; global ignore settings remain unchanged.  
Reason: cross-session and off-machine continuity without a premature backlog or a second source of truth. More issues follow evidence; no complete waterfall task tree is created. Status: active.
