# Learning replay

Authority: PRODUCT_GOAL version 7, G04/G05 and D030. This specifies required behavior; implementation and visual design are pending Cycle 0029 follow-up.

## Purpose and entry

Learning is the ability to save an explained code path and revisit it as a replay. The source is a live explanation performed in standard Copilot Chat or Cursor Agent while the AI operates the actual project and debugger. The Codebook Activity Bar entry exposes the saved-learning library and opens a dedicated replay screen. Exact navigation and pane arrangement belong to the later design review.

A learner can finish a code-path explanation, choose to save it as learning, and later select that saved session. Acquisition of screen/pause evidence must begin early enough to preserve the explanation being saved; saving afterward cannot recreate uncaptured execution. A partial capture remains explicitly partial. Whether the implementation buffers privately or offers a recording control is an engineering choice that must preserve this outcome and disclose capture state.

## Saved learning artifact

| Content | Required behavior |
| --- | --- |
| Question and source identity | Retain the natural question, project/revision and actual source hashes, session identity and capture time. Dirty source is identified, not silently represented as the commit. |
| Processing summary | Explain the overall purpose, main steps, inputs/results and important branches using the actual explained path. Clearly identify outcomes that were not observed. |
| Sequence diagram | Show participating UI/components/services/functions and their ordered interactions. Link meaningful steps to source, explanation and recorded moments. Distinguish observed interactions from source-derived relationships and unknown boundaries. A call stack alone cannot prove all arrows or async causality. |
| Saved explanation | Preserve the explanation of each meaningful stop, its source anchors and supporting evidence references so it remains readable when the original chat is closed. This is saved learning content, not a replacement live chat client. |
| Execution recording | Retain application frames where applicable, ordered actions/pauses and corresponding source/explanation. For server, test or extension execution, preserve the applicable execution evidence without inventing a Web UI. |
| Learner state | Retain selected moment/playhead, reading context and explicitly marked understanding/progress. Execution success or saving never marks understanding automatically. |
| Limitations | Identify partial/interrupted recordings, unavailable/redacted facts, capture skew and source drift. Keep failures inspectable. |

A source-linked sequence diagram is the learning flow representation. Other useful source navigation may remain, but it cannot substitute for the requested sequence explanation. Diagram generation is not permission to invent calls, requests or completed results.

## Save, reopen and replay

1. Explain a real code path through the standard editor chat and actual execution.
2. Save the explanation and available recording as one identified learning replay, including summary and sequence diagram. Finalization reports complete or partial status.
3. Open it from Codebook's learning library after the app/debugger, original chat or editor process has closed.
4. Read the summary/diagram, select a meaningful step and replay or seek through its corresponding recorded application/source/explanation evidence.
5. Navigate to source while retaining the replay's recorded version. Opening current files discloses differences; it must not rewrite the historical record.
6. Mark understanding only through explicit learner action; reopen and verify the saved progress and reading/playback position.

Playback is read-only with respect to the target runtime. It never reexecutes the application, sends a purchase request or presents a stopped live debugger when none exists. A deliberate new execution creates a separate run.

## Native debugger and evidence boundary

Live values, watches and call stacks use VS Code/Cursor's native debugger. Codebook does not duplicate the Variables or Watch interface in a custom live or replay panel. Bounded runtime snapshots may still be retained internally to ground explanations, summaries and diagram links. A saved explanation may quote a relevant observed value with its evidence and time; this does not require a general value-inspection UI. Recorded images are historical captures and must be labeled accordingly.

## Relationship to independent Wiki

A replay needs no Wiki or Wiki generation job. It can optionally link to repository documentation, but replay identity, recording storage, progress and source snapshots are independent. Regenerating, relocating or deleting generated Wiki output must not erase a replay or change its historical explanation/diagram. Wiki pages do not automatically become lessons or acquire learner progress.

## Verification

Use the same real-project natural question in each host. Verify save/reopen after runtime exit, summary/diagram correctness and source links, ordered playback, an inspected video of motion where applicable, stale/partial states, progress ownership and independence from Wiki. Exact viewport, theme, source/package identity and limitations belong in evidence. A mockup or static screenshot is not replay proof.
