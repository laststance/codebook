import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { DEVIN_DESCRIPTOR_LIMIT_BYTES } from '../constants'
import { checkDevinBridgeReceipts as realCheckDevinBridgeReceipts } from '../utils/checkDevinBridgeReceipts'
import * as realReadDescriptorText from '../utils/readDescriptorText'
import { readReceiptState } from '../utils/readReceiptState'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

const WINDOWS_MODES = 'Windows reports mode 0o666 for every file'

/** Makes a storage folder with an agent folder, removed after the test. */
async function arrangeStorage(context: TestContext): Promise<string> {
  const storage = await mkdtemp(join(tmpdir(), 'receipt-state-'))
  context.after(() => removeTestFolder(storage))
  await mkdir(join(storage, 'agent'))
  await mkdir(join(storage, 'devin-skill'))
  await mkdir(join(storage, 'devin-mcp'))
  return storage
}

/** Writes a private file with the given text. */
async function writePrivate(path: string, text: string): Promise<void> {
  await writeFile(path, text, { mode: 0o600 })
}

/** Writes the three files the bridge's check reads, each standing for the installation `installation-a`. */
async function writeStandingSetup(storage: string): Promise<string> {
  await writePrivate(
    join(storage, 'devin-skill', 'receipt.json'),
    JSON.stringify({ installed: true }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'receipt.json'),
    JSON.stringify({ installed: true, installationId: 'installation-a' }),
  )
  const descriptorPath = join(storage, 'agent', 'x.connection.json')
  await writePrivate(
    descriptorPath,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      instanceId: '11111111-1111-4111-8111-111111111111',
      devinSetupInstallation: 'installation-a',
    }),
  )
  return descriptorPath
}

/**
 * Loads {@link readReceiptState} so that one receipt read fails with the given error code, the way a file shortage or an input error would.
 * @param code - The `code` of the error the bounded read throws.
 */
async function loadWithFailingRead(code: string) {
  const failingRead = () =>
    Promise.reject(Object.assign(new Error('read failed'), { code }))
  return loadModule<{ readReceiptState: typeof readReceiptState }>(
    resolve(__dirname, '../utils/readReceiptState.js'),
    {
      './readPrivateJsonState': await loadModule(
        resolve(__dirname, '../utils/readPrivateJsonState.js'),
        {
          './readDescriptorText': {
            ...realReadDescriptorText,
            readDescriptorText: failingRead,
          },
        },
      ),
    },
  )
}

// protects=a receipt that stands being told from the other states; fails_when=an installed receipt answers removed or its fields are lost; no_claim=the bridge's reconnect behavior
test('a receipt that says installed answers installed with its fields', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    receiptPath,
    JSON.stringify({ installed: true, installationId: 'installation-a' }),
  )
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'installed',
    receipt: { installed: true, installationId: 'installation-a' },
  })
})

// protects=a removal being observed as removed with its reason; fails_when=a missing receipt answers no-answer, so a removed setup is never seen; no_claim=other absences such as ENOTDIR
test('a receipt that is not there answers removed with the reason missing', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, { state: 'removed', reason: 'missing', receiptPath })
})

// protects=a removed skill receipt (installed false) counting as removed; fails_when=it answers installed; no_claim=the MCP receipt
test('a receipt that says installed false answers removed with the reason uninstalled', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-skill', 'receipt.json')
  await writePrivate(receiptPath, JSON.stringify({ installed: false }))
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'uninstalled',
    receiptPath,
  })
})

// protects=an invalid receipt text counting as removed; fails_when=it answers no-answer or throws; no_claim=a JSON value that is an array (same branch)
test('a receipt whose text is no JSON answers removed with the reason unparsable', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(receiptPath, '{ not json')
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'unparsable',
    receiptPath,
  })
})

// protects=an oversized receipt counting as removed by its code; fails_when=the refusal is judged by its message and answers no-answer; no_claim=a file that grows while read
test('a receipt larger than the limit answers removed with the reason oversized', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(receiptPath, 'x'.repeat(DEVIN_DESCRIPTOR_LIMIT_BYTES + 1))
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'oversized',
    receiptPath,
  })
})

// protects=a receipt others can read counting as removed by its code; fails_when=it answers no-answer; no_claim=Windows modes
test(
  'a receipt that others can read answers removed with the reason not-private',
  { skip: process.platform === 'win32' && WINDOWS_MODES },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
    await writePrivate(receiptPath, JSON.stringify({ installed: true }))
    await chmod(receiptPath, 0o644)
    // Act
    const state = await readReceiptState(receiptPath)
    // Assert
    assert.deepEqual(state, {
      state: 'removed',
      reason: 'not-private',
      receiptPath,
    })
  },
)

// protects=a linked receipt counting as removed; fails_when=a link answers no-answer or is followed; no_claim=other non-regular files
test('a receipt that is a link answers removed with the reason not-regular', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const targetPath = join(storage, 'target.json')
  await writePrivate(targetPath, JSON.stringify({ installed: true }))
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  if (!(await createLinkIfAllowed(targetPath, receiptPath)))
    return context.skip(LINK_NOT_ALLOWED)
  // Act
  const state = await readReceiptState(receiptPath)
  // Assert
  assert.deepEqual(state, {
    state: 'removed',
    reason: 'not-regular',
    receiptPath,
  })
})

// protects=a receipt this user may not read counting as removed; fails_when=it answers no-answer; no_claim=running as root (which can read anything; the test then skips)
test(
  'a receipt this user may not read answers removed with the reason permission',
  {
    skip:
      (process.platform === 'win32' && WINDOWS_MODES) ||
      (process.getuid?.() === 0 && 'root reads every file'),
  },
  async (context) => {
    // Arrange
    const storage = await arrangeStorage(context)
    const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
    await writePrivate(receiptPath, JSON.stringify({ installed: true }))
    await chmod(receiptPath, 0o000)
    // Act
    const state = await readReceiptState(receiptPath)
    // Assert
    assert.deepEqual(state, {
      state: 'removed',
      reason: 'permission',
      receiptPath,
    })
  },
)

for (const code of ['EMFILE', 'ENFILE', 'EIO'])
  // protects=a failed read never counting as a removal; fails_when=any read failure other than an observed absence answers removed; no_claim=the bridge's handling of no answer
  test(`a receipt read that fails with ${code} answers no-answer`, async () => {
    // Arrange
    const { readReceiptState: readWithFailure } =
      await loadWithFailingRead(code)
    // Act
    const state = await readWithFailure('/storage/devin-mcp/receipt.json')
    // Assert
    // The module ran in its own realm, so its answer is compared by its JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
      state: 'no-answer',
      receiptPath: '/storage/devin-mcp/receipt.json',
    })
  })

// protects=a replacement race counting as no answer, not as a removal of the setup; fails_when=EREPLACED answers removed; no_claim=the real replacement
test('a receipt read that reports EREPLACED answers no-answer', async () => {
  // Arrange
  const { readReceiptState: readWithFailure } =
    await loadWithFailingRead('EREPLACED')
  // Act
  const state = await readWithFailure('/storage/devin-mcp/receipt.json')
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    state: 'no-answer',
    receiptPath: '/storage/devin-mcp/receipt.json',
  })
})

// protects=Windows EPERM and EACCES (seen while a file is replaced or scanned) counting as no answer, and as permission elsewhere; fails_when=Windows answers removed/permission, or another system answers no-answer; no_claim=real Windows errors
for (const code of ['EPERM', 'EACCES'])
  test(`a receipt read that fails with ${code} answers no-answer on win32 and permission on linux`, async () => {
    // Arrange
    const { readReceiptState: readWithFailure } =
      await loadWithFailingRead(code)
    // Act
    const states = [
      await readWithFailure('/storage/devin-mcp/receipt.json', 'win32'),
      await readWithFailure('/storage/devin-mcp/receipt.json', 'linux'),
    ]
    // Assert
    assert.deepEqual(JSON.parse(JSON.stringify(states)), [
      { state: 'no-answer', receiptPath: '/storage/devin-mcp/receipt.json' },
      {
        state: 'removed',
        reason: 'permission',
        receiptPath: '/storage/devin-mcp/receipt.json',
      },
    ])
  })

// protects=the bridge's check passing for a standing setup; fails_when=the three reads disagree on a setup that stands; no_claim=a removal
test('the bridge check answers stands when the mark and both receipts name one installation', async (context) => {
  // Arrange
  const descriptorPath = await writeStandingSetup(await arrangeStorage(context))
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, { answer: 'stands' })
})

// protects=a removal naming the receipt it was seen on; fails_when=the answer lacks the reason or the path; no_claim=the bridge's line
test('the bridge check answers removed with the skill receipt after a removal took it out', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  const skillPath = join(storage, 'devin-skill', 'receipt.json')
  await writePrivate(skillPath, JSON.stringify({ installed: false }))
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, {
    answer: 'removed',
    reason: 'uninstalled',
    path: skillPath,
  })
})

// protects=an unmarked descriptor (the window's mark taken away) counting as removed; fails_when=it answers stands or no-answer; no_claim=a mark of another installation
test('the bridge check answers removed with no-mark when the descriptor names no installation', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  await writePrivate(
    descriptorPath,
    JSON.stringify({ url: 'http://127.0.0.1:1/mcp' }),
  )
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, {
    answer: 'removed',
    reason: 'no-mark',
    path: descriptorPath,
  })
})

// protects=the MCP receipt of another installation counting as removed; fails_when=it answers stands; no_claim=a bound check
test('the bridge check answers removed with another-installation when the MCP receipt names another installation', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  const mcpPath = join(storage, 'devin-mcp', 'receipt.json')
  await writePrivate(
    mcpPath,
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath)
  // Assert
  assert.deepEqual(answer, {
    answer: 'removed',
    reason: 'another-installation',
    path: mcpPath,
  })
})

// protects=a descriptor re-marked for another installation being told from a removal when the check is bound; fails_when=the bound check answers stands for installation B while the bridge is connected for A; no_claim=the bridge's line
test('the bridge check bound to installation A answers replaced when the descriptor and receipt name B', async (context) => {
  // Arrange
  const storage = await arrangeStorage(context)
  const descriptorPath = await writeStandingSetup(storage)
  await writePrivate(
    descriptorPath,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      instanceId: '11111111-1111-4111-8111-111111111111',
      devinSetupInstallation: 'installation-b',
    }),
  )
  await writePrivate(
    join(storage, 'devin-mcp', 'receipt.json'),
    JSON.stringify({ installed: true, installationId: 'installation-b' }),
  )
  // Act
  const answer = await realCheckDevinBridgeReceipts(descriptorPath, {
    instanceId: '11111111-1111-4111-8111-111111111111',
    url: 'http://127.0.0.1:1/mcp',
    installationId: 'installation-a',
  })
  // Assert
  assert.deepEqual(answer, { answer: 'replaced' })
})

// protects=a failed receipt read never reading as a removed setup in the bridge's check; fails_when=the EMFILE of the MCP receipt read answers removed; no_claim=the skill receipt read (same path)
test('the bridge check answers no-answer when a receipt read fails with EMFILE', async () => {
  // Arrange
  const failingModule = await loadModule<{
    checkDevinBridgeReceipts: typeof realCheckDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: () =>
        Promise.resolve({
          state: 'read',
          value: { devinSetupInstallation: 'installation-a' },
        }),
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string) =>
        Promise.resolve({ state: 'no-answer', receiptPath }),
    },
  })
  // Act
  const answer = await failingModule.checkDevinBridgeReceipts(
    '/storage/agent/x.connection.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), { answer: 'no-answer' })
})

// protects=a removal seen in a receipt still ending the connected bridge when the descriptor read has no answer (EIO); fails_when=the failed descriptor read answers no-answer first, so a removed MCP receipt is masked and the bridge stays up on repeated refusals; no_claim=a descriptor read that fails while both receipts stand (still no-answer)
test('the bridge check answers removed when the descriptor read fails with EIO but the MCP receipt was read as missing', async () => {
  // Arrange
  const mcpPath = join('/storage', 'devin-mcp', 'receipt.json')
  const maskedModule = await loadModule<{
    checkDevinBridgeReceipts: typeof realCheckDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: () => Promise.resolve({ state: 'no-answer' }),
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string) =>
        Promise.resolve(
          receiptPath === mcpPath
            ? { state: 'removed', reason: 'missing', receiptPath }
            : { state: 'installed', receipt: { installed: true } },
        ),
    },
  })
  // Act
  const answer = await maskedModule.checkDevinBridgeReceipts(
    '/storage/agent/x.connection.json',
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), {
    answer: 'removed',
    reason: 'missing',
    path: mcpPath,
  })
})

// protects=a removal seen in one receipt ending the bridge although the other receipt read never settles; fails_when=the check waits for every read, so every refusal times out and the bridge stays up for a removed setup; no_claim=a stalled read when nothing was observed (it stays pending)
test('the bridge check answers removed at once when the skill receipt read never settles and the MCP receipt was read as missing', async () => {
  // Arrange
  const mcpPath = join('/storage', 'devin-mcp', 'receipt.json')
  const stalledModule = await loadModule<{
    checkDevinBridgeReceipts: typeof realCheckDevinBridgeReceipts
  }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
    './readPrivateJsonState': {
      readPrivateJsonState: () =>
        Promise.resolve({
          state: 'read',
          value: { devinSetupInstallation: 'installation-a' },
        }),
    },
    './readReceiptState': {
      readReceiptState: (receiptPath: string) =>
        receiptPath === mcpPath
          ? Promise.resolve({
              state: 'removed',
              reason: 'missing',
              receiptPath,
            })
          : new Promise(() => {}),
    },
  })
  // Act
  const answer = await within(
    stalledModule.checkDevinBridgeReceipts('/storage/agent/x.connection.json'),
    5_000,
  )
  // Assert
  // The module ran in its own realm, so its answer is compared by its JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), {
    answer: 'removed',
    reason: 'missing',
    path: mcpPath,
  })
})
