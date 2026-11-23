import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { ReceiptState } from '../utils/readReceiptState'
import type { readStandingDevinInstallationId } from '../utils/readStandingDevinInstallationId'
import { createPathReadGate } from '../utils/shareReceiptRead'

import { loadModule } from './utils/loadModule'
import { within } from './utils/within'

/** The two receipt folders of the Devin setup. */
type ReceiptFolder = 'devin-skill' | 'devin-mcp'

/**
 * Loads {@link readStandingDevinInstallationId} over receipt reads a test controls, with a read gate of its own: the skill's and the MCP entry's receipt answer what `answers` says, by the folder in the path, and a missing answer is a read that never returns until the test ends.
 * @param answers - What each receipt's read answers; a receipt left out is held until the test ends.
 * @param context - The test, whose end releases the held reads.
 * @returns The read of a storage root and how many reads of each receipt started.
 * @example const { read, starts } = await loadWith({ 'devin-mcp': MCP_REMOVED }, context)
 */
async function loadWith(
  answers: Partial<Record<ReceiptFolder, ReceiptState>>,
  context: TestContext,
): Promise<{
  read: (storageRoot: string) => Promise<string | undefined | null>
  starts: Record<ReceiptFolder, number>
}> {
  const starts: Record<ReceiptFolder, number> = {
    'devin-skill': 0,
    'devin-mcp': 0,
  }
  const heldReads: Array<() => void> = []
  let isReleased = false
  // A held read answers no answer once the test ended, so no read of this test stays pending.
  context.after(() => {
    isReleased = true
    for (const release of heldReads) release()
  })
  const loaded = await loadModule<{
    readStandingDevinInstallationId: typeof readStandingDevinInstallationId
  }>(resolve(__dirname, '../utils/readStandingDevinInstallationId.js'), {
    './readReceiptState': {
      readReceiptState: (receiptPath: string): Promise<ReceiptState> => {
        const folder: ReceiptFolder = receiptPath.includes('devin-skill')
          ? 'devin-skill'
          : 'devin-mcp'
        starts[folder] += 1
        const answer = answers[folder]
        if (answer) return Promise.resolve(answer)
        const noAnswer: ReceiptState = { state: 'no-answer', receiptPath }
        if (isReleased) return Promise.resolve(noAnswer)
        return new Promise((resolveRead) => {
          heldReads.push(() => resolveRead(noAnswer))
        })
      },
    },
  })
  const reads = createPathReadGate()
  return {
    read: (storageRoot) =>
      loaded.readStandingDevinInstallationId(storageRoot, reads),
    starts,
  }
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

// Value: protects=a removal observed on one receipt is answered at once while the other receipt's read never returns; fails_when=the read waits for both receipts, so the mark decision and the descriptor queue behind it hold until the hung read ends; no_claim=a hung read next to an installed receipt (nothing is known then)
test('a removed MCP receipt answers not standing at once while the skill receipt read never returns', async (context) => {
  // Arrange
  const { read } = await loadWith({ 'devin-mcp': MCP_REMOVED }, context)
  // Act
  const answer = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(answer, undefined)
})

// Value: protects=the same early answer when the skill receipt is the removed one; fails_when=only one of the two receipts is raced; no_claim=the wording of the reason
test('a removed skill receipt answers not standing at once while the MCP receipt read never returns', async (context) => {
  // Arrange
  const { read } = await loadWith({ 'devin-skill': SKILL_REMOVED }, context)
  // Act
  const answer = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(answer, undefined)
})

// Value: protects=both receipts installed still give the MCP receipt's installation id; fails_when=the early answer changes the normal answer; no_claim=a hung read
test('both receipts installed answer the installation id of the MCP receipt', async (context) => {
  // Arrange
  const { read } = await loadWith(
    {
      'devin-skill': { state: 'installed', receipt: { installed: true } },
      'devin-mcp': {
        state: 'installed',
        receipt: { installed: true, installationId: 'installation-a' },
      },
    },
    context,
  )
  // Act
  const answer = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(answer, 'installation-a')
})

// Value: protects=an installed receipt next to a hung read gives no answer yet, so a missing answer is never taken for a standing setup; fails_when=the read answers an id or not standing before the hung read settles; no_claim=how long the caller waits (it bounds the wait itself)
test('an installed MCP receipt next to a skill receipt read that never returns gives no answer', async (context) => {
  // Arrange
  const { read } = await loadWith(
    {
      'devin-mcp': {
        state: 'installed',
        receipt: { installed: true, installationId: 'installation-a' },
      },
    },
    context,
  )
  // Act
  const answer = await within(read('/storage'), 300)
  // Assert
  assert.equal(answer, 'still waiting')
})

// Value: protects=refreshes on a storage whose skill receipt read never returns hold one read of that receipt, so each refresh after an early removal answer adds no hung read to the editor's file pool (Cycle 0146 task 1d; hosted CodeRabbit on PR 364, readStandingDevinInstallationId.ts:41); fails_when=every read starts one more read of the hung skill receipt (two reads, two starts); no_claim=the window's own refresh loop and real file reads (a stand-in of readReceiptState answers by folder)
test('two reads while the MCP receipt is removed and the skill receipt read never returns start the skill receipt read once', async (context) => {
  // Arrange
  const { read, starts } = await loadWith({ 'devin-mcp': MCP_REMOVED }, context)
  // Act
  const first = await within(read('/storage'), 2_000)
  const second = await within(read('/storage'), 2_000)
  // Assert
  assert.equal(first, undefined)
  assert.equal(second, undefined)
  assert.equal(starts['devin-skill'], 1)
})
