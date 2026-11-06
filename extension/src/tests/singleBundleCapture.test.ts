import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { readResource } from '../resources'
import {
  DEFAULT_SOURCE_MAP_LIMITS,
  EXPO_WEB_SOURCE_MAP_LIMITS,
} from '../sourceMapLimits'
import { SingleBundleCache } from '../utils/readSingleServedBundle'
import { sealSingleBundleStop } from '../utils/sealSingleBundleStop'

import { pausedViteRun } from './utils/pausedViteRun'
import { profileWith } from './utils/singleBundleProfileWith'

const MIB = 1_048_576
/** The generated JavaScript of the served bundle: above the 8 MiB default and inside the Expo profile's 32 MiB. */
const BUNDLE_PADDING_BYTES = 9 * MIB
/** The served map's names: above the 16 MiB default and inside the Expo profile's 64 MiB. */
const MAP_PADDING_BYTES = 17 * MIB

/** Serves an entry page, a 9 MiB bundle and a 17 MiB map whose one source is the file `stop()` names. */
async function serveLargeBundle(context: TestContext) {
  const stop: { path: string; text: string } = { path: '', text: '' }
  let port = 0
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end('<script src="/entry.bundle?platform=web"></script>')
    } else if (request.url === '/entry.bundle?platform=web') {
      response.setHeader('content-type', 'application/javascript')
      response.end(
        `const nextTheme = "dark";\n/*${'x'.repeat(BUNDLE_PADDING_BYTES)}*/\n//# sourceMappingURL=http://127.0.0.1:${port}/entry.map\n`,
      )
    } else if (request.url === '/entry.map') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          version: 3,
          sources: [stop.path],
          sourcesContent: [stop.text],
          names: ['n'.repeat(MAP_PADDING_BYTES)],
          mappings: 'AAAA',
        }),
      )
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((done) => server.close(() => done())))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('The fixture server has no port.')
  port = address.port
  return { stop, origin: `http://127.0.0.1:${port}` }
}

// Value: protects=a stop sealed from a 9 MiB bundle and a 17 MiB map, above today's limits and inside the Expo profile's, pauses, verifies and has its JavaScript and map read back whole as evidence; fails_when=any reader on the stop's path (the seal, bundleSchema, the verifier, the source resource) keeps today's limits, so the run fails or the evidence read is refused; why_new=Cycle 0089 E-12 (limits reach every reader); seam=the controlled runtime with the real single-bundle seal over a loopback server; no_claim=a real Metro bundle or js-debug's binding
test('a stop sealed from a bundle and map above the default limits pauses and serves its JavaScript and map as evidence under the Expo limits', async (context) => {
  // Arrange
  const server = await serveLargeBundle(context)
  const cache = new SingleBundleCache('/')
  const { service, record } = await pausedViteRun(
    context,
    'plainsecret1',
    undefined,
    {
      realSourceRoot: true,
      sealBundle: async (request) => {
        const stopPath = join(
          await realpath(request.workspace),
          request.source.path,
        )
        server.stop.path = stopPath
        server.stop.text = await readFile(stopPath, 'utf8')
        return sealSingleBundleStop(
          {
            appRoot: request.workspace,
            packageRootRelative: '.',
            packageRelativePath: request.source.path,
            source: request.source,
            citationEndLine: request.citationEndLine,
            ownedOrigin: server.origin,
            signal: request.signal,
            cache,
          },
          profileWith(EXPO_WEB_SOURCE_MAP_LIMITS),
        )
      },
    },
  )
  const snapshotUri = service.state(record).observations[0]!.snapshotUri
  // Act
  const javascript = await readResource(
    service,
    `${snapshotUri}/source/javascript`,
  )
  const map = await readResource(service, `${snapshotUri}/source/map`)
  // Assert
  assert.ok('text' in javascript && 'text' in map)
  assert.equal(javascript.text.length > BUNDLE_PADDING_BYTES, true)
  assert.equal(map.text.length > MAP_PADDING_BYTES, true)
  assert.equal(
    DEFAULT_SOURCE_MAP_LIMITS.bundleBytes < BUNDLE_PADDING_BYTES,
    true,
  )
})
