import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aiChatReadyMessage } from '../utils/aiChatReadyMessage'

// Value: protects=a learner whose VS Code opens chat requests in a Copilot CLI session is told which session reaches Codebook and how to get it; fails_when=the setup message only says "open a new chat", so the agent answers that no Codebook tool is connected and the learner has no next step (0038-N7-a); why_new=the message named no session; seam=none
test('after setup in VS Code the learner is told to use a Local chat session and how to leave the Copilot CLI harness', () => {
  // Arrange / Act
  const message = aiChatReadyMessage('vscode')
  // Assert
  assert.equal(
    message,
    'Codebook AI chat is ready for this workspace. Open a new chat in a Local session and choose /codebook. A Copilot CLI session cannot reach Codebook: if the agent says that no Codebook tool is connected, turn off chat.defaultToCopilotHarness and chat.editor.preferCopilotHarness in Settings and start a Local chat.',
  )
})

// Value: protects=Cursor's setup message keeps naming where Codebook is registered in Cursor; fails_when=the VS Code wording replaces it; why_new=the two messages now come from one utility; seam=none
test('after setup in Cursor the learner is told to check Customize > MCPs before using /codebook', () => {
  // Arrange / Act
  const message = aiChatReadyMessage('cursor')
  // Assert
  assert.equal(
    message,
    'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.',
  )
})

// Value: protects=a Devin Desktop learner is told that the window must reload before Devin Local loads Codebook's MCP server, and which slash name the skill has there; fails_when=the VS Code or Cursor wording is shown, so the learner looks for /codebook or a Copilot setting and finds no Codebook tool until some later reload; why_new=Devin Desktop setup (Cycle 0143); seam=none
test('after setup in Devin Desktop the learner is told to reload the window and type /devin:codebook in a Local session', () => {
  // Arrange / Act
  const message = aiChatReadyMessage('devin')
  // Assert
  assert.equal(
    message,
    "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
  )
})
