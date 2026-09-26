# Cycle 0028 — Installed VS Code console-space retest

Date: 2026-09-26. Development validation only; no D029 Stage 1/2 credit.

## Frozen identity and ordinary route

- Source: `050f284ac3ce2afdc96da09b3b40508da48764e8` (clean package input, source hash `dd5e31c2b91e3f47045e0c24a6d354c6a7bac4017d666a237d09797a79d11b88`).
- Extension: 0.2.7; bundled skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- VSIX: SHA-256 `06cb0ca5308b13b026bddc1344b18e28b2335d19e0e7298c98843660ecb0a4a3`, 917882 bytes.
- Host: VS Code 1.139.1, ordinary Copilot Chat Auto routed to GPT-6 Luna, owner Carbonfox/zoom 2. Dedicated QA extension directory and fresh trial workspace; public `Codebook: Set Up AI Chat` reported ready.
- Question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

## Observed result: panel correction succeeds; reading outcome remains incomplete

The AI loaded the installed skill and opened Study before application input. Presentation selection hit the same grid-proportion timeout; the AI disclosed this and used public Restore, then Return Current to select Live before `codebook_start`. It performed two application actions and traversed four real pauses with four saved explanations. It distinguished pre-render captured state from post-continuation screen state and reached the visible purchase confirmation. The chat completed 70 steps in 2m32s; Study retained all four moments and reported `Recording saved.`. No driver execution or reader rescue was applied.

The Codebook-owned Node/browser configurations kept VS Code's Debug Console closed throughout the recorded execution. The native `Toggle Panel` value was 0. The application and captured source therefore occupied substantially more editor height than in the 0.2.6 recording. At owner zoom 2, the Study header and read controls still wrap across several rows; the runtime strip, presentation selector and tabs push Live's interpretation and captured values below the visible viewport during every sampled pause. The values and interpretation exist in Study's accessibility tree, but a user must scroll to read them. This does **not** satisfy the bounded simultaneous reading outcome; the 0.2.7 result is PARTIAL, not PASS.

The 241-second renderer recording was inspected at 65, 100, 135, 170, 205 and 235 seconds. Frames 100, 135 and 170 show a closed lower panel and larger app/source panes while the Study column remains consumed by controls. Frames 205 and 235 show the post-run Live tab and the start of the interpretation, with captured values below the fold. This renderer film is separate from the full native screenshot and does not prove every transition frame. The native AX tree confirms `cartId=selected`, `productId=tote-01`, `price=24`, `cartCount=1`, `admittedCount=2`, `total=24` and `orderCount=1` at the saved purchase-confirmation observation.

Cursor was not run on this cut. This local demo and the package checks do not count for any of the nine required projects. All D029 Stage 1 and Stage 2 cells remain NOT RUN.

## Next change

Reduce the Study reading chrome at narrow effective widths while preserving discoverable pane controls, keyboard access, saved presentation modes and reading pose. Repeat the installed video and native viewport check on a new frozen VSIX in both editors. Raw media stays ignored; hashes and paths are in [media manifest](media-manifest.json).
