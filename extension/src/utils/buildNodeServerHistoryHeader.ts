import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import { MAX_EXPLANATION_CHARS } from '../constants'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import type { NodeServerHistoryHeader } from '../nodeServerHistorySchemas'

import { maskNodeServerConfiguration } from './maskNodeServerConfiguration'

/** What {@link buildNodeServerHistoryHeader} reads of the run. */
export type NodeServerHistoryHeaderInput = {
  workspaceKey: string
  instanceId: string
  runId: string
  /** The run's creation time in milliseconds. */
  createdAtMs: number
  configuration: NodeServerConfiguration
  /** SHA-256 of the original declaration; identity only. */
  configurationHash: string
  descriptor: ConfiguredDescriptor
  repositoryRevision: NodeServerHistoryHeader['repositoryRevision']
}

/**
 * Builds the header a node-server history starts with: the run's identity, the declaration with secret-named values masked, the declared request and stops, the repository revision and the hashes of the cited sources.
 * Called by {@link StudyService} just before it starts the history of a node-server run. The question is the explained article node's title until the chat saves its own question with its learning material.
 * @param input - The run's identity, declaration and pinned article node.
 * @returns The header without its `formatVersion`, which the store stamps.
 * @example buildNodeServerHistoryHeader(input).declaredStops.length // => 2
 */
export function buildNodeServerHistoryHeader(
  input: NodeServerHistoryHeaderInput,
): Omit<NodeServerHistoryHeader, 'formatVersion'> {
  const configuration = maskNodeServerConfiguration(input.configuration)
  const stops = [
    input.configuration.source,
    ...(input.configuration.additionalStops ?? []),
  ]
  return {
    profile: 'node-server',
    workspaceKey: input.workspaceKey,
    studyId: `${input.instanceId}_${input.runId}`,
    instanceId: input.instanceId,
    runId: input.runId,
    createdAt: new Date(input.createdAtMs).toISOString(),
    question:
      input.descriptor.nodeTitle.slice(0, MAX_EXPLANATION_CHARS) ||
      'Node server run',
    configurationHash: input.configurationHash,
    configuration,
    declaredRequest: {
      method: configuration.request.method,
      path: configuration.request.path,
    },
    declaredStops: stops.map((stop) => ({ path: stop.path, line: stop.line })),
    repositoryRevision: input.repositoryRevision,
    sourceHashes: input.descriptor.sources.map((source) => ({
      path: source.path,
      hash: source.hash,
    })),
  }
}
