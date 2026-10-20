# Learning replay and time-travel debugging

Authority: PRODUCT_GOAL version 10, G03/G04/G05/G07 and D030/D032. This specifies required behavior. [DESIGN.md](../../DESIGN.md) owns visual approval; the current state of the active cycle record owns implementation/proof status.

## Purpose and screen hierarchy

Learning replay lets a learner repeatedly inspect how an application's behavior corresponds to the code that executed and the runtime state at that moment. It is saved from a real code-path explanation performed in standard Copilot Chat or Cursor Agent while the AI operates the actual project and debugger.

The replay screen inherits the live explanation's composition. It shows the recorded application, the historical executed source in a native source editor and historical values/call stacks in the standard debugger together. The live chat area becomes a **learning summary** containing the processing summary, saved explanation and sequence diagram. This is a Codebook-owned replay surface, not a replacement live chat client or a request to modify native chat internals. The Codebook Activity Bar entry opens the learning library and selected replay.

The primary task is synchronized playback and time-travel debugging; the summary supports it. A document-like reader with a small video thumbnail and source links cannot substitute for synchronized source/debugger history. No dedicated Codebook Variables/Watch clone is required: the native debugger is the inspection surface in both live use and replay.

### Desktop layout and summary visibility

D034 sets the reference: an ordinary desktop display with the editor window expanded to the available screen area at normal/default zoom. OS full-screen mode is not required. Show application video, source, native debugger and the learning summary together at this reference size.

Approved choice **5A** allows the learning summary to collapse behind a visible **Learning summary** button when space is limited, preserving priority for application/source/native debugger. Opening/closing it retains the selected moment, historical debug context, reading position and appropriate keyboard focus. Preserve manual user layout choices and unrelated native panes. Extremely small windows and extreme zoom such as 200% are outside required design/acceptance; this fallback does not make them mandatory targets.

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

### Partial history — approved design choice 4A

When application video exists but source or debugger history is missing for an interval, continue playing the available video. Mark the missing interval on the shared timeline. Each affected source/debugger surface shows **Not recorded at this moment** (Japanese: **この時点は未記録**) instead of a line highlight, values or call stack from another moment. Retain any genuinely available same-moment evidence with its identity; never imply that an absent observation exists.

The same behavior applies during playback, a direct seek and backward/forward navigation. Entering a gap clears any previously selected execution highlight or debugger state that would otherwise look current. Reaching a recorded point restores that point's captured source/debugger context at the shared playhead. A gap does not automatically pause playback or require a confirmation. The learner can still pause or seek deliberately through the ordinary controls.

This is a playback recovery rule, not permission to omit required capture. Missing history at a required acceptance point remains unverified and cannot earn a PASS.

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
- With video present and source/debugger history absent for a controlled interval, playback continues across a marked timeline gap. The affected surfaces display the missing-history message and no earlier/later execution highlight, values or stack. Direct seeking and repeated traversal behave the same; recorded points restore matching state. Required absent evidence still prevents PASS.
- Partial, skewed, truncated or otherwise unavailable evidence retains its accurate labels and source/time identity.
- Wiki generation/update has no effect on the saved replay or progress.

Record native operation as video, extract and inspect frames for temporal correspondence and motion, and bind evidence to source/package/host/theme/viewport identity. A static screenshot, generated image, source-link-only reader or video-plus-summary without native historical inspection does not verify this feature. The exact nine-project matrix remains unchanged; pre-acceptance development uses D031's designated nextjs-dashboard checkout.
