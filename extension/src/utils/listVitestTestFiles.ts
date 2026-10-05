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
/** What {@link prepareNodeTestLaunch} asks Vitest; the caller binds the Node executable and cancellation. */
export type ListVitestTestFilesRequest = {
  program: string
  workspace: string
  filter: string
  excludes: string[]
}
/** What a listing left behind when its release failed: the group that may still have a member, the folder that was kept for it, and the release's error as text. `processGroup` is `undefined` when the listing process never started. */
export type VitestListingReleaseFailure = {
  processGroup: number | undefined
  directory: string
  reason: string
}

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
 * @param request.workspace - Canonical repository root, used as the working directory.
 * @param request.filter - The cited repository-relative test file.
 * @param request.excludes - Escaped absolute paths passed as `--exclude=` globs.
 * @param request.signal - The run's cancellation.
 * @param request.timeoutMs - Listing deadline; the default fits inside the attach phase.
 * @param request.onReleaseFailed - Told once when the listing's process group could not be confirmed as ended, whatever the listing's own outcome; the owned Node test run journals it.
 * @returns Every file entry Vitest reports, in Vitest's order, once the listing's process group is confirmed as ended.
 * @throws When Vitest fails, times out, is cancelled or writes no readable list; that reason is kept also when the release fails. When a listing that finished
 * could not be released, because a signal or a probe was refused or the group did not end within its wait after SIGTERM and SIGKILL, with that failure as the
 * cause: a process of the group may still run, so the Node test run is not started and the listing's folder is kept.
 * @example
 * ```ts
 * await listVitestTestFiles({ node, program, workspace: '/repo', filter: 'src/a.test.ts', excludes: [], signal })
 * // => [{ file: '/repo/src/a.test.ts' }, { file: '/repo/copy/src/a.test.ts' }]
 * ```
 */
export async function listVitestTestFiles(
  request: ListVitestTestFilesRequest & {
    node: string
    signal: AbortSignal
    timeoutMs?: number
    onReleaseFailed?: (failure: VitestListingReleaseFailure) => void
  },
): Promise<VitestListedFile[]> {
  const timeoutMs = request.timeoutMs ?? VITEST_FILE_LIST_TIMEOUT_MS
  const deadline = AbortSignal.timeout(timeoutMs)
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-list-'))
  const output = join(directory, 'files.json')
  let release: (() => Promise<void>) | undefined
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
        cwd: request.workspace,
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
    release = async (): Promise<void> => {
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
        throw new Error(
          `Vitest could not list the cited test file (exit code ${exitCode}): ${errorText.trim()}`,
        )
    } catch (error) {
      // The bounded wait reports a generic cancellation; name the run's actual reason instead.
      if (request.signal.aborted) throw request.signal.reason
      if (deadline.aborted)
        throw new Error(
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
      throw new Error('Vitest wrote an unreadable test file list.')
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
      request.onReleaseFailed?.({
        processGroup: listingProcessGroup,
        directory,
        reason,
      })
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
