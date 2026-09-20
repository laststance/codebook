# Recording tool discovery investigation

Scope: Cycle 0008, four files under `extension/src`; scope lock removed after the focused fix. This is additional evidence after the non-converged implementation review, not a fresh independent review.

**Symptom:** The actual driving agent connected to a new VS Code instance and discovered `codebook_playback` with `{ "type": "object", "properties": {} }`. It stopped before supplying arguments from private implementation knowledge. No new application run or playback mutation occurred. The failed attempt remains in the original native suite's `agent-replay` directory.

**Root cause:** Pinned MCP SDK 1.30.0 `server/mcp.js:79` calls `normalizeObjectSchema` during `tools/list` and substitutes `EMPTY_OBJECT_JSON_SCHEMA` for a top-level discriminated union. Its call path at line 175 still parses that union, so all previous hard-coded native calls succeeded while agent discovery was incomplete. Context7's v1.x official tool-registration example uses object-shaped fields; installed pinned source establishes this exact behavior. Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md .

**Fix:** Keep the discriminated command contract for execution; publish a strict object-shaped boundary containing all five fields and a description that `positionMs` is required only for `seek`. Apply the original union's conditional validation before dispatch, and keep the strongly narrowed command inside the handler. The small external client now preserves the SDK's pre-handler textual validation error when no domain structured outcome exists, instead of masking it with a secondary undefined-object parsing error. No SDK upgrade or generic arbitrary-command API was added.

**Red evidence:** `<owned-profile>.log` shows `actual: []`, expected `action, expectedRevision, instanceId, positionMs, studyId`. New actual-SDK coverage asserts published required fields, rejects a missing seek position and a position on Open, and verifies unchanged controller revision/no runtime creation. Its initial assertion also exposed the client error-mask, repaired at the same boundary.

**Validation:** `agents discover playback arguments and invalid seek shapes dispatch no controls` in `recordingProtocol.test.ts`; whole suite 238/238, zero failed/skipped/cancelled, `<owned-profile>.log`. Source checkpoint `1740e34`; fresh actual VS Code discovery now publishes all five arguments. The driving agent then performed 22 public MCP operations: discovered saved context/frames, sought order/confirmation/cart, played and paused, and recovered a rejected stale revision, without application mutation or live runs. Native cleanup reports zero sessions and restored breakpoints. Evidence: `product/vscode/checkout-demo/recording-2026-09-19T07-44-07.121Z-b5e77017/agent-replay-2026-09-19T07-45-33.055Z/agent-transcript.json`, `agent-finished.json` and `bootstrap-1.json`. Two intermediate compile errors involved SDK/Zod's loose result/issue types; the final code narrows values without type assertions.

**Status: DONE.** Root cause, focused fix, red/green regression, all 238 tests and a fresh reproduction of the original actual-host discovery are complete. Cursor regression remains part of cycle validation. No full-product or independent review pass follows.

## Debug report

- Symptom: actual MCP discovery hid all playback arguments.
- Root cause: the pinned SDK discovery accepts object schemas, while its invocation path also accepts unions.
- Fix: object-shaped discovery plus conditional domain validation; preserve pre-handler SDK errors in the client.
- Evidence: 238/238 tests; actual VS Code five-field discovery and 22-operation root-agent replay with zero application mutation.
- Regression: `extension/src/tests/recordingProtocol.test.ts`, `agents discover playback arguments and invalid seek shapes dispatch no controls`.
- Related: earlier native calls hard-coded arguments and therefore did not establish discoverability; previous implementation review is explicitly non-converged.
- Status: DONE for this defect; product acceptance remains separate.
