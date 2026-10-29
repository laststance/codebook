import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canonicalJson } from '../utils/canonicalJson'

// protects=CR9: two reads of the same data compare equal whatever order the browser listed the keys in, at any depth, while array order still matters; fails_when=key sorting is dropped, stops at the top level, or arrays are sorted; why_new=the observation tests never reorder keys; seam=none; no_claim=what the browser returns for real
test('serializes objects with sorted keys at every depth and keeps array order', () => {
  // Arrange
  const first = { b: 1, a: [2, { d: 1, c: 2 }], z: null }
  const second = { z: null, a: [2, { c: 2, d: 1 }], b: 1 }
  const swappedArray = { b: 1, a: [{ c: 2, d: 1 }, 2], z: null }

  // Act
  const left = canonicalJson(first)
  const right = canonicalJson(second)
  const other = canonicalJson(swappedArray)

  // Assert
  assert.equal(left, '{"a":[2,{"c":2,"d":1}],"b":1,"z":null}')
  assert.equal(right, left)
  assert.notEqual(other, left)
})

// protects=ER23: a value JSON cannot hold reads undefined, not the text "undefined", so the observation can tell it from a real null; fails_when=undefined is stringified or null becomes undefined; why_new=only the helper itself maps this edge; seam=none; no_claim=none beyond protects
test('reports undefined for a value JSON cannot hold and "null" for a real null', () => {
  // Act
  const missing = canonicalJson(undefined)
  const real = canonicalJson(null)

  // Assert
  assert.equal(missing, undefined)
  assert.equal(real, 'null')
})
