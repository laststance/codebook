import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { nodeServerHistoryHeader } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import {
  repositoryOf,
  type ServerWorkspaceHarness as Harness,
} from './utils/serverWorkspaceHarness'

before(async () => {
  await realProcessStart(process.pid)
})

/** The Saved studies rows of the reader's current view, by study id. */
function rowOf(harness: Harness, studyId: string) {
  return harness.reader
    .inspect()
    .view!.studies.find((entry) => entry.id === studyId)
}

// protects=a saved server replay is listed in Saved studies with its question first, its request line and answer, and its status; fails_when=the row is missing, worded as a test replay, or does not name the request and its status; no_claim=the Study pane's rendering of the row
test('Saved studies lists a server replay by its question, request line, response status and Partial status before the chat explained it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: harness.service.nodeHistoryStore!.workspaceKey,
      question: 'How does the server create an item?',
    })

    // Act
    await harness.reader.action('retry')
    const row = rowOf(harness, header.studyId)

    // Assert
    assert.equal(
      row?.outcome,
      "How does the server create an item? · Server replay · POST /api/items → 201 · Partial: the chat's explanation is not saved yet",
    )
    assert.equal(row?.profile, 'node-server')
  } finally {
    await harness.close()
  }
})

// protects=a server row leads with the saved learning title and reads Saved once the explanation covers the capture, and two replays of one route are told apart by what they explain; fails_when=the title is not used, two rows of one route read the same, or the status stays Partial; no_claim=a partial capture
test('two server replays of one route are told apart by their saved learning titles and read Saved', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const workspaceKey = harness.service.nodeHistoryStore!.workspaceKey
    const first = await writeServerHistory(repository, { workspaceKey })
    const second = await writeServerHistory(repository, { workspaceKey })
    const material = (
      title: string,
      sequences: { request: number; stops: number[]; response?: number },
    ) => ({
      question: 'How does the server create an item?',
      title,
      summary: 'The handler creates the item.',
      participants: [{ id: 'server', label: 'Handler' }],
      steps: [
        {
          id: 'request',
          from: 'server',
          to: 'server',
          label: 'request',
          explanation: 'Codebook sends the request.',
          evidence: 'observed' as const,
          reference: { type: 'request' as const, sequence: sequences.request },
        },
        {
          id: 'stop',
          from: 'server',
          to: 'server',
          label: 'stop',
          explanation: 'The handler stops.',
          evidence: 'observed' as const,
          reference: {
            type: 'stop' as const,
            sequence: sequences.stops[0]!,
            sourceHash: sha256(
              'export function handler(req) {\n  const id = req.params.id\n  const item = load(id)\n  return item\n}\n',
            ),
          },
        },
        {
          id: 'response',
          from: 'server',
          to: 'server',
          label: 'response',
          explanation: 'The server answers.',
          evidence: 'observed' as const,
          reference: {
            type: 'response' as const,
            sequence: sequences.response!,
          },
        },
      ],
    })

    // Act
    await repository.serverHistories.saveLearningMaterial(
      first.header.studyId,
      0,
      material('Creating an item with a name', first.sequences),
    )
    await repository.serverHistories.saveLearningMaterial(
      second.header.studyId,
      0,
      material('Creating an item twice', second.sequences),
    )
    await harness.reader.action('retry')

    // Assert
    assert.equal(
      rowOf(harness, first.header.studyId)?.outcome,
      'Creating an item with a name · Server replay · POST /api/items → 201 · Saved',
    )
    assert.equal(
      rowOf(harness, second.header.studyId)?.outcome,
      'Creating an item twice · Server replay · POST /api/items → 201 · Saved',
    )
  } finally {
    await harness.close()
  }
})

// protects=a partial server capture shows its first reason and the count of the others in its row; fails_when=the row hides the reason or lists every reason; no_claim=the full reasons (the replay's capture line lists them all)
test('a server replay stopped before its answer lists its first reason and the count of the others', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: harness.service.nodeHistoryStore!.workspaceKey,
      declaredStops: 2,
      response: null,
    })

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.equal(
      rowOf(harness, header.studyId)?.outcome,
      'How does the server create an item? · Server replay · POST /api/items → no response · Partial: No response was recorded: the run was stopped before the server answered. (+1 more)',
    )
  } finally {
    await harness.close()
  }
})

// protects=a server replay cannot be deleted from Saved studies, as a test replay cannot, and the refusal says server replay; fails_when=the delete request moves its files to the Trash or answers with the test words; no_claim=deletion of a test replay
test('deleting a server replay is refused in server words and moves nothing to the Trash', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: harness.service.nodeHistoryStore!.workspaceKey,
    })
    await harness.reader.action('retry')

    // Act
    await readerSeams(harness).receive(
      {
        type: 'delete-study',
        revision: harness.reader.inspect().view!.revision,
        studyId: header.studyId,
      },
      'context',
    )

    // Assert
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyRemoval),
      {
        status: 'refused',
        studyId: header.studyId,
        text: 'Server replays cannot be deleted here yet.',
      },
    )
    assert.deepEqual(harness.trashMoves, [])
    assert.deepEqual(harness.warningDialogs, [])
  } finally {
    await harness.close()
  }
})

// protects=a server history another window is still recording lists as recording and its row names no result; fails_when=it lists as interrupted or partial while its writer lives; no_claim=opening it
test('a server history another window records lists as Recording with its request line', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const writer = await repository.serverHistories.start(
      nodeServerHistoryHeader(harness.service.nodeHistoryStore!.workspaceKey),
    )
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: '/api/items',
      bodyBytes: 14,
    })

    // Act
    await harness.reader.action('retry')
    const row = harness.reader
      .inspect()
      .view!.studies.find((entry) => entry.profile === 'node-server')
    writer.abandon()

    // Assert
    assert.equal(
      row?.outcome,
      'How does the server create an item? · Server replay · POST /api/items · Recording',
    )
  } finally {
    await harness.close()
  }
})
