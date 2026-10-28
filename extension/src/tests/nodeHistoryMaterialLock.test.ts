import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import fsPromises, { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { NodeLearningRevisionChangedError } from '../errors'
import type { NodeServerLearningMaterialContent } from '../nodeServerLearningSchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  HANDLER_SOURCE_TEXT,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/** A server learning material citing the given entries: the request, a stop and the response. */
function serverMaterial(
  cites: {
    request: number
    stop: number
    response?: number
  },
  title = 'Creating an item',
): NodeServerLearningMaterialContent {
  const stopHash = sha256(HANDLER_SOURCE_TEXT)
  return {
    question: 'How does the server create an item?',
    title,
    summary: 'The handler reads the id, loads the item and returns it.',
    participants: [
      { id: 'client', label: 'Codebook request' },
      { id: 'server', label: 'Handler' },
    ],
    steps: [
      {
        id: 'request',
        from: 'client',
        to: 'server',
        label: 'POST /api/items',
        explanation: 'Codebook sends the declared request.',
        evidence: 'observed',
        reference: { type: 'request', sequence: cites.request },
      },
      {
        id: 'stop',
        from: 'server',
        to: 'server',
        label: 'load the item',
        explanation: 'The handler stops after reading the id.',
        evidence: 'observed',
        reference: {
          type: 'stop',
          sequence: cites.stop,
          sourceHash: stopHash,
        },
      },
      ...(cites.response
        ? [
            {
              id: 'response',
              from: 'server',
              to: 'client',
              label: '201',
              explanation: 'The server answers 201.',
              evidence: 'observed' as const,
              reference: {
                type: 'response' as const,
                sequence: cites.response,
              },
            },
          ]
        : []),
    ],
  }
}

/** Two windows over one learning directory: each its own repository and stores. */
async function twoWindows(context: TestContext) {
  const first = await openServerRepository(context)
  const second = await openServerRepository(context, {
    learningDirectory: first.learningDirectory,
  })
  return { first, second }
}

// protects=two windows saving the same revision of a server history's material get one success and one conflict; fails_when=both saves succeed and the later silently replaces the earlier, or neither reports the current revision; no_claim=a test history (its own test below)
test('two windows save the same revision of a server learning material and exactly one succeeds', async (context) => {
  // Arrange
  const { first, second } = await twoWindows(context)
  const { header, sequences } = await writeServerHistory(first.repository)
  const content = serverMaterial({
    request: sequences.request,
    stop: sequences.stops[0]!,
    response: sequences.response,
  })

  // Act
  const results = await Promise.allSettled([
    first.repository.serverHistories.saveLearningMaterial(
      header.studyId,
      0,
      content,
    ),
    second.repository.serverHistories.saveLearningMaterial(
      header.studyId,
      0,
      serverMaterial(
        {
          request: sequences.request,
          stop: sequences.stops[0]!,
          response: sequences.response,
        },
        'Another title',
      ),
    ),
  ])

  // Assert
  assert.deepEqual(results.map((result) => result.status).sort(), [
    'fulfilled',
    'rejected',
  ])
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected?.reason instanceof NodeLearningRevisionChangedError)
  assert.match(String(rejected.reason), /expected 0, current 1/)
  const stored = await first.repository.serverHistories.readLearningMaterial(
    header.studyId,
  )
  assert.equal(stored?.revision, 1)
})

// protects=two windows saving the same revision of a test history's material get one success and one conflict under the storage lock; fails_when=the second window's read passes before the first window's write; no_claim=server histories (their own test above)
test('two windows save the same revision of a test learning material and exactly one succeeds', async (context) => {
  // Arrange
  const { first } = await twoWindows(context)
  const key = sha256('node-history-test-workspace')
  const storeFor = () => new NodeTestHistoryStore(first.learningDirectory, key)
  const [one, other] = [storeFor(), storeFor()]
  const header = nodeTestHistoryHeader(key)
  const writer = await one.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'RUN',
  })
  await writer.finish('partial', 'The learner stopped this run.')
  const content = {
    question: 'Why dark?',
    title: 'Theme',
    summary: 'The theme turns dark.',
    participants: [{ id: 'ui', label: 'Theme' }],
    steps: [
      {
        id: 's1',
        from: 'ui',
        to: 'ui',
        label: 'run',
        explanation: 'The run starts.',
        evidence: 'observed' as const,
        reference: {
          type: 'output' as const,
          sequence: 1,
          channel: 'stdout' as const,
        },
      },
    ],
  }

  // Act
  const results = await Promise.allSettled([
    one.saveLearningMaterial(header.studyId, 0, content),
    other.saveLearningMaterial(header.studyId, 0, content),
  ])

  // Assert
  assert.deepEqual(results.map((result) => result.status).sort(), [
    'fulfilled',
    'rejected',
  ])
})

// protects=a material saved in another window shows in this window's library summary without a restart; fails_when=this window keeps its memoized summary of the history before the save; no_claim=the Study pane's refresh
test('a server learning material saved in another window shows its title and coverage in this window', async (context) => {
  // Arrange
  const { first, second } = await twoWindows(context)
  const { header, sequences } = await writeServerHistory(first.repository)
  const [before] = await first.repository.serverHistories.list()

  // Act
  await second.repository.serverHistories.saveLearningMaterial(
    header.studyId,
    0,
    serverMaterial({
      request: sequences.request,
      stop: sequences.stops[0]!,
      response: sequences.response,
    }),
  )
  const [after] = await first.repository.serverHistories.list()

  // Assert
  assert.equal(before?.title, undefined)
  assert.equal(before?.learningCoverage, 'none')
  assert.equal(after?.title, 'Creating an item')
  assert.equal(after?.learningCoverage, 'complete')
  assert.equal(after?.materialRevision, 1)
})

// protects=a server material that cites a missing or mismatched entry is refused with the offending reference and the nearest valid sequences; fails_when=it saves, or the refusal does not tell the agent which sequence to cite; no_claim=the MCP tool's wording (published by the producer part)
test('a server learning material citing a stop as the response is refused with the nearest valid response sequences', async (context) => {
  // Arrange
  const { first } = await twoWindows(context)
  const { header, sequences } = await writeServerHistory(first.repository)
  const content = serverMaterial({
    request: sequences.request,
    stop: sequences.stops[0]!,
    // The sequence of the stop, claimed as the response.
    response: sequences.stops[0]!,
  })

  // Act
  const refused = first.repository.serverHistories.saveLearningMaterial(
    header.studyId,
    0,
    content,
  )

  // Assert
  await assert.rejects(refused, (error: Error) => {
    assert.equal((error as { code?: string }).code, 'INVALID_REFERENCE')
    assert.match(
      error.message,
      new RegExp(
        `sequence ${sequences.stops[0]} is a stop at src/handler.ts:2 in the sealed history, but the step claims the response\\. Nearest valid sequences for the response: ${sequences.response}\\.`,
      ),
    )
    return true
  })
})

// protects=a save racing a move of the history's folder to the Trash never resurrects the folder; fails_when=the material write recreates the folder path the Trash moved away; no_claim=the Trash itself
test('a material save racing a Trash move leaves no folder behind', async (context) => {
  // Arrange
  const { first } = await twoWindows(context)
  const { header, sequences } = await writeServerHistory(first.repository)
  const folder = join(
    first.learningDirectory,
    'node-servers.v1',
    header.studyId,
  )
  const trash = join(first.learningDirectory, 'trash')
  await mkdir(trash)
  const renameBefore = fsPromises.rename
  let moved = false
  context.mock.method(
    fsPromises,
    'rename',
    async (...input: Parameters<typeof renameBefore>) => {
      // The learner's Trash move lands between the revision check and the publication.
      if (!moved && String(input[1]).endsWith('learning-material.json')) {
        moved = true
        await renameBefore(folder, join(trash, header.studyId))
      }
      return renameBefore(...input)
    },
  )

  // Act
  const refused = first.repository.serverHistories.saveLearningMaterial(
    header.studyId,
    0,
    serverMaterial({
      request: sequences.request,
      stop: sequences.stops[0]!,
      response: sequences.response,
    }),
  )

  // Assert
  await assert.rejects(refused, /ENOENT/)
  context.mock.restoreAll()
  assert.equal(existsSync(folder), false)
  assert.deepEqual(
    await readdir(join(first.learningDirectory, 'node-servers.v1')),
    [],
  )
  void rename
})
