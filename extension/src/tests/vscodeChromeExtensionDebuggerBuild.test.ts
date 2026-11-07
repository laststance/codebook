import assert from 'node:assert/strict'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { isFrameInStopSource } from '../utils/isFrameInStopSource'

import {
  extensionEditorHarness,
  type TestStop,
} from './utils/chromeExtensionEditorHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const SIGNAL = (): AbortSignal => AbortSignal.timeout(5_000)
const BUILD = { tool: 'wxt', version: '0.21.4', durationMs: 1_000 } as const
const PAGE_STOP: TestStop = { file: 'popup.js', line: 2, context: 'page' }

/** Waits until a condition holds; the debugger classifies stops asynchronously. */
async function until(condition: () => boolean): Promise<void> {
  await waitUntil(condition, 'the condition to hold', 1_000, undefined, 2)
}

/** Runs the debugger's setup of a `wxt-build` run with one page stop to the point a click could start. */
async function readyBuildRun(options: { withBuild: boolean }) {
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger(
    [PAGE_STOP],
    options.withBuild ? { build: BUILD } : {},
  )
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  const page = await editor.addChild({
    kind: 'page',
    id: 'page-session',
    title: 'Popup « Bookmarks',
  })
  await attaching
  const worker = await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
    title: 'Bookmarks: service-worker.js',
  })
  await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  return { ...created, editor, page, worker }
}

/** Pauses the page at its declared stop, reporting the top frame in `frameFile` at line 2. */
function pauseWithFrameIn(
  run: Awaited<ReturnType<typeof readyBuildRun>>,
  frameFile: string,
): void {
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: frameFile, line: 2 },
  )
}

// protects=a wxt-build pause whose top frame is in the stop's own source is captured as before; fails_when=the frame-source check refuses a matching source; no_claim=real js-debug mapping a breakpoint through a source map (the native check)
test('a wxt-build pause with the top frame in the stop source is captured', async () => {
  // Arrange
  const run = await readyBuildRun({ withBuild: true })
  // Act
  pauseWithFrameIn(run, run.editor.path('popup.js'))
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  // Assert
  const [pause] = run.debug.pauses()
  assert.equal(pause?.captured?.path, 'popup.js')
  assert.equal(pause?.captureFailure, undefined)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a wxt-build pause whose top frame is in another source is not recorded and reads frame-source-mismatch, so a replay never labels another file as the stop's; fails_when=the capture is recorded with the stop's name for a frame elsewhere; no_claim=that the editor reports such a frame for a verified breakpoint
test('a wxt-build pause with the top frame in another source records no capture', async () => {
  // Arrange
  const run = await readyBuildRun({ withBuild: true })
  // Act
  pauseWithFrameIn(run, run.editor.path('service-worker.js'))
  await until(() => run.debug.pauses()[0]?.status === 'capture-failed')
  // Assert
  const [pause] = run.debug.pauses()
  assert.equal(pause?.captured, undefined)
  assert.equal(pause?.captureFailure, 'frame-source-mismatch')
  assert.equal(run.failures.length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a wxt-build pause whose top frame is in the bundle is not recorded and reads frame-source-mismatch, so bundle coordinates never carry the TypeScript name; fails_when=a bundle frame is recorded as the stop's source; no_claim=a bundle path spelled the way real js-debug reports it
test('a wxt-build pause with the top frame in the bundle records no capture', async () => {
  // Arrange
  const run = await readyBuildRun({ withBuild: true })
  // Act
  pauseWithFrameIn(
    run,
    join(run.editor.path('popup.js'), '..', 'chunks', 'options.js'),
  )
  await until(() => run.debug.pauses()[0]?.status === 'capture-failed')
  // Assert
  const [pause] = run.debug.pauses()
  assert.equal(pause?.captured, undefined)
  assert.equal(pause?.captureFailure, 'frame-source-mismatch')
  await run.debug.release()
  await run.editor.dispose()
})

// protects=an unpacked run keeps capturing whatever file the frame names, as before the check existed; fails_when=the frame check applies to a run without a build; no_claim=wxt-build behavior
test('an unpacked pause is captured without a frame-source check', async () => {
  // Arrange
  const run = await readyBuildRun({ withBuild: false })
  // Act
  pauseWithFrameIn(run, run.editor.path('service-worker.js'))
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  // Assert
  assert.equal(run.debug.pauses()[0]?.captured?.path, 'popup.js')
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a frame without a path or in another file never counts as the stop's source, while a link spelling of the same file does; fails_when=an undefined or empty path matches, or a symlinked spelling of the stop's file is rejected so a valid pause records no capture; no_claim=what path spelling js-debug reports
test('matches a frame reached through a link to the stop file and rejects a missing path', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'wxt-frame-'))
  const stopPath = join(root, 'App.tsx')
  const linkPath = join(root, 'linked.tsx')
  await writeFile(stopPath, 'export {}')
  await symlink(stopPath, linkPath)
  // Act
  const throughLink = await isFrameInStopSource(linkPath, stopPath)
  const missing = await isFrameInStopSource(undefined, stopPath)
  const empty = await isFrameInStopSource('', stopPath)
  const other = await isFrameInStopSource(join(root, 'Other.tsx'), stopPath)
  await removeTestFolder(root)
  // Assert
  assert.equal(throughLink, true)
  assert.equal(missing, false)
  assert.equal(empty, false)
  assert.equal(other, false)
})
