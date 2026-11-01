import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'

import type { ChromeExtensionConfiguration } from './chromeExtensionConfigSchemas'
import type {
  ExtensionStopContext,
  ResolvedExtensionClick,
  ResolvedExtensionRun,
  ResolvedExtensionStop,
} from './chromeExtensionContracts'
import { StudyError } from './errors'
import { assertExtensionLinksInside } from './utils/assertExtensionLinksInside'
import { assertStopNotBundled } from './utils/assertStopNotBundled'
import {
  chromeExtensionIdFromKey,
  chromeExtensionIdFromPath,
} from './utils/chromeExtensionId'
import {
  discoverStaticLoads,
  type StaticLoads,
} from './utils/discoverStaticLoads'
import { extensionFileUrl } from './utils/extensionFileUrl'
import { extensionPermissionsNeedingAcknowledgement } from './utils/extensionPermissionsNeedingAcknowledgement'
import { isInsideFolder } from './utils/isInsideFolder'
import {
  readExtensionManifest,
  type ExtensionManifest,
} from './utils/readExtensionManifest'
import { resolveExtensionFile } from './utils/resolveExtensionFile'
import { splitSourceLines } from './utils/splitSourceLines'

type DeclaredStop = ChromeExtensionConfiguration['stops'][number]

/** Names a stop context as the refusal sentences do. */
const CONTEXT_WORDS: Record<ExtensionStopContext, string> = {
  page: 'page',
  'service-worker': 'service worker',
}

/** SHA-256 of bytes, lowercase hex. */
function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Reads a declared file, wording a directory or unreadable file as a configuration refusal instead of a raw file system error.
 * @throws `INVALID_CONFIGURATION` "`<field> is not a readable file: <path>.`".
 */
async function readFileOrRefuse(
  absolutePath: string,
  declaredPath: string,
  field: string,
): Promise<Buffer> {
  try {
    return await readFile(absolutePath)
  } catch {
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `${field} is not a readable file: ${declaredPath}.`,
    )
  }
}

/**
 * Refuses two stops at the same path, line and context (SR5); a line may be declared once per context (ER21).
 * @throws `STOP_DUPLICATE` with the 1-based indexes.
 */
function assertNoDuplicateStops(stops: readonly DeclaredStop[]): void {
  const firstSeen = new Map<string, number>()
  stops.forEach((stop, position) => {
    const key = `${stop.context}\u0000${stop.line}\u0000${posix.normalize(stop.path)}`
    const earlier = firstSeen.get(key)
    if (earlier !== undefined)
      throw new StudyError(
        'STOP_DUPLICATE',
        `Stops ${earlier} and ${position + 1} are the same.`,
      )
    firstSeen.set(key, position + 1)
  })
}

/**
 * Refuses two stops that resolve to the same real file, line and context although they were written differently (a link alias or a case variant).
 * @throws `STOP_DUPLICATE` with the declared 1-based indexes.
 */
function assertNoDuplicateResolvedStops(
  stops: readonly ResolvedExtensionStop[],
): void {
  const firstSeen = new Map<string, number>()
  for (const stop of stops) {
    const key = `${stop.context}\u0000${stop.line}\u0000${stop.absolutePath}`
    const earlier = firstSeen.get(key)
    if (earlier !== undefined)
      throw new StudyError(
        'STOP_DUPLICATE',
        `Stops ${earlier} and ${stop.index} are the same.`,
      )
    firstSeen.set(key, stop.index)
  }
}

/**
 * Resolves the declared extension root to its realpath inside the repository.
 * @throws `INVALID_CONFIGURATION` when the root leaves the repository by name or through a link, or does not exist.
 */
async function resolveExtensionRoot(
  repositoryRoot: string,
  extensionRoot: string,
): Promise<string> {
  const outside = new StudyError(
    'INVALID_CONFIGURATION',
    'configuration.extensionRoot must stay inside the repository.',
  )
  const isInRepository = (path: string) =>
    path === repositoryRoot || isInsideFolder(repositoryRoot, path)
  const lexical = resolve(repositoryRoot, extensionRoot)
  if (!isInRepository(lexical)) throw outside
  const real = await realpath(lexical).catch(() => undefined)
  if (real === undefined)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `configuration.extensionRoot does not exist: ${extensionRoot}.`,
    )
  if (!isInRepository(real)) throw outside
  return real
}

/**
 * Refuses a manifest that lacks what the declared surface or stops need.
 * @throws `MANIFEST_SURFACE_MISSING` for a popup surface without `action.default_popup`, or a service-worker stop without `background.service_worker`.
 */
function assertManifestDeclaresSurfaces(
  configuration: ChromeExtensionConfiguration,
  manifest: ExtensionManifest,
): void {
  if (
    configuration.surface.kind === 'popup' &&
    manifest.popupPath === undefined
  )
    throw new StudyError(
      'MANIFEST_SURFACE_MISSING',
      'The manifest declares no popup.',
    )
  const needsWorker = configuration.stops.some(
    (stop) => stop.context === 'service-worker',
  )
  if (needsWorker && manifest.workerPath === undefined)
    throw new StudyError(
      'MANIFEST_SURFACE_MISSING',
      'The manifest declares no service worker.',
    )
}

/**
 * Refuses a manifest whose reaching-out permissions are not acknowledged exactly (ER5).
 * @throws `PERMISSIONS_NEED_ACKNOWLEDGEMENT` listing the entries, unless `acknowledged` holds exactly them (order and repeats ignored).
 */
function assertPermissionsAcknowledged(
  manifest: ExtensionManifest,
  acknowledged: readonly string[] | undefined,
): void {
  const needing = extensionPermissionsNeedingAcknowledgement(
    [...manifest.permissions, ...manifest.optionalPermissions],
    [...manifest.hostPermissions, ...manifest.optionalHostPermissions],
  )
  if (needing.length === 0) return
  const wanted = [...new Set(needing)].sort()
  const given = [...new Set(acknowledged ?? [])].sort()
  if (
    wanted.length === given.length &&
    wanted.every((entry, i) => entry === given[i])
  )
    return
  throw new StudyError(
    'PERMISSIONS_NEED_ACKNOWLEDGEMENT',
    `The manifest declares permissions that reach outside the test profile: ${needing.join(', ')}. Pass them in acknowledgedPermissions after telling the learner.`,
  )
}

/** Words the unfollowed load forms for a refusal: `Not followed: dynamic import in a.js, bare specifier in b.js.` or an empty string. */
function describeUnfollowed(loads: StaticLoads): string {
  if (loads.unfollowed.length === 0) return ''
  const named = loads.unfollowed.map(
    (entry) => `${entry.form} in ${entry.path}`,
  )
  return ` Not followed: ${named.join(', ')}.`
}

/** Everything the per-stop checks share: the root, the pinned surface page and the lazily discovered loads of each context. */
interface StopCheckEnvironment {
  repositoryRoot: string
  extensionRoot: string
  extensionId: string
  manifest: ExtensionManifest
  surfaceHtml: string
  loadsOf(context: ExtensionStopContext): Promise<StaticLoads>
}

/**
 * Checks one declared stop and pins its file: confinement, existence, line, static load, inline script, bundled rule.
 * @param position - The stop's 0-based position in the configuration; the refusal sentences use position + 1.
 * @returns The resolved stop with the file's SHA-256.
 * @throws `INVALID_CONFIGURATION`, `STOP_FILE_NOT_LOADED` or `BUNDLED_EXTENSION_UNSUPPORTED`.
 */
async function resolveStop(
  stop: DeclaredStop,
  position: number,
  environment: StopCheckEnvironment,
): Promise<ResolvedExtensionStop> {
  const index = position + 1
  const field = `configuration.stops[${position}]`
  const absolutePath = await resolveExtensionFile({
    extensionRoot: environment.extensionRoot,
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
  if (stop.context === 'page' && absolutePath === environment.surfaceHtml)
    throw new StudyError(
      'STOP_FILE_NOT_LOADED',
      `Stop ${index} is in an inline script; declare it in a script file.`,
    )
  const loads = await environment.loadsOf(stop.context)
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
    sha256: sha256Of(bytes),
  }
}

/** Builds the lazy, memoized static-load discovery of both contexts. */
function createLoadsOf(options: {
  repositoryRoot: string
  extensionRoot: string
  extensionId: string
  manifest: ExtensionManifest
  surfaceHtml: string
}): StopCheckEnvironment['loadsOf'] {
  const { repositoryRoot, extensionRoot, extensionId, manifest, surfaceHtml } =
    options
  const memo = new Map<ExtensionStopContext, Promise<StaticLoads>>()
  return (context) => {
    const known = memo.get(context)
    if (known) return known
    const discovered =
      context === 'page'
        ? discoverStaticLoads({
            extensionRoot,
            repositoryRoot,
            extensionId,
            entry: { kind: 'page', htmlPath: surfaceHtml },
          })
        : resolveExtensionFile({
            extensionRoot,
            relativePath: manifest.workerPath ?? '',
            field: "The manifest's background.service_worker",
            code: 'MANIFEST_SURFACE_MISSING',
          }).then((scriptPath) =>
            discoverStaticLoads({
              extensionRoot,
              repositoryRoot,
              extensionId,
              entry: {
                kind: 'worker',
                scriptPath,
                isModule: manifest.workerType === 'module',
              },
            }),
          )
    memo.set(context, discovered)
    return discovered
  }
}

/** Resolves the surface page's real path from the configuration or the manifest's popup. */
async function resolveSurfacePage(
  configuration: ChromeExtensionConfiguration,
  manifest: ExtensionManifest,
  extensionRoot: string,
): Promise<{ kind: 'popup' | 'page'; path: string; absolutePath: string }> {
  const { surface } = configuration
  const isPage = surface.kind === 'page'
  const path = isPage ? surface.path : (manifest.popupPath ?? '')
  const absolutePath = await resolveExtensionFile({
    extensionRoot,
    relativePath: path,
    field: isPage
      ? 'configuration.surface.path'
      : "The manifest's action.default_popup",
    code: isPage ? 'INVALID_CONFIGURATION' : 'MANIFEST_SURFACE_MISSING',
  })
  return { kind: surface.kind, path: posix.normalize(path), absolutePath }
}

/** Adds the 1-based index and the click kind default to each declared click. */
function resolveClicks(
  configuration: ChromeExtensionConfiguration,
): ResolvedExtensionClick[] {
  return configuration.clicks.map((click, position) => ({
    index: position + 1,
    title: click.title,
    selector: click.selector,
    kind: click.kind,
    ...(click.dialog === undefined ? {} : { dialog: click.dialog }),
    inputs: click.inputs ?? [],
  }))
}

/**
 * Runs every pre-launch check of a chrome-extension run in a fixed order and returns what the launch, the debugger and the executor need.
 * Order: duplicate stops, extension root, link walk (ER6), manifest (readable, V3), declared surfaces, permissions (ER5), surface page, then each stop in declaration order (confinement, line, static load, inline script, bundled rule). The first refusal is thrown. Pins the SHA-256 of the manifest, the surface page and every stop file (ER20).
 * Called by the chrome-extension start after {@link parseChromeExtensionConfiguration}.
 * @param options.repositoryRoot - The opened repository's canonical path.
 * @param options.configuration - The parsed configuration.
 * @returns The resolved run (see {@link ResolvedExtensionRun}); indexes are 1-based.
 * @throws `StudyError` with `STOP_DUPLICATE`, `INVALID_CONFIGURATION`, `EXTENSION_LINK_OUTSIDE`, `MANIFEST_UNREADABLE`, `MANIFEST_NOT_V3`, `MANIFEST_SURFACE_MISSING`, `PERMISSIONS_NEED_ACKNOWLEDGEMENT`, `STOP_FILE_NOT_LOADED` or `BUNDLED_EXTENSION_UNSUPPORTED`.
 * @example
 * const run = await resolveChromeExtensionRun({ repositoryRoot: '/repo', configuration })
 * run.surfaceUrl // => 'chrome-extension://kgdak…/popup/popup.html'
 */
export async function resolveChromeExtensionRun(options: {
  repositoryRoot: string
  configuration: ChromeExtensionConfiguration
}): Promise<ResolvedExtensionRun> {
  const { repositoryRoot, configuration } = options
  assertNoDuplicateStops(configuration.stops)
  const root = await resolveExtensionRoot(
    repositoryRoot,
    configuration.extensionRoot,
  )
  await assertExtensionLinksInside(repositoryRoot, root)
  const manifest = await readExtensionManifest(root)
  assertManifestDeclaresSurfaces(configuration, manifest)
  assertPermissionsAcknowledged(manifest, configuration.acknowledgedPermissions)
  // A manifest key decides the id; otherwise Chrome derives it from the canonical path.
  const extensionId =
    manifest.key === undefined
      ? chromeExtensionIdFromPath(root)
      : chromeExtensionIdFromKey(manifest.key)
  const surface = await resolveSurfacePage(configuration, manifest, root)
  const environment: StopCheckEnvironment = {
    repositoryRoot,
    extensionRoot: root,
    extensionId,
    manifest,
    surfaceHtml: surface.absolutePath,
    loadsOf: createLoadsOf({
      repositoryRoot,
      extensionRoot: root,
      extensionId,
      manifest,
      surfaceHtml: surface.absolutePath,
    }),
  }
  // Read before the stops, so an unreadable surface is named before a stop that depends on it.
  const surfaceBytes = await readFileOrRefuse(
    surface.absolutePath,
    surface.path,
    'configuration.surface.path',
  )
  const stops: ResolvedExtensionStop[] = []
  // Sequential, so the first failing stop is always the same one.
  for (const [position, stop] of configuration.stops.entries())
    stops.push(await resolveStop(stop, position, environment))
  // The names may differ while the files are the same (link alias, case variant): compare the resolved paths.
  assertNoDuplicateResolvedStops(stops)
  return {
    root,
    extensionId,
    manifestName: manifest.name,
    manifestVersion: manifest.version,
    permissions: manifest.permissions,
    hostPermissions: manifest.hostPermissions,
    surface: { kind: surface.kind, path: surface.path },
    surfaceUrl: extensionFileUrl(surface.path, extensionId).href,
    ...(manifest.workerPath === undefined
      ? {}
      : { workerPath: manifest.workerPath }),
    stops,
    clicks: resolveClicks(configuration),
    seed: {
      bookmarks: configuration.seed.bookmarks ?? [],
      storage: configuration.seed.storage ?? {},
    },
    observe: configuration.observe,
    pinnedHashes: {
      [join(root, 'manifest.json')]: manifest.sha256,
      [surface.absolutePath]: sha256Of(surfaceBytes),
      ...Object.fromEntries(
        stops.map((stop) => [stop.absolutePath, stop.sha256]),
      ),
    },
  }
}
