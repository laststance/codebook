import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiChatOpenFailure } from '../utils/describeWikiChatOpenFailure'

test('the failure of a chat that could not be opened names the editor’s error and ends with the next step', () => {
  // Act
  const sentence = describeWikiChatOpenFailure('Chat is unavailable')

  // Assert
  assert.equal(
    sentence,
    'The editor chat could not be opened (Chat is unavailable). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.',
  )
})

test('a long error of the editor is cut inside the sentence, so the sentence stays bounded and still ends with the next step', () => {
  // Arrange: an error text of 294 characters; the sentence quotes its first 120.
  const thrownText = 'command workbench.action.chat.open failed '.repeat(7)

  // Act
  const sentence = describeWikiChatOpenFailure(thrownText)

  // Assert
  assert.equal(thrownText.length, 294)
  assert.equal(
    sentence,
    'The editor chat could not be opened (command workbench.action.chat.open failed command workbench.action.chat.open failed command workbench.action.chat.open f…). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.',
  )
})
