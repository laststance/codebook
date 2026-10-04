import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
test('updating repository source and extension location preserves recorded bytes and learner history while requesting source review', async () => {
  // Arrange: persist actual archive/recording files; only editor and runtime effects are simulated.
  const harness = await recordedReaderHarness()
  let reloaded: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.reader.understand(true)
    const library = await harness.reader.learningStorage(),
      decisions = (await library.readProgress()).decisions
    // Retire the original writer before freezing immutable bytes for the installation update.
    await harness.service.shutdown()
    await harness.reader.retire(harness.service)
    await harness.reader.dispose()
    const archivePath = join(
        library.directory,
        `${harness.studyId}.study.v3.json`,
      ),
      archiveBefore = await readFile(archivePath)
    const recordingDirectory = harness.store.path(harness.studyId),
      recordingFiles = (await readdir(recordingDirectory)).sort()
    const recordingBefore = await Promise.all(
      recordingFiles.map((file) => readFile(join(recordingDirectory, file))),
    )
    const nextExtension = join(harness.directory, 'codebook-next-install'),
      nextSource = join(harness.directory, 'src', 'theme.ts')
    await mkdir(nextExtension, { recursive: true })
    await writeFile(nextSource, 'const nextTheme = \"light\";\n')

    // Act: a new reader uses the changed installation but the same real persisted workspace store.
    reloaded = harness.createReader(nextExtension)
    await reloaded.open()
    const restored = reloaded.inspect().view!
    const currentSource = await readFile(nextSource, 'utf8')

    // Assert: old evidence and decisions remain exact, while current-source progress needs review.
    assert.equal(restored.model.source.text, 'const nextTheme = "dark";\n')
    assert.equal(restored.model.observation?.values['value:nextTheme'], 'dark')
    assert.equal(currentSource, 'const nextTheme = \"light\";\n')
    assert.equal(restored.model.sourceChanged, true)
    assert.equal(
      harness.watchedPatterns.some(
        (pattern) =>
          pattern.base.endsWith(
            harness.directory.replace(/^\/var\//, '/private/var/') + '/src',
          ) && pattern.pattern === '*',
      ),
      true,
    )
    assert.equal(restored.model.understoodCount, 0)
    assert.equal(restored.model.reviewCount, 1)
    assert.equal(restored.model.selectedUnderstanding.understood, true)
    assert.equal(decisions.length, 1)
    assert.deepEqual((await library.readProgress()).decisions, decisions)
    assert.deepEqual(await readFile(archivePath), archiveBefore)
    assert.deepEqual((await readdir(recordingDirectory)).sort(), recordingFiles)
    assert.deepEqual(
      await Promise.all(
        recordingFiles.map((file) => readFile(join(recordingDirectory, file))),
      ),
      recordingBefore,
    )
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await reloaded?.dispose()
    await harness.close()
  }
})

test('starting a live viewport after closing recorded Study leaves its old film closed and preserves the saved replay position', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    await harness.reader.close()
    // Act
    const liveViewport = harness.reader.presentation.createViewport(
      'next-live-run',
      () => {},
      () => {},
      'normal',
    )
    await harness.controller.settle()
    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.controller.state().studyId, undefined)
    assert.equal(harness.controller.state().readiness, 'idle')
    assert.equal((await harness.store.readPreference())?.positionMs, 100)
    liveViewport.close()
  } finally {
    await harness.close()
  }
})

test('starting a live viewport while recorded Study is open preserves the independently selected film', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    // Act
    const liveViewport = harness.reader.presentation.createViewport(
      'next-live-run',
      () => {},
      () => {},
      'normal',
    )
    await harness.controller.settle()
    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(harness.reader.inspect().view?.contentTab, 'recording')
    assert.equal(harness.controller.state().studyId, harness.studyId)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 100)
    liveViewport.close()
  } finally {
    await harness.close()
  }
})

test('retiring before the next polling tick preserves the last accepted interpretation and terminal state', async (context) => {
  // Arrange: the poll never fires; finalization must explicitly collect the latest service state.
  context.mock.timers.enable({ apis: ['setInterval'] })
  const harness = await workspaceHarness(),
    service = harness.service
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'last-tick',
    })
    const record = service.record(receipt)
    await record.preparation
    service.action({
      instanceId: service.instanceId,
      runId: receipt.runId,
      action: 'repository-click',
      key: 'one',
    })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    await service.explain({
      instanceId: service.instanceId,
      runId: receipt.runId,
      key: 'last-explanation',
      snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The captured price is 24 before this final shutdown.',
    })
    // Act
    await service.shutdown()
    await harness.reader.retire(service)
    const directory = harness.reader.inspect().libraryDirectory!,
      library = new LearningLibrary(directory, directory.split('/').at(-1)!)
    const archives = await library.list(),
      archive = await library.readStudy(archives[0]!.id)
    // Assert
    assert.equal(archives.length, 1)
    assert.equal(archive.terminal, true)
    assert.equal(archive.observations.length, 1)
    assert.equal(
      archive.observations[0]!.interpretations[0]!.text,
      'The captured price is 24 before this final shutdown.',
    )
    assert.equal(
      (await library.readProgress()).decisions.length,
      0,
      'Execution and explanation never mark understanding',
    )
  } finally {
    await harness.close()
    context.mock.timers.reset()
  }
})

test('a successful runtime with a rejected final history write stays partial in both service and reader until Retry', async (context) => {
  // Arrange
  const harness = await workspaceHarness(),
    service = harness.service,
    saveStudy = LearningLibrary.prototype.saveStudy
  let rejectFinal = true
  context.mock.method(
    LearningLibrary.prototype,
    'saveStudy',
    async function (
      this: LearningLibrary,
      study: Parameters<LearningLibrary['saveStudy']>[0],
    ) {
      if (study.terminal && rejectFinal)
        throw new Error('Injected archive size limit')
      return saveStudy.call(this, study)
    },
  )
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = [...service.records.values()][0]!
    await record.preparation
    const runtime = harness.runtimes[0]!,
      view = runtime.view.bind(runtime)
    if (!runtime.snapshot) await harness.reader.action('click')
    runtime.view = () => ({
      ...view(),
      finalOutcome: 'demonstrated',
      resourcesReleased: true,
      cleaned: true,
      operation: {
        ...view().operation!,
        afterVerified: true,
        continuedPause: runtime.snapshot!.pause,
      },
    })
    await harness.reader.open()
    // Act
    await assert.rejects(harness.reader.action('stop'), /archive size limit/)
    const stopped = await service.stop({
        instanceId: service.instanceId,
        runId: record.id,
      }),
      reader = harness.reader.inspect().view!
    // Assert
    assert.equal(stopped.finalOutcome, 'demonstrated')
    assert.equal(stopped.historyOutcome.status, 'failed')
    assert.equal(stopped.studyOutcome, 'partial')
    assert.equal(reader.study?.historyOutcome, 'failed')
    assert.equal(reader.study?.studyOutcome, 'partial')
    rejectFinal = false
    await harness.reader.action('retry')
    assert.equal(service.state(record).studyOutcome, 'demonstrated')
    assert.equal(
      harness.reader.inspect().view!.study?.studyOutcome,
      'demonstrated',
    )
  } finally {
    rejectFinal = false
    context.mock.restoreAll()
    await harness.close()
  }
})

for (const savedEarlier of [false, true])
  test(`retiring a failed final checkpoint stays partial ${savedEarlier ? 'with an older saved projection' : 'without any saved catalog entry'}`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(),
      service = harness.service,
      saveStudy = LearningLibrary.prototype.saveStudy
    let rejecting = !savedEarlier
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        if (rejecting) throw new Error('Injected final checkpoint rejection')
        return saveStudy.call(this, study)
      },
    )
    try {
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = [...service.records.values()][0]!
      await record.preparation
      const runtime = harness.runtimes[0]!,
        originalView = runtime.view.bind(runtime)
      if (!runtime.snapshot) await harness.reader.action('click')
      runtime.view = () => ({
        ...originalView(),
        finalOutcome: 'demonstrated',
        resourcesReleased: true,
        cleaned: true,
        operation: {
          ...originalView().operation!,
          afterVerified: true,
          continuedPause: runtime.snapshot!.pause,
        },
      })
      await harness.reader.open()
      if (savedEarlier) await harness.reader.action('retry')
      rejecting = true
      // Act
      await service.shutdown()
      await assert.rejects(
        harness.reader.retire(service),
        /final reader history was not saved/,
      )
      const retired = harness.reader.inspect().view!
      // Assert
      assert.equal(retired.liveState, undefined)
      assert.equal(retired.studies.length, savedEarlier ? 1 : 0)
      assert.equal(retired.study?.finalOutcome, 'demonstrated')
      assert.equal(retired.study?.historyOutcome, 'failed')
      assert.equal(retired.study?.studyOutcome, 'partial')
      rejecting = false
      await harness.reader.action('retry')
      assert.equal(
        harness.reader.inspect().view!.study?.historyOutcome,
        'saved',
      )
      assert.equal(
        harness.reader.inspect().view!.study?.studyOutcome,
        'demonstrated',
      )
    } finally {
      rejecting = false
      context.mock.restoreAll()
      await harness.close()
    }
  })

test('an interpretation added to an earlier stopped run persists while the later run keeps execution ownership', async () => {
  // Arrange
  const harness = await workspaceHarness(),
    service = harness.service
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const first = [...service.records.values()][0]!
    await first.preparation
    await harness.reader.action('click')
    await harness.reader.open()
    const snapshotUri = service.state(first).participants.browser.snapshotUri!
    await harness.reader.action('stop')
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const second = [...service.records.values()][1]!
    await second.preparation
    // Act
    await service.explain({
      instanceId: service.instanceId,
      runId: first.id,
      key: 'earlier-run-note',
      snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The earlier run captured price 24.',
    })
    await harness.reader.open()
    await harness.reader.action('retry')
    const studyId = `${service.instanceId}_${first.id}`
    await harness.reader['receive'](
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId,
      },
      'moments',
    )
    await waitUntil(
      () =>
        harness.reader.inspect().view!.model.selection.studyId === studyId &&
        !harness.reader.inspect().view!.loading,
      'updated earlier history',
      1_000,
    )
    // Assert
    const history = harness.reader.inspect().view!
    assert.equal(service.state(first).historyOutcome.status, 'saved')
    assert.equal(history.study?.historyOutcome, 'saved')
    assert.equal(
      history.model.observation?.interpretations[0]?.text,
      'The earlier run captured price 24.',
    )
    assert.equal(history.liveState, 'ready')
    assert.equal(second.stopped, false)
    assert.equal(history.model.continueArguments, undefined)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    assert.equal(harness.runtimes[1]!.dispatches, 0)
  } finally {
    await harness.close()
  }
})

test('history selected during a retained run save shows the new explanation before claiming saved evidence', async (context) => {
  // Arrange: freeze polling so the history selection falls between capture and its durable write.
  context.mock.timers.enable({ apis: ['setInterval'] })
  const harness = await workspaceHarness(),
    service = harness.service,
    saveStudy = LearningLibrary.prototype.saveStudy
  let release = (): void => {},
    entered = (): void => {}
  const held = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const first = [...service.records.values()][0]!
    await first.preparation
    await harness.reader.action('click')
    const runtime = harness.runtimes[0]!,
      originalView = runtime.view.bind(runtime)
    if (!runtime.snapshot) await harness.reader.action('click')
    runtime.view = () => ({
      ...originalView(),
      finalOutcome: 'demonstrated',
      resourcesReleased: true,
      cleaned: true,
      operation: {
        ...originalView().operation!,
        afterVerified: true,
        continuedPause: runtime.snapshot!.pause,
      },
    })
    await harness.reader.open()
    await harness.reader.action('stop')
    const snapshotUri = service.state(first).participants.browser.snapshotUri!,
      studyId = `${service.instanceId}_${first.id}`
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const second = [...service.records.values()][1]!
    await second.preparation
    await harness.reader.action('retry')
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        if (
          study.id === studyId &&
          study.observations[0]?.interpretations.length === 1
        ) {
          entered()
          await held
        }
        return saveStudy.call(this, study)
      },
    )
    // Act
    await service.explain({
      instanceId: service.instanceId,
      runId: first.id,
      key: 'selected-during-save',
      snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation:
        'The retained pause captured the dark theme before mutation.',
    })
    await harness.reader.open()
    await started
    await harness.reader['receive'](
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId,
      },
      'moments',
    )
    await waitUntil(
      () =>
        harness.reader.inspect().view!.model.selection.studyId === studyId &&
        !harness.reader.inspect().view!.loading,
      'older history selected during save',
      1_000,
    )
    const pending = harness.reader.inspect().view!
    assert.equal(pending.model.observation?.interpretations.length, 0)
    assert.equal(pending.study?.historyOutcome, 'pending')
    assert.equal(pending.study?.studyOutcome, 'pending')
    release()
    await waitUntil(
      () => service.state(first).historyOutcome.status === 'saved',
      'retained explanation checkpoint saved',
      1_000,
    )
    await harness.reader.open()
    // Assert
    const selected = harness.reader.inspect().view!,
      directory = harness.reader.inspect().libraryDirectory!
    const archive = await new LearningLibrary(
      directory,
      directory.split('/').at(-1)!,
    ).readStudy(studyId)
    assert.equal(selected.model.observation?.interpretations.length, 1)
    assert.equal(
      selected.model.observation?.interpretations[0]?.text,
      'The retained pause captured the dark theme before mutation.',
    )
    assert.equal(
      archive.observations[0]?.interpretations[0]?.text,
      'The retained pause captured the dark theme before mutation.',
    )
    assert.equal(selected.study?.historyOutcome, 'saved')
    assert.equal(selected.study?.studyOutcome, 'demonstrated')
    assert.equal(selected.liveState, 'ready')
    assert.equal(second.stopped, false)
    assert.equal(selected.model.continueArguments, undefined)
  } finally {
    release()
    context.mock.restoreAll()
    await harness.close()
    context.mock.timers.reset()
  }
})

test('a failed latest image checkpoint stays failed and partial while the older captured facts remain readable until Retry', async (context) => {
  // Arrange: the runtime is synthetic; canonical image reads and durable archive writes remain real.
  context.mock.timers.enable({ apis: ['setInterval'] })
  const harness = await workspaceHarness(),
    service = harness.service
  const png = Buffer.from('synthetic-unit-test-pixels')
  let imagePath: string | undefined
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = [...service.records.values()][0]!
    await record.preparation
    await harness.reader.action('click')
    const runtime = harness.runtimes[0]!,
      originalView = runtime.view.bind(runtime)
    imagePath = join(runtime.evidence.directory, 'paused-browser.png')
    await writeFile(imagePath, png)
    runtime.view = () => ({
      ...originalView(),
      finalOutcome: 'demonstrated',
      resourcesReleased: true,
      cleaned: true,
      operation: {
        ...originalView().operation!,
        afterVerified: true,
        continuedPause: runtime.snapshot!.pause,
      },
      captures: {
        ...originalView().captures,
        'paused-browser': {
          status: 'captured',
          file: 'paused-browser.png',
          renderer: { epoch: 'test', id: 1, hash: sha256(png) },
        },
      },
    })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    await service.explain({
      instanceId: service.instanceId,
      runId: record.id,
      key: 'saved-before-image-failure',
      snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The original saved observation has price 24.',
    })
    await harness.reader.open()
    await harness.reader.action('stop')
    const studyId = `${service.instanceId}_${record.id}`,
      directory = harness.reader.inspect().libraryDirectory!
    const library = new LearningLibrary(
        directory,
        directory.split('/').at(-1)!,
      ),
      original = await library.readStudy(studyId)
    const originalImage = original.captures.find(
      (capture) => capture.phase === 'paused-browser',
    )
    assert.equal(original.terminal, true)
    assert.ok(originalImage?.status === 'captured')
    assert.equal(originalImage.base64, png.toString('base64'))
    assert.equal(
      harness.reader.inspect().view!.study?.studyOutcome,
      'demonstrated',
    )
    // Act: a permitted post-stop explanation needs a new projection, but its canonical PNG is now corrupt.
    await service.explain({
      instanceId: service.instanceId,
      runId: record.id,
      key: 'late-after-image-failure',
      snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation:
        'The later explanation also refers to the captured price 24.',
    })
    await writeFile(imagePath, 'corrupted canonical PNG')
    await assert.rejects(
      harness.reader.open(),
      /Captured image no longer matches its sealed hash/,
    )
    await harness.reader.open()
    // Assert: the failure is settled; older readable facts cannot turn it into an indefinite pending state.
    const failed = harness.reader.inspect().view!,
      retained = await library.readStudy(studyId)
    assert.equal(service.state(record).historyOutcome.status, 'failed')
    assert.equal(service.state(record).studyOutcome, 'partial')
    assert.equal(failed.study?.historyOutcome, 'failed')
    assert.equal(failed.study?.studyOutcome, 'partial')
    assert.equal(failed.model.observation?.snapshotUri, snapshotUri)
    assert.equal(failed.model.observation?.values['value:nextTheme'], 'dark')
    assert.equal(failed.model.observation?.interpretations.length, 1)
    assert.equal(
      failed.model.observation?.interpretations[0]?.text,
      'The original saved observation has price 24.',
    )
    assert.equal(failed.model.image?.status, 'captured')
    assert.equal(failed.model.image?.base64, png.toString('base64'))
    assert.equal(retained.materialSignature, original.materialSignature)
    assert.equal(retained.observations[0]?.interpretations.length, 1)
    assert.equal(harness.reader['archiveWrites'].size, 0)
    // Act: recovery is explicit and must collect the new explanation before certifying the saved study.
    await writeFile(imagePath, png)
    await harness.reader.action('retry')
    // Assert
    const recovered = harness.reader.inspect().view!,
      saved = await library.readStudy(studyId)
    assert.equal(service.state(record).historyOutcome.status, 'saved')
    assert.equal(service.state(record).studyOutcome, 'demonstrated')
    assert.equal(recovered.study?.historyOutcome, 'saved')
    assert.equal(recovered.study?.studyOutcome, 'demonstrated')
    assert.equal(recovered.model.observation?.interpretations.length, 2)
    assert.equal(
      recovered.model.observation?.interpretations[1]?.text,
      'The later explanation also refers to the captured price 24.',
    )
    assert.equal(
      saved.observations[0]?.interpretations[1]?.text,
      'The later explanation also refers to the captured price 24.',
    )
    assert.equal(recovered.model.observation?.values['value:nextTheme'], 'dark')
    assert.equal(harness.runtimes.length, 1)
    assert.equal(runtime.dispatches, 1)
  } finally {
    if (imagePath) await writeFile(imagePath, png)
    await harness.close()
    context.mock.timers.reset()
  }
})

test('reopening the reader restores a captured source tab after Close removed it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    await harness.reader.close()
    assert.equal(harness.groups[0]!.tabs.length, 0)
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.groups[0]!.tabs.length, 1)
    const input = harness.groups[0]!.activeTab!.input
    assert.ok('uri' in input)
    assert.match(input.uri.toString(), /Captured-overview\.mts$/)
  } finally {
    await harness.close()
  }
})

test('Close during initialization prevents the pending Open from recreating reader panes', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false),
    readProgress = LearningLibrary.prototype.readProgress
  let entered = (): void => {},
    release = (): void => {}
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  context.mock.method(
    LearningLibrary.prototype,
    'readProgress',
    async function (this: LearningLibrary) {
      entered()
      await held
      return readProgress.call(this)
    },
  )
  try {
    const opening = harness.reader.open()
    await started
    // Act
    await harness.reader.close()
    release()
    await assert.rejects(opening, /closed/)
    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.counts().panels, 0)
  } finally {
    release()
    context.mock.restoreAll()
    await harness.close()
  }
})

test('Study Run requires an editor-agent repository declaration and cannot launch an embedded target', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // Act / Assert
    await assert.rejects(
      harness.reader.action('run'),
      /Ask your editor agent to prepare a study in the open repository/,
    )
    assert.equal(harness.service.records.size, 0)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('a slow archive writer does not delay inspection of the committed live pause', async (context) => {
  // Arrange
  const harness = await workspaceHarness(),
    saveStudy = LearningLibrary.prototype.saveStudy
  let entered = (): void => {},
    release = (): void => {}
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  context.mock.method(
    LearningLibrary.prototype,
    'saveStudy',
    async function (
      this: LearningLibrary,
      study: Parameters<LearningLibrary['saveStudy']>[0],
    ) {
      entered()
      await held
      return saveStudy.call(this, study)
    },
  )
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'slow-library',
    })
    await harness.service.record(receipt).preparation
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: receipt.runId,
      action: 'repository-click',
      key: 'one',
    })
    // Act
    const opening = harness.reader.open()
    await started
    const inspectedWhileSaving = await waitUntil(
      () => {
        const view = harness.reader.inspect().view!
        return (
          !view.loading &&
          view.model.observation?.values['value:nextTheme'] === 'dark' &&
          view.model.matching
        )
      },
      'inspection independent of archive write',
      1_000,
    ).catch(() => false)
    release()
    await opening
    // Assert
    assert.equal(inspectedWhileSaving, true)
  } finally {
    release()
    context.mock.restoreAll()
    await harness.close()
  }
})

test('a cold reader keeps the newer selected study and its observation when an older Retry read completes', async (context) => {
  // Arrange: persist two real archives, then remove the live reader so no current run can repair selection.
  context.mock.timers.enable({ apis: ['setInterval'] })
  const harness = await workspaceHarness(),
    service = harness.service,
    readCheckpoint = LearningLibrary.prototype.readCheckpoint
  let cold: ReturnType<typeof harness.createReader> | undefined,
    retry: Promise<void> | undefined
  let release = (): void => {},
    entered = (): void => {}
  const held = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  try {
    const studyIds: string[] = []
    for (const label of ['A', 'B']) {
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = [...service.records.values()].at(-1)!
      await record.preparation
      await harness.reader.action('click')
      await service.explain({
        instanceId: service.instanceId,
        runId: record.id,
        key: label,
        snapshotUri: service.state(record).participants.browser.snapshotUri!,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation: `Study ${label} captured price 24.`,
      })
      await harness.reader.action('stop')
      studyIds.push(`${service.instanceId}_${record.id}`)
    }
    const firstStudyId = studyIds[0]!,
      secondStudyId = studyIds[1]!
    const secondSnapshotUri = service.state([...service.records.values()][1]!)
      .participants.browser.snapshotUri!
    await service.shutdown()
    await harness.reader.retire(service)
    await harness.reader.dispose()
    cold = harness.createReader()
    await cold.open()
    await cold['receive'](
      {
        type: 'history',
        revision: cold.inspect().view!.revision,
        studyId: firstStudyId,
      },
      'context',
    )
    let firstStudyReads = 0
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        const checkpoint = await readCheckpoint.call(this, id)
        // Retry first reconciles A; hold only its later reload of the selected archive.
        if (id === firstStudyId && ++firstStudyReads === 2) {
          entered()
          await held
        }
        return checkpoint
      },
    )
    // Act
    retry = cold.action('retry')
    await started
    await cold['receive'](
      {
        type: 'history',
        revision: cold.inspect().view!.revision,
        studyId: secondStudyId,
      },
      'context',
    )
    const selectedSourceUri = cold.inspect().sourceUri
    assert.equal(cold.inspect().view!.study?.id, secondStudyId)
    assert.equal(
      cold.inspect().view!.model.observation?.interpretations[0]?.text,
      'Study B captured price 24.',
    )
    release()
    await retry
    // Assert
    const selected = cold.inspect()
    assert.equal(selected.view!.model.selection.studyId, secondStudyId)
    assert.equal(selected.view!.study?.id, secondStudyId)
    assert.equal(
      selected.view!.model.observation?.snapshotUri,
      secondSnapshotUri,
    )
    assert.equal(
      selected.view!.model.observation?.interpretations[0]?.text,
      'Study B captured price 24.',
    )
    assert.equal(
      selected.view!.model.observation?.values['value:nextTheme'],
      'dark',
    )
    assert.equal(selected.sourceUri, selectedSourceUri)
    assert.equal(selected.view!.loading, false)
    assert.equal(selected.view!.errors.length, 0)
    assert.equal(harness.runtimes.length, 2)
  } finally {
    release()
    await retry?.catch(() => undefined)
    context.mock.restoreAll()
    await cold?.dispose()
    await harness.close()
    context.mock.timers.reset()
  }
})

test('a queued checkbox from a previous configured profile cannot change another article understanding or raise an error', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    const library = await harness.reader.learningStorage(),
      decisions = (await library.readProgress()).decisions
    const selection = harness.reader.inspect().view!.model.selection
    // Act: native TreeView can deliver a checkbox event from its previous children list.
    assert.doesNotThrow(() =>
      harness.changeOutlineCheckbox('repository/interface/theme', true),
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    // Assert
    assert.deepEqual((await library.readProgress()).decisions, decisions)
    assert.deepEqual(harness.reader.inspect().view!.model.selection, selection)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    await harness.close()
  }
})

test('an obsolete failed history read cannot downgrade a newer verified reader or API checkpoint', async (context) => {
  // Arrange: the first read observes a real missing sidecar before a later read repairs and verifies it.
  context.mock.timers.enable({ apis: ['setInterval'] })
  const harness = await workspaceHarness(),
    service = harness.service,
    readCheckpoint = LearningLibrary.prototype.readCheckpoint
  let release = (): void => {},
    entered = (): void => {},
    firstRead = true
  let olderSelection: Promise<void> | undefined
  const held = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = [...service.records.values()][0]!
    await record.preparation
    const runtime = harness.runtimes[0]!,
      originalView = runtime.view.bind(runtime)
    if (!runtime.snapshot) await harness.reader.action('click')
    runtime.view = () => ({
      ...originalView(),
      finalOutcome: 'demonstrated',
      resourcesReleased: true,
      cleaned: true,
      operation: {
        ...originalView().operation!,
        afterVerified: true,
        continuedPause: runtime.snapshot!.pause,
      },
    })
    await harness.reader.open()
    await harness.reader.action('stop')
    const studyId = `${service.instanceId}_${record.id}`,
      directory = harness.reader.inspect().libraryDirectory!
    const library = new LearningLibrary(directory, directory.split('/').at(-1)!)
    await unlink(join(directory, `${studyId}.study.meta.v3.json`))
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        const checkpoint = await readCheckpoint.call(this, id)
        if (firstRead) {
          firstRead = false
          assert.equal(checkpoint.status, 'failed')
          entered()
          await held
        }
        return checkpoint
      },
    )
    const revision = harness.reader.inspect().view!.revision
    // Act: await the message boundary directly so the obsolete read finishes before the assertions.
    olderSelection = harness.reader['receive'](
      { type: 'history', revision, studyId },
      'moments',
    )
    await started
    await library.reconcile()
    await harness.reader['receive'](
      { type: 'history', revision, studyId },
      'moments',
    )
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'saved')
    release()
    await olderSelection.catch(() => undefined)
    // Assert
    const selected = harness.reader.inspect().view!
    assert.equal((await readCheckpoint.call(library, studyId)).status, 'saved')
    assert.equal(selected.study?.id, studyId)
    assert.equal(selected.study?.historyOutcome, 'saved')
    assert.equal(selected.study?.studyOutcome, 'demonstrated')
    assert.equal(selected.loading, false)
    assert.equal(service.state(record).historyOutcome.status, 'saved')
    assert.equal(service.state(record).studyOutcome, 'demonstrated')
    assert.equal(selected.errors.length, 0)
  } finally {
    release()
    await olderSelection?.catch(() => undefined)
    context.mock.restoreAll()
    await harness.close()
    context.mock.timers.reset()
  }
})

for (const retired of [false, true])
  test(`failed disk verification downgrades a formerly saved ${retired ? 'retired' : 'attached'} study and Retry restores the exact checkpoint`, async () => {
    // Arrange
    const harness = await workspaceHarness(),
      service = harness.service
    try {
      harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = [...service.records.values()][0]!
      await record.preparation
      const runtime = harness.runtimes[0]!,
        originalView = runtime.view.bind(runtime)
      if (!runtime.snapshot) await harness.reader.action('click')
      runtime.view = () => ({
        ...originalView(),
        finalOutcome: 'demonstrated',
        resourcesReleased: true,
        cleaned: true,
        operation: {
          ...originalView().operation!,
          afterVerified: true,
          continuedPause: runtime.snapshot!.pause,
        },
      })
      await harness.reader.open()
      await harness.reader.action('stop')
      if (retired) {
        await service.shutdown()
        await harness.reader.retire(service)
      }
      const studyId = `${service.instanceId}_${record.id}`
      assert.equal(
        harness.reader.inspect().view!.study?.studyOutcome,
        'demonstrated',
      )
      // Act
      await unlink(
        join(
          harness.reader.inspect().libraryDirectory!,
          `${studyId}.study.meta.v3.json`,
        ),
      )
      await harness.reader['receive'](
        {
          type: 'history',
          revision: harness.reader.inspect().view!.revision,
          studyId,
        },
        'moments',
      )
      await waitUntil(
        () =>
          harness.reader.inspect().view!.study?.historyOutcome === 'failed' &&
          !harness.reader.inspect().view!.loading,
        'failed current checkpoint verification',
        1_000,
      )
      // Assert
      assert.equal(
        harness.reader.inspect().view!.study?.studyOutcome,
        'partial',
      )
      if (!retired) assert.equal(service.state(record).studyOutcome, 'partial')
      await harness.reader.action('retry')
      assert.equal(
        harness.reader.inspect().view!.study?.historyOutcome,
        'saved',
      )
      assert.equal(
        harness.reader.inspect().view!.study?.studyOutcome,
        'demonstrated',
      )
    } finally {
      await harness.close()
    }
  })

test('an older successful save cannot erase the failed final archive from explicit Retry', async (context) => {
  // Arrange
  const harness = await workspaceHarness(),
    saveStudy = LearningLibrary.prototype.saveStudy
  let releaseFirst = (): void => {},
    releaseFinal = (): void => {},
    writes = 0
  const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    }),
    finalHeld = new Promise<void>((resolve) => {
      releaseFinal = resolve
    })
  context.mock.method(
    LearningLibrary.prototype,
    'saveStudy',
    async function (
      this: LearningLibrary,
      study: Parameters<LearningLibrary['saveStudy']>[0],
    ) {
      const attempt = ++writes
      if (attempt === 1) await firstHeld
      if (attempt === 2) {
        await finalHeld
        throw new Error('Final archive write denied')
      }
      return saveStudy.call(this, study)
    },
  )
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'retry-final',
    })
    await harness.service.record(receipt).preparation
    const opening = harness.reader.open()
    await waitUntil(() => writes === 1, 'initial archive write', 1_000)
    // Act
    const stopping = harness.reader.action('stop')
    await waitUntil(
      () => harness.service.record(receipt).stopped,
      'runtime physically stopped',
      1_000,
    )
    releaseFirst()
    await opening
    await waitUntil(() => writes === 2, 'final archive write', 1_000)
    releaseFinal()
    await assert.rejects(stopping, /Final archive write denied/)
    await harness.reader.action('retry')
    // Assert
    const directory = harness.reader.inspect().libraryDirectory!,
      library = new LearningLibrary(directory, directory.split('/').at(-1)!)
    assert.equal(
      (await library.readStudy(`${receipt.instanceId}_${receipt.runId}`))
        .terminal,
      true,
    )
    assert.ok(writes >= 3, 'Retry attempted the pending final projection')
  } finally {
    releaseFirst()
    releaseFinal()
    context.mock.restoreAll()
    await harness.close()
  }
})

test('Close drains an accepted workbench arrangement batch without dispatching another layout change afterward', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    await harness.reader.open()
    const widthsBefore = harness.commands.filter(
      (name) => name === 'workbench.action.evenEditorWidths',
    ).length
    const held = harness.holdNextCommand('vscode.setEditorLayout')
    release = held.release
    const arranging = harness.reader.action('arrange')
    await held.started
    let closed = false
    // Act
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const closedWhileArrangementPending = closed
    held.release()
    await arranging.catch(() => undefined)
    await closing
    // Assert
    assert.equal(closedWhileArrangementPending, false)
    assert.equal(
      harness.commands.filter(
        (name) => name === 'workbench.action.evenEditorWidths',
      ).length,
      widthsBefore,
    )
    assert.equal(harness.reader.inspect().opened, false)
  } finally {
    release()
    await harness.close()
  }
})

test('native transient half-pixel layout sizes are finalized in the workbench before Wiki ownership is verified', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.showTransientNativeSizes()
  try {
    // Act
    await harness.reader.open()
    await harness.reader.arrangeRepository(new AbortController().signal)
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}, {}],
    })
    assert.equal(
      harness.commands.filter((name) => name === 'runCommands').length,
      2,
    )
    assert.equal(
      harness.commands.filter(
        (name) => name === 'workbench.action.evenEditorWidths',
      ).length,
      1,
    )
  } finally {
    await harness.close()
  }
})

for (const command of ['vscode.setEditorLayout'])
  test(`a host-suppressed ${command} failure warns the learner and cannot claim the incomplete layout for a later Wiki return`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.showTransientNativeSizes()
    harness.failNextCommand(command)
    try {
      // Act
      await harness.reader.open()
      const incompleteLayout = harness.editorLayout()
      await harness.reader.arrangeRepository(new AbortController().signal)
      // Assert
      assert.deepEqual(harness.editorLayout(), incompleteLayout)
      assert.equal(
        harness.commands.filter((name) => name === 'runCommands').length,
        1,
      )
      assert.equal(
        harness.reader
          .inspect()
          .view!.errors.includes(
            'Error: The editor did not retain the requested Codebook layout. Use the focus commands or arrange the Codebook panes manually.',
          ),
        true,
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await harness.close()
    }
  })

test('an MCP source reveal rejects a host rendering failure instead of recording a successful reveal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'reveal-failure',
    })
    const record = harness.service.record(receipt)
    await record.preparation
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: receipt.runId,
      action: 'repository-click',
      key: 'one',
    })
    await harness.reader.open()
    const snapshot = harness.service.snapshot(
      record,
      harness.service.state(record).participants.browser.snapshotUri!,
    )
    const held = harness.holdNextSource()
    release = held.release
    // Act
    const revealing = harness.reader.presentation.revealSource(
      snapshot,
      'server.mts',
    )
    await held.started
    held.reject(new Error('Injected host source open failure'))
    // Assert: the reveal is refused, and the pane shows the reason instead of a loading line that would never end.
    await assert.rejects(revealing, /captured source.*not displayed/)
    assert.equal(harness.reader.inspect().view!.loading, false)
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.includes('Error: Injected host source open failure'),
      true,
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=an agent's source reveal succeeding while the reader is already displaying that observation for another request; fails_when=the reveal whose display is superseded by a newer one answers EVIDENCE_UNAVAILABLE "Matching captured source is not displayed" although the source appears a moment later; why_new=Cycle 0044 0036-N06 (the existing reveal tests issue one reveal at a time); seam=workspace harness, held native source open
test('a source reveal whose display is superseded by another reveal of the same observation waits for that display and succeeds', async () => {
  // Arrange: a paused run whose observation the reader shows; the first reveal's source open is held by the editor.
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'reveal-superseded',
    })
    const record = harness.service.record(receipt)
    await record.preparation
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: receipt.runId,
      action: 'repository-click',
      key: 'one',
    })
    await harness.reader.open()
    const snapshot = harness.service.snapshot(
      record,
      harness.service.state(record).participants.browser.snapshotUri!,
    )
    const held = harness.holdNextSource()
    release = held.release
    const first = harness.reader.presentation.revealSource(
      snapshot,
      'server.mts',
    )
    await held.started
    const heldRevision =
      harness.reader.presentationState().reader.contentRevision
    // Act: a second reveal of the same observation starts a newer display before the first one's source opens.
    const second = harness.reader.presentation.revealSource(
      snapshot,
      'server.mts',
    )
    await waitUntil(
      () =>
        harness.reader.presentationState().reader.contentRevision >
        heldRevision,
      'the second reveal to start its display',
      2_000,
    )
    held.release()
    // Assert
    assert.equal(await first, true)
    assert.equal(await second, true)
    assert.equal(harness.reader.inspect().view!.loading, false)
    assert.equal(
      harness.reader.inspect().view!.model.observation?.id,
      snapshot.id,
    )
    assert.match(harness.reader.inspect().sourceUri!, /^codebook-source:/)
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=an agent's source reveal succeeding when it arrives while the reader is still reading the run as it was before the observation was committed; fails_when=the reveal joins that earlier read and answers BUSY "Learner is reading another observation" although the learner follows the current run; why_new=Cycle 0044 0036-N06 (the existing reveal tests reveal only after the reader has settled); seam=workspace harness, held native source open
test('a source reveal that arrives while the reader is still reading the run from before the observation shows that observation', async () => {
  // Arrange: the reader is opening and its first source display is held; the run pauses only after that read began.
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'reveal-during-read',
    })
    const record = harness.service.record(receipt)
    await record.preparation
    const held = harness.holdNextSource()
    release = held.release
    const opening = harness.reader.open()
    await held.started
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: receipt.runId,
      action: 'repository-click',
      key: 'one',
    })
    const snapshot = harness.service.snapshot(
      record,
      harness.service.state(record).participants.browser.snapshotUri!,
    )
    // Act
    const revealing = harness.reader.presentation.revealSource(
      snapshot,
      'server.mts',
    )
    held.release()
    // Assert
    assert.equal(await revealing, true)
    await opening
    assert.equal(
      harness.reader.inspect().view!.model.observation?.id,
      snapshot.id,
    )
    assert.equal(harness.reader.inspect().view!.model.matching, true)
    assert.match(harness.reader.inspect().sourceUri!, /^codebook-source:/)
  } finally {
    release()
    await harness.close()
  }
})
