# Cycle 0006 implementation review — plan audit

Base: origin/main (`9ce3ddc`); HEAD `5c883a1` plus current tracked and nonignored untracked work. Scope is the bounded Cycle 0006 D6/E6 contract.

Scope: REQUIREMENTS MISSING (failure-path repairs and final validation in progress); no unrelated feature expansion.

| Contract | Verification mode | Status at first pass | Evidence / gap |
| --- | --- | --- | --- |
| Stable two-item projection and selected/current identities | Diff + tests | DONE | studyModel and learning tests; actual history/current host checks |
| Explicit append-only progress, source-version review | Diff + tests | PARTIAL | Library and persistence work; cold default identity and closed-outline regressions fail |
| Workspace isolation, corruption and atomic failure | Diff + tests | DONE | learning.test.ts; no silent reset |
| Count/byte limits with no eviction | Diff + tests | PARTIAL | Guards exist; boundary tests being added |
| MCP-first retained viewport / late callbacks | Diff + actual hosts | DONE | BrowserViewport lease test and native open-paused identity checks |
| Native default group composition and moved source | Diff + actual hosts | DONE for API behavior | nativeStudyBootstrap; pixels remain separate |
| Foreign dirty tab preservation / owned closure | Actual hosts + tests | PARTIAL | Native normal preserves draft; pending Open/Run after Close uncovered |
| Immutable source and selected loading/error fences | Diff + tests | PARTIAL | Historical source hashes verified; A-B-A/obsolete failure/reopen fail |
| Context states, navigation, keyboard and zoom | Browser + native APIs | PARTIAL | 22 webview checks and five layouts; loading transition loses flow focus |
| Explicit exact-pause Continue / history refusal | Actual hosts | DONE for current tested paths | history runner uses real UI continue; historical continue and MCP reveal rejected |
| Native editor pixels, 1440/1024/800 behavior | External native state | UNVERIFIABLE | Mac locked; API layout and webview screenshot do not replace this |
| Final checkpoint after shutdown/last tick | Diff + tests + actual hosts | DONE | explicit retire checkpoint test; two interpretations after reload |
| Bounded responsive observation and storage | Diff + causal tests | PARTIAL | source cache unbounded; live projection awaits slow save |
| Existing normal/hold/source-drift behavior in both hosts | Actual hosts | PARTIAL | Earlier native normal available; candidate matrix required after fixes |
| Portable evidence and cycle/issue/state synchronization | Repo + remote state | NOT DONE | Implementation/review ongoing; no new closing claim or GH write |

Discrepancies are ongoing implementation and reproduced failure cases, not approved scope cuts. Repair under D008 and rerun relevant tests. Independent native visual acceptance remains blocked by the unchanged lock; no bypass or repeated lock probe. Final G01–G11 gate remains 0/10.
