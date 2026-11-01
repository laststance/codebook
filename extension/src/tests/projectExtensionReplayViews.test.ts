import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { adaptExtensionReplay } from '../utils/adaptExtensionReplay'
import { projectExtensionReplayViews } from '../utils/projectExtensionReplayViews'

import {
  EXTENSION_WORKSPACE_KEY,
  openExtensionStore,
} from './utils/chromeExtensionHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeExtensionHistory } from './utils/sealedExtensionHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/** A sealed history of two stops, each with a pinned frame, presented as the workspace presents it. */
async function presentedTwoStops(
  context: Parameters<typeof openExtensionStore>[0],
) {
  const { store, learningDirectory } = await openExtensionStore(context)
  const written = await writeExtensionHistory(
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    [
      { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      { at: 110, type: 'frame', kind: 'pin', pauseId: 'p1', salt: 'pin1' },
      { at: 200, type: 'close', pauseId: 'p1' },
      { at: 300, type: 'open', pauseId: 'p2', stopIndex: 2, context: 'page' },
      { at: 310, type: 'frame', kind: 'pin', pauseId: 'p2', salt: 'pin2' },
      { at: 400, type: 'close', pauseId: 'p2' },
    ],
  )
  const replay = adaptExtensionReplay(await store.read(written.studyId))
  return {
    replay,
    firstOpen: written.sequences[0]!,
    secondOpen: written.sequences[3]!,
  }
}

/** The Application view of the first stop, optionally while the selection leaves for the second. */
function applicationOf(
  presented: Awaited<ReturnType<typeof presentedTwoStops>>,
  isLeaving: boolean,
) {
  const { replay, firstOpen, secondOpen } = presented
  return projectExtensionReplayViews({
    replay,
    selected: replay.history.entries.find(
      (entry) => entry.sequence === firstOpen,
    ),
    leavingPosition: isLeaving
      ? replay.model.indexBySequence.get(secondOpen)
      : undefined,
    opening: false,
    shownFrame: { sequence: firstOpen, src: 'data:image/png;base64,AAAA' },
    memo: undefined,
    nextGeneration: () => 1,
    applicationClosed: false,
    timeline: undefined,
  }).views.nodeHistoryApplication
}

// protects=while a seek leaves a stop the pane does not claim the kept image was captured at the next stop; fails_when=the earlier stop's caption stays under its image during the leaving state; no_claim=the pixels
test('while the replay leaves a stop the kept frame reads as loading, without a time or a stop claim', async (context) => {
  // Arrange
  const presented = await presentedTwoStops(context)

  // Act
  const view = applicationOf(presented, true)

  // Assert
  assert.equal(view?.time, 'Recorded extension frame')
  assert.equal(view?.frame?.label, 'Loading the recorded extension frame…')
  assert.equal(view?.frame?.src, 'data:image/png;base64,AAAA')
})

// protects=a settled stop still reads its time and that its frame was captured at the stop; fails_when=the loading wording leaks into a settled moment; no_claim=the pixels
test('a settled stop reads its time and that its frame was captured at the stop', async (context) => {
  // Arrange
  const presented = await presentedTwoStops(context)

  // Act
  const view = applicationOf(presented, false)

  // Assert
  assert.match(view?.time ?? '', /^Recorded extension frame · \d+\.\d+ s$/)
  assert.equal(view?.frame?.label, 'Recorded frame captured at this stop')
})
