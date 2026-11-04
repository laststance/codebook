import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import {
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_CONCURRENCY,
  NEXT_PACKAGE_DISCOVERY_GIT_BYTES,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  NEXT_PACKAGE_DISCOVERY_MAX_PATH_CHARS,
  NEXT_PACKAGE_SUGGESTION_LIMIT,
  NEXT_PACKAGE_SUGGESTION_TIMEOUT_MS,
  REPOSITORY_GIT_TIMEOUT_MS,
} from '../constants'
import { repositoryPathSchema } from '../sourceSchemas'

import { manifestNamesNext } from './nextManifest'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { sanitizeDeclaredPath, type PackageAppKind } from './resolveNextPackage'
import {
  runOpenedFolderGit,
  type OpenedFolderGitLimits,
} from './runOpenedFolderGit'
import { isViteAppManifest } from './viteAppManifest'

/** Why a discovered list is incomplete, as `codebook_status` reports it in `packagesTruncatedReason`. */
export type NextPackageTruncationReason =
  'limit' | 'manifest-cap' | 'deadline' | 'skipped-path' | 'git-failed'

/** An app the scan found (Next or Vite): its repository-relative folder, the exact value to declare as `packageRoot`. */
export type ScannedNextApp = { packageRoot: string }

/** Turns a found app into an item; it gets the signal that ends when the deadline passes, and a throw skips the app. */
export type ScanVisit<Item> = (
  app: ScannedNextApp,
  signal: AbortSignal,
) => Promise<Item>

/** What {@link scanNextPackages} returns: what `visit` produced for each listed app, shallow-first then by path, and why the list is incomplete when it is. */
export type NextPackageScan<Item> = {
  items: Item[]
  truncation?: NextPackageTruncationReason
}

/** The kinds of app one pass of {@link scanPackages} classifies each tracked manifest as. */
type ScanKind = PackageAppKind

/** The bounds {@link scanNextPackages} applies; each defaults to the constant of the same meaning. */
export type NextPackageScanLimits = {
  apps: number
  manifests: number
  concurrency: number
  /** The output cap of `git ls-files`, in bytes. */
  gitBytes: number
}

/** The options of {@link scanNextPackages}; the clock and limits are injectable for tests. */
export type ScanNextPackagesOptions = {
  /** The clock the deadline is judged by; defaults to `Date.now`. */
  now?: () => number
  /** The one deadline covering Git, the manifest reads and every `visit`; defaults to {@link REPOSITORY_GIT_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Ends the scan when the caller gives up. */
  signal?: AbortSignal
  limits?: Partial<NextPackageScanLimits>
}

/** Strongest first: when several reasons apply, the one the chat can act on most is reported. */
const REASON_STRENGTH: readonly NextPackageTruncationReason[] = [
  'git-failed',
  'deadline',
  'limit',
  'manifest-cap',
  'skipped-path',
]

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/** Orders folders shallow-first, then by path (E15). */
function compareFolders(left: string, right: string): number {
  const depthDifference = left.split('/').length - right.split('/').length
  if (depthDifference !== 0) return depthDifference
  if (left < right) return -1
  return left > right ? 1 : 0
}

/**
 * Keeps the strongest of two truncation reasons.
 * @param current - The reason held so far, if any.
 * @param next - A reason that just applied.
 * @returns The one that comes first in {@link REASON_STRENGTH}.
 * @example strongerReason('skipped-path', 'deadline') // => 'deadline'
 */
function strongerReason(
  current: NextPackageTruncationReason | undefined,
  next: NextPackageTruncationReason,
): NextPackageTruncationReason {
  if (current === undefined) return next
  return REASON_STRENGTH.indexOf(next) < REASON_STRENGTH.indexOf(current)
    ? next
    : current
}

/** Says whether a failed read means the file is simply not there (a tracked file deleted from the working tree). */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

/**
 * Lists the Git-tracked folders below the repository root, shallow-first, whose `package.json` could hold a Next app (a folder deeper than the depth limit is not listed).
 * @param output - NUL-separated `git ls-files -z` output.
 * @returns The folders to read and whether a path was skipped for its length or a control character.
 * @example listManifestFolders('a/package.json\0b/c/package.json\0package.json\0') // => { folders: ['a', 'b/c'], skippedPath: false }
 */
function listManifestFolders(output: string): {
  folders: string[]
  skippedPath: boolean
} {
  const folders: string[] = []
  let skippedPath = false
  for (const path of output.split('\0')) {
    const segments = path.split('/')
    // Only a file named exactly package.json counts (`foo-package.json` does not), and the root has its own `packageRoot: "."`.
    if (segments.at(-1) !== 'package.json') continue
    const folderSegments = segments.slice(0, -1)
    // Depth is judged before anything is read.
    if (
      folderSegments.length === 0 ||
      folderSegments.length > NEXT_PACKAGE_DISCOVERY_MAX_DEPTH
    )
      continue
    // A folder the start schema refuses (a backslash is legal on POSIX) is never offered as a packageRoot.
    if (
      path.length > NEXT_PACKAGE_DISCOVERY_MAX_PATH_CHARS ||
      CONTROL_CHARACTERS.test(path) ||
      !repositoryPathSchema.safeParse(folderSegments.join('/')).success
    ) {
      skippedPath = true
      continue
    }
    folders.push(folderSegments.join('/'))
  }
  return { folders: folders.sort(compareFolders), skippedPath }
}

/**
 * Reads one tracked manifest safely and says which kinds of app it is, in the one pass both kinds share.
 * @param root - The repository's real path.
 * @param folder - The repository-relative folder of the manifest.
 * @param kinds - The kinds the caller lists; a kind not asked for costs no check.
 * @param signal - Ends the read.
 * @returns
 * - `apps` with the kinds the manifest is: `next` when it names `next`, `vite` when it is a Vite app by decision D5 ({@link isViteAppManifest}); a manifest of no asked kind reads as `none`
 * - `none` when it is no app of an asked kind, is not JSON, or is gone from the working tree
 * - `skipped` when it could not be read safely: a link, a FIFO or other non-regular file, over the byte cap, or unreadable
 * @example await readManifestKinds('/repo', 'apps/web', ['next', 'vite'], signal) // => { kind: 'apps', kinds: ['next'] }
 */
async function readManifestKinds(
  root: string,
  folder: string,
  kinds: readonly ScanKind[],
  signal: AbortSignal,
): Promise<
  { kind: 'apps'; kinds: ScanKind[] } | { kind: 'none' } | { kind: 'skipped' }
> {
  let text: string
  try {
    text = await readRepositoryBuildText(
      root,
      `${folder}/package.json`,
      NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
      signal,
    )
  } catch (error) {
    return isMissingFile(error) ? { kind: 'none' } : { kind: 'skipped' }
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch {
    return { kind: 'none' }
  }
  const found: ScanKind[] = []
  if (kinds.includes('next') && manifestNamesNext(manifest)) found.push('next')
  if (
    kinds.includes('vite') &&
    (await isViteAppManifest(manifest, join(root, folder)))
  )
    found.push('vite')
  return found.length > 0 ? { kind: 'apps', kinds: found } : { kind: 'none' }
}

/** What one folder of a chunk became: the item of each kind it is an app of, a folder that is none, or one that could not be read safely. `failed` marks a `visit` that threw (that app is skipped, the others stay). */
type ChunkResult<NextItem, ViteItem> =
  | {
      kind: 'apps'
      next?: { item: NextItem }
      vite?: { item: ViteItem }
      failed: boolean
    }
  | { kind: 'none' }
  | { kind: 'skipped' }

/**
 * Reads and visits one chunk of manifest folders at once.
 * @param root - The repository's real path.
 * @param chunk - The folders of this chunk.
 * @param visitors - Turns an app of each asked kind into an item; a throw skips that app.
 * @param signal - Ends the reads.
 * @returns One result per folder, in order.
 * @example await visitChunk('/repo', ['apps/web'], { next: async (app) => app.packageRoot }, signal) // => [{ kind: 'apps', next: { item: 'apps/web' }, failed: false }]
 */
async function visitChunk<NextItem, ViteItem>(
  root: string,
  chunk: readonly string[],
  visitors: ScanVisitors<NextItem, ViteItem>,
  signal: AbortSignal,
): Promise<ChunkResult<NextItem, ViteItem>[]> {
  const asked: ScanKind[] = []
  if (visitors.next) asked.push('next')
  if (visitors.vite) asked.push('vite')
  return Promise.all(
    chunk.map(async (folder): Promise<ChunkResult<NextItem, ViteItem>> => {
      const read = await readManifestKinds(root, folder, asked, signal)
      if (read.kind !== 'apps') return read
      const app = { packageRoot: folder }
      const result: ChunkResult<NextItem, ViteItem> = {
        kind: 'apps',
        failed: false,
      }
      // A visit that throws skips its own app only; the other kind's item is kept.
      if (read.kinds.includes('next') && visitors.next)
        try {
          result.next = { item: await visitors.next(app, signal) }
        } catch {
          result.failed = true
        }
      if (read.kinds.includes('vite') && visitors.vite)
        try {
          result.vite = { item: await visitors.vite(app, signal) }
        } catch {
          result.failed = true
        }
      return result
    }),
  )
}

/**
 * Lists the tracked `package.json` paths through the hardened Git invocation.
 * @param repositoryRoot - The repository's root.
 * @param limits - Timeout, output cap and cancellation.
 * @param isPastDeadline - Whether the scan's deadline has passed.
 * @returns The NUL-separated listing, or the truncation reason of the failure: `deadline` for a killed process or a late failure, `git-failed` otherwise.
 * @example await listTrackedManifests('/repo', limits, () => false) // => { output: 'apps/web/package.json\0' }
 */
async function listTrackedManifests(
  repositoryRoot: string,
  limits: OpenedFolderGitLimits,
  isPastDeadline: () => boolean,
): Promise<
  | { output: string; failure?: undefined }
  | { output?: undefined; failure: NextPackageTruncationReason }
> {
  try {
    return {
      output: await runOpenedFolderGit(
        repositoryRoot,
        ['ls-files', '-z', '--', ':(glob)**/package.json'],
        { ...limits, timeoutMs: Math.max(1, limits.timeoutMs) },
      ),
    }
  } catch (error) {
    // A killed process ran into the deadline; any other failure is the listing's (missing program, not a repository, output past the buffer).
    const timedOut =
      typeof error === 'object' &&
      error !== null &&
      'killed' in error &&
      error.killed === true
    return { failure: timedOut || isPastDeadline() ? 'deadline' : 'git-failed' }
  }
}

/** The `visit` of each kind of app one pass of {@link scanPackages} lists; a kind without a visitor is not classified. */
export type ScanVisitors<NextItem, ViteItem> = {
  next?: ScanVisit<NextItem>
  vite?: ScanVisit<ViteItem>
}

/**
 * Finds the Next apps below the repository root from tracked `package.json` files only, within one deadline, and hands each to `visit`.
 *
 * Why it exists: the Next-only view of {@link scanPackages}, for the refusal suggestions and the Next discovery. Called by {@link discoverNextPackages} and {@link suggestNextPackageRoots}.
 *
 * @param repositoryRoot - The opened repository's root (the Git top level).
 * @param visit - Turns a found app into an item; it gets the signal that ends when the deadline passes.
 * @param options - Clock, deadline, cancellation and limits.
 * @returns The finished items in folder order, and a `truncation` reason when the list is incomplete (see {@link scanPackages}).
 * @example
 * await scanNextPackages('/repo', async (app) => app.packageRoot) // => { items: ['examples/react/nextjs'] }
 */
export async function scanNextPackages<Item>(
  repositoryRoot: string,
  visit: ScanVisit<Item>,
  options: ScanNextPackagesOptions = {},
): Promise<NextPackageScan<Item>> {
  return (await scanPackages(repositoryRoot, { next: visit }, options)).next
}

/**
 * Finds the Vite apps below the repository root, the Vite-only view of {@link scanPackages}.
 * Called by {@link suggestVitePackageRoots} for the refusals of a Vite `packageRoot`.
 * @param repositoryRoot - The opened repository's root.
 * @param visit - Turns a found Vite app into an item.
 * @param options - Clock, deadline, cancellation and limits.
 * @returns The finished items and the truncation reason, as {@link scanNextPackages}.
 * @example await scanVitePackages('/repo', async (app) => app.packageRoot) // => { items: ['examples/react/basic'] }
 */
export async function scanVitePackages<Item>(
  repositoryRoot: string,
  visit: ScanVisit<Item>,
  options: ScanNextPackagesOptions = {},
): Promise<NextPackageScan<Item>> {
  return (await scanPackages(repositoryRoot, { vite: visit }, options)).vite
}

/**
 * Finds the Next apps and the Vite apps below the repository root in one pass over the tracked `package.json` files, within one deadline, and hands each to the `visit` of its kind.
 *
 * Why it exists: `codebook_status` lists the apps a chat can start with `packageRoot` (AC 4), and refusals suggest them; Next and Vite are listed from one `git ls-files`, one manifest read each and one deadline (Cycle 0077). It reads through the hardened Git invocation ({@link runOpenedFolderGit}): `git ls-files -z -- ':(glob)**\/package.json'`, keeps exact `package.json` basenames of depth 1 to 4, skips a path over 256 characters or with a control character, orders folders shallow-first then by path, reads at most 500 manifests of at most 256 KiB through {@link readRepositoryBuildText} (no link, no FIFO), and lists at most 50 apps of each kind. One deadline covers Git, the reads and every `visit`; when it passes, what was finished is returned.
 * Called by {@link scanNextPackages}, {@link scanVitePackages} and {@link discoverPackages}.
 *
 * @param repositoryRoot - The opened repository's root (the Git top level).
 * @param visitors - Turns a found app of each kind into an item; a kind without a visitor is not classified.
 * @param options - Clock, deadline, cancellation and limits.
 * @returns One scan per kind: the finished items in folder order, and a `truncation` reason when that list is incomplete: `git-failed` (no Git, a Git failure or an output past the buffer), `deadline`, `limit` (more than 50 apps of that kind), `manifest-cap` (more than 500 manifests), `skipped-path` (a path or manifest that could not be read safely). The reasons other than `limit` hold for both lists.
 * @example
 * await scanPackages('/repo', { next: async (app) => app.packageRoot, vite: async (app) => app.packageRoot }) // => { next: { items: ['examples/react/nextjs'] }, vite: { items: ['examples/react/basic'] } }
 */
export async function scanPackages<NextItem, ViteItem>(
  repositoryRoot: string,
  visitors: ScanVisitors<NextItem, ViteItem>,
  options: ScanNextPackagesOptions = {},
): Promise<{
  next: NextPackageScan<NextItem>
  vite: NextPackageScan<ViteItem>
}> {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? REPOSITORY_GIT_TIMEOUT_MS
  const limits: NextPackageScanLimits = {
    apps: NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
    manifests: NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT,
    concurrency: NEXT_PACKAGE_DISCOVERY_CONCURRENCY,
    gitBytes: NEXT_PACKAGE_DISCOVERY_GIT_BYTES,
    ...options.limits,
  }
  const deadlineAt = now() + timeoutMs
  const stop = new AbortController()
  const onCallerAbort = (): void => stop.abort()
  // An already-aborted signal never fires its event, so it is read first.
  if (options.signal?.aborted)
    return { next: { items: [] }, vite: { items: [] } }
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const nextItems: NextItem[] = []
  const viteItems: ViteItem[] = []
  // `limit` is per kind; every other reason holds for both lists.
  const limitReached = { next: false, vite: false }
  let reason: NextPackageTruncationReason | undefined
  const note = (next: NextPackageTruncationReason): void => {
    reason = strongerReason(reason, next)
  }

  /** Adds one app's item to its kind's list, or marks the kind's limit reached when the list is full. */
  const take = <Item>(
    kind: ScanKind,
    items: Item[],
    entry: { item: Item } | undefined,
  ): void => {
    if (!entry) return
    if (items.length >= limits.apps) limitReached[kind] = true
    else items.push(entry.item)
  }
  /** Says whether every asked kind has reached the app limit, so no later manifest can add an item. */
  const isFinished = (): boolean =>
    (!visitors.next || limitReached.next) &&
    (!visitors.vite || limitReached.vite)

  /** Takes a chunk's results in order; false when every asked kind has reached the app limit, which ends the scan. */
  const absorb = (
    results: readonly ChunkResult<NextItem, ViteItem>[],
  ): boolean => {
    for (const result of results) {
      if (result.kind === 'skipped') note('skipped-path')
      if (result.kind !== 'apps') continue
      if (result.failed) note('skipped-path')
      take('next', nextItems, result.next)
      take('vite', viteItems, result.vite)
      if (isFinished()) return false
    }
    return true
  }

  const collect = async (): Promise<void> => {
    const listed = await listTrackedManifests(
      repositoryRoot,
      {
        timeoutMs: deadlineAt - now(),
        maxBuffer: limits.gitBytes,
        signal: stop.signal,
      },
      () => now() >= deadlineAt,
    )
    if (listed.failure) {
      note(listed.failure)
      return
    }
    const real = await realpath(repositoryRoot).catch(() => undefined)
    if (real === undefined) {
      note('git-failed')
      return
    }
    const { folders, skippedPath } = listManifestFolders(listed.output)
    if (skippedPath) note('skipped-path')
    if (folders.length > limits.manifests) note('manifest-cap')
    const readable = folders.slice(0, limits.manifests)
    for (let start = 0; start < readable.length; start += limits.concurrency) {
      // The clock is judged between chunks; the timer below ends a chunk that hangs.
      if (stop.signal.aborted) return
      if (now() >= deadlineAt) {
        note('deadline')
        return
      }
      const results = await visitChunk(
        real,
        readable.slice(start, start + limits.concurrency),
        visitors,
        stop.signal,
      )
      // A chunk that finished after the deadline ended the scan is dropped.
      if (stop.signal.aborted || !absorb(results)) return
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<'expired'>((resolve) => {
    timer = setTimeout(
      () => resolve('expired'),
      Math.max(0, deadlineAt - now()),
    )
  })
  let outcome: 'done' | 'expired'
  try {
    outcome = await Promise.race([
      collect().then(() => 'done' as const),
      expiry,
    ])
  } finally {
    // The caller's signal can outlive the scan, so the listener must not.
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
  if (outcome === 'expired') {
    stop.abort()
    note('deadline')
  }
  const truncationOf = (
    didReachLimit: boolean,
  ): { truncation?: NextPackageTruncationReason } => {
    const kindReason = didReachLimit ? strongerReason(reason, 'limit') : reason
    return kindReason ? { truncation: kindReason } : {}
  }
  return {
    next: { items: [...nextItems], ...truncationOf(limitReached.next) },
    vite: { items: [...viteItems], ...truncationOf(limitReached.vite) },
  }
}

/**
 * Lists up to five discovered `packageRoot` values for a refusal's `details.suggestions` (DX-5/9/12).
 *
 * Called as the `suggest` option of {@link resolveNextPackage} by the configured run and by the start preflight, so a wrong or missing `packageRoot` names real apps. It waits at most 2 s and never throws: no Git or no apps gives an empty list.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param options - Clock and cancellation; the deadline is {@link NEXT_PACKAGE_SUGGESTION_TIMEOUT_MS}.
 * @returns The first five Next-app folders whose names can be declared exactly, shallow-first then by path.
 * @example await suggestNextPackageRoots('/repo') // => ['examples/react/nextjs']
 */
export async function suggestNextPackageRoots(
  repositoryRoot: string,
  options: Omit<ScanNextPackagesOptions, 'timeoutMs' | 'limits'> = {},
): Promise<string[]> {
  const scan = await scanNextPackages(repositoryRoot, suggestionOf, {
    ...options,
    ...SUGGESTION_SCAN_OPTIONS,
  })
  return scan.items
}

/**
 * Lists up to five discovered Vite app folders for a refusal's `details.suggestions`, as {@link suggestNextPackageRoots} does for Next.
 *
 * Called as the `suggest` option of {@link resolveVitePackage} by the configured run and by the start preflight. It waits at most 2 s and never throws: no Git or no apps gives an empty list.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param options - Clock and cancellation; the deadline is {@link NEXT_PACKAGE_SUGGESTION_TIMEOUT_MS}.
 * @returns The first five Vite-app folders (decision D5) whose names can be declared exactly, shallow-first then by path.
 * @example await suggestVitePackageRoots('/repo') // => ['examples/react/basic']
 */
export async function suggestVitePackageRoots(
  repositoryRoot: string,
  options: Omit<ScanNextPackagesOptions, 'timeoutMs' | 'limits'> = {},
): Promise<string[]> {
  const scan = await scanVitePackages(repositoryRoot, suggestionOf, {
    ...options,
    ...SUGGESTION_SCAN_OPTIONS,
  })
  return scan.items
}

/** The deadline and app limit a refusal's suggestion scan uses. */
const SUGGESTION_SCAN_OPTIONS = {
  timeoutMs: NEXT_PACKAGE_SUGGESTION_TIMEOUT_MS,
  limits: { apps: NEXT_PACKAGE_SUGGESTION_LIMIT },
}

/** Turns a found app into its suggestion; a folder the declaration cut would shorten fails when declared, so it is never suggested. */
async function suggestionOf(app: ScannedNextApp): Promise<string> {
  if (sanitizeDeclaredPath(app.packageRoot) !== app.packageRoot)
    throw new Error('The folder name is too long to declare.')
  return app.packageRoot
}
