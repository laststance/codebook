# Cycle 0018 — Bounded reader-pose transfer

Date: 2026-09-23 JST. H3 implementation and source/browser controls pass on the [manifest-identified inputs](reading-pose-handoff-manifest.json), following H2 at `5d48361`. **338/338 workspace/schema tests, extension/shared build and extension typecheck pass. Seven real Chromium cases pass**, with all three final video sheets inspected. H4 native workspace replacement, full product/package checks and a new unchanged installed candidate remain outstanding. This is not a native product PASS; unchanged-v22b remains FAIL.

## Implemented contract

The host requests a pose only after the current model renders and pending playback returns to its last confirmed position. A bounded schema carries known anchor/fraction/offset/scroll, value-table horizontal scroll, allowed expanded details, visited source-action keys and a semantic control locator. No raw HTML, DOM element or executable selector crosses the boundary. A unique capture identity binds the current presentation operation, displayed UI revision, learning item, source hash, study, observation and content tab.

After placement, the current renderer must acknowledge restoration before the mode/preference can commit. A new document can import a pose only before any learner input. Real keyboard, pointer, wheel and touch input invalidates the capture; a queued animation frame checks that authority again. Restoration does not focus another native pane, issue runtime controls or write understanding. Retired context callbacks are ignored both before and after asynchronous initialization, including late view-state refresh completion.

Rehydrating the same confirmed replay legitimately advances its UI revision. The first complete test pass exposed eight false refusals (328/336 pass). Capturing after initial playback settlement alone was insufficient: the post-placement rehydration can advance it again. The final implementation authorizes the new UI revision only after item, source, study, observation and content-tab identity remain equal; runtime and selection guards are retained. Fourteen focused replay/reentry/manual-resume controls then pass. Observation IDs use their existing bounded session-and-pause format rather than assuming UUIDs.

## Observations and controls

| Check | Observed result |
| --- | --- |
| Original compiled reader, real document replacement | FAIL: checkbox focus becomes body, scroll 1,826 → 0 px, disclosures and visited state disappear; the original pose message has no transferable data |
| Final replacement | Source-version anchor stays at 402 px; checkbox focus, disclosure and visited-action identity survive; understanding remains false with zero writes |
| Keyboard after capture | New focus and scroll survive; old restoration receives no success receipt |
| Wheel after capture | New scroll survives; stale restoration is rejected |
| Input in the new renderer | Imported old state cannot overwrite it |
| Input before the queued restoration frame | New focus/scroll survive; no successful restoration receipt |
| Stale model / different observation of the same source | Neither can inherit the prior pose receipt |
| Complete workspace/schema suite | 338/338 PASS, zero failures/skips/cancellations, 116.484 s; frozen input bytes unchanged |
| Build and typecheck | PASS; raw output and exit receipts retained |

The standalone browser uses the actual compiled product HTML with a simulated extension bridge and real Chromium inputs. It does not prove WebviewPanel creation, native tab pinning, live runtime handoff or host-specific focus. The unit suite models native boundaries; those assertions are not native pixels.

The final video is 5.880 seconds, 390×640, 25 fps, SHA-256 `18f430e3136b842c377f80b33ca13e52c585c373bf0e8b44647238b34761003c`. All three sheets sampled at 4 fps were inspected. They show retained source/value reading and unchecked learner progress, then preserved newer input. Fresh-document blank/placeholder frames remain visible. Half-second pauses after observations improve readable recording; they never satisfy readiness predicates and provide no product latency measurement. Earlier fast clips omit readable intermediate states; their three sheets plus five earlier paced sheets are inspected separately and not substituted for the final source cut.

## Retained unsuccessful attempts

- Browser harness initially used an insecure `about:blank` context without `crypto.randomUUID`; no product render occurred. A second diagnostic identifies that exact page error.
- The first loopback harness used a synchronous child call that blocked its HTTP server; navigation failed. The corrected helper uses asynchronous subprocess execution on loopback and the actual crypto API, with no product stub.
- The first repaired-browser check compared duplicate DOM links with unique visited-action keys. Its first verdict is FAIL despite preserved reading; four other cases pass. The corrected observer compares the set defined by the product's visited-state contract. This is an observer correction, not a claimed product fix.
- The intermediate 328/336 workspace result and the later 2/6 focused result retain their failures. They precede the replay revision/semantic-identity repair and do not invalidate the final same-input 338/338 result.

Private artifacts live in `artifacts/cycle-0018/reading-pose-controls/`. The manifest retains source input identities, logs, screenshots, videos, metadata and inspection receipts. The first two setup failures produced no usable recording; the later failed loopback video is setup evidence, not product proof. Every browser session is closed and each loopback listener is stopped. No persistent Mac setting, logged-in editor profile or product installation is changed.

Next: H4 must create pinned replacement panes in final columns, transfer every live/history/replay lease before retiring predecessors, resolve final focus by the admitted logical pane role, and use this exact pose protocol. Preserve no-move behavior and creation/adoption failure, source/learner changes, cancellation, genuine user closure and current-lease cleanup. Then H5 freezes a new archive after complete checks and exercises each ordinary editor with video/frame evidence. T3 remains in progress, T4 FAIL, T5 pending; G12 and final acceptance remain unimplemented/unstarted, and Claude Code CLI long reviews remain owner-skipped.
