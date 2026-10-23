import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_TEST_LEARNING_MATERIAL_VERSION } from '../constants'
import type {
  NodeTestHistoryEntry,
  NodeTestLearningMaterial,
} from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { projectNodeLearningSummary } from '../utils/projectNodeLearningSummary'
import { projectNodeTestSection } from '../utils/projectNodeTestSection'

const SOURCE_HASH = sha256('export const delay = schedule(job, 5_000)\n')

const output = (sequence: number, elapsedMs: number): NodeTestHistoryEntry => ({
  type: 'output',
  sequence,
  elapsedMs,
  outputSequence: sequence,
  channel: 'stdout',
  text: 'RUN src/jobs.test.ts\n',
})

const stop = (
  sequence: number,
  elapsedMs: number,
  index: number,
): NodeTestHistoryEntry => ({
  type: 'stop',
  sequence,
  elapsedMs,
  index,
  source: { path: 'src/jobs.ts', hash: SOURCE_HASH, line: 1, column: 1 },
  frame: { name: 'schedule', line: 1, column: 1 },
  facts: [],
  debuggerSnapshot: { version: 1, frames: [], variables: [], limitations: [] },
})

const entries: NodeTestHistoryEntry[] = [
  output(1, 100),
  stop(2, 420, 0),
  output(3, 600),
  stop(4, 700, 1),
  {
    type: 'result',
    sequence: 5,
    elapsedMs: 900,
    exitCode: 0,
    signal: null,
    outputTail: '',
  },
]
const history = { entries, status: 'complete' as const }

/** The saved material of the job scheduler's test: a step on the first output, two on stop 1, one on the result and an unknown one. */
const material: NodeTestLearningMaterial = {
  version: NODE_TEST_LEARNING_MATERIAL_VERSION,
  studyId: 'study_one',
  revision: 1,
  updatedAt: '2026-10-22T06:00:00.000Z',
  content: {
    question: 'How does the scheduler delay a job?',
    title: 'Delayed job',
    summary:
      'The test schedules a job and checks that it runs after its timer.',
    participants: [
      { id: 'test', label: 'Job test' },
      { id: 'scheduler', label: 'schedule' },
    ],
    steps: [
      {
        id: 'start',
        from: 'test',
        to: 'scheduler',
        label: 'Start the test',
        explanation: 'Vitest prints the test file it runs.',
        evidence: 'observed',
        reference: { type: 'output', sequence: 1, channel: 'stdout' },
      },
      {
        id: 'read',
        from: 'test',
        to: 'scheduler',
        label: 'Read the delay',
        explanation: 'The stop shows the delay of 5,000 ms.',
        evidence: 'observed',
        reference: { type: 'stop', sequence: 2, sourceHash: SOURCE_HASH },
      },
      {
        id: 'note',
        from: 'scheduler',
        to: 'scheduler',
        label: 'Keep the timer',
        explanation: 'The scheduler keeps the timer it created.',
        evidence: 'source-derived',
        reference: { type: 'stop', sequence: 2, sourceHash: SOURCE_HASH },
      },
      {
        id: 'verdict',
        from: 'scheduler',
        to: 'test',
        label: 'Pass',
        explanation: 'The job ran after its timer, so the test passed.',
        evidence: 'observed',
        reference: { type: 'result', sequence: 5 },
      },
      {
        id: 'gap',
        from: 'scheduler',
        to: 'test',
        label: 'Clock',
        explanation: 'How the fake clock advanced was not recorded.',
        evidence: 'unknown',
      },
    ],
  },
}

// Value: protects=each summary step leads to the event its reference names by sequence, also when two events share a time, and a step without a reference or naming no event of the history leads nowhere; fails_when=a step selects another event of the same time, or an unknown step gets a position; why_new=PR-B1 renders test replay material through the browser's summary renderer with positions (Design 5); seam=none; no_claim=the diagram's drawing
test('summary steps lead to the event their reference names, even at a shared time', () => {
  // Arrange
  const sameTime = [output(1, 100), stop(2, 100, 0), ...entries.slice(2)]
  const stray: NodeTestLearningMaterial = {
    ...material,
    content: {
      ...material.content,
      steps: [
        {
          ...material.content.steps[0]!,
          id: 'stray',
          reference: { type: 'output', sequence: 99, channel: 'stdout' },
        },
      ],
    },
  }

  // Act
  const projected = projectNodeLearningSummary(material, { entries: sameTime })
  const strayProjection = projectNodeLearningSummary(stray, { entries })
  const nothing = projectNodeLearningSummary(undefined, { entries })

  // Assert
  assert.deepEqual(projected?.positions, [
    { stepId: 'start', sequence: 1 },
    { stepId: 'read', sequence: 2 },
    { stepId: 'note', sequence: 2 },
    { stepId: 'verdict', sequence: 5 },
  ])
  assert.deepEqual(strayProjection?.positions, [])
  assert.equal(nothing, undefined)
})

// Value: protects=at a stop the section names the stop and its time, shows the moment's first step and its explanation, marks the moment's other steps, counts explained stops in its status and offers only the stop navigation that exists; fails_when=the locator is metadata-first or 0-based, another event's step is selected, a same-moment step is missed, or Previous stop is offered at the first stop; why_new=DS3, DS12, DS16 and DS21 replace the Study pane's position text; seam=none; no_claim=the section's DOM, which the Reader DOM check covers
test('at a stop the section shows its locator, its first step and the other steps of the same moment', () => {
  // Arrange
  const learning = projectNodeLearningSummary(material, history)

  // Act
  const view = projectNodeTestSection({
    history,
    selected: entries[1],
    selectedStopVerified: true,
    ...(learning ? { learning } : {}),
    applicationClosed: false,
  })

  // Assert
  assert.deepEqual(view, {
    status:
      'Test passed · exit code 0 · capture complete · 1 of 2 stops explained',
    position: 'Stop 1 of 2 · 0.42 s',
    explanation: 'The stop shows the delay of 5,000 ms.',
    pointer: 'Output up to this moment is in the Application pane.',
    applicationClosed: false,
    selectedStepId: 'read',
    sameMomentStepIds: ['note'],
    stepActions: {
      start: 'Inspect output · 0.10 s',
      read: 'Inspect stop 1 · 0.42 s',
      note: 'Inspect stop 1 · 0.42 s',
      verdict: 'Inspect result · 0.90 s',
    },
    events: 'Events (5)',
    verdict: 'Test passed · exit code 0',
    previousStop: false,
    nextStop: true,
    // The fixture's stops carry no captured source, so the whole range is one unrecorded span with no tick.
    timeline: {
      startMs: 100,
      endMs: 900,
      gaps: [{ startMs: 100, endMs: 900 }],
      recordedPoints: [],
    },
  })
})

// Value: protects=the step the learner chose stays shown with its event, while a choice from another event leaves that event's first step shown; fails_when=a chosen same-moment step is replaced by the first step, or a step of another event is shown at this one; why_new=DS21 keeps the selected step apart from the selected event; seam=none; no_claim=how the workspace keeps the choice across messages
test('a step the learner chose stays shown with its event and another event’s choice does not', () => {
  // Arrange
  const learning = projectNodeLearningSummary(material, history)

  // Act
  const chosen = projectNodeTestSection({
    history,
    selected: entries[1],
    selectedStopVerified: true,
    ...(learning ? { learning } : {}),
    chosenStepId: 'note',
    applicationClosed: false,
  })
  const otherEvents = projectNodeTestSection({
    history,
    selected: entries[1],
    selectedStopVerified: true,
    ...(learning ? { learning } : {}),
    chosenStepId: 'verdict',
    applicationClosed: false,
  })

  // Assert
  assert.equal(chosen.selectedStepId, 'note')
  assert.deepEqual(chosen.sameMomentStepIds, ['read'])
  assert.equal(chosen.explanation, 'The scheduler keeps the timer it created.')
  assert.equal(otherEvents.selectedStepId, 'read')
})

// Value: protects=the section says what is not explained or not recorded: an unexplained stop and an unexplained result say so, an output without a step says nothing, and an output, the result and an unverified stop carry the 4A line; fails_when=an unexplained moment reads as explained, the 4A line is missing at an output or the result, or an unverified stop claims its source; why_new=DS3 and the String catalog's 4A and unverified lines (PRODUCT_GOAL 4A); seam=none; no_claim=the recorded-source slot of PR-B2
test('unexplained and unrecorded moments say so in the section', () => {
  // Arrange
  const learning = projectNodeLearningSummary(material, history)
  const withoutVerdict = projectNodeLearningSummary(
    {
      ...material,
      content: {
        ...material.content,
        steps: material.content.steps.filter((step) => step.id !== 'verdict'),
      },
    },
    history,
  )
  const section = (
    selected: NodeTestHistoryEntry | undefined,
    selectedStopVerified: boolean,
    projection = learning,
  ) =>
    projectNodeTestSection({
      history,
      selected,
      selectedStopVerified,
      ...(projection ? { learning: projection } : {}),
      applicationClosed: false,
    })

  // Act
  const unexplainedStop = section(entries[3], true)
  const unverifiedStop = section(entries[3], false)
  const plainOutput = section(entries[2], false)
  const explainedResult = section(entries[4], false)
  const unexplainedResult = section(entries[4], false, withoutVerdict)

  // Assert
  assert.equal(
    unexplainedStop.explanation,
    'No saved explanation for this stop.',
  )
  assert.equal(unexplainedStop.notRecorded, undefined)
  assert.equal(
    unverifiedStop.notRecorded,
    'Source and debugger not recorded at this moment.',
  )
  assert.equal(
    unverifiedStop.unverified,
    'Recorded source unavailable for this stop.',
  )
  assert.equal(plainOutput.position, 'Output · 0.60 s')
  assert.equal(plainOutput.explanation, undefined)
  assert.equal(
    plainOutput.notRecorded,
    'Source and debugger not recorded at this moment.',
  )
  assert.equal(
    explainedResult.position,
    'Result · Test passed · exit code 0 · 0.90 s',
  )
  assert.equal(
    explainedResult.explanation,
    'The job ran after its timer, so the test passed.',
  )
  assert.equal(
    unexplainedResult.explanation,
    'No saved explanation for the result.',
  )
})

// Value: protects=before a selection the section offers Next stop and no Previous stop, shows no locator, and with the Application pane closed says so; fails_when=a locator or a step appears with nothing selected, Previous stop is offered, or the closed pane is not named; why_new=DS7's closed-pane line and DS12's stop navigation; seam=none; no_claim=the action that reopens the pane
test('before a selection the section offers the first stop and says when the Application pane is closed', () => {
  // Arrange
  const learning = projectNodeLearningSummary(material, history)

  // Act
  const view = projectNodeTestSection({
    history,
    selectedStopVerified: false,
    ...(learning ? { learning } : {}),
    applicationClosed: true,
  })

  // Assert
  assert.equal(view.position, undefined)
  assert.equal(view.selectedStepId, undefined)
  assert.deepEqual(view.sameMomentStepIds, [])
  assert.equal(view.pointer, 'The Application pane is closed.')
  assert.equal(view.applicationClosed, true)
  assert.equal(view.previousStop, false)
  assert.equal(view.nextStop, true)
})

// Value: protects=Previous stop and Next stop are offered only where a stop lies before or after the selected event, whatever type that event is: both at an output between two stops, only Next stop before the first stop, only Previous stop at the last stop and at the result, and neither in a replay that recorded no stop; fails_when=a side is decided by the selected event's own type or position instead of by the stops around it (an output between two stops loses a side), the first stop offers Previous stop, the last stop or the result offers Next stop, or a replay without stops offers a move the host would refuse; why_new=the section tests above assert Previous stop only as false, and its true cases exist only in the Study messages the Reader DOM check builds by hand (DS12); seam=none; no_claim=how the pane draws or disables the buttons (the Reader DOM check) or where a move lands (nodeHistoryStepTarget's tests)
test('Previous stop and Next stop are offered only where a stop lies before or after the selected event', () => {
  // Arrange
  const stopFlagsAt = (
    selected: NodeTestHistoryEntry | undefined,
    shown: typeof history = history,
  ) => {
    const { previousStop, nextStop } = projectNodeTestSection({
      history: shown,
      selected,
      selectedStopVerified: true,
      applicationClosed: false,
    })
    return { previousStop, nextStop }
  }
  const withoutStops = {
    entries: [entries[0]!, entries[2]!, entries[4]!],
    status: 'complete' as const,
  }

  // Act
  const flags = {
    atFirstOutput: stopFlagsAt(entries[0]),
    atFirstStop: stopFlagsAt(entries[1]),
    betweenStops: stopFlagsAt(entries[2]),
    atLastStop: stopFlagsAt(entries[3]),
    atResult: stopFlagsAt(entries[4]),
    withoutStops: stopFlagsAt(entries[4], withoutStops),
  }

  // Assert
  assert.deepEqual(flags, {
    atFirstOutput: { previousStop: false, nextStop: true },
    atFirstStop: { previousStop: false, nextStop: true },
    betweenStops: { previousStop: true, nextStop: true },
    atLastStop: { previousStop: true, nextStop: false },
    atResult: { previousStop: true, nextStop: false },
    withoutStops: { previousStop: false, nextStop: false },
  })
})

// Value: protects=a summary step whose id is `__proto__` (the step id schema accepts it) keeps its action label through the message to the Study pane, as an own property of the labels; fails_when=the label is assigned through the prototype's setter and dropped, so the Study pane reads Object.prototype and shows "[object Object]" on the step's control; why_new=Step 9's security review found the labels built in a plain object keyed by agent-authored step ids, and the learning summary already guards prototype-shaped ids (learningSummary.test.ts); seam=none; no_claim=the Study pane's own read, which reads only own labels
test('a summary step named __proto__ keeps its action label through the message to the Study pane', () => {
  // Arrange
  const prototypeNamed: NodeTestLearningMaterial = {
    ...material,
    content: {
      ...material.content,
      steps: [{ ...material.content.steps[1]!, id: '__proto__' }],
    },
  }
  const learning = projectNodeLearningSummary(prototypeNamed, history)

  // Act
  const view = projectNodeTestSection({
    history,
    selected: entries[1]!,
    selectedStopVerified: true,
    ...(learning ? { learning } : {}),
    applicationClosed: false,
  })
  const posted: Record<string, string> = JSON.parse(
    JSON.stringify(view.stepActions),
  )

  // Assert
  assert.equal(Object.hasOwn(posted, '__proto__'), true)
  assert.equal(posted['__proto__'], 'Inspect stop 1 · 0.42 s')
  assert.equal(view.selectedStepId, '__proto__')
})

// Value: protects=an interrupted or partial test replay tells why its capture ended, on its own line under the status, in the String catalog's words (no "Node", DS14), and a complete capture or a missing reason shows no such line; fails_when=the reason is dropped (the regression of PR-B1), a "Node history" survives into the line, or a complete capture shows a reason; why_new=F130: the old status line added the history's reason and the section lost it; seam=none; no_claim=how the pane places the line (the Reader DOM check)
test('an interrupted or partial capture shows its reason in test replay words and a complete one shows none', () => {
  // Arrange
  const reasoned = (
    status: 'complete' | 'partial' | 'interrupted',
    reason?: string,
  ) => ({
    history: { ...history, status, ...(reason ? { reason } : {}) },
    selectedStopVerified: false,
    applicationClosed: false,
  })

  // Act
  const interrupted = projectNodeTestSection(
    reasoned(
      'interrupted',
      'Interrupted Node history after its verified prefix: Error: EIO',
    ),
  )
  const partial = projectNodeTestSection(
    reasoned('partial', 'The debugger\nended the Node test history early.'),
  )
  const complete = projectNodeTestSection(
    reasoned('complete', 'A reason a complete capture never shows.'),
  )
  const withoutReason = projectNodeTestSection(reasoned('partial'))

  // Assert
  assert.equal(
    interrupted.captureReason,
    'Capture interrupted: Interrupted test replay after its verified prefix: Error: EIO',
  )
  assert.equal(
    partial.captureReason,
    'Capture partial: The debugger ended the test replay early.',
  )
  assert.equal(complete.captureReason, undefined)
  assert.equal(withoutReason.captureReason, undefined)
})
