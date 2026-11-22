import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

import { DEVIN_DESCRIPTOR_LIMIT_BYTES } from '../constants'
import { DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE } from '../devinWindowSentences'
import { setDescriptorDevinChat } from '../utils/setDescriptorDevinChat'

import { removeTestFolder } from './utils/removeTestFolder'

const run = promisify(execFile)

/** Resolves with the settled outcome of `work`, or `'hung'` when it does not settle within the budget. */
async function settleWithin(
  timeoutMs: number,
  work: Promise<void>,
): Promise<'resolved' | 'hung' | Error> {
  const controller = new AbortController()
  try {
    return await Promise.race([
      work.then(
        () => 'resolved' as const,
        (error: unknown) =>
          error instanceof Error ? error : new Error(String(error)),
      ),
      sleep(timeoutMs, 'hung' as const, { signal: controller.signal }),
    ])
  } finally {
    controller.abort()
  }
}

test('mark update refuses a named pipe at the descriptor path instead of holding the descriptor queue', async (context) => {
  // protects=a pipe at the descriptor path cannot hang the descriptor queue; fails_when=the update waits on the pipe for ever; no_claim=another window's removal of the descriptor
  // Arrange
  if (process.platform === 'win32')
    return context.skip('Windows has no mkfifo to create a named pipe')
  const folder = await mkdtemp(join(tmpdir(), 'codebook-descriptor-fifo-'))
  const descriptorPath = join(folder, 'instance.connection.json')
  // Registered before mkfifo: a failed mkfifo still removes the folder.
  context.after(async () => {
    // Unblocks a read that is still waiting on the pipe, so the process can end.
    const releasing = await open(descriptorPath, 'r+').catch(() => undefined)
    await releasing?.close()
    await removeTestFolder(folder)
  })
  await run('mkfifo', [descriptorPath])

  // Act
  const outcome = await settleWithin(
    3_000,
    setDescriptorDevinChat(descriptorPath, true),
  )

  // Assert
  assert.ok(outcome instanceof Error, `expected a refusal, got ${outcome}`)
  assert.equal(outcome.message, DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE)
})

test('mark update refuses an oversized descriptor without reading it and leaves it unchanged', async (context) => {
  // protects=a huge file at the descriptor path is not read whole; fails_when=the update parses or rewrites a file over the size cap; no_claim=a descriptor that grows while it is read
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-descriptor-big-'))
  context.after(() => removeTestFolder(folder))
  const descriptorPath = join(folder, 'instance.connection.json')
  const oversized = JSON.stringify({
    url: 'http://127.0.0.1:1/mcp',
    padding: 'x'.repeat(DEVIN_DESCRIPTOR_LIMIT_BYTES),
  })
  await writeFile(descriptorPath, oversized, { mode: 0o600 })

  // Act
  const outcome = await settleWithin(
    3_000,
    setDescriptorDevinChat(descriptorPath, true),
  )

  // Assert
  assert.ok(outcome instanceof Error, `expected a refusal, got ${outcome}`)
  assert.equal(outcome.message, DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE)
  assert.equal(await readFile(descriptorPath, 'utf8'), oversized)
})
