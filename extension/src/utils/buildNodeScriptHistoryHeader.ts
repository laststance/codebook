import { MAX_EXPLANATION_CHARS } from '../constants'
import type {
  NodeScriptHistoryHeader,
  NodeScriptHistoryHeaderDraft,
  NodeScriptHistoryLibrary,
} from '../nodeScriptHistorySchemas'

/** What {@link buildNodeScriptHistoryHeader} reads of the run. */
export type NodeScriptHistoryHeaderInput = {
  workspaceKey: string
  instanceId: string
  runId: string
  /** The run's creation time in milliseconds. */
  createdAtMs: number
  /** The question the run answers; defaults to a generic one until the chat saves its own with its learning material. */
  question?: string
  packageRoot: string
  entry: string
  loader: NodeScriptHistoryHeader['loader']
  declaredStops: NodeScriptHistoryHeader['declaredStops']
  sourceHashes: NodeScriptHistoryHeader['sourceHashes']
  repositoryRevision: NodeScriptHistoryHeader['repositoryRevision']
  /** The library the run declares (API 1.33); its presence makes the history format 2. Only the declared identity: the build's results are journal events. */
  library?: NodeScriptHistoryLibrary
}

/**
 * Builds the header a node-script history starts with: the run's identity, the script (`packageRoot`, `entry`, `loader`), the declared stops, the repository revision and the hashes of the declared sources. It has no request.
 * Called by {@link startNodeScriptHistory} just before the history starts.
 * @param input - The run's identity and prepared script.
 * @returns The header without its `formatVersion`, which the store stamps: format 2 when `library` is declared, else format 1.
 * @example buildNodeScriptHistoryHeader(input).entry // => 'scripts/seed.mjs'
 */
export function buildNodeScriptHistoryHeader(
  input: NodeScriptHistoryHeaderInput,
): NodeScriptHistoryHeaderDraft {
  return {
    profile: 'node-script',
    workspaceKey: input.workspaceKey,
    studyId: `${input.instanceId}_${input.runId}`,
    instanceId: input.instanceId,
    runId: input.runId,
    createdAt: new Date(input.createdAtMs).toISOString(),
    question:
      input.question?.slice(0, MAX_EXPLANATION_CHARS) || 'Node script run',
    packageRoot: input.packageRoot,
    entry: input.entry,
    loader: input.loader,
    declaredStops: input.declaredStops,
    repositoryRevision: input.repositoryRevision,
    sourceHashes: input.sourceHashes,
    ...(input.library === undefined ? {} : { library: input.library }),
  }
}
