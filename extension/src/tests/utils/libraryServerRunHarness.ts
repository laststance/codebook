import type { TestContext } from 'node:test'

import type { RetainedStudy } from '../../retainedStudySchemas'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { captureStudy } from '../../utils/captureStudy'

import { armedEntry } from './entryRenderHarness'
import {
  LIBRARY_APP_FOLDER,
  libraryFixture,
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
  type LibraryFixtureSpec,
  type LibraryHarnessFiles,
} from './libraryBuildHarness'
import {
  pagesServerService,
  type PagesServerRunOptions,
} from './pagesServerRunHarness'

/** The workspace key of a study captured here. */
export const LIBRARY_STUDY_WORKSPACE_KEY = '0'.repeat(64)

/** A library fixture whose facts a test reads after the harness wrote it. */
export type StagedLibrary = {
  /** The writer to give the harness as `libraryStop`. */
  stop: NonNullable<PagesServerRunOptions['libraryStop']>
  /** The facts the writer returned; throws before the harness called it. */
  files(): LibraryHarnessFiles
}

/**
 * Stages a library fixture and keeps what its writer returned, so a test can build hits and instances after the harness exists.
 * @param spec - What the fixture stages.
 * @returns The writer for the harness and a reader of its facts.
 * @example const staged = stageLibrary({ inCompile: [] }); await pagesServerRun(context, libraryRunOptions(staged))
 */
export function stageLibrary(spec: LibraryFixtureSpec = {}): StagedLibrary {
  let written: LibraryHarnessFiles | undefined
  const write = libraryFixture(spec)
  return {
    stop: async (input) => (written = await write(input)),
    files() {
      if (!written) throw new Error('The library fixture was not written yet.')
      return written
    },
  }
}

/**
 * Gives the harness options of a server stop on the library's `return doubled` line, reached from a nested Pages app that links the library: the stop file lies outside the app, the debugger reports the library's built file, and the required inspection is `value:doubled`.
 * @param staged - The staged library fixture.
 * @param extra - Options that replace these.
 * @returns Options for `pagesServerRun` and `pagesServerService`.
 * @example await pagesServerRun(context, libraryRunOptions(stageLibrary()))
 */
export function libraryRunOptions(
  staged: StagedLibrary,
  extra: PagesServerRunOptions = {},
): PagesServerRunOptions {
  return {
    packageRoot: LIBRARY_APP_FOLDER,
    packageApp: { stopsOutside: true },
    sourcePath: LIBRARY_SOURCE_PATH,
    fixture: {
      source: LIBRARY_SOURCE,
      citationEndLine: 4,
      declaredLine: LIBRARY_RETURN_LINE,
    },
    nextPages: { mappedLines: 3, serverCompile: {} },
    libraryStop: staged.stop,
    inspections: [{ path: 'doubled', mode: 'value', required: true }],
    inspectionScope: { doubled: 6 },
    ...extra,
  }
}

/**
 * Runs the library server stop in a service to its completion and captures the study, as the editor saves it: arms, hits `return doubled` with the data function's frames, continues and completes.
 * @param context - The running test.
 * @param spec - What the library fixture stages.
 * @returns The study, the run and the staged library.
 * @example const { study, run } = await captureLibraryRun(context)
 */
export async function captureLibraryRun(
  context: TestContext,
  spec: LibraryFixtureSpec = {},
): Promise<{
  study: RetainedStudy
  run: Awaited<ReturnType<typeof pagesServerService>>
  staged: StagedLibrary
}> {
  const staged = stageLibrary(spec)
  const run = await pagesServerService(context, libraryRunOptions(staged))
  const { harness, state, service, receipt } = run
  harness.server!.setFrameName('double')
  harness.server!.setScope({ doubled: 6 })
  run.holdMaintenance()
  await armedEntry(harness).catch((timeout: unknown) => {
    throw new Error(
      `${String(timeout)}; the run's error: ${JSON.stringify(state().error)}`,
    )
  })
  harness.server!.hit({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  await waitUntil(() => state().state === 'paused-server', 'the library pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'completed', 'the completed run')
  const study = await captureStudy(
    service,
    service.record(receipt),
    LIBRARY_STUDY_WORKSPACE_KEY,
  )
  if (!study) throw new Error('The completed run produced no study.')
  return { study, run, staged }
}
