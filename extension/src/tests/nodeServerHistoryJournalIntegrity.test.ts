import assert from 'node:assert/strict'
import fsPromises, { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import type { NodeServerHistoryEntryInput } from '../nodeServerHistorySchemas'
import { nodeServerStorageDescriptor } from '../nodeServerStorageDescriptor'
import { advanceHistoryScan } from '../utils/recordingJournalScan'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  serverStopCapture,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const request: NodeServerHistoryEntryInput = {
  type: 'request',
  elapsedMs: 1,
  attempt: 1,
  method: 'POST',
  path: '/x',
  bodyBytes: 0,
}
const sent: NodeServerHistoryEntryInput = {
  type: 'request-sent',
  elapsedMs: 2,
  attempt: 1,
}

/** A source entry and a stop of the fixture handler, by declared stop and hit. */
function sourceAndStop(
  hit: number,
  elapsedMs: number,
): NodeServerHistoryEntryInput[] {
  const capture = serverStopCapture({
    declaredStopIndex: 0,
    hit,
    line: 2,
    elapsedMs,
  })
  const [top] = capture.snapshot.frames
  const stop: NodeServerHistoryEntryInput = {
    type: 'stop',
    elapsedMs,
    declaredStopIndex: 0,
    hit,
    generation: hit,
    source: capture.source,
    frame: { name: 'handler' },
    facts: capture.facts,
    unavailable: [],
    debuggerSnapshot: {
      ...capture.snapshot,
      frames: [{ ...top!, source: { ...top!.source!, text: '' } }],
    },
  }
  const source: NodeServerHistoryEntryInput = {
    type: 'source',
    elapsedMs,
    path: capture.source.path,
    hash: capture.source.hash,
    text: top!.source!.text,
  }
  return hit === 1 ? [source, stop] : [stop]
}

const response: NodeServerHistoryEntryInput = {
  type: 'response',
  elapsedMs: 30,
  status: 200,
  contentType: null,
  body: '',
  bodyBytes: 0,
  readCut: false,
  location: null,
  requestDurationMs: 5,
}
const end: NodeServerHistoryEntryInput = {
  type: 'end',
  elapsedMs: 40,
  reason: 'stopped',
}

/** Each journal with the number of entries every reader must accept before it refuses the rest. */
const JOURNALS: Array<{
  name: string
  entries: NodeServerHistoryEntryInput[]
  accepted: number
}> = [
  {
    name: 'a whole run',
    entries: [request, sent, ...sourceAndStop(1, 10), response, end],
    accepted: 6,
  },
  {
    name: 'a stop before the request',
    entries: [...sourceAndStop(1, 1), request],
    accepted: 1,
  },
  {
    name: 'a response before its request was sent',
    entries: [request, response],
    accepted: 1,
  },
  {
    name: 'a stop whose source entry is missing',
    entries: [request, sent, sourceAndStop(1, 10)[1]!],
    accepted: 2,
  },
  {
    name: 'time moving back',
    entries: [request, { ...sent, elapsedMs: 0.5 }],
    accepted: 1,
  },
  {
    name: 'an entry after the end',
    entries: [
      request,
      end,
      { type: 'output', elapsedMs: 50, channel: 'stdout', text: 'late' },
    ],
    accepted: 2,
  },
  {
    name: 'a repeated source entry',
    entries: [request, sent, ...sourceAndStop(1, 10), sourceAndStop(1, 11)[0]!],
    accepted: 4,
  },
]

/** Runs one journal through the writer, the incremental scan and the full read, each on its own folder. */
async function acceptedByEachReader(
  context: TestContext,
  entries: NodeServerHistoryEntryInput[],
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const store = repository.serverHistories
  // The writer: entries offered one after another; the first refusal ends the timeline.
  const writerHeader = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await store.start(writerHeader)
  let throughWriter = 0
  for (const entry of entries) {
    const accepted = await writer.appendEntry(entry).then(
      () => true,
      () => false,
    )
    if (!accepted) break
    throughWriter++
  }
  writer.abandon()
  // The scan and the read: the same journal as lines of a folder no writer holds.
  const folderHeader = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const folderWriter = await store.start(folderHeader)
  folderWriter.abandon()
  const journalPath = join(
    learningDirectory,
    'node-servers.v1',
    folderHeader.studyId,
    'events.jsonl',
  )
  const lines = entries.map((entry, index) =>
    JSON.stringify({ ...entry, sequence: index + 1 }),
  )
  await writeFile(journalPath, `${lines.join('\n')}\n`)
  const scan = await advanceHistoryScan(
    undefined,
    nodeServerStorageDescriptor.parseHeader({
      ...folderHeader,
      formatVersion: 1,
    }),
    'signal',
    journalPath,
    String,
    nodeServerStorageDescriptor.scanRules,
    'Interrupted:',
  )
  const read = await store.read(folderHeader.studyId)
  return {
    throughWriter,
    throughScan: scan.progress.entryCount,
    throughRead: read.entries.length,
  }
}

for (const journal of JOURNALS) {
  // protects=the writer, the incremental scan and the full read accept the same journals; fails_when=any of the three accepts an entry another refuses; no_claim=the wording of the refusal
  test(`the writer, the scan and the read accept the same ${journal.accepted} entries of ${journal.name}`, async (context) => {
    // Arrange
    const expected = {
      throughWriter: journal.accepted,
      throughScan: journal.accepted,
      throughRead: journal.accepted,
    }

    // Act
    const accepted = await acceptedByEachReader(context, journal.entries)

    // Assert
    assert.deepEqual(accepted, expected)
  })
}

// protects=a torn last line is cut at the verified prefix of an unsealed history; fails_when=a half-written line fails the open or its bytes are read as an entry; no_claim=sealed histories
test('an unsealed server history with a torn last line opens its verified prefix as interrupted', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendEntry(request)
  await writer.appendEntry(sent)
  writer.abandon()
  await appendFile(
    join(learningDirectory, 'node-servers.v1', header.studyId, 'events.jsonl'),
    '{"type":"output","sequence":3,"elapsedMs":3,"chan',
  )

  // Act
  const opened = await repository.serverHistories.read(header.studyId)

  // Assert
  assert.equal(opened.entries.length, 2)
  assert.equal(opened.status, 'interrupted')
})

// protects=a sealed history whose journal changed stays refused and is never shown as interrupted; fails_when=an edited sealed journal opens as a prefix; no_claim=unsealed histories
test('a sealed server history whose journal was edited stays refused and its summary reads unavailable, not interrupted', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendEntry(request)
  await writer.seal({ elapsedMs: 5, reason: 'stopped' })
  const journalPath = join(
    learningDirectory,
    'node-servers.v1',
    header.studyId,
    'events.jsonl',
  )
  await writeFile(
    journalPath,
    (await readFile(journalPath, 'utf8')).replace('/x', '/y'),
  )

  // Act
  const reading = assert.rejects(
    repository.serverHistories.read(header.studyId),
    /Sealed Node history journal is corrupt/,
  )
  const summary = await repository.serverHistories.summarize(header.studyId)

  // Assert
  await reading
  assert.equal(summary?.verification, 'unavailable')
  assert.equal(summary?.status, 'partial')
  assert.match(summary?.reason ?? '', /integrity check failed/i)
})

// protects=a history whose append failed has no end and reads as a valid partial with the append reason; fails_when=it reads as corrupt or complete; no_claim=which disk error
test('a server history whose append failed seals partial without an end and names the entry before the gap', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendEntry(request)
  const openBefore = fsPromises.open
  let failJournal = true
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      if (failJournal && String(input[0]).endsWith('events.jsonl'))
        throw Object.assign(new Error('EIO: disk gone'), { code: 'EIO' })
      return openBefore(...input)
    },
  )
  const refused = writer
    .appendEntry(sent)
    .catch((error: Error) => error.message)
  await refused
  failJournal = false

  // Act
  await writer.seal({ elapsedMs: 9, reason: 'stopped' })
  context.mock.restoreAll()
  const opened = await repository.serverHistories.read(header.studyId)

  // Assert
  assert.equal(opened.status, 'partial')
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['request'],
  )
  const reason = opened.seal?.reasons.find(
    (candidate) => candidate.code === 'SERVER_HISTORY_APPEND_FAILED',
  )
  assert.match(
    reason?.text ?? '',
    /could not be written after the request \(entry 1\)/,
  )
})
