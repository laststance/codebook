# Cycle 0018 — Unchanged v21 installed validation

Result: **FAIL in ordinary Cursor; VS Code native validation unexecuted**, 2026-09-22. The [three pre-landing ownership repairs](prelanding-primary-interaction.md) have source-level regression evidence, but this new unchanged archive does not pass the complete installed schedule. No final reviewer trial or G12 validation occurred.

## Frozen candidate

| Identity | Value |
| --- | --- |
| Source commit | `9a9fd7cf50ed9c64f912048d5556a41407ddbc14`, clean when packaged |
| VSIX | `artifacts/cycle-0018/installed-development-v21/codebook-cycle0018-v21.vsix` |
| SHA-256 / size | `de89f86635d3d0228d4ed9d48794db5153de41276424947688e9891b266793bb` / 600,940 bytes |
| Extension / protocol | 0.2.1 / 1.5 |
| Selected inputs | 273; SHA-256 `a76bbfb6cffd6321645786e86cf3a7642f1207f04dd931f4d0d7fd625c62d211` |
| Source checks | 23 focused, 825/825 product/shared and 96/96 package; exact selected inputs match the tested working tree |
| Cursor | 3.21.16, API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, js-debug 1.93.0 |
| VS Code | 1.138.0, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, js-debug 1.117.0; installed, not launched |
| System / target | macOS 26.6.2 arm64, Node 24.21.0; retained Laststance.io checkouts at clean `43d039938287ed494a66f4fad198da2464a9e7b0` |

The candidate, 23 helpers and sequence were frozen at 10:18:37 UTC before native launch. Both ordinary editor CLIs installed the same VSIX into three owned profiles; all 29 packaged files matched each installed copy, separating installer metadata. The loaded clean build identity matched in all three executed Cursor instances. Final verification confirms the VSIX, all three installed copies, every selected source input and all frozen helpers remain unchanged. VS Code installation equality is not loaded-runtime evidence.

## Observations and failure

Cursor's empty-catalog, separate-main/chat control passes: one public Wiki command visibly refuses ambiguous focus while preserving tabs, geometry and the dirty draft. The full initial phase passes cold Study with app/source/context at 1/2/3, current saved Wiki and exact ready paused replay at 11,453.2425 ms before any seek. All six observation/recording Wiki Returns and final default-mode restoration pass.

After normal close and restart, cold Wiki, Study and exact pre-close paused replay at 11,429.631958 ms pass, including study, observation and frame identity. Twelve serial Wiki/Study pairs and all six restarted observation/recording Returns pass. Every one of the twelve initial/restarted Returns restores its exact control focus and position, with zero pixel displacement.

The restarted round-trip helper then fails its mandatory final Guided-to-Study restoration. The receipt ends at 10:24:48.242 UTC with `PRESENTATION_UNAVAILABLE`; read-only observation identifies **`Timed out waiting for owned presentation inner focus`**. Guided mode and saved preference remain, requested mode is Study, and `layoutConfirmed` is false. The screenshot and sampled video show the visible error after panes move. Exact paused replay and zero application runs remain intact.

This is a product presentation timeout, not a CLI/observer timeout or an AI-service failure. The post-failure workbench is visible and focused, but that later observation cannot prove which document receipt/native predicate failed during the handoff. The cause is not yet established. Earlier native activation, text-focus-clear and primary-interaction diagnoses cannot be assigned to this timeout from its message alone.

The schedule stops at this first unexpected failure. The twelve additional Living/Guided pairs, ninety immediate transfers, fourth-main-group control and all VS Code native phases are **unexecuted**. No retry, corrective seek, layout restoration or product injection follows. A new read-only observer, derived by replacing the frozen VS Code observer's host with Cursor, captures failure state; it is explicitly post-failure instrumentation, not a changed passing trial.

## Recording and preservation

| Native video | Duration | Inspected / extracted one-Hz sheets |
| --- | --- | --- |
| Cursor scope-negative | 53.60 s | 3/5 |
| Cursor initial | 90.32 s | 8/8 |
| Cursor restart | 187.52 s | 7/16 |

All three recordings are 1280×800 at 25 fps. Eighteen contact sheets are inspected and eleven remain uninspected. The inspected restart sheet beginning at 132 seconds shows the final movement and subsequent timeout. One-Hz sampling is not every-frame inspection. Guided Context is vertically constrained; full reading usability, other viewports/themes and console cleanliness are unverified. Trailing black contact-sheet cells are padding after video end.

Every launched owned window closes normally with exit 0. All original 62 Cursor and 115 VS Code profile files retain bytes and modification times; unsaved backups are preserved. All three prepared profiles have zero owned editor processes and connection descriptors. VS Code remains unlaunched. Existing test understanding is not Raphtalia's understanding or acceptance.

The [sanitized manifest](installed-v21-manifest.json) records 163 private artifacts under `artifacts/cycle-0018/installed-development-v21/`. The frozen schedule, per-phase receipts, read-only failure observation, videos/inspection inventory, `validation-summary.json`, final installed/source equality and original-profile preservation are separate records. Missing private evidence requires revalidation.

## Next action and gates

**T3 reopens for the inner-focus investigation; T4 is FAIL and T5 remains pending.** Trace the request/epoch, delivery, focused receipt and native completion predicates at this exact boundary before selecting another fix. Preserve the original timeout and learner-ownership protections; a repeated attempt without a changed diagnostic hypothesis is not justified. The completed three-fixing-pass pre-landing workflow remains non-converged, and the CodeRabbit supplement retains its original coverage/triage.

G12 remains specified, unimplemented and unverified. The `/codebook` skill/onboarding increment follows this cycle's delivery; this known-repository, direct-MCP development trial cannot satisfy actual editor-AI acceptance. Goal #1 and cycle #23 remain open; final counts stay **0/10 reviewers, 0/at least 20 editor trials, not started**. Claude Code CLI long reviews remain owner-skipped.
