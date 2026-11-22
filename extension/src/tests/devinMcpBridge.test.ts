import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import {
  createServer as createNetServer,
  type AddressInfo,
  type Server as NetServer,
} from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'

import { SESSION_IDLE_TIMEOUT_MS } from '../constants'
import { runCursorMcpBridge } from '../cursorMcpBridge'
import type * as DevinMcpBridgeModule from '../devinMcpBridge'
import {
  createDevinSelectState,
  devinDescriptorExpectation,
  runDevinMcpBridge,
  selectDevinDescriptor,
} from '../devinMcpBridge'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import { createHarness } from './helpers'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

const FAST = { timeoutMs: 300, intervalMs: 20 }
/** The installation id of the receipts {@link writeSetupReceipts} writes and of the default descriptor. */
const INSTALLATION_ID = '99999999-9999-4999-8999-999999999999'
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]

/** The instance id of descriptor `index`: one of {@link IDS}, or a numbered id for the tests that need many. */
function instanceIdOf(index: number): string {
  return (
    IDS[index] ??
    `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, 'a')}`
  )
}

/**
 * Writes the two receipts a Devin Desktop setup leaves in the global storage folder (the parent of the agent folder): the skill's and the MCP entry's, which carries the installation id.
 * @param storageRoot - The global storage folder.
 * @param overrides - Fields that replace those of the MCP receipt; `installed: false` makes a removed one.
 */
async function writeSetupReceipts(
  storageRoot: string,
  overrides: Record<string, unknown> = {},
  skillInstalled = true,
): Promise<void> {
  await mkdir(join(storageRoot, 'devin-skill'), { recursive: true })
  await mkdir(join(storageRoot, 'devin-mcp'), { recursive: true })
  await writeFile(
    join(storageRoot, 'devin-skill', 'receipt.json'),
    JSON.stringify({ installed: skillInstalled }),
    { mode: 0o600 },
  )
  await writeFile(
    join(storageRoot, 'devin-mcp', 'receipt.json'),
    JSON.stringify({
      installed: true,
      installationId: INSTALLATION_ID,
      ...overrides,
    }),
    { mode: 0o600 },
  )
}

/** Makes an agent folder inside a storage folder that holds the setup receipts; the caller removes the storage folder, the parent of the agent folder. */
async function makeLiveAgentFolder(): Promise<string> {
  const storage = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-devin-bridge-live-')),
  )
  const agentDir = join(storage, 'agent')
  await mkdir(agentDir)
  await writeSetupReceipts(storage)
  return agentDir
}

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
  await writeSetupReceipts(root)
  await mkdir(workspace)
  await mkdir(otherWorkspace)
  return { agentDir, workspace, otherWorkspace }
}

/**
 * Writes one descriptor with fake values that names this machine as its owner; `overrides` replace any field.
 * The default descriptor is the one a Devin Desktop window with AI chat set up writes: a loopback url and `devinChat: true`.
 */
async function writeDescriptor(
  agentDir: string,
  index: number,
  workspace: string,
  pid: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const path = join(agentDir, `${instanceIdOf(index)}.connection.json`)
  await writeFile(
    path,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      token: 'fake-test-value',
      instanceId: instanceIdOf(index),
      workspace,
      apiVersion: '1.0',
      pid,
      ...(await currentStorageOwner()),
      devinChat: true,
      devinSetupInstallation: INSTALLATION_ID,
      ...overrides,
    }),
    { mode: 0o600 },
  )
  return path
}

/**
 * Runs the bridge in this process and returns the stderr lines the bridge entry would show and the exit code it would end with.
 * The bridge returns its refusal line instead of writing it, so the line is added to what the bridge itself wrote (the connected line), and the exit code is 1 exactly when the bridge refused.
 */
async function runCapturingStderr(
  agentDir: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number; intervalMs?: number },
) {
  const lines: string[] = [],
    originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk: string) => {
    lines.push(chunk)
    return true
  }
  let refusal: string | undefined
  try {
    refusal = await runDevinMcpBridge(agentDir, workspace, env, options)
  } finally {
    process.stderr.write = originalWrite
  }
  if (refusal !== undefined) lines.push(`${refusal}\n`)
  const exitCode: number | undefined = refusal === undefined ? undefined : 1
  return { lines, exitCode }
}

/** Starts a loopback HTTP server that is closed, with its open connections, when the test ends. */
async function listen(
  context: { after: (callback: () => Promise<void>) => void },
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { server, port: (server.address() as AddressInfo).port }
}

/** Forwards one request to the loopback port of a real Codebook endpoint. */
function forward(
  port: number,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): void {
  const upstream = request(
    {
      host: '127.0.0.1',
      port,
      path: incoming.url,
      method: incoming.method,
      // The real endpoint answers only its own host name.
      headers: { ...incoming.headers, host: `127.0.0.1:${port}` },
    },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(outgoing)
    },
  )
  incoming.pipe(upstream)
}

/** Starts the bridge entry as Devin Desktop does and connects an MCP client to it. */
async function connectThroughBridge(
  root: string,
  cwd: string,
  context: { after: (callback: () => Promise<void>) => void },
  launch: { nodeArgs?: string[]; env?: Record<string, string> } = {},
): Promise<Client> {
  const client = new Client({ name: 'devin-bridge-test', version: '1.0' })
  context.after(() => client.close())
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      ...(launch.nodeArgs ?? []),
      join(__dirname, '../devinMcpBridgeEntry.js'),
      root,
    ],
    cwd,
    env: { WINDSURF_EXT_HOST_PID: String(process.pid), ...launch.env },
    stderr: 'pipe',
  })
  await client.connect(transport, { timeout: 10_000 })
  return client
}

/**
 * Watches a started bridge process for its connected line; used by the tests that spawn the bridge entry.
 * @param child - The bridge process, started with a piped stderr.
 * @returns `connected` resolves once the connected line was printed and rejects, with the stderr read to its end, when the process fails to start or ends first; `readStderr` returns what stderr held so far.
 */
function watchConnectedLine(child: ChildProcess): {
  connected: Promise<void>
  readStderr: () => string
} {
  let stderr = ''
  const connected = new Promise<void>((done, fail) => {
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.includes('Codebook bridge: instance')) done()
    })
    child.once('error', (error) => fail(error))
    // close, not exit: stderr was read to its end by then.
    child.once('close', (code) =>
      fail(
        new Error(
          `The bridge ended with code ${code} before its connected line. stderr: ${stderr}`,
        ),
      ),
    )
  })
  return { connected, readStderr: () => stderr }
}

/** Reads the instance id the connected Codebook answers in its status. */
async function statusInstanceId(client: Client): Promise<string> {
  const status = await client.callTool({
    name: 'codebook_status',
    arguments: {},
  })
  return z
    .object({ data: z.object({ instanceId: z.string() }) })
    .parse(status.structuredContent).data.instanceId
}

// Value: protects=the Devin bridge connecting to its own window's instance among several; fails_when=the selection takes the first descriptor instead of the one with this workspace and extension host pid; no_claim=a real MCP connection
test('the bridge selects the descriptor of this workspace and extension host among several', async (context) => {
  // Arrange
  const { agentDir, workspace, otherWorkspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, otherWorkspace, process.pid)
  await writeDescriptor(agentDir, 1, workspace, process.pid + 1)
  const expected = await writeDescriptor(agentDir, 2, workspace, process.pid)
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  // Assert
  assert.equal(selection?.descriptorPath, expected)
  assert.equal(selection.instanceId, IDS[2])
  assert.equal(selection.workspace, workspace)
})

// Value: protects=two Devin windows on different folders never sharing a Codebook instance; fails_when=a descriptor of another workspace is selected; no_claim=symlinked workspaces
test('the bridge ignores a descriptor of another workspace', async (context) => {
  // Arrange
  const { agentDir, workspace, otherWorkspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, otherWorkspace, process.pid)
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  // Assert
  assert.equal(selection, undefined)
})

// Value: protects=two windows of one folder keeping their own instances; fails_when=a descriptor of another extension host pid is selected; no_claim=pid reuse
test('the bridge ignores a descriptor of another extension host process', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, process.pid + 1)
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  // Assert
  assert.equal(selection, undefined)
})

// protects: this window's connection when another window's stale descriptor points at a mount that never answers / fails_when: selection resolves every descriptor's workspace before judging its pid, so the hanging lookup stalls past the deadline / no_claim: a real MCP connection
test(
  'a stale descriptor of another window on a hanging mount does not stall this window selection',
  { timeout: 10_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace, otherWorkspace } = await createFolders(context)
    const ownPath = await writeDescriptor(agentDir, 0, workspace, process.pid)
    await writeDescriptor(agentDir, 1, otherWorkspace, process.pid + 1)
    const resolvedPaths: string[] = []
    const resolveWorkspace = (path: string): Promise<string> => {
      resolvedPaths.push(path)
      // The other window's mount never answers.
      if (path === otherWorkspace) return new Promise<string>(() => undefined)
      return Promise.resolve(path)
    }
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { ...FAST, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, ownPath)
    assert.deepEqual(resolvedPaths, [workspace, workspace])
  },
)

// protects: the startup deadline of selection against a same-window descriptor whose workspace never answers / fails_when: the lookup is not bounded by the remaining budget, so the newer hanging descriptor blocks the healthy one / no_claim: which descriptor wins when both answer
test(
  'a same-window descriptor whose workspace never answers is skipped for the healthy one',
  { timeout: 10_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace, otherWorkspace } = await createFolders(context)
    await writeDescriptor(agentDir, 1, otherWorkspace, process.pid)
    const healthyPath = await writeDescriptor(
      agentDir,
      0,
      workspace,
      process.pid,
    )
    const resolveWorkspace = (path: string): Promise<string> =>
      path === otherWorkspace
        ? new Promise<string>(() => undefined)
        : Promise.resolve(path)
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 600, intervalMs: 20, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, healthyPath)
  },
)

// Value: protects=a bridge started before Codebook finishes activating; fails_when=selection gives up at the first look instead of polling; no_claim=the default 15 s limit
test('the bridge finds a descriptor written 600 ms after it started', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  const late = new Promise<string>((resolve) =>
    setTimeout(
      () => resolve(writeDescriptor(agentDir, 0, workspace, process.pid)),
      600,
    ),
  )
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    { timeoutMs: 3_000, intervalMs: 50 },
  )
  // Assert
  assert.equal(selection?.descriptorPath, await late)
})

// Value: protects=the fixed recovery message and failing exit of a bridge with no instance; fails_when=the line changes, the exit code stays 0, or more than one line is written; no_claim=the 15 s default wait
test('the bridge reports the recovery line and exit code 1 when no instance matches', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  // Act
  const { lines, exitCode } = await runCapturingStderr(
    agentDir,
    workspace,
    { WINDSURF_EXT_HOST_PID: '10' },
    FAST,
  )
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
  await writeDescriptor(agentDir, 0, workspace, process.pid)
  // Act
  const { lines, exitCode } = await runCapturingStderr(
    agentDir,
    workspace,
    {},
    FAST,
  )
  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(lines, [
    'Codebook cannot tell which Devin Desktop window started this bridge: WINDSURF_EXT_HOST_PID is not set. Reload the window; if this stays, Devin Desktop changed how it starts MCP servers.\n',
  ])
})

// Value: protects=a Devin window connecting to its own fresh instance, not to the descriptor a crashed window left under the same extension host pid; fails_when=the first descriptor of the workspace and pid is taken without asking whether its owner still runs, so the bridge connects to a dead url; why_new=pid reuse after a crash or reboot; seam=this machine's identity (the stale descriptor names this running process with an earlier start)
test('the bridge skips the descriptor of a crashed window and waits for the fresh one', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    processStart: startOfKilledWindow(),
  })
  const fresh = new Promise<string>((resolve) =>
    setTimeout(
      () => resolve(writeDescriptor(agentDir, 1, workspace, process.pid)),
      100,
    ),
  )
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    { timeoutMs: 3_000, intervalMs: 20 },
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
    const firstPath = await writeDescriptor(agentDir, 0, workspace, process.pid)
    const secondPath = await writeDescriptor(
      agentDir,
      1,
      workspace,
      process.pid,
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
      FAST,
    )
    picked.push(selection?.instanceId ?? 'none')
  }
  // Assert
  assert.deepEqual(picked, [IDS[0], IDS[1]])
})

/** Builds the url a descriptor names from its parts, so each test names the one part that differs. */
function descriptorUrl(scheme: string, host: string, path: string): string {
  return `${scheme}://${host}:4100${path}`
}

for (const url of [
  descriptorUrl('http', 'example.com', '/mcp'),
  descriptorUrl('https', '127.0.0.1', '/mcp'),
  descriptorUrl('http', '127.0.0.1', '/other'),
  descriptorUrl('http', 'user@127.0.0.1', '/mcp'),
  descriptorUrl('http', 'localhost.example.com', '/mcp'),
]) {
  // Value: protects=the descriptor's bearer token staying on this machine's Codebook endpoint; fails_when=a descriptor whose url is not http on a loopback host with the path /mcp is selected, so the bridge would send its token to that url; why_new=a planted or edited descriptor in a shared agent folder; seam=none
  test(`the bridge never selects a descriptor whose url is ${url}`, async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid, { url })
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    // Assert
    assert.equal(selection, undefined)
  })
}

for (const url of [
  descriptorUrl('http', 'localhost', '/mcp'),
  descriptorUrl('http', '[::1]', '/mcp'),
]) {
  // Value: protects=a Devin window whose Codebook listens on another loopback spelling still connecting; fails_when=the loopback check accepts 127.0.0.1 only; why_new=B1's loopback allowlist; seam=none
  test(`the bridge selects a descriptor whose url is ${url}`, async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const expected = await writeDescriptor(
      agentDir,
      0,
      workspace,
      process.pid,
      { url },
    )
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    // Assert
    assert.equal(selection?.descriptorPath, expected)
  })
}

// Value: protects=the descriptor's bearer token never reaching a listener a descriptor of this window names outside Codebook's /mcp path; fails_when=the bridge connects to that url; why_new=B1 end to end through the running bridge; seam=a loopback listener that counts requests
test('the bridge sends nothing to a loopback listener whose path is not /mcp', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  let requests = 0
  const { port } = await listen(context, (_request, response) => {
    requests += 1
    response.end()
  })
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    url: `http://127.0.0.1:${port}/other`,
  })
  // Act
  const { exitCode } = await runCapturingStderr(
    agentDir,
    workspace,
    { WINDSURF_EXT_HOST_PID: String(process.pid) },
    FAST,
  )
  // Assert
  assert.equal(exitCode, 1)
  assert.equal(requests, 0)
})

// Value: protects=the descriptor's bearer token never reaching a url a descriptor was swapped to after the bridge selected it; fails_when=the transport reopens the selected path and connects to whatever url it holds then; why_new=Codex P1 time-of-check gap between selection and connect (Cycle 0143 B1); seam=selectDevinDescriptor, a rewrite of the file, then runCursorMcpBridge on the selected path against a loopback listener that counts requests
// Windows reports 0o666 for every file, so the private-file check refuses before the url check this test reaches.
test(
  'a descriptor swapped to another url after its selection never receives the token',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    let requests = 0
    const { port } = await listen(context, (_request, response) => {
      requests += 1
      response.end()
    })
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    assert.ok(selection)
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${port}/other`,
    })
    // Act
    const outcome = runCursorMcpBridge(selection.descriptorPath, 2_000)
    // Assert
    await assert.rejects(outcome, /not a loopback endpoint/)
    assert.equal(requests, 0)
  },
)

for (const [change, overrides] of [
  ['loses devinChat', { devinChat: undefined }],
  ['names another instance', { instanceId: IDS[2] }],
  ['names another extension host process', { pid: process.pid + 1 }],
  [
    'is marked for another installation',
    { devinSetupInstallation: 'another-installation' },
  ],
] as const) {
  // Value: protects=a Devin window connecting only with the descriptor its selection validated; fails_when=the connection reads the path again and accepts whatever descriptor it holds then, so a removed AI chat setup or another instance's descriptor receives the token and requests; why_new=time-of-check gap between selection and connect (Cycle 0143 /ship pass 2 E1); seam=selectDevinDescriptor, a rewrite of the file, then runCursorMcpBridge with the selection's expectation against a loopback listener that counts requests
  // Windows reports 0o666 for every file, so the private-file check refuses before the expectation check this test reaches.
  test(
    `a descriptor that ${change} after its selection never receives a request`,
    { skip: process.platform === 'win32' },
    async (context) => {
      // Arrange
      const { agentDir, workspace } = await createFolders(context)
      let requests = 0
      const { port } = await listen(context, (_request, response) => {
        requests += 1
        response.end()
      })
      const url = `http://127.0.0.1:${port}/mcp`
      await writeDescriptor(agentDir, 0, workspace, process.pid, { url })
      const selection = await selectDevinDescriptor(
        agentDir,
        workspace,
        process.pid,
        FAST,
      )
      assert.ok(selection)
      await writeDescriptor(agentDir, 0, workspace, process.pid, {
        url,
        ...overrides,
      })
      // Act
      const outcome = runCursorMcpBridge(
        selection.descriptorPath,
        2_000,
        devinDescriptorExpectation(selection, process.pid, workspace),
      )
      // Assert
      await assert.rejects(outcome, /changed after it was selected/)
      assert.equal(requests, 0)
    },
  )
}

// Value: protects=the Devin bridge naming exactly what its selection matched to the shared connection; fails_when=the expectation drops the instance id, the extension host pid, the workspace real path or devinChat, so a descriptor of another window passes the second read; why_new=the expectation is the only link between selection and connection (Cycle 0143 /ship pass 2 E1); seam=none
test('the expectation of a selection names its instance, pid, workspace and devinChat', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 1, workspace, process.pid)
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  assert.ok(selection)
  // Act
  const expectation = devinDescriptorExpectation(selection, 4242, workspace)
  // Assert
  assert.deepEqual(expectation, {
    instanceId: IDS[1],
    pid: 4242,
    workspace,
    devinChat: true,
    devinSetupInstallation: '99999999-9999-4999-8999-999999999999',
    url: 'http://127.0.0.1:1/mcp',
  })
})

// Value: protects=the descriptor scan never blocking Devin's launch on a named pipe an agent folder can hold; fails_when=the descriptor is opened for reading without checking it is a regular file, so the scan waits for a writer forever; why_new=B2 hostile file in a shared agent folder; seam=a real FIFO made with mkfifo
test(
  'a named pipe in the agent folder does not block the scan',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await promisify(execFile)('mkfifo', [
      join(agentDir, `${IDS[0]}.connection.json`),
    ])
    const expected = await writeDescriptor(agentDir, 1, workspace, process.pid)
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    // Assert
    assert.equal(selection?.descriptorPath, expected)
  },
)

// Value: protects=the bridge never reading a descriptor through a link; fails_when=a link named like a descriptor is followed to a file elsewhere; why_new=B2 link planted in a shared agent folder; seam=a real symlink
test(
  'a link named like a descriptor is skipped',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const target = await writeDescriptor(agentDir, 0, workspace, process.pid)
    const linkDir = join(agentDir, '..', 'linked')
    await mkdir(linkDir)
    await symlink(target, join(linkDir, `${IDS[1]}.connection.json`))
    // Act
    const selection = await selectDevinDescriptor(
      linkDir,
      workspace,
      process.pid,
      FAST,
    )
    // Assert
    assert.equal(selection, undefined)
  },
)

// Value: protects=the descriptor scan reading only a few hundred bytes per file; fails_when=a descriptor larger than 65536 bytes is parsed; why_new=B2 size cap before parsing; seam=a valid descriptor padded with an extra field
test('a descriptor larger than the size cap is skipped', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    padding: 'x'.repeat(70_000),
  })
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  // Assert
  assert.equal(selection, undefined)
})

// Value: protects=a shared home folder never leading the bridge to another computer's Codebook; fails_when=a descriptor naming another machine as its owner is selected; why_new=B3 foreign owner; seam=a descriptor with another host name and boot
test('the bridge skips a descriptor whose owner is another machine', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    hostname: 'another-workstation',
    machineId: undefined,
    machineKey: undefined,
    hostKey: undefined,
    boot: { id: 'another-boot' },
    processStart: undefined,
  })
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  // Assert
  assert.equal(selection, undefined)
})

// Value: protects=a descriptor that names no machine never being taken for this machine's; fails_when=a descriptor without any owner field is selected; why_new=B3 unknown owner; seam=a descriptor of a build that records the process id alone
test('the bridge skips a descriptor that names no machine', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    hostname: undefined,
    machineId: undefined,
    machineKey: undefined,
    hostKey: undefined,
    boot: undefined,
    processStart: undefined,
  })
  // Act
  const selection = await selectDevinDescriptor(
    agentDir,
    workspace,
    process.pid,
    FAST,
  )
  // Assert
  assert.equal(selection, undefined)
})

// Value: protects=the startup deadline of a bridge whose server accepts a connection and never answers; fails_when=the first connection waits for the SDK's 60 s request timeout instead of the remaining startup budget; why_new=B4 unbounded connect; seam=a loopback listener that never answers
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'the bridge gives up on a server that never answers within its startup deadline',
  { skip: process.platform === 'win32', timeout: 15_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    let initializeRequests = 0
    const { port } = await listen(context, (incoming) => {
      if (incoming.method === 'POST') initializeRequests += 1
      // The request is held open on purpose.
    })
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${port}/mcp`,
    })
    // Act
    const { exitCode } = await runCapturingStderr(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 1_500, intervalMs: 20 },
    )
    // Assert
    // The server was reached, so exit code 1 is the deadline and not a refusal before any request.
    assert.equal(initializeRequests >= 1, true)
    assert.equal(exitCode, 1)
  },
)

// Value: protects=a Devin window reaching Codebook while the server's sessions are full for a moment (three bridges start at window load); fails_when=an HTTP 429 drops the descriptor instead of asking the same one again; why_new=B5 transient 429; seam=a loopback proxy that answers 429 twice, then forwards to a real Codebook endpoint
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'the bridge asks again after an HTTP 429 and connects',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      root = await makeLiveAgentFolder()
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(dirname(root))
    })
    const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
    let answers = 0
    const { port } = await listen(context, (incoming, outgoing) => {
      answers += 1
      if (answers <= 2) {
        outgoing.writeHead(429)
        outgoing.end()
      } else forward(upstreamPort, incoming, outgoing)
    })
    await writeDescriptor(root, 0, harness.directory, process.pid, {
      ...endpoint.descriptor,
      url: `http://127.0.0.1:${port}/mcp`,
      instanceId: IDS[0],
    })
    // Act
    const client = await connectThroughBridge(root, harness.directory, context)
    // Assert
    assert.equal(await statusInstanceId(client), endpoint.descriptor.instanceId)
  },
)

// Value: protects=the Devin bridge marking every request it sends, so the server can refuse them once the window's mark is off (Cycle 0144 task 4); fails_when=a request reaches the server without x-codebook-bridge: devin; no_claim=the server's refusal (serverDevinBridgeGate.test.ts)
test(
  'the Devin bridge sends the x-codebook-bridge header on every request',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      root = await makeLiveAgentFolder()
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(dirname(root))
    })
    const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
    const markers: Array<string | string[] | undefined> = []
    const { port } = await listen(context, (incoming, outgoing) => {
      markers.push(incoming.headers['x-codebook-bridge'])
      forward(upstreamPort, incoming, outgoing)
    })
    await writeDescriptor(root, 0, harness.directory, process.pid, {
      ...endpoint.descriptor,
      url: `http://127.0.0.1:${port}/mcp`,
      instanceId: IDS[0],
    })
    // Act
    const client = await connectThroughBridge(root, harness.directory, context)
    await statusInstanceId(client)
    // Assert
    assert.equal(markers.length > 1, true)
    assert.deepEqual([...new Set(markers)], ['devin'])
  },
)

// Value: protects=a Devin window whose Codebook server is restarting when the bridge starts; fails_when=a reset or refused connection drops the descriptor so the bridge exits before the server listens again; why_new=B5 transient refusal, made deterministic (Cycle 0143 /ship pass 2 E6); seam=a listener that resets each connection and counts the resets, replaced by a proxy to a real Codebook endpoint on the same port once the first reset was observed
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'the bridge keeps asking a refusing server until it listens again',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      root = await makeLiveAgentFolder()
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(dirname(root))
    })
    const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
    const server = createServer((incoming, outgoing) =>
      forward(upstreamPort, incoming, outgoing),
    )
    context.after(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    )
    // The port is held by a listener that resets every connection; the first observed reset swaps the forwarding server in.
    let resets = 0,
      listening: Promise<void> = Promise.resolve()
    const resetter: NetServer = createNetServer((socket) => {
      // The reset follows the first bytes of the request: a reset straight after accept makes Node's socket setup throw in the bridge process.
      socket.once('data', () => {
        resets += 1
        socket.resetAndDestroy()
        if (resets === 1)
          listening = new Promise<void>((resolve) =>
            resetter.close(() => server.listen(port, '127.0.0.1', resolve)),
          )
      })
    })
    await new Promise<void>((resolve) =>
      resetter.listen(0, '127.0.0.1', resolve),
    )
    context.after(
      () => new Promise<void>((resolve) => resetter.close(() => resolve())),
    )
    const port = (resetter.address() as AddressInfo).port
    await writeDescriptor(root, 0, harness.directory, process.pid, {
      ...endpoint.descriptor,
      url: `http://127.0.0.1:${port}/mcp`,
      instanceId: IDS[0],
    })
    // Act
    const client = await connectThroughBridge(root, harness.directory, context)
    await listening
    // Assert
    assert.equal(await statusInstanceId(client), endpoint.descriptor.instanceId)
    assert.ok(resets >= 1)
  },
)

// Value: protects=a Devin window with two live descriptors of one workspace and pid connecting to the newest at once, with a connection budget that does not shrink to nothing; fails_when=selection waits out the whole selection window for a single descriptor, or the attempt after it gets the 1 ms left of the budget, so a server needing a few hundred milliseconds is never reached; why_new=newest-at-once and the connection floor (Cycle 0143 /ship pass 2 E4); seam=a spawned bridge entry, an older descriptor naming a dead port, a newer one naming a proxy that delays every answer by 400 ms
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'the bridge connects to the newest of two live descriptors through a server that answers slowly',
  { timeout: 30_000, skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      root = await makeLiveAgentFolder()
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(dirname(root))
    })
    const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
    const { port } = await listen(context, (incoming, outgoing) => {
      setTimeout(() => forward(upstreamPort, incoming, outgoing), 400)
    })
    const writeLive = (index: number, url: string): Promise<string> =>
      writeDescriptor(root, index, harness.directory, process.pid, {
        ...endpoint.descriptor,
        url,
        instanceId: IDS[index],
      })
    const olderPath = await writeLive(0, 'http://127.0.0.1:1/mcp')
    const newerPath = await writeLive(1, `http://127.0.0.1:${port}/mcp`)
    await utimes(olderPath, new Date(1_000_000), new Date(1_000_000))
    await utimes(newerPath, new Date(2_000_000), new Date(2_000_000))
    // Act
    const client = await connectThroughBridge(root, harness.directory, context)
    // Assert
    assert.equal(await statusInstanceId(client), endpoint.descriptor.instanceId)
  },
)

// Value: protects=a Devin window without a matching AI chat setup being told so at once; fails_when=a descriptor of this workspace and pid without devinChat true is connected to, or the bridge waits out its deadline, or writes another line; why_new=B6 the descriptor's devinChat field; seam=a loopback listener that counts requests
test('the bridge refuses with the setup line when the descriptor lacks devinChat', async (context) => {
  // Arrange
  const { agentDir, workspace } = await createFolders(context)
  let requests = 0
  const { port } = await listen(context, (_request, response) => {
    requests += 1
    response.end()
  })
  await writeDescriptor(agentDir, 0, workspace, process.pid, {
    url: `http://127.0.0.1:${port}/mcp`,
    devinChat: undefined,
  })
  // Act
  const { lines, exitCode } = await runCapturingStderr(
    agentDir,
    workspace,
    { WINDSURF_EXT_HOST_PID: String(process.pid) },
    { timeoutMs: 5_000, intervalMs: 20 },
  )
  // Assert
  assert.equal(exitCode, 1)
  assert.deepEqual(lines, [
    `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${workspace}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
  ])
  assert.equal(requests, 0)
})

// Value: protects=a Devin window whose first matching descriptor fails with a server error still reaching its fresh instance within the startup wait; fails_when=the entry exits at the first failed connection instead of dropping that descriptor and polling on; why_new=a stale descriptor that passes the liveness check; seam=a spawned bridge entry, a loopback listener answering 500 whose first request publishes the fresh descriptor, and a real Codebook endpoint
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'the bridge drops a descriptor whose server fails and connects to the fresh one published after its first attempt',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      root = await makeLiveAgentFolder()
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(dirname(root))
    })
    const writeLive = (index: number, url: string): Promise<string> =>
      writeDescriptor(root, index, harness.directory, process.pid, {
        ...endpoint.descriptor,
        url,
        instanceId: IDS[index],
      })
    // The failing instance publishes the fresh one when the bridge first asks it, so the order never depends on a delay.
    const { port } = await listen(context, (_request, response) => {
      response.writeHead(500)
      response.end()
      void writeLive(1, endpoint.descriptor.url)
    })
    await writeLive(0, `http://127.0.0.1:${port}/mcp`)
    // Act
    const client = await connectThroughBridge(root, harness.directory, context)
    // Assert
    assert.equal(await statusInstanceId(client), endpoint.descriptor.instanceId)
  },
)

// Value: protects=the bearer token never reaching another local service when the descriptor's port is rewritten after the selection; fails_when=the connection compares only instance, pid, workspace and devinChat, so a descriptor naming a different loopback port receives the token; why_new=Cycle 0143 /ship cycle 3 H1 exact endpoint url; seam=selectDevinDescriptor, a rewrite of the url's port, then runCursorMcpBridge with the selection's expectation against two loopback listeners that count requests
// Windows reports 0o666 for every file, so the private-file check refuses before the expectation check this test reaches.
test(
  'a descriptor whose port is rewritten after its selection never sends a request to either port',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const requestsByPort = new Map<number, number>()
    const listenCounting = async (): Promise<number> => {
      const { port } = await listen(context, (incoming, response) => {
        const localPort = incoming.socket.localPort ?? 0
        requestsByPort.set(localPort, (requestsByPort.get(localPort) ?? 0) + 1)
        response.end()
      })
      return port
    }
    const selectedPort = await listenCounting()
    const rewrittenPort = await listenCounting()
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${selectedPort}/mcp`,
    })
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    assert.ok(selection)
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${rewrittenPort}/mcp`,
    })
    // Act
    const outcome = runCursorMcpBridge(
      selection.descriptorPath,
      2_000,
      devinDescriptorExpectation(selection, process.pid, workspace),
    )
    // Assert
    await assert.rejects(outcome, /changed after it was selected/)
    assert.equal(requestsByPort.get(selectedPort) ?? 0, 0)
    assert.equal(requestsByPort.get(rewrittenPort) ?? 0, 0)
  },
)

// Value: protects=the bridge never reading an unbounded descriptor at connection time; fails_when=the final read takes a file of any size (the scan's size cap alone does not cover the file read for the connection); why_new=Cycle 0143 /ship cycle 3 H2 bounded final read; seam=runCursorMcpBridge on a descriptor padded past the limit that names a loopback listener counting requests
// Windows reports 0o666 for every file, so the private-file check refuses before the size check this test reaches.
test(
  'a descriptor larger than the size cap is refused before any request at connection time',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    let requests = 0
    const { port } = await listen(context, (_request, response) => {
      requests += 1
      response.end()
    })
    const path = await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${port}/mcp`,
      padding: 'x'.repeat(70_000),
    })
    // Act
    const outcome = runCursorMcpBridge(path, 2_000)
    // Assert
    await assert.rejects(outcome, /larger than 65536 bytes/)
    assert.equal(requests, 0)
  },
)

// Value: protects=the final descriptor read never waiting on a pipe swapped in after the selection; fails_when=the path is opened for reading without O_NONBLOCK and a handle check, so the bridge waits for a writer that never comes; why_new=Cycle 0143 /ship cycle 3 H2 swap after selection; seam=selectDevinDescriptor, the file replaced by a real FIFO, then runCursorMcpBridge
test(
  'a named pipe swapped in at the descriptor path after its selection is refused promptly',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const path = await writeDescriptor(agentDir, 0, workspace, process.pid)
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    assert.ok(selection)
    await unlink(path)
    await promisify(execFile)('mkfifo', [path])
    // Act
    const outcome = runCursorMcpBridge(
      path,
      2_000,
      devinDescriptorExpectation(selection, process.pid, workspace),
    )
    // Assert
    await assert.rejects(outcome, /not a private regular file/)
  },
)

// Value: protects=the final descriptor read never following a link swapped in after the selection; fails_when=the path is opened with link following, so a link to another private descriptor's token is read; why_new=Cycle 0143 /ship cycle 3 H2 swap after selection; seam=selectDevinDescriptor, the file replaced by a symlink to a private descriptor elsewhere, then runCursorMcpBridge against a loopback listener counting requests
test(
  'a link swapped in at the descriptor path after its selection is refused before any request',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    let requests = 0
    const { port } = await listen(context, (_request, response) => {
      requests += 1
      response.end()
    })
    const url = `http://127.0.0.1:${port}/mcp`
    const path = await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url,
    })
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      FAST,
    )
    assert.ok(selection)
    const elsewhere = join(agentDir, '..', 'elsewhere')
    await mkdir(elsewhere)
    const target = await writeDescriptor(elsewhere, 0, workspace, process.pid, {
      url,
    })
    await unlink(path)
    await symlink(target, path)
    // Act
    const outcome = runCursorMcpBridge(
      path,
      2_000,
      devinDescriptorExpectation(selection, process.pid, workspace),
    )
    // Assert
    await assert.rejects(outcome, /not a private regular file/)
    assert.equal(requests, 0)
  },
)

// Value: protects=the bridge's total time after its startup deadline; fails_when=every remaining matching descriptor gets its own floor-length attempt once the deadline has passed, so three candidates cost three floors; why_new=Cycle 0143 /ship cycle 3 H3 one late attempt in total; seam=runDevinMcpBridge with three descriptors of one window naming a listener that never answers and records when each initialize request arrives
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'after the deadline the bridge starts at most one more connection attempt however many descriptors match',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const startupMs = 2_000,
      arrivals: number[] = []
    const { port } = await listen(context, (incoming) => {
      if (incoming.method === 'POST') arrivals.push(Date.now())
      // The request is held open on purpose.
    })
    for (const index of [0, 1, 2])
      await writeDescriptor(agentDir, index, workspace, process.pid, {
        url: `http://127.0.0.1:${port}/mcp`,
      })
    // Act
    const startedAt = Date.now()
    const { exitCode } = await runCapturingStderr(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: startupMs, intervalMs: 20 },
    )
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(arrivals.length, 2)
    const firstArrival = arrivals[0] ?? Number.NaN,
      secondArrival = arrivals[1] ?? Number.NaN
    // The bridge's deadline lies at least startupMs after the test started, so the first attempt began before it. gstack-timing-ok: the contract is attempt start times against the deadline.
    assert.equal(firstArrival - startedAt < startupMs, true)
    // The deadline lies at most startupMs after the first attempt began, and the second attempt waited out the first one's floor: it began after the deadline. gstack-timing-ok: the contract is attempt start times against the deadline.
    assert.equal(secondArrival - firstArrival >= startupMs, true)
  },
)

// protects: the bridge's own lookup of its working folder spends the startup window, so a mount that never answers cannot hold the bridge before its first selection / fails_when: the bridge awaits the working folder's real path without a bound, so it neither selects nor refuses while the mount hangs / no_claim: how a real mount stops answering
test(
  'the bridge refuses within its startup window when its working folder never answers',
  { timeout: 5_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/realOrSame': {
          realOrSame: (path: string) =>
            path === workspace
              ? new Promise<string>(() => {})
              : Promise.resolve(path),
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 300, intervalMs: 20 },
    )
    // Assert
    assert.equal(
      refusal,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`,
    )
  },
)

// protects=the bridge entry ending its process right after the refusal line when a lookup never answers; fails_when=the entry only sets the exit code, so a referenced handle of the unanswered lookup keeps the process alive and Devin never gets the end of the stream; no_claim=a real pending file-system request (a referenced setInterval stands in for it)
test(
  'the bridge entry exits with 1 right after its refusal line while a lookup never settles',
  { timeout: 30_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const preloadPath = join(agentDir, '..', 'preload.js')
    // The preload gives the entry's call a 500 ms deadline and a resolver that never settles but holds an event-loop handle.
    await writeFile(
      preloadPath,
      `const bridge = require(${JSON.stringify(resolve(__dirname, '../devinMcpBridge.js'))})
const original = bridge.runDevinMcpBridge
bridge.runDevinMcpBridge = (agentDirectory) =>
  original(agentDirectory, process.cwd(), process.env, {
    timeoutMs: 500,
    intervalMs: 20,
    resolveWorkspace: () => {
      setInterval(() => {}, 1_000)
      return new Promise(() => {})
    },
  })
`,
    )
    // Act
    const result = await new Promise<{
      code: number | null
      stderr: string
    }>((done) => {
      const child = execFile(
        process.execPath,
        [
          '--require',
          preloadPath,
          join(__dirname, '../devinMcpBridgeEntry.js'),
          agentDir,
        ],
        {
          cwd: workspace,
          env: { WINDSURF_EXT_HOST_PID: '10' },
          // A process that is still alive here is the failure; it is ended so the test does not hang. The margin covers a cold Node start under the gate's parallel load.
          timeout: 15_000,
          killSignal: 'SIGKILL',
        },
        (_error, _stdout, stderr) => done({ code: child.exitCode, stderr }),
      )
    })
    // Assert
    assert.equal(result.code, 1)
    assert.equal(
      result.stderr,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.\n`,
    )
  },
)

// protects=a Devin window whose symlinked working folder has one lookup that never answers still connecting to its valid descriptor; fails_when=the connection check compares the unresolved folder while the selection matched the real one, so the descriptor is dropped and the bridge refuses; no_claim=a real hung mount (the first resolver call never settles, later ones answer with the real path)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'the bridge connects when only the first lookup of a symlinked working folder never answers',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      // The agent folder sits in a storage folder holding the setup receipts the bridge checks before its session.
      agentDir = await makeLiveAgentFolder(),
      root = dirname(agentDir)
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(root)
    })
    const linkedFolder = join(root, 'linked-workspace')
    await symlink(harness.directory, linkedFolder)
    await writeDescriptor(agentDir, 0, harness.directory, process.pid, {
      ...endpoint.descriptor,
      instanceId: IDS[0],
    })
    const preloadPath = join(root, 'preload.js')
    // The preload starts the bridge in the symlinked folder; its resolver never answers the first lookup of that folder and answers every other one with the real path.
    await writeFile(
      preloadPath,
      `const { realpath } = require('node:fs/promises')
const bridge = require(${JSON.stringify(resolve(__dirname, '../devinMcpBridge.js'))})
const original = bridge.runDevinMcpBridge
let lookupsOfLink = 0
bridge.runDevinMcpBridge = (agentDirectory) =>
  original(agentDirectory, process.env.LINKED_FOLDER, process.env, {
    timeoutMs: 8_000,
    intervalMs: 20,
    resolveWorkspace: (path) => {
      if (path === process.env.LINKED_FOLDER && (lookupsOfLink += 1) === 1)
        return new Promise(() => {})
      return realpath(path)
    },
  })
`,
    )
    // Act
    const client = await connectThroughBridge(
      agentDir,
      harness.directory,
      context,
      {
        nodeArgs: ['--require', preloadPath],
        env: { LINKED_FOLDER: linkedFolder },
      },
    )
    // Assert
    assert.equal(await statusInstanceId(client), endpoint.descriptor.instanceId)
  },
)

// protects=a selection scan's length with many same-window descriptors whose workspace lookups never answer; fails_when=each hanging candidate gets its own 200 ms floor after the deadline, so twenty of them add about four seconds; no_claim=how a real mount stops answering (the resolver never settles)
test(
  'a scan with twenty hanging same-window candidates ends within the deadline plus one grace',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace, otherWorkspace } = await createFolders(context)
    for (let index = 0; index < 20; index += 1)
      await writeDescriptor(
        agentDir,
        index,
        `${otherWorkspace}-${index}`,
        process.pid,
      )
    const resolveWorkspace = (path: string): Promise<string> =>
      path === workspace
        ? Promise.resolve(path)
        : new Promise<string>(() => undefined)
    // Act
    const startedAt = Date.now()
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 500, intervalMs: 20, resolveWorkspace },
    )
    const elapsedMs = Date.now() - startedAt
    // Assert
    assert.equal(selection, undefined)
    // gstack-timing-ok: the contract is the scan's length against the deadline plus one grace, with a 1,500 ms margin for the gate's parallel load.
    assert.equal(elapsedMs < 500 + 1_500, true)
  },
)

// protects=a healthy descriptor being chosen well before the deadline although a NEWER same-window descriptor's lookup never answers, whatever the folder's listing order; fails_when=the scan judges candidates newest first one after another, so the hanging newest candidate holds the healthy one until the startup deadline; no_claim=which descriptor wins when both answer
for (const hangingIndex of [0, 1]) {
  test(
    `a newer same-window candidate whose workspace never answers does not delay the healthy older one (hanging descriptor listed ${hangingIndex === 0 ? 'first' : 'second'})`,
    { timeout: 20_000 },
    async (context) => {
      // Arrange
      const { agentDir, workspace, otherWorkspace } =
        await createFolders(context)
      const healthyIndex = 1 - hangingIndex
      const hangingPath = await writeDescriptor(
        agentDir,
        hangingIndex,
        otherWorkspace,
        process.pid,
      )
      const healthyPath = await writeDescriptor(
        agentDir,
        healthyIndex,
        workspace,
        process.pid,
      )
      // The hanging descriptor is the newest by file time.
      await utimes(healthyPath, new Date(1_000_000), new Date(1_000_000))
      await utimes(hangingPath, new Date(2_000_000), new Date(2_000_000))
      const resolveWorkspace = (path: string): Promise<string> =>
        path === otherWorkspace
          ? new Promise<string>(() => undefined)
          : Promise.resolve(path)
      // Act
      const startedAt = Date.now()
      const selection = await selectDevinDescriptor(
        agentDir,
        workspace,
        process.pid,
        { timeoutMs: 10_000, intervalMs: 20, resolveWorkspace },
      )
      const elapsedMs = Date.now() - startedAt
      // Assert
      assert.equal(selection?.descriptorPath, healthyPath)
      // gstack-timing-ok: the contract is a choice long before the 10,000 ms deadline (about 200 ms expected), with a wide margin for the gate's parallel load.
      assert.equal(elapsedMs < 4_000, true)
    },
  )
}

// protects=a healthy descriptor being chosen well before the deadline beside a descriptor whose read never returns, whatever the folder's listing order; fails_when=the scan waits for every read before judging, so the stalled read holds the scan until the startup deadline; no_claim=how a real read stalls (the read stand-in never settles for one path)
for (const stalledIndex of [0, 1]) {
  test(
    `a descriptor whose read stalls does not hold a healthy descriptor (stalled descriptor listed ${stalledIndex === 0 ? 'first' : 'second'})`,
    { timeout: 20_000 },
    async (context) => {
      // Arrange
      const { agentDir, workspace } = await createFolders(context)
      const stalledPath = await writeDescriptor(
        agentDir,
        stalledIndex,
        workspace,
        process.pid,
      )
      const healthyPath = await writeDescriptor(
        agentDir,
        1 - stalledIndex,
        workspace,
        process.pid,
      )
      const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
        resolve(__dirname, '../devinMcpBridge.js'),
        {
          './utils/readWikiRegularFile': {
            readWikiRegularFile: (
              ...parameters: Parameters<typeof readWikiRegularFile>
            ) =>
              parameters[0] === stalledPath
                ? new Promise<undefined>(() => undefined)
                : readWikiRegularFile(...parameters),
          },
        },
      )
      // Act
      const startedAt = Date.now()
      const selection = await bridgeModule.selectDevinDescriptor(
        agentDir,
        workspace,
        process.pid,
        { timeoutMs: 10_000, intervalMs: 20 },
      )
      const elapsedMs = Date.now() - startedAt
      // Assert
      assert.equal(selection?.descriptorPath, healthyPath)
      // gstack-timing-ok: the contract is a choice long before the 10,000 ms deadline (about 200 ms expected), with a wide margin for the gate's parallel load.
      assert.equal(elapsedMs < 4_000, true)
    },
  )
}

// protects=a working folder whose lookup answers during a scan being used at once; fails_when=the scan under way keeps matching with the folder as written until it ends, so a hanging same-window candidate holds the matching descriptor for the whole scan wait; no_claim=a real mount (the lookup answers after 1,100 ms)
test(
  'a scan ends and starts again when the working folder lookup answers during it',
  // A directory symlink needs a privilege on Windows.
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace, otherWorkspace } = await createFolders(context)
    const hangingPath = await writeDescriptor(
      agentDir,
      0,
      otherWorkspace,
      process.pid,
    )
    const matchingPath = await writeDescriptor(
      agentDir,
      1,
      workspace,
      process.pid,
    )
    // The hanging candidate is the older one, so a match never waits for it.
    await utimes(hangingPath, new Date(1_000_000), new Date(1_000_000))
    await utimes(matchingPath, new Date(2_000_000), new Date(2_000_000))
    const linkedFolder = join(agentDir, '..', 'linked-workspace')
    await symlink(workspace, linkedFolder)
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path === otherWorkspace) return new Promise<string>(() => undefined)
      // The lookup of the symlinked working folder answers after the bridge's one-second wait for it.
      if (path === linkedFolder)
        return new Promise<string>((resolveLater) =>
          setTimeout(() => resolveLater(workspace), 1_100),
        )
      return Promise.resolve(path)
    }
    // Act
    const startedAt = Date.now()
    const selection = await selectDevinDescriptor(
      agentDir,
      linkedFolder,
      process.pid,
      { timeoutMs: 10_000, intervalMs: 20, resolveWorkspace },
    )
    const elapsedMs = Date.now() - startedAt
    // Assert
    assert.equal(selection?.descriptorPath, matchingPath)
    assert.equal(selection?.matchedCwd, workspace)
    // gstack-timing-ok: the contract is a choice right after the lookup answers (about 1,100 ms), not after the first scan's 1,000 ms wait (about 2,000 ms); margin for the gate's parallel load.
    assert.equal(elapsedMs < 1_900, true)
  },
)

// protects=a slow workspace mount whose lookup answers after one scan's one-second wait and before the next scan; fails_when=the settled lookup is dropped, so each scan starts it over and a workspace that always takes 1,300 ms never matches; no_claim=a real mount, or which scan takes the answer when several overlap
test(
  'a workspace lookup that answers between two scans is used by the next scan and ran once',
  // A directory symlink needs a privilege on Windows.
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const slowFolder = join(agentDir, '..', 'slow-workspace')
    await symlink(workspace, slowFolder)
    const descriptorPath = await writeDescriptor(
      agentDir,
      0,
      slowFolder,
      process.pid,
    )
    let slowLookups = 0
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== slowFolder) return Promise.resolve(path)
      slowLookups += 1
      // The answer comes 300 ms after the first scan's wait ended and before the next scan starts (1,500 ms pause).
      return new Promise<string>((resolveLater) =>
        setTimeout(() => resolveLater(workspace), 1_300),
      )
    }
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 6_000, intervalMs: 1_500, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, descriptorPath)
    assert.equal(slowLookups, 1)
  },
)

// protects=the newest of two descriptors of one slow workspace being chosen when the lookup answered between two scans; fails_when=the kept answer serves only the candidate that asks first, so the newer one starts another slow lookup and the older instance is chosen or none; no_claim=a real mount
test(
  'two descriptors of one slow workspace both use its late answer and the newer one is selected',
  // A directory symlink needs a privilege on Windows.
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const slowFolder = join(agentDir, '..', 'slow-workspace')
    await symlink(workspace, slowFolder)
    const olderPath = await writeDescriptor(
      agentDir,
      0,
      slowFolder,
      process.pid,
    )
    const newerPath = await writeDescriptor(
      agentDir,
      1,
      slowFolder,
      process.pid,
    )
    // The older descriptor is listed and evaluated first.
    await utimes(olderPath, new Date(1_000_000), new Date(1_000_000))
    await utimes(newerPath, new Date(2_000_000), new Date(2_000_000))
    const resolveWorkspace = (path: string): Promise<string> =>
      path === slowFolder
        ? new Promise<string>((resolveLater) =>
            setTimeout(() => resolveLater(workspace), 1_300),
          )
        : Promise.resolve(path)
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 6_000, intervalMs: 1_500, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, newerPath)
  },
)

// protects=a workspace whose resolution failed late being asked again by the next scan; fails_when=the fallback spelling is kept like a resolved answer, so the next scan judges the stale spelling and the repaired link never matches; no_claim=a real failing realpath (the stand-in rejects after 1,300 ms once)
test(
  'a workspace lookup that failed late is not kept and the next scan asks again',
  // A directory symlink needs a privilege on Windows.
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const brokenFolder = join(agentDir, '..', 'broken-workspace')
    const descriptorPath = await writeDescriptor(
      agentDir,
      0,
      brokenFolder,
      process.pid,
    )
    let brokenLookups = 0
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== brokenFolder) return Promise.resolve(path)
      brokenLookups += 1
      // The first lookup fails after the first scan's wait; the link is repaired by the second.
      return brokenLookups === 1
        ? new Promise<string>((_resolve, rejectLater) =>
            setTimeout(() => rejectLater(new Error('ENOENT')), 1_300),
          )
        : Promise.resolve(workspace)
    }
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 4_000, intervalMs: 1_500, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, descriptorPath)
    assert.equal(brokenLookups, 2)
  },
)

// protects=a kept lookup answer being used once (the next selection takes it, the one after looks again); fails_when=the answer is never kept, so the second selection finds nothing, or stays in the state, so the third never looks again; no_claim=a real mount
test(
  'a selection after the kept workspace answer was taken starts a new lookup',
  // A directory symlink needs a privilege on Windows.
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const slowFolder = join(agentDir, '..', 'slow-workspace')
    await symlink(workspace, slowFolder)
    await writeDescriptor(agentDir, 0, slowFolder, process.pid)
    const state = createDevinSelectState()
    let slowLookups = 0
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== slowFolder) return Promise.resolve(path)
      slowLookups += 1
      return new Promise<string>((resolveLater) =>
        setTimeout(() => resolveLater(workspace), 1_300),
      )
    }
    const options = {
      timeoutMs: 1_100,
      intervalMs: 20,
      resolveWorkspace,
      state,
    }
    // Act
    const first = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    await new Promise((resolveLater) => setTimeout(resolveLater, 500))
    const second = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    const third = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    // Assert
    // The first selection ends before the slow answer; the second takes the kept answer; the third looks again.
    assert.equal(first, undefined)
    assert.notEqual(second, undefined)
    assert.equal(third, undefined)
    assert.equal(slowLookups, 2)
  },
)

// protects=a Devin window whose setup check does not answer reaching a retry instead of a wrong "not set up" refusal; fails_when=the check is awaited without a bound (the bridge hangs past its startup window) or a timed-out check counts as a removed setup; no_claim=a real receipt read that stalls (the check stand-in never settles)
test(
  'a receipts check that never answers ends the wait with the not-running line, not the not-set-up line',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/checkDevinBridgeReceipts': {
          checkDevinBridgeReceipts: () => new Promise<never>(() => undefined),
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 1_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(
      refusal,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`,
    )
  },
)

// protects=the end-of-wait refusal following the last attempt; fails_when=a not-set-up outcome of an earlier attempt stays set, so a wait that ends after a later attempt was dropped names a missing setup; no_claim=how the later attempt fails (a server that answers 500)
test(
  'a wait whose last attempt was dropped after a not-set-up one says Codebook is not running',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const { port } = await listen(context, (_incoming, outgoing) => {
      outgoing.writeHead(500)
      outgoing.end()
    })
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${port}/mcp`,
    })
    let checks = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/checkDevinBridgeReceipts': {
          // The first check finds the setup removed; the second finds it standing again.
          checkDevinBridgeReceipts: () => {
            checks += 1
            return Promise.resolve(
              checks > 1
                ? { answer: 'stands' }
                : {
                    answer: 'removed',
                    reason: 'missing',
                    path: '/receipt.json',
                  },
            )
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 1_500, intervalMs: 20 },
    )
    // Assert
    assert.equal(
      refusal,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`,
    )
    assert.equal(checks >= 2, true)
  },
)

// protects=a connected bridge ending its process once its cleanup completed after Devin closed its stdin, although a lookup of another window's descriptor never settles; fails_when=nothing ends the process, so a referenced handle of the unanswered lookup keeps the bridge alive after Devin is gone; no_claim=a real pending realpath (a referenced setInterval stands in for it)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a connected bridge exits with 0 after its stdin closes while a lookup never settles',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      agentDir = await makeLiveAgentFolder(),
      root = dirname(agentDir)
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(root)
    })
    const hangingWorkspace = join(root, 'hanging-workspace')
    const hangingPath = await writeDescriptor(
      agentDir,
      0,
      hangingWorkspace,
      process.pid,
    )
    const livePath = await writeDescriptor(
      agentDir,
      1,
      harness.directory,
      process.pid,
      { ...endpoint.descriptor, instanceId: IDS[1] },
    )
    // The hanging candidate is the older one, so the live one is taken at once.
    await utimes(hangingPath, new Date(1_000_000), new Date(1_000_000))
    await utimes(livePath, new Date(2_000_000), new Date(2_000_000))
    const preloadPath = join(root, 'preload.js')
    // The preload gives the lookup of the other window's workspace a referenced handle and never settles it.
    await writeFile(
      preloadPath,
      `const { realpath } = require('node:fs/promises')
const bridge = require(${JSON.stringify(resolve(__dirname, '../devinMcpBridge.js'))})
const original = bridge.runDevinMcpBridge
bridge.runDevinMcpBridge = (agentDirectory, cwd, env, options) =>
  original(agentDirectory, cwd, env, {
    ...options,
    resolveWorkspace: (path) => {
      if (path !== process.env.HANGING_WORKSPACE) return realpath(path)
      setInterval(() => {}, 1_000)
      return new Promise(() => {})
    },
  })
`,
    )
    // Act
    const result = await new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
      stderr: string
    }>((done) => {
      let stderr = ''
      const child = spawn(
        process.execPath,
        [
          '--require',
          preloadPath,
          join(__dirname, '../devinMcpBridgeEntry.js'),
          agentDir,
        ],
        {
          cwd: harness.directory,
          env: {
            WINDSURF_EXT_HOST_PID: String(process.pid),
            HANGING_WORKSPACE: hangingWorkspace,
          },
          // A process that is still alive here is the failure; it is ended so the test does not hang.
          timeout: 25_000,
          killSignal: 'SIGKILL',
        },
      )
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        // The bridge writes its connected line once the transport is up; Devin then closes stdin.
        if (stderr.includes('Codebook bridge: instance')) child.stdin.end()
      })
      child.on('exit', (code, signal) => done({ code, signal, stderr }))
    })
    // Assert
    assert.equal(result.signal, null)
    assert.equal(result.code, 0)
  },
)

// protects=a removed Devin setup not getting a new Codebook session when the old one expires; fails_when=the bridge reinitializes its upstream session without reading the setup receipts again, so a removal made in another window (whose unmark never reaches this window) still opens a session; no_claim=the removal itself (the receipts are rewritten by hand)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a connected bridge whose session expired after the setup was removed ends with the not-set-up line and opens no new session',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    let now = 0
    const harness = await createHarness(),
      endpoint = await startServer(harness.service, () => now),
      agentDir = await makeLiveAgentFolder(),
      root = dirname(agentDir)
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(root)
    })
    // The proxy counts the initialize requests that reach the server.
    let initializeRequests = 0
    const { port } = await listen(context, (incoming, outgoing) => {
      incoming.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('"method":"initialize"'))
          initializeRequests += 1
      })
      forward(Number(new URL(endpoint.descriptor.url).port), incoming, outgoing)
    })
    await writeDescriptor(agentDir, 0, harness.directory, process.pid, {
      ...endpoint.descriptor,
      url: `http://127.0.0.1:${port}/mcp`,
      instanceId: IDS[0],
    })
    const child = spawn(
      process.execPath,
      [join(__dirname, '../devinMcpBridgeEntry.js'), agentDir],
      {
        cwd: harness.directory,
        env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
        // A process that is still alive here is the failure; it is ended so the test does not hang.
        timeout: 25_000,
        killSignal: 'SIGKILL',
      },
    )
    const { connected, readStderr } = watchConnectedLine(child)
    const exited = new Promise<number | null>((done) => {
      child.on('exit', (code) => done(code))
    })
    await connected
    // Act
    await writeSetupReceipts(root, { installed: false }, false)
    now = SESSION_IDLE_TIMEOUT_MS + 1
    await endpoint.expire()
    const send = (message: object): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'devin-bridge-test', version: '1.0' },
      },
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const exitCode = await exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(
      readStderr().includes(
        `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(harness.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
      ),
      true,
    )
    // Only the bridge's own first handshake reached the server.
    assert.equal(initializeRequests, 1)
  },
)

/**
 * Starts the bridge entry with a preload against a server whose session the test expires, then sends the requests that make the bridge reinitialize.
 * @param context - The test context; its cleanup removes the folders and the servers.
 * @param preloadSource - Source of the preload that wraps the bridge's reconnect check and its close callback.
 * @param setupRemoved - Whether the setup receipts are rewritten as removed before the session expires.
 * @returns The bridge process and its stderr watcher.
 */
async function startBridgeWithExpiredSession(
  context: { after: (callback: () => Promise<void>) => void },
  preloadSource: string,
  setupRemoved: boolean,
): Promise<{
  child: ChildProcess
  watcher: ReturnType<typeof watchConnectedLine>
}> {
  let now = 0
  const harness = await createHarness(),
    endpoint = await startServer(harness.service, () => now),
    agentDir = await makeLiveAgentFolder(),
    root = dirname(agentDir)
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await removeTestFolder(root)
  })
  await writeDescriptor(agentDir, 0, harness.directory, process.pid, {
    ...endpoint.descriptor,
    instanceId: IDS[0],
  })
  const preloadPath = join(root, 'preload.js')
  await writeFile(preloadPath, preloadSource)
  const child = spawn(
    process.execPath,
    [
      '--require',
      preloadPath,
      join(__dirname, '../devinMcpBridgeEntry.js'),
      agentDir,
    ],
    {
      cwd: harness.directory,
      env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
      // A process that is still alive here is the failure; it is ended so the test does not hang.
      timeout: 25_000,
      killSignal: 'SIGKILL',
    },
  )
  const watcher = watchConnectedLine(child)
  await watcher.connected
  if (setupRemoved) await writeSetupReceipts(root, { installed: false }, false)
  now = SESSION_IDLE_TIMEOUT_MS + 1
  await endpoint.expire()
  const send = (message: object): void => {
    child.stdin?.write(`${JSON.stringify(message)}\n`)
  }
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'devin-bridge-test', version: '1.0' },
    },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  return { child, watcher }
}

const CURSOR_BRIDGE_MODULE_PATH = JSON.stringify(
  resolve(__dirname, '../cursorMcpBridge.js'),
)

// protects=the bridge's close callback running exactly once when Devin closes stdin while the reconnect check still runs and the check then refuses; fails_when=stdin EOF and the refusal each start their own cleanup notice, so the callback (which ends the entry's process) runs twice; no_claim=the real receipts read (the preload's check answers false after 800 ms)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a bridge whose stdin closes during a reconnect check that then refuses calls its close callback once',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const preload = `const { writeSync } = require('node:fs')
const bridge = require(${CURSOR_BRIDGE_MODULE_PATH})
const original = bridge.runCursorMcpBridge
let closedCalls = 0
bridge.runCursorMcpBridge = (descriptorPath, timeoutMs, expected, header) =>
  original(descriptorPath, timeoutMs, expected, header,
    () => {
      closedCalls += 1
      // The callback only counts; the preload ends the process after a wait that would show a second call.
      if (closedCalls === 1) setTimeout(() => { writeSync(2, 'CLOSED_CALLS ' + closedCalls + '\\n'); process.exit(0) }, 2_000)
    },
    async () => {
      writeSync(2, 'CHECK_STARTED\\n')
      await new Promise((done) => setTimeout(done, 800))
      return false
    })
`
    const { child, watcher } = await startBridgeWithExpiredSession(
      context,
      preload,
      false,
    )
    // Act
    // Devin closes stdin as soon as the reconnect check started.
    await waitUntil(
      () => watcher.readStderr().includes('CHECK_STARTED'),
      'the reconnect check to start',
      10_000,
      undefined,
      20,
    )
    child.stdin?.end()
    await new Promise((done) => child.once('close', done))
    // Assert
    assert.equal(watcher.readStderr().includes('CLOSED_CALLS 1\n'), true)
  },
)

// protects=the not-set-up line of a refused reconnection being written before the bridge's close callback ends the process; fails_when=the check queues the line and returns without waiting for the write, so the callback (process.exit in the entry) can run before the write completed; no_claim=a real full stderr pipe (the preload delays the write's callback by 500 ms while the bytes go out at once, so the loss itself cannot show, only the order)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a connected bridge whose setup was removed ends only after the not-set-up line write completed',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const preload = `const { writeSync } = require('node:fs')
const bridge = require(${CURSOR_BRIDGE_MODULE_PATH})
const originalWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = (chunk, callback) => {
  if (!String(chunk).includes('is not set up')) return originalWrite(chunk, callback)
  // The bytes go out at once; only the completion callback is late.
  originalWrite(chunk)
  setTimeout(() => { writeSync(2, 'WRITE_COMPLETED\\n'); callback?.() }, 500)
  return true
}
const original = bridge.runCursorMcpBridge
bridge.runCursorMcpBridge = (descriptorPath, timeoutMs, expected, header, onClosed, before) =>
  original(descriptorPath, timeoutMs, expected, header,
    () => { writeSync(2, 'CLOSE_CALLBACK\\n'); onClosed?.() },
    before)
`
    const { watcher, child } = await startBridgeWithExpiredSession(
      context,
      preload,
      true,
    )
    // Act
    const exitCode = await new Promise<number | null>((done) =>
      child.once('close', (code) => done(code)),
    )
    // Assert
    const stderr = watcher.readStderr()
    assert.equal(exitCode, 1)
    assert.equal(stderr.includes('WRITE_COMPLETED'), true)
    assert.equal(
      stderr.indexOf('WRITE_COMPLETED') < stderr.indexOf('CLOSE_CALLBACK'),
      true,
    )
  },
)

// protects=a connected bridge ending after its stdin closed although the server never answers the session DELETE; fails_when=the cleanup waits for the DELETE without a bound, so the bridge process stays alive forever; no_claim=the server's own session release (the proxy swallows the DELETE)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a connected bridge exits after its stdin closes although the server never answers the session DELETE',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const harness = await createHarness(),
      endpoint = await startServer(harness.service),
      agentDir = await makeLiveAgentFolder(),
      root = dirname(agentDir)
    context.after(async () => {
      await endpoint.close()
      await harness.close()
      await removeTestFolder(root)
    })
    // The proxy records the DELETE, accepts it and never answers it.
    let deleteRequests = 0
    const { port } = await listen(context, (incoming, outgoing) => {
      if (incoming.method === 'DELETE') {
        deleteRequests += 1
        return
      }
      forward(Number(new URL(endpoint.descriptor.url).port), incoming, outgoing)
    })
    await writeDescriptor(agentDir, 0, harness.directory, process.pid, {
      ...endpoint.descriptor,
      url: `http://127.0.0.1:${port}/mcp`,
      instanceId: IDS[0],
    })
    const child = spawn(
      process.execPath,
      [join(__dirname, '../devinMcpBridgeEntry.js'), agentDir],
      {
        cwd: harness.directory,
        env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
        // A process that is still alive here is the failure; it is ended so the test does not hang.
        timeout: 25_000,
        killSignal: 'SIGKILL',
      },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      // The bridge writes its connected line once the transport is up; Devin then closes stdin.
      if (stderr.includes('Codebook bridge: instance')) child.stdin.end()
    })
    // Act
    const startedAt = Date.now()
    const result = await new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
    }>((done) => {
      child.on('exit', (code, signal) => done({ code, signal }))
    })
    const elapsedMs = Date.now() - startedAt
    // Assert
    assert.equal(result.signal, null)
    assert.equal(result.code, 0)
    // The bridge did send the DELETE the server then never answered.
    assert.equal(deleteRequests, 1)
    // gstack-timing-ok: the contract is an exit within the cleanup bound (1,000 ms) plus the start, with a wide margin for the gate's parallel load.
    assert.equal(elapsedMs < 15_000, true)
  },
)

// protects=a healthy descriptor being chosen on a home folder whose listing takes longer than one scan wait; fails_when=each scan starts a new readdir and discards a listing slower than the scan wait, so no listing ever answers within the startup budget; no_claim=a real slow disk (the listing stand-in answers after 1,500 ms)
test(
  'a folder listing slower than one scan wait still selects the descriptor within the startup budget',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const healthyPath = await writeDescriptor(
      agentDir,
      0,
      workspace,
      process.pid,
    )
    let listings = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        'node:fs/promises': {
          // Every listing takes 1,500 ms, longer than the 1,000 ms scan wait.
          readdir: async (path: string) => {
            listings += 1
            await new Promise<void>((done) => setTimeout(done, 1_500))
            return readdir(path)
          },
        },
      },
    )
    // Act
    const selection = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 10_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(selection?.descriptorPath, healthyPath)
    assert.equal(listings, 1)
  },
)

// protects=a healthy descriptor being chosen when the first open fails because the process is out of file descriptors; fails_when=the shortage reads as an absent descriptor and is only asked again at the next poll (here 5,000 ms later); no_claim=a real descriptor limit (the read stand-in reports EMFILE once)
test(
  'a descriptor whose first open fails with EMFILE is read again within the scan, not at the next poll',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const healthyPath = await writeDescriptor(
      agentDir,
      0,
      workspace,
      process.pid,
    )
    let opens = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/readWikiRegularFile': {
          readWikiRegularFile: (
            ...parameters: Parameters<typeof readWikiRegularFile>
          ) => {
            opens += 1
            if (opens > 1) return readWikiRegularFile(...parameters)
            // The first open runs out of file descriptors.
            parameters[3]?.(Object.assign(new Error('x'), { code: 'EMFILE' }))
            return Promise.resolve(undefined)
          },
        },
      },
    )
    // Act
    const startedAt = Date.now()
    const selection = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 10_000, intervalMs: 5_000 },
    )
    const elapsedMs = Date.now() - startedAt
    // Assert
    assert.equal(selection?.descriptorPath, healthyPath)
    // gstack-timing-ok: the contract is a retry inside the first scan (about 100 ms), not at the next poll 5,000 ms later; margin for the gate's parallel load.
    assert.equal(elapsedMs < 2_500, true)
  },
)

// protects=a folder of many descriptors never opening more files at once than the cap; fails_when=every candidate is opened at once, so a process at its descriptor limit fails them all with EMFILE; no_claim=the real descriptor limit (the read stand-in counts the reads in flight)
test(
  'forty descriptors are read at most sixteen at a time and the newest is still selected',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    let newestPath = ''
    for (let index = 0; index < 40; index += 1) {
      const path = await writeDescriptor(
        agentDir,
        index,
        workspace,
        process.pid,
      )
      await utimes(
        path,
        new Date(1_000_000 + index),
        new Date(1_000_000 + index),
      )
      newestPath = path
    }
    let open = 0,
      mostOpen = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/readWikiRegularFile': {
          readWikiRegularFile: async (
            ...parameters: Parameters<typeof readWikiRegularFile>
          ) => {
            open += 1
            mostOpen = Math.max(mostOpen, open)
            // A pause keeps the read open long enough for the others to start.
            await new Promise<void>((done) => setTimeout(done, 30))
            open -= 1
            return readWikiRegularFile(...parameters)
          },
        },
      },
    )
    // Act
    const selection = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 10_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(selection?.descriptorPath, newestPath)
    assert.equal(mostOpen, 16)
  },
)

/** A connected Devin bridge process behind a proxy the test controls, as {@link startConnectedBridge} starts it. */
interface ConnectedBridge {
  /** The global storage folder, the parent of the agent folder. */
  root: string
  agentDir: string
  /** The folder of the window's workspace, the bridge's working folder. */
  directory: string
  /** The initialize requests and the other requests that reached the proxy since the bridge connected. */
  counts: { initializes: number; others: number }
  /** The status the proxy answers to every request instead of forwarding it; `undefined` forwards. */
  proxy: { refuseWith: number | undefined }
  readStderr: () => string
  /** Resolves with the exit code once the process ended. */
  exited: Promise<number | null>
  /** The JSON-RPC messages the bridge wrote to stdout so far. */
  readMessages: () => Array<{ id?: number }>
  /** Makes the server forget the bridge's session, so that its next request answers 404 `Unknown MCP session`. */
  expireSession: () => Promise<void>
  /** Does the MCP handshake a client makes (request 0 `initialize`, then `initialized`). */
  handshake: () => void
  /** Asks `tools/list` as request `id`. */
  askToolsList: (id: number) => void
}

/**
 * Starts the Devin bridge entry against a real Codebook server behind a counting proxy and waits for its connected line; the arrange step of the reconnect tests.
 * @param context - The test context; its cleanup removes the folders and the servers.
 * @param preloadSource - Source of a preload script run in the bridge process; none when left out.
 * @returns The running bridge with the controls of {@link ConnectedBridge}.
 */
async function startConnectedBridge(
  context: { after: (callback: () => Promise<void>) => void },
  preloadSource?: string,
): Promise<ConnectedBridge> {
  let now = 0
  const harness = await createHarness(),
    endpoint = await startServer(harness.service, () => now),
    agentDir = await makeLiveAgentFolder(),
    root = dirname(agentDir)
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await removeTestFolder(root)
  })
  const counts = { initializes: 0, others: 0 },
    proxy: ConnectedBridge['proxy'] = { refuseWith: undefined }
  const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
  const { port } = await listen(context, (incoming, outgoing) => {
    incoming.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('"method":"initialize"'))
        counts.initializes += 1
      else if (incoming.method === 'POST') counts.others += 1
    })
    if (proxy.refuseWith !== undefined) {
      outgoing.writeHead(proxy.refuseWith)
      outgoing.end()
      return
    }
    forward(upstreamPort, incoming, outgoing)
  })
  await writeDescriptor(agentDir, 0, harness.directory, process.pid, {
    ...endpoint.descriptor,
    url: `http://127.0.0.1:${port}/mcp`,
    instanceId: IDS[0],
  })
  const preloadArguments: string[] = []
  if (preloadSource !== undefined) {
    const preloadPath = join(root, 'preload.js')
    await writeFile(preloadPath, preloadSource)
    preloadArguments.push('--require', preloadPath)
  }
  const child = spawn(
    process.execPath,
    [
      ...preloadArguments,
      join(__dirname, '../devinMcpBridgeEntry.js'),
      agentDir,
    ],
    {
      cwd: harness.directory,
      env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
      // A process that is still alive here is the failure; it is ended so the test does not hang.
      timeout: 25_000,
      killSignal: 'SIGKILL',
    },
  )
  const watcher = watchConnectedLine(child)
  const exited = new Promise<number | null>((done) => {
    child.on('exit', (code) => done(code))
  })
  let stdout = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  await watcher.connected
  // The connection's own handshake is not counted.
  counts.initializes = 0
  counts.others = 0
  const send = (message: object): void => {
    child.stdin?.write(`${JSON.stringify(message)}\n`)
  }
  return {
    root,
    agentDir,
    directory: harness.directory,
    counts,
    proxy,
    readStderr: watcher.readStderr,
    exited,
    readMessages: () =>
      stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) =>
          z.looseObject({ id: z.number().optional() }).parse(JSON.parse(line)),
        ),
    expireSession: async (): Promise<void> => {
      now = SESSION_IDLE_TIMEOUT_MS + 1
      await endpoint.expire()
    },
    handshake: (): void => {
      send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'devin-bridge-test', version: '1.0' },
        },
      })
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    askToolsList: (id): void => {
      send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} })
    },
  }
}

/**
 * Rewrites the connection descriptor of the bridge's window so that it names another installation, keeping everything else (the endpoint and the token the bridge connected with).
 * @param agentDir - The agent folder holding the descriptor.
 * @param installationId - The installation id the descriptor's mark names from now on.
 */
async function markDescriptorFor(
  agentDir: string,
  installationId: string,
): Promise<void> {
  const descriptorPath = join(agentDir, `${IDS[0]}.connection.json`)
  const descriptor = z
    .looseObject({})
    .parse(JSON.parse(await readFile(descriptorPath, 'utf8')))
  await writeFile(
    descriptorPath,
    JSON.stringify({ ...descriptor, devinSetupInstallation: installationId }),
    { mode: 0o600 },
  )
}

const REPLACING_INSTALLATION_ID = '88888888-8888-4888-8888-888888888888'

// protects=a connected bridge never opening a session with its old endpoint once the window's setup moved to another installation (Cycle 0145 task 5); fails_when=the reconnect check asks about the descriptor as it is now, so installation B's records pass while the bridge reconnects with installation A's endpoint and token; no_claim=the removal of a setup (the not-set-up test above)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a connected bridge whose session expired after the window was set up again for another installation ends with the replaced line and opens no new session',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    await markDescriptorFor(bridge.agentDir, REPLACING_INSTALLATION_ID)
    await writeSetupReceipts(bridge.root, {
      installationId: REPLACING_INSTALLATION_ID,
    })
    // Act
    bridge.handshake()
    await bridge.expireSession()
    bridge.askToolsList(1)
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(
      bridge
        .readStderr()
        .includes(
          `Codebook's AI chat setup for ${await realpath(bridge.directory)} changed in this Devin Desktop window after this bridge connected. Reload the window.\n`,
        ),
      true,
    )
    assert.equal(bridge.readStderr().includes('is not set up'), false)
    assert.equal(bridge.counts.initializes, 0)
  },
)

// protects=a connected bridge still reconnecting when its setup stands after the session expired; fails_when=the bound check refuses a descriptor that still names the instance, endpoint and installation the bridge connected for; no_claim=the answer of a changed setup (the test above)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a connected bridge whose session expired while its setup still stands opens a new session and answers',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    // Act
    bridge.handshake()
    await bridge.expireSession()
    bridge.askToolsList(1)
    const answer = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 1),
      'the answer to tools/list after the reconnection',
      20_000,
      undefined,
      20,
    )
    // Assert
    assert.equal('result' in answer, true)
    assert.equal(bridge.counts.initializes, 1)
  },
)
