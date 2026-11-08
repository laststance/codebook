import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ApiRequestFact, ConfiguredStudy } from '../configuredStudySchemas'
import {
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
  VITE_API_SERVER_STUDY_VERSION,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import {
  operationsRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { ApiRequestTracker } from '../utils/attributeApiRequest'
import { citationContext } from '../utils/citationContext'
import { configuredStops } from '../utils/configuredStops'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import {
  apiRequestSentenceOf,
  projectPauseNames,
} from '../utils/projectPauseNames'
import {
  evidenceFormatOfStudy,
  isApiServerStudyFormat,
  isOperationsStudyFormat,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Observation = ConfiguredStudy['observations'][number]

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

const UNATTRIBUTED: ApiRequestFact = {
  state: 'unattributed',
  reason: 'none',
  count: 0,
  sentence: 'Codebook observed no request from the page under /api.',
  watched: { apiPort: 8787, devServerPort: 5173, proxyPaths: ['/api'] },
}

/**
 * Builds the saved study of a `vite-dev` run that declares `apiServer`: two browser stops in the app and one server stop in the API, resealed as the given format.
 * @param options - `apiRequest` replaces the server observation's fact (`null` removes it); `version` reseals the study as another format; `apiServer` replaces the declaration (`null` removes it).
 * @returns A study that validates by the format 8 evidence rules plus the format 20 `apiRequest` rules.
 * @example viteApiServerStudy().version // => 20
 */
function viteApiServerStudy(
  options: {
    apiRequest?: ApiRequestFact | null
    version?: number
    apiServer?: typeof API_SERVER | null
  } = {},
): ConfiguredStudy {
  const { version = 20 } = options
  const apiRequest =
    options.apiRequest === undefined ? PROXIED : options.apiRequest
  const apiServer =
    options.apiServer === undefined ? API_SERVER : options.apiServer
  const base = createOperationsStudy()
  if (base.configuration.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const moved = (path: string): string => MOVED_PATHS[path] ?? path
  // A configuration without apiServer cannot hold the server stop, so it skips the live schema: the case exists to show the reader refuses it.
  const parseConfiguration = (value: unknown) =>
    apiServer === null
      ? (value as ConfiguredStudy['configuration'])
      : operationsRepositoryConfigSchema.parse(value)
  const configuration = parseConfiguration({
    ...base.configuration,
    adapter: 'vite-dev',
    packageRoot: 'apps/app',
    ...(apiServer === null ? {} : { apiServer }),
    source: {
      ...base.configuration.source,
      path: moved(base.configuration.source.path),
    },
    additionalStops: base.configuration.additionalStops?.map((stop) => ({
      ...stop,
      // The API stop pauses during the request operation 3 sends.
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

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(viteApiServerStudy()) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=D38 a vite-dev run that declares apiServer takes format 20, a vite-dev run without it keeps its format, an undefined apiServer declares nothing and Expo keeps 19; fails_when=any run moves format; no_claim=a live run
test('a vite-dev run that declares apiServer takes format 20; one without keeps its format; Expo keeps 19', () => {
  // Arrange
  const withApiServer = viteApiServerStudy().configuration
  const { apiServer: _dropped, ...withoutApiServer } =
    withApiServer as typeof withApiServer & { apiServer: unknown }
  const undeclared = {
    ...withoutApiServer,
    apiServer: undefined,
  } as typeof withApiServer
  const flatApp = {
    ...withoutApiServer,
    packageRoot: '.',
  } as typeof withApiServer
  const expo = {
    ...withApiServer,
    adapter: 'expo-web-dev',
  } as typeof withApiServer
  // Act
  const formats = [
    studyFormatOfConfiguration(withApiServer),
    studyFormatOfConfiguration(withoutApiServer),
    studyFormatOfConfiguration(undeclared),
    studyFormatOfConfiguration(flatApp),
    studyFormatOfConfiguration(expo),
  ]
  // Assert
  assert.deepEqual(formats, [20, 10, 10, 8, 19])
  assert.equal(isApiServerStudyFormat(20), true)
  assert.equal(isApiServerStudyFormat(18), false)
})

// Value: protects=D38 AC4 a mixed browser and API replay saves as .study.v20.json, lists as v20 and reopens with execution order and apiRequest; fails_when=format 20 drops the execution order fields, the apiRequest or its route fields, or the storage table lacks v20; no_claim=a live run writes it
test('a mixed browser and API replay saves as .study.v20.json, lists as v20 and reopens with its execution order and request', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-20-'))
  context.after(() => removeTestFolder(directory))
  const study = viteApiServerStudy()
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.equal(reopened.version, 20)
  assert.equal(evidenceFormatOfStudy(reopened), 8)
  assert.equal(isOperationsStudyFormat(20), true)
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
  assert.deepEqual(reopened.observations[2]!.apiRequest, PROXIED)
  assert.deepEqual(files, [
    `${study.id}.study.meta.v20.json`,
    `${study.id}.study.v20.json`,
  ])
  assert.deepEqual(listed, ['v20'])
})

// Value: protects=AC4 Outcome 4 saved facts, not the live run, name the proxied request after a window reload; fails_when=the reopened stop is named Server action, the sentence is regenerated or lost, or route, proxyPath or watched is dropped by the schema or observationOfFormat; no_claim=a real editor window reload (the native check covers it)
test('a replay reopened after a window reload names a proxied API stop, shows its proxied sentence and keeps route, proxyPath and watched', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-20-reload-'))
  context.after(() => removeTestFolder(directory))
  const study = viteApiServerStudy()
  const firstWindow = new LearningLibrary(directory, study.workspaceKey)
  await firstWindow.saveStudy(study)
  const unattributedStudy = viteApiServerStudy({ apiRequest: UNATTRIBUTED })
  const secondDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-format-20-reload-none-'),
  )
  context.after(() => removeTestFolder(secondDirectory))
  await new LearningLibrary(secondDirectory, study.workspaceKey).saveStudy(
    unattributedStudy,
  )
  // Act
  // A new library object on the stored files is what a window reload does.
  const reopened = await new LearningLibrary(
    directory,
    study.workspaceKey,
  ).readStudy(study.id)
  const reopenedNone = await new LearningLibrary(
    secondDirectory,
    study.workspaceKey,
  ).readStudy(study.id)
  const moment = (saved: ConfiguredStudy) => {
    const named = projectPauseNames(
      saved.observations,
      configuredStops(saved.configuration),
    ).find(({ observation }) => observation.participant === 'server')!
    return {
      label: named.name?.text,
      ...apiRequestSentenceOf(named.observation),
      apiRequest: named.observation.apiRequest,
    }
  }
  // Assert
  assert.deepEqual(moment(reopened), {
    label:
      'After operation 3 · API handler GET /api/items · apps/api/src/mode.ts:1',
    apiRequestSentence:
      "While the API paused here, the page's GET /api/items, sent to the dev server after operation 3 under /api, was the only request waiting for it.",
    apiRequest: {
      state: 'attributed',
      method: 'GET',
      path: '/api/items',
      operation: 3,
      basis: 'time-window',
      sentence:
        "While the API paused here, the page's GET /api/items, sent to the dev server after operation 3 under /api, was the only request waiting for it.",
      route: 'dev-server-proxy',
      proxyPath: '/api',
    },
  })
  assert.deepEqual(moment(reopenedNone).apiRequest, {
    state: 'unattributed',
    reason: 'none',
    count: 0,
    sentence: 'Codebook observed no request from the page under /api.',
    watched: { apiPort: 8787, devServerPort: 5173, proxyPaths: ['/api'] },
  })
})

// Value: protects=D29 D48 format 20 refuses route fields that disagree with each other or with apiServer.proxyPaths; fails_when=a proxyPath outside the declaration, a missing route, a missing watched or a proxyPath on api-origin decodes; no_claim=the wording beyond the first refusal sentence
test('format 20 refuses route fields that disagree: proxyPath not a member of apiServer.proxyPaths, route missing, watched missing on unattributed, proxyPath on api-origin', () => {
  // Arrange
  const { route: _route, ...withoutRoute } = PROXIED as ApiRequestFact & {
    route: string
  }
  const { watched: _watched, ...withoutWatched } =
    UNATTRIBUTED as ApiRequestFact & { watched: unknown }
  const attempts: Array<[string, ConfiguredStudy]> = [
    [
      'foreign-prefix',
      viteApiServerStudy({
        apiRequest: { ...PROXIED, proxyPath: '/other' } as ApiRequestFact,
      }),
    ],
    ['no-route', viteApiServerStudy({ apiRequest: withoutRoute })],
    ['no-watched', viteApiServerStudy({ apiRequest: withoutWatched })],
    [
      'api-origin-with-prefix',
      viteApiServerStudy({
        apiRequest: { ...PROXIED, route: 'api-origin' } as ApiRequestFact,
      }),
    ],
    [
      'proxy-without-prefix',
      viteApiServerStudy({
        apiRequest: { ...PROXIED, proxyPath: undefined } as ApiRequestFact,
      }),
    ],
  ]
  // Act
  const refusals = attempts.map(([, study]) => refusalOf(study))
  // Assert
  assert.deepEqual(refusals, [
    'A format 20 apiRequest proxyPath is not one of apiServer.proxyPaths.',
    'A format 20 attributed apiRequest needs a route.',
    'A format 20 unattributed apiRequest needs watched.',
    'A format 20 apiRequest has a proxyPath exactly when its route is dev-server-proxy.',
    'A format 20 apiRequest has a proxyPath exactly when its route is dev-server-proxy.',
  ])
})

// Value: protects=CR-7 an unattributed fact whose watched names a devServerPort but no proxyPaths is not a saved shape; fails_when=such a watched decodes; no_claim=the wording outside the refinement sentence
test('format 20 refuses a watched with a devServerPort and an empty proxyPaths', () => {
  // Arrange
  const study = viteApiServerStudy({
    apiRequest: {
      ...UNATTRIBUTED,
      watched: { apiPort: 8787, devServerPort: 5173, proxyPaths: [] },
    } as ApiRequestFact,
  })
  // Act
  const refusal = refusalOf(study)
  // Assert
  assert.match(
    refusal,
    /devServerPort is kept only with a non-empty proxyPaths/,
  )
})

// Value: protects=OCR3-1 a stored proxyPath holds no control character; fails_when=a newline in a watched prefix decodes; no_claim=the wording
test('format 20 refuses a watched proxy prefix that holds a control character', () => {
  // Arrange
  const study = viteApiServerStudy({
    apiRequest: {
      ...UNATTRIBUTED,
      watched: { apiPort: 8787, devServerPort: 5173, proxyPaths: ['/api\n'] },
    } as ApiRequestFact,
  })
  // Act
  const refusal = refusalOf(study)
  // Assert
  assert.match(refusal, /Use a prefix without control characters/)
})

// Value: protects=D48 a prefix that equals a masked env value attributes, saves and reopens with the masked stored path; fails_when=format 20 demands the stored path continue the unmasked prefix; no_claim=the real masking of an environment value
test('a prefix equal to a masked env value attributes, saves and reopens with the masked path', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-20-mask-'))
  context.after(() => removeTestFolder(directory))
  const maskedPrefix = '/hidden-prefix'
  const tracker = new ApiRequestTracker(8787, { proxyPaths: [maskedPrefix] })
  tracker.bindDevServerPort(5173)
  tracker.requestWillBeSent({
    requestId: 'masked',
    timestamp: 100,
    wallTime: 1000,
    request: {
      method: 'GET',
      url: `http://localhost:5173${maskedPrefix}/items`,
    },
  })
  const fact = tracker.attribute({
    windowStartWallMs: 999_000,
    cutoffWallMs: 1_010_000,
    operation: 3,
    title: 'Press',
    maskText: (text) => text.replace('hidden-prefix', '[masked]'),
  })
  const study = viteApiServerStudy({
    apiRequest: fact,
    apiServer: { ...API_SERVER, proxyPaths: [maskedPrefix] },
  })
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  // Assert
  const saved = reopened.observations[2]!.apiRequest
  assert.equal(saved?.state === 'attributed' && saved.path, '/[masked]/items')
  assert.equal(
    saved?.state === 'attributed' && saved.proxyPath,
    '/hidden-prefix',
  )
})

// Value: protects=D29 route, proxyPath and watched are format 20 only; fails_when=a format 19 study keeps any of the three; no_claim=the Expo tracker's output
test('route, proxyPath and watched are refused in format 19', () => {
  // Arrange
  const expoStudy = (apiRequest: ApiRequestFact): ConfiguredStudy => {
    const study = viteApiServerStudy({ apiRequest, version: 19 })
    const { proxyPaths: _proxyPaths, ...expoApiServer } = API_SERVER
    const configuration = operationsRepositoryConfigSchema.parse({
      ...study.configuration,
      adapter: 'expo-web-dev',
      apiServer: expoApiServer,
    })
    return {
      ...study,
      configuration,
      configurationHash: sha256(JSON.stringify(configuration)),
    }
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
    refusalOf(expoStudy(PROXIED)),
    refusalOf(expoStudy(UNATTRIBUTED)),
  ]
  // Assert
  const refusal =
    'A format 19 apiRequest has no route, proxyPath or watched; only format 20 keeps them.'
  assert.deepEqual(results, ['accepted', refusal, refusal, refusal])
})

// Value: protects=D37 formats 7, 10, 16 and 19 refuse a Vite apiServer and format 20 refuses a configuration without apiServer; fails_when=an older retained format accepts the key or format 20 accepts none; no_claim=the wording of the refusal
test('formats 7, 10, 16 and 19 refuse a Vite apiServer; format 20 refuses a configuration without apiServer', () => {
  // Arrange
  const study = viteApiServerStudy()
  const withoutApiServer = viteApiServerStudy({
    apiServer: null,
    apiRequest: null,
  })
  const parsedAs = (version: number) =>
    refusalOf({ ...study, version } as ConfiguredStudy) === 'accepted'
  // Act
  const olderFormats = [7, 8, 10, 16, 19].map(parsedAs)
  const retained = studyConfigurationSchema.safeParse(
    study.configuration,
  ).success
  const atTwenty = refusalOf({ ...withoutApiServer, version: 20 })
  // Assert
  assert.deepEqual(olderFormats, [false, false, false, false, false])
  assert.equal(retained, true)
  assert.notEqual(atTwenty, 'accepted')
})

// Value: protects=D38 this Codebook reads format 20 second in the table (after format 21) and lists 22 as newer, and Codebook 0.2.101 (readable up to 19) lists a .study.v20.json file as saved by a newer Codebook; fails_when=the row is missing or not first, the readable limit stays 19, or the file name rule stops recognising v20; no_claim=the 0.2.101 binary
test('Codebook 0.2.101 lists a .study.v20.json archive as saved by a newer Codebook; this one reads 20 and lists 22 as newer', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 19 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const row = STUDY_STORAGE_FORMATS.find((format) => format.version === 20)
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v20.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v20.json')
  // Assert
  assert.deepEqual(row, {
    version: 20,
    format: 'v20',
    archiveSuffix: '.study.v20.json',
    metadataSuffix: '.study.meta.v20.json',
  })
  assert.equal(VITE_API_SERVER_STUDY_VERSION, 20)
  assert.equal(READABLE_STUDY_VERSION, 21)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 20 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 22 }),
    /saved in format 22 by a newer Codebook; this Codebook reads formats up to 21/,
  )
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 20 })
  assert.equal(sidecar, undefined)
})
