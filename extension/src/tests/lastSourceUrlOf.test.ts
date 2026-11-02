import assert from 'node:assert/strict'
import { test } from 'node:test'

import { lastSourceUrlOf } from '../utils/lastSourceUrlOf'

// Value: protects=a pre-attach server module recognised by the address webpack gave it; fails_when=the first comment is returned, or a text without a comment yields an address; no_claim=the address shape
test('the last sourceURL comment of a script text is its address', () => {
  // Arrange
  const text =
    'eval("a");\n//# sourceURL=webpack-internal:///(rsc)/./a.tsx\nx\n//# sourceURL=about://React/Server/webpack-internal:///(rsc)/./a.tsx?7\n'
  // Act
  const withComment = lastSourceUrlOf(text)
  const withoutComment = lastSourceUrlOf('eval("a")')
  // Assert
  assert.equal(
    withComment,
    'about://React/Server/webpack-internal:///(rsc)/./a.tsx?7',
  )
  assert.equal(withoutComment, undefined)
})
