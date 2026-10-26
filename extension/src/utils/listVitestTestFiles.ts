import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import {
  VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS,
  VITEST_FILE_LIST_TIMEOUT_MS,
  VITEST_LIST_ERROR_LIMIT_CHARS,
} from '../constants'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { buildNodeTestEnvironment } from './buildNodeTestEnvironment'
import { isProcessGroupGone } from './isProcessGroupGone'
import { signalProcessGroup } from './signalProcessGroup'

/** One test file Vitest would run; a file included by several Vitest projects appears once per project. */
export type VitestListedFile = { file: string; projectName?: string }
/** What {@link prepareNodeTestLaunch} and a root claim ask Vitest; the caller binds the Node executable and cancellation. */
export type ListVitestTestFilesRequest = {
  program: string
  /** The Vitest root the listing runs in, its working directory: the cited test's nearest config folder, or the opened root. */
  vitestRoot: string
  /** The cited test file relative to {@link ListVitestTestFilesRequest.vitestRoot}, with `/` separators. */
  filter: string
  excludes: string[]
  /** Also told when this listing's process group could not be confirmed as ended, beside the owner the caller binds; a launch's root claim re-check reads it to refuse instead of falling back. */
  onReleaseFailed?: (
    failure: VitestListingReleaseFailure,
    retryRelease: RetryVitestListingRelease,
  ) => void
}
/** A listing that outlived its deadline, told apart from Vitest's own failure so that a root claim refuses the start instead of falling back ({@link listVitestForRootClaim}). */
export class VitestListingDeadlineError extends Error {}
/** A listing Vitest itself ended with an error exit or without a readable list: the only failure a root claim treats as clean and falls back from ({@link listVitestForRootClaim}); a folder, spawn or file-system failure of Codebook's own is no such failure. */
export class VitestListingFailedError extends Error {}
/** What a listing left behind when its release failed: the group that may still have a member, the folder that was kept for it, and the release's error as text. `processGroup` is `undefined` when the listing process never started. */
export type VitestListingReleaseFailure = {
  processGroup: number | undefined
  directory: string
  reason: string
}
/**
 * Runs a failed listing release again: signals the listing's process group while it still has a member, waits until it has ended, then removes the folder that was kept for it; once the group was found ended, later calls only remove the folder.
 * Handed to {@link listVitestTestFiles}'s `onReleaseFailed` beside the failure, so whoever owns the run can release the listing at its own stop ({@link releaseVitestListings}); it throws while the group still cannot be confirmed as ended, and may then be called again.
 * A group found ended gets no signal, since its id may by then name another process's group; a group id the system reuses between the group's end and this probe cannot be told apart, as with any release by group id.
 * @example
 * await retryRelease() // => resolves once the group has ended and its folder is gone
 */
export type RetryVitestListingRelease = () => Promise<void>

const listedFilesSchema = z.array(
  z.object({ file: z.string().min(1), projectName: z.string().optional() }),
)

/**
 * Asks the repository's own Vitest which test files a `run` with the same file filter and exclusions would select, without importing any test module.
 *
 * Vitest's positional file filter is a case-insensitive substring match, so only Vitest itself can say which files a filter selects under the
 * repository's configuration and projects. The JSON path is always passed as one `--json=<path>` token: a separate token would make Vitest take the
 * next argument as its output file and overwrite it. Called by the owned Node test run before launch, through {@link prepareNodeTestLaunch}.
 *
 * @param request.node - External Node executable that will also run the test.
 * @param request.program - Owned `node_modules/vitest/vitest.mjs`.
 * @param request.vitestRoot - The canonical Vitest root, used as the working directory: the cited test's nearest config folder, or the repository root.
 * @param request.filter - The cited test file relative to the Vitest root.
 * @param request.excludes - Escaped absolute paths passed as `--exclude=` globs.
 * @param request.signal - The run's cancellation.
 * @param request.timeoutMs - Listing deadline; the default bounds each listing on its own, and the owned Node test run starts its attach budget only after its listings.
 * @param request.onReleaseFailed - Told once when the listing's process group could not be confirmed as ended, whatever the listing's own outcome, with a {@link RetryVitestListingRelease} that runs the release again; the owned Node test run journals it and keeps the retry for its own release.
 * @returns Every file entry Vitest reports, in Vitest's order, once the listing's process group is confirmed as ended.
 * @throws The cancellation's reason, before any process starts, when the signal has already aborted. When Vitest fails or writes no readable list (a {@link VitestListingFailedError}), times out (a {@link VitestListingDeadlineError}), is cancelled, or cannot be started; that reason is kept also when the release fails. When a listing that finished
 * could not be released, because a signal or a probe was refused or the group did not end within its wait after SIGTERM and SIGKILL, with that failure as the
 * cause: a process of the group may still run, so the Node test run is not started and the listing's folder is kept.
 * @example
 * ```ts
 * await listVitestTestFiles({ node, program, vitestRoot: '/repo', filter: 'src/a.test.ts', excludes: [], signal })
 * // => [{ file: '/repo/src/a.test.ts' }, { file: '/repo/copy/src/a.test.ts' }]
 * ```
 */
export async function listVitestTestFiles(
  request: ListVitestTestFilesRequest & {
    node: string
    signal: AbortSignal
    timeoutMs?: number
    onReleaseFailed?: (
      failure: VitestListingReleaseFailure,
      retryRelease: RetryVitestListingRelease,
    ) => void
  },
): Promise<VitestListedFile[]> {
  // A run stopped before this listing starts (while the previous listing was released, for example) starts no Vitest process.
  request.signal.throwIfAborted()
  const timeoutMs = request.timeoutMs ?? VITEST_FILE_LIST_TIMEOUT_MS
  const deadline = AbortSignal.timeout(timeoutMs)
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-list-'))
  const output = join(directory, 'files.json')
  /** Ends the listing's process group; a retry passes `onlyWhileRunning`, so a group that has ended since gets no signal. */
  let release: ((onlyWhileRunning?: boolean) => Promise<void>) | undefined
  let listingProcessGroup: number | undefined
  let files: VitestListedFile[]
  let refusedRelease: Error | undefined
  try {
    const child = spawn(
      request.node,
      [
        request.program,
        'list',
        '--filesOnly',
        `--json=${output}`,
        request.filter,
        ...request.excludes.map((exclude) => `--exclude=${exclude}`),
      ],
      {
        cwd: request.vitestRoot,
        env: buildNodeTestEnvironment(),
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    // Cancellation rejects the wait before close; ownership and draining must survive that early rejection.
    const closed = new Promise<void>((resolve) =>
      child.once('close', () => resolve()),
    )
    listingProcessGroup = child.pid
    release = async (onlyWhileRunning = false): Promise<void> => {
      const processGroup = child.pid
      if (processGroup === undefined) {
        await awaitResponse(
          closed,
          'Vitest listing exit',
          undefined,
          VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS,
        )
        return
      }
      const drain = async (): Promise<void> => {
        await awaitResponse(
          closed,
          'Vitest listing exit',
          undefined,
          VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS,
        )
        await waitUntil(
          () => isProcessGroupGone(processGroup),
          'Vitest listing process group exit',
          VITEST_FILE_LIST_SHUTDOWN_TIMEOUT_MS,
        )
      }
      // A retry may run long after the first release: once the group has ended, its id can name another process's group, which is never signalled. A helper outside the group may still hold the error stream, which then never closes; the group's end is what the release owes.
      if (onlyWhileRunning && isProcessGroupGone(processGroup)) {
        child.stderr?.destroy()
        return
      }
      signalProcessGroup(processGroup, 'SIGTERM')
      // Repository configuration can spawn a helper or intercept SIGTERM; release the complete owned group.
      try {
        await drain()
      } catch {
        signalProcessGroup(processGroup, 'SIGKILL')
        await drain()
      }
    }
    let errorText = ''
    child.stderr.setEncoding('utf8')
    // Keep the start: Vitest prints the failing message before its stack.
    child.stderr.on('data', (text: string) => {
      if (errorText.length < VITEST_LIST_ERROR_LIMIT_CHARS)
        errorText = (errorText + text).slice(0, VITEST_LIST_ERROR_LIMIT_CHARS)
    })
    try {
      const [exitCode]: unknown[] = await awaitResponse(
        once(child, 'close'),
        'Vitest test file listing',
        AbortSignal.any([request.signal, deadline]),
        timeoutMs,
      )
      if (exitCode !== 0)
        throw new VitestListingFailedError(
          `Vitest could not list the cited test file (exit code ${exitCode}): ${errorText.trim()}`,
        )
    } catch (error) {
      // The bounded wait reports a generic cancellation; name the run's actual reason instead.
      if (request.signal.aborted) throw request.signal.reason
      if (deadline.aborted)
        throw new VitestListingDeadlineError(
          `Vitest did not list its test files within ${timeoutMs} ms.`,
        )
      throw error
    }
    const listed = listedFilesSchema.safeParse(
      await readFile(output, 'utf8')
        .then((text): unknown => JSON.parse(text))
        .catch(() => undefined),
    )
    if (!listed.success)
      throw new VitestListingFailedError(
        'Vitest wrote an unreadable test file list.',
      )
    files = listed.data.map((entry) =>
      entry.projectName === undefined
        ? { file: entry.file }
        : { file: entry.file, projectName: entry.projectName },
    )
  } finally {
    const failedRelease = await (release?.() ?? Promise.resolve()).then(
      () => undefined,
      (error: unknown) => ({ error }),
    )
    // Never remove the listing destination while an owned process may still be writing it.
    if (!failedRelease) await rm(directory, { recursive: true, force: true })
    else {
      const reason = String(failedRelease.error)
      const releaseAgain = release
      /** Set once a retry found the listing's group ended: later retries only remove the folder. */
      const retryState = { groupEnded: false }
      request.onReleaseFailed?.(
        { processGroup: listingProcessGroup, directory, reason },
        async () => {
          // The same release as above, with SIGKILL after SIGTERM while the group still runs. A group once found ended is never probed or signalled again, since by a later retry its id may name another process's group.
          if (!retryState.groupEnded)
            await releaseAgain?.(true).catch((error: unknown) => {
              throw new Error(
                `Codebook still could not confirm that the Vitest listing's process group ${listingProcessGroup} ended (${String(error)}), so a process of that group may still run, and its folder ${directory} is kept. Stop the run again.`,
                { cause: error },
              )
            })
          retryState.groupEnded = true
          // The folder goes only once the group has ended; a removal that fails is tried again by the next retry, without the group.
          await rm(directory, { recursive: true, force: true }).catch(
            (error: unknown) => {
              throw new Error(
                `The Vitest listing's process group ${listingProcessGroup} has ended, but Codebook could not remove its folder ${directory} (${String(error)}). Stop the run again.`,
                { cause: error },
              )
            },
          )
        },
      )
      // A refused signal or probe and a group that did not end within its wait alike leave a member that may still run: a listing that finished is refused.
      refusedRelease = new Error(
        `Vitest listed the test files, but Codebook could not end the listing's process group ${listingProcessGroup} (${reason}), so a process of that group may still run. The test was not started, and the listing's folder ${directory} is kept. Start the run again.`,
        { cause: failedRelease.error },
      )
    }
  }
  // Reached only by a listing that finished: its own failure left through the `finally` above and keeps its reason.
  if (refusedRelease) throw refusedRelease
  return files
}
