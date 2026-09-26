# Cycle 0028 — Installed VS Code 0.2.8 narrow-reader trial

Date: 2026-09-26. Development validation only; no D029 Stage 1/2 credit. Result: **PARTIAL**.

## Candidate and route

- Source: clean `b11b25dad83bf00e05047e83fd6ec516054e4885`; extension 0.2.8; common skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- VSIX: SHA-256 `dd665a3deacdb8660b8c887eb0897ea2fb956164bc0a5c7f601feeae3910e110`, 918148 bytes. Installed in a dedicated extension directory and a fresh `cb28-vscode` trial workspace.
- Host: VS Code 1.139.1, Copilot Chat Auto routed to GPT-6 Luna, owner zoom 2. The ordinary setup command reported the AI chat connection ready.
- Question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

## Observed

The AI loaded Codebook, checked status, opened Study, selected Live through Return Current, and started the demo before application input. It performed both application actions, traversed four real pauses, saved four interpretations, reached selected purchase confirmation, and saved the recording. The chat completed 58 steps in 1m 59s. Study reported `demonstrated`, `Recording saved`, and 0 of 4 learner-owned understanding checks. No driver Open Study, Continue, or application-action rescue was used.

The new Study disclosure was collapsed on narrow Live entry. Native accessibility exposed its summary and the actual values (`cartId=selected`, `productId=tote-01`, `price=24`, `cartCount=1`, `admittedCount=2`, `total=24`, `orderCount=1`). Clicking the summary exposed the existing pane and presentation controls; pressing Space while focused closed it again. The Debug Console remained closed.

The visible reading result still fails: at owner zoom 2, the sticky runtime strip wraps Return, Continue, Stop and the wall-limit text across most of the Study column. In the native screenshot during Cart update, the Live tabs are only just visible at the bottom edge and the interpretation and values are below the fold. The 197-second Playwright renderer video shows the same geometry at 135 and 165 seconds; at 190 seconds, part of the interpretation becomes visible after execution, but values are still below the fold. That renderer video is 800×600 and does not replace native viewport evidence. The disclosure alone does not meet simultaneous app/source/Live reading.

The run's ignored video and six inspected frame hashes are in [media-manifest.json](media-manifest.json). Cursor was not run on this failed reading candidate; no real-project acceptance cell is credited. The dedicated VS Code window was closed after recording and its Playwright session detached.

## Revised hypothesis

The sticky runtime controls, not just Study's title and pane controls, consume the remaining visible height. A next candidate should put evidence first at a new followed pause while preserving an obvious Continue action, keyboard access, manual scroll and reading pose. Test the actual narrow stopped viewport before freezing another package, then repeat both installed hosts. Do not claim source-level scroll calculations or AX presence as visible reading proof.
