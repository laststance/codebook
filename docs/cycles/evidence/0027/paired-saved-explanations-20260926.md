# Cycle 0027 paired ordinary-chat saved explanations

Date: 2026-09-26. Development evidence, **not final acceptance**. See the [preregistered cycle](../../0027-saved-pause-explanations.md).

## Frozen input

- Question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`
- Clean source: `ec6c2b0fb62dda4a9746e3f95874be11ccb43c37`; extension 0.2.4, API 1.5.
- VSIX: `artifacts/cycle-0027/codebook-0.2.4.vsix`, 917,479 bytes; SHA-256 `d2caccd1acda4b43a32105aa9cb9bcb46e06ab1058a743971d57119fc97405b4`.
- Selected-source hash: `bda25b2fa08ad9653384394db54998df53dfc53b46f3fefc92dedce61f0d10f3`.
- Shared skill 1.0.18: SHA-256 `d5dcc162207fae5215ab13cbbac968df1c99e77f374b40faf459391ca9b1310f`.
- Later README correction is not part of these installed bytes. Preserve this archive; subsequent package correspondence does not create a new native run.

## Separate host results

| Check | Cursor | VS Code |
| --- | --- | --- |
| Host | 3.22.8, named Cycle 0027 profile | 1.139.1, isolated extension directory |
| Ordinary chat | Agent, Grok 4.7 High Fast | Copilot 0.67.0, Auto resolved to GPT-6 Luna |
| Workspace | `cb27-cursor` | `cb27-vscode` |
| Setup and identity | Public setup, connected catalog, native skill editor exact bundled bytes, explicit slash invocation | Public setup, explicit slash invocation, persisted actual context exact installed skill body |
| Image route | Seven image reads in expanded native tool history | Seven decoded PNG payloads in actual model tool results; all hashes match retained recording PNGs |
| AI work | Two actions, four explanation saves and committed receipts, four continuations | Two actions, four explanation saves, four continuations; final recording/context reads |
| Saved result | Four observations, one interpretation each; source/facts match | Four observations, one interpretation each; source/facts match |
| Completion | Seven captures, eleven observed links, terminal demonstrated | Seven captures, eleven observed links, terminal demonstrated |
| Stopped-app native replay | Explanation, captured source, values and selected confirmation | Explanation, captured source, values and selected confirmation |
| Learner progress | 0/4, unchanged | 0/4, unchanged |
| Recording | Complete, 33 frames, 144.972 s | Complete, 32 frames, 104.383 s |
| Editor-screen motion | Not recorded; static native observations only | 316.680 s renderer video, recorded with Playwright CLI; interactions driven with CUA |

VS Code used the documented workspace-only `github.copilot.chat.imageUpload.enabled=false` setting. Copilot prepends `Prompt instructions file:\n-\n\n` to the loaded skill attachment and omits YAML frontmatter; stripping only that known wrapper yields exact packaged body equality. Full-file version/hash is independently checked against the installed artifact. No per-stop follow-up, driver MCP execution or answer-key content was supplied to either AI.

Both ordinary runs displayed Application/source/debug views; Study was opened manually for post-run replay inspection. Automatic default Study presentation is **not verified** and is the next bounded G07 candidate. Both native Read Explanation actions avoided the previously reported modal error. This does not update or revalidate the owner's untouched older default installation.

## Retained data and identity

All following artifact paths are relative to the repository; exact private storage paths are inside the ignored JSON checks. Recording contents and chat data are not committed.

| Evidence | Cursor | VS Code |
| --- | --- | --- |
| Archive check | `artifacts/cycle-0027/cursor-archive-check.json` | `artifacts/cycle-0027/vscode-archive-check.json` |
| Archive SHA-256 | `47bcfb2b0c13eef2f449fd83b5097fd81b7b8a6ff038674af065f16dcc613587` | `7a92dc5c99d4ede89b5ad899918006aa297a9bbdfd42ce487cb8867e134a4822` |
| Journal SHA-256 | `612f8d2c83bc7943d4a52f9b3267e020fa503ea7bc277ce8f119218982d718ea` | `e2bf558c0fcccf52a233d57b64fc1132b261280013d408f6880a06cbc7500079` |
| Instance | `dfe55f39-d409-4908-963e-a74e6168fd83` | `9d8ed1cf-6a00-4b1f-9f51-26250d33238e` |
| Run | `fdf790a2-4131-468d-b13d-141316249a07` | `0e0a23dd-d67d-41bf-b69a-0e06f80beaed` |
| Runtime | `7016626a-2d4f-4222-9aa5-24eb8be629cb` | `8db09c33-b335-44d0-bcd6-e7633880564d` |

VS Code actual-context/tool proof: `artifacts/cycle-0027/vscode-chat-proof.json`. Its retained recording context SHA-256 is `71d3c2f11082acdec241199ab24e7208860260de977fb51c897f64646b1a0e16`, with interpretation counts `[1,1,1,1]`. The AI read the returned `/recording/context/dbdfac2f17658c3750dd2717b6e1ef74696b2dbabfa3e4c6765d17b12e40c4cd` resource after completion; it is not inferred from a final chat claim.

## Motion and console observations

[Media manifest](media-manifest.json) lists private media paths, sizes and hashes. The application films convert original recorded frames with their relative durations; they begin at the first received frame (about 1.29 s), omitting the preceding blank interval. VS Code's 720×447 source is padded by one bottom pixel for H.264. These conversions are application-frame evidence, not editor-screen capture.

- Cursor application movie: inspected 142.1, 142.6, 142.9 and 143.3 s. Confirmation absent → translucent → near-opaque → complete. The existing `cursor-confirmation-before.png` filename corresponds to early entry, not absence; `pretransition` is absence.
- VS Code application movie: inspected 101.0, 101.5, 101.8 and 102.8 s. Confirmation absent → translucent → near-opaque → complete with selected order, total $24 and checkout count 1.
- VS Code renderer movie: inspected 90/150 s live pauses, 290 s retained explanation/value reading and 310 s recorded final application/cleanup command. Recording covers real installed editor content; no additional claim about uncaptured macOS chrome.
- The renderer console contains 13 pre-capture errors: Copilot managed-settings/MCP-registry 404s, duplicated remote embedding-cache fetch/status errors and duplicated Node `url.parse()` deprecation reporting. Seven later warnings concern iframe sandbox and unrecognized `local-network-access`. No captured Codebook execution error; do not call this an error-free console.

## Cleanup and limits

Cursor's dedicated trial window closed; the original Cursor PID/window remained. The receipt-protected existing deployment helper restored the original 1.0.10 shared skill. VS Code's public Stop Agent Server completed and its dedicated process exited. `artifacts/cycle-0027/owner-after-both.json` verifies all six baseline hashes: owner settings, default installed extension code, shared Cursor skill and MCP configuration. Neither owner default extension was upgraded. QA workspaces, profiles, receipts and recordings remain private and available locally.

The first same-version Cursor identity preflight failed before any question/runtime; retain it as a failed preflight rather than a product run. The distinct-version changed hypothesis selected the expected package. These paired passes establish the bounded explanation-save/replay behavior only. Integrated three modes, connected learning, real-repository intended uses, complete G12 restart/conflict behavior, owner acceptance and final frozen reviewers remain open; final reviewers **0/10**.
