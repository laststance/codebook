import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import type { CapturedExtensionStop } from '../chromeExtensionContracts'
import {
  ChromeExtensionHistoryRecorder,
  type ExtensionHistoryBegun,
} from '../chromeExtensionHistoryRecorder'
import {
  parseExtensionHistoryHeader,
  type ExtensionHistoryHeader,
} from '../chromeExtensionHistorySchemas'
import type { ExtensionHistoryPause } from '../chromeExtensionHistorySink'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  capturedStop,
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  openExtensionStore,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'

const NEWER_TEXT =
  'EXTENSION_HISTORY_FORMAT_NEWER: Recorded by a newer Codebook; update Codebook to open it.'

/** The TypeScript the browser executed through the build's source map, as the map's `sourcesContent` holds it. */
const MAPPED_SOURCE_TEXT =
  'export function onPing(message: Message): void {\n  reply({ pong: message.type })\n}\n'

const PAGE_PAUSE: ExtensionHistoryPause = {
  pauseId: 'run:1:page:1',
  generation: 1,
  context: 'page',
  stopIndex: 1,
  targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
  workerGeneration: 0,
}
const WORKER_PAUSE: ExtensionHistoryPause = {
  pauseId: 'run:2:service-worker:2',
  generation: 2,
  context: 'service-worker',
  stopIndex: 2,
  targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
  workerGeneration: 1,
}

/** Runs a two-stop history to a complete seal over a real store; `header` names the format through its `build`. */
async function completeHistory(
  context: Parameters<typeof openExtensionStore>[0],
  header: Omit<ExtensionHistoryHeader, 'formatVersion'>,
  captures: [CapturedExtensionStop, CapturedExtensionStop],
) {
  const { store, learningDirectory } = await openExtensionStore(context)
  const begun: ExtensionHistoryBegun =
    await ChromeExtensionHistoryRecorder.begin({
      start: () => store.start(header),
      describeCause: String,
      summarize: (studyId) => store.summarize(studyId),
    })
  assert.ok('recorder' in begun)
  const { recorder } = begun
  // A complete seal needs a filmstrip: one stream frame stands for it.
  recorder.frameObserver.frame({
    data: pngOf(720, 640, 'surface').toString('base64'),
    elapsedMs: recorder.frameObserver.elapsedMs(),
    kind: 'stream',
  })
  recorder.pauseOpened(PAGE_PAUSE)
  recorder.captured(PAGE_PAUSE.pauseId, captures[0])
  recorder.pauseClosed(PAGE_PAUSE.pauseId, 'continue')
  recorder.pauseOpened(WORKER_PAUSE)
  recorder.captured(WORKER_PAUSE.pauseId, captures[1])
  recorder.pauseClosed(WORKER_PAUSE.pauseId, 'continue')
  recorder.resultObserved({
    kind: 'text',
    before: { value: 'idle' },
    after: { value: 'pong' },
    changed: true,
    observedAtMs: 900,
  })
  await recorder.seal({}, 5_000)
  const folder = join(learningDirectory, 'chrome-extensions.v1', header.studyId)
  return { store, learningDirectory, folder }
}

/** Reads a stored JSON file of a history folder. */
async function readJson(folder: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(folder, name), 'utf8'))
}

// protects=an unpacked run still writes the header keys and header format older versions read, and seals with version 1; fails_when=the header gains a key (build), takes format 2, or the seal version moves; no_claim=that an older build opens it (the strict schema is pinned by the key list)
test('a complete unpacked history keeps the header format 1 keys that older versions read', async (context) => {
  // Arrange
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)

  // Act
  const { store, folder } = await completeHistory(context, header, [
    capturedStop({ stopIndex: 1, context: 'page' }),
    capturedStop({ stopIndex: 2, context: 'service-worker' }),
  ])
  const stored = await readJson(folder, 'header.json')
  const seal = await readJson(folder, 'sealed.json')
  const history = await store.read(header.studyId)

  // Assert
  assert.deepEqual(Object.keys(stored as object).sort(), [
    'chrome',
    'createdAt',
    'declaredStops',
    'extension',
    'formatVersion',
    'instanceId',
    'profile',
    'question',
    'repositoryRevision',
    'runId',
    'studyId',
    'surface',
    'workspaceKey',
  ])
  assert.equal((stored as { formatVersion: number }).formatVersion, 1)
  assert.equal((seal as { version: number }).version, 1)
  assert.equal(history.status, 'complete')
  assert.equal(history.header.formatVersion, 1)
})

// protects=a wxt-build run writes header format 2 with its build facts, the seal stays version 1, and the history is listed and opened; fails_when=the build fact is dropped, the header stays format 1, the seal version follows the header, or the history is not listed or opened; no_claim=a real WXT build (the build facts are handed in by hand)
test('a complete wxt-build history is written as header format 2 with its build facts, sealed at version 1, listed and opened', async (context) => {
  // Arrange
  const header = {
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    build: { tool: 'wxt' as const, version: '0.20.6' },
  }

  // Act
  const { store, folder } = await completeHistory(context, header, [
    capturedStop({ stopIndex: 1, context: 'page' }),
    capturedStop({ stopIndex: 2, context: 'service-worker' }),
  ])
  const stored = await readJson(folder, 'header.json')
  const seal = await readJson(folder, 'sealed.json')
  const listed = await store.list()
  const history = await store.read(header.studyId)

  // Assert
  assert.equal((stored as { formatVersion: number }).formatVersion, 2)
  assert.deepEqual((stored as { build: unknown }).build, {
    tool: 'wxt',
    version: '0.20.6',
  })
  assert.equal((seal as { version: number }).version, 1)
  assert.deepEqual(
    listed.map((summary) => [summary.studyId, summary.status]),
    [[header.studyId, 'complete']],
  )
  assert.equal(history.header.formatVersion, 2)
  assert.deepEqual(history.header.build, { tool: 'wxt', version: '0.20.6' })
})

// protects=a header of a format above 2 is refused with the format-newer sentence, and its folder is neither listed nor deleted; fails_when=format 3 parses, fails with a schema dump, or its files are removed; no_claim=what a newer Codebook writes into it
test('a header of format 3 is refused with the format-newer sentence and its folder stays on disk', async (context) => {
  // Arrange
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const { store, folder } = await completeHistory(context, header, [
    capturedStop({ stopIndex: 1, context: 'page' }),
    capturedStop({ stopIndex: 2, context: 'service-worker' }),
  ])
  const stored = (await readJson(folder, 'header.json')) as object
  const newer = {
    ...stored,
    formatVersion: 3,
    build: { tool: 'wxt', version: '0.20.6' },
  }
  await writeFile(join(folder, 'header.json'), JSON.stringify(newer))

  // Act
  const listed = await store.list()

  // Assert
  assert.throws(() => parseExtensionHistoryHeader(newer), {
    message: NEWER_TEXT,
  })
  assert.deepEqual(listed, [])
  assert.equal(existsSync(folder), true)
})

// protects=a format 2 header must carry the build facts, and a format 1 header must not; fails_when=format 2 parses without build or format 1 parses with it; no_claim=how the store words the refusal
test('a header of format 2 without build facts and a header of format 1 with them are both refused', () => {
  // Arrange
  const base = {
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
  }
  const withoutBuild = { ...base, formatVersion: 2 }
  const unpackedWithBuild = {
    ...base,
    formatVersion: 1,
    build: { tool: 'wxt', version: '0.20.6' },
  }

  // Act, Assert
  assert.throws(() => parseExtensionHistoryHeader(withoutBuild))
  assert.throws(() => parseExtensionHistoryHeader(unpackedWithBuild))
})

// protects=a mapped stop keeps its repository-relative path, line and the hash of the repository file, while the journal carries the executed TypeScript the caller supplied and the capture counts as having its source; fails_when=the text is re-read from a build folder, replaced, or the record reads partial for a mapped path; no_claim=the source map that produced the text (the caller supplies it by hand)
test('a mapped stop record carries the supplied executed text under its repository path and the hash of that text', async (context) => {
  // Arrange
  const header = {
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    declaredStops: [
      { index: 1, path: 'src/popup/main.ts', line: 2, context: 'page' },
      {
        index: 2,
        path: 'src/background.ts',
        line: 2,
        context: 'service-worker',
      },
    ],
    build: { tool: 'wxt' as const, version: '0.20.6' },
  }
  // The caller supplies the map's `sourcesContent`; its hash is the repository file's hash while the file is unchanged, so the recorded hash and text agree.
  const page = {
    ...capturedStop({
      stopIndex: 1,
      context: 'page',
      text: MAPPED_SOURCE_TEXT,
    }),
    path: 'src/popup/main.ts',
  }
  const worker = {
    ...capturedStop({
      stopIndex: 2,
      context: 'service-worker',
      text: MAPPED_SOURCE_TEXT,
    }),
    path: 'src/background.ts',
  }
  for (const stop of [page, worker]) {
    const frame = stop.snapshot.frames[0]
    if (frame?.source) frame.source.name = stop.path
  }

  // Act
  const { store } = await completeHistory(context, header, [page, worker])
  const history = await store.read(header.studyId)
  const capture = history.entries.find((entry) => entry.type === 'capture')

  // Assert
  assert.equal(history.status, 'complete')
  assert.equal(capture?.path, 'src/popup/main.ts')
  assert.equal(capture?.line, 2)
  assert.equal(capture?.sourceHash, sha256(MAPPED_SOURCE_TEXT))
  assert.equal(capture?.sourceBytes, Buffer.byteLength(MAPPED_SOURCE_TEXT))
  assert.equal(
    capture?.debuggerSnapshot.frames[0]?.source?.text,
    MAPPED_SOURCE_TEXT,
  )
})
