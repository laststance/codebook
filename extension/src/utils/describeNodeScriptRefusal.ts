import { StudyError } from '../errors'

import { isInsideFolder } from './isInsideFolder'
import { repositoryPosixPath } from './repositoryPosixPath'
import type { ResolvedNodeServerLaunch } from './resolveNodeServerLaunch'

/** The `details.reason` values of a `NODE_SCRIPT_SOURCE_REFUSED` refusal. */
type NodeScriptRefusalReason =
  | 'package-root'
  | 'entry'
  | 'stop-file'
  | 'tsx-missing'
  | 'outside-package'
  | 'node-modules'
  | 'source-refused'

/**
 * Builds the refusal of a script's source: the code, the reason an agent branches on, and `sideEffects: none` because nothing was spawned.
 * @param reason - Why the source is refused.
 * @param message - What is wrong, naming the field as the declaration wrote it.
 * @returns The `NODE_SCRIPT_SOURCE_REFUSED` {@link StudyError}.
 * @example refuseNodeScriptSource('entry', "node-script's entry run.mjs is not a file inside packageRoot .")
 */
function refuseNodeScriptSource(
  reason: NodeScriptRefusalReason,
  message: string,
): StudyError {
  return new StudyError(
    'NODE_SCRIPT_SOURCE_REFUSED',
    message,
    undefined,
    undefined,
    undefined,
    { reason, sideEffects: 'none' },
  )
}

/**
 * Names why the shared node-server launch or stop resolution refused a script's source, from the sentence it raised.
 * @param message - The `NODE_SERVER_SOURCE_REFUSED` sentence.
 * @returns The reason of the script refusal.
 * @example reasonOfNodeServerRefusal("node-server's stop 2 (a.ts) is not a file …") // => 'stop-file'
 */
function reasonOfNodeServerRefusal(message: string): NodeScriptRefusalReason {
  if (/packageRoot .* is not a folder/.test(message)) return 'package-root'
  if (/entry .* is not a file inside packageRoot/.test(message)) return 'entry'
  if (/node-server's stop \d+/.test(message)) return 'stop-file'
  // The tsx sentences of resolveTsxLoader: none installed, outside the repository, or no loader file inside it.
  if (/none is installed for/.test(message)) return 'tsx-missing'
  if (/lies outside the opened repository by its real path/.test(message))
    return 'outside-package'
  if (/exports no loader file inside the repository/.test(message))
    return 'tsx-missing'
  // A sentence this mapping does not know is never guessed as a missing tsx.
  return 'source-refused'
}

/**
 * Turns what the shared resolvers threw into the script's own refusal: a `NODE_SERVER_SOURCE_REFUSED` becomes `NODE_SCRIPT_SOURCE_REFUSED` with its reason, worded for a script; every other error (`SOURCE_CHANGED`, a failed read) passes unchanged.
 * Called by the script run's checks before anything is spawned.
 * @param error - What the launch or stop resolution threw.
 * @returns The error to throw instead.
 * @example describeNodeScriptRefusal(new StudyError('NODE_SERVER_SOURCE_REFUSED', "node-server's entry …")) // => StudyError with details.reason 'entry'
 */
export function describeNodeScriptRefusal(error: unknown): unknown {
  if (
    !(error instanceof StudyError) ||
    error.code !== 'NODE_SERVER_SOURCE_REFUSED'
  )
    return error
  return refuseNodeScriptSource(
    reasonOfNodeServerRefusal(error.message),
    // Only the profile prefix is renamed, so a declared path such as packages/node-server/run.mjs is echoed unchanged.
    error.message.replace(/^node-server(?='s )/, 'node-script'),
  )
}

/**
 * Checks that every stop lies in the package's own source: inside the package root and outside `node_modules`.
 * Why: a published package under `node_modules` is not the checked-out library, and a file outside the package is not what the script runs. Called by the script run after the launch and stops resolved, before anything is spawned.
 * @param workspace - The opened repository's real root.
 * @param launch - The resolved real package root.
 * @param stops - The resolved stops' real files and repository paths.
 * @throws `NODE_SCRIPT_SOURCE_REFUSED` with reason `node-modules` or `outside-package`, naming the first offending stop.
 * @example assertNodeScriptStopsInPackage('/repo', { packageRoot: '/repo/app' }, [{ declaredStopIndex: 0, path: 'lib/a.js', file: '/repo/lib/a.js' }]) // throws reason outside-package
 */
export function assertNodeScriptStopsInPackage(
  workspace: string,
  launch: Pick<ResolvedNodeServerLaunch, 'packageRoot'>,
  stops: ReadonlyArray<{
    declaredStopIndex: number
    path: string
    file: string
  }>,
): void {
  for (const stop of stops) {
    const inside = isInsideFolder(launch.packageRoot, stop.file)
    // A file under node_modules is a published package, even when it is inside the package folder.
    if (
      inside &&
      repositoryPosixPath(launch.packageRoot, stop.file)
        .split('/')
        .includes('node_modules')
    )
      throw refuseNodeScriptSource(
        'node-modules',
        `node-script's stop ${stop.declaredStopIndex + 1} (${stop.path}) is in node_modules, a published package and not the checked-out library; declare the stop in the package's own source.`,
      )
    if (!inside)
      throw refuseNodeScriptSource(
        'outside-package',
        `node-script's stop ${stop.declaredStopIndex + 1} (${stop.path}) is outside the package folder ${repositoryPosixPath(workspace, launch.packageRoot)}; declare stops only in the package's own source.`,
      )
  }
}
