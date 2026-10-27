import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { StudyError } from '../errors'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import type { NodeServerStopTarget } from '../nodeServerDebugger'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { isInsideFolder } from './isInsideFolder'

/**
 * Turns a node-server declaration's stops into the targets the debugger arms: each cited file by its real path inside the opened repository, with the hash the article cites checked against the file now.
 * Called by the node-server run's preparation before anything is spawned.
 * @param workspace - The opened repository's real root.
 * @param configuration - The declaration: `source` is stop 0, then `additionalStops` in order.
 * @returns One target per stop, in declared order.
 * @throws `NODE_SERVER_SOURCE_REFUSED` when a stop's file is missing or lies outside the repository by its real path; `SOURCE_CHANGED` when its bytes no longer have the cited hash.
 * @example
 * await resolveNodeServerStops('/repo', configuration) // => [{ declaredStopIndex: 0, path: 'src/routes/users.ts', file: '/repo/src/routes/users.ts', line: 14, column: 3, hash: '…', inspections: [] }]
 */
export async function resolveNodeServerStops(
  workspace: string,
  configuration: Pick<
    NodeServerConfiguration,
    'source' | 'inspections' | 'additionalStops'
  >,
): Promise<NodeServerStopTarget[]> {
  const declared = [
    { ...configuration.source, inspections: configuration.inspections },
    ...(configuration.additionalStops ?? []),
  ]
  const targets: NodeServerStopTarget[] = []
  for (const [declaredStopIndex, stop] of declared.entries()) {
    const file = await realpath(join(workspace, stop.path)).catch(
      () => undefined,
    )
    // A stop outside the repository by its real path (a link) is no cited source.
    if (!file || !isInsideFolder(workspace, file))
      throw new StudyError(
        'NODE_SERVER_SOURCE_REFUSED',
        `node-server's stop ${declaredStopIndex + 1} (${stop.path}) is not a file inside the opened repository by its real path.`,
      )
    if (sha256(await readFile(file)) !== stop.hash)
      throw new StudyError(
        'SOURCE_CHANGED',
        `The cited source ${stop.path} changed on disk since the article cited it. Read the source again and publish the article again, then start a new run.`,
      )
    targets.push({
      declaredStopIndex,
      path: stop.path,
      file,
      line: stop.line,
      column: stop.column,
      hash: stop.hash,
      inspections: stop.inspections,
    })
  }
  return targets
}
