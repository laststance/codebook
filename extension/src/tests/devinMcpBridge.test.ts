import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'

import { runDevinMcpBridge, selectDevinDescriptor } from '../devinMcpBridge'
import { startServer } from '../server'
import { currentStorageOwner } from '../utils/currentStorageOwner'

import { createHarness } from './helpers'
import { removeTestFolder } from './utils/removeTestFolder'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

const FAST = { timeoutMs: 300, intervalMs: 20 }
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]

/** Makes an agent folder and workspace folders that are removed when the test ends. */
async function createFolders(context: {
  after: (callback: () => Promise<void>) => void
}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-devin-bridge-')),
  )
  context.after(() => removeTestFolder(root))
  const agentDir = join(root, 'agent'),
    workspace = join(root, 'workspace'),
    otherWorkspace = join(root, 'other')
  await mkdir(agentDir)
  await mkdir(workspace)
  await mkdir(otherWorkspace)
  return { agentDir, workspace, otherWorkspace }
}

/** Writes one descriptor with fake values. */
async function writeDescriptor(
  agentDir: string,
  index: number,
  workspace: string,
  pid: number,
  owner: Record<string, unknown> = {},
): Promise<string> {
  const path = join(agentDir, `${IDS[index]}.connection.json`)
  await writeFile(
    path,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      token: 'fake-test-value',
      instanceId: IDS[index],
      workspace,
      apiVersion: '1.0',
      pid,
      ...owner,
    }),
    { mode: 0o600 },
  )
  return path
}

// Value: protects=the Devin bridge connecting to its own window's instance among several; fails_when=the selection takes the first descriptor instead of the one with this workspace and extension host pid; no_claim=a real MCP connection
test('the bridge selects the descriptor of this workspace and extension host among several', async (context) => {
  // Arrange
  const { agentDir, workspace, otherWorkspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, otherWorkspace, 10)
  await writeDescriptor(agentDir, 1, workspace, 20)
  const expected = await writeDescriptor(agentDir, 2, workspace, 10)
  // Act
  const selection = await selectDevinDescriptor(agentDir, workspace, 10, FAST)
  // Assert
  assert.equal(selection?.descriptorPath, expected)
  assert.equal(selection.instanceId, IDS[2])
  assert.equal(selection.workspace, workspace)
})

// Value: protects=two Devin windows on different folders never sharing a Codebook instance; fails_when=a descriptor of another workspace is selected; no_claim=symlinked workspaces
test('the bridge ignores a descriptor of another workspace', async (context) => {
  // Arrange
  const { agentDir, workspace, otherWorkspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, otherWorkspace, 10)
  // Act
  const selection = await selectDevinDescriptor(agentDir, workspace, 10, FAST)
  // Assert
  assert.equal(selection, undefined)
})

// Value: protects=two windows of one folder keeping their own instances; fails_when=a descriptor of another extension host pid is selected; no_claim=pid reuse
test('the bridge ignores a descriptor of another extension host process', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, 99)
  // Act
  const selection = await selectDevinDescriptor(agentDir, workspace, 10, FAST)
  // Assert
  assert.equal(selection, undefined)
})

// Value: protects=a bridge started before Codebook finishes activating; fails_when=selection gives up at the first look instead of polling; no_claim=the default 15 s limit
test('the bridge finds a descriptor written 600 ms after it started', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  const late = new Promise<string>((resolve) =>
    setTimeout(() => resolve(writeDescriptor(agentDir, 0, workspace, 10)), 600),
  )
  // Act
  const selection = await selectDevinDescriptor(agentDir, workspace, 10, {
    timeoutMs: 3_000,
    intervalMs: 50,
  })
  // Assert
  assert.equal(selection?.descriptorPath, await late)
})

// Value: protects=the fixed recovery message and failing exit of a bridge with no instance; fails_when=the line changes, the exit code stays 0, or more than one line is written; no_claim=the 15 s default wait
test('the bridge reports the recovery line and exit code 1 when no instance matches', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  const lines: string[] = [],
    originalWrite = process.stderr.write.bind(process.stderr),
    originalExitCode = process.exitCode
  process.stderr.write = (chunk: string) => {
    lines.push(chunk)
    return true
  }
  let exitCode: typeof process.exitCode
  try {
    // Act
    await runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: '10' },
      FAST,
    )
    exitCode = process.exitCode
  } finally {
    process.stderr.write = originalWrite
    process.exitCode = originalExitCode
  }
  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(lines, [
    `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.\n`,
  ])
})

// Value: protects=a Devin window never talking to another window's Codebook of the same folder; fails_when=a bridge without WINDSURF_EXT_HOST_PID still connects to the one workspace match instead of refusing; no_claim=the 15 s default wait
test('without a window identity the bridge refuses with that line', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, 10)
  const lines: string[] = [],
    originalWrite = process.stderr.write.bind(process.stderr),
    originalExitCode = process.exitCode
  process.stderr.write = (chunk: string) => {
    lines.push(chunk)
    return true
  }
  let exitCode: typeof process.exitCode
  try {
    // Act
    await runDevinMcpBridge(agentDir, workspace, {}, FAST)
    exitCode = process.exitCode
  } finally {
    process.stderr.write = originalWrite
    process.exitCode = originalExitCode
  }
  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(lines, [
    'Codebook cannot tell which Devin Desktop window started this bridge: WINDSURF_EXT_HOST_PID is not set. Reload the window; if this stays, Devin Desktop changed how it starts MCP servers.\n',
  ])
})

/** The machine and boot of this test's window, as the descriptor of a window of this build records them. */
const MACHINE = {
  hostname: 'workstation',
  machineId: 'machine-a',
  boot: { id: 'boot-1' },
}

// Value: protects=a Devin window connecting to its own fresh instance, not to the descriptor a crashed window left under the same extension host pid; fails_when=the first descriptor of the workspace and pid is taken without asking whether its owner still runs, so the bridge connects to a dead url; why_new=pid reuse after a crash or reboot; seam=the injected machine identity (the stale descriptor names this running process with an earlier start)
test('the bridge skips the descriptor of a crashed window and waits for the fresh one', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    ...MACHINE,
    processStart: startOfKilledWindow(),
  })
  const fresh = new Promise<string>((resolve) =>
    setTimeout(
      () =>
        resolve(writeDescriptor(agentDir, 1, workspace, process.pid, MACHINE)),
      100,
    ),
  )
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    { timeoutMs: 3_000, intervalMs: 20, identity: MACHINE },
  )
  // Assert
  assert.equal(selection?.descriptorPath, await fresh)
  assert.equal(selection.instanceId, IDS[1])
})

// Value: protects=the three launches of one window choosing the same instance; fails_when=several live descriptors of one workspace and pid resolve by the folder's listing order instead of by newest file time; why_new=a known pid used to return the first match; seam=none (file times set with utimes)
test('the bridge resolves two live descriptors of one window to the newest one whatever the creation order', async (context) => {
  // Arrange: two folders with the same two descriptors; the newer file time sits on the first in one folder and on the second in the other.
  const newestIsFirst = await createFolders(context),
    newestIsSecond = await createFolders(context)
  const picked: string[] = []
  for (const [folders, isFirstNewer] of [
    [newestIsFirst, true],
    [newestIsSecond, false],
  ] as const) {
    const { agentDir, workspace } = folders
    const firstPath = await writeDescriptor(
      agentDir,
      0,
      workspace,
      process.pid,
      MACHINE,
    )
    const secondPath = await writeDescriptor(
      agentDir,
      1,
      workspace,
      process.pid,
      MACHINE,
    )
    const newer = new Date(2_000_000),
      older = new Date(1_000_000)
    await utimes(
      firstPath,
      isFirstNewer ? newer : older,
      isFirstNewer ? newer : older,
    )
    await utimes(
      secondPath,
      isFirstNewer ? older : newer,
      isFirstNewer ? older : newer,
    )
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { ...FAST, identity: MACHINE },
    )
    picked.push(selection?.instanceId ?? 'none')
  }
  // Assert
  assert.deepEqual(picked, [IDS[0], IDS[1]])
})

// Value: protects=a Devin window whose first matching descriptor does not answer still reaching its fresh instance within the startup wait; fails_when=the entry exits at the first failed connection instead of dropping that descriptor and polling on; why_new=a stale descriptor that passes the liveness check; seam=a spawned bridge entry, a refused loopback url and a real Codebook endpoint
test('the bridge drops a descriptor whose server refuses and connects to the fresh one written 500 ms later', async (context) => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-devin-bridge-live-')),
    )
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await removeTestFolder(root)
  })
  const owner = await currentStorageOwner()
  const writeLive = (index: number, url: string): Promise<void> =>
    writeFile(
      join(root, `${IDS[index]}.connection.json`),
      JSON.stringify({
        ...endpoint.descriptor,
        url,
        instanceId: IDS[index],
        pid: process.pid,
        ...owner,
      }),
      { mode: 0o600 },
    )
  await writeLive(0, 'http://127.0.0.1:1/mcp')
  const fresh = new Promise<void>((resolve) =>
    setTimeout(() => resolve(writeLive(1, endpoint.descriptor.url)), 500),
  )
  const client = new Client({ name: 'devin-bridge-test', version: '1.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(__dirname, '../devinMcpBridgeEntry.js'), root],
    cwd: harness.directory,
    env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
    stderr: 'pipe',
  })
  try {
    // Act
    await client.connect(transport, { timeout: 10_000 })
    await fresh
    const status = await client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    // Assert
    assert.equal(
      z
        .object({ data: z.object({ instanceId: z.string() }) })
        .parse(status.structuredContent).data.instanceId,
      endpoint.descriptor.instanceId,
    )
  } finally {
    await client.close()
  }
})
