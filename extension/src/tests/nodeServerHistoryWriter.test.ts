import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { nodeServerHistoryEntrySchema } from '../nodeServerHistorySchemas'
import type { NodeServerHistoryWriter } from '../nodeServerHistoryWriter'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { rehydrateNodeServerEntries } from '../utils/rehydrateServerStopSnapshot'

import {
  HANDLER_SOURCE_TEXT,
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

// Every start of a history takes the storage lock, which names this process's own start.
before(async () => {
  await realProcessStart(process.pid)
})

/** Starts a server history with `declaredStops` declared stops and returns its writer, folder and store. */
async function startServerHistory(
  context: Parameters<typeof openServerRepository>[0],
  declaredStops = 2,
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops,
  })
  const writer = await repository.serverHistories.start(header)
  const folder = join(learningDirectory, 'node-servers.v1', header.studyId)
  return {
    repository,
    writer,
    folder,
    header,
    store: repository.serverHistories,
  }
}

/** Writes request, sent mark and one stop hit, the opening every refusal test builds on. */
async function openRequestWithOneStop(
  writer: NodeServerHistoryWriter,
): Promise<void> {
  await writer.appendRequest({
    elapsedMs: 10,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 14,
  })
  await writer.appendRequestSent({ elapsedMs: 11, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 20 }),
  )
}

// protects=a server run's evidence is written as files a reader can list, read and seal; fails_when=the header, journal, writer record or seal go missing or the sealed run does not read back complete; no_claim=a live run produces it
test('a valid server run writes its header, journal and writer record, and seals complete with its response and end', async (context) => {
  // Arrange
  const { writer, folder, store, header } = await startServerHistory(context, 1)
  const filesWhileRecording = (await readdir(folder)).sort()

  // Act
  await openRequestWithOneStop(writer)
  await writer.appendOutput({
    elapsedMs: 25,
    channel: 'stdout',
    text: 'created\n',
  })
  await writer.appendResponse({
    elapsedMs: 30,
    status: 201,
    contentType: 'application/json',
    body: '{"id":7}',
    bodyBytes: 8,
    readCut: false,
    location: null,
    requestDurationMs: 20,
  })
  await writer.seal({ elapsedMs: 40, reason: 'stopped' })
  const opened = await store.read(header.studyId)

  // Assert
  assert.deepEqual(filesWhileRecording, [
    'events.jsonl',
    'header.json',
    'writer.json',
  ])
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'source', 'stop', 'output', 'response', 'end'],
  )
  assert.equal(opened.status, 'complete')
  assert.equal(opened.seal?.entryCount, 7)
  assert.deepEqual((await readdir(folder)).sort(), [
    'events.jsonl',
    'header.json',
    'sealed.json',
  ])
})

// protects=the server header round-trips with its identity and masked declaration; fails_when=the header loses the declared request, stops or revision, or stores the secret body field; no_claim=the hash of the original is reversible
test('a server header round-trips and stores the declared request with its secret-named body field masked', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const input = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    path: '/api/login?access_token=abc&next=/home',
    body: '{"user":"ada","password":"hunter2"}',
  })

  // Act
  const writer = await repository.serverHistories.start(input)
  writer.abandon()
  const stored = await readFile(
    join(
      repository.serverHistories.learningDirectory,
      'node-servers.v1',
      input.studyId,
      'header.json',
    ),
    'utf8',
  )
  const parsed = JSON.parse(stored)

  // Assert
  assert.equal(parsed.formatVersion, 1)
  assert.equal(parsed.profile, 'node-server')
  assert.equal(
    parsed.declaredRequest.path,
    '/api/login?access_token=[masked]&next=/home',
  )
  assert.equal(
    parsed.configuration.request.body,
    '{"user":"ada","password":"[masked]"}',
  )
  assert.equal(stored.includes('hunter2'), false)
  assert.equal(stored.includes('abc&'), false)
})

// protects=entries offered in one synchronous step get consecutive numbers in call order; fails_when=numbers are taken at the call or the queue reorders; no_claim=durability across a crash
test('two server entries appended in one synchronous step are numbered one and two in call order', async (context) => {
  // Arrange
  const { writer, store, header } = await startServerHistory(context, 1)

  // Act
  const first = writer.appendOutput({
    elapsedMs: 1,
    channel: 'stdout',
    text: 'a',
  })
  const second = writer.appendOutput({
    elapsedMs: 2,
    channel: 'stderr',
    text: 'b',
  })
  await Promise.all([first, second])
  await writer.appendRequest({
    elapsedMs: 3,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.seal({ elapsedMs: 4, reason: 'stopped' })
  const opened = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    opened.entries
      .slice(0, 2)
      .map((entry) => [
        entry.sequence,
        entry.type === 'output' ? entry.text : '',
      ]),
    [
      [1, 'a'],
      [2, 'b'],
    ],
  )
})

const REFUSALS: Array<{
  name: string
  prepare: (writer: NodeServerHistoryWriter) => Promise<void>
  offer: (writer: NodeServerHistoryWriter) => Promise<void>
  refusal: RegExp
  /** `removed` for a history that never opened a request: it holds nothing to replay. */
  afterSeal?: 'partial' | 'removed'
}> = [
  {
    name: 'a stop before any request',
    prepare: async (): Promise<void> => {},
    offer: (writer): Promise<void> =>
      writer.appendStop(
        serverStopCapture({
          declaredStopIndex: 0,
          hit: 1,
          line: 2,
          elapsedMs: 5,
        }),
      ),
    refusal: /stops outside an open request/,
    afterSeal: 'removed',
  },
  {
    name: 'a stop at a declared index out of range',
    prepare: async (writer): Promise<void> => {
      await writer.appendRequest({
        elapsedMs: 1,
        attempt: 1,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      })
    },
    offer: (writer): Promise<void> =>
      writer.appendStop(
        serverStopCapture({
          declaredStopIndex: 5,
          hit: 1,
          line: 2,
          elapsedMs: 5,
        }),
      ),
    refusal: /undeclared stop/,
  },
  {
    name: 'two terminal entries',
    prepare: async (writer): Promise<void> => {
      await writer.appendRequest({
        elapsedMs: 1,
        attempt: 1,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      })
      await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
      await writer.appendResponse({
        elapsedMs: 3,
        status: 200,
        contentType: null,
        body: '',
        bodyBytes: 0,
        readCut: false,
        location: null,
        requestDurationMs: 1,
      })
    },
    offer: (writer): Promise<void> =>
      writer.appendRequestFailed({ elapsedMs: 4, code: 'X', message: 'late' }),
    refusal: /fails a request never opened/,
  },
  {
    name: 'an entry after end',
    prepare: async (writer): Promise<void> => {
      await writer.appendRequest({
        elapsedMs: 0,
        attempt: 1,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      })
      await writer.appendEntry({ type: 'end', elapsedMs: 1, reason: 'stopped' })
    },
    offer: (writer): Promise<void> =>
      writer.appendOutput({ elapsedMs: 2, channel: 'stdout', text: 'late' }),
    refusal: /after its end/,
  },
  {
    name: 'time moving back',
    prepare: async (writer): Promise<void> => {
      await writer.appendRequest({
        elapsedMs: 0,
        attempt: 1,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      })
      await writer.appendOutput({ elapsedMs: 50, channel: 'stdout', text: 'a' })
    },
    offer: (writer): Promise<void> =>
      writer.appendOutput({ elapsedMs: 49, channel: 'stdout', text: 'b' }),
    refusal: /time moved backward/,
  },
  {
    name: 'a stop whose source hash has no earlier source entry',
    prepare: async (writer): Promise<void> => {
      await writer.appendRequest({
        elapsedMs: 1,
        attempt: 1,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      })
    },
    offer: async (writer): Promise<void> => {
      const capture = serverStopCapture({
        declaredStopIndex: 0,
        hit: 1,
        line: 2,
        elapsedMs: 5,
      })
      await writer.appendEntry({
        type: 'stop',
        elapsedMs: 5,
        declaredStopIndex: 0,
        hit: 1,
        generation: 1,
        source: capture.source,
        frame: { name: 'handler' },
        facts: {},
        unavailable: [],
        debuggerSnapshot: capture.snapshot,
      })
    },
    refusal: /no earlier source entry/,
  },
  {
    name: 'a second open attempt',
    prepare: async (writer): Promise<void> => {
      await writer.appendRequest({
        elapsedMs: 1,
        attempt: 1,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      })
    },
    offer: (writer): Promise<void> =>
      writer.appendRequest({
        elapsedMs: 2,
        attempt: 2,
        method: 'POST',
        path: '/x',
        bodyBytes: 0,
      }),
    refusal: /while one is open or finished/,
  },
]

for (const refusalCase of REFUSALS) {
  // protects=each ordering rule of the server journal; fails_when=the writer accepts the violation and a reader would then refuse the sealed journal; no_claim=rules between profiles other than node-server
  test(`the server writer refuses ${refusalCase.name} and keeps the verified prefix sealable`, async (context) => {
    // Arrange
    const { writer, store, header } = await startServerHistory(context, 2)
    await refusalCase.prepare(writer)

    // Act
    const refused = refusalCase.offer(writer)

    // Assert
    await assert.rejects(refused, refusalCase.refusal)
    await writer.seal({ elapsedMs: 100, reason: 'stopped' })
    if (refusalCase.afterSeal === 'removed') {
      await assert.rejects(store.read(header.studyId), /ENOENT/)
      return
    }
    const opened = await store.read(header.studyId)
    assert.equal(opened.status, 'partial')
  })
}

// protects=the 17th stop is refused by the writer's own limit; fails_when=a history holds more stops than the run's capture budget; no_claim=the run's refusal of the 17th hit
test('the server writer refuses a 17th stop entry', async (context) => {
  // Arrange
  const { writer } = await startServerHistory(context, 1)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  for (let hit = 1; hit <= 16; hit++)
    await writer.appendStop(
      serverStopCapture({
        declaredStopIndex: 0,
        hit,
        line: 2,
        elapsedMs: 10 + hit,
      }),
    )

  // Act
  const seventeenth = writer.appendStop(
    serverStopCapture({
      declaredStopIndex: 0,
      hit: 17,
      line: 2,
      elapsedMs: 40,
    }),
  )

  // Assert
  await assert.rejects(seventeenth, /exceeds its stop limit/)
})

// protects=sixteen hits of one handler store its text once and each reads back with the full snapshot; fails_when=the text is duplicated or a stop reads without its source text; no_claim=binding of the snapshot to a live debugger
test('three hits of one handler store its text in one source entry and each rehydrates to the full snapshot', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startServerHistory(context, 3)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })

  // Act
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 10 }),
  )
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 1, hit: 1, line: 3, elapsedMs: 11 }),
  )
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 2, hit: 1, line: 4, elapsedMs: 12 }),
  )
  await writer.seal({ elapsedMs: 20, reason: 'stopped' })
  const opened = await store.read(header.studyId)
  const rehydrated = rehydrateNodeServerEntries(opened.entries)
  const journal = await readFile(join(folder, 'events.jsonl'), 'utf8')

  // Assert
  assert.equal(
    opened.entries.filter((entry) => entry.type === 'source').length,
    1,
  )
  assert.equal(journal.split(HANDLER_SOURCE_TEXT.split('\n')[0]!).length - 1, 1)
  const texts = rehydrated
    .filter((entry) => entry.type === 'stop')
    .map((entry) => entry.debuggerSnapshot.frames[0]?.source?.text)
  assert.deepEqual(texts, [
    HANDLER_SOURCE_TEXT,
    HANDLER_SOURCE_TEXT,
    HANDLER_SOURCE_TEXT,
  ])
  assert.deepEqual(
    rehydrated
      .filter((entry) => entry.type === 'stop')
      .map((entry) => entry.debuggerSnapshot.frames[0]?.line),
    [2, 3, 4],
  )
})

// protects=a source above 512 KiB is stored as its hash with the reason; fails_when=a huge file is written into the journal or the replay loses the reason; no_claim=the replay's wording of the reason
test('a 600 KiB source is stored as its hash only and rehydrates without text and with the reason', async (context) => {
  // Arrange
  const { writer, store, header } = await startServerHistory(context, 1)
  const hugeText = `${'x'.repeat(600 * 1024)}\n`
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })

  // Act
  await writer.appendStop(
    serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
      text: hugeText,
    }),
  )
  await writer.seal({ elapsedMs: 20, reason: 'stopped' })
  const opened = await store.read(header.studyId)
  const source = opened.entries.find((entry) => entry.type === 'source')
  const stop = rehydrateNodeServerEntries(opened.entries).find(
    (entry) => entry.type === 'stop',
  )

  // Assert
  assert.equal(source?.type === 'source' ? source.text : 'present', undefined)
  assert.equal(
    source?.type === 'source' ? source.sourceUnavailable : '',
    'too large',
  )
  assert.equal(source?.type === 'source' ? source.hash : '', sha256(hugeText))
  assert.equal(
    stop?.type === 'stop' ? stop.debuggerSnapshot.frames[0]?.source : 'x',
    undefined,
  )
  assert.equal(
    stop?.type === 'stop'
      ? stop.debuggerSnapshot.frames[0]?.sourceUnavailable
      : '',
    'too large',
  )
})

// protects=entry schemas refuse a source entry whose text does not hash to its name; fails_when=an edited text passes as the executed source; no_claim=anything about the debugger
test('a source entry whose text does not hash to its name is refused by the schema', () => {
  // Arrange
  const entry = {
    type: 'source',
    sequence: 1,
    elapsedMs: 0,
    path: 'a.ts',
    hash: sha256('one'),
    text: 'two',
  }

  // Act
  const parsed = nodeServerHistoryEntrySchema.safeParse(entry)

  // Assert
  assert.equal(parsed.success, false)
})
