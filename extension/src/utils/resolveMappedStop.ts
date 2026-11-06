import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import { EXTENSION_CONTEXT_SOURCES_LIMIT } from '../constants'

import { hashFileSha256 } from './hashFileSha256'
import type { MappedSources } from './listMappedSources'

/** Why a stop's source is not accepted; each cause has one fixed sentence. */
export type MappedStopRefusalCause =
  | 'not-listed'
  | 'unfollowed-load'
  | 'map-unusable'
  | 'sources-content-missing'
  | 'sources-content-differs'

/** A stop whose source is listed by a loaded chunk's map, with the text the build executed. */
export interface ResolvedMappedStop {
  ok: true
  /** The project file's real path. */
  sourcePath: string
  /** SHA-256 of the file on disk, lowercase hex. */
  sha256: string
  /** The text the map embedded, which equals the file on disk. */
  executedText: string
}

/** A refused stop for `STOP_FILE_NOT_LOADED`, with the project sources the context does list. */
export interface RefusedMappedStop {
  ok: false
  cause: MappedStopRefusalCause
  /** One fixed sentence for the cause; it names the context, and the map or the load form where there is one. */
  message: string
  /** Up to {@link EXTENSION_CONTEXT_SOURCES_LIMIT} listed project sources, relative and sorted. */
  contextSources: readonly string[]
  /** How many project sources the context lists in all. */
  contextSourceCount: number
}

/** Forward-slash path of `absolutePath` below `root`. */
function relativeName(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/')
}

/**
 * Lists the project sources a context's maps list, for the refusal that lets the chat correct a stop path.
 * Called by {@link resolveMappedStop} for every refusal.
 * @param mapped - The context's listed sources.
 * @param relativeTo - The folder the paths are made relative to; the project root by default, which is what a stop's `path` is relative to.
 * @returns The first {@link EXTENSION_CONTEXT_SOURCES_LIMIT} paths in sorted order and the total count.
 * @example
 * listContextSources(mapped) // => { sources: ['src/a.ts', 'src/b.ts'], count: 2 }
 */
function listContextSources(
  mapped: MappedSources,
  relativeTo: string = mapped.projectRoot,
): { sources: string[]; count: number } {
  const all = [...mapped.sources.keys()]
    .map((absolutePath) => relativeName(relativeTo, absolutePath))
    .sort()
  return {
    sources: all.slice(0, EXTENSION_CONTEXT_SOURCES_LIMIT),
    count: all.length,
  }
}

/** The sentence for a source that no usable map lists: a map that could not be read, a load form that is not followed, or nothing. */
function unlistedCause(
  mapped: MappedSources,
  stopPath: string,
): Pick<RefusedMappedStop, 'cause' | 'message'> {
  const context = mapped.context
  // A named map that was capped or malformed may have held the source, so it is named first.
  const unusable = mapped.unlisted.find((entry) => entry.kind !== 'no-map')
  if (unusable)
    return {
      cause: 'map-unusable',
      message: `Stop file ${stopPath} is not listed for the ${context} context, and the map ${unusable.map} lists nothing because ${unusable.reason}.`,
    }
  const unfollowed = mapped.unfollowed[0]
  if (unfollowed)
    return {
      cause: 'unfollowed-load',
      message: `Stop file ${stopPath} is not listed for the ${context} context; ${unfollowed.path} loads code through a ${unfollowed.form}, which is not followed.`,
    }
  return {
    cause: 'not-listed',
    message: `Stop file ${stopPath} is not listed by any source map the ${context} context loads.`,
  }
}

/**
 * Decides whether a stop declared in a project source can run in a context, and fixes what its replay will show.
 * Why: a `wxt-build` stop is valid only when a chunk its context loads has a map that lists the file and embeds the very text on disk, so a replay never shows code that did not run.
 * Called by the extension-source boundary for each stop, with {@link listMappedSources}'s answer for the stop's context.
 * @param options.projectRoot - The project folder's real path; the stop's file must be inside it.
 * @param options.stopPath - The stop's path relative to the project root.
 * @param options.mapped - What the stop's context loads, from {@link listMappedSources}.
 * @param options.relativeTo - The folder `contextSources` are relative to; defaults to the project root.
 * @returns
 * - `ok` with the real path, the file's SHA-256 and the executed text
 * - a refusal with the cause, one sentence and the sources the context does list
 * @example
 * await resolveMappedStop({ stopPath: 'src/App.tsx', mapped })
 * // => { ok: true, sourcePath: '/repo/app/src/App.tsx', sha256: '9f86…', executedText: 'export …' }
 */
export async function resolveMappedStop(options: {
  stopPath: string
  mapped: MappedSources
  relativeTo?: string
}): Promise<ResolvedMappedStop | RefusedMappedStop> {
  const { stopPath, mapped } = options
  const real = await realpath(resolve(mapped.projectRoot, stopPath)).catch(
    () => undefined,
  )
  const listed = real === undefined ? undefined : mapped.sources.get(real)
  const refuse = (
    refusal: Pick<RefusedMappedStop, 'cause' | 'message'>,
  ): RefusedMappedStop => {
    const context = listContextSources(mapped, options.relativeTo)
    return {
      ok: false,
      ...refusal,
      message: `${refusal.message} The ${mapped.context} context lists ${context.count} project source${context.count === 1 ? '' : 's'}.`,
      contextSources: context.sources,
      contextSourceCount: context.count,
    }
  }
  if (real === undefined || listed === undefined)
    return refuse(unlistedCause(mapped, stopPath))
  if (listed.sourcesContent === undefined)
    return refuse({
      cause: 'sources-content-missing',
      message: `Stop file ${stopPath} is listed by ${listed.map}, but that map embeds no text for it, so the executed source cannot be confirmed.`,
    })
  const onDisk = await readFile(real, 'utf8').catch(() => undefined)
  if (onDisk !== listed.sourcesContent)
    return refuse({
      cause: 'sources-content-differs',
      message: `Stop file ${stopPath} differs from the source the build embedded in ${listed.map}; the build's source differs from the file.`,
    })
  return {
    ok: true,
    sourcePath: real,
    sha256: await hashFileSha256(real),
    executedText: listed.sourcesContent,
  }
}
