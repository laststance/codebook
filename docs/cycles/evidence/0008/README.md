# Cycle 0008 evidence — implementation checkpoint

Clean candidate: `f9806fa93df978f8eedf8cf8321f72e534085b3a`; source fingerprint `117d0bbd7fd8c988eb1f4d9a581aae06f4aa912e9ebe56f7cdc037ea1462b73e`. Validation/review is ongoing; this is not cycle closure or final product acceptance.

- [Verification](verification.json), [eight attempts](attempts.json), [provenance](provenance.json), [checksums](SHA256SUMS).
- [VS Code result](native/vscode/result.json), [Cursor result](native/cursor/result.json): actual fixed checkout, 40-second hold, recorded moving frames, four captured-source/value seeks, playback after runtime cleanup, pane recreation and complete editor replacement. New credentials discover the old study and restore paused with zero live runs. Old instance URIs fail explicitly. No learner decision is generated.
- [231 passing tests](tests/all-231.txt): storage/identity/limits/faults/ordering, context availability, playback concurrency, SDK protocol, workspace and shared runtime regressions. These are not native visual proof.
- [28 browser checks](webview-qa/result.json): actual product workspace/controller/renderers, cloned actual recording, simulated native editor API. Initial replay video was inspected but cropped the confirmation transition; final motion and constrained/error-state QA are pending.
- [Investigations](investigations): finite confirmation timing, covered native source, runner reload/error-data assertions and shared local writer ordering. Earlier diagnostic attempts never upgrade to successful acceptance.

Native versions: VS Code 1.138.0 and Cursor 3.21.13 (API 1.128.0); previously measured js-debug 1.117.0 / 1.93.0. Full executable/extension/environment identifiers remain in native result/transcript files. This is a development-host matrix, not a packaged support matrix.

Only local fixture evidence is exported. Credentials, descriptors, raw editor logs and profiles are excluded; paths/endpoints redacted. Source hashes are checked before redaction; PNG bytes remain unchanged. Both original and shared file hashes are recorded. `recording/context.json` is a sanitized explanatory copy; use original hashed context from the local run for byte-identical resource verification. Recording images are unmodified content-hash-named PNGs.

Independent native pixels, implementation review, actual root-agent playback, installed extension, ordinary repositories, generated wiki, both additional display layouts and owner acceptance remain open. Ten final sequential reviews: 0/10, not started.
