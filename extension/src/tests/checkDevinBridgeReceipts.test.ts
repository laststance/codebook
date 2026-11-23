import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type {
  checkDevinBridgeReceipts,
  DevinBridgeReceiptsAnswer,
} from '../utils/checkDevinBridgeReceipts'
import type { PrivateJsonState } from '../utils/readPrivateJsonState'
import type { ReceiptState } from '../utils/readReceiptState'
import { createPathReadGate } from '../utils/shareReceiptRead'

import { loadModule } from './utils/loadModule'
import { within } from './utils/within'

/** The three files one check reads. */
type CheckedFile = 'descriptor' | 'devin-skill' | 'devin-mcp'

/** What each file's read answers; a file left out is held until the test ends. */
interface CheckAnswers {
  descriptor?: PrivateJsonState
  'devin-skill'?: ReceiptState
  'devin-mcp'?: ReceiptState
}

const DESCRIPTOR_PATH = '/storage/agent/window.connection.json'

/**
 * Loads {@link checkDevinBridgeReceipts} over descriptor and receipt reads a test controls, with a read gate of its own; a read whose answer is left out is held until the test ends, then answers no answer.
 * @param answers - What each file's read answers.
 * @param context - The test, whose end releases the held reads.
 * @returns The check of {@link DESCRIPTOR_PATH} and how many reads of each file started.
 * @example const { check, starts } = await loadCheckWith({ 'devin-mcp': MCP_REMOVED }, context)
 */
async function loadCheckWith(
  answers: CheckAnswers,
  context: TestContext,
): Promise<{
  check: () => Promise<DevinBridgeReceiptsAnswer>
  starts: Record<CheckedFile, number>
}> {
  const starts: Record<CheckedFile, number> = {
    descriptor: 0,
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
  /** Answers one read, or holds it until the test ends. @example answerOrHold(answers.descriptor, { state: 'no-answer' }) */
  const answerOrHold = <State>(
    answer: State | undefined,
    noAnswer: State,
  ): Promise<State> => {
    if (answer) return Promise.resolve(answer)
    if (isReleased) return Promise.resolve(noAnswer)
    return new Promise((resolveRead) => {
      heldReads.push(() => resolveRead(noAnswer))
    })
  }
  const loaded = await loadModule<{
    checkDevinBridgeReceipts: typeof checkDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: (): Promise<PrivateJsonState> => {
        starts.descriptor += 1
        return answerOrHold(answers.descriptor, { state: 'no-answer' })
      },
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string): Promise<ReceiptState> => {
        const folder = receiptPath.includes('devin-skill')
          ? 'devin-skill'
          : 'devin-mcp'
        starts[folder] += 1
        return answerOrHold(answers[folder], {
          state: 'no-answer',
          receiptPath,
        })
      },
    },
  })
  const reads = createPathReadGate()
  return {
    check: () => loaded.checkDevinBridgeReceipts(DESCRIPTOR_PATH, {}, reads),
    starts,
  }
}

const MARKED_DESCRIPTOR: PrivateJsonState = {
  state: 'read',
  value: { devinChat: true, devinSetupInstallation: 'installation-a' },
}
const MCP_REMOVED: ReceiptState = {
  state: 'removed',
  reason: 'missing',
  receiptPath: '/storage/devin-mcp/receipt.json',
}
const SKILL_INSTALLED: ReceiptState = {
  state: 'installed',
  receipt: { installed: true },
}
const MCP_INSTALLED: ReceiptState = {
  state: 'installed',
  receipt: { installed: true, installationId: 'installation-a' },
}

// Value: protects=the Devin bridge's retries after an early removal answer hold one read of a skill receipt that never returns, so its first connection cannot fill the file pool with reads of a stalled disk (Cycle 0146 task 1e; hosted CodeRabbit on PR 364, devinMcpBridge.ts:1032); fails_when=each check starts one more read of the hung skill receipt (two checks, two starts); no_claim=the bridge's retry loop itself and real file reads (stand-ins of the two readers answer by file)
test('two checks while the MCP receipt is removed and the skill receipt read never returns start the skill receipt read once', async (context) => {
  // Arrange
  const { check, starts } = await loadCheckWith(
    { descriptor: MARKED_DESCRIPTOR, 'devin-mcp': MCP_REMOVED },
    context,
  )
  // Act
  const first = await within(check(), 2_000)
  const second = await within(check(), 2_000)
  // Assert
  // The answers come from the loaded module's own realm: a copy made here compares by value.
  assert.deepEqual(structuredClone(first), {
    answer: 'removed',
    reason: 'missing',
    path: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(structuredClone(second), {
    answer: 'removed',
    reason: 'missing',
    path: '/storage/devin-mcp/receipt.json',
  })
  assert.equal(starts['devin-skill'], 1)
})

// Value: protects=checks after an early removal answer hold one read of a descriptor that never returns (Cycle 0146 task 1e, the descriptor read included per Codex finding 14); fails_when=each check starts one more read of the hung descriptor (two checks, two starts); no_claim=real file reads (stand-ins of the two readers answer by file)
test('two checks while the MCP receipt is removed and the descriptor read never returns start the descriptor read once', async (context) => {
  // Arrange
  const { check, starts } = await loadCheckWith(
    { 'devin-skill': SKILL_INSTALLED, 'devin-mcp': MCP_REMOVED },
    context,
  )
  // Act
  const first = await within(check(), 2_000)
  const second = await within(check(), 2_000)
  // Assert
  // The answers come from the loaded module's own realm: a copy made here compares by value.
  assert.deepEqual(structuredClone(first), {
    answer: 'removed',
    reason: 'missing',
    path: '/storage/devin-mcp/receipt.json',
  })
  assert.deepEqual(structuredClone(second), {
    answer: 'removed',
    reason: 'missing',
    path: '/storage/devin-mcp/receipt.json',
  })
  assert.equal(starts.descriptor, 1)
})

// Value: protects=a setup whose descriptor and receipts all stand still answers stands through the shared reads; fails_when=sharing the reads changes the normal answer; no_claim=a hung read
test('a check whose descriptor and receipts all stand answers stands', async (context) => {
  // Arrange
  const { check } = await loadCheckWith(
    {
      descriptor: MARKED_DESCRIPTOR,
      'devin-skill': SKILL_INSTALLED,
      'devin-mcp': MCP_INSTALLED,
    },
    context,
  )
  // Act
  const answer = await within(check(), 2_000)
  // Assert
  // The answers come from the loaded module's own realm: a copy made here compares by value.
  assert.deepEqual(structuredClone(answer), { answer: 'stands' })
})
