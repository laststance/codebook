# Final acceptance: ten consecutive independent end-user trials

Authority: Raphtalia's active goal of 2026-09-18, refined by the explicit request of 2026-09-21; [D022](../../DECISIONS.md#d022--require-ten-independent-end-user-acceptance-trials-2026-09-21). This mandatory gate supplements [Issue #1](https://github.com/laststance/codebook/issues/1) and [PRODUCT_GOAL.md](../../PRODUCT_GOAL.md). It preserves G01–G11, the complete cart-to-purchase-confirmation scenario, every other final acceptance condition and Raphtalia's own intended-use acceptance.

Each fresh reviewer must operate the installed product as a human end user would, in **both ordinary VS Code and ordinary Cursor**, through their actual AI chat interfaces. Ten consecutive PASS reviewers require at least **20 editor-specific trials** on one frozen candidate. Source review, old evidence or development helpers alone cannot pass this gate. Development code reviews do not count. The owner's instruction to skip long-running Claude Code CLI reviews remains in force; this gate uses editor AI chats and does not restart that CLI workflow.

## Start conditions and candidate freeze

Do not dispatch final reviewers until development has produced the complete candidate and reproducible evidence for all capabilities, integrated checkout, recording/replay, three presentations, recovery and the three intended real-repository use contexts. Fixture and partial evidence keep their narrower labels. Record Raphtalia's acceptance separately; reviewers cannot grant it on the owner's behalf.

Before testing, freeze a versioned, hashed manifest containing:

- Source commit and clean/dirty provenance, built VSIX and SHA-256, extension version, build revision and dependency/build receipts. All reviewers install the **same VSIX bytes** in both hosts. No rebuild, development host, direct source loader or injected implementation substitutes.
- Declared support matrix: both editor builds, OS/architecture, AI chat extension/provider/model when identifiable, debugger/browser integrations, supported Web stacks, launch/source-map/prerequisite limits and ordinary documented onboarding. Record unavailable identity as unknown, never invented; required compatibility must still be verifiable.
- Complete Issue #1 / G01–G11 / final-acceptance checklist, full checkout expectation table and causal links, observable success criteria, host order, normal recovery rules and time budgets. Criteria are fixed before results; a timeout cannot silently become a PASS by changing its budget.
- Eligible repository pool and commits, selection criteria, prior development-use labels, random-draw method/receipt and required report schema.
- Neutral reviewer instructions, public user guide and evidence index. Exclude previous reviewers' conclusions, answers and successful tool recipes from the reviewer packet.

Evidence and review-log metadata may be appended without changing candidate bytes. Product source or VSIX changes reset the streak. Material changes to support, mandatory criteria, onboarding or trial setup also require a new manifest and streak; they never excuse an earlier failure.

## Random real-repository selection

Declare the final support range **before selecting targets**. Freeze a pool of existing real Web application repositories satisfying objective criteria, recording URL, exact commit, stack/prerequisites, eligibility evidence and any exclusion reason. Establish eligibility from source/dependency and ordinary launch prerequisites before Codebook outcomes are observed; product success is never an inclusion criterion. Do not populate it only with known development successes. Label known development examples and prefer independently eligible alternatives; document any unavoidable overlap before drawing. The required checkout fixture and failed-case regressions are separate obligations, not replacements for random trials.

Draw randomly, preferably without replacement for ten distinct repositories. Record the ordered pool and its hash, algorithm/version, entropy or seed, draw time, ordered selections and exact commits. Freeze the pool before obtaining the random seed; make one draw and retain its receipt. If fewer than ten eligible repositories exist, exhaust unique choices before recorded randomized reuse and disclose the limitation. Do not create duplicate entries, redraw, substitute or remove a selected target after observing failure, or narrow support to make it ineligible.

Each reviewer uses the **same repository commit and same initial question in both editors**, starting from equivalent clean application state. Record the natural-language question and intended learning objective before seeing the answer in either host. Ask as an ordinary user, for example: “Explain what happens between pressing this button and the screen changing, while showing the related code and actual values.” Do not provide exact pause locations, expected values, per-stop instructions or a worked solution. The random action does not replace the original full checkout scenario.

## Independence and serialized execution

1. Start exactly one new subagent with a fresh context for reviewer 1. Provide authoritative requirements, neutral protocol, frozen candidate, selected target, public setup instructions and verification evidence locations. Do not fork the development conversation or provide previous final-review verdicts, scores, answers or tool sequences. Source inspection to verify the reviewer's own observations is allowed; reading previous final-review conclusions is not.
2. That reviewer owns both editor trials and its judgment. Run one editor at a time and finish/clean up its owned trial before operating the other. Do not run other reviewers or competing editor automation concurrently. Record host order.
3. Each reviewer performs the required stages below in **both hosts**, including the original full cart-to-confirmation scenario against its unchanged causal-link expectations, and independently checks every Issue #1 / PRODUCT_GOAL requirement. Supporting historical evidence never substitutes for this reviewer's actual editor trials.
4. Only after a reviewer finishes, saves evidence, protects/restores user state and issues PASS may the next fresh reviewer begin. Ten file audits, reviewers sharing one operator's trial, or results divided across hosts do not qualify.

## Mandatory stages in each editor

| Stage | Required operation and proof |
| --- | --- |
| Normal installation | Install the frozen VSIX through the documented ordinary-editor path. Verify archive hash and actually loaded extension version/build identity, plus host/debugger/browser identity. Development-host or source-loaded execution fails this condition. |
| Public onboarding | Open the selected repository in a dedicated work window and follow published user setup for Codebook and that editor's AI chat. Record prerequisites, settings and integration steps. Hidden test wiring is not allowed. |
| Actual AI chat | Use Computer Use or equivalent native UI control to submit the preregistered question in the editor's real AI chat. Record timestamps, provider/model identity, visible response and actions. A terminal AI, synthetic chat or reviewer MCP client is not a substitute. |
| AI-driven execution | The **chat AI itself** must use Codebook to operate the app, pause actual execution, inspect the bound source and captured values, explain and continue to the observed result. General code commentary is insufficient. Also execute the full original checkout scenario with its required causal links. |
| Explanation correctness | Compare claims with actual source revision, target/pause identity, captured values and application result. Verify that observed facts, source-derived reasoning and unknown boundaries are distinguished. Required unresolved causal links fail. |
| Save and replay | Save screen/source/value/explanation correspondence; stop the owned app and debugger; replay without reexecution. Verify paused moments, timing, moving transitions and required partial/source-drift behavior. |
| Connected learning | Actually traverse Wiki, linked codemap/source, runtime observations and recording while retaining item/citation/reading context. Exercise explicit understanding checks and persistence; execution never auto-checks them. Label these **reviewer test progress**, never Raphtalia's understanding or acceptance. |
| Three modes | Switch Study workspace, Living book and Guided walkthrough during live use and replay. Verify shared run, selection, values, explanation, progress and playhead, and judge whether the screen makes their correspondence understandable. |
| Restart and recovery | Normally restart the editor; reopen the saved study/recording and verify article/selection/progress plus paused replay before corrective seeking or hidden repair. Exercise required interruption/recovery and unrelated-target cases. Record every failure and explicit recovery action. |
| Visible usability and cleanup | Record on-screen operation as video, extract and inspect frames for motion, transitions and understandable correspondence. Identify host, viewport, theme, revision and capture method; renderer assertions alone are not native usability proof. Check required constrained/focus/accessibility cases, unrelated drafts and owned-resource cleanup. |

After public onboarding, reviewers must not call MCP directly in the background to perform steps the chat AI failed to do. They must not supply exact breakpoints, expected runtime values, per-stop tool instructions, unpublished setup or implementation patches to manufacture success. Natural follow-up questions and actions permitted by the public guide are allowed, with exact wording/actions and assistance recorded. A required flow that only succeeds with prohibited assistance is FAIL. Read-only evidence inspection may verify an action; it cannot perform a missing action retroactively or turn an incomplete flow into a pass.

## Logged-in profiles and existing work

Raphtalia permits using existing logged-in profiles in both editors for their AI features. Use dedicated work windows and separately checked-out trial targets. Preserve unrelated windows, worktrees, files, dirty buffers, progress and native groups. Inventory relevant extension versions/enabled states and settings before testing, record changes and restoration procedures, and restore as appropriate without overwriting intervening user changes. Do not terminate unrelated editor processes to simplify a trial.

Never include credentials, cookies, bearer tokens or private account material in chat, Git or evidence. Pause capture for authentication and exclude sensitive screens from retained material. If reauthentication or two-factor authentication is needed, ask Raphtalia to perform **only that manual step**. Pending authentication never establishes PASS; inability to complete a required trial follows the failure rules. Profile authorization does not authorize real purchases or production transactions; retain the sandbox checkout scenario.

## Verdict and streak rules

Every reviewer explicitly issues **PASS** or **FAIL**, with per-host results and a complete requirement/evidence map. PASS requires both editor trials, every mandatory stage and full Issue #1 / PRODUCT_GOAL confirmation, with no unresolved required item. A single-host success, unknown required result, missing video/artifact, tool timeout or inability to verify is **FAIL**. An incomplete/paused session cannot advance the streak.

Classify failures separately: product defect; editor/AI-service/infrastructure failure; harness/observer failure; or unverifiable evidence. Record the actual error and stage. Environmental failure is not automatically a product defect, but cannot count as PASS. Preserve all failed attempts. After remedy and revalidation, refreeze the unchanged or repaired candidate as appropriate and restart with a **new reviewer 1**; retrying only the failed host cannot preserve earlier passes.

Any FAIL immediately resets consecutive passes to **0**. Preserve its repository commit, original question, objective, setup and failure proof as regression obligations. Revalidate these before restarting; keep failed targets eligible under the original support declaration. Regression cases supplement the next random campaign and do not displace its draws. Neutral regression prompts may be provided without old verdicts, answers or tool recipes. Source/VSIX changes also reset to zero. Undisclosed assistance, omitted failures or post-result criteria changes invalidate the affected streak.

Only ten fresh reviewers' consecutive PASS verdicts on the **same candidate**, plus all existing final acceptance conditions and Raphtalia's separately recorded acceptance, permit closing Issue #1 and completing the active goal.

## Evidence and reports

Keep sanitized candidate/sampling manifests and an append-only sequence ledger in `docs/acceptance/`, and one report per reviewer under `docs/acceptance/reviews/`. Large/private videos, chat captures and runtime evidence stay in durable private storage referenced by location, availability and SHA-256. Each report records:

- Campaign/candidate, fresh reviewer identity, sequence number, host order, timestamps and independence attestation.
- Source commit, VSIX hash, each installed/loaded version/build, editor/OS/debugger/browser and AI chat/provider/model identities; label unknowns.
- Repository URL/commit, eligibility/draw receipt, original question and objective before answers, follow-ups and public setup steps.
- Profile/settings/extension baseline, changes/restoration, target state, actual UI/chat actions and transcript, observed results, source/value bindings and assistance disclosure.
- Per-host stage results and complete Issue #1 / G01–G11 / final-acceptance mapping, including full checkout, recovery and three intended-use coverage. Separate direct trials, supporting evidence and owner feedback.
- Videos and inspected frames with timestamps/hashes; source/runtime/recording evidence; errors, missing items, limitations and cleanup proof.
- Findings/failure category, per-host PASS/FAIL, final PASS/FAIL with reasons, streak before/after and required fixes/regressions. Never hide a failed attempt behind a rerun.

The driving agent checks completeness and appends the ledger; it cannot rewrite a reviewer's FAIL as PASS. Reports/conclusions are withheld from later reviewers' neutral packets.

## Current state

**Not started. Consecutive passes: 0 / 10. Editor-specific final trials: 0 / at least 20.** The product is incomplete; no final candidate, support pool or draw is frozen. Continue development first, then execute this protocol. Existing development reviews and native QA do not count.
