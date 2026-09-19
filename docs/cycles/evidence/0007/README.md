# Cycle 0007 evidence — connected checkout

Implementation: `8be09135bd2df56f54cdd5895af30ec0d8769da8` (clean). Source fingerprint: `20ff1ec5d3cf1c29f46488483649e5d1bb860ea316d98ee47ff73fc583aa43ea`. Both final native matrices use these bytes. Earlier stage results remain historical and are listed in [attempts](attempts.json).

**Mechanism demonstrated; native presentation reliability remains inconclusive.** Fixed local checkout only, no real payment. No complete-product, real-repository, installation or independent native-pixel claim.

| Evidence | VS Code | Cursor |
| --- | --- | --- |
| Product-native checkout normal/history + paired normal | 3/3 expected outcomes | 3/3 expected outcomes |
| Checkout runtime normal/40-second hold/continue race/capture timeout/late request | 5/5 expected outcomes | 5/5 expected outcomes |
| Actual driving-agent checkout | Runtime demonstrated; 3 missing render ACKs; study partial | Demonstrated, seven phase images |
| Agent operations / explanations / continues | 36 / 4 / 4 | 36 / 4 / 4 |
| Order hold / status read | 40005.72 / 3.49 ms | 40005.37 / 3.68 ms |

Normal runs prove four actual TS stops (server 23, client 29, server 38, client 54), eleven declared links, seven phase images, total 24, one cart handler and one checkout handler. History deliberately hides a phase; its partial result passes the negative expectation. Native restart reads archived observations without launching the app/debugger. Unrelated dirty drafts survive owned workspace closure. All final native/agent runtimes and owned editor processes exit.

- [Verification](verification.json), [provenance](provenance.json), [SHA256SUMS](SHA256SUMS). Exported bytes are path/endpoint-redacted; original and shared hashes are distinct. Credentials, descriptors, profiles and raw editor logs are excluded. PNG bytes are unchanged. Source text/hash consistency is checked before redaction.
- [VS Code agent](agent/vscode/agent-result.json), [Cursor agent](agent/cursor/agent-result.json): root agent chose each operation from public discovery/manifest/state and read captured source/values before explaining. This is the knowledgeable implementing agent, not a fresh blind or final reviewer. [Cursor bootstrap timeout](agent/cursor-bootstrap-timeout/harness-failure.json) records a preceding abandoned run; a fresh bootstrap removed the pre-action delay without changing product timeouts.
- [CDP investigation](investigation/report.md): hidden startup stops and repeated subscription forwarding invalidated raw ordinal matching. Two pre-fix regressions fail; shared event subscriptions and explicit source-matched pause binding repair the original native failure.
- [Renderer investigation](renderer-investigation/report.md): the actual VS Code agent run misses three image render acknowledgements. A 25-second-per-stop instrumented diagnostic does not reproduce the failure. Root cause remains unknown; compiled instrumentation was [restored](renderer-investigation/restored.json) and the diagnostic is excluded from clean acceptance. No timeout relaxation or fabricated ACK.
- Tests: [96 product](tests/product-96.txt), [46 shared](tests/shared-46.txt), [43 paired](tests/paired-43.txt). Implementation review fixed 14 confirmed findings across three fixing passes and ended **not converged**, with reused reviewer contexts and no outside-provider result. Post-review CDP fixes have focused regression/native evidence, not a fourth whole-diff review.
- [Webview QA](webview-qa/report.md): 53 checks/five layouts, plus 14 outcome regression checks. Recorded interaction and inspected frames validate compiled renderer behavior through a deterministic host adapter. They do not establish native editor composition or G04 product recording.

Host versions: VS Code 1.138.0 / js-debug 1.117.0; Cursor 3.21.12 / extension API 1.128.0 / js-debug 1.93.0; Chrome 153.0.8010.50; extension-host Node 24.18.1 / Electron 42.10.0; runner Node 24.21.0; macOS arm64. This environment is a development-host matrix, not a packaged support matrix.

Remaining: intermittent presentation ACKs, independent native pixels, ordinary repository support, synchronized recording/replay, generated wiki, both additional modes, packaging and intended-use acceptance. Final independent reviews remain **0/10, not started**. Next selected capability: bounded synchronized recording/replay of this established checkout.
