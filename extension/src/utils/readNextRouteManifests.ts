import { setTimeout as delay } from 'node:timers/promises'

import { z } from 'zod'

import {
  NEXT_MANIFEST_POLL_INTERVAL_MS,
  NEXT_MANIFEST_POLL_MS,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'

import { findNextPagesSource } from './findNextPagesSource'
import { findNextRouteFolder } from './findNextRouteFolder'
import { hasNextAppPageSource } from './hasNextAppPageSource'
import { nextManifestError, parseNextManifest } from './parseNextManifest'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { resolveNextClientManifest } from './resolveNextClientManifest'
import {
  compareNextRouterMatches,
  resolveNextPagesRoute,
  type NextPagesRoute,
  type NextPagesRouteResolution,
} from './resolveNextPagesRoute'

const ROUTES_MANIFEST = '.next/dev/routes-manifest.json'
const APP_PATHS_MANIFEST = '.next/dev/server/app-paths-manifest.json'
const PAGES_MANIFEST = '.next/dev/server/pages-manifest.json'

const routeManifestSchema = z.record(z.string(), z.string())
// Only the two settings a run refuses are read; redirects and rewrites are never parsed or quoted.
const routesManifestSchema = z.object({
  basePath: z.string().optional(),
  i18n: z.unknown().optional(),
})

/** The `routes-manifest.json` settings a Pages run cannot serve: a non-empty `basePath`, and `i18n` when it is set. */
export type NextRouteSettings = { basePath?: string; i18n?: true }

/** What {@link readNextRouteManifests} found for the entry path, with the settings it read. */
export type NextRouteManifests = { settings: NextRouteSettings } & (
  | { kind: 'app'; route: ReturnType<typeof resolveNextClientManifest> }
  | ({ kind: 'pages' } & NextPagesRoute)
  | {
      kind: 'conflict'
      appKey: string
      pagesRoute: string
      /** The Pages manifest value of the route, e.g. `pages/index.js`, so the conflict can ask whether the Pages source still exists. */
      pagesCompiledPath: string
    }
  | { kind: 'unresolved'; manifests: { pages: boolean; app: boolean } }
)

/**
 * Reads one manifest's text for {@link readNextRouteManifests}.
 * @returns The text, or `undefined` when the file does not exist (yet).
 */
export type NextManifestTextReader = (
  path: string,
  limitBytes: number,
  signal?: AbortSignal,
) => Promise<string | undefined>

/** What {@link readNextRouteManifests} needs; `now`, `sleep` and `readText` are seams that default to the real clock, timer and bounded workspace reader. */
export type NextRouteManifestsRequest = {
  /** The opened workspace (the Next project root). */
  workspace: string
  /** The configured entry path the readiness GET asked for. */
  entryPath: string
  signal?: AbortSignal
  now?: () => number
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readText?: NextManifestTextReader
}

/** One manifest as one round of the poll read it. */
type ManifestRead<Value> =
  | { state: 'read'; value: Value }
  | { state: 'absent' }
  | { state: 'failed'; error: Error }

/** What one round of the poll read, with the entry path resolved in each router's manifest. */
type ManifestRound = {
  settings: ManifestRead<NextRouteSettings>
  app: ManifestRead<Record<string, string>>
  pages: ManifestRead<Record<string, string>>
  appRoute?: ReturnType<typeof resolveNextClientManifest>
  pagesRoute: NextPagesRouteResolution
}

/**
 * Reads Next's route manifests after the readiness GET of the entry path and says which router serves it, waiting for a cold compile to write them.
 * Called by the Next run between the readiness GET and sealing, so the run takes the App path, the Pages path or a refusal. It reads `.next/dev/routes-manifest.json` (settings), `.next/dev/server/app-paths-manifest.json` (absent in a project without App routes) and `.next/dev/server/pages-manifest.json`, again every {@link NEXT_MANIFEST_POLL_INTERVAL_MS} until the entry path resolves or {@link NEXT_MANIFEST_POLL_MS} passes. In a project with both an App and a Pages folder it waits until both manifests are readable, then judges a conflict once, at the end.
 * @param request - The workspace, entry path, abort signal and test seams.
 * @returns The settings, and `app`, `pages`, `conflict` or `unresolved` (with which manifests were readable).
 * @throws {@link nextManifestError} when a manifest is still unreadable or unparsable when the poll ends; the abort reason when the signal aborts.
 * @example
 * await readNextRouteManifests({ workspace: '/repo', entryPath: '/' })
 * // => { settings: {}, kind: 'pages', route: '/', compiledPath: 'pages/index.js' }
 */
export async function readNextRouteManifests(
  request: NextRouteManifestsRequest,
): Promise<NextRouteManifests> {
  const now = request.now ?? (() => performance.now())
  const sleep =
    request.sleep ??
    ((milliseconds: number, signal?: AbortSignal) =>
      delay(milliseconds, undefined, { signal }))
  const readText =
    request.readText ?? workspaceManifestReader(request.workspace)
  const routers = {
    app: (await findNextRouteFolder(request.workspace, 'app')) !== undefined,
    pages:
      (await findNextRouteFolder(request.workspace, 'pages')) !== undefined,
  }
  const deadline = now() + NEXT_MANIFEST_POLL_MS
  for (;;) {
    request.signal?.throwIfAborted()
    const round = await readManifestRound(
      readText,
      request.entryPath,
      request.signal,
    )
    if (isSettledRound(round, routers) || now() >= deadline)
      return classifyRound(
        round,
        await contestedWinnerOf(round, request.entryPath, request.workspace),
      )
    await sleep(
      Math.min(NEXT_MANIFEST_POLL_INTERVAL_MS, Math.max(0, deadline - now())),
      request.signal,
    )
  }
}

/**
 * Builds the production reader of {@link readNextRouteManifests}: bounded, contained, link-refusing reads inside the workspace ({@link readRepositoryBuildText}), with an absent file as `undefined`.
 * @param workspace - The opened workspace.
 * @returns The reader.
 * @example
 * await workspaceManifestReader('/repo')('.next/dev/server/pages-manifest.json', 1024) // => '{"/":"pages/index.js"}'
 */
function workspaceManifestReader(workspace: string): NextManifestTextReader {
  return (path, limitBytes, signal) =>
    readRepositoryBuildText(workspace, path, limitBytes, signal).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      },
    )
}

/**
 * Reads the three manifests once and resolves the entry path in the App and Pages ones; one round of {@link readNextRouteManifests}.
 * @param readText - The manifest reader.
 * @param entryPath - The configured entry path.
 * @param signal - Aborts the reads.
 * @returns What the round read and resolved.
 * @example
 * (await readManifestRound(readText, '/', signal)).pagesRoute // => { kind: 'matched', route: '/', compiledPath: 'pages/index.js' }
 */
async function readManifestRound(
  readText: NextManifestTextReader,
  entryPath: string,
  signal?: AbortSignal,
): Promise<ManifestRound> {
  const settings = await readManifest(
      readText,
      ROUTES_MANIFEST,
      routesManifestSchema,
      signal,
    ),
    app = await readManifest(
      readText,
      APP_PATHS_MANIFEST,
      routeManifestSchema,
      signal,
    ),
    pages = await readManifest(
      readText,
      PAGES_MANIFEST,
      routeManifestSchema,
      signal,
    )
  return {
    settings:
      settings.state === 'read'
        ? { state: 'read', value: settingsOf(settings.value) }
        : settings,
    app,
    pages,
    appRoute:
      app.state === 'read' ? appRouteOf(app.value, entryPath) : undefined,
    pagesRoute:
      pages.state === 'read'
        ? resolveNextPagesRoute(pages.value, entryPath)
        : { kind: 'unmatched' },
  }
}

/**
 * Reads and parses one manifest for a round of the poll, keeping a failure as a result: a cold compile may be writing the file, and the next round may read it whole.
 * @param readText - The manifest reader.
 * @param file - The manifest's workspace-relative path.
 * @param schema - The fields read from it.
 * @param signal - Aborts the read; an abort is thrown, never kept.
 * @returns The parsed manifest, `absent`, or the failure as a {@link nextManifestError}.
 * @example
 * await readManifest(readText, PAGES_MANIFEST, routeManifestSchema) // => { state: 'read', value: { '/': 'pages/index.js' } }
 */
async function readManifest<Schema extends z.ZodType>(
  readText: NextManifestTextReader,
  file: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<ManifestRead<z.infer<Schema>>> {
  let text: string | undefined
  try {
    text = await readText(file, REPOSITORY_JAVASCRIPT_LIMIT_BYTES, signal)
  } catch (error) {
    signal?.throwIfAborted()
    return {
      state: 'failed',
      error: nextManifestError(
        file,
        error instanceof Error ? error.message : String(error),
      ),
    }
  }
  if (text === undefined) return { state: 'absent' }
  try {
    return { state: 'read', value: parseNextManifest(file, text, schema) }
  } catch (error) {
    // parseNextManifest throws only its own error, which already names the file.
    return {
      state: 'failed',
      error:
        error instanceof Error ? error : nextManifestError(file, String(error)),
    }
  }
}

/**
 * Keeps the two settings a Pages run refuses from the routes manifest; called by {@link readManifestRound}.
 * @param manifest - The parsed routes manifest fields.
 * @returns `basePath` when it is a non-empty string, `i18n: true` when it is set (not `null`).
 * @example
 * settingsOf({ basePath: '', i18n: null })          // => {}
 * settingsOf({ basePath: '/docs', i18n: { locales: ['en'] } }) // => { basePath: '/docs', i18n: true }
 */
function settingsOf(
  manifest: z.infer<typeof routesManifestSchema>,
): NextRouteSettings {
  return {
    ...(manifest.basePath ? { basePath: manifest.basePath } : {}),
    ...(manifest.i18n === undefined || manifest.i18n === null
      ? {}
      : { i18n: true }),
  }
}

/**
 * Resolves the entry path among the App routes with the unchanged App matcher, whose refusal of no unique page means no App route; called by {@link readManifestRound}.
 * @param routes - The parsed App paths manifest.
 * @param entryPath - The configured entry path.
 * @returns The App route, or `undefined` when none matches uniquely.
 * @example
 * appRouteOf({ '/page': 'app/page.js' }, '/') // => { key: '/page', path: '.next/dev/server/app/page_client-reference-manifest.js' }
 */
function appRouteOf(
  routes: Record<string, string>,
  entryPath: string,
): ReturnType<typeof resolveNextClientManifest> | undefined {
  try {
    return resolveNextClientManifest(routes, entryPath)
  } catch {
    return undefined
  }
}

/**
 * Says whether the poll may stop after a round: every manifest read without failure, the routes manifest present, the entry path resolved, and, in a project with both routers, both route manifests readable. Called by {@link readNextRouteManifests}.
 * @param round - What the round read.
 * @param routers - Which router folders the project has.
 * @returns Whether the round settles the answer.
 * @example
 * isSettledRound(round, { app: false, pages: true }) // => true once the Pages manifest lists the entry path
 */
function isSettledRound(
  round: ManifestRound,
  routers: { app: boolean; pages: boolean },
): boolean {
  const reads = [round.settings, round.app, round.pages]
  if (reads.some((read) => read.state === 'failed')) return false
  if (round.settings.state !== 'read') return false
  if (!round.appRoute && round.pagesRoute.kind !== 'matched') return false
  // With both routers a stale listing in the other manifest decides a conflict, so both must be read first.
  return (
    !(routers.app && routers.pages) ||
    (round.app.state === 'read' && round.pages.state === 'read')
  )
}

/**
 * Decides which router serves an entry path both route manifests match, for {@link classifyRound}: the more specific route as Next decides ({@link compareNextRouterMatches}), but only while its source still exists, so a stale listing left in `.next/dev` stays a conflict whose refusal names it as stale. Called by {@link readNextRouteManifests}.
 * @param round - The last round.
 * @param entryPath - The configured entry path.
 * @param workspace - The opened workspace, where the winning source is looked up.
 * @returns
 * - `undefined` when at most one router matches
 * - `'app'` or `'pages'` for the more specific route whose source exists
 * - `'equal'` for an equally specific pair, or a more specific route whose source is gone
 * @example
 * await contestedWinnerOf(round, '/about', '/repo') // => 'app' for app/about/page.tsx beside pages/[...slug].tsx
 */
async function contestedWinnerOf(
  round: ManifestRound,
  entryPath: string,
  workspace: string,
): Promise<'app' | 'pages' | 'equal' | undefined> {
  const { appRoute, pagesRoute } = round
  if (!appRoute || pagesRoute.kind !== 'matched') return undefined
  const winner = compareNextRouterMatches(
    appRoute.key,
    pagesRoute.route,
    entryPath,
  )
  if (winner === 'app')
    return (await hasNextAppPageSource(workspace, appRoute.key))
      ? 'app'
      : 'equal'
  if (winner === 'pages')
    return (await findNextPagesSource(workspace, pagesRoute.compiledPath))
      .kind === 'missing'
      ? 'equal'
      : 'pages'
  return winner
}

/**
 * Turns the last round of the poll into the answer, judging a conflict once, here; called by {@link readNextRouteManifests}.
 * When both routers match, the route {@link contestedWinnerOf} names serves the entry path; an equally specific pair, or a winner whose source is gone, is a conflict.
 * @param round - The last round.
 * @param winner - What {@link contestedWinnerOf} decided for a path both routers match.
 * @returns The settings and what the manifests say about the entry path.
 * @throws The first manifest failure the round still has.
 * @example
 * classifyRound(round, 'equal') // => { settings: {}, kind: 'conflict', appKey: '/page', pagesRoute: '/', pagesCompiledPath: 'pages/index.js' } when both list `/`
 */
function classifyRound(
  round: ManifestRound,
  winner: 'app' | 'pages' | 'equal' | undefined,
): NextRouteManifests {
  for (const read of [round.settings, round.app, round.pages])
    if (read.state === 'failed') throw read.error
  const settings = round.settings.state === 'read' ? round.settings.value : {}
  const { appRoute, pagesRoute } = round
  if (appRoute && pagesRoute.kind === 'matched' && winner === 'equal')
    return {
      settings,
      kind: 'conflict',
      appKey: appRoute.key,
      pagesRoute: pagesRoute.route,
      pagesCompiledPath: pagesRoute.compiledPath,
    }
  if (appRoute && winner !== 'pages')
    return { settings, kind: 'app', route: appRoute }
  if (pagesRoute.kind === 'matched')
    return {
      settings,
      kind: 'pages',
      route: pagesRoute.route,
      compiledPath: pagesRoute.compiledPath,
    }
  return {
    settings,
    kind: 'unresolved',
    manifests: {
      pages: round.pages.state === 'read',
      app: round.app.state === 'read',
    },
  }
}
