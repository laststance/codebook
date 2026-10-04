import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCapturedFactPaths } from '../utils/resolveCapturedFactPaths'

// Value: protects=only an unambiguous bare path being rewritten, and every other path reaching the service as the agent sent it; fails_when=a prefixed path is touched, a bare path no fact has gains a prefix (the "did not capture" answer would then name a key the agent never sent), or the order of the paths changes; why_new=Cycle 0045 cause 2 (ER-6); seam=none
test('a bare path is rewritten to the one captured key that has it, and prefixed or uncaptured paths stay as sent', () => {
  // Arrange: the snapshot captured a value fact and a type fact with different paths.
  const capturedFacts = {
    'value:nextTheme': 'dark',
    'type:setTheme': 'function',
  }

  // Act
  const resolved = resolveCapturedFactPaths(
    ['setTheme', 'value:nextTheme', 'missing', 'type:missing'],
    capturedFacts,
  )

  // Assert
  assert.equal(
    JSON.stringify(resolved),
    '{"paths":["type:setTheme","value:nextTheme","missing","type:missing"],"rewritten":[{"from":"setTheme","to":"type:setTheme"}]}',
  )
})

// Value: protects=the refusal of an ambiguous bare path naming the argument's position and both keys; fails_when=the first matching key is taken by guess; why_new=Cycle 0045 cause 2 (ER-6); seam=none
test('a bare path that both a value fact and a type fact have is refused naming its position and both keys', () => {
  // Arrange: the snapshot captured the same path as a value and as a type.
  const capturedFacts = {
    'value:nextTheme': 'dark',
    'type:nextTheme': 'string',
  }

  // Act
  const resolve = (): unknown =>
    resolveCapturedFactPaths(['value:nextTheme', 'nextTheme'], capturedFacts)

  // Assert
  assert.throws(resolve, {
    code: 'INVALID_REFERENCE',
    message:
      'valuePaths[1] "nextTheme" is the path of two captured facts of this snapshot, value:nextTheme and type:nextTheme. Send the one you mean with its prefix; the same key is free.',
  })
})
