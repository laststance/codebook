# Current project state

Updated: 2026-09-19\
Product stage: connected study and durable learning mechanisms demonstrated; full native usability unverified\
Active cycle: [0008 — Recording and offline replay](docs/cycles/0008-recording-replay.md) — implementation\
Last cycle: [0007 — Cart-to-confirmation scenario](docs/cycles/0007-checkout-scenario.md) — mechanisms demonstrated; native reliability inconclusive\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open\
Active cycle issue: [#9](https://github.com/laststance/codebook/issues/9) — open\
Last cycle issue: [#8](https://github.com/laststance/codebook/issues/8) — closed with remote evidence `6840178`\
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main\
Authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 3

## Verified facts

- [Cycle 0007 evidence](docs/cycles/evidence/0007/README.md): clean `8be0913`, fingerprint `20ff1ec5d3cf1c29f46488483649e5d1bb860ea316d98ee47ff73fc583aa43ea`; **96 product / 46 shared / 43 paired tests**, **6/6 product-native and 10/10 runtime cases** across both hosts. Four item-specific observations, eleven links, seven phase images, interpretations and reload without execution are demonstrated. Actual root-agent checkout uses 36 operations/four explanations per host: Cursor complete; VS Code runtime demonstrated but study partial after three render-ACK timeouts. A bounded diagnostic is inconclusive and excluded from clean acceptance. Review repaired 14 findings in three fixing passes, not converged; a post-review CDP subscription/pause-binding fix has red-before/focused/native evidence. Independent native pixels, installed extension, real repositories, synchronized replay and both later modes remain unverified.
- [Cycle 0006 evidence](docs/cycles/evidence/0006/README.md): clean implementation `c873b43`, fingerprint `f9836a7d23a8b9cdacb0b6babfcd0927aa443b2808969640e53e8d13b9345d46`; **63 product / 44 shared / 28 paired tests, 27 webview checks, learner normal/history and MCP normal/hold/source-drift in each host**. Two linked observations, exact captured source, values, interpretations, durable personal checks and restart without execution are demonstrated. All runtime cleanup completes; unrelated dirty drafts survive. History cases deliberately remain partial when an invisible page cannot supply a pause receipt. Independent native visual/installed acceptance remains unverified.
- Cycle 0006 repaired 23 distinct findings in three implementation fixing passes; no convergence is certified. Fresh reviewer creation hit the agent-thread limit, reused reviewers are explicitly limited, and no outside-provider result exists. These reviews do not count toward final acceptance.
- [Cycle 0005 evidence](docs/cycles/evidence/0005/README.md): clean implementation `c813053`, fingerprint `4be3d512c89df69f9ffea3fb26eab59645241e9a3f7a50acd84a1e8e489b5cde`; **33 product / 43 shared / 28 paired unit tests, 6/6 native MCP cases and 3/3 shared native regressions per host**. The real external client discovers, clicks, reads exact pauses/source/images, saves referenced interpretations, continues, reconnects and cleans up. A separate driving-agent smoke completed both stops and recovered a stale reference; its harness exited 0. Earlier failed/partial attempts remain recorded.
- MCP server hold/state-read measurements: VS Code 40004.70/3.08 ms; Cursor 40005.60/3.00 ms. One input, two interpretations, both exact source/value snapshots, four image receipts and all five instrumented links agree. Closed resource events match disk and remain stable across later runs. Seven implementation-review findings were repaired; three fixing passes reached the review limit without convergence, and four outside invocations timed out. No final review, CI, PR approval or package claim.
- [Cycle 0004 evidence](docs/cycles/evidence/0004/README.md): clean implementation `f968e02`, fingerprint `e89d14e46d5763ec88ba02508ae0a8a29d0b3633c7b0aa06c04928a0aee94717`; **26 paired and 40 shared unit tests; 18/18 native cases in each host**. One real click, two distinguishable concurrent POSTs, server TS line 19 at cart 0, browser TS line 23 at result cart 1, then screen cart 1 with one handler. Actual JS/map/TS, pause values, request/response and four page images agree.
- Forty-second server holds retain responsive control. GET/server continue/browser continue: VS Code 6.41/6.44/2.21 ms; Cursor 6.24/7.04/4.84 ms. These are observations on this machine. Duplicate input/continue, manual interference, decoy isolation, malformed correlation, stale source, missing response, cancellation, late contradictions and cleanup were exercised. Missing images remain partial; failed runs clean themselves without an external DELETE; final public success waits for evidence persistence.
- Current recorded versions: VS Code 1.138.0 / js-debug 1.117.0; Cursor 3.21.12 / API 1.128.0 / js-debug 1.93.0; Chrome 153.0.8010.50; extension-host Node 24.18.1 / Electron 42.10.0; runner Node 24.21.0 for Cycle 0006 (26.8.2 for prior cycles); macOS arm64.
- Shared source extraction retains all previous behavior: native normal/stale-script/source-drift checks pass in both hosts, and their shared source hashes match the final tree. Earlier [Cycle 0003](docs/cycles/0003-scoped-browser-transport.md) proved managed Chrome via debugging pipe without editor-wide CDP. Its full native-presentation criterion remains inconclusive.
- Independent editor presentation is **unverified**: CUA reported the Mac locked. Current page PNGs and renderer ACKs are distinct evidence. Do not retry against an unchanged lock or bypass it.
- Six concrete Cycle 0004 review findings were repaired. The latest persistence fix has two focused regression tests and final native matrices. `/review` reached three fixing passes, **not converged**; four outside invocations timed out. No final-product review, PR approval or release claim follows.

## Capability evidence

A fixture proves mechanisms, not the integrated final product.

| Goal | State | Evidence and remaining gap |
| --- | --- | --- |
| G01 | partial | Actual driving-agent cart-to-confirmation fixture in both hosts; general repository orchestration and intended-use acceptance remain open. |
| G02 | partial | Four checkout items and original paired items share outline, source-derived overview/flow, observations and values; no generated repository wiki or recording navigation. |
| G03 | partial | Exact executed source, values, target/pause identities and an instrumented async boundary verified; arbitrary repository causal links remain unverified. |
| G04 | partial | Ordered page frames and evidence; no video or offline synchronized replay/export. |
| G05 | partial | Durable source-versioned decisions, restart, drift and storage-failure tests pass for both fixed profiles; broader repository/installed acceptance pending. |
| G06 | partial | Extension-owned MCP and actual external SDK/agent clients demonstrated; six native scenarios per host. Explicit fixed demo profiles only; no ordinary-workspace or packaged support proof. |
| G07 | partial | Native Study workspace implemented; source/selection/ownership API checks and real webview behavior pass. Independent editor pixels and constrained native UX remain unverified. |
| G08 | unverified | Living book required; not implemented. |
| G09 | unverified | Guided walkthrough required; not implemented. |
| G10 | unverified | No packaged installation, three real-repository uses or learning feedback. |
| G11 | partial | Both actual editors pass runtime fixtures; full packaged experience and native UX remain unverified. |

## Exact resume action

Implement ENG1→ENG4 of active Cycle 0008: synchronized recording/offline replay of the fixed checkout (D014). DX, design and engineering plans are complete, including three fresh same-host challenges (2/5/3 findings adopted). External coverage is unavailable after one Claude Code timeout; no repeated unchanged invocation. Start with the optional shared clock/frame seam and bounded recording store, then context/outcome, playback/API/UI and separate native host evidence. The cycle contains exact limits and T1–T9 tests. Cycle 0007 evidence remains on origin/main at `6840178`; 96/46/43 tests and prior native outcomes are baseline only, not recording proof. Preserve source versions, legacy archives and the unresolved render-ACK distinction. D008 authorizes continuation; no final goal is removed.

Cycle 0007 source and final host evidence are frozen at `8be0913`. No CI, PR approval, VSIX, installed-product or publication claim exists. Desktop-lock-dependent native visual checks remain unverified; do not bypass or repeatedly retry the unchanged lock.

## Full-product completion gate

[Ten consecutive sequential independent reviews](docs/acceptance/FINAL_REVIEW.md) start only once the complete candidate and G01–G11 evidence exist. **0/10, not started.** Any failure restarts at reviewer 1 after fixes. Raphtalia's intended-use acceptance remains outstanding. Goal #1 stays open.
