import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readDevToolsActivePort } from '../runtimeSupport/utils/readDevToolsActivePort'

// Value: protects=a half-written DevToolsActivePort is treated as not yet written so the poll retries; fails_when=a port line alone, or a path line that is no browser endpoint, yields an endpoint to connect to; no_claim=Chrome's write timing
test('a DevToolsActivePort without both the port and the browser path is not read yet', () => {
  // Arrange
  const complete = '51234\n/devtools/browser/abc'
  // Act
  const results = {
    complete: readDevToolsActivePort(complete),
    portOnly: readDevToolsActivePort('51234'),
    portAndNewline: readDevToolsActivePort('51234\n'),
    wrongPath: readDevToolsActivePort('51234\n/json/version'),
    empty: readDevToolsActivePort(''),
  }
  // Assert
  assert.deepEqual(results, {
    complete: { port: 51234, path: '/devtools/browser/abc' },
    portOnly: undefined,
    portAndNewline: undefined,
    wrongPath: undefined,
    empty: undefined,
  })
})
