import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  MCP_RECEIPT_TEXT,
  devinWindow,
} from './utils/devinChatOnboardingHarness'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

// Value: protects=Set Up AI Chat in Devin Desktop leaves Devin Local able to reach this window's Codebook: the skill in Devin's folder, a running server, then one MCP entry naming this installation's bridge and the descriptor folder, with the setup saved and a reload offered; fails_when=Devin Desktop runs the VS Code path (no skill, no entry, Cycle 0142 O8), the entry is written before the server exists, it carries the token, or no reload is offered so Devin Local never loads the entry; why_new=Devin Desktop setup (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('Set Up AI Chat in Devin Desktop installs the skill, starts the server, writes the MCP entry and offers a reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { noticeChoice: 'Reload Window' })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    await waitUntil(
      () => window.executedCommands.length > 0,
      'the reload the notice offered',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
    assert.deepEqual(window.writtenEntries, [
      {
        command: '/external/node',
        args: [
          join(window.directory, 'dist/devinMcpBridge.js'),
          join(window.directory, 'agent'),
        ],
        env: {},
      },
    ])
    assert.doesNotMatch(JSON.stringify(window.writtenEntries), /test-token/)
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
    assert.deepEqual(window.executedCommands, ['workbench.action.reloadWindow'])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Windows Devin Desktop learner gets one plain refusal and no file is written; fails_when=setup writes a skill into an unverified Windows folder or an MCP entry Devin may never read (Cycle 0143 decision D6); why_new=Devin Desktop setup (Cycle 0143); seam=process.platform of the loaded module
test('Set Up AI Chat in a Windows Devin Desktop window refuses before it writes anything', async (context) => {
  // Arrange
  const window = await devinWindow(context, { platform: 'win32' })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Devin Desktop setup on Windows is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after an extension update a Devin Desktop window brings Codebook's entry to the new bridge before the server starts and asks for the reload Devin Local needs; fails_when=the entry keeps naming the removed version's bridge, so Devin Local fails to start Codebook's MCP server after the update; why_new=Devin Desktop activation refresh (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window that opens on a set-up workspace refreshes a moved MCP entry, starts the server and offers a reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'start server',
    ])
    assert.deepEqual(window.refreshedEntries, [
      {
        command: '/external/node',
        args: [
          join(window.directory, 'dist/devinMcpBridge.js'),
          join(window.directory, 'agent'),
        ],
        env: {},
      },
    ])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook updated its MCP server entry for Devin Local to this installation. Reload this window so Devin Local starts the updated server.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a learner who turned Codebook's Devin entry off in Customize is told to turn it on before the reload / fails_when: the activation notice promises that a reload starts the updated server while the entry stays off / no_claim: the entry's own refresh (devinMcpConfig tests)
test('a Devin Desktop window whose refreshed MCP entry is turned off in Customize asks to turn it on before the reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
    entryDisabled: true,
  })
  try {
    // Act
    await waitUntil(
      () => window.notices.length > 0,
      'the refreshed entry notice',
    )
    // Assert
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook updated its MCP server entry for Devin Local to this installation, but the codebook server is turned off in Devin's Customize. Turn it on there, then reload this window so Devin Local starts the updated server.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose setup was removed (in another window) writes no file and starts nothing, and says so in the Output; fails_when=activation writes the skill or the entry back, or starts a server for a setup the learner removed; why_new=Devin Desktop activation refresh (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window whose setup was removed elsewhere reconnects nothing, reads neither Node nor the config, and writes one Output line', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
    entryReceipt: false,
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's Devin Desktop setup was removed, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
        ),
      'the Output line of the removed setup',
    )
    // Assert
    assert.deepEqual(window.steps, ['verify Devin skill'])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads while Codebook's record of the entry stands only at its private dropping name (a run stopped while it moved receipt.json there to rewrite or delete it) still runs the locked entry refresh, whose run start puts that record back, instead of calling the setup removed when its skill check fails too (Cycle 0149 ship review pass 2, red team 1 on extension.ts:2588); fails_when=the window writes the removed-setup line or any Output line but the skill check's refusal, shows a notice, or never refreshes the entry, so the record a stopped run left there is never put back at window load, all read once the reconnect at activation settled (Cycle 0149 final-range review: a wait that ended at the server start missed what the rest of the reconnect writes or shows); no_claim=what the real refresh does with that record (the config module's own tests: the run start puts it back while its dropping note proves it), a real stop (the test writes the record at receipt.json.codebook-dropping and nothing at receipt.json, as such a stop leaves them); seam=module stand-ins of the skill (its check fails), config, Node and server, and the real records in a temporary storage
test("a Devin Desktop window whose skill check fails while Codebook's record of the entry stands only at its dropping name refreshes the entry instead of calling the setup removed", async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await mkdir(join(storageDirectory, 'devin-mcp'), { recursive: true })
  await writeFile(
    join(storageDirectory, 'devin-mcp/receipt.json.codebook-dropping'),
    MCP_RECEIPT_TEXT,
    { mode: 0o600 },
  )
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
    entryReceipt: false,
    storageDirectory,
  })
  try {
    // Act
    // The reconnect at activation settles once it started the server or decided not to, so a line or notice it raises after the server start is in by then.
    const reconnect = await within(window.whenReconnected(), 10_000)
    // Assert
    assert.equal(reconnect, undefined)
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [
      'Codebook did not refresh its Devin Desktop skill: Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ])
    assert.deepEqual(window.outputErrorLines, [])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=Remove Devin Desktop Setup removes Codebook's skill and entry after the learner confirms, clears this window's setup and offers the reload that stops the bridge; fails_when=the removal leaves the entry, keeps the setup saved so the next window writes everything back, or never asks before touching files shared by every Devin Desktop window; why_new=Devin Desktop removal command (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('Remove Devin Desktop Setup removes the skill and the MCP entry, clears the setup and offers a reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { confirmRemoval: true })
  try {
    await window.commands.get('codebook.setupAiChat')!()
    window.steps.length = 0
    window.notices.length = 0
    // Act
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    assert.deepEqual(window.modalQuestions, [
      "Remove the Codebook-owned Devin Desktop skill and Codebook's entry in Devin's MCP config? Every Devin Desktop window of this user shares them.",
    ])
    assert.deepEqual(window.steps, ['remove Devin skill', 'remove MCP entry'])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message: `Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from ${window.configPath} and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.`,
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Windows Devin Desktop learner who runs the removal is told setup is not supported there, and nothing at the macOS and Linux paths is touched; fails_when=the removal reaches the skill and config helpers on Windows after the confirmation; why_new=review round (CodeRabbit, the Windows guard covered only setup); seam=process.platform of the loaded module
test('Remove Devin Desktop Setup in a Windows Devin Desktop window refuses before it touches any file', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    platform: 'win32',
    confirmRemoval: true,
  })
  try {
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    await assert.rejects(removal, {
      message: 'Devin Desktop setup on Windows is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.modalQuestions, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Windows Devin Desktop window whose workspace has a saved setup (an older Codebook's VS Code path) reconnects nothing and touches no skill or config; fails_when=activation refreshes the macOS and Linux paths or starts a server for Devin Local on Windows; why_new=review round (CodeRabbit, the Windows guard covered only setup); seam=process.platform of the loaded module
test('a Windows Devin Desktop window with a saved setup reconnects nothing and writes the refusal to the Output', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    platform: 'win32',
    savedSetup: true,
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          'Devin Desktop setup on Windows is not supported yet.',
        ),
      'the Output line of the Windows refusal',
    )
    // Assert
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a removal confirmed while the reconnect refreshed the entry stops that reconnect: no server starts for a setup the learner removed; fails_when=activation goes on to start() after its earlier skill check, so a removed setup's server runs until the window closes; why_new=review round (CodeRabbit, an activation check before the removal's state change); seam=a held entry refresh
test('a reconnect whose refresh is passed by a confirmed removal starts no server', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    holdRefresh: true,
  })
  try {
    await window.refreshReached
    // Act
    // The removal waits for the setup lock the held refresh holds, so it is confirmed first and the refresh then goes on.
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    await waitUntil(
      () => window.modalQuestions.length === 1,
      "the removal's confirmed question",
    )
    window.releaseRefresh()
    await removal
    // Assert
    // The reconnect has ended; a start would show in the steps.
    await window.whenReconnected()
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'remove Devin skill',
      'remove MCP entry',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Stop Agent Server run while the reconnect refreshed the entry is not undone by the automatic start (Cycle 0144 task 12); fails_when=activation goes on to start() after the learner's stop, so a server runs and writes a descriptor after the stop; no_claim=a start the learner asks for later; seam=a held entry refresh
test('a reconnect whose refresh is passed by Stop Agent Server starts no server and writes no descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdRefresh: true,
  })
  try {
    await window.refreshReached
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    window.releaseRefresh()
    // Assert
    // The reconnect has ended; a start would show in the steps.
    await window.whenReconnected()
    assert.equal(window.steps.includes('start server'), false)
    // No server ever started, so not even the agent folder with the descriptors exists.
    await assert.rejects(window.descriptorNames(), { code: 'ENOENT' })
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed write of the saved setup never stops the removal before Codebook's entry is taken out of the shared config, and the learner still gets the notice; fails_when=the state write rejects first and the entry stays in Devin's config with no notice; why_new=review round (CodeRabbit, the state write came before the entry cleanup); seam=a workspace state stand-in that rejects the clear
test('Remove Devin Desktop Setup removes the MCP entry and shows its notice even when clearing the saved setup fails', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    confirmRemoval: true,
    failSetupClear: true,
  })
  try {
    await window.commands.get('codebook.setupAiChat')!()
    window.steps.length = 0
    window.notices.length = 0
    // Act
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    assert.deepEqual(window.steps, ['remove Devin skill', 'remove MCP entry'])
    assert.equal(
      window.outputLines.includes(
        "Codebook could not clear this window's saved Devin Desktop setup: Injected workspace state write failure",
      ),
      true,
    )
    assert.equal(window.notices.length, 1)
    assert.equal(window.notices[0]!.severity, 'information')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a setup that loses its skill to another window's removal takes back only the entry it wrote, so no MCP entry is left that no window will serve; fails_when=the entry stays after the final check fails (Devin launches a bridge with no saved setup behind it), or the rollback removes without naming this setup's generation and so could take a newer setup's entry; why_new=review round (CodeRabbit major, an entry left after another window removes the setup); seam=module stand-ins of the skill, config, Node and server
test('a Devin setup whose skill another window removed takes back the entry it wrote and saves no setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, { skillManaged: false })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message:
        'Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    })
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
      'remove MCP entry',
    ])
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed setup that found Codebook's entry already in place leaves that shared entry for the windows that use it; fails_when=the rollback removes an entry this setup did not write, cutting other Devin Desktop windows off from Codebook; why_new=review round (CodeRabbit major, roll back only this setup's write); seam=module stand-ins of the skill, config, Node and server
test('a failed Devin setup that found the entry already in place leaves it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    entryWrite: 'current',
  })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup)
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
    assert.deepEqual(window.entryRemovals, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window in WSL, SSH or a container gets one plain refusal from setup and writes nothing; fails_when=setup writes Devin's skill and config on the remote machine, where nothing was checked; why_new=review finding C3 (remote windows); seam=env.remoteName of the editor stand-in
test('Set Up AI Chat in a remote Devin Desktop window refuses before it writes anything', async (context) => {
  // Arrange
  const window = await devinWindow(context, { remoteName: 'wsl' })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Devin Desktop setup in a remote window is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the removal in a remote Devin Desktop window asks nothing and touches no file; fails_when=the removal confirms and reaches the skill and config helpers of a remote machine; why_new=review finding C3 (remote windows); seam=env.remoteName of the editor stand-in
test('Remove Devin Desktop Setup in a remote Devin Desktop window refuses before it asks or touches any file', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    remoteName: 'ssh-remote',
    confirmRemoval: true,
  })
  try {
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    await assert.rejects(removal, {
      message: 'Devin Desktop setup in a remote window is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.modalQuestions, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a remote Devin Desktop window with a saved setup reconnects nothing and says why in the Output; fails_when=activation refreshes the remote machine's config or starts a server Devin Local cannot use there; why_new=review finding C3 (remote windows); seam=env.remoteName of the editor stand-in
test('a remote Devin Desktop window with a saved setup reconnects nothing and writes the refusal to the Output', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    remoteName: 'dev-container',
    savedSetup: true,
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          'Devin Desktop setup in a remote window is not supported yet.',
        ),
      'the Output line of the remote refusal',
    )
    // Assert
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed setup that only updated an entry other windows use leaves that entry; fails_when=the rollback removes an updated entry and cuts the other windows off from Codebook; why_new=review finding C2 (roll back only an installed entry); seam=module stand-ins of the skill, config, Node and server
test('a failed Devin setup that only updated the entry leaves it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    entryWrite: 'updated',
  })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup)
    assert.deepEqual(window.entryRemovals, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a setup whose saved state cannot be written takes back the entry it installed; fails_when=the save sits outside the rollback, so the entry stays with no setup behind it; why_new=review finding C5 (save inside the rollback); seam=a workspace state stand-in that rejects the save
test('a Devin setup whose saved setup cannot be written takes back the entry it installed', async (context) => {
  // Arrange
  const window = await devinWindow(context, { failSetupSave: true })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Injected workspace state save failure',
    })
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a rollback whose clearing of the saved setup fails still takes the installed entry back; fails_when=the failed clear ends the rollback and leaves the entry; why_new=review finding C5 (clear failure during a rollback); seam=a workspace state stand-in that rejects the clear
test('a Devin setup rollback removes the installed entry even when clearing the saved setup fails', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    failSetupClear: true,
  })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, { message: /Devin Desktop skill is missing/ })
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Node the configuration names that cannot be used never puts its raw failure text in the Output, and the window still reconnects; fails_when=the Output line carries the resolver's path or process text; why_new=review finding C4 (fixed line for a Node failure); seam=a Node resolver stand-in that throws raw text
test('a Devin Desktop refresh whose Node cannot be used writes one fixed Output line and still reconnects', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    nodeFailure: true,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [
      'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not refresh its Devin Desktop MCP entry.',
    ])
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'start server',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a skill check that fails while the entry's receipt is left is told as its own Output line, not as a removed setup, and the window reconnects; fails_when=any skill failure is read as a removal; why_new=review finding C10 (removed only when both receipts are gone); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window whose skill check fails but whose entry receipt is left writes the skill line and reconnects', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [
      'Codebook did not refresh its Devin Desktop skill: Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the Devin bridge can tell a window where Set Up AI Chat ran: the descriptor carries devinChat after setup and loses it after the removal, and a window without setup has none; fails_when=the descriptor never carries the mark (the bridge refuses every window) or keeps it after the removal; why_new=review finding C8 (descriptor mark); seam=the real descriptor file in the temporary storage
test('Devin Desktop marks the connection descriptor after setup and unmarks it after the removal', async (context) => {
  // Arrange
  const window = await devinWindow(context, { confirmRemoval: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const beforeSetup = await window.readDescriptorField()
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    const afterSetup = await window.readDescriptorField()
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    const afterRemoval = await window.readDescriptorField()
    // Assert
    assert.deepEqual(
      [beforeSetup, afterSetup, afterRemoval],
      [undefined, true, undefined],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the descriptor mark names the installation of the MCP receipt, so a bridge can tell a removed setup from an updated one (Cycle 0144 task 1); fails_when=the mark carries no installation id or another one than the receipt's, so the bridge refuses every window or accepts a removed setup; no_claim=the bridge's comparison of the id with the receipt; why_new=Cycle 0144 task 1; seam=the real descriptor file in the temporary storage
test(
  'Devin Desktop writes the installation id of the MCP receipt beside devinChat and drops it with the mark',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { confirmRemoval: true })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      await window.commands.get('codebook.setupAiChat')!()
      const afterSetup = await window.readDescriptorInstallation()
      await window.commands.get('codebook.removeManagedDevinSetup')!()
      const afterRemoval = await window.readDescriptorInstallation()
      // Assert
      assert.deepEqual(
        [afterSetup, afterRemoval],
        ['installation-test', undefined],
      )
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// Value: protects=Set Up AI Chat does not report success for a window whose bridge could never connect because the MCP receipt's installation id cannot be read (Cycle 0144 F12); fails_when=the window is marked and the reload is offered although the receipt (mode 0644) is unreadable, so rerunning setup repeats it; no_claim=the wording of the repair beyond naming the receipt file; why_new=Cycle 0144 F12; seam=the real descriptor and receipt files in the temporary storage
test(
  'Devin Desktop setup refuses with the receipt file to repair when the receipt is not private, and leaves the descriptor unmarked',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { receiptMode: 0o644 })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        `Codebook could not read the installation id in ${join(window.directory, 'devin-mcp', 'receipt.json')}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      )
      assert.equal(await window.readDescriptorField(), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a skill receipt that others can read ends setup in a refusal that names devin-skill/receipt.json with the mode repair, rolls back, offers no reload and leaves the window unmarked, because the bridge would refuse that receipt; fails_when=setup marks the window and offers Reload Window while Devin Local could never connect; no_claim=the wording beyond naming the file and the mode; seam=the real descriptor and receipt files, the skill deployment leaves its receipt with mode 0644
test(
  'Devin Desktop setup refuses with the skill receipt to repair when others can read it, offering no reload',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { skillReceiptMode: 0o644 })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        `Codebook could not use its record at ${join(await realpath(window.directory), 'devin-skill', 'receipt.json')}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      )
      assert.equal(await window.readDescriptorField(), undefined)
      assert.deepEqual(window.notices, [])
      assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a re-run of setup whose skill receipt others can read unmarks a window that carried the mark of its earlier setup, so the rollback never marks what the bridge refuses; fails_when=the rollback's sync keeps the mark because the looser receipts check says the setup stands; no_claim=the wording of the refusal
test(
  'a Devin Desktop window with an earlier setup is unmarked after a setup re-run refused for a skill receipt others can read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      savedSetup: true,
      entryWrite: 'current',
      skillReceiptMode: 0o644,
    })
    try {
      await waitUntil(window.descriptorReadable, 'the reconnect descriptor')
      await waitUntil(
        async () => (await window.readDescriptorField()) === true,
        'the earlier setup mark',
      )
      // Act
      await window.commands.get('codebook.setupAiChat')!().catch(
        () => undefined,
      )
      // Assert
      assert.equal(await window.readDescriptorField(), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=once the skill receipt is private again, setup succeeds and marks the window; fails_when=the new check refuses a setup whose records the bridge accepts; no_claim=the reload notice wording
test(
  'Devin Desktop setup succeeds after the skill receipt was made private again',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { skillReceiptMode: 0o644 })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      await window.commands.get('codebook.setupAiChat')!().catch(
        () => undefined,
      )
      await chmod(join(window.directory, 'devin-skill', 'receipt.json'), 0o600)
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(setupOutcome, 'resolved')
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=Set Up AI Chat never reports success when the MCP receipt became readable by others right after its installation id was read: the bridge's own check refuses it, the setup rolls back, the window ends unmarked and no reload is offered (Cycle 0145 task 9, was Cycle 0144 CR12); fails_when=setup resolves with a mark the bridge refuses; no_claim=the activation reconnect and the rollback sync; seam=afterInstallationRead makes the receipt mode 0644 after the check
test(
  'Devin Desktop setup rolls back and offers no reload when the receipt becomes readable by others right after the installation id check',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      afterInstallationRead: async (): Promise<void> => {
        await chmod(join(window.directory, 'devin-mcp', 'receipt.json'), 0o644)
      },
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        `Codebook could not use its record at ${join(await realpath(window.directory), 'devin-mcp', 'receipt.json')}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      )
      assert.equal(await window.readDescriptorField(), undefined)
      assert.deepEqual(window.notices, [])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=Set Up AI Chat does not report success for a descriptor that names another server than the one it checked; fails_when=the final check accepts a descriptor of another instance, so the reload is offered for a window whose bridge cannot select this server; why_new=Cycle 0145 /ship pass 1 finding (false success, final check without server identity); seam=the descriptor is replaced right after the installation id was read; no_claim=the wording of the rollback's Output lines
test(
  'Devin Desktop setup rolls back with the changed-meanwhile sentence and offers no reload when the descriptor names another instance at the final check',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      afterInstallationRead: async (): Promise<void> => {
        await writeFile(
          await window.descriptorPath(),
          JSON.stringify({
            instanceId: 'instance-other',
            url: 'http://127.0.0.1/instance-other/mcp',
            token: 'test-token',
            workspace: window.directory,
            apiVersion: '1.6',
            pid: process.pid,
          }),
          { mode: 0o600 },
        )
      },
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        'The Devin Desktop setup changed while this setup ran; run Codebook: Stop Agent Server, then Codebook: Set Up AI Chat again.',
      )
      assert.deepEqual(window.notices, [])
      assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=Set Up AI Chat does not report success for a descriptor rewritten to an empty object, which gains only the mark; fails_when=the final check accepts a descriptor that names no instance, url, workspace or host; why_new=Cycle 0145 /ship pass 1 finding (false success, final check without server identity); seam=the descriptor is replaced by {} right after the installation id was read; no_claim=the wording of the rollback's Output lines
test(
  'Devin Desktop setup rolls back and offers no reload when the descriptor was rewritten to an empty object before the final check',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      afterInstallationRead: async (): Promise<void> => {
        await writeFile(await window.descriptorPath(), '{}', { mode: 0o600 })
      },
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        'The Devin Desktop setup changed while this setup ran; run Codebook: Stop Agent Server, then Codebook: Set Up AI Chat again.',
      )
      assert.deepEqual(window.notices, [])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a first setup whose MCP receipt others can read and whose rollback deletes that receipt asks only for a setup retry, not for a mode repair of a file that is gone; fails_when=the sentence is chosen before the rollback and names the deleted receipt with the mode-600 instruction; why_new=Cycle 0145 /ship pass 1 finding (false success, chmod for a deleted receipt); seam=a removal stand-in that deletes the receipt as the real one does; no_claim=a receipt that stays (the sibling test above)
test(
  'Devin Desktop setup asks only for a retry when its rollback deleted the receipt others could read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      receiptMode: 0o644,
      removalDeletesReceipt: true,
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.',
      )
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a first read of the installation id that failed to look (EMFILE) asks for a retry and offers no mode repair for a private receipt that holds a valid id; fails_when=the refusal reads the receipt again, finds it fine and asks the learner to chmod a file that needs nothing; why_new=Cycle 0145 /ship pass 1 finding (error handling, EMFILE then reread); seam=the first installation id read answers no answer; no_claim=a receipt others can read (the sibling test above)
test(
  'Devin Desktop setup asks for a retry without a mode repair when the first read of the installation id gave no answer',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      failFirstInstallationRead: true,
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
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
        'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.',
      )
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// Value: protects=a window that opens on a set-up workspace writes its descriptor already marked; fails_when=the descriptor written at the server start lacks devinChat, so Devin Local's bridge refuses the window after every reload; why_new=review finding C8 (descriptor decided before the start); seam=the real descriptor file in the temporary storage
test('a Devin Desktop window that opens on a set-up workspace writes a marked connection descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // Assert
    assert.equal(await window.readDescriptorField(), true)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after Stop and Start Agent Server a set-up Devin Desktop window offers the reload Devin Local needs to reach the new server, and not at the first start; fails_when=no reload is offered and the bridge stays on the stopped server, or the first start already asks for one; why_new=review finding C7 (reload after a restart); seam=module stand-ins of the skill, config, Node and server
test('a set-up Devin Desktop window offers Reload Window after its agent server was stopped and started again', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // The first Stop waits for the reconnect's start to end: a Stop while it still starts makes the reconnect answer "did not reconnect", a notice this test does not exercise. The activation's notices are counted once it ended, so a reload offered at the first start cannot pass for the restart's.
    await window.whenReconnected()
    const noticesAtActivation = window.notices.length
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(noticesAtActivation, 0)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook restarted its agent server. Reload this window so Devin Local connects to the new server.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the Devin removal shows in the Command Palette only in Devin Desktop; fails_when=activation never sets codebook.isDevinDesktop or the manifest lists the command for every editor; why_new=review finding C11 (palette entry only in Devin Desktop); seam=the editor's setContext call and package.json
test('Devin Desktop sets the context key that shows Remove Devin Desktop Setup in the Command Palette', async (context) => {
  // Arrange
  const window = await devinWindow(context)
  const manifest: {
    contributes: {
      menus: { commandPalette: Array<{ command: string; when?: string }> }
    }
  } = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )
  try {
    // Act
    await waitUntil(
      () => window.contextKeys.has('codebook.isDevinDesktop'),
      'the context key of Devin Desktop',
    )
    // Assert
    assert.equal(window.contextKeys.get('codebook.isDevinDesktop'), true)
    assert.deepEqual(
      manifest.contributes.menus.commandPalette.filter(
        (entry) => entry.command === 'codebook.removeManagedDevinSetup',
      ),
      [
        {
          command: 'codebook.removeManagedDevinSetup',
          when: 'codebook.isDevinDesktop',
        },
      ],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Node the configuration names that cannot be used shows one fixed sentence in Set Up AI Chat and logs nothing of its stderr, and no file is written; fails_when=the resolver's raw text (stderr of the executable) reaches the error, a notice or the Output; why_new=review finding (Codex P1, setup path of the Node failure); seam=a Node resolver stand-in that throws secret-like text
test('Set Up AI Chat in Devin Desktop with an unusable Node shows a fixed sentence and never the failure text', async (context) => {
  // Arrange
  const window = await devinWindow(context, { nodeFailure: true })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message:
        'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not set up Devin Desktop. Check that setting, then run Codebook: Set Up AI Chat again.',
    })
    assert.deepEqual(window.steps, ['resolve Node'])
    assert.doesNotMatch(
      JSON.stringify([window.notices, window.outputLines]),
      /TOKEN-LIKE-TEXT/,
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a connection descriptor that does not parse never puts any of its content, which includes the bearer token, into the setup error or the Output; fails_when=the JSON parser's own message (it quotes part of the input) reaches the learner's error or the removal's Output line; why_new=review finding F1 (Cycle 0143 /ship pass 2, descriptor content in an error); seam=a real descriptor file overwritten with token-like text
test('a Devin Desktop setup and removal never show the content of a connection descriptor that does not parse', async (context) => {
  // Arrange
  const window = await devinWindow(context, { confirmRemoval: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    await writeFile(await window.descriptorPath(), 'TOKEN-LIKE-TEXT {')
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // The unmark of the rollback fails on the same descriptor, so the rollback says it is incomplete.
    await assert.rejects(setup, {
      message:
        "Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again. Codebook could not take back everything the setup saved; see Codebook's Output for details.",
    })
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    assert.equal(
      window.outputLines.includes(
        "Codebook could not update this window's connection descriptor: Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again.",
      ),
      true,
    )
    assert.doesNotMatch(
      JSON.stringify([window.notices, window.outputLines]),
      /TOKEN-LIKE-TEXT/,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a kept copy of the previous Devin config, which holds other servers' settings, is named in the setup notice; fails_when=the write's cleanupFailure sentence is dropped and the copy stays on disk unreported; why_new=review finding F2 (Cycle 0143 /ship pass 2); seam=an entry write stand-in that answers a cleanupFailure
test('Set Up AI Chat in Devin Desktop names a kept copy of the previous config in its notice', async (context) => {
  // Arrange
  const sentence =
    'Codebook could not delete its private copy of your config at /home/user/.config/devin/mcp_config.json.bak; delete that copy by hand.'
  const window = await devinWindow(context, { cleanupFailure: sentence })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(
      window.notices.map((notice) => notice.message),
      [
        `Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session. ${sentence}`,
      ],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the activation refresh writes the sentence of a kept copy of the previous Devin config to the Output; fails_when=the refresh drops the cleanupFailure of the config module and the copy stays unreported; why_new=review finding F2 (Cycle 0143 /ship pass 2); seam=an entry refresh stand-in that answers a cleanupFailure
test('a Devin Desktop refresh that moved the entry names a kept copy of the previous config in the Output', async (context) => {
  // Arrange
  const sentence =
    'Codebook could not delete its private copy of your config at /home/user/.config/devin/mcp_config.json.bak; delete that copy by hand.'
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
    cleanupFailure: sentence,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [sentence])
  } finally {
    await window.loaded.deactivate()
  }
})
