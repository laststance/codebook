import type { ChildProcess } from 'node:child_process'

import {
  captureProcessOutput,
  type ProcessOutputCapture,
  type ProcessOutputOptions,
} from './captureProcessOutput'

/** How an owned process ended, as its `exit` event reports it. */
export type OwnedProcessExitFact = {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

/** What an owned launcher follows of the process it spawned: its exit, a start failure and its redacted output. */
export type WatchedProcess = {
  /** Settles when the process has closed (exited and its streams ended). */
  exit: Promise<void>
  /** Says whether the process has closed. */
  hasExited(): boolean
  /** Settles when the process has exited, which its `exit` event reports before `close`: a descendant that holds the output pipes open delays `close` but not this. */
  exitEvent: Promise<OwnedProcessExitFact>
  /** How the process ended once its `exit` event fired, or `undefined` before. */
  exitFact(): OwnedProcessExitFact | undefined
  /** The process's start failure, else its output capture's first failure, if any. */
  failure(): Error | undefined
  /** The redacted output capture ({@link captureProcessOutput}). */
  capture: ProcessOutputCapture
}

/**
 * Follows an owned process from the moment it is spawned: its exit event and its close, a failure to start, and its output through the redacted capture.
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
    exited = false,
    exitFact: OwnedProcessExitFact | undefined
  const exit = new Promise<void>((resolve) =>
    child.once('close', () => {
      exited = true
      resolve()
    }),
  )
  const exitEvent = new Promise<OwnedProcessExitFact>((resolve) =>
    child.once('exit', (exitCode, signal) => {
      exitFact = { exitCode, signal }
      resolve(exitFact)
    }),
  )
  child.once('error', (cause) => {
    spawnError = cause
  })
  const capture = captureProcessOutput(child, output)
  return {
    exit,
    exitEvent,
    exitFact: () => exitFact,
    hasExited: () => exited,
    failure: () => spawnError ?? capture.failure(),
    capture,
  }
}
