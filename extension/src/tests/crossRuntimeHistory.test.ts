import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import type { RecordingIndex } from '../recordingSchemas'
import { RecordingStore } from '../recordingStore'
import { repositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertStudyCheckpoint } from '../utils/assertStudyCheckpoint'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { citationContext } from '../utils/citationContext'
import { configuredObservationPosition } from '../utils/configuredObservationPosition'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { projectRecording } from '../utils/projectRecording'
import { validateRecordingContext } from '../utils/validateRecordingContext'

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

test('a saved stop the debugger bound at another column of its declared line reopens when its native top frame names that column', () => {
  // Arrange: the server stop was declared at 1:1 and committed at 1:8, where its saved top frame also is.
  const study = createCrossRuntimeStudy(),
    server = study.observations[1]!
  server.source = { ...server.source, column: 8 }
  server.debugger!.frames[0]!.column = 8
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.equal(decoded.observations[1]?.source.line, 1)
  assert.equal(decoded.observations[1]?.source.column, 8)
  assert.equal(decoded.observations[1]?.debugger?.frames[0]?.column, 8)
  assert.equal(decoded.finalOutcome, 'demonstrated')
})

// Value: protects=a saved moved position being a real place of the cited text; fails_when=the saved debugger frame alone confirms a column that lies past the end of its source line; why_new=Cycle 0036 C05a; seam=none
test('a saved stop whose moved column lies past the end of its source line is rejected although its native top frame names that column', () => {
  // Arrange: the cited line holds far fewer than 500 characters; the saved observation and its top frame both claim column 500.
  const study = createCrossRuntimeStudy(),
    server = study.observations[1]!
  server.source = { ...server.source, column: 500 }
  server.debugger!.frames[0]!.column = 500

  // Act
  const decoding = (): unknown =>
    decodeConfiguredStudy(study, study.workspaceKey)

  // Assert
  assert.throws(decoding, {
    message:
      'Configured observation source differs from its sealed definition.',
  })
})

test('a saved stop whose column moved is rejected when its native top frame names another column or it sits on another line', () => {
  // Arrange
  const besideFrame = createCrossRuntimeStudy()
  besideFrame.observations[1]!.source = {
    ...besideFrame.observations[1]!.source,
    column: 8,
  }
  const otherLine = createCrossRuntimeStudy()
  otherLine.observations[1]!.source = {
    ...otherLine.observations[1]!.source,
    line: 2,
  }
  otherLine.observations[1]!.debugger!.frames[0]!.line = 2
  // Act / Assert: the frame still says 1:1, so nothing confirms column 8.
  assert.throws(
    () => decodeConfiguredStudy(besideFrame, besideFrame.workspaceKey),
    {
      message: 'Historical debugger differs from its verified source stop.',
    },
  )
  assert.throws(
    () => decodeConfiguredStudy(otherLine, otherLine.workspaceKey),
    {
      message:
        'Configured observation source differs from its sealed definition.',
    },
  )
})

/** A cross-runtime study whose server stop was declared at 1:1, cited over lines 1 to 2 and committed at 2:1, where its saved native top frame also is. @example decodeConfiguredStudy(studyWithMovedServerLine(), workspaceKey) */
const studyWithMovedServerLine = () => {
  const study = createCrossRuntimeStudy(),
    server = study.observations[1]!,
    descriptor = study.descriptor!
  descriptor.anchors[1]!.endLine = 2
  descriptor.citationContext = citationContext(descriptor.anchors)
  server.source = { ...server.source, line: 2 }
  const frame = server.debugger!.frames[0]!
  frame.line = 2
  frame.source!.line = 2
  return study
}

// Value: protects=a study saved with a stop the debugger moved to the next line of its citation reopening with that line and its native values; fails_when=the saved-study check accepts the declared line only and answers "Configured observation source differs from its sealed definition."; why_new=a run never committed a stop on another line before (Cycle 0043, criterion 8a); seam=none
test('a saved stop the debugger bound on a later line within its citation reopens when its native top frame names that line', () => {
  // Arrange
  const study = studyWithMovedServerLine()
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.equal(decoded.observations[1]?.source.line, 2)
  assert.equal(decoded.observations[1]?.source.column, 1)
  assert.equal(decoded.observations[1]?.debugger?.frames[0]?.line, 2)
  assert.equal(decoded.finalOutcome, 'demonstrated')
})

// Value: protects=a saved observation on another line than declared never being trusted on its own word; fails_when=a later line within the citation is accepted although no saved native frame confirms it, or although the frame names another line; why_new=the acceptance of a later line is new (Cycle 0043, criterion 8b); seam=none
test('a saved stop on a later line within its citation is rejected without its native debugger state, and when that state names another line', () => {
  // Arrange
  const withoutDebugger = studyWithMovedServerLine()
  delete withoutDebugger.observations[1]!.debugger
  const besideFrame = studyWithMovedServerLine()
  besideFrame.observations[1]!.debugger!.frames[0]!.line = 1
  // Act / Assert
  assert.throws(
    () => decodeConfiguredStudy(withoutDebugger, withoutDebugger.workspaceKey),
    {
      message:
        'Configured observation source differs from its sealed definition.',
    },
  )
  assert.throws(
    () => decodeConfiguredStudy(besideFrame, besideFrame.workspaceKey),
    { message: 'Historical debugger differs from its verified source stop.' },
  )
})

/** {@link studyWithMovedServerLine} as this release saves it: every observation carries the run's receipt that its binding rule held. @example decodeConfiguredStudy(studyWithBindingReceipts(), workspaceKey) */
const studyWithBindingReceipts = () => {
  const study = studyWithMovedServerLine()
  study.observations[0]!.source.binding = {
    declaredLine: 1,
    boundLine: 1,
    mappedLinesBetween: 0,
  }
  study.observations[1]!.source.binding = {
    declaredLine: 1,
    boundLine: 2,
    mappedLinesBetween: 0,
  }
  return study
}

// Value: protects=a study recording that its run applied the binding rule to a stop on a later line, and reopening with that record; fails_when=the saved receipt is dropped or refused as an unknown field; why_new=Cycle 0043 O3 (the study recorded no rule-L receipt, ER8); seam=none
test('a saved stop on a later line reopens with the binding receipt that names its declared and its bound line', () => {
  // Arrange
  const study = studyWithBindingReceipts()
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.deepEqual(decoded.observations[1]?.source.binding, {
    declaredLine: 1,
    boundLine: 2,
    mappedLinesBetween: 0,
  })
  assert.equal(decoded.observations[1]?.source.line, 2)
})

// Value: protects=a saved observation on a later line never being accepted without the run's record that nothing mapped lay between; fails_when=a later-line observation whose receipt is missing in a study that carries receipts, or whose receipt names other lines, is accepted because its line is inside the citation; why_new=Cycle 0043 O3; seam=none
test('a saved stop on a later line is rejected when its binding receipt is missing beside another observation’s receipt, or names other lines than declared and observed', () => {
  // Arrange
  const missingReceipt = studyWithBindingReceipts()
  delete missingReceipt.observations[1]!.source.binding
  const otherDeclaredLine = studyWithBindingReceipts()
  otherDeclaredLine.observations[1]!.source.binding!.declaredLine = 2
  const otherBoundLine = studyWithBindingReceipts()
  otherBoundLine.observations[1]!.source.binding!.boundLine = 1
  // Act / Assert
  for (const study of [missingReceipt, otherDeclaredLine, otherBoundLine])
    assert.throws(() => decodeConfiguredStudy(study, study.workspaceKey), {
      message:
        'Configured observation binding receipt is missing or differs from its declared and observed lines.',
    })
})

// Value: protects=studies saved before a later line could be accepted decoding to exactly what was saved; fails_when=the new position check changes, drops or rejects an observation on its declared line; why_new=the saved-study position check was rewritten (Cycle 0043, criterion 8d); seam=none
test('a study whose stops were committed on their declared lines decodes to the observations it saved', () => {
  // Arrange: the study an earlier version saved, with the server stop at another column of its declared line.
  const study = createCrossRuntimeStudy(),
    server = study.observations[1]!
  server.source = { ...server.source, column: 8 }
  server.debugger!.frames[0]!.column = 8
  const saved = structuredClone(study.observations)
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.deepEqual(decoded.observations, saved)
})
