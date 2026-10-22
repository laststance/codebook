import assert from 'node:assert/strict'
import { test } from 'node:test'

import { awaitDocumentSettled } from '../utils/awaitDocumentSettled'

type Listener = (event: { document: { uri: { toString(): string } } }) => void

/**
 * Builds a fake text document change event whose listeners the test fires by hand.
 * @returns The event to hand to the wait, a way to fire a change of one document, and the count of live listeners.
 * @example const documents = fakeDocumentChanges(); documents.change('file:///a.ts')
 */
function fakeDocumentChanges() {
  const listeners = new Set<Listener>()
  return {
    event: (listener: Listener) => {
      listeners.add(listener)
      return { dispose: () => void listeners.delete(listener) }
    },
    change: (uri: string): void => {
      for (const listener of [...listeners])
        listener({ document: { uri: { toString: () => uri } } })
    },
    liveListeners: () => listeners.size,
  }
}

// Value: protects=a wait on one document ends at that document's own change and not at another document's change; fails_when=the wait drops the uri comparison and settles on any document's edit, or never re-checks at a change; why_new=the util's contract had only indirect cover through the workspace's two callers; seam=none; no_claim=the bounded poll
test('a wait for one document settles at that document’s change and ignores another document’s change', async () => {
  // Arrange
  const documents = fakeDocumentChanges()
  let text = 'old'
  const wait = awaitDocumentSettled(
    documents.event,
    'file:///a.ts',
    () => {
      return text === 'new'
    },
    'the new bytes',
    2_000,
  )
  let resolved = false
  void wait.then(() => (resolved = true))

  // Act
  text = 'new'
  documents.change('file:///other.ts')
  await new Promise((resolve) => setImmediate(resolve))
  const resolvedAfterOtherDocument = resolved
  documents.change('file:///a.ts')
  await wait

  // Assert
  assert.equal(resolvedAfterOtherDocument, false)
  assert.equal(resolved, true)
  assert.equal(documents.liveListeners(), 0)
})

// Value: protects=the provider is notified only once the change listener is in place, and the bytes it delivers settle the wait; fails_when=afterSubscribe runs before the subscription (the provider's event is lost) or its change is not observed; why_new=the capture view's "subscribe before notifying the provider" rule, now in the shared util; seam=none; no_claim=the editor's own event order
test('a wait notifies the provider after subscribing, and the bytes it delivers settle the wait', async () => {
  // Arrange
  const documents = fakeDocumentChanges()
  const liveListenersAtNotify: number[] = []
  let text = 'old'

  // Act
  await awaitDocumentSettled(
    documents.event,
    'file:///a.ts',
    () => text === 'new',
    'the bytes',
    2_000,
    {
      afterSubscribe: () => {
        liveListenersAtNotify.push(documents.liveListeners())
        text = 'new'
        documents.change('file:///a.ts')
      },
    },
  )

  // Assert
  assert.deepEqual(liveListenersAtNotify, [1])
  assert.equal(documents.liveListeners(), 0)
})

// Value: protects=a superseded or closed reader ends the wait with its own error, and an aborting signal re-checks at once without a document event; fails_when=the settled check's throw is swallowed so the wait runs to its bound, or abort is not observed; why_new=the replacement of two hand-written waits by one util changed who owns these exits; seam=none; no_claim=the message wording of the callers
test('a settled check that throws ends the wait with that error, and an abort wakes the check', async () => {
  // Arrange
  const documents = fakeDocumentChanges()
  const controller = new AbortController()
  const wait = awaitDocumentSettled(
    documents.event,
    'file:///a.ts',
    () => {
      controller.signal.throwIfAborted()
      return false
    },
    'the bytes',
    2_000,
    { signal: controller.signal },
  )

  // Act
  controller.abort(new Error('reader closed'))

  // Assert
  await assert.rejects(wait, { message: 'reader closed' })
  assert.equal(documents.liveListeners(), 0)
})

// Value: protects=a document that never shows the bytes fails the wait at its bound naming what was waited for, and the listener is released; fails_when=the wait hangs, times out without the description, or leaks its change listener; why_new=the slot's open-failure row depends on this bound (NODE_HISTORY_TRANSITION_BOUND_MS); seam=none; no_claim=the bound's value for the slot
test('a document that never shows the bytes fails the wait at its bound and releases the listener', async () => {
  // Arrange
  const documents = fakeDocumentChanges()

  // Act
  const wait = awaitDocumentSettled(
    documents.event,
    'file:///a.ts',
    () => false,
    'the recorded source of this moment',
    60,
  )

  // Assert
  await assert.rejects(wait, {
    message: 'Timed out waiting for the recorded source of this moment',
  })
  assert.equal(documents.liveListeners(), 0)
})
