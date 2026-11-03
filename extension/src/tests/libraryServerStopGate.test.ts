import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { armedEntry } from './utils/entryRenderHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_SOURCE_PATH,
} from './utils/libraryBuildHarness'
import {
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

/** Reads the `details` of a thrown refusal as plain data. */
function detailsOf(failure: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details')))
}

// protects=a server stop in a workspace library of a nested App Router app is refused up front as outside-package, as before library stops existed; fails_when=the stop is frozen as a library stop (the run fails late and uncoded) or the refusal reports other effects; no_claim=an app with both routers
test('a library server stop in a nested App Router app is refused outside-package before any server starts', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(
    context,
    libraryRunOptions(
      {
        ...staged,
        // The nested app gets an App folder and no Pages folder, so no Pages route can run.
        stop: async (input) => {
          const appFolder = join(input.directory, LIBRARY_APP_FOLDER, 'app')
          await mkdir(appFolder, { recursive: true })
          await writeFile(
            join(appFolder, 'page.tsx'),
            'export default function Page() { return null }\n',
          )
          return staged.stop(input)
        },
      },
      { nextPages: undefined },
    ),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(detailsOf(failure), {
    reason: 'outside-package',
    files: [LIBRARY_SOURCE_PATH],
    packageRoot: LIBRARY_APP_FOLDER,
    sideEffects: 'none',
  })
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=a library stop's freeze charges the run-level discovery budget, so several library stops cannot multiply the bounds; fails_when=each freeze gets a fresh budget object (the run's shared one stays at zero); no_claim=the sum over two stops (one stop is staged here)
test('a library stop freeze charges the run-level discovery budget', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  // Act
  // The run stays prepared-in-flight; the harness closes it with the test context.
  void harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // Assert
  const budget = Reflect.get(Object(harness.run), 'libraryBudget') as {
    readBytes: number
    spentMs: number
  }
  assert.ok(budget.readBytes > 0)
})
