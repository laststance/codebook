import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readNodeInspectorEndpoint } from '../utils/readNodeInspectorEndpoint'

test('a split inspector announcement cannot expose a partial port or worker identity', () => {
  // Arrange
  const announcement =
    'Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111\n'
  // Act / Assert
  for (let length = 0; length < announcement.length; length++)
    assert.equal(
      readNodeInspectorEndpoint(announcement.slice(0, length)),
      undefined,
    )
  assert.equal(
    readNodeInspectorEndpoint(announcement),
    'ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111',
  )
})

test('repeated announcements retain one inspector but adjacent competing workers reject acquisition', () => {
  // Arrange
  const first =
    'Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111\n'
  const second =
    'Debugger listening on ws://127.0.0.1:43211/22222222-2222-4222-8222-222222222222\n'
  // Act / Assert
  assert.equal(
    readNodeInspectorEndpoint(first + first),
    'ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111',
  )
  assert.throws(
    () => readNodeInspectorEndpoint(first + second),
    /Ambiguous server inspector endpoints/,
  )
})

test('remote authenticated malformed and out-of-range inspector endpoints cannot authorize a connection', () => {
  // Arrange
  const identity = '/11111111-1111-4111-8111-111111111111'
  const endpoints = [
    'ws://example.com:43210',
    'ws://0.0.0.0:43210',
    'ws://user:secret@127.0.0.1:43210',
    'http://127.0.0.1:43210',
    'ws://127.0.0.1:0',
    'ws://127.0.0.1:70000',
    'ws://127.0.0.1',
    'invalid',
  ]
  // Act / Assert
  for (const endpoint of endpoints)
    assert.throws(
      () =>
        readNodeInspectorEndpoint(
          `Debugger listening on ${endpoint}${identity}\n`,
        ),
      /inspector/,
    )
  assert.throws(
    () =>
      readNodeInspectorEndpoint(
        'Debugger listening on ws://127.0.0.1:43210/not-an-identity\n',
      ),
    /inspector/,
  )
})

test('ordinary output does not impersonate an inspector announcement and CRLF announcements remain usable', () => {
  // Arrange / Act / Assert
  assert.equal(
    readNodeInspectorEndpoint(
      'App says: Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111\n',
    ),
    undefined,
  )
  assert.equal(
    readNodeInspectorEndpoint(
      'Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111\r\n',
    ),
    'ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111',
  )
})
