import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  VITE_LIBRARY_WALK_CODE_LIMIT_BYTES,
  VITE_LIBRARY_WALK_DEADLINE_MS,
  VITE_LIBRARY_WALK_MODULE_LIMIT_COUNT,
  VITE_OPTIMIZED_DEPS_PATH_SEGMENT,
  VITE_VIRTUAL_MODULE_URL_PREFIXES,
} from '../constants'
import type {
  ViteLibraryModulesCommand,
  ViteLibraryWalkBound,
} from '../viteLauncherProtocol'

import { isInsideFolder } from './isInsideFolder'

/** The part of Vite's module node the walk reads (`EnvironmentModuleNode`). */
type WalkedModuleNode = {
  /** The module's absolute file path without a query; `null` for a virtual module. */
  file?: string | null
  /** The URLs the module imports; in Vite 8.3.5 this also lists `import()` targets. */
  staticImportedUrls?: ReadonlySet<string>
}

/** The part of Vite's client `DevEnvironment` the walk uses; typed structurally so a test passes a small fake. */
export type ViteWalkEnvironment = {
  /** Transforms one URL as the browser's request would (Vite's `transformRequest`). */
  transformRequest(url: string): Promise<{ code: string } | null | undefined>
  moduleGraph: {
    /** Vite 6+ answers a promise; an older graph answers the node directly. */
    getModuleByUrl(
      url: string,
    ): Promise<WalkedModuleNode | undefined> | WalkedModuleNode | undefined
  }
  config?: { cacheDir?: string }
  depsOptimizer?: {
    metadata?: {
      optimized?: Record<string, { src?: string; file?: string }>
    }
  }
}

/** The limits and the clock of one walk; tests replace them so no test waits for the real deadline. */
export type ViteLibraryWalkOptions = {
  moduleLimitCount?: number
  codeLimitBytes?: number
  deadlineMs?: number
  /** The clock in milliseconds; defaults to `Date.now`. */
  now?: () => number
}

/** What one walk found; the launcher sends it as the answer to a library-modules command. */
export type ViteLibraryWalkResult = {
  modules: string[]
  optimizedLibrary: boolean
  bound?: ViteLibraryWalkBound
}

/**
 * Resolves a path through symlinks, or keeps it when it does not exist.
 *
 * Why it exists: the library folder is a real path, so a module's file must be compared by its real path too (a workspace link points into the library). Called by {@link walkViteLibraryModules} and {@link hasOptimizedLibrary}.
 *
 * @param path - An absolute path.
 * @returns The real path, or the path itself when it cannot be resolved.
 * @example
 * await realPathOrSelf('/repo/node_modules/lib/index.js') // => '/repo/packages/lib/index.js'
 */
async function realPathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * Tells whether a served URL is one the walk must not transform or follow: an optimized dependency or a Vite virtual module.
 *
 * Why it exists: a pre-bundled dependency is one rewritten chunk that no source map of the library maps, and Vite's virtual modules hold no library code; the safer route is to leave both untouched. Called by {@link walkViteLibraryModules} before each transform.
 *
 * @param url - A served module URL, possibly with a query.
 * @returns `true` for a URL under the optimizer's cache folder or starting with a virtual prefix.
 * @example
 * isUntouchedViteUrl('/node_modules/.vite/deps/react.js?v=1') // => true
 */
function isUntouchedViteUrl(url: string): boolean {
  return (
    url.includes(VITE_OPTIMIZED_DEPS_PATH_SEGMENT) ||
    VITE_VIRTUAL_MODULE_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
  )
}

/**
 * Tells whether one of Vite's optimized dependencies has its source inside the library folder.
 *
 * Why it exists: the page may then load the library pre-bundled, which the extension refuses instead of guessing. Called by {@link walkViteLibraryModules} once per walk.
 *
 * @param environment - Vite's client environment.
 * @param libraryFolder - The library's real path.
 * @returns `true` when an optimized entry's `src` lies inside the folder; `false` without an optimizer or such an entry.
 * @example
 * await hasOptimizedLibrary(environment, '/repo/packages/lib') // => false
 */
async function hasOptimizedLibrary(
  environment: ViteWalkEnvironment,
  libraryFolder: string,
): Promise<boolean> {
  const optimized = environment.depsOptimizer?.metadata?.optimized ?? {}
  for (const info of Object.values(optimized)) {
    if (typeof info.src !== 'string') continue
    if (isInsideFolder(libraryFolder, await realPathOrSelf(info.src)))
      return true
  }
  return false
}

/** The limits and the clock of one walk, defaults filled in. */
type ResolvedWalkLimits = Required<ViteLibraryWalkOptions>

/**
 * Names the bound a walk has reached, checked before each transform.
 *
 * Why it exists: keeps {@link walkViteLibraryModules} a plain queue loop. Called by it once per URL.
 *
 * @param limits - The walk's limits and clock.
 * @param progress - Modules visited, bytes transformed and the time the walk started.
 * @returns The first bound reached, or `undefined` while the walk may go on.
 * @example
 * reachedWalkBound(limits, { visited: 500, transformedBytes: 0, startedAt: 0 }) // => 'modules'
 */
function reachedWalkBound(
  limits: ResolvedWalkLimits,
  progress: { visited: number; transformedBytes: number; startedAt: number },
): ViteLibraryWalkBound | undefined {
  if (progress.visited >= limits.moduleLimitCount) return 'modules'
  if (progress.transformedBytes >= limits.codeLimitBytes) return 'bytes'
  if (limits.now() - progress.startedAt >= limits.deadlineMs) return 'deadline'
  return undefined
}

/**
 * Appends the URLs the walk has not queued yet.
 *
 * Why it exists: deduplicates by URL, so a cycle ends. Called by {@link walkViteLibraryModules} for each walked module's imports.
 *
 * @param queue - The walk queue, extended in place.
 * @param seen - Every URL queued so far, extended in place.
 * @param imports - The URLs a module imports.
 * @example
 * enqueueNewUrls(queue, seen, new Set(['/a.js']))
 */
function enqueueNewUrls(
  queue: string[],
  seen: Set<string>,
  imports: Iterable<string>,
): void {
  for (const imported of imports) {
    if (seen.has(imported)) continue
    seen.add(imported)
    queue.push(imported)
  }
}

/** What one transformed module contributed to the walk. */
type WalkedModule = {
  /** Whether the module's real file lies inside the library folder. */
  inLibrary: boolean
  /** The URLs to walk next; empty for a module Vite pre-bundled. */
  imports: Iterable<string>
  /** The UTF-8 size of the transformed code. */
  codeBytes: number
}

/**
 * Transforms one URL and reads its module node: its size, whether it belongs to the library and what it imports.
 *
 * Why it exists: keeps {@link walkViteLibraryModules} a plain queue loop. Called by it for each URL it visits.
 *
 * @param environment - Vite's client environment.
 * @param url - The served URL to transform.
 * @param libraryFolder - The library's real path.
 * @returns The module's contribution; `undefined` when Vite has nothing for the URL.
 * @throws When the transform fails; the caller skips the module.
 * @example
 * await readWalkedModule(environment, '/src/main.tsx', '/repo/lib') // => { inLibrary: false, imports: Set {…}, codeBytes: 120 }
 */
async function readWalkedModule(
  environment: ViteWalkEnvironment,
  url: string,
  libraryFolder: string,
): Promise<WalkedModule | undefined> {
  const transformed = await environment.transformRequest(url)
  if (!transformed) return undefined
  const codeBytes = Buffer.byteLength(transformed.code, 'utf8')
  const node = await environment.moduleGraph.getModuleByUrl(url)
  if (!node) return { inLibrary: false, imports: [], codeBytes }
  const file = node.file ? resolve(node.file) : undefined
  const cacheDir = environment.config?.cacheDir
  // A file inside the optimizer's cache is a pre-bundled dependency, however its URL looked: it is neither listed nor followed.
  if (file && cacheDir && isInsideFolder(resolve(cacheDir), file))
    return { inLibrary: false, imports: [], codeBytes }
  return {
    inLibrary:
      file !== undefined &&
      isInsideFolder(libraryFolder, await realPathOrSelf(file)),
    // A library imports its own chunks, so its imports are followed too.
    imports: node.staticImportedUrls ?? [],
    codeBytes,
  }
}

/**
 * Walks Vite's client module graph breadth-first from the entry modules and lists the modules whose real file lies inside one library folder.
 *
 * Why it exists: a browser stop in a workspace library is sealed against the served module that maps it, and only Vite's own graph names the modules the page will load, with the browser's resolution, before the page opens. Called by the owned Vite launcher (`viteLauncher.ts`) for each `vite-library-modules` command.
 *
 * Each URL is transformed first (which fills the graph), then its module node's `staticImportedUrls` are followed (`TransformResult.deps` is unset at runtime in Vite 8.3.5). The result is a superset of what the page loads, because that set also lists `import()` targets. Optimized dependencies and Vite's virtual modules are never transformed or followed. A module whose transform throws is skipped with its imports. The walk never throws as a whole.
 *
 * @param environment - Vite's client environment (`server.environments.client`).
 * @param command - The entry URLs and the library's real path.
 * @param options - Limits and clock; tests inject them.
 * @returns The library's module URLs as the graph names them, in walk order without duplicates; whether an optimized dependency holds the library; the bound that ended the walk, if one did.
 * @example
 * await walkViteLibraryModules(environment, { entries: ['/src/main.tsx'], libraryFolder: '/repo/packages/query-core' })
 * // => { modules: ['/@fs/repo/packages/query-core/build/modern/query.js'], optimizedLibrary: false }
 */
export async function walkViteLibraryModules(
  environment: ViteWalkEnvironment,
  command: Pick<ViteLibraryModulesCommand, 'entries' | 'libraryFolder'>,
  options: ViteLibraryWalkOptions = {},
): Promise<ViteLibraryWalkResult> {
  const limits: ResolvedWalkLimits = {
    moduleLimitCount: VITE_LIBRARY_WALK_MODULE_LIMIT_COUNT,
    codeLimitBytes: VITE_LIBRARY_WALK_CODE_LIMIT_BYTES,
    deadlineMs: VITE_LIBRARY_WALK_DEADLINE_MS,
    now: Date.now,
    ...options,
  }
  const { libraryFolder } = command
  const queue = [...command.entries]
  const seen = new Set(queue)
  const modules: string[] = []
  const progress = { visited: 0, transformedBytes: 0, startedAt: limits.now() }
  let bound: ViteLibraryWalkBound | undefined
  for (const url of queue) {
    if (isUntouchedViteUrl(url)) continue
    // Checked before each transform: the walk stops with what it has and names the bound.
    bound = reachedWalkBound(limits, progress)
    if (bound) break
    progress.visited += 1
    try {
      const walked = await readWalkedModule(environment, url, libraryFolder)
      if (!walked) continue
      progress.transformedBytes += walked.codeBytes
      if (walked.inLibrary) modules.push(url)
      enqueueNewUrls(queue, seen, walked.imports)
    } catch {
      // A module whose transform fails is skipped with its imports; the walk goes on.
    }
  }
  return {
    modules,
    optimizedLibrary: await hasOptimizedLibrary(environment, libraryFolder),
    ...(bound === undefined ? {} : { bound }),
  }
}
