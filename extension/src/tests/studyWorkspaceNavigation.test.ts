import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { BookObservationBinding } from '../repositorySchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { bookObservationHash } from '../utils/bookObservationHash'

import {
  workspaceHarness,
  recordedReaderHarness,
  readerSeams,
  articleRecordingLayoutHarness,
} from './studyWorkspaceHarness'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

for (const sameHost of [false, true])
  test(`a Wiki observation link opens its exact earlier same-item pause ${sameHost ? 'beside the active archive' : 'after host restart'} and newer history choices retire that reading point`, async (context) => {
    // Arrange
    const harness = await recordedReaderHarness()
    let reader: ReturnType<typeof harness.createReader> | undefined
    try {
      // A later editor host reads sealed history without the original run's active in-memory archive.
      if (sameHost) reader = harness.reader
      else {
        await harness.reader.dispose()
        reader = harness.createReader()
      }
      const library = await reader.learningStorage()
      const checkpoint = await library.readCheckpoint(harness.studyId),
        original = checkpoint.study.observations[0]!,
        observations = [
          {
            ...original,
            id: 'linked-earlier',
            values: { ...original.values, 'value:linkedMarker': 'earlier' },
          },
          {
            ...original,
            id: 'linked-middle',
            values: { ...original.values, 'value:linkedMarker': 'middle' },
          },
          {
            ...original,
            id: 'linked-latest',
            values: { ...original.values, 'value:linkedMarker': 'latest' },
          },
        ],
        study = { ...checkpoint.study, observations },
        observation = observations[0]!,
        binding: BookObservationBinding = {
          nodeId: 'module',
          linkIndex: 1,
          studyId: study.id,
          observationId: observation.id,
          sourceHash: observation.source.hash,
          itemId: observation.itemId,
          observationHash: bookObservationHash(observation),
          elapsedMs: observation.elapsedMs,
          outcome: study.finalOutcome,
        }
      // The existing checkpoint boundary supplies several sealed captures of one configured item.
      context.mock.method(library, 'readCheckpoint', async () => ({
        ...checkpoint,
        study,
      }))

      // Act
      await reader.openRepositoryEvidence(binding, false)
      const selected = reader.inspect().view!
      await assert.rejects(
        reader.openRepositoryEvidence(
          { ...binding, observationId: 'missing-linked-pause' },
          false,
        ),
        /exact saved checkpoint/,
      )
      const afterRefusal = reader.inspect().view!

      // Assert
      assert.equal(selected.model.observation?.id, 'linked-earlier')
      assert.equal(
        selected.model.observation?.values['value:linkedMarker'],
        'earlier',
      )
      assert.equal(selected.model.source.line, 1)
      assert.equal(afterRefusal.model.observation?.id, 'linked-earlier')
      assert.equal(
        afterRefusal.model.observation?.values['value:linkedMarker'],
        'earlier',
      )
      assert.equal(selected.model.selection.follow, false)
      assert.equal(selected.model.continueArguments, undefined)
      assert.equal(harness.runtimes[0]!.dispatches, 1)
      assert.equal((await library.readProgress()).decisions.length, 0)
      if (sameHost) {
        // An explicit learner selection retires the exact visit and restores the ordinary active-archive choice.
        await reader.select(binding.itemId)
        assert.equal(reader.inspect().view?.model.observation?.id, original.id)
        assert.equal(
          reader.inspect().view?.model.observation?.values[
            'value:linkedMarker'
          ],
          undefined,
        )
      }
      // Closing retires this visit; ordinary later history projection keeps its default newest capture.
      await reader.close()
      if (sameHost) {
        assert.equal(reader.inspect().view?.model.observation?.id, original.id)
        assert.equal(
          reader.inspect().view?.model.observation?.values[
            'value:linkedMarker'
          ],
          undefined,
        )
      } else {
        assert.equal(
          reader.inspect().view?.model.observation?.id,
          'linked-latest',
        )
        assert.equal(
          reader.inspect().view?.model.observation?.values[
            'value:linkedMarker'
          ],
          'latest',
        )
      }
      {
        // A new exact visit after Close is retired independently by the Node-history admission.
        await reader.openRepositoryEvidence(binding, false)
        assert.equal(
          reader.inspect().view?.model.observation?.id,
          'linked-earlier',
        )
        // Admitting an isolated Node journal is a different history choice while browser selection stays unchanged.
        const header = nodeTestHistoryHeader(library.workspaceKey),
          writer = await harness.service.nodeHistoryStore!.start(header)
        // Partial journals are readable history choices; this fixture claims no executed stop or result.
        await writer.finish(
          'partial',
          'Owned test fixture has no execution evidence.',
        )
        await readerSeams({ reader }).receive(
          {
            type: 'node-history',
            revision: reader.inspect().view!.revision,
            studyId: header.studyId,
          },
          'context',
        )
        assert.equal(
          reader.inspect().view?.nodeHistory?.header.studyId,
          header.studyId,
        )
        if (sameHost) {
          assert.equal(
            reader.inspect().view?.model.observation?.id,
            original.id,
          )
          assert.equal(
            reader.inspect().view?.model.observation?.values[
              'value:linkedMarker'
            ],
            undefined,
          )
        } else {
          assert.equal(
            reader.inspect().view?.model.observation?.id,
            'linked-latest',
          )
          assert.equal(
            reader.inspect().view?.model.observation?.values[
              'value:linkedMarker'
            ],
            'latest',
          )
        }
      }
    } finally {
      await reader?.dispose()
      await harness.close()
    }
  })

test('book evidence opens the exact historical observation and retains a restart-safe Return to Wiki target', async () => {
  // Arrange
  const harness = await recordedReaderHarness(),
    library = await harness.reader.learningStorage()
  try {
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    await library.selectRepository({
      bookId: 'architecture',
      revision: 1,
      nodeId: 'module',
      anchorIndex: 0,
      location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-1' },
    })
    // Act
    await harness.reader.openRepositoryEvidence(binding, false)
    const view = harness.reader.inspect().view!
    // Assert
    assert.equal(view.model.observation?.id, observation.id)
    assert.equal(view.model.selection.follow, false)
    assert.equal(view.model.continueArguments, undefined)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    assert.equal(
      (await library.readProgress()).repositorySelection?.location?.fraction,
      0.5,
    )
    assert.equal((await library.readProgress()).decisions.length, 0)
  } finally {
    await harness.close()
  }
})

test('book recording links seek the exact captured observation time while playback stays paused and runtime input stays unchanged', async () => {
  // Arrange
  const harness = await recordedReaderHarness(),
    library = await harness.reader.learningStorage()
  try {
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    // Act
    await harness.reader.openRepositoryEvidence(binding, true)
    const view = harness.reader.inspect().view!
    // Assert
    assert.equal(view.model.observation?.id, observation.id)
    assert.equal(view.recording?.presentedMs, 100)
    assert.equal(view.recording?.mode, 'paused')
    assert.equal(view.model.continueArguments, undefined)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    assert.equal((await library.readProgress()).decisions.length, 0)
  } finally {
    await harness.close()
  }
})

for (const recording of [false, true])
  test(`Wiki ${recording ? 'recording' : 'observation'} and explicit Study entry keep hidden navigation panes hidden until requested`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(),
      library = await harness.reader.learningStorage()
    try {
      const study = await library.readStudy(harness.studyId),
        observation = study.observations[0]!
      const binding: BookObservationBinding = {
        nodeId: 'module',
        linkIndex: 0,
        studyId: study.id,
        observationId: observation.id,
        sourceHash: observation.source.hash,
        itemId: observation.itemId,
        observationHash: bookObservationHash(observation),
        elapsedMs: observation.elapsedMs,
        outcome: study.finalOutcome,
      }
      harness.commands.length = 0
      // Act
      await harness.reader.openRepositoryEvidence(binding, recording)
      const evidenceNavigation = harness.commands.filter(
        (name) =>
          name === 'codebook.learningOutline.focus' ||
          name === 'codebook.observedMoments.focus',
      )
      await harness.reader.open()
      // Assert
      assert.deepEqual(evidenceNavigation, [])
      assert.deepEqual(
        harness.commands.filter(
          (name) =>
            name === 'codebook.learningOutline.focus' ||
            name === 'codebook.observedMoments.focus',
        ),
        [],
      )
      assert.equal(
        harness.reader.inspect().view!.model.observation?.id,
        observation.id,
      )
      assert.equal(harness.runtimes[0]!.dispatches, 1)
      assert.equal((await library.readProgress()).decisions.length, 0)
      await harness.reader.action('outline')
      assert.deepEqual(
        harness.commands.filter(
          (name) =>
            name === 'codebook.learningOutline.focus' ||
            name === 'codebook.observedMoments.focus',
        ),
        ['codebook.learningOutline.focus'],
      )
    } finally {
      await harness.close()
    }
  })

for (const recording of [false, true])
  test(`explicit Open Study preserves hidden navigation while a Wiki ${recording ? 'recording' : 'observation'} entry waits for source`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(),
      library = await harness.reader.learningStorage()
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    harness.commands.length = 0
    const source = harness.holdNextSource()
    const navigation = harness.reader.openRepositoryEvidence(binding, recording)
    try {
      await source.started
      // Act
      await harness.reader.open()
      // Assert
      assert.deepEqual(
        harness.commands.filter(
          (name) =>
            name === 'codebook.learningOutline.focus' ||
            name === 'codebook.observedMoments.focus',
        ),
        [],
      )
    } finally {
      source.release()
      await navigation
      await harness.close()
    }
  })

test('book evidence rejects a changed captured observation before selecting history or opening replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(),
    library = await harness.reader.learningStorage()
  try {
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: '0'.repeat(64),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    // Act / Assert
    await assert.rejects(
      harness.reader.openRepositoryEvidence(binding, false),
      /exact saved checkpoint/,
    )
    await assert.rejects(
      harness.reader.openRepositoryEvidence(binding, true),
      /exact saved checkpoint/,
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    assert.equal(harness.reader.inspect().view?.recording, undefined)
  } finally {
    await harness.close()
  }
})

test('closing the article during a pending checkpoint prevents the later evidence read from opening study panes', async () => {
  // Arrange
  const harness = await recordedReaderHarness(),
    library = await harness.reader.learningStorage(),
    originalRead = library.readCheckpoint.bind(library)
  let release = (): void => {},
    enter = (): void => {}
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  try {
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    await harness.reader.close()
    library.readCheckpoint = async (
      ...arguments_: Parameters<typeof originalRead>
    ) => {
      const checkpoint = await originalRead(...arguments_)
      enter()
      await held
      return checkpoint
    }
    const cancellation = new AbortController()
    // Act
    const pending = harness.reader.openRepositoryEvidence(
        binding,
        false,
        cancellation.signal,
      ),
      rejected = assert.rejects(pending, /abort/i)
    await entered
    cancellation.abort()
    release()
    await rejected
    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    release()
    library.readCheckpoint = originalRead
    await harness.close()
  }
})

for (const recording of [false, true])
  test(`cancelling ${recording ? 'recording' : 'observation'} navigation during native source acquisition prevents its later source reveal and focus commands`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(),
      library = await harness.reader.learningStorage()
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    await harness.reader.close()
    const source = harness.holdNextSource(),
      cancellation = new AbortController()
    try {
      // Act
      const pending = harness.reader.openRepositoryEvidence(
          binding,
          recording,
          cancellation.signal,
        ),
        rejected = assert.rejects(pending, /abort/i)
      await source.started
      const commands = [...harness.commands]
      cancellation.abort()
      source.release()
      await rejected
      // Assert
      assert.equal(harness.groups[0]!.tabs.length, 0)
      assert.deepEqual(harness.commands, commands)
      assert.equal(harness.reader.inspect().opened, false)
      assert.equal(harness.runtimes[0]!.dispatches, 1)
      assert.equal((await library.readProgress()).decisions.length, 0)
      await harness.reader.open()
      assert.equal(harness.reader.inspect().opened, true)
    } finally {
      source.release()
      await harness.close()
    }
  })

test('cancelling a first reader entry drains its accepted workbench layout batch without dispatching another mutation', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    cancellation = new AbortController(),
    layout = harness.holdNextCommand('runCommands')
  try {
    // Act
    const opening = harness.reader.open(cancellation.signal),
      rejected = assert.rejects(opening, /abort/i)
    await layout.started
    const commands = [...harness.commands]
    cancellation.abort()
    layout.release()
    await rejected
    // Assert
    assert.deepEqual(harness.commands, [
      ...commands,
      'vscode.setEditorLayout',
      'vscode.getEditorLayout',
    ])
    assert.equal(harness.reader.inspect().opened, false)
    await harness.reader.open()
    assert.equal(harness.reader.inspect().opened, true)
  } finally {
    layout.release()
    await harness.close()
  }
})

test('returning to Wiki places source beside article without merging tabs and the next evidence entry restores Study panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    const groups = [...harness.groups],
      draft = harness.addForeignDraft()
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal)
    const readingLayout = harness.editorLayout()
    await harness.reader.open()
    // Assert
    assert.deepEqual(readingLayout, { orientation: 0, groups: [{}, {}, {}] })
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.deepEqual(harness.groups, groups)
    assert.equal(harness.groups[0]!.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
    assert.equal(
      harness.commands.filter((name) => name === 'vscode.setEditorLayout')
        .length,
      3,
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('Wiki reading layout cannot report the selected Study presentation as confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal)
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(
      (await harness.reader.readPresentationState()).layoutConfirmed,
      false,
    )
    await harness.reader.open()
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
  } finally {
    await harness.close()
  }
})

test('Study reports why a captured source prevents layout confirmation after failed execution', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    // Act: a failed run invalidates the source receipt while the native panes remain visible.
    harness.reader['sourceRevision'] = undefined
    const state = harness.reader.presentationState()
    // Assert
    assert.equal(state.layoutConfirmed, false)
    assert.match(
      state.reason ?? '',
      /captured source is not ready in its native pane/,
    )
    assert.deepEqual(
      { ...state.panes },
      { appColumn: 1, sourceColumn: 2, contextColumn: 3 },
    )
  } finally {
    await harness.close()
  }
})

for (const change of ['shape', 'size', 'identity', 'extra-group'])
  test(`returning to Wiki preserves a learner's ${change} change to the native editor layout`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    try {
      await harness.reader.open()
      if (change === 'shape')
        harness.changeEditorLayout({ orientation: 1, groups: [{}, {}, {}] })
      if (change === 'size')
        harness.changeEditorLayout({
          orientation: 0,
          groups: [
            { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
            { size: 0.3 },
          ],
        })
      if (change === 'identity') harness.groups[0] = { ...harness.groups[0]! }
      if (change === 'extra-group')
        harness.groups.push({ viewColumn: 4, tabs: [] })
      const layout = harness.editorLayout(),
        groups = [...harness.groups],
        draft = harness.addForeignDraft()
      // Act
      await harness.reader.arrangeRepository(new AbortController().signal)
      await harness.reader.open()
      // Assert
      assert.deepEqual(harness.editorLayout(), layout)
      assert.deepEqual(harness.groups, groups)
      assert.equal(harness.groups[0]!.tabs.includes(draft), true)
      assert.equal(
        harness.commands.filter((name) => name === 'vscode.setEditorLayout')
          .length,
        1,
      )
    } finally {
      await harness.close()
    }
  })

test('evidence entry preserves a learner resize made while reading the Wiki', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    layout = {
      orientation: 0,
      groups: [{ size: 0.2 }, { size: 0.6 }, { size: 0.2 }],
    }
  try {
    await harness.reader.open()
    await harness.reader.arrangeRepository(new AbortController().signal)
    harness.changeEditorLayout(layout)
    // Act
    await harness.reader.open()
    // Assert
    assert.deepEqual(harness.editorLayout(), layout)
    assert.equal(
      harness.commands.filter((name) => name === 'vscode.setEditorLayout')
        .length,
      2,
    )
  } finally {
    await harness.close()
  }
})

test('cancelling Wiki navigation while checking native layout ownership cannot rearrange the editor later', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.open()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    // Act
    const navigation = harness.reader.arrangeRepository(cancellation.signal),
      rejected = assert.rejects(navigation, /abort/i)
    await held.started
    cancellation.abort()
    held.release()
    await rejected
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(
      harness.commands.filter((name) => name === 'vscode.setEditorLayout')
        .length,
      1,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('returning to Wiki during a cancelled Study layout waits for the accepted host effect then restores side-by-side reading', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.arrangeRepository(new AbortController().signal)
    const held = harness.holdNextCommand('runCommands')
    release = held.release
    const opening = harness.reader.open(cancellation.signal),
      rejected = assert.rejects(opening, /abort/i)
    // Act
    await held.started
    cancellation.abort()
    const returning = harness.reader.arrangeRepository(
      new AbortController().signal,
    )
    held.release()
    await rejected
    await returning
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}, {}],
    })
    assert.equal(
      harness.commands.filter((name) => name === 'vscode.setEditorLayout')
        .length,
      4,
    )
    assert.equal(
      harness.commands.filter(
        (name) => name === 'workbench.action.evenEditorWidths',
      ).length,
      2,
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    release()
    await harness.close()
  }
})

for (const change of ['shape', 'size'])
  test(`a manual ${change} change during the host layout receipt never becomes Codebook-owned on the next Wiki return`, async () => {
    // Arrange
    const harness = await workspaceHarness(false),
      manual =
        change === 'shape'
          ? { orientation: 1, groups: [{}, {}, {}] }
          : {
              orientation: 0,
              groups: [
                { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
                { size: 0.3 },
              ],
            }
    let release = (): void => {}
    try {
      await harness.reader.open()
      const placement = harness.holdNextCommand('vscode.setEditorLayout')
      release = placement.release
      // Act
      const arranging = harness.reader.action('arrange')
      await placement.started
      // Measure the receipt after the accepted mutation, rather than the new pre-placement geometry read.
      const held = harness.holdNextCommand('vscode.getEditorLayout')
      release = (): void => {
        placement.release()
        held.release()
      }
      placement.release()
      await held.started
      harness.changeEditorLayout(manual)
      held.release()
      await arranging
      await harness.reader.arrangeRepository(new AbortController().signal)
      // Assert
      assert.deepEqual(harness.editorLayout(), manual)
      assert.equal(
        harness.commands.filter((name) => name === 'vscode.setEditorLayout')
          .length,
        2,
      )
      assert.equal(
        harness.commands.filter(
          (name) => name === 'workbench.action.evenEditorWidths',
        ).length,
        0,
      )
    } finally {
      release()
      await harness.close()
    }
  })

test('Cursor wrapper-only tab resync preserves Wiki and Study layout switching during an in-flight ownership read', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  let release = (): void => {}
  try {
    await harness.reader.open()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    // Act
    const returning = harness.reader.arrangeRepository(
      new AbortController().signal,
    )
    await held.started
    harness.resyncEditorGroups()
    held.release()
    await returning
    const wiki = harness.editorLayout()
    harness.resyncEditorGroups()
    await harness.reader.open()
    // Assert
    assert.deepEqual(wiki, { orientation: 0, groups: [{}, {}, {}] })
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(
      harness.commands.filter((name) => name === 'vscode.setEditorLayout')
        .length,
      3,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('an unchanged empty chat part cannot block Study reentry after Wiki tab resync', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  try {
    await harness.reader.open()
    await harness.reader.arrangeRepository(new AbortController().signal)
    // Act
    harness.resyncEditorGroups('empty')
    await harness.reader.open()
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.deepEqual(harness.groups.at(-1)!.tabs, [])
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(
      harness.groups[0]!.tabs.some(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.toString() === draft.document.uri.toString(),
      ),
      true,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

for (const change of ['replace', 'unannounced', 'move', 'ambiguous'] as const)
  test(`an empty other-part ${change} cannot authorize Study to replace the reading layout`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    try {
      await harness.reader.open()
      await harness.reader.arrangeRepository(new AbortController().signal)
      const layout = harness.editorLayout(),
        mutations = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length
      if (change === 'move') harness.groups.at(-1)!.viewColumn = 5
      if (change === 'ambiguous')
        harness.groups.push({ viewColumn: 5, tabs: [] })
      // Act
      harness.resyncEditorGroups(
        change === 'replace' || change === 'unannounced' ? change : 'empty',
        true,
      )
      await harness.reader.open()
      // Assert
      assert.deepEqual(harness.editorLayout(), layout)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(
        harness.groups
          .filter((group) => group.viewColumn > 3)
          .every((group) => group.tabs.length === 0),
        true,
      )
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await harness.close()
    }
  })

test('explicit Study reentry reveals its application and captured source over retained reading tabs', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    await harness.reader.arrangeRepository(new AbortController().signal)
    const citation = harness.addTextPreview('/article-citation.ts', 1),
      article = harness.addTextPreview('/wiki-reader.html', 2)
    harness.groups.find((group) => group.viewColumn === 1)!.activeTab = citation
    harness.groups.find((group) => group.viewColumn === 2)!.activeTab = article
    // Act
    await harness.reader.open()
    // Assert
    const application = harness.groups.find((group) => group.viewColumn === 1)!
      .activeTab?.input
    const source = harness.groups.find((group) => group.viewColumn === 2)!
      .activeTab?.input
    assert.ok(application && 'viewType' in application)
    assert.equal(application.viewType, 'codebook.scopedBrowser')
    assert.ok(source && 'uri' in source)
    assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.includes(citation),
      true,
    )
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 2)!
        .tabs.includes(article),
      true,
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

for (const change of [
  'move',
  'replace',
  'remove',
  'reorder',
  'unannounced',
] as const)
  test(`a host tab resync cannot disguise a learner group ${change} as Codebook ownership`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    try {
      await harness.reader.open()
      if (change === 'remove' || change === 'reorder') {
        harness.seedPanelTabs('known')
        harness.addForeignDraft()
      }
      harness.resyncEditorGroups(change)
      // Act
      await harness.reader.arrangeRepository(new AbortController().signal)
      // Assert
      assert.deepEqual(harness.editorLayout(), {
        orientation: 0,
        groups: [
          { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
          { size: 0.45 },
        ],
      })
      assert.equal(
        harness.commands.filter((name) => name === 'vscode.setEditorLayout')
          .length,
        1,
      )
    } finally {
      await harness.close()
    }
  })

for (const kind of [
  'known',
  'unknown',
  'duplicate',
  'ambiguous',
  'empty',
] as const)
  test(`Cursor ${kind} webview inputs ${kind === 'known' ? 'retain layout ownership across application title changes' : 'cannot acquire Codebook layout ownership during resync'}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    try {
      await harness.reader.open()
      harness.seedPanelTabs(kind)
      // Act
      harness.resyncEditorGroups(kind === 'empty' ? 'empty' : undefined)
      await harness.reader.arrangeRepository(new AbortController().signal)
      // Assert
      assert.deepEqual(
        harness.editorLayout(),
        kind === 'known'
          ? { orientation: 0, groups: [{}, {}, {}] }
          : {
              orientation: 0,
              groups: [
                { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { size: 0.45 },
              ],
            },
      )
      assert.equal(
        harness.commands.filter((name) => name === 'vscode.setEditorLayout')
          .length,
        kind === 'known' ? 2 : 1,
      )
    } finally {
      await harness.close()
    }
  })

test('a retired renderer cannot select another layout while replay opens its summary sidebar', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.open()
    await harness.reader.openRecording(harness.studyId)
    const state = harness.reader.presentationState()

    // Act
    harness.receive({
      type: 'presentation',
      revision: harness.reader.inspect().view!.revision,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.summary.visible, true)
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes('first confirmed replay position'),
        ),
      false,
    )
    assert.equal(
      harness.reader
        .presentationState()
        .reason?.includes('first confirmed replay position') ?? false,
      false,
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('an MCP mode request before replay readiness clears its warning when the first position becomes ready', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.open()
    await harness.reader.openRecording(harness.studyId)
    const state = harness.reader.presentationState()

    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: /first confirmed replay position/,
      },
    )
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /first confirmed replay position/,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(
      harness.reader
        .presentationState()
        .reason?.includes('first confirmed replay position') ?? false,
      false,
    )
    assert.equal(harness.reader.presentationState().requestedMode, undefined)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('returning from recording to Wiki keeps background study refresh from covering the article with captured source', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    await harness.reader.openRepositoryEvidence(binding, true, undefined, {
      bookId: 'architecture',
      revision: 1,
      nodeId: 'module',
      anchorIndex: 0,
      location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-1' },
    })
    let preservedNativeInput: boolean | undefined
    harness.controls.returnToRepository = async (
      _selection,
      preserveNativeInput?: boolean,
    ): Promise<void> => {
      preservedNativeInput = preserveNativeInput
      harness.controller.hide()
      harness.groups[0]!.activeTab = undefined
    }
    const tabs = [...harness.groups[0]!.tabs],
      commands = [...harness.commands]
    // Act
    await harness.reader.action('return-wiki')
    await harness.reader['refresh']()
    await harness.reader.retire(harness.service)
    // Assert
    assert.equal(preservedNativeInput, true)
    assert.deepEqual(harness.groups[0]!.tabs, tabs)
    assert.deepEqual(harness.commands, commands)
    assert.equal(harness.groups[0]!.activeTab, undefined)
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    // A validated in-pane Return remains an explicit handoff to the Wiki.
    await readerSeams(harness).receive(
      {
        type: 'action',
        action: 'return-wiki',
        revision: harness.reader.inspect().view!.revision,
      },
      'context',
    )
    assert.equal(preservedNativeInput, false)
    harness.controller.reveal()
    await harness.controller.settle()
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(
      harness.reader.inspect().view?.model.observation?.elapsedMs,
      100,
    )
  } finally {
    await harness.close()
  }
})

test('a successful recording Summary Return removes its earlier navigation error from the published Summary', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    readerSeams(harness).stopOwnTimer()
    let returns = 0
    harness.controls.returnToRepository = async (): Promise<void> => {
      returns++
      if (returns === 1)
        throw new Error(
          'Native focus changed during repository navigation; the newer learner focus was preserved.',
        )
    }
    harness.receive({
      type: 'action',
      action: 'return-wiki',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.includes(
            'Error: Native focus changed during repository navigation; the newer learner focus was preserved.',
          ),
      'the refused recording Return notice',
    )

    // Act
    harness.receive({
      type: 'action',
      action: 'return-wiki',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(() => returns === 2, 'the accepted recording Return')
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    assert.deepEqual([...harness.postedMessages().at(-1)!.errors], [])
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      harness.studyId,
    )
  } finally {
    await harness.close()
  }
})

test('a pending recording Return keeps a newer refused connection error when the Wiki handoff completes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  let completeReturn!: () => void
  const returnFinished = new Promise<void>((resolve) => {
    completeReturn = resolve
  })
  let entered = false
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    readerSeams(harness).stopOwnTimer()
    harness.controls.returnToRepository = async (): Promise<void> => {
      entered = true
      await returnFinished
    }
    harness.controls.connect = async (): Promise<void> => {
      throw new Error('The newer agent connection was refused.')
    }
    harness.receive({
      type: 'action',
      action: 'return-wiki',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(() => entered, 'the pending recording Return')

    // Act
    harness.receive({
      type: 'action',
      action: 'connect',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.includes(
            'Error: The newer agent connection was refused.',
          ),
      'the newer connection refusal',
    )
    completeReturn()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual(
      [...harness.postedMessages().at(-1)!.errors],
      ['Error: The newer agent connection was refused.'],
    )
  } finally {
    completeReturn()
    await harness.close()
  }
})

test('explicit Arrange separates moved application, source and context while preserving unrelated tabs', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    const draft = harness.addForeignDraft()
    harness.movePanel('codebook.scopedBrowser', 2)
    harness.movePanel('codebook.studyContext', 2)
    const sourceGroup = harness.groups.find((group) => group.viewColumn === 2)!,
      contextGroup = harness.groups.find((group) => group.viewColumn === 3)!
    // Both manually retained owned tabs coexist; a real group cannot retain two replacing preview tabs.
    for (const tab of sourceGroup.tabs)
      if ('viewType' in tab.input) tab.isPreview = false
    harness.swapEditorGroups(sourceGroup, contextGroup)
    harness.changeEditorLayout({ orientation: 0, groups: [{}, {}, {}] })
    harness.restoreSourceFocusOnArrange()
    harness.reportSourceEditorInColumn(3)
    harness.clearDecorations()

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.decoratedColumns().includes(2), true)
    assert.equal(sourceGroup.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    // A later Source action must retain Arrange's reader instead of reopening the older duplicate.
    await harness.reader.action('source')
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(sourceGroup.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
  } finally {
    await harness.close()
  }
})

test('Restore separates a Study explanation from source after its third native group closes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    harness.closeEmptyGroupsAfterPanelMove()
    harness.movePanel('codebook.studyContext', 2)
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

for (const moveImmediately of [false, true])
  test(`Arrange retains its source region after replay visibility cancels rendering and respects ${moveImmediately ? 'an immediate' : 'a later'} manual move`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    try {
      await harness.reader.open()
      const draft = harness.addForeignDraft()
      const original = harness.groups.find((group) => group.viewColumn === 2)!,
        destination = harness.groups.find((group) => group.viewColumn === 3)!
      harness.swapEditorGroups(original, destination)
      harness.invalidateNextSourceRender()

      // Act
      await harness.reader.action('arrange')
      if (moveImmediately) harness.moveSource(1)
      await harness.reader.action('source')

      // Assert
      assert.equal(
        harness.sourceColumn(),
        moveImmediately ? 1 : 2,
        harness.reader.inspect().view!.errors.join('\n'),
      )
      assert.equal(original.tabs.includes(draft), true)
      assert.equal(draft.isDirty, true)
      // A completed source render releases the explicit arrangement so later manual moves remain authoritative.
      harness.moveSource(1)
      await harness.reader.action('source')
      assert.equal(harness.sourceColumn(), 1)
    } finally {
      await harness.close()
    }
  })

test('Arrange reports interrupted source placement and a later explicit retry restores the three regions', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  let release = (): void => {}
  try {
    await harness.reader.open()
    const original = harness.groups.find((group) => group.viewColumn === 2)!,
      destination = harness.groups.find((group) => group.viewColumn === 3)!
    harness.swapEditorGroups(original, destination)
    const held = harness.holdNextSource()
    release = held.release

    // Act
    const arranging = harness.reader.action('arrange')
    await held.started
    harness.reader['revision']++
    release()
    await arranging

    // Assert
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes(
            'The selected source changed before it could be arranged',
          ),
        ),
      true,
    )
    await harness.reader.action('arrange')
    await harness.reader.action('source')
    assert.equal(
      harness.sourceColumn(),
      2,
      harness.reader.inspect().view!.errors.join('\n'),
    )
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    release()
    await harness.close()
  }
})

test('Source follows a learner move after Arrange while preserving the earlier duplicate and dirty draft', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    await harness.reader.open()
    const draft = harness.addForeignDraft()
    const original = harness.groups.find((group) => group.viewColumn === 2)!,
      destination = harness.groups.find((group) => group.viewColumn === 3)!
    harness.swapEditorGroups(original, destination)
    await harness.reader.action('arrange')
    const retainedTabs = [...original.tabs]

    // Act
    harness.moveSource(1)
    await harness.reader.action('source')

    // Assert
    assert.equal(harness.sourceColumn(), 1)
    assert.deepEqual(original.tabs, retainedTabs)
    assert.equal(original.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
  } finally {
    await harness.close()
  }
})
