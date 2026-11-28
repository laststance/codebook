// Fixtures shared by the partitions of the Devin MCP bridge tests (devinMcpBridge*.test.ts): agent and storage folders,
// setup receipts, descriptors, loopback servers and the spawned bridge entry.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import { SESSION_IDLE_TIMEOUT_MS } from '../../constants'
import type * as DevinMcpBridgeModule from '../../devinMcpBridge'
import { runDevinMcpBridge } from '../../devinMcpBridge'
import { startServer } from '../../server'
import { currentStorageOwner } from '../../utils/currentStorageOwner'
import { createHarness } from '../helpers'

import { removeTestFolder } from './removeTestFolder'

/** The installation id of the receipts {@link writeSetupReceipts} writes and of the default descriptor. */
export const INSTALLATION_ID = '99999999-9999-4999-8999-999999999999'

export const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]

/** The instance id of descriptor `index`: one of {@link IDS}, or a numbered id for the tests that need many. */
export function instanceIdOf(index: number): string {
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
export async function writeSetupReceipts(
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
export async function makeLiveAgentFolder(): Promise<string> {
  const storage = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-devin-bridge-live-')),
  )
  const agentDir = join(storage, 'agent')
  await mkdir(agentDir)
  await writeSetupReceipts(storage)
  return agentDir
}

/** Makes an agent folder and workspace folders that are removed when the test ends. */
export async function createFolders(context: {
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
export async function writeDescriptor(
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
export async function runCapturingStderr(
  agentDir: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  options: Pick<
    DevinMcpBridgeModule.DevinSelectOptions,
    'timeoutMs' | 'intervalMs' | 'onClosed'
  >,
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
export async function listen(
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
export function forward(
  port: number,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  /** The request body when the caller already consumed the stream. */
  body?: Buffer,
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
  if (body) upstream.end(body)
  else incoming.pipe(upstream)
}

export const CURSOR_BRIDGE_MODULE_PATH = JSON.stringify(
  resolve(__dirname, '../../cursorMcpBridge.js'),
)

/** Devin's request 0 of a handshake, as the Devin bridge tests send it. */
export const DEVIN_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'devin-bridge-test', version: '1.0' },
  },
}

/** A Devin bridge process behind a proxy the test controls, as {@link startConnectedBridge} (connected) or {@link launchDevinBridge} (still starting) starts it. */
export interface ConnectedBridge {
  /** The global storage folder, the parent of the agent folder. */
  root: string
  agentDir: string
  /** The folder of the window's workspace, the bridge's working folder. */
  directory: string
  /** The initialize requests and the other requests that reached the proxy since the bridge connected ({@link startConnectedBridge}) or since its spawn ({@link launchDevinBridge}), and the `tools/list` requests per session id. */
  counts: {
    initializes: number
    others: number
    toolsListBySession: Record<string, number>
  }
  /** The status the proxy answers to every request instead of forwarding it; `undefined` forwards. */
  proxy: {
    refuseWith: number | undefined
    /** Called with the JSON-RPC method of every request (empty for a request without one), the count of initializes seen since the bridge connected (since its spawn, the one being decided included, for {@link launchDevinBridge}), the HTTP method (`DELETE` for the session release), the request's `mcp-session-id`, whether the bridge already closed the request's connection, and the response; resolves the status to answer instead of forwarding it, `undefined` forwards, `answered` when it wrote (or holds) the response itself. It may change the disk first. */
    decide?: (
      method: string,
      initializesSoFar: number,
      httpMethod: string,
      sessionId: string | undefined,
      isClientGone: () => boolean,
      outgoing: ServerResponse,
    ) => Promise<number | 'answered' | undefined>
  }
  readStderr: () => string
  /** Resolves with the exit code once the process ended. */
  exited: Promise<number | null>
  /** The JSON-RPC messages the bridge wrote to stdout so far; an answer carries `result` or `error`. */
  readMessages: () => Array<{ id?: number; result?: unknown; error?: unknown }>
  /** Makes the server forget the bridge's session, so that its next request answers 404 `Unknown MCP session`. */
  expireSession: () => Promise<void>
  /** Does the MCP handshake a client makes (request 0 `initialize`, then `initialized`). */
  handshake: () => void
  /** Writes `text` to the bridge's stdin as it is, so a test can split a message across writes. */
  write: (text: string) => void
  /** Asks `tools/list` as request `id`. */
  askToolsList: (id: number) => void
  /** Signals the bridge process (SIGUSR2) so a preload given to {@link startConnectedBridge} starts its work. */
  arm: () => void
  /** Closes the bridge's stdin, the way Devin Desktop ends a bridge. */
  closeStdin: () => void
  /** Sends a signal to the bridge process. */
  signal: (name: NodeJS.Signals) => void
}

/** What {@link launchDevinBridge} starts the bridge with. */
export interface DevinBridgeLaunch {
  /** Source of a preload script run in the bridge process; none when left out. */
  preloadSource?: string
  /** The proxy's `decide` from the bridge's first request on, its startup included (see {@link ConnectedBridge}'s `proxy`). */
  decide?: ConnectedBridge['proxy']['decide']
}

/**
 * Starts the Devin bridge entry against a real Codebook server behind a counting proxy, without waiting for anything: the arrange step of the startup tests, and the first step of {@link startConnectedBridge}.
 * It returns right after the spawn, so a caller that watches stderr for the connected line sees all of it. Its counts start at the spawn.
 * @param context - The test context; its cleanup ends a bridge that is still running first, then removes the folders and the servers.
 * @param launch - The preload and the proxy's `decide` from the start ({@link DevinBridgeLaunch}).
 * @returns The bridge's controls ({@link ConnectedBridge}) and its process.
 */
export async function launchDevinBridge(
  context: { after: (callback: () => Promise<void>) => void },
  launch: DevinBridgeLaunch,
): Promise<{ bridge: ConnectedBridge; child: ChildProcess }> {
  let now = 0
  // After-hooks run in the order they were registered: the bridge ends first, so it sends nothing to a server that is already closed.
  const running: { child?: ChildProcess } = {}
  context.after(async () => {
    const { child } = running
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const ended = new Promise((done) => child.once('exit', done))
    child.kill('SIGKILL')
    await ended
  })
  const harness = await createHarness(),
    endpoint = await startServer(harness.service, () => now),
    agentDir = await makeLiveAgentFolder(),
    root = dirname(agentDir)
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await removeTestFolder(root)
  })
  const counts: ConnectedBridge['counts'] = {
      initializes: 0,
      others: 0,
      toolsListBySession: {},
    },
    proxy: ConnectedBridge['proxy'] = {
      refuseWith: undefined,
      decide: launch.decide,
    }
  const upstreamPort = Number(new URL(endpoint.descriptor.url).port)
  const { port } = await listen(context, (incoming, outgoing) => {
    const sessionHeader = incoming.headers['mcp-session-id'],
      sessionId = typeof sessionHeader === 'string' ? sessionHeader : undefined
    let isClientGone = false
    outgoing.once('close', () => {
      isClientGone = !outgoing.writableFinished
    })
    // The request is classified once, on its whole body: one request can arrive in several data events.
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      if (body.includes('"method":"initialize"')) counts.initializes += 1
      else if (incoming.method === 'POST') counts.others += 1
      if (body.includes('"method":"tools/list"')) {
        const key = sessionId ?? 'none'
        counts.toolsListBySession[key] =
          (counts.toolsListBySession[key] ?? 0) + 1
      }
    })
    if (proxy.refuseWith !== undefined) {
      outgoing.writeHead(proxy.refuseWith)
      outgoing.end()
      return
    }
    const { decide } = proxy
    if (!decide) {
      forward(upstreamPort, incoming, outgoing)
      return
    }
    // A request the test decides on is read whole first, so its method is known before it is forwarded or refused.
    incoming.on('end', () => {
      const body = Buffer.concat(chunks)
      const method = /"method":"([^"]+)"/.exec(body.toString('utf8'))?.[1]
      void decide(
        method ?? '',
        counts.initializes,
        incoming.method ?? '',
        sessionId,
        () => isClientGone,
        outgoing,
      ).then((status) => {
        if (status === 'answered') return
        if (status === undefined) {
          forward(upstreamPort, incoming, outgoing, body)
          return
        }
        outgoing.writeHead(status)
        outgoing.end()
      })
    })
  })
  await writeDescriptor(agentDir, 0, harness.directory, process.pid, {
    ...endpoint.descriptor,
    url: `http://127.0.0.1:${port}/mcp`,
    instanceId: IDS[0],
  })
  const preloadArguments: string[] = []
  if (launch.preloadSource !== undefined) {
    const preloadPath = join(root, 'preload.js')
    await writeFile(preloadPath, launch.preloadSource)
    preloadArguments.push('--require', preloadPath)
  }
  const child = spawn(
    process.execPath,
    [
      ...preloadArguments,
      join(__dirname, '../../devinMcpBridgeEntry.js'),
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
  running.child = child
  let stderr = '',
    stdout = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  const exited = new Promise<number | null>((done) => {
    // Waits for close, not exit: stderr's last chunk can arrive after exit.
    child.on('close', (code) => done(code))
  })
  const send = (message: object): void => {
    child.stdin?.write(`${JSON.stringify(message)}\n`)
  }
  const bridge: ConnectedBridge = {
    root,
    agentDir,
    directory: harness.directory,
    counts,
    proxy,
    readStderr: () => stderr,
    exited,
    readMessages: () =>
      stdout
        // Only lines that ended with a newline are whole messages; an unfinished last line waits for the next read.
        .split('\n')
        .slice(0, -1)
        .filter((line) => line.startsWith('{'))
        .map((line) =>
          z
            .looseObject({
              id: z.number().optional(),
              result: z.unknown().optional(),
              error: z.unknown().optional(),
            })
            .parse(JSON.parse(line)),
        ),
    expireSession: async (): Promise<void> => {
      now = SESSION_IDLE_TIMEOUT_MS + 1
      await endpoint.expire()
    },
    handshake: (): void => {
      send(DEVIN_INITIALIZE_REQUEST)
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    write: (text): void => {
      child.stdin?.write(text)
    },
    askToolsList: (id): void => {
      send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} })
    },
    arm: (): void => {
      child.kill('SIGUSR2')
    },
    closeStdin: (): void => {
      child.stdin?.end()
    },
    signal: (name): void => {
      child.kill(name)
    },
  }
  return { bridge, child }
}

export const REPLACING_INSTALLATION_ID = '88888888-8888-4888-8888-888888888888'

/** How often `part` occurs in `text`, so a test can require a line exactly once. */
export function occurrencesOf(text: string, part: string): number {
  return text.split(part).length - 1
}
