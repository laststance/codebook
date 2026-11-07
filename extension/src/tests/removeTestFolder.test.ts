import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import fsPromises, { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { removeTestFolder } from './utils/removeTestFolder'

// Value: protects=the cleanup of a test folder under a loaded suite, where a writer (a frame writer, a step left running) still creates files in the folder while it is removed: the removal ends with the folder gone instead of an ENOTEMPTY failure of an unchanged test; fails_when=the helper rejects or leaves the folder behind while a writer is still adding files; no_claim=it does not catch a helper that drops its retries: a bare recursive rm usually finishes between two writes on a fast machine, so the first attempt need not hit ENOTEMPTY; the next test pins the retry options
test('removes a test folder a writer is still filling', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-remove-test-folder-'))
  const writerWindowMs = 300
  const writerPauseMs = 3
  let isRemovalDone = false
  const writer = (async () => {
    const startedAtMs = Date.now()
    let fileNumber = 0
    while (!isRemovalDone && Date.now() - startedAtMs < writerWindowMs) {
      fileNumber += 1
      // The writer never recreates the folder: a write into a removed folder ends the loop.
      await writeFile(join(folder, `frame-${fileNumber}.json`), '{}').catch(
        () => {
          isRemovalDone = true
        },
      )
      await sleep(writerPauseMs)
    }
  })()

  // Act
  await sleep(writerPauseMs * 2)
  await removeTestFolder(folder)
  isRemovalDone = true
  await writer

  // Assert
  assert.equal(existsSync(folder), false)
})

// Value: protects=the retry budget of the cleanup of test folders: up to five retries, 100 ms apart, recursive and forced, so a folder a writer fills for a moment is removed and an absent folder is no error; fails_when=the helper drops the retries, the pause, recursive or force; no_claim=rm is a mock here; Node's own retry on ENOTEMPTY, EBUSY and EPERM is not exercised
test('asks Node for 5 retries 100 ms apart, recursive and forced', async (context) => {
  // Arrange
  const removeCalls = context.mock.method(
    fsPromises,
    'rm',
    async (): Promise<void> => undefined,
  )

  // Act
  await removeTestFolder('/tmp/a-test-folder')

  // Assert
  assert.deepEqual(
    removeCalls.mock.calls.map((call) => call.arguments),
    [
      [
        '/tmp/a-test-folder',
        { recursive: true, force: true, maxRetries: 5, retryDelay: 100 },
      ],
    ],
  )
})
