# Cycle 0028 — Installed VS Code 0.2.10 followed-pause trial

Date: 2026-09-26. Development validation only; no D029 Stage 1/2 credit. Result: **PARTIAL**.

## Candidate and route

- Clean source `fb9435d421f3e78ba3a29b27a15a8953050d6697`; extension 0.2.10; common skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- Checked VSIX SHA-256 `b289569c6a9230efc9b76bf442e2eb8b60e6293707f701f89b700f14392ec0e2`, 918302 bytes, installed in the dedicated `cb210-vscode` workspace and extension directory.
- VS Code 1.139.1, Copilot Chat Auto routed to GPT-6 Luna, owner zoom 2. The standard setup command reported the connection ready.
- Ordinary question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

## Observed

Copilot opened Study before application input, selected Live, ran two application actions through four actual pauses, saved four interpretations, reached selected purchase confirmation and saved the recording. No driver Open Study, Continue or application-action rescue was used. Understanding remained 0/4. The Debug Console stayed closed.

The first Cart mutation pause did scroll the Study column to the evidence. The native screen simultaneously showed Application, captured source, the interpretation heading and captured value rows including `cartId=selected`, `productId=tote-01`, and `price=24`. This confirms the delayed-render fix is active in the installed extension.

Long saved interpretations still fill the narrow Study column. The inspected video at 115 seconds shows the Cart update interpretation occupying the visible Study height with values below. At 160 seconds the Purchase confirmation interpretation likewise fills the viewport; the final native screenshot agrees. The bounded requirement for readable interpretation and actual values together during all inspected pauses therefore remains unmet. The 170.68-second ignored renderer video and three inspected frame hashes are in [media-manifest.json](media-manifest.json). Cursor was not run on this failed reading candidate.

## Revised hypothesis

Keep the full AI explanation keyboard-readable inside a height-bounded region on narrow Live, and keep the first captured values in the same visible viewport. Verify a long explanation in compiled Chromium first, then repeat native VS Code and Cursor on one frozen VSIX. Do not credit a fixture as native proof.
