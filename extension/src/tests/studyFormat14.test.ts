import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { API_ROUTE_STUDY_VERSION } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { describeApiRoutePauseMessage } from '../utils/describeApiRoutePauseMessage'
import { describeRenderRunMessage } from '../utils/describeRenderRunMessage'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import { pauseLabelOf } from '../utils/pauseLabelOf'
import { projectPauseNames } from '../utils/projectPauseNames'
import {
  isModuleEvaluationUpgrade,
  studyFormatOfEvidence,
} from '../utils/studyFormatOfConfiguration'
import { validateConfiguredStudyEvidence } from '../utils/validateConfiguredStudyEvidence'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'

type Observation = ConfiguredStudy['observations'][number]

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

/**
 * Builds a saved Next study with up to two server stops: an entry-render stop (`afterOperation: 0`, a module evaluation) and a route-handler or API-route stop after operation 2.
 * @param version - The format number to give the study.
 * @param kinds - Which pauses the study holds, in the order the run paused them.
 * @param packageRoot - The `packageRoot` of the configuration; `undefined` leaves the field out.
 * @param hasEntryStop - Whether the configuration also declares the entry-render stop.
 * @returns A study that validates by the format 8 rules plus the fields of formats 12 to 14.
 * @example routeStudy(14, ['module', 'api']).observations.length // => 2
 */
function routeStudy(
  version: number,
  kinds: readonly ('module' | 'route' | 'api')[],
  packageRoot?: string,
  hasEntryStop = kinds.includes('module'),
): ConfiguredStudy {
  const complete = createOperationsStudy('failed-at-3')
  const [, server] = createOperationsStudy().observations
  const base = complete.configuration
  if (base.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const [serverStop] = base.additionalStops ?? []
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
    ...(packageRoot === undefined ? {} : { packageRoot }),
  } as ConfiguredStudy['configuration']
  const pauses: Record<'module' | 'route' | 'api', Partial<Observation>> = {
    module: {
      execution: 'server-render',
      attribution: 'preparation',
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
      // The entry pause is before any input; the handler pause follows operation 2 (sent at 1500 ms).
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
        // Operation 1 is done, so the entry pause (when declared) was continued.
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
  } as ConfiguredStudy
}

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(routeStudy(14, ['api'])) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=R6 a Next study holding an API-route observation takes format 14 (also beside a route-handler pause, also in a package folder) and every other Next study keeps 8, 9, 12 or 13; fails_when=an API-route study stays format 8, 9, 12 or 13; no_claim=a live run
test('studyFormatOfEvidence gives 14 for an API-route observation and keeps 8, 9, 12 and 13 otherwise', () => {
  // Arrange
  const root = routeStudy(8, []).configuration
  const nested = routeStudy(9, [], 'apps/web').configuration
  // Act
  const formats = [
    studyFormatOfEvidence(root, [{ execution: 'api-route' }]),
    studyFormatOfEvidence(nested, [
      { execution: 'route-handler' },
      { execution: 'api-route' },
    ]),
    studyFormatOfEvidence(root, [{ execution: 'route-handler' }]),
    studyFormatOfEvidence(root, [{ scope: 'module' }]),
    studyFormatOfEvidence(nested, []),
  ]
  // Assert
  assert.deepEqual(formats, [14, 14, 13, 12, 9])
})

// Value: protects=DX-8 an API-route study saves as .study.v14.json beside its metadata, reopens with its apiRoute, moment and label, and is listed as v14; fails_when=the storage table lacks v14 or the schema drops apiRoute; no_claim=a live run
test('a study with an API-route pause is saved as .study.v14.json, reopens with its request, moment and label and is listed as v14', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-14-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = routeStudy(14, ['api'])
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  const [observation] = reopened.observations
  const names = projectPauseNames(
    [{ ...observation!, source: { line: 17 } }],
    [
      {
        participant: 'server',
        source: { path: 'src/pages/api/data.ts', line: 17 },
      },
    ],
  ).map((named) => named.name?.text)
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v14.json`,
    `${study.id}.study.v14.json`,
  ])
  assert.equal(reopened.version, 14)
  assert.equal(observation?.execution, 'api-route')
  assert.deepEqual(observation?.apiRoute, {
    method: 'GET',
    route: '/api/data',
    path: '/api/data',
  })
  assert.equal(observation?.elapsedMs, 1600)
  assert.deepEqual(listed, ['v14'])
  assert.deepEqual(names, [
    'After operation 2 · API route GET /api/data · src/pages/api/data.ts:17',
  ])
})

// Value: protects=OV-E3 a run saved at format 8, 9 or 12 moves to format 14 at the checkpoint that adds its first API-route pause instead of being refused as a changed format; fails_when=assertStudyCheckpoint allows no move to 14, so Save fails when the API-route pause arrives; no_claim=a live run
test('a run saved at format 8, 9 or 12 moves to format 14 at the checkpoint that holds its first API-route pause', async (context) => {
  // Arrange
  const cases = [
    { from: 8, earlierKinds: [], packageRoot: undefined, hasEntryStop: false },
    { from: 9, earlierKinds: [], packageRoot: 'apps/web', hasEntryStop: false },
    {
      from: 12,
      earlierKinds: ['module'],
      packageRoot: undefined,
      hasEntryStop: true,
    },
  ] as const
  const results: unknown[] = []
  for (const { from, earlierKinds, packageRoot, hasEntryStop } of cases) {
    const directory = await mkdtemp(join(tmpdir(), 'codebook-format-14-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const later = routeStudy(
      14,
      [...earlierKinds, 'api'],
      packageRoot,
      hasEntryStop,
    )
    const earlier = {
      ...routeStudy(from, earlierKinds, packageRoot, hasEntryStop),
      terminal: false,
    }
    const library = new LearningLibrary(directory, later.workspaceKey)
    // Act
    await library.saveStudy(earlier)
    const first = (await library.list()).map((entry) => entry.format)
    await library.saveStudy(later)
    const reopened = await library.readStudy(later.id)
    results.push([first, reopened.version, reopened.observations.length])
  }
  // Assert
  assert.deepEqual(results, [
    [['v8'], 14, 1],
    [['v9'], 14, 1],
    [['v12'], 14, 2],
  ])
})

// Value: protects=OV-E3 the checkpoint rule lets a Next study move up to format 14 from 8, 9, 12 and 13 and never back down or sideways; fails_when=isModuleEvaluationUpgrade refuses 13 to 14 or accepts 14 to 13; no_claim=a live run
test('a checkpoint may move from format 8, 9, 12 or 13 up to 14, never from 14 back to 13', () => {
  // Arrange
  const moves = [
    [8, 14],
    [9, 14],
    [12, 14],
    [13, 14],
    [14, 13],
    [10, 14],
  ] as const
  // Act
  const allowed = moves.map(([prior, next]) =>
    isModuleEvaluationUpgrade(prior, next),
  )
  // Assert
  assert.deepEqual(allowed, [true, true, true, true, false, false])
})

// Value: protects=E-5 formats 13, 12 and 8 keep opening, and format 14 keeps the module-evaluation fields; fails_when=format 13, 12 or 8 stops being readable, or format 14 refuses a module scope; no_claim=a live run
test('format 13, 12 and 8 studies still open, and a format 14 study holds a module pause too', () => {
  // Arrange
  const studies = [
    routeStudy(13, ['route']),
    routeStudy(12, ['module']),
    routeStudy(8, []),
    routeStudy(14, ['module', 'api']),
  ]
  // Act
  const results = studies.map(refusalOf)
  // Assert
  assert.deepEqual(results, ['accepted', 'accepted', 'accepted', 'accepted'])
})

// Value: protects=E-5 an API-route pause belongs to format 14 only, format 14 holds one, and the pause is attributed after an operation with its apiRoute; fails_when=format 13 accepts execution api-route or apiRoute, or format 14 is accepted without one, or an API pause reads as a page load; no_claim=the wording beyond its sentence
test('an API-route observation in format 13, an apiRoute on another pause, a format 14 study without one, an API pause at the page load and one without its request are refused', () => {
  // Arrange
  const inFormat13 = routeStudy(13, ['api'])
  const [api] = routeStudy(14, ['api']).observations
  const [route] = routeStudy(13, ['route']).observations
  const withoutApiPause = routeStudy(14, ['route'])
  const apiRouteOnHandler = {
    ...routeStudy(13, ['route']),
    observations: [{ ...route!, apiRoute: API_ROUTE }],
  }
  const atPageLoad = {
    ...routeStudy(14, ['api']),
    observations: [{ ...api!, attribution: 'entry-load' as const }],
  }
  const withoutRequest = {
    ...routeStudy(14, ['api']),
    observations: [{ ...api!, apiRoute: undefined }],
  }
  // Act
  const messages = [
    inFormat13,
    apiRouteOnHandler,
    withoutApiPause,
    atPageLoad,
    withoutRequest,
  ].map(refusalOf)
  // Assert
  assert.deepEqual(messages, [
    'Only a study of format 14 keeps an API-route observation.',
    'Only an API-route observation has an apiRoute.',
    'A study of format 14 holds an API-route observation.',
    'An API-route observation is attributed after an operation.',
    'An API-route observation needs an apiRoute and has no routeHandler or scope.',
  ])
})

// Value: protects=DX-8 Codebook 0.2.87 (readable up to 13) lists a .study.v14.json file as saved by a newer Codebook and keeps its sidecar out of the listing, never as a server render; fails_when=the file name rule stops recognising v14; no_claim=the 0.2.87 binary
test('Codebook 0.2.87 lists a .study.v14.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 13 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  const message = await loadModule<typeof NewerStudyFormatMessageModule>(
    resolve(__dirname, '../utils/newerStudyFormatMessage.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v14.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v14.json')
  // Assert
  assert.equal(API_ROUTE_STUDY_VERSION, 14)
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 14 })
  assert.equal(sidecar, undefined)
  assert.equal(
    message.newerStudyFormatMessage(14),
    'This study was saved in format 14 by a newer Codebook; this Codebook reads formats up to 13. Update the extension to open it. The study is kept as it is.',
  )
})

// Value: protects=DX-1 the replay and library name an API-route pause After operation k · API route METHOD route · path:line, never a route handler, server render or page load; fails_when=the label says Route handler, Server render or Page load, or drops the method or route; no_claim=where the label is drawn
test('an API-route pause is named After operation 1 · API route GET /api/data · src/pages/api/data.ts:17', () => {
  // Arrange
  const stops = [
    {
      participant: 'server',
      source: { path: 'src/pages/api/data.ts', line: 17 },
    },
  ]
  const pause = {
    execution: 'api-route',
    attribution: 'after-operation',
    operationIndex: 1,
    apiRoute: API_ROUTE,
    declaredIndex: 0,
    executionIndex: 0,
    source: { line: 17 },
  }
  // Act
  const names = projectPauseNames([pause], stops).map(
    (named) => named.name?.text,
  )
  // Assert
  assert.deepEqual(names, [
    'After operation 1 · API route GET /api/data · src/pages/api/data.ts:17',
  ])
})

// Value: protects=DX-1 the pause message names API route, request and operation in the fixed sentence, the run's render message appends the wait sentence, and the pause label keeps apiRoute; fails_when=the sentence changes, calls it a route handler, or pauseLabelOf drops apiRoute; no_claim=where the run calls the helper
test('the API-route pause message and label carry the API route, its request and the operation', () => {
  // Arrange
  const snapshot = {
    execution: 'api-route' as const,
    attribution: 'after-operation' as const,
    operationIndex: 1,
    apiRoute: API_ROUTE,
  }
  // Act
  const message = describeApiRoutePauseMessage(snapshot)
  const runMessage = describeRenderRunMessage({
    isEntryRenderPaused: false,
    apiRoute: { ...API_ROUTE, operationIndex: 1 },
  })
  const label = pauseLabelOf(snapshot)
  // Assert
  assert.equal(
    message,
    'Paused in the API route GET /api/data (request /api/data), observed after operation 1',
  )
  assert.equal(
    runMessage,
    "Paused in the API route GET /api/data (request /api/data), observed after operation 1. The page's request waits for the handler; continue to let it answer, or stop it with codebook_stop.",
  )
  assert.deepEqual(label, snapshot)
})

// Value: protects=format 7 stays the strict 0.2.72.0 shape: an apiRoute object alone is refused there like every execution field; fails_when=the format 7 check lists every format 8 field but apiRoute, so a forged format 7 study keeps it; no_claim=the writer, which never writes it outside format 14
test('a format 7 study whose observation carries only an apiRoute object is refused as keeping an execution field', () => {
  // Arrange
  const { firstExecutionObserved: _firstExecutionObserved, ...complete } =
    createOperationsStudy()
  const browserOnly = { ...complete.configuration, additionalStops: [] }
  const {
    execution: _execution,
    attribution: _attribution,
    operationIndex: _operationIndex,
    declaredIndex: _declaredIndex,
    executionIndex: _executionIndex,
    scope: _scope,
    routeHandler: _routeHandler,
    apiRoute: _apiRoute,
    ...plain
  } = complete.observations[0]!
  const forged: ConfiguredStudy = {
    ...complete,
    version: 7,
    configuration: browserOnly,
    configurationHash: sha256(JSON.stringify(browserOnly)),
    observations: [{ ...plain, apiRoute: API_ROUTE }],
  }
  // Act
  const acceptForged = (): void =>
    validateConfiguredStudyEvidence(forged, forged.workspaceKey)
  // Assert
  assert.throws(acceptForged, {
    message: 'Only a study of format 8 keeps execution fields.',
  })
})
