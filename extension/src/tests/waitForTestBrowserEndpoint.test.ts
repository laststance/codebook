import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitForTestBrowserEndpoint } from './utils/waitForTestBrowserEndpoint'

/**
 * A fake clock, sleep and file reader for one wait: the sleep and each read advance the clock, and the reader answers with the text a test gives for the current time.
 * @param answerAt - The file text at a fake time (`undefined` when the file does not exist yet).
 * @param readMs - How much fake time each read takes.
 * @returns The seams to pass, the clock and the number of reads.
 * @example const fake = fakeStart((nowMs) => (nowMs >= 2_000 ? '51234\n/devtools/browser/abc' : undefined))
 */
function fakeStart(
  answerAt: (nowMs: number) => string | undefined,
  readMs = 0,
) {
  const state = { nowMs: 0, reads: 0 }
  return {
    state,
    seams: {
      now: () => state.nowMs,
      sleep: async (ms: number): Promise<void> => {
        state.nowMs += ms
      },
      readText: async () => {
        state.reads += 1
        const text = answerAt(state.nowMs)
        state.nowMs += readMs
        if (text === undefined) throw new Error('ENOENT: no such file')
        return text
      },
    },
  }
}

// Value: protects=CI-1: a test browser whose first start on a cold runner takes 25 s still connects, because the wait uses Codebook's own start bound; fails_when=the default bound is shorter than a measured cold start (the old 10 s and 20 s loops fail here); no_claim=a real Chrome start (the fake reader stands in for its DevToolsActivePort file)
test('a test browser that publishes its endpoint after 25 s on a cold runner is still connected', async () => {
  // Arrange
  const fake = fakeStart((nowMs) =>
    nowMs >= 25_000 ? '51234\n/devtools/browser/cold-start' : undefined,
  )

  // Act
  const endpoint = await waitForTestBrowserEndpoint('/profile', fake.seams)

  // Assert
  assert.deepEqual(endpoint, {
    port: 51234,
    path: '/devtools/browser/cold-start',
  })
  assert.equal(fake.state.nowMs, 25_000)
})

// Value: protects=CI-1: a Chrome that never publishes its endpoint fails the test at its bound with a sentence naming it, neither earlier nor long after; fails_when=the wait gives up before the bound or keeps waiting past it by more than one poll; no_claim=the real file system (the fake reader answers that no file exists)
test('a test browser that never publishes its endpoint fails at the bound with the bound named', async () => {
  // Arrange
  const fake = fakeStart(() => undefined)

  // Act
  const failure = await waitForTestBrowserEndpoint('/profile', {
    ...fake.seams,
    boundMs: 1_000,
    pollMs: 100,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(
    failure.message,
    'Chrome published no debugging endpoint within 1 s.',
  )
  assert.ok(fake.state.nowMs >= 1_000)
  assert.ok(fake.state.nowMs <= 1_100)
})

// Value: protects=a half-written DevToolsActivePort is read again instead of failing the test or connecting to nothing; fails_when=an unparsable first read ends the wait or is returned as an endpoint; no_claim=Chrome's write timing (the fake reader gives a port line alone, then the full file)
test('a half-written endpoint file is read again until the full endpoint is there', async () => {
  // Arrange
  const fake = fakeStart((nowMs) =>
    nowMs < 300 ? '51234' : '51234\n/devtools/browser/full',
  )

  // Act
  const endpoint = await waitForTestBrowserEndpoint('/profile', fake.seams)

  // Assert
  assert.deepEqual(endpoint, { port: 51234, path: '/devtools/browser/full' })
  assert.equal(fake.state.reads, 4)
})

// Value: protects=the bound covers the time reads take, so slow reads of a loaded runner cannot stretch the wait; fails_when=only the pauses count, which lets a 1 s bound run about ten 400 ms reads; no_claim=real disk latency (each fake read takes 400 ms of fake time)
test('slow reads count toward the bound, so the wait ends after three reads of a 1 s bound', async () => {
  // Arrange
  const fake = fakeStart(() => undefined, 400)

  // Act
  const failure = await waitForTestBrowserEndpoint('/profile', {
    ...fake.seams,
    boundMs: 1_000,
    pollMs: 100,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(fake.state.reads, 3)
  assert.equal(fake.state.nowMs, 1_400)
})
