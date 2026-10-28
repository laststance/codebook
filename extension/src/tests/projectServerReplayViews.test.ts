import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { presentServerHistory } from '../utils/presentServerHistory'
import { projectServerReplayViews } from '../utils/projectServerReplayViews'

import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/** A sealed fixture history presented as the workspace presents it, with the entries the test-shaped view holds. */
async function presented(context: Parameters<typeof openServerRepository>[0]) {
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository, {
    output: ['created\n'],
  })
  const store = repository.serverHistories
  const replay = presentServerHistory(
    await store.read(header.studyId),
    await store.summarize(header.studyId),
  )
  return { replay, sequences }
}

/** The input of one projection at the entry with `sequence`, counting how often a view generation is taken. */
function inputAt(
  replay: Awaited<ReturnType<typeof presented>>['replay'],
  sequence: number,
  options: {
    memo?: Parameters<typeof projectServerReplayViews>[0]['memo']
  } = {},
) {
  const generations = { taken: 0 }
  const input: Parameters<typeof projectServerReplayViews>[0] = {
    replay,
    selected: replay.history.entries.find(
      (entry) => entry.sequence === sequence,
    ),
    leavingPosition: undefined,
    opening: false,
    memo: options.memo,
    nextGeneration: () => ++generations.taken,
    learningMaterial: undefined,
    sectionContext: () => ({ applicationClosed: false, marks: {} }),
  }
  return { input, generations }
}

// protects=the Application view is projected once per shown moment and reused while the moment is the same; fails_when=every refresh projects the whole output again and takes a new generation; no_claim=the pane's drawing
test('the Application view of one moment is projected once and reused on the next refresh', async (context) => {
  // Arrange
  const { replay, sequences } = await presented(context)
  const first = inputAt(replay, sequences.stops[0]!)
  const { memo } = projectServerReplayViews(first.input)
  const again = inputAt(replay, sequences.stops[0]!, { memo })

  // Act
  const second = projectServerReplayViews(again.input)

  // Assert
  assert.equal(first.generations.taken, 1)
  assert.equal(again.generations.taken, 0)
  assert.equal(second.memo, memo)
})

// protects=a new shown moment takes a new generation and a new view; fails_when=a moved playhead keeps the earlier moment's view; no_claim=the contents of the view
test('moving to another moment projects a new Application view with the next generation', async (context) => {
  // Arrange
  const { replay, sequences } = await presented(context)
  const { memo } = projectServerReplayViews(
    inputAt(replay, sequences.stops[0]!).input,
  )
  const moved = inputAt(replay, sequences.response!, { memo })

  // Act
  const result = projectServerReplayViews(moved.input)

  // Assert
  assert.equal(moved.generations.taken, 1)
  assert.notEqual(result.memo.key, memo.key)
  assert.equal(
    result.views.nodeHistoryApplication?.response?.state,
    'Response 201 · application/json',
  )
})

// protects=a selection that is going to another event names its position with the loading suffix and the Application header while it loads; fails_when=the pending moment shows the old event's position without the loading mark; no_claim=the load itself
test('a selection going to the response reads the response position with the loading suffix', async (context) => {
  // Arrange
  const { replay, sequences } = await presented(context)
  const responsePosition = replay.shownModel.indexBySequence.get(
    sequences.response!,
  )
  const { input } = inputAt(replay, sequences.stops[0]!)

  // Act
  const result = projectServerReplayViews({
    ...input,
    leavingPosition: responsePosition,
  })

  // Assert
  assert.match(result.views.nodeHistorySection?.position ?? '', / · loading…$/)
})
