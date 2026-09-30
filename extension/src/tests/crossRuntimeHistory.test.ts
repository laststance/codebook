import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import { repositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { assertStudyCheckpoint } from '../utils/assertStudyCheckpoint'
import { configuredObservationPosition } from '../utils/configuredObservationPosition'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { validateRecordingContext } from '../utils/validateRecordingContext'
import { projectRecording } from '../utils/projectRecording'
import type { RecordingIndex } from '../recordingSchemas'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

test('server and browser first pauses retain distinct sources and native history without colliding', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.deepEqual(
    decoded.observations.map((value) => [
      value.participant,
      value.pause.generation,
    ]),
    [
      ['browser', 1],
      ['server', 1],
      ['browser', 2],
    ],
  )
  assert.equal(
    decoded.observations[1]?.debugger?.variables[0]?.value,
    'display',
  )
  assert.equal(
    configuredObservationPosition(decoded, 'server-session:1').path,
    'src/mode.ts',
  )
  assert.equal(
    configuredObservationPosition(decoded, 'browser-session:2').path,
    'src/theme.ts',
  )
  assert.throws(
    () => configuredObservationPosition(decoded, 'foreign:1'),
    /no declared source/,
  )
  assert.equal(
    repositoryConfigSchema.safeParse(study.configuration).success,
    false,
  )
})

test('old browser intent hashes and decoded archive bytes stay unchanged', () => {
  // Arrange
  const study = createConfiguredStudy(),
    bytes = JSON.stringify(study)
  // Act
  const decoded = decodeConfiguredStudy(JSON.parse(bytes), study.workspaceKey)
  // Assert
  assert.equal(JSON.stringify(decoded), bytes)
  assert.equal(decoded.configurationHash, study.configurationHash)
  assert.equal(decoded.version, 3)
})

test('cross-runtime records reject mismatched versions participants phases sources and citation indexes', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  // Act / Assert
  assert.throws(
    () => decodeConfiguredStudy({ ...study, version: 3 }, study.workspaceKey),
    /versions disagree/,
  )
  for (const change of [
    { participant: 'browser' },
    { capturePhase: 'paused-browser' },
    { source: study.observations[0]!.source },
  ]) {
    const invalid = structuredClone(study)
    Object.assign(invalid.observations[1]!, change)
    assert.throws(() => decodeConfiguredStudy(invalid, study.workspaceKey))
  }
  const citation = structuredClone(study)
  assert.equal(citation.configuration.version, 2)
  if (citation.configuration.version !== 2)
    throw new Error('Expected version 2')
  citation.configuration.additionalStops![0]!.anchorIndex = 0
  citation.configurationHash = sha256(JSON.stringify(citation.configuration))
  assert.throws(
    () => decodeConfiguredStudy(citation, study.workspaceKey),
    /selected citation/,
  )
})

test('same-session generations cannot repeat and a participant cannot switch debugger ownership', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  // Act / Assert
  for (const pause of [
    { sessionId: 'browser-session', generation: 1, threadId: 1 },
    { sessionId: 'foreign-session', generation: 2, threadId: 1 },
    { sessionId: 'server-session', generation: 2, threadId: 1 },
  ]) {
    const invalid = structuredClone(study)
    invalid.observations[2]!.pause = pause
    assert.throws(
      () => decodeConfiguredStudy(invalid, study.workspaceKey),
      /ordered pause identities|owned debugger session/,
    )
  }
  const reversedTime = structuredClone(study)
  reversedTime.observations[2]!.elapsedMs = 3000
  assert.throws(
    () => decodeConfiguredStudy(reversedTime, study.workspaceKey),
    /ordered pause identities/,
  )
})

test('pause images cannot be attributed to another participant or a missing snapshot', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  // Act / Assert
  const wrongPhase = structuredClone(study)
  wrongPhase.captures[2]!.phase = 'paused-browser'
  assert.throws(
    () => decodeConfiguredStudy(wrongPhase, study.workspaceKey),
    /another observation/,
  )
  const missing = structuredClone(study)
  delete missing.captures[2]!.snapshotId
  assert.throws(
    () => decodeConfiguredStudy(missing, study.workspaceKey),
    /exact snapshot/,
  )
})

test('checkpoint continuation advances across participants while preserving every earlier stop', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  const prior = {
    ...study,
    terminal: false,
    finalOutcome: 'pending-teardown' as const,
    observations: study.observations.slice(0, 1),
    captures: study.captures.slice(0, 2),
    operation: {
      ...study.operation!,
      afterVerified: false,
      continuedPause: study.observations[0]!.pause,
    },
  }
  const next = {
    ...study,
    terminal: false,
    finalOutcome: 'pending-teardown' as const,
    observations: study.observations.slice(0, 2),
    captures: study.captures.slice(0, 3),
    operation: {
      ...study.operation!,
      afterVerified: false,
      continuedPause: study.observations[1]!.pause,
    },
  }
  // Act / Assert
  assert.doesNotThrow(() => assertStudyCheckpoint(prior, next))
  assert.doesNotThrow(() => assertStudyCheckpoint(next, study))
  assert.throws(
    () =>
      assertStudyCheckpoint(next, {
        ...next,
        operation: {
          ...next.operation,
          continuedPause: prior.operation.continuedPause,
        },
      }),
    /confirmed receipts/,
  )
  assert.throws(
    () =>
      assertStudyCheckpoint(prior, {
        ...next,
        observations: [...next.observations].reverse(),
      }),
    /observation or interpretation history/,
  )
})

test('new history catalogs and repairs its sidecar without rewriting old browser files', async (context) => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-cross-runtime-history-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const old = createConfiguredStudy(),
    current = createCrossRuntimeStudy()
  current.runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  current.id = `${current.instanceId}_${current.runId}`
  for (const observation of current.observations)
    observation.snapshotUri = `codebook://${current.instanceId}/runs/${current.runId}/snapshots/${encodeURIComponent(observation.id)}`
  const library = new LearningLibrary(directory, old.workspaceKey)
  await library.saveStudy(old)
  const oldPath = join(directory, `${old.id}.study.v3.json`),
    oldBytes = await readFile(oldPath)
  // Act
  await library.saveStudy(current)
  const currentPath = join(directory, `${current.id}.study.v4.json`),
    currentBytes = await readFile(currentPath)
  await rm(join(directory, `${current.id}.study.meta.v4.json`))
  assert.equal((await library.readCheckpoint(current.id)).status, 'failed')
  await library.reconcile()
  // Assert
  assert.equal((await library.readCheckpoint(current.id)).status, 'saved')
  assert.deepEqual((await library.list()).map((entry) => entry.format).sort(), [
    'v3',
    'v4',
  ])
  assert.deepEqual(await readFile(oldPath), oldBytes)
  assert.deepEqual(await readFile(currentPath), currentBytes)
  await writeFile(join(directory, `${old.id}.study.v4.json`), '{broken')
  await assert.rejects(library.readStudy(old.id))
  assert.deepEqual(await readFile(oldPath), oldBytes)
})

test('recording context retains server history and rejects a browser phase attached to its stop', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  // Act
  const context = buildRecordingContext(study, [], 1)
  const verified = validateRecordingContext(context, study.workspaceKey)
  // Assert
  assert.equal(verified.study.version, 4)
  assert.equal(
    verified.phases.find((phase) => phase.snapshotId === 'server-session:1')
      ?.phase,
    'paused-server',
  )
  const invalid = structuredClone(context)
  invalid.phases.find(
    (phase) => phase.snapshotId === 'server-session:1',
  )!.phase = 'paused-browser'
  assert.throws(
    () => validateRecordingContext(invalid, study.workspaceKey),
    /another observation/,
  )
})

test('a continued browser pause cannot hide missing required facts after control moves to the server', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  study.finalOutcome = 'partial'
  study.terminal = false
  study.operation!.afterVerified = false
  study.operation!.continuedPause = study.observations[1]!.pause
  delete study.observations[0]!.values['value:nextTheme']
  study.observations[0]!.unavailableValues.push({
    path: 'value:nextTheme',
    reason: 'Unavailable',
  })
  // Act / Assert
  assert.throws(
    () => decodeConfiguredStudy(study, study.workspaceKey),
    /required fact/,
  )
})

test('completed cross-runtime learning requires historical native debugger state at every stop', () => {
  // Arrange
  const study = createCrossRuntimeStudy()
  delete study.observations[1]!.debugger
  // Act / Assert
  assert.throws(
    () => decodeConfiguredStudy(study, study.workspaceKey),
    /lacks native debugger state/,
  )
})

test('seeking across browser and server history shows matching values and clears uncaptured intervals', () => {
  // Arrange
  const study = createCrossRuntimeStudy(),
    context = buildRecordingContext(study, [], 1)
  const index: RecordingIndex = {
    header: {
      version: 3,
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: study.runId,
      profile: study.profile,
      sourceBuild: {
        revision: 'test',
        dirty: false,
        sourceHash: sha256('test source'),
      },
      createdAt: study.createdAt,
      startedMs: 0,
      clock: 'runtime-receipt-ms',
      sampleIntervalMs: 50,
      owner: { pid: 1, hostname: 'test', sessionId: study.instanceId },
    },
    entries: [],
    status: 'finalized',
    endMs: 8000,
    lastVerifiedMs: 8000,
  }
  // Act / Assert
  for (const time of [4000, 2000, 6000, 4000]) {
    const projection = projectRecording(index, context, time)
    assert.equal(
      projection.observation?.participant,
      time === 4000 ? 'server' : 'browser',
    )
    assert.equal(
      projection.debugger?.variables[0]?.value,
      time === 4000 ? 'display' : 'dark',
    )
  }
  assert.equal(projectRecording(index, context, 4500).debugger, undefined)
  assert.equal(projectRecording(index, context, 4500).observation, undefined)
})

test('cross-runtime films reopen with their own format and cannot be relabeled as browser-only recordings', async (context) => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-cross-runtime-film-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = createCrossRuntimeStudy(),
    library = new LearningLibrary(directory, study.workspaceKey)
  await library.saveStudy(study)
  const store = new RecordingStore(directory, study.workspaceKey)
  const writer = await store.start(
    {
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: study.runId,
      profile: study.profile,
      sourceBuild: {
        revision: 'mechanism-test',
        dirty: false,
        sourceHash: sha256('test source'),
      },
    },
    0,
    3,
  )
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    'base64',
  )
  // Act
  assert.equal(
    writer.frame({
      bytes: png,
      elapsedMs: 4000,
      kind: 'phase',
      phase: 'paused-server',
    }),
    true,
  )
  await writer.finish(8000)
  await store.saveContext(buildRecordingContext(study, [], 1))
  const reopened = new RecordingStore(directory, study.workspaceKey),
    index = await reopened.read(study.id),
    recording = await reopened.readContext(study.id)
  // Assert
  assert.equal(index.header.version, 3)
  assert.equal(index.seal?.version, 3)
  assert.equal(recording.context.version, 3)
  assert.equal(
    projectRecording(index, recording.context, 4000).debugger?.variables[0]
      ?.value,
    'display',
  )
  assert.deepEqual(await reopened.readFrame(study.id, sha256(png)), png)
  assert.throws(() =>
    validateRecordingContext(
      { ...recording.context, version: 2 },
      study.workspaceKey,
    ),
  )
})
