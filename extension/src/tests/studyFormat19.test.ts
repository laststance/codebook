import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ApiRequestFact, ConfiguredStudy } from '../configuredStudySchemas'
import {
  EXPO_WEB_API_SERVER_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertObservationFormatFields } from '../utils/assertObservationFormatFields'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { ApiRequestTracker } from '../utils/attributeApiRequest'
import { citationContext } from '../utils/citationContext'
import { configuredStops } from '../utils/configuredStops'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import {
  projectPauseNames,
  apiRequestSentenceOf,
} from '../utils/projectPauseNames'
import {
  evidenceFormatOfStudy,
  isOperationsStudyFormat,
  studyFormatOfConfiguration,
  studyFormatOfEvidence,
} from '../utils/studyFormatOfConfiguration'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Observation = ConfiguredStudy['observations'][number]

const API_SERVER = {
  packageRoot: 'apps/api',
  entry: 'src/server.ts',
  port: 4100,
}

/** The files of the shared operations study, moved into the app's and the API's folders. */
const MOVED_PATHS: Record<string, string> = {
  'src/theme.ts': 'apps/app/src/theme.ts',
  'src/mode.ts': 'apps/api/src/mode.ts',
}

const ATTRIBUTED: ApiRequestFact = {
  state: 'attributed',
  method: 'POST',
  path: '/api/orders',
  operation: 4,
  basis: 'time-window',
  sentence:
    "While the API paused here, the page's POST /api/orders, sent after operation 4, was the only request waiting for it.",
}

/**
 * Builds the saved study of an `expo-web-dev` run that declares `apiServer`: two browser stops in the app and one server stop in the API, all after operation 4 but the first, resealed as format 19.
 * @param options - `order: 'mixed'` makes the server stop pause last although it is declared second; `apiRequest` replaces the server observation's fact (`null` removes it); `version` reseals the study as another format.
 * @returns A study that validates by the format 8 evidence rules plus the `apiRequest` fact.
 * @example apiServerStudy().version // => 19
 */
function apiServerStudy(
  options: {
    order?: 'declared' | 'mixed'
    apiRequest?: ApiRequestFact | null
    version?: number
  } = {},
): ConfiguredStudy {
  const { order = 'declared', version = 19 } = options
  const apiRequest =
    options.apiRequest === undefined ? ATTRIBUTED : options.apiRequest
  const base = createOperationsStudy()
  if (base.configuration.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const moved = (path: string): string => MOVED_PATHS[path] ?? path
  const configuration = operationsRepositoryConfigSchema.parse({
    ...base.configuration,
    adapter: 'expo-web-dev',
    packageRoot: 'apps/app',
    apiServer: API_SERVER,
    source: {
      ...base.configuration.source,
      path: moved(base.configuration.source.path),
    },
    additionalStops: base.configuration.additionalStops?.map((stop) => ({
      ...stop,
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
  // The shared study pauses browser 0, server 1, browser 2; a mixed run pauses the server last.
  const [first, server, last] = base.observations
  const paused =
    order === 'mixed'
      ? [
          { ...first!, executionIndex: 0, elapsedMs: 2000 },
          { ...last!, executionIndex: 1, elapsedMs: 4000 },
          { ...server!, executionIndex: 2, elapsedMs: 6000 },
        ]
      : base.observations
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

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(apiServerStudy()) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=AC4 an expo-web-dev run that declares apiServer takes format 19, every run without it keeps format 15 and the other adapters keep their formats; fails_when=an apiServer run stays 15, a run without it moves to 19, or an undefined apiServer counts as declared; no_claim=a live run
test('studyFormatOfConfiguration gives 19 for expo-web-dev with apiServer and keeps 15 without it', () => {
  // Arrange
  const withApiServer = apiServerStudy().configuration
  const { apiServer: _dropped, ...withoutApiServer } =
    withApiServer as typeof withApiServer & { apiServer: unknown }
  const undeclared = {
    ...withoutApiServer,
    apiServer: undefined,
  } as typeof withApiServer
  const next = {
    ...withoutApiServer,
    adapter: 'next-dev-webpack',
  } as typeof withApiServer
  // Act
  const formats = [
    studyFormatOfConfiguration(withApiServer),
    studyFormatOfConfiguration(withoutApiServer),
    studyFormatOfConfiguration(undeclared),
    studyFormatOfConfiguration(next),
  ]
  // Assert
  assert.deepEqual(formats, [19, 15, 15, 9])
  assert.equal(studyFormatOfEvidence(withApiServer, [{}]), 19)
})

// Value: protects=AC4 a format 19 study whose server observation carries an attributed apiRequest decodes, and it follows the format 8 evidence rules; fails_when=format 19 is not a known format, or its evidence rules are not format 8's; no_claim=a live run writes it
test('a format 19 study with an attributed API request decodes by the format 8 rules', () => {
  // Arrange
  const study = apiServerStudy()
  // Act
  const refusal = refusalOf(study)
  // Assert
  assert.equal(refusal, 'accepted')
  assert.equal(evidenceFormatOfStudy(study), 8)
  assert.equal(isOperationsStudyFormat(19), true)
})

// Value: protects=E-5 AC4 a replay whose server stop paused after a browser stop declared later saves as .study.v19.json, is listed as v19 and reopens with execution, declaredIndex and executionIndex and its apiRequest kept; fails_when=format 19 drops the execution order fields or the apiRequest, or the storage table lacks v19; no_claim=the library list for other formats
test('a mixed browser and API replay saves as v19, lists as v19 and reopens with its execution order and request', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-19-'))
  context.after(() => removeTestFolder(directory))
  const study = apiServerStudy({ order: 'mixed' })
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.equal(reopened.version, 19)
  assert.deepEqual(
    reopened.observations.map((o) => [
      o.participant,
      o.execution,
      o.declaredIndex,
      o.executionIndex,
    ]),
    [
      ['browser', 'browser', 0, 0],
      ['browser', 'browser', 2, 1],
      ['server', 'server-action', 1, 2],
    ],
  )
  assert.deepEqual(reopened.observations[2]!.apiRequest, ATTRIBUTED)
  assert.deepEqual(files, [
    `${study.id}.study.meta.v19.json`,
    `${study.id}.study.v19.json`,
  ])
  assert.deepEqual(listed, ['v19'])
})

// Value: protects=AC4 an unattributed fact (none with count 0, several with count 2 or more) is kept and read back; fails_when=the unattributed shapes are refused or lose their count and sentence; no_claim=the wording of the sentences
test('a format 19 study keeps an unattributed apiRequest of none and several', () => {
  // Arrange
  const none: ApiRequestFact = {
    state: 'unattributed',
    reason: 'none',
    count: 0,
    sentence: 'Codebook observed no request from the page.',
  }
  const several: ApiRequestFact = {
    state: 'unattributed',
    reason: 'several',
    count: 3,
    sentence: '3 requests from the page were waiting.',
  }
  // Act
  const results = [none, several].map((apiRequest) =>
    refusalOf(apiServerStudy({ apiRequest })),
  )
  // Assert
  assert.deepEqual(results, ['accepted', 'accepted'])
})

// Value: protects=AC4 every broken apiRequest case is refused on read: missing on a server observation, present on a browser observation, a path with a query, an operation other than the stop's afterOperation, several with count 1, none with count 1; fails_when=any of them decodes; no_claim=the wording beyond the first refusal sentence
test('refuses a format 19 study whose apiRequest is missing, misplaced or inconsistent', () => {
  // Arrange
  const browserWithRequest = apiServerStudy()
  browserWithRequest.observations[0] = {
    ...browserWithRequest.observations[0]!,
    apiRequest: ATTRIBUTED,
  }
  const attempts: Array<[string, ConfiguredStudy]> = [
    ['missing', apiServerStudy({ apiRequest: null })],
    ['browser', browserWithRequest],
    [
      'query',
      apiServerStudy({
        apiRequest: {
          ...ATTRIBUTED,
          path: '/api/orders?id=7',
        } as ApiRequestFact,
      }),
    ],
    [
      'operation',
      apiServerStudy({
        apiRequest: { ...ATTRIBUTED, operation: 3 } as ApiRequestFact,
      }),
    ],
    [
      'several-one',
      apiServerStudy({
        apiRequest: {
          state: 'unattributed',
          reason: 'several',
          count: 1,
          sentence: 's',
        },
      }),
    ],
    [
      'none-one',
      apiServerStudy({
        apiRequest: {
          state: 'unattributed',
          reason: 'none',
          count: 1,
          sentence: 's',
        },
      }),
    ],
  ]
  // Act
  const results = attempts.map(([, study]) => refusalOf(study) === 'accepted')
  // Assert
  assert.deepEqual(results, [false, false, false, false, false, false])
  assert.equal(
    refusalOf(attempts[0]![1]),
    'A format 19 server observation needs an apiRequest.',
  )
  assert.equal(
    refusalOf(attempts[1]![1]),
    'A browser observation has no apiRequest.',
  )
  assert.equal(
    refusalOf(attempts[3]![1]),
    'Configured apiRequest operation differs from its stop.',
  )
})

// Value: protects=AC4 apiRequest in a format other than 19 is refused on read, and a format 19 study whose configuration declares no apiServer (or a format 15 study that declares one) is refused; fails_when=apiRequest decodes in format 8, or the format and the apiServer declaration may disagree; no_claim=the wording of the refusal
test('refuses apiRequest outside format 19 and a format that disagrees with the apiServer declaration', () => {
  // Arrange
  const nextStudy = createOperationsStudy()
  nextStudy.observations[1] = {
    ...nextStudy.observations[1]!,
    apiRequest: ATTRIBUTED,
  }
  const asFifteen = apiServerStudy({ version: 15 })
  const withoutDeclaration = apiServerStudy()
  const { apiServer: _dropped, ...rest } =
    withoutDeclaration.configuration as typeof withoutDeclaration.configuration & {
      apiServer: unknown
    }
  const configuration = operationsRepositoryConfigSchema.parse({
    ...rest,
    participant: 'browser',
    additionalStops: [],
  })
  const asNineteenWithout = {
    ...withoutDeclaration,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    observations: [withoutDeclaration.observations[0]!],
  } as ConfiguredStudy
  // Act
  const results = [nextStudy, asFifteen, asNineteenWithout].map(refusalOf)
  // Assert
  assert.equal(
    results[0],
    'Only a study of format 19 or 20 keeps an apiRequest.',
  )
  assert.equal(results[1], 'Configured archive and intent versions disagree.')
  assert.equal(results[2], 'Configured archive and intent versions disagree.')
})

// Value: protects=AC4 a format 19 server observation whose stop file lies outside apiServer.packageRoot is refused by the evidence check itself, not only by the configuration schema; fails_when=the folder check is dropped from the evidence rules; no_claim=the configuration schema's own refusal (apiServerConfig tests)
test('the evidence check refuses a format 19 server observation outside apiServer.packageRoot', () => {
  // Arrange
  const study = apiServerStudy()
  const configuration = {
    ...study.configuration,
    apiServer: { ...API_SERVER, packageRoot: 'services/other' },
  } as ConfiguredStudy['configuration']
  const { captures: _captures, ...subject } = study
  // Act / Assert
  assert.throws(
    () =>
      assertObservationFormatFields(
        { ...subject, configuration },
        configuredStops(configuration),
      ),
    /lies outside apiServer\.packageRoot/,
  )
})

// Value: protects=AC4 this Codebook reads format 19, stores it as .study.v19.json, refuses format 24 as saved by a newer Codebook, and Codebook 0.2.100 (readable up to 18) lists a .study.v19.json file as saved by a newer one; fails_when=the row is missing, the readable limit stays 18, or the file name rule stops recognising v19; no_claim=the 0.2.100 binary
test('format 19 is stored and readable, format 24 is saved by a newer Codebook, and a reader limited to 18 lists v19 as newer', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 18 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const row = STUDY_STORAGE_FORMATS.find((format) => format.version === 19)
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v19.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v19.json')
  // Assert
  assert.deepEqual(row, {
    version: 19,
    format: 'v19',
    archiveSuffix: '.study.v19.json',
    metadataSuffix: '.study.meta.v19.json',
  })
  assert.equal(EXPO_WEB_API_SERVER_STUDY_VERSION, 19)
  assert.equal(READABLE_STUDY_VERSION, 23)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 19 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 24 }),
    /saved in format 24 by a newer Codebook; this Codebook reads formats up to 23/,
  )
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 19 })
  assert.equal(sidecar, undefined)
})

// Value: protects=R2 F13 a format 19 study with a producer-capped long path is accepted; a count above the tracker limit and a path with a control character are refused on read; fails_when=the cap and the schema disagree, or count/path control characters decode; no_claim=the wording of the refusal
test('accepts the capped long path and refuses an oversized count or a control character in the path', () => {
  // Arrange
  const tracker = new ApiRequestTracker(4100)
  tracker.requestWillBeSent({
    requestId: 'long',
    timestamp: 100,
    wallTime: 1000,
    request: {
      method: 'POST',
      url: `http://localhost:4100/${'a'.repeat(2999)}`,
    },
  })
  const capped = tracker.attribute({
    windowStartWallMs: 999_000,
    cutoffWallMs: 1_010_000,
    operation: 4,
    title: 'Press',
    maskText: (text) => text,
  })
  const tooMany: ApiRequestFact = {
    state: 'unattributed',
    reason: 'several',
    count: 257,
    sentence: 's',
  }
  const control: ApiRequestFact = { ...ATTRIBUTED, path: '/api/\u0007x' }
  // Act
  const results = [capped, tooMany, control].map(
    (apiRequest) => refusalOf(apiServerStudy({ apiRequest })) === 'accepted',
  )
  // Assert
  assert.deepEqual(results, [true, false, false])
})

// Value: protects=C2 a fact produced from a custom method token with a dot saves and reopens in a format 19 study, and a method over the length bound is never written as an attributed fact; fails_when=the producer names a method the saved schema refuses, or the schema rejects a valid HTTP token; no_claim=the wording of the sentences
test('a custom-token or over-long API method produces a fact that saves and reopens', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-19-method-'))
  context.after(() => removeTestFolder(directory))
  const factOfMethod = (method: string): ApiRequestFact => {
    const tracker = new ApiRequestTracker(4100)
    tracker.requestWillBeSent({
      requestId: 'm',
      timestamp: 100,
      wallTime: 1000,
      request: { method, url: 'http://localhost:4100/api/x' },
    })
    return tracker.attribute({
      windowStartWallMs: 999_000,
      cutoffWallMs: 1_010_000,
      operation: 4,
      title: 'Press',
      maskText: (text) => text,
    })
  }
  const tokenFact = factOfMethod('m.search')
  const longFact = factOfMethod('a'.repeat(17))
  const study = apiServerStudy({ apiRequest: tokenFact, order: 'mixed' })
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  // Assert
  assert.equal(tokenFact.state === 'attributed' && tokenFact.method, 'M.SEARCH')
  assert.equal(reopened.version, 19)
  assert.deepEqual(reopened.observations[2]!.apiRequest, tokenFact)
  assert.equal(longFact.state, 'unattributed')
  assert.equal(refusalOf(apiServerStudy({ apiRequest: longFact })), 'accepted')
})

/** The label and sentence of the server observation of a study, as the replay builds them. */
function serverMoment(study: ConfiguredStudy) {
  const named = projectPauseNames(
    study.observations,
    configuredStops(study.configuration),
  ).find(({ observation }) => observation.participant === 'server')!
  return {
    label: named.name?.text,
    ...apiRequestSentenceOf(named.observation),
  }
}

// Value: protects=Outcome 3 AC6 a reopened replay names an attributed API server stop by its request and operation and shows the saved sentence, never calling it a Server action; fails_when=projectPauseNames ignores apiRequest or the sentence is not passed to the Observed moments; no_claim=how the view draws the sentence
test('a reopened format 19 stop is named After operation 4 · API handler POST /api/orders and carries its attribution sentence', () => {
  // Arrange
  const study = apiServerStudy()
  // Act
  const moment = serverMoment(study)
  // Assert
  assert.deepEqual(moment, {
    label:
      'After operation 4 · API handler POST /api/orders · apps/api/src/mode.ts:1',
    apiRequestSentence:
      "While the API paused here, the page's POST /api/orders, sent after operation 4, was the only request waiting for it.",
  })
})

// Value: protects=Outcome 4 a stop the run could not tie to exactly one request reads plain API handler with its reason sentence; fails_when=an unattributed stop is called a Server action or names a request; no_claim=the wording of the sentence
test('a reopened format 19 stop with no single request is named API handler and carries the reason sentence', () => {
  // Arrange
  const study = apiServerStudy({
    apiRequest: {
      state: 'unattributed',
      reason: 'several',
      count: 2,
      sentence: 'Two page requests were waiting, so Codebook named neither.',
    },
  })
  // Act
  const moment = serverMoment(study)
  // Assert
  assert.deepEqual(moment, {
    label: 'API handler · apps/api/src/mode.ts:1',
    apiRequestSentence:
      'Two page requests were waiting, so Codebook named neither.',
  })
})

// Value: protects=a study without apiRequest (format 15 Expo, or older) keeps its Server action name and shows no request sentence; fails_when=the API handler name or a sentence leaks to stops with no apiRequest; no_claim=a live run
test('a server stop without an apiRequest keeps the Server action name and has no request sentence', () => {
  // Arrange
  const study = apiServerStudy({ apiRequest: null, version: 15 })
  // Act
  const moment = serverMoment(study)
  // Assert
  assert.deepEqual(moment, {
    label: 'Server action · apps/api/src/mode.ts:1',
  })
})
