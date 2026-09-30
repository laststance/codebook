import { readResource } from '../resources'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { RecordingStore } from '../recordingStore'
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
