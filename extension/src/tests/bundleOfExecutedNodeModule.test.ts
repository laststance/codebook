import assert from 'node:assert/strict'
import test from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { bundleOfExecutedNodeModule } from '../utils/bundleOfExecutedNodeModule'
import { createBundleVerifier } from '../utils/createBundleVerifier'

import {
  FIXTURE_ORIGINAL,
  FIXTURE_STOP_PATH,
  fixtureMap,
  fixtureScript,
} from './fixtures/node-api-module/tsxModule'

const SCRIPT_URL = 'file:///repo/apps/api/src/handler.ts'
const seal = (scriptSource: string, declaredHash = sha256(FIXTURE_ORIGINAL)) =>
  bundleOfExecutedNodeModule({
    scriptSource,
    scriptUrl: SCRIPT_URL,
    stopPath: FIXTURE_STOP_PATH,
    declaredHash,
  })

test('an E1-shaped tsx module is sealed and the verifier accepts its declared line', () => {
  // protects=API stops seal by executed content; fails_when=the adapter output is not a bundle createBundleVerifier accepts; no_claim=real tsx output
  // Arrange
  const script = fixtureScript(fixtureMap())
  // Act
  const result = seal(script)
  // Assert
  assert.equal(result.kind, 'bundle')
  if (result.kind !== 'bundle') return
  assert.equal(result.bundle.mapSource, FIXTURE_STOP_PATH)
  assert.equal(result.bundle.chunkPath, FIXTURE_STOP_PATH)
  const verifier = createBundleVerifier(result.bundle)
  assert.deepEqual(verifier.mappedPositions(3, 3).positions, [
    { line: 3, column: 3 },
  ])
})

test('a script whose retained original differs from the declared hash is source-drift', () => {
  // protects=a stale or edited file never seals; fails_when=a different original is accepted; no_claim=disk reads
  // Arrange
  const script = fixtureScript(
    fixtureMap({ sourcesContent: [`${FIXTURE_ORIGINAL}// edited\n`] }),
  )
  // Act
  const result = seal(script)
  // Assert
  assert.equal(result.kind, 'refused')
  assert.equal(result.kind === 'refused' && result.reason, 'source-drift')
})

test('a script with no map is source-unverifiable', () => {
  // protects=OV-4 no disk fallback; fails_when=a mapless script seals; no_claim=none
  // Arrange
  const script = fixtureScript(undefined)
  // Act
  const result = seal(script)
  // Assert
  assert.equal(
    result.kind === 'refused' && result.reason,
    'source-unverifiable',
  )
})

test('an external map is source-unverifiable', () => {
  // protects=external maps are never read; fails_when=an external map seals; no_claim=none
  // Arrange
  const script = `${fixtureScript(undefined)}//# sourceMappingURL=handler.js.map\n`
  // Act
  const result = seal(script)
  // Assert
  assert.equal(
    result.kind === 'refused' && result.reason,
    'source-unverifiable',
  )
})

test('a null sourcesContent entry is source-unverifiable', () => {
  // protects=a map without the original text never verifies; fails_when=null content seals or throws; no_claim=none
  // Arrange
  const script = fixtureScript(fixtureMap({ sourcesContent: [null] }))
  // Act
  const result = seal(script)
  // Assert
  assert.equal(
    result.kind === 'refused' && result.reason,
    'source-unverifiable',
  )
})

test('two entries resolving to the stop file are source-unverifiable', () => {
  // protects=ambiguous originals refused; fails_when=an alias pair seals; no_claim=none
  // Arrange
  const script = fixtureScript(
    fixtureMap({
      sources: [FIXTURE_STOP_PATH, '/repo/apps/api/src/../src/handler.ts'],
      sourcesContent: [FIXTURE_ORIGINAL, FIXTURE_ORIGINAL],
    }),
  )
  // Act
  const result = seal(script)
  // Assert
  assert.equal(
    result.kind === 'refused' && result.reason,
    'source-unverifiable',
  )
})

test('a relative source with a sourceRoot is source-unverifiable', () => {
  // protects=no map rewriting (D25); fails_when=sourceRoot or relative sources resolve; no_claim=none
  // Arrange
  const script = fixtureScript(
    fixtureMap({ sourceRoot: '/repo/apps/api', sources: ['src/handler.ts'] }),
  )
  // Act
  const result = seal(script)
  // Assert
  assert.equal(
    result.kind === 'refused' && result.reason,
    'source-unverifiable',
  )
})
