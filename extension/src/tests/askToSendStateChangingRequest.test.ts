import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  askToSendStateChangingRequest,
  type ShowModalQuestion,
} from '../utils/askToSendStateChangingRequest'

import { defer } from './utils/defer'

/** A modal that records what it showed and answers with the given choice. */
function modalAnswering(choice: string | undefined) {
  const shown: { message: string; detail: string; items: string[] }[] = []
  const show: ShowModalQuestion = async (message, detail, ...items) => {
    shown.push({ message, detail, items })
    return choice
  }
  return { show, shown }
}

// protects=TD-6: the modal names the method and path, says the server uses the repository's configured database, offers Send, and Send returns true; fails_when=the question lacks the method, path or database sentence, or Send is not true; no_claim=how the editor draws the modal
test('the confirmation is a modal naming the method, the path and the repository database, and Send confirms', async () => {
  // Arrange
  const { show, shown } = modalAnswering('Send')
  // Act
  const confirmed = await askToSendStateChangingRequest(
    show,
    { method: 'DELETE', path: '/api/items/7' },
    new AbortController().signal,
  )
  // Assert
  assert.equal(confirmed, true)
  assert.equal(shown.length, 1)
  assert.deepEqual(shown[0]?.items, ['Send'])
  assert.equal(
    shown[0]?.message,
    "Send DELETE /api/items/7 to the repository's server?",
  )
  assert.match(shown[0]?.detail ?? '', /DELETE request once/)
  assert.match(
    shown[0]?.detail ?? '',
    /uses the repository's own configured database/,
  )
})

// protects=Cancel and dismissing the modal confirm nothing; fails_when=an undefined answer (Cancel, Escape) reads as Send; no_claim=none
test('Cancel or a dismissed modal does not confirm', async () => {
  // Arrange
  const { show } = modalAnswering(undefined)
  // Act
  const confirmed = await askToSendStateChangingRequest(
    show,
    { method: 'POST', path: '/api/items' },
    new AbortController().signal,
  )
  // Assert
  assert.equal(confirmed, false)
})

// protects=D6: an abort (no answer within the bound, a cancelled run) answers false while the modal is still open; fails_when=the question waits for the learner after the bound; no_claim=the modal closing (the editor offers no way to close it)
test('an abort while the modal is open answers false', async () => {
  // Arrange
  const learner = defer<string | undefined>()
  const controller = new AbortController()
  const show: ShowModalQuestion = () => learner.promise
  // Act
  const asking = askToSendStateChangingRequest(
    show,
    { method: 'PUT', path: '/api/items/7' },
    controller.signal,
  )
  controller.abort()
  const confirmed = await asking
  // Assert
  assert.equal(confirmed, false)
})

// protects=a question whose signal is already aborted shows no modal; fails_when=the learner is asked about a request the run no longer wants; no_claim=none
test('an already aborted question shows no modal', async () => {
  // Arrange
  const { show, shown } = modalAnswering('Send')
  const controller = new AbortController()
  controller.abort()
  // Act
  const confirmed = await askToSendStateChangingRequest(
    show,
    { method: 'POST', path: '/api/items' },
    controller.signal,
  )
  // Assert
  assert.equal(confirmed, false)
  assert.equal(shown.length, 0)
})
