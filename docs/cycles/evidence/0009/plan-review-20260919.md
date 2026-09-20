# Cycle 0009 independent plan challenge

Date: 2026-09-19. Candidate: `6f22f1286dcabdf629549f775d068baa879a788e`, branch `codex/cycle-0009-repository-learning-book`, with the seven source drafts from the named handoff checkpoint. All seven SHA-256 values matched that checkpoint; fresh typecheck and 11 real-filesystem/schema tests passed. Original drafts are additionally preserved under ignored `artifacts/cycle-0009/handoff-20260919-190104/`, with a hash manifest.

A fresh native subagent (`cycle0009_independent_plan_review`) started successfully and independently challenged the bounded plan. It read the goal, cycle, accepted D016/D017 and relevant current source. No source edits, further agents or owner questions were made. Serena again reported `Active language servers: []`; scoped source searches supplied the evidence. Coverage is same-host independent development review, not external-model coverage or one of the final ten complete-product reviews.

## Findings and reconciliation

1. **P2: recover committed intent before mutable preparation.** The original prepare → lock → same-key lookup sequence cannot recover a lost successful response after a cited source changes/disappears. After validating input and instance ownership, inspect the immutable stored intent first. Identical key/input returns the original receipt without current-source or checkpoint availability; changed input conflicts. Only new keys prepare. Recheck intent under the shared writer lock to resolve concurrent publishers. Verify response loss followed by changed/deleted source and changed checkpoint, with no additional revision.
2. **P2: transport must admit the documented input.** The document limit is 1,048,576 bytes but the previous HTTP body limit was 65,536 bytes. A reviewer probe used the compiled schema and actual HTTP server: a schema-valid 72,507-byte document in a 72,734-byte JSON-RPC request received HTTP 413, `Request body too large`. This proves only the transport mismatch; its placeholder source did not test publication. Keep the 1 MiB document limit and separately bound the entire HTTP envelope at 1 MiB + 64 KiB. Verify a document over 64 KiB reaches publication, exact document limit plus envelope succeeds, and document/envelope overflow each preserves prior data. Preserve authentication, concurrency and read-deadline checks.

The primary accepted both as routine corrections implementing existing D017/D008 guarantees. No approved design, architecture boundary or final product outcome changes. The plan challenge completed with concerns; these remedies are planned, not yet implementation proof. Source/context/store → protocol → reader → integrated/native evidence remains one sequential lane.

## Live restoration facts

- Same checkout, branch and HEAD as the checkpoint; no reset, clean, stash or new worktree.
- Source draft: 11 passed, 0 failed/skipped/cancelled; typecheck and `git diff --check` passed.
- GitHub #1 and #10 open; no branch PR. The existing #10 comment still described D6 as pending and is updated after the documentation checkpoint is pushed.
- Native host QA has not been rerun. Historical locked-desktop and Cursor phase-ACK concerns remain qualified; no new host capability is certified.
- Final-product reviews remain 0/10, not started.
