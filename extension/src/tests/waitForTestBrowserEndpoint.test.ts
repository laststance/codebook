import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitForTestBrowserEndpoint } from './utils/waitForTestBrowserEndpoint'

/**
 * A fake clock, sleep and file reader for one wait: the sleep and each read advance the clock, and the reader answers with the text a test gives for the current time.
 * @param answerAt - The file text at a fake time: `undefined` when the file does not exist yet (an `ENOENT` rejection), an `Error` to reject with.
 * @param readMs - How much fake time each read takes.
 * @returns The seams to pass, the clock, the number of reads and the paths read.
 * @example const fake = fakeStart((nowMs) => (nowMs >= 2_000 ? '51234\n/devtools/browser/abc' : undefined))
 */
function fakeStart(
  answerAt: (nowMs: number) => string | Error | undefined,
  readMs = 0,
) {
  const state = { nowMs: 0, reads: 0, paths: new Set<string>() }
  return {
    state,
    seams: {
      now: () => state.nowMs,
      sleep: async (ms: number): Promise<void> => {
        state.nowMs += ms
      },
      readText: async (path: string) => {
        state.reads += 1
        state.paths.add(path)
        const answer = answerAt(state.nowMs)
        state.nowMs += readMs
        if (answer === undefined)
          throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
        if (answer instanceof Error) throw answer
        return answer
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
  // node:path joins with the platform's separator, so Windows reads the backslash spelling.
  assert.deepEqual(
    [...fake.state.paths],
    [
      process.platform === 'win32'
        ? '\\profile\\DevToolsActivePort'
        : '/profile/DevToolsActivePort',
    ],
  )
})

// Value: protects=CI-1: a Chrome that never publishes its endpoint fails the test at its bound with a sentence naming it, neither earlier nor long after, after a last look at the bound; fails_when=the wait gives up before the bound, keeps waiting past it by more than one poll, or skips the look at the bound (10 reads instead of 11); no_claim=the real file system (the fake reader answers that no file exists)
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
  // gstack-timing-ok: nowMs is the injected fake clock, and the bound is the contract under test.
  assert.ok(fake.state.nowMs >= 1_000)
  assert.ok(fake.state.nowMs <= 1_100) // gstack-timing-ok: the same fake clock.
  assert.equal(fake.state.reads, 11)
})

// Value: protects=a Chrome that crashed at start fails the test at once with a sentence saying it ended, instead of waiting out the 30 s bound; fails_when=the wait ignores the ended process and runs to the bound; no_claim=a real crash (a flag stands in for the child's exit code)
test('a test browser that exits before publishing its endpoint fails at once', async () => {
  // Arrange
  const fake = fakeStart(() => undefined)
  let exited = false

  // Act
  const failure = await waitForTestBrowserEndpoint('/profile', {
    ...fake.seams,
    hasExited: () => {
      // The process ends during the first pause.
      const ended = exited
      exited = true
      return ended
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(
    failure.message,
    'Chrome exited before it published its debugging endpoint.',
  )
  assert.equal(fake.state.reads, 2)
  assert.equal(fake.state.nowMs, 100)
})

// Value: protects=a read failure other than a missing file (a permission or descriptor error) is named in the failure, so a CI log shows the cause; fails_when=the failure hides it behind the generic sentence, or names a plain missing file; no_claim=a real EACCES (the fake reader rejects with that code)
test('a read that fails with more than a missing file is named when the wait gives up', async () => {
  // Arrange
  const fake = fakeStart((nowMs) =>
    nowMs < 500
      ? Object.assign(new Error('permission denied'), { code: 'EACCES' })
      : undefined,
  )

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
    'Chrome published no debugging endpoint within 1 s. The last read failed with EACCES.',
  )
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
