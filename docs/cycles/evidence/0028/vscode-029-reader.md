# Cycle 0028 — Installed VS Code 0.2.9 followed-pause trial

Date: 2026-09-26. Development validation only; no D029 Stage 1/2 credit. Result: **PARTIAL**.

## Candidate and route

- Clean source `c0800cdf117992127f9f62bdc2e4dedd6a56841e`; extension 0.2.9; common skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- Checked VSIX SHA-256 `d3fcb270cdd0e4486f1c2d70083a6d530d5e1ce28ce4225fe2078a29ed2c5474`, 918309 bytes. Installed in a dedicated extension directory and fresh `cb29-vscode` workspace.
- VS Code 1.139.1, Copilot Chat Auto routed to GPT-6 Luna, owner zoom 2. The setup command reported the connection ready.
- Ordinary question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

## Observed

Copilot checked Codebook, opened Study before application input, recovered one reported presentation-grid timeout through public Restore, selected Live, ran two application actions through four real pauses, saved four interpretations, reached purchase confirmation and saved the recording. No driver Open Study, Continue or application-action rescue was used. Understanding remained 0/4. The initial Restore timeout and recovery are part of this trial, not a clean first-attempt layout pass.

At the first Cart mutation pause, native accessibility exposed the captured values, but the actual Study viewport remained at its top with runtime controls filling most of the column. The inspected recording at 95 seconds shows the same top-of-Study position during Cart update. At 145 seconds, after the final pause, the interpretation heading appears but the value table remains below the fold. Native screenshots at the first and last pauses agreed. Application and source panes were open; Debug Console stayed closed. The stopped-page reading requirement therefore still fails at owner zoom 2.

The ignored 175.92-second renderer video and three inspected frames are bound in [media-manifest.json](media-manifest.json). This is renderer motion evidence plus native observation, not real-project acceptance. Cursor was not run on this failed reading candidate.

## Revised hypothesis

The renderer records the new observation ID before a later complete render can scroll to the evidence. A loading snapshot or tab transition can therefore consume the one-shot condition. Track the last observation actually revealed after complete rendering, add a delayed-snapshot regression, then repeat the installed viewport trial. Do not infer native success from the compiled Chromium fixture alone.
