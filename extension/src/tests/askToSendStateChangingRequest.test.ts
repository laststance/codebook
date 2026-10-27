import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { test } from 'node:test'

import {
  createStateChangingRequestAsker,
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
  const confirmed = await createStateChangingRequestAsker(show)(
    { runId: 'run-1', method: 'DELETE', path: '/api/items/7' },
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
  const confirmed = await createStateChangingRequestAsker(show)(
    { runId: 'run-1', method: 'POST', path: '/api/items' },
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
  const asking = createStateChangingRequestAsker(show)(
    { runId: 'run-1', method: 'PUT', path: '/api/items/7' },
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
  const confirmed = await createStateChangingRequestAsker(show)(
    { runId: 'run-1', method: 'POST', path: '/api/items' },
    controller.signal,
  )
  // Assert
  assert.equal(confirmed, false)
  assert.equal(shown.length, 0)
})

// protects=the abort listener is removed once the question settles, so a long-lived signal collects none; fails_when=a listener stays on the signal after an answer; no_claim=none
test('the question removes its abort listener once it is answered', async () => {
  // Arrange
  const { show } = modalAnswering('Send')
  const controller = new AbortController()
  // Act
  await createStateChangingRequestAsker(show)(
    { runId: 'run-1', method: 'POST', path: '/api/items' },
    controller.signal,
  )
  // Assert
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

// protects=a retry after an abort joins the modal that is still showing instead of opening a second one: the learner's single answer then belongs to the retry; fails_when=the editor shows two modals for one request, or the retry never gets the answer; no_claim=the editor closing the first modal (it cannot)
test('a retry after an abort joins the open modal and gets its answer', async () => {
  // Arrange
  const learner = defer<string | undefined>()
  let shownCount = 0
  const show: ShowModalQuestion = () => {
    shownCount++
    return learner.promise
  }
  const ask = createStateChangingRequestAsker(show)
  const request = { runId: 'run-1', method: 'POST', path: '/api/items' }
  const first = new AbortController()
  // Act
  const firstAnswer = ask(request, first.signal)
  first.abort()
  const retry = ask(request, new AbortController().signal)
  learner.resolve('Send')
  // Assert
  assert.equal(await firstAnswer, false)
  assert.equal(await retry, true)
  assert.equal(shownCount, 1)
})

// protects=once the learner has answered, the next question opens a new modal; fails_when=a settled modal is reused; no_claim=none
test('a question after the answer opens a new modal', async () => {
  // Arrange
  const { show, shown } = modalAnswering('Send')
  const ask = createStateChangingRequestAsker(show)
  const request = { runId: 'run-1', method: 'POST', path: '/api/items' }
  // Act
  await ask(request, new AbortController().signal)
  await ask(request, new AbortController().signal)
  // Assert
  assert.equal(shown.length, 2)
})

// protects=a modal another run left on screen never answers this run's request: a new run asks the learner in its own modal; fails_when=the Send click on the old run's modal sends the new run's request, or the new run shows no modal; no_claim=the editor's modal queue
test('a new run with the same method and path asks in its own modal, not the one an earlier run left open', async () => {
  // Arrange
  const modals: ReturnType<typeof defer<string | undefined>>[] = []
  const show: ShowModalQuestion = () => {
    const learner = defer<string | undefined>()
    modals.push(learner)
    return learner.promise
  }
  const ask = createStateChangingRequestAsker(show)
  const earlierRun = { runId: 'run-a', method: 'POST', path: '/api/items' }
  const laterRun = { runId: 'run-b', method: 'POST', path: '/api/items' }
  const gaveUp = new AbortController()
  // Act
  const earlierAnswer = ask(earlierRun, gaveUp.signal)
  gaveUp.abort()
  const laterAnswer = ask(laterRun, new AbortController().signal)
  modals[0]?.resolve('Send')
  modals[1]?.resolve(undefined)
  // Assert
  assert.equal(await earlierAnswer, false)
  assert.equal(await laterAnswer, false)
  assert.equal(modals.length, 2)
})

// protects=the shared modal belongs to one declared request: a request with another body asks again; fails_when=a Send given for one body sends another; no_claim=none
test('a request with another body asks in its own modal', async () => {
  // Arrange
  const modals: ReturnType<typeof defer<string | undefined>>[] = []
  const show: ShowModalQuestion = () => {
    const learner = defer<string | undefined>()
    modals.push(learner)
    return learner.promise
  }
  const ask = createStateChangingRequestAsker(show)
  const declared = {
    runId: 'run-a',
    method: 'POST',
    path: '/api/items',
    contentType: 'application/json',
    body: '{"name":"a"}',
  }
  const changed = { ...declared, body: '{"name":"b"}' }
  const gaveUp = new AbortController()
  // Act
  const declaredAnswer = ask(declared, gaveUp.signal)
  gaveUp.abort()
  const changedAnswer = ask(changed, new AbortController().signal)
  modals[0]?.resolve('Send')
  modals[1]?.resolve(undefined)
  // Assert
  assert.equal(await declaredAnswer, false)
  assert.equal(await changedAnswer, false)
  assert.equal(modals.length, 2)
})

// protects=the shared modal belongs to one content type too: the same body declared with another content type asks again; fails_when=a Send given for one content type sends another; no_claim=none
test('a request with another content type asks in its own modal', async () => {
  // Arrange
  const modals: ReturnType<typeof defer<string | undefined>>[] = []
  const show: ShowModalQuestion = () => {
    const learner = defer<string | undefined>()
    modals.push(learner)
    return learner.promise
  }
  const ask = createStateChangingRequestAsker(show)
  const declared = {
    runId: 'run-a',
    method: 'POST',
    path: '/api/items',
    contentType: 'application/json',
    body: 'name=a',
  }
  const changed = { ...declared, contentType: 'text/plain' }
  const gaveUp = new AbortController()
  // Act
  const declaredAnswer = ask(declared, gaveUp.signal)
  gaveUp.abort()
  const changedAnswer = ask(changed, new AbortController().signal)
  modals[0]?.resolve('Send')
  modals[1]?.resolve(undefined)
  // Assert
  assert.equal(await declaredAnswer, false)
  assert.equal(await changedAnswer, false)
  assert.equal(modals.length, 2)
})

// protects=a retry of an earlier run still joins that run's modal after another run asked: the editor never stacks a second identical modal for it; fails_when=the earlier run's retry opens a new modal; no_claim=the editor's modal queue
test("a retry of an earlier run joins that run's modal still on screen after another run asked", async () => {
  // Arrange
  const modals: ReturnType<typeof defer<string | undefined>>[] = []
  const show: ShowModalQuestion = () => {
    const learner = defer<string | undefined>()
    modals.push(learner)
    return learner.promise
  }
  const ask = createStateChangingRequestAsker(show)
  const earlierRun = { runId: 'run-a', method: 'POST', path: '/api/items' }
  const laterRun = { runId: 'run-b', method: 'POST', path: '/api/items' }
  const gaveUp = new AbortController()
  // Act
  void ask(earlierRun, gaveUp.signal)
  gaveUp.abort()
  const laterAnswer = ask(laterRun, new AbortController().signal)
  const earlierRetry = ask(earlierRun, new AbortController().signal)
  modals[0]?.resolve('Send')
  modals[1]?.resolve(undefined)
  // Assert
  assert.equal(await earlierRetry, true)
  assert.equal(await laterAnswer, false)
  assert.equal(modals.length, 2)
})

// protects=two modals left on screen can be told apart: the detail names the run it asks for; fails_when=modals of different runs read the same; no_claim=how the editor draws the detail
test('the modal names the run it asks for', async () => {
  // Arrange
  const { show, shown } = modalAnswering('Send')
  // Act
  await createStateChangingRequestAsker(show)(
    {
      runId: '68ca83a9-c358-4df9-ac94-f6d8e85a887e',
      method: 'POST',
      path: '/api/items',
    },
    new AbortController().signal,
  )
  // Assert
  assert.match(shown[0]?.detail ?? '', /for run 68ca83a9,/)
})

// protects=the learner sees the content type and the size of the body they confirm, never its content; fails_when=the detail omits the type or the byte count, or prints the body; no_claim=how the editor draws the modal
test('the confirmation names the content type and the body size in bytes but not the body', async () => {
  // Arrange
  const { show, shown } = modalAnswering('Send')
  // Act
  await createStateChangingRequestAsker(show)(
    {
      runId: 'run-1',
      method: 'POST',
      path: '/api/items',
      contentType: 'application/json',
      body: '{"token":"ひらがな"}',
    },
    new AbortController().signal,
  )
  // Assert: 12 ASCII bytes of JSON plus the 12 bytes of four 3-byte characters = 24
  assert.match(
    shown[0]?.detail ?? '',
    /The request body is 24 bytes of application\/json\./,
  )
  assert.doesNotMatch(shown[0]?.detail ?? '', /token/)
})

// protects=a request without a body says so; fails_when=the detail claims a body or a size for a DELETE with none; no_claim=none
test('the confirmation of a request without a body says it has none', async () => {
  // Arrange
  const { show, shown } = modalAnswering('Send')
  // Act
  await createStateChangingRequestAsker(show)(
    { runId: 'run-1', method: 'DELETE', path: '/api/items/7' },
    new AbortController().signal,
  )
  // Assert
  assert.match(shown[0]?.detail ?? '', /The request has no body\./)
})
