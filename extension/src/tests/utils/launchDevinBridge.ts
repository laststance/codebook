import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { SESSION_IDLE_TIMEOUT_MS } from '../../constants'
import { startServer } from '../../server'
import { createHarness } from '../helpers'

import type { ConnectedBridge } from './ConnectedBridge'
import { DEVIN_INITIALIZE_REQUEST } from './DEVIN_INITIALIZE_REQUEST'
import type { DevinBridgeLaunch } from './DevinBridgeLaunch'
import { forward } from './forward'
import { IDS } from './IDS'
import { listen } from './listen'
import { makeLiveAgentFolder } from './makeLiveAgentFolder'
import { removeTestFolder } from './removeTestFolder'
import { writeDescriptor } from './writeDescriptor'

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
