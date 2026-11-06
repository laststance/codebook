import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EXPO_WEB_NESTED_CONFIGURATION } from '../expoWebHelp'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'

// Value: protects=DX-9 the copyable Expo configuration in the help is a configuration the live schema accepts, so a chat that copies it does not start with a refused shape; fails_when=the example drifts from the schema (a renamed field, a missing adapter value); why_new=this lane's example needs the adapter in the version 3 schema, which Lane B adds, so this test passes only after integration; seam=none; no_claim=that a run with it succeeds
test('the Expo help example configuration parses with the live configuration schema', () => {
  // Arrange
  const example = EXPO_WEB_NESTED_CONFIGURATION
  // Act
  const parsed = liveRepositoryConfigSchema.safeParse(example)
  // Assert
  assert.equal(parsed.success, true)
})
