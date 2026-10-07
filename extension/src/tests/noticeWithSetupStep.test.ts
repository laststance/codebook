import assert from 'node:assert/strict'
import { test } from 'node:test'

import { noticeWithSetupStep } from '../utils/noticeWithSetupStep'

test('a reconnect refusal that already names the setup step is shown once, without "Error:" and with one full stop', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook AI chat did not reconnect',
    new Error(
      'Cursor skill is missing or was changed: /home/user/.cursor/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ),
    'Run Codebook: Set Up AI Chat.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: Cursor skill is missing or was changed: /home/user/.cursor/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
  )
})

test('a reconnect failure without a next step is followed by the setup step', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook AI chat did not reconnect',
    new Error('The selected workspace changed after setup'),
    'Run Codebook: Set Up AI Chat.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: The selected workspace changed after setup. Run Codebook: Set Up AI Chat.',
  )
})

test('a reconnect failure that ends its own sentence keeps one full stop before the setup step', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook AI chat did not reconnect',
    new Error(
      'Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
    ),
    'Run Codebook: Set Up AI Chat.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock. Run Codebook: Set Up AI Chat.',
  )
})

test('a reconnect failure that is not an error object is shown as its text', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook AI chat did not reconnect',
    'server start was interrupted',
    'Run Codebook: Set Up AI Chat.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: server start was interrupted. Run Codebook: Set Up AI Chat.',
  )
})

test('a failed Cursor registration whose reason already names the setup step is shown once, without "Error:" and with one full stop', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook agent server started, but Cursor MCP registration failed',
    new Error(
      'Cursor skill is missing or was changed: /home/user/.cursor/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ),
    'Run Codebook: Set Up AI Chat to repair the connection.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook agent server started, but Cursor MCP registration failed: Cursor skill is missing or was changed: /home/user/.cursor/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
  )
})

test('a failed Cursor registration without a next step is followed by the setup step that repairs the connection', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook agent server started, but Cursor MCP registration failed',
    new Error(
      'Expected an absolute external Node.js >=24 executable, not Electron.',
    ),
    'Run Codebook: Set Up AI Chat to repair the connection.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook agent server started, but Cursor MCP registration failed: Expected an absolute external Node.js >=24 executable, not Electron. Run Codebook: Set Up AI Chat to repair the connection.',
  )
})

test('a failed Cursor registration whose reason has no full stop gets exactly one before the setup step', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook agent server started, but Cursor MCP registration failed',
    new Error(
      "EACCES: permission denied, open '/home/user/.cursor/skills/codebook/SKILL.md'",
    ),
    'Run Codebook: Set Up AI Chat to repair the connection.',
  )

  // Assert
  assert.equal(
    notice,
    "Codebook agent server started, but Cursor MCP registration failed: EACCES: permission denied, open '/home/user/.cursor/skills/codebook/SKILL.md'. Run Codebook: Set Up AI Chat to repair the connection.",
  )
})

// Value: protects=the notice a learner reads at editor start when Cursor's settings folder is gone; fails_when=the refusal of the skill check, which names the setup as its own step since Cycle 0046 row 277, is followed by the setup step a second time; why_new=Cycle 0046 row 277: the refusal this file quoted before had no step and no full stop; seam=none
test('a reconnect refusal for a missing Cursor folder, which ends with its own setup step, is shown without a second setup step', () => {
  // Act
  const notice = noticeWithSetupStep(
    'Codebook AI chat did not reconnect',
    new Error(
      'Codebook will not follow a missing or redirected skill directory: /home/user/.cursor. Nothing stands at that path. Run Codebook: Set Up AI Chat again.',
    ),
    'Run Codebook: Set Up AI Chat.',
  )

  // Assert
  assert.equal(
    notice,
    'Codebook AI chat did not reconnect: Codebook will not follow a missing or redirected skill directory: /home/user/.cursor. Nothing stands at that path. Run Codebook: Set Up AI Chat again.',
  )
})

// Value: protects=the notice a learner reads at editor start, or after a start, when the skill check ends with a refusal that names its own step after "then run"; fails_when=the helper knows the setup step only as "Run Codebook: Set Up AI Chat" with a capital R and says the step a second time after "…, then run Codebook: Set Up AI Chat again."; why_new=Cycle 0046 row 284: every refusal of the Cursor setup of this cycle ends that way; seam=none
test('a reconnect or registration refusal that names the setup command after "then run" is shown without a second setup step', () => {
  // Arrange: the refusal for a link at ~/.cursor/skills, as the skill check words it.
  const refusal = new Error(
    "Codebook will not follow a missing or redirected skill directory: /home/user/.cursor/skills. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
  )

  // Act
  const notices = {
    reconnect: noticeWithSetupStep(
      'Codebook AI chat did not reconnect',
      refusal,
      'Run Codebook: Set Up AI Chat.',
    ),
    registration: noticeWithSetupStep(
      'Codebook agent server started, but Cursor MCP registration failed',
      refusal,
      'Run Codebook: Set Up AI Chat to repair the connection.',
    ),
  }

  // Assert
  assert.deepEqual(notices, {
    reconnect:
      "Codebook AI chat did not reconnect: Codebook will not follow a missing or redirected skill directory: /home/user/.cursor/skills. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
    registration:
      "Codebook agent server started, but Cursor MCP registration failed: Codebook will not follow a missing or redirected skill directory: /home/user/.cursor/skills. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
  })
})

// Value: protects=the notice a learner reads when the saved chat does not reconnect because the server was stopped while it started; fails_when=the notice adds "Run Codebook: Set Up AI Chat." after a reason that already says which command to run ("Run Codebook: Start Agent Server to start it."), so the learner reads two commands for one step; why_new=Cycle 0046 row 311: the sentences of a stopped start name their step, and the helper sends nobody to the setup after a sentence that says to run something else; seam=none
test('a reconnect or registration failure whose reason says which command to run is shown without the setup step, and a reason that names a command without telling to run it still gets the setup step', () => {
  // Act
  const notices = {
    stoppedWhileStarting: noticeWithSetupStep(
      'Codebook AI chat did not reconnect',
      new Error(
        'Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.',
      ),
      'Run Codebook: Set Up AI Chat.',
    ),
    stopAskedForWhileWaiting: noticeWithSetupStep(
      'Codebook AI chat did not reconnect',
      new Error(
        "Codebook server was not started: a stop was asked for while the start waited for the workspace's folders to change. Run Codebook: Start Agent Server to start it.",
      ),
      'Run Codebook: Set Up AI Chat.',
    ),
    shutdownIncomplete: noticeWithSetupStep(
      'Codebook AI chat did not reconnect',
      new Error(
        'Previous server shutdown is incomplete. Retry Codebook: Stop Agent Server before starting a new instance.',
      ),
      'Run Codebook: Set Up AI Chat.',
    ),
  }

  // Assert
  assert.deepEqual(notices, {
    stoppedWhileStarting:
      'Codebook AI chat did not reconnect: Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.',
    stopAskedForWhileWaiting:
      "Codebook AI chat did not reconnect: Codebook server was not started: a stop was asked for while the start waited for the workspace's folders to change. Run Codebook: Start Agent Server to start it.",
    shutdownIncomplete:
      'Codebook AI chat did not reconnect: Previous server shutdown is incomplete. Retry Codebook: Stop Agent Server before starting a new instance. Run Codebook: Set Up AI Chat.',
  })
})
