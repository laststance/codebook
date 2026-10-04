import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

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
 * - The declared stop with its index and configuration path
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
  const laterStop = `configuration.additionalStops[${index - 1}]`
  return {
    stop,
    index,
    configurationPath:
      index === 0
        ? 'configuration.source'
        : // Only a version 2 stop has a source of its own; a version 1 later stop holds its line and column directly.
          configuration.version === 2
          ? `${laterStop}.source`
          : laterStop,
  }
}
