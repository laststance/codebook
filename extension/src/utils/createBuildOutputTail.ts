import {
  EXTENSION_BUILD_OUTPUT_LINES,
  EXTENSION_BUILD_OUTPUT_TAIL_CHARS,
} from '../constants'

import { createOutputRedactor } from './createOutputRedactor'

/** Collects a build's output, masked, and answers with its last lines. */
export type BuildOutputTail = {
  push(text: string, channel: 'stdout' | 'stderr'): void
  /** Releases what the redactors hold and returns the last {@link EXTENSION_BUILD_OUTPUT_LINES} non-empty lines. */
  finish(): string[]
}

/**
 * Keeps the last masked lines of a WXT build's stdout and stderr, so a failure can quote them without leaking a credential the build printed.
 * Called by {@link buildWxtExtension} for each build.
 * @returns A fresh collector; one per build.
 * @example
 * const tail = createBuildOutputTail()
 * tail.push('error: boom\n', 'stderr')
 * tail.finish() // => ['error: boom']
 */
export function createBuildOutputTail(): BuildOutputTail {
  const redactors = {
    stdout: createOutputRedactor(),
    stderr: createOutputRedactor(),
  }
  let text = ''
  const keep = (released: string): void => {
    text = (text + released).slice(-EXTENSION_BUILD_OUTPUT_TAIL_CHARS)
  }
  return {
    push(chunk, channel): void {
      keep(redactors[channel].write(chunk))
    },
    finish() {
      keep(redactors.stdout.end())
      keep(redactors.stderr.end())
      return text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .slice(-EXTENSION_BUILD_OUTPUT_LINES)
    },
  }
}
