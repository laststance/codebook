import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { NodeHistoryRepository } from '../../nodeHistoryRepository'
import { nodeServerConfigSchema } from '../../nodeServerConfigSchemas'
import type { NodeServerHistoryHeader } from '../../nodeServerHistorySchemas'
import type { NodeServerStopCapture } from '../../nodeServerHistoryWriter'
import type { ReplayDebugSnapshot } from '../../replayDebugSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { maskNodeServerConfiguration } from '../../utils/maskNodeServerConfiguration'

import { createConfiguredStudy } from './createConfiguredStudy'

/** The workspace key every server history test uses. */
export const SERVER_WORKSPACE_KEY = sha256('node-server-history-test-workspace')

/** The source text a stop at `handler.ts` executes, one function over four lines. */
export const HANDLER_SOURCE_TEXT =
  'export function handler(req) {\n  const id = req.params.id\n  const item = load(id)\n  return item\n}\n'

/**
 * Makes a private learning directory and a repository over it, both removed when the test ends.
 * @param context - The test whose end removes the directory.
 * @param options - The saved-study limit and the saved studies the library holds.
 * @returns The repository and its directory.
 * @example const { repository } = await openServerRepository(context)
 */
export async function openServerRepository(
  context: TestContext,
  options: {
    limit?: number
    savedStudies?: () => Promise<number>
    workspaceKey?: string
    /** Another window over the same learning directory. */
    learningDirectory?: string
  } = {},
): Promise<{ repository: NodeHistoryRepository; learningDirectory: string }> {
  const learningDirectory =
    options.learningDirectory ??
    (await mkdtemp(join(tmpdir(), 'codebook-server-')))
  if (!options.learningDirectory)
    context.after(() => rm(learningDirectory, { recursive: true, force: true }))
  const repository = new NodeHistoryRepository(
    learningDirectory,
    options.workspaceKey ?? SERVER_WORKSPACE_KEY,
    () => options.limit ?? 64,
    options.savedStudies ?? (async () => 0),
  )
  return { repository, learningDirectory }
}

/**
 * Builds the header input of a server history that declares `declaredStops` stops on `handler.ts`, one POST request and a masked configuration, the way the run builds it.
 * @param workspaceKey - The workspace key.
 * @param options - How many stops to declare and the request path.
 * @returns The header without its `formatVersion`, which the store stamps.
 * @example const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, { declaredStops: 2 })
 */
export function nodeServerHistoryHeader(
  workspaceKey: string,
  options: {
    declaredStops?: number
    path?: string
    body?: string
    workspaceInstance?: string
  } = {},
): Omit<NodeServerHistoryHeader, 'formatVersion'> {
  const browser = createConfiguredStudy().configuration
  const sourceHash = sha256(HANDLER_SOURCE_TEXT)
  const declaredStops = options.declaredStops ?? 1
  const declaration = {
    version: 1,
    adapter: 'node-server',
    book: browser.book,
    entry: 'src/server.ts',
    port: 4100,
    request: {
      method: 'POST',
      path: options.path ?? '/api/items',
      contentType: 'application/json',
      body: options.body ?? '{"name":"pen"}',
    },
    source: { path: 'src/handler.ts', hash: sourceHash, line: 2, column: 1 },
    inspections: [{ path: 'id', mode: 'value', required: true }],
    additionalStops: Array.from({ length: declaredStops - 1 }, (_, index) => ({
      path: 'src/handler.ts',
      hash: sourceHash,
      line: 3 + index,
      column: 1,
      anchorIndex: 0,
      inspections: [{ path: 'id', mode: 'value', required: true }],
    })),
  }
  const configuration = maskNodeServerConfiguration(
    nodeServerConfigSchema.parse(declaration),
  )
  const instanceId = randomUUID()
  const runId = randomUUID()
  return {
    profile: 'node-server',
    workspaceKey,
    studyId: `${instanceId}_${runId}`,
    instanceId,
    runId,
    createdAt: '2026-10-28T00:00:00.000Z',
    question: 'How does the server create an item?',
    configurationHash: sha256(JSON.stringify(declaration)),
    configuration,
    declaredRequest: {
      method: 'POST',
      path: configuration.request.path,
    },
    declaredStops: Array.from({ length: declaredStops }, (_, index) => ({
      path: 'src/handler.ts',
      line: 2 + index,
    })),
    repositoryRevision: { revision: 'abc1234', dirty: false },
    sourceHashes: [{ path: 'src/handler.ts', hash: sourceHash }],
  }
}

/**
 * Builds the run's capture of one stop hit with a presentable snapshot: the top frame at `line` of `handler.ts` with its source text, a local scope and one variable.
 * @param options - The declared stop index, hit number, line and time; `text` replaces the executed source, `facts` the inspected values.
 * @returns A capture the writer accepts and the evaluator calls presentable.
 * @example await writer.appendStop(serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 50 }))
 */
export function serverStopCapture(options: {
  declaredStopIndex: number
  hit: number
  line: number
  elapsedMs: number
  text?: string
  facts?: NodeServerStopCapture['facts']
  unavailable?: NodeServerStopCapture['unavailable']
  snapshot?: ReplayDebugSnapshot
}): NodeServerStopCapture {
  const text = options.text ?? HANDLER_SOURCE_TEXT
  const hash = sha256(text)
  const snapshot: ReplayDebugSnapshot = options.snapshot ?? {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: options.line,
        column: 1,
        source: { name: 'src/handler.ts', text, hash, line: options.line },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'id', value: '7', type: 'string', children: [] }],
    limitations: [],
  }
  return {
    elapsedMs: options.elapsedMs,
    declaredStopIndex: options.declaredStopIndex,
    hit: options.hit,
    generation: options.hit,
    source: { path: 'src/handler.ts', hash, line: options.line, column: 1 },
    frameName: 'handler',
    facts: options.facts ?? { 'value:id': '7' },
    unavailable: options.unavailable ?? [],
    snapshot,
  }
}
