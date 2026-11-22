import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { runDevinMcpBridge, selectDevinDescriptor } from '../devinMcpBridge'

import { removeTestFolder } from './utils/removeTestFolder'

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
    await runDevinMcpBridge(agentDir, workspace, {}, FAST)
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

// Value: protects=windows of one folder without a known extension host pid from mixing; fails_when=two workspace matches pick one; no_claim=the single-match case
test('the bridge without an extension host pid refuses two matching workspaces', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, 10)
  await writeDescriptor(agentDir, 1, workspace, 20)
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    undefined,
    FAST,
  )
  // Assert
  assert.equal(selection, undefined)
})
