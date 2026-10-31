import { basename } from 'node:path'

import { CAPTURED_SOURCE_NAME_PREFIX } from '../constants'

import { formatEventSeconds } from './formatEventSeconds'
import { stripTerminalControls } from './stripTerminalControls'

/**
 * The fixed words of a test replay's recorded-source slot and its debugger thread, the String catalog of plan version 7 (DS5, DS14); words that hold a value are worded by {@link describeNodeRecordedSource}.
 * The placeholder is the slot's whole text before the first stop, at an output, at the result and at a stop whose source does not verify (4A). The slot is named after a JavaScript or TypeScript file, so its placeholder and loading text are line comments: as plain sentences the editor's language service reported them as problems of the learner's workspace (the source-slot spike in VS Code, 2026-10-22).
 */
export const NODE_RECORDED_SOURCE_TEXT = {
  placeholder:
    '// Recorded source · Not recorded at this moment\n// The test journal holds no source state for this moment.\n',
  /** The placeholder of a server replay's slot: the same as the test replay's, naming the server journal. */
  serverPlaceholder:
    '// Recorded source · Not recorded at this moment\n// The server journal holds no source state for this moment.\n',
  /** The placeholder of an Extension replay's slot: the same, naming the extension journal. */
  extensionPlaceholder:
    '// Recorded source · Not recorded at this moment\n// The extension journal holds no source state for this moment.\n',
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
      /** For a server replay: the hit's number and whether the stop was hit more than once; the thread then names a server stop and its hit. */
      server?: { hit: number; repeated: boolean }
    }
  | {
      /** The Study row of a slot that cannot open. */
      kind: 'open-failed'
      stop?: number
      cause: string
    }
  | {
      /** The Study row of a slot that shows its moment but could not close the tab of the slot it replaced. */
      kind: 'close-failed'
      cause: string
    }
  | {
      /** The slot's tab title, named after the stop's source file. */
      kind: 'tab-title'
      path: string
    }

/**
 * Words one recorded-source message of a test replay; {@link StudyWorkspace} calls it for the slot's label and tab, the replay debugger's thread, the slot's open failure and the failure to close an earlier slot tab.
 * A recorded path is shown without terminal and bidirectional controls ({@link stripTerminalControls}), so a control in a file name never reorders the label, the tab title or the thread name around it; the real path stays with the caller for the slot's URI hash and the source identity (F286).
 * @param message - The surface and its values; `stop` is 1-based.
 * @returns The catalog's sentence with the values filled in.
 * @example
 * describeNodeRecordedSource({ kind: 'label', path: 'src/jobs.ts', line: 12, elapsedMs: 1234 }) // => 'Recorded: src/jobs.ts:12 · 1.23 s'
 * describeNodeRecordedSource({ kind: 'thread', stop: 2, path: 'src/jobs.ts', line: 12 }) // => 'Recorded test stop 2 · src/jobs.ts:12'
 * describeNodeRecordedSource({ kind: 'tab-title', path: 'src/jobs.ts' }) // => 'Captured-jobs.ts'
 * describeNodeRecordedSource({ kind: 'close-failed', cause: 'The editor kept a tab' }) // => 'Codebook could not close an earlier recorded-source tab: The editor kept a tab.'
 */
export function describeNodeRecordedSource(
  message: NodeRecordedSourceMessage,
): string {
  switch (message.kind) {
    case 'label':
      return `Recorded: ${stripTerminalControls(message.path)}:${message.line} · ${formatEventSeconds(message.elapsedMs)} s`
    case 'thread':
      return message.server
        ? `Recorded server stop ${message.stop}${message.server.repeated ? ` · hit ${message.server.hit}` : ''} · ${stripTerminalControls(message.path)}:${message.line}`
        : `Recorded test stop ${message.stop} · ${stripTerminalControls(message.path)}:${message.line}`
    case 'open-failed':
      return message.stop === undefined
        ? `Codebook could not open the recorded source: ${message.cause}. Details: Output › Codebook.`
        : `Codebook could not open the recorded source of stop ${message.stop}: ${message.cause}. Details: Output › Codebook.`
    case 'close-failed':
      return `Codebook could not close an earlier recorded-source tab: ${message.cause.replace(/\.$/, '')}.`
    case 'tab-title':
      return `${CAPTURED_SOURCE_NAME_PREFIX}${basename(stripTerminalControls(message.path))}`
  }
}
