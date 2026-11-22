import assert from 'node:assert/strict'
import { test } from 'node:test'

import { devinRemovalNotice } from '../utils/devinRemovalNotice'

// Value: protects=after a full removal the learner reads what went, that the config's other servers stayed, and that a reload stops the bridge Devin Local already runs; fails_when=the notice hides the kept entries or drops the reload, so Devin Local keeps calling a removed setup until some later reload; why_new=Devin Desktop removal command (Cycle 0143); seam=none
test('a removal of the skill and the entry asks for a reload and says the other MCP entries were kept', () => {
  // Arrange / Act
  const notice = devinRemovalNotice('removed', {
    status: 'removed',
    path: '/home/user/.config/devin/mcp_config.json',
  })
  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    text: "Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from /home/user/.config/devin/mcp_config.json and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.",
    reload: true,
  })
})

// Value: protects=a learner who runs the removal where Codebook installed nothing is told plainly that no file changed; fails_when=the notice claims a removal or asks for a pointless reload; why_new=Devin Desktop removal command (Cycle 0143); seam=none
test('a removal that finds nothing of Codebook says that no file was changed and asks for no reload', () => {
  // Arrange / Act
  const notice = devinRemovalNotice('not-installed', {
    status: 'not-managed',
    path: '/home/user/.config/devin/mcp_config.json',
  })
  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    text: "Nothing to remove: no Codebook-owned Devin Desktop skill was found and /home/user/.config/devin/mcp_config.json holds no codebook entry of Codebook's. No file was changed.",
    reload: false,
  })
})

// Value: protects=an entry the learner edited after setup stays, and the notice says so, how to remove it by hand and that it must be renamed or deleted before setup runs again; fails_when=the notice says the entry was removed, says setup installs both again although it refuses the remaining entry, or the reload is offered although Devin Local's servers did not change; why_new=Devin Desktop removal command (Cycle 0143); seam=none
test('a removal that meets an edited entry keeps it and says how to remove it by hand', () => {
  // Arrange / Act
  const notice = devinRemovalNotice('removed', {
    status: 'changed',
    path: '/home/user/.config/devin/mcp_config.json',
  })
  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    text: 'Codebook removed its Devin Desktop skill. The codebook entry in /home/user/.config/devin/mcp_config.json was edited after setup, so Codebook left it in place; remove it by hand if you no longer want it. Rename or delete that remaining codebook entry before you run Codebook: Set Up AI Chat, which refuses an entry it did not write.',
    reload: false,
  })
})

// Value: protects=a refused entry removal leads with the refusal's cause, says what became of the skill and names the command that finishes the removal; fails_when=the refusal is swallowed behind a success notice, or the learner is not told the skill already went; why_new=Devin Desktop removal command (Cycle 0143); seam=none
test('a refused entry removal warns with its cause and names the command that finishes the removal', () => {
  // Arrange / Act
  const notice = devinRemovalNotice('removed', {
    refusal:
      'Devin Desktop MCP config is not valid JSON: /home/user/.config/devin/mcp_config.json. Codebook left it untouched.',
  })
  // Assert
  assert.deepEqual(notice, {
    severity: 'warning',
    text: 'Devin Desktop MCP config is not valid JSON: /home/user/.config/devin/mcp_config.json. Codebook left it untouched. Codebook removed its Devin Desktop skill. When the cause above is resolved, run Codebook: Remove Devin Desktop Setup again: it goes on with the entry.',
    reload: false,
  })
})

// Value: protects=an entry removed while Codebook's own record could not be deleted is still reported as removed, with the record sentence and the reload Devin Local needs; fails_when=the notice turns the finished config change into a refusal without a reload, so Devin Local keeps the removed server until some later reload; why_new=review round (CodeRabbit, a record-cleanup failure after the config change); seam=none
test('a removal whose record could not be deleted still reports the removed entry and asks for a reload', () => {
  // Arrange / Act
  const notice = devinRemovalNotice('removed', {
    status: 'removed',
    path: '/home/user/.config/devin/mcp_config.json',
    cleanupFailure:
      'Codebook could not delete its own record of that entry at /private/devin-mcp/receipt.json; delete that record by hand.',
  })
  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    text: "Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from /home/user/.config/devin/mcp_config.json and kept the file's other entries. Codebook could not delete its own record of that entry at /private/devin-mcp/receipt.json; delete that record by hand. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.",
    reload: true,
  })
})
