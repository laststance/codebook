# Required project acceptance matrix

Authority: PRODUCT_GOAL version 7, D029 and D030 (2026-09-26). This is a fixed required set, not a candidate pool. All results below are unexecuted under the new protocol. Historical fixture, demo and development preflight results do not populate these cells.

| ID | Required project | Revision / execution mapping | Stage 1 VS Code / Cursor | Stage 2 VS Code / Cursor |
| --- | --- | --- | --- | --- |
| P01 | Designated private work application (`zumen-fe`; owner-designated existing checkout) | Next/React Pages Router manifest and path inventory confirmed read-only; deeper private code/runtime mapping pending | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P02 | https://github.com/TanStack/query | Library tests + browser/Node SSR Examples; additional forms pending inventory | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P03 | https://github.com/reduxjs/redux | Library tests + browser Examples; CDN/source-version binding needs resolution | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P04 | https://github.com/reduxjs/react-redux | Library tests + Next RSC Example; useful runtime task not yet established | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P05 | https://github.com/reduxjs/redux-toolkit | Library tests + browser and Node Examples; selected tasks pending | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P06 | https://github.com/laststance/bookmark-xp-explorer | Chrome MV3 popup/fullpage + service worker | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P07 | https://github.com/laststance/nsx | Vite Web UI + Express Node server + Chrome MV3 popup/content/service worker | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P08 | https://github.com/laststance/switch-time | Web app + Hono Node API | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |
| P09 | https://github.com/laststance/gitbox | Next Web UI + server-side actions/authentication | NOT RUN / NOT RUN | NOT STARTED / NOT STARTED |

Before this acceptance campaign starts, D031 requires development behavior verification on the owner's nextjs-dashboard checkout (see DEVELOPMENT.md for the exact path). Dashboard results are development-only, not a new matrix target or a PASS for any row.

## Mapping and evidence rules

Before trials, inspect each actual repository at a pinned revision. Expand each project into rows for every applicable required execution form: Web UI interaction, Node.js server processing, Chrome Extension contexts, library tests, and library Examples. Record the source/configuration paths establishing that mapping, entry points, real commands, dependencies, normal setup burden and required use cases. Do not infer forms from repository names or assume browser/Next.js-only scope. The library labels above encode the owner's mandatory test-plus-Example requirement; they are not inspection results. Mark unsupported forms as development gaps. A NOT APPLICABLE entry needs code-based grounds; it cannot remove a required target or its applicable runtime.

For every project/host/use-case row retain: fixed target revision, question and objective, setup prerequisites, candidate VSIX/version/hash and skill/setup identities, host version, stage/operator, observed actions/stops/values/call stack, source correspondence, learning replay with processing summary/sequence diagram, independent Wiki generation/update/browser-to-editor source-link evidence, and feature-screen usability, errors/help/unknowns, verdict and report link. Stage 2 also requires the junior's own-word understanding, correctness evidence and confidence with reasons. Confidence is unset until an actual evaluation; it is subjective assurance, not a probability.

For each host, verify the three feature areas independently: live standard-chat explanation with native debugging; save/open learning replay containing the explained path, summary and sequence diagram; and repository-wide Wiki generation/browser reading/update/source deep links with no runtime/replay prerequisite. Exercise chat and **Update LLM Wiki** updates and default/configured output. The retired display themes are not required rows. A new feature specification, old fixture run or old coupled Wiki reader does not earn a PASS.

Stage 1: 0/18 minimum project-host assessments completed. Stage 2: 0/18 minimum project-host assessments completed; nine independent project reviewers not started. Expanded use cases will increase row counts. No complete final candidate or final distributed VSIX is frozen. Owner acceptance remains outstanding.

P01 is exactly the owner's existing private work checkout specified in the request, not an interchangeable application. Its absolute local locator is retained only in ignored private campaign metadata. Inspect without changing the working tree, inventory existing changes, and use authorized isolation when needed. Publish only the P01 alias and sanitized outcomes; never publish private source, business data, credentials or recordings. Private evidence needs stable restricted locations and hashes, not copied contents.

Keep attempts append-only in linked reports. After any extension/skill/setup/connection change, record the old and new candidate identities, affected rows, impact rationale and required regressions. Shared execution, recording or explanation changes require retesting all affected targets. Every final PASS must be demonstrably valid for the final fixed distributed VSIX; different-version results cannot simply be added together.

## Initial repository inspection, 2026-09-26

Read-only source/configuration inspection, **not execution or acceptance**. Eight clean shallow inspection clones are stored under ignored `artifacts/acceptance-v6/targets/`; existing owner checkouts were not changed. These are pinned inspection revisions, not yet final trial freezes. P01's exact revision, pre/post Git status and manifest inventory stay in restricted ignored metadata; one pre-existing dirty entry remains unchanged. No private source, environment values or recordings are copied here.

| Target | Inspection revision | Code/configuration evidence and remaining work |
| --- | --- | --- |
| P01 | Restricted private receipt | Manifest/path inventory only; Next/React Pages Router found. Preserve existing work; deeper source/execution mapping and authorized isolated environment remain pending. |
| P02 | `5279b05211223dd719803ca22a9d1fa46c98638e` | `packages/query-core/package.json`, `src/__tests__` and `examples/react/nextjs-app-prefetching/package.json`: test execution plus supplied browser/SSR Examples. Pin installed package/source correspondence and select real test/Example tasks. |
| P03 | `3ae0f79bdcce35ac2a4895e284ef04b7dc0ebd5e` | `test/createStore.spec.ts` executes store operations; `examples/counter-vanilla/index.html` has click/dispatch/render behavior but imports Redux from a remote latest CDN. Establish immutable dependency/source correspondence through a normal supported Example route; do not count an unpinned dependency as the checked-out library. |
| P04 | `0b4e33307bf077a7756fe6b83a94606b6a3a83c3` | `test/utils/Subscription.spec.ts` executes subscription notifications. `examples/publish-ci/rr-rsc-context/app/page.tsx` is a Next template importing/logging useSelector, not a demonstrated stateful learner flow. Investigate supplied/officially documented Examples and an appropriate real execution task; do not substitute a fabricated demo. |
| P05 | `c9dac937d77adc3bf04842a43955e81d0e7a46da` | `packages/toolkit/src/tests`, `packages/toolkit/package.json`, `examples/query/react/basic/package.json` and `examples/publish-ci/node/package.json` establish real library tests and supplied browser/Node Examples. Several Examples depend on published versions; verify correspondence before trial. |
| P06 | `91a06132934eb053b923fe54c9255221f4c1da2b` | `manifest.json` declares MV3, popup, bookmarks/storage/tabs permissions and `background/service-worker.js`; popup/fullpage source uses extension-owned APIs. Requires genuine extension contexts and isolated test bookmarks, not an HTTP-only reproduction. |
| P07 | `e066ab8878f7bd04781bb86f54563f6e46eeef05` | Root/workspace manifests, `server/index.ts` Express router/listener, and `browser-extension/src/manifest/base/v3.js` establish Web + Node + extension service worker/content/popup. Inspect normal dependency/auth/database setup without using production data. |
| P08 | `5e50febef55c0a0caa6a520e8f1ce6a498680301` | `apps/api/src/server.ts` uses `@hono/node-server` with app.fetch; `apps/app/package.json` and workspace scripts establish separate application/API packages. Normal database/auth setup and chosen causal flow remain to validate. |
| P09 | `44f6e95b04ec8c0f448818dea06603c1c920a559` | Root Next scripts, `src/lib/actions/` and `src/lib/supabase/server.ts` establish Web and server-side processing. Establish normal local service/auth prerequisites; internal E2E bypasses cannot rescue an acceptance flow. |

### Development gaps revealed by this inspection

Current Codebook discovery exposes bounded demo profiles and one configured repository-browser profile (`extension/src/service.ts`), not verified general Node server, library test-runner or Chrome Extension flows. Those required forms need capability investigation/development and normal installed proof. The browser route does not establish support for Vite/Parcel/CRA or all Next server paths. All target cells remain NOT RUN; no exclusion or PASS follows from this inspection. Final use-case mapping is still open, including further applicable forms not yet inventoried. The library test and Example requirements are separate mandatory rows in each host when the detailed campaign is frozen.
