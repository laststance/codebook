import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createNodeScriptRunAsker,
  RUN_SCRIPT_LABEL,
} from '../utils/createNodeScriptRunAsker'

import { defer } from './utils/defer'

const QUESTION = {
  runId: '1234567890abcdef',
  entry: 'test-esm.mjs',
  packageRoot: 'examples/publish-ci/node',
}

// protects=the dialog names the entry, the package folder and the run, and says the script may change files, databases or remote services; fails_when=the learner is not told what runs or that it has real effects; no_claim=the editor's rendering of the modal
test('the dialog names the script, its package folder and the run and warns of its effects', async () => {
  // Arrange
  const shown: Array<{ message: string; detail: string; items: string[] }> = []
  const ask = createNodeScriptRunAsker(
    async (message, detail, ...items) => {
      shown.push({ message, detail, items })
      return RUN_SCRIPT_LABEL
    },
    () => undefined,
  )

  // Act
  const accepted = await ask(QUESTION, new AbortController().signal)

  // Assert
  assert.equal(accepted, true)
  assert.equal(shown[0]?.message, 'Run test-esm.mjs once?')
  assert.match(shown[0]?.detail ?? '', /examples\/publish-ci\/node/)
  assert.match(shown[0]?.detail ?? '', /run 12345678\./)
  assert.match(
    shown[0]?.detail ?? '',
    /change files, databases or remote services/,
  )
  assert.deepEqual(shown[0]?.items, ['Run once'])
})

// protects=Cancel and a dismissal answer false; fails_when=anything but Run once starts the script; no_claim=none beyond protects
test('cancelling the dialog answers false', async () => {
  // Arrange
  const ask = createNodeScriptRunAsker(
    async () => undefined,
    () => undefined,
  )

  // Act
  const accepted = await ask(QUESTION, new AbortController().signal)

  // Assert
  assert.equal(accepted, false)
})

// protects=a Run once clicked after the run stopped waiting starts nothing and shows the notice that the run already ended; fails_when=a late answer is taken as a yes or shows no notice; no_claim=that the editor cannot close the dialog
test('a late Run once after the run stopped waiting answers false once and shows the already-ended notice', async () => {
  // Arrange
  const choice = defer<string | undefined>()
  const notices: string[] = []
  const ask = createNodeScriptRunAsker(
    () => choice.promise,
    (shortRunId) => notices.push(shortRunId),
  )
  const abort = new AbortController()
  const pending = ask(QUESTION, abort.signal)

  // Act
  abort.abort()
  const accepted = await pending
  choice.resolve(RUN_SCRIPT_LABEL)
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(accepted, false)
  assert.deepEqual(notices, ['12345678'])
})

// protects=an already aborted wait shows no dialog at all; fails_when=a modal opens for a run that ended; no_claim=none beyond protects
test('a wait that already ended shows no dialog', async () => {
  // Arrange
  let shownCount = 0
  const ask = createNodeScriptRunAsker(
    async () => {
      shownCount += 1
      return RUN_SCRIPT_LABEL
    },
    () => undefined,
  )
  const abort = new AbortController()
  abort.abort()

  // Act
  const accepted = await ask(QUESTION, abort.signal)

  // Assert
  assert.equal(accepted, false)
  assert.equal(shownCount, 0)
})
