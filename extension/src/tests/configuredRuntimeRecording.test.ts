import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { POLL_INTERVAL_MS } from '../runtimeSupport/constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { captureStudy } from '../utils/captureStudy'
import { createRecordingObserver } from '../utils/createRecordingObserver'
import { projectRecording } from '../utils/projectRecording'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

for (const failure of ['renderer acknowledgement', 'required inspection'])
  test(`a failed ${failure} retains verified source and available facts offline without granting Continue`, async (context) => {
    // Arrange: real coordinator/storage with controlled protocol failure, not native paint evidence.
    let service: StudyService | undefined,
      books: RepositoryBookStore | undefined
    context.after(async () => {
      await service?.shutdown()
      books?.dispose()
    })
    const harness = await configuredRuntimeHarness(context),
      directory = join(harness.directory, '.learning')
    const library = new LearningLibrary(directory, '0'.repeat(64)),
      store = new RecordingStore(directory, library.workspaceKey)
    books = new RepositoryBookStore(harness.sources, library)
    await books.publish({
      bookId: 'interface',
      expectedRevision: 0,
      key: 'article',
      document: {
        title: 'Interface',
        summary: 'Two citations.',
        nodes: [
          {
            id: 'theme',
            title: 'Theme',
            sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
            anchors: harness.definition.descriptor.anchors,
            observations: [],
          },
        ],
        edges: [],
      },
    })
    service = new StudyService(
      {
        workspace: harness.directory,
        host: {
          id: 'vscode',
          productVersion: 'test',
          apiVersion: 'test',
          commit: 'test',
        },
        build: {
          revision: 'controlled-runtime',
          dirty: false,
          sourceHash: '0'.repeat(64),
        },
        prerequisites: async () => ({ ready: true, missing: [] }),
        createRuntime: async () => harness.run,
      },
      join(harness.directory, '.service'),
    )
    service.repository = books
    service.recordings = store
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'partial',
      configuration: harness.definition.configuration,
    })
    const record = service.record(receipt)
    harness.observeRecording(() => createRecordingObserver(record))
    await record.preparation
    if (failure === 'renderer acknowledgement')
      harness.rejectCapture('paused-browser')
    else harness.requireUnavailableValue()
    // Act
    service.action({ ...receipt, key: 'one', action: 'repository-click' })
    await waitUntil(
      () => harness.run.view().status === 'failed',
      'explicit incomplete observation',
    )
    await service.stop(receipt)
    const archive = await captureStudy(service, record, library.workspaceKey)
    assert.ok(archive)
    const revision = service.beginHistory(record, archive.materialSignature)
    assert.ok(revision)
    await library.saveStudy(archive)
    service.reportHistory(record, archive.materialSignature, revision, 'saved')
    await service.saveRecordingContext(record, archive, revision)
    const restarted = new RecordingStore(directory, library.workspaceKey),
      saved = await restarted.readContext(archive.id),
      index = await restarted.read(archive.id)
    const projection = projectRecording(
      index,
      saved.context,
      index.endMs ?? index.lastVerifiedMs,
    )
    // Assert
    assert.equal(service.state(record).participants.browser.resumable, false)
    assert.equal(
      service.state(record).participants.browser.continueArguments,
      undefined,
    )
    assert.equal(service.state(record).recordedStudyOutcome, 'not-demonstrated')
    assert.equal(archive.observations.length, 1)
    assert.equal(projection.observation, undefined)
    assert.equal(projection.debugger, undefined)
    assert.equal(
      archive.observations[0]!.source.text,
      'const nextTheme = "dark";\n',
    )
    assert.equal(archive.observations[0]!.values['value:enabled'], false)
    assert.equal(archive.observations[0]!.values['value:selection'], null)
    assert.equal(projection.rendererConfirmed, false)
    assert.equal(
      harness.commands.filter((command) => command === 'continue').length,
      0,
    )
    const snapshot = harness.run.view().snapshots[0]!
    await assert.rejects(
      harness.run.continue('browser', snapshot.pause),
      /conflict/,
    )
    if (failure === 'required inspection') {
      assert.equal(snapshot.values['value:nextTheme'], undefined)
      assert.equal(snapshot.unavailableValues[0]?.path, 'value:nextTheme')
    } else {
      assert.equal(snapshot.values['value:nextTheme'], 'dark')
      assert.equal(
        archive.captures.find((capture) => capture.phase === 'paused-browser')
          ?.status,
        'failed',
      )
    }
  })

for (const captureUndefined of [false, true])
  test(`a configured action preserves ${captureUndefined ? 'undefined' : 'string'} facts and explanations through recording restart`, async (context) => {
    // Arrange: controlled native protocols and a synthetic PNG; real coordinator, observer, archive and recording storage.
    let service: StudyService | undefined,
      books: RepositoryBookStore | undefined
    context.after(async () => {
      await service?.shutdown()
      books?.dispose()
    })
    const harness = await configuredRuntimeHarness(context),
      directory = join(harness.directory, '.learning')
    const library = new LearningLibrary(directory, '0'.repeat(64)),
      store = new RecordingStore(directory, library.workspaceKey)
    books = new RepositoryBookStore(harness.sources, library)
    await books.publish({
      bookId: 'interface',
      expectedRevision: 0,
      key: 'article',
      document: {
        title: 'Interface',
        summary: 'Two citations.',
        nodes: [
          {
            id: 'theme',
            title: 'Theme',
            sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
            anchors: harness.definition.descriptor.anchors,
            observations: [],
          },
        ],
        edges: [],
      },
    })
    service = new StudyService(
      {
        workspace: harness.directory,
        host: {
          id: 'vscode',
          productVersion: 'test',
          apiVersion: 'test',
          commit: 'test',
        },
        build: {
          revision: 'controlled-runtime',
          dirty: false,
          sourceHash: '0'.repeat(64),
        },
        prerequisites: async () => ({ ready: true, missing: [] }),
        createRuntime: async () => harness.run,
      },
      join(harness.directory, '.service'),
    )
    service.repository = books
    service.recordings = store
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'record-once',
      configuration: harness.definition.configuration,
    })
    const record = service.record(receipt)
    harness.observeRecording(() => createRecordingObserver(record))
    await record.preparation
    assert.equal(record.error, undefined)
    if (captureUndefined) harness.useUndefinedValue()
    // Act
    service.action({
      ...receipt,
      key: 'click-once',
      action: 'repository-click',
    })
    const snapshot = await waitUntil(
      () => harness.run.view().snapshots[0],
      'configured recorded pause',
    )
    await service.explain({
      ...receipt,
      key: 'observed-value',
      snapshotUri: service.state(record).participants.browser.snapshotUri!,
      sourceHash: harness.definition.configuration.source.hash,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The selected value was captured at this exact pause.',
    })
    await service.continue({
      ...receipt,
      participant: 'browser',
      ...snapshot.pause,
    })
    await waitUntil(
      () => harness.run.view().status === 'completed',
      'configured recorded completion',
    )
    await service.stop(receipt)
    const archive = await captureStudy(service, record, library.workspaceKey)
    assert.ok(archive)
    const revision = service.beginHistory(record, archive.materialSignature)
    assert.ok(revision)
    await library.saveStudy(archive)
    service.reportHistory(record, archive.materialSignature, revision, 'saved')
    await service.saveRecordingContext(record, archive, revision)
    const restarted = new RecordingStore(directory, library.workspaceKey),
      index = await restarted.read(archive.id),
      saved = await restarted.readContext(archive.id)
    const pausePhase = saved.context.phases.find(
      (phase) => phase.phase === 'paused-browser',
    )!
    const projection = projectRecording(
      index,
      saved.context,
      snapshot.elapsedMs,
    )
    // Assert: no manufactured capture events or direct writer.frame calls can conceal a missing production connection.
    assert.equal(service.state(record).recordedStudyOutcome, 'demonstrated')
    assert.equal(index.status, 'finalized')
    assert.deepEqual(
      index.entries
        .filter((entry) => entry.type === 'frame')
        .map((entry) => entry.phase),
      ['before', 'paused-browser', 'after'],
    )
    const pixels = harness.run.evidence.events.filter(
      (event) => event.type === 'capture.response-received',
    )
    const imageHash =
      '13f49d37064e5e9a125e79406f0e4d06a719813a3a3cca585595433c73e9b259'
    assert.deepEqual(
      JSON.parse(JSON.stringify(pixels.map((event) => event.detail))),
      [
        { phase: 'before', hash: imageHash },
        {
          phase: 'paused-browser',
          pause: { sessionId: 'browser-session', threadId: 1, generation: 1 },
          hash: imageHash,
        },
        { phase: 'after', hash: imageHash },
      ],
    )
    assert.equal(pausePhase.pauseVerifiedMs, snapshot.elapsedMs)
    assert.ok(
      pausePhase.rendererConfirmedMs !== undefined &&
        pausePhase.rendererConfirmedMs <= snapshot.elapsedMs,
    )
    assert.equal(projection.pauseConfirmed, true)
    assert.equal(projection.rendererConfirmed, true)
    assert.ok(projection.observation?.actionId === 'repository-click')
    assert.equal(
      projection.observation.source.text,
      'const nextTheme = "dark";\n',
    )
    assert.deepEqual(
      projection.observation.values['value:nextTheme'],
      captureUndefined ? { type: 'undefined' } : 'dark',
    )
    assert.deepEqual(
      saved.context.study.observations[0]?.interpretations[0]?.facts,
      [
        {
          path: 'value:nextTheme',
          value: captureUndefined ? { type: 'undefined' } : 'dark',
        },
      ],
    )
    assert.equal(projection.debugger?.frames[0]?.name, 'configured')
    assert.equal(
      projection.debugger?.variables[0]?.value,
      captureUndefined ? 'undefined' : 'dark',
    )
    assert.equal(
      projectRecording(index, saved.context, index.endMs!).debugger,
      undefined,
    )
    assert.equal(
      projectRecording(index, saved.context, index.endMs!).observation,
      undefined,
    )
  })

for (const differentPixels of [false, true])
  test(`two declared stops checkpoint each pause with ${differentPixels ? 'distinct' : 'identical'} pixels and survive recording restart`, async (context) => {
    // Arrange
    let service: StudyService | undefined,
      books: RepositoryBookStore | undefined
    context.after(async () => {
      await service?.shutdown()
      books?.dispose()
    })
    const harness = await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
    const directory = join(harness.directory, '.learning'),
      library = new LearningLibrary(directory, '0'.repeat(64)),
      store = new RecordingStore(directory, library.workspaceKey)
    books = new RepositoryBookStore(harness.sources, library)
    await books.publish({
      bookId: 'interface',
      expectedRevision: 0,
      key: 'article',
      document: {
        title: 'Interface',
        summary: 'Two citations.',
        nodes: [
          {
            id: 'theme',
            title: 'Theme',
            sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
            anchors: harness.definition.descriptor.anchors,
            observations: [],
          },
        ],
        edges: [],
      },
    })
    service = new StudyService(
      {
        workspace: harness.directory,
        host: {
          id: 'vscode',
          productVersion: 'test',
          apiVersion: 'test',
          commit: 'test',
        },
        build: {
          revision: 'controlled-runtime',
          dirty: false,
          sourceHash: '0'.repeat(64),
        },
        prerequisites: async () => ({ ready: true, missing: [] }),
        createRuntime: async () => harness.run,
      },
      join(harness.directory, '.service'),
    )
    service.repository = books
    service.recordings = store
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'ordered',
      configuration: harness.definition.configuration,
    })
    const record = service.record(receipt)
    harness.observeRecording(() => createRecordingObserver(record))
    await record.preparation
    // Act
    service.action({ ...receipt, key: 'one', action: 'repository-click' })
    const first = await waitUntil(
      () => harness.run.view().participants.browser.snapshot,
      'first stop',
    )
    await service.explain({
      ...receipt,
      key: 'first',
      snapshotUri: service.state(record).participants.browser.snapshotUri!,
      sourceHash: first.source.hash,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The first declared position captures dark.',
    })
    const firstArchive = await captureStudy(
      service,
      record,
      library.workspaceKey,
    )
    assert.ok(firstArchive)
    await library.saveStudy(firstArchive)
    const firstArchiveRevision = service.beginHistory(
      record,
      firstArchive.materialSignature,
    )
    assert.ok(firstArchiveRevision)
    service.reportHistory(
      record,
      firstArchive.materialSignature,
      firstArchiveRevision,
      'saved',
    )
    await service.saveRecordingContext(
      record,
      firstArchive,
      firstArchiveRevision,
    )
    assert.equal(record.recordingReceipt?.status, 'saved')
    const firstImageUri = service.state(record).observations[0]!.imageUri!
    const firstImage = await readResource(service, firstImageUri)
    if (differentPixels)
      harness.setScreenshot(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      )
    const capture = harness.holdCapture('paused-browser')
    await harness.run.continue('browser', first.pause)
    await capture.started
    const pendingArchive = await captureStudy(
      service,
      record,
      library.workspaceKey,
    )
    assert.ok(pendingArchive)
    await library.saveStudy(pendingArchive)
    const pendingArchiveRevision = service.beginHistory(
      record,
      pendingArchive.materialSignature,
    )
    assert.ok(pendingArchiveRevision)
    service.reportHistory(
      record,
      pendingArchive.materialSignature,
      pendingArchiveRevision,
      'saved',
    )
    await service.saveRecordingContext(
      record,
      pendingArchive,
      pendingArchiveRevision,
    )
    assert.equal(record.recordingReceipt?.status, 'saved')
    capture.release()
    const second = await waitUntil(
      () =>
        harness.run.view().snapshots[1] &&
        harness.run.view().participants.browser.snapshot,
      'second stop',
    )
    await service.explain({
      ...receipt,
      key: 'second',
      snapshotUri: service.state(record).participants.browser.snapshotUri!,
      sourceHash: second.source.hash,
      valuePaths: ['value:enabled'],
      interpretation: 'The second declared position captures false.',
    })
    const secondArchive = await captureStudy(
      service,
      record,
      library.workspaceKey,
    )
    assert.ok(secondArchive)
    await library.saveStudy(secondArchive)
    const secondArchiveRevision = service.beginHistory(
      record,
      secondArchive.materialSignature,
    )
    assert.ok(secondArchiveRevision)
    service.reportHistory(
      record,
      secondArchive.materialSignature,
      secondArchiveRevision,
      'saved',
    )
    await service.saveRecordingContext(
      record,
      secondArchive,
      secondArchiveRevision,
    )
    assert.equal(record.recordingReceipt?.status, 'saved')
    assert.deepEqual(await readResource(service, firstImageUri), firstImage)
    const secondImage = await readResource(
      service,
      service.state(record).observations[1]!.imageUri!,
    )
    assert.ok('blob' in firstImage && 'blob' in secondImage)
    assert.equal(firstImage.blob === secondImage.blob, !differentPixels)
    await harness.run.continue('browser', second.pause)
    await waitUntil(
      () => harness.run.view().status === 'completed',
      'after result',
    )
    await service.stop(receipt)
    const archive = await captureStudy(service, record, library.workspaceKey)
    assert.ok(archive)
    const revision = service.beginHistory(record, archive.materialSignature)
    assert.ok(revision)
    await library.saveStudy(archive)
    service.reportHistory(record, archive.materialSignature, revision, 'saved')
    await service.saveRecordingContext(record, archive, revision)
    const restarted = new RecordingStore(directory, library.workspaceKey),
      saved = await restarted.readContext(archive.id),
      index = await restarted.read(archive.id)
    // Assert: identical PNG bytes cannot make the second stop borrow the first phase's identity.
    assert.equal(archive.observations.length, 2)
    assert.equal(archive.finalOutcome, 'demonstrated')
    assert.deepEqual(
      archive.captures
        .filter((image) => image.snapshotId)
        .map((image) => image.snapshotId),
      [first.id, second.id],
    )
    assert.equal(archive.captures.length, 4)
    if (differentPixels) {
      const rewritten = structuredClone(archive),
        firstCapture = rewritten.captures.find(
          (image) => image.snapshotId === first.id,
        ),
        secondCapture = rewritten.captures.find(
          (image) => image.snapshotId === second.id,
        )
      assert.ok(
        firstCapture?.status === 'captured' &&
          secondCapture?.status === 'captured',
      )
      firstCapture.base64 = secondCapture.base64
      firstCapture.hash = secondCapture.hash
      await assert.rejects(
        library.saveStudy(rewritten),
        /Confirmed or failed image history changed/,
      )
    }
    assert.deepEqual(
      saved.context.study.observations.map(
        (observation) => observation.interpretations.length,
      ),
      [1, 1],
    )
    const firstReplay = projectRecording(index, saved.context, first.elapsedMs),
      secondReplay = projectRecording(index, saved.context, second.elapsedMs)
    assert.equal(firstReplay.debugger?.frames[0]?.column, 1)
    assert.equal(secondReplay.debugger?.frames[0]?.column, 7)
    assert.equal(firstReplay.observation?.values['value:nextTheme'], 'dark')
    assert.equal(secondReplay.observation?.values['value:enabled'], false)
    assert.equal(firstReplay.pauseConfirmed, true)
    assert.equal(secondReplay.pauseConfirmed, true)
    assert.deepEqual(
      saved.context.phases
        .filter((phase) => phase.phase === 'paused-browser')
        .map((phase) => phase.snapshotId),
      [first.id, second.id],
    )
    const alteredReceipt = structuredClone(saved.context)
    const secondPhase = alteredReceipt.phases.find(
      (phase) => phase.snapshotId === second.id,
    )
    assert.ok(secondPhase?.requestedMs)
    secondPhase.requestedMs -= 0.1
    alteredReceipt.historyRevision++
    await assert.rejects(
      restarted.saveContext(alteredReceipt),
      /Recorded phase availability changed/,
    )
    assert.deepEqual(await restarted.readContext(archive.id), saved)
    assert.equal(record.recordingReceipt?.status, 'saved')
    assert.equal(harness.mouse.length, 2)
  })

// Value: protects=the end of the recording of a run that completed but whose final save of its events and run record failed: the run fails with that save's error, its journal ends with `run.failed`, and its recording is sealed partial, so the saved study does not claim a complete, demonstrated run whose last evidence is missing; fails_when=the failure of the save that follows the completion reaches `fail()` after the run's state became completed and is ignored there as a late failure (row 41), so nothing records it and the recording is sealed complete (Cycle 0047 row 197); why_new=Cycle 0047 row 197 (S2CXA-C2-3): row 41's tests fail the run only after its final save; seam=the run evidence's save of runtime.json, which fails once, at the save that follows the completion; no_claim=an overflow of the event limit at the completion, which ends in the same failed save
test('a completed run whose final save fails records the failure and seals its recording partial', async (context) => {
  // Arrange: a recorded run of the real coordinator; the save of its run record that follows its completion fails once.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64)),
    store = new RecordingStore(directory, library.workspaceKey)
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  service.recordings = store
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'final-save-fails',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  harness.observeRecording(() => createRecordingObserver(record))
  await record.preparation
  const evidence = harness.run.evidence,
    save = evidence.save.bind(evidence)
  let hasFinalSaveFailed = false
  context.mock.method(
    evidence,
    'save',
    async (...input: Parameters<typeof evidence.save>) => {
      // Only the save that follows the completion fails; the release saves the run record again.
      if (harness.run.view().status === 'completed' && !hasFinalSaveFailed) {
        hasFinalSaveFailed = true
        throw new Error('ENOSPC: no space left on device, write')
      }
      return save(...input)
    },
  )
  service.action({ ...receipt, key: 'click-once', action: 'repository-click' })
  const snapshot = await waitUntil(
    () => harness.run.view().snapshots[0],
    'configured recorded pause',
  )

  // Act: the run continues to its completion, whose final save fails, and is released.
  await service.continue({
    ...receipt,
    participant: 'browser',
    ...snapshot.pause,
  })
  await waitUntil(() => hasFinalSaveFailed, 'the final save of the run')
  await service.stop(receipt)

  // Assert
  assert.deepEqual(
    {
      status: harness.run.view().status,
      failures: [...harness.run.view().failures],
      journaledFailures: harness.run.evidence.events
        .filter((event) => event.type === 'run.failed')
        .map((event) => event.detail),
      recordingSeal: {
        status: record.recordingSeal?.status,
        reason: record.recordingSeal?.reason,
      },
    },
    {
      status: 'failed',
      failures: ['Error: ENOSPC: no space left on device, write'],
      journaledFailures: [
        { reason: 'Error: ENOSPC: no space left on device, write' },
      ],
      recordingSeal: {
        status: 'partial',
        // The seal names the run's own failure (Cycle 0052 task 7a).
        reason:
          'The run failed: ENOSPC: no space left on device, write. Recorded prefix retained.',
      },
    },
  )
})

// Value: protects=the answer an agent gets from its last continuation when the run's final save of its events and run record fails after the run completed: the agent is answered with the failure, which the run ends with (row 197), never with the result; fails_when=the run shows `completed` before its final save settled, so the continuation's wait answers `result` while that save is under way, and the run then fails with that save's error: the agent reports a demonstrated run whose study is saved as failed; why_new=Cycle 0047 row 241 (P2TEST-2): row 197's test continues without waiting for the next state and checks no answer; seam=the run evidence's save of runtime.json, which holds the save that follows the completion across more than one turn of the continuation's wait and then fails it; no_claim=a real full disk
test('an agent waiting on the next state while a completed run’s final save is held and then fails is answered with the failure, not the result', async (context) => {
  // Arrange: a run of the real coordinator; the save of its run record that follows its completion is held and then fails.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64))
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'final-save-held',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  const evidence = harness.run.evidence,
    save = evidence.save.bind(evidence)
  let isFinalSaveHeld = false,
    releaseFinalSave = (): void => {}
  const finalSaveReleased = new Promise<void>((resolve) => {
    releaseFinalSave = resolve
  })
  context.mock.method(
    evidence,
    'save',
    async (...input: Parameters<typeof evidence.save>) => {
      // Only the save that follows the completion is held and fails; the release saves the run record again.
      if (harness.run.view().status === 'completed' && !isFinalSaveHeld) {
        isFinalSaveHeld = true
        await finalSaveReleased
        throw new Error('ENOSPC: no space left on device, write')
      }
      return save(...input)
    },
  )
  service.action({ ...receipt, key: 'click-once', action: 'repository-click' })
  const snapshot = await waitUntil(
    () => harness.run.view().snapshots[0],
    'configured pause',
  )

  // Act: the agent continues and waits for the next state; the final save is held for more than one turn of that wait, then fails.
  const answering = service.continueToNextState({
    ...receipt,
    participant: 'browser',
    ...snapshot.pause,
    answer: 'next',
  })
  await waitUntil(() => isFinalSaveHeld, 'the final save of the run')
  await delay(POLL_INTERVAL_MS * 3)
  releaseFinalSave()
  const answer = await answering

  // Assert
  assert.deepEqual(
    {
      next: 'next' in answer ? answer.next : undefined,
      runStatus: harness.run.view().status,
      failures: [...harness.run.view().failures],
    },
    {
      next: 'failure',
      runStatus: 'failed',
      failures: ['Error: ENOSPC: no space left on device, write'],
    },
  )
  await service.stop(receipt)
})

/**
 * Starts a run of the real coordinator on a configured runtime harness, as an agent starts one beside a published book that cites the harness's source, and waits for its preparation; the service and the book store end with the test.
 * @param context - The test, at whose end the service shuts down and the book store is disposed.
 * @param harness - The configured runtime harness whose run the service drives.
 * @param key - The idempotency key of the start.
 * @returns The service, the start's receipt and the run's record.
 * @example const { service, receipt } = await preparedRunOn(context, harness, 'final-save-polled')
 */
async function preparedRunOn(
  context: TestContext,
  harness: Awaited<ReturnType<typeof configuredRuntimeHarness>>,
  key: string,
) {
  const library = new LearningLibrary(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  const books = new RepositoryBookStore(harness.sources, library)
  const service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  context.after(async () => {
    await service.shutdown()
    books.dispose()
  })
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service.repository = books
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key,
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  return { service, receipt, record }
}

/**
 * Reads the parts of the run resource that tell an agent whether the run has shown its result, as an agent polls it.
 * @param service - The service that answers the resource.
 * @param runUri - The run resource.
 * @returns The run's state, its runtime's state, the runtime's outcome and the observed result; an absent field as `undefined`.
 * @example await polledResult(service, receipt.runUri) // => { state: 'completed', runtimeState: 'completed', runtimeOutcome: 'demonstrated', observed: { afterVerified: true } }
 */
async function polledResult(
  service: StudyService,
  runUri: string,
): Promise<Record<string, unknown>> {
  const content = await readResource(service, runUri)
  const run: Record<string, unknown> =
    'text' in content ? JSON.parse(content.text) : {}
  return {
    state: run.state,
    runtimeState: run.runtimeState,
    runtimeOutcome: run.runtimeOutcome,
    observed: run.observed,
  }
}

// Value: protects=an agent that polls the run resource while a completed run's final save of its events and run record is under way (also one that follows the poll instruction after a continuation that answered without next): it reads no result and no outcome before that save settled; fails_when=the run resource shows the run completed, its runtime outcome demonstrated and observed.afterVerified during that save, so the agent reports a result that the save can still fail (row 197 then fails the run); why_new=Cycle 0047 row 252 (P3CXA-C3, P3TEST-3): row 241 held back only the continuation's answer; seam=the run evidence's save of runtime.json, which holds the save that follows the completion until the test releases it, and the service's maintenance turn, which the test leaves out so that the release of the completed run does not make the run's state read stopping before the poll; no_claim=a real slow disk
test('a poll of the run resource while a completed run’s final save is held shows the run still resuming, with no outcome and no observed result', async (context) => {
  // Arrange: a run of the real coordinator; the save of its run record that follows its completion is held until the poll.
  const harness = await configuredRuntimeHarness(context)
  const { service, receipt } = await preparedRunOn(
    context,
    harness,
    'final-save-polled',
  )
  // The maintenance turn would release the completed run; its state would then read stopping, whatever the save does.
  context.mock.method(service, 'maintain', () => {})
  const evidence = harness.run.evidence,
    save = evidence.save.bind(evidence)
  let isFinalSaveHeld = false,
    releaseFinalSave = (): void => {}
  const finalSaveReleased = new Promise<void>((resolve) => {
    releaseFinalSave = resolve
  })
  context.mock.method(
    evidence,
    'save',
    async (...input: Parameters<typeof evidence.save>) => {
      // Only the save that follows the completion is held; once released it saves as the run asked.
      if (harness.run.view().status === 'completed' && !isFinalSaveHeld) {
        isFinalSaveHeld = true
        await finalSaveReleased
      }
      return save(...input)
    },
  )
  service.action({ ...receipt, key: 'click-once', action: 'repository-click' })
  const snapshot = await waitUntil(
    () => harness.run.view().snapshots[0],
    'configured pause',
  )
  await service.continue({
    ...receipt,
    participant: 'browser',
    ...snapshot.pause,
  })
  await waitUntil(() => isFinalSaveHeld, 'the final save of the run')

  // Act
  const polledDuringTheSave = await polledResult(service, receipt.runUri)
  releaseFinalSave()

  // Assert
  assert.deepEqual(polledDuringTheSave, {
    state: 'resuming',
    runtimeState: 'resuming',
    runtimeOutcome: undefined,
    observed: undefined,
  })
  await service.stop(receipt)
})

// Value: protects=the result of a run whose final save succeeds after it was held: the agent that waits on its last continuation is answered with the result, and a poll after the save shows it; fails_when=the flag of the final save is not cleared after a save that succeeds (configuredBrowserRun.ts observeAfter's finally), so every real completed run reads as saving: the continuation's wait never answers the result and the run resource never shows it; why_new=Cycle 0047 row 252 (P3TEST-2, P3SM-11): only the failed save had a test; seam=the run evidence's save of runtime.json, which holds the save that follows the completion across more than one turn of the continuation's wait and then lets it save; no_claim=a real slow disk
test('an agent waiting on the next state while a completed run’s final save is held and then succeeds is answered with the result, and a poll then shows it', async (context) => {
  // Arrange: a run of the real coordinator; the save of its run record that follows its completion is held, then saves.
  const harness = await configuredRuntimeHarness(context)
  const { service, receipt } = await preparedRunOn(
    context,
    harness,
    'final-save-held-then-saved',
  )
  const evidence = harness.run.evidence,
    save = evidence.save.bind(evidence)
  let isFinalSaveHeld = false,
    releaseFinalSave = (): void => {}
  const finalSaveReleased = new Promise<void>((resolve) => {
    releaseFinalSave = resolve
  })
  context.mock.method(
    evidence,
    'save',
    async (...input: Parameters<typeof evidence.save>) => {
      // Only the save that follows the completion is held; once released it saves as the run asked.
      if (harness.run.view().status === 'completed' && !isFinalSaveHeld) {
        isFinalSaveHeld = true
        await finalSaveReleased
      }
      return save(...input)
    },
  )
  service.action({ ...receipt, key: 'click-once', action: 'repository-click' })
  const snapshot = await waitUntil(
    () => harness.run.view().snapshots[0],
    'configured pause',
  )

  // Act: the agent continues and waits for the next state; the final save is held for more than one turn of that wait, then saves.
  const answering = service.continueToNextState({
    ...receipt,
    participant: 'browser',
    ...snapshot.pause,
    answer: 'next',
  })
  await waitUntil(() => isFinalSaveHeld, 'the final save of the run')
  await delay(POLL_INTERVAL_MS * 3)
  releaseFinalSave()
  const answer = await answering
  // The run's own state may already read stopping or stopped: the service releases a completed run by itself.
  const { runtimeState, runtimeOutcome, observed } = await polledResult(
    service,
    receipt.runUri,
  )

  // Assert
  assert.deepEqual(
    {
      next: 'next' in answer ? answer.next : undefined,
      polledAfterTheSave: { runtimeState, runtimeOutcome, observed },
    },
    {
      next: 'result',
      polledAfterTheSave: {
        runtimeState: 'completed',
        runtimeOutcome: 'demonstrated',
        observed: { afterVerified: true },
      },
    },
  )
  await service.stop(receipt)
})

// Value: protects=the result of a real completed run whose final save settled before the agent's wait looks at it: the wait answers the result at its first look; fails_when=the guard of row 241 holds back the result of every runtime that has a final save to wait for (it asks whether the runtime has isSavingCompletion rather than whether a save is under way), so a real run is never answered with its result, which no test saw because the one test of the result uses a stand-in runtime without isSavingCompletion; why_new=Cycle 0047 row 252 (P3SM-10); seam=the runtime's continue, which returns only once the run completed and its final save settled, so the service's wait begins after it; no_claim=the order of a real adapter's acknowledgement and the run's completion
test('an agent whose last continuation is acknowledged only after the completed run’s final save settled is answered with the result', async (context) => {
  // Arrange: a run of the real coordinator whose runtime acknowledges the last continuation only once the run completed and its final save settled.
  const harness = await configuredRuntimeHarness(context)
  const { service, receipt } = await preparedRunOn(
    context,
    harness,
    'final-save-settled-before-the-wait',
  )
  const continueBefore = harness.run.continue.bind(harness.run)
  context.mock.method(
    harness.run,
    'continue',
    async (...input: Parameters<typeof harness.run.continue>) => {
      await continueBefore(...input)
      await waitUntil(
        () =>
          harness.run.view().status === 'completed' &&
          !harness.run.isSavingCompletion(),
        'the completion and its final save',
      )
    },
  )
  service.action({ ...receipt, key: 'click-once', action: 'repository-click' })
  const snapshot = await waitUntil(
    () => harness.run.view().snapshots[0],
    'configured pause',
  )

  // Act
  const answer = await service.continueToNextState({
    ...receipt,
    participant: 'browser',
    ...snapshot.pause,
    answer: 'next',
  })

  // Assert
  assert.deepEqual(
    {
      next: 'next' in answer ? answer.next : undefined,
      runtimeState: 'state' in answer ? answer.state.runtimeState : undefined,
    },
    { next: 'result', runtimeState: 'completed' },
  )
  await service.stop(receipt)
})

// Value: protects=the recording of a browser run whose preparation was refused names that refusal when it is sealed, so the saved study and the agent read why nothing was recorded; fails_when=the seal reads "Runtime interrupted or cleanup incomplete; recorded prefix retained." for a run that was refused before input and stopped by the agent, as N51's three Cursor runs did (Cycle 0052 task 7a); why_new=the seal had one sentence for any journaled failure and for an incomplete release; seam=the controlled runtime's preparation, which refuses with the route-chunk sentence; no_claim=the native browser and debugger
test('a run refused during its preparation seals its recording with the refusal, not as interrupted', async (context) => {
  // Arrange: a recorded run of the real coordinator whose preparation is refused.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64)),
    store = new RecordingStore(directory, library.workspaceKey)
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  service.recordings = store
  context.mock.method(harness.run, 'prepare', async () => {
    throw new Error(
      'Selected source app/ui/login-form.tsx is not in the client code that the launched page (entryPath "/") loads, and a browser stop can only be armed in that code before input; start the run at the page whose component holds the stop (set entryPath to it) or choose a stop in the launched page\'s own components',
    )
  })
  // The start's idempotency key, named by what this run is for (the pre-gate's secrets scan reads a key literal as a credential).
  const startKey = 'refused-at-preparation'
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: startKey,
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation

  // Act: the agent stops the refused run, as N51's did.
  await service.stop(receipt).catch(() => undefined)
  await waitUntil(() => record.stopped, 'the refused run is released')

  // Assert
  assert.deepEqual(
    {
      status: record.recordingSeal?.status,
      reason: record.recordingSeal?.reason,
    },
    {
      status: 'partial',
      reason:
        'The run failed: Selected source app/ui/login-form.tsx is not in the client code that the launched page (entryPath "/") loads, and a browser stop can only be armed in that code before input; start the run at the page whose component holds the stop (set entryPath to it) or choose a stop in the launched page\'s own components. Recorded prefix retained.',
    },
  )
})

// Value: protects=the recording of a browser run that journaled no failure but whose resources were not released is sealed with the cleanup sentence, so the saved study says the cleanup was incomplete and not that the run failed or was interrupted; fails_when=the sentence changes back to "Runtime interrupted or cleanup incomplete; recorded prefix retained." (Cycle 0052 task 7a) or the unreleased run is sealed without a reason; why_new=no test pins the seal of an incomplete release, only those of journaled failures; seam=the controlled runtime's view, which reports resourcesReleased false; no_claim=a real failed release of the native browser or debugger
test('a run stopped with its resources not released and no failure seals its recording as cleanup incomplete', async (context) => {
  // Arrange: a recorded run of the real coordinator whose view reports that its resources are still held.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64)),
    store = new RecordingStore(directory, library.workspaceKey)
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  service.recordings = store
  const view = harness.run.view.bind(harness.run)
  context.mock.method(harness.run, 'view', () => ({
    ...view(),
    resourcesReleased: false,
  }))
  // The start's idempotency key, named by what this run is for (the pre-gate's secrets scan reads a key literal as a credential).
  const startKey = 'unreleased-resources'
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: startKey,
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation

  // Act: the agent stops the run whose release leaves resources held.
  await service.stop(receipt).catch(() => undefined)
  await waitUntil(() => record.stopped, 'the unreleased run is stopped')

  // Assert
  assert.deepEqual(
    {
      status: record.recordingSeal?.status,
      reason: record.recordingSeal?.reason,
    },
    {
      status: 'partial',
      reason: 'Runtime cleanup incomplete; recorded prefix retained.',
    },
  )
})

// Value: protects=the recording of a browser run whose journaled failure names no reason and that has no error of its own is sealed as a failed run, not as an interrupted one; fails_when=the reasonless failure is sealed with "Runtime interrupted or cleanup incomplete; recorded prefix retained." again or with an empty cause (Cycle 0052 task 7a); why_new=pt3 /ship review (state machines, testing): the reasonless branch of the seal had no test; seam=the controlled runtime's view, which adds a run.failed event without a reason; no_claim=which runtime paths journal a failure without a reason (none known)
test('a run whose journaled failure names no reason seals its recording as a failed run', async (context) => {
  // Arrange: a recorded run of the real coordinator whose view reports a failure without a reason.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64)),
    store = new RecordingStore(directory, library.workspaceKey)
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  service.recordings = store
  const view = harness.run.view.bind(harness.run)
  context.mock.method(harness.run, 'view', () => {
    const current = view()
    const last = current.events.at(-1)
    return last
      ? {
          ...current,
          events: [
            ...current.events,
            { ...last, type: 'run.failed', detail: {} },
          ],
        }
      : current
  })
  // The start's idempotency key, named by what this run is for (the pre-gate's secrets scan reads a key literal as a credential).
  const startKey = 'reasonless-failure'
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: startKey,
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation

  // Act: the agent stops the run.
  await service.stop(receipt).catch(() => undefined)
  await waitUntil(() => record.stopped, 'the run is stopped')

  // Assert
  assert.deepEqual(
    {
      status: record.recordingSeal?.status,
      reason: record.recordingSeal?.reason,
    },
    {
      status: 'partial',
      reason: 'The run failed. Recorded prefix retained.',
    },
  )
})
