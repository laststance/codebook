import { MAX_EXPLANATION_CHARS } from '../constants'
import type { NodeScriptHistoryHeader } from '../nodeScriptHistorySchemas'

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
  loader: string
  declaredStops: NodeScriptHistoryHeader['declaredStops']
  sourceHashes: NodeScriptHistoryHeader['sourceHashes']
  repositoryRevision: NodeScriptHistoryHeader['repositoryRevision']
}

/**
 * Builds the header a node-script history starts with: the run's identity, the script (`packageRoot`, `entry`, `loader`), the declared stops, the repository revision and the hashes of the declared sources. It has no request.
 * Called by {@link startNodeScriptHistory} just before the history starts.
 * @param input - The run's identity and prepared script.
 * @returns The header without its `formatVersion`, which the store stamps.
 * @example buildNodeScriptHistoryHeader(input).entry // => 'scripts/seed.mjs'
 */
export function buildNodeScriptHistoryHeader(
  input: NodeScriptHistoryHeaderInput,
): Omit<NodeScriptHistoryHeader, 'formatVersion'> {
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
  }
}
