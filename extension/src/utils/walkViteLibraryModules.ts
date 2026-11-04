import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  VITE_LIBRARY_WALK_CODE_LIMIT_BYTES,
  VITE_LIBRARY_WALK_DEADLINE_MS,
  VITE_LIBRARY_WALK_MODULE_LIMIT_COUNT,
  VITE_OPTIMIZED_DEPS_PATH_SEGMENT,
  VITE_CLIENT_HELPER_URL_PREFIXES,
} from '../constants'
import type {
  ViteLibraryModulesCommand,
  ViteLibraryWalkBound,
} from '../viteLauncherProtocol'

import { isInsideFolder } from './isInsideFolder'
import { viteModuleIdentityKey } from './viteModuleIdentityKey'

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
  /**
   * Starts a one-shot timer and answers a function that cancels it; defaults to `setTimeout` / `clearTimeout`.
   * Tests inject a scripted timer so no test waits for the real deadline.
   */
  startTimer?: (callback: () => void, delayMs: number) => () => void
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
 * Tells whether a served URL is one the walk must not transform or follow: an optimized dependency or one of Vite's own client helpers.
 *
 * Why it exists: a pre-bundled dependency is one rewritten chunk that no source map of the library maps, and Vite's client helpers import no application code; the safer route is to leave both untouched. Plugin virtual modules are walked, because a generated module may import a library. Called by {@link walkViteLibraryModules} before each transform.
 *
 * @param url - A served module URL, possibly with a query.
 * @returns `true` for a URL under the optimizer's cache folder or starting with a client-helper prefix.
 * @example
 * isUntouchedViteUrl('/node_modules/.vite/deps/react.js?v=1') // => true
 */
function isUntouchedViteUrl(url: string): boolean {
  return (
    url.includes(VITE_OPTIMIZED_DEPS_PATH_SEGMENT) ||
    VITE_CLIENT_HELPER_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
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

/**
 * Starts a real one-shot timer and answers the function that cancels it.
 *
 * Why it exists: the default of {@link ViteLibraryWalkOptions.startTimer}. Called by {@link walkViteLibraryModules} when a test injects no timer.
 *
 * @param callback - Runs once after the delay.
 * @param delayMs - The delay in milliseconds.
 * @returns A function that cancels the timer.
 * @example
 * const cancel = startRealTimer(() => {}, 100)
 * cancel()
 */
function startRealTimer(callback: () => void, delayMs: number): () => void {
  const handle = setTimeout(callback, delayMs)
  return (): void => clearTimeout(handle)
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
  /** The module's real file path when it lies in the library; the key (file plus meaning-changing query) that keeps one module from being listed under two URLs. */
  libraryFile?: string
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
  const realFile = node.file
    ? await realPathOrSelf(resolve(node.file))
    : undefined
  const cacheDir = environment.config?.cacheDir
  // A file inside the optimizer's cache is a pre-bundled dependency, however its URL looked: it is neither listed nor followed. Both sides are real paths, like the library check.
  if (
    realFile &&
    cacheDir &&
    isInsideFolder(await realPathOrSelf(resolve(cacheDir)), realFile)
  )
    return { inLibrary: false, imports: [], codeBytes }
  const inLibrary =
    realFile !== undefined && isInsideFolder(libraryFolder, realFile)
  return {
    inLibrary,
    // A library imports its own chunks, so its imports are followed too.
    imports: node.staticImportedUrls ?? [],
    codeBytes,
    ...(inLibrary ? { libraryFile: viteModuleIdentityKey(realFile, url) } : {}),
  }
}

/** Marks that the deadline won the race against a transform. */
const DEADLINE_WON = Symbol('deadline-won')

/**
 * Reads one module, giving up when the time left before the walk's deadline runs out.
 *
 * Why it exists: the deadline is otherwise checked only between transforms, so one transform that hangs would outlast it and the extension would time out without a coded answer. Called by {@link walkViteLibraryModules} for each URL.
 *
 * @param read - The module read to race.
 * @param remainingMs - The time left before the deadline.
 * @param startTimer - Starts the one-shot timer; answers its cancel function.
 * @returns The module's contribution, or {@link DEADLINE_WON} when the time ran out first.
 * @throws When the read fails before the deadline; the caller skips the module.
 * @example
 * await raceAgainstDeadline(readWalkedModule(env, url, lib), 5_000, startRealTimer)
 */
async function raceAgainstDeadline(
  read: Promise<WalkedModule | undefined>,
  remainingMs: number,
  startTimer: (callback: () => void, delayMs: number) => () => void,
): Promise<WalkedModule | undefined | typeof DEADLINE_WON> {
  // A read that loses the race may still fail later; swallow that so it is not an unhandled rejection.
  read.catch(() => undefined)
  let cancelTimer = (): void => undefined
  const deadline = new Promise<typeof DEADLINE_WON>((resolveDeadline) => {
    cancelTimer = startTimer(() => resolveDeadline(DEADLINE_WON), remainingMs)
  })
  try {
    return await Promise.race([read, deadline])
  } finally {
    cancelTimer()
  }
}

/**
 * Walks Vite's client module graph breadth-first from the entry modules and lists the modules whose real file lies inside one library folder.
 *
 * Why it exists: a browser stop in a workspace library is sealed against the served module that maps it, and only Vite's own graph names the modules the page will load, with the browser's resolution, before the page opens. Called by the owned Vite launcher (`viteLauncher.ts`) for each `vite-library-modules` command.
 *
 * Each URL is transformed first (which fills the graph), then its module node's `staticImportedUrls` are followed (`TransformResult.deps` is unset at runtime in Vite 8.3.5). The result is a superset of what the page loads, because that set also lists `import()` targets. Optimized dependencies and Vite's own client helpers are never transformed or followed; plugin virtual modules are. A module whose transform throws is skipped with its imports. The walk never throws as a whole.
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
    startTimer: startRealTimer,
    ...options,
  }
  const { libraryFolder } = command
  const queue = [...command.entries]
  const seen = new Set(queue)
  const modules: string[] = []
  // One module reached under two URLs (`?t=` / `?v=` variants) is listed once, under the first URL; `?raw` and the plain file stay two modules.
  const listedFiles = new Set<string>()
  const progress = { visited: 0, transformedBytes: 0, startedAt: limits.now() }
  let bound: ViteLibraryWalkBound | undefined
  for (const url of queue) {
    if (isUntouchedViteUrl(url)) continue
    // Checked before each transform: the walk stops with what it has and names the bound.
    bound = reachedWalkBound(limits, progress)
    if (bound) break
    progress.visited += 1
    try {
      const remainingMs =
        limits.deadlineMs - (limits.now() - progress.startedAt)
      const walked = await raceAgainstDeadline(
        readWalkedModule(environment, url, libraryFolder),
        Math.max(remainingMs, 0),
        limits.startTimer,
      )
      // A transform that outlasts the deadline ends the walk with what it has.
      if (walked === DEADLINE_WON) {
        bound = 'deadline'
        break
      }
      if (!walked) continue
      progress.transformedBytes += walked.codeBytes
      if (walked.libraryFile && !listedFiles.has(walked.libraryFile)) {
        listedFiles.add(walked.libraryFile)
        modules.push(url)
      }
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
