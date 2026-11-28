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
 * Builds a node-server run whose debugger is the editor's real one, behind the fake editor and adapter, so a test drives the run and the debugger together (the ordering of DAP events against the run's own steps).
 * Why it exists: the run's fakes ({@link createHarness}) cannot model what the debugger knows about the learner's Pause, an unreported stop or the stop ledger, and the debugger's tests cannot model the run's write checks.
 * Called by the tests that need both sides.
 * @param options.editor - The fake editor's options (a held stack read, a rejected stack, a first stop).
 * @param options.run - The run harness's options (a held peer check, two stops, a Bun loader, a sign-in).
 * @param options.prepare - `false` leaves the run unprepared, so a test acts while it prepares.
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
  } = {},
): Promise<{
  editor: Awaited<ReturnType<typeof editorHarness>>
  harness: Harness
}> {
  const editor = await editorHarness(options.editor)
  const harness = createHarness({
    ...options.run,
    createDebugger: (input) => editor.createDebuggerFor(input),
  })
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
