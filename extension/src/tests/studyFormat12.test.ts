import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  configuredObservationSchema,
  type ConfiguredStudy,
} from '../configuredStudySchemas'
import { ENTRY_LOAD_OPERATION_KEY } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { captureStudy } from '../utils/captureStudy'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { projectPauseNames } from '../utils/projectPauseNames'
import { studyFormatOfEvidence } from '../utils/studyFormatOfConfiguration'
import { validateConfiguredStudyEvidence } from '../utils/validateConfiguredStudyEvidence'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { serviceHostedEntryRun } from './utils/entryRenderService'

/** The observation fields a pause in a module's evaluation carries. */
type PauseFields = Partial<ConfiguredStudy['observations'][number]>

/**
 * Builds the saved study of a run that declared one entry-render server stop (`afterOperation: 0`) and paused it once, resealed as the given format and package folder.
 * @param version - The format number to give the study.
 * @param pause - The observation fields of the pause (`attribution`, `scope`, …) on top of a plain entry-load server render.
 * @param packageRoot - The `packageRoot` of the configuration; `undefined` leaves the field out (a root run).
 * @returns A study that validates by the format 8 rules when `version` is 8, 9 or 12.
 * @example entryRenderStudy(12, { attribution: 'preparation', scope: 'module' }, 'apps/web').version // => 12
 */
function entryRenderStudy(
  version: number,
  pause: PauseFields,
  packageRoot?: string,
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
    afterOperation: 0,
    additionalStops: [],
    ...(packageRoot === undefined ? {} : { packageRoot }),
  } as ConfiguredStudy['configuration']
  const observation = {
    ...server!,
    elapsedMs: 500,
    execution: 'server-render' as const,
    attribution: 'entry-load' as const,
    declaredIndex: 0,
    executionIndex: 0,
    ...pause,
  }
  return {
    ...complete,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    finalOutcome: 'not-demonstrated',
    operation: undefined,
    operations: complete.operations!.map(
      ({
        atMs: _atMs,
        ...record
      }): NonNullable<ConfiguredStudy['operations']>[number] => ({
        ...record,
        state: 'not-run',
        ack: 'pending',
        effect: 'pending',
      }),
    ),
    observations: [observation],
    captures: [],
  } as ConfiguredStudy
}

const MODULE_PREPARATION: PauseFields = {
  attribution: 'preparation',
  scope: 'module',
}

// Value: protects=AC 5 / R7 a Next study that holds a module-evaluation or preparation observation takes format 12, root or packageRoot, and every other Next study keeps 8 or 9; fails_when=format 12 is written for an ordinary server render, or a module observation stays format 8 or 9; no_claim=a live run
test('studyFormatOfEvidence gives 12 for a module-evaluation or preparation observation and keeps 8 and 9 otherwise', () => {
  // Arrange
  const root = entryRenderStudy(8, {}).configuration
  const nested = entryRenderStudy(9, {}, 'apps/web').configuration
  // Act
  const formats = [
    studyFormatOfEvidence(root, [{ scope: 'module' }]),
    studyFormatOfEvidence(root, [{ attribution: 'preparation' }]),
    studyFormatOfEvidence(nested, [MODULE_PREPARATION]),
    studyFormatOfEvidence(root, [{ attribution: 'entry-load' }]),
    studyFormatOfEvidence(nested, [{ attribution: 'after-operation' }]),
    studyFormatOfEvidence(nested, []),
  ]
  // Assert
  assert.deepEqual(formats, [12, 12, 12, 8, 9, 9])
})

// Value: protects=AC 5 / R7 a preparation module-evaluation study saves as .study.v12.json beside its metadata, reopens and is listed as format v12; fails_when=the storage table lacks v12 or the schema refuses scope and preparation; no_claim=a live run
test('a study with a preparation module-evaluation pause is saved as .study.v12.json, reopens and is listed as v12', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-12-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = entryRenderStudy(12, MODULE_PREPARATION)
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v12.json`,
    `${study.id}.study.v12.json`,
  ])
  assert.equal(reopened.version, 12)
  assert.deepEqual(
    reopened.observations.map((o) => [o.attribution, o.scope]),
    [['preparation', 'module']],
  )
  assert.deepEqual(listed, ['v12'])
})

// Value: protects=R7 a run saved at format 8 before its first module-evaluation pause moves to format 12 at the next checkpoint instead of being refused as a changed format; fails_when=assertStudyCheckpoint demands an equal version, so Save fails when the module pause arrives; no_claim=a live run
test('a run saved at format 8 moves to format 12 at the checkpoint that holds its first preparation pause', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-12-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const later = entryRenderStudy(12, MODULE_PREPARATION)
  const earlier: ConfiguredStudy = {
    ...later,
    version: 8,
    terminal: false,
    observations: [],
    captures: [],
  }
  const library = new LearningLibrary(directory, later.workspaceKey)
  // Act
  await library.saveStudy(earlier)
  const afterFirst = (await library.list()).map((entry) => entry.format)
  await library.saveStudy(later)
  const reopened = await library.readStudy(later.id)
  // Assert
  assert.deepEqual(afterFirst, ['v8'])
  assert.equal(reopened.version, 12)
  assert.equal(reopened.observations.length, 1)
})

// Value: protects=AC 5 the replay names the moment from the saved fields: Preparation for Codebook's own request, Page load for the page's own load, both as Module evaluation; fails_when=the label stays Server render, or Preparation reads Page load; no_claim=where the label is drawn
test('a module-evaluation pause is named Preparation or Page load · Module evaluation with its path and line', () => {
  // Arrange
  const stops = [
    { participant: 'server', source: { path: 'db/index.ts', line: 12 } },
  ]
  const at = (fields: object): object => ({
    participant: 'server',
    execution: 'server-render',
    scope: 'module',
    declaredIndex: 0,
    executionIndex: 0,
    source: { line: 12 },
    ...fields,
  })
  // Act
  const names = [
    at({ attribution: 'preparation' }),
    at({ attribution: 'entry-load' }),
    at({ attribution: 'entry-load', scope: undefined }),
  ].map((observation) => projectPauseNames([observation], stops)[0]?.name?.text)
  // Assert
  assert.deepEqual(names, [
    'Preparation · Module evaluation · db/index.ts:12',
    'Page load · Module evaluation · db/index.ts:12',
    'Page load · Server render · db/index.ts:12',
  ])
})

// Value: protects=R7 format 8 and 9 studies refuse the scope and the preparation attribution, so only format 12 carries them; fails_when=an older format accepts either field; no_claim=the wording of the refusal beyond its sentence
test('format 8 and 9 studies carrying a module scope or a preparation attribution are refused', () => {
  // Arrange
  const withScope = entryRenderStudy(8, { scope: 'module' })
  const withPreparation = entryRenderStudy(9, MODULE_PREPARATION, 'apps/web')
  // Act
  const decode = (study: ConfiguredStudy): unknown =>
    decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  for (const study of [withScope, withPreparation])
    assert.throws(() => decode(study), {
      message:
        'Only a study of format 12 keeps a module scope or a preparation attribution.',
    })
})

// Value: protects=R7 format 12 is written only for a study that holds such an observation; fails_when=a format 12 study of plain server renders is accepted; no_claim=a live run
test('a format 12 study without a module-evaluation or preparation observation is refused', () => {
  // Arrange
  const study = entryRenderStudy(12, {})
  // Act
  const accept = (): unknown => decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.throws(accept, {
    message:
      'A study of format 12 holds a module-evaluation or preparation observation.',
  })
})

// Value: protects=R7 a format 12 study of a packageRoot run validates, and a preparation pause belongs to the entry-render stop only; fails_when=format 12 is read only for root runs, or a preparation pause is accepted for a stop after an operation; no_claim=a live run
test('a format 12 study with a packageRoot validates and a preparation pause after an operation is refused', () => {
  // Arrange
  const nested = entryRenderStudy(12, MODULE_PREPARATION, 'apps/web')
  const afterOperation = entryRenderStudy(12, {
    ...MODULE_PREPARATION,
    operationIndex: 1,
  })
  // Act
  const acceptNested = (): void =>
    validateConfiguredStudyEvidence(nested, nested.workspaceKey)
  const acceptAfter = (): void =>
    validateConfiguredStudyEvidence(afterOperation, afterOperation.workspaceKey)
  // Assert
  assert.doesNotThrow(acceptNested)
  assert.throws(acceptAfter, {
    message: 'Configured observation operationIndex differs from its stop.',
  })
})

// Value: protects=R7 a study of format 16 (above the readable 12) is listed as saved by a newer Codebook and kept; fails_when=READABLE_STUDY_VERSION stays 11 or the file is read; no_claim=the 0.2.85 binary
test('a study saved in format 16 is listed as saved by a newer Codebook', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-13-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = entryRenderStudy(12, MODULE_PREPARATION)
  await writeFile(
    join(directory, `${study.id}.study.v16.json`),
    JSON.stringify({ ...study, version: 16 }),
  )
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  const listed = await library.list()
  // Assert
  assert.equal(listed[0]?.format, 'newer')
  assert.equal(
    listed[0]?.reason,
    'This study was saved in format 16 by a newer Codebook; this Codebook reads formats up to 15. Update the extension to open it. The study is kept as it is.',
  )
})

// Value: protects=R11 a preparation pause with no application frame is saved with an absent image of its own and reopens; the replay finds that entry, never a neighbouring frame; fails_when=the pause needs a captured frame, or the saved image is another snapshot's; no_claim=the replay's drawing of the empty frame
test('a preparation pause with no application frame reopens with an absent image of its own', () => {
  // Arrange
  const study = entryRenderStudy(12, MODULE_PREPARATION)
  const observation = study.observations[0]!
  const absent = {
    phase: 'paused-server' as const,
    snapshotId: observation.id,
    status: 'absent' as const,
    reason: 'The application was not yet available.',
  }
  const withFrame = { ...study, captures: [absent] }
  // Act
  const decoded = decodeConfiguredStudy(withFrame, withFrame.workspaceKey)
  const image = decoded.captures.find(
    (capture) => capture.snapshotId === observation.id,
  )
  // Assert
  assert.equal(image?.status, 'absent')
})

// Value: protects=R7 `preparationRequest` is a live field and is never saved; fails_when=the saved observation schema accepts it; no_claim=the capture writer, which a service test covers
test('a saved observation refuses the live preparationRequest field', () => {
  // Arrange
  const observation = {
    ...entryRenderStudy(12, MODULE_PREPARATION).observations[0]!,
    preparationRequest: 'readiness',
  }
  // Act
  const parse = (): unknown => configuredObservationSchema.parse(observation)
  // Assert
  assert.throws(parse)
})

// Value: protects=R7 the study writer saves scope and the preparation attribution from the live pause as format 12, saves no preparationRequest, and gives the pause with no frame an absent image of its own; fails_when=the writer keeps the format 8, fails on the live-only field, or saves it; no_claim=a real Next server (a stand-in server hits the armed stop)
test('the study writer saves a live preparation module pause as format 12 without preparationRequest', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context)
  const { harness, service, state, receipt } = run
  run.holdMaintenance()
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the entry-render stop was armed',
  )
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  for (const snapshot of harness.run.view().snapshots) {
    snapshot.attribution = 'preparation'
    snapshot.scope = 'module'
    snapshot.preparationRequest = 'readiness'
  }
  // Act
  const saved = await captureStudy(
    service,
    service.record(receipt),
    '0'.repeat(64),
  )
  // Assert
  assert.equal(saved?.version, 12)
  assert.deepEqual(
    saved?.observations.map((o) => [o.attribution, o.scope]),
    [['preparation', 'module']],
  )
  assert.equal(JSON.stringify(saved).includes('preparationRequest'), false)
})

// Value: protects=R11 a demonstrated run whose only pause was in the readiness request (no browser, so no application image) still reopens, while the same gap for a page-load pause voids the study; fails_when=the completeness rule demands a captured image for a preparation pause, or stops demanding one for every other pause; no_claim=the replay's drawing of the empty frame
test('a demonstrated study whose preparation pause has no application image reopens, and the same gap on a page-load pause is refused', () => {
  // Arrange
  const entry = entryRenderStudy(12, MODULE_PREPARATION)
  const observation = entry.observations[0]!
  const configuration = {
    ...entry.configuration,
    operations: undefined,
  } as ConfiguredStudy['configuration']
  const { operations: _operations, ...withoutOperations } = entry
  const completeCaptures = createOperationsStudy().captures.filter(
    (capture) => capture.phase === 'before' || capture.phase === 'after',
  )
  const demonstrated = (pause: PauseFields): ConfiguredStudy => {
    const pauseObservation = { ...observation, ...pause }
    return {
      ...withoutOperations,
      configuration,
      configurationHash: sha256(JSON.stringify(configuration)),
      finalOutcome: 'demonstrated',
      terminal: true,
      operation: {
        id: '00000000-0000-4000-8000-000000000072',
        key: ENTRY_LOAD_OPERATION_KEY,
        inputDispatched: false,
        inputAcknowledged: false,
        continuedPause: pauseObservation.pause,
        afterVerified: true,
      },
      observations: [pauseObservation],
      captures: [
        ...completeCaptures,
        {
          phase: 'paused-server',
          snapshotId: pauseObservation.id,
          status: 'absent',
          reason: 'The application was not yet available.',
        },
      ],
    }
  }
  const preparation = demonstrated({})
  const pageLoad = demonstrated({ attribution: 'entry-load' })
  // Act
  const decodePreparation = (): unknown =>
    decodeConfiguredStudy(preparation, preparation.workspaceKey)
  const decodePageLoad = (): unknown =>
    decodeConfiguredStudy(pageLoad, pageLoad.workspaceKey)
  // Assert
  assert.doesNotThrow(decodePreparation)
  assert.throws(decodePageLoad, {
    message: 'Configured completed study is missing required evidence.',
  })
})
