import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow, postInitialize } from './utils/devinChatOnboardingHarness'

// protects: activate gives the running server its in-memory mark, and a failed setup's rollback turns it off before the descriptor is rewritten, so a bridge that connected meanwhile is refused (Cycle 0144 tasks 1 and 4) / fails_when: the server is started without the window's mark as its gate, or the rollback leaves the mark on, so the Devin bridge is served for a setup that was taken back / no_claim: the descriptor file's content or the order of the two writes
test('a Devin bridge request is served while the setup stands and refused after a failed setup took it back, while other clients stay served', async (context) => {
  // Arrange
  let statusBeforeFailure: number | undefined
  const stopAndStart = async (): Promise<void> => {
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // The restarted server read the half-saved setup, so it is marked now.
    statusBeforeFailure = await postInitialize(
      await window.descriptorPath(),
      true,
    )
  }
  const window = await devinWindow(context, {
    realServer: true,
    onSkillCheck: stopAndStart,
  })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    const descriptorFile = await window.descriptorPath()
    const bridgeStatus = await postInitialize(descriptorFile, true)
    const otherClientStatus = await postInitialize(descriptorFile, false)
    // Assert
    assert.deepEqual(
      [statusBeforeFailure, bridgeStatus, otherClientStatus],
      [200, 403, 200],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed Devin setup's rollback rotates the server's token and writes the new one into the descriptor, so a bridge of an earlier build (it sends no Devin header) is refused too (Cycle 0144 F6) / fails_when: the old token still works after the rollback, or the descriptor's new token is refused / no_claim: the bridge's own reconnect
test('a Devin bridge without the Devin header that holds the old token is refused after a failed setup took the setup back, and the descriptor token is served', async (context) => {
  // Arrange
  let oldToken: string | undefined
  let statusBeforeFailure: number | undefined
  const restartAndRememberToken = async (): Promise<void> => {
    // The restarted server read the half-saved setup, so it is marked and the bridge connects with its token.
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    oldToken = JSON.parse(
      await readFile(await window.descriptorPath(), 'utf8'),
    ).token
    statusBeforeFailure = await postInitialize(
      await window.descriptorPath(),
      false,
      oldToken,
    )
  }
  const window = await devinWindow(context, {
    realServer: true,
    onSkillCheck: restartAndRememberToken,
  })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    const descriptorFile = await window.descriptorPath()
    const newToken = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    const withOldToken = await postInitialize(descriptorFile, false, oldToken)
    const withNewToken = await postInitialize(descriptorFile, false)
    // Assert
    assert.equal(typeof oldToken, 'string')
    assert.notEqual(newToken, oldToken)
    assert.deepEqual(
      [statusBeforeFailure, withOldToken, withNewToken],
      [200, 401, 200],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed setup's rollback in a window whose descriptor was never marked keeps the token, so no client of that window loses its connection for no reason (Cycle 0144 F15) / fails_when: the rollback rotates the token of a window that never carried the Devin mark, so the old token answers 401 / no_claim: a window whose mark was removed
test('a failed Devin setup in a window whose descriptor was never marked keeps the token it serves', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    skillManaged: false,
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const descriptorFile = await window.descriptorPath()
    const tokenBefore = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    const tokenAfter = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    const withOldToken = await postInitialize(
      descriptorFile,
      false,
      tokenBefore,
    )
    // Assert
    assert.equal(tokenAfter, tokenBefore)
    assert.equal(withOldToken, 200)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a rollback whose descriptor rewrite fails leaves the server on the token the descriptor still holds, so clients that read the file keep their connection (Cycle 0144 F15) / fails_when: the server switches to the new token before the descriptor carries it, so the file's token answers 401 / no_claim: the learner's wording beyond the incomplete take-back
test('a Devin setup whose rollback cannot write the descriptor keeps serving the token the descriptor holds and reports the take-back incomplete', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    failDescriptorUnmark: true,
    onSkillCheck: async (): Promise<void> => {
      // The restarted server read the half-saved setup, so its descriptor is marked.
      await window.commands.get('codebook.stopAgentServer')!()
      await window.commands.get('codebook.startAgentServer')!()
    },
  })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const descriptorFile = await window.descriptorPath()
    const status = await postInitialize(descriptorFile, false)
    // Assert
    assert.equal(status, 200)
    assert.equal(setupOutcome.includes('could not take back everything'), true)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a committed token rotation changes the MCP definition's version and tells the editor, so a VS Code MCP client resolves the definition again with the new bearer (Cycle 0144 F15) / fails_when: the version stays the same or no change event fires after the switch / no_claim: the editor's own re-resolve
test('a committed token rotation changes the MCP definition version and fires the definitions change event', async (context) => {
  // Arrange
  let versionBefore: string | undefined
  let eventsBefore = 0
  const window = await devinWindow(context, {
    realServer: true,
    savedSetup: true,
    entryWrite: 'current',
    skillManaged: false,
    onSkillCheck: async (): Promise<void> => {
      // The restarted server is marked; another window's removal then takes the skill record, so the rollback leaves the window unmarked while its earlier setup stays saved.
      await window.commands.get('codebook.stopAgentServer')!()
      await window.commands.get('codebook.startAgentServer')!()
      await rm(join(window.directory, 'devin-skill/receipt.json'))
      versionBefore = window.definitionVersion()
      eventsBefore = window.changeEvents()
    },
  })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    // Assert
    assert.equal(typeof versionBefore, 'string')
    assert.notEqual(window.definitionVersion(), versionBefore)
    assert.equal(window.changeEvents(), eventsBefore + 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a failed Devin setup whose restore of the saved setup also fails leaves no mark: the provisional value reads as no setup, so the rollback unmarks the window and a restarted server stays unmarked; fails_when=the half-saved value still counts as a setup while the receipts stand, so the rollback's sync keeps the Devin mark and the server serves a bridge for a failed setup; no_claim=the wording of the Output lines
test('a Devin setup whose restore of the saved setup fails leaves the window unmarked, also after a server restart', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupClear: true,
    afterInstallationRead: async (): Promise<void> => {
      throw new Error('Injected failure after the saved setup')
    },
  })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const markAfterRollback = await window.readDescriptorField()
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    const markAfterRestart = await window.readDescriptorField()
    // Assert
    assert.equal(setupOutcome.includes('could not take back everything'), true)
    assert.equal(markAfterRollback, undefined)
    assert.equal(markAfterRestart, undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a failed re-run whose commit and restore writes both fail keeps the earlier valid setup working: the provisional value reads as the setup before the run, so the window stays marked after a server restart; fails_when=the provisional value replaces the earlier setup, or vetoes it, so a valid setup stops working; no_claim=the rollback's wording
test('a failed Devin setup re-run whose saved setup cannot be restored keeps the earlier setup marked after a restart', async (context) => {
  // Arrange
  let isSkillCheckFailing = false
  const window = await devinWindow(context, {
    savedSetup: true,
    entryWrite: 'current',
    failSetupRestore: true,
    onSkillCheck: async (): Promise<void> => {
      if (isSkillCheckFailing) throw new Error('Injected skill check failure')
    },
  })
  try {
    await waitUntil(window.descriptorReadable, 'the reconnect descriptor')
    isSkillCheckFailing = true
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), true)
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
      provisional: true,
      previous: { workspace: window.directory },
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a Devin setup whose final write of the committed setup fails rolls back instead of reporting success; fails_when=the setup reports success while the saved value is still provisional; no_claim=which sentence the refusal carries
test('a Devin setup whose final commit write fails rolls back and saves no setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, { failSetupCommit: true })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Injected workspace state commit failure',
    })
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a Devin setup that succeeds saves the committed value {workspace} without the provisional fields; fails_when=the committed value keeps provisional fields, so every reader treats a finished setup as one that failed; no_claim=the reload notice
test('a successful Devin setup saves the committed setup without provisional fields', async (context) => {
  // Arrange
  const window = await devinWindow(context, {})
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a rollback whose entry removal resolved with a kept receipt or copy reports itself incomplete and names the file in the Output; fails_when=only a rejected removal counts, so the learner is told the setup was taken back while a record stays; no_claim=the wording of the Output line beyond the named file
test('a Devin setup rollback whose entry removal left a file behind tells the learner the take-back is incomplete and names the file', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    removalResult: {
      status: 'removed',
      path: '/config/mcp_config.json',
      cleanupFailure:
        'Codebook could not delete its own record of that entry at /storage/devin-mcp/receipt.json; delete that record by hand.',
    },
  })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome.includes('could not take back everything'), true)
    assert.equal(
      window.outputLines.some((line) =>
        line.includes('/storage/devin-mcp/receipt.json'),
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed unmark makes the rollback of a Devin setup incomplete and says so to the learner and the Output / fails_when: the rollback ends complete although the descriptor could not be rewritten, so the learner is told the setup was taken back while a mark may stay / no_claim: the wording of the Output line beyond its cause
test('a Devin Desktop setup whose rollback cannot rewrite the descriptor tells the learner the take-back is incomplete', async (context) => {
  // Arrange
  const window = await devinWindow(context, {})
  try {
    await window.commands.get('codebook.startAgentServer')!()
    await writeFile(await window.descriptorPath(), 'not a descriptor {')
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      setupOutcome,
      "Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again. Codebook could not take back everything the setup saved; see Codebook's Output for details.",
    )
    assert.equal(
      window.outputLines.includes(
        "Codebook could not update this window's connection descriptor: Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again.",
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin setup stopped mid-way whose take-back also failed points the learner to Codebook's Output / fails_when: the notice claims only that the setup did not complete, so the learner never learns that part of it stays saved / no_claim: the Output line's wording
test('a Devin Desktop setup whose take-back failed points to the Codebook Output', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDescriptorRewrite: true,
    failEntryRemoval: true,
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const setup = window.commands.get('codebook.setupAiChat')!()
    await window.rewriteReached
    // Act
    const stop = window.commands.get('codebook.stopAgentServer')!()
    window.releaseRewrite()
    const [setupOutcome] = await Promise.allSettled([setup, stop])
    // Assert
    assert.equal(setupOutcome.status, 'rejected')
    assert.equal(
      setupOutcome.reason.message,
      "Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again. Codebook could not take back everything the setup saved; see Codebook's Output for details.",
    )
    assert.deepEqual(
      window.outputLines.filter((line) => line.includes('MCP entry')),
      [
        'Codebook could not take back the Devin Desktop MCP entry this setup wrote: Injected entry removal failure',
      ],
    )
  } finally {
    window.releaseRewrite()
    await window.loaded.deactivate()
  }
})

// Value: protects=a window whose setup records stand but whose Devin MCP config no longer holds Codebook's entry (the learner deleted mcp_config.json) reconnects nothing and the Output tells the learner to run Set Up AI Chat again; fails_when=the reconnect starts a server for an entry that is gone, so Devin Local has nothing to connect to and no line says why; why_new=review finding M3 (Cycle 0143 /ship cycle 3 final range, not-managed refresh with both receipts left); seam=an entry refresh stand-in that answers not-managed while both records stay
test('a Devin Desktop window whose config lost the codebook entry reconnects nothing and tells the learner to run setup again', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'not-managed',
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook found no codebook entry of its own in Devin Desktop's MCP config, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat again.",
        ),
      'the missing entry line in the Output',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
    ])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=an entry the learner edited after setup stays as it is, the Output says so with its own line, and the window still reconnects to the bridge that entry names; fails_when=the edited entry is treated as a missing one and the reconnect stops, or no line names it; why_new=review finding M3 (Cycle 0143 /ship cycle 3 final range, changed apart from not-managed); seam=an entry refresh stand-in that answers changed
test('a Devin Desktop window whose codebook entry was edited keeps it, says so in the Output and still reconnects', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'changed',
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [
      `Codebook left the codebook entry in ${window.configPath} as it is: it was edited after setup.`,
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after Stop and Start Agent Server no reload is offered when the new instance's descriptor carries no devinChat mark, although the saved setup still matches the workspace; fails_when=the offer is decided from the saved workspace state alone, so the learner reloads for a bridge that the unmarked descriptor refuses anyway; why_new=review finding M4 (Cycle 0143 /ship cycle 3 final range, offer follows the mark); seam=the real descriptor file, the entry's record deleted before the restart
test('a Devin Desktop window offers no reload after a restart whose new descriptor is unmarked', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    await rm(join(window.directory, 'devin-mcp/receipt.json'), { force: true })
    // Act
    // The first Stop waits for the reconnect's start to end: a Stop while it still starts makes the reconnect answer "did not reconnect", a notice this test does not exercise.
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop learner whose codebook entry stays turned off in Devin's Customize is told to turn it on there instead of being promised that the reload loads the server; fails_when=the setup notice still says the reload loads Codebook's MCP server for a disabled entry; why_new=review finding M6 (Cycle 0143 /ship cycle 3 final range, disabled entry); seam=an entry write stand-in that answers disabled
test('Set Up AI Chat in Devin Desktop with a turned-off entry tells the learner to turn it on in Customize', async (context) => {
  // Arrange
  const window = await devinWindow(context, { entryDisabled: true })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local, but the codebook server is turned off in Devin's Customize. Turn it on there, reload this window, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})
