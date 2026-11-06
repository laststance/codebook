import type { ChromeExtensionConfiguration } from './chromeExtensionConfigSchemas'
import type {
  ExtensionBuildFacts,
  ExtensionStopContext,
  ResolvedExtensionStop,
} from './chromeExtensionContracts'
import { StudyError } from './errors'
import { assertNoDuplicateExtensionStops } from './utils/assertNoDuplicateExtensionStops'
import { assertWxtStopsInsideProject } from './utils/assertWxtStopsInsideProject'
import { buildWxtExtension } from './utils/buildWxtExtension'
import {
  discoverStaticLoads,
  type StaticLoads,
} from './utils/discoverStaticLoads'
import {
  listMappedSources,
  type MappedSources,
} from './utils/listMappedSources'
import { memoizeByStopContext } from './utils/memoizeByStopContext'
import type { ExtensionManifest } from './utils/readExtensionManifest'
import { readInstalledWxtVersion } from './utils/readInstalledWxtVersion'
import { resolveExtensionRoot } from './utils/resolveExtensionRoot'
import { resolveStopContextEntry } from './utils/resolveStopContextEntry'
import { resolveUnpackedExtensionStop } from './utils/resolveUnpackedExtensionStop'
import { resolveWxtExtensionStop } from './utils/resolveWxtExtensionStop'
import type { WxtBuildNode } from './utils/wxtBuildTypes'

type DeclaredStop = ChromeExtensionConfiguration['stops'][number]

/** What a source needs of the loaded extension to check a stop: the id Chrome gives it, its manifest and the surface page. */
export interface ExtensionStopEnvironment {
  extensionId: string
  manifest: ExtensionManifest
  /** The surface page's real path inside the load root. */
  surfaceHtml: string
}

/**
 * Where a chrome-extension run's code comes from, behind one boundary for both adapters.
 * The resolver, the run, the debugger and the history ask it instead of branching on the adapter.
 */
export interface ExtensionSource {
  adapter: ChromeExtensionConfiguration['adapter']
  /** The repository's canonical path: identity, revision and the tracked-file check. */
  repositoryRoot: string
  /** The folder stops are declared in: `extensionRoot`'s real path inside the repository. */
  projectRoot: string
  /** The folder Chrome loads: the project root for an unpacked extension, the build's output folder for `wxt-build`. */
  loadRoot: string
  /** What the build made; `wxt-build` only. */
  build?: ExtensionBuildFacts
  /**
   * Checks one declared stop and pins its source.
   * @param stop - The declared stop.
   * @param position - The stop's 0-based position in the configuration.
   * @param environment - The loaded extension's identity, manifest and surface page.
   * @throws `INVALID_CONFIGURATION`, `STOP_FILE_NOT_LOADED` (for `wxt-build` with `details.contextSources`) or `BUNDLED_EXTENSION_UNSUPPORTED`.
   */
  resolveStop(
    stop: DeclaredStop,
    position: number,
    environment: ExtensionStopEnvironment,
  ): Promise<ResolvedExtensionStop>
}

/** What {@link prepareExtensionSource} is given. */
export type PrepareExtensionSourceInput = {
  repositoryRoot: string
  configuration: ChromeExtensionConfiguration
  /** The run's private folder; the `wxt-build` adapter builds into `wxt-build/` inside it. Required for `wxt-build`, unused otherwise. */
  privateFolder?: string
  /** The external Node the build runs with; `undefined` when none could be resolved. */
  node?: WxtBuildNode
  /** Cancels the build; the build ends with the stop error. */
  signal?: AbortSignal
  /** Tells, just before the build starts, the WXT version resolved from the project (`undefined` when it does not resolve). */
  onBuilding?: (wxtVersion: string | undefined) => void
  /** Replaces {@link buildWxtExtension}; a test passes a fake build. */
  buildExtension?: typeof buildWxtExtension
}

/** The error a build that the run's own stop ended raises, as a stop before `ready` always did. */
function stoppedBeforeReady(): StudyError {
  return new StudyError(
    'RUNTIME_FAILED',
    'The extension run was stopped before it was ready.',
  )
}

/** The source of an unpacked extension: the three roots are one folder, and a stop is checked by the static-load rules. */
async function prepareUnpackedSource(
  input: PrepareExtensionSourceInput,
): Promise<ExtensionSource> {
  const { repositoryRoot } = input
  const root = await resolveExtensionRoot(
    repositoryRoot,
    input.configuration.extensionRoot,
  )
  // Discovery runs once per context, however many of its stops are resolved.
  let loadsOf:
    ((context: ExtensionStopContext) => Promise<StaticLoads>) | undefined
  return {
    adapter: 'chrome-mv3-unpacked',
    repositoryRoot,
    projectRoot: root,
    loadRoot: root,
    resolveStop: (stop, position, environment) => {
      loadsOf ??= memoizeByStopContext(async (context) =>
        discoverStaticLoads({
          extensionRoot: root,
          repositoryRoot,
          extensionId: environment.extensionId,
          entry: await resolveStopContextEntry({
            loadRoot: root,
            context,
            manifest: environment.manifest,
            surfaceHtml: environment.surfaceHtml,
          }),
        }),
      )
      return resolveUnpackedExtensionStop({
        stop,
        position,
        extensionRoot: root,
        surfaceHtml: environment.surfaceHtml,
        loads: loadsOf,
      })
    },
  }
}

/** Builds the `wxt-build` source: the project builds into the private folder, and a stop is checked through the build's source maps. */
async function prepareWxtSource(
  input: PrepareExtensionSourceInput,
): Promise<ExtensionSource> {
  const { repositoryRoot, configuration, privateFolder } = input
  const projectRoot = await resolveExtensionRoot(
    repositoryRoot,
    configuration.extensionRoot,
  )
  // A stop that leaves the project is refused before the build, with nothing started.
  assertWxtStopsInsideProject(projectRoot, configuration.stops)
  if (privateFolder === undefined)
    throw new StudyError(
      'RUNTIME_FAILED',
      'The wxt-build adapter needs a private folder for the build.',
    )
  input.onBuilding?.(await readInstalledWxtVersion(projectRoot))
  const result = await (input.buildExtension ?? buildWxtExtension)({
    repositoryRoot,
    projectRoot,
    privateFolder,
    node: input.node,
    signal: input.signal ?? new AbortController().signal,
  })
  // The run's own stop ended the build: the tracked files are verified unchanged, so today's stop error stands.
  if (result.kind === 'cancelled') throw stoppedBeforeReady()
  const { loadRoot } = result
  // Maps are read once per context, however many of its stops are resolved.
  let mappedOf:
    ((context: ExtensionStopContext) => Promise<MappedSources>) | undefined
  return {
    adapter: 'wxt-build',
    repositoryRoot,
    projectRoot,
    loadRoot,
    build: {
      tool: 'wxt',
      version: result.wxtVersion,
      durationMs: result.durationMs,
    },
    resolveStop: async (stop, position, environment) => {
      mappedOf ??= memoizeByStopContext(async (context) =>
        listMappedSources({
          loadRoot,
          projectRoot,
          extensionId: environment.extensionId,
          entry: await resolveStopContextEntry({
            loadRoot,
            context,
            manifest: environment.manifest,
            surfaceHtml: environment.surfaceHtml,
          }),
        }),
      )
      return resolveWxtExtensionStop({
        stop,
        position,
        repositoryRoot,
        mapped: await mappedOf(stop.context),
      })
    },
  }
}

/**
 * Prepares where a chrome-extension run's code comes from: the roots, the build (`wxt-build` only) and the rule that decides whether a stop's source ran.
 * Why: every difference between the two adapters lives here, so a later bundler adds one implementation instead of a branch in the resolver, the run, the debugger and the history.
 * Called by {@link resolveChromeExtensionRun} when it is not handed a source, and by the run before it arms its preparation bound, so a slow build never ends as a preparation failure.
 * @param input - The repository, the configuration and, for `wxt-build`, the private folder, the external Node and the cancellation.
 * @returns The source: for `chrome-mv3-unpacked` the three roots are the resolved extension root and the stop rules are today's; for `wxt-build` the load root is the build output and a stop is checked through its source maps.
 * @throws `STOP_DUPLICATE`, `INVALID_CONFIGURATION` for a root that leaves the repository or does not exist, and for `wxt-build` also `EXTENSION_BUILD_UNSUPPORTED`, `EXTENSION_BUILD_FAILED`, and `RUNTIME_FAILED` when the signal ended the build.
 * @example
 * const source = await prepareExtensionSource({ repositoryRoot: '/repo', configuration })
 * source.loadRoot // => '/repo/ext' for an unpacked extension
 */
export async function prepareExtensionSource(
  input: PrepareExtensionSourceInput,
): Promise<ExtensionSource> {
  assertNoDuplicateExtensionStops(input.configuration.stops)
  return input.configuration.adapter === 'wxt-build'
    ? prepareWxtSource(input)
    : prepareUnpackedSource(input)
}
