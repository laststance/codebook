import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** What the run measured of the API process when an API stop's not-reached deadline ran out. */
export type ApiProcessState = {
  /** `paused`: js-debug returned a frame; `not-paused`: js-debug said the thread is not paused; `unknown`: nothing was read. */
  state: 'paused' | 'not-paused' | 'unknown'
  /** Set only for `paused` when the top frame maps to a repository file: its repository-relative path and one-based line. */
  at?: { path: string; line: number }
}

/** The session's `customRequest`, the only part of the debug session the probe uses. */
type CustomRequest = (command: string, args?: unknown) => Thenable<unknown>

/** The one js-debug message that means "the thread runs" (observed natively); compared after trimming, case-insensitively, so no other failure reads as a running thread. */
const THREAD_NOT_PAUSED_MESSAGE = /^thread is not paused$/i

/** One thread's answer: its top frame, the narrow "not paused" answer, or anything else. */
type TopFrameAnswer =
  { kind: 'frame'; frame: unknown } | { kind: 'running' } | { kind: 'other' }

/**
 * Asks the API's debug session whether its thread is paused, and where, for the failure of an API stop that no request reached.
 *
 * Why it exists: the not-reached failure used to list possibilities and state no measured fact; a request that waits inside the app (its database pool, another service) leaves the API running, which js-debug answers to `stackTrace` with `Thread is not paused`. Called by the run when an API stop's not-reached deadline expires, before the run ends the API; the caller bounds the wait.
 *
 * @param customRequest - The server session's `customRequest`.
 * @param repositoryRoot - The opened repository's folder, to give a frame's path relative to it.
 * @returns
 * - `paused` with `at` when a frame came back whose file lies inside the repository; without `at` when it does not
 * - `not-paused` when every thread answered `Thread is not paused`
 * - `unknown` for no thread, no frame, a failed request or any other error, so a failure to probe is never `not-paused`
 * @example
 * ```ts
 * await readApiProcessState((command, args) => session.customRequest(command, args), '/repo')
 * // => { state: 'paused', at: { path: 'apps/api/src/a.ts', line: 12 } }
 * ```
 */
export async function readApiProcessState(
  customRequest: CustomRequest,
  repositoryRoot: string,
): Promise<ApiProcessState> {
  try {
    const answer: unknown = await customRequest('threads')
    const threads: unknown =
      typeof answer === 'object' && answer !== null
        ? Reflect.get(answer, 'threads')
        : undefined
    if (!Array.isArray(threads) || threads.length === 0)
      return { state: 'unknown' }
    for (const thread of threads) {
      const threadId: unknown = Reflect.get(Object(thread), 'id')
      if (typeof threadId !== 'number') return { state: 'unknown' }
      const top = await readTopFrame(customRequest, threadId)
      // One paused thread decides: the API stands paused.
      if (top.kind === 'frame')
        return {
          state: 'paused',
          ...(await locationOf(top.frame, repositoryRoot)),
        }
      // A thread that neither runs nor pauses leaves the state unread.
      if (top.kind === 'other') return { state: 'unknown' }
    }
    // Every thread answered that it runs.
    return { state: 'not-paused' }
  } catch {
    return { state: 'unknown' }
  }
}

/**
 * Reads one thread's top frame through `stackTrace`.
 * @param customRequest - The server session's `customRequest`.
 * @param threadId - The thread asked about.
 * @returns The frame, `running` when js-debug's error message is exactly `Thread is not paused`, `other` for no frame or any other error.
 * @example await readTopFrame(request, 0) // => { kind: 'running' }
 */
async function readTopFrame(
  customRequest: CustomRequest,
  threadId: number,
): Promise<TopFrameAnswer> {
  try {
    const answer: unknown = await customRequest('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 1,
    })
    const frames: unknown =
      typeof answer === 'object' && answer !== null
        ? Reflect.get(answer, 'stackFrames')
        : undefined
    return Array.isArray(frames) && frames.length > 0
      ? { kind: 'frame', frame: frames[0] }
      : { kind: 'other' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return THREAD_NOT_PAUSED_MESSAGE.test(message.trim())
      ? { kind: 'running' }
      : { kind: 'other' }
  }
}

/**
 * Maps a stack frame to a repository-relative path and one-based line, or to nothing when its file lies outside the repository or has no path.
 * @param frame - A DAP stack frame.
 * @param repositoryRoot - The opened repository's folder.
 * @returns `{ at }` for a frame inside the repository; an empty object otherwise.
 * @example await locationOf({ source: { path: '/repo/a.ts' }, line: 3 }, '/repo') // => { at: { path: 'a.ts', line: 3 } }
 */
async function locationOf(
  frame: unknown,
  repositoryRoot: string,
): Promise<{ at?: { path: string; line: number } }> {
  const framePath: unknown = Reflect.get(
    Object(Reflect.get(Object(frame), 'source')),
    'path',
  )
  const line: unknown = Reflect.get(Object(frame), 'line')
  if (typeof framePath !== 'string' || typeof line !== 'number') return {}
  // Real paths on both sides, so a symlinked folder does not read as outside the repository.
  const [root, file] = await Promise.all([
    realpath(repositoryRoot).catch(() => resolve(repositoryRoot)),
    realpath(framePath).catch(() => resolve(framePath)),
  ])
  const path = relative(root, file).split('\\').join('/')
  // A path that leaves the repository, or sits in a dependency folder, names no repository file.
  if (
    path === '' ||
    path === '..' ||
    path.startsWith('../') ||
    isAbsolute(path) ||
    path.split('/').includes('node_modules')
  )
    return {}
  return { at: { path, line } }
}
