# QA Report: codebook Cycle 0007 checkout reader

| Field | Value |
| --- | --- |
| Date | 2026-09-19 |
| URL | <loopback-origin> |
| Branch | feat/cycle-0007-checkout-scenario |
| Commit | 2a9137775ee543a69b18fe7ed000323c2c2ca2d2, clean product source |
| PR | None |
| Tier | Standard, bounded webview QA |
| Scope | Actual compiled Context, Moments and historical Application HTML, driven by a deterministic host adapter and real archived fixture evidence |
| Duration | About 15 minutes; recorded interaction 111.4 seconds |
| Pages visited | 3; 16 context states |
| Screenshots | 9 application/driver screenshots plus 18 sampled video frames |
| Framework | Extension webview HTML, Playwright CLI and GStack browser |

## Provisional health score: 100/100

No reproducible product defect was found in this bounded surface. This score does not measure native editor composition, installation, persistence, live DAP/MCP behavior, screen-reader usability or final-product readiness.

| Category | Score | Coverage |
| --- | --- | --- |
| Console | 100 | No page or console errors across tested states |
| Links | Not scored | Host navigation intents tested, native destinations covered separately |
| Visual | 100 | Dark/light/high contrast, 280/360/520 px, CSS zoom 200%; inspected screenshots |
| Functional | 100 | 53 checks; render acknowledgement, identity and control intents |
| UX | 100 | History versus current pause, loading, errors, empty states, recovery affordance |
| Performance | Not scored | No reproducible timing benchmark |
| Content | 100 | Explicit source-derived, observed, partial, unavailable and history labels |
| Accessibility | 100 provisional | Keyboard tab activation, roving tab index, retained focus and visible controls; no real screen reader |

Weights total 80% after excluding links and performance. All tested categories scored 100. Compare only equivalent coverage.

## Findings

Critical 0; high 0; medium 0; low 0. No product fixes were made under `/qa-only`.

Two driver failures were reproduced and isolated from product behavior: matching an old render ACK after publication, and choosing the hidden Overview copy of a Live control. Waiting for a new ACK and using the visible control made all 53 checks pass. The original observations and failed output remain in `driver-observation.md` and `driver-hidden-tab-result.txt`.

## Observed behavior

- Four stable checkout items and two original paired items keep their identities, source values and progress totals. Earlier cart history cannot continue a later order stop. Return to current pause is explicit.
- Order creation shows captured `orderCount=0`, `total=24`; confirmation shows `orderCount=1`. Unobserved/loading content does not borrow previous values, interpretation or page images.
- Pending/failed durable history does not show complete study evidence; Retry emits a named intent. Learner checks await host acknowledgement and remain independent of execution.
- Agent markup renders literally. Source drift and unavailable source remain visible. Current run and selected reading profile are independently labeled.
- 5/5 layout variants had no page-wide horizontal overflow or obscured focused checkbox. Long values wrap substantially at 280 px and 200% zoom but controls remain reachable.
- Historical application image identifies Cart mutation and retains cart count zero. Moments identify all four items. Video frames show selected-state changes and scrolling; no animated product transition was introduced in this cycle.

## Evidence

All paths below are within `<repo>/artifacts/cycle-0007/webview-qa`:

- `flow-result.txt`: 53 passing checks; errors empty.
- `layout-result.txt`: five geometry/focus variants.
- `screenshots/initial.png`, `moments.png`, `app-history.png`, five layout PNGs and `driver-history-observation.png`.
- `interaction.webm`: 111.4 s QA recording, including driver waits. Inspected sampled frames `video-frame-01/06/10/11.png` and `video-tail-01/03/05/07.png`. This is QA evidence, not the product recording capability G04.

## Limits and next verification

The host adapter records intents and supplies fixture states. It does not execute real VS Code/Cursor commands, mutate durable storage or exercise DAP/MCP. Its synthetic paused states reuse a final archive; their raw runtime outcome/link fields do not represent a chronological live run. Native product runs at the same source revision separately verify four stops, persistence and reload in both editors. Independent native pixels remain unverified because the desktop is locked; no bypass was attempted.

Agent orchestration and implementation review remain pending for Cycle 0007. Final goal #1 and the ten independent final reviews remain open. No ship-readiness or final-product approval is claimed.
