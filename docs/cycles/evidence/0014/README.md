# Cycle 0014 evidence

Shared Study workspace, Living book and Guided walkthrough controls are demonstrated in the supported development hosts. This is a bounded increment, not packaged or full-product acceptance. Issue #15 remains open until its delivery PR merges; Issue #1 and the final ten-review gate remain open.

- [Native execution, replay, focus and appearance](native-validation-20260921.md)
- [Implementation, CodeRabbit and OCR review](implementation-review-20260921.md)
- [Design review and its limitations](design-review-20260921.md)
- [Sanitized machine-readable manifest](manifest.json)
- [Exact earlier source inventory](source-cut.json)
- [Ship repairs, executable SDK and carried acceptance obligations](ship-verification-20260921.md)
- [Ship source inventory](ship-source-cut.json) and [supplemental artifact manifest](ship-manifest.json)

The implementation base is `1e8075002639ef4c5250d375cba2f3932954d3a1`. The integration base is remote main `684017857a1d7965249161250f96c2cb4725b782`, so the first PR also integrates Cycles 0008–0013. Final local candidate is `fc3d1b5b065e78627a1268a8828e4633275d4a2c` plus the recorded repairs, with source inventory fingerprint `c522c385f5f22a646a254b2802d11422e6749ed747bc817e1c9b1260fc491855`. The inventory includes the new launcher regression; it does not include these documentation-only records.

The earlier native candidate passes **505/505** extension tests and **39/39** Cycle 0010 tests. The later ship candidate adds three launcher regressions and passes a fresh combined **647/647** (508 extension, 55 shared, 45 paired, 39 experiment), zero failed/skipped/cancelled. Its source fingerprint is `55ce23cfb156a0491976a3a1b295912de7ef41031c73ffc0b20674ff380eafee`. Compiled webview QA remains **118/118** assertions across 24 cells on unchanged renderer bytes. The executable SDK example passes five selections and stale-revision recovery per host, with Cursor's initial foreign-focus failure and explicit recovery retained separately.

Private recordings, MCP transcripts, native logs and QA profiles remain under ignored `artifacts/cycle-0014/` and `~/.cbqa/` on the owner's current machine. The manifest contains artifact paths, byte counts and SHA-256 hashes without credentials or raw recordings. These are available local evidence, not remotely downloadable attachments; move them to another approved durable store and update this record before discarding this workspace. A missing artifact invalidates the claim that depends on it.

Standalone implementation review reached three fixing passes and remains **non-converged**. A fresh ship review repaired a native launcher cleanup issue and independently verified the bounded repair. The final CodeRabbit CLI supplement completed on 30 files with zero findings; it does not certify complete integration semantics or the later documentation supplement. Outside Claude Code coverage remains unavailable. One modeled Wiki source-open ordering race and the listed carried plan obligations remain active work. The final sequential product reviews have not started: **0/10**.
