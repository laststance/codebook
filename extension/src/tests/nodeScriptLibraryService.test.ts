import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  NODE_SCRIPT_HISTORY_DIRECTORY,
  NODE_SCRIPT_PROFILE,
} from '../constants'
import { LibraryPackageCancelled, type LibraryPackage } from '../libraryPackage'
import { createOwnedNodeScriptRun } from '../ownedNodeScriptRun'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { createLibraryBuildError } from '../utils/createLibraryBuildError'

import { createHarness } from './helpers'
import { defer } from './utils/defer'
import { fakeLibraryPackage } from './utils/fakeLibraryPackage'
import {
  createScriptHarness,
  fakeScriptHistory,
  settle,
  type ScriptHarnessOptions,
} from './utils/nodeScriptRunHarness'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { WORKSPACE } from './utils/nodeServerRunHarness'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

type Harness = Awaited<ReturnType<typeof createHarness>>

/** The script declaration over the harness's published article, with the library the Example is built on. */
function libraryConfigurationOf(
  harness: Pick<Harness, 'configuration'>,
  library: { packageRoot: string } | null,
) {
  const base = harness.configuration
  return {
    version: 1,
    adapter: 'node-script',
    book: base.book,
    entry: 'src/run.mjs',
    ...(library ? { library } : {}),
    source: base.source,
    inspections: base.inspections.slice(0, 1),
  }
}

/**
 * Makes the service create the real owned run over a script harness's fakes (the process, the debugger, the build), so the service's own stop, error and history handling meet the run's.
 * @param harness - The service harness.
 * @param scripts - The script harness whose dependencies the run uses.
 * @param history - A history sink the run reports to instead of the service's own; absent keeps the service's.
 */
function wireRealRun(
  harness: Harness,
  scripts: ReturnType<typeof createScriptHarness>,
  history?: ReturnType<typeof fakeScriptHistory>['sink'],
): void {
  harness.service.environment.createNodeScriptRun = async (
    configuration,
    record,
    citedSources,
    runId,
    serviceHistory,
  ) =>
    createOwnedNodeScriptRun({
      workspace: WORKSPACE,
      configuration,
      record,
      citedSources,
      runId,
      history: history ?? serviceHistory,
      dependencies: scripts.dependencies,
    })
}

/** Starts the run and returns its record; the service answers the receipt at once. */
function startRun(
  harness: Harness,
  library: { packageRoot: string } | null = { packageRoot: 'packages/widgets' },
) {
  const { service } = harness
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_SCRIPT_PROFILE,
    key: 'first',
    configuration: libraryConfigurationOf(harness, library),
  })
  return { receipt, record: service.record(receipt) }
}

/** A build that waits for the run's abort and then fails with `error`. */
function buildEndingOnAbort(error: unknown) {
  return (request: { signal: AbortSignal }): Promise<LibraryPackage> =>
    new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(error), {
        once: true,
      })
    })
}

/** Reads the run resource's JSON. */
async function runJson(harness: Harness, record: { id: string }) {
  const resource = await readResource(
    harness.service,
    harness.service.uri(record.id),
  )
  const parsed: Record<string, any> = JSON.parse(
    'text' in resource ? resource.text : '{}',
  )
  return parsed
}

const baseOptions: ScriptHarnessOptions = { stopCount: 2 }

// protects=codebook_start answers its receipt at once for a library run while the confirmation and the build follow, and the run resource reads confirming, then building with the library identity (D11); fails_when=the start waits for the confirmation or the build, or the building phase is missing from the resource; no_claim=the real build
test('the start receipt answers at once and the run resource follows confirming then building', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const build = defer<LibraryPackage>()
  const scripts = createScriptHarness({
    ...baseOptions,
    confirm: 'manual',
    library: { packageRoot: 'packages/widgets' },
    describeLibrary: async () => ({
      package: '@acme/widgets',
      packageManager: 'pnpm',
    }),
    prepareLibrary: () => build.promise,
  })
  wireRealRun(harness, scripts)

  // Act
  const { receipt, record } = startRun(harness)
  await waitUntil(
    () => scripts.questions.length > 0,
    'the run confirmation question',
  )
  const whileAsked = (await runJson(harness, record)).state
  scripts.answer(true)
  await waitUntil(
    () => scripts.order.includes('prepareLibrary'),
    'the library preparation',
  )
  const whileBuilding = await runJson(harness, record)
  build.resolve(fakeLibraryPackage(scripts.order))
  await record.preparation

  // Assert
  assert.ok(receipt)
  assert.equal(whileAsked, 'confirming')
  assert.equal(whileBuilding.state, 'building')
  assert.equal(whileBuilding.nodeScript.library.package, '@acme/widgets')
  assert.equal(whileBuilding.nodeScript.library.prepared, false)
  assert.equal(scripts.order.includes('launch'), true)

  // Cleanup
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })
})

// protects=a declined confirmation builds nothing and the run's error is SCRIPT_NOT_CONFIRMED; fails_when=a build starts after a no; no_claim=the dialog
test('a declined confirmation through the service builds nothing', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const scripts = createScriptHarness({
    ...baseOptions,
    confirm: 'no',
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: async () => fakeLibraryPackage([]),
  })
  wireRealRun(harness, scripts)

  // Act
  const { record } = startRun(harness)
  await record.preparation

  // Assert
  assert.equal(record.error?.code, 'SCRIPT_NOT_CONFIRMED')
  assert.equal(scripts.order.includes('prepareLibrary'), false)
})

// protects=a stop while the library builds keeps the build's tracked-file-changed as the run's error (D21) and the stop ends; fails_when=the service drops the error as a plain stop; no_claim=the real tracked-file comparison
test('a stop while building keeps tracked-file-changed as the run error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: buildEndingOnAbort(
      createLibraryBuildError(
        'LIBRARY_BUILD_FAILED',
        'tracked-file-changed',
        'A tracked file changed.',
        {
          path: 'src/index.ts',
          cleanup: 'removed',
        },
      ),
    ),
  })
  wireRealRun(harness, scripts)
  const { record } = startRun(harness)
  await waitUntil(
    () => scripts.order.includes('prepareLibrary'),
    'the library preparation',
  )

  // Act
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })

  // Assert
  assert.equal(record.stopped, true)
  assert.equal(record.error?.code, 'LIBRARY_BUILD_FAILED')
  assert.equal(record.error?.details?.reason, 'tracked-file-changed')
})

// protects=a stop that finds the sources unchanged leaves no error of its own; fails_when=a verified cancellation reads as a failure; no_claim=none beyond protects
test('a stop while the build ends with a build-error and no tracked-file change leaves no run error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: buildEndingOnAbort(
      createLibraryBuildError(
        'LIBRARY_BUILD_FAILED',
        'build-error',
        'The build failed.',
        { cleanup: 'removed' },
      ),
    ),
  })
  wireRealRun(harness, scripts)
  const { record } = startRun(harness)
  await waitUntil(
    () => scripts.order.includes('prepareLibrary'),
    'the library preparation',
  )

  // Act
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })

  // Assert
  assert.equal(record.stopped, true)
  assert.equal(record.error, undefined)
})

// protects=a stop whose build ends as LibraryPackageCancelled (sources verified unchanged) is a plain stop through the service: no library error as record.error, ended within the stop bound, no saved history; fails_when=the cancellation is kept as a run error, waits for the stop bound, or leaves a history; no_claim=the real source verification
test('a stop while building that ends as a verified cancellation is a plain stop with no history', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  harness.service.nodeHistoryRepository = repository
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: buildEndingOnAbort(new LibraryPackageCancelled('removed')),
  })
  wireRealRun(harness, scripts)
  const { record } = startRun(harness)
  await waitUntil(
    () => scripts.order.includes('prepareLibrary'),
    'the library preparation',
  )

  // Act
  // The fake clock is never advanced, so only the build's own ending can settle the stop within the bound.
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })
  const { scripts: saved } = await repository.listByProfile()

  // Assert
  assert.equal(record.stopped, true)
  assert.equal(record.error, undefined)
  assert.deepEqual(saved, [])
})

// protects=a stop whose build does not settle ends within the stop bound with tracked-files-unverified as the run's error (D21); fails_when=the stop waits for the build forever or reads clean; no_claim=the real tree end
test('a stop whose build never settles ends at the stop bound as tracked-files-unverified', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: () => new Promise<LibraryPackage>(() => undefined),
  })
  wireRealRun(harness, scripts)
  const { record } = startRun(harness)
  await waitUntil(
    () => scripts.order.includes('prepareLibrary'),
    'the library preparation',
  )
  let didStopResolve = false

  // Act
  const stopping = harness.service
    .stop({ instanceId: harness.service.instanceId, runId: record.id })
    .then(() => {
      didStopResolve = true
    })
  await settle()
  const didResolveBeforeBound = didStopResolve
  scripts.clock.advance(10_000)
  await stopping

  // Assert
  assert.equal(didResolveBeforeBound, false)
  assert.equal(record.stopped, true)
  assert.equal(record.error?.details?.reason, 'tracked-files-unverified')
})

// protects=a library run's script exit appends library.observed before the history's end and removes the folder last, and the run resource reports the library facts, the observation and the cleanup (D24, D27); fails_when=the order differs or a fact is missing from the resource; no_claim=the real files
test('a script exit through the service ends in the fixed order and the resource carries the library facts', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const order: string[] = []
  const history = fakeScriptHistory(order)
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: async () => fakeLibraryPackage(order),
  })
  wireRealRun(harness, scripts, history.sink)
  const { record } = startRun(harness)
  await record.preparation

  // Act
  scripts.exits({ exitCode: 0, signal: null })
  while (!record.stopped) await settle()
  const resource = await runJson(harness, record)

  // Assert
  assert.deepEqual(order, [
    'history:libraryPrepared',
    'finishObservation',
    'history:libraryObserved',
    'history:end',
    'dispose',
  ])
  assert.equal(resource.state, 'ended')
  assert.deepEqual(
    {
      package: resource.nodeScript.library.package,
      version: resource.nodeScript.library.version,
      prepared: resource.nodeScript.library.prepared,
      observation: resource.nodeScript.library.observation,
      loaded: resource.nodeScript.library.loaded,
      loadCount: resource.nodeScript.library.loadCount,
      publishedCopyLoaded: resource.nodeScript.library.publishedCopyLoaded,
      cleanup: resource.nodeScript.library.cleanup,
    },
    {
      package: '@acme/widgets',
      version: '2.14.0',
      prepared: true,
      observation: 'complete',
      loaded: true,
      loadCount: 2,
      publishedCopyLoaded: false,
      cleanup: 'removed',
    },
  )
})

// protects=a build failure leaves no saved history (D25) and the run keeps the build error; fails_when=a header-only history stays listed after a failed build; no_claim=a failure after the script started
test('a build failure leaves no saved history and keeps the error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  harness.service.nodeHistoryRepository = repository
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: async () => {
      throw createLibraryBuildError(
        'LIBRARY_BUILD_FAILED',
        'build-error',
        'The library build ended with an error.',
        {
          cleanup: 'removed',
        },
      )
    },
  })
  wireRealRun(harness, scripts)
  const { record } = startRun(harness)

  // Act
  await record.preparation
  while (!record.stopped) await settle()
  const { scripts: saved } = await repository.listByProfile()

  // Assert
  assert.equal(record.error?.code, 'LIBRARY_BUILD_FAILED')
  assert.equal(record.error?.details?.reason, 'build-error')
  assert.deepEqual(saved, [])
})

// protects=a run with library writes its history header as format 2 with the declared identity; fails_when=the service starts the history without the library identity; no_claim=the journal entries (nodeScriptLibraryHistory tests)
test('a library run starts a format 2 history header with the declared identity', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository, learningDirectory } = await openServerRepository(context)
  harness.service.nodeHistoryRepository = repository
  const scripts = createScriptHarness({
    ...baseOptions,
    library: { packageRoot: 'packages/widgets' },
    prepareLibrary: () => new Promise<LibraryPackage>(() => undefined),
  })
  wireRealRun(harness, scripts)

  // Act
  const { record } = startRun(harness)
  await waitUntil(
    () => scripts.order.includes('prepareLibrary'),
    'the library preparation',
  )
  const folder = join(
    learningDirectory,
    NODE_SCRIPT_HISTORY_DIRECTORY,
    `${harness.service.instanceId}_${record.id}`,
  )
  const header = JSON.parse(await readFile(join(folder, 'header.json'), 'utf8'))
  const stopping = harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })
  await settle()
  scripts.clock.advance(10_000)
  await stopping

  // Assert
  assert.equal(header.formatVersion, 2)
  assert.deepEqual(header.library, {
    package: 'packages/widgets',
    packageRoot: 'packages/widgets',
  })
})

// protects=a run without library lists the installed copies in the run resource's nodeScript block; fails_when=the copies never reach the resource or a library block appears; no_claim=origin matching
test('a run without library carries repositoryPackageCopies in the resource', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const scripts = createScriptHarness({
    ...baseOptions,
    listPackageCopies: async () => [
      {
        package: '@acme/widgets',
        installedVersion: '2.12.0',
        correspondence: 'unverified',
      },
    ],
  })
  wireRealRun(harness, scripts)
  const { record } = startRun(harness, null)

  // Act
  await record.preparation
  const resource = await runJson(harness, record)

  // Assert
  assert.deepEqual(resource.nodeScript.repositoryPackageCopies, [
    {
      package: '@acme/widgets',
      installedVersion: '2.12.0',
      correspondence: 'unverified',
    },
  ])
  assert.equal('library' in resource.nodeScript, false)

  // Cleanup
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })
})

// protects=codebook_status reports the repository's package manager under the node-script prerequisites; fails_when=the environment's report is dropped on the way to the status; no_claim=the lookup itself (describeRepositoryPackageManager tests)
test('codebook_status reports the package manager under the node-script prerequisites', async (context) => {
  // Arrange
  const harness = await createHarness({
    prerequisites: async () => ({
      ready: true,
      missing: [],
      profiles: {
        'node-script': {
          ready: true,
          missing: [],
          repositoryPackageManager: {
            name: 'pnpm',
            found: true,
            version: '11.23.0',
          },
        },
      },
    }),
  })
  context.after(() => harness.close())
  harness.service.environment.createNodeScriptRun = async () => {
    throw new Error('not created by status')
  }

  // Act
  const status = await harness.service.status()
  const profile = status.profiles.find((entry) => entry.id === 'node-script')

  // Assert
  assert.ok(profile && 'repositoryPackageManager' in profile.prerequisites)
  assert.deepEqual(profile.prerequisites.repositoryPackageManager, {
    name: 'pnpm',
    found: true,
    version: '11.23.0',
  })
})
