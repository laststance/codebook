import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NEXT_SERVER_STARTUP_SCAN_CHARS } from '../constants'
import { serverChunkIdsRequiredBy } from '../utils/serverChunkIdsRequiredBy'

import { serverChunk } from './utils/nextPagesBuildHarness'

// protects=the chunks a page's server compile requires are read from its startup call in the order it lists them, so a shared module is found where Next put it; fails_when=an id is dropped, reordered or duplicated, or a compile with no startup call lists chunks; no_claim=that every Next version emits this call (a call in another form lists none, which the next test pins)
test('the startup call of a server compile lists the chunks it requires, once each, in order', () => {
  // Arrange
  const compile = serverChunk({}, [
    'vendor-chunks/next',
    'chunks/shared',
    'chunks/shared',
  ])
  // Act
  const ids = serverChunkIdsRequiredBy(compile)
  // Assert
  assert.deepEqual(ids, ['vendor-chunks/next', 'chunks/shared'])
  assert.deepEqual(serverChunkIdsRequiredBy(serverChunk({})), [])
})

// protects=a startup call in a form the reader does not know, or an id that would leave the server folder, lists nothing from that point, so the run reads no file outside the build and seals no module wrongly; fails_when=a numeric id, a computed list, an absolute or parent path, a backslash or a control character is read as a chunk; no_claim=none beyond protects
test('a startup call in an unknown form or with an escaping id lists no chunk', () => {
  // Arrange
  const call = (list: string) =>
    `x();\nvar __webpack_exports__ = __webpack_require__.X(0, ${list}, () => (__webpack_exec__("./a")));\n`
  // Act / Assert
  assert.deepEqual(serverChunkIdsRequiredBy(call('[185, 342]')), [])
  assert.deepEqual(serverChunkIdsRequiredBy(call('ids')), [])
  assert.deepEqual(serverChunkIdsRequiredBy(call('["a", b]')), [])
  assert.deepEqual(serverChunkIdsRequiredBy(call('["\\q"]')), [])
  assert.deepEqual(
    serverChunkIdsRequiredBy(
      call(
        '["../../outside", "/abs", "a\\\\b", "a/./b", "a//b", "a\\u0001b", "chunks/ok"]',
      ),
    ),
    ['chunks/ok'],
  )
})

// protects=only the end of a compile is searched for the startup call, so a hostile compile of many megabytes costs a bounded scan, and a call-like text inside a module before the end is not read as the call; fails_when=the whole text is searched or a call earlier than the scanned tail is used; no_claim=the scan's speed
test('only the end of a server compile is searched for the startup call', () => {
  // Arrange
  const earlyCall = '__webpack_require__.X(0, ["chunks/early"], () => 0);\n'
  const compile = `${earlyCall}${'x'.repeat(NEXT_SERVER_STARTUP_SCAN_CHARS)}`
  // Act
  const ids = serverChunkIdsRequiredBy(compile)
  // Assert
  assert.deepEqual(ids, [])
})
