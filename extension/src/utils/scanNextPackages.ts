import { realpath } from 'node:fs/promises'

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

import { manifestNamesNext } from './nextManifest'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import {
  runOpenedFolderGit,
  type OpenedFolderGitLimits,
} from './runOpenedFolderGit'

/** Why a discovered list is incomplete, as `codebook_status` reports it in `packagesTruncatedReason`. */
export type NextPackageTruncationReason =
  'limit' | 'manifest-cap' | 'deadline' | 'skipped-path' | 'git-failed'

/** A Next app the scan found: its repository-relative folder, the exact value to declare as `packageRoot`. */
export type ScannedNextApp = { packageRoot: string }

/** What {@link scanNextPackages} returns: what `visit` produced for each listed app, shallow-first then by path, and why the list is incomplete when it is. */
export type NextPackageScan<Item> = {
  items: Item[]
  truncation?: NextPackageTruncationReason
}

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
 * Lists the Git-tracked folders below the repository root, shallow-first, whose `package.json` could hold a Next app.
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
    if (
      path.length > NEXT_PACKAGE_DISCOVERY_MAX_PATH_CHARS ||
      CONTROL_CHARACTERS.test(path)
    ) {
      skippedPath = true
      continue
    }
    folders.push(folderSegments.join('/'))
  }
  return { folders: folders.sort(compareFolders), skippedPath }
}

/**
 * Reads one tracked manifest safely and says what it is.
 * @param root - The repository's real path.
 * @param folder - The repository-relative folder of the manifest.
 * @param signal - Ends the read.
 * @returns
 * - `app` when the manifest names `next`
 * - `none` when it is not a Next app, is not JSON, or is gone from the working tree
 * - `skipped` when it could not be read safely: a link, a FIFO or other non-regular file, over the byte cap, or unreadable
 * @example await readManifestKind('/repo', 'apps/web', signal) // => 'app'
 */
async function readManifestKind(
  root: string,
  folder: string,
  signal: AbortSignal,
): Promise<'app' | 'none' | 'skipped'> {
  let text: string
  try {
    text = await readRepositoryBuildText(
      root,
      `${folder}/package.json`,
      NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
      signal,
    )
  } catch (error) {
    return isMissingFile(error) ? 'none' : 'skipped'
  }
  try {
    return manifestNamesNext(JSON.parse(text)) ? 'app' : 'none'
  } catch {
    return 'none'
  }
}

/** What one folder of a chunk became: an app with its item, a folder that is none, or one that could not be read safely. */
type ChunkResult<Item> =
  { kind: 'app'; item: Item } | { kind: 'none' } | { kind: 'skipped' }

/**
 * Reads and visits one chunk of manifest folders at once.
 * @param root - The repository's real path.
 * @param chunk - The folders of this chunk.
 * @param visit - Turns an app into an item; a throw skips the app.
 * @param signal - Ends the reads.
 * @returns One result per folder, in order.
 * @example await visitChunk('/repo', ['apps/web'], async (app) => app.packageRoot, signal) // => [{ kind: 'app', item: 'apps/web' }]
 */
async function visitChunk<Item>(
  root: string,
  chunk: readonly string[],
  visit: (app: ScannedNextApp, signal: AbortSignal) => Promise<Item>,
  signal: AbortSignal,
): Promise<ChunkResult<Item>[]> {
  return Promise.all(
    chunk.map(async (folder): Promise<ChunkResult<Item>> => {
      const kind = await readManifestKind(root, folder, signal)
      if (kind !== 'app') return { kind }
      try {
        return { kind, item: await visit({ packageRoot: folder }, signal) }
      } catch {
        return { kind: 'skipped' }
      }
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

/**
 * Finds the Next apps below the repository root from tracked `package.json` files only, within one deadline, and hands each to `visit`.
 *
 * Why it exists: `codebook_status` lists the apps a chat can start with `packageRoot` (AC 4), and refusals suggest them. It reads through the hardened Git invocation ({@link runOpenedFolderGit}): `git ls-files -z -- ':(glob)**\/package.json'`, keeps exact `package.json` basenames of depth 1 to 4, skips a path over 256 characters or with a control character, orders folders shallow-first then by path, reads at most 500 manifests of at most 256 KiB through {@link readRepositoryBuildText} (no link, no FIFO), and lists at most 50 apps. One deadline covers Git, the reads and every `visit`; when it passes, what was finished is returned.
 * Called by {@link discoverNextPackages} for the status list and by {@link suggestNextPackageRoots} for refusals.
 *
 * @param repositoryRoot - The opened repository's root (the Git top level).
 * @param visit - Turns a found app into an item; it gets the signal that ends when the deadline passes.
 * @param options - Clock, deadline, cancellation and limits.
 * @returns The finished items in folder order, and a `truncation` reason when the list is incomplete: `git-failed` (no Git, a Git failure or an output past the buffer), `deadline`, `limit` (more than 50 apps), `manifest-cap` (more than 500 manifests), `skipped-path` (a path or manifest that could not be read safely).
 * @example
 * await scanNextPackages('/repo', async (app) => app.packageRoot) // => { items: ['examples/react/nextjs'] }
 */
export async function scanNextPackages<Item>(
  repositoryRoot: string,
  visit: (app: ScannedNextApp, signal: AbortSignal) => Promise<Item>,
  options: ScanNextPackagesOptions = {},
): Promise<NextPackageScan<Item>> {
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
  options.signal?.addEventListener('abort', () => stop.abort(), { once: true })
  const items: Item[] = []
  let reason: NextPackageTruncationReason | undefined
  const note = (next: NextPackageTruncationReason): void => {
    reason = strongerReason(reason, next)
  }

  /** Takes a chunk's results in order; false when the app limit ends the scan. */
  const absorb = (results: readonly ChunkResult<Item>[]): boolean => {
    for (const result of results) {
      if (result.kind === 'skipped') note('skipped-path')
      if (result.kind !== 'app') continue
      if (items.length >= limits.apps) {
        note('limit')
        return false
      }
      items.push(result.item)
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
        visit,
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
  const outcome = await Promise.race([
    collect().then(() => 'done' as const),
    expiry,
  ])
  clearTimeout(timer)
  if (outcome === 'expired') {
    stop.abort()
    note('deadline')
  }
  return { items: [...items], ...(reason ? { truncation: reason } : {}) }
}

/**
 * Lists up to five discovered `packageRoot` values for a refusal's `details.suggestions` (DX-5/9/12).
 *
 * Called as the `suggest` option of {@link resolveNextPackage} by the configured run and by the start preflight, so a wrong or missing `packageRoot` names real apps. It waits at most 2 s and never throws: no Git or no apps gives an empty list.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param options - Clock and cancellation; the deadline is {@link NEXT_PACKAGE_SUGGESTION_TIMEOUT_MS}.
 * @returns The first five Next-app folders, shallow-first then by path.
 * @example await suggestNextPackageRoots('/repo') // => ['examples/react/nextjs']
 */
export async function suggestNextPackageRoots(
  repositoryRoot: string,
  options: Omit<ScanNextPackagesOptions, 'timeoutMs' | 'limits'> = {},
): Promise<string[]> {
  const scan = await scanNextPackages(
    repositoryRoot,
    async (app) => app.packageRoot,
    {
      ...options,
      timeoutMs: NEXT_PACKAGE_SUGGESTION_TIMEOUT_MS,
      limits: { apps: NEXT_PACKAGE_SUGGESTION_LIMIT },
    },
  )
  return scan.items
}
