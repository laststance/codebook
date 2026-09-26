# Cycle 0026 — Copilot image handoff comparison, 2026-09-26

This is a development comparison for [Cycle 0026](../../0026-copilot-image-handoff.md). It verifies a public client configuration that carries the same PNG pixels through ordinary Copilot Chat. It is not final G01/G04/G12 acceptance or a final reviewer pass.

## Frozen inputs and scope

- VS Code 1.139.1 (`04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`, macOS arm64), bundled GitHub Copilot 0.67.0. Both chats used Auto and routed to **GPT-6 Luna**. The owner allowed a roughly ten-minute shared-screen trial; native operations ran from 09:45 to 09:53 JST, then the sole trial VS Code process exited. Cursor was not operated.
- Same clean 35-entry Codebook VSIX: `artifacts/cycle-0022/ci-head-abf6af8/codebook.vsix`, SHA-256 `af0242d06f61760bff3852e4b81ade7b009670303eba41f1bcf3abba124abb15`. Build revision `b8d1e5928246e6aa781591de104c8563a36238b6`, selected-source hash `bf9c8243cab1fa5562777281664ef0cbc6998e9af45b32125e9b39e4e809159e`, `dirty:false`. The same bundled skill 1.0.17 hash is `073e5a484ef6dd68fd64155a7428289fa80dfc9d260897d2e3d0a54e03518bc7`; installed `dist/extension.js` hash is `d5ce36ce48607263287076cc2af13c572072b6c887e3090497d6b984fb9a0749`.
- Package provenance: the local folder label `ci-head-abf6af8` identifies the PR head that triggered [Cycle 0022 CI run 36187025973](https://github.com/laststance/codebook/actions/runs/36187025973), whose `head_sha` is `abf6af8b50b889e0bce81fcb2a9d81d8d255bfa4`. The downloaded artifact ID is `10887421327`, named `codebook-vsix-b8d1e5928246e6aa781591de104c8563a36238b6`. GitHub's pull-request checkout built its merge ref: `b8d1e592…` has parents `7113819260106bddfdc6c0c6acb1c9642807b920` and `abf6af8…`. Both the retained verification receipt and the installed `dist/build.json` report that merge revision and the same selected-source hash. The folder label is not a claim that the archive was built directly at the PR head.
- Isolated extension directory `/tmp/cb26vscodeext`; dedicated workspace `/Users/ryotamurakami/laststance/.codebook-trials/cb26-copilot-image`. Initially it contained only the trial workspace setting and an ignored question-copy file. Product source was unchanged during both runs.
- Same natural question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`. Both native slash completions added an extra separator space after `/codebook`; the Japanese question words were unchanged. No profile ID, stop location, expected values or per-stop advice was supplied to either chat.
- Existing owner zoom level 2 and editor font size 15 were retained. Native screenshots were 2880×1800 with a dark appearance. The requested owner theme was Carbonfox; the loaded theme identity in the isolated extension directory was not independently verified. This is not a theme/readability matrix. The separate Playwright CLI renderer films are 800×600 with padding.

## A — Default uploaded-image route

The trial workspace explicitly set `github.copilot.chat.imageUpload.enabled` to `true`, matching the installed public default. File hash: `4ea07499ee3bd23542866b9b872f48be78d2b6046ac342d0b5df6e40f411c98f`. Public **Codebook: Set Up AI Chat** reported ready; ordinary Copilot Chat selected `/codebook` and sent the question at 09:46 JST.

The AI called its own `codebook_status` for instance `ed639b68-7ad2-4b24-bf9d-367375afeed8`, discovered the local checkout profile and started run `dfc9cc4d-7f59-498d-a93e-2c1a8df31deb` (runtime `ec2bb850-d389-4450-8f7d-2eca8eece196`). It read the manifest and before image. Immediately after that image tool result, Copilot reported `400 invalid_request_body`, `Error while downloading file. Upstream status code: 404.` The native chat displayed the image thumbnail, and the Copilot extension log records the same CAPI error through 09:48:05 JST. The chat ended after 1m18s on GPT-6 Luna (1.1 displayed credits).

No application action or continuation was called. Public Stop Agent Server retired the run and descriptor. Its final saved Study is terminal `not-demonstrated`, with zero observations, one captured before image and 11 unknown links; archive SHA-256 `5a4c3c60483190d9a9211482fccfc22e4b5ed14f86cf031d2ca02a5e394aeefb`. Its complete three-frame film ends at 68.57 s and remains only a recording of the failed attempt. Seal SHA-256 `b8547f41f62be5e6047a69e0af03d0373a2d866d74792b5ddcdf38f699a06865`; journal hash `72938c86be3fcd5af30112ae839b4441ab52783b3ec26f25e9e75797a9d9f979`.

## B — Public inline-image setting

After A stopped, only the dedicated workspace's image setting changed to `false`; its file hash became `b22406288e7401467cf4ea3b588b71f00640c45138f4713f020b16bea5006acc`. No owner setting, Codebook runtime/skill bytes or model selection changed. Public setup created a fresh connection, and a fresh standard Copilot Chat Editor submitted the same question at 09:50 JST. The first trial had used the Chat side view; the second used an editor tab. Both are standard Copilot surfaces. The AI also used its normal memory-reading tool; the driver supplied no memory or answer key.

The different visual surfaces share the same request/image path in this exact VS Code version. At installed commit `04c0d99f…`, [ChatEditor constructs ChatWidget with ChatAgentLocation.Chat](https://github.com/microsoft/vscode/blob/04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1/src/vs/workbench/contrib/chat/browser/widgetHosts/editor/chatEditor.ts#L113), and [ChatViewPane passes the same location](https://github.com/microsoft/vscode/blob/04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1/src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts#L1051). The [location enum](https://github.com/microsoft/vscode/blob/04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1/src/vs/workbench/contrib/chat/common/constants.ts#L272) explicitly covers sidebar, chat editor and quick chat under `panel`. Both actual A/B session records persist `initialLocation: panel`. The identical installed Copilot bundle's shared tool-result `onImage` upload branch depends on the public setting and model endpoint, not the visual container; both A/B requests used GPT-6 Luna. These source and session checks address the surface difference without pretending the windows were identical. They do not establish the lifecycle of the provider's opaque image URL.

The AI called status for instance `09a0791f-0b0f-460e-9eb5-8c5612c4fbc9`, started run `7015a6eb-9fea-4779-964d-1955ed3741d1` (runtime `8b215c22-0105-4d7e-be2c-068f6a8017d6`), read the manifest and all seven phase images, sent Add to cart and Checkout once each, and continued four actual stops. The tool history contains 1 status, 1 start, 19 resource reads, 2 actions and 4 continuations. No image 400/404 interrupted this chat. It completed after 1m43s on GPT-6 Luna (2.4 displayed credits).

The response described actual image details after each read: Cart 0 and pending requests before display update, Cart 1 and one completed cart click afterward, then the order progress and selected purchase confirmation. This establishes image use beyond the mere presence of a thumbnail. The final answer separated the local demonstration from untested real payment, delivery and inventory services.

| Observed stop | Bound source | Captured values |
| --- | --- | --- |
| Cart mutation | `server.mts:23` | selected cart, `tote-01`, price 24, cart count 0, admitted count 2 |
| Cart update | `client.mts:29` | same selected cart/product, cart count 1, admitted count 2 |
| Order creation | `server.mts:38` | selected parent cart operation, total 24, order count 0 |
| Purchase confirmation | `client.mts:54` | matching selected order, total 24, order count 1 |

The final saved Study is terminal `demonstrated`, with four observations, all seven captures and all 11 required causal links `observed`. After final public Stop, its stable archive hash is `5f0f2785e1d6407d1497b07ef9c20d39de44b8db6ad0d1ec2077ca943d6a4a11`; an earlier pre-Stop checkpoint had a different material hash and is not the final archive identity.

## Image boundary and cause

The persisted Copilot tool data from both chats contains the identical before PNG: **32,297 bytes, SHA-256 `6c5b6a018294b39aed6c3b77b4f28f3a376268aaab8c287593e6b6fa25221b44`**. The successful inline chat also retained all six later PNG results, including the same cart-pause image that failed in Cycle 0025 (`dfee369e…`). Codebook delivered valid equal bytes to Copilot in both arms.

The exact installed Copilot bundle declares the public setting and gates the upload token on it. With uploads enabled, its MCP image renderer replaces the data URI with the upload service's returned URL; with the setting disabled, it retains inline image data. The current default control failed at the provider's URL fetch, while the immediately subsequent inline control read the same image and continued. This supports the **uploaded-image URL handoff** as the failing compatibility boundary and verifies the inline setting as a bounded workaround. The provider's opaque file URL lifecycle was not inspected, and no reverse-order control was run. The result does not claim a repair to that external service or universal compatibility across Copilot versions.

## C — Follow-up editor-tab attempt, excluded from image comparison

After hosted review flagged the different surfaces, the owner-authorized additional trial reopened the same isolated installation/workspace, set image upload to `true` and used a fresh standard Chat Editor with the unchanged question. At 10:32 JST, Auto selected **GPT-5.6 Luna**, a different model from A/B. After transient reader/presentation refusals, the AI re-read state, found current-run following true and independently completed checkout in 1m28s (5.6 displayed credits).

Its actual tool transcript contains two status calls, one return-current, one presentation request, one start, 12 resource reads, two actions, four continuations and one stop. Every resource read targets JSON run/snapshot/help data; **zero image URIs were read**, and there are zero explanation saves. Therefore its lack of an image 404 neither verifies the upload path nor establishes a reversal of B. It is excluded from the image comparison; no second execution was attempted without a new hypothesis.

The retained terminal archive is `demonstrated`, with four observations, seven captures, all 11 links observed and four empty interpretation arrays. Instance `f8656787-85b3-4026-a115-856fc4b87391`, run `6c190714-d913-44a6-96b7-6adeb3c9d1a6`, runtime `a99b8c34-e144-457d-acbc-315ce1cc8efe`; archive SHA-256 `e96ef3a92ce65086d31882e1b1300a02248cefb5c7b2e2fc2eb3872ff782f126`. Its complete recording has 33 frames over 32.001 seconds, seal `b8088fa8edd84611ef39808f2f0d2ff1e07c8635ea84ec742f7fc31ef3e42f74`, journal `a97303d578509863fa2eb7d32cff91a5e401b2baeff702645a671bdcd59e1485`. No native replay or image-model result is claimed for C. Public Stop Agent Server retired the descriptor, the sole trial VS Code exited, owner hashes remained unchanged, and the disposable workspace setting returned to `false`. Cursor was not operated.

## B's saved replay, motion and remaining explanation gap

After the app/debugger had exited, public **Codebook: Open Study Workspace** showed the demonstrated history, the exact captured source and values, 11 observed links and `0 of 4 understood`. Recording opened as finalized; native seek to the end reported **57.00 s presented / 57.00 s**, and focused Read application visibly displayed the selected order, `Total $24`, Cart 1, one completed cart click and one completed checkout without reexecution.

The finalized application recording has 32 frames, end 57.003 s, seal SHA-256 `c21e1eedd383a3160a1915ba616307c486c1bc41d5f28ab7465844ebf989a6ab`, journal hash `c82740f1979c529187654774a79bdaaec678599aa119b066c4513d831fd67797`. Frames at 55.46, 55.87, 56.32 and 56.55 s were inspected: the confirmation is absent, fades in, becomes opaque and then reaches confirmed status with checkout count 1. These application pixels are separate from the editor-renderer films below.

The AI called `codebook_explain` **zero times**, and all four archived interpretation arrays are empty. Native Live and Recording explicitly show no saved explanation. Both chats also noted that the checkout profile's public help URI was absent from status; the registered `codebook://help/studies` resource contains the per-pause save instruction, but tool-only discovery returned only repository help URIs. The image setting does not solve this guidance/discovery gap. Complete synchronized recorded explanation and final acceptance remain open.

## Artifacts and cleanup

| Artifact | Size / duration | SHA-256 / inspection |
| --- | --- | --- |
| `artifacts/cycle-0026/native/default-image-route.webm` | 4,077,697 bytes / 178.48 s | `23aa096faa9c7744ef8205cac647651157b60594decb0b8ef49fb926ab8e4dd4`; inspected 30, 100, 170 s |
| `artifacts/cycle-0026/native/inline-image-route.webm` | 5,807,346 bytes / 205.96 s | `ee79746bbf28efcab2f6403475baf895903e2d7bdb60ca59c0793934e446e2f1`; inspected 30, 70, 100, 150, 195 s |
| `artifacts/cycle-0026/native/editor-default-reversal.webm` | 7,354,866 bytes / 353.64 s | `3a0b7dcb7a483fc75c6b8a5c4d7ae95957bf25767c21d589a7f171fce558fa4c`; inspected 30, 100, 300 s; C is excluded from image comparison |

All three public server stops removed their descriptors. Playwright recordings stopped and detached; the native Window menu listed only the dedicated trial window before each Code quit. Its main process and trial recording processes exited. Owner VS Code settings remained SHA-256 `917b41debe19b6607751f1ff433554fc9d4bd151da702e6838e7b5e2d72cc8bf`; its default Codebook extension remained `f3d78122aed0b4e7ec193fa42429a1e82ddbf8b4f27bd1f83242de23e05e93b4`. The inline setting remains only in the named disposable trial workspace. No Cursor window, setting, skill or extension was touched in this cycle.

The comparison verifies the documented configuration against the unchanged installed candidate. The subsequent README addition changes package documentation, not runtime or skill bytes; it is not a claim that a newly built archive was separately installed. Final reviewer count remains **0/10**.
