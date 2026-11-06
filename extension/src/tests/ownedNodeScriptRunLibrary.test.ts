import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { LibraryPackageCancelled, type LibraryPackage } from '../libraryPackage'
import { createLibraryBuildError } from '../utils/createLibraryBuildError'
import { describeNodeScriptViewStatus } from '../utils/describeNodeScriptViewStatus'

import { defer } from './utils/defer'
import {
  COMPLETE_OBSERVATION,
  FAKE_LIBRARY_FACTS,
  fakeLibraryPackage,
} from './utils/fakeLibraryPackage'
import {
  createScriptHarness,
  fakeScriptHistory,
  settle,
  until,
  type ScriptHarnessOptions,
} from './utils/nodeScriptRunHarness'

const CLEAN_EXIT = { exitCode: 0, signal: null } as const

/** The steps of an ending whose order D24 fixes. */
const ENDING_STEPS = [
  'finishObservation',
  'history:libraryObserved',
  'history:end',
  'dispose',
]

/** A harness with a library run whose build answers at once with a fake package. */
function libraryHarness(
  options: {
    observationFails?: boolean
    observation?: NonNullable<
      Parameters<typeof fakeLibraryPackage>[1]
    >['observation']
  } & Omit<ScriptHarnessOptions, 'history' | 'library' | 'prepareLibrary'> = {},
) {
  const order: string[] = []
  const history = fakeScriptHistory(order)
  const { observationFails, observation, ...rest } = options
  const harness = createScriptHarness({
    ...rest,
    library: { packageRoot: 'packages/widgets' },
    history: history.sink,
    prepareLibrary: async () =>
      fakeLibraryPackage(order, { observation, observationFails }),
  })
  // The harness keeps its own order list; the history and the library push to a second one that is merged by reading both.
  return { harness, history, libraryOrder: order }
}

/** The steps of an ending, read from the list the library and the history share. */
function endingStepsOf(libraryOrder: string[]): string[] {
  return libraryOrder.filter((step) => ENDING_STEPS.includes(step))
}

// protects=a run with library asks the learner before anything builds and the dialog names the package, its folder and the package manager; fails_when=the build starts before the answer or the dialog omits the build; no_claim=the dialog's wording (createNodeScriptRunAsker tests)
test('a library run asks the confirmation with the package, folder and manager before it builds', async () => {
  // Arrange
  const { harness } = libraryHarness({
    describeLibrary: async () => ({
      package: '@acme/widgets',
      packageManager: 'pnpm',
    }),
  })

  // Act
  await harness.run.prepare()

  // Assert
  assert.deepEqual(harness.questions[0]?.library, {
    package: '@acme/widgets',
    packageRoot: 'packages/widgets',
    packageManager: 'pnpm',
  })
  assert.ok(
    harness.order.indexOf('confirmRun') <
      harness.order.indexOf('prepareLibrary'),
  )
})

// protects=a declined confirmation builds nothing and spawns nothing; fails_when=prepareLibrary or launch runs after a no; no_claim=the real build
test('a declined library confirmation runs no build', async () => {
  // Arrange
  const { harness } = libraryHarness({ confirm: 'no' })

  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SCRIPT_NOT_CONFIRMED')
  assert.equal(harness.order.includes('prepareLibrary'), false)
  assert.equal(harness.order.includes('launch'), false)
})

// protects=the run reads building with the status line naming the package while the library builds, reports library.prepared before the script and starts node with the hook's arguments; fails_when=the phase is missing, the prepared event comes after the launch or the hook arguments are not passed; no_claim=real node resolution (the libraryPackage tests)
test('a library run reads building, reports library.prepared and launches with the hook arguments', async () => {
  // Arrange
  const order: string[] = []
  const history = fakeScriptHistory(order)
  const build = defer<LibraryPackage>()
  const harness = createScriptHarness({
    library: { packageRoot: 'packages/widgets' },
    history: history.sink,
    describeLibrary: async () => ({
      package: '@acme/widgets',
      packageManager: 'pnpm',
    }),
    prepareLibrary: () => build.promise,
  })
  const preparing = harness.run.prepare()
  await settle()

  // Act
  const whileBuilding = harness.run.view()
  build.resolve(fakeLibraryPackage(order))
  await preparing

  // Assert
  assert.equal(whileBuilding.state, 'building')
  assert.equal(
    describeNodeScriptViewStatus(whileBuilding),
    'Building @acme/widgets for the Example…',
  )
  assert.equal(harness.run.view().library?.prepared, true)
  assert.equal(harness.run.view().library?.version, '2.14.0')
  assert.deepEqual(history.told[0], {
    call: 'libraryPrepared',
    detail: {
      package: '@acme/widgets',
      version: '2.14.0',
      packageRoot: 'packages/widgets',
      revision: FAKE_LIBRARY_FACTS.revision,
      dirty: false,
      packageManager: 'pnpm',
      buildMs: 5_500,
      packMs: 620,
      tarballSha256: 'b'.repeat(64),
      installedVersion: '2.12.0',
    },
  })
  assert.deepEqual(harness.launches[0]?.libraryArguments, [
    '--import',
    'file:///fake-private/library-hook.mjs',
  ])
})

/** Runs a library run to one ending and returns the steps of its ending in the order they happened. */
async function endingOf(
  ending: 'exit' | 'stop' | 'deadline' | 'unreadable',
): Promise<{
  steps: string[]
  view: ReturnType<ReturnType<typeof createScriptHarness>['run']['view']>
}> {
  const { harness, libraryOrder } = libraryHarness({
    observationFails: ending === 'unreadable',
  })
  await harness.run.prepare()
  if (ending === 'stop') await harness.run.stop()
  else if (ending === 'deadline') {
    harness.clock.advance(60_000)
    await until(harness, (view) => view.end !== undefined)
  } else {
    harness.exits(CLEAN_EXIT)
    await until(harness, (view) => view.end !== undefined)
  }
  await harness.run.stop()
  return { steps: endingStepsOf(libraryOrder), view: harness.run.view() }
}

// protects=the script's own exit appends library.observed before the history's end and removes the folder last (D24); fails_when=the observation is read after the end, dropped, or the folder goes first; no_claim=the real file read
test('a natural exit reads the observation, appends it, ends the history, then removes the folder', async () => {
  // Act
  const { steps, view } = await endingOf('exit')

  // Assert
  assert.deepEqual(steps, ENDING_STEPS)
  assert.equal(view.library?.loaded, true)
  assert.equal(view.library?.cleanup, 'removed')
  assert.equal(view.state, 'ended')
})

// protects=a codebook_stop of a running script follows the same ending order; fails_when=the stop path ends the history before the observation; no_claim=a stop while paused
test('a stop ends in the same order as an exit', async () => {
  // Act
  const { steps, view } = await endingOf('stop')

  // Assert
  assert.deepEqual(steps, ENDING_STEPS)
  assert.equal(view.library?.cleanup, 'removed')
})

// protects=the running-time limit follows the same ending order; fails_when=the limit path ends the history before the observation; no_claim=the 10 minute run deadline (same path)
test('a deadline ends in the same order as an exit', async () => {
  // Act
  const { steps, view } = await endingOf('deadline')

  // Assert
  assert.deepEqual(steps, ENDING_STEPS)
  assert.equal(view.end?.kind, 'limit')
})

// protects=an observation that cannot be read is appended as unreadable and the run resource never says the package was not loaded; fails_when=the failed read drops the event, ends before it or reports loaded false; no_claim=the file format (readLibraryObservation tests)
test('an unreadable observation is appended as unreadable and reports no negative', async () => {
  // Act
  const { steps, view } = await endingOf('unreadable')

  // Assert
  assert.deepEqual(steps, ENDING_STEPS)
  assert.equal(view.library?.observation, 'unreadable')
  assert.equal('loaded' in (view.library ?? {}), false)
  assert.equal('publishedCopyLoaded' in (view.library ?? {}), false)
})

// protects=a script that never loaded the package reads loaded false with a complete observation, and one that loaded the installed copy reports publishedCopyLoaded with the first path; fails_when=either fact is lost; no_claim=real loads
test('the run resource keeps loaded and publishedCopyLoaded apart', async () => {
  // Arrange
  const { harness } = libraryHarness({
    observation: {
      loaded: false,
      loadCount: 0,
      otherCopyLoaded: true,
      otherCopyPath: '/repo/examples/app/node_modules/@acme/widgets/index.js',
      observation: 'complete',
    },
  })
  await harness.run.prepare()

  // Act
  harness.exits(CLEAN_EXIT)
  await until(harness, (view) => view.end !== undefined)
  const library = harness.run.view().library

  // Assert
  assert.equal(library?.loaded, false)
  assert.equal(library?.loadCount, 0)
  assert.equal(library?.publishedCopyLoaded, true)
  assert.equal(
    library?.publishedCopyPath,
    '/repo/examples/app/node_modules/@acme/widgets/index.js',
  )
})

// protects=a build error ends the preparation with the build's own error, spawns nothing and reports no library.prepared (D25 at the run); fails_when=the script launches, the prepared event is written, or the error is replaced; no_claim=the real build
test('a build failure rejects with the build error and reports nothing to the history', async () => {
  // Arrange
  const order: string[] = []
  const history = fakeScriptHistory(order)
  const harness = createScriptHarness({
    library: { packageRoot: 'packages/widgets' },
    history: history.sink,
    prepareLibrary: async () => {
      throw createLibraryBuildError(
        'LIBRARY_BUILD_FAILED',
        'build-error',
        'The library build ended with an error.',
        { cleanup: 'removed' },
      )
    },
  })

  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'LIBRARY_BUILD_FAILED')
  assert.equal(harness.order.includes('launch'), false)
  assert.deepEqual(history.told, [])
  assert.equal(harness.run.view().library?.cleanup, 'removed')
  assert.equal(harness.run.view().library?.prepared, false)
})

/** A build that waits for the run's abort and then fails with `error`. */
function buildEndingOnAbort(error: unknown) {
  return (request: { signal: AbortSignal }): Promise<LibraryPackage> =>
    new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(error), {
        once: true,
      })
    })
}

// protects=a stop while building keeps the build's tracked-file-changed as the preparation's error and the stop resolves; fails_when=the stop hides the verdict behind a plain stop or never resolves; no_claim=the service adoption (nodeScriptLibraryService tests)
test('a stop while building keeps tracked-file-changed as the error', async () => {
  // Arrange
  const harness = createScriptHarness({
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: buildEndingOnAbort(
      createLibraryBuildError(
        'LIBRARY_BUILD_FAILED',
        'tracked-file-changed',
        'A tracked file changed.',
        { path: 'src/index.ts', cleanup: 'removed' },
      ),
    ),
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()

  // Act
  const stateWhileBuilding = harness.run.view().state
  await harness.run.stop()
  const failure = await preparing

  // Assert
  assert.equal(stateWhileBuilding, 'building')
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.details?.reason, 'tracked-file-changed')
  assert.equal(harness.order.includes('launch'), false)
})

// protects=a stop that finds the sources unchanged reads as the plain stop (RUNTIME_FAILED) and the run ends stopped; fails_when=the cancellation surfaces as a build failure; no_claim=the verification itself
test('a stop while building with verified sources reads as a plain stop', async () => {
  // Arrange
  const harness = createScriptHarness({
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: buildEndingOnAbort(new LibraryPackageCancelled('removed')),
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()

  // Act
  await harness.run.stop()
  const failure = await preparing

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'RUNTIME_FAILED')
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(harness.run.view().library?.cleanup, 'removed')
})

// protects=a build that does not settle within the stop bound ends the stop with tracked-files-unverified and a pending folder, and a package that arrives later removes itself; fails_when=the stop waits for the build or reports a clean stop; no_claim=the real tree end
test('a build unsettled at the stop bound ends the stop as tracked-files-unverified', async () => {
  // Arrange
  const order: string[] = []
  const build = defer<LibraryPackage>()
  const harness = createScriptHarness({
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: () => build.promise,
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()

  // Act
  const stopping = harness.run.stop()
  await settle()
  harness.clock.advance(10_000)
  await stopping
  const failure = await preparing
  build.resolve(fakeLibraryPackage(order))
  await settle()

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'LIBRARY_BUILD_FAILED')
  assert.equal(failure.details?.reason, 'tracked-files-unverified')
  assert.equal(harness.run.view().library?.cleanup, 'removed')
  assert.deepEqual(order, ['dispose'])
})

// protects=a run without library lists the installed copies of the repository's packages and a failing or empty lookup lists none; fails_when=the list is dropped, shown empty or fails the run; no_claim=real origin matching (listRepositoryPackageCopies tests)
test('a run without library reports repositoryPackageCopies only when there are some', async () => {
  // Arrange
  const withCopies = createScriptHarness({
    listPackageCopies: async () => [
      {
        package: '@acme/widgets',
        installedVersion: '2.12.0',
        correspondence: 'unverified',
      },
    ],
  })
  const withoutCopies = createScriptHarness({
    listPackageCopies: async () => [],
  })
  const failing = createScriptHarness({
    listPackageCopies: async () => {
      throw new Error('git failed')
    },
  })

  // Act
  await Promise.all([
    withCopies.run.prepare(),
    withoutCopies.run.prepare(),
    failing.run.prepare(),
  ])

  // Assert
  assert.deepEqual(withCopies.run.view().repositoryPackageCopies, [
    {
      package: '@acme/widgets',
      installedVersion: '2.12.0',
      correspondence: 'unverified',
    },
  ])
  assert.equal('repositoryPackageCopies' in withoutCopies.run.view(), false)
  assert.equal('repositoryPackageCopies' in failing.run.view(), false)
  assert.equal(withCopies.run.view().library, undefined)
})

// protects=a run with library never lists installed copies, since it runs the checked-out one; fails_when=the disclosure runs for a library run; no_claim=none beyond protects
test('a library run lists no repositoryPackageCopies', async () => {
  // Arrange
  let listed = false
  const { harness } = libraryHarness({
    listPackageCopies: async () => {
      listed = true
      return []
    },
  })

  // Act
  await harness.run.prepare()

  // Assert
  assert.equal(listed, false)
  assert.equal(COMPLETE_OBSERVATION.observation, 'complete')
})
