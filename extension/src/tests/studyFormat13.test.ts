import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { ROUTE_HANDLER_STUDY_VERSION } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { describeRouteHandlerPauseMessage } from '../utils/describeRouteHandlerPauseMessage'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import { pauseLabelOf } from '../utils/pauseLabelOf'
import { projectPauseNames } from '../utils/projectPauseNames'
import { studyFormatOfEvidence } from '../utils/studyFormatOfConfiguration'
import { validateConfiguredStudyEvidence } from '../utils/validateConfiguredStudyEvidence'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Observation = ConfiguredStudy['observations'][number]

const ROUTE_HANDLER = {
  method: 'POST',
  route: '/api/todos',
  path: '/api/todos',
}

/**
 * Builds a saved Next study with two server stops: an entry-render stop (`afterOperation: 0`, a module evaluation) and a route-handler stop after operation 2.
 * @param version - The format number to give the study.
 * @param kinds - Which pauses the study holds, in the order the run paused them.
 * @param packageRoot - The `packageRoot` of the configuration; `undefined` leaves the field out.
 * @returns A study that validates by the format 8 rules plus the fields of formats 12 and 13.
 * @example routeStudy(13, ['module', 'route']).observations.length // => 2
 */
function routeStudy(
  version: number,
  kinds: readonly ('module' | 'route')[],
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
  const pauses: Record<'module' | 'route', Partial<Observation>> = {
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
  }
  const observations = kinds.map((kind, position) => {
    const generation = server!.pause.generation + position
    const id = `${server!.pause.sessionId}:${generation}`
    return {
      ...server!,
      id,
      snapshotUri: `codebook://${complete.instanceId}/runs/${complete.runId}/snapshots/${encodeURIComponent(id)}`,
      pause: { ...server!.pause, generation },
      // The entry pause is before any input; the route handler pause follows operation 2 (sent at 1500 ms).
      elapsedMs: kind === 'module' ? 500 : 1600,
      ...pauses[kind],
      executionIndex: position,
    }
  }) as Observation[]
  const hasRoute = kinds.includes('route')
  const { continuedPause: _continued, ...receipt } = complete.operation!
  const operation = hasRoute
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
        kinds.includes('route') && position < 2
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

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(routeStudy(13, ['route'])) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=R6 a Next study holding a route-handler observation takes format 13 (also with a module pause, also in a package folder) and every other Next study keeps 8, 9 or 12; fails_when=a route-handler study stays format 8, 9 or 12; no_claim=a live run
test('studyFormatOfEvidence gives 13 for a route-handler observation and keeps 8, 9 and 12 otherwise', () => {
  // Arrange
  const root = routeStudy(8, []).configuration
  const nested = routeStudy(9, [], 'apps/web').configuration
  // Act
  const formats = [
    studyFormatOfEvidence(root, [{ execution: 'route-handler' }]),
    studyFormatOfEvidence(nested, [
      { scope: 'module' },
      { execution: 'route-handler' },
    ]),
    studyFormatOfEvidence(root, [{ scope: 'module' }]),
    studyFormatOfEvidence(root, [{ execution: 'server-render' }]),
    studyFormatOfEvidence(nested, []),
  ]
  // Assert
  assert.deepEqual(formats, [13, 13, 12, 8, 9])
})

// Value: protects=R6 a route-handler study saves as .study.v13.json beside its metadata, reopens with its routeHandler and is listed as v13; fails_when=the storage table lacks v13 or the schema drops routeHandler; no_claim=a live run
test('a study with a route-handler pause is saved as .study.v13.json, reopens with its request and is listed as v13', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-13-'))
  context.after(() => removeTestFolder(directory))
  const study = routeStudy(13, ['route'])
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v13.json`,
    `${study.id}.study.v13.json`,
  ])
  assert.equal(reopened.version, 13)
  assert.deepEqual(reopened.observations[0]?.routeHandler, {
    method: 'POST',
    route: '/api/todos',
    path: '/api/todos',
  })
  assert.equal(reopened.observations[0]?.execution, 'route-handler')
  assert.deepEqual(listed, ['v13'])
})

// Value: protects=OV-E3 a run saved at format 8, 9 or 12 moves to format 13 at the checkpoint that adds its first route-handler pause instead of being refused as a changed format; fails_when=assertStudyCheckpoint allows only 8/9 to 12, so Save fails when the route-handler pause arrives; no_claim=a live run
test('a run saved at format 8, 9 or 12 moves to format 13 at the checkpoint that holds its first route-handler pause', async (context) => {
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
    const directory = await mkdtemp(join(tmpdir(), 'codebook-format-13-'))
    context.after(() => removeTestFolder(directory))
    const later = routeStudy(
      13,
      [...earlierKinds, 'route'],
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
    [['v8'], 13, 1],
    [['v9'], 13, 1],
    [['v12'], 13, 2],
  ])
})

// Value: protects=OV-E3 a format 13 study that also holds a format 12 module-evaluation pause validates; format 12 and format 8 studies still open; fails_when=format 13 refuses the module scope, or format 12 is no longer readable; no_claim=a live run
test('a format 13 study holding a module-evaluation pause opens, and format 12 and 8 studies still open', () => {
  // Arrange
  const studies = [
    routeStudy(13, ['module', 'route']),
    routeStudy(12, ['module']),
    routeStudy(8, []),
  ]
  // Act
  const results = studies.map(refusalOf)
  // Assert
  assert.deepEqual(results, ['accepted', 'accepted', 'accepted'])
})

// Value: protects=R6 a route-handler pause belongs to format 13 only, format 13 holds one, and the pause is attributed after an operation with its request; fails_when=an older format accepts execution route-handler, or format 13 is accepted without it, or a handler pause reads as a page load; no_claim=the wording beyond its sentence
test('a route-handler observation outside format 13, a format 13 study without one, and a handler pause at the page load are refused', () => {
  // Arrange
  const inFormat12 = routeStudy(12, ['module', 'route'])
  const withoutHandler = routeStudy(13, ['module'])
  const [route] = routeStudy(13, ['route']).observations
  const atPageLoad = {
    ...routeStudy(13, ['route']),
    observations: [{ ...route!, attribution: 'entry-load' as const }],
  }
  const withoutRequest = {
    ...routeStudy(13, ['route']),
    observations: [{ ...route!, routeHandler: undefined }],
  }
  const onRender = {
    ...routeStudy(12, ['module']),
    observations: [
      {
        ...routeStudy(12, ['module']).observations[0]!,
        routeHandler: ROUTE_HANDLER,
      },
    ],
  }
  // Act
  const messages = [
    inFormat12,
    withoutHandler,
    atPageLoad,
    withoutRequest,
    onRender,
  ].map(refusalOf)
  // Assert
  assert.deepEqual(messages, [
    'Only a study of format 13 keeps a route-handler observation.',
    'A study of format 13 holds a route-handler observation.',
    'A route-handler observation is attributed after an operation.',
    'A route-handler observation needs a routeHandler and has no scope.',
    'Only a route-handler observation has a routeHandler.',
  ])
})

// Value: protects=DX-9 Codebook 0.2.86 (readable up to 12) lists a .study.v13.json file as saved by a newer Codebook and keeps its sidecar out of the listing, never as a server render; fails_when=the file name rule stops recognising v13; no_claim=the 0.2.86 binary
test('Codebook 0.2.86 lists a .study.v13.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 12 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  const message = await loadModule<typeof NewerStudyFormatMessageModule>(
    resolve(__dirname, '../utils/newerStudyFormatMessage.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v13.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v13.json')
  // Assert
  assert.equal(ROUTE_HANDLER_STUDY_VERSION, 13)
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 13 })
  assert.equal(sidecar, undefined)
  assert.equal(
    message.newerStudyFormatMessage(13),
    'This study was saved in format 13 by a newer Codebook; this Codebook reads formats up to 12. Update the extension to open it. The study is kept as it is.',
  )
})

// Value: protects=DX-2 the replay and library name a route-handler pause After operation k · Route handler METHOD route · path:line, never a server render or page load; fails_when=the label says Server render or Page load, or drops the method or route; no_claim=where the label is drawn
test('a route-handler pause is named After operation 2 · Route handler POST /api/todos · path:line', () => {
  // Arrange
  const stops = [
    {
      participant: 'server',
      source: { path: 'app/api/todos/route.ts', line: 25 },
    },
  ]
  const [route] = routeStudy(13, ['route']).observations
  const pause = { ...route!, source: { line: 25 } }
  // Act
  const names = projectPauseNames([pause], stops).map(
    (named) => named.name?.text,
  )
  // Assert
  assert.deepEqual(names, [
    'After operation 2 · Route handler POST /api/todos · app/api/todos/route.ts:25',
  ])
})

// Value: protects=DX-2 the live pause message names handler, request and operation in the fixed sentence, and the run resource keeps routeHandler in the pause label; fails_when=the sentence changes or pauseLabelOf drops routeHandler; no_claim=where the run calls the helper
test('the route-handler pause message and label carry the handler, its request and the operation', () => {
  // Arrange
  const snapshot = {
    execution: 'route-handler' as const,
    attribution: 'after-operation' as const,
    operationIndex: 2,
    routeHandler: { method: 'POST', route: '/api/todos', path: '/api/todos' },
  }
  // Act
  const message = describeRouteHandlerPauseMessage(snapshot)
  const label = pauseLabelOf(snapshot)
  // Assert
  assert.equal(
    message,
    'Paused in the route handler POST /api/todos (request /api/todos), observed after operation 2',
  )
  assert.deepEqual(label, snapshot)
})

// Value: protects=format 7 stays the strict 0.2.72.0 shape: a routeHandler object alone (with no other format 8 field) is refused there like every execution field, while the same study without it passes that check and stops at a later one; fails_when=the format 7 check lists every format 8 field but routeHandler, so a forged format 7 study keeps it; no_claim=the writer, which never writes it outside format 13
test('a format 7 study whose observation carries only a routeHandler object is refused as keeping an execution field, and the same study without it passes that check', () => {
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
    ...plain
  } = complete.observations[0]!
  const formatSeven = (observation: Observation): ConfiguredStudy => ({
    ...complete,
    version: 7,
    configuration: browserOnly,
    configurationHash: sha256(JSON.stringify(browserOnly)),
    observations: [observation],
  })
  const withoutField = formatSeven(plain)
  const forged = formatSeven({ ...plain, routeHandler: ROUTE_HANDLER })
  // Act
  const acceptPlain = (): void =>
    validateConfiguredStudyEvidence(withoutField, withoutField.workspaceKey)
  const acceptForged = (): void =>
    validateConfiguredStudyEvidence(forged, forged.workspaceKey)
  // Assert
  // The study without the field fails only a later check: its single pause leaves operation 2 without its declared pauses.
  assert.throws(acceptPlain, {
    message: 'Operation 2 is done without its declared pauses continued.',
  })
  assert.throws(acceptForged, {
    message: 'Only a study of format 8 keeps execution fields.',
  })
})
