import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BUILD_AND_RUN_LABEL,
  createViteLibraryRunAsker,
} from '../utils/createViteLibraryRunAsker'

import { defer } from './utils/defer'

const QUESTION = {
  runId: '1234567890abcdef',
  package: '@acme/widgets',
  packageRoot: 'packages/widgets',
  packageManager: 'pnpm',
  examplePackageRoot: 'examples/widgets-vite',
}

// protects=the dialog names the library, the package manager, the build folder, the Example and the run, and says the build runs the project's own scripts; fails_when=the learner is not told what builds before it builds; no_claim=the editor's rendering of the modal
test('the dialog names the build and pack and the Example it starts', async () => {
  // Arrange
  const shown: { message: string; detail: string; items: string[] }[] = []
  const ask = createViteLibraryRunAsker(
    async (message, detail, ...items) => {
      shown.push({ message, detail, items })
      return BUILD_AND_RUN_LABEL
    },
    () => undefined,
  )
  // Act
  const accepted = await ask(QUESTION, new AbortController().signal)
  // Assert
  assert.equal(accepted, true)
  assert.equal(shown[0]?.message, 'Build @acme/widgets and run the Example?')
  assert.match(shown[0]?.detail ?? '', /pnpm run build in packages\/widgets/)
  assert.match(shown[0]?.detail ?? '', /examples\/widgets-vite/)
  assert.match(shown[0]?.detail ?? '', /run 12345678\./)
  assert.match(shown[0]?.detail ?? '', /runs the project's own build scripts/)
  assert.deepEqual(shown[0]?.items, ['Build and run'])
})

// protects=Cancel and a dismissal answer false; fails_when=anything but Build and run starts the build; no_claim=none beyond protects
test('cancelling the dialog answers false', async () => {
  // Arrange
  const ask = createViteLibraryRunAsker(
    async () => undefined,
    () => undefined,
  )
  // Act
  const accepted = await ask(QUESTION, new AbortController().signal)
  // Assert
  assert.equal(accepted, false)
})

// protects=a Build and run clicked after the run stopped waiting starts nothing and shows the notice that the run already ended; fails_when=a late answer is taken as a yes or shows no notice; no_claim=that the editor cannot close the dialog
test('a late Build and run answers false once and shows the already-ended notice', async () => {
  // Arrange
  const choice = defer<string | undefined>()
  const notices: string[] = []
  const ask = createViteLibraryRunAsker(
    () => choice.promise,
    (shortRunId) => notices.push(shortRunId),
  )
  const abort = new AbortController()
  const pending = ask(QUESTION, abort.signal)
  // Act
  abort.abort()
  const accepted = await pending
  choice.resolve(BUILD_AND_RUN_LABEL)
  await Promise.resolve()
  // Assert
  assert.equal(accepted, false)
  assert.deepEqual(notices, ['12345678'])
})
