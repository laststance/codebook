import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ExtensionPauseCloseReason } from '../../chromeExtensionHistorySchemas'
import type { ExtensionHistoryTypes } from '../../chromeExtensionHistoryTypes'
import { createExtensionStorageDescriptor } from '../../chromeExtensionStorageDescriptor'
import { EXTENSION_HISTORY_FRAMES_DIRECTORY } from '../../constants'
import { NodeHistoryStore } from '../../nodeTestHistoryStore'
import { sha256 } from '../../runtimeSupport/utils/sha256'

import {
  capturedStop,
  extensionHistoryHeader,
  pngOf,
} from './chromeExtensionHistoryFixture'

/** One step of a scripted extension run, at a time on the run clock. */
export type ExtensionScriptStep =
  | {
      at: number
      type: 'open'
      pauseId: string
      stopIndex: 1 | 2
      /** The stop's context; the declared stops are `popup.js:2` (page) and `worker.js:2` (service worker). */
      context: 'page' | 'service-worker'
    }
  | {
      at: number
      type: 'capture'
      pauseId: string
      stopIndex: 1 | 2
      context: 'page' | 'service-worker'
      /** Records a source hash the executed text does not have, so the stop's source cannot be proven (a partial stop). */
      staleSource?: boolean
    }
  | {
      at: number
      type: 'close'
      pauseId: string
      /** Why the pause closed; a continue when omitted. */
      reason?: ExtensionPauseCloseReason
    }
  | {
      at: number
      type: 'frame'
      kind: 'stream' | 'pin'
      pauseId?: string
      /** Makes two frames of one size differ. */
      salt: string
      width?: number
      height?: number
      /** When the frame was received; defaults to `at`. */
      capturedAtMs?: number
      /** Leaves the blob out of the folder, as a damaged history does. */
      withoutBlob?: boolean
    }
  | { at: number; type: 'result' }

/** What {@link writeExtensionHistory} returns: the header and the journal sequence each step got. */
export type WrittenExtensionHistory = {
  studyId: string
  header: ReturnType<typeof extensionHistoryHeader>
  /** The journal sequence of each step, in script order. */
  sequences: number[]
  /** The folder of the history. */
  directory: string
  /** The hash of each frame step's blob, by script position. */
  hashes: Map<number, string>
}

/**
 * Writes a scripted chrome-extension history with a fake run clock into a learning directory, the way the recorder will: each step is appended at its time, and the history is sealed (or left to read as interrupted).
 * A separate store over the directory the workspace reads, so the workspace lists and opens it as it would a history recorded in another session.
 * @param learningDirectory - The workspace's learning directory.
 * @param workspaceKey - The workspace key.
 * @param script - The steps in journal order; times never go back.
 * @param options - Whether to seal, and the question.
 * @returns The written history's identity.
 * @example const { studyId } = await writeExtensionHistory(directory, key, [{ at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' }])
 */
export async function writeExtensionHistory(
  learningDirectory: string,
  workspaceKey: string,
  script: readonly ExtensionScriptStep[],
  options: { seal?: boolean; question?: string } = {},
): Promise<WrittenExtensionHistory> {
  let now = 0
  const store: NodeHistoryStore<ExtensionHistoryTypes> = new NodeHistoryStore(
    createExtensionStorageDescriptor({ now: () => now }),
    learningDirectory,
    workspaceKey,
  )
  const header = {
    ...extensionHistoryHeader(workspaceKey),
    ...(options.question ? { question: options.question } : {}),
  }
  const writer = await store.start(header)
  const sequences: number[] = []
  const hashes = new Map<number, string>()
  let sequence = 0
  for (const [position, step] of script.entries()) {
    now = step.at
    if (step.type === 'open')
      await writer.appendPauseOpen({
        pauseId: step.pauseId,
        generation: 1,
        context: step.context,
        stopIndex: step.stopIndex,
        targetUrl:
          step.context === 'page'
            ? 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
            : 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
        workerGeneration: step.context === 'page' ? 0 : 1,
      })
    else if (step.type === 'capture') {
      const capture = capturedStop({
        stopIndex: step.stopIndex,
        context: step.context,
      })
      await writer.appendCapture({
        pauseId: step.pauseId,
        path: capture.path,
        line: capture.line,
        sourceHash: step.staleSource ? sha256('edited since') : capture.sha256,
        sourceBytes: Buffer.byteLength(
          capture.snapshot.frames[0]?.source?.text ?? '',
        ),
        debuggerSnapshot: capture.snapshot,
        facts: {},
      })
    } else if (step.type === 'close')
      await writer.appendPauseClose({
        pauseId: step.pauseId,
        reason: step.reason ?? 'continue',
      })
    else if (step.type === 'frame') {
      const width = step.width ?? 720
      const height = step.height ?? 640
      const bytes = pngOf(width, height, step.salt)
      const hash = sha256(bytes)
      hashes.set(position, hash)
      if (!step.withoutBlob) {
        const frames = join(
          writer.historyDirectory,
          EXTENSION_HISTORY_FRAMES_DIRECTORY,
        )
        await mkdir(frames, { recursive: true })
        await writeFile(join(frames, `${hash}.png`), bytes)
      }
      await writer.appendFrame({
        kind: step.kind,
        ...(step.pauseId === undefined ? {} : { pauseId: step.pauseId }),
        hash,
        byteLength: bytes.byteLength,
        width,
        height,
        capturedAtMs: step.capturedAtMs ?? step.at,
      })
    } else
      await writer.appendResult({
        outcome: 'changed',
        before: { value: 'a' },
        after: { value: 'b' },
      })
    sequences.push(++sequence)
  }
  if (options.seal === false) writer.abandon()
  else await writer.seal()
  return {
    studyId: header.studyId,
    header,
    sequences,
    directory: writer.historyDirectory,
    hashes,
  }
}
