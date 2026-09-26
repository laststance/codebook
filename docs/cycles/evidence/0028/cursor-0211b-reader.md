# Cycle 0028 — Installed Cursor 0.2.11 ordinary-chat trial

Date: 2026-09-26. Development trial only; **no D029 Stage 1/2 credit**. Result: **PASS for the recovered checkout reading path; ordinary entry remains qualified by native focus and pane-layout failures**.

## Candidate and route

- Clean source `a58d68fd690751906cc513d7ddf638b45257e11e`; extension 0.2.11; bundled skill 1.0.20. The checked 918361-byte VSIX SHA-256 is `2ca23ab41d26c242769f1a62a129ac4af5184666ab6a3b553c1d4505682c6c95`, identical to the successful VS Code retest.
- Cursor 3.22.9 in a signed-in isolated user-data and extension profile, IDE window on the `cb211-cursor` fixture workspace. The public setup command installed the common skill; Customize showed its discovery and a connected Codebook MCP with 15 tools and four resources. This was a normal installed-extension Agent chat, with a recorded IDE renderer video.
- The exact question was inspected in the composer before sending: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。` A second identical user message appeared later in the same chat; its cause was not established. This is not a clean single-prompt trial.

## Failure, recovery and observed result

An old native setup warning about the globally shared `codebook` skill was displayed before the successful run and was dismissed. Cursor Agent initially received a public `PRESENTATION_UNAVAILABLE` response when the editor was not focused. During recovery, the native group arrangement also reported `Native editor groups changed during pane creation`. The AI used public status/presentation and layout operations, opened an editor anchor and recovered the Study layout **before application input**. These failures and the extra identical chat message qualify the ordinary-entry outcome; neither is erased by later success. The driver dismissed the native warning and kept the intended IDE window focused, but did not open Study, act in the application, or save explanations for the AI.

After recovery, Cursor Agent opened Application, captured source and Study together. It clicked Add to cart and Checkout in the local fixture, inspected four distinct pauses, saved four Japanese explanations grounded in source and captured values, and stopped. The resulting Study was `demonstrated`, with purchase confirmation, all eleven observed runtime links, four saved moments, 0/4 learner understanding and `Recording saved.` The visible value progression included `cartCount=0` before cart input, `cartCount=1` afterward, and the final local total of $24 with one checkout. No real payment occurred.

The inspected IDE video frame at 420 seconds retains the pane-creation failure, rather than treating recovery as seamless. At 580 seconds, Application/cart, captured source, saved interpretation and first captured-value rows are visible together. At 700 seconds, historical purchase confirmation, source, saved interpretation and values remain together. This supports the narrow **post-recovery** Cursor reading outcome on 0.2.11. The Debug sidebar was open and narrow panes still required horizontal reading; this does not prove a clean constrained-layout or transition-motion pass.

The ignored 741.44-second IDE video is `artifacts/cycle-0028/native/cursor-0211b-agent-1.webm` (23,917,048 bytes, SHA-256 `9244890b11578c7b5334b62d2e9062fde04abcef1ed479993e248a8ecadf7e5f`). Its inspected 420, 580 and 700-second frames are bound in [media-manifest.json](media-manifest.json). The separate failed setup recordings are retained as private development artifacts, not counted as a pass.

## Owner state and next gate

Public `Remove Managed Cursor Skill` removed the trial-managed global skill. The owner's pre-existing skill directory was restored from ignored private storage, with original SKILL.md SHA-256 `4ba173b890b94bbc31cb7e603925c8a5ab79cdb9c991fc02e45d6a692d4d7d0f`. The owner's receipt SHA-256 `27f4936e0710f1cc6ac96faa21c8e7a1a9078737e86c2cfb5d271a09a0207799` and MCP config SHA-256 `70f76bb304f862fb1fc26f69fc9ee43134107b2d41797994a74ddd0853e0de4d` remained unchanged. The default extension registry retains its original Codebook 0.2.3 entry and 51 other entries. Only the isolated Cursor process was stopped; the signed-in test profile remains private for later use.

Investigate the initial focus refusal and pane-creation race using this distinct failure evidence, then repeat an ordinary Cursor entry on any corrected candidate. Keep the fixture outcome outside D029's nine real-project assessments. Current-head review, CI and Cycle 0028 delivery remain pending.
