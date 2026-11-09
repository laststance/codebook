import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { Protocol } from 'devtools-protocol'

import { inspectConfiguredValues } from '../utils/inspectConfiguredValues'
import { minifiedPathOf } from '../utils/minifiedPathOf'

/** Base64 digits a source map's VLQ fields are written in. */
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Writes one signed number as a VLQ field. */
function vlq(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2
  let field = ''
  do {
    let digit = rest % 32
    rest = Math.floor(rest / 32)
    if (rest > 0) digit += 32
    field += BASE64[digit]
  } while (rest > 0)
  return field
}

/**
 * Builds a one-line map whose segments all point at original line 0, column 0 and carry a name.
 * @param names - The map's `names`.
 * @param mapped - Each mapping: the text `at` found inside the text `inside` (or in the script when absent), and the name it carries.
 * @param script - The generated script.
 */
function mapOf(
  names: string[],
  mapped: { at: string; inside?: string; name: string }[],
  script: string,
): string {
  const columns = mapped
    .map(({ at, inside, name }) => ({
      column:
        inside === undefined
          ? script.indexOf(at)
          : script.indexOf(inside) + inside.indexOf(at),
      nameIndex: names.indexOf(name),
    }))
    .sort((left, right) => left.column - right.column)
  let previousColumn = 0,
    previousName = 0
  const segments = columns.map(({ column, nameIndex }) => {
    const segment = `${vlq(column - previousColumn)}${vlq(0)}${vlq(0)}${vlq(0)}${vlq(nameIndex - previousName)}`
    previousColumn = column
    previousName = nameIndex
    return segment
  })
  return JSON.stringify({
    version: 3,
    sources: ['src/lib.ts'],
    names,
    mappings: segments.join(','),
  })
}

/** A scope of the paused frame covering `text` of the script. */
function scopeOf(
  script: string,
  text: string,
  type: Protocol.Debugger.Scope['type'],
): Protocol.Debugger.Scope {
  const start = script.indexOf(text)
  return {
    type,
    object: { type: 'object' },
    startLocation: { scriptId: '1', lineNumber: 0, columnNumber: start },
    endLocation: {
      scriptId: '1',
      lineNumber: 0,
      columnNumber: start + text.length,
    },
  }
}

const GLOBAL_SCOPE: Protocol.Debugger.Scope = {
  type: 'global',
  object: { type: 'object' },
}

const OUTER =
  'function o(){var l=0;function h(){return l}function d(t){return t.type}function k(){return 1}}'
const SCRIPT = `${OUTER};`

// Value: protects=native finding (VS Code, 52c4934e): a library stop in a minified build reads a source name through the map names; fails_when=the closure binding `currentState` is not found under its generated name `l`; no_claim=which scope V8 reports for other build tools
test('a closure binding the minifier renamed is found in the closure scope of the paused function', () => {
  // Arrange
  const map = mapOf(
    ['currentState'],
    [
      { at: 'l=0', inside: OUTER, name: 'currentState' },
      { at: 'l}', inside: 'return l}', name: 'currentState' },
    ],
    SCRIPT,
  )
  const scopeChain = [
    scopeOf(SCRIPT, 'function k(){return 1}', 'local'),
    scopeOf(SCRIPT, OUTER, 'closure'),
    GLOBAL_SCOPE,
  ]

  // Act
  const rewritten = minifiedPathOf(
    'currentState.length',
    map,
    SCRIPT,
    scopeChain,
  )

  // Assert
  assert.deepEqual(rewritten, {
    name: 'currentState',
    compiledPath: 'l.length',
  })
})

// Value: protects=a renamed parameter (`action` of dispatch) is read through the map; fails_when=the local scope is skipped or the rest of the path is dropped; no_claim=destructured parameters
test('a parameter the minifier renamed is found in the local scope and keeps the rest of the path', () => {
  // Arrange
  const map = mapOf(
    ['action'],
    [
      { at: 't)', inside: 'function d(t)', name: 'action' },
      { at: 't.type', inside: 'return t.type', name: 'action' },
    ],
    SCRIPT,
  )
  const scopeChain = [scopeOf(SCRIPT, 'function d(t){return t.type}', 'local')]

  // Act
  const rewritten = minifiedPathOf('action.type', map, SCRIPT, scopeChain)

  // Assert
  assert.deepEqual(rewritten, { name: 'action', compiledPath: 't.type' })
})

// Value: protects=never guess: two generated variables for one source name in the deciding scope give no rewrite; fails_when=the first of two candidates is read, which could be another variable; no_claim=how a minifier chooses names
test('a source name that maps to two different variables of one scope stays unresolved', () => {
  // Arrange
  const map = mapOf(
    ['value'],
    [
      { at: 'l=0', inside: OUTER, name: 'value' },
      { at: 't)', inside: 'function d(t)', name: 'value' },
    ],
    SCRIPT,
  )
  const scopeChain = [scopeOf(SCRIPT, OUTER, 'closure')]

  // Act
  const rewritten = minifiedPathOf('value', map, SCRIPT, scopeChain)

  // Assert
  assert.equal(rewritten, undefined)
})

// Value: protects=a name the map does not carry stays unavailable; fails_when=a name is invented for an unmapped source name; no_claim=maps without names
test('a source name without any mapping stays unresolved', () => {
  // Arrange
  const map = mapOf(
    ['other'],
    [{ at: 'l=0', inside: OUTER, name: 'other' }],
    SCRIPT,
  )

  // Act
  const rewritten = minifiedPathOf('currentState', map, SCRIPT, [
    scopeOf(SCRIPT, OUTER, 'closure'),
  ])

  // Assert
  assert.equal(rewritten, undefined)
})

// Value: protects=the innermost scope that holds the name decides, so a shadowing inner variable beats an outer one; fails_when=the outer scope is read first and the two variables count as ambiguous or the outer one wins; no_claim=block scopes
test('an inner scope that holds the name wins over the outer scope', () => {
  // Arrange
  const script = 'function o(i){var p=1;function n(){var q=2;return q}return i}'
  const innerText = 'function n(){var q=2;return q}'
  const map = mapOf(
    ['v'],
    [
      { at: 'q=2', inside: innerText, name: 'v' },
      { at: 'i)', inside: 'function o(i)', name: 'v' },
    ],
    script,
  )

  // Act
  const fromInner = minifiedPathOf('v', map, script, [
    scopeOf(script, innerText, 'local'),
    scopeOf(script, script, 'closure'),
  ])
  const fromOuterOnly = minifiedPathOf('v', map, script, [
    scopeOf(script, script, 'local'),
  ])

  // Assert
  assert.deepEqual(fromInner, { name: 'v', compiledPath: 'q' })
  assert.equal(fromOuterOnly, undefined)
})

// Value: protects=a property access that shares the source name is not a variable; fails_when=`s.currentState` counts as a second candidate and blocks a clear binding; no_claim=computed keys
test('a mapped property access is not counted as a variable of the frame', () => {
  // Arrange
  const script = 'function o(){var l=0;return s.currentState+l}'
  const map = mapOf(
    ['currentState'],
    [
      { at: 'l=0', inside: script, name: 'currentState' },
      { at: 'currentState+', inside: script, name: 'currentState' },
    ],
    script,
  )

  // Act
  const rewritten = minifiedPathOf('currentState', map, script, [
    scopeOf(script, script, 'local'),
  ])

  // Assert
  assert.deepEqual(rewritten, { name: 'currentState', compiledPath: 'l' })
})

// Value: protects=a wrong value is never saved as observed: an inner function that reuses the generated identifier for another name makes the evaluation read the inner variable; fails_when=the outer `a` is chosen although the paused inner scope binds `a` as `other`; no_claim=block scopes
test('a generated identifier an inner scope reuses for another source name stays unresolved', () => {
  // Arrange
  const script = 'function o(){var a=0;function i(a){return a}return a}'
  const innerText = 'function i(a){return a}'
  const map = mapOf(
    ['currentState', 'other'],
    [
      { at: 'a=0', inside: script, name: 'currentState' },
      { at: 'a)', inside: innerText, name: 'other' },
    ],
    script,
  )

  // Act
  const rewritten = minifiedPathOf('currentState', map, script, [
    scopeOf(script, innerText, 'local'),
    scopeOf(script, script, 'closure'),
  ])

  // Assert
  assert.equal(rewritten, undefined)
})

// Value: protects=the plain closure case still resolves when the inner scope has no binding of the identifier; fails_when=any inner scope blocks the rewrite; no_claim=other minifiers
test('a closure identifier no inner scope reuses is still resolved', () => {
  // Arrange
  const script = 'function o(){var l=0;function i(a){return a+l}return l}'
  const innerText = 'function i(a){return a+l}'
  const map = mapOf(
    ['currentState', 'other'],
    [
      { at: 'l=0', inside: script, name: 'currentState' },
      { at: 'a)', inside: innerText, name: 'other' },
    ],
    script,
  )

  // Act
  const rewritten = minifiedPathOf('currentState', map, script, [
    scopeOf(script, innerText, 'local'),
    scopeOf(script, script, 'closure'),
  ])

  // Assert
  assert.deepEqual(rewritten, { name: 'currentState', compiledPath: 'l' })
})

// Value: protects=an inner scope that uses the identifier only as the same source name does not block; fails_when=the same name inside an inner scope counts as a conflicting binding; no_claim=different bindings of one name
test('an inner scope that uses the identifier as the same source name still resolves', () => {
  // Arrange
  const script = 'function o(){var a=0;function i(){return a}return a}'
  const innerText = 'function i(){return a}'
  const map = mapOf(
    ['currentState'],
    [
      { at: 'a=0', inside: script, name: 'currentState' },
      { at: 'a}', inside: innerText, name: 'currentState' },
    ],
    script,
  )

  // Act
  const rewritten = minifiedPathOf('currentState', map, script, [
    scopeOf(script, innerText, 'local'),
    scopeOf(script, script, 'closure'),
  ])

  // Assert
  assert.deepEqual(rewritten, { name: 'currentState', compiledPath: 'a' })
})

/** Evaluates on a scripted frame as V8 does: an unknown name throws its ReferenceError. */
function pausedFrame(frame: Record<string, unknown>) {
  return async (
    parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> => {
    try {
      const value: unknown = runInNewContext(parameters.expression, {
        ...frame,
      })
      return { result: { type: 'string', value } }
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : ''
      return {
        result: { type: 'undefined' },
        exceptionDetails: {
          exceptionId: 1,
          text: 'Uncaught',
          lineNumber: 0,
          columnNumber: 0,
          exception: {
            type: 'object',
            subtype: 'error',
            className: 'ReferenceError',
            description: `ReferenceError: ${message}`,
          },
        },
      }
    }
  }
}

const READ_MAP = mapOf(
  ['currentState'],
  [{ at: 'l=0', inside: OUTER, name: 'currentState' }],
  SCRIPT,
)
const READ_SCOPES = [scopeOf(SCRIPT, OUTER, 'closure')]

// Value: protects=native finding: a required `value:currentState` at a minified library stop is captured, not failed; fails_when=the source name throws ReferenceError and the inspection is unavailable; no_claim=the run-level stop sealing
test('a required inspection by source name is captured from the minified binding when the frame lacks that name', async () => {
  // Arrange
  const frame = { l: 'idle' }

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame(frame),
    'closure-frame',
    [{ path: 'currentState', mode: 'value', required: true }],
    () => {},
    (text) => text,
    (path) => minifiedPathOf(path, READ_MAP, SCRIPT, READ_SCOPES),
  )

  // Assert
  assert.deepEqual(facts, {
    values: { 'value:currentState': 'idle' },
    unavailableValues: [],
  })
})

// Value: protects=a source name the frame holds is never rewritten; fails_when=the minified name is read in place of the real binding; no_claim=bindings before initialization
test('a source name the paused frame holds is read as declared although the map renames it', async () => {
  // Arrange
  const frame = { currentState: 'declared', l: 'minified' }

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame(frame),
    'closure-frame',
    [{ path: 'currentState', mode: 'value', required: true }],
    () => {},
    (text) => text,
    (path) => minifiedPathOf(path, READ_MAP, SCRIPT, READ_SCOPES),
  )

  // Assert
  assert.deepEqual(facts, {
    values: { 'value:currentState': 'declared' },
    unavailableValues: [],
  })
})

// Value: protects=a map whose walk a size limit cuts short never resolves a name from the partial list read so far; fails_when=`currentState` is rewritten to `l` although the unread rest of the map may bind the name to another variable or shadow `l`; why_new=Cycle 0105 hosted review (partial scan ignored); seam=minifiedPathOf over a map with more generated lines than DEFAULT_SOURCE_MAP_LIMITS allows; no_claim=which limit stops the walk
test('a source map larger than the scan limits leaves the name unresolved instead of using the part read', () => {
  // Arrange
  const readable = JSON.parse(READ_MAP) as { mappings: string }
  // 150,000 empty generated lines exceed the 100,000-line limit after the one mapping that resolves.
  const oversized = JSON.stringify({
    ...JSON.parse(READ_MAP),
    mappings: `${readable.mappings}${';'.repeat(150_000)}`,
  })

  // Act
  const rewritten = minifiedPathOf(
    'currentState',
    oversized,
    SCRIPT,
    READ_SCOPES,
  )
  const rewrittenWithinLimits = minifiedPathOf(
    'currentState',
    READ_MAP,
    SCRIPT,
    READ_SCOPES,
  )

  // Assert
  assert.equal(rewritten, undefined)
  assert.deepEqual(rewrittenWithinLimits, {
    name: 'currentState',
    compiledPath: 'l',
  })
})
