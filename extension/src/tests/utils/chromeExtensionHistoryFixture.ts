import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { CapturedExtensionStop } from '../../chromeExtensionContracts'
import type { ExtensionHistoryHeader } from '../../chromeExtensionHistorySchemas'
import type { ExtensionHistoryIdentity } from '../../chromeExtensionHistorySink'
import type { ExtensionHistoryTypes } from '../../chromeExtensionHistoryTypes'
import type { ExtensionHistoryJournalLimits } from '../../chromeExtensionHistoryWriter'
import { createExtensionStorageDescriptor } from '../../chromeExtensionStorageDescriptor'
import { NodeHistoryStore } from '../../nodeTestHistoryStore'
import type { ReplayDebugSnapshot } from '../../replayDebugSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'

/** The workspace key every extension history test uses. */
export const EXTENSION_WORKSPACE_KEY = sha256(
  'chrome-extension-history-test-workspace',
)

/** The executed file of the page stop, three lines. */
export const POPUP_SOURCE_TEXT =
  'document.querySelector("#ping").addEventListener("click", () => {\n  chrome.runtime.sendMessage({ type: "ping" })\n})\n'

/** The executed file of the service-worker stop, three lines. */
export const WORKER_SOURCE_TEXT =
  'chrome.runtime.onMessage.addListener((message, sender, reply) => {\n  reply({ pong: message.type })\n})\n'

/**
 * Builds what a resolved declaration tells the history: the extension `Bookmark Notes 1.2.0`, a popup, a page stop at `popup.js:2` and a service-worker stop at `worker.js:2`.
 * @returns The identity the run hands its history starter.
 * @example const identity = extensionIdentity()
 */
export function extensionIdentity(): ExtensionHistoryIdentity {
  return {
    extension: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      name: 'Bookmark Notes',
      version: '1.2.0',
    },
    surface: { kind: 'popup', path: 'popup.html' },
    declaredStops: [
      { index: 1, path: 'popup.js', line: 2, context: 'page' },
      { index: 2, path: 'worker.js', line: 2, context: 'service-worker' },
    ],
    chromeVersion: 'Google Chrome 156.0.8078.74',
  }
}

/**
 * Builds the header input of an extension history, the way the run builds it.
 * @param workspaceKey - The workspace key.
 * @returns The header without its `formatVersion`, which the store stamps.
 * @example const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
 */
export function extensionHistoryHeader(
  workspaceKey: string,
): Omit<ExtensionHistoryHeader, 'formatVersion'> {
  const identity = extensionIdentity()
  const instanceId = randomUUID()
  const runId = randomUUID()
  return {
    profile: 'chrome-extension',
    workspaceKey,
    studyId: `${instanceId}_${runId}`,
    instanceId,
    runId,
    createdAt: '2026-11-01T00:00:00.000Z',
    question: 'Extension run: Bookmark Notes',
    extension: identity.extension,
    surface: identity.surface,
    declaredStops: identity.declaredStops.map((stop) => ({ ...stop })),
    repositoryRevision: { revision: 'abc1234', dirty: false },
    chrome: { version: identity.chromeVersion },
  }
}

/**
 * Builds a PNG-shaped buffer the frame writer accepts: the real signature and header chunk with the given size, then `salt` bytes so two frames of one size differ.
 * @param width - The frame width in pixels.
 * @param height - The frame height in pixels.
 * @param salt - Text appended after the header; equal salts make identical frames.
 * @returns The buffer.
 * @example pngOf(720, 640, 'a').byteLength // => 25
 */
export function pngOf(width: number, height: number, salt: string): Buffer {
  const header = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(header)
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return Buffer.concat([header, Buffer.from(salt)])
}

/**
 * Builds the run's capture of one stop with a presentable snapshot: the top frame at the stop's line with its source text, a local scope and one variable.
 * @param options - Which stop, its context and file, the executed text and the worker generation.
 * @returns A capture the recorder journals.
 * @example recorder.captured(pauseId, capturedStop({ stopIndex: 1, context: 'page' }))
 */
export function capturedStop(options: {
  stopIndex: number
  context: 'page' | 'service-worker'
  workerGeneration?: number
  text?: string
}): CapturedExtensionStop {
  const isPage = options.context === 'page'
  const text = options.text ?? (isPage ? POPUP_SOURCE_TEXT : WORKER_SOURCE_TEXT)
  const path = isPage ? 'popup.js' : 'worker.js'
  const hash = sha256(text)
  const snapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      {
        name: isPage ? 'onClick' : 'onMessage',
        line: 2,
        column: 1,
        source: { name: path, text, hash, line: 2 },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [
      {
        name: isPage ? 'type' : 'pong',
        value: '"ping"',
        type: 'string',
        children: [],
      },
    ],
    limitations: [],
  }
  return {
    stopIndex: options.stopIndex,
    path,
    line: 2,
    context: options.context,
    workerGeneration: options.workerGeneration ?? (isPage ? 0 : 1),
    targetUrl: isPage
      ? 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
      : 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
    sha256: hash,
    capturedAtMs: 0,
    snapshot,
  }
}

/**
 * Makes a private learning directory and an extension history store over it, both removed when the test ends.
 * @param context - The test whose end removes the directory.
 * @param now - The run clock the store's writers stamp entries with; the real one when omitted.
 * @returns The store and its directory.
 * @example const { store } = await openExtensionStore(context)
 */
export async function openExtensionStore(
  context: TestContext,
  now?: () => number,
  limits?: ExtensionHistoryJournalLimits,
): Promise<{
  store: NodeHistoryStore<ExtensionHistoryTypes>
  learningDirectory: string
}> {
  const learningDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-extension-history-'),
  )
  context.after(() => rm(learningDirectory, { recursive: true, force: true }))
  const store = new NodeHistoryStore(
    createExtensionStorageDescriptor({
      ...(now ? { now } : {}),
      ...(limits ? { limits } : {}),
    }),
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
  )
  return { store, learningDirectory }
}
