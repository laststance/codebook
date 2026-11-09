import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  NEXT_LIBRARY_MINIMUM_API,
  NEXT_LIBRARY_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
import {
  liveRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import {
  evidenceFormatOfStudy,
  isModuleEvaluationUpgrade,
  isOperationsStudyFormat,
  studyFormatOfConfiguration,
  studyFormatOfEvidence,
} from '../utils/studyFormatOfConfiguration'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Observation = ConfiguredStudy['observations'][number]

/** The facts of a library that was built, packed and completely observed. */
const COMPLETE_FACTS: LibraryRunFacts = {
  package: 'react-redux',
  packageRoot: '.',
  prepared: true,
  version: '9.3.1',
  revision: '8e54f5baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 3500,
  packMs: 900,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '9.3.0',
  observation: 'complete',
  loaded: true,
  loadCount: 1,
  publishedCopyLoaded: false,
  cleanup: 'removed',
}

const ROUTE_HANDLER = {
  method: 'POST',
  route: '/api/todos',
  path: '/api/todos',
}

const API_ROUTE = {
  method: 'GET',
  route: '/api/data',
  path: '/api/data',
}

/** The pause kinds a Next library study can hold. */
type PauseKind = 'module' | 'route' | 'api'

/**
 * Builds the saved study of a Next run with a nested `packageRoot` and server stops, resealed as the given format and holding the given pauses, with or without a `library` declaration.
 * @param version - The format number to give the study.
 * @param kinds - The pauses the study holds, in the order the run paused them.
 * @param options - `declaresLibrary` adds `library: { packageRoot: '.' }` to the configuration (default true); `library` gives the saved facts (default complete facts; pass `undefined` for none).
 * @returns A study that validates by the format 8 rules plus the fields of formats 12 to 14.
 * @example nextLibraryStudy(18, ['module']).version // => 18
 */
function nextLibraryStudy(
  version: number,
  kinds: readonly PauseKind[],
  options: { declaresLibrary?: boolean; library?: unknown } = {},
): ConfiguredStudy {
  const { declaresLibrary = true } = options
  const library = 'library' in options ? options.library : COMPLETE_FACTS
  const complete = createOperationsStudy('failed-at-3')
  const [, server] = createOperationsStudy().observations
  const base = complete.configuration
  if (base.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const [serverStop] = base.additionalStops ?? []
  const hasEntryStop = kinds.includes('module')
  const configuration = {
    ...base,
    participant: serverStop!.participant,
    source: serverStop!.source,
    book: { ...base.book, anchorIndex: serverStop!.anchorIndex },
    inspections: serverStop!.inspections,
    afterOperation: hasEntryStop ? 0 : 2,
    additionalStops: hasEntryStop
      ? [{ ...serverStop!, afterOperation: 2 }]
      : [],
    packageRoot: 'examples/publish-ci/rr-rsc-context',
    ...(declaresLibrary ? { library: { packageRoot: '.' } } : {}),
  } as ConfiguredStudy['configuration']
  const pauses: Record<PauseKind, Partial<Observation>> = {
    module: {
      execution: 'server-render',
      attribution: 'entry-load',
      scope: 'module',
      declaredIndex: 0,
    },
    route: {
      execution: 'route-handler',
      attribution: 'after-operation',
      operationIndex: 2,
      routeHandler: ROUTE_HANDLER,
      declaredIndex: hasEntryStop ? 1 : 0,
    },
    api: {
      execution: 'api-route',
      attribution: 'after-operation',
      operationIndex: 2,
      apiRoute: API_ROUTE,
      declaredIndex: hasEntryStop ? 1 : 0,
    },
  }
  const observations = kinds.map((kind, position) => {
    const generation = server!.pause.generation + position
    const id = `${server!.pause.sessionId}:${generation}`
    return {
      ...server!,
      id,
      snapshotUri: `codebook://${complete.instanceId}/runs/${complete.runId}/snapshots/${encodeURIComponent(id)}`,
      pause: { ...server!.pause, generation },
      // The entry pause is before any input; a handler pause follows operation 2 (sent at 1500 ms).
      elapsedMs: kind === 'module' ? 500 : 1600,
      ...pauses[kind],
      executionIndex: position,
    }
  }) as Observation[]
  const hasHandler = kinds.includes('route') || kinds.includes('api')
  const { continuedPause: _continued, ...receipt } = complete.operation!
  const operation = hasHandler
    ? {
        ...receipt,
        inputDispatched: true,
        ...(hasEntryStop ? { continuedPause: observations[0]!.pause } : {}),
      }
    : undefined
  return {
    ...complete,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    finalOutcome: 'not-demonstrated',
    operation,
    operations: complete.operations!.map(
      (
        { atMs: _atMs, ...record },
        position,
      ): NonNullable<ConfiguredStudy['operations']>[number] =>
        hasHandler && position < 2
          ? {
              ...record,
              atMs: position === 0 ? 1000 : 1500,
              state: position === 0 ? 'done' : 'paused',
              ack: 'yes',
              effect: 'dispatched',
            }
          : { ...record, state: 'not-run', ack: 'pending', effect: 'pending' },
    ),
    observations,
    captures: [],
    ...(library === undefined ? {} : { library }),
  } as ConfiguredStudy
}

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(nextLibraryStudy(18, ['module'])) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** A version 3 `next-dev-webpack` configuration with a nested packageRoot that declares a library, as plain JSON. */
function liveConfiguration(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(nextLibraryStudy(18, ['module']).configuration),
  )
}

// Value: protects=T1 API 1.36 lets a nested version 3 next-dev-webpack configuration declare library.packageRoot and keeps it, while the retained schema of formats 3 to 8 refuses it; fails_when=next-dev-webpack still refuses library as an unknown key, the field is stripped, or a retained schema accepts it; no_claim=that the library exists (the build checks) or that a root app is refused (the run does)
test('accepts library on a nested version 3 next-dev-webpack configuration', () => {
  // Arrange
  const configuration = liveConfiguration()
  // Act
  const parsed = liveRepositoryConfigSchema.parse(configuration)
  const retained = retainedRepositoryConfigSchema.safeParse(configuration)
  // Assert
  assert.deepEqual('library' in parsed ? parsed.library : undefined, {
    packageRoot: '.',
  })
  assert.equal(retained.success, false)
  assert.equal(NEXT_LIBRARY_MINIMUM_API, '1.36')
})

// Value: protects=T1 every shape that is not a version 3 next-dev-webpack, vite-dev or react-scripts-dev configuration still refuses library as an unknown key; fails_when=library is accepted under expo-web-dev or a version 1 configuration, or refused with another message; no_claim=the node-script profile, which has its own schema
test('refuses library as an unknown key on expo-web-dev and on version 1', () => {
  // Arrange
  const expoWeb = { ...liveConfiguration(), adapter: 'expo-web-dev' }
  const versionOne = {
    version: 1,
    adapter: 'next-dev-webpack',
    book: { bookId: 'a', revision: 1, nodeId: 'n', anchorIndex: 0 },
    source: { path: 'src/a.ts', hash: '0'.repeat(64), line: 1, column: 1 },
    action: {
      title: 'Click',
      selector: '#a',
      before: [{ kind: 'visible', selector: '#a' }],
      after: [{ kind: 'text', selector: '#b', equals: 'x' }],
    },
    inspections: [{ path: 'value', mode: 'value', required: true }],
    library: { packageRoot: '.' },
  }
  // Act
  const results = [expoWeb, versionOne].map((candidate) =>
    liveRepositoryConfigSchema.safeParse(candidate),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false],
  )
  for (const result of results)
    assert.match(result.error?.message ?? '', /Unrecognized key: \\"library\\"/)
})

// Value: protects=T2 a saved study configuration that declares library on next-dev-webpack validates only with a nested packageRoot (format 18); fails_when=a root Next configuration with library is retained; no_claim=the live refusal of a root app (library-needs-package-root)
test('the retained study configuration of a Next library run needs a nested packageRoot', () => {
  // Arrange
  const nested = liveConfiguration()
  const root = { ...nested, packageRoot: '.' }
  const { packageRoot: _dropped, ...absent } = nested
  // Act
  const results = [nested, root, absent].map(
    (candidate) => studyConfigurationSchema.safeParse(candidate).success,
  )
  // Assert
  assert.deepEqual(results, [true, false, false])
})

// Value: protects=T4 a next-dev-webpack run that declares library takes format 18 and every run without it (absent or explicit undefined, root or nested) keeps its format byte for byte; fails_when=a library run falls back to 9, a run without library moves to 18, or an undefined library counts as declared; no_claim=a live run
test('studyFormatOfConfiguration gives 18 for next-dev-webpack with library and keeps 8 and 9 without it', () => {
  // Arrange
  const withLibrary = nextLibraryStudy(18, ['module']).configuration
  const { library: _dropped, ...withoutLibrary } =
    withLibrary as typeof withLibrary & { library: unknown }
  const undeclared = {
    ...withoutLibrary,
    library: undefined,
  } as typeof withLibrary
  const { packageRoot: _root, ...rootServerStop } = withoutLibrary as Record<
    string,
    unknown
  >
  // Act
  const formats = [
    studyFormatOfConfiguration(withLibrary),
    studyFormatOfConfiguration(withoutLibrary),
    studyFormatOfConfiguration(undeclared),
    studyFormatOfConfiguration(rootServerStop as typeof withLibrary),
  ]
  // Assert
  assert.deepEqual(formats, [18, 9, 9, 8])
})

// Value: protects=T3 / A1 a format 18 study keeps format 18 whatever module-evaluation, preparation, route-handler or API-route pause it holds, while the same pauses move a run without library to 12, 13 and 14; fails_when=a library run is moved to 12 to 14 at its first module pause, or a run without library stops moving; no_claim=the checkpoint writer, which the save test covers
test('studyFormatOfEvidence keeps format 18 for every pause kind and still gives 12, 13 and 14 without library', () => {
  // Arrange
  const withLibrary = nextLibraryStudy(18, []).configuration
  const { library: _dropped, ...withoutLibrary } =
    withLibrary as typeof withLibrary & { library: unknown }
  const plain = withoutLibrary
  // Act
  const withLibraryFormats = [
    studyFormatOfEvidence(withLibrary, [{ scope: 'module' }]),
    studyFormatOfEvidence(withLibrary, [{ attribution: 'preparation' }]),
    studyFormatOfEvidence(withLibrary, [{ execution: 'route-handler' }]),
    studyFormatOfEvidence(withLibrary, [{ execution: 'api-route' }]),
  ]
  const plainFormats = [
    studyFormatOfEvidence(plain, [{ scope: 'module' }]),
    studyFormatOfEvidence(plain, [{ execution: 'route-handler' }]),
    studyFormatOfEvidence(plain, [{ execution: 'api-route' }]),
    studyFormatOfEvidence(plain, []),
  ]
  // Assert
  assert.deepEqual(withLibraryFormats, [18, 18, 18, 18])
  assert.deepEqual(plainFormats, [12, 13, 14, 9])
  assert.equal(isModuleEvaluationUpgrade(9, 18), false)
  assert.equal(isModuleEvaluationUpgrade(18, 12), false)
})

// Value: protects=T3 / A1 the acceptance stop of Cycle 0098 (a server stop in the Example's module evaluation) saves as .study.v18.json beside its metadata, reopens with its scope, attribution and library facts and is listed as v18; fails_when=format 18 refuses scope module, drops the library facts, or the storage table lacks v18; no_claim=a live run writes it
test('a format 18 study with a module-evaluation server stop is saved as .study.v18.json, reopens with its library facts and is listed as v18', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-18-'))
  context.after(() => removeTestFolder(directory))
  const study = nextLibraryStudy(18, ['module'])
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.equal(reopened.version, 18)
  assert.deepEqual(reopened.library, COMPLETE_FACTS)
  assert.deepEqual(
    reopened.observations.map((o) => [o.attribution, o.scope]),
    [['entry-load', 'module']],
  )
  assert.deepEqual(files, [
    `${study.id}.study.meta.v18.json`,
    `${study.id}.study.v18.json`,
  ])
  assert.deepEqual(listed, ['v18'])
})

// Value: protects=T3 a format 18 study keeps a preparation module pause, a route-handler pause and an API-route pause (alone and beside the module pause) with the fields of formats 12 to 14; fails_when=format 18 refuses any of those fields because it is not 12, 13 or 14; no_claim=a live run
test('a format 18 study keeps preparation, route-handler and API-route evidence', () => {
  // Arrange
  const preparation = nextLibraryStudy(18, ['module'])
  preparation.observations[0] = {
    ...preparation.observations[0]!,
    attribution: 'preparation',
  }
  const studies = [
    preparation,
    nextLibraryStudy(18, ['route']),
    nextLibraryStudy(18, ['api']),
    nextLibraryStudy(18, ['module', 'route']),
    nextLibraryStudy(18, ['module', 'api']),
  ]
  // Act
  const results = studies.map(refusalOf)
  // Assert
  assert.deepEqual(results, [
    'accepted',
    'accepted',
    'accepted',
    'accepted',
    'accepted',
  ])
})

// Value: protects=T3 a format 18 study follows the format 8 evidence rules for a server stop (derived from its configuration), so a module pause attributed after an operation is still refused; fails_when=format 18 skips the stop and attribution checks that format 12 runs; no_claim=the wording of the refusal beyond its sentence
test('a format 18 study still refuses a module pause attributed after an operation', () => {
  // Arrange
  const study = nextLibraryStudy(18, ['module'])
  study.observations[0] = {
    ...study.observations[0]!,
    operationIndex: 1,
  }
  // Act
  const refusal = refusalOf(study)
  // Assert
  assert.equal(
    refusal,
    'Configured observation operationIndex differs from its stop.',
  )
  assert.equal(evidenceFormatOfStudy(study), 8)
})

// Value: protects=T4 a configuration that declares library is no longer readable as format 9 or 12, and a configuration without library is no longer readable as 18, while the older formats still read their own; fails_when=format 9 or 12 accepts a library configuration, or format 18 accepts one without library; no_claim=formats 16 and 17, which their own tests cover
test('a study whose format and library declaration disagree is refused', () => {
  // Arrange
  const asNine = nextLibraryStudy(9, [], { library: undefined })
  const asTwelve = nextLibraryStudy(12, ['module'], { library: undefined })
  const asEighteenWithoutDeclaration = nextLibraryStudy(18, ['module'], {
    declaresLibrary: false,
  })
  const plainNine = nextLibraryStudy(9, [], {
    declaresLibrary: false,
    library: undefined,
  })
  const plainTwelve = nextLibraryStudy(12, ['module'], {
    declaresLibrary: false,
    library: undefined,
  })
  // Act
  const refused = [asNine, asTwelve, asEighteenWithoutDeclaration].map(
    (study) => refusalOf(study) !== 'accepted',
  )
  const plain = [plainNine, plainTwelve].map(refusalOf)
  // Assert
  assert.deepEqual(refused, [true, true, true])
  assert.deepEqual(plain, ['accepted', 'accepted'])
})

// Value: protects=T5 a format 18 study whose library facts break the state rules, name another library folder or are missing is unreadable, and facts on a format 9 study are refused; fails_when=any of these decodes; no_claim=the wording of the refusals
test('refuses a format 18 study whose library facts break the state rules or disagree with its format', () => {
  // Arrange
  const attempts = [
    nextLibraryStudy(18, ['module'], {
      library: { ...COMPLETE_FACTS, version: undefined },
    }),
    nextLibraryStudy(18, ['module'], {
      library: { ...COMPLETE_FACTS, loaded: undefined },
    }),
    nextLibraryStudy(18, ['module'], { library: undefined }),
    nextLibraryStudy(18, ['module'], {
      library: { ...COMPLETE_FACTS, packageRoot: 'packages/other' },
    }),
    nextLibraryStudy(9, [], { declaresLibrary: false }),
  ]
  const accepted = nextLibraryStudy(18, ['module'])
  // Act
  const results = attempts.map((study) => refusalOf(study) === 'accepted')
  // Assert
  assert.deepEqual(results, [false, false, false, false, false])
  assert.equal(refusalOf(accepted), 'accepted')
})

// Value: protects=T5 this Codebook stores format 18 as .study.v18.json in the table and reads it, and a format above the readable limit is refused as saved by a newer Codebook; fails_when=the v18 row changes or goes missing, or the readable limit is below 18; no_claim=a run's round trip
test('format 18 is a stored and readable format and a format above the readable limit is refused as saved by a newer Codebook', () => {
  // Arrange / Act
  const row = STUDY_STORAGE_FORMATS.find((format) => format.version === 18)
  // Assert
  assert.deepEqual(row, {
    version: 18,
    format: 'v18',
    archiveSuffix: '.study.v18.json',
    metadataSuffix: '.study.meta.v18.json',
  })
  assert.equal(NEXT_LIBRARY_STUDY_VERSION, 18)
  assert.equal(READABLE_STUDY_VERSION, 23)
  assert.equal(isOperationsStudyFormat(18), true)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 18 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 24 }),
    /saved in format 24 by a newer Codebook; this Codebook reads formats up to 23/,
  )
})

// Value: protects=T5 Codebook 0.2.99 (readable up to 17) lists a .study.v18.json file as saved by a newer Codebook and keeps its sidecar out of the listing; fails_when=the file name rule stops recognising v18; no_claim=the 0.2.99 binary
test('Codebook 0.2.99 lists a .study.v18.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 17 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v18.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v18.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 18 })
  assert.equal(sidecar, undefined)
})
