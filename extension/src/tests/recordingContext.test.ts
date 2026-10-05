import assert from 'node:assert/strict'
import fsPromises, { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mock, test } from 'node:test'

import { IMAGE_LIMIT_BYTES } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import {
  RecordingStore,
  recordingDiskIo,
  type RecordingIo,
} from '../recordingStore'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { captureStudy } from '../utils/captureStudy'
import { projectRecording } from '../utils/projectRecording'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { ControlledRuntime, createHarness } from './helpers'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
  'base64',
)

/**
 * Combines actual service/archive/recording I/O with a deterministic synthetic runtime clock; it is not native proof.
 * @param io - The recording store's file operations, replaced by a test that makes one of them fail.
 * @param citationEndLine - Last line of the first citation of the article the run starts on. The default cites line 1 only; a test of a stop the debugger moves to line 2 passes 2, and the run then starts on a second revision of the article that cites both lines.
 * @example const harness = await contextHarness()
 */
async function contextHarness(
  io: RecordingIo = recordingDiskIo,
  citationEndLine = 1,
) {
  let clock = 0
  const harness = await createHarness({
    // The runtime takes the definition the service froze, which names the wider citation when one was published.
    create: async (directory, definition) => {
      const runtime = new ControlledRuntime(directory, definition)
      runtime.evidence.elapsedMs = () => clock
      return runtime
    },
  })
  const service = harness.service,
    workspaceKey = sha256(harness.directory),
    directory = join(harness.directory, 'learning')
  const store = new RecordingStore(directory, workspaceKey, {}, io),
    library = new LearningLibrary(directory, workspaceKey)
  service.environment.build.sourceHash = sha256('source-build')
  service.recordings = store
  let configuration = harness.configuration
  // A saved stop on a later line must lie inside its citation, so the article is published again with the wider one.
  if (citationEndLine > 1) {
    const article = await service.repository!.readDefinition('interface', 1),
      document = article.revision.document
    const widened = await service.publishBook({
      instanceId: service.instanceId,
      bookId: 'interface',
      expectedRevision: 1,
      key: 'wider-citation',
      document: {
        ...document,
        nodes: document.nodes.map((node) => ({
          ...node,
          anchors: node.anchors.map((anchor, index) =>
            index === 0 ? { ...anchor, endLine: citationEndLine } : anchor,
          ),
        })),
      },
    })
    configuration = {
      ...configuration,
      book: { ...configuration.book, revision: widened.revision },
    }
  }
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      configuration,
      key: 'recorded',
    }),
    record = service.record(receipt)
  await record.preparation
  assert.ok(record.recording)
  const runtime = harness.runtimes[0]!,
    view = runtime.view.bind(runtime)
  runtime.view = () => ({
    ...view(),
    finalOutcome: 'demonstrated',
    operation: runtime.operation && {
      ...runtime.operation,
      afterVerified: true,
      continuedPause: runtime.snapshot?.pause,
    },
  })
  return {
    ...harness,
    record,
    receipt,
    store,
    library,
    runtime,
    workspaceKey,
    clock(value: number): void {
      clock = value
    },
    async checkpoint() {
      const study = await captureStudy(service, record, workspaceKey)
      assert.ok(study)
      const revision = service.beginHistory(record, study.materialSignature)
      assert.ok(revision)
      await library.saveStudy(study)
      service.reportHistory(record, study.materialSignature, revision, 'saved')
      await service.saveRecordingContext(record, study, revision)
      return { study, revision }
    },
  }
}

/**
 * Puts the committed synthetic snapshot where a debugger bound its stop, with the native top frame at that place: a saved study keeps a position other than the declared one only when that frame confirms it.
 * @param snapshot - The run's committed snapshot, declared at src/theme.ts 1:1.
 * @param place - The line and column the debugger bound and paused at.
 * @param binding - The run's receipt that its binding rule held, which a stop on another line carries.
 * @example bindCommittedSnapshotAt(harness.runtime.snapshots[0]!, { line: 1, column: 7 })
 */
const bindCommittedSnapshotAt = (
  snapshot: ControlledRuntime['snapshots'][number],
  place: { line: number; column: number },
  binding?: NonNullable<
    ControlledRuntime['snapshots'][number]['source']['binding']
  >,
): void => {
  snapshot.source = {
    ...snapshot.source,
    ...place,
    ...(binding && { binding }),
  }
  snapshot.debugger = {
    version: 1,
    frames: [
      {
        name: 'toggleTheme',
        ...place,
        source: {
          name: 'src/theme.ts',
          text: snapshot.source.text,
          hash: snapshot.source.hash,
          line: place.line,
        },
        scopes: [],
      },
    ],
    variables: [],
    limitations: [],
  }
}

test('replay withholds future values and saved interpretations even when their creation date is earlier', async () => {
  // Arrange
  const harness = await contextHarness(),
    { service, record, runtime, store } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'module',
      action: 'repository-click',
    })
    const observed = service.state(record).observations[0]!
    harness.clock(180)
    await service.explain({
      ...harness.receipt,
      key: 'meaning',
      snapshotUri: observed.snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Observed price: 24.',
    })
    harness.clock(250)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const index = await store.read(record.recording!.header.studyId),
      saved = await store.readContext(index.header.studyId)
    // Act
    const before = projectRecording(index, saved.context, 99),
      stop = projectRecording(index, saved.context, 100),
      afterStop = projectRecording(index, saved.context, 140),
      later = projectRecording(index, saved.context, 180)
    // Assert
    assert.equal(before.observation, undefined)
    assert.equal(stop.observation?.values['value:nextTheme'], 'dark')
    // Cycle 0045 (cause 10): at the stop's own recorded time its first explanation is shown although it was saved 80 ms later.
    assert.deepEqual(
      stop.observation?.interpretations.map(
        (interpretation) => interpretation.text,
      ),
      ['Observed price: 24.'],
    )
    assert.equal(stop.laterInterpretations.length, 0)
    // Past that time and before the explanation was saved, it is withheld as before.
    assert.equal(afterStop.observation?.interpretations.length, 0)
    assert.equal(afterStop.laterInterpretations.length, 1)
    assert.equal(
      later.observation?.interpretations[0]?.text,
      'Observed price: 24.',
    )
    assert.equal(saved.context.interpretationAvailability[0]?.elapsedMs, 180)
    assert.equal(runtime.dispatches, 1)
    assert.equal(runtime.releases, 1)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    await harness.close()
  }
})

test('late annotations replace only context and stale context hashes never return different bytes', async () => {
  // Arrange
  const harness = await contextHarness(),
    { service, record, store } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'module',
      action: 'repository-click',
    })
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      earlier = await store.readContext(id),
      journal = await readFile(join(store.path(id), 'frames.jsonl'))
    assert.equal(service.state(record).recordedStudyOutcome, 'demonstrated')
    harness.clock(400)
    // Act
    await service.explain({
      ...harness.receipt,
      key: 'later',
      snapshotUri: service.state(record).observations[0]!.snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Added after the app exited.',
    })
    assert.equal(service.state(record).recordedStudyOutcome, 'pending')
    await harness.checkpoint()
    const latest = await store.readContext(id),
      index = await store.read(id)
    // Assert
    assert.notEqual(latest.hash, earlier.hash)
    await assert.rejects(store.readContext(id, earlier.hash), /stale/)
    assert.deepEqual(
      await readFile(join(store.path(id), 'frames.jsonl')),
      journal,
    )
    assert.equal(index.endMs, 200)
    const projection = projectRecording(index, latest.context, 200)
    assert.equal(projection.observation?.interpretations.length, 0)
    assert.equal(projection.laterInterpretations[0]?.availableMs, 400)
    assert.equal(service.state(record).recordedStudyOutcome, 'demonstrated')
  } finally {
    await harness.close()
  }
})

test('phase confirmation badges appear only after their own receipt and the referenced observation', async () => {
  // Arrange
  const harness = await contextHarness(),
    { runtime, record, service, store } = harness
  try {
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'module',
      action: 'repository-click',
    })
    const pause = runtime.snapshot!.pause
    harness.clock(110)
    runtime.evidence.record('capture.requested', {
      phase: 'paused-browser',
      pause,
    })
    harness.clock(120)
    runtime.evidence.record('capture.response-received', {
      phase: 'paused-browser',
      pause,
      hash: sha256(png),
    })
    record.recording!.frame({
      bytes: png,
      elapsedMs: 120,
      kind: 'phase',
      phase: 'paused-browser',
    })
    harness.clock(200)
    runtime.evidence.record('capture.received', {
      phase: 'paused-browser',
      pause,
      renderer: { hash: sha256(png) },
    })
    harness.clock(250)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const index = await store.read(record.recording!.header.studyId),
      saved = await store.readContext(index.header.studyId)
    // Act
    const pixels = projectRecording(index, saved.context, 120),
      painted = projectRecording(index, saved.context, 200)
    // Assert
    assert.equal(pixels.pauseConfirmed, true)
    assert.equal(pixels.rendererConfirmed, false)
    assert.equal(painted.rendererConfirmed, true)
    assert.equal(
      saved.context.phases.find((phase) => phase.phase === 'paused-browser')
        ?.pixelsMs,
      120,
    )
    assert.equal(
      saved.context.phases.find((phase) => phase.phase === 'paused-browser')
        ?.rendererConfirmedMs,
      200,
    )
  } finally {
    await harness.close()
  }
})

test('known missing intervals hide pixels rather than keeping an apparently current frozen screenshot', async () => {
  // Arrange
  const harness = await contextHarness(),
    { record, service, store } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    record.recording!.stopFrames(100, 'stream lost')
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'input',
      action: 'repository-click',
    })
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const index = await store.read(record.recording!.header.studyId)
    // Act / Assert
    assert.ok(projectRecording(index, undefined, 99).frame)
    assert.equal(projectRecording(index, undefined, 100).frame, undefined)
    assert.equal(projectRecording(index, undefined, 100).missing, 'stream lost')
    assert.equal(service.state(record).recordedStudyOutcome, 'partial')
  } finally {
    await harness.close()
  }
})

test('context storage rejection leaves execution history complete but recorded study partial through repeated GET', async () => {
  // Arrange
  const harness = await contextHarness({
    ...recordingDiskIo,
    async json(path, value, limit) {
      if (path.endsWith('context.json'))
        throw new Error('injected context failure')
      await recordingDiskIo.json(path, value, limit)
    },
  })
  try {
    harness.record.recording!.frame({
      bytes: png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(100)
    harness.service.action({
      ...harness.receipt,
      key: 'input',
      action: 'repository-click',
    })
    await harness.service.stop(harness.receipt)
    // Act
    await harness.checkpoint()
    const state = harness.service.state(harness.record)
    // Assert
    assert.equal(state.studyOutcome, 'demonstrated')
    assert.equal(state.recordedStudyOutcome, 'partial')
    assert.equal(state.recording.contextStatus, 'failed')
    assert.match(
      state.recording.contextReason ?? '',
      /injected context failure/,
    )
    assert.equal(
      (await harness.service.stop(harness.receipt)).recordedStudyOutcome,
      'partial',
    )
    assert.equal(harness.runtime.releases, 1)
  } finally {
    await harness.close()
  }
})

test('a delayed context checkpoint cannot certify newer explanations and does not alter the material signature', async () => {
  // Arrange
  let release: () => void = () => undefined,
    entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  const harness = await contextHarness({
    ...recordingDiskIo,
    async json(path, value, limit) {
      if (path.endsWith('context.json')) {
        entered()
        await waiting
      }
      await recordingDiskIo.json(path, value, limit)
    },
  })
  try {
    harness.record.recording!.frame({
      bytes: png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(100)
    harness.service.action({
      ...harness.receipt,
      key: 'module',
      action: 'repository-click',
    })
    harness.clock(200)
    await harness.service.stop(harness.receipt)
    const pending = harness.checkpoint()
    await started
    assert.equal(
      harness.service.state(harness.record).recordedStudyOutcome,
      'pending',
    )
    // Act
    harness.clock(300)
    await harness.service.explain({
      ...harness.receipt,
      key: 'new',
      snapshotUri: harness.service.state(harness.record).observations[0]!
        .snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Newer checkpoint.',
    })
    const signature = harness.service.state(harness.record).materialSignature
    release()
    await pending
    // Assert
    assert.equal(
      harness.service.state(harness.record).recordedStudyOutcome,
      'pending',
    )
    assert.equal(
      harness.service.state(harness.record).materialSignature,
      signature,
    )
    await harness.checkpoint()
    assert.equal(
      harness.service.state(harness.record).recordedStudyOutcome,
      'demonstrated',
    )
    assert.equal(
      harness.service.state(harness.record).materialSignature,
      signature,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('context rejects source tampering, rewritten availability and a hash from another saved checkpoint', async () => {
  // Arrange
  const harness = await contextHarness()
  try {
    harness.record.recording!.frame({
      bytes: png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(100)
    harness.service.action({
      ...harness.receipt,
      key: 'module',
      action: 'repository-click',
    })
    harness.clock(200)
    await harness.service.stop(harness.receipt)
    const { study, revision } = await harness.checkpoint(),
      context = buildRecordingContext(
        study,
        harness.runtime.evidence.events,
        revision,
      )
    // Act / Assert
    const changed = structuredClone(context)
    changed.study.observations[0]!.source.text = 'changed'
    assert.throws(
      () => validateRecordingContext(changed, harness.workspaceKey),
      /source differs/,
    )
    await assert.rejects(
      harness.store.saveContext({
        ...context,
        studyHash: sha256('wrong checkpoint'),
        historyRevision: revision + 1,
      }),
      /saved study checkpoint/,
    )
    await writeFile(
      join(harness.store.path(context.studyId), 'context.json'),
      JSON.stringify(changed),
    )
    await assert.rejects(
      harness.store.readContext(context.studyId),
      /source differs/,
    )
  } finally {
    await harness.close()
  }
})

test('rediscovery rejects valid JSON recorded values that differ from the saved study checkpoint', async () => {
  // Arrange
  const harness = await contextHarness(),
    { service, record, store } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'module',
      action: 'repository-click',
    })
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      saved = await store.readContext(id)
    saved.context.study.observations[0]!.values['value:nextTheme'] = 'light'
    const corrupt = JSON.stringify(saved.context)
    await writeFile(join(store.path(id), 'context.json'), corrupt)
    // Act / Assert: a new URI cannot turn a parseable changed value into an observed fact.
    await assert.rejects(
      store.readContext(id),
      /differs from the saved study checkpoint/,
    )
    const base = `codebook://${service.instanceId}/studies/${id}/recording`
    await assert.rejects(
      readResource(service, `${base}/context/${sha256(corrupt)}`),
      /differs from the saved study checkpoint/,
    )
    const metadata = await readResource(service, base)
    assert.ok('text' in metadata)
    assert.equal(JSON.parse(metadata.text).contextUri, undefined)
    assert.match(
      JSON.parse(metadata.text).contextReason,
      /differs from the saved study checkpoint/,
    )
    assert.equal(
      (await harness.library.readStudy(id)).observations[0]!.values[
        'value:nextTheme'
      ],
      'dark',
    )
  } finally {
    await harness.close()
  }
})

test('an observation the debugger bound at another column reports the bound position as source beside the declared one as requestedSource', async () => {
  // Arrange: the stop was declared at 1:1 and the committed snapshot sits at 1:7.
  const harness = await contextHarness(),
    { service, record } = harness
  try {
    service.action({
      ...harness.receipt,
      key: 'moved-column',
      action: 'repository-click',
    })
    const committed = harness.runtime.snapshots[0]!
    committed.source = { ...committed.source, column: 7 }
    const observed = service.state(record).observations[0]!
    // Act
    const inspection = await readResource(service, observed.inspectionUri)
    // Assert
    assert.ok('text' in inspection)
    const facts = JSON.parse(JSON.parse(inspection.text).content)
    assert.equal(facts.source.line, 1)
    assert.equal(facts.source.column, 7)
    assert.equal(JSON.stringify(facts.requestedSource), '{"line":1,"column":1}')
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent citing a saved observation at the position the debugger bound; fails_when=the saved learning resource lists only the line and hash, so the bound column and the declared position are lost after shutdown, or copies one of the two places into the other; why_new=Cycle 0036 C02e (only the live inspection resource reported them), and Cycle 0045 X7-E3.3 (both places were expected at 1:1, so a copy passed); seam=none
test('the saved learning resource lists each observation with its source line and column and the declared position as requestedSource', async () => {
  // Arrange: one stop declared at 1:1 is captured where the debugger bound it, at 1:7, and the study is saved.
  const harness = await contextHarness(),
    { service, record } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'saved-position',
      action: 'repository-click',
    })
    bindCommittedSnapshotAt(harness.runtime.snapshots[0]!, {
      line: 1,
      column: 7,
    })
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      metadata = await readResource(
        service,
        `codebook://${service.instanceId}/studies/${id}/recording`,
      )
    assert.ok('text' in metadata)

    // Act
    const learning = await readResource(
      service,
      JSON.parse(metadata.text).learningUri,
    )

    // Assert
    assert.ok('text' in learning)
    const observation = JSON.parse(JSON.parse(learning.text).content)
      .observations[0]
    assert.equal(
      JSON.stringify(observation.source),
      '{"hash":"f117f21caab18af046f2e57a64ff045dd846130ab2e86fbe6c9360cfcc275771","line":1,"column":7}',
    )
    assert.equal(
      JSON.stringify(observation.requestedSource),
      '{"line":1,"column":1}',
    )
    assert.equal(
      JSON.stringify(observation.declaredSource),
      '{"line":1,"column":1}',
    )
    assert.equal('armed' in observation, false)
    assert.equal('place' in observation, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a reader of a saved study learning which line a moved stop paused on from Codebook's own fields, whatever the agent wrote; fails_when=the saved learning resource gives a moved stop no sentence and its explanations no place, so a text that names the declared line stands alone; why_new=Cycle 0045 cause 1 (ER-5 and the decision on PC-1.8, PC-2.6, PC-3.3, PC-4.10, PC-5.7); seam=none
test('the saved learning resource of a stop the debugger moved to the next line says which line it paused on and gives that place with each explanation', async () => {
  // Arrange: the stop declared at src/theme.ts 1:1 is captured at 2:1 inside a citation over lines 1 to 2, explained twice and saved.
  const harness = await contextHarness(recordingDiskIo, 2),
    { service, record } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'moved-line',
      action: 'repository-click',
    })
    bindCommittedSnapshotAt(
      harness.runtime.snapshots[0]!,
      { line: 2, column: 1 },
      { declaredLine: 1, boundLine: 2, mappedLinesBetween: 0 },
    )
    const observed = service.state(record).observations[0]!
    await service.explain({
      ...harness.receipt,
      key: 'at-the-stop',
      snapshotUri: observed.snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation:
        'The stop paused on line 2, where the next theme is dark.',
    })
    await service.explain({
      ...harness.receipt,
      key: 'after-the-result',
      snapshotUri: observed.snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'After the click the label reads Dark.',
    })
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      metadata = await readResource(
        service,
        `codebook://${service.instanceId}/studies/${id}/recording`,
      )
    assert.ok('text' in metadata)

    // Act
    const learning = await readResource(
      service,
      JSON.parse(metadata.text).learningUri,
    )

    // Assert
    assert.ok('text' in learning)
    const observation = JSON.parse(JSON.parse(learning.text).content)
      .observations[0]
    assert.equal(
      observation.place,
      'src/theme.ts: this stop paused on line 2, column 1. You declared line 1 (configuration.source); the debugger bound the breakpoint on line 2. Name line 2 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.',
    )
    assert.equal(
      JSON.stringify(observation.declaredSource),
      '{"line":1,"column":1}',
    )
    assert.equal(observation.source.line, 2)
    assert.equal(observation.source.column, 1)
    // The run requested this stop on its declared line, so the saved receipt names no requested line and the resource no armed place.
    assert.equal('armed' in observation, false)
    assert.equal(observation.interpretations.length, 2)
    assert.equal(
      observation.interpretations[0].text,
      'The stop paused on line 2, where the next theme is dark.',
    )
    assert.equal(
      JSON.stringify(observation.interpretations[0].boundPlace),
      '{"path":"src/theme.ts","declaredLine":1,"boundLine":2,"boundColumn":1}',
    )
    assert.equal(
      observation.interpretations[1].text,
      'After the click the label reads Dark.',
    )
    assert.equal(
      JSON.stringify(observation.interpretations[1].boundPlace),
      '{"path":"src/theme.ts","declaredLine":1,"boundLine":2,"boundColumn":1}',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the saved learning resource naming where the breakpoint was requested as far as the saved receipt holds it; fails_when=a saved stop requested on the first mapped line after its declared line has no armed place, or one with a column the receipt never held; why_new=Cycle 0045 ER-8 as limited by PC-1.4 and PC-5.4 (the receipt keeps the requested line only, and only when it differs); seam=none
test('the saved learning resource of a stop requested on another line than declared gives armed as that line only', async () => {
  // Arrange: the stop declared at src/theme.ts 1:1 was requested on line 2, captured at 2:1, and the study is saved.
  const harness = await contextHarness(recordingDiskIo, 2),
    { service, record } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'requested-on-next-line',
      action: 'repository-click',
    })
    bindCommittedSnapshotAt(
      harness.runtime.snapshots[0]!,
      { line: 2, column: 1 },
      {
        declaredLine: 1,
        requestedLine: 2,
        boundLine: 2,
        mappedLinesBetween: 0,
      },
    )
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      metadata = await readResource(
        service,
        `codebook://${service.instanceId}/studies/${id}/recording`,
      )
    assert.ok('text' in metadata)

    // Act
    const learning = await readResource(
      service,
      JSON.parse(metadata.text).learningUri,
    )

    // Assert
    assert.ok('text' in learning)
    const observation = JSON.parse(JSON.parse(learning.text).content)
      .observations[0]
    assert.equal(JSON.stringify(observation.armed), '{"line":2}')
    assert.equal(
      JSON.stringify(observation.declaredSource),
      '{"line":1,"column":1}',
    )
    assert.equal(
      JSON.stringify(observation.requestedSource),
      '{"line":1,"column":1}',
    )
    assert.equal(observation.source.line, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=a reader of a saved study learning that Codebook, not the debugger, put a stop on the line after the one declared (the line declares the binding the stop requires, or has no mapped position); fails_when=the saved place says the debugger bound the breakpoint on the next line, or names the declared line as the place of the pause; why_new=Cycle 0045 N14d-15 (DX-1 a): such a stop is requested after its own declaring line; seam=none
test('the saved learning resource of a stop Codebook requested after its declared line says Codebook requested the breakpoint on the line it paused on', async () => {
  // Arrange: the stop declared at src/theme.ts 1:1 (`const nextTheme = "dark";`, value:nextTheme required) was requested on line 2, captured at 2:1, and the study is saved.
  const harness = await contextHarness(recordingDiskIo, 2),
    { service, record } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'requested-after-declaring-line',
      action: 'repository-click',
    })
    bindCommittedSnapshotAt(
      harness.runtime.snapshots[0]!,
      { line: 2, column: 1 },
      {
        declaredLine: 1,
        requestedLine: 2,
        boundLine: 2,
        mappedLinesBetween: 0,
      },
    )
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      metadata = await readResource(
        service,
        `codebook://${service.instanceId}/studies/${id}/recording`,
      )
    assert.ok('text' in metadata)

    // Act
    const learning = await readResource(
      service,
      JSON.parse(metadata.text).learningUri,
    )

    // Assert
    assert.ok('text' in learning)
    const observation = JSON.parse(JSON.parse(learning.text).content)
      .observations[0]
    assert.equal(
      observation.place,
      'src/theme.ts: this stop paused on line 2, column 1. You declared line 1 (configuration.source); Codebook requested the breakpoint on line 2 and the debugger bound it on line 2. Name line 2 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.',
    )
    assert.equal(
      JSON.stringify(observation.declaredSource),
      '{"line":1,"column":1}',
    )
    assert.equal(observation.source.line, 2)
  } finally {
    await harness.close()
  }
})

test('ordinary readers discover bounded actual facts and saved explanations without opening debugger graphs', async () => {
  // Arrange
  const harness = await contextHarness(),
    { service, record, store } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'input',
      action: 'repository-click',
    })
    const observed = service.state(record).observations[0]!
    // Act
    const inspection = await readResource(service, observed.inspectionUri)
    assert.ok('text' in inspection)
    const facts = JSON.parse(JSON.parse(inspection.text).content)
    await service.explain({
      ...harness.receipt,
      key: 'explain',
      snapshotUri: observed.snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: '記録した値はdarkです。'.repeat(400),
      learningSummary: {
        title: 'Theme',
        question: 'What theme was captured?',
        summary: 'The captured theme is dark.',
        participants: [{ id: 'control', label: 'Control' }],
        steps: [
          {
            id: 'selected',
            from: 'control',
            to: 'control',
            label: 'Selected theme',
            explanation: 'Dark was captured.',
            evidence: 'observed',
            reference: {
              snapshotUri: observed.snapshotUri,
              sourceHash: sha256('const nextTheme = "dark";\n'),
            },
          },
        ],
      },
    })
    harness.clock(200)
    await service.stop(harness.receipt)
    await harness.checkpoint()
    const id = record.recording!.header.studyId,
      recordingUri = `codebook://${service.instanceId}/studies/${id}/recording`
    const metadata = await readResource(service, recordingUri)
    assert.ok('text' in metadata)
    const links = JSON.parse(metadata.text),
      learning = await readResource(service, links.learningUri)
    assert.ok('text' in learning)
    let page = JSON.parse(learning.text),
      content = page.content,
      pageCount = 1
    while (page.nextUri) {
      const next = await readResource(service, page.nextUri)
      assert.ok('text' in next)
      assert.ok(Buffer.byteLength(next.text) < 10000)
      page = JSON.parse(next.text)
      content += page.content
      pageCount++
    }
    const saved = JSON.parse(content)
    // Assert
    assert.equal(facts.values['value:nextTheme'], 'dark')
    assert.equal(facts.source.hash, sha256('const nextTheme = "dark";\n'))
    assert.equal('debugger' in facts, false)
    assert.equal('text' in facts.source, false)
    assert.ok(pageCount > 1)
    assert.equal(
      saved.observations[0].interpretations[0].text,
      '記録した値はdarkです。'.repeat(400),
    )
    assert.equal(
      saved.learningSummary.content.question,
      'What theme was captured?',
    )
    assert.equal(saved.learningSummary.content.steps[0].label, 'Selected theme')
    assert.equal(saved.studyId, id)
    assert.equal(saved.contextHash, (await store.readContext(id)).hash)
    assert.equal('debugger' in saved.observations[0], false)
    assert.ok('text' in (await readResource(service, links.contextUri)))
    await assert.rejects(
      readResource(
        service,
        links.learningUri.replace(
          service.instanceId,
          '11111111-1111-4111-8111-111111111111',
        ),
      ),
      { code: 'STALE_INSTANCE' },
    )
    await service.explain({
      ...harness.receipt,
      key: 'later',
      snapshotUri: observed.snapshotUri,
      sourceHash: facts.source.hash,
      valuePaths: ['value:nextTheme'],
      interpretation: 'A later annotation.',
    })
    await harness.checkpoint()
    await assert.rejects(readResource(service, links.learningUri), {
      code: 'EVIDENCE_UNAVAILABLE',
    })
    assert.equal(harness.runtime.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('a checkpoint that loses a confirmed phase image while copying it is discarded instead of failing the refresh', async () => {
  // Arrange: preparation confirmed every phase image; the checkpoint snapshots that state before its first file read.
  const harness = await contextHarness(),
    { runtime, record, service, workspaceKey } = harness
  try {
    // Act: the runtime withdraws the after image while the before image is still being read.
    const pending = captureStudy(service, record, workspaceKey)
    delete runtime.captures.after
    const discarded = await pending
    // Assert: the stale copy is dropped like any other changed read; the newer state is left for the next checkpoint.
    assert.equal(discarded, undefined)
    assert.deepEqual(
      service.state(record).captures.map((capture) => capture.phase),
      ['before', 'paused-browser'],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a checkpoint racing a newer run state that withdrew an observation's sealed source; fails_when=the withdrawn source read fails the refresh instead of discarding the stale copy; why_new=Cycle 0044 (0032-T6f / 0033-S7d); seam=ControlledRuntime.source
test('a checkpoint whose observation source is withdrawn while it is read is discarded instead of failing the refresh', async () => {
  // Arrange: one committed observation; reading its source finds it withdrawn by a newer run state.
  const harness = await contextHarness(),
    { runtime, record, service, workspaceKey } = harness
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    service.action({
      ...harness.receipt,
      key: 'input',
      action: 'repository-click',
    })
    assert.equal(service.state(record).observations.length, 1)
    runtime.source = () => {
      delete runtime.captures.after
      return undefined
    }

    // Act
    const discarded = await captureStudy(service, record, workspaceKey)

    // Assert: the stale copy is dropped; the newer state is left for the next checkpoint.
    assert.equal(discarded, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=tampered sealed evidence surfacing even when a newer checkpoint changes state during the same read; fails_when=every EVIDENCE_UNAVAILABLE after a signature change is discarded as withdrawn; why_new=Cycle 0033 M1 (b); seam=none
test('a checkpoint still fails on a tampered phase image when the run state also changes during the read', async () => {
  // Arrange: the saved before image bytes were altered on disk, and the runtime will withdraw another image mid-read.
  const harness = await contextHarness(),
    { runtime, record, service, workspaceKey } = harness
  try {
    await writeFile(
      join(runtime.evidence.directory, 'before.png'),
      Buffer.from('tampered'),
    )
    // Act
    const checkpoint = captureStudy(service, record, workspaceKey)
    delete runtime.captures.after
    // Assert: a concurrent state change must not turn an integrity failure into a silently discarded copy.
    await assert.rejects(checkpoint, {
      code: 'EVIDENCE_UNAVAILABLE',
      message: 'Captured image no longer matches its sealed hash.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=an oversized sealed image surfacing even when a newer checkpoint changes state during the same read; fails_when=the size refusal is a plain evidence error, so the checkpoint silently discards its copy; why_new=Cycle 0034 R3; seam=none
test('a checkpoint still fails on a phase image that outgrew its size limit when the run state also changes during the read', async () => {
  // Arrange: the saved before image now exceeds the image limit, and the runtime will withdraw another image mid-read.
  const harness = await contextHarness(),
    { runtime, record, service, workspaceKey } = harness
  try {
    await writeFile(
      join(runtime.evidence.directory, 'before.png'),
      Buffer.alloc(IMAGE_LIMIT_BYTES + 1),
    )
    // Act
    const checkpoint = captureStudy(service, record, workspaceKey)
    delete runtime.captures.after
    // Assert
    await assert.rejects(checkpoint, {
      code: 'EVIDENCE_UNAVAILABLE',
      message: 'Captured file exceeds 8388608 bytes.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=a sealed image rewritten during its read surfacing even when a newer checkpoint changes state meanwhile; fails_when=the changed-while-reading refusal is a plain evidence error, so the checkpoint silently discards its copy; why_new=Cycle 0034 R3; seam=node:fs/promises open (reports the size from before the rewrite)
test('a checkpoint still fails on a phase image rewritten while it is read when the run state also changes during the read', async () => {
  // Arrange: the before image grows by one byte between the size check and the read, and the runtime will withdraw another image mid-read.
  const harness = await contextHarness(),
    { runtime, record, service, workspaceKey } = harness
  const open = fsPromises.open.bind(fsPromises)
  const opened = mock.method(
    fsPromises,
    'open',
    async (...parameters: Parameters<typeof fsPromises.open>) => {
      const handle = await open(...parameters)
      if (!String(parameters[0]).endsWith('before.png')) return handle
      const stat = handle.stat.bind(handle)
      mock.method(handle, 'stat', async () => {
        const measured = await stat()
        return { ...measured, size: measured.size - 1 }
      })
      return handle
    },
  )
  try {
    // Act
    const checkpoint = captureStudy(service, record, workspaceKey)
    delete runtime.captures.after
    // Assert
    await assert.rejects(checkpoint, {
      code: 'EVIDENCE_UNAVAILABLE',
      message: 'Captured file changed while reading.',
    })
  } finally {
    opened.mock.restore()
    await harness.close()
  }
})

test('a checkpoint still fails when a confirmed phase image no longer matches its sealed hash', async () => {
  // Arrange: the runtime state is unchanged, but the saved before image bytes were altered on disk.
  const harness = await contextHarness(),
    { runtime, record, service, workspaceKey } = harness
  try {
    await writeFile(
      join(runtime.evidence.directory, 'before.png'),
      Buffer.from('tampered'),
    )
    // Act
    const checkpoint = captureStudy(service, record, workspaceKey)
    // Assert: tampered evidence is an integrity failure, not a changed read to discard silently.
    await assert.rejects(checkpoint, {
      code: 'EVIDENCE_UNAVAILABLE',
      message: 'Captured image no longer matches its sealed hash.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that reads how a saved recording is replayed learning what the Study pane shows as a stop's explanation; fails_when=the help still says that only facts available at the selected time appear, although a stop now shows its own explanation with a note about when it was saved; why_new=Cycle 0045 cause 10 (no test pinned this sentence); seam=none
test('the saved-study help says that recorded facts appear from their own time, that a stop shows its own explanation with a note when it was saved later, and that other later explanations stay under Later annotations', async () => {
  // Arrange
  const harness = await createHarness()
  try {
    // Act
    const help = await readResource(harness.service, 'codebook://help/studies')

    // Assert
    assert.ok('text' in help)
    const parsed: { recording: { timing: string } } = JSON.parse(help.text)
    assert.equal(
      parsed.recording.timing,
      "Recorded facts (the application frame, the source, the debugger values and stack, the phases and their confirmations) appear only from their own recorded time. While the selected time lies in a stop's own recorded pause, the Study pane shows that stop's explanation: every explanation saved before that pause ended and the stop's first saved explanation, each with a note when it was saved later than the selected time (while this pause was held, after this pause ended, or after the recording ended); every other explanation saved later stays under \"Later annotations\". Playback does not mark understanding.",
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the README's replay step saying the same as the help about a stop's explanation; fails_when=the step still tells the reader to inspect "later annotations at their recorded times"; why_new=Cycle 0045 cause 10; seam=none
test('the extension README says in its replay step what the Study pane shows as a stop’s explanation, as the help does', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')

  // Act
  const statesRule = readme.includes(
    "Inspect the pause-associated source/values at their recorded times: recorded facts appear only from their own recorded time. While the selected time lies in a stop's own recorded pause, the Study pane shows that stop's explanation: every explanation saved before that pause ended and the stop's first saved explanation, each with a note when it was saved later than the selected time (while this pause was held, after this pause ended, or after the recording ended); every other explanation saved later stays under **Later annotations**.",
  )

  // Assert
  assert.equal(statesRule, true)
  assert.doesNotMatch(readme, /later annotations at their recorded times/)
})
