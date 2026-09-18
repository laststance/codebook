# Final acceptance and ten consecutive independent reviews

Authority: Raphtalia's active goal request on 2026-09-18. This gate supplements PRODUCT_GOAL.md; it does not replace G01–G11, integrated acceptance, or required learner feedback.

## Start conditions

- Implement every final capability in the declared VS Code and Cursor environments.
- Produce actual packaged-extension, full-workflow, recording/replay, three-layout, recovery, and real-repository evidence. Mocks and fixtures retain their narrower labels.
- Freeze the candidate source commit, packaged artifact hashes, support matrix, acceptance expectations, and evidence index. List every goal and acceptance clause against direct proof. Unknown or indirect evidence is not a pass.

## Sequential review rule

1. Dispatch exactly one fresh subagent for reviewer 1. Give it the authoritative requirements, frozen candidate, reproduction instructions, and evidence. Do not prescribe a passing verdict or disclose prior reviewers' conclusions as authority.
2. Each reviewer independently checks the complete Issue #1 and PRODUCT_GOAL.md requirements, AGENTS.md and referenced rules, actual source/artifacts, and the scope/validity of native evidence. It may rerun checks. It must list missing, contradicted, indirect, or unverified proof and finish with PASS or FAIL and concrete reasons. Silence, tool failure, a timeout, or inability to verify a requirement never counts as PASS.
3. Only after that review finishes with PASS, dispatch a different fresh subagent for the next number. Never run final reviewers concurrently. Require ten consecutive PASS verdicts on the same candidate.
4. Any FAIL resets the consecutive count to zero. Preserve the failed report, fix the product or evidence, revalidate affected requirements, freeze the new candidate, and restart with reviewer 1 using fresh subagents. Do not hide failure by narrowing a requirement.
5. Product/source/package changes invalidate an ongoing pass streak. Review-log metadata alone may be appended without changing the frozen candidate; review ledger commits never silently change candidate identity.
6. Preserve reviewer identity, order, timestamps, target commit/artifact hashes, evidence inspected, findings, verdict, and fixes in docs/acceptance/reviews/. Keep live credentials and private recordings out of Git.
7. Completion requires all product acceptance conditions plus ten consecutive independent PASS verdicts, with no unresolved findings. Only then close Issue #1 and complete the active goal.

## Current state

Not started. Consecutive passes: 0 / 10. The product is incomplete. Engineering reviews during development are not members of this final sequence.
