import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import type { RecordingIndex } from '../recordingSchemas'
import type { RecordedEvent } from '../runtimeSupport/evidence'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { projectRecording } from '../utils/projectRecording'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

/**
 * Indexes a study's film as the recording store would, without frames: the projection of explanations reads only its identity and its end.
 * @param study - The saved study the film belongs to.
 * @param version - The recording format of that study: 2 for a browser-only study, 3 for a cross-runtime one.
 * @returns A finalized film that started at 0 ms and ended at 8000 ms.
 * @example filmEndingAt8000(createCrossRuntimeStudy(), 3).endMs // 8000
 */
function filmEndingAt8000(
  study: ConfiguredStudy,
  version: 2 | 3,
): RecordingIndex {
  return {
    header: {
      version,
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: study.runId,
      profile: study.profile,
      sourceBuild: {
        revision: 'test',
        dirty: false,
        sourceHash: sha256('test source'),
      },
      createdAt: study.createdAt,
      startedMs: 0,
      clock: 'runtime-receipt-ms',
      sampleIntervalMs: 50,
      owner: { pid: 1, hostname: 'test', sessionId: study.instanceId },
    },
    entries: [],
    status: 'finalized',
    endMs: 8000,
    lastVerifiedMs: 8000,
  }
}

/** Numbers journal entries and stamps them as the run's evidence does. @example journal({ type: 'continue.accepted', elapsedMs: 3000, detail: {} })[0]?.sequence // 1 */
const journal = (
  ...entries: Pick<RecordedEvent, 'type' | 'elapsedMs' | 'detail'>[]
): RecordedEvent[] =>
  entries.map((entry, position) => ({
    ...entry,
    sequence: position + 1,
    wallTime: '2026-09-20T00:00:10.000Z',
  }))

// The first stop of createCrossRuntimeStudy: committed at 2000 ms with native debugger state and one saved explanation.
const firstStopId = 'browser-session:1',
  firstExplanationId = '44444444-4444-4444-8444-444444444444'

// Value: protects=the learner reading a stop's explanation at that stop in the replay, as region 2 of the approved image shows it; fails_when=the summary reads "No explanation was available by this recorded time." at every recorded stop, because an agent saves its explanation after the stop was committed (both hosts in the second native round); why_new=Cycle 0045 cause 10; seam=none
test("a stop's explanation saved while its pause was held is shown when the playhead stands on that stop", () => {
  // Arrange: the stop was committed at 2000 ms, explained at 2600 ms and continued at 3000 ms.
  const study = createCrossRuntimeStudy(),
    context = buildRecordingContext(
      study,
      journal(
        {
          type: 'agent.explanation-saved',
          elapsedMs: 2600,
          detail: { id: firstExplanationId, snapshotId: firstStopId },
        },
        { type: 'continue.accepted', elapsedMs: 3000, detail: {} },
      ),
      1,
    )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 3), context, 2000)

  // Assert
  assert.deepEqual(atStop.observation?.interpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
      savedLater: 'while-pause-held',
    },
  ])
  assert.deepEqual(atStop.laterInterpretations, [])
})

// Value: protects=the note standing only where the explanation is shown ahead of its saved time; fails_when=an explanation keeps "saved while this pause was held" after the playhead reached the time it was saved at; why_new=Cycle 0045 cause 10 (rule 3); seam=none
test('an explanation carries no note about its saved time once the playhead has reached that time inside the pause', () => {
  // Arrange: the stop was committed at 2000 ms, explained at 2600 ms and continued at 3000 ms.
  const study = createCrossRuntimeStudy(),
    context = buildRecordingContext(
      study,
      journal(
        {
          type: 'agent.explanation-saved',
          elapsedMs: 2600,
          detail: { id: firstExplanationId, snapshotId: firstStopId },
        },
        { type: 'continue.accepted', elapsedMs: 3000, detail: {} },
      ),
      1,
    )

  // Act
  const atSavedTime = projectRecording(
    filmEndingAt8000(study, 3),
    context,
    2600,
  )

  // Assert
  assert.deepEqual(atSavedTime.observation?.interpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
    },
  ])
  assert.deepEqual(atSavedTime.laterInterpretations, [])
})

// Value: protects=every explanation an agent saved during a pause being read at that stop, not only the first; fails_when=the second explanation saved before the continuation is moved under Later annotations; why_new=Cycle 0045 cause 10 (rule 2, first part); seam=none
test("every explanation saved before a stop's pause ended is shown at that stop", () => {
  // Arrange: the stop was committed at 2000 ms, explained at 2600 ms and again at 2800 ms, and continued at 3000 ms.
  const study = createCrossRuntimeStudy()
  study.observations[0]!.interpretations.push({
    id: '55555555-5555-4555-8555-555555555555',
    text: 'The theme is still light at this pause.',
    createdAt: '2026-09-20T00:00:03.500Z',
    facts: [{ path: 'value:nextTheme', value: 'dark' }],
  })
  const context = buildRecordingContext(
    study,
    journal(
      {
        type: 'agent.explanation-saved',
        elapsedMs: 2600,
        detail: { id: firstExplanationId, snapshotId: firstStopId },
      },
      {
        type: 'agent.explanation-saved',
        elapsedMs: 2800,
        detail: {
          id: '55555555-5555-4555-8555-555555555555',
          snapshotId: firstStopId,
        },
      },
      { type: 'continue.accepted', elapsedMs: 3000, detail: {} },
    ),
    1,
  )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 3), context, 2000)

  // Assert
  assert.deepEqual(
    atStop.observation?.interpretations.map((interpretation) => [
      interpretation.text,
      interpretation.savedLater,
    ]),
    [
      [
        'This stop captures the selected dark theme before it is applied.',
        'while-pause-held',
      ],
      ['The theme is still light at this pause.', 'while-pause-held'],
    ],
  )
  assert.deepEqual(atStop.laterInterpretations, [])
})

// Value: protects=the explanation an agent sends together with its continuation being read at the stop it explains; fails_when=a first explanation saved just after the continuation was accepted is hidden under Later annotations (the baseline run of N14-b saved one 0.6 s after it); why_new=Cycle 0045 cause 10 (rule 2, second part); seam=none
test("a stop's first explanation saved after the run continued is shown at the stop and says so", () => {
  // Arrange: the stop was committed at 2000 ms and continued at 3000 ms; its explanation was saved at 3500 ms.
  const study = createCrossRuntimeStudy(),
    context = buildRecordingContext(
      study,
      journal(
        { type: 'continue.accepted', elapsedMs: 3000, detail: {} },
        {
          type: 'agent.explanation-saved',
          elapsedMs: 3500,
          detail: { id: firstExplanationId, snapshotId: firstStopId },
        },
      ),
      1,
    )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 3), context, 2000)

  // Assert
  assert.deepEqual(atStop.observation?.interpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
      savedLater: 'after-run-continued',
    },
  ])
  assert.deepEqual(atStop.laterInterpretations, [])
})

// Value: protects=an explanation added to a finished recording being read at the stop it explains; fails_when=a first explanation whose saving the journal no longer recorded is hidden under Later annotations; why_new=Cycle 0045 cause 10 (rule 2, second part: an availability of null); seam=none
test("a stop's first explanation saved after the recording ended is shown at the stop and says so", () => {
  // Arrange: the stop was committed at 2000 ms and continued at 3000 ms; the journal holds no receipt of its explanation.
  const study = createCrossRuntimeStudy(),
    context = buildRecordingContext(
      study,
      journal({ type: 'continue.accepted', elapsedMs: 3000, detail: {} }),
      1,
    )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 3), context, 2000)

  // Assert
  assert.deepEqual(atStop.observation?.interpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
      savedLater: 'after-recording-ended',
    },
  ])
  assert.deepEqual(atStop.laterInterpretations, [])
})

// Value: protects=the same note for an explanation the journal still recorded although the film had ended; fails_when=a receipt later than the film's end reads "saved after the run continued"; why_new=Cycle 0045 cause 10 (rule 3: the journal outlives the film while the editor session lasts); seam=none
test("a stop's first explanation whose receipt is later than the film's end says that it was saved after the recording ended", () => {
  // Arrange: the film ended at 8000 ms; the stop's explanation was saved at 9000 ms.
  const study = createCrossRuntimeStudy(),
    context = buildRecordingContext(
      study,
      journal(
        { type: 'continue.accepted', elapsedMs: 3000, detail: {} },
        {
          type: 'agent.explanation-saved',
          elapsedMs: 9000,
          detail: { id: firstExplanationId, snapshotId: firstStopId },
        },
      ),
      1,
    )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 3), context, 2000)

  // Assert
  assert.equal(
    atStop.observation?.interpretations[0]?.savedLater,
    'after-recording-ended',
  )
  assert.deepEqual(atStop.laterInterpretations, [])
})

// Value: protects=the selected stop's summary holding what was said about that stop, while the revision the skill asks for after the result stays apart; fails_when=the revision is shown as the stop's explanation, or the stop's own explanation is listed under Later annotations as well; why_new=Cycle 0045 cause 10 (rule 4); seam=none
test('a revision saved after the result stays under Later annotations at the stop', () => {
  // Arrange: the stop was committed at 2000 ms, explained at 2600 ms and continued at 3000 ms; a second explanation of it was saved at 7000 ms, after the result.
  const study = createCrossRuntimeStudy()
  study.observations[0]!.interpretations.push({
    id: '55555555-5555-4555-8555-555555555555',
    text: 'The complete path ended with the dark theme applied.',
    createdAt: '2026-09-20T00:00:07.000Z',
    facts: [{ path: 'value:nextTheme', value: 'dark' }],
  })
  const context = buildRecordingContext(
    study,
    journal(
      {
        type: 'agent.explanation-saved',
        elapsedMs: 2600,
        detail: { id: firstExplanationId, snapshotId: firstStopId },
      },
      { type: 'continue.accepted', elapsedMs: 3000, detail: {} },
      {
        type: 'agent.explanation-saved',
        elapsedMs: 7000,
        detail: {
          id: '55555555-5555-4555-8555-555555555555',
          snapshotId: firstStopId,
        },
      },
    ),
    1,
  )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 3), context, 2000)

  // Assert
  assert.deepEqual(
    atStop.observation?.interpretations.map((interpretation) => [
      interpretation.text,
      interpretation.savedLater,
    ]),
    [
      [
        'This stop captures the selected dark theme before it is applied.',
        'while-pause-held',
      ],
    ],
  )
  assert.deepEqual(atStop.laterInterpretations, [
    {
      id: '55555555-5555-4555-8555-555555555555',
      text: 'The complete path ended with the dark theme applied.',
      createdAt: '2026-09-20T00:00:07.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
      availableMs: 7000,
    },
  ])
})

// Value: protects=the rule outside a stop's own pause: an explanation appears from the recorded time it was saved at; fails_when=the stop's rule is applied to every playhead position, so an explanation is shown between stops before it was saved; why_new=Cycle 0045 cause 10 (rule 5, a guard: green before the change, its control is the mutation that drops the pause condition); seam=none
test('between two stops an explanation is shown only from the time it was saved', () => {
  // Arrange: two stops without native debugger state, committed at 2000 ms and 4000 ms; the first one's explanation was saved at 3500 ms.
  const study = createConfiguredStudy()
  study.configuration.additionalStops = [
    { line: 1, column: 7, inspections: study.configuration.inspections },
  ]
  study.configurationHash = sha256(JSON.stringify(study.configuration))
  const second = structuredClone(study.observations[0]!)
  second.pause.generation = 2
  second.id = 'browser-session:2'
  second.snapshotUri = `codebook://${study.instanceId}/runs/${study.runId}/snapshots/browser-session%3A2`
  second.elapsedMs = 4000
  second.source.column = 7
  second.interpretations = []
  study.observations.push(second)
  study.operation!.continuedPause = second.pause
  const pausedImage = study.captures.find(
    (image) => image.phase === 'paused-browser',
  )!
  pausedImage.snapshotId = study.observations[0]!.id
  study.captures.push({ ...pausedImage, snapshotId: second.id })
  const context = buildRecordingContext(
      study,
      journal({
        type: 'agent.explanation-saved',
        elapsedMs: 3500,
        detail: { id: firstExplanationId, snapshotId: firstStopId },
      }),
      1,
    ),
    film = filmEndingAt8000(study, 2)

  // Act
  const beforeSaved = projectRecording(film, context, 3000),
    whenSaved = projectRecording(film, context, 3500)

  // Assert
  assert.equal(beforeSaved.observation?.id, 'browser-session:1')
  assert.deepEqual(beforeSaved.observation?.interpretations, [])
  assert.deepEqual(beforeSaved.laterInterpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
      availableMs: 3500,
    },
  ])
  assert.deepEqual(whenSaved.observation?.interpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
    },
  ])
  assert.deepEqual(whenSaved.laterInterpretations, [])
})

// Value: protects=the recorded behavior for a stop whose pause the recording did not seal, which the decided rule leaves open (P2 closure, "Conflicts with the plan"); fails_when=such a stop hides its first explanation, or claims that the pause was held or that the run continued, which the recording cannot tell; why_new=Cycle 0045 cause 10 (rule 3 has no note for this case); seam=none
test('a stop whose pause the recording did not seal shows its first explanation without a note about when it was saved', () => {
  // Arrange: one stop without native debugger state, so without a sealed pause, committed at 2000 ms; its explanation was saved at 3500 ms, inside the film.
  const study = createConfiguredStudy(),
    context = buildRecordingContext(
      study,
      journal({
        type: 'agent.explanation-saved',
        elapsedMs: 3500,
        detail: { id: firstExplanationId, snapshotId: firstStopId },
      }),
      1,
    )

  // Act
  const atStop = projectRecording(filmEndingAt8000(study, 2), context, 2000)

  // Assert
  assert.deepEqual(context.pausedIntervals, [])
  assert.deepEqual(atStop.observation?.interpretations, [
    {
      id: '44444444-4444-4444-8444-444444444444',
      text: 'This stop captures the selected dark theme before it is applied.',
      createdAt: '2026-09-20T00:00:03.000Z',
      facts: [{ path: 'value:nextTheme', value: 'dark' }],
    },
  ])
  assert.deepEqual(atStop.laterInterpretations, [])
})
