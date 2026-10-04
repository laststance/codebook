import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cursorRegistrationNotice } from '../utils/cursorRegistrationNotice'

test('a failed Cursor registration whose reason already names the setup step is shown once, without "Error:" and with one full stop', () => {
  // Act
  const notice = cursorRegistrationNotice(
    new Error(
      'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ),
  )

  // Assert
  assert.equal(
    notice,
    'Codebook agent server started, but Cursor MCP registration failed: Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
  )
})

test('a failed Cursor registration without a next step is followed by the setup step that repairs the connection', () => {
  // Act
  const notice = cursorRegistrationNotice(
    new Error(
      'Expected an absolute external Node.js >=24 executable, not Electron.',
    ),
  )

  // Assert
  assert.equal(
    notice,
    'Codebook agent server started, but Cursor MCP registration failed: Expected an absolute external Node.js >=24 executable, not Electron. Run Codebook: Set Up AI Chat to repair the connection.',
  )
})

test('a failed Cursor registration whose reason has no full stop gets exactly one before the setup step', () => {
  // Act
  const notice = cursorRegistrationNotice(
    new Error(
      'Codebook will not follow a missing or redirected skill directory: /home/user/.cursor',
    ),
  )

  // Assert
  assert.equal(
    notice,
    'Codebook agent server started, but Cursor MCP registration failed: Codebook will not follow a missing or redirected skill directory: /home/user/.cursor. Run Codebook: Set Up AI Chat to repair the connection.',
  )
})
