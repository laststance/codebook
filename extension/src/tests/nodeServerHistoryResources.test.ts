import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/** Reads a resource and returns the page object its text holds. */
async function pageOf(
  service: Parameters<typeof readResource>[0],
  uri: string,
) {
  const resource = await readResource(service, uri)
  if (!('text' in resource)) throw new Error(`${uri} did not return JSON.`)
  return JSON.parse(resource.text) as {
    sourceUri: string
    content: string
    complete: boolean
    nextUri?: string
    totalBytes: number
  }
}

/** Reads every page of a resource by following `nextUri` and parses the joined content. */
async function wholeJson(
  service: Parameters<typeof readResource>[0],
  uri: string,
): Promise<{ value: unknown; pages: number }> {
  let page = await pageOf(service, uri)
  let content = page.content
  let pages = 1
  while (page.nextUri) {
    page = await pageOf(service, page.nextUri)
    content += page.content
    pages++
  }
  return { value: JSON.parse(content), pages }
}

/** A service over a repository whose server store holds the history `build` writes. */
async function serviceWith<Result>(
  context: Parameters<typeof openServerRepository>[0],
  build: (
    repository: Awaited<ReturnType<typeof openServerRepository>>['repository'],
  ) => Promise<Result>,
) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const built = await build(repository)
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  return { service: harness.service, repository, built }
}

// protects=the node-history catalog lists a server history with its profile, request line, response status and capture status; fails_when=a server history is missing from the catalog or lacks one of those members; no_claim=the catalog's paging
test('the node-history catalog lists a server history with its request line, response status and capture status', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, (repository) =>
    writeServerHistory(repository, { output: ['created\n'] }),
  )

  // Act
  const { value } = await wholeJson(service, 'codebook://node-history')

  // Assert
  const [entry] = value as Array<Record<string, unknown>>
  assert.equal(entry?.studyId, built.header.studyId)
  assert.equal(entry?.profile, 'node-server')
  assert.equal(entry?.requestLine, 'POST /api/items')
  assert.equal(entry?.responseStatus, 201)
  assert.equal(entry?.status, 'complete')
  assert.equal(entry?.captureComplete, true)
  assert.equal(
    entry?.eventsUri,
    `codebook://node-history/${built.header.studyId}/events`,
  )
})

// protects=the history resource states the three verdicts with capped missing lists of {code, text, params}; fails_when=a verdict is missing, the lists are uncut, or a reason loses its code or params; no_claim=the run resource (producer part)
test('the history resource returns saved, capture and learning verdicts with twenty reasons and the count of thirty-one', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, async (repository) => {
    const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
      declaredStops: 3,
    })
    const writer = await repository.serverHistories.start(header)
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: '/api/items',
      bodyBytes: 14,
    })
    await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
    // Three stops of ten unreadable values each.
    for (const index of [0, 1, 2])
      await writer.appendStop(
        serverStopCapture({
          declaredStopIndex: index,
          hit: 1,
          line: 2 + index,
          elapsedMs: 10 + index,
          unavailable: Array.from({ length: 10 }, (_, value) => ({
            path: `value${value}`,
            reason: 'not readable',
          })),
        }),
      )
    await writer.seal({ elapsedMs: 50, reason: 'stopped' })
    return header
  })

  // Act
  const { value } = await wholeJson(
    service,
    `codebook://node-history/${built.studyId}`,
  )

  // Assert
  const body = value as Record<string, unknown>
  assert.equal(body.profile, 'node-server')
  assert.equal(body.saved, true)
  assert.equal(body.captureComplete, false)
  assert.equal(body.captureMissingCount, 31)
  const missing = body.captureMissing as Array<{
    code: string
    text: string
    params: Record<string, unknown>
  }>
  assert.equal(missing.length, 20)
  assert.deepEqual(missing[0], {
    code: 'SERVER_HISTORY_NO_RESPONSE_STOPPED',
    text: 'No response was recorded: the run was stopped before the server answered.',
    params: {},
  })
  assert.equal(body.learningCoverage, 'none')
  assert.equal(body.learningMissingCount, 4)
})

// protects=the events list is lean: citable events only, no executed source text and no snapshot; fails_when=a stop in the list carries its snapshot or source text, or source and end entries are listed; no_claim=the per-entry detail
test('the events list names citable events with a stop reduced to its position, hash and facts', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, (repository) =>
    writeServerHistory(repository, { output: ['created\n'] }),
  )

  // Act
  const { value } = await wholeJson(
    service,
    `codebook://node-history/${built.header.studyId}/events`,
  )

  // Assert
  const events = value as Array<Record<string, unknown>>
  assert.deepEqual(
    events.map((event) => [event.sequence, event.type]),
    [
      [1, 'request'],
      [4, 'stop'],
      [5, 'output'],
      [6, 'response'],
    ],
  )
  const stop = events[1]!
  assert.equal(stop.path, 'src/handler.ts')
  assert.equal(stop.line, 2)
  assert.deepEqual(stop.facts, { 'value:id': '7' })
  assert.equal('debuggerSnapshot' in stop, false)
  assert.equal(
    JSON.stringify(events).includes('export function handler'),
    false,
  )
})

// protects=a 16-hit history with 200 output lines reads its events in at most 16 pages; fails_when=the lean list outgrows the page budget the skill plans its reads by; no_claim=a larger output budget
test('a sixteen-hit history with two hundred output lines lists its events in at most sixteen pages', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, (repository) =>
    writeServerHistory(repository, {
      declaredStops: 2,
      hits: Array.from({ length: 16 }, (_, index) => [
        index % 2,
        index / 2 + 1 - (index % 2) / 2,
      ]),
      output: Array.from({ length: 200 }, (_, index) => `line ${index}\n`),
    }),
  )

  // Act
  const { pages } = await wholeJson(
    service,
    `codebook://node-history/${built.header.studyId}/events`,
  )

  // Assert
  assert.ok(pages <= 16, `the events list took ${pages} pages`)
})

// protects=one entry's detail returns the whole snapshot with the executed source text restored; fails_when=the detail is the hash-only stored form or misses the body of a response; no_claim=the lean list
test('an entry detail returns a stop with its rehydrated snapshot and a response with its body', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, (repository) =>
    writeServerHistory(repository, {}),
  )

  // Act
  const stop = (
    await wholeJson(
      service,
      `codebook://node-history/${built.header.studyId}/events/4`,
    )
  ).value as {
    type: string
    debuggerSnapshot: { frames: Array<{ source: { text: string } }> }
  }
  const response = (
    await wholeJson(
      service,
      `codebook://node-history/${built.header.studyId}/events/5`,
    )
  ).value as { type: string; body: string }

  // Assert
  assert.equal(stop.type, 'stop')
  assert.match(
    stop.debuggerSnapshot.frames[0]!.source.text,
    /export function handler/,
  )
  assert.equal(response.type, 'response')
  assert.equal(response.body, '{"id":7}')
})

// protects=a sequence the history does not hold is refused as NOT_FOUND naming the events list; fails_when=the read answers an empty page or a raw error; no_claim=an unknown history id
test('an entry detail for a sequence the history does not hold is refused as NOT_FOUND', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, (repository) =>
    writeServerHistory(repository, {}),
  )

  // Act
  const refused = readResource(
    service,
    `codebook://node-history/${built.header.studyId}/events/99`,
  )

  // Assert
  await assert.rejects(refused, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'NOT_FOUND')
    assert.match(error.message, /has no entry with sequence 99/)
    return true
  })
})

// protects=every page of one events read is pinned to the prefix its first page saw, so a history that keeps recording reads consistently; fails_when=output appended between two pages fails the read with changed evidence or leaks into a later page; no_claim=a read that starts after the append
test('output appended between two pages of one events read does not change the pages that follow', async (context) => {
  // Arrange
  const { service, built } = await serviceWith(context, async (repository) => {
    const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
    const writer = await repository.serverHistories.start(header)
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: '/api/items',
      bodyBytes: 14,
    })
    await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
    for (let line = 0; line < 120; line++)
      await writer.appendOutput({
        elapsedMs: 3 + line,
        channel: 'stdout',
        text: `output line ${line}\n`,
      })
    return { header, writer }
  })
  const uri = `codebook://node-history/${built.header.studyId}/events`
  const first = await pageOf(service, uri)

  // Act
  await built.writer.appendOutput({
    elapsedMs: 500,
    channel: 'stdout',
    text: 'a line recorded after the first page\n',
  })
  let page = first
  let content = first.content
  while (page.nextUri) {
    page = await pageOf(service, page.nextUri)
    content += page.content
  }

  // Assert
  assert.match(first.nextUri ?? '', /\/events\/through\/122\/pages\//)
  const events = JSON.parse(content) as Array<{ sequence: number }>
  assert.equal(events.length, 121)
  assert.equal(events.at(-1)?.sequence, 122)
  built.writer.abandon()
})
