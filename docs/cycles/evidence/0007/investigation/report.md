# Native CDP correspondence investigation

Status: DONE for the reproduced native failure. Clean two-host matrix remains pending.
Skill session: `40088-1789779938-e5727d70`.

Symptom: clean `1950281` failed the first VS Code checkout at the browser cart stop with `Timed out waiting for matching generation CDP stop`. The failure manifest confirms owned resources released and no active sessions.

Root cause: raw CDP pause counts are not DAP learner-stop generations. The real trace has two internal browser pause/resume pairs without DAP stopped events, then three identical forwarded events for the first learner stop. js-debug creates one event forwarder for each subscription call; preparation, network and viewport had repeated the same names. Local bundled code and the [upstream proxy implementation](https://github.com/microsoft/vscode-js-debug/blob/main/src/adapter/cdpProxy.ts) confirm additive subscriptions. Context7 was consulted for the extension protocol.

Fix: four source/test files only, under experiments. CDP shares per-event in-flight subscriptions and closes an uncertain subscription connection. Runtime pairs an unclaimed non-instrumentation CDP event at the expected source-map position to the DAP pause, guards that exact event throughout inspection, retains duplicate bindings, and rejects a resume of the current bound pause. The executed JS/map/TS verifier still validates the actual script bytes before snapshot commit; candidate matching is not source proof.

Evidence: two new reproductions failed before repair (red-tests.txt). After repair: 96/96 product, 46/46 shared, 43/43 paired tests. Extra regression covers pending instrumentation, replayed pause binding and rejected shared subscriptions. Existing delayed-old-resume/stale-frame/manual-current-resume checks remain green.

Original native scenario re-run: VS Code checkout normal PASS at `product/vscode/checkout-demo/normal-2026-09-19T01-12-05.249Z-b38af8a7`, on dirty `1950281` containing this repair. Four stops, observed confirmation and saved archive pass through the real host. This establishes the original reproduction is fixed, not final clean matrix coverage or native pixel acceptance.

Related: the pass-2 cross-protocol race repair relied on equal protocol ordinals; this investigation replaces that assumption. Prior selected-child/source-map learning remains preserved. No new full-diff review or fourth review pass is claimed.
