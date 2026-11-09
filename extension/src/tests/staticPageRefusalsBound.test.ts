import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  staticPageAmbiguousSourceRefusal,
  staticPageNeedsBundlerRefusal,
  staticPageNodeModulesRefusal,
  staticPageOutsidePackageRefusal,
} from '../staticPageRefusals'

/** A page-controlled reference: 1000 characters with a line break near the start. */
const LONG_REFERENCE = `lib\nFORGED LINE ${'x'.repeat(984)}`

// Value: protects=AC 3 page-controlled text in a refusal is cut to 200 characters and one line, in the message and the details alike; fails_when=a reference reaches the message or details unbounded or with a line break; no_claim=wording of the rest of the message
test('a 1000-character reference with a line break is shortened and single-line in the needs-bundler refusal', () => {
  // Arrange
  const reference = LONG_REFERENCE
  // Act
  const refusal = staticPageNeedsBundlerRefusal(reference, 'bare-import')
  // Assert
  assert.equal(refusal.details?.reference, `lib FORGED LINE ${'x'.repeat(184)}`)
  assert.equal(refusal.message.includes('\n'), false)
  assert.equal(refusal.message.includes('x'.repeat(185)), false)
})

// Value: protects=AC 3 stop-file refusals bound the file names they echo; fails_when=a file name with a line break or 1000 characters is echoed whole; no_claim=how a real repository path reaches these builders
test('stop-file refusals shorten a long file name with a line break to one line', () => {
  // Arrange
  const file = `a\nb${'y'.repeat(997)}`
  // Act
  const outside = staticPageOutsidePackageRefusal('examples/page', [file])
  const modules = staticPageNodeModulesRefusal([file])
  const ambiguous = staticPageAmbiguousSourceRefusal(file)
  // Assert
  const bounded = `a b${'y'.repeat(197)}`
  assert.deepEqual(outside.details?.files, [bounded])
  assert.deepEqual(modules.details?.files, [bounded])
  assert.equal(ambiguous.details?.file, bounded)
  for (const refusal of [outside, modules, ambiguous]) {
    assert.equal(refusal.message.includes('\n'), false)
    assert.equal(refusal.message.includes('y'.repeat(198)), false)
  }
})
