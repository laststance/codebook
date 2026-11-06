import { realpath } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import { EXTENSION_SOURCE_MAP_LIMIT_BYTES } from '../constants'

import {
  discoverStaticLoads,
  type StaticLoadEntry,
  type UnfollowedLoad,
} from './discoverStaticLoads'
import { isInsideFolder } from './isInsideFolder'
import { readChunkSourceMap, type UnlistedMapKind } from './readChunkSourceMap'
import { resolveMapSource } from './resolveMapSource'

/** The two places a stop can run in; the same names as a stop's `context`. */
export type MappedSourceContext = 'page' | 'service-worker'

/** One project source a loaded chunk's map lists. */
export interface MappedSource {
  /** The chunk that names the map, relative to the load root with forward slashes. */
  chunk: string
  /** The map file relative to the load root, or the chunk itself for an embedded `data:` map. */
  map: string
  /** The text the build embedded for this source, or `undefined` when the map embeds none. */
  sourcesContent: string | undefined
}

/** A map (or chunk) that listed no sources, and why. */
export interface UnlistedMap {
  /** The chunk, relative to the load root. */
  chunk: string
  /** The map file relative to the load root, or the chunk itself for an embedded map; the chunk's own name when no map was named. */
  map: string
  kind: UnlistedMapKind | 'no-map'
  reason: string
}

/** What one context's statically loaded chunks list. */
export interface MappedSources {
  context: MappedSourceContext
  /** Absolute real path of a project source to the first loaded chunk's map that lists it (one with `sourcesContent` wins). Only sources inside the project root and outside `node_modules` are kept. */
  sources: ReadonlyMap<string, MappedSource>
  /** Chunks whose map listed nothing, in load order. */
  unlisted: readonly UnlistedMap[]
  /** Load forms the static-load discovery saw and did not follow. */
  unfollowed: readonly UnfollowedLoad[]
  /** The project root's real path the sources were matched against. */
  projectRoot: string
}

/** Whether a path below the project root runs through a `node_modules` folder. */
function isInNodeModules(projectRoot: string, absolutePath: string): boolean {
  return relative(projectRoot, absolutePath).split(sep).includes('node_modules')
}

/** Forward-slash path of `absolutePath` below `root`, for names a refusal quotes. */
function nameBelow(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/')
}

/** Adds the project sources of one map to `sources`; an existing entry stays unless it has no text and the new one has. */
async function addMapSources(
  sources: Map<string, MappedSource>,
  options: {
    projectRoot: string
    map: {
      sources: readonly string[]
      sourceRoot: string
      sourcesContent: readonly (string | null)[] | undefined
    }
    folder: string
    chunk: string
    mapName: string
  },
): Promise<void> {
  const { projectRoot, map, folder } = options
  for (const [index, source] of map.sources.entries()) {
    const resolved = resolveMapSource(folder, map.sourceRoot, source)
    if (resolved === undefined) continue
    // Compare real paths, so a link or a differently cased folder still matches the stop's file.
    const real = await realpath(resolved).catch(() => resolved)
    if (
      !isInsideFolder(projectRoot, real) ||
      isInNodeModules(projectRoot, real)
    )
      continue
    const text = map.sourcesContent?.[index] ?? undefined
    const existing = sources.get(real)
    if (
      existing &&
      (existing.sourcesContent !== undefined || text === undefined)
    )
      continue
    sources.set(real, {
      chunk: options.chunk,
      map: options.mapName,
      sourcesContent: text,
    })
  }
}

/**
 * Lists the project sources the source maps of a context's statically loaded chunks name.
 * Why: a `wxt-build` run loads a build whose files are bundles, so a stop declared in a TypeScript file is valid only when a chunk its context loads has a map that lists that file.
 * Called by the extension-source boundary once per context that declares a stop; {@link resolveMappedStop} reads its answer.
 * @param options.loadRoot - The build folder the extension is loaded from; static loads and map files must lie inside it.
 * @param options.projectRoot - The project folder; only sources inside it and outside `node_modules` are listed.
 * @param options.extensionId - The run's extension id, which decides which `chrome-extension://` urls the static-load discovery follows.
 * @param options.entry - The surface page's HTML or the service worker script, absolute inside the load root.
 * @param options.mapLimitBytes - The most bytes of one map to read; defaults to {@link EXTENSION_SOURCE_MAP_LIMIT_BYTES}.
 * @returns The listed sources, the chunks whose map listed nothing with the reason, and the load forms discovery did not follow.
 * @example
 * await listMappedSources({ loadRoot, projectRoot, extensionId, entry: { kind: 'page', htmlPath: `${loadRoot}/options.html` } })
 * // => { context: 'page', sources: Map { '<project>/src/App.tsx' => { chunk: 'chunks/options.js', map: 'chunks/options.js.map', … } }, unlisted: [], unfollowed: [], projectRoot }
 */
export async function listMappedSources(options: {
  loadRoot: string
  projectRoot: string
  extensionId: string
  entry: StaticLoadEntry
  mapLimitBytes?: number
}): Promise<MappedSources> {
  const { entry, extensionId } = options
  const loadRoot = await realpath(options.loadRoot)
  const projectRoot = await realpath(options.projectRoot)
  const limitBytes = options.mapLimitBytes ?? EXTENSION_SOURCE_MAP_LIMIT_BYTES
  // The load root is the extension root and the confinement root of the discovery: nothing outside the build counts as loaded.
  const loads = await discoverStaticLoads({
    extensionRoot: loadRoot,
    extensionId,
    entry,
  })
  const sources = new Map<string, MappedSource>()
  const unlisted: UnlistedMap[] = []
  // Maps are read one after another, so at most one map's text is in memory.
  for (const chunkPath of loads.reachable) {
    const chunk = nameBelow(loadRoot, chunkPath)
    const read = await readChunkSourceMap(chunkPath, loadRoot, limitBytes)
    if (read.status === 'none') {
      unlisted.push({
        chunk,
        map: chunk,
        kind: 'no-map',
        reason: 'it names no source map',
      })
    } else if (read.status === 'unlisted') {
      unlisted.push({
        chunk,
        map: nameBelow(loadRoot, read.location),
        kind: read.kind,
        reason: read.reason,
      })
    } else {
      await addMapSources(sources, {
        projectRoot,
        map: read.map,
        folder: read.folder,
        chunk,
        mapName: nameBelow(loadRoot, read.location),
      })
    }
  }
  return {
    context: entry.kind === 'page' ? 'page' : 'service-worker',
    sources,
    unlisted,
    unfollowed: loads.unfollowed,
    projectRoot,
  }
}
