# Cycle 0018 — Unchanged v20 installed validation

Result: **PASS for the frozen development schedule in both ordinary editors**, 2026-09-22. This verifies the [delayed text-focus clear repair](cursor-text-focus-clear.md) against the original entry/restart sequence and retained mode/ownership regressions. It is not G12 implementation, final product acceptance or a final reviewer trial.

## Frozen candidate and environment

| Identity | Value |
| --- | --- |
| Source commit | `6324f40c7eced9c2283ee613d66b1b7cc9ffdd3a`, clean when packaged |
| VSIX | `artifacts/cycle-0018/installed-development-v20/codebook-cycle0018-v20.vsix` |
| SHA-256 / size | `4aa0cdb35764be7f08d4fb6696c28a00afd9d6890624b7e5965e551a3dd22de3` / 600,615 bytes |
| Extension / API | 0.2.1 / 1.5 |
| Tested inputs | 273; SHA-256 `f38f68aee4366bbd91a4990addfc2ccd79f6f44c32c2332dec2c6380daaee202` |
| Source checks | 816/816 product/shared and 96/96 package checks; no failures, skips or cancellations |
| Cursor | 3.21.16, API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, js-debug 1.93.0 |
| VS Code | 1.138.0, API 1.138.0, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, js-debug 1.117.0 |
| System / runner | macOS 26.6.2 arm64 / Node 24.21.0 |
| Repository | Both retained Laststance.io checkouts at clean `43d039938287ed494a66f4fad198da2464a9e7b0` |

The 19 helpers, candidate, environments and sequence were frozen before launch. Execution was sequential: Cursor scope-negative, Cursor full, then VS Code full. Each ordinary editor CLI installed the same VSIX into a fresh copy of its original QA profile. All 29 installed extension files matched, with installer metadata separated from the manifest comparison. Public status confirmed the loaded clean revision and source hash in every initial/restarted instance. After all trials, the archive, all three installations and every selected source input still matched. No product instrumentation or development host was used.

## Results by host

| Required development observation | Cursor | VS Code |
| --- | --- | --- |
| Cold Study, current saved Wiki and exact ready paused replay before seek | PASS; 11,453.2425 ms | PASS; 11,405.3895 ms |
| Initial observation/recording Returns in all three modes | 6/6 PASS | 6/6 PASS |
| Normal restart, current Wiki and exact pre-close replay state before seek | PASS; 11,429.631958 ms | PASS; 11,358.763459 ms |
| Retained Wiki/Study timing regression | 12 pairs PASS | Cursor-specific control |
| Restarted observation/recording Returns in all three modes | 6/6 PASS | 6/6 PASS |
| Living/Guided moving-pane regression and final Study restoration | 12 pairs / 24 transfers plus restore PASS | 12 pairs / 24 transfers plus restore PASS |
| Immediate serial Living/Guided/Study regression | 30 triplets / 90 transfers PASS | 30 triplets / 90 transfers PASS |
| Real fourth main group | Expected refusal; learner arrangement preserved | Expected refusal; learner arrangement preserved |
| Separate ambiguous main/chat focus with empty catalog | Expected visible refusal; work preserved | Cursor-specific control |

Recording links may select a different captured moment during normal use. Each exact restart expectation was therefore frozen from the actual final paused state before close; no corrective seek was used to obtain the restart result. Observation, frame and study identities also match. All 24 Wiki Returns retain the exact control focus and bounding box, with zero pixel displacement. Existing explicit test understanding remains unchanged and no new application runtime starts.

The new 90-transfer control includes the Guided-to-Study boundary that failed at transfer 60 in the separately identified v19 diagnostic. V20 completes every planned transfer in both hosts. The expected fourth-group refusal remains visible at the end; it is a successful preservation control, not an unexpected presentation failure.

## Video, preservation and limits

| Native recording | Duration | Inspected / extracted one-Hz sheets |
| --- | --- | --- |
| Cursor scope-negative | 91.12 s | 3/8 |
| Cursor initial | 78.00 s | 7/7 |
| Cursor restart | 219.40 s | 9/19 |
| VS Code initial | 70.88 s | 6/6 |
| VS Code restart | 175.76 s | 8/15 |

All recordings are 1280×800 at 25 fps. The 33 inspected contact sheets show the original draft, cold entry, saved Wiki/source/recorded-app correspondence, moving/loading and settled compositions, and expected preserving refusals. Twenty-two extracted sheets remain uninspected. One-Hz inspection is not every-frame review. Guided Context remains vertically constrained at this viewport; full reading usability, other geometries, exact theme certification and console cleanliness are not established. Visually dark appearance is recorded without assigning a certified theme name. Padding after a video's end is not a black application frame.

Every owned window closes normally with exit 0. Cleanup verifies all 62 original Cursor and 115 original VS Code files, their modification times and unsaved backups. Only owned background processes are terminated after window closure and backup verification. Every owned profile ends with zero editor PIDs and connection descriptors. No existing logged-in work profile is altered, no AI message is sent, and no test understanding is treated as Raphtalia's acceptance.

The [sanitized manifest](installed-v20-manifest.json) identifies private artifacts under `artifacts/cycle-0018/installed-development-v20/`. `validation-summary.json` cross-checks the successful receipts, original-profile preservation, exact Returns and unchanged helpers; `final-unchanged-verification.json` verifies the archive, installed files and 273 inputs. Missing private artifacts require revalidation of their associated claims.

## Development and final gates

**T3 source repair and T4 installed development validation are complete; T5 remains pending.** The exact two-file CodeRabbit supplement has zero findings, with its source cut and coverage recorded in the repair report. It does not replace fresh current-head pre-landing review of the complete cycle or erase historical non-convergence. Current CI/artifact comparison, cycle PR/merge and Issue #23 closure are still required. Include `@coderabbitai ignore` and `Closes #23` in that PR. Claude Code CLI remains owner-skipped.

G12's common skill, registration/setup, protected lifecycle, correct MCP onboarding and actual `/codebook` chats remain unimplemented and unverified. The known repository and direct-MCP development helpers here are not the random-repository, actual-AI end-user protocol. All prior product, checkout, recording, three-mode and owner-acceptance requirements remain open where their final evidence is missing. Keep Goal #1 open and final counts at **0/10 reviewers, 0/at least 20 editor trials, not started**. Select the required skill/onboarding increment after this cycle's delivery.
