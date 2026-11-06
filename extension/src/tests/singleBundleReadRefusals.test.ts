import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { test, type TestContext } from 'node:test'

import type { StudyError } from '../errors'
import { EXPO_WEB_SINGLE_BUNDLE_PROFILE } from '../expoWebSingleBundleProfile'
import { REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE } from '../reactScriptsSingleBundleProfile'
import type { SingleBundleProfile } from '../singleBundleProfile'
import { EXPO_WEB_SOURCE_MAP_LIMITS } from '../sourceMapLimits'
import {
  readSingleServedBundle,
  SingleBundleCache,
  SingleBundleNotReadyError,
} from '../utils/readSingleServedBundle'

import { profileWith } from './utils/singleBundleProfileWith'

const BUNDLE_PATH = '/entry.bundle?platform=web'
const MAP_PATH = '/entry.map'
const SMALL_MAP = JSON.stringify({
  version: 3,
  sources: ['/app/a.js'],
  sourcesContent: ['a()'],
  names: [],
  mappings: 'AAAA',
})

/** What the fixture server answers for the bundle path. */
type BundleAnswer = (response: ServerResponse, port: number) => void

/** Serves an entry page naming `bundlePath` and records every other path requested. */
async function serve(
  context: TestContext,
  bundlePath: string,
  answerBundle: BundleAnswer,
) {
  const requested: string[] = []
  let port = 0
  const server = createServer((request, response) => {
    requested.push(request.url ?? '')
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end(`<script src="${bundlePath}"></script>`)
    } else if (request.url === bundlePath) {
      answerBundle(response, port)
    } else if (request.url === MAP_PATH) {
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
  port = address.port
  return { origin: `http://127.0.0.1:${port}`, requested }
}

/** Serves a bundle whose last line is the given `sourceMappingURL` value (`PORT` stands for the server's port). */
function bundleNaming(reference: string): BundleAnswer {
  return (response, port) =>
    response.end(
      `a()\n//# sourceMappingURL=${reference.replaceAll('PORT', String(port))}\n`,
    )
}

/** Reads the bundle under a profile and returns what it ended with. */
async function readUnder(
  origin: string,
  profile: SingleBundleProfile,
  deadlineMs?: number,
) {
  return readSingleServedBundle(
    origin,
    new AbortController().signal,
    new SingleBundleCache('/'),
    profile,
    deadlineMs === undefined ? undefined : performance.now() + deadlineMs,
  ).then(
    (served) => ({ served }),
    (error: unknown) => ({ error }),
  )
}

// Value: protects=SSRF review finding: a sourceMappingURL whose path starts with // or that resolves to another host is refused as an unreadable map and nothing but the entry page and bundle is requested; fails_when=the map address is joined onto the owned origin as a protocol-relative URL or fetched without an origin check; why_new=Cycle 0089 review round; seam=a loopback server and the real Expo profile; no_claim=a real Metro
for (const reference of [
  'http://localhost:PORT//evil.example/x.map',
  'http://localhost:PORT/.//evil.example/m.map',
  '//evil.example/x.map',
]) {
  test(`the Expo profile refuses the map reference ${reference} and fetches no map`, async (context) => {
    // Arrange
    const { origin, requested } = await serve(
      context,
      BUNDLE_PATH,
      bundleNaming(reference),
    )
    // Act
    const result = await readUnder(origin, EXPO_WEB_SINGLE_BUNDLE_PROFILE)
    // Assert
    assert.equal(
      'error' in result &&
        (result.error as { details?: { reason?: string } }).details?.reason,
      'map-unreadable',
    )
    assert.deepEqual(requested, ['/', BUNDLE_PATH])
  })
}

// Value: protects=SSRF review finding: the shared read refuses a map address on another origin even when a profile returns it; fails_when=readSingleServedBundle fetches whatever resolveMapUrl returns; why_new=second layer of the origin check; seam=a loopback server and a profile whose resolver returns a foreign address; no_claim=the Expo profile's own resolver
test('the shared read refuses a map address another origin even when the profile returns it', async (context) => {
  // Arrange
  const { origin, requested } = await serve(
    context,
    BUNDLE_PATH,
    bundleNaming('http://localhost:PORT/entry.map'),
  )
  const profile: SingleBundleProfile = {
    ...profileWith(EXPO_WEB_SOURCE_MAP_LIMITS),
    resolveMapUrl: () => new URL('http://evil.example/x.map'),
  }
  // Act
  const result = await readUnder(origin, profile)
  // Assert
  assert.equal(
    'error' in result &&
      (result.error as { details?: { reason?: string } }).details?.reason,
    'map-unreadable',
  )
  assert.deepEqual(requested, ['/', BUNDLE_PATH])
})

// Value: protects=a normal Metro map reference naming localhost is still rebased onto the owned origin and read; fails_when=the stricter origin checks refuse Metro's own host name; why_new=regression guard for the SSRF fix; seam=a loopback server and the real Expo profile; no_claim=a real Metro
test('the Expo profile still rebases a localhost map reference onto the owned origin', async (context) => {
  // Arrange
  const { origin } = await serve(
    context,
    BUNDLE_PATH,
    bundleNaming('http://localhost:PORT/entry.map'),
  )
  // Act
  const result = await readUnder(origin, EXPO_WEB_SINGLE_BUNDLE_PROFILE)
  // Assert
  assert.equal('served' in result && result.served.map.version, 3)
})

// Value: protects=review round: an inline data: map reference is refused at once as unreadable, not requested as a garbage path until the deadline; fails_when=the reference is resolved as a path and fetched; why_new=non-http map reference; seam=a loopback server and the Expo-shaped profile; no_claim=decoding inline maps
test('a data: sourceMappingURL is refused at once as an unreadable map', async (context) => {
  // Arrange
  const { origin, requested } = await serve(
    context,
    BUNDLE_PATH,
    bundleNaming('data:application/json;base64,e30='),
  )
  // Act
  const result = await readUnder(
    origin,
    profileWith(EXPO_WEB_SOURCE_MAP_LIMITS),
  )
  // Assert
  assert.deepEqual('error' in result && (result.error as StudyError).details, {
    reason: 'map-unreadable',
    problem: 'the bundle names a source map that is not an http(s) address',
  })
  assert.deepEqual(requested, ['/', BUNDLE_PATH])
})

// Value: protects=review round: under the react-scripts profile a non-success bundle answer with a stalled body is answered "not ready" at once without reading the body; fails_when=the shared read waits for the body before answering; why_new=quoting the error body is an opt-in of the profile; seam=a loopback server that sends a 500 head and never ends the body; no_claim=the Expo profile
test('the react-scripts profile answers a non-success bundle with a stalled body as not ready without reading it', async (context) => {
  // Arrange
  const { origin } = await serve(
    context,
    '/static/js/bundle.js',
    (response) => {
      response.statusCode = 500
      response.flushHeaders()
      response.write('Compiling')
    },
  )
  const startedAt = performance.now()
  // Act
  const result = await readUnder(origin, REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE)
  // Assert
  assert.ok('error' in result)
  assert.ok(result.error instanceof SingleBundleNotReadyError)
  assert.deepEqual(result.error.response, { status: 500, body: undefined })
  assert.equal(performance.now() - startedAt < 3_000, true)
})

// Value: protects=review round: an Expo error body over the cap keeps its truncated head for the bundle-failed quote; fails_when=the over-cap body is dropped and the quote falls back to the status; why_new=readCappedBody returned undefined for a long body; seam=a loopback server answering 500 with 70,000 bytes; no_claim=the quote's masking (adapter tests)
test('an Expo error body over the cap keeps its first 65,536 bytes', async (context) => {
  // Arrange
  const { origin } = await serve(context, BUNDLE_PATH, (response) => {
    response.statusCode = 500
    response.end(`Unable to resolve ./x${'y'.repeat(70_000)}`)
  })
  // Act
  const result = await readUnder(origin, EXPO_WEB_SINGLE_BUNDLE_PROFILE)
  // Assert
  assert.ok('error' in result)
  assert.ok(result.error instanceof SingleBundleNotReadyError)
  assert.equal(result.error.response?.status, 500)
  assert.equal(result.error.response?.body?.length, 65_536)
  assert.equal(
    result.error.response?.body?.startsWith('Unable to resolve ./x'),
    true,
  )
})
