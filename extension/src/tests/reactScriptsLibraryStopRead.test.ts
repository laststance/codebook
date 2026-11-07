import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { DevelopmentBundleRequest } from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { REACT_SCRIPTS_DEV_ADAPTER } from '../reactScriptsDevAdapter'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { resolveReactScriptsPackage } from '../utils/resolveReactScriptsPackage'

import {
  createReactScriptsRepository,
  serveFakeBundle,
} from './utils/reactScriptsFixture'

const LIBRARY_TEXT = [
  'export function createStore() {',
  '  const state = 1',
  '  return state',
  '}',
  '',
].join('\n')
const STOP_FILE = 'src/createStore.ts'

/** Stages a library at the repository root with an Example below it (P03's shape), a packed copy, and a served map that names the checked-out file. */
async function stageRootLibrary(context: TestContext) {
  const repository = await createReactScriptsRepository(context)
  const checkedOut = join(repository.root, STOP_FILE)
  const packedRoot = join(repository.root, 'private/node_modules/lib')
  await mkdir(dirname(checkedOut), { recursive: true })
  await writeFile(checkedOut, LIBRARY_TEXT)
  await mkdir(join(packedRoot, 'src'), { recursive: true })
  await writeFile(join(packedRoot, STOP_FILE), LIBRARY_TEXT)
  const served = await serveFakeBundle(context, () => ({
    sources: [checkedOut],
    sourcesContent: [LIBRARY_TEXT],
  }))
  const reactScriptsPackage = await resolveReactScriptsPackage(
    repository.root,
    repository.appFolder,
  )
  const request: DevelopmentBundleRequest = {
    workspace: repository.root,
    reactScriptsPackage,
    source: { path: STOP_FILE, hash: sha256(LIBRARY_TEXT), line: 2, column: 1 },
    citationEndLine: 3,
    signal: new AbortController().signal,
    entryPath: '/',
    execution: 'browser',
    ownedOrigin: served.origin,
    record: () => undefined,
  }
  return { repository, checkedOut, packedRoot, request }
}

// Value: protects=D3: a stop in the checked-out library of a react-scripts library run is sealed through the library seal instead of refused as outside the app; fails_when=readBundle ignores reactScriptsLibraryStop or passes the stop path unchanged below a library folder; no_claim=a real react-scripts compile or a browser pause (E2, AC 6)
test('a library stop of a react-scripts library run is sealed from the checked-out file', async (context) => {
  // Arrange
  const { repository, checkedOut, packedRoot, request } =
    await stageRootLibrary(context)
  // Act
  const sealed = await REACT_SCRIPTS_DEV_ADAPTER.readBundle({
    ...request,
    reactScriptsLibraryStop: {
      packageName: 'lib',
      libraryRoot: repository.root,
      libraryRootRelative: '.',
      packedRoot,
      examplePackageRoot: repository.appFolder,
    },
  })
  // Assert
  assert.equal(sealed.bundle.sourcePath, checkedOut)
  assert.equal(sealed.bundle.source, LIBRARY_TEXT)
})

// Value: protects=a stop outside the app of a run without the library route keeps the outside-package refusal; fails_when=the library branch runs for a request without reactScriptsLibraryStop; no_claim=the pre-start refusal of the run, which refuses such a stop before any process starts
test('a stop outside the app without the library route is still refused as outside the package', async (context) => {
  // Arrange
  const { request } = await stageRootLibrary(context)
  // Act
  const error = await REACT_SCRIPTS_DEV_ADAPTER.readBundle(request).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError, String(error))
  assert.deepEqual(
    [error.code, error.details?.reason],
    ['REACT_SCRIPTS_SEAL_FAILED', 'outside-package'],
  )
})
