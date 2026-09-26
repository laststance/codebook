# Cycle 0028 — Installed VS Code 0.2.11 exact-question retest

Date: 2026-09-26. Development trial only; no D029 Stage 1/2 credit. Result: **PASS for this bounded VS Code checkout reading trial**, with constrained-width limitations retained.

## Candidate and route

- Clean source `a58d68fd690751906cc513d7ddf638b45257e11e`; extension 0.2.11; bundled skill 1.0.20.
- Same checked VSIX SHA-256 `2ca23ab41d26c242769f1a62a129ac4af5184666ab6a3b553c1d4505682c6c95`, 918361 bytes. New dedicated VS Code process, `cb211b-vscode` workspace and the already isolated 0.2.11 extension directory.
- VS Code 1.139.1, owner zoom 2. The standard setup command reported the connection ready. Copilot Chat Auto routed the completed request to GPT-6 Luna; its UI reported 3.6 credits.
- The exact ordinary question was inspected before sending and after submission: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。` No probe suffix was present.

## Observed

The AI opened the closed Study workspace and selected current Live before application input. A native screenshot at the ready state showed the real demo page in Application, linked captured source and visible Study Live. Both webviews painted before the first action; the previous dedicated-process black panes did not recur.

Copilot performed the declared add-to-cart and checkout actions, inspected four distinct pauses, saved four source-grounded explanations and stopped the run. The resulting Study was `demonstrated`, reported purchase confirmation, retained all eleven required runtime links, and saved its recording. Learner understanding remained 0/4. The Copilot response completed 80 steps in 2m 4s and reported the local demo outcome; no real payment occurred.

The inspected renderer video shows the Application, captured source, explanation and first captured-value rows together at the selected purchase pause and after Stop. At 105 seconds the cart-update stop displays actual values with no explanation yet. At 145 seconds the saved purchase-confirmation interpretation and value table are both visible; at 165 seconds they remain visible beside the historical Application and captured source. This supports the 0.2.11 long-interpretation layout's bounded VS Code reading outcome. The source line and longer values still require horizontal reading in the narrow, zoomed panes; this trial does not prove broad constrained-layout usability or other hosts.

The ignored 204.24-second video, 8,570,066 bytes, and inspected frames are bound in [media-manifest.json](media-manifest.json). The earlier invalid 0.2.11 trial remains separate; its blank pixels and partial Study are not converted into a pass.

## Next gate

Run the identical checked VSIX in an ordinary Cursor Agent chat, preserving the owner's existing extension, skill, and connection state. Then perform current-head CodeRabbit CLI/OCR review, CI and Cycle 0028 delivery. Every nine-project acceptance row remains NOT RUN.
