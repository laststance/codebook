import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

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

/** Combines actual service/archive/recording I/O with a deterministic synthetic runtime clock; it is not native proof. @example const harness = await contextHarness() */
async function contextHarness(io: RecordingIo = recordingDiskIo) {
  let clock = 0
  const harness = await createHarness({
    create: async (directory) => {
      const runtime = new ControlledRuntime(directory)
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
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
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
      later = projectRecording(index, saved.context, 180)
    // Assert
    assert.equal(before.observation, undefined)
    assert.equal(stop.observation?.values['value:nextTheme'], 'dark')
    assert.equal(stop.observation?.interpretations.length, 0)
    assert.equal(stop.laterInterpretations.length, 1)
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
