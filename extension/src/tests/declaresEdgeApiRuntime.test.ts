import assert from 'node:assert/strict'
import { test } from 'node:test'

import { declaresEdgeApiRuntime } from '../utils/declaresEdgeApiRuntime'

// Value: protects=AC 4 an exported config literal with runtime edge (either name, with a type annotation) is read as Edge; fails_when=an Edge route is armed and fails at run time; no_claim=a runtime set any other way
test('an exported config literal with runtime edge or experimental-edge is an Edge route', () => {
  // Arrange
  const sources = [
    "export const config = { runtime: 'edge' }",
    'export const config: PageConfig = {\n  runtime: "experimental-edge",\n}',
  ]
  // Act
  const results = sources.map(declaresEdgeApiRuntime)
  // Assert
  assert.deepEqual(results, [true, true])
})

// Value: protects=E-4 one nested object before runtime (api: { bodyParser: false }) is still read; fails_when=a runtime after the api object is missed; no_claim=two levels of nesting (not decided from source)
test('an Edge runtime after one nested config object is found', () => {
  // Arrange
  const source =
    "export const config = {\n  api: { bodyParser: false },\n  runtime: 'edge',\n}\n"
  // Act
  const result = declaresEdgeApiRuntime(source)
  // Assert
  assert.equal(result, true)
})

// Value: protects=a commented-out or templated declaration, and a runtime key inside the nested api object, never refuse a Node route; fails_when=text in a comment or a nested key refuses a Node route; no_claim=a runtime in a regular expression literal
test('an Edge declaration in a comment or a nested object does not make the route Edge', () => {
  // Arrange
  const sources = [
    "// export const config = { runtime: 'edge' }\nexport const config = { runtime: 'nodejs' }",
    "/* export const config = { runtime: 'edge' } */\nexport default function handler() {}",
    "export const config = { api: { runtime: 'edge' } }",
  ]
  // Act
  const results = sources.map(declaresEdgeApiRuntime)
  // Assert
  assert.deepEqual(results, [false, false, false])
})

// Value: protects=a runtime set by a constant or a re-export, or after two levels of nesting, is not decided from source, so the stop is armed; fails_when=such a route is refused as Edge although the text does not say so; no_claim=what the run does at run time for such a route (not reached with the possibility named)
test('a runtime that is not a quoted literal within one nesting level is not decided as Edge', () => {
  // Arrange
  const sources = [
    'export const config = { runtime: RUNTIME }',
    "export const config = { api: { parser: { limit: 1 } }, runtime: 'edge' }",
    "export { config } from './config'",
    'export const config = baseConfig',
  ]
  // Act
  const results = sources.map(declaresEdgeApiRuntime)
  // Assert
  assert.deepEqual(results, [false, false, false, false])
})
