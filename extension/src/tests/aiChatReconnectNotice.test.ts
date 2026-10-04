import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aiChatReconnectNotice } from '../utils/aiChatReconnectNotice'

test('a reconnect refusal that already names the setup step is shown once, without "Error:" and with one full stop', () => {
  // Act
  const notice = aiChatReconnectNotice(
    new Error(
      'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ),
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
  )
})

test('a reconnect failure without a next step is followed by the setup step', () => {
  // Act
  const notice = aiChatReconnectNotice(
    new Error('The selected workspace changed after setup'),
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: The selected workspace changed after setup. Run Codebook: Set Up AI Chat.',
  )
})

test('a reconnect failure that ends its own sentence keeps one full stop before the setup step', () => {
  // Act
  const notice = aiChatReconnectNotice(
    new Error(
      'Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
    ),
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock. Run Codebook: Set Up AI Chat.',
  )
})

test('a reconnect failure that is not an error object is shown as its text', () => {
  // Act
  const notice = aiChatReconnectNotice('server start was interrupted')

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: server start was interrupted. Run Codebook: Set Up AI Chat.',
  )
})
