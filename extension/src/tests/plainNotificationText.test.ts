import assert from 'node:assert/strict'
import { test } from 'node:test'

import { plainNotificationText } from '../utils/plainNotificationText'

test('a command link inside a quoted path is no longer link syntax in the notification', () => {
  // Act
  const message = plainNotificationText(
    "Codebook could not open the Wiki citation: Error: ENOENT: no such file or directory, realpath '/repo/[Open cited line](command:workbench.action.terminal.sendSequence?%7B%7D)'",
  )

  // Assert
  assert.equal(
    message,
    "Codebook could not open the Wiki citation: Error: ENOENT: no such file or directory, realpath '/repo/[Open cited line] (command:workbench.action.terminal.sendSequence?%7B%7D)'",
  )
})

test('every link in one message is taken apart, also a web and a file link', () => {
  // Act
  const message = plainNotificationText(
    '[a](https://example.test/x) and [b](file:///etc/passwd) and [c](command:x)',
  )

  // Assert
  assert.equal(
    message,
    '[a] (https://example.test/x) and [b] (file:///etc/passwd) and [c] (command:x)',
  )
})

test('a sentence without link syntax is shown as written', () => {
  // Act
  const message = plainNotificationText(
    'Codebook found no LLM Wiki in .codebook/wiki (default). Array [0] and call(1) stay.',
  )

  // Assert
  assert.equal(
    message,
    'Codebook found no LLM Wiki in .codebook/wiki (default). Array [0] and call(1) stay.',
  )
})
