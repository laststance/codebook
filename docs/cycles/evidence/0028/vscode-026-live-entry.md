# Cycle 0028 — Installed VS Code Live-entry retest

Date: 2026-09-26. Development validation only; no D029 Stage 1/2 credit.

## Frozen identity and ordinary route

- Source: `5f63fb2309f00983c20f4dcd05dc18e74e5989ac` (clean package input, source hash `235212d56624bb05f28dd21d10bc3110dd1340fc6a427c0a7053aa248d03ed37`).
- Extension: 0.2.6; bundled skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- VSIX: SHA-256 `9c50e9d692c9dee1629c32ae1e78b22bb8e331324efb1a641e2ac23889456ed3`, 917875 bytes, 35 entries.
- Host: VS Code 1.139.1, ordinary Copilot Chat Auto routed to GPT-6 Luna, owner Carbonfox/zoom 2. Dedicated QA extension directory and fresh trial workspace; normal `Codebook: Set Up AI Chat` reported ready.
- Question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

## Observed result: Live correction succeeds; bounded reading outcome remains incomplete

The AI loaded the installed skill and selected Study before execution. Presentation selection again hit a grid-proportion timeout; it disclosed that and used public Restore. It then saw the reader on Overview and independently called the public Return Current operation. The native Study selected Live before `codebook_start` and remained on Live through runtime pauses. No driver execution or presentation MCP call assisted the chat.

The AI performed two application actions, four real pauses and four saved explanations, with continuation and a final purchase confirmation. During the cart-mutation pause, the Live AX tree exposed `cartId=selected`, `productId=tote-01`, `price=24`, `cartCount=0`, `admittedCount=2`. At order creation it exposed `cartCount=1`, `total=24`, `orderCount=0`; at purchase confirmation `orderCount=1`. The chat distinguished values observed before the final DOM update from the screen after continuation. One explanation call had an incorrect URI; the AI used the correct snapshot reference on the next call and continued. The run reached `demonstrated`; Study reported a saved recording and all four moments. The chat completed 79 steps in 2m50s.

The correction resolves the 0.2.5 Overview regression. Native usability remains unproven: the owned debugger launches opened the Debug Console and Run/Debug sidebar. At owner zoom 2, the console occupied much of the editor height; the application appeared only as a tiny pane and Study's Live values and explanations required scrolling below the visible fold. AX exposed correct values while the simultaneous three-pane reading experience remained constrained. The six inspected renderer-video frames at 55, 80, 110, 145, 175 and 205 seconds show the transition from normal workspace to open Study, then the expanded debug panel throughout pauses and completion. A renderer film is not a full desktop capture, and these samples do not certify transition quality.

The separate post-run learner read controls and all three modes were not re-evaluated on this 0.2.6 cut; prior runs retain only their own source identities. Cursor on this cut was not run. All new nine-project acceptance cells remain NOT RUN.

## Next change

VS Code's documented launch option `internalConsoleOptions: neverOpen` keeps the Debug Console closed for a debug session. Apply it to Codebook-owned Node and browser launch configurations only, preserving user settings and foreign sessions, then repeat installed evidence on a new package. Source: [VS Code debugging configuration](https://code.visualstudio.com/docs/debugtest/debugging-configuration#_launchjson-attributes). If the sidebar or window geometry still prevents readable panes, retain that limit and investigate layout ownership separately.

Raw video, chat and saved archive stay local and ignored; hashes/paths are in [media manifest](media-manifest.json). The dedicated video session was detached, public Stop Agent Server was used, and the QA VS Code process exited. Owner Cursor stayed running.
