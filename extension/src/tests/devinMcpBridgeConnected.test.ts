import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, realpath, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import { z } from 'zod'

import { SESSION_IDLE_TIMEOUT_MS } from '../constants'
import type * as DevinMcpBridgeModule from '../devinMcpBridge'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import { createHarness } from './helpers'
import { bridgeStopMarksPreload } from './utils/bridgeStopMarksPreload'
import { defer } from './utils/defer'
import {
  createFolders,
  writeSetupReceipts,
  writeDescriptor,
  IDS,
  listen,
  makeLiveAgentFolder,
  forward,
  REPLACING_INSTALLATION_ID,
  CURSOR_BRIDGE_MODULE_PATH,
  type ConnectedBridge,
  launchDevinBridge,
  occurrencesOf,
} from './utils/devinMcpBridgeHarness'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

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

// protects=a connected bridge ending its process once its cleanup completed after Devin closed its stdin, although a lookup of another window's descriptor never settles; fails_when=nothing ends the process, so a referenced handle of the unanswered lookup keeps the bridge alive after Devin is gone; no_claim=a real pending realpath (a referenced setInterval stands in for it)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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
    // The hanging candidate is the newer one, so its lookup always starts first; the live one is taken once the scan's wait ends.
    await utimes(hangingPath, new Date(2_000_000), new Date(2_000_000))
    await utimes(livePath, new Date(1_000_000), new Date(1_000_000))
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
      process.stderr.write('HANGING-READ-STARTED\\n')
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
        // Devin closes stdin once the transport is up and the hanging read of the other window's workspace has started, so the exit is held only by that read's referenced handle.
        if (
          stderr.includes('Codebook bridge: instance') &&
          stderr.includes('HANGING-READ-STARTED')
        )
          child.stdin.end()
      })
      child.on('exit', (code, signal) => done({ code, signal, stderr }))
    })
    // Assert
    assert.equal(result.signal, null)
    assert.equal(result.code, 0)
  },
)

// protects=a removed Devin setup not getting a new Codebook session when the old one expires; fails_when=the bridge reinitializes its upstream session without reading the setup receipts again, so a removal made in another window (whose unmark never reaches this window) still opens a session; no_claim=the removal itself (the receipts are rewritten by hand)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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
      // Waits for close, not exit: stderr's last chunk can arrive after exit.
      child.on('close', (code) => done(code))
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

// protects=the bridge's close callback running exactly once when Devin closes stdin while the reconnect check still runs and the check then refuses; fails_when=stdin EOF and the refusal each start their own cleanup notice, so the callback (which ends the entry's process) runs twice; no_claim=the real receipts read (the preload's check answers false after 800 ms)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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

/**
 * Starts the Devin bridge entry against a real Codebook server behind a counting proxy and waits for its connected line; the arrange step of the reconnect tests.
 * @param context - The test context; its cleanup removes the folders and the servers.
 * @param preloadSource - Source of a preload script run in the bridge process; none when left out.
 * @returns The running bridge with the controls of {@link ConnectedBridge}; its counts start after the connection's own handshake.
 */
async function startConnectedBridge(
  context: { after: (callback: () => Promise<void>) => void },
  preloadSource?: string,
): Promise<ConnectedBridge> {
  const { bridge, child } = await launchDevinBridge(context, { preloadSource })
  await watchConnectedLine(child).connected
  // The connection's own handshake is not counted.
  bridge.counts.initializes = 0
  bridge.counts.others = 0
  bridge.counts.toolsListBySession = {}
  return bridge
}

/**
 * Arms a receipt-hold preload and waits until its SIGUSR2 listener ran, so the receipts read the test triggers next is held; the arrange step of the tests whose preload holds receipt reads once armed.
 * The signal alone does not wait for the child: a read that started before the listener ran would bypass the hold, and the test would time out waiting for a held read instead of testing the stop.
 * @param bridge - A bridge whose preload writes `RECEIPT_HOLD_ARMED` on stderr once it is armed.
 * @example await armReceiptHold(bridge) // receipt reads that start from now on are held
 */
async function armReceiptHold(bridge: ConnectedBridge): Promise<void> {
  bridge.arm()
  await waitUntil(
    () => bridge.readStderr().includes('RECEIPT_HOLD_ARMED\n'),
    "the preload's acknowledgment that receipt reads are held",
    10_000,
    undefined,
    5,
  )
}

/**
 * Rewrites the connection descriptor of the bridge's window so that it names another installation, keeping everything else (the endpoint and the token the bridge connected with).
 * @param agentDir - The agent folder holding the descriptor.
 * @param installationId - The installation id the descriptor's mark names from now on; none removes the mark.
 */
async function markDescriptorFor(
  agentDir: string,
  installationId: string | undefined,
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

// protects=a connected bridge never opening a session with its old endpoint once the window's setup moved to another installation (Cycle 0145 task 5); fails_when=the reconnect check asks about the descriptor as it is now, so installation B's records pass while the bridge reconnects with installation A's endpoint and token; no_claim=the removal of a setup (the not-set-up test above)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
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

// protects=a connected bridge surviving a file shortage while its reconnect check reads a valid receipt (Cycle 0145 task 6); fails_when=any failed read of a receipt answers 'removed', so one EMFILE ends the bridge with the not-set-up line although nothing was removed; no_claim=a shortage at the first connection (task 13) or other failure codes (the receipt state tests)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose reconnect check meets a file shortage fails only that request, keeps running and reconnects on the next one',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // The preload fails the first open of the MCP receipt after the test created its flag file, the way a full file table would.
    const preload = `const fsPromises = require('node:fs/promises')
const { existsSync, unlinkSync } = require('node:fs')
const { dirname, join } = require('node:path')
const originalOpen = fsPromises.open
fsPromises.open = (path, ...rest) => {
  const receiptPath = String(path)
  if (receiptPath.endsWith(join('devin-mcp', 'receipt.json'))) {
    const flagPath = join(dirname(dirname(receiptPath)), 'fail-receipt-once')
    if (existsSync(flagPath)) {
      unlinkSync(flagPath)
      return Promise.reject(Object.assign(new Error('too many open files'), { code: 'EMFILE' }))
    }
  }
  return originalOpen(path, ...rest)
}
`
    const bridge = await startConnectedBridge(context, preload)
    await writeFile(join(bridge.root, 'fail-receipt-once'), '')
    bridge.handshake()
    await bridge.expireSession()
    // Act
    bridge.askToolsList(1)
    const failedRequest = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 1),
      'the failed answer of the request that met the shortage',
      20_000,
      undefined,
      20,
    )
    bridge.askToolsList(2)
    const nextRequest = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 2),
      'the answer to the next request',
      20_000,
      undefined,
      20,
    )
    // Assert
    assert.equal('error' in failedRequest, true)
    assert.equal('result' in nextRequest, true)
    assert.equal(bridge.readStderr().includes('is not set up'), false)
    assert.equal(bridge.counts.initializes, 1)
  },
)

// protects=a connected bridge reconnecting on a later request once the read that hung settled (Cycle 0145 final-range review, CodeRabbit final-range F4; revised by Codex last-round O5: while a timed-out check still hangs, a request fails at once); fails_when=the timed-out read stays shared until the raw read settles, so every later request gets the same stale timeout and the bridge never reconnects, or the hung check is never given back after it settled; no_claim=how many file reads a hung check holds (the stalled-disk test)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose reconnect check hung fails requests meanwhile, then reconnects once the read settled',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // The preload holds the first open of the MCP receipt after the test created its flag file, the way a stalled mount would, until the test arms it (SIGUSR2).
    const preload = `const fsPromises = require('node:fs/promises')
const { existsSync, unlinkSync } = require('node:fs')
const { dirname, join } = require('node:path')
const originalOpen = fsPromises.open
fsPromises.open = (path, ...rest) => {
  const receiptPath = String(path)
  if (receiptPath.endsWith(join('devin-mcp', 'receipt.json'))) {
    const flagPath = join(dirname(dirname(receiptPath)), 'hang-receipt-once')
    if (existsSync(flagPath)) {
      unlinkSync(flagPath)
      return new Promise((release) => process.once('SIGUSR2', release)).then(() => originalOpen(path, ...rest))
    }
  }
  return originalOpen(path, ...rest)
}
`
    const bridge = await startConnectedBridge(context, preload)
    await writeFile(join(bridge.root, 'hang-receipt-once'), '')
    bridge.handshake()
    await bridge.expireSession()
    // Act
    bridge.askToolsList(1)
    const failedRequest = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 1),
      'the failed answer of the request whose receipts read hung',
      20_000,
      undefined,
      20,
    )
    // The read still hangs: this request fails at once without a new read.
    bridge.askToolsList(2)
    const requestWhileHung = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 2),
      'the answer to the request while the read still hangs',
      20_000,
      undefined,
      20,
    )
    bridge.arm()
    // Each attempt asks once and reports its answer; a request that comes before the released read settled fails and the next attempt asks again.
    let nextId = 3
    const nextRequest = await waitUntil(
      async () => {
        const id = nextId
        nextId += 1
        bridge.askToolsList(id)
        const answer = await waitUntil(
          () => bridge.readMessages().find((message) => message.id === id),
          `the answer to request ${id}`,
          20_000,
          undefined,
          20,
        )
        return 'result' in answer ? answer : undefined
      },
      'a request reconnecting once the hung read settled',
      20_000,
      undefined,
      50,
    )
    // Assert
    assert.equal('error' in failedRequest, true)
    assert.equal('error' in requestWhileHung, true)
    assert.equal('result' in nextRequest, true)
    assert.equal(bridge.readStderr().includes('is not set up'), false)
    assert.equal(bridge.counts.initializes, 1)
  },
)

// protects=a Devin window whose receipts check could not tell (a read failed) reaching a retry before the first connection instead of a wrong "not set up" refusal (Cycle 0145 task 6); fails_when=a no-answer counts as a removed setup, so the wait ends with the not-set-up line; no_claim=the real read failure (the check answers no-answer from a stand-in)
test(
  'a receipts check that answers no-answer ends the wait with the could-not-check line, not the not-set-up line',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/checkDevinBridgeReceipts': {
          checkDevinBridgeReceipts: () =>
            Promise.resolve({ answer: 'no-answer' }),
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
      `Codebook could not check the AI chat setup for ${workspace} in this Devin Desktop window, because its setup records could not be read. Reload the window to try again.`,
    )
  },
)

// protects=two failures of one bridge (a 404 reconnect beside a 403 refusal) writing the refusal line once and the second failure resolving only after that line was written (Cycle 0145 review OCR2 P2); fails_when=the bridge counts as ended before its line is out, so a later caller resolves `false` at once and its shutdown can end the process before the line is written; no_claim=the wording of the line (the tests around this one)
test(
  'a second failure that arrives while the refusal line is being written waits for the line and does not write it again',
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const lines: string[] = []
    const callbacks: Array<() => void> = []
    const fakeProcess = Object.create(process, {
      // An own property, so the bridge's `exitCode = 1` does not reach this test process's real exit code.
      exitCode: { value: undefined, writable: true },
      stderr: {
        value: {
          write: (line: string, callback?: () => void): boolean => {
            lines.push(line)
            if (callback) callbacks.push(callback)
            return true
          },
        },
      },
    })
    const reconnectChecks: Array<() => Promise<boolean>> = [],
      refusedChecks: Array<() => Promise<boolean>> = []
    const answers = ['stands', 'removed']
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/checkDevinBridgeReceipts': {
          checkDevinBridgeReceipts: () =>
            Promise.resolve({ answer: answers.shift() ?? 'removed' }),
        },
        './cursorMcpBridge': {
          runCursorMcpBridge: (
            _descriptorPath: string,
            _timeoutMs: number,
            _expected: unknown,
            _header: unknown,
            _onClosed: unknown,
            beforeUpstream: () => Promise<boolean>,
            onRefused: () => Promise<boolean>,
          ) => {
            reconnectChecks.push(beforeUpstream)
            refusedChecks.push(onRefused)
            return Promise.resolve()
          },
        },
      },
      { process: fakeProcess },
    )
    await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    const reconnectCheck = reconnectChecks[0]!,
      refusedCheck = refusedChecks[0]!
    lines.length = 0
    // Act
    const first = reconnectCheck()
    await waitUntil(
      () => (lines.length === 1 ? true : undefined),
      'the refusal line being written',
      5_000,
    )
    let isSecondSettled = false
    // The refusal hook is a different function the bridge passes beside the reconnect hook; both must share one check.
    const second = refusedCheck().then((value) => {
      isSecondSettled = true
      return value
    })
    // A pause long enough for a wrongly resolved second call to settle.
    await new Promise((done) => setTimeout(done, 100))
    const wasSettledBeforeLine = isSecondSettled
    callbacks.forEach((callback) => callback())
    const results = await Promise.all([first, second])
    // Assert
    assert.equal(wasSettledBeforeLine, false)
    assert.deepEqual(results, [false, false])
    assert.equal(lines.length, 1)
  },
)

// protects=a Devin bridge whose window was unmarked (the server answers 403) ending with the not-set-up line instead of failing every request for good (Cycle 0145 task 12); fails_when=the setup check runs only for the 404 Unknown MCP session, so a 403 never reaches it and the bridge stays up; no_claim=Cursor's bridge, which passes no check (cursorMcpBridge tests)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose window was unmarked and whose server answers 403 ends with the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    await markDescriptorFor(bridge.agentDir, undefined)
    bridge.proxy.refuseWith = 403
    bridge.handshake()
    // Act
    bridge.askToolsList(1)
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(
      bridge
        .readStderr()
        .includes(
          `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(bridge.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
        ),
      true,
    )
  },
)

// protects=a Devin bridge whose token was rotated by a take-back (the server answers 401) ending with the not-set-up line; fails_when=a 401 never reaches the setup check, so the bridge stays up and fails every request; no_claim=the take-back itself (the receipts are rewritten by hand)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose setup was removed and whose server answers 401 ends with the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    await writeSetupReceipts(bridge.root, { installed: false }, false)
    bridge.proxy.refuseWith = 401
    bridge.handshake()
    // Act
    bridge.askToolsList(1)
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(
      bridge
        .readStderr()
        .includes(
          `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(bridge.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
        ),
      true,
    )
  },
)

// Value: protects=a Devin bridge ending with the not-set-up line when the server refuses the reconnect handshake (403) after an expired session, not staying up for a removed setup (Cycle 0145 /ship pass 1, p1/outside-voice#7); fails_when=only the first forwarded request runs the refusal check, so a 403 on the new session's initialize reaches the caller with no check and no exit; no_claim=the 403 of a first request (the test above)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose reconnect handshake is refused with 403 after the setup was removed ends with the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    // The receipts are removed only when the new session's initialize arrives, after the reconnect check passed.
    bridge.proxy.decide = async (method) => {
      if (method !== 'initialize') return undefined
      await writeSetupReceipts(bridge.root, { installed: false }, false)
      return 403
    }
    bridge.handshake()
    await bridge.expireSession()
    // Act
    bridge.askToolsList(1)
    const exitCode = await within(bridge.exited, 15_000)
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(bridge.readStderr().includes('AI chat is not set up'), true)
  },
)

// Value: protects=a Devin bridge ending with the not-set-up line when the single replay after a reconnect is refused with 403 (Cycle 0145 /ship pass 1, p1/outside-voice#7); fails_when=the replay escapes the refusal handling, so the caller gets the 403 and the bridge stays up for a removed setup; no_claim=a refused request being sent a third time (it never is)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose replayed request is refused with 403 after the setup was removed ends with the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    // The reconnect succeeds; the setup is removed while the replay is on its way.
    bridge.proxy.decide = async (method, initializesSoFar) => {
      if (method !== 'tools/list' || initializesSoFar === 0) return undefined
      await writeSetupReceipts(bridge.root, { installed: false }, false)
      return 403
    }
    bridge.handshake()
    await bridge.expireSession()
    // Act
    bridge.askToolsList(1)
    const exitCode = await within(bridge.exited, 15_000)
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(bridge.readStderr().includes('AI chat is not set up'), true)
  },
)

// Value: protects=the refusal line and exit code 1 of a Devin bridge whose stdin closes while its 403 receipt check is still reading (Cycle 0145 /ship pass 1, Codex structured P1 shutdown); fails_when=shutdown waits only for a reconnect, so the process exits 0 before the check wrote its line; no_claim=a refusal after the bridge ended
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose stdin closes while the 403 setup check is reading still ends with exit code 1 and the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // The preload holds the receipt reads that start after it is armed for a moment and says when it was armed and when the first one started.
    const preload = `const fsPromises = require('node:fs/promises')
const { writeSync } = require('node:fs')
const originalOpen = fsPromises.open
let isArmed = false
process.on('SIGUSR2', () => { isArmed = true; writeSync(2, 'RECEIPT_HOLD_ARMED\\n') })
fsPromises.open = async (path, ...rest) => {
  if (isArmed && String(path).endsWith('receipt.json')) {
    writeSync(2, 'RECEIPT_READ_HELD\\n')
    await new Promise((done) => setTimeout(done, 700))
  }
  return originalOpen(path, ...rest)
}
`
    const bridge = await startConnectedBridge(context, preload)
    await writeSetupReceipts(bridge.root, { installed: false }, false)
    await armReceiptHold(bridge)
    bridge.proxy.refuseWith = 403
    bridge.handshake()
    bridge.askToolsList(1)
    await waitUntil(
      () =>
        bridge.readStderr().includes('RECEIPT_READ_HELD') ? true : undefined,
      'the receipt check starting to read',
      10_000,
      undefined,
      10,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(bridge.readStderr().includes('AI chat is not set up'), true)
  },
)

// Value: protects=the refusal line and exit code 1 of a Devin bridge whose request is answered 403 while its upstream session is being released after stdin closed (Cycle 0145 final-range review, CodeRabbit final-range F3); fails_when=shutdown drains only the refusal checks present when stdin closed, so the check this 403 starts is not awaited and the process ends before its line with exit code 0; no_claim=a refusal that arrives after the upstream is released
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose request is answered 403 during the session release after stdin closed still ends with exit code 1 and the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // The preload holds the receipt reads that start after it is armed, so the check outlives the release, and says when it was armed.
    const preload = `const fsPromises = require('node:fs/promises')
const { writeSync } = require('node:fs')
const originalOpen = fsPromises.open
let isArmed = false
process.on('SIGUSR2', () => { isArmed = true; writeSync(2, 'RECEIPT_HOLD_ARMED\\n') })
fsPromises.open = async (path, ...rest) => {
  if (isArmed && String(path).endsWith('receipt.json'))
    await new Promise((done) => setTimeout(done, 700))
  return originalOpen(path, ...rest)
}
`
    const bridge = await startConnectedBridge(context, preload)
    await writeSetupReceipts(bridge.root, { installed: false }, false)
    await armReceiptHold(bridge)
    // The proxy holds the tools/list request until the test says and tells when it holds it; the session release is recognised by its HTTP DELETE, which is then forwarded.
    let releaseToolsList: () => void = () => undefined,
      markToolsListHeld: () => void = () => undefined,
      markDeleteSeen: () => void = () => undefined
    const toolsListRelease = new Promise<void>((done) => {
      releaseToolsList = done
    })
    const toolsListHeld = new Promise<void>((done) => {
      markToolsListHeld = done
    })
    const deleteSeen = new Promise<void>((done) => {
      markDeleteSeen = done
    })
    bridge.proxy.decide = async (method, _initializes, httpMethod) => {
      if (method === 'tools/list') {
        markToolsListHeld()
        await toolsListRelease
        return 403
      }
      if (httpMethod === 'DELETE') {
        markDeleteSeen()
        await new Promise((done) => setTimeout(done, 300))
      }
      return undefined
    }
    bridge.handshake()
    bridge.askToolsList(1)
    // stdin closes only after the proxy holds the request, so the 403 can only arrive during the release.
    await toolsListHeld
    // Act
    bridge.closeStdin()
    await deleteSeen
    releaseToolsList()
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(bridge.readStderr().includes('AI chat is not set up'), true)
  },
)

/**
 * Starts a connected bridge whose `tools/list` is held at the proxy, expires the session, closes stdin and releases the request during the session release, so the server answers it 404 `Unknown MCP session` after shutdown began.
 * @param context - The test context that cleans the bridge up.
 * @param isSetupRemoved - Whether the setup receipts are removed just before the held request is released.
 * @returns The bridge, after the proxy held the request, stdin closed and the session DELETE reached the proxy.
 */
async function startBridgeWith404DuringRelease(
  context: Parameters<typeof startConnectedBridge>[0],
  isSetupRemoved: boolean,
): Promise<ConnectedBridge> {
  const bridge = await startConnectedBridge(context)
  let releaseToolsList: () => void = () => undefined,
    markToolsListHeld: () => void = () => undefined,
    markDeleteSeen: () => void = () => undefined
  const toolsListRelease = new Promise<void>((done) => {
    releaseToolsList = done
  })
  const toolsListHeld = new Promise<void>((done) => {
    markToolsListHeld = done
  })
  const deleteSeen = new Promise<void>((done) => {
    markDeleteSeen = done
  })
  bridge.proxy.decide = async (method, _initializes, httpMethod) => {
    if (method === 'tools/list') {
      markToolsListHeld()
      await toolsListRelease
    }
    if (httpMethod === 'DELETE') {
      markDeleteSeen()
      // The release is forwarded only after the bridge answered the held request, so the 404 is handled while the release is still pending.
      await waitUntil(
        () => bridge.readMessages().find((message) => message.id === 1),
        'the answer to the held request',
        20_000,
        undefined,
        10,
      )
    }
    return undefined
  }
  bridge.handshake()
  bridge.askToolsList(1)
  await toolsListHeld
  // The server forgets the session, so the held request is answered 404 Unknown MCP session when it is forwarded.
  await bridge.expireSession()
  bridge.closeStdin()
  await deleteSeen
  if (isSetupRemoved)
    await writeSetupReceipts(bridge.root, { installed: false }, false)
  releaseToolsList()
  return bridge
}

// protects=a Devin bridge opening no new session once its shutdown began (Cycle 0145 last-round review, Codex structured review cursorMcpBridge.ts); fails_when=a request answered 404 Unknown MCP session while the session is released starts a reconnect, so the setup check passes and a new initialize reaches the server after stdin closed; no_claim=the setup removal path (next test)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose request gets 404 during the session release after stdin closed opens no new session',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // Act
    const bridge = await startBridgeWith404DuringRelease(context, false)
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(bridge.counts.initializes, 0)
  },
)

// protects=the not-set-up line and exit code 1 of a Devin bridge whose request gets 404 during the session release after stdin closed while the setup was removed (Cycle 0145 last-round review, Codex structured review cursorMcpBridge.ts); fails_when=the reconnect's setup check is not drained before the bridge ends, so the process exits 0 before the line; no_claim=a standing setup (previous test)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose request gets 404 during the session release after stdin closed and whose setup was removed still ends with exit code 1 and the not-set-up line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // Act
    const bridge = await startBridgeWith404DuringRelease(context, true)
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(bridge.readStderr().includes('AI chat is not set up'), true)
    assert.equal(bridge.counts.initializes, 0)
  },
)

/**
 * Source of a preload that holds every setup receipts read of the bridge, once the test armed it (SIGUSR2, acknowledged with `RECEIPT_HOLD_ARMED`), until the bridge's stop itself, and marks on stderr when a read is held (`RECEIPT_READ_HELD`), when the stop came (`STOP_SEEN <end|SIGTERM|SIGINT>`) and what the reconnect check answered (`SETUP_CHECK_ANSWERED <true|false>`, `SETUP_CHECK_FAILED`).
 * Its stop listeners are registered before the bridge's, so a held read continues only after the bridge's own handler ran in the same emit. They also keep a signalled process alive by themselves: only the bridge's own shutdown ends it.
 */
const HOLD_RECEIPTS_UNTIL_STOP_PRELOAD = `const fsPromises = require('node:fs/promises')
const { writeSync } = require('node:fs')
const cursorBridge = require(${CURSOR_BRIDGE_MODULE_PATH})
const originalOpen = fsPromises.open
let isArmed = false
process.on('SIGUSR2', () => { isArmed = true; writeSync(2, 'RECEIPT_HOLD_ARMED\\n') })
const stopped = new Promise((done) => {
  const stopOn = (name) => () => { writeSync(2, 'STOP_SEEN ' + name + '\\n'); done() }
  process.stdin.once('end', stopOn('end'))
  process.once('SIGTERM', stopOn('SIGTERM'))
  process.once('SIGINT', stopOn('SIGINT'))
})
fsPromises.open = async (path, ...rest) => {
  if (isArmed && String(path).endsWith('receipt.json')) {
    writeSync(2, 'RECEIPT_READ_HELD\\n')
    await stopped
  }
  return originalOpen(path, ...rest)
}
const original = cursorBridge.runCursorMcpBridge
cursorBridge.runCursorMcpBridge = (descriptorPath, timeoutMs, expected, header, onClosed, beforeUpstream, onRefused) =>
  original(descriptorPath, timeoutMs, expected, header, onClosed,
    () => beforeUpstream().then(
      (stands) => { writeSync(2, 'SETUP_CHECK_ANSWERED ' + stands + '\\n'); return stands },
      (error) => { writeSync(2, 'SETUP_CHECK_FAILED\\n'); throw error }),
    onRefused)
`

/** Source of a preload that gives the bridge entry a 60 s startup budget, so the handshake of a reconnect may last far longer than any stop test waits; the entry's `onClosed` is kept. */
const LONG_STARTUP_BUDGET_PRELOAD = `const bridge = require(${JSON.stringify(resolve(__dirname, '../devinMcpBridge.js'))})
const original = bridge.runDevinMcpBridge
bridge.runDevinMcpBridge = (agentDirectory, cwd, env, options) =>
  original(agentDirectory, cwd, env, { ...options, timeoutMs: 60_000 })
`

// Value: protects=no new session for a Devin client that has gone, when stdin closes while the reconnect check reads a setup that stands (Cycle 0146 task 7); fails_when=the check that stands after the end of input still lets the replacement initialize reach the server; no_claim=a removed setup (the 404-during-release tests above), a signal (the guards below)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose stdin closes while its reconnect setup check is reading opens no new session',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(
      context,
      HOLD_RECEIPTS_UNTIL_STOP_PRELOAD,
    )
    await armReceiptHold(bridge)
    bridge.handshake()
    await bridge.expireSession()
    bridge.askToolsList(1)
    await waitUntil(
      () => bridge.readStderr().includes('RECEIPT_READ_HELD'),
      'the reconnect check reading the receipts',
      10_000,
      undefined,
      10,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await bridge.exited
    // Assert
    // The held check answered that the setup stands, after the stop: a check that timed out before it would prove nothing.
    assert.match(
      bridge.readStderr(),
      /STOP_SEEN end\n[\s\S]*SETUP_CHECK_ANSWERED true\n/,
    )
    assert.equal(exitCode, 0)
    assert.equal(bridge.counts.initializes, 0)
  },
)

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  // Value: protects=the bridge's own signal handler stopping a Devin bridge whose reconnect check is reading, with no new session (Cycle 0146 task 7 guard; Codex review of v3 for SIGINT); fails_when=the bridge's handler for this signal is gone (the preload's own listener keeps the process alive, so only the bridge's shutdown ends it with code 0) or the check that stands then opens a session; no_claim=end of input (the test above), a removed setup (the guards below)
  // Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
  test(
    `a connected bridge that gets ${signal} while its reconnect setup check is reading opens no new session and exits with code 0`,
    { skip: process.platform === 'win32', timeout: 40_000 },
    async (context) => {
      // Arrange
      const bridge = await startConnectedBridge(
        context,
        HOLD_RECEIPTS_UNTIL_STOP_PRELOAD,
      )
      await armReceiptHold(bridge)
      bridge.handshake()
      await bridge.expireSession()
      bridge.askToolsList(1)
      await waitUntil(
        () => bridge.readStderr().includes('RECEIPT_READ_HELD'),
        'the reconnect check reading the receipts',
        10_000,
        undefined,
        10,
      )
      // Act
      bridge.signal(signal)
      const exitCode = await bridge.exited
      // Assert
      assert.match(
        bridge.readStderr(),
        new RegExp(
          `STOP_SEEN ${signal}\\n[\\s\\S]*SETUP_CHECK_ANSWERED true\\n`,
        ),
      )
      assert.equal(exitCode, 0)
      assert.equal(bridge.counts.initializes, 0)
    },
  )
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  for (const check of ['403 refusal', 'reconnect setup'] as const) {
    // Value: protects=the whole not-set-up line, written once, and exit code 1 of a Devin bridge signalled while a setup check reads a removed setup (Cycle 0146 task 7 guard: the stop's abort keeps this order); fails_when=the signal's cleanup ends the process before the check, or writes the line twice; no_claim=the bridge's own handler for the signal (the preload's listener keeps the process alive, the standing-setup tests above prove the handler)
    // Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
    test(
      `a connected bridge that gets ${signal} while its ${check} check is reading still writes the whole not-set-up line once and exits with code 1`,
      { skip: process.platform === 'win32', timeout: 40_000 },
      async (context) => {
        // Arrange
        const bridge = await startConnectedBridge(
          context,
          HOLD_RECEIPTS_UNTIL_STOP_PRELOAD,
        )
        await writeSetupReceipts(bridge.root, { installed: false }, false)
        await armReceiptHold(bridge)
        if (check === '403 refusal') bridge.proxy.refuseWith = 403
        bridge.handshake()
        if (check === 'reconnect setup') await bridge.expireSession()
        bridge.askToolsList(1)
        await waitUntil(
          () => bridge.readStderr().includes('RECEIPT_READ_HELD'),
          'the setup check reading the receipts',
          10_000,
          undefined,
          10,
        )
        // Act
        bridge.signal(signal)
        const exitCode = await bridge.exited
        // Assert
        assert.equal(exitCode, 1)
        assert.equal(
          occurrencesOf(
            bridge.readStderr(),
            `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(bridge.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
          ),
          1,
        )
        assert.equal(bridge.counts.initializes, 0)
      },
    )
  }
}

for (const [setup, title] of [
  [
    'stands',
    'a connected bridge whose requests got 404 while it released its old session after the reconnect replays nothing on the new session once stdin closed',
  ],
  [
    'was removed',
    'a connected bridge whose setup was removed while it released its old session after the reconnect replays nothing once stdin closed and ends with the not-set-up line once',
  ],
] as const) {
  // Value: protects=no replay reaching the server after Devin closed the bridge, for requests that waited for a reconnect, and the not-set-up line of a setup removed meanwhile (Cycle 0146 task 7; Codex reviews of v2 F2 and of v3); fails_when=a waiting request is sent again on the new session after stdin closed, or the stop suppresses that replay without a setup check, so a removed setup ends with exit code 0 and no line; no_claim=a replay before the stop (still sent)
  // Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
  test(
    title,
    { skip: process.platform === 'win32', timeout: 40_000 },
    async (context) => {
      // Arrange
      const bridge = await startConnectedBridge(
        context,
        bridgeStopMarksPreload(),
      )
      const heldToolsLists: Array<() => void> = [],
        oldRelease = defer<void>()
      let oldSessionId: string | undefined,
        heldRelease: { isClientGone: () => boolean } | undefined
      bridge.proxy.decide = async (
        method,
        initializesSoFar,
        httpMethod,
        sessionId,
        isClientGone,
      ) => {
        if (method === 'tools/list' && initializesSoFar === 0) {
          oldSessionId = sessionId
          const held = defer<void>()
          heldToolsLists.push(held.resolve)
          await held.promise
          return undefined
        }
        if (httpMethod === 'DELETE' && sessionId === oldSessionId) {
          heldRelease = { isClientGone }
          await oldRelease.promise
        }
        return undefined
      }
      bridge.handshake()
      bridge.askToolsList(1)
      bridge.askToolsList(2)
      await waitUntil(
        () => heldToolsLists.length === 2,
        'both requests held on the old session',
        10_000,
        undefined,
        5,
      )
      // The server forgets the session, so both held requests are answered 404 Unknown MCP session when they are forwarded.
      await bridge.expireSession()
      // Act
      // The first 404 opens the new session; the reconnect then waits at the release of the old one.
      heldToolsLists[0]!()
      const release = await waitUntil(
        () => heldRelease,
        'the release of the old session',
        10_000,
        undefined,
        5,
      )
      if (setup === 'was removed')
        await writeSetupReceipts(bridge.root, { installed: false }, false)
      // The second 404 arrives while the old session is released, so its request waits for the reconnect.
      heldToolsLists[1]!()
      await waitUntil(
        () => bridge.readStderr().includes('UNKNOWN_SESSION_REJECTED 2\n'),
        'the second request waiting for the reconnect',
        10_000,
        undefined,
        5,
      )
      bridge.closeStdin()
      await waitUntil(
        () => bridge.readStderr().includes('STDIN_END_SEEN\n'),
        'the bridge seeing the end of its input',
        10_000,
        undefined,
        5,
      )
      const wasReleasePending = !release.isClientGone()
      oldRelease.resolve()
      const exitCode = await bridge.exited
      // Assert
      // The endpoint had not seen the bridge drop the release of the old session when the bridge saw the end of its input; the flag says nothing more about where the two requests were waiting.
      assert.equal(wasReleasePending, true)
      assert.equal(exitCode, setup === 'was removed' ? 1 : 0)
      assert.deepEqual(bridge.counts.toolsListBySession, {
        [oldSessionId ?? 'none']: 2,
      })
      assert.equal(bridge.counts.initializes, 1)
      assert.equal(
        occurrencesOf(
          bridge.readStderr(),
          `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(bridge.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
        ),
        setup === 'was removed' ? 1 : 0,
      )
    },
  )
}

for (const stop of ['stdin closes', 'it gets SIGTERM'] as const) {
  // Value: protects=a prompt end of a Devin bridge whose client has gone, also while the replacement session's initialize is unanswered (Cycle 0146 task 7; Codex review of v2 F6); fails_when=the stop waits for the replacement handshake, whose budget is the bridge's remaining startup time (60 s here); no_claim=the release of a replacement session the server named (Cursor bridge tests)
  // Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
  test(
    `a connected bridge ends within 8 seconds when ${stop} while its replacement initialize is unanswered`,
    { skip: process.platform === 'win32', timeout: 40_000 },
    async (context) => {
      // Arrange
      const bridge = await startConnectedBridge(
        context,
        LONG_STARTUP_BUDGET_PRELOAD,
      )
      const initializeHeld = defer<void>(),
        releasedSessions: string[] = []
      let oldSessionId: string | undefined
      bridge.proxy.decide = async (
        method,
        initializesSoFar,
        httpMethod,
        sessionId,
      ) => {
        if (method === 'tools/list') oldSessionId = sessionId
        if (httpMethod === 'DELETE') releasedSessions.push(sessionId ?? 'none')
        if (method !== 'initialize' || initializesSoFar !== 1) return undefined
        initializeHeld.resolve()
        // Never answered.
        return new Promise<undefined>(() => undefined)
      }
      bridge.handshake()
      await bridge.expireSession()
      bridge.askToolsList(1)
      await initializeHeld.promise
      // Act
      if (stop === 'stdin closes') bridge.closeStdin()
      else bridge.signal('SIGTERM')
      const exitCode = await within(bridge.exited, 8_000)
      // Assert
      assert.equal(exitCode, 0)
      assert.deepEqual(releasedSessions, [oldSessionId ?? 'none'])
      assert.equal(bridge.counts.initializes, 1)
    },
  )
}

for (const [change, stop, title] of [
  [
    'removed',
    'stdin closes',
    'a connected bridge whose stdin closes while its replacement initialize waits, after the setup was removed, ends with the not-set-up line once and exit code 1',
  ],
  [
    'replaced',
    'stdin closes',
    'a connected bridge whose stdin closes while its replacement initialize waits, after the setup was replaced, ends with the replaced line once and exit code 1',
  ],
  [
    'removed',
    'it gets SIGTERM',
    'a connected bridge that gets SIGTERM while its replacement initialize waits, after the setup was removed, ends with the not-set-up line once and exit code 1',
  ],
] as const) {
  // Value: protects=the refusal line and exit code 1 of a Devin bridge whose replacement handshake a stop cut short after the setup was removed or replaced (Cycle 0146 task 7; Codex review of v2 F1); fails_when=a stop during the handshake ends the bridge with exit code 0 and no line, because the cut handshake is no refusal and no check runs; no_claim=a server 401 or 403 (the reconnect-handshake refusal test above)
  // Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
  test(
    title,
    { skip: process.platform === 'win32', timeout: 40_000 },
    async (context) => {
      // Arrange
      const bridge = await startConnectedBridge(context)
      const initializeHeld = defer<void>()
      bridge.proxy.decide = async (method, initializesSoFar) => {
        if (method !== 'initialize' || initializesSoFar !== 1) return undefined
        // The setup changes after the reconnect check passed, while the new session's initialize waits.
        if (change === 'replaced') {
          await markDescriptorFor(bridge.agentDir, REPLACING_INSTALLATION_ID)
          await writeSetupReceipts(bridge.root, {
            installationId: REPLACING_INSTALLATION_ID,
          })
        } else
          await writeSetupReceipts(bridge.root, { installed: false }, false)
        initializeHeld.resolve()
        // Never answered.
        return new Promise<undefined>(() => undefined)
      }
      bridge.handshake()
      await bridge.expireSession()
      bridge.askToolsList(1)
      await initializeHeld.promise
      // Act
      if (stop === 'stdin closes') bridge.closeStdin()
      else bridge.signal('SIGTERM')
      const exitCode = await within(bridge.exited, 15_000)
      // Assert
      const directory = await realpath(bridge.directory)
      assert.equal(exitCode, 1)
      assert.equal(
        occurrencesOf(
          bridge.readStderr(),
          change === 'replaced'
            ? `Codebook's AI chat setup for ${directory} changed in this Devin Desktop window after this bridge connected. Reload the window.\n`
            : `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${directory}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
        ),
        1,
      )
      assert.equal(
        bridge.readStderr().includes('is not set up'),
        change === 'removed',
      )
      assert.equal(bridge.counts.initializes, 1)
    },
  )
}

// Value: protects=the not-set-up line and exit code 1 of a Devin bridge whose replayed request was being refused (403 headers in, body still arriving) when Devin closed it, after its setup was removed (Cycle 0146 task 7, Codex review of v3); fails_when=the final close turns that request into 'Connection closed', so no refusal check runs and the bridge exits 0 without the line; no_claim=a 403 whose answer was read before the close (the 403-during-release test above)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose replayed request is being refused when stdin closes, after its setup was removed, still ends with the not-set-up line once and exit code 1',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context, bridgeStopMarksPreload())
    bridge.proxy.decide = async (
      method,
      initializesSoFar,
      _httpMethod,
      _sessionId,
      _isClientGone,
      outgoing,
    ) => {
      if (method !== 'tools/list' || initializesSoFar === 0) return undefined
      await writeSetupReceipts(bridge.root, { installed: false }, false)
      // The refusal's headers go out at once; its body never comes.
      outgoing.writeHead(403, { 'content-type': 'text/plain' })
      outgoing.flushHeaders()
      return 'answered'
    }
    bridge.handshake()
    await bridge.expireSession()
    bridge.askToolsList(1)
    await waitUntil(
      () => bridge.readStderr().includes('REFUSAL_HEADERS_SEEN\n'),
      'the bridge holding the headers of the refused replay',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 15_000)
    // Assert
    assert.equal(exitCode, 1)
    assert.equal(
      occurrencesOf(
        bridge.readStderr(),
        `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(bridge.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
      ),
      1,
    )
  },
)

/** Source of a preload that marks on stderr each answer of the bridge's refusal hook (`REFUSAL_CHECK_ANSWERED <true|false>`): the check a stop runs for a handshake it cut short, a request it suppressed or one its final close interrupts. The reconnect's own check (`beforeUpstream`) is not marked. */
const MARK_REFUSAL_CHECKS_PRELOAD = `const { writeSync } = require('node:fs')
const cursorBridge = require(${CURSOR_BRIDGE_MODULE_PATH})
const original = cursorBridge.runCursorMcpBridge
cursorBridge.runCursorMcpBridge = (descriptorPath, timeoutMs, expected, header, onClosed, beforeUpstream, onRefused) =>
  original(descriptorPath, timeoutMs, expected, header, onClosed, beforeUpstream,
    () => onRefused().then((stands) => { writeSync(2, 'REFUSAL_CHECK_ANSWERED ' + stands + '\\n'); return stands }))
`

// Value: protects=the not-set-up line and exit code 1 of a Devin bridge whose setup was removed after its stop's first setup check stood, when the stop's final close interrupts a request still in flight (Cycle 0146 review round, OCR lens 3 cursorMcpBridge.ts:231); fails_when=the stop keeps the settled answer of its first check, so the interrupted request reuses `stands` and the bridge exits 0 with no line; no_claim=a removal after the final close (nothing checks then), a check that hangs (the stalled-disk tests)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose setup was removed after its stop check stood still ends with the not-set-up line once and exit code 1 when the final close interrupts a request',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(
      context,
      MARK_REFUSAL_CHECKS_PRELOAD,
    )
    const initializeHeld = defer<void>(),
      requestHeld = defer<void>()
    let toolsLists = 0
    bridge.proxy.decide = async (method, initializesSoFar, httpMethod) => {
      if (method === 'tools/list') toolsLists += 1
      // The second request stays in flight on the old session until the final close interrupts it.
      if (method === 'tools/list' && toolsLists === 2) {
        requestHeld.resolve()
        return new Promise<undefined>(() => undefined)
      }
      // The replacement's initialize is never answered, so the stop cuts it short and runs its first setup check then.
      if (method === 'initialize' && initializesSoFar === 1) {
        initializeHeld.resolve()
        return new Promise<undefined>(() => undefined)
      }
      // The old session's release comes after that check settled: the setup is removed before the release is forwarded.
      if (httpMethod === 'DELETE')
        await writeSetupReceipts(bridge.root, { installed: false }, false)
      return undefined
    }
    bridge.handshake()
    await bridge.expireSession()
    bridge.askToolsList(1)
    await initializeHeld.promise
    bridge.askToolsList(2)
    await requestHeld.promise
    // Act
    bridge.signal('SIGTERM')
    const exitCode = await within(bridge.exited, 15_000)
    // Assert
    // The stop's first check stood before the removal, and a later one saw the removal.
    assert.match(
      bridge.readStderr(),
      /REFUSAL_CHECK_ANSWERED true\n[\s\S]*REFUSAL_CHECK_ANSWERED false\n/,
    )
    assert.equal(exitCode, 1)
    assert.equal(
      occurrencesOf(
        bridge.readStderr(),
        `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${await realpath(bridge.directory)}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
      ),
      1,
    )
    assert.equal(bridge.counts.initializes, 1)
  },
)

// protects=exit code 1 of a Devin bridge that confirmed a removed setup, when SIGTERM arrives while its refusal line is still being written (Cycle 0145 /ship pass 1, Codex structured P1 signal); fails_when=the signal cleanup sets exit code 0 over the refusal's 1; no_claim=the line reaching Devin Desktop's stderr pipe
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge that gets SIGTERM while its not-set-up line is being written still exits with code 1',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // The preload writes the refusal line at once but calls its write back only after 1.5 s, and says when the line was written.
    const preload = `const { writeSync } = require('node:fs')
const originalWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = (chunk, callback) => {
  if (!String(chunk).includes('is not set up')) return originalWrite(chunk, callback)
  writeSync(2, 'REFUSAL_WRITE_HELD\\n')
  originalWrite(chunk)
  setTimeout(callback, 1_500)
  return true
}
`
    const bridge = await startConnectedBridge(context, preload)
    await writeSetupReceipts(bridge.root, { installed: false }, false)
    bridge.proxy.refuseWith = 403
    bridge.handshake()
    bridge.askToolsList(1)
    await waitUntil(
      () =>
        bridge.readStderr().includes('REFUSAL_WRITE_HELD') ? true : undefined,
      'the refusal line being written',
      10_000,
      undefined,
      10,
    )
    // Act
    bridge.signal('SIGTERM')
    const exitCode = await bridge.exited
    // Assert
    assert.equal(exitCode, 1)
  },
)

// protects=a refusal of one request (403) not ending a bridge whose setup stands, and its request not being sent twice; fails_when=the bridge ends on any 403, or replays the request after the check; no_claim=what the server's refusal means
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a connected bridge whose setup stands fails only the request the server answered 403 and does not send it again',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const bridge = await startConnectedBridge(context)
    bridge.proxy.refuseWith = 403
    bridge.handshake()
    // Act
    // Requests of the handshake are not counted against the two below.
    const othersBeforeRequests = bridge.counts.others
    bridge.askToolsList(1)
    const failedRequest = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 1),
      'the failed answer of the refused request',
      20_000,
      undefined,
      20,
    )
    // The server accepts again: a bridge that stayed up answers the next request.
    bridge.proxy.refuseWith = undefined
    bridge.askToolsList(2)
    const nextRequest = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 2),
      'the answer to the next request',
      20_000,
      undefined,
      20,
    )
    // Assert
    assert.equal('error' in failedRequest, true)
    assert.equal('result' in nextRequest, true)
    assert.equal(bridge.readStderr().includes('is not set up'), false)
    // One request refused, one answered: the refused one was not sent twice.
    assert.equal(bridge.counts.others - othersBeforeRequests, 2)
  },
)

// protects=a file shortage at the first connection's descriptor read counting as transient, so the same descriptor is tried again (Cycle 0145 task 13); fails_when=an EMFILE there answers dropped and the selection excludes the only descriptor until the startup deadline, so the bridge never connects; no_claim=the shortage in the scan's own read (readDescriptorFile retries that one) or ENFILE (same predicate)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a bridge whose first descriptor read for the connection meets a file shortage connects to the same descriptor on the retry',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    // The preload fails the first descriptor read made for the connection (the one under readBridgeDescriptor), the way a full file table would.
    const preload = `const fsPromises = require('node:fs/promises')
const { writeSync } = require('node:fs')
const originalOpen = fsPromises.open
let hasFailed = false
fsPromises.open = (path, ...rest) => {
  const isConnectionRead = String(path).endsWith('.connection.json') && new Error().stack.includes('readBridgeDescriptor')
  if (isConnectionRead && !hasFailed) {
    hasFailed = true
    writeSync(2, 'SHORTAGE_INJECTED\\n')
    return Promise.reject(Object.assign(new Error('too many open files'), { code: 'EMFILE' }))
  }
  return originalOpen(path, ...rest)
}
`
    // Act
    const bridge = await startConnectedBridge(context, preload)
    // Assert
    assert.equal(bridge.readStderr().includes('SHORTAGE_INJECTED'), true)
  },
)
