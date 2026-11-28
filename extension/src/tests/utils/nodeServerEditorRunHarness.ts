import type {
  NodeServerDebugger,
  NodeServerDebuggerPause,
  NodeServerStopCapture,
} from '../../nodeServerDebugger'

import { editorHarness, OWNED_IDS } from './nodeServerEditorHarness'
import {
  createHarness,
  type Harness,
  type HarnessOptions,
  WORKSPACE,
} from './nodeServerRunHarness'

/** The file both declared stops of {@link editorRun} lie in, as the run's stops name it. */
export const RUN_STOP_FILE = `${WORKSPACE}/src/routes/users.ts`

/** The editor harness's options. */
type EditorOptions = NonNullable<Parameters<typeof editorHarness>[0]>

/**
 * Reads a pause the way a capture would, without a repository on disk: the run's capture path is real, and only what the debugger would read from the file is fixed.
 * Why it exists: the real capture reads the cited file of the stop, and the run harness's workspace is no folder on disk.
 * @param pause - The owned pause being captured.
 * @returns A presentable capture of the pause's declared stop.
 * @example await fixedCapture({ token: 1, declaredStopIndex: 1 }).line // => 15
 */
function fixedCapture(pause: NodeServerDebuggerPause): NodeServerStopCapture {
  return {
    path: 'src/routes/users.ts',
    line: 14 + (pause.declaredStopIndex ?? 0),
    sourceHash: 'cited-hash',
    facts: [],
    unavailable: [],
    snapshot: { version: 1, frames: [], variables: [], limitations: [] },
  }
}

/**
 * Wraps the editor's real debugger so only its file read is replaced ({@link fixedCapture}); every other call and every piece of state is the real debugger's.
 * @param real - The editor's real debugger.
 * @param capture - What a capture reads; the fixed stand-in unless a history test needs a presentable one.
 * @returns A debugger that delegates to `real`.
 * @example const debug = withFixedCapture(editor.createDebuggerFor(input), fixedCapture)
 */
function withFixedCapture(
  real: NodeServerDebugger,
  capture: (pause: NodeServerDebuggerPause) => NodeServerStopCapture,
): NodeServerDebugger {
  return new Proxy(real, {
    get(target, property) {
      if (property === 'capture')
        return async (pause: NodeServerDebuggerPause) => capture(pause)
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Builds a node-server run whose debugger is the editor's real one, behind the fake editor and adapter, so a test drives the run and the debugger together (the ordering of DAP events against the run's own steps).
 * Why it exists: the run's fakes ({@link createHarness}) cannot model what the debugger knows about the learner's Pause, an unreported stop or the stop ledger, and the debugger's tests cannot model the run's write checks.
 * Called by the tests that need both sides.
 * @param options.editor - The fake editor's options (a held stack read, a rejected stack, a first stop).
 * @param options.run - The run harness's options (a held peer check, two stops, a Bun loader, a sign-in); the harness reads this object itself, so a later change to it is heard.
 * @param options.prepare - `false` leaves the run unprepared, so a test acts while it prepares.
 * @param options.capture - What every capture reads, in place of the fixed stand-in (a history test needs a presentable snapshot).
 * @returns The fake editor with its adapter, and the run harness.
 * @example
 * const { editor, harness } = await editorRun({ run: { stops: 2 } })
 * hitDeclaredStop(editor, 0)
 */
export async function editorRun(
  options: {
    editor?: EditorOptions
    run?: HarnessOptions
    prepare?: boolean
    capture?: (pause: NodeServerDebuggerPause) => NodeServerStopCapture
  } = {},
): Promise<{
  editor: Awaited<ReturnType<typeof editorHarness>>
  harness: Harness
}> {
  const editor = await editorHarness(options.editor)
  // The caller's own options object is the harness's, so a test that changes one later (a peer check gate it sets after the sign-in) is heard.
  const runOptions: HarnessOptions = options.run ?? {}
  runOptions.createDebugger = (input) =>
    withFixedCapture(
      editor.createDebuggerFor(input),
      options.capture ?? fixedCapture,
    )
  const harness = createHarness(runOptions)
  if (options.prepare !== false) await harness.run.prepare()
  return { editor, harness }
}

/**
 * The adapter reports a hit of declared stop `index` of {@link editorRun}'s run, on that stop's own line.
 * @param editor - The fake editor of {@link editorRun}.
 * @param index - The zero-based declared stop.
 * @param threadId - The thread that stops; thread 1 unless named.
 * @example hitDeclaredStop(editor, 1) // the second stop at line 15
 */
export function hitDeclaredStop(
  editor: Awaited<ReturnType<typeof editorHarness>>,
  index: number,
  threadId?: number,
): void {
  editor.adapter.stop(
    'breakpoint',
    [OWNED_IDS[index]!],
    { file: RUN_STOP_FILE, line: 14 + index },
    threadId,
  )
}
