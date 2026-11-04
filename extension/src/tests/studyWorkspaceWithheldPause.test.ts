import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { workspaceHarness } from './studyWorkspaceHarness'

// protects=the learner can still open the stop's source and values when its image was withheld; fails_when=isPauseUninspected requires a captured image and presentation answers PRESENTATION_UNAVAILABLE; no_claim=native Application-view pixels
test('a live pause whose stop image was withheld can be presented in the Study workspace', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let restoreView = (): void => {}
  try {
    await harness.reader.open()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    const runtime = harness.runtimes[0]!,
      view = runtime.view.bind(runtime)
    restoreView = (): void => {
      runtime.view = view
    }
    runtime.view = () => ({
      ...view(),
      captures: {
        'paused-browser': {
          status: 'withheld',
          withheldReason: 'cross-origin-frame',
          error:
            'An image was withheld while a frame from another origin, whose content Codebook cannot read, was on screen after a secret was typed.',
        },
      },
    })
    await harness.reader.action('click')
    await harness.reader.action('focus-app')
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
  } finally {
    // The run's own view is back before the checkpoint on close, which compares saved captures with the run's.
    restoreView()
    await harness.close()
  }
})

// protects=native C79-2: the learner can still open the stop's source and values when the paused page drew no image of the stop in time (its capture reads failed while the run stays paused); fails_when=isPauseUninspected requires a captured or withheld image and presentation answers PRESENTATION_UNAVAILABLE; no_claim=native Application-view pixels, and a run whose capture failed in another way (that run has already failed)
test('a live pause whose stop image the paused page drew nothing for in time can be presented in the Study workspace', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let restoreView = (): void => {}
  try {
    await harness.reader.open()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    const runtime = harness.runtimes[0]!,
      view = runtime.view.bind(runtime)
    restoreView = (): void => {
      runtime.view = view
    }
    runtime.view = () => ({
      ...view(),
      captures: {
        'paused-browser': {
          status: 'failed',
          error:
            'The paused page drew no image of this stop within 3 s; the stop keeps its source and values, and the run goes on and ends partial.',
        },
      },
    })
    await harness.reader.action('click')
    await harness.reader.action('focus-app')
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
  } finally {
    // A failed image is kept in the reader's image history once presented, so the view keeps it through the checkpoint on close, as the run's own view would.
    await harness.close()
    restoreView()
  }
})
