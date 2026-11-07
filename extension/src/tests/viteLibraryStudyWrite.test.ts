import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { VITE_LIBRARY_STUDY_VERSION } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
import { RepositoryBookStore } from '../repositoryBook'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { captureStudy } from '../utils/captureStudy'
import { describeStudyLibraryLine } from '../utils/describeStudyLibraryLine'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const ORIGIN = 'http://localhost:4321'

/** Runs a nested library run through the service to its first stop and stops it, returning the captured study. */
async function savedLibraryStudy(
  context: TestContext,
  announce: 'packed' | 'none',
) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-lib-study-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const packedRoot = join(privateFolder, 'node_modules', '@acme', 'widgets')
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: 'examples/widgets-vite',
    packageApp: { decoyRoot: true },
    operations: {
      operations: [{ kind: 'click', title: 'Toggle', selector: '#toggle' }],
      stopOperations: [1],
    },
    libraryRoute: {
      declared: 'packages/widgets',
      dependencies: {
        confirm: async () => true,
        resolveNode: async () => ({
          executable: process.execPath,
          version: '24.0.0',
        }),
        assertSupported: async () => ({
          libraryRoot: join(privateFolder, 'library'),
          relativeRoot: 'packages/widgets',
          name: '@acme/widgets',
          version: '1.2.0',
          peers: [],
          packageManager: {
            ok: true,
            name: 'pnpm',
            version: '10.0.0',
            executable: '/bin/pnpm',
          },
        }),
        readManifest: async () => ({ peers: [] }),
        allocatePrivateFolder: async () => privateFolder,
        prepareCore: async () => ({
          facts: {
            package: '@acme/widgets',
            version: '1.2.0',
            packageRoot: 'packages/widgets',
            revision: 'a'.repeat(40),
            dirty: false,
            packageManager: { name: 'pnpm', version: '10.0.0' },
            buildMs: 5,
            packMs: 2,
            tarballSha256: 'c'.repeat(64),
            installedVersion: null,
          },
          packedRoot,
          peers: [],
          imports: undefined,
          libraryRoot: join(privateFolder, 'library'),
          privateFolder,
          dispose: async () => ({ cleanup: 'removed' as const }),
          failLink: async (sentence: string) => {
            throw new Error(sentence)
          },
        }),
        writeAnchor: async () => join(privateFolder, 'codebook-anchor.js'),
      },
    },
  })
  const library = new LearningLibrary(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'library-study',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  if (announce === 'packed') {
    const file = join(packedRoot, 'dist', 'index.mjs')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'export {}\n')
    harness.announceScript('p1', `${ORIGIN}/@fs${file}?v=1`)
  }
  service.action({ ...receipt, key: 'one', action: 'repository-operation' })
  await waitUntil(
    () => harness.run.view().snapshots.length === 1,
    'committed first stop',
  )
  await service.stop(receipt)
  return captureStudy(service, record, library.workspaceKey)
}

// protects=a Vite library run is saved as format 16 with the library facts of its final state, and the replay line reads the correspondence sentence from them; fails_when=the study keeps format 10, loses the facts, or saves them before the observation was finalized; no_claim=reload from disk (studyFormat16 covers the stored form) and the webview paint
test('a library run is saved as format 16 with its final facts and the replay sentence', async (context) => {
  // Arrange / Act
  const study = await savedLibraryStudy(context, 'packed')
  // Assert
  assert.equal(study?.version, VITE_LIBRARY_STUDY_VERSION)
  const facts: LibraryRunFacts | undefined =
    study && 'library' in study ? study.library : undefined
  assert.equal(facts?.observation, 'complete')
  assert.equal(facts?.loaded, true)
  assert.equal(facts?.cleanup, 'removed')
  assert.equal(
    describeStudyLibraryLine(facts),
    'Ran on the checked-out @acme/widgets 1.2.0 built from aaaaaaa (packed by pnpm)',
  )
})

// protects=a library run whose page parsed nothing of the package is saved complete with loaded false, and the replay says built but not served; fails_when=the saved facts claim a load; no_claim=none beyond protects
test('a library run that served nothing of the package is saved with loaded false', async (context) => {
  // Arrange / Act
  const study = await savedLibraryStudy(context, 'none')
  // Assert
  const facts = study && 'library' in study ? study.library : undefined
  assert.equal(facts?.loaded, false)
  assert.equal(
    describeStudyLibraryLine(facts),
    'Built @acme/widgets 1.2.0, but not served to this page.',
  )
})

// protects=the replay line of each observation state: incomplete and unreadable read not fully observed, an unbuilt library has no line; fails_when=an uncertain state reads as a claim or as not loaded; no_claim=none beyond protects
test('the replay line never turns an uncertain observation into a claim', () => {
  // Arrange
  const base: LibraryRunFacts = {
    package: '@acme/widgets',
    packageRoot: 'packages/widgets',
    prepared: true,
    version: '1.2.0',
    revision: 'a'.repeat(40),
    dirty: false,
    packageManager: { name: 'pnpm', version: null },
    buildMs: 1,
    packMs: 1,
    tarballSha256: 'b'.repeat(64),
    installedVersion: null,
    observation: 'incomplete',
    loaded: true,
    loadCount: 1,
  }
  // Assert
  assert.equal(
    describeStudyLibraryLine(base),
    'What the page loaded was not fully observed.',
  )
  const { loaded: _loaded, loadCount: _count, ...unreadable } = base
  assert.equal(
    describeStudyLibraryLine({ ...unreadable, observation: 'unreadable' }),
    'What the page loaded was not fully observed.',
  )
  assert.equal(
    describeStudyLibraryLine({
      package: '@acme/widgets',
      packageRoot: 'packages/widgets',
      prepared: false,
      observation: 'pending',
    }),
    undefined,
  )
})
