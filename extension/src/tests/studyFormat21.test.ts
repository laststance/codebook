import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ApiRequestFact, ConfiguredStudy } from '../configuredStudySchemas'
import {
  PRESS_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
import {
  operationsRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { citationContext } from '../utils/citationContext'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import { projectReplayOperations } from '../utils/projectReplayOperations'
import {
  evidenceFormatOfStudy,
  isOperationsStudyFormat,
  isReadableStudyFormatOfConfiguration,
  studyFormatOfConfiguration,
  studyRulesVersionOf,
} from '../utils/studyFormatOfConfiguration'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Observation = ConfiguredStudy['observations'][number]
type Configuration = ConfiguredStudy['configuration']

const API_SERVER = {
  packageRoot: 'apps/api',
  entry: 'src/server.ts',
  port: 8787,
  proxyPaths: ['/api'],
}

/** The files of the shared operations study, moved into the app's and the API's folders. */
const MOVED_PATHS: Record<string, string> = {
  'src/theme.ts': 'apps/app/src/theme.ts',
  'src/mode.ts': 'apps/api/src/mode.ts',
}

const PROXIED: ApiRequestFact = {
  state: 'attributed',
  method: 'GET',
  path: '/api/items',
  operation: 3,
  basis: 'time-window',
  sentence:
    "While the API paused here, the page's GET /api/items, sent to the dev server after operation 3 under /api, was the only request waiting for it.",
  route: 'dev-server-proxy',
  proxyPath: '/api',
}

const LIBRARY_FACTS: LibraryRunFacts = {
  package: '@acme/widgets',
  packageRoot: 'packages/widgets',
  prepared: true,
  version: '2.14.0',
  revision: '7114787aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 7000,
  packMs: 900,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '2.12.0',
  observation: 'complete',
  loaded: true,
  loadCount: 12,
  publishedCopyLoaded: false,
  cleanup: 'removed',
}

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(pressStudy()) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Reseals a study with another configuration. @example reseal(study, { ...study.configuration, afterOperation: 1 }) */
function reseal(
  study: ConfiguredStudy,
  configuration: Configuration,
): ConfiguredStudy {
  return {
    ...study,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
}

/**
 * Builds the saved study of a `vite-dev` run that declares `apiServer` and a press as operation 3: two browser stops in the app and one server stop in the API.
 * @param version - The format number to give the study; 21 by default, 20 for the same run with a click.
 * @param apiRequest - The fact of the server observation; `null` removes it.
 * @returns A study that validates by the format 8 evidence rules plus the `apiRequest` rules of format 20.
 * @example viteApiPressStudy().version // => 21
 */
function viteApiPressStudy(
  version: number = PRESS_STUDY_VERSION,
  apiRequest: ApiRequestFact | null = PROXIED,
): ConfiguredStudy {
  const base = createOperationsStudy('complete', {
    press: version === PRESS_STUDY_VERSION,
  })
  if (base.configuration.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const moved = (path: string): string => MOVED_PATHS[path] ?? path
  const configuration = operationsRepositoryConfigSchema.parse({
    ...base.configuration,
    adapter: 'vite-dev',
    packageRoot: 'apps/app',
    apiServer: API_SERVER,
    source: {
      ...base.configuration.source,
      path: moved(base.configuration.source.path),
    },
    additionalStops: base.configuration.additionalStops?.map((stop) => ({
      ...stop,
      ...(stop.participant === 'server' ? { afterOperation: 3 } : {}),
      source: { ...stop.source, path: moved(stop.source.path) },
    })),
  })
  const anchors = base.descriptor!.anchors.map((anchor) => ({
    ...anchor,
    path: moved(anchor.path),
  }))
  const descriptor = {
    ...base.descriptor!,
    anchors,
    citationContext: citationContext(anchors),
    sources: base.descriptor!.sources.map((source) => ({
      ...source,
      path: moved(source.path),
    })),
  }
  // The shared study pauses browser 0, server 1, browser 2; the server stop pauses last here although it is declared second.
  const [first, server, last] = base.observations
  const paused = [
    { ...first!, executionIndex: 0, elapsedMs: 2000 },
    { ...last!, executionIndex: 1, elapsedMs: 4000 },
    { ...server!, executionIndex: 2, elapsedMs: 6000 },
  ]
  const observations = paused.map((observation) => {
    // The replay's frames name the file the stop lies in, so they move with it.
    const movedObservation = {
      ...observation,
      debugger: observation.debugger && {
        ...observation.debugger,
        frames: observation.debugger.frames.map((frame) => ({
          ...frame,
          source: frame.source && {
            ...frame.source,
            name: moved(frame.source.name),
          },
        })),
      },
    }
    return observation.participant === 'server' && apiRequest !== null
      ? { ...movedObservation, apiRequest }
      : movedObservation
  }) as Observation[]
  return {
    ...base,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    descriptor,
    observations,
    operation: {
      ...base.operation!,
      continuedPause: observations.at(-1)!.pause,
    },
  } as ConfiguredStudy
}

/**
 * Builds a saved Next study with one server stop that holds a preparation module pause (`preparation`) or a route-handler pause (`route`), with or without a press.
 * @param kind - Which pause the study holds.
 * @param version - The format number to give the study.
 * @param press - Whether operation 3 is a press (otherwise a click).
 * @returns A study that validates by the format 8 rules plus the fields of formats 12 and 13.
 * @example nextStudy('route', 21, true).observations[0]?.execution // => 'route-handler'
 */
function nextStudy(
  kind: 'preparation' | 'route',
  version: number,
  press: boolean,
): ConfiguredStudy {
  const complete = createOperationsStudy('failed-at-3', { press })
  const [, server] = createOperationsStudy().observations
  const base = complete.configuration
  if (base.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const [serverStop] = base.additionalStops ?? []
  const isRoute = kind === 'route'
  const configuration = {
    ...base,
    participant: serverStop!.participant,
    source: serverStop!.source,
    book: { ...base.book, anchorIndex: serverStop!.anchorIndex },
    inspections: serverStop!.inspections,
    afterOperation: isRoute ? 2 : 0,
    additionalStops: [],
  } as Configuration
  const observation = {
    ...server!,
    elapsedMs: isRoute ? 1600 : 500,
    execution: isRoute ? 'route-handler' : 'server-render',
    attribution: isRoute ? 'after-operation' : 'preparation',
    ...(isRoute
      ? {
          operationIndex: 2,
          routeHandler: {
            method: 'POST',
            route: '/api/todos',
            path: '/api/todos',
          },
        }
      : { scope: 'module' }),
    declaredIndex: 0,
    executionIndex: 0,
  } as Observation
  const { continuedPause: _continued, ...receipt } = complete.operation!
  return {
    ...complete,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    finalOutcome: 'not-demonstrated',
    operation: isRoute ? { ...receipt, inputDispatched: true } : undefined,
    operations: complete.operations!.map(
      (
        { atMs: _atMs, ...record },
        position,
      ): NonNullable<ConfiguredStudy['operations']>[number] =>
        isRoute && position < 2
          ? {
              ...record,
              atMs: position === 0 ? 1000 : 1500,
              state: position === 0 ? 'done' : 'paused',
              ack: 'yes',
              effect: 'dispatched',
            }
          : { ...record, state: 'not-run', ack: 'pending', effect: 'pending' },
    ),
    observations: [observation],
    captures: isRoute
      ? []
      : [
          {
            phase: 'paused-server',
            snapshotId: observation.id,
            status: 'absent',
            reason: 'The application was not yet available.',
          },
        ],
  } as ConfiguredStudy
}

// Value: protects=D33 a run that declares a press takes format 21 whatever else it declares, and every base shape keeps its format without the press; fails_when=a base shape moves format without a press, or a press leaves a shape at its own format; no_claim=a live run
test('a run that declares a press takes format 21 for every base shape; without the press each keeps its own format', () => {
  // Arrange
  const base = createOperationsStudy().configuration as Configuration & {
    version: 3
  }
  const browserOnly = { ...base, additionalStops: [] }
  const shapes: Array<[string, Record<string, unknown>]> = [
    ['7', browserOnly],
    ['8', base],
    ['9', { ...base, packageRoot: 'apps/web' }],
    ['10', { ...base, adapter: 'vite-dev', packageRoot: 'apps/web' }],
    ['11', { ...base, adapter: 'react-scripts-dev' }],
    ['15', { ...base, adapter: 'expo-web-dev' }],
    [
      '16',
      { ...base, adapter: 'vite-dev', library: { packageRoot: 'packages/x' } },
    ],
    [
      '17',
      {
        ...base,
        adapter: 'react-scripts-dev',
        library: { packageRoot: 'packages/x' },
      },
    ],
    [
      '18',
      {
        ...base,
        packageRoot: 'apps/web',
        library: { packageRoot: 'packages/x' },
      },
    ],
    ['19', { ...base, adapter: 'expo-web-dev', apiServer: API_SERVER }],
    ['20', { ...base, adapter: 'vite-dev', apiServer: API_SERVER }],
  ]
  const pressOperation = {
    kind: 'press',
    title: 'Open palette',
    key: 'Control+k',
    after: [{ kind: 'visible', selector: '#palette' }],
  }
  const withPress = (shape: Record<string, unknown>): Configuration =>
    ({
      ...shape,
      operations: [
        ...(base.operations ?? []).slice(0, 2),
        pressOperation,
        ...(base.operations ?? []).slice(3),
      ],
    }) as Configuration
  // Act
  const withoutPress = shapes.map(([, shape]) =>
    studyFormatOfConfiguration(shape as Configuration),
  )
  const withPressFormats = shapes.map(([, shape]) =>
    studyFormatOfConfiguration(withPress(shape)),
  )
  // Assert
  assert.deepEqual(withoutPress, [7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20])
  assert.deepEqual(
    withPressFormats,
    shapes.map(() => 21),
  )
})

// Value: protects=D44 AC4 a replay with a press saves as .study.v21.json, is listed as v21 with its outcome, a lost sidecar is repaired by reconcile and a v22 file is listed as newer; fails_when=keepsCheckpoint or the catalog type omits v21, or the storage table lacks v21; no_claim=disk errors
test('a replay with a press saves as .study.v21.json, lists as v21, repairs a lost sidecar and lists v22 as saved by a newer Codebook', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-21-'))
  context.after(() => removeTestFolder(directory))
  const study = createOperationsStudy('complete', { press: true })
  const library = new LearningLibrary(directory, study.workspaceKey)
  const newerId =
    '00000000-0000-4000-8000-000000000000_11111111-1111-4111-8111-111111111111'
  // Act
  await library.saveStudy(study)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => [
    entry.format,
    entry.metadata,
    entry.outcome,
  ])
  await rm(join(directory, `${study.id}.study.meta.v21.json`))
  await library.reconcile()
  const repaired = await library.readCheckpoint(study.id)
  await writeFile(
    join(directory, `${newerId}.study.v22.json`),
    '{"version":22}',
  )
  const withNewer = (await library.list()).map((entry) => entry.format).sort()
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v21.json`,
    `${study.id}.study.v21.json`,
  ])
  assert.deepEqual(listed, [['v21', 'validated', 'demonstrated']])
  assert.equal(repaired.status, 'saved')
  assert.deepEqual(withNewer, ['newer', 'v21'])
  assert.deepEqual(
    STUDY_STORAGE_FORMATS.find((format) => format.version === 21),
    {
      version: 21,
      format: 'v21',
      archiveSuffix: '.study.v21.json',
      metadataSuffix: '.study.meta.v21.json',
    },
  )
})

// Value: protects=AC4 Outcome 4 the saved press, not the live run, names the operation in the replay after a window reload; fails_when=the reopened study drops the press, its canonical key or its title, or the replay row loses the press kind; no_claim=a real editor window reload (the native check covers it)
test('a replay reopened after a window reload names the press operation and keeps its canonical key', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-21-reload-'))
  context.after(() => removeTestFolder(directory))
  const study = createOperationsStudy('complete', { press: true })
  await new LearningLibrary(directory, study.workspaceKey).saveStudy(study)
  // Act
  // A new library object on the stored files is what a window reload does.
  const reopened = await new LearningLibrary(
    directory,
    study.workspaceKey,
  ).readStudy(study.id)
  const context21 = validateRecordingContext(
    buildRecordingContext(reopened, [], 1),
    study.workspaceKey,
  )
  const marks = projectReplayOperations(context21, {
    startMs: 0,
    endMs: 7000,
  })
  // Assert
  assert.equal(reopened.version, 21)
  const savedPress =
    reopened.configuration.version === 3
      ? reopened.configuration.operations?.[2]
      : undefined
  assert.deepEqual(
    savedPress && 'key' in savedPress ? [savedPress.kind, savedPress.key] : [],
    ['press', 'Control+k'],
  )
  assert.deepEqual(
    marks.map((mark) => [mark.index, mark.kind, mark.title, mark.state]),
    [
      [1, 'choose', 'Customer', 'done'],
      [2, 'text', 'Amount', 'done'],
      [3, 'press', 'Open palette', 'done'],
      [4, 'click', 'Create Invoice', 'done'],
    ],
  )
})

// Value: protects=D33 a format 21 study keeps the apiRequest rules of the Vite apiServer run it would otherwise be; fails_when=format 21 reads its own number for the 19 and 20 rules, so a missing or misplaced apiRequest decodes or a correct one is refused; no_claim=the Expo tracker's output
test('format 21 keeps the apiRequest rules of the Vite apiServer run: a proxied fact decodes, a missing one is refused', () => {
  // Arrange
  const complete = viteApiPressStudy()
  const missing = viteApiPressStudy(PRESS_STUDY_VERSION, null)
  // Act
  const results = [refusalOf(complete), refusalOf(missing)]
  // Assert
  assert.equal(studyRulesVersionOf(complete), 20)
  assert.equal(evidenceFormatOfStudy(complete), 8)
  assert.equal(results[0], 'accepted')
  assert.notEqual(results[1], 'accepted')
})

// Value: protects=D33 a format 21 Expo apiServer run keeps the format 19 rule that route fields are not kept; fails_when=format 21 applies the Vite format 20 field rules to an Expo run; no_claim=the Expo tracker's output
test('format 21 keeps the Expo apiServer rules: a plain fact decodes and a route field is refused', () => {
  // Arrange
  const expoStudy = (apiRequest: ApiRequestFact): ConfiguredStudy => {
    const study = viteApiPressStudy(PRESS_STUDY_VERSION, apiRequest)
    const { proxyPaths: _proxyPaths, ...expoApiServer } = API_SERVER
    return reseal(
      study,
      operationsRepositoryConfigSchema.parse({
        ...study.configuration,
        adapter: 'expo-web-dev',
        apiServer: expoApiServer,
      }),
    )
  }
  const plain: ApiRequestFact = {
    state: 'attributed',
    method: 'GET',
    path: '/api/items',
    operation: 3,
    basis: 'time-window',
    sentence: 'The only request waiting.',
  }
  // Act
  const results = [
    refusalOf(expoStudy(plain)),
    refusalOf(expoStudy({ ...plain, route: 'api-origin' })),
  ]
  // Assert
  assert.equal(results[0], 'accepted')
  assert.equal(
    results[1],
    'A format 19 apiRequest has no route, proxyPath or watched; only format 20 keeps them.',
  )
})

// Value: protects=D33 a format 21 study keeps the library facts exactly when the run declares a library; fails_when=format 21 refuses facts it must keep, accepts none, or accepts facts of a run without a library; no_claim=the run that writes the facts
test('format 21 keeps the library facts of a declared library and refuses them without one', () => {
  // Arrange
  // The run stopped at the press, so only the first browser stop was reached and no server stop is declared.
  const base = createOperationsStudy('failed-at-3', { press: true })
  if (base.configuration.version !== 3) throw new Error('version 3 needed')
  // Browser-only stops follow the format 7 rules, which keep no execution fields.
  const browserOnly: ConfiguredStudy = {
    ...base,
    observations: base.observations.map(
      ({
        execution: _execution,
        declaredIndex: _declaredIndex,
        executionIndex: _executionIndex,
        ...observation
      }) => observation,
    ),
    firstExecutionObserved: undefined,
  }
  const declared = reseal(browserOnly, {
    ...base.configuration,
    adapter: 'vite-dev',
    packageRoot: 'examples/widgets-vite',
    library: { packageRoot: 'packages/widgets' },
    additionalStops: [],
  })
  const undeclared = reseal(browserOnly, {
    ...base.configuration,
    additionalStops: [],
  })
  // Act
  const results = [
    refusalOf({ ...declared, library: LIBRARY_FACTS }),
    refusalOf(declared),
    refusalOf({ ...undeclared, library: LIBRARY_FACTS }),
  ]
  // Assert
  assert.deepEqual(results, [
    'accepted',
    'Configured library facts and study format disagree.',
    'Configured library facts and study format disagree.',
  ])
})

// Value: protects=D33 F5 a format 21 Next study keeps a route-handler observation and a preparation observation with its deliberately absent image; fails_when=format 21 rejects the fields of formats 12 and 13 or the absent preparation image; no_claim=a live Next server
test('format 21 keeps a Next route-handler observation and a preparation observation with its absent image', () => {
  // Arrange
  const route = nextStudy('route', 21, true)
  const preparation = nextStudy('preparation', 21, true)
  const demonstratedPreparation = {
    ...preparation,
    finalOutcome: 'not-demonstrated' as const,
  }
  // Act
  const results = [
    refusalOf(route),
    refusalOf(demonstratedPreparation),
    // The same shapes without a press keep their own formats 13 and 12.
    refusalOf(nextStudy('route', 13, false)),
    refusalOf(nextStudy('preparation', 12, false)),
  ]
  // Assert
  assert.deepEqual(results, ['accepted', 'accepted', 'accepted', 'accepted'])
  assert.equal(
    preparation.captures[0]?.status === 'absent' &&
      preparation.captures[0].snapshotId,
    preparation.observations[0]!.id,
  )
})

// Value: protects=D33 D34 a press is held by format 21 only: every older format refuses a press configuration, format 21 refuses a configuration without one and a non-canonical key; fails_when=an older format accepts a press, format 21 accepts none, or a key spelled Meta+Shift+p is stored; no_claim=the wording of the refusal beyond the version sentence
test('only format 21 holds a press: older formats, a format 21 study without one and a non-canonical key are refused', () => {
  // Arrange
  const study = createOperationsStudy('complete', { press: true })
  const withClick = createOperationsStudy()
  const configuration = study.configuration
  if (configuration.version !== 3) throw new Error('version 3 needed')
  const nonCanonical = reseal(study, {
    ...configuration,
    operations: configuration.operations?.map((operation) =>
      operation.kind === 'press'
        ? { ...operation, key: 'Meta+Shift+p' }
        : operation,
    ),
  })
  // Act
  const olderFormats = [7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20].map(
    (version) => refusalOf({ ...study, version } as ConfiguredStudy),
  )
  const refusals = [
    refusalOf(study),
    refusalOf({ ...withClick, version: 21 }),
    refusalOf(nonCanonical),
  ]
  // Assert
  assert.equal(
    olderFormats.every((refusal) => refusal !== 'accepted'),
    true,
  )
  assert.equal(refusals[0], 'accepted')
  assert.equal(refusals[1], 'Configured archive and intent versions disagree.')
  assert.notEqual(refusals[2], 'accepted')
  assert.equal(
    studyConfigurationSchema.safeParse(nonCanonical.configuration).success,
    false,
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(21, withClick.configuration),
    false,
  )
})

// Value: protects=D38 Codebook 0.2.102 (readable up to 20) lists .study.v21.json as saved by a newer Codebook, this one reads 21 and refuses 22; fails_when=the file name rule stops recognising v21, the readable limit stays 20, or format 21 is not an operations format; no_claim=the 0.2.102 binary
test('Codebook 0.2.102 lists a .study.v21.json archive and its sidecar as saved by a newer Codebook; this one reads 21', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 20 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v21.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v21.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 21 })
  assert.equal(sidecar, undefined)
  assert.equal(READABLE_STUDY_VERSION, 21)
  assert.equal(isOperationsStudyFormat(21), true)
  assert.equal(isOperationsStudyFormat(22), false)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 21 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 22 }),
    /saved in format 22 by a newer Codebook; this Codebook reads formats up to 21/,
  )
})
