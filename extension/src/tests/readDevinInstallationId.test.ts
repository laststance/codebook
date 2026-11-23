import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { readDevinInstallationId } from '../utils/readDevinInstallationId'
import type { ReceiptState } from '../utils/readReceiptState'
import { createPathReadGate } from '../utils/shareReceiptRead'

import { loadModule } from './utils/loadModule'
import { within } from './utils/within'

const MCP_INSTALLED: ReceiptState = {
  state: 'installed',
  receipt: { installed: true, installationId: 'installation-a' },
}
/** The receipt a later read finds after setup ran again for another installation, so a caller answered from an earlier read is told apart. */
const MCP_REINSTALLED: ReceiptState = {
  state: 'installed',
  receipt: { installed: true, installationId: 'installation-b' },
}

/**
 * Loads {@link readDevinInstallationId} over an MCP receipt read a test controls, with a read gate of its own: the first read is held until the test releases it (or the test ends) and answers `installation-a`, later reads answer `installation-b`.
 * @param context - The test, whose end releases the held read.
 * @returns The read of a storage root, the release of the held read and how many reads started.
 * @example const { read, releaseFirstRead, starts } = await loadWithHeldFirstRead(context)
 */
async function loadWithHeldFirstRead(context: TestContext): Promise<{
  read: (storageRoot: string) => ReturnType<typeof readDevinInstallationId>
  releaseFirstRead: () => void
  starts: () => number
}> {
  let starts = 0
  let releaseFirstRead = (): void => {}
  const firstRead = new Promise<ReceiptState>((resolveRead) => {
    releaseFirstRead = (): void => resolveRead(MCP_INSTALLED)
  })
  context.after(() => releaseFirstRead())
  const loaded = await loadModule<{
    readDevinInstallationId: typeof readDevinInstallationId
  }>(resolve(__dirname, '../utils/readDevinInstallationId.js'), {
    './readReceiptState': {
      readReceiptState: (): Promise<ReceiptState> => {
        starts += 1
        return starts === 1 ? firstRead : Promise.resolve(MCP_REINSTALLED)
      },
    },
  })
  const reads = createPathReadGate()
  return {
    read: (storageRoot) => loaded.readDevinInstallationId(storageRoot, reads),
    releaseFirstRead: (): void => releaseFirstRead(),
    starts: () => starts,
  }
}

// Value: protects=a setup's installation-id read on a storage whose MCP receipt read is still in flight starts no second read of that file, and still answers from a read that began after it (Cycle 0146 task 1d, the raw read of v2 finding 13; Cycle 0146 review round, CodeRabbit readDevinInstallationId.test.ts:40); fails_when=each call starts its own read of the receipt, so a stalled disk holds one more thread of the file pool per setup, or the later call is answered with the earlier read's installation id; no_claim=real file reads (a stand-in of readReceiptState answers)
test('an installation-id read while another read of the MCP receipt is in flight starts its own read only after that one ended', async (context) => {
  // Arrange
  const { read, releaseFirstRead, starts } =
    await loadWithHeldFirstRead(context)
  const earlier = read('/storage')
  const later = read('/storage')
  // Act
  const laterWhileHeld = await within(later, 100)
  const startsWhileHeld = starts()
  releaseFirstRead()
  const answers = await within(Promise.all([earlier, later]), 2_000)
  // Assert
  assert.equal(laterWhileHeld, 'still waiting')
  assert.equal(startsWhileHeld, 1)
  assert.notEqual(answers, 'still waiting')
  // The answers come from the loaded module's own realm: a copy made here compares by value.
  assert.deepEqual(structuredClone(answers), [
    { installationId: 'installation-a', state: MCP_INSTALLED },
    { installationId: 'installation-b', state: MCP_REINSTALLED },
  ])
  assert.equal(starts(), 2)
})
