import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { NodeProcessRun } from '../nodeProcessRun'
import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createManualClock } from './utils/createManualClock'
import { editorHarness, OWNED_IDS } from './utils/nodeServerEditorHarness'
import { fakeServer } from './utils/nodeServerRunHarness'
import { removeTestFolder } from './utils/removeTestFolder'

/** The text of the script file both declared stops lie in, with executable code on lines 3 and 4 (the stops' lines); its hash is what the stops cite. */
const SCRIPT_TEXT = [
  '// The script both declared stops lie in.',
  "const label = 'script'",
  'export const first = () => label.length',
  'export const second = () => first() + 1',
  '',
].join('\n')

/**
 * Builds the core of a script run (no request window of its own: the script is captured from its release until it exits) around the editor's real debugger, with a real script file so a capture reads the cited bytes.
 * Why it exists: the script run shares the debugger with the server run, so what the debugger reports about when a stop arrived decides whether the script's stop is captured.
 * @param editor - The fake editor of {@link editorHarness}.
 * @param directory - The folder holding `src/script.ts`.
 * @param options - How many declared stops the script has (lines 3 and 4 of its file).
 * @returns The core, its preparation and the stop file.
 * @example const { core, preparation } = scriptCore(editor, directory, { stops: 2 })
 */
function scriptCore(
  editor: Awaited<ReturnType<typeof editorHarness>>,
  directory: string,
  options: { stops: 1 | 2 },
) {
  const file = join(directory, 'src/script.ts')
  const order: string[] = []
  const clock = createManualClock()
  const process = fakeServer(order, {}, { output: '' })
  const core: NodeProcessRun = new NodeProcessRun({
    workspace: directory,
    runId: 'script-run-1',
    record: () => undefined,
    citedSources: [],
    declaredPort: 0,
    notify: () => undefined,
    // As a script run passes: it never lets a process that was not released run on, and confirms the group after a natural exit.
    options: {
      killFirstUnlessReleased: true,
      confirmEverySignalAfterNaturalExit: true,
    },
    hooks: {
      // As a script run's: capturable until the process exits.
      inWindow: () => true,
      holdLimits: () => undefined,
      releaseLimits: () => undefined,
      onStopAdmitted: () => undefined,
      onProcessOutput: () => undefined,
      // As a script run's: its next stop is the learner's keyboard once a capture is accepted.
      onStopCaptured: () => core.debuggerSession?.setRequestWindow(false),
    },
    dependencies: {
      clock: {
        now: () => clock.now(),
        set: (callback, delayMs) => {
          const id = clock.setTimeout(callback, delayMs)
          return (): void => clock.clearTimeout(id)
        },
      },
      node: { executable: '/usr/bin/node', version: '26.0.0' },
      createDebugger: (input) => editor.createDebuggerFor(input),
      launch: async () => process,
      signalGroup: () => undefined,
      isGroupGone: () => false,
      isProcessGone: () => false,
      readProcessStart: async () => 'start-1',
      readProcessCwd: async () => undefined,
      readListeningPorts: async () => [],
      rememberProcess: async () => undefined,
      forgetProcess: async () => undefined,
    },
  })
  const preparation = {
    resolveStops: async () =>
      Array.from({ length: options.stops }, (_, index) => ({
        declaredStopIndex: index,
        path: 'src/script.ts',
        file,
        line: 3 + index,
        column: 1,
        hash: sha256(SCRIPT_TEXT),
        inspections: [],
      })),
    resolveLaunch: async () => ({
      packageRoot: directory,
      entry: join(directory, 'script.js'),
      loader: { kind: 'node' as const },
    }),
    // As a script run's: it is prepared and its window opens before the entry release.
    beforeRelease: (): void => {
      core.markPrepared()
      core.requireDebugger().setRequestWindow(true)
    },
    afterRelease: async () => undefined,
  }
  return { core, preparation, file }
}

/** Makes a folder with the script file the stops cite. */
async function scriptFolder(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-script-core-'))
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, 'src/script.ts'), SCRIPT_TEXT)
  return directory
}

// protects=a script run's owned first stop, queued before the run's release opens its window, is captured: a script's capture eligibility is its lifecycle, not the HTTP first-byte window the server run judges by; fails_when=the shared debugger records the window as it stood when the stop arrived (closed, since the release had not run) and reports it to a script run, so its entry stop is held as unattributed with no capture (Cycle 0153 ship pass 1 S5); seam=the editor's real debugger behind the process core with a script-run preparation and a real script file; no_claim=a real script process or js-debug's entry stop
test(
  'a script run captures its owned first stop that arrived before the run was released',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const directory = await scriptFolder()
    const editor = await editorHarness({
      firstStop: {
        reason: 'breakpoint',
        ids: [OWNED_IDS[0]!],
        frame: { file: join(directory, 'src/script.ts'), line: 3 },
        // A hit by id follows the acknowledgement of its breakpoint, which the debugger reads as the stop arrives.
        afterArming: true,
      },
    })
    const { core, preparation } = scriptCore(editor, directory, { stops: 1 })
    try {
      // Act
      await core.prepare(preparation)
      await waitUntil(
        () => core.snapshot().captures.length === 1,
        'the entry stop captured',
        5_000,
      )
      // Assert
      assert.equal(core.snapshot().captures[0]?.declaredStopIndex, 0)
      assert.equal(core.snapshot().captures[0]?.line, 3)
      assert.equal(core.snapshot().heldPause, undefined)
    } finally {
      await core.stop().catch(() => undefined)
      await removeTestFolder(directory)
    }
  },
)

// protects=a script run captures its second declared stop after the learner continued the first one in the editor: the capture of the first closed the window that hands the keyboard back, and a script's later stops stay Codebook's captures; fails_when=the debugger reports the closed window to the script run, so the second declared stop is held as unattributed with no capture (Cycle 0153 ship pass 1 S5); seam=the editor's real debugger behind the process core with a script-run preparation, the learner's Continue in the editor and a second owned hit; no_claim=the keyboard handling of the Study (the stop ledger test covers it)
test(
  'a script run captures its second declared stop after the learner continued the first in the editor',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const directory = await scriptFolder()
    const editor = await editorHarness()
    const { core, preparation, file } = scriptCore(editor, directory, {
      stops: 2,
    })
    try {
      await core.prepare(preparation)
      editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], { file, line: 3 })
      await waitUntil(
        () => core.snapshot().captures.length === 1,
        'the first stop captured',
        5_000,
      )
      // Act
      editor.adapter.learnerContinues()
      editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], { file, line: 4 })
      await waitUntil(
        () => core.snapshot().captures.length === 2,
        'the second stop captured',
        5_000,
      )
      // Assert
      assert.deepEqual(
        core.snapshot().captures.map((capture) => capture.declaredStopIndex),
        [0, 1],
      )
      assert.deepEqual(
        core.snapshot().captures.map((capture) => capture.line),
        [3, 4],
      )
      assert.equal(core.snapshot().heldPause, undefined)
    } finally {
      await core.stop().catch(() => undefined)
      await removeTestFolder(directory)
    }
  },
)
