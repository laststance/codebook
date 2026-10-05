import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { configuredStopFields } from './configuredStopFields'
import { configuredStops } from './configuredStops'

/** A committed snapshot's declared stop, its position among the declared stops and where the agent wrote it. */
export interface DeclaredStopOfSnapshot {
  stop: ReturnType<typeof configuredStops>[number]
  /** Zero-based position among the declared stops, which is also the snapshot's position among the committed ones. */
  index: number
  /** Where the configuration holds the stop's line and column: `configuration.source` for the first stop; for a later one `configuration.additionalStops[<i>].source` (version 2), or `configuration.additionalStops[<i>]` in a version 1 configuration, whose later stops hold `line` and `column` themselves. */
  configurationPath: string
}

/**
 * Finds the stop a committed snapshot answers, because committed snapshots follow the declared stop order; the live inspection resource and {@link StudyService.explain} (through {@link StudyService.boundPlace}), the saved learning resource ({@link readRecordingResource}) and the Study pane's label share this one lookup.
 * @param configuration - The run's frozen configuration, of either version.
 * @param committedSnapshots - The run's committed snapshots (or a saved study's observations) in commit order.
 * @param snapshotId - The snapshot whose declared stop is asked for.
 * @returns
 * - The declared stop with its index and its configuration path, as {@link configuredStopFields} names the stop's `source`
 * - `undefined` when the snapshot is not among the committed ones, or no stop is declared at its index
 * @example
 * declaredStopOfSnapshot(configuration, snapshots, snapshots[0].id)?.configurationPath // => 'configuration.source'
 * declaredStopOfSnapshot(configuration, snapshots, snapshots[2].id)?.configurationPath // => 'configuration.additionalStops[1].source'
 * declaredStopOfSnapshot(configuration, snapshots, 'unknown') // => undefined
 */
export function declaredStopOfSnapshot(
  configuration: RetainedRepositoryConfiguration,
  committedSnapshots: readonly { id: string }[],
  snapshotId: string,
): DeclaredStopOfSnapshot | undefined {
  const index = committedSnapshots.findIndex(
      (committed) => committed.id === snapshotId,
    ),
    stop = configuredStops(configuration)[index]
  if (!stop) return undefined
  return {
    stop,
    index,
    // The one naming of a stop's field, which the refusals of a run use too.
    configurationPath: configuredStopFields(configuration.version, index)
      .source,
  }
}
