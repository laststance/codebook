import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Protocol } from 'devtools-protocol'

import type { BundleSource } from '../repositoryBundle'
import { boundColumnOfInstance } from '../utils/boundColumnOfInstance'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { isPauseAtBoundColumn } from '../utils/isPauseAtBoundColumn'

const SOURCE_PATH = '/repo/src/mode.ts'
const SOURCE = 'var a = 1; var b = 2;\n'

/** A sealed module whose map puts the two statements of line 1 at original columns `columns` (zero-based deltas are given as mappings by the caller). */
const moduleWithMappings = (mappings: string) =>
  createBundleVerifier({
    sourcePath: SOURCE_PATH,
    source: SOURCE,
    javascript: SOURCE,
    sourceMap: JSON.stringify({
      version: 3,
      sources: [SOURCE_PATH],
      sourcesContent: [SOURCE],
      names: [],
      mappings,
    }),
    mapSource: SOURCE_PATH,
    scriptUrl: 'webpack-internal:///(action-browser)/./src/mode.ts',
    chunkPath: '/repo/.next/chunk.js',
    chunkHash: '0'.repeat(64),
  } satisfies BundleSource)

/** Builds a pause whose top frame is at a generated place. @example pauseAt('9', 0, 11) */
const pauseAt = (
  scriptId: string,
  lineNumber: number,
  columnNumber: number,
): Protocol.Debugger.PausedEvent => ({
  reason: 'other',
  callFrames: [
    {
      callFrameId: 'frame',
      functionName: '',
      location: { scriptId, lineNumber, columnNumber },
      url: '',
      scopeChain: [],
      this: { type: 'undefined' },
    },
  ],
})

// Value: protects=the columns a map puts code on, on one line, being listed in order; fails_when=a comment's mapping, another line or a duplicate column is listed; why_new=F441 (boundColumnOfInstance needs the statements of a line); seam=createBundleVerifier over a map with two statements on line 1; no_claim=maps with several originals
test('lists the distinct original columns of a line’s code mappings in ascending order', () => {
  // Arrange: generated columns 0 and 11 map to original columns 1 and 12 of line 1.
  const verifier = moduleWithMappings('AAAA,WAAW')
  // Act
  const columns = [
    verifier.mappedColumnsOfLine(1),
    verifier.mappedColumnsOfLine(2),
  ]
  // Assert
  assert.deepEqual(columns, [[1, 12], []])
})

// Value: protects=a stop bound at the second statement of a line being judged in another layer's instance at the column that instance's map gives the second statement; fails_when=the bound column of the sealed map is compared with the instance's columns, so a genuine pause in the instance is refused as another statement; why_new=F441 (OCR low: a pause in an instance was compared with the column bound in one script); seam=two verifiers over one source, the sealed map at columns 1 and 12, the instance's at 1 and 5; no_claim=how the runtime binds a breakpoint in an instance
test('judges a pause in an instance by the column its own map gives the bound statement and refuses the other statement of the line', () => {
  // Arrange
  const sealed = moduleWithMappings('AAAA,WAAW'),
    instance = moduleWithMappings('AAAA,WAAI'),
    bound = { line: 1, column: 12 }
  // Act
  const instanceColumn = boundColumnOfInstance(sealed, instance, bound)
  const genuine = isPauseAtBoundColumn(pauseAt('2', 0, 11), {
    bound: { column: instanceColumn },
    verifier: instance,
  })
  const otherStatement = isPauseAtBoundColumn(pauseAt('2', 0, 0), {
    bound: { column: instanceColumn },
    verifier: instance,
  })
  const bySealedColumn = isPauseAtBoundColumn(pauseAt('2', 0, 11), {
    bound,
    verifier: instance,
  })
  // Assert
  assert.deepEqual(
    [instanceColumn, genuine, otherStatement, bySealedColumn],
    [5, true, false, false],
  )
})

// Value: protects=the sealed bound column staying the rule when the two maps cannot be matched statement by statement; fails_when=a guess between maps that hold different numbers of statements on the line, or a bound column the sealed map does not list, picks another column; why_new=F441 (the rule for instances is stated: Nth statement of the line, else the bound column); seam=createBundleVerifier over maps with one and two statements on line 1; no_claim=that unmatched maps are common
test('keeps the bound column when the maps hold different numbers of statements on the line or the bound column is no mapped column', () => {
  // Arrange
  const sealed = moduleWithMappings('AAAA,WAAW'),
    oneStatement = moduleWithMappings('AAAA')
  // Act
  const differentCounts = boundColumnOfInstance(sealed, oneStatement, {
    line: 1,
    column: 12,
  })
  const unlisted = boundColumnOfInstance(sealed, sealed, {
    line: 1,
    column: 7,
  })
  // Assert
  assert.deepEqual([differentCounts, unlisted], [12, 7])
})
