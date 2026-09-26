# Cycle 0028 — First installed VS Code entry attempt

Date: 2026-09-26. Development validation only; no D029 Stage 1 or Stage 2 credit.

## Frozen identity

- Source: `3072cf7459ebd7acb05e6d3d6628e3db1cad79a5`.
- Extension: 0.2.5; bundled skill: 1.0.19.
- VSIX SHA-256: `a9fb8ca8b533eefd8af25de4ee7d52e55b5faf811deca1b6cf6cc7cce2890cee`.
- Host: VS Code 1.139.1, ordinary Copilot Chat Auto (reported GPT 6 Luna), Carbonfox, retained owner zoom 2 and editor font size 15.
- Separate QA extension directory and fresh checkout trial workspace; owner Cursor remained running.
- Question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

## Result: bounded outcome FAIL

The AI read the installed skill, selected Study before execution, encountered a presentation grid-proportion timeout, and used public Restore to obtain confirmed layout before starting. No driver Open Study or execution MCP calls rescued the chat. It performed two application actions, four pauses, four saved explanations and four continuations.

However, the Study tab remained Overview throughout execution. Following the current run did not imply Live content. Runtime values and saved explanations were therefore not presented at each pause. At the retained zoom, the debug sidebar/console also left the application pane largely reduced to its header. Automatic opening and archive correctness do not demonstrate a usable connected three-pane experience. Cursor was not tested on this failed candidate.

The saved archive contains seven captures, eleven observed links and four interpretations whose source hashes and captured facts match. The application recording sealed 33 frames over 77.197 seconds. Learner understanding remained 0/4. These are bounded checkout development results, not required-project acceptance.

After chat completion, ordinary learner controls selected the saved confirmation and Read Application displayed purchase confirmation. Read Explanation displayed the retained interpretation and captured values without the original error modal. These post-run actions do not repair the missing live context retrospectively.

## Recording and limitations

The local manifest records the 296.040-second Playwright renderer video and six inspected frames at 100, 110, 120, 145, 190 and 275 seconds. The output is 800 by 600, while native CUA observations used a 2880 by 1800 screen; it is not a full-desktop native recording. Inspected frames show opening, timeout, restoration, pauses and post-run reading. Full transition quality and the constrained reading layout are not accepted from this sample. Console diagnostics remain unclassified.

The initial recording attachment failed because the spaced remote-debugging-port argument did not expose a listener. A normal restart with the equals form corrected the recording setup. A separate input attempt sent only the slash command when Japanese typing failed; it was cancelled before execution and is excluded. The corrected full question was visually verified before submission. These driver failures remain in local logs.

Public Stop Agent Server and normal editor quit completed cleanup. The six recorded owner baseline hashes are unchanged; owner Cursor remained running. Raw chat, archives and recordings stay ignored locally; see [media manifest](media-manifest.json).

## Evidence-backed next step

Require both `followingCurrentRun: true` and `contentTab: live` before a new run, using the existing public Return Current operation when either is absent. Candidate 0.2.6 / common skill 1.0.20 implements that guidance and checks it through the actual MCP transport. Repeat installed validation on a newly frozen candidate; assess the observed reading-space limitation separately rather than inferring visibility from state flags.
