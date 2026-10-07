import assert from 'node:assert/strict'
import { test } from 'node:test'

import { folderChangeCleanupNotice } from '../utils/folderChangeCleanupNotice'

// Value: protects=the notice a learner reads when a reader could not be closed after the workspace's folders changed: it names the reader, the cause, that Codebook goes on with new readers and what to do with a pane that stayed open; fails_when=the notice is the bare "Codebook cleanup incomplete: Error: …", which says none of the three, or prints "Error:" or two full stops; why_new=Cycle 0046 row 312; seam=the notice's own function
for (const [step, reader, whatFailed] of [
  [
    'study-reader',
    'Study workspace',
    'The Study workspace could not be closed',
  ],
  [
    'repository-reader',
    'Repository Wiki reader',
    'The Repository Wiki reader could not be closed',
  ],
] as const)
  test(`a ${reader} that could not be closed after the workspace’s folders changed is told with its cause, that Codebook goes on with new readers, and what to do with a pane that stayed open`, () => {
    // Act
    const notice = folderChangeCleanupNotice([
      { step, thrown: new Error('The panes could not be closed.') },
    ])

    // Assert
    assert.equal(
      notice,
      `Codebook did not finish its cleanup after the workspace's folders changed. ${whatFailed}: The panes could not be closed. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.`,
    )
  })

// Value: protects=the learner whose agent server could not be released when the folders changed being sent to the one command that ends it, without a sentence about a pane; fails_when=the notice gives no next step, or tells of a pane that cannot have stayed open; why_new=Cycle 0046 row 312; seam=the notice's own function
test('an agent server that could not be stopped completely after the workspace’s folders changed is told with the Stop Agent Server step and without the sentence about a pane', () => {
  // Act
  const notice = folderChangeCleanupNotice([
    {
      step: 'server-still-owned',
      thrown: new Error('Owned shutdown remains incomplete.'),
    },
  ])

  // Assert
  assert.equal(
    notice,
    "Codebook did not finish its cleanup after the workspace's folders changed. The agent server could not be stopped completely: Owned shutdown remains incomplete. Run Codebook: Stop Agent Server again before you start it. Codebook goes on with new readers.",
  )
})

// Value: protects=the notice saying nothing untrue about the agent server when it is gone and only a later part of its stop failed: it does not send the learner to Stop Agent Server; fails_when=every failed stop is told as a server that still runs; why_new=Cycle 0046 row 312; seam=the notice's own function
test('an agent server that was stopped while its last history save failed is told as stopped, with the cause given one full stop, and without a step to stop it again', () => {
  // Act: the cause is a text without a final full stop and no error object.
  const notice = folderChangeCleanupNotice([
    {
      step: 'server-stopped',
      thrown:
        'Runtime released; final reader history was not saved: Error: disk is read-only',
    },
  ])

  // Assert
  assert.equal(
    notice,
    "Codebook did not finish its cleanup after the workspace's folders changed. The agent server was stopped, but not all of its cleanup was done: Runtime released; final reader history was not saved: Error: disk is read-only. Codebook goes on with new readers.",
  )
})

// Value: protects=the notice not claiming new readers when they could not be made: it says that the next command makes them; fails_when="Codebook goes on with new readers." is added to every notice; why_new=Cycle 0046 row 312 (the sentence is true for each failure it tells); seam=the notice's own function
test('readers that could not be made again after the workspace’s folders changed are told with the step that makes them, and the notice does not say that Codebook goes on with new readers', () => {
  // Act
  const notice = folderChangeCleanupNotice([
    {
      step: 'new-readers',
      thrown: new Error('The Learning summary could not be registered.'),
    },
  ])

  // Assert
  assert.equal(
    notice,
    "Codebook did not finish its cleanup after the workspace's folders changed. Codebook's readers could not be made again: The Learning summary could not be registered. The next Codebook command makes them.",
  )
})

// Value: protects=every failure of one change of the folders being told in one notice, in the order the steps ran, each with its own next step; fails_when=only the first or the last failure is told, as when each step's failure ended the handling; why_new=Cycle 0046 row 312 (each step runs whatever the step before it did, so several can fail); seam=the notice's own function
test('several steps that failed after one change of the workspace’s folders are told in one notice, in their order, each with its own sentence', () => {
  // Act
  const notice = folderChangeCleanupNotice([
    {
      step: 'chat-setup',
      thrown: new Error('The workspace state could not be written.'),
    },
    {
      step: 'study-reader',
      thrown: new Error('The panes could not be closed.'),
    },
    {
      step: 'wiki-reader',
      thrown: new Error('The local page server did not close.'),
    },
  ])

  // Assert
  assert.equal(
    notice,
    "Codebook did not finish its cleanup after the workspace's folders changed. The saved AI chat setup could not be cleared: The workspace state could not be written. It is still in use; run Codebook: Set Up AI Chat to replace it. The Study workspace could not be closed: The panes could not be closed. The DeepWiki reader in the browser could not be closed: The local page server did not close. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.",
  )
})
