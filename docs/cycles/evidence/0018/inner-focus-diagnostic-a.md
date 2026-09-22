# Cycle 0018 — Inner-focus diagnostic A

Result: **inconclusive about the original v21 timeout**, 2026-09-22. The [unchanged v21 failure](installed-v21-validation.md) remains valid. This separately instrumented Cursor copy is diagnostic evidence, not unchanged installed validation, a repaired product, G12 or a final reviewer trial.

## Question and instrumentation

The frozen hypothesis asks whether a matching focused renderer receipt arrives while delayed native panel/tab/text state prevents the completion predicate. The schedule retains the original initial/restart sequence and stops on the first unexpected failure. Missing receipts, changed document epochs, whole-window blur and a satisfied completion predicate are explicit falsifiers.

The same v21 VSIX (`de89f86635d3d0228d4ed9d48794db5153de41276424947688e9891b266793bb`, source `9a9fd7c`) was normally installed in a fresh owned Cursor profile. All 29 files matched before logging instrumentation changed only the installed bundle and manifest. Product source, focus conditions, commands, timeouts and retries were unchanged. The diagnostic bundle is `bd5e9c5578c0e67097af65922884c396257306bc3bec5111ffe3ce07e7cb40c9`; the diagnostic manifest is `e11f70b4461ce58d0eb7bde08eb56c7a05bcd36940c21830718f1b4f0b6217b9`. Observer overhead can affect timing.

## Observed boundary

Cold Study, saved Wiki and exact ready paused replay at 11,453.2425 ms pass. The initial round-trip helper then refuses its first presentation request at 10:37:30.656–10:37:32.137 UTC: **`Focus this Codebook work window before changing its presentation.`** No round-trip case, presentation-start or host-focus-start occurs. Restart and all remaining controls are unexecuted.

The first four-event trace records native blur at 10:35:50.295 UTC, before the attempted mode operation. The final 126-event trace has one initial focused native snapshot followed by 125 unfocused snapshots, including all five window events. Later DOM observation reports visible/focused, which does not prove native work-window focus. The original inner-focus boundary was never reached, so the trace neither confirms its cause nor demonstrates a fix. The refusal is separated from the original product timeout.

No corrective focus, retry, seek or restoration follows the refusal. The owned window closes normally with exit 0. All 62 original profile files retain bytes and modification times, the unsaved draft is retained, and owned editor PIDs and connection descriptors are zero. After-run verification matches 27 original files plus the two declared diagnostic files.

## Evidence and next action

The 192.64-second, 1280×800/25-fps workbench video has seventeen one-Hz contact sheets. Three are inspected (0, 96 and 180 seconds); fourteen remain uninspected. They show the draft, saved paused replay/source/Context and trace command. This renderer recording cannot establish OS window focus or broad native usability.

The [sanitized manifest](inner-focus-diagnostic-a-manifest.json) retains the frozen schedule, instrumentation, receipts, trace, video, inspection and preservation proof under `artifacts/cycle-0018/owned-inner-focus-v21/`. A later [diagnostic B capture-path collision](inner-focus-diagnostic-b.md#evidence-integrity-and-preservation) overwrote two captures: this original video was recovered by its exact preexisting SHA-256, but the original before-close screenshot is unavailable and excluded from verification. All seventeen extracted frame sheets remain unchanged; the manifest records this availability amendment.

Next: in a fresh diagnostic, establish the actual owned native window as focused and verify the live native API state before attempting the original sequence. Stop if that prerequisite cannot be established. This changed setup must be recorded; it does not turn diagnostic A or the original v21 failure into PASS. **T3 remains diagnosis, T4 FAIL, T5 pending; final reviewers 0/10, not started.**
