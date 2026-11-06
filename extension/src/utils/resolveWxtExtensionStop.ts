import { relative, sep } from 'node:path'

import type { ChromeExtensionConfiguration } from '../chromeExtensionConfigSchemas'
import type { ResolvedExtensionStop } from '../chromeExtensionContracts'
import { StudyError } from '../errors'

import type { MappedSources } from './listMappedSources'
import { resolveMappedStop } from './resolveMappedStop'
import { splitSourceLines } from './splitSourceLines'

/**
 * Checks one stop of a `wxt-build` run: the project source must be listed by a source map of a chunk its context loads, and the map must embed the very text on disk.
 * Called by the `wxt-build` extension source for each declared stop, with the mapped sources of the stop's context.
 * @param options.stop - The declared stop; its path is relative to the project root.
 * @param options.position - The stop's 0-based position in the configuration; the refusal sentences use position + 1.
 * @param options.repositoryRoot - The repository's canonical path; the resolved stop's `path` is relative to it, which is what the history and the replay name.
 * @param options.mapped - What the stop's context loads, from {@link listMappedSources}.
 * @returns The resolved stop: the project source's real path, its SHA-256 and the executed text.
 * @throws `STOP_FILE_NOT_LOADED` with `details.contextSources` (up to 20 listed project sources, relative to the project root) when no loaded chunk's map lists the file or the map's text differs; `INVALID_CONFIGURATION` for a line past the end of the file.
 * @example
 * await resolveWxtExtensionStop({ stop, position: 0, repositoryRoot: '/repo', mapped }) // => { index: 1, path: 'ext/src/App.tsx', … }
 */
export async function resolveWxtExtensionStop(options: {
  stop: ChromeExtensionConfiguration['stops'][number]
  position: number
  repositoryRoot: string
  mapped: MappedSources
}): Promise<ResolvedExtensionStop> {
  const { stop, position, repositoryRoot, mapped } = options
  const index = position + 1
  const outcome = await resolveMappedStop({ stopPath: stop.path, mapped })
  if (!outcome.ok)
    throw new StudyError(
      'STOP_FILE_NOT_LOADED',
      `Stop ${index}: ${outcome.message}`,
      undefined,
      undefined,
      undefined,
      {
        reason: outcome.cause,
        contextSources: outcome.contextSources,
        contextSourceCount: outcome.contextSourceCount,
      },
    )
  if (stop.line > splitSourceLines(outcome.executedText).length)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `configuration.stops[${position}].line is past the end of ${stop.path}.`,
    )
  return {
    index,
    path: relative(repositoryRoot, outcome.sourcePath).split(sep).join('/'),
    absolutePath: outcome.sourcePath,
    line: stop.line,
    context: stop.context,
    sha256: outcome.sha256,
    executedText: outcome.executedText,
  }
}
