# Real-repository cross-runtime execution

Status: source audit and implementation draft; engineering review pending target selection.
Scope: Cycle 0029, AC-LIVE; dependencies AC-SAVE, AC-REPLAY, AC-GAPS, AC-LEARNING, AC-SKILL. Goal 9 remains unchanged.
Baseline: branch codex/cycle-0029-native-editor-spec, HEAD 273660c; dirty implementation candidate 4eaa0bb9.

## Required outcome

An ordinary editor chat operates the opened dashboard, submits once with fictional credentials, pauses in actual server source and the resulting client source, explains captured facts, saves the session and reopens each historical source/native-debugger state without another submit. Existing learning remains readable and unchanged. This is a development increment toward full runtime coverage, not final acceptance or a replacement for other required projects.

## Verified source constraints

| Layer | Current evidence | Required change |
| --- | --- | --- |
| Intent | repositoryConfigSchemas.ts additionalStops stores only line/column/inspections; configuredStops copies the first source into every stop. | Each new-format stop declares participant, source identity and citation; retain old intent/hash decoding. |
| Source authority | assertConfiguredDescriptor checks every stop against one book.anchorIndex. | Validate each stop against its own retained citation, and every source hash/line boundary before execution. |
| Process | launchDevelopmentServer directly spawns Next with no inspector. Existing owned process-group and lock cleanup are reusable. | Acquire and verify an owned server debugger endpoint/session; do not attach to arbitrary user processes or change project launch settings. |
| Modules | readDevelopmentBundle discovers client-reference chunks and app-pages-browser script URLs only. | Resolve and verify actual server loaded scripts/maps separately; do not relabel browser maps as server evidence. |
| Live control | ConfiguredBrowserRun has one selected DAP session, bundle, verifier and PauseGate. continue explicitly rejects server. | Participant-owned session/source/stop state, common run clock and explicit sequencing; arm required server stops before the request can execute them. |
| Saved evidence | configuredObservationSchema fixes browser/paused-browser; configuredStudySchema forbids causal links. validateConfiguredStudyEvidence requires every observation to share one session. | Versioned evidence for participant-specific pause identities and run-level ordering; duplicate/foreign pauses remain rejected. |
| Replay | Source/debugger snapshots already persist concrete source and native history; recording receipts now distinguish snapshot identities. | Project the selected observation's participant/source; clear absent surfaces independently and preserve old recordings. |

## Runtime sequence and ownership

```text
Freeze declared real sources and stops
  -> launch owned application and acquire its server debugger
  -> launch/select browser and attach recording
  -> verify sources and arm server stop before input
  -> dispatch one browser action
  -> capture server stop, explain, continue
  -> capture subsequent declared server/client stops
  -> verify visible result and close owned resources
  -> save history -> replay after runtime exit
```

Do not assume a React pending render precedes server execution: source order alone does not establish cross-process ordering. The first bounded trial can stop in authenticate before signIn, then authorize after validation, then the client error branch. The browser input is the initiating operation. Choose actual executable positions from current source/maps during normal agent preparation, not a bundled answer key.

A request-start event, an observed server pause and a response are separate facts. Record network request identity only when observed; do not label a particular server pause causally linked merely because it followed a click. If request-to-server correlation is unavailable, preserve that uncertainty in the explanation and refuse a stronger causal PASS. Avoid storing credential bodies or headers.

## Acquisition evidence and next probe

- Installed target uses Next 16.1.4. Its `dist/cli/next-dev.js` lines 231–254 clear inherited inspector flags and apply `--inspect` to the forked server worker. Explicit port 0 remains 0; inherited nonzero inspector ports are incremented. Its CLI accepts `--inspect [[host:]port]`. This is inspected source behavior, not a completed native connection.
- The [official Next debugging guide](https://nextjs.org/docs/app/guides/debugging) documents server-side inspection. Context7 lookup was attempted but returned monthly quota exhausted; installed version source is the authority for worker-specific details.
- Next probe: use explicit loopback/ephemeral inspection for the owned server worker, observe the advertised endpoint, verify its process-group membership, attach the native Node debugger and resolve a real server source binding. Do not select the first inspector line or assume the launcher PID is the application worker.
- Probe failure criteria: inspector belongs to a foreign process, multiple ambiguous workers, stale endpoint after restart, missing source/map verification, or owned listener/process group survives cleanup. No application submit is needed for the acquisition probe. Run it with the real project opened in the editor; notify before desktop use.

## Acquisition probe result — expectation revision 2

[Evidence](../cycles/evidence/0029/server-acquisition.json): two real-dashboard launches with explicit loopback port 0 exposed the owned Next worker; process-group identity, route response and shutdown passed. No submit or native DAP stop was attempted.

The original requirement for every exact runtime binding before input is falsified for cold Server Actions. The loaded SSR actions module is a createServerReference proxy. Actual authenticate/auth modules exist in the route chunk under action-browser, but are not loaded into the inspector after GET /login. Existing extraction and map verification can seal these modules before input without executing them.

Revision 2 therefore distinguishes a verified source/map plus acknowledged pending breakpoint registration from an already bound runtime location. Require exact executed module, DAP source position, pause ownership and loaded-map equality before capturing or explaining a server stop. Do not run/import application modules merely to force breakpoint binding. Preserve the first probe's URL-only discovery as superseded by executed-text inspection.

## Implementation order

1. Establish the owned server-debugger acquisition contract from the actual installed Next/debug adapter and a bounded real-project probe. Validate worker ownership, dynamic ports, teardown and restart; retain existing process cleanup.
2. Add versioned per-stop participant/source intent and retained evidence. Reuse existing source/citation validators and snapshot capture. Preserve old archive hashes and metadata; no bulk migration or history rewrite.
3. Extract participant-local debugger state from ConfiguredBrowserRun. Retain one operation coordinator for input, deadlines, recording clock and final result. Dispatch must wait for all required breakpoint registrations. Loaded modules require exact bindings; lazy modules require a sealed generated position and an acknowledged pending registration, then exact loaded-source/DAP verification before a pause qualifies.
4. Integrate server and browser stop transitions, capture/continuation and failure paths. Distinguish chronological run order from per-session pause generation.
5. Extend save/replay projection, public capability guidance and shared skill. Advertise support only after the runtime exists.
6. Verify the normal installed workflow in the designated dashboard and both editors, using Copilot Auto first and the authorized extension fallback on exhausted quota.

## Frozen verification requirements

- Same-path browser history from version 3 still opens byte-for-byte; existing understanding decisions unchanged.
- A declared different-file stop retains its own citation/hash, captured text and debugger frame; reject a substituted source, foreign session or stale generation.
- Two sessions may both have generation 1 without collision; one session cannot repeat or move backward. Global observed order is checked independently.
- Required server breakpoint registration fails before browser input if ownership or sealed source mapping cannot be verified. For a lazy module, an acknowledged pending registration is distinct from a verified binding: missing/wrong runtime binding fails the run, never earns a captured-stop claim.
- A server pause may arrive before browser pending paint. No deadlock waiting for a browser pause that was never required.
- Manual resume, server worker exit/restart, source change, timeout and rejected continuation retain partial evidence and fail honestly.
- Server-only missing history does not display the preceding browser's values. Application recording remains independently timed.
- One real submit reaches required stops, explanations reference captured facts, visible result is observed, and replay survives app/debugger exit without repeating input.
- Record and inspect video of native backward/forward replay. Preserve target source/settings and all prior learning hashes.
- Full existing mechanism suite and VSIX content validation remain required before candidate installation. No bundled application, cart assets or Codex hooks.

## Implementation checkpoint

Internal source acquisition is implemented in readDevelopmentBundle with explicit server-action selection. [Evidence](../cycles/evidence/0029/server-source-acquisition.json): build and 60 source/browser/route tests pass; real dashboard actions.ts/auth.ts source and map hashes match. This does not enable server runtime operation or replace the pending engineering review. Reuse this path for participant preparation.

## Review status

GStack plan-eng-review was loaded, but its mandatory target selector is awaiting the owner. No preamble or engineering review ran; this file is an implementation draft and source audit, not a cleared review. The source audit above is independent preparatory work. Claude Code CLI reviews remain owner-skipped.

The opt-in launcher and its inspector ownership guard now have real-dashboard mechanism evidence: [launcher](../cycles/evidence/0029/server-launcher.json), [ownership](../cycles/evidence/0029/server-inspector-ownership.json). Reuse launcher.verifyInspector for native attachment, then implement per-stop participant/source intent and retained evidence. Neither receipt proves a native server pause.

## Native integration handoff after the history format change

- Internal intent version 2 normalizes through configuredStops, including each participant/source/anchor. Archive version 4 and recording version 3 retain it; version 1/3/2 browser input/archive/recording paths remain supported. Public live entry remains version 1 until integration.
- ConfiguredBrowserRun still guards version 2 before resource acquisition. Replace its single gate/session/CDP/module/breakpoint state with participant-local state and keep one ordered operation coordinator. Browser DOM/input/video must always use the browser proxy even while the active stop is server-owned.
- Reuse launchDevelopmentServer(..., true), inspectorEndpoint and verifyInspector for an owned pwa-node session. Native proxy selection must verify the exact worker and close rejected/provisional connections. Preserve acquisition draining and stop only owned roots.
- Extend OwnedRepositoryBreakpoint registration receipts for lazy server modules: a successful exact-source setBreakpoints ACK permits pending registration; a verified DAP position plus sealed executed script/map is still mandatory at the actual pause. Never load an action solely to force binding.
- resources.ts currently requests runtime.source(snapshot.itemId), environment.ts reveals configuration.source.path, and service.state currently projects only runtime.participants.browser. Change these with the runtime: source access must use the exact snapshot/stop, and state/continuation must expose the selected participant. Snapshot filenames also need participant/session identity; generation 1 exists independently in both sessions.
- StudyWorkspace must choose RecordingStore.start's explicit version 3 for version 2 intent; captureStudy must emit archive version 4. Only after this end-to-end route exists should live schema/skill advertise it. Keep source/citation/phase/generation guards and existing browser paths intact.


## Participant coordinator checkpoint

The [integration receipt](../cycles/evidence/0029/native-participant-integration.json) supersedes the browser-only coordinator handoff above: runtime construction now supports internal version 2, selects/owns a native server proxy, keeps participant-local pause gates and seals every declared module. Exact snapshot source resources/reveal, service participant state and intent-dependent archive/recording versions are wired. Controlled server/browser/server transitions, wrong binding/source, worker loss, delayed continuation and registration invalidation are tested. Browser input/video stay on the browser proxy. Native pending-breakpoint compatibility remains unverified.

Next complete the public version 2 schema/help/skill route and a complete new-format service-to-recording test. Then build/package and verify the designated dashboard's native adapter registration, actual pauses and preserved replay through ordinary editor chat. Current public entry and installed candidate remain unchanged; the internal test is not end-user or final-acceptance proof.

### Public entry and durable recording checkpoint (2026-09-27)

The [public integration receipt](../cycles/evidence/0029/public-participants.json) supersedes the previous handoff: version 2 is now exposed through start/help and skill 1.0.25. Controlled native transports pass the complete service/coordinator/observer/checkpoint/reopen path for server/browser/server, with separate source/value/image identity and saved explanations/sequence. The existing version 1 SDK path remains covered. Build/package inspection passed; the exact source `0ed66b0d` is installed in VS Code and ordinary Claude Code extension validation is in progress after visible Copilot quota exhaustion. Native binding, actual server pauses and final acceptance remain unverified until that trial settles.

### Installed public-entry result — 2026-09-27

At installed source `0ed66b0d`, ordinary Claude Code extension (Copilot quota exhausted) completed six browser/server stops, six explanations and ten summary/sequence steps on the designated dashboard. Complete recording failed: 64 MiB frame storage exhausted and the inherited paused-interval schema allowed only four stops. The latter is repaired at working source `94532404` with a before-failure/eight-stop service-storage-reopen regression; build and 56 focused checks pass. Next fix recording capacity and rerun the complete saved replay. No final acceptance or Cursor credit. See public-participants receipt and cycle closure for preservation/cleanup; desktop is released.
