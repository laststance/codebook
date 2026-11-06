import { join, posix } from 'node:path'

import type { ChromeExtensionConfiguration } from './chromeExtensionConfigSchemas'
import type {
  ResolvedExtensionClick,
  ResolvedExtensionRun,
  ResolvedExtensionStop,
} from './chromeExtensionContracts'
import { StudyError } from './errors'
import {
  prepareExtensionSource,
  type ExtensionSource,
  type ExtensionStopEnvironment,
} from './extensionSource'
import { sha256 } from './runtimeSupport/utils/sha256'
import { assertExtensionLinksInside } from './utils/assertExtensionLinksInside'
import {
  chromeExtensionIdFromKey,
  chromeExtensionIdFromPath,
} from './utils/chromeExtensionId'
import { extensionFileUrl } from './utils/extensionFileUrl'
import { extensionPermissionsNeedingAcknowledgement } from './utils/extensionPermissionsNeedingAcknowledgement'
import { readExtensionManifest } from './utils/readExtensionManifest'
import type { ExtensionManifest } from './utils/readExtensionManifest'
import { readFileOrRefuse } from './utils/readFileOrRefuse'
import { resolveExtensionFile } from './utils/resolveExtensionFile'

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
 * Order: the extension source (duplicate stops, extension root and, for `wxt-build`, the build), link walk (ER6), manifest (readable, V3), declared surfaces, permissions (ER5), surface page, then each stop in declaration order, checked by the source (confinement, line, static load or source map, inline script, bundled rule). The first refusal is thrown. Pins the SHA-256 of the manifest, the surface page and every stop file (ER20).
 * The manifest, the surface, the static loads and the link walk run on the source's load root; the stops resolve through the source; the repository identity stays on the repository root.
 * Called by the chrome-extension start after {@link parseChromeExtensionConfiguration}.
 * @param options.repositoryRoot - The opened repository's canonical path.
 * @param options.configuration - The parsed configuration.
 * @param options.source - The prepared extension source; the run passes one it built before arming its preparation bound. Absent, {@link prepareExtensionSource} makes it (an unpacked extension needs nothing else).
 * @returns The resolved run (see {@link ResolvedExtensionRun}); indexes are 1-based.
 * @throws `StudyError` with `STOP_DUPLICATE`, `INVALID_CONFIGURATION`, `EXTENSION_BUILD_UNSUPPORTED`, `EXTENSION_BUILD_FAILED`, `EXTENSION_LINK_OUTSIDE`, `MANIFEST_UNREADABLE`, `MANIFEST_NOT_V3`, `MANIFEST_SURFACE_MISSING`, `PERMISSIONS_NEED_ACKNOWLEDGEMENT`, `STOP_FILE_NOT_LOADED` or `BUNDLED_EXTENSION_UNSUPPORTED`.
 * @example
 * const run = await resolveChromeExtensionRun({ repositoryRoot: '/repo', configuration })
 * run.surfaceUrl // => 'chrome-extension://kgdak…/popup/popup.html'
 */
export async function resolveChromeExtensionRun(options: {
  repositoryRoot: string
  configuration: ChromeExtensionConfiguration
  source?: ExtensionSource
}): Promise<ResolvedExtensionRun> {
  const { repositoryRoot, configuration } = options
  const source =
    options.source ??
    (await prepareExtensionSource({ repositoryRoot, configuration }))
  const root = source.loadRoot
  // The walk's confinement is the load root: nothing Chrome serves may link out of it (for an unpacked extension it is the repository, as before).
  await assertExtensionLinksInside(
    source.adapter === 'wxt-build' ? root : repositoryRoot,
    root,
  )
  const manifest = await readExtensionManifest(root)
  assertManifestDeclaresSurfaces(configuration, manifest)
  assertPermissionsAcknowledged(manifest, configuration.acknowledgedPermissions)
  // A manifest key decides the id; otherwise Chrome derives it from the canonical path.
  const extensionId =
    manifest.key === undefined
      ? chromeExtensionIdFromPath(root)
      : chromeExtensionIdFromKey(manifest.key)
  const surface = await resolveSurfacePage(configuration, manifest, root)
  const environment: ExtensionStopEnvironment = {
    extensionId,
    manifest,
    surfaceHtml: surface.absolutePath,
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
    stops.push(await source.resolveStop(stop, position, environment))
  // The names may differ while the files are the same (link alias, case variant): compare the resolved paths.
  assertNoDuplicateResolvedStops(stops)
  return {
    root,
    ...(source.build === undefined ? {} : { build: source.build }),
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
      [surface.absolutePath]: sha256(surfaceBytes),
      ...Object.fromEntries(
        stops.map((stop) => [stop.absolutePath, stop.sha256]),
      ),
    },
  }
}
