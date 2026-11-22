import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { runDevinMcpBridge } from '../devinMcpBridge'
import {
  devinMcpConfigPath,
  refreshManagedDevinMcpEntry,
  removeManagedDevinMcpEntry,
  writeManagedDevinMcpEntry,
  type DevinMcpEntry,
} from '../devinMcpConfig'
import { checkDevinBridgeReceipts } from '../utils/checkDevinBridgeReceipts'
import { currentStorageOwner } from '../utils/currentStorageOwner'

import { removeTestFolder } from './utils/removeTestFolder'

const ENTRY: DevinMcpEntry = {
  command: '/usr/bin/node',
  args: ['/ext/dist/devinMcpBridge.js', '/storage/agent'],
  env: {},
}
const UPDATED_ENTRY: DevinMcpEntry = {
  command: '/opt/node',
  args: ['/ext-2/dist/devinMcpBridge.js', '/storage/agent'],
  env: {},
}
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'

/** Makes a temporary home and storage folder that are removed after the test. */
async function arrange(context: TestContext) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-install-')),
  )
  context.after(() => removeTestFolder(root))
  const home = join(root, 'home'),
    storage = join(root, 'storage')
  await mkdir(home, { recursive: true })
  return { home, storage, configPath: devinMcpConfigPath(home) }
}

/** Reads the `installationId` the MCP receipt of a storage folder holds. */
async function receiptInstallationId(storage: string): Promise<unknown> {
  const receipt: unknown = JSON.parse(
    await readFile(join(storage, 'devin-mcp', 'receipt.json'), 'utf8'),
  )
  return typeof receipt === 'object' && receipt !== null
    ? Reflect.get(receipt, 'installationId')
    : undefined
}

test('the MCP receipt of a first setup carries an installation id that an update and a re-run keep', async (context) => {
  // protects=a setup stays one installation across updates; fails_when=a managed rewrite drops or changes the installation id, so a bridge refuses after every extension update; no_claim=the bridge's check
  // Arrange
  const { home, storage } = await arrange(context)

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const firstId = await receiptInstallationId(storage)
  await writeManagedDevinMcpEntry(storage, UPDATED_ENTRY, home)
  const afterUpdate = await receiptInstallationId(storage)
  await refreshManagedDevinMcpEntry(storage, ENTRY, home)
  const afterRefresh = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.match(String(firstId), UUID_PATTERN)
  assert.equal(afterUpdate, firstId)
  assert.equal(await receiptInstallationId(storage), firstId)
  assert.equal(afterRefresh.status, 'current')
})

test('a setup after a removal gets a new installation id', async (context) => {
  // protects=a bridge that connected for a removed setup cannot be mistaken for the new one; fails_when=the id outlives the receipt; no_claim=the bridge's check
  // Arrange
  const { home, storage } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const removedId = await receiptInstallationId(storage)

  // Act
  await removeManagedDevinMcpEntry(storage, home)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  const newId = await receiptInstallationId(storage)
  assert.match(String(removedId), UUID_PATTERN)
  // A missing id would differ from the old one too, so the new one must be a real id first.
  assert.equal(typeof newId, 'string')
  assert.match(String(newId), UUID_PATTERN)
  assert.notEqual(newId, removedId)
})

test('the activation refresh gives a receipt of an older build an installation id and rewrites only the receipt', async (context) => {
  // protects=a setup of the previous version works after the update; fails_when=the receipt stays without an id or the refresh touches Devin's config; no_claim=a changed entry
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  delete receipt.installationId
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 })
  const configBefore = await readFile(configPath, 'utf8')

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(refreshed.status, 'current')
  assert.match(String(await receiptInstallationId(storage)), UUID_PATTERN)
  assert.equal(await readFile(configPath, 'utf8'), configBefore)
})

/**
 * Writes the two setup receipts and a marked descriptor of one window, then returns the agent folder and the descriptor path.
 * @param storage - The global storage folder.
 * @param receipts - What each receipt says.
 */
async function writeMarkedWindow(
  storage: string,
  receipts: {
    skillInstalled: boolean
    mcp: Record<string, unknown> | undefined
  },
  url: string,
  workspace: string,
): Promise<{ agentDir: string; descriptorPath: string }> {
  const agentDir = join(storage, 'agent')
  await mkdir(agentDir, { recursive: true })
  await mkdir(join(storage, 'devin-skill'), { recursive: true })
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(
    join(storage, 'devin-skill', 'receipt.json'),
    JSON.stringify({ installed: receipts.skillInstalled }),
    { mode: 0o600 },
  )
  if (receipts.mcp)
    await writeFile(
      join(storage, 'devin-mcp', 'receipt.json'),
      JSON.stringify(receipts.mcp),
      { mode: 0o600 },
    )
  const descriptorPath = join(agentDir, `${INSTANCE_ID}.connection.json`)
  await writeFile(
    descriptorPath,
    JSON.stringify({
      url,
      token: 'fake-test-value',
      instanceId: INSTANCE_ID,
      workspace,
      apiVersion: '1.0',
      pid: process.pid,
      ...(await currentStorageOwner()),
      devinChat: true,
      devinSetupInstallation: 'installation-a',
    }),
    { mode: 0o600 },
  )
  return { agentDir, descriptorPath }
}

// Windows reports 0o666 for every file, so the private-file check refuses the descriptor these receipts tests read.
test(
  'the receipts check passes for the installation of the descriptor, also after an update changed the generation',
  { skip: process.platform === 'win32' },
  async (context) => {
    // protects=another window's refresh after an update does not cut this window's bridge; fails_when=the check compares the per-write generation instead of the installation id; no_claim=a removal after the check
    // Arrange
    const { storage } = await arrange(context)
    const { descriptorPath } = await writeMarkedWindow(
      storage,
      {
        skillInstalled: true,
        mcp: {
          installed: true,
          installationId: 'installation-a',
          generation: 'generation-after-update',
        },
      },
      'http://127.0.0.1:1/mcp',
      storage,
    )

    // Act
    const answer = await checkDevinBridgeReceipts(descriptorPath)

    // Assert
    assert.deepEqual(answer, { answer: 'stands' })
  },
)

/** Starts a loopback listener that counts every request it gets; closed when the test ends. */
async function countingListener(context: TestContext) {
  const counter = { requests: 0 }
  const server: Server = createServer((_request, response) => {
    counter.requests += 1
    response.writeHead(500)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { counter, port: (server.address() as AddressInfo).port }
}

const REFUSED_SETUPS: Array<{
  name: string
  skillInstalled: boolean
  mcp: Record<string, unknown> | undefined
}> = [
  {
    name: 'another window removed the whole setup',
    skillInstalled: false,
    mcp: undefined,
  },
  {
    name: 'a removal took the skill out but failed on the entry, so the MCP receipt survived',
    skillInstalled: false,
    mcp: { installed: true, installationId: 'installation-a' },
  },
  {
    name: 'a removal and a new setup replaced the installation the descriptor was marked for',
    skillInstalled: true,
    mcp: { installed: true, installationId: 'installation-b' },
  },
]

for (const { name, skillInstalled, mcp } of REFUSED_SETUPS)
  test(
    `the bridge opens no session when ${name}`,
    { skip: process.platform === 'win32' },
    async (context) => {
      // protects=a bridge never connects for a descriptor whose setup was removed after the window marked it (Cycle 0144 task 1); fails_when=the bridge connects on the descriptor's mark alone, so its first request reaches the server; no_claim=a removal after the bridge's last check
      // Arrange
      const { storage } = await arrange(context)
      const { counter, port } = await countingListener(context)
      const { agentDir } = await writeMarkedWindow(
        storage,
        { skillInstalled, mcp },
        `http://127.0.0.1:${port}/mcp`,
        storage,
      )
      // Act
      const refusal = await runDevinMcpBridge(
        agentDir,
        storage,
        { WINDSURF_EXT_HOST_PID: String(process.pid) },
        { timeoutMs: 2_000, intervalMs: 20 },
      )

      // Assert
      assert.equal(counter.requests, 0)
      assert.equal(
        refusal,
        `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${storage}. Run Codebook: Set Up AI Chat here, then reload the window.`,
      )
      assert.equal(dirname(agentDir), storage)
    },
  )
