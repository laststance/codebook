import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  realpath,
  symlink,
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
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'

import { runCursorMcpBridge } from '../cursorMcpBridge'
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
      ...(await currentStorageOwner()),
      devinChat: true,
      ...overrides,
    }),
    { mode: 0o600 },
  )
  return path
}

/** Runs the bridge in this process and returns what it wrote to stderr, its exit code and how long it took. */
async function runCapturingStderr(
  agentDir: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number; intervalMs?: number },
) {
  const lines: string[] = [],
    originalWrite = process.stderr.write.bind(process.stderr),
    originalExitCode = process.exitCode
  process.stderr.write = (chunk: string) => {
    lines.push(chunk)
    return true
  }
  let exitCode: typeof process.exitCode
  try {
    await runDevinMcpBridge(agentDir, workspace, env, options)
    exitCode = process.exitCode
  } finally {
    process.stderr.write = originalWrite
    process.exitCode = originalExitCode
  }
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
): Promise<Client> {
  const client = new Client({ name: 'devin-bridge-test', version: '1.0' })
  context.after(() => client.close())
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(__dirname, '../devinMcpBridgeEntry.js'), root],
    cwd,
    env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
    stderr: 'pipe',
  })
  await client.connect(transport, { timeout: 10_000 })
  return client
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
test('a descriptor swapped to another url after its selection never receives the token', async (context) => {
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
test(
  'the bridge gives up on a server that never answers within its startup deadline',
  { timeout: 15_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const { port } = await listen(context, () => {
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
    assert.equal(exitCode, 1)
  },
)

// Value: protects=a Devin window reaching Codebook while the server's sessions are full for a moment (three bridges start at window load); fails_when=an HTTP 429 drops the descriptor instead of asking the same one again; why_new=B5 transient 429; seam=a loopback proxy that answers 429 twice, then forwards to a real Codebook endpoint
test('the bridge asks again after an HTTP 429 and connects', async (context) => {
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
})

// Value: protects=a Devin window whose Codebook server is restarting when the bridge starts; fails_when=ECONNREFUSED drops the descriptor so the bridge exits before the server listens again; why_new=B5 transient refusal; seam=a descriptor naming a port that nothing listens on until a proxy to a real Codebook endpoint starts there 2.5 s later, after the bridge's first refused attempt
test('the bridge keeps asking a refusing server until it listens again', async (context) => {
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
  const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
  // A free port: listen, note it, close it.
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  await writeDescriptor(root, 0, harness.directory, process.pid, {
    ...endpoint.descriptor,
    url: `http://127.0.0.1:${port}/mcp`,
    instanceId: IDS[0],
  })
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
  const listening = new Promise<void>((resolve) =>
    setTimeout(() => server.listen(port, '127.0.0.1', resolve), 2_500),
  )
  // Act
  const client = await connectThroughBridge(root, harness.directory, context)
  await listening
  // Assert
  assert.equal(await statusInstanceId(client), endpoint.descriptor.instanceId)
})

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
test('the bridge drops a descriptor whose server fails and connects to the fresh one published after its first attempt', async (context) => {
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
})
