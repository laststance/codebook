# Durable decisions

Closed log. D001 to D047 stay because older records cite their numbers; no entry is added after D047. A rule the owner sets is stated in the required read that governs the work ([AGENTS.md](AGENTS.md#authority-and-completion)). Superseded decisions are linked, not deleted. These are decisions, not a task backlog.

> Historical authority: D029 supersedes every earlier ten-reviewer, random-pool, consecutive-pass and reset-to-zero acceptance provision (including earlier goal-continuation, D021/D022/D023/D027 references). Earlier decisions and observations remain historical; their other product and delivery requirements remain in force.

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
Reference: [Cycle 0001](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0001-click-pause-resume.md). Status: active for this experiment.

## D006 — Keep the proven runtime core; next test one async boundary, 2026-09-18

Source: [Cycle 0001 native execution and review](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0001-click-pause-resume.md), within the approved adaptive process.\
Decision: keep explicit session/thread/pause identity, independent input/control lifetimes, multiplexed CDP, and immutable source/value/frame evidence. Revise integrated-browser lifecycle handling to make owned-tab visibility/layout explicit. The temporary HTTP bridge is not a production MCP decision.\
Evidence: 12 unit tests and 15 final native scenarios passed; one synchronous fixture has matching source, values, and before/pause/after images. Earlier layout/capture failures remain recorded.\
Next candidate: one asynchronous browser-to-backend boundary with request correlation and an unrelated concurrent request. Plan only that bounded question next; do not start it as part of Cycle 0001.\
Limits: no arbitrary-repository, checkout, LLM orchestration, recording/replay, product MCP, layout, packaging, or release proof. All final capabilities remain unchanged. Status: active; revalidate on environment or control-lifecycle changes.

## D007 — Require Cursor alongside VS Code, 2026-09-18

Source: explicit user request, "最終要件にCursorでも動作することを追加してください。"\
Decision: increment PRODUCT_GOAL.md to version 2 and add G11. Both VS Code and Cursor must support the complete required experience, including extension-owned MCP control, real-debugger explanations, recording/replay, learning views/progress, and all three display modes. Final acceptance runs separately in each actual host with declared versions.\
Reason: the intended product must also be usable in Cursor; assumed VS Code extension compatibility is insufficient evidence.\
Effect: earlier VS Code-centered design wording does not restrict supported hosts. Cycle 0001 remains a closed goal-version-1 experiment and supplies no Cursor evidence. Host-dependent implementation choices must account for both editors; no Cursor implementation or compatibility verification is claimed by this requirement change. Status: active.

## D008 — Continuous execution and ten-review final gate, 2026-09-18

Source: Raphtalia's active goal and subsequent delegation while unavailable.\
Decision: continue one evidence-driven cycle at a time through the complete Issue #1 product; require ten fresh subagents to review the full frozen candidate sequentially and pass consecutively. Any failure requires fixes and restart at reviewer 1. Goal version 3 records this additional final acceptance gate.\
Current route: user selected Cycle 0002 Cursor runtime compatibility before the async-boundary candidate. Routine reversible implementation decisions may proceed under the user's delegation, with reasons retained.\
Limits: neither fixture success, a completed cycle, an engineering review, nor an unavailable reviewer can satisfy the full-product gate. Status: active; D022 strengthens the final-review method into mandatory end-user trials.

## D009 — Preserve shared runtime evidence; replace experimental host transport, 2026-09-18

Source: [Cycle 0002](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0002-cursor-runtime-compatibility.md), 26 unit checks and native matrices of 17 VS Code / 20 Cursor cases.\
Decision: retain explicit target/pause identity, immutable source/value/frame evidence, independent input/control, and best-effort owned cleanup. Keep the Cursor target-metadata bridge as an experiment; do not treat its editor-wide remote-debug endpoint as the product integration.\
Reason: both native hosts demonstrate the synchronous mechanism, while everyday deployment and native full-product presentation remain unproven. Select one scoped-browser transport investigation next, then return to the asynchronous boundary. This updates D006's next candidate without removing that functional uncertainty.\
Limits: development review is non-converged after three fix cycles, outside review unavailable, Cursor final-source native before/after screenshots missing. No complete product or package claim. Status: active.


## D010 — Use owned-browser transport for the next functional experiment, 2026-09-18

Source: [Cycle 0003](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0003-scoped-browser-transport.md), 38 unit tests and 21/21 real-host scenarios in each editor at `8ceb901`. Agent-selected route within D008.
Decision: provisionally retain js-debug-owned Chrome via a debugging pipe, selected-child CDP, isolated pixel viewport and exact phase receipts. Replace the experimental editor-wide Cursor endpoint for subsequent functional experiments. Return to one correlated browser-to-backend async boundary.
Reason: the installed native Cursor facade exposed command responses but no observed general target/event connection. The alternative preserves real source/value evidence and owned cleanup without editor-wide remote debugging.
Limits: Cycle 0003 is inconclusive for native presentation because Mac lock prevented independent editor screenshots. Render ACK is not native visual proof. Ordinary-workspace installation, finished UX, browser input UI and recording remain unverified. External review unavailable; fresh in-host source review has no findings, without a whole-tree convergence/approval claim. No final outcome changed. Status: provisional; revalidate native presentation and packaged integration before product acceptance.

## D011 — Advance the proven paired runtime to an agent interface, 2026-09-19

Source: [Cycle 0004](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0004-async-request-boundary.md), 18/18 native cases per required editor and 26 paired / 40 shared unit tests at `f968e02`. Agent-selected route within D008.
Decision: retain explicit request identity, complete expected traffic, participant pause generations, executed-source validation and qualified persisted outcomes. Next select one extension-owned MCP integration increment; do not keep polishing the solved private HTTP fixture.
Reason: the browser/server boundary is now demonstrated on the instrumented fixture. The next core gap is allowing an external agent to discover and use it through the product's required control interface.
Limits: public MCP contract still needs DX/engineering review; no arbitrary-repository, full checkout, native product UX, recording, layouts or package claim. Implementation review remains non-converged and outside coverage unavailable. Final requirements are unchanged. Status: active route, not a final API decision.

## D012 — Connect the proven agent interface to a learner workspace, 2026-09-19

Source: [Cycle 0005](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0005-live-study-mcp.md), clean implementation `c813053`, six native MCP cases and three shared native regressions per required host, plus an actual driving-agent smoke. Agent-selected route within D008.
Decision: retain the extension-owned MCP service with explicit demo capability, immutable source/value/image references and separately labeled agent interpretations. Move next to one learner-facing Study workspace increment that links a selected learning item to the application, exact source, explanation and a durable learner-owned check.
Reason: the required external-agent boundary now works on the proven instrumented fixture. A visible learning experience is the next missing connection; repeated transport refinement would not establish usefulness.
Limits: no arbitrary-repository or natural-language checkout proof; native product UX remains unverified while the desktop is locked. Implementation review reached three fixing passes without convergence; outside coverage is unavailable. Recording, all layouts, packaging, real-repository use and the final ten-review gate remain required. Status: active route; no final outcome changed.


## D013 — Extend connected observations through purchase confirmation, 2026-09-19

Source: [Cycle 0006](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0006-study-workspace.md), clean implementation `c873b43`, learner normal/history and MCP regressions in each required host. Agent-selected route within D008.
Decision: keep one shared selection, exact captured source, separate live identity, append-only learner decisions and self-contained historical reading. Next investigate a reusable scenario sequence from cart addition through order confirmation, with the same learning/observation identities available for later recording and layouts.
Reason: the learner can now inspect and retain the proven two-stop flow. The largest immediate experience gap is the requested complete purchase narrative; another transport-only cycle would not close it.
Limits: full native usability remains inconclusive while independent editor pixels are unavailable. Three fixing passes repaired 23 findings without certified convergence; fresh-reviewer and outside-provider coverage remain limited. Recording, wiki, all layouts, installation, real repositories and the final ten fresh sequential reviews remain required. No final outcome changed. Status: active route.


## D014 — Record and replay the proven connected scenario, 2026-09-19

Source: [Cycle 0007](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0007-checkout-scenario.md), clean `8be0913`, six product-native and ten runtime cases across both hosts, plus actual agent checkout (Cursor complete; VS Code partial images). Agent-selected route under D008.
Decision: retain the connected four-item checkout and its immutable source/value/explanation records. Next build one synchronized recording/replay increment for this same scenario after the app/debugger exit. Reuse learning identities and evidence timing; represent missing frames and incomplete recording explicitly.
Reason: the complete fixed purchase narrative now runs, but learners cannot replay its motion and explanation correspondence. G04 is the next missing connection and a shared playback model is also required by both later layouts. Repeated transport/reader polishing would not establish it.
Limits: native presentation remains inconclusive; one actual VS Code run misses three render ACKs and a bounded diagnostic does not identify a cause. Native pixels, arbitrary repositories, generated wiki, additional layouts, packaging, intended-use acceptance and ten fresh sequential reviews remain required. No capability is removed and no complete product claim is made. Status: active route.


## D015 — Connect repository learning content to retained observations, 2026-09-19

Source: [Cycle 0008](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0008-recording-replay.md), clean `1740e34`, 238 tests, native VS Code recording/restart, actual-agent replay in both required hosts, browser motion/error/layout evidence; current Cursor phase presentation remains partial. Agent-selected route under D008.
Decision: retain bounded immutable recording, as-of source/value/interpretation context and shared revision-checked playback. Next build one source-grounded repository learning-document/wiki and codemap increment through the existing agent/learner boundary. Start with actual source in this repository and navigation to established observed learning items; source-derived content must never imply runtime proof.
Reason: macro learning content remains hard-coded to demonstration profiles. Establishing an agent-authored source-backed document is the next connection toward unfamiliar real repositories and can later supply both required alternate layouts. Repeating unchanged transport or renderer trials would not resolve their intermittent native condition or this missing macro capability.
Limits: keep native phase-presentation reliability unresolved and require a measured failing-stage/owner-driven reproduction before claiming a repair. No ordinary-repository runtime, independent native pixels, packaging, final layout/host acceptance or fresh sequential review pass follows. No final requirement changes. Status: selected route.

## D016 — Preserve the approved repository reader experience, 2026-09-19

Source: Raphtalia's actual Cycle 0009 design-review answers D3–D6 and the [recorded seven-pass review](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0009-repository-learning-book.md#formal-design-review-checkpoint).
Decision: retain B's article/source/context composition with a small lowercase `understand` checkbox. Any changed citation makes the article Review needed while preserving historical learner decisions. Narrow readers use one article column, a small contents disclosure and source relationships below; wide readers retain B. Return from an observation or recording restores the same book/revision/node, section and reading position, including saved-reader restart, without execution or understanding changes.
Reason: preserve reading context while the learner moves between macro explanations, exact source and recorded evidence. The small check remains a learner action; source validation and observed execution remain separate facts.
Limits: these are approved behavior and layout requirements, not native UX or runtime evidence. Source-context identity, position persistence and storage mechanics remain engineering-review work. Living book and Guided walkthrough remain required later modes. Approved image: `/Users/ryotamurakami/.gstack/projects/codebook/designs/cycle0009-repository-wiki-20260919/variant-B-compact.png`, SHA-256 `9fe687a6ff72923d70f55db20065f00e6d7a9518368af70361679996b6d41e8a`. Status: approved by owner.


## D017 — Preserve complete citation context and short publication ownership, 2026-09-19

Source: Raphtalia's actual Cycle 0009 engineering-review answers D1 B, D2 A and D3 A, recorded in the [engineering plan review](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/0009-repository-learning-book.md#engineering-review--architecture).
Decision: keep a dedicated small book validation/persistence module with the existing shared storage primitives. Bind explicit understanding to the stable learning item and canonical complete citation set (path, full-byte hash and inclusive range), preserving legacy single-source meaning. Prepare bounded source/link data outside the shared writer queue; under the queue revalidate expected revision, source identity/hash and checkpoint facts before atomic publication.
Reason: unrelated prose edits should not clear understanding, secondary source edits must not inherit it, and source preparation should not hold up existing learner/recording saves. Conflicts or failed validation preserve prior content; identical intent recovers the original committed receipt after response loss.
Limits: this is an approved implementation contract, not a working implementation or an atomic whole-workspace snapshot guarantee. Primary plan reviews completed; independent review and new integration/native evidence remain outstanding. Status: approved by owner.

## D018 — Retain source-grounded books; investigate a non-fixture runtime, 2026-09-19

Source: [Cycle 0009](docs/cycles/0009-repository-learning-book.md), 238 passing extension tests, actual-agent repository publication in both editors and independently inspected normal/200% native evidence returns. Agent-selected route under D008.
Decision: retain bounded tracked-source acquisition, immutable book revisions, complete-citation learner history and exact observation/replay return. Native layout transitions require an unchanged owned receipt; accepted workbench work is drained and its observed result is checked. Wiki evidence navigation preserves hidden navigation panes, while explicit Study opening remains explicit. Next investigate one non-fixture TypeScript runtime contract before expanding the reader further.
Reason: actual Codebook-source authoring establishes useful macro reading and its connection to existing evidence. The remaining fixed-runtime boundary is a higher-impact constraint on unfamiliar repository learning than another reader refinement. A bounded experiment can expose launch/debug/source assumptions before choosing a general integration API.
Limits: existing runtime evidence still comes from prepared profiles; VS Code's original Cycle 0009 study remains partial. This decision does not claim general phase-capture reliability, full review-skill convergence, packaging, final native usability, three intended uses, both later layouts, owner acceptance or final sequential reviews. No goal outcome or accepted D016/D017 behavior changes. Status: selected route.


## D019 — Keep real-source browser control; connect it to the product contract, 2026-09-20

Source: [Cycle 0010](docs/cycles/0010-real-repository-runtime.md), 38 experiment tests, 14 final native cases, exact JS/map/TSX and closure values, and inspected 70-second-hold videos in VS Code and Cursor. Agent-selected route under D008.
Decision: keep bounded emitted-source verification, normalized full script identity, explicit selected session/thread/generation, independent input/control and owned cleanup. Require usable development maps for this demonstrated Next webpack path; do not pretend the frozen production build retained maps. Next connect a configurable ordinary-repository browser action to the existing MCP, Study observations, book evidence and recording model. The selected target is acceptance evidence, not a new hard-coded runtime profile. Preserve current fixed checkout and D016/D017 reader behavior.
Reason: the real-repository experiment removes the immediate source/debugger uncertainty, while the product environment still constructs only PairedRun and exposes prepared profiles. A bounded public integration now advances G01/G03/G04/G06/G10 more directly than another experiment or reader refinement.
Limits: the original native after-frame ACK failure remains unexplained; successful later runs do not establish general reliability. Review stopped non-converged at three fixing passes, outside coverage is missing, and the experiment is neither packaged nor installed. All three intended uses, both later layouts, integrated two-host acceptance, owner acceptance and ten consecutive fresh final reviews remain required. No product outcome or accepted design choice changes. Status: selected route.


## D020 — Advance the configured path to shared presentations, 2026-09-20

Source: [Cycle 0011 final reconciliation](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0011/final-reconciliation-20260920.md), source-equivalent implementation `58f08cd`, 476 tests, actual VS Code/Cursor configured runs, offline/partial replay and native UX evidence. Agent-selected route within D008.

Decision: keep the bounded configured browser adapter and shared immutable study/recording/learner identities. Select one shared presentation-mode increment next, after reading Issue #1 purpose and inspecting the approved images again. Switching must preserve the same run, item, understanding and playhead; it must not create another runtime or reinterpret recorded evidence as live.

Reason: the configured path now answers its finite cycle question; G08 and G09 remain wholly unimplemented. Further repetition of unchanged runtime checks would not close that product gap.

Limits: full implementation review remains non-converged; supported adapter bounds, prior partial captures and local evidence availability remain qualified. Packaging, three intended uses, owner acceptance and the final ten sequential reviews remain required. No product outcome changes. Status: active route.

## D021 — Deliver every new cycle through its own branch and merged PR, 2026-09-20

Source: Raphtalia's explicit active-goal update during Cycle 0014.

Decision: at each new cycle, freshly read Issue #1 and its linked purpose prose and visually inspect its approved design images; create that cycle's work branch; implement, validate and review including coderabbit-cli; create a PR whose description contains `@coderabbitai ignore`; close the cycle issue at merge, using the PR's closing reference. Keep Issue #1 open until complete integrated acceptance and ten consecutive fresh sequential PASS reviews. Owner delegates recommended skill choices and waives user-named-target/question-wait gates as already recorded in the active goal.

Application: Cycle 0014 was already in progress when this instruction arrived. Its changes are now on `codex/cycle-0014-shared-presentations`, based on `1e80750`. Issue #15 stays open through review and PR delivery. Earlier closed cycles retain their historical delivery state. Remote main is still `6840178`; the first PR to main will also integrate the existing unmerged recording/repository/configured-runtime baseline. Its review must disclose and cover that larger integration diff separately from Cycle 0014's implementation range. Subsequent cycles branch from the integrated result. No requirement or evidence claim changes.

## D022 — Require ten independent end-user acceptance trials, 2026-09-21

Source: Raphtalia's explicit request to redefine the final ten-review gate as actual end-user acceptance, before continuing development.

Decision: increment PRODUCT_GOAL.md to version 4 and make [FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) the required execution protocol. Ten new subagents run sequentially; each installs the same frozen VSIX in ordinary VS Code and Cursor and actually operates both editors' AI chats, one host at a time. At least twenty editor-specific trials are required. Freeze source/archive/support/criteria first; randomly draw real Web repositories from a recorded eligible pool, minimizing repeats and known-development bias. Each reviewer records one natural user question and objective before answers and uses the same target/question in both hosts. The chat AI must perform the connected Codebook workflow itself; hidden reviewer MCP assistance, correct per-stop instructions and general code commentary cannot pass.

Evidence: independently verify actual source/values/results, facts versus inference/unknowns, recording after runtime exit, linked Wiki/codemap/source/observations/replay, explicit test progress, all three modes, normal restart and native usability with video and inspected frames. Preserve reviewer/order/time/candidate/host/AI/repository/question/action/evidence/findings/verdict records. Withhold earlier reviewer conclusions and model answers. Test progress is never the owner's understanding or acceptance.

Authority and failure policy: the owner permits existing logged-in editor profiles in dedicated work windows, with unrelated work protected and settings/extension changes recorded and restorable. Never retain credentials; request manual help only for necessary authentication/2FA. Require explicit PASS or FAIL after both hosts and all requirements. Any failure, tool timeout or unverifiable mandatory item resets the streak; distinguish product and environment causes without granting a pass. Refreeze after remedy/revalidation and restart with a new reviewer 1. Product/source/VSIX changes also reset it. Retain failed repositories/questions as regressions; never narrow support or swap a failed target to manufacture success.

Effect on D008: final evidence inspection is now a mandatory hands-on acceptance procedure, not an optional rerun. G01–G11, the full purchase-confirmation scenario, other integrated acceptance conditions, the three intended uses and Raphtalia's separate acceptance remain unchanged. Claude Code CLI long-review skipping stays in force; development reviews never count toward this gate. Start only after the complete candidate exists. Current state: 0/10, not started. Issue #1 stays open. Status: active.

## D023 — Bundle one thin codebook skill for explicit editor chat entry, 2026-09-21

Source: Raphtalia's explicit request during Cycle 0018 to add bundled skill distribution, ordinary MCP onboarding and explicit `/codebook` acceptance to the final product.

Decision: increment PRODUCT_GOAL.md to version 5 and add G12 without changing G01–G11 or prior final acceptance steps 1–7. Ship one versioned `SKILL.md`, named `codebook`, in the extension's VSIX. Register it with VS Code's official `contributes.chatSkills`; normally install that same body into Cursor's supported user skill directory through Codebook setup. Standard Copilot Chat and Cursor Agent must both support explicit `/codebook` questions, independently of automatic selection. Maintain one shared procedure body. A Cursor plugin API may replace the primary route only after ordinary installed target-version discovery, slash visibility and actual invocation are demonstrated.

The skill is a thin guide to public Codebook capabilities: first `codebook_status`, current workspace/instance/capabilities/prerequisites, public help and state-derived tool arguments, requested source/runtime/recording workflows, observed-versus-inferred-versus-unknown explanations, current continuation authority, and learner-owned understanding. Do not embed repository answers, stopping locations, expected values or test recipes. Missing connections or prerequisites must remain explicit; ordinary code commentary cannot substitute for Codebook observations.

Setup must prepare both the skill and the correct dedicated-window/repository MCP connection, with documented restart/reconnection. Track installed ownership, version and content; provide update, removal and restoration paths that preserve existing same-name skills and later manual edits. Keep credentials and temporary connection material out of the skill, VSIX, public documents and chat explanations. Users must not have to locate or author the skill themselves.

MCP Skills Extension / SEP-2640 is an optional future distribution route, not a completion dependency: both required hosts' acquisition, activation and slash invocation remain unverified at this decision. Any implementation must share the bundled body/version and prove actual host recognition and activation. See the [required development plan and research references](docs/plans/bundled-codebook-skill.md).

Effect on D022: every fresh reviewer normally installs the same fixed VSIX, follows public skill/MCP setup and sends the same preregistered `/codebook` question in both standard chats. Independently prove loaded skill version/content, discovery/invocation, AI-owned MCP execution/results, truthful unavailable states, restart and protection of existing skills/settings/work. Freeze skill and registration/setup sources with the candidate; changes reset the consecutive count. Skill loading, generic explanations and hidden reviewer MCP work cannot pass. All earlier requirements, owner acceptance and the Claude Code CLI skip remain mandatory. The [trial protocol](docs/acceptance/FINAL_REVIEW.md) owns the evidence fields and verdict rules.

Status: accepted requirement; Cycle 0019 has partial ordinary-install development evidence in both hosts, while same-candidate completion, full restart and final acceptance remain outstanding. Cycle 0018's scope repair and PR #24 delivery closed on 2026-09-23; [Cycle 0019](docs/cycles/0019-bundled-codebook-skill.md) is the one active skill/onboarding increment. No final candidate is ready and no final reviewer has started.

## D024 — Bridge Cursor MCP over local stdio on the target version, 2026-09-23

Source: Cycle 0019 [ordinary-install development diagnostics](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0019/installed-chat-development.md), a routine implementation decision within G12.

Decision: for the declared Cursor 3.21.16 target, register a local stdio MCP child through the Cursor extension API. That child reads only the current work window's private 0600 descriptor and forwards to Codebook's authenticated loopback MCP service. Keep the bearer out of registration arguments, the skill, the VSIX and user MCP configuration. Unregister the prior instance on stop and register the new descriptor after the extension window restarts. Use the same VSIX's canonical skill body through the receipted Cursor user-skill setup already required by D023.

Reason and boundary: the ordinary installed Cursor HTTP registration omitted both the configured bearer and an independent probe header on six requests, producing 401. Disabling Codebook authentication would expand access and is rejected. The first stdio diagnostic connected and served the Agent's actual question; after removing diagnostic stderr output, normally reinstalled development VSIX `2a675c1e83490c5d9450193c180ce43b363c3864fd9982ce842edea53b893dd2` reloaded in the dedicated window and showed 13 tools/4 resources Connected, with an Agent-issued `codebook_status` bound to the correct workspace. This 13-tool result belongs only to that earlier cut; later cuts added tools and require their own host checks. It is target-version development evidence, not a guarantee for other Cursor versions, a full process quit/relaunch or final G12 acceptance. Reassess the route if those required checks fail; do not reduce either editor's required support.

## D025 — Use the available VS Code chat in credit-conscious order, 2026-09-25

Source: Raphtalia's explicit direction during Cycle 0019 PR delivery. The owner accepts the installed Claude Code extension's Cycle 0019 development check for the current PR decision and sets the order for later cycles.

Decision: starting with the next cycle, first verify the ordinary VS Code AI-chat flow in Copilot Chat with its model set to **Auto**, the owner's preferred low-credit option. If Copilot credits are exhausted or unavailable, use the installed Claude Code extension under the existing MAX20 subscription. If that path's quota is also exhausted or it is unavailable, use the installed Codex extension. Do not purchase credits, enable additional billing or change subscriptions to complete a check. In every case, record the actual chat extension, model or mode, source/VSIX identity, skill identity, connection and AI-owned Codebook calls and results. Run Cursor Agent validation independently; a VS Code result never verifies Cursor.

Evidence boundary: Claude Code and Codex extension results remain labeled with the chat that produced them; they must never be reported as direct Copilot Chat observations. An unavailable fallback or a generic source answer is not a passing Codebook execution. This is a prospective development-validation order and the owner's acceptance of the qualified Cycle 0019 Claude development evidence for PR delivery; it does not retroactively change earlier results or start the frozen ten-reviewer final campaign. D022/D023 and FINAL_REVIEW.md retain their separate final-acceptance rules until explicitly amended.

## D026 — Continue toward Goal Issue #1 after Cycle 0020 delivery, 2026-09-26

Source: Raphtalia's explicit instruction during Cycle 0020 to continue without pausing, followed by permission to use the Mac while the owner sleeps. This supersedes the earlier session handoff's stop-after-PR-merge instruction.

Decision: complete Cycle 0020's source-specific validation and PR gates, then keep working toward every requirement of Goal Issue #1. Keep one active cycle, use its evidence to select the next bounded action, and preserve all final product, two-host, CodeRabbit CLI, installed-extension and final-review gates. Routine non-costly Mac operations and protected editor trials are authorized; preserve the owner's installed extension, skills, settings, tabs, target source and credentials unless a later explicit direction changes their ownership.

Boundary: continuation does not convert a partial development trial into final acceptance, authorize purchases or loosen review/merge checks. At this decision, Cycle Issue #27 and Goal Issue #1 remained open while their evidence was incomplete; later delivery state belongs to PROJECT_STATE.md.

2026-09-26 clarification: while using Cursor for another project, Raphtalia explicitly authorized continuing dedicated VS Code and isolated-profile Cursor trials without asking for a screen-time slot. Ask only when actual interference with the owner's other-project work blocks the test. Possible focus changes alone do not establish that blocker. Preserve the owner's work and profile; if a specific recording truly requires exclusive foreground ownership and cannot coexist with current use, report that concrete conflict. This changes trial coordination, not the evidence or acceptance gates.

## D027 — Skip hosted CodeRabbit PR review after rate limiting, 2026-09-26

Source: Raphtalia's explicit instruction after PR #41 reached the hosted review limit: “レートリミットに達したのであれば、プルリクエストのコードラビットは無効にしてそのまま進めてください。PR本文に@coderabbitai ignoreを書くとPRレビューをskipできます”.

Decision: keep `@coderabbitai ignore` in PR descriptions for this Goal continuation and proceed without the hosted CodeRabbit approval gate. Preserve local CodeRabbit CLI review and CI as separate checks; record actual findings, resolutions and reviewed commits. An owner-skipped hosted review is not APPROVED, and historical CHANGES_REQUESTED remains identified as such. No additional billing is authorized.

Effect: PR #41 merged with its four findings addressed/resolved, final local CLI/CI evidence and the explicit hosted-review waiver. This supersedes the hosted CodeRabbit re-enable/approval steps in the earlier delivery workflow for this continuation. It does not waive functional validation, unresolved implementation defects, owner acceptance or the ten fresh final end-user trials.

## D028 — Require OCR delegation alongside CodeRabbit CLI, 2026-09-26

Source: Raphtalia updated the active Goal to add `open-code-review-delegate` alongside CodeRabbit CLI in the review phase.

Decision: apply both methods to the active Cycle 0027 PR and future cycles. OCR supplies deterministic file eligibility and rule resolution; the host agent reviews each eligible `(path, status)` entry and records reviewed/skipped coverage and default exclusions. Review excluded skill/docs/tests separately when they contain material product behavior. Do not call this an independent external-provider review or substitute it for CodeRabbit CLI. Preserve D027's hosted PR-review skip, CI, native evidence and every final acceptance condition.

## D029 — Require all nine projects and two-stage practical acceptance, 2026-09-26

Source: Raphtalia explicitly approved replacing the ten fresh consecutive reviewers with main-agent practical validation followed by one independent junior-developer SubAgent per designated project. This changes final acceptance, not a routine implementation choice.

Decision: PRODUCT_GOAL version 6 and FINAL_REVIEW.md require all nine fixed projects in ACCEPTANCE_MATRIX.md. They are mandatory targets, not an eligible random pool. No deletion, easier substitution, fixture replacement, ten-repository recommendation or target reuse policy applies. Protect the existing private work checkout and never publish its source, business data, credentials or recordings. Use sanitized public identifiers and restricted evidence.

Required TS/JS scope includes actual applicable Web UI, Node server, Chrome Extension, library test and Example execution, mapped from code at pinned revisions. Every library needs both real test-code step-by-step explanation and Example execution/explanation in each host. Missing support is a development gap, never grounds to remove a required target.

Stage 1: the main agent personally completes ordinary packaged-install, public skill/MCP setup and natural-question product use on all nine projects in VS Code and Cursor. Verify actual execution, pauses/values/state/call stacks, stepping/continuation, source correspondence, saving/later modes and understandable failures. Hidden manual MCP calls, source modifications, developer-only workarounds and prepared stop/value answers cannot rescue a pass. Record normal debugger setup and user burden.

Stage 2 starts only after all required Stage 1 rows pass and the complete candidate exists. Nine independent junior-role SubAgents, one per project, personally evaluate both hosts and all required use cases. Give neutral tasks and ordinary documents, not developer answers, workarounds or previous verdicts. Require actual evidence, each junior's own-word understanding, correctness grounds, obstacles/help/unknowns and PASS/FAIL/BLOCKED plus justified confidence >=9/10 for every required assessment. Confidence is subjective assurance, not statistical probability. Missing mandatory work, material mismatch, prohibited assistance or material unknowns prevent PASS regardless of score.

No consecutive success requirement remains. Preserve failures and remedied retries. Every extension/skill/setup/connection change requires impact assessment; shared execution/recording/explanation changes require retesting all affected targets. Justify unaffected evidence explicitly. All final passes must be valid for the final fixed distributed VSIX, never pooled across incompatible implementations.

Preserved: G01–G12, both hosts, explicit `/codebook` in ordinary Copilot Chat/Cursor Agent, common bundled thin skill, public onboarding, recording, both later display modes, stage-specific evidence and separate owner acceptance. Existing demos and preflight are historical development evidence, not new Stage 1 or Stage 2 passes. Goal #1 remains open.


## D030 — Separate live explanation, learning replay and independent Wiki, 2026-09-26

Source: Raphtalia's explicit Cycle 0029 request, followed by the clarification that retiring three UI themes does **not** mean one permanent screen or removal of replay/Wiki screens. The owner requested documentation first and a separate screen-design review afterward.

Decision: advance PRODUCT_GOAL to version 7 with three feature areas:

1. **Live explanation:** the standard Copilot Chat/Cursor Agent AI operates a real project's application/runtime and debugger, pauses actual source, explains the observed code path and continues. The native debugger displays values, watches and call stacks. Retire Codebook's duplicate runtime-value display; retain bounded internal facts needed to ground explanations and recordings.
2. **Learning replay:** save an explained session as learning material, including its processing summary, sequence diagram of logic flow, source-linked explanation and recorded execution. A library and replay screen remain. Capture must occur in time to preserve the explanation being saved; later saving cannot fabricate missed execution. Learner progress remains explicit and independent of run success.
3. **Independent LLM Wiki / DeepWiki:** generate a complete navigable browser site from repository source, defaulting to output inside the project with a configurable location. Provide explicit updates through a natural chat request and an **Update LLM Wiki** button, understandable freshness/status, and source deep links to the editor being used. Wiki generation, update and browsing require no live explanation, debugger, application browser or learning replay. In-editor opening is a permitted convenience. Automatic regeneration/indexing architecture is not prescribed.

The three selectable UI variants are retired; G08/G09 remain retired historical IDs. Distinct functional screens remain required. A Codebook icon in the left Activity Bar is the proposed extension entry. Do not interpret “one variation” as showing chat, debugger, browser, source, replay and Wiki together at all times. The initial agent interpretation of a single fixed composition was corrected by the owner and is not product authority.

Remove the active bundled cart demo project and its packaged copies/assets, launch paths and fixture-specific product instructions. Use actual GitHub/Laststance projects opened in the editor for practical validation. Inspect active/generated/package/local trial locations before implementation removal. Preserve historical reports and Git history; isolated unit inputs do not qualify as practical product use. No remote repository deletion or destruction of unrelated projects is authorized.

Supersession: replace the old three-mode visual mandate, duplicate value UI, shared Wiki/lesson lifecycle and compulsory packaged checkout fixture in earlier decisions/designs. G01 now uses a real project scenario; G02 owns independent Wiki; G04/G05 own learning replay/progress; G07 owns usable feature screens. Preserve Architecture B, runtime truth, recording, both hosts, G12 skill/setup ownership, D027/D028 review policy and D029's nine fixed projects/two stages. D021 refreshes the **current** goal/design/visual status at cycle selection; old images are archival, and a missing new image does not block this written phase. Historical evidence retains its original scope.

Sequence: Cycle 0028 was completed and the broad goal paused as requested. The owner then resumed Cycle 0029 **documentation first**. Update written authority, feature specifications and Issues #1/#46; conduct the screen-design review separately afterward, then produce the replacement concept image and proceed with bounded implementation/real-project proof. The written phase does not delete demo code, implement the new features or establish acceptance. Subsequent owner direction explicitly authorizes GStack design review and a matching final-product design image after document consistency review, within the same Cycle 0029; this supersedes stopping after the written phase.


## D031 — Use nextjs-dashboard for development until final acceptance starts, 2026-09-26

Source: Raphtalia explicitly designated `/Users/ryotamurakami/repository/nextjs-dashboard` for editor-based behavior verification until the product reaches the nine-project acceptance stage.

Decision: before final acceptance begins, open that existing project in the actual editor for development validation. Use it in VS Code and Cursor as applicable to the current capability; retain separate host evidence. Do not select another easier development repository, revive the bundled cart demo or move prematurely into the nine acceptance targets. Preserve the project's source/settings/work and use public product setup; failures or missing prerequisites become development gaps.

The path exists. Read-only inspection on 2026-09-26 found clean `main` at `26e5b2c`, with origin `ryota-murakami/nextjs-dashboard`. This is a locator/preflight observation, not an editor launch, runtime test or Codebook success. Recheck revision and existing changes before each trial.

The D029 acceptance matrix remains exactly its nine designated projects. Dashboard development evidence is neither Stage 1 nor Stage 2, adds no tenth target and cannot substitute for a required project. Once the candidate is ready for acceptance, follow the normal frozen Stage 1 protocol. D030's written-specification-first and separate-design-review boundary still applies to the current task.

## D032 — Synchronize learning replay with recorded source and native debugger state, 2026-09-26

Source: Raphtalia's individual answer during Cycle 0029 GStack design review. The owner rejected the summary/video-reader emphasis and clarified the essential replay experience:

> ラーニングリプレイはライブ説明のチャット欄がサマリーに置き換わったUIで大丈夫です。
>
> 最も重要なのは、映像と同時に、再生と同時に、その時実行されていたソースが表示され、デバッガでランタイムの値を見れる点です。
>
> アプリケーションとコードがどう対応しているのか、何回もリプレイ、タイムトラベルデバッキングができる点です。

Decision: advance PRODUCT_GOAL to version 8. Learning replay inherits the live explanation's application/source/native-debugger composition, replacing the chat area with the learning summary. Repeated playback, backward/forward stepping and seeking synchronize the recorded application, the source executing at that time and inspectable historical values/call stacks in the editor's native debugger. The processing summary, explanation and sequence diagram accompany that synchronized experience; they do not replace it.

This selects the replay composition instead of the agent's proposed standalone document-like reader or sidebar-contained player. Codebook's Activity Bar remains the library/feature entry. The standard live chat remains native; the summary is a Codebook-owned replay surface in its place, not a mutation of native chat internals. Preserve unrelated chats/layout and use supported editor capabilities.

D030's removal of a custom Variables/Watch panel does not remove replay-time inspection in the native debugger. Persist the historical state needed for that inspection, identify the replay context clearly and synchronize its source/frame/value identity with the playhead. Never present present-day variables, stale live handles or values from another recorded point as the selected historical state. A video with source links or a summary-only reader cannot meet G04. Missing/partial capture is explicit and does not pass required replay points.

Replay remains usable after the original runtime/debugger/chat exit. Time travel navigates captured history without repeating purchases or other target side effects; any deliberate new execution is a separate run. Exact recording/debug-adapter mechanics remain engineering work and need proof in both editors. No screenshot or specification establishes that capability.

Preserve the independent Wiki, recording/sequence/summary requirements, explicit learner progress, G12, D031 development target and D029's unchanged nine-project acceptance. Continue the remaining GStack passes and update the visual candidate in Cycle 0029. This individual decision settles the replay hierarchy; it does not approve unrelated control placement, missing states or the entire generated image.

Subsequent individual design choice **2A**: show capture status and **Save learning replay** in the editor's bottom status area, outside standard chat. The owner explicitly selected the placement shown in the version 8 candidate. Retain that affordance during live explanation; do not reopen this choice under later review passes.

Subsequent individual design choice **4A**: when video exists but source/debugger history is missing, continue video playback, mark the interval on the timeline and show **Not recorded at this moment** on the affected source/debugger surfaces. The owner's selected copy was “この時点は未記録”. Never substitute values or execution highlights from another moment. Entering a gap clears misleading prior state; reaching a recorded point restores its corresponding history. Apply this consistently to playback and seeking, with no automatic gap pause. Missing required evidence still prevents acceptance PASS. This resolves question 4, including its later re-display; it does not approve other state/layout changes.

## D033 — Reproduce DeepWiki through the editor agent's generation skill, 2026-09-26

Source: the owner selected design choice **3A**, then required that LLM Wiki reproduce DeepWiki itself and emphasized the generation skill as the primary implementation. Source links should open the user's local editor. These clarify the in-progress version 8 specification.

Decision: reproduce the DeepWiki repository documentation and reader experience: full chapter hierarchy, architecture/process explanations and diagrams, relevant-source/inline citations, page navigation and code-grounded repository Q&A. Treat the real inspected DeepWiki as the product reference. Emphasize this requirement in both written specification and the design image. Source citations target the matching local VS Code/Cursor checkout. Retain independent local/configurable output and the owner-approved browser **Update LLM Wiki** button, which starts updating in the correct editor without manual prompt re-entry.

The key implementation is a carefully authored DeepWiki generation skill used by the editor's AI agent. It teaches source exploration, chapter structure, explanation depth, accurate diagrams/citations, updates and quality checks. The shared thin `/codebook` entry delegates to that guidance. Wiki generation uses the agent's normal source/file capabilities and does not require the runtime/debug MCP service. The extension supplies configuration, update/status/open and source-link support; any bridge is supporting transport, not the Wiki-content engine. Route Wiki requests before the runtime `codebook_status` prerequisite. Runtime/replay still use their MCP/native-debugger contracts.

The independent Wiki remains readable without the editor, debugger, original chat or a learning replay. Agent/model setup may be needed for generation, updating and interactive Q&A; it does not become a dependency of reading already generated pages. The [Wiki specification](docs/specs/llm-wiki.md) and [generation-skill plan](docs/plans/deepwiki-generation-skill.md) own detailed outcomes. The observed external service is a reference, not Codebook implementation evidence.

## D034 — Use an ordinary expanded desktop window as the layout baseline, 2026-09-26

Source: the owner selected replay summary choice **5A**, then explicitly narrowed the layout requirement:

> 基本的には一般的なディスプレイでのフルスクリーンではないけど、画面いっぱいに広げた時のレイアウト基準でOKです。
>
> 極端に小さいウィンドウサイズだったり、200%とか極端な拡大倍率の時は正直考慮しなくてもいいです。

Decision: advance the product goal to **version 9** for this acceptance-scope change. Design and verify the editor/browser on an ordinary desktop display, with the window expanded to the available screen area at normal/default zoom. OS full-screen mode is not required. Extremely small windows and extreme zoom such as 200% are outside mandatory design and final acceptance. Do not turn generic skill prescriptions for mobile, tablet or high zoom into extra requirements for this product.

Preserve the chosen **5A** behavior: the replay's learning summary can collapse behind a clearly labeled **Learning summary** button when space is limited, prioritizing application video, source and native debugger. This remains a useful secondary behavior, not a requirement to make extreme sizes/zoom pass. In the ordinary expanded-window reference, show the summary alongside the primary context. Preserve the selected moment, source/debugger state, summary reading position and user focus when opening/closing it. Do not rearrange unrelated chats or native work layouts.

Keyboard access, meaningful labels, focus/reading return, supported host themes, contrast and reduced-motion behavior remain required at the supported ordinary desktop layout. Source/runtime truth, both hosts, D029's nine projects/two stages, D031's development target and all active feature capabilities remain unchanged. Older constrained/high-zoom results retain their historical scope; they no longer define a current product-completion gate.

## D035 — Make every shortcut discoverable in tooltips and a question-mark list, 2026-09-26

Source: the owner supplied tooltip/shortcut-list visual references and required:

> キーボードショートカットをつけるならUIのツールチップに明記必須、"?"キーでのshortcutリスト必須

Decision: every Codebook action with an assigned keyboard shortcut must show the operation name and applicable key combination in its UI tooltip. Pressing **?** in a Codebook non-editing context opens an accessible **Keyboard shortcuts** list. Use a readable operation/key layout matching the supplied references. Keep a visible list-entry control so the shortcut list can itself be discovered without already knowing the key.

The list and tooltips must agree with the shortcuts actually available in the active editor/browser, platform and feature context. The example screenshot's Codex commands and key assignments are visual references, not Codebook bindings. Only **?** is fixed by this decision; choose other assignments during implementation without conflicts or invented documentation. Preserve ordinary question-mark input in text fields, chat, source editors, terminals and IME composition. Native host actions retain native behavior.

The [keyboard-shortcut specification](docs/specs/keyboard-shortcuts.md) owns focus, discovery, list, tooltip and acceptance details. Apply it to Codebook-owned editor UI and the generated independent Wiki. This clarifies the in-progress version 9 design; it is not implementation evidence.

## D036 — Adopt the v9 visual target and a local implementation harness, 2026-09-26

Source: after design review, the owner requested an instruction/specification harness that a less capable agent can follow from AGENTS.md and linked local files. Issues may duplicate the local material; reading an issue must not be necessary to know the product or next action. The owner then explicitly adopted the corrected v9 image: **採用する。修正版v9を視覚仕様にする（推奨）**.

Decision: use [the approved v9 PNG](docs/designs/assets/codebook-product-spec-v9.png), SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, as the product's visual specification together with its [written companion](DESIGN.md). The generated Review candidate header predates adoption; keep the approved bytes and record identity and approval in [DESIGN.md](DESIGN.md). Native editor chrome and illustrative sample values retain the companion's evidence boundary.

AGENTS.md must lead to a local execution guide, complete active-goal acceptance map and current cycle/state. Require the implementing agent to open the actual image through an image-viewing tool, describe the relevant observed composition and compare implemented UI against it. A filename/prompt/metadata read is not visual inspection. Keep the PNG, generation prompts, identity, full feature contracts and evidence procedure in the repository so another checkout needs no private chat or GStack cache to understand the target.

The harness directs one bounded observable increment, its verification and local state update at a time. Preserve existing authorization boundaries, adaptive cycle selection and all final outcomes; it does not start runtime implementation during the current documentation/design/harness phase. Local documents own requirements and evidence; Issues #1/#46 mirror them. Reading/synchronizing issues remains useful tracking but their availability is not a prerequisite for otherwise authorized local progress. Keep the fixed nine projects, both hosts, ordered stages and owner acceptance intact.

Owner follow-up: give AGENTS.md stronger force, ensure every Cycle 0029 product requirement is reflected in PRODUCT_GOAL.md and its related contracts, and reduce document sprawl. Consolidate the execution loop, acceptance map and evidence template into IMPLEMENTATION.md. Make full normative reading, current assignment/cycle and actual PNG inspection an explicit implementation-entry gate; require mapped verification and local updates at review/closure. Preserve a fixed mandatory set and feature-triggered additional contracts, with historical/reference links consulted on demand. Record omissions as incomplete rather than claiming readiness. This is an auditable instruction protocol; Markdown alone cannot mechanically prove comprehension.

Review follow-up: require a source-grounded baseline for every acceptance row when a goal/design/cycle changes, then reassess affected rows after each increment. PROJECT_STATE records inspected source, concrete implementation gaps or UNKNOWN, separate proof gaps and next actions. Select work from those gaps and record before/after evidence at closure. Keep state/cycle records current, consolidate visual authority in DESIGN.md, and retain superseded detail in immutable Git history. The owner requested four-agent review of this instruction path; findings and verification belong in Cycle 0029.

## D037 — External application boundary, 2026-09-27

Source: the owner required complete removal of the bundled validation application and resumed extension development.

Decision: no demonstration or validation application may be embedded in extension source, runtime dependencies, build tasks, commands or VSIX assets. Open the designated external repository for actual-editor development. Isolated unit-test data remains outside production imports and package assets; package validation must reject accidental inclusion. Obsolete trial assets are removed and historical reports remain in Git. The approved product goals, both hosts and nine-project acceptance are unchanged.

## D038 — Restore the compaction product-context reminder, 2026-09-27

Source: the owner explicitly requested restoring the discarded Codex hook that makes an agent reread Product Goal materials after compaction, using the preceding 24-hour design/implementation transcript.

Decision: restore only `SessionStart` for `source: compact`. Supply the current AGENTS.md as developer context and require its full normative reads, current cycle, actual approved-image inspection and gap reassessment before continuing implementation/trials. Keep AGENTS.md as the reading-list authority. This narrowly supersedes the earlier hook deletion; tool interception, preparation receipts, Stop retries and CI harness gates remain retired. Injection proves delivery of instructions, not compliance or comprehension. Existing owner scope and pause instructions still control work.

## D039 — Deliver each completed cycle through review, PR, CI and merge, 2026-09-29

Source: Raphtalia's Goal direction during Cycle 0029: “Codebookを完成させてください。現在のCycleの作業が終わったら/open-code-review-delegate でレビュー後 /shipでPRを作成し、CIが通ったらマージして次のCycleを計画してください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はClaude CodeのExtensionを使用してください。”

Decision: continue toward the complete product. When the current cycle's authorized work is finished, review it with `open-code-review-delegate`, create or update its PR through `/ship`, merge once required CI passes, then plan the next cycle from the updated gap ledger. This authorizes the merge step for completed cycles; it does not waive D028's local CodeRabbit CLI review, D027's hosted-review skip, recorded findings, native evidence or any final acceptance gate. VS Code practical trials keep D025's order: Copilot Chat **Auto** first and the installed Claude Code extension only after observed Copilot credit exhaustion. Cursor evidence stays separate. Goal Issue #1 stays open until final acceptance and owner approval.

## D040 — Use Codex Extension after Copilot credit exhaustion, 2026-09-30

Source: Raphtalia's updated completion Goal explicitly says: “VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。” The owner subsequently selected “A：残りの作業を再開（推奨）” after the context restore.

Decision: resume the saved Cycle 0031 checkout and preserve its four uncommitted documents. For VS Code practical development trials use Copilot Chat **Auto**, then the installed **Codex Extension** after observed credit exhaustion. This supersedes the Claude Extension fallback in D025/D039 for this continuation. Do not purchase credits or change subscriptions; label evidence with the actual chat and fallback reason. Historical Claude observations remain attributed to their original host/source. Both-host separation, review/CI/merge gates and all final acceptance requirements remain unchanged.

## D041 — Use OBS Window Capture for native QA recording, 2026-09-30

Source: the owner requested actual trials of the three researched recording methods and the best method in AGENTS.md/workflow documents. During the trials the owner explicitly stated: “quick time、mac標準の録画ツールは操作が一切できなくなるからむりですね”.

Decision: use OBS **macOS Screen Capture → Window Capture** for native macOS editor QA, with the [tested procedure](docs/qa/native-recording.md). Select the exact owned window; verify silent audio setup, actual dimensions, reset transform/crop, changing-content preflight, saved-video metadata and inspected frames. Preserve unrelated work and record both hosts separately. Do not use QuickTime/Screenshot for this workflow or ask for an exclusive foreground hold. The window-ID CLI video's two black-output trials do not qualify it as a fallback without fresh successful proof.

Evidence and boundary: Cycle 0031's corrected OBS take captured the full dedicated VS Code dashboard window at 2880 × 1800/30 fps, including an inactive-window sample and subsequent visible panel/source changes without an exclusive foreground hold. Initial cropped OBS takes, CLI black files and standard-recorder automation failures remain preserved. This selects an evidence-acquisition tool; it changes no product outcome, recording/replay implementation, public package dependency or final acceptance gate. A working recorder does not establish reliable native input, current-candidate replay synchronization or Cursor/final proof.

Provenance: [Cycle 0031 recorder results](docs/cycles/0031-replay-transport.md#recorder-workflow-result-2026-09-30) and its recorder-entry baseline identify the private video/frames and receipt, VS Code 1.139.1 host, ce89dbd with declared dirty controller/tests, inspected artifacts, failed attempts and cleanup limitations. The receipt remains in ignored artifacts/cycle-0031/recorder-comparison/comparison.json; these are original recorder observations, not the later test-partition source cut or product/native acceptance.

## D042 — Stop after the current viewport acknowledgement repair, 2026-09-30

Superseded by the owner's subsequent explicit continuation under D043 before this stopping condition was reached.

Source: Raphtalia's explicit steering: “調査している不具合の修正が終わったら、一旦作業を止めて連絡して。” At that point the selected investigation is the recurring recorded-viewport paint acknowledgement timeout in Cycle 0031.

Decision: continue only the current bug investigation, repair and necessary verification. Once that repair is actually verified, stop work and notify the owner; pause the active completion goal without claiming the entire product is complete. Do not create its PR, merge or start another increment/cycle before an explicit resume. This stopping boundary supersedes D026/D039's automatic continuation/delivery for the current handoff; accepted product outcomes, existing dirty work and remaining evidence gates are preserved.

Boundary: the request is conditional, not an immediate pause or permission to call an unverified remedy complete. Preserve the failed recording and exact candidate/host/renderer-stage evidence. Recorder acquisition, native inspection readiness and viewport paint remain separate outcomes.

## D043 — Resume completion and authorize protected Mac use, 2026-09-30

Source: Raphtalia's explicit follow-up: “先ほど中断してと言いましたが、事情が変わりまして、コードブックの完成まで作業を継続していただけますでしょうか。私は寝ますので、おやすみなさい。Macはご自由に使っていただいて構いません。”

Decision: revoke D042's conditional stop and continue toward the complete Codebook product. Finish the current ACK repair and required proof, then continue the existing bounded-cycle workflow under D026/D039, including reviews, PR, required CI, merge and subsequent gap-driven cycles. Routine protected Mac operations are authorized while the owner sleeps; no new screen-time confirmation is needed. Preserve existing work, profiles, skills, settings, drafts, learner decisions, source and credentials.

Boundary: continuation does not waive current-source/native evidence, either editor, final nine-project stages, review/delivery gates or owner acceptance. Purchases, subscriptions and unrelated destructive changes remain outside authorization. Historical D042 receipts retain their original stopping instruction but no longer govern the current next action.

## D044 — Plan each next cycle through /spec and its issue, 2026-09-30

Source: Raphtalia's updated completion goal after the Cycle 0031 context restore: “Codebookを完成させてください。一つのCycleが終わったら 最終スペックと現在の完成状況から導出した次のCycleのIssueを /spec で作成し、必要に応じて /plan-design-review /plan-eng-review, /plan-devex-review でspecを補強し実装。… coderabbit-cli, /open-code-review-delegate でレビュー後 /shipでPRを作成し、CIが通ったらマージして次のCycleを計画してください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。”

Decision: continue D039/D043 delivery. After each cycle merges, derive the next bounded cycle from PRODUCT_GOAL, its contracts and the PROJECT_STATE gap ledger, and create its cycle Issue through `/spec`. Strengthen that spec with `/plan-design-review`, `/plan-eng-review` or `/plan-devex-review` when its scope touches UI, architecture or public API/setup, then implement. Review each completed cycle with local CodeRabbit CLI and `open-code-review-delegate`, create the PR through `/ship`, and merge after required CI passes. D040's VS Code chat order is unchanged: Copilot Chat **Auto**, then the installed Codex Extension after observed credit exhaustion.

Boundary: `/spec` output and its Issue mirror the local cycle document; they do not replace AGENTS.md's entry gate, the local cycle record or gap audit. This changes planning workflow only. D027's hosted-review skip, both hosts, native evidence, the nine-project stages and owner acceptance remain unchanged. Goal Issue #1 stays open.

## D045 — Resume cycle-after-cycle work after the pause, 2026-10-02

Source: on 2026-10-02 Raphtalia paused the work during Cycle 0038's reviews ("今回のPRをマージしたら一旦作業を中断してください。") and cleared the standing goal; PR #71 merged and the work stopped. Later the same day the owner set the goal again: "Codebookを完成させてください。一つのCycleが終わったら 最終スペックと現在の完成状況から導出した次のCycleのIssueを /spec で作成し、必要に応じて /plan-design-review /plan-eng-review, /plan-devex-review でspecを補強し実装。… coderabbit-cli, /open-code-review-delegate でレビュー後 /shipでPRを作成し、CIが通ったらマージして次のCycleを計画してください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください".

Decision: the pause is lifted. D043 and D044 apply again without change: continue toward the complete product one bounded cycle at a time, each planned through `/spec`, strengthened by the plan reviews its scope needs, reviewed with local CodeRabbit CLI and `open-code-review-delegate`, delivered through `/ship`, merged after required CI and the separate exact-HEAD gate, and followed by the next gap-derived cycle. D040's VS Code chat order is unchanged. Because the owner cannot answer, every decision point takes the recommended option and the cycle record names it.

Boundary: a pause the owner directs still stops the work at once, and only the owner's explicit message lifts it. The owner's statement that Codex automatic review is off stays in force: a delivery has no Codex cloud step. Both hosts, native evidence, the nine-project stages, owner acceptance and Goal Issue #1 are unchanged. Purchases, subscriptions, credentials, permanent deletion and security settings remain outside authorization.

## D046 — Pause once the next cycle's Issue is written, 2026-10-03

Source: Raphtalia's message during Cycle 0042's second `/ship` invocation, about 12:07 JST on 2026-10-03: "お疲れ様です😀次のサイクルのIssueを書き上げた時点で作業を中断してください".

Decision: finish Cycle 0042 as D045 describes. That is its `/ship` pull request, CI, the separate exact-HEAD gate, the merge in its own step, CI on `main`, Issue #78 closed by hand and the closure records. Then derive the next cycle from the goal and the gap ledger and write its Issue through `/spec`. Record that Issue and this pause in the local records, then stop. The next cycle's plan reviews, implementation, native trials and any later cycle wait for the owner's explicit message.

Boundary: this is a conditional pause, not an immediate one. Until the Issue is written, D045 applies unchanged, including the recommended option at every decision point. After it, only the owner's explicit message resumes the work. The pause changes no accepted product outcome, evidence rule or acceptance gate.

## D047 — Resume with Cycle 0043 on a Windows WSL host, 2026-10-03

Source: Raphtalia's messages of 2026-10-03, after Issue #80 was written and the work had stopped under D046: "この環境はWindowsのWSLです、nextjs-dashboardは~/laststance/nextjs-dashboardにあります"; "まずはこちらのサイクルから着手して https://github.com/laststance/codebook/issues/80"; and the goal "Codebookを完成させてください、VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください".

Decision: the pause of D046 is lifted. Cycle 0043 (Issue #80) starts, and D045 applies again: one bounded cycle after another, each specified through `/spec`, strengthened by the plan reviews it needs, reviewed with local CodeRabbit CLI and `open-code-review-delegate`, delivered through `/ship`, merged after required CI and the separate exact-HEAD gate. The owner cannot answer, so every decision point takes the recommended option and the cycle record names it. D040's VS Code chat order is unchanged.

The development host is now a Windows machine with WSL2. D031's designated dashboard is the same repository and revision; on this host it is at `/home/murakami/laststance/nextjs-dashboard`. Paths in earlier records that begin with `/Users/ryotamurakami` describe the development Mac and stay as written. Procedures that are specific to macOS (the OBS Window Capture procedure of D041, the protected Mac settings hashes, Computer Use grants) describe the Mac; a native check on the Windows host freezes its own procedure and identities in its cycle record, keeps both editors' evidence apart and reports what it could not run.

Boundary: no accepted product outcome, evidence rule or acceptance gate changes. The Mac's private `artifacts/`, its QA profiles and its local branches are not on the Windows host; evidence that depends on them is not carried over by assumption. Purchases, subscriptions, credentials, permanent deletion and security settings remain outside authorization. A pause the owner directs still stops the work at once.
