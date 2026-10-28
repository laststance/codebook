import type { NodeHistoryRepository } from '../../nodeHistoryRepository'
import type { NodeServerHistoryHeader } from '../../nodeServerHistorySchemas'

import {
  nodeServerHistoryHeader,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './nodeServerHistoryFixture'

/** What a sealed fixture server history holds beyond its request: how many stops it records, its output lines and how it answers. */
export type SealedServerHistoryOptions = {
  workspaceKey?: string
  declaredStops?: number
  /** The stop hits to record, in order; each is `[declaredStopIndex, hit]`. Defaults to one hit of stop 1. */
  hits?: Array<[number, number]>
  /** The output lines recorded before the response. */
  output?: string[]
  /** The recorded response; `null` ends the run with no answer. */
  response?: { status: number; body: string; contentType?: string } | null
  question?: string
  path?: string
  /** Seals the history; `false` leaves its writer abandoned, so it reads interrupted. */
  seal?: boolean
}

/**
 * Writes a server history with the fixture writer, the way a producer will: request, send mark, output lines, stop hits, the response and the end; the test fixture is the only writer of a server history until the producer part of Cycle 0059.
 * @param repository - The repository whose server store receives the history.
 * @param options - What the history holds.
 * @returns The header and the sequence of each kind of entry written, so a test can cite them.
 * @example const { header, sequences } = await writeServerHistory(repository, { response: { status: 201, body: '{}' } })
 */
export async function writeServerHistory(
  repository: NodeHistoryRepository,
  options: SealedServerHistoryOptions = {},
): Promise<{
  header: Omit<NodeServerHistoryHeader, 'formatVersion'>
  sequences: {
    request: number
    stops: number[]
    output: number[]
    response?: number
  }
}> {
  const hits = options.hits ?? [[0, 1]]
  const header = {
    ...nodeServerHistoryHeader(options.workspaceKey ?? SERVER_WORKSPACE_KEY, {
      declaredStops: options.declaredStops ?? 1,
      ...(options.path ? { path: options.path } : {}),
    }),
    ...(options.question ? { question: options.question } : {}),
  }
  const writer = await repository.serverHistories.start(header)
  let elapsedMs = 1
  let sequence = 0
  const sequences: {
    request: number
    stops: number[]
    output: number[]
    response?: number
  } = { request: 0, stops: [], output: [] }
  await writer.appendRequest({
    elapsedMs,
    attempt: 1,
    method: 'POST',
    path: header.declaredRequest.path,
    bodyBytes: 14,
  })
  sequences.request = ++sequence
  await writer.appendRequestSent({ elapsedMs: ++elapsedMs, attempt: 1 })
  sequence++
  for (const [declaredStopIndex, hit] of hits) {
    // The first hit of a source writes its source entry first.
    if (!sequences.stops.length) sequence++
    await writer.appendStop(
      serverStopCapture({
        declaredStopIndex,
        hit,
        line: 2 + declaredStopIndex,
        elapsedMs: (elapsedMs += 10),
      }),
    )
    sequences.stops.push(++sequence)
  }
  for (const text of options.output ?? []) {
    await writer.appendOutput({
      elapsedMs: (elapsedMs += 5),
      channel: 'stdout',
      text,
    })
    sequences.output.push(++sequence)
  }
  if (options.response !== null) {
    const response = options.response ?? { status: 201, body: '{"id":7}' }
    await writer.appendResponse({
      elapsedMs: (elapsedMs += 10),
      status: response.status,
      contentType: response.contentType ?? 'application/json',
      body: response.body,
      bodyBytes: Buffer.byteLength(response.body),
      readCut: false,
      location: null,
      requestDurationMs: 30,
    })
    sequences.response = ++sequence
  }
  if (options.seal === false) writer.abandon()
  else await writer.seal({ elapsedMs: (elapsedMs += 10), reason: 'stopped' })
  return { header, sequences }
}
