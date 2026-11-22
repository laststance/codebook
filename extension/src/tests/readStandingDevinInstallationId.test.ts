import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type { ReceiptState } from '../utils/readReceiptState'
import type { readStandingDevinInstallationId } from '../utils/readStandingDevinInstallationId'

import { loadModule } from './utils/loadModule'
import { within } from './utils/within'

/**
 * Loads {@link readStandingDevinInstallationId} over receipt reads a test controls: the skill's and the MCP entry's receipt answer what `answers` says, by the folder in the path, and a missing answer is a read that never returns.
 * @param answers - What each receipt's read answers; a receipt left out never answers.
 * @returns The loaded function.
 * @example await loadWith({ 'devin-mcp': removed })
 */
async function loadWith(
  answers: Partial<Record<'devin-skill' | 'devin-mcp', ReceiptState>>,
): Promise<typeof readStandingDevinInstallationId> {
  const loaded = await loadModule<{
    readStandingDevinInstallationId: typeof readStandingDevinInstallationId
  }>(resolve(__dirname, '../utils/readStandingDevinInstallationId.js'), {
    './readReceiptState': {
      readReceiptState: (receiptPath: string): Promise<ReceiptState> => {
        const folder = receiptPath.includes('devin-skill')
          ? 'devin-skill'
          : 'devin-mcp'
        const answer = answers[folder]
        return answer ? Promise.resolve(answer) : new Promise(() => undefined)
      },
    },
  })
  return loaded.readStandingDevinInstallationId
}

const MCP_REMOVED: ReceiptState = {
  state: 'removed',
  reason: 'missing',
  receiptPath: '/storage/devin-mcp/receipt.json',
}
const SKILL_REMOVED: ReceiptState = {
  state: 'removed',
  reason: 'uninstalled',
  receiptPath: '/storage/devin-skill/receipt.json',
}

// protects=a removal observed on one receipt is answered at once while the other receipt's read never returns; fails_when=the read waits for both receipts, so the mark decision and the descriptor queue behind it hold until the hung read ends; no_claim=a hung read next to an installed receipt (nothing is known then)
test('a removed MCP receipt answers not standing at once while the skill receipt read never returns', async () => {
  // Arrange
  const read = await loadWith({ 'devin-mcp': MCP_REMOVED })
  // Act
  const answer = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(answer, undefined)
})

// protects=the same early answer when the skill receipt is the removed one; fails_when=only one of the two receipts is raced; no_claim=the wording of the reason
test('a removed skill receipt answers not standing at once while the MCP receipt read never returns', async () => {
  // Arrange
  const read = await loadWith({ 'devin-skill': SKILL_REMOVED })
  // Act
  const answer = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(answer, undefined)
})

// protects=both receipts installed still give the MCP receipt's installation id; fails_when=the early answer changes the normal answer; no_claim=a hung read
test('both receipts installed answer the installation id of the MCP receipt', async () => {
  // Arrange
  const read = await loadWith({
    'devin-skill': { state: 'installed', receipt: { installed: true } },
    'devin-mcp': {
      state: 'installed',
      receipt: { installed: true, installationId: 'installation-a' },
    },
  })
  // Act
  const answer = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(answer, 'installation-a')
})

// protects=an installed receipt next to a hung read gives no answer yet, so a missing answer is never taken for a standing setup; fails_when=the read answers an id or not standing before the hung read settles; no_claim=how long the caller waits (it bounds the wait itself)
test('an installed MCP receipt next to a skill receipt read that never returns gives no answer', async () => {
  // Arrange
  const read = await loadWith({
    'devin-mcp': {
      state: 'installed',
      receipt: { installed: true, installationId: 'installation-a' },
    },
  })
  // Act
  const answer = await within(read('/storage'), 300)
  // Assert
  assert.equal(answer, 'still waiting')
})
