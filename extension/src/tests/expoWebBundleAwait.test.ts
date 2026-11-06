import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { test, type TestContext } from 'node:test'

import type { ExpoWebExit } from '../expoWebRefusals'
import { awaitExpoWebBundle } from '../utils/awaitExpoWebBundle'
import { SingleBundleCache } from '../utils/readSingleServedBundle'

const BUNDLE_PATH = '/entry.bundle?platform=web'
const SMALL_MAP = JSON.stringify({
  version: 3,
  sources: ['/app/a.js'],
  sourcesContent: ['a()'],
  names: [],
  mappings: 'AAAA',
})
const WATCH = {
  isRunning: () => true,
  exitStatus: () => ({ code: null, signal: null }) as unknown as ExpoWebExit,
  mask: (text: string) => text,
  onStep: () => undefined,
}

/** Answers one request; `count` is the 1-based number of requests the path has had. */
type Answer = (count: number, response: ServerResponse) => void

/** Serves a Metro-shaped fake whose entry page and bundle answers a test may replace. */
async function serve(
  context: TestContext,
  answers: { entry?: Answer; bundle?: Answer },
) {
  let entryCount = 0
  let bundleCount = 0
  const server = createServer((request, response) => {
    if (request.url === '/') {
      entryCount += 1
      if (answers.entry) return answers.entry(entryCount, response)
      response.end(`<script src="${BUNDLE_PATH}"></script>`)
    } else if (request.url === BUNDLE_PATH) {
      bundleCount += 1
      if (answers.bundle) return answers.bundle(bundleCount, response)
      response.end('a()\n//# sourceMappingURL=/entry.map\n')
    } else if (request.url === '/entry.map') {
      response.end(SMALL_MAP)
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => {
    server.closeAllConnections()
    return new Promise<void>((done) => server.close(() => done()))
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('The fixture server has no port.')
  return `http://127.0.0.1:${address.port}`
}

/** Runs the Expo wait and returns whether it became ready, or the refusal's reason, with how long it took. */
async function awaitUnder(origin: string, timeoutMs: number) {
  const startedAt = performance.now()
  const outcome = await awaitExpoWebBundle(
    origin,
    new SingleBundleCache('/'),
    timeoutMs,
    new AbortController().signal,
    WATCH,
  ).then(
    () => 'ready',
    (error: unknown) =>
      (error as { details?: { reason?: string } }).details?.reason ??
      'unexpected',
  )
  return { outcome, elapsedMs: performance.now() - startedAt }
}

/** Answers a redirect the first time and the real thing after. */
function redirectOnce(real: (response: ServerResponse) => void): Answer {
  return (count, response): void => {
    if (count > 1) return real(response)
    response.statusCode = 302
    response.setHeader('location', '/elsewhere')
    response.end()
  }
}

// Value: protects=review finding: a Metro redirect on the entry page is "not ready yet" and polled, not refused as a failed bundle; fails_when=a 3xx entry answer becomes bundle-failed at once; why_new=only an error status is Metro's error answer; seam=a loopback server answering 302 then the page; no_claim=a real Metro
test('the Expo wait keeps polling after a redirect on the entry page and becomes ready', async (context) => {
  // Arrange
  const origin = await serve(context, {
    entry: redirectOnce((response) =>
      response.end(`<script src="${BUNDLE_PATH}"></script>`),
    ),
  })
  // Act
  const result = await awaitUnder(origin, 10_000)
  // Assert
  assert.equal(result.outcome, 'ready')
})

// Value: protects=review finding: a Metro redirect on the bundle is "not ready yet" and polled, not refused as a failed bundle; fails_when=a 3xx bundle answer becomes bundle-failed at once; why_new=only an error status is Metro's error answer; seam=a loopback server answering 302 then the bundle; no_claim=a real Metro
test('the Expo wait keeps polling after a redirect on the bundle and becomes ready', async (context) => {
  // Arrange
  const origin = await serve(context, {
    bundle: redirectOnce((response) =>
      response.end('a()\n//# sourceMappingURL=/entry.map\n'),
    ),
  })
  // Act
  const result = await awaitUnder(origin, 10_000)
  // Assert
  assert.equal(result.outcome, 'ready')
})

// Value: protects=Metro's own error answer still ends the Expo wait at once as bundle-failed; fails_when=the 3xx fix also makes a 500 poll until the deadline; why_new=guards the other side of the status split; seam=a loopback server answering 500 for the bundle; no_claim=the quote text
test('the Expo wait refuses a 500 bundle answer at once as bundle-failed', async (context) => {
  // Arrange
  const origin = await serve(context, {
    bundle: (_count, response) => {
      response.statusCode = 500
      response.end('SyntaxError: boom')
    },
  })
  // Act
  const result = await awaitUnder(origin, 20_000)
  // Assert
  assert.equal(result.outcome, 'bundle-failed')
  assert.equal(result.elapsedMs < 5_000, true)
})

// Value: protects=review finding: a 500 entry page is still refused at once as bundle-failed; fails_when=the status split makes an error entry page poll; why_new=guards the entry page side; seam=a loopback server answering 500 for the entry page; no_claim=the quote text
test('the Expo wait refuses a 500 entry page at once as bundle-failed', async (context) => {
  // Arrange
  const origin = await serve(context, {
    entry: (_count, response) => {
      response.statusCode = 500
      response.end('boom')
    },
  })
  // Act
  const result = await awaitUnder(origin, 20_000)
  // Assert
  assert.equal(result.outcome, 'bundle-failed')
  assert.equal(result.elapsedMs < 5_000, true)
})

// Value: protects=review finding: a malformed script src alone is skipped and the page names no web bundle, so the Expo wait is refused at once, not at the setup deadline; fails_when=the malformed src is thrown into the poll-again catch-all; why_new=lazy URL construction; seam=a loopback server with one malformed src; no_claim=a real Metro
test('the Expo wait refuses an entry page whose only script src is malformed at once', async (context) => {
  // Arrange
  const origin = await serve(context, {
    entry: (_count, response) => {
      response.end('<script src="http://[bad"></script>')
    },
  })
  // Act
  const result = await awaitUnder(origin, 20_000)
  // Assert
  assert.equal(result.outcome, 'bundle-failed')
  assert.equal(result.elapsedMs < 5_000, true)
})

// Value: protects=review finding: a malformed script src beside exactly one valid web bundle does not block the start; fails_when=the malformed src stops the scan before the valid bundle; why_new=lazy URL construction; seam=a loopback server with a malformed and a valid src; no_claim=a real Metro
test('the Expo wait becomes ready when a malformed script src sits beside one valid web bundle', async (context) => {
  // Arrange
  const origin = await serve(context, {
    entry: (_count, response) => {
      response.end(
        `<script src="http://[bad"></script><script src="${BUNDLE_PATH}"></script>`,
      )
    },
  })
  // Act
  const result = await awaitUnder(origin, 10_000)
  // Assert
  assert.equal(result.outcome, 'ready')
})
