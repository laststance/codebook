import { posix } from 'node:path'

import type { ChromeExtensionConfiguration } from '../chromeExtensionConfigSchemas'
import type {
  ExtensionStopContext,
  ResolvedExtensionStop,
} from '../chromeExtensionContracts'
import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { assertStopNotBundled } from './assertStopNotBundled'
import type { StaticLoads } from './discoverStaticLoads'
import { readFileOrRefuse } from './readFileOrRefuse'
import { resolveExtensionFile } from './resolveExtensionFile'
import { splitSourceLines } from './splitSourceLines'

/** Names a stop context as the refusal sentences do. */
const CONTEXT_WORDS: Record<ExtensionStopContext, string> = {
  page: 'page',
  'service-worker': 'service worker',
}

/** Words the unfollowed load forms for a refusal: `Not followed: dynamic import in a.js, bare specifier in b.js.` or an empty string. */
function describeUnfollowed(loads: StaticLoads): string {
  if (loads.unfollowed.length === 0) return ''
  const named = loads.unfollowed.map(
    (entry) => `${entry.form} in ${entry.path}`,
  )
  return ` Not followed: ${named.join(', ')}.`
}

/**
 * Checks one stop of an unpacked extension and pins its file: confinement, existence, line, static load, inline script, bundled rule.
 * Called by the `chrome-mv3-unpacked` extension source for each declared stop; the rules are exactly the ones the resolver applied before the extension source existed.
 * @param options.stop - The declared stop.
 * @param options.position - The stop's 0-based position in the configuration; the refusal sentences use position + 1.
 * @param options.extensionRoot - The extension root's real path.
 * @param options.surfaceHtml - The surface page's real path; a page stop in it is in an inline script.
 * @param options.loads - The static loads of the stop's context.
 * @returns The resolved stop with the file's SHA-256.
 * @throws `INVALID_CONFIGURATION`, `STOP_FILE_NOT_LOADED` or `BUNDLED_EXTENSION_UNSUPPORTED`.
 * @example
 * await resolveUnpackedExtensionStop({ stop, position: 0, extensionRoot, surfaceHtml, loads }) // => { index: 1, path: 'popup.js', … }
 */
export async function resolveUnpackedExtensionStop(options: {
  stop: ChromeExtensionConfiguration['stops'][number]
  position: number
  extensionRoot: string
  surfaceHtml: string
  loads: (context: ExtensionStopContext) => Promise<StaticLoads>
}): Promise<ResolvedExtensionStop> {
  const { stop, position, extensionRoot, surfaceHtml } = options
  const index = position + 1
  const field = `configuration.stops[${position}]`
  const absolutePath = await resolveExtensionFile({
    extensionRoot,
    relativePath: stop.path,
    field: `${field}.path`,
  })
  const bytes = await readFileOrRefuse(absolutePath, stop.path, `${field}.path`)
  const source = bytes.toString('utf8')
  const lines = splitSourceLines(source)
  if (stop.line > lines.length)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `${field}.line is past the end of ${stop.path}.`,
    )
  // A page stop inside the surface page's own HTML can only be in an inline script.
  if (stop.context === 'page' && absolutePath === surfaceHtml)
    throw new StudyError(
      'STOP_FILE_NOT_LOADED',
      `Stop ${index} is in an inline script; declare it in a script file.`,
    )
  const loads = await options.loads(stop.context)
  if (!loads.reachable.has(absolutePath))
    throw new StudyError(
      'STOP_FILE_NOT_LOADED',
      `Stop ${index} is in a file the ${CONTEXT_WORDS[stop.context]} does not load.${describeUnfollowed(loads)}`,
    )
  assertStopNotBundled(index, source, lines[stop.line - 1] ?? '')
  return {
    index,
    path: posix.normalize(stop.path),
    absolutePath,
    line: stop.line,
    context: stop.context,
    sha256: sha256(bytes),
  }
}
