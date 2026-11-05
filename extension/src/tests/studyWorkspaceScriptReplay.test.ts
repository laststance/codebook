import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'

import { workspaceHarness } from './studyWorkspaceHarness'
import {
  runScriptHistory,
  scriptMaterialCiting,
} from './utils/nodeScriptHistoryFixture'
import { HANDLER_SOURCE_TEXT } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import {
  openServerReplay,
  repositoryOf,
  selectEvent,
  slotUri,
} from './utils/serverWorkspaceHarness'
import { shownApplicationView } from './utils/shownTestOutput'
import { lastView } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/**
 * Reads the journal sequences of a saved script history by entry type, so a test cites the moments it opens.
 * @param harness - The workspace harness.
 * @param studyId - The script history's study id.
 * @returns The sequences of the stop, output and end entries, in journal order.
 * @example (await sequencesOf(harness, studyId)).end // => 4
 */
async function sequencesOf(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  studyId: string,
) {
  const { entries } = await repositoryOf(harness).scriptHistories.read(studyId)
  const of = (type: 'stop' | 'output' | 'end') =>
    entries
      .filter((entry) => entry.type === type)
      .map((entry) => entry.sequence)
  return { stops: of('stop'), output: of('output'), end: of('end')[0]! }
}

// protects=a saved Script replay opens from the library on its first recorded stop with the recorded source in the slot and the recorded values in the debugger, worded as a script replay; fails_when=the replay does not open, opens on another moment, shows the server catalog, or the slot and debugger lack the recorded source and stack; no_claim=the native editor's drawing of the slot
test('Open replay of a saved Script replay lands on its first stop with the recorded source in the slot and the recorded stack in the debugger', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 1,
        hits: [0],
        output: ['seeding\n'],
        end: {
          kind: 'exited',
          exitCode: 0,
          stopsReached: [0],
          stopsNeverReached: [],
        },
      },
      repositoryOf(harness),
    )

    // Act
    await openServerReplay(harness, studyId)
    const view = lastView(harness)
    const presented = harness.historicalDebugPresentations.at(-1)

    // Assert
    assert.equal(view?.nodeReplayProfile, 'node-script')
    assert.equal(view?.nodeHistorySection?.position, 'Stop 1 · 0.03 s')
    assert.equal(
      view?.nodeHistorySection?.status,
      'Exited with code 0 · capture complete · 0 of 1 stops explained',
    )
    assert.deepEqual(
      view?.nodeServerEvents?.map((event) => event.heading),
      [
        'Output · stdout · 0.02 s',
        'Stop 1 · src/handler.ts:2:1 · 0.03 s',
        'Exited with code 0 · 0.04 s',
      ],
    )
    assert.equal(
      presented?.snapshot?.frames[0]?.source?.text,
      HANDLER_SOURCE_TEXT,
    )
    assert.equal(harness.documentTextOf(slotUri(harness)), HANDLER_SOURCE_TEXT)
    assert.equal(presented?.snapshot?.frames[0]?.name, 'handler')
  } finally {
    await harness.close()
  }
})

// protects=the end of a script run takes the place of a response: the Application pane's end region says how the run ended once the replay reaches the end, and a summary step citing a stop and the end links to each moment; fails_when=the pane shows a request or response region, the end reads before it is reached, or a step does not move the playhead; no_claim=the diagram's drawing
test('the Application pane of a Script replay shows no request, the end only once reached, and the summary steps link to the stop and the end', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 1,
        hits: [0],
        output: ['seeding\n'],
        end: {
          kind: 'exited',
          exitCode: 3,
          stopsReached: [0],
          stopsNeverReached: [],
        },
      },
      repository,
    )
    const sequences = await sequencesOf(harness, studyId)
    await openServerReplay(harness, studyId)
    const atStop = shownApplicationView(harness)
    const material = await repository.scriptHistories.saveLearningMaterial(
      studyId,
      0,
      scriptMaterialCiting([
        {
          type: 'stop',
          sequence: sequences.stops[0]!,
          sourceHash: sha256(HANDLER_SOURCE_TEXT),
        },
        { type: 'end', sequence: sequences.end },
      ]),
    )
    harness.reader.nodeHistoryLearningMaterialSaved(studyId, material)

    // Act
    await selectEvent(harness, studyId, sequences.end, 'step-2')
    const atEnd = shownApplicationView(harness)
    const sectionAtEnd = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(atStop?.profile, 'node-script')
    assert.equal(atStop?.name, 'Script replay · scripts/seed.mjs')
    assert.equal(atStop?.request, undefined)
    assert.equal(
      atStop?.response?.state,
      'The run had not ended at this moment.',
    )
    assert.equal(atEnd?.response?.state, 'Exited with code 3')
    assert.equal(sectionAtEnd?.selectedStepId, 'step-2')
    assert.equal(
      sectionAtEnd?.notRecorded,
      'Source and debugger not recorded at this moment.',
    )
    assert.deepEqual(sectionAtEnd?.stepActions, {
      'step-1': 'Inspect Stop 1 · 0.03 s',
      'step-2': 'Show end · 0.04 s',
    })
  } finally {
    await harness.close()
  }
})

// protects=a moment of a Script replay with no recorded stop (an output line) shows the 4A state and no recorded stack; fails_when=the output moment keeps the stop's source or lacks the not-recorded line; no_claim=the placeholder document's layout
test('seeking a Script replay to an output line shows that source and debugger were not recorded at this moment', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 1,
        hits: [0],
        output: ['seeding\n'],
        end: {
          kind: 'exited',
          exitCode: 0,
          stopsReached: [0],
          stopsNeverReached: [],
        },
      },
      repositoryOf(harness),
    )
    const sequences = await sequencesOf(harness, studyId)
    await openServerReplay(harness, studyId)

    // Act
    await selectEvent(harness, studyId, sequences.output[0]!)
    const section = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(section?.position, 'Output · 0.02 s')
    assert.equal(
      section?.notRecorded,
      'Source and debugger not recorded at this moment.',
    )
    assert.equal(shownApplicationView(harness)?.lines[0]?.text, 'seeding')
  } finally {
    await harness.close()
  }
})

// protects=a partial run whose second declared stop was never reached opens and names that stop as never reached; fails_when=the partial run does not open, reads as complete, or hides the missing stop; no_claim=the wording of the seal reasons beyond naming a script replay
test('a Script replay of a partial run opens and names the stop that was never reached', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 2,
        hits: [0],
        end: {
          kind: 'exited',
          exitCode: 0,
          stopsReached: [0],
          stopsNeverReached: [1],
        },
      },
      repositoryOf(harness),
    )
    const sequences = await sequencesOf(harness, studyId)

    // Act
    await openServerReplay(harness, studyId)
    await selectEvent(harness, studyId, sequences.end)
    const view = lastView(harness)

    // Assert
    assert.equal(view?.nodeHistory?.status, 'partial')
    assert.equal(
      shownApplicationView(harness)?.response?.note,
      'Stops never reached: 2.',
    )
    assert.match(
      view?.nodeHistorySection?.captureReason ?? '',
      /^Capture partial: /,
    )
  } finally {
    await harness.close()
  }
})

// protects=a run that spent its capture budget labels the stop it could not watch as not observed, never as never reached; fails_when=the later stop is worded as never reached or the budget note is missing; no_claim=the budget size
test('a Script replay of a run that spent its capture budget labels the later stop as not observed', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 2,
        hits: [0],
        budgetExhausted: true,
        end: {
          kind: 'exited',
          exitCode: 0,
          stopsReached: [0],
          stopsNeverReached: [],
          captureBudgetExhausted: true,
          stopsNotObserved: [1],
        },
      },
      repositoryOf(harness),
    )
    const sequences = await sequencesOf(harness, studyId)

    // Act
    await openServerReplay(harness, studyId)
    await selectEvent(harness, studyId, sequences.end)

    // Assert
    assert.equal(
      shownApplicationView(harness)?.response?.note,
      'Stops not observed after the capture budget was spent: 2.',
    )
  } finally {
    await harness.close()
  }
})

// protects=a Script replay is not deletable from Saved studies, as a server replay is not, and it says so in script words; fails_when=a script replay is offered for deletion or is called a test or server replay; no_claim=the delete button's drawing
test('a Script replay cannot be deleted from Saved studies and the refusal names a script replay', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { studyId } = await runScriptHistory(
      context,
      {
        declaredStops: 1,
        hits: [0],
        end: {
          kind: 'exited',
          exitCode: 0,
          stopsReached: [0],
          stopsNeverReached: [],
        },
      },
      repositoryOf(harness),
    )
    await harness.reader.action('retry')

    // Act
    const refusal = harness.reader['studyRemovalRefusal'](studyId)

    // Assert
    assert.equal(refusal, 'Script replays cannot be deleted here yet.')
  } finally {
    await harness.close()
  }
})
