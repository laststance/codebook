import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  readerSeams,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
import {
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
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
    const liveViewport = await harness.reader.presentation.createViewport(
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
    const liveViewport = await harness.reader.presentation.createViewport(
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

// Value: protects=the saved time of a study, which the Saved studies list prints and sorts by, changes only when the study's content does; fails_when=retiring the reader writes every study of the editor session again although nothing changed, so each gets the time of the quit (NF-32); why_new=retirement was only tested for a study whose last state was not saved yet; seam=the reader's polling timer, which the test never fires
test('retiring the reader leaves a study whose content did not change since its last save byte-identical, and still writes one that changed', async (context) => {
  // Arrange: the poll never fires. A first run is stopped and saved by Retry storage; a second run is saved at its pause and explained afterwards, which no save has seen.
  context.mock.timers.enable({ apis: ['setInterval'] })
  const harness = await workspaceHarness(),
    service = harness.service
  try {
    const startPausedRun = async (key: string) => {
      const receipt = service.start({
        instanceId: service.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key,
      })
      const record = service.record(receipt)
      await record.preparation
      service.action({
        instanceId: service.instanceId,
        runId: receipt.runId,
        action: 'repository-click',
        key: `${key}-click`,
      })
      return record
    }
    const unchanged = await startPausedRun('unchanged')
    await service.stop({ instanceId: service.instanceId, runId: unchanged.id })
    const changed = await startPausedRun('changed')
    await harness.reader.action('retry')
    const directory = harness.reader.inspect().libraryDirectory!
    const archiveOf = (runId: string): Promise<string> =>
      readFile(
        join(directory, `${service.instanceId}_${runId}.study.v3.json`),
        'utf8',
      )
    const unchangedBefore = await archiveOf(unchanged.id),
      changedBefore = await archiveOf(changed.id)
    await service.explain({
      instanceId: service.instanceId,
      runId: changed.id,
      key: 'explained-after-the-save',
      snapshotUri: service.state(changed).participants.browser.snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The next theme is dark at this pause.',
    })
    // Act
    await service.shutdown()
    await harness.reader.retire(service)
    // Assert
    assert.equal(await archiveOf(unchanged.id), unchangedBefore)
    const changedAfter = await archiveOf(changed.id)
    assert.notEqual(changedAfter, changedBefore)
    assert.equal(
      changedAfter.includes('The next theme is dark at this pause.'),
      true,
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
    await harness.reader.action('stop')
    const stopped = await service.stop({
        instanceId: service.instanceId,
        runId: record.id,
      }),
      reader = harness.reader.inspect().view!
    // Assert: the run stopped, and the rejected write is told once, in the line that Retry answers and not as a refused control (row 280).
    assert.equal(
      reader.errors.includes(
        'Error: History not saved: Error: Injected archive size limit',
      ),
      true,
    )
    assert.equal(readerSeams(harness).hasErrorOfKind('control'), false)
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
        // Retry reconciles A from the library's one listing, not through this method; hold its reload of the selected archive, the first read here.
        if (id === firstStudyId && ++firstStudyReads === 1) {
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
    await stopping
    const linesAfterStop = readerSeams(harness).errorLines(),
      hasControlLineAfterStop = readerSeams(harness).hasErrorOfKind('control')
    await harness.reader.action('retry')
    // Assert: Stop told the denied final write once, in the line that Retry answers and not as a refused control (row 280).
    assert.equal(
      linesAfterStop.includes(
        'Error: History not saved: Error: Final archive write denied',
      ),
      true,
    )
    assert.equal(hasControlLineAfterStop, false)
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
            'Error: The Codebook panes were not arranged: the editor did not keep the layout Codebook applied. Run "Codebook: Arrange Study Workspace" to apply it again.',
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

// Value: protects=the line Retry storage / refresh shows when it could not drop the studies removed by hand from the ledger; fails_when=the same Retry clears that line once its later reconcile and listing succeed, so the learner sees no error while the ledger still names the removed studies; why_new=Cycle 0045 local review study-1 #3 (the failed step and the later steps report under one error kind, and the later success deleted it); seam=the reader's learning storage with a `forgetAbsentStudies` that rejects, and the reader's error lines
test('Retry storage keeps the line of a ledger it could not clean of studies removed by hand, although the rest of the retry succeeds', async () => {
  // Arrange: the ledger cannot be rewritten (another window holds the storage lock); every other storage step works.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const library = await harness.reader.learningStorage()
    library.forgetAbsentStudies = async (): Promise<string[]> => {
      throw new Error('The storage lock is held by another window.')
    }

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(readerSeams(harness).errorLines(), [
      'Error: The storage lock is held by another window.',
    ])
    assert.equal(readerSeams(harness).hasErrorOfKind('archive'), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the study a learner had open as a recording being the one the Study workspace opens on after the editor restarts; fails_when=a recording opened through the status bar's Open replay changes the selection in memory only, so the ledger keeps a study chosen in an earlier session; why_new=Cycle 0045 N14c-F2 (the final VS Code submission reopened on another study after the restart); seam=none
test("a recording opened for the status bar's Open replay is the study the reader opens on after a restart", async () => {
  // Arrange: two saved studies with recordings; the learner last chose the second one in Saved studies.
  const harness = await recordedReaderHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const otherRecord = [...harness.service.records.values()].at(-1)!
    await otherRecord.preparation
    assert.ok(otherRecord.recording)
    otherRecord.recording.frame({
      bytes: harness.png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(1_100)
    await harness.reader.action('click')
    harness.clock(1_200)
    await harness.reader.action('stop')
    const otherStudyId = otherRecord.recording.header.studyId
    await harness.reader['receive'](
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: otherStudyId,
      },
      'context',
    )
    const library = await harness.reader.learningStorage()
    const ledgerBeforeOpen = (await library.readProgress()).selection

    // Act: Open replay names the first study; the editor is then quit and started again.
    await harness.reader.openLearningReplay(harness.studyId)
    const ledgerAfterOpen = (await library.readProgress()).selection
    await harness.reader.dispose()
    restarted = harness.createReader()
    await restarted.open()

    // Assert
    assert.equal(ledgerBeforeOpen?.studyId, otherStudyId)
    assert.equal(ledgerAfterOpen?.studyId, harness.studyId)
    assert.equal(ledgerAfterOpen?.tab, 'live')
    const view = restarted.inspect().view!
    assert.equal(view.model.selection.studyId, harness.studyId)
    assert.equal(view.model.selection.tab, 'live')
    assert.equal(view.study?.id, harness.studyId)
  } finally {
    await restarted?.dispose()
    await harness.close()
  }
})

// Value: protects=the ledger's selection after an Open replay whose load failed; fails_when=the selection of a recording that was never shown is written before its load can still fail, so the restarted reader opens on a study the learner never saw; why_new=Cycle 0045 N14c-F2 (the write is made once a recording is shown, not when its study is first known); seam=the harness's window focus, and node:test setTimeout mock
test(
  'a recording whose load failed leaves the earlier selection in the ledger, and the reader opens on that study after a restart',
  { timeout: 30_000 },
  async (context) => {
    // Arrange: two saved studies with recordings; the learner last chose the second one; the reader is closed and another window keeps the desktop focus.
    const harness = await recordedReaderHarness()
    let restarted: ReturnType<typeof harness.createReader> | undefined
    try {
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const otherRecord = [...harness.service.records.values()].at(-1)!
      await otherRecord.preparation
      assert.ok(otherRecord.recording)
      otherRecord.recording.frame({
        bytes: harness.png,
        elapsedMs: 20,
        kind: 'stream',
      })
      harness.clock(1_100)
      await harness.reader.action('click')
      harness.clock(1_200)
      await harness.reader.action('stop')
      const otherStudyId = otherRecord.recording.header.studyId
      await harness.reader['receive'](
        {
          type: 'history',
          revision: harness.reader.inspect().view!.revision,
          studyId: otherStudyId,
        },
        'context',
      )
      const library = await harness.reader.learningStorage()
      await harness.reader.close()
      harness.changeWindowFocus(false)
      enableFakeClock(context)

      // Act: Open replay names the first study; its load fails after the 10 s wait for the focus, then the editor is started again.
      const opening = harness.reader.openLearningReplay(harness.studyId).then(
        () => 'completed',
        (error: unknown) => String(error),
      )
      await advanceClockUntilSettled(context, opening, 40_000)
      resetFakeClock(context)
      harness.changeWindowFocus(true)
      const loadReadiness = harness.controller.state().readiness
      const ledgerAfterFailedOpen = (await library.readProgress()).selection
      await harness.reader.dispose()
      restarted = harness.createReader()
      await restarted.open()

      // Assert
      assert.equal(await opening, 'completed')
      assert.equal(loadReadiness, 'failed')
      assert.equal(ledgerAfterFailedOpen?.studyId, otherStudyId)
      assert.equal(
        restarted.inspect().view!.model.selection.studyId,
        otherStudyId,
      )
    } finally {
      resetFakeClock(context)
      harness.changeWindowFocus(true)
      await restarted?.dispose()
      await harness.close()
    }
  },
)

// Value: protects=the ledger's selection while a recording's load is overtaken by another recording; fails_when=the overtaken load writes its study to the ledger before it is shown, so an editor quit at that moment reopens on a study that never appeared; why_new=Cycle 0045 N14c-F2 (the write is made once a recording is shown); seam=the reader's recording store with a held playback preference read
test('a recording whose load was replaced by another recording before it was shown never writes its study to the ledger', async () => {
  // Arrange: two saved studies with recordings; the learner last chose the second one; the first recording's load is held after its study was read.
  const harness = await recordedReaderHarness()
  let releaseLoad = (): void => {}
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const otherRecord = [...harness.service.records.values()].at(-1)!
    await otherRecord.preparation
    assert.ok(otherRecord.recording)
    otherRecord.recording.frame({
      bytes: harness.png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(1_100)
    await harness.reader.action('click')
    harness.clock(1_200)
    await harness.reader.action('stop')
    const otherStudyId = otherRecord.recording.header.studyId
    await harness.reader['receive'](
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: otherStudyId,
      },
      'context',
    )
    const library = await harness.reader.learningStorage()
    const readerStore = harness.reader['recordings']
    assert.ok(readerStore)
    const readPreference = readerStore.readPreference
    let enteredHeldRead = (): void => {}
    const heldReadEntered = new Promise<void>((resolve) => {
        enteredHeldRead = resolve
      }),
      loadReleased = new Promise<void>((resolve) => {
        releaseLoad = resolve
      })
    readerStore.readPreference = async () => {
      enteredHeldRead()
      await loadReleased
      return readPreference.call(readerStore)
    }

    // Act: the first recording is opened and held; the second recording replaces it before it is shown.
    await harness.reader.openRecording(harness.studyId)
    await heldReadEntered
    const ledgerWhileFirstLoads = (await library.readProgress()).selection
    Reflect.deleteProperty(readerStore, 'readPreference')
    await harness.reader.openRecording(otherStudyId)
    releaseLoad()
    await harness.controller.settle()
    const ledgerAfterReplacement = (await library.readProgress()).selection

    // Assert
    assert.equal(ledgerWhileFirstLoads?.studyId, otherStudyId)
    assert.equal(harness.controller.state().studyId, otherStudyId)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(ledgerAfterReplacement?.studyId, otherStudyId)
  } finally {
    releaseLoad()
    await harness.close()
  }
})

// Value: protects=the ledger being written once per opened recording; fails_when=the selection is written on every shown position (each seek, pause or Play tick rewrites the ledger file), or an opened recording writes nothing; why_new=Cycle 0045 N14c-F2 (the write is tied to a recording's load, not to its playhead); seam=the reader's learning storage with a recording select
test('every opened recording writes its study to the ledger once, and seeking within it writes nothing more', async () => {
  // Arrange: two saved studies with recordings; every selection the reader writes to the ledger is recorded.
  const harness = await recordedReaderHarness()
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const otherRecord = [...harness.service.records.values()].at(-1)!
    await otherRecord.preparation
    assert.ok(otherRecord.recording)
    otherRecord.recording.frame({
      bytes: harness.png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(1_100)
    await harness.reader.action('click')
    harness.clock(1_200)
    await harness.reader.action('stop')
    const otherStudyId = otherRecord.recording.header.studyId
    const library = await harness.reader.learningStorage()
    const select = library.select.bind(library)
    const writtenStudyIds: (string | undefined)[] = []
    library.select = async (selection): Promise<void> => {
      writtenStudyIds.push(selection.studyId)
      return select(selection)
    }

    // Act: the first recording is opened through Open replay and sought twice, then the second recording is opened.
    await harness.reader.openLearningReplay(harness.studyId)
    for (const positionMs of [100, 20]) {
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs,
      })
      await harness.controller.settle()
    }
    await harness.reader.openLearningReplay(otherStudyId)

    // Assert
    assert.equal(harness.controller.state().studyId, otherStudyId)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(writtenStudyIds, [harness.studyId, otherStudyId])
  } finally {
    await harness.close()
  }
})

// Value: protects=the status bar's Open replay ending within its bound and telling the learner about a failed load while the ledger write of the recording shown before it is still waiting for storage; fails_when=the command awaits that write without a bound, so it outlasts the bound and the failed load's notice waits for the storage lock of another window; why_new=Cycle 0045 FXU item 6 (delegated review of the selection fixer's write); seam=the reader's learning storage with a held selection write, the reader's recording store with a failing read, and node:test setTimeout mock
test(
  'Open replay whose load fails while the ledger write of the recording shown before it is still pending ends within its bound and shows the failure',
  { timeout: 30_000 },
  async (context) => {
    // Arrange: two saved studies with recordings; the first recording is shown and its ledger write stays pending; the second recording's index cannot be read.
    const harness = await recordedReaderHarness()
    let releaseLedgerWrite = (): void => {}
    try {
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const otherRecord = [...harness.service.records.values()].at(-1)!
      await otherRecord.preparation
      assert.ok(otherRecord.recording)
      otherRecord.recording.frame({
        bytes: harness.png,
        elapsedMs: 20,
        kind: 'stream',
      })
      harness.clock(1_100)
      await harness.reader.action('click')
      harness.clock(1_200)
      await harness.reader.action('stop')
      const otherStudyId = otherRecord.recording.header.studyId
      const library = await harness.reader.learningStorage()
      const select = library.select.bind(library)
      const ledgerWriteReleased = new Promise<void>((resolve) => {
        releaseLedgerWrite = resolve
      })
      const heldLedgerWrites: (string | undefined)[] = []
      library.select = async (selection): Promise<void> => {
        heldLedgerWrites.push(selection.studyId)
        await ledgerWriteReleased
        return select(selection)
      }
      await harness.reader.openRecording(harness.studyId)
      await waitUntil(
        () => harness.controller.state().readiness === 'ready',
        'the first recording shown',
        2_000,
      )
      const readerStore = harness.reader['recordings']
      assert.ok(readerStore)
      const read = readerStore.read.bind(readerStore)
      readerStore.read = async (studyId) => {
        if (studyId === otherStudyId)
          throw new Error('The recording index of this study cannot be read.')
        return read(studyId)
      }
      enableFakeClock(context)

      // Act: the status bar's Open replay names the second study.
      const opening = harness.reader.openLearningReplay(otherStudyId).then(
        () => 'completed',
        (error: unknown) => String(error),
      )
      const elapsedMs = await advanceClockUntilSettled(context, opening, 60_000)
      resetFakeClock(context)

      // Assert: the command ended within its bound of 33 s (10 s for the window focus and 23 s for one replay settle), with the first write still pending.
      assert.equal(await opening, 'completed')
      assert.ok(elapsedMs <= 33_250, `ended after ${elapsedMs} ms`)
      assert.deepEqual(heldLedgerWrites, [harness.studyId])
      assert.equal(harness.controller.state().readiness, 'failed')
      assert.deepEqual(harness.errorMessages, [
        'Codebook could not open the learning replay: The recording index of this study cannot be read.',
      ])
    } finally {
      resetFakeClock(context)
      releaseLedgerWrite()
      await harness.close()
    }
  },
)

/**
 * Makes the ledger of every library refuse a learner's decision until the test lets it write again, and counts the attempts.
 * @param context - The test whose mocks the caller restores.
 * @returns `isWritable`, which a test sets once the ledger can be written, and `attempts`, the number of decisions the reader tried to write.
 * @example
 * const ledger = refuseDecisions(context)
 * ledger.isWritable = true // the next decision, or Retry storage / refresh, reaches the ledger
 */
function refuseDecisions(context: TestContext) {
  const decide = LearningLibrary.prototype.decide
  const ledger = { isWritable: false, attempts: 0 }
  context.mock.method(
    LearningLibrary.prototype,
    'decide',
    function (
      this: LearningLibrary,
      decision: Parameters<LearningLibrary['decide']>[0],
    ) {
      ledger.attempts += 1
      return ledger.isWritable
        ? decide.call(this, decision)
        : Promise.reject(new Error('ledger is read-only'))
    },
  )
  return ledger
}

/**
 * Sends the Study pane's understanding choice through the pane's own webview, whose listener shows a rejected message as a control line, and waits until the reader has tried to write it and the listener has run.
 * @param harness - The reader whose open Study pane sends.
 * @param understood - The learner's choice.
 * @param settled - Tells when the reader has handled the choice.
 * @example await chooseUnderstandingInPane(harness, true, () => ledger.attempts === 1)
 */
async function chooseUnderstandingInPane(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
  understood: boolean,
  settled: () => boolean,
): Promise<void> {
  harness.receive({
    type: 'understanding',
    revision: harness.reader.inspect().view!.revision,
    understood,
  })
  await waitUntil(
    () => settled() && !harness.reader.inspect().view!.saving,
    'the understanding choice to be handled',
    1_000,
  )
  // The webview listener reports a rejected message one task after its handling ended.
  await new Promise<void>((resolve) => setImmediate(resolve))
}

// Value: protects=a learner's understanding choice that the ledger refuses: it waits as it was made, the pane tells it in the progress line "Not saved: …" with Retry storage / refresh beside it, nothing is marked meanwhile, and the Retry that writes it saves that very choice and leaves no line; fails_when=the failure is thrown on into a control line beside which no Retry is offered and which outlives the Retry that wrote the choice, or the next ledger read retires the progress line while the choice still waits, or the choice is saved with another item, value or time than the learner's; why_new=Cycle 0046 row 299 (observed with a probe while working on row 280); seam=the Study pane's own webview route and the library's decision write, which fails until the ledger is writable again
test('an understanding choice the ledger refuses waits with the line “Not saved: …” and Retry storage / refresh, marks nothing by itself, and the Retry that writes it saves the choice the learner made and leaves no line', async (context) => {
  // Arrange: a saved study is shown in the Study pane, not marked as understood, and the ledger refuses every decision.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.open()
    const ledger = refuseDecisions(context),
      library = await harness.reader.learningStorage(),
      shown = structuredClone(harness.reader.inspect().view!.model)
    const decisionsBefore = (await library.readProgress()).decisions.length
    // Act: the learner marks the article as understood in the pane and opens the Study workspace again, which reads the ledger, and it can be read; Retry storage / refresh is pressed while the ledger still refuses decisions, and again once it writes.
    const earliestChoiceMs = Date.now()
    await chooseUnderstandingInPane(harness, true, () => ledger.attempts === 1)
    const latestChoiceMs = Date.now()
    await harness.reader.open()
    const whileWaiting = structuredClone({
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
      isShownAsUnderstood:
        harness.reader.inspect().view!.model.selectedUnderstanding.understood,
      decisionsInLedger: (await library.readProgress()).decisions.length,
    })
    await harness.reader.action('retry')
    const afterRefusedRetry = structuredClone({
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
      decisionsInLedger: (await library.readProgress()).decisions.length,
    })
    // The Retry that writes the choice happens measurably later than the choice.
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    ledger.isWritable = true
    await harness.reader.action('retry')
    const saved = structuredClone((await library.readProgress()).decisions)
    // Assert
    assert.equal(decisionsBefore, 0)
    assert.equal(shown.selectedUnderstanding.understood, false)
    assert.deepEqual(whileWaiting, {
      errors: ['Error: Not saved: Error: ledger is read-only'],
      // Retry storage / refresh is offered beside the line.
      unretryableErrorCount: 0,
      isShownAsUnderstood: false,
      decisionsInLedger: 0,
    })
    assert.deepEqual(afterRefusedRetry, {
      // The line of the Retry whose write of the choice failed; Retry is still offered.
      errors: ['Error: ledger is read-only'],
      unretryableErrorCount: 0,
      decisionsInLedger: 0,
    })
    // One decision is saved, the learner's: the article that was shown, understood, on the source and the citations that were shown, at the time of the choice and not of the Retry.
    assert.deepEqual(
      saved.map((decision) => ({
        item: decision.item,
        understood: decision.understood,
        sourceHash: decision.sourceHash,
        context: 'context' in decision ? decision.context : undefined,
      })),
      [
        {
          item: 'repository/interface/theme',
          understood: true,
          sourceHash: shown.source.hash,
          context: shown.selectedUnderstanding.context,
        },
      ],
    )
    const savedAtMs = Date.parse(saved[0]!.at)
    assert.equal(
      earliestChoiceMs <= savedAtMs && savedAtMs <= latestChoiceMs,
      true,
    )
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.errors), [])
    assert.equal(view.model.selectedUnderstanding.understood, true)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the understanding choice that waits to be written when the learner chooses again before Retry: the waiting choice is kept as it was made and saved by Retry, and the learner is told in the progress line that the new choice was not taken and what to press; fails_when=a later choice replaces the one that waits, so the earlier decision of the learner is lost or changed without a word; why_new=Cycle 0046 row 299 (the learner's decision is never lost or changed by the failure); seam=the Study pane's own webview route and the library's decision write, which fails until the ledger is writable again
test('an understanding choice made while an earlier one still waits to be written is not taken and does not replace it: the progress line says so, and Retry storage / refresh saves the earlier choice alone', async (context) => {
  // Arrange: a saved study is shown in the Study pane; the learner marked it as understood while the ledger refused, so that choice waits.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.open()
    const ledger = refuseDecisions(context),
      library = await harness.reader.learningStorage()
    await chooseUnderstandingInPane(harness, true, () => ledger.attempts === 1)
    // Act: a second choice, the opposite one, reaches the reader before Retry; then the ledger writes and the learner presses Retry storage / refresh.
    await chooseUnderstandingInPane(
      harness,
      false,
      () => harness.reader.inspect().view!.errors.length > 0,
    )
    const afterSecondChoice = structuredClone({
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
      attempts: ledger.attempts,
    })
    ledger.isWritable = true
    await harness.reader.action('retry')
    const saved = structuredClone((await library.readProgress()).decisions)
    // Assert
    assert.deepEqual(afterSecondChoice, {
      errors: [
        'Error: Not saved: an earlier understanding choice still waits to be written, and this one was not taken. Press Retry storage / refresh to write the earlier one, then choose again.',
      ],
      unretryableErrorCount: 0,
      // The second choice was never sent to the ledger.
      attempts: 1,
    })
    assert.deepEqual(
      saved.map((decision) => [decision.item, decision.understood]),
      [['repository/interface/theme', true]],
    )
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})
