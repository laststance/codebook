# Cycle 0018 — Guarded viewport lease handoff

Date: 2026-09-23 JST. H2 source primitive and focused/shared checks pass; workspace integration (H4), reader transfer (H3), complete checks and ordinary installed validation remain outstanding. The [engineering amendment](../../../plans/cycle-0018-presentation-handoff.md) follows the separate [both-host H1 prerequisite](presentation-handoff-prerequisite.md). This does not override unchanged-v22b FAIL or count toward final acceptance.

## Change and lifetime contract

`BrowserViewport.rebindPanel` permits replacement only for a current leased viewport with a fully drained placement reservation. It retires the old renderer epoch and callbacks, binds the replacement, and retains the same CDP subscription, recording observer, frame delivery and latest/pinned pixels. Rebinding does not set HTML or reveal the panel. Only the explicitly selected live, historical or replay presentation subsequently restores content, so a hidden live lease cannot overwrite replay.

```text
accepted required paints -> hold/drain -> rebind current lease -> release
                                             |                    |
                                 retire old listeners/epoch       v
                                 keep runtime/observer      selected renderer
                                             |              fresh exact ACK
                                  predecessor disposal
                                  has no session effect

current panel disposal -> release queued work -> fail/close observer once
normal lease cleanup   -> release current lease -> retain reader panel
```

Two viewport objects can share Application. The original-source control confirms that closing that panel closes both leases and the live observer. New tests transfer both before predecessor disposal, preserve the live historical state, paint only the selected replay, and later restore the historical content explicitly. Workspace code does not call the new primitive yet; H4 must transfer every attached lease and resolve cleanup against its current panel.

A separate regression reproduced current-panel closure leaving a reserved capture waiting for later cleanup. Before repair it fails with `still waiting for cleanup` instead of `closed`; after repair disposal releases the placement reservation immediately. Retired-panel identity checks run before that release, preventing an old callback from releasing a new reservation.

## Evidence

| Check | Result | Scope |
| --- | --- | --- |
| Original-source shared-disposal control | 1/1 PASS | Confirms lifetime coupling; not a failing-before handoff test |
| Current-panel-close regression before repair | 0/1, expected assertion failure | Actual pending-capture defect; preserves pre-fix source/test hashes |
| Focused viewport checks after repair | 18/18 PASS | Required paint drain, old epoch/callback rejection, exact retained pixels, both leases, current closure and one CDP stream |
| Complete Cycle 0001 shared checks | 62/62 PASS | Zero failures, skips or cancellations |
| Extension/shared build and extension typecheck | PASS | Shared declaration compatibility and all extension TypeScript |

The CDP test uses the real `Cdp` class with a responding socket fake. One stream starts, two real protocol frame messages reach the same observer, both get ACKs, and only normal cleanup closes it. These are source-bound behavior checks, not real browser/native paint proof. The full product/package suites will run after workspace integration; earlier 841 + 96 counts apply only to source `64c7629` and are not reused for this change.

The [sanitized manifest](viewport-handoff-manifest.json) fixes both input hashes and all private controls under `artifacts/cycle-0018/viewport-handoff-controls/`. Build/typecheck completion is recorded from the returned terminal result, with no fabricated raw log. No new product archive is built or installed. T3 remains in progress, T4 FAIL, T5 pending; G12 remains unimplemented, final trials 0/10 and 0/at least 20, not started.

## Next

Implement bounded reader-pose capture/restoration (H3), then integrate final-column panel creation and atomic lease ownership transfer (H4). Recheck admission after drains and awaits, preserve source/learner intent, restore only selected pixels outside the native lock, and retain genuine user-close errors. Test creation/adoption failure and all current negative guards before a new frozen unchanged both-host schedule. Measure product loading intervals; H1's synthetic model does not establish seamless motion.
