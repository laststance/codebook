# Learning replay and time-travel debugging

Authority: PRODUCT_GOAL version 8, G03/G04/G05/G07 and D030/D032. This specifies required behavior; implementation and final visual approval remain pending in Cycle 0029.

## Purpose and screen hierarchy

Learning replay lets a learner repeatedly inspect how an application's behavior corresponds to the code that executed and the runtime state at that moment. It is saved from a real code-path explanation performed in standard Copilot Chat or Cursor Agent while the AI operates the actual project and debugger.

The replay screen inherits the live explanation's composition. It shows the recorded application, the historical executed source in a native source editor and historical values/call stacks in the standard debugger together. The live chat area becomes a **learning summary** containing the processing summary, saved explanation and sequence diagram. This is a Codebook-owned replay surface, not a replacement live chat client or a request to modify native chat internals. The Codebook Activity Bar entry opens the learning library and selected replay.

The primary task is synchronized playback and time-travel debugging; the summary supports it. A document-like reader with a small video thumbnail and source links cannot substitute for synchronized source/debugger history. No dedicated Codebook Variables/Watch clone is required: the native debugger is the inspection surface in both live use and replay.

## Shared historical moment

Play, pause, step backward/forward and seek use one selected recorded moment. Repeatedly revisiting that moment must recover the same captured application frame, executed source version/location, native debugger values/stack and corresponding explanation. The learner can compare earlier and later states without rerunning the application.

| Surface | Required correspondence |
| --- | --- |
| Recorded application | Display the captured application/video frame for the selected time and identify it as recorded. Applicable server/test/extension evidence must not invent a Web UI. |
| Native source editor | Show the source version that actually executed and its corresponding location. A current checkout file or a merely related source link is insufficient. |
| Native debugger | Expose recorded values, scopes and stack for the same recorded context. Label the replay debug context so it cannot be mistaken for a currently running target. Required historical values must remain inspectable after the original debugger exits. |
| Learning summary | Show the overall summary and selected-step explanation/sequence correspondence. Distinguish the complete path from what had happened at the selected instant. |
| Playback controls | Apply the same playhead/step to all synchronized surfaces. Keep historical state visibly selected while paused; never silently mix earlier values with later video. |

Capture skew, intervals without a source/debug observation and truncated/redacted values remain explicit. Do not interpolate a value, fabricate an executing line or silently carry the last observed state forward as if freshly captured. Unsupported capture fidelity at a required point is an implementation gap, not a passing alternative design. Precise sampling/storage/debug-adapter mechanics belong to engineering planning, with these observable outcomes preserved.

## Capture and saved learning artifact

The learner can finish an explanation and save it as learning. Acquisition of video/source/runtime state must start early enough to preserve the session; saving afterward cannot recreate uncaptured execution. Finalization identifies complete or partial capture. Whether recording is privately buffered or explicitly started is an engineering choice that must disclose capture state and preserve the required history.

The owner selected bottom status-area capture state and **Save learning replay** during live explanation (design decision 2A). These controls are extension-owned and outside the standard chat UI. They remain available while the learner reads the chat or inspects source/debugger state.

| Content | Required behavior |
| --- | --- |
| Question and source identity | Retain natural question, project/revision, actual source hashes, session identity and capture time. Dirty source is identified; it is not silently represented as the commit. |
| Processing summary | Explain purpose, main steps, inputs/results and important branches from the actual explained path. Identify outcomes that were not observed. |
| Sequence diagram | Show participating UI/components/services/functions and ordered interactions. Link meaningful steps to the matching source, explanation and recorded moment. Distinguish observed interactions, source-derived relationships and unknown boundaries; a stack alone cannot prove every async arrow. |
| Saved explanation | Preserve meaningful-stop explanations, source anchors and supporting evidence so they remain readable after the original chat closes. |
| Execution recording | Retain application frames where applicable, ordered actions/pauses, historical source and durable runtime values/scopes/stack sufficient for native debugger replay. Do not persist live debugger handles as durable values. |
| Learner state | Retain selected moment/playhead, reading context and explicitly marked understanding/progress. Execution success or saving never marks understanding automatically. |
| Limitations | Identify partial/interrupted capture, unavailable/redacted facts, skew and source drift. Keep failures inspectable. |

Internal evidence still grounds explanations. D032 additionally requires exposing recorded runtime state through the native debugger during replay; it is not restricted to private facts or quotations in text.

## Save, reopen and time travel

1. Explain a real code path through standard editor chat and actual execution.
2. Save the explanation and acquired video/source/debugger history as one learning replay, with summary and sequence diagram. Report complete or partial status.
3. Stop the original application/debugger and close the original chat. Reopen the saved learning from the library, including after restarting the editor.
4. Play the recording and verify that the historical executed source and native debugger move with it. Pause to inspect values and the call stack at that recorded point.
5. Step backward and forward, seek to an earlier moment and replay the same interval repeatedly. Recover the same recorded frame/source/values/stack without changing target state or creating a new application run.
6. Navigate from the summary/sequence to a recorded step. Keep the selected time, source and debugger aligned and retain reading context. Opening current source separately discloses drift without rewriting the recorded version.
7. Mark understanding only through explicit learner action. Reopen and verify progress, playback position and its corresponding historical debug state.

Time travel navigates captured history. Replay never sends another purchase request or reruns other application side effects. A deliberate new execution is a separate live run. Replay controls must not resume an unrelated live debugger or borrow its state. The native debugger may have a dedicated historical session; its concrete implementation is not frozen by this specification.

## Relationship to independent Wiki

A replay needs no Wiki or Wiki-generation job. It may link to repository documentation, but recording storage, playback/debug context, learner progress and source snapshots are independent. Regenerating, relocating or deleting generated Wiki output must not erase a replay or change its explanation, sequence or captured history. Wiki pages do not automatically become lessons or acquire learner progress.

## Acceptance

In each host, use a real project and natural question. Save a session that crosses multiple meaningful source/runtime states. After original runtime/debugger/chat exit, prove:

- Playback shows the recorded application and the source executing at the same moment, with corresponding recorded values/stack inspectable through the native debugger.
- Backward/forward steps, non-adjacent seeking and repeated replay return to identical historical state; no new target side effects or unintended live-debug mutations occur.
- Summary/sequence/selected-step explanation remain grounded and synchronized where they refer to a selected point; learner progress stays explicit.
- Editor restart restores the saved playhead and corresponding source/debugger context; source drift does not replace recorded state with current values/files.
- Missing, partial, skewed or unavailable data is labeled honestly and required absent evidence prevents PASS.
- Wiki generation/update has no effect on the saved replay or progress.

Record native operation as video, extract and inspect frames for temporal correspondence and motion, and bind evidence to source/package/host/theme/viewport identity. A static screenshot, generated image, source-link-only reader or video-plus-summary without native historical inspection does not verify this feature. The exact nine-project matrix remains unchanged; pre-acceptance development uses D031's designated nextjs-dashboard checkout.
