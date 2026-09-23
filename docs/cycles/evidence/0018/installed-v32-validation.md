# Cycle 0018 — v32 unchanged installed development validation

Recorded: 2026-09-23 JST. The same normally installed candidate **passes the complete frozen functional schedule in both VS Code and Cursor**, including the original v31 cold Wiki-to-Study failure. All extracted overview and selected detailed motion sheets are inspected. This establishes the bounded repair and retained-state regression; it does not complete the stopped development review, delivery, G12 or final acceptance.

## Frozen source and ordinary installations

- Clean source: `e6bbfadaef7a66d6b1380229d2f4b3405790823a`; 276 selected inputs, SHA-256 `ba43804ac39a67217e3295710d3cc015f41b41ee20d49d62510f41ac34b2ad47`.
- VSIX: `artifacts/cycle-0018/installed-development-v32/codebook-cycle0018-v32.vsix`, 609,482 bytes, SHA-256 `b8e872e7d1a10dfa6633f180f4cc809c963d7a2120f0c0ba0a0a45d8823faba1`. Extension 0.2.2, MCP API 1.5; root VERSION 0.2.2.0.
- VS Code 1.138.0 / API 1.138.0, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, debugger 1.117.0.
- Cursor 3.21.16 / API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, debugger 1.93.0.
- macOS 26.6.2 arm64 (25G83). Recorded editor viewport: 1280 × 800, dark theme, 25 fps.
- Known development repository: Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`. This is not a random final-trial target.

The schedule and 35 helpers freeze before launch at **2026-09-23 01:26:17 UTC**. Schedule SHA-256: `54a1769e3bb425b3f3038a18321a20d4ad9e79b1f757a201b6a52a18ac57b38a`. The three fresh owned profiles use normal editor CLI installation; all 29 packaged files per installation match the archive, separating installer metadata from package content. Runtime status identifies the loaded source/version in each launched host. No development host or changed installed bundle supplies the result.

Native admission uses the official editor CLI and the actual workbench document's focus, visibility and animation callbacks. It does not claim a successful Computer Use Raise operation. Product native-focus guards remain unchanged. The schedule runs the negative Cursor profile, full VS Code profile and full Cursor profile sequentially; no two editor trials compete for the screen.

## Observed results

| Trial | UTC interval on 2026-09-23 | Result |
| --- | --- | --- |
| Cursor scope-negative | 01:26:45–01:27:03 | **PASS**, eight orchestration steps. Empty catalog with separate Settings/native-chat focus refuses ambiguous main scope, preserving groups, tabs, draft and zero runtime runs. No AI chat message is sent. |
| VS Code full | 01:27:25–01:32:25 | **PASS**, 21 orchestration steps. First and restarted cold Wiki/source/Study, exact paused recording before any seek, both six-case Return matrices, mode/stress/retention controls and cleanup complete. |
| Cursor full | 01:32:55–01:42:30 | **PASS**, 22 orchestration steps. The same complete schedule plus twelve serial Wiki/Study pairs after restart completes. |

Each full host verifies:

1. Public cold Wiki entry selects the saved article and its actual source citation. The first Study entry reaches its owned app/source/context panes with confirmed layout.
2. The saved recording becomes ready at the exact expected paused position **before any corrective seek**. Before normal editor exit, the actual final pause is frozen; restart restores that state before any seek.
3. Six public observation/recording-to-Wiki Return cases across all three modes run both initially and after restart, twelve cases per host. Selection, learner state and captured evidence stay bound to the same item.
4. Twelve Living book/Guided walkthrough pairs, final Study restoration, 30 rapid three-mode cycles (90 transfers), 60 retained Guided/Study pairs (120 transfers) and twelve explicit Study Restores complete without an intermediate corrective retry. Cursor's retained phase completes in 206.503 seconds, within its frozen 300-second runner allowance.
5. Opening ordinary `package.json` and `tsconfig.json` preserves the existing owned tabs and actual webview document identities. Only the new unedited ordinary file is closed.
6. A real fourth main editor group produces the expected visible refusal while preserving that learner-owned group, unrelated work and replay state.

No new application/debugger run starts during these saved-evidence trials. Native public controls and direct public MCP calls supply development verification. They do not establish that Copilot Chat or Cursor Agent can independently perform the final workflow.

## Video and transition observations

All **73 overview sheets** are visually inspected: one Cursor negative, four initial and 21 restarted VS Code, four initial and 43 restarted Cursor. Their five source videos last 11.16, 38.32, 246.04, 47.92 and 507.96 seconds respectively. Overview extraction samples one frame per second, twelve samples per sheet; black padding after a video's final frame is not a black product frame.

All **12 detailed motion sheets**, 144 selected frames at 10 fps, are also inspected. Each editor has three 2.4-second clips: VS Code initial 3.0–5.4 seconds and restart 36.0–38.4 / 139.0–141.4; Cursor initial 3.0–5.4 and restart 84.0–86.4 / 292.0–294.4. Cold entry shows the correct saved Wiki/source, neutral selected-observation loading, then the matching application, source and explanation. Mode changes reconstruct the same paused recording and captured source.

**Visible loading remains a usability limitation.** Multiple detailed and overview samples show empty panes, Connecting, Loading or Changing presentation while replacement occurs. The retained-transfer clips end during another transition; their eventual completion is established by separate functional receipts, not by pretending that each selected clip shows completion. No unrelated checkout example is observed in these samples. The evidence does not establish seamless animation, every original 25 fps frame, full text readability, other themes/geometries, accessibility or owner acceptance.

| Host / phase | Calls | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| VS Code placement pairs | 24 | 694.5 ms | 700.1 ms | 744.4 ms |
| VS Code rapid transfers | 90 | 702.9 ms | 753.8 ms | 761.7 ms |
| VS Code retained transfers / Restores | 132 | 698.3 ms | 705.9 ms | 711.6 ms |
| Cursor placement pairs | 24 | 1575.8 ms | 1586.2 ms | 1592.6 ms |
| Cursor rapid transfers | 90 | 1572.7 ms | 1583.6 ms | 1593.3 ms |
| Cursor retained transfers / Restores | 132 | 1566.5 ms | 1577.5 ms | 1581.9 ms |

These are elapsed times from the public presentation request through its confirmed result, including orchestration. They are not measurements of the blank-pixel interval or portable performance guarantees.

## Source checks, CI and review remain separate

The [cold registration repair](cold-study-registration.md) has 33 focused passing checks, **993/993 product/shared + 96/96 package checks**, both builds and four typechecks on input hash `7c34db22c73baee2a0b711addc2b1695723b7763f15b4b51e9b9a24fa299e989`. Before packaging, only the reviewed `extension/README.md` changes: the other 275 inputs are byte-identical. No runtime, dependency, test or build-program input changes in that documentation bridge.

[Actions run 35806329227](https://github.com/laststance/codebook/actions/runs/35806329227) succeeds at the exact clean candidate source with **993/993 and 96/96**, zero failures, cancellations or skips. Its published artifact checksum matches. All **276 selected inputs and 31 unpacked archive entries** are byte-identical to the locally installed candidate. CI archive SHA-256 is `e1adfdf1dbe6f78d0870bcd4b01bba1c337b5d36b522d81e6dbd221fa3892b96`; ZIP-container identity differs from the local archive and is not claimed. The initial TAP-only log parser found no counts; reading Node's actual spec-reporter summaries corrected that read-only parser, without rerunning CI or inventing a pass.

The final two-file CodeRabbit supplement finishes in 148.080 seconds with zero findings on unchanged reviewed bytes. The parent follow-up and previously reviewed byte-identical files remain separately identified. Three **reused** delegated fixing passes ended non-converged; fresh-agent capacity was unavailable. Corrected findings, provider completion, passing CI and native success do not rewrite that review history or certify an independent clean pass. Claude Code CLI remains owner-skipped.

The invoked `/ship` workflow remains incomplete at its three-fix-cycle stop. Its installed rule says: “If the 3rd cycle still applies fixes” then “STOP and report” (`gstack-ship/SKILL.md`, review item 7). Findings concerned learner departure during passive reads, closed/reopened native lookalikes and cleanup on failed native panel creation; the source report records the exact reproduced controls and repairs. No fourth delegated fixing pass, PR, merge or publication is claimed. The checked candidate and this evidence are ready for the owner's decision about that development-review stop; the final ten-reviewer gate cannot be waived by this development result.

## Preservation and remaining work

Every owned test window closes normally with exit code zero. After backup verification, only any remaining owned background main process receives SIGTERM. All original **62 Cursor and 115 VS Code profile files retain their exact bytes and timestamps**; unsaved draft backups survive. Final read-only checks find zero owned editor processes or connection descriptors, unchanged real-repository checkouts, the same VSIX and installed files, and all 276 source inputs / 35 frozen helpers unchanged. Runner-owned sleep inhibition ends with each runner; no permanent Mac setting or authentication change is made.

The [sanitized manifest](installed-v32-manifest.json) identifies private evidence paths, sizes and hashes; recordings and raw runtime/profile data stay out of source control. The files remain local and must move to durable private storage before deleting this workspace. Missing evidence requires revalidation.

T3 implementation and T4's bounded installed schedule are demonstrated for this source. H8's source/native portion is demonstrated, while its non-converged review remains with the T5/H6 delivery gate. Cycle 0018 and Issue #23 stay open until authorized delivery completes. The earlier [v31 failure](installed-v31-validation.md) and every logging-only diagnostic retain their own identities. Do not repeat this successful unchanged schedule without a changed input or unresolved concern that warrants it.

G12's common thin skill and ordinary skill/MCP onboarding remain unimplemented. The previously recorded warm Wiki storage-wait focus race, loading/readability limitations, all intended real-repository contexts and full integrated acceptance remain outstanding. Issue #1, G01–G12, purchase confirmation, recording and stopped-app replay, connected learning views, understanding checks, all three modes, restart and Raphtalia's acceptance remain mandatory. Final trials remain **0/10 reviewers; 0/at least 20 editor trials, not started**. Test understanding checks never represent the owner's understanding.
