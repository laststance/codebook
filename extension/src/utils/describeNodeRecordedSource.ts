import { basename } from 'node:path'

import { formatEventSeconds } from './formatEventSeconds'
import { stripTerminalControls } from './stripTerminalControls'

/**
 * The fixed words of a test replay's recorded-source slot and its debugger thread, the String catalog of plan version 7 (DS5, DS14); words that hold a value are worded by {@link describeNodeRecordedSource}.
 * The placeholder is the slot's whole text before the first stop, at an output, at the result and at a stop whose source does not verify (4A). The slot is named after a JavaScript or TypeScript file, so its placeholder and loading text are line comments: as plain sentences the editor's language service reported them as problems of the learner's workspace (the source-slot spike in VS Code, 2026-10-22).
 */
export const NODE_RECORDED_SOURCE_TEXT = {
  placeholder:
    '// Recorded source · Not recorded at this moment\n// The test journal holds no source state for this moment.\n',
  loading: '// Loading recorded source…\n',
  notRecordedThread: 'Not recorded at this moment',
} as const

/** What a test replay's recorded-source slot or its debugger says, keyed by surface and value. */
export type NodeRecordedSourceMessage =
  | {
      /** The end-of-line label at a verified stop's stopped line. */
      kind: 'label'
      path: string
      line: number
      elapsedMs: number
    }
  | {
      /** The replay debugger's thread at a verified stop. */
      kind: 'thread'
      stop: number
      path: string
      line: number
    }
  | {
      /** The Study row of a slot that cannot open. */
      kind: 'open-failed'
      stop?: number
      cause: string
    }
  | {
      /** The slot's tab title, named after the stop's source file. */
      kind: 'tab-title'
      path: string
    }

/**
 * Words one recorded-source message of a test replay; {@link StudyWorkspace} calls it for the slot's label and tab, the replay debugger's thread and the slot's open failure.
 * A recorded path is shown without terminal and bidirectional controls ({@link stripTerminalControls}), so a control in a file name never reorders the label, the tab title or the thread name around it; the real path stays with the caller for the slot's URI hash and the source identity (F286).
 * @param message - The surface and its values; `stop` is 1-based.
 * @returns The catalog's sentence with the values filled in.
 * @example
 * describeNodeRecordedSource({ kind: 'label', path: 'src/jobs.ts', line: 12, elapsedMs: 1234 }) // => 'Recorded: src/jobs.ts:12 · 1.23 s'
 * describeNodeRecordedSource({ kind: 'thread', stop: 2, path: 'src/jobs.ts', line: 12 }) // => 'Recorded test stop 2 · src/jobs.ts:12'
 * describeNodeRecordedSource({ kind: 'tab-title', path: 'src/jobs.ts' }) // => 'Captured-jobs.ts'
 */
export function describeNodeRecordedSource(
  message: NodeRecordedSourceMessage,
): string {
  switch (message.kind) {
    case 'label':
      return `Recorded: ${stripTerminalControls(message.path)}:${message.line} · ${formatEventSeconds(message.elapsedMs)} s`
    case 'thread':
      return `Recorded test stop ${message.stop} · ${stripTerminalControls(message.path)}:${message.line}`
    case 'open-failed':
      return message.stop === undefined
        ? `Codebook could not open the recorded source: ${message.cause}. Details: Output › Codebook.`
        : `Codebook could not open the recorded source of stop ${message.stop}: ${message.cause}. Details: Output › Codebook.`
    case 'tab-title':
      return `Captured-${basename(stripTerminalControls(message.path))}`
  }
}
