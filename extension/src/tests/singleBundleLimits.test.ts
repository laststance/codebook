import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import {
  DEFAULT_SOURCE_MAP_LIMITS,
  EXPO_WEB_SOURCE_MAP_LIMITS,
  type SourceMapLimits,
} from '../sourceMapLimits'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { SingleBundleCache } from '../utils/readSingleServedBundle'
import { sealSingleBundleStop } from '../utils/sealSingleBundleStop'

import {
  createReactScriptsRepository,
  type ReactScriptsRepository,
} from './utils/reactScriptsFixture'
import { profileWith } from './utils/singleBundleProfileWith'

const APP_FOLDER = 'examples/counter'
/** Generated lines before the stop's mappings: above the shared 100,000 limit and inside the Expo profile's 1,000,000. */
const LEADING_GENERATED_LINES = 150_000
/** The first generated line the stop file is mapped on (the original lines 1 to 3 follow). */
const STOP_GENERATED_LINE = LEADING_GENERATED_LINES
const MIB = 1_048_576

/** How the served map differs from a small one: the generated lines before the stop and padding. */
type ServedMetroMap = {
  leadingGeneratedLines: number
  /** Pads the map's JSON to this many bytes. */
  padToBytes?: number
  /** Replaces the `mappings` altogether (a map the stop is never mapped in). */
  mappings?: string
}

/** Serves a Metro-shaped entry page, bundle and map for the stop file of a staged app. */
async function serveMetroBundle(
  context: TestContext,
  repository: ReactScriptsRepository,
  served: ServedMetroMap,
) {
  const stopPath = join(repository.appRoot, 'src/App.js')
  let port = 0
  const query = '?platform=web&dev=true'
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end(`<script src="/entry.bundle${query}" defer></script>`)
    } else if (request.url === `/entry.bundle${query}`) {
      response.setHeader('content-type', 'application/javascript')
      response.end(
        `${'\n'.repeat(served.leadingGeneratedLines)}a()\nb()\nc()\n//# sourceMappingURL=http://localhost:${port}/entry.map${query}\n`,
      )
    } else if (request.url === `/entry.map${query}`) {
      const body = {
        version: 3,
        sources: [stopPath],
        sourcesContent: [repository.sourceText],
        names: [] as string[],
        mappings:
          served.mappings ??
          `${';'.repeat(served.leadingGeneratedLines)}AAAA;AACA;AACA`,
        padding: '',
      }
      const bytes = Buffer.byteLength(JSON.stringify(body))
      body.padding = 'x'.repeat(Math.max(0, (served.padToBytes ?? 0) - bytes))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(body))
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
  return { origin: `http://127.0.0.1:${port}`, stopPath }
}

/** Seals the stop on line 2 of the staged app under a profile. */
async function sealUnder(
  context: TestContext,
  served: ServedMetroMap,
  limits: SourceMapLimits,
) {
  const repository = await createReactScriptsRepository(context)
  const server = await serveMetroBundle(context, repository, served)
  return () =>
    sealSingleBundleStop(
      {
        appRoot: repository.appRoot,
        packageRootRelative: APP_FOLDER,
        packageRelativePath: 'src/App.js',
        source: {
          path: `${APP_FOLDER}/src/App.js`,
          hash: repository.sourceHash,
          line: 2,
          column: 1,
        },
        citationEndLine: 3,
        ownedOrigin: server.origin,
        signal: new AbortController().signal,
        cache: new SingleBundleCache('/'),
      },
      profileWith(limits),
    )
}

/** Reads the refusal a seal ended with: reason, limit and limit value. */
async function refusalOf(sealing: () => Promise<unknown>) {
  const error = await sealing().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return {
    reason: error.details?.reason,
    limit: error.details?.limit,
    limitValue: error.details?.limitValue,
  }
}

// Value: protects=a Metro-sized map (a stop at generated line 150,001) is refused with map-limit under today's limits and sealed under the Expo profile; fails_when=the mapped-position limits are not read from the adapter's profile, so Expo refuses a bundle it must seal or the default stops refusing; why_new=Cycle 0089 E-1 (P08's stop sits at generated line 190,118); seam=a loopback server serving a generated Metro-shaped bundle and map; no_claim=a real Metro bundle (measured by the throwaway E-15 script)
test('a stop after 150,000 generated lines is refused with map-limit under the default limits and sealed under the Expo limits', async (context) => {
  // Arrange
  const served = { leadingGeneratedLines: LEADING_GENERATED_LINES }
  const underDefault = await sealUnder(
    context,
    served,
    DEFAULT_SOURCE_MAP_LIMITS,
  )
  const underExpo = await sealUnder(context, served, EXPO_WEB_SOURCE_MAP_LIMITS)
  // Act
  const defaultRefusal = await refusalOf(underDefault)
  const { bundle, limits } = await underExpo()
  // Assert
  assert.deepEqual(defaultRefusal, {
    reason: 'map-limit',
    limit: 'mapped-generated-lines',
    limitValue: 100_000,
  })
  assert.equal(bundle.sourcePath.endsWith('src/App.js'), true)
  assert.deepEqual(limits, EXPO_WEB_SOURCE_MAP_LIMITS)
})

// Value: protects=a map above today's 16 MiB byte limit and inside the Expo profile's 64 MiB is refused with map-limit (map-bytes) by default and sealed under Expo; fails_when=the served read or the sealed-map check keeps the fixed byte limit; why_new=Cycle 0089 E-1 (P08's map is 13.4 MB, a larger app crosses 16 MiB); seam=a loopback server padding the map JSON; no_claim=a real Metro map
test('a 17 MiB map is refused with map-bytes under the default limits and sealed under the Expo limits', async (context) => {
  // Arrange
  const served = { leadingGeneratedLines: 0, padToBytes: 17 * MIB }
  const underDefault = await sealUnder(
    context,
    served,
    DEFAULT_SOURCE_MAP_LIMITS,
  )
  const underExpo = await sealUnder(context, served, EXPO_WEB_SOURCE_MAP_LIMITS)
  // Act
  const defaultRefusal = await refusalOf(underDefault)
  const { bundle } = await underExpo()
  // Assert
  assert.deepEqual(defaultRefusal, {
    reason: 'map-limit',
    limit: 'map-bytes',
    limitValue: 16 * MIB,
  })
  assert.equal(bundle.source.startsWith('export function App'), true)
})

// Value: protects=map-limit names the Expo limit reached and its Expo value, not today's value; fails_when=the refusal names the shared constant or the wrong counter under the Expo profile; why_new=Cycle 0089 E-1 (map-limit names the limit reached); seam=a loopback server whose mappings begin 1,000,001 generated lines; no_claim=the scanned-characters and byte limits under Expo (the same replay, pinned by the default-profile tests)
test('a map beyond 1,000,000 generated lines is refused under the Expo limits naming mapped-generated-lines and its Expo value', async (context) => {
  // Arrange
  const sealing = await sealUnder(
    context,
    { leadingGeneratedLines: 0, mappings: `${';'.repeat(1_000_001)}AAAA` },
    EXPO_WEB_SOURCE_MAP_LIMITS,
  )
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    reason: 'map-limit',
    limit: 'mapped-generated-lines',
    limitValue: 1_000_000,
  })
})

// Value: protects=a map beyond 4,000,000 segments is refused under the Expo limits naming mapped-position-segments and its Expo value; fails_when=the segment counter uses the shared 200,000 limit or the refusal names it; why_new=Cycle 0089 E-1; seam=a loopback server whose mappings hold 4,000,001 empty segments; no_claim=real maps near the limit
test('a map beyond 4,000,000 segments is refused under the Expo limits naming mapped-position-segments and its Expo value', async (context) => {
  // Arrange
  const sealing = await sealUnder(
    context,
    { leadingGeneratedLines: 0, mappings: ','.repeat(4_000_001) },
    EXPO_WEB_SOURCE_MAP_LIMITS,
  )
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    reason: 'map-limit',
    limit: 'mapped-position-segments',
    limitValue: 4_000_000,
  })
})

// Value: protects=the verifier built with the sealed bundle's limits reads a stop at generated line 150,001 whole and verifies an exact pause there, while the default verifier cannot finish its scan; fails_when=createBundleVerifier ignores its limits parameter in the scan, the generated range or the pause check; why_new=Cycle 0089 E-12 (the verifier is on the stop's path); seam=a sealed bundle from the real seal over a loopback server; no_claim=js-debug's own binding (E1c)
test('the verifier of a Metro-sized sealed bundle reads the stop whole and verifies a pause at generated line 150,001 under the Expo limits only', async (context) => {
  // Arrange
  const sealing = await sealUnder(
    context,
    { leadingGeneratedLines: LEADING_GENERATED_LINES },
    EXPO_WEB_SOURCE_MAP_LIMITS,
  )
  const { bundle, limits } = await sealing()
  const verifier = createBundleVerifier(bundle, limits)
  const underDefault = createBundleVerifier(bundle)
  const location = {
    scriptId: '1',
    lineNumber: STOP_GENERATED_LINE + 1,
    columnNumber: 0,
  }
  // Act
  const scan = verifier.mappedPositions(2, 2)
  const range = verifier.generatedRangeOfLine(2)
  const verified = verifier.verify(
    bundle.javascript,
    bundle.source,
    location,
    '1',
    2,
    1,
  )
  const defaultScan = underDefault.mappedPositions(2, 2)
  // Assert
  assert.deepEqual(scan, {
    positions: [{ line: 2, column: 1 }],
    complete: true,
  })
  assert.equal(range.complete, true)
  assert.deepEqual(range.range?.start, {
    lineNumber: STOP_GENERATED_LINE + 1,
    columnNumber: 0,
  })
  assert.equal(verified.mapping.originalLine, 1)
  assert.equal(defaultScan.complete, false)
})

// Value: protects=a bundle of 9 MiB (above the 8 MiB default) is accepted by the verifier under the Expo limits and refused under the default; fails_when=bundleSchema keeps its fixed 8 MiB refinement; why_new=Cycle 0089 E-12 (bundleSchema's fixed refinements); seam=a bundle object built in the test; no_claim=a served 9 MiB bundle (the served read is covered by the seal tests)
test('a 9 MiB sealed bundle passes the verifier under the Expo limits and is refused under the default limits', async (context) => {
  // Arrange
  const sealing = await sealUnder(
    context,
    { leadingGeneratedLines: 0 },
    EXPO_WEB_SOURCE_MAP_LIMITS,
  )
  const { bundle } = await sealing()
  const large = {
    ...bundle,
    javascript: `${bundle.javascript}${' '.repeat(9 * MIB)}`,
  }
  // Act
  const underExpo = createBundleVerifier(large, EXPO_WEB_SOURCE_MAP_LIMITS)
  const underDefault = (): unknown => createBundleVerifier(large)
  // Assert
  assert.equal(underExpo.hashes.javascript.length, 64)
  assert.throws(underDefault, /JavaScript exceeds byte limit/)
})
