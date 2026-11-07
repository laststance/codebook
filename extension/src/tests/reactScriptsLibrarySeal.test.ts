import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import {
  REACT_SCRIPTS_LIBRARY_BUILD_CHANGED_VARIANT,
  reactScriptsLibraryBuildChangedFailure,
  reactScriptsLibraryFailureText,
} from '../reactScriptsRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { ReactScriptsBundleCache } from '../utils/readReactScriptsServedBundle'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import { sealReactScriptsLibraryStop } from '../utils/sealReactScriptsLibraryStop'

import {
  createReactScriptsRepository,
  serveFakeBundle,
  type ServedMapOptions,
} from './utils/reactScriptsFixture'

const LIBRARY_TEXT = [
  'export function createStore() {',
  '  const state = 1',
  '  return state',
  '}',
  '',
].join('\n')
const LIBRARY_FOLDER = 'packages/lib'
const STOP_FILE = `${LIBRARY_FOLDER}/src/createStore.ts`

/** Stages a checked-out library file and its packed copy next to a staged Example, and seals the stop against a served map. */
async function stageLibrarySeal(
  context: TestContext,
  options: {
    checkedOutText?: string
    packedText?: string | null
    map: (paths: { checkedOut: string; packed: string }) => ServedMapOptions
    line?: number
  },
) {
  const repository = await createReactScriptsRepository(context)
  const libraryRoot = join(repository.root, LIBRARY_FOLDER)
  const packedRoot = join(repository.root, 'private/node_modules/lib')
  const checkedOut = join(libraryRoot, 'src/createStore.ts')
  const packed = join(packedRoot, 'src/createStore.ts')
  const checkedOutText = options.checkedOutText ?? LIBRARY_TEXT
  await mkdir(dirname(checkedOut), { recursive: true })
  await writeFile(checkedOut, checkedOutText)
  await mkdir(packedRoot, { recursive: true })
  if (options.packedText !== null) {
    await mkdir(dirname(packed), { recursive: true })
    await writeFile(packed, options.packedText ?? LIBRARY_TEXT)
  }
  const served = await serveFakeBundle(context, () =>
    options.map({ checkedOut, packed }),
  )
  const sealing = () =>
    sealReactScriptsLibraryStop(
      {
        appRoot: libraryRoot,
        packageRootRelative: LIBRARY_FOLDER,
        packageRelativePath: 'src/createStore.ts',
        source: {
          path: STOP_FILE,
          hash: sha256(checkedOutText),
          line: options.line ?? 2,
          column: 1,
        },
        citationEndLine: (options.line ?? 2) + 1,
        ownedOrigin: served.origin,
        signal: new AbortController().signal,
        cache: new ReactScriptsBundleCache(),
      },
      {
        packageName: 'lib',
        examplePackageRoot: 'examples/counter',
        packedRoot,
      },
    )
  return { sealing, checkedOut, packed }
}

/** Reads the thrown refusal of a seal whole. */
async function thrownOf(sealing: () => Promise<unknown>): Promise<StudyError> {
  const error = await sealing().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return error
}

// Value: protects=a library stop the served map names by the checked-out file with equal text is sealed and the sealed result names the checked-out file; fails_when=the library seal cannot find the checked-out entry or names the packed copy; no_claim=a real react-scripts compile
test('a library stop named by the checked-out file with equal text is sealed', async (context) => {
  // Arrange
  const { sealing, checkedOut } = await stageLibrarySeal(context, {
    map: ({ checkedOut: path }) => ({
      sources: [path],
      sourcesContent: [LIBRARY_TEXT],
    }),
  })
  // Act
  const { bundle } = await sealing()
  // Assert
  assert.equal(bundle.sourcePath, checkedOut)
  assert.equal(bundle.source, LIBRARY_TEXT)
})

// Value: protects=a library file edited after the build is refused as library-build-stale with the library vocabulary; fails_when=the checked-out file is not compared with its packed copy; no_claim=an edit made while the run is paused
test('a checked-out library file edited after the build is refused with library-build-stale', async (context) => {
  // Arrange
  const edited = `${LIBRARY_TEXT}// edited after the build\n`
  const { sealing } = await stageLibrarySeal(context, {
    checkedOutText: edited,
    map: ({ packed }) => ({
      sources: [packed],
      sourcesContent: [LIBRARY_TEXT],
    }),
  })
  // Act
  const error = await thrownOf(sealing)
  // Assert
  assert.equal(error.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.deepEqual(
    [
      error.details?.reason,
      error.details?.library,
      error.details?.file,
      error.details?.sideEffects,
    ],
    ['library-build-stale', 'lib', STOP_FILE, 'partial'],
  )
})

// Value: protects=a library file the bundle does not contain is refused as library-not-in-build; fails_when=the library seal falls back to outside-package; no_claim=lazy chunks served by other bundles
test('a library file neither path of which the map names is refused with library-not-in-build', async (context) => {
  // Arrange
  const { sealing } = await stageLibrarySeal(context, {
    map: () => ({
      sources: ['/somewhere/else/src/other.ts'],
      sourcesContent: [LIBRARY_TEXT],
    }),
  })
  // Act
  const error = await thrownOf(sealing)
  // Assert
  assert.equal(error.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.equal(error.details?.reason, 'library-not-in-build')
  assert.equal(error.details?.sideEffects, 'partial')
})

// Value: protects=an unrewritten packed entry without source text is refused as library-build-unmapped no-sources-content; fails_when=the missing text is read as SOURCE_CHANGED or as not in the build; no_claim=maps with partial text
test('an unrewritten packed entry without source text is refused with library-build-unmapped no-sources-content', async (context) => {
  // Arrange
  const { sealing } = await stageLibrarySeal(context, {
    map: ({ packed }) => ({ sources: [packed], sourcesContent: [null] }),
  })
  // Act
  const error = await thrownOf(sealing)
  // Assert
  assert.equal(error.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.deepEqual(
    [error.details?.reason, error.details?.cause],
    ['library-build-unmapped', 'no-sources-content'],
  )
})

// Value: protects=an unrewritten packed entry with other text is refused as library-build-unmapped content-differs, never SOURCE_CHANGED or not-in-build; fails_when=a library whose map text differs surfaces as SOURCE_CHANGED; no_claim=a rebuild during the run
test('an unrewritten packed entry with differing text is refused with library-build-unmapped content-differs', async (context) => {
  // Arrange
  const { sealing } = await stageLibrarySeal(context, {
    map: ({ packed }) => ({
      sources: [packed],
      sourcesContent: ['export const other = 1\n'],
    }),
  })
  // Act
  const error = await thrownOf(sealing)
  // Assert
  assert.equal(error.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.deepEqual(
    [error.details?.reason, error.details?.cause],
    ['library-build-unmapped', 'content-differs'],
  )
})

// Value: protects=a library stop on a line no mapping reaches keeps the shared unmapped-line refusal; fails_when=the library route swallows or rewords the line refusal; no_claim=other reading limits
test('a library stop on an unmapped line keeps the unmapped-line refusal', async (context) => {
  // Arrange
  const { sealing } = await stageLibrarySeal(context, {
    line: 5,
    map: ({ checkedOut }) => ({
      sources: [checkedOut],
      sourcesContent: [LIBRARY_TEXT],
    }),
  })
  // Act
  const error = await thrownOf(sealing)
  // Assert
  assert.equal(error.code, 'REACT_SCRIPTS_SEAL_FAILED')
  assert.equal(error.details?.reason, 'unmapped-line')
})

// Value: protects=a library whose packed copy lacks the stop file ends in library-not-in-build instead of a stale or crash; fails_when=the missing packed file throws an uncoded error; no_claim=packages that publish no src folder
test('a stop whose file the packed copy does not hold is refused with library-not-in-build', async (context) => {
  // Arrange
  const { sealing } = await stageLibrarySeal(context, {
    packedText: null,
    map: () => ({ sources: ['/somewhere/else/x.ts'], sourcesContent: ['x'] }),
  })
  // Act
  const error = await thrownOf(sealing)
  // Assert
  assert.equal(error.details?.reason, 'library-not-in-build')
})

// Value: protects=a library build change at a pause reaches the agent as RUNTIME_FAILED library-build-changed with the library fields after the text round trip; fails_when=the failure text loses the library identity or the code; no_claim=the run's own executed-bytes check
test('a library build change keeps its code, library and file through the failure text', () => {
  // Arrange
  const failure = reactScriptsLibraryBuildChangedFailure({
    packageRoot: 'examples/counter',
    library: 'lib',
    file: STOP_FILE,
  })
  // Act
  const text = reactScriptsLibraryFailureText(failure)
  const restored = refusalFailureOf(text ?? '')
  // Assert
  assert.ok(
    text?.startsWith(
      `RUNTIME_FAILED(${REACT_SCRIPTS_LIBRARY_BUILD_CHANGED_VARIANT}:`,
    ),
  )
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-changed',
    packageRoot: 'examples/counter',
    library: 'lib',
    file: STOP_FILE,
    sideEffects: 'partial',
  })
})
