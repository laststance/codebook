import type { ChildProcess } from 'node:child_process'

import {
  captureProcessOutput,
  type ProcessOutputCapture,
  type ProcessOutputOptions,
} from './captureProcessOutput'

/** What an owned launcher follows of the process it spawned: its exit, a start failure and its redacted output. */
export type WatchedProcess = {
  /** Settles when the process has closed (exited and its streams ended). */
  exit: Promise<void>
  /** Says whether the process has closed. */
  hasExited(): boolean
  /** The process's start failure, else its output capture's first failure, if any. */
  failure(): Error | undefined
  /** The redacted output capture ({@link captureProcessOutput}). */
  capture: ProcessOutputCapture
}

/**
 * Follows an owned process from the moment it is spawned: its close, a failure to start, and its output through the redacted capture.
 * Called by {@link launchNodeTest} and {@link launchNodeServer} right after `spawn`, before any event can be missed.
 * @param child - The spawned process.
 * @param output - How its output is stamped, delivered and bounded ({@link ProcessOutputOptions}).
 * @returns The process's exit, close state, failure and capture ({@link WatchedProcess}).
 * @example
 * const watched = watchOwnedProcess(child, { startedAt, onOutput, pendingLimitBytes, overflowMessage, failurePrefix })
 * await watched.exit; watched.hasExited() // => true
 */
export function watchOwnedProcess(
  child: ChildProcess,
  output: ProcessOutputOptions,
): WatchedProcess {
  let spawnError: Error | undefined,
    exited = false
  const exit = new Promise<void>((resolve) =>
    child.once('close', () => {
      exited = true
      resolve()
    }),
  )
  child.once('error', (cause) => {
    spawnError = cause
  })
  const capture = captureProcessOutput(child, output)
  return {
    exit,
    hasExited: () => exited,
    failure: () => spawnError ?? capture.failure(),
    capture,
  }
}
