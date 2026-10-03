import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aiChatReadyMessage } from '../utils/aiChatReadyMessage'

// Value: protects=a learner whose VS Code opens chat requests in a Copilot CLI session is told which session reaches Codebook and how to get it; fails_when=the setup message only says "open a new chat", so the agent answers that no Codebook tool is connected and the learner has no next step (0038-N7-a); why_new=the message named no session; seam=none
test('after setup in VS Code the learner is told to use a Local chat session and how to leave the Copilot CLI harness', () => {
  // Arrange / Act
  const message = aiChatReadyMessage(false)
  // Assert
  assert.equal(
    message,
    'Codebook AI chat is ready for this workspace. Open a new chat in a Local session and choose /codebook. A Copilot CLI session cannot reach Codebook: if the agent says that no Codebook tool is connected, turn off chat.defaultToCopilotHarness and chat.editor.preferCopilotHarness in Settings and start a Local chat.',
  )
})

// Value: protects=Cursor's setup message keeps naming where Codebook is registered in Cursor; fails_when=the VS Code wording replaces it; why_new=the two messages now come from one utility; seam=none
test('after setup in Cursor the learner is told to check Customize > MCPs before using /codebook', () => {
  // Arrange / Act
  const message = aiChatReadyMessage(true)
  // Assert
  assert.equal(
    message,
    'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.',
  )
})
