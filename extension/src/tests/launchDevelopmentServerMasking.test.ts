import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEVELOPMENT_SERVER_MESSAGE_QUEUE_LIMIT,
  REPOSITORY_APPLICATION_LOG_LIMIT_BYTES,
} from '../constants'
import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'
import { maskKnownValues } from '../utils/maskKnownValues'

const SECRET = 'plainsecretvalue-0123456789'

/** Launches a Node script with a masking spec and returns the app and the journal. */
function launch(script: string, values: string[] = [SECRET]) {
  const journal: { type: string; detail: unknown }[] = []
  const app = launchDevelopmentServer(
    process.cwd(),
    process.execPath,
    (type, detail) => journal.push({ type, detail }),
    false,
    0,
    {
      arguments: ['-e', script],
      environment: { PATH: process.env.PATH },
      mask: (text) => maskKnownValues(text, values),
      maskHoldback: () => Math.max(...values.map((value) => value.length)),
      name: 'Stub',
    },
  )
  return { app, journal }
}

/** Waits until the published tail holds a text. */
async function until(read: () => string, text: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!read().includes(text)) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${text}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// Value: protects=a secret that crosses the output size limit leaves no fragment in the closed evidence; fails_when=output is cut to its limit before it is masked; why_new=masking precedes every cut; seam=none; no_claim=a secret split over the limit and a chunk
test('a secret across the output tail limit leaves no fragment in application.closed', async () => {
  // Arrange
  // 3 characters of 'END' follow the filler, so the last limit bytes start 5 characters into the secret
  const after = REPOSITORY_APPLICATION_LOG_LIMIT_BYTES + 5 - SECRET.length - 3
  const { app, journal } = launch(
    `process.stdout.write('a'.repeat(300000) + '${SECRET}' + 'b'.repeat(${after}) + 'END');setInterval(()=>{},1000)`,
  )
  await until(() => app.outputTail(), 'END')
  // Act
  const tail = app.outputTail()
  await app.close()
  // Assert
  const closed = journal.find((entry) => entry.type === 'application.closed')
  const log = (closed?.detail as { log: string }).log
  assert.equal(log.includes(SECRET.slice(5)), false)
  assert.equal(log.includes(SECRET.slice(0, 10)), false)
  assert.equal(tail.includes(SECRET.slice(5)), false)
})

// Value: protects=a secret split over two stream chunks is never published half-masked; fails_when=a chunk is released before the rest of a known value can arrive; why_new=holdback keeps the end of the output pending; seam=none; no_claim=none
test('a secret split across two chunks is masked whole', async () => {
  // Arrange
  const { app } = launch(
    `process.stdout.write('x'.repeat(600000) + '${SECRET.slice(0, 12)}');setTimeout(()=>{process.stdout.write('${SECRET.slice(12)} END')},300);setInterval(()=>{},1000)`,
  )
  await until(() => app.outputTail(), 'END')
  // Act
  const tail = app.outputTail()
  await app.close()
  // Assert
  assert.equal(tail.includes(SECRET.slice(0, 8)), false)
  assert.equal(tail.includes(SECRET.slice(12)), false)
  assert.ok(tail.endsWith('[masked] END'))
})

// Value: protects=project code flooding process.send cannot grow memory; fails_when=every IPC message is queued; why_new=the queue is bounded and only protocol messages are kept; seam=none; no_claim=which messages are dropped
test('drops non-protocol messages and keeps at most the queue limit', async () => {
  // Arrange
  const app = launchDevelopmentServer(
    process.cwd(),
    process.execPath,
    () => undefined,
    false,
    0,
    {
      arguments: [
        '-e',
        `for (let i = 0; i < 100; i++) { process.send({ type: 'keep', i }); process.send('junk') }; setInterval(()=>{},1000)`,
      ],
      environment: { PATH: process.env.PATH },
      ipc: true,
      acceptMessage: (message) =>
        typeof message === 'object' && message !== null,
      name: 'Stub',
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
  // Act
  const received: unknown[] = []
  for (;;) {
    const message = await app
      .nextMessage(300, new AbortController().signal)
      .catch(() => undefined)
    if (message === undefined) break
    received.push(message)
  }
  await app.close()
  // Assert
  assert.equal(received.length, DEVELOPMENT_SERVER_MESSAGE_QUEUE_LIMIT)
  assert.deepEqual(received[0], { type: 'keep', i: 0 })
})
