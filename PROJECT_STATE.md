# Current project state

Updated: 2026-09-19\
Product stage: runtime mechanisms and extension-owned MCP demonstrated on fixed fixtures; learner UI not yet implemented\
Active cycle: [0006 — Study workspace](docs/cycles/0006-study-workspace.md) — planning\
Last cycle: [0005 — Live study through MCP](docs/cycles/0005-live-study-mcp.md) — closed, demonstrated on the declared demo\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open\
Active cycle issue: [#7](https://github.com/laststance/codebook/issues/7) — open\
Last cycle issue: [#6](https://github.com/laststance/codebook/issues/6) — closed with remote evidence `9ce3ddc`\
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main\
Authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 3

## Verified facts

- Architecture B and Study workspace remain approved; Living book and Guided walkthrough remain required. Learning items, evidence, recording correspondence and personal progress share one model.
- [Cycle 0005 evidence](docs/cycles/evidence/0005/README.md): clean implementation `c813053`, fingerprint `4be3d512c89df69f9ffea3fb26eab59645241e9a3f7a50acd84a1e8e489b5cde`; **33 product / 43 shared / 28 paired unit tests, 6/6 native MCP cases and 3/3 shared native regressions per host**. The real external client discovers, clicks, reads exact pauses/source/images, saves referenced interpretations, continues, reconnects and cleans up. A separate driving-agent smoke completed both stops and recovered a stale reference; its harness exited 0. Earlier failed/partial attempts remain recorded.
- MCP server hold/state-read measurements: VS Code 40004.70/3.08 ms; Cursor 40005.60/3.00 ms. One input, two interpretations, both exact source/value snapshots, four image receipts and all five instrumented links agree. Closed resource events match disk and remain stable across later runs. Seven implementation-review findings were repaired; three fixing passes reached the review limit without convergence, and four outside invocations timed out. No final review, CI, PR approval or package claim.
- [Cycle 0004 evidence](docs/cycles/evidence/0004/README.md): clean implementation `f968e02`, fingerprint `e89d14e46d5763ec88ba02508ae0a8a29d0b3633c7b0aa06c04928a0aee94717`; **26 paired and 40 shared unit tests; 18/18 native cases in each host**. One real click, two distinguishable concurrent POSTs, server TS line 19 at cart 0, browser TS line 23 at result cart 1, then screen cart 1 with one handler. Actual JS/map/TS, pause values, request/response and four page images agree.
- Forty-second server holds retain responsive control. GET/server continue/browser continue: VS Code 6.41/6.44/2.21 ms; Cursor 6.24/7.04/4.84 ms. These are observations on this machine. Duplicate input/continue, manual interference, decoy isolation, malformed correlation, stale source, missing response, cancellation, late contradictions and cleanup were exercised. Missing images remain partial; failed runs clean themselves without an external DELETE; final public success waits for evidence persistence.
- Current recorded versions: VS Code 1.138.0 / js-debug 1.117.0; Cursor 3.21.12 / API 1.128.0 / js-debug 1.93.0; Chrome 153.0.8010.50; extension-host Node 24.18.1 / Electron 42.10.0; runner Node 26.8.2; macOS arm64.
- Shared source extraction retains all previous behavior: native normal/stale-script/source-drift checks pass in both hosts, and their shared source hashes match the final tree. Earlier [Cycle 0003](docs/cycles/0003-scoped-browser-transport.md) proved managed Chrome via debugging pipe without editor-wide CDP. Its full native-presentation criterion remains inconclusive.
- Independent editor presentation is **unverified**: CUA reported the Mac locked. Current page PNGs and renderer ACKs are distinct evidence. Do not retry against an unchanged lock or bypass it.
- Six concrete Cycle 0004 review findings were repaired. The latest persistence fix has two focused regression tests and final native matrices. `/review` reached three fixing passes, **not converged**; four outside invocations timed out. No final-product review, PR approval or release claim follows.

## Capability evidence

A fixture proves mechanisms, not the integrated final product.

| Goal | State | Evidence and remaining gap |
| --- | --- | --- |
| G01 | partial | Single synchronous/paired cart click in both hosts; no chat-driven full checkout. |
| G02 | unverified | Approved linked-item design; no wiki/codemap navigation. |
| G03 | partial | Exact executed source, values, target/pause identities and an instrumented async boundary verified; arbitrary repository causal links remain unverified. |
| G04 | partial | Ordered page frames and evidence; no video or offline synchronized replay/export. |
| G05 | unverified | No durable learner progress implementation. |
| G06 | partial | Extension-owned MCP and actual external SDK/agent clients demonstrated; six native scenarios per host. Explicit demo profile only; no ordinary-workspace or packaged support proof. |
| G07 | unverified | Approved Study workspace reference; experiment panes do not establish product UX. |
| G08 | unverified | Living book required; not implemented. |
| G09 | unverified | Guided walkthrough required; not implemented. |
| G10 | unverified | No packaged installation, three real-repository uses or learning feedback. |
| G11 | partial | Both actual editors pass runtime fixtures; full packaged experience and native UX remain unverified. |

## Exact resume action

Review and implement Cycle 0006. Use the approved default Study workspace to connect the same selected learning item with the app, exact source, explanation and durable personal understanding. Apply the bounded design/engineering reviews before implementation. Cycle 0005 evidence is verified on remote main and issue #6 is closed. User delegated continuous execution under D008; continue without re-planning the whole product.

Final Cycle 0005 runners and owned editor processes have exited. Private profiles/logs stay outside Git; required sanitized evidence is copied under docs/cycles/evidence/0005 with raw/shared hashes. No CI, PR approval, VSIX, installed-product or publication claim. Full checkout, recording/replay, wiki/codemap/progress, all three layouts and real-repository support are the remaining product work; do not spend repeated cycles polishing the proven transport layer. Desktop-lock-dependent native visual checks remain unverified; do not bypass the lock or repeatedly retry it unchanged.

## Full-product completion gate

[Ten consecutive sequential independent reviews](docs/acceptance/FINAL_REVIEW.md) start only once the complete candidate and G01–G11 evidence exist. **0/10, not started.** Any failure restarts at reviewer 1 after fixes. Raphtalia's intended-use acceptance remains outstanding. Goal #1 stays open.
