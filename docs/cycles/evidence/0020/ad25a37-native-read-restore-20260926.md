# Cycle 0020 latest-source native Read and Restore, 2026-09-26

This is development evidence for [Cycle 0020](../../0020-constrained-study.md), not final G07/G11 acceptance or a final-review trial. The two editors used the same clean source and VSIX, but different saved studies and profiles. Renderer recordings, native accessibility, and macOS screen observations are distinguished below.

## Candidate and checks

- Source: `ad25a3735a605d2f730ba85d99d05f2627a2ad02`, clean. The additional Restore window-focus regression failed before the repair and passed afterward. The full extension suite passed **955/955**, the package suite passed **101/101**, and TypeScript typecheck and `git diff --check` passed. Ignored local logs: `artifacts/cycle-0020/checks/cb20-window-focus-full.log` and `cb20-window-focus-package.log`.
- Checked 35-entry VSIX: ignored `artifacts/cycle-0020/packages/cb20-codebook-ad25a37.vsix`, 915,859 bytes, SHA-256 `cb8c1ac50104c498c61ce41e5c0889a5757504f992655a903959dc341000ded2`, selected-source hash `d6a2b76a14f9ecfbc0c530acb08d476d065c1c17690a6a32362cf16e0347b53e`, `dirty: false`. The official editor CLIs installed it with `--force` into `/tmp/cb20ext` and `/tmp/cb20cursorext`; both installed `dist/build.json` files matched this revision and source hash.
- Host versions: macOS 26.6.2, VS Code 1.139.1, Cursor 3.22.8. The target `artifacts/cycle-0019/targets/mantine-analytics-preflight` stayed clean on `dev`.

## Native schedule and limits

| Host and profile | Window and zoom | Observed public operation | Retained state and limit |
| --- | --- | --- | --- |
| VS Code, isolated `/tmp/cb20qa` and `/tmp/cb20ext` | 1240 × 776 CSS px, zoom 0, renderer DPR 2 | Open Study, Read application, Read captured source, Read explanation, Restore. Native accessibility showed the requested maximized pane and then Application/source/Study in editor groups 1/2/3. | Source-derived Cart mutation remained selected at captured line 23; understanding stayed 0/4. No runtime observation or recording was made on this source-derived study. |
| VS Code, same installed window | 1240 × 776 CSS px, zoom level 4 (200%), renderer DPR 4.1472 and 598 × 374 inner CSS px | The same Read sequence made each pane individually readable; Restore returned all three owned groups. The focused explanation explicitly said the three-pane split was not confirmed before Restore. | Cart mutation and 0/4 understanding remained. The restored split is cramped, so its content is read through the public focus controls. The observed native screen stills were inspected in this task, but were not saved as independent native-pixel files. |
| Cursor, signed-in owner profile with only `--extensions-dir /tmp/cb20cursorext` | 1240 × 776 CSS px, zoom 0, renderer DPR 2 | Open Study, Read application, Read captured source, Read explanation, Restore. Native accessibility showed the requested maximized pane and then the same three owned editor groups. | Historical `Menu button opens the drawer` remained selected at captured `HeaderNav.tsx:111`; understanding stayed 0/1. Existing `SKILL.md`, original `HeaderNav.tsx`, settings and Agent chat were not edited. |
| Cursor, same work window | 1240 × 776 CSS px, zoom level 4 (200%), renderer DPR 4.1472 and 598 × 374 inner CSS px | Source and explanation were readable through public commands; a later Read application displayed the captured image; Arrange returned the three owned groups. | The first native screenshot immediately after Read application showed a black Application surface without a completed maximization. The same recording shows captured Application pixels shortly afterward, and a later explicit Read succeeded. This first transition is **qualified**, not a clean first-attempt success. The restored compact split remains cramped and needs focused reading. |

The first fresh `/tmp/cb20cursorqa` Cursor profile displayed its first-run login screen over the workbench. The VSIX was installed and Study tabs appeared behind it, but this was installation evidence only. The native Cursor schedule above used the already signed-in profile with the **isolated extension directory**. The owner's installed `~/.cursor/extensions/laststance.codebook-0.2.3` stayed at its earlier `f3395a4…` dirty build. The owner's `settings.json` SHA-256 stayed `c626f9ae2b11846a97b1d3dbcead752b99563d03d627815b9224191aa0f2ee1f`; the work window returned to its original 1728 × 1084 CSS px and zoom level 2. Codebook-owned panes were closed, the target Git tree remained clean, and the dedicated Cursor and VS Code processes exited.

## Private motion artifacts

The ignored videos below are Playwright CLI **800 × 600 renderer recordings**, not native-pixel recordings. Frames were extracted with `ffmpeg` and visually inspected. Native macOS screenshots and accessibility were inspected separately through Computer Use in this task; they have no durable file path and must not be promoted to final native-pixel evidence.

| Host and schedule | Ignored local artifact | Duration | SHA-256 | Inspected frames |
| --- | --- | ---: | --- | --- |
| Cursor, zoom 0 | `artifacts/cycle-0020/native/cursor-ad25a37-1244x776-normal.webm` | 68.16 s | `b9a30138f999378d2f54a980cc306d29e9a0ea86bfd6aae03e8d3767aedd4a50` | `cursor-ad25a37-normal-frame-10.png`, `-35.png`, `-60.png`, `-65.png` |
| Cursor, 200% | `artifacts/cycle-0020/native/cursor-ad25a37-1240x776-200pct.webm` | 288.80 s | `8328e549b84217dec7672722a37ce2bd848e5c63dbb6c0bad30067f3b4434d77` | `cursor-ad25a37-200pct-frame-30.png`, `-110.png`, `-180.png`, `-270.png` |
| VS Code, zoom 0 | `artifacts/cycle-0020/native/vscode-ad25a37-1240x776-normal.webm` | 60.48 s | `29a16575e573671d7af5c2c631ca2f1007a7286ef8c432ebea106f3f6c0a0226` | `vscode-ad25a37-normal-frame-10.png`, `-35.png`, `-55.png` |
| VS Code, 200% | `artifacts/cycle-0020/native/vscode-ad25a37-1240x776-200pct.webm` | 49.32 s | `ee81f3ddc1ff88b36efeb466cfe62316c289b6830a1f80816f0d502f9559ae3f` | `vscode-ad25a37-200pct-frame-5.png`, `-35.png`, `-45.png` |

The Cursor normal recording began at approximately 1244 × 781 CSS px before a measured resize to exactly 1240 × 776; report the recorded geometry per frame. The 200% Cursor recording includes diagnostic time between actions. The 110-second frame shows captured Application content despite the separate transient black native capture, so neither observation alone establishes a stable first transition.

## Owner-reported Read Explanation error

The owner supplied a 2026-09-25 21:00 screenshot showing `Codebook: Read Explanation` rejected with `Focus the Codebook work window and open Study before reading a pane.` The screenshot does not identify the extension build, active-window focus state or whether Study was open at command dispatch. The checked `ad25a37…` VSIX was built later at 21:40; the owner's default Cursor extension remained the earlier dirty `f3395a4…` build. In the current source, {@link StudyWorkspace} emits that exact message only when its reader is closed or the extension host reports the work window unfocused. Existing background-window tests cover that refusal, which protects unrelated windows from a focus steal.

The owner screenshot's exact trigger is therefore **unconfirmed**. The same user-visible captured-source → `Codebook: Read Explanation` flow succeeded through the native command palette in focused VS Code and Cursor work windows on the current VSIX, with no modal. Do not weaken the focus guard on this evidence. A current default-profile installation and a replay of the exact owner window state remain necessary before claiming the old installed experience repaired.

## What remains

This source-specific development run establishes focused reading and Restore at the declared compact window size in both editors, with the qualified Cursor first Application transition above. It does not prove saved playback-position preservation in both hosts, uninterrupted native-pixel motion, ordinary fresh-profile Cursor onboarding, current default-profile installation, AI-owned `/codebook` use, the complete real checkout or G01–G12 final acceptance. The final reviewer streak is still 0/10. Keep Cycle Issue #27 and Goal Issue #1 open while those requirements remain.
