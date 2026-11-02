import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  configuredStudySchema,
  type ConfiguredStudy,
} from '../configuredStudySchemas'
import {
  ENTRY_LOAD_OPERATION_KEY,
  READABLE_STUDY_VERSION,
  SERVER_RENDER_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { configuredStops } from '../utils/configuredStops'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { executionOfObservation } from '../utils/executionOfObservation'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import { projectPauseNames } from '../utils/projectPauseNames'
import { studyFormatOfConfiguration } from '../utils/studyFormatOfConfiguration'
import { validateConfiguredStudyEvidence } from '../utils/validateConfiguredStudyEvidence'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { captureBrowserOnlyOperationsStudy } from './utils/captureBrowserOnlyOperationsStudy'
import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'

/** The study 0.2.72.0 (commit 2f5de949) wrote for the run of {@link captureBrowserOnlyOperationsStudy}. */
const GOLDEN_PATH = resolve(
  __dirname,
  '../../src/tests/fixtures/operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

/** The keys whose values are run ids or times, which differ from run to run. */
const RUN_ID_OR_TIME_KEYS = new Set([
  'id',
  'instanceId',
  'runId',
  'snapshotUri',
  'createdAt',
  'savedAt',
  'capturedAt',
  'elapsedMs',
  'atMs',
  'materialSignature',
])

/**
 * Replaces every run id and time of a saved study by a fixed word, so two runs compare field for field on everything else.
 * @param value - A parsed study or a part of it.
 * @returns The same structure with those values replaced.
 * @example withoutRunIdsAndTimes({ runId: 'a', title: 'x' }) // => { runId: '<run-specific>', title: 'x' }
 */
function withoutRunIdsAndTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRunIdsAndTimes)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      RUN_ID_OR_TIME_KEYS.has(key)
        ? '<run-specific>'
        : withoutRunIdsAndTimes(member),
    ]),
  )
}

/** The fixture's configuration with its stops declared as given: the first of `stops` is the main stop. */
function restopped(
  study: ConfiguredStudy,
  stops: readonly {
    participant: 'browser' | 'server'
    source: unknown
    anchorIndex: number
    inspections: unknown
    afterOperation: number
  }[],
): ConfiguredStudy['configuration'] {
  const configuration = study.configuration
  if (configuration.version !== 3)
    throw new Error('A version 3 study is needed.')
  const [main, ...additional] = stops
  return {
    ...configuration,
    participant: main!.participant,
    source: main!.source,
    book: { ...configuration.book, anchorIndex: main!.anchorIndex },
    inspections: main!.inspections,
    afterOperation: main!.afterOperation,
    additionalStops: additional,
  } as ConfiguredStudy['configuration']
}

// protects=AC 10: a browser-only version 3 run is still saved exactly as 0.2.72.0 saved it (format 7), field for field except run ids and times; fails_when=the new writer adds a field, changes the format or any value for a browser-only run; no_claim=a real browser run (the controlled operations runtime stands in)
test('a browser-only version 3 run is saved as format 7 equal to the study 0.2.72.0 wrote, except run ids and times', async (context) => {
  // Arrange
  const golden: unknown = JSON.parse(await readFile(GOLDEN_PATH, 'utf8'))
  // Act
  const written = await captureBrowserOnlyOperationsStudy(context)
  // Assert
  assert.deepEqual(
    withoutRunIdsAndTimes(JSON.parse(JSON.stringify(written))),
    withoutRunIdsAndTimes(golden),
  )
  assert.equal(written.version, 7)
})

// protects=AC 10: a browser-only run whose pause snapshots carry the format 8 fields is still written as the 0.2.72.0 format 7 study, without those fields, and passes format 7 validation; fails_when=the writer keeps execution, declaredIndex or executionIndex in a format 7 study; no_claim=a real run (the controlled runtime stands in)
test('a browser-only version 3 run whose snapshots carry format 8 fields is saved as the format 7 golden without them', async (context) => {
  // Arrange
  const golden: unknown = JSON.parse(await readFile(GOLDEN_PATH, 'utf8'))
  // Act
  const written = await captureBrowserOnlyOperationsStudy(context, {
    snapshotsCarryFormat8Fields: true,
  })
  // Assert
  assert.deepEqual(
    withoutRunIdsAndTimes(JSON.parse(JSON.stringify(written))),
    withoutRunIdsAndTimes(golden),
  )
  assert.doesNotThrow(() =>
    validateConfiguredStudyEvidence(written, written.workspaceKey),
  )
})

// protects=AC 10a: the study 0.2.72.0 wrote still passes today's decoding and the semantic validation of its recording context; fails_when=format 7 validation rejects the golden study or its recording context; no_claim=playback of it
test('the study 0.2.72.0 wrote decodes and its recording context validates', async () => {
  // Arrange
  const golden: ConfiguredStudy = JSON.parse(
    await readFile(GOLDEN_PATH, 'utf8'),
  )
  // Act
  const decoded = decodeConfiguredStudy(golden, golden.workspaceKey)
  const context = validateRecordingContext(
    buildRecordingContext(decoded, [], 1),
    golden.workspaceKey,
  )
  // Assert
  assert.equal(decoded.version, 7)
  assert.equal(context.studyId, golden.id)
})

// protects=AC 10: the format of a new save is a pure function of the sealed configuration; fails_when=a server stop, an afterOperation 0 stop or omitted operations stays format 7, or a browser-only run leaves it; no_claim=the configuration schema (afterOperation 0 and omitted operations are given as objects)
test('studyFormatOfConfiguration gives 8 for a server stop, an entry-render stop or no operations and 7 for browser stops', () => {
  // Arrange
  const browserOnly = createOperationsStudy().configuration
  if (browserOnly.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const withoutServer = { ...browserOnly, additionalStops: [] }
  const withServer = browserOnly
  const entryRender = { ...withoutServer, afterOperation: 0 }
  const withoutOperations = { ...withoutServer, operations: undefined }
  // Act
  const formats = [
    withoutServer,
    withServer,
    entryRender,
    withoutOperations,
  ].map((configuration) =>
    studyFormatOfConfiguration(
      configuration as ConfiguredStudy['configuration'],
    ),
  )
  // Assert
  assert.deepEqual(formats, [7, 8, 8, 8])
})

// protects=the table of storage formats, the readable version and the study schema agree on the formats this Codebook knows; fails_when=a format is added to one and not the others; no_claim=the contents of an archive
test('STUDY_STORAGE_FORMATS, READABLE_STUDY_VERSION and the study schema agree', () => {
  // Arrange
  const versions = STUDY_STORAGE_FORMATS.map((row) => row.version)
  // Act
  const numbered = STUDY_STORAGE_FORMATS.filter((row) => row.version >= 3)
  const schemaVersion = configuredStudySchema.shape.version
  // Assert
  assert.equal(READABLE_STUDY_VERSION, 8)
  assert.equal(SERVER_RENDER_STUDY_VERSION, 8)
  assert.equal(Math.max(...versions), READABLE_STUDY_VERSION)
  for (const row of numbered) {
    assert.equal(row.format, `v${row.version}`)
    assert.equal(row.archiveSuffix, `.study.v${row.version}.json`)
    assert.equal(row.metadataSuffix, `.study.meta.v${row.version}.json`)
    assert.equal(schemaVersion.safeParse(row.version).success, true)
  }
  assert.equal(
    schemaVersion.safeParse(READABLE_STUDY_VERSION + 1).success,
    false,
  )
})

// protects=AC 10: a run whose configuration has a server stop is saved as .study.v8.json from its first checkpoint, a later checkpoint and a restart keep format 8; fails_when=the first checkpoint is written as format 7 or the format changes between checkpoints; no_claim=a real run (saved fixtures stand in for its checkpoints)
test('a run saved at its first pause, saved again after a later pause, restarted and reopened stays format 8', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-8-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const laterCheckpoint = createOperationsStudy()
  const firstPause = laterCheckpoint.observations[0]!
  // The first checkpoint: operations 1 and 2 sent, the stop after operation 2 paused, nothing after it reached.
  const firstCheckpoint: ConfiguredStudy = {
    ...laterCheckpoint,
    terminal: false,
    finalOutcome: 'not-demonstrated',
    operation: {
      ...laterCheckpoint.operation!,
      continuedPause: firstPause.pause,
      afterVerified: false,
    },
    operations: laterCheckpoint.operations!.map((record) =>
      record.index > 2
        ? {
            index: record.index,
            kind: record.kind,
            title: record.title,
            state: 'not-run' as const,
            ack: 'pending' as const,
            valueCheck: 'n/a' as const,
            effect: 'pending' as const,
          }
        : record,
    ),
    observations: [firstPause],
    captures: laterCheckpoint.captures.filter(
      (capture) =>
        capture.phase !== 'after' &&
        (!capture.snapshotId || capture.snapshotId === firstPause.id),
    ),
  }
  const library = new LearningLibrary(directory, firstCheckpoint.workspaceKey)
  // Act
  await library.saveStudy(firstCheckpoint)
  const afterFirst = (await library.list()).map((entry) => entry.format)
  await library.saveStudy(laterCheckpoint)
  const restarted = new LearningLibrary(directory, firstCheckpoint.workspaceKey)
  const reopened = await restarted.readStudy(laterCheckpoint.id)
  const afterLater = (await restarted.list()).map((entry) => entry.format)
  // Assert
  assert.deepEqual(afterFirst, ['v8'])
  assert.equal(reopened.version, 8)
  assert.deepEqual(afterLater, ['v8'])
  assert.deepEqual(
    reopened.observations.map((observation) => observation.declaredIndex),
    [0, 1, 2],
  )
})

// protects=AC 10: a format 8 set that paused out of declared order validates by declaredIndex, not by position; fails_when=format 8 matches observations to stops by position, or accepts a stop observed twice; no_claim=which order a real page runs its renders in
test('a format 8 set paused out of declared order validates by declaredIndex and refuses a stop observed twice', () => {
  // Arrange
  const complete = createOperationsStudy()
  const [first, server, finalBrowser] = complete.observations
  const outOfOrder = [
    first!,
    { ...finalBrowser!, elapsedMs: 4000, executionIndex: 1 },
    { ...server!, elapsedMs: 6000, executionIndex: 2 },
  ]
  const reordered: ConfiguredStudy = {
    ...complete,
    observations: outOfOrder,
    operation: { ...complete.operation!, continuedPause: server!.pause },
  }
  const twice: ConfiguredStudy = {
    ...reordered,
    observations: [
      first!,
      { ...outOfOrder[1]!, declaredIndex: 0 },
      outOfOrder[2]!,
    ],
  }
  // Act
  const accept = (): void =>
    validateConfiguredStudyEvidence(reordered, reordered.workspaceKey)
  const acceptTwice = (): void =>
    validateConfiguredStudyEvidence(twice, twice.workspaceKey)
  // Assert
  assert.doesNotThrow(accept)
  assert.throws(acceptTwice, {
    message:
      'Configured observation names a stop that is not declared or already observed.',
  })
})

// protects=AC 10a: an entry-render observation (a stop with afterOperation 0) needs no dispatched operation in format 8 and comes before operation mark 1, while format 7 keeps its dispatched-operation rule; fails_when=format 8 demands a dispatched operation for it, accepts it after operation 1, or format 7 stops demanding one; no_claim=the schema, which lane L3 opens to afterOperation 0
test('a group-0 observation with no dispatched operation validates in format 8 and is refused in format 7', () => {
  // Arrange
  const complete = createOperationsStudy('failed-at-3')
  const [, server] = createOperationsStudy().observations
  const baseConfiguration = complete.configuration
  if (baseConfiguration.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const [serverStop] = baseConfiguration.additionalStops ?? []
  const entryRenderConfiguration = restopped(complete, [
    { ...serverStop!, afterOperation: 0 },
  ])
  const notSent = complete.operations!.map((record) => ({
    ...record,
    atMs: undefined,
    state: 'not-run' as const,
    ack: 'pending' as const,
    effect: 'pending' as const,
  }))
  const entryRender: ConfiguredStudy = {
    ...complete,
    configuration: entryRenderConfiguration,
    configurationHash: sha256(JSON.stringify(entryRenderConfiguration)),
    finalOutcome: 'not-demonstrated',
    operation: undefined,
    operations: notSent.map(({ atMs: _atMs, ...record }) => record),
    observations: [
      {
        ...server!,
        elapsedMs: 500,
        execution: 'server-render',
        attribution: 'entry-load',
        declaredIndex: 0,
        executionIndex: 0,
      },
    ],
  }
  const browserStop = restopped(complete, [
    {
      participant: 'browser',
      source: baseConfiguration.source,
      anchorIndex: baseConfiguration.book.anchorIndex,
      inspections: baseConfiguration.inspections,
      afterOperation: 1,
    },
  ])
  const {
    execution: _e,
    declaredIndex: _d,
    executionIndex: _x,
    ...plainFirst
  } = complete.observations[0]!
  const format7: ConfiguredStudy = {
    ...complete,
    version: 7,
    firstExecutionObserved: undefined,
    configuration: browserStop,
    configurationHash: sha256(JSON.stringify(browserStop)),
    operation: undefined,
    operations: complete.operations!.map((record, position) =>
      position === 0
        ? {
            ...record,
            state: 'paused',
            atMs: 1000,
            ack: 'pending',
            effect: 'pending',
          }
        : {
            ...record,
            state: 'not-run',
            atMs: undefined,
            ack: 'pending',
            effect: 'pending',
          },
    ),
    observations: [{ ...plainFirst, elapsedMs: 1200 }],
    finalOutcome: 'not-demonstrated',
  }
  // Act
  const acceptEntryRender = (): void =>
    validateConfiguredStudyEvidence(entryRender, entryRender.workspaceKey)
  const acceptFormat7 = (): void =>
    validateConfiguredStudyEvidence(format7, format7.workspaceKey)
  // Assert
  assert.doesNotThrow(acceptEntryRender)
  assert.throws(acceptFormat7, {
    message: 'Configured observation has no dispatched operation.',
  })
})

// protects=OCR medium on the fix round: only a run that declares no operation may keep a verified result without an acknowledged input; fails_when=a saved study whose configuration declares operations reopens with an aggregate record keyed "entry-load", no input and a verified result, so its learning summary may cite a result no operation produced; no_claim=a real saved run (a hand-built format 8 study stands in)
test('a verified entry-load result is refused when the configuration declares operations', () => {
  // Arrange
  const complete = createOperationsStudy()
  const [, server] = complete.observations
  const baseConfiguration = complete.configuration
  if (baseConfiguration.version !== 3)
    throw new Error('A version 3 configuration is needed.')
  const [serverStop] = baseConfiguration.additionalStops ?? []
  const entryRenderConfiguration = restopped(complete, [
    { ...serverStop!, afterOperation: 0 },
  ])
  const entryPause = {
    ...server!,
    elapsedMs: 500,
    execution: 'server-render' as const,
    attribution: 'entry-load' as const,
    declaredIndex: 0,
    executionIndex: 0,
  }
  const forged: ConfiguredStudy = {
    ...complete,
    configuration: entryRenderConfiguration,
    configurationHash: sha256(JSON.stringify(entryRenderConfiguration)),
    finalOutcome: 'not-demonstrated',
    operation: {
      id: '00000000-0000-4000-8000-000000000071',
      key: ENTRY_LOAD_OPERATION_KEY,
      inputDispatched: false,
      inputAcknowledged: false,
      continuedPause: entryPause.pause,
      afterVerified: true,
    },
    // Every declared operation done with its result verified, so only the aggregate record's input rule can refuse it.
    observations: [entryPause],
  }
  // Act
  const accept = (): void =>
    validateConfiguredStudyEvidence(forged, forged.workspaceKey)
  // Assert
  assert.throws(accept, {
    message:
      'Configured after verification lacks confirmed input and continuation.',
  })
})

// protects=format 7 stays the strict 0.2.72.0 shape: the format 8 fields are refused in it; fails_when=a format 7 study accepts execution, declaredIndex or firstExecutionObserved; no_claim=the writer
test('a format 7 study that carries a format 8 field is refused', () => {
  // Arrange
  const complete = createOperationsStudy()
  const browserOnly = { ...complete.configuration, additionalStops: [] }
  const withField: ConfiguredStudy = {
    ...complete,
    version: 7,
    configuration: browserOnly,
    configurationHash: sha256(JSON.stringify(browserOnly)),
    observations: complete.observations.slice(0, 1),
  }
  // Act
  const accept = (): void =>
    validateConfiguredStudyEvidence(withField, withField.workspaceKey)
  // Assert
  assert.throws(accept, {
    message: 'Only a study of format 8 keeps execution fields.',
  })
})

// protects=the replay names the kind of a pause saved before format 8 from its participant; fails_when=a format 7 server pause is labeled a browser pause or a format 8 execution is overridden; no_claim=the label text, which the UI lane owns
test('executionOfObservation reads a format 7 pause from its participant and a format 8 pause from its own execution', () => {
  // Arrange
  const server = { participant: 'server' as const }
  const browser = { participant: 'browser' as const }
  const render = {
    participant: 'server' as const,
    execution: 'server-render' as const,
  }
  // Act
  const kinds = [server, browser, render].map(executionOfObservation)
  // Assert
  assert.deepEqual(kinds, ['server-action', 'browser', 'server-render'])
})

// protects=0.2.72.0 lists a .study.v8.json file as saved by a newer Codebook and keeps it; fails_when=the 0.2.72.0 rule (readable up to 7) stops recognising the format 8 file name, or its sidecar is taken for an archive; no_claim=the 0.2.72.0 binary (its one function, newerStudyArchive, and its message run here over the constant 7)
test('the 0.2.72.0 rule lists a .study.v8.json archive as saved by a newer Codebook, with its sidecar kept out of the listing', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 7 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    {
      '../constants': frozenConstants,
    },
  )
  const message = await loadModule<typeof NewerStudyFormatMessageModule>(
    resolve(__dirname, '../utils/newerStudyFormatMessage.js'),
    {
      '../constants': frozenConstants,
    },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v8.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v8.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 8 })
  assert.equal(sidecar, undefined)
  assert.equal(
    message.newerStudyFormatMessage(8),
    'This study was saved in format 8 by a newer Codebook; this Codebook reads formats up to 7. Update the extension to open it. The study is kept as it is.',
  )
})

/** The study 0.2.72.0 (commit 2f5de949) saved for a version 3 run with a server-action stop, written by that commit's createOperationsStudy. */
const SERVER_STOP_GOLDEN_PATH = resolve(
  __dirname,
  '../../src/tests/fixtures/operations-study-v0.2.72.0/server-action-stop-v3.study.v7.json',
)

// protects=H1 a version 3 study with a server-action stop that 0.2.72.0 saved as format 7 still opens and its server pause reads as a server action; fails_when=the reader demands format 8 for every server stop, or names the pause a server render; no_claim=a real 0.2.72.0 file (the base writer's output stands in)
test('a format 7 study with a server-action stop saved by 0.2.72.0 still opens and names its server pause a server action', async (context) => {
  // Arrange
  const golden: ConfiguredStudy = JSON.parse(
    await readFile(SERVER_STOP_GOLDEN_PATH, 'utf8'),
  )
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-7-server-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, golden.workspaceKey)
  await library.saveStudy(golden)
  // Act
  const reopened = await library.readStudy(golden.id)
  const serverPause = reopened.observations.find(
    (observation) => observation.participant === 'server',
  )!
  const names = projectPauseNames(
    reopened.observations,
    configuredStops(reopened.configuration),
  ).map((pause) => pause.name?.kind)
  // Assert
  assert.equal(golden.version, 7)
  assert.equal(reopened.version, 7)
  assert.equal(executionOfObservation(serverPause), 'server-action')
  assert.deepEqual(names, [undefined, 'Server action', undefined])
})
