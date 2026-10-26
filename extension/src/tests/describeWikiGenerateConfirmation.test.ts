import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiGenerateConfirmation } from '../utils/describeWikiGenerateConfirmation'

// Value: protects=D2 and E1-F2, what the learner reads before a generation uses the plan; fails_when=the resolved folder is not named, VS Code says "You can keep working" although its chat asks for about 38 approvals and a Continue, Cursor does not say the model is the CLI's own, or the bound is not named; no_claim=where the request goes (describeWikiChatHandOver tests); seam=none
test('the Generate confirmation names the project, the resolved folder, the host’s runner, what the learner does meanwhile and the 55 minute bound', () => {
  // Act
  const confirmations = {
    vscode: describeWikiGenerateConfirmation({
      host: 'vscode',
      projectName: 'nextjs-dashboard',
      outputDirectory: '/repo/.codebook/wiki',
      chatHandOver:
        'Copilot Chat receives the generate request for this project in a new chat.',
      timeoutMs: 3_300_000,
    }),
    cursor: describeWikiGenerateConfirmation({
      host: 'cursor',
      projectName: 'nextjs-dashboard',
      outputDirectory: '/repo/.codebook/wiki',
      chatHandOver: '',
      timeoutMs: 3_300_000,
    }),
  }

  // Assert
  assert.deepEqual(confirmations, {
    vscode: {
      title: 'Generate the LLM Wiki of nextjs-dashboard?',
      detail:
        'It is written to /repo/.codebook/wiki.\n\nCopilot Chat receives the generate request for this project in a new chat. The chat asks you to approve its commands and may ask you to Continue, so keep the Chat view open; it uses your chat plan. Codebook watches for up to 55 minutes.',
    },
    cursor: {
      title: 'Generate the LLM Wiki of nextjs-dashboard?',
      detail:
        'It is written to /repo/.codebook/wiki.\n\nIt runs through Cursor’s agent CLI (cursor-agent) without further prompts and uses your Cursor plan; the agent can edit files and run commands in this project. The model is the one cursor-agent is set to use; Codebook does not choose it. Codebook waits up to 55 minutes; you can keep working.',
    },
  })
})
