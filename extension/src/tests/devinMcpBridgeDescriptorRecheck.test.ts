import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, realpath, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import type { runCursorMcpBridge } from '../cursorMcpBridge'
import type * as DevinMcpBridgeModule from '../devinMcpBridge'
import type { checkDevinBridgeReceipts } from '../utils/checkDevinBridgeReceipts'
import {
  DescriptorMarkChangedError,
  readBridgeDescriptor,
} from '../utils/readBridgeDescriptor'
import { createPathReadGate } from '../utils/shareReceiptRead'

import { createFolders } from './utils/createFolders'
import { INSTALLATION_ID } from './utils/INSTALLATION_ID'
import { instanceIdOf } from './utils/instanceIdOf'
import { listen } from './utils/listen'
import { loadModule } from './utils/loadModule'
import { REPLACING_INSTALLATION_ID } from './utils/REPLACING_INSTALLATION_ID'
import { writeDescriptor } from './utils/writeDescriptor'
import { writeSetupReceipts } from './utils/writeSetupReceipts'

/** What a stand-in for the shared stdio bridge saw of one connection the Devin bridge made. */
interface SeenConnection {
  expected: Parameters<typeof runCursorMcpBridge>[2]
  beforeUpstream: Parameters<typeof runCursorMcpBridge>[5]
  onRefused: Parameters<typeof runCursorMcpBridge>[6]
}

// protects=a Devin bridge binding every later check to the installation id its descriptor carried when it was selected (Cycle 0145 /ship pass 1, FX6 item 1); fails_when=a descriptor selected before it gained its mark leaves the binding's id undefined, so a later installation at the same endpoint satisfies that wildcard and the bridge reconnects with it; no_claim=a rotated token of the same installation (closed by Devin Desktop restarting the bridge on the failed request)
test(
  'a descriptor that gains its installation id after the bridge read it is selected again and every later check binds that id',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const storageRoot = dirname(agentDir)
    await writeSetupReceipts(storageRoot, {
      installationId: REPLACING_INSTALLATION_ID,
    })
    // The descriptor carries no installation id when the bridge reads it.
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      devinSetupInstallation: undefined,
    })
    let isMarked = false
    const seen: SeenConnection[] = []
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: (
            _path: string,
            _timeoutMs: number,
            expected: SeenConnection['expected'],
            _header: unknown,
            _onClosed: unknown,
            beforeUpstream: SeenConnection['beforeUpstream'],
            onRefused: SeenConnection['onRefused'],
          ) => {
            seen.push({ expected, beforeUpstream, onRefused })
            return Promise.resolve()
          },
        },
        './utils/evidenceInUseElsewhere': {
          // Runs after the candidate was read: setup marks the descriptor right then.
          isDescriptorOwnerGone: async () => {
            if (!isMarked) {
              isMarked = true
              await writeDescriptor(agentDir, 0, workspace, process.pid, {
                devinSetupInstallation: REPLACING_INSTALLATION_ID,
              })
            }
            return false
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 5_000, intervalMs: 20 },
    )
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      devinSetupInstallation: INSTALLATION_ID,
    })
    await writeSetupReceipts(storageRoot, { installationId: INSTALLATION_ID })
    // The replaced-path refusal sets this process's exit code; restore it so the test file does not end with exit code 1.
    const originalExitCode = process.exitCode
    context.after(() => {
      process.exitCode = originalExitCode
    })
    const standsForOtherInstallation = await seen[0]?.beforeUpstream?.()
    // Assert
    assert.equal(refusal, undefined)
    assert.equal(
      seen[0]?.expected?.devinSetupInstallation,
      REPLACING_INSTALLATION_ID,
    )
    assert.equal(standsForOtherInstallation, false)
  },
)

// protects=a window whose setup re-marks the descriptor between the bridge's receipts check and its final descriptor read still getting a connection within the startup wait (Cycle 0145 /ship pass 1, FX6 item 2); fails_when=the identity-change error of that read drops the path for the whole startup, so the bridge ends with the not-running line; no_claim=a descriptor that keeps changing until the deadline
test(
  'a descriptor re-marked between the receipts check and the connection read is selected and connected on a later attempt',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const storageRoot = dirname(agentDir)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const connectedFor: (string | undefined)[] = []
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          // The first connection reads the descriptor after setup re-marked it, as the real bridge does; the second finds the new mark.
          runCursorMcpBridge: async (
            path: string,
            timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            if (connectedFor.length === 0) {
              await writeDescriptor(agentDir, 0, workspace, process.pid, {
                devinSetupInstallation: REPLACING_INSTALLATION_ID,
              })
              await writeSetupReceipts(storageRoot, {
                installationId: REPLACING_INSTALLATION_ID,
              })
            }
            connectedFor.push(expected?.devinSetupInstallation)
            if (connectedFor.length === 1)
              await readBridgeDescriptor(path, expected, timeoutMs)
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 5_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(refusal, undefined)
    assert.deepEqual(connectedFor, [INSTALLATION_ID, REPLACING_INSTALLATION_ID])
  },
)

// protects=a window whose descriptor changed its endpoint after the bridge chose it never being connected to the new endpoint (Cycle 0145 /ship pass 1, FX6 item 2); fails_when=every change at the final read is retried, so the bridge connects to a rewritten port on a later attempt; no_claim=a mark-only change (the test above)
test(
  'a descriptor whose port changed between the receipts check and the connection read is dropped and never connected',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    let connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: async (
            path: string,
            timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            connections += 1
            await writeDescriptor(agentDir, 0, workspace, process.pid, {
              url: 'http://127.0.0.1:2/mcp',
            })
            await readBridgeDescriptor(path, expected, timeoutMs)
          },
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
    assert.equal(connections, 1)
  },
)

// protects=the endpoint a window was selected with staying required across a retry after its mark changed (Cycle 0145 /ship pass 1, FX6 item 2); fails_when=the retry selects the descriptor again with whatever endpoint it names by then, so a port rewritten after the mark change is connected; no_claim=how the rewrite happens
test(
  'a descriptor re-marked and then moved to another port is not connected on the retry',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const storageRoot = dirname(agentDir)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    let connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: async (
            path: string,
            timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            connections += 1
            await writeDescriptor(agentDir, 0, workspace, process.pid, {
              devinSetupInstallation: REPLACING_INSTALLATION_ID,
            })
            await writeSetupReceipts(storageRoot, {
              installationId: REPLACING_INSTALLATION_ID,
            })
            try {
              await readBridgeDescriptor(path, expected, timeoutMs)
            } finally {
              // After the mark change the descriptor is rewritten for another endpoint.
              await writeDescriptor(agentDir, 0, workspace, process.pid, {
                devinSetupInstallation: REPLACING_INSTALLATION_ID,
                url: 'http://127.0.0.1:2/mcp',
              })
            }
          },
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
    assert.equal(typeof refusal, 'string')
    assert.equal(connections, 1)
  },
)

/**
 * Loads the real descriptor reader with a descriptor text read that meets a file shortage first, so a stand-in connection reads the descriptor as the shared bridge does; the Devin bridge must be loaded with the returned module as its reader so both share one error class.
 * @param shortages - How many reads reject with EMFILE before reads succeed.
 * @returns The loaded reader module.
 */
async function loadReaderWithShortages(shortages: number) {
  let reads = 0
  return loadModule<{
    readBridgeDescriptor: typeof readBridgeDescriptor
  }>(resolve(__dirname, '../utils/readBridgeDescriptor.js'), {
    './readDescriptorText': {
      readDescriptorText: async (path: string) => {
        reads += 1
        if (reads <= shortages)
          throw Object.assign(new Error('too many open files'), {
            code: 'EMFILE',
          })
        return readFile(path, 'utf8')
      },
    },
  })
}

// Value: protects=a window whose descriptor moved to another port after the descriptor read met a file shortage never being connected on the new port (Cycle 0146 task 10, D7 finding 1); fails_when=a shortage at the descriptor read waits unpinned like a busy server, so the retry takes the rewritten port as expected; no_claim=a shortage at the connect phase (fetch), which stays a retry
test(
  'a descriptor that moved to another port after the descriptor read met a file shortage is not connected on the retry',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const readerModule = await loadReaderWithShortages(1)
    let connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/readBridgeDescriptor': readerModule,
        './cursorMcpBridge': {
          runCursorMcpBridge: async (
            path: string,
            timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            connections += 1
            try {
              await readerModule.readBridgeDescriptor(path, expected, timeoutMs)
            } finally {
              // After the shortage the descriptor is rewritten for another endpoint.
              await writeDescriptor(agentDir, 0, workspace, process.pid, {
                url: 'http://127.0.0.1:2/mcp',
              })
            }
          },
        },
      },
      // The bridge tells a transient failure by `instanceof Error`; the stand-in's errors belong to this realm, as every error does in the bridge process.
      { Error },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(
      refusal,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`,
    )
    assert.equal(connections, 1)
  },
)

// Value: protects=a window whose descriptor read met a file shortage still connecting to the same descriptor on the retry (Cycle 0146 task 10 guard); fails_when=the shortage ends the wait, drops the descriptor or pins an identity the unchanged descriptor does not match; no_claim=how many shortages a real machine meets
test(
  'a bridge whose descriptor read met a file shortage connects to the same descriptor on the retry',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const readerModule = await loadReaderWithShortages(1)
    let connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/readBridgeDescriptor': readerModule,
        './cursorMcpBridge': {
          runCursorMcpBridge: async (
            path: string,
            timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            connections += 1
            await readerModule.readBridgeDescriptor(path, expected, timeoutMs)
          },
        },
      },
      // The bridge tells a transient failure by `instanceof Error`; the stand-in's errors belong to this realm, as every error does in the bridge process.
      { Error },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(refusal, undefined)
    assert.equal(connections, 2)
  },
)

// Value: protects=a server that refused the connection at first being followed to the new port of the same descriptor (Cycle 0146 task 10 guard; Cycle 0145 FX6); fails_when=a transient server failure pins the first url, so the new port is never connected; no_claim=a rewrite for another instance
test(
  'a bridge whose server refused the connection is followed to the new port of the same descriptor',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    const urls: (string | undefined)[] = []
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: async (
            _path: string,
            _timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            urls.push(expected?.url)
            if (urls.length > 1) return
            await writeDescriptor(agentDir, 0, workspace, process.pid, {
              url: 'http://127.0.0.1:2/mcp',
            })
            throw Object.assign(new Error('refused'), {
              code: 'ECONNREFUSED',
            })
          },
        },
      },
      // The bridge tells a transient failure by `instanceof Error`; the stand-in's errors belong to this realm, as every error does in the bridge process.
      { Error },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(refusal, undefined)
    assert.deepEqual(urls, ['http://127.0.0.1:1/mcp', 'http://127.0.0.1:2/mcp'])
  },
)

// Value: protects=a window whose descriptor moved to another port while its setup check could not answer never being connected on the new port (Cycle 0146 task 10); fails_when=an unverified setup waits unpinned, so the retry takes the rewritten port; no_claim=how the check fails to answer
test(
  'a descriptor that moved to another port while its setup check could not answer is not connected on the retry',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    let checks = 0,
      connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: () => {
            connections += 1
            return Promise.resolve()
          },
        },
        './utils/checkDevinBridgeReceipts': {
          // The first check cannot answer, after the descriptor moved; later checks stand.
          checkDevinBridgeReceipts: async () => {
            checks += 1
            if (checks > 1) return { answer: 'stands' }
            await writeDescriptor(agentDir, 0, workspace, process.pid, {
              url: 'http://127.0.0.1:2/mcp',
            })
            return { answer: 'no-answer' }
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(
      refusal,
      `Codebook could not check the AI chat setup for ${workspace} in this Devin Desktop window, because its setup records could not be read. Reload the window to try again.`,
    )
    assert.equal(connections, 0)
  },
)

// Value: protects=a window whose setup was found replaced between selection and the receipts check never being connected on a port rewritten afterwards (Cycle 0146 task 10, Cycle 0145 J10); fails_when=a replaced answer waits unpinned like a busy server; no_claim=the replaced refusal line of a connected bridge
test(
  'a descriptor that moved to another port after its setup was found replaced is not connected on the retry',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    let checks = 0,
      connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: () => {
            connections += 1
            return Promise.resolve()
          },
        },
        './utils/checkDevinBridgeReceipts': {
          checkDevinBridgeReceipts: async () => {
            checks += 1
            if (checks > 1) return { answer: 'stands' }
            await writeDescriptor(agentDir, 0, workspace, process.pid, {
              url: 'http://127.0.0.1:2/mcp',
            })
            return { answer: 'replaced' }
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(
      refusal,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`,
    )
    assert.equal(connections, 0)
  },
)

// Value: protects=a window whose descriptor gained its mark and moved to another port after the bridge waited for the mark never being connected on the new port, and a wait that then ends without asking for a setup the rejected descriptor already has (Cycle 0146 task 10, Cycle 0145 J10; Cycle 0146 review round, CodeRabbit devinMcpBridge.ts:1217); fails_when=a not-set-up wait pins nothing, so the marked descriptor at the new port is connected, or the exclusion keeps the earlier attempt's not-set-up status, so the wait ends with the run-setup line; no_claim=a marked descriptor that keeps its first port, a descriptor that stays unmarked (the setup line stays)
test(
  'a descriptor that gained its mark and moved to another port is not connected after the bridge waited for the mark, and the wait does not ask for setup',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      devinSetupInstallation: undefined,
    })
    let isMarked = false,
      connections = 0
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: () => {
            connections += 1
            return Promise.resolve()
          },
        },
        './utils/evidenceInUseElsewhere': {
          // Runs after the unmarked candidate was read: setup marks it and the server restarts on another port.
          isDescriptorOwnerGone: async () => {
            if (!isMarked) {
              isMarked = true
              await writeDescriptor(agentDir, 0, workspace, process.pid, {
                url: 'http://127.0.0.1:2/mcp',
              })
            }
            return false
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    // The rewrite ran: without it the descriptor stays unmarked on its first port and the same refusal follows.
    assert.equal(isMarked, true)
    assert.equal(
      refusal,
      `Codebook is not running for ${workspace} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.`,
    )
    assert.equal(connections, 0)
  },
)

// Value: protects=a pinned descriptor that changed identity and lost its AI chat mark not ending the search while another descriptor can connect (Cycle 0146 task 10, D7 finding 2); fails_when=the unmarked refusal fires before the pin check, so the other descriptor of this window never gets its turn; no_claim=which descriptor the selection prefers
test(
  'a pinned descriptor that changed identity and lost its AI chat mark does not stop another descriptor from connecting',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const olderPath = await writeDescriptor(agentDir, 1, workspace, process.pid)
    const newerPath = await writeDescriptor(agentDir, 0, workspace, process.pid)
    // Descriptor 0 is the newer one, so it is selected first.
    await utimes(olderPath, new Date(1_000), new Date(1_000))
    await utimes(newerPath, new Date(2_000), new Date(2_000))
    const connectedTo: (string | undefined)[] = []
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: async (
            _path: string,
            _timeoutMs: number,
            expected: SeenConnection['expected'],
          ) => {
            connectedTo.push(expected?.instanceId)
            if (connectedTo.length > 1) return
            // The first connection finds only the mark changed, so its path is pinned; then the descriptor is rewritten for another port without the AI chat mark.
            await writeDescriptor(agentDir, 0, workspace, process.pid, {
              url: 'http://127.0.0.1:2/mcp',
              devinChat: false,
            })
            throw new DescriptorMarkChangedError()
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 2_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(refusal, undefined)
    assert.deepEqual(connectedTo, [instanceIdOf(0), instanceIdOf(1)])
  },
)

// Value: protects=receipt reads of a stalled disk not piling up: one timed-out check holds three file reads and a request that comes while it hangs fails at once without starting any (Cycle 0145 /ship pass 1, FX6 item 3; CodeRabbit final-range F4; Codex last-round O5); fails_when=a second hanging check is allowed, so two checks hold six file reads, more than libuv's four pool threads; no_claim=how long a real stalled read takes to settle
test(
  'requests that time out one after another on a stalled disk start only three file reads',
  { timeout: 30_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    let fileReads = 0,
      checks = 0
    const seen: SeenConnection[] = []
    // The real receipts check, whose three reads stall at the file-read boundary and are counted there.
    const realCheck = await loadModule<{
      checkDevinBridgeReceipts: typeof checkDevinBridgeReceipts
    }>(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'), {
      './readPrivateJsonState': {
        readPrivateJsonState: () => {
          fileReads += 1
          return new Promise<never>(() => undefined)
        },
      },
      './readReceiptState': {
        readReceiptState: () => {
          fileReads += 1
          return new Promise<never>(() => undefined)
        },
      },
    })
    const stalledReads = createPathReadGate()
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: (
            _path: string,
            _timeoutMs: number,
            expected: SeenConnection['expected'],
            _header: unknown,
            _onClosed: unknown,
            beforeUpstream: SeenConnection['beforeUpstream'],
            onRefused: SeenConnection['onRefused'],
          ) => {
            seen.push({ expected, beforeUpstream, onRefused })
            return Promise.resolve()
          },
        },
        './utils/checkDevinBridgeReceipts': {
          // The first check is the connection's own and stands; every later one reads the stalled disk.
          checkDevinBridgeReceipts: (
            descriptorPath: string,
            binding: Parameters<typeof checkDevinBridgeReceipts>[1],
          ) => {
            checks += 1
            // A gate of its own: the reads left hung hold no slot of the gate the rest of this process shares.
            return checks === 1
              ? Promise.resolve({ answer: 'stands' })
              : realCheck.checkDevinBridgeReceipts(
                  descriptorPath,
                  binding,
                  stalledReads,
                )
          },
        },
      },
    )
    await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 5_000, intervalMs: 20 },
    )
    const check = seen[0]?.beforeUpstream
    assert.ok(check)
    // Act
    const outcomes: string[] = []
    for (let request = 0; request < 3; request += 1)
      outcomes.push(
        await check().then(
          () => 'answered',
          (error: Error) => error.message,
        ),
      )
    // Assert
    assert.deepEqual(outcomes, [
      'Codebook setup check did not answer.',
      'Codebook setup check did not answer.',
      'Codebook setup check did not answer.',
    ])
    // Only the first request's check reads: its three file reads hang; the second and third requests fail at once without a read.
    assert.equal(fileReads, 3)
  },
)

// protects=one refusal line when both hooks of the bridge enter before the shared receipts read settles (Cycle 0145 /ship pass 1, FX6 item 3); fails_when=each hook writes its own line, or the second hook's request reconnects while the first still writes; no_claim=a stalled pipe (the write is a plain stderr write)
test(
  'a refusal and an expired session that both wait on one receipts read write one not-set-up line',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    await writeDescriptor(agentDir, 0, workspace, process.pid)
    let reads = 0
    let releaseRead = (): void => undefined
    const gate = new Promise<void>((resolveLater) => {
      releaseRead = resolveLater
    })
    const seen: SeenConnection[] = []
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: (
            _path: string,
            _timeoutMs: number,
            expected: SeenConnection['expected'],
            _header: unknown,
            _onClosed: unknown,
            beforeUpstream: SeenConnection['beforeUpstream'],
            onRefused: SeenConnection['onRefused'],
          ) => {
            seen.push({ expected, beforeUpstream, onRefused })
            return Promise.resolve()
          },
        },
        './utils/checkDevinBridgeReceipts': {
          // The connection's own read stands; the next one is held, then finds the setup removed.
          checkDevinBridgeReceipts: async () => {
            reads += 1
            if (reads === 1) return { answer: 'stands' }
            await gate
            return { answer: 'removed', reason: 'missing', path: '/receipt' }
          },
        },
      },
    )
    await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 5_000, intervalMs: 20 },
    )
    const written: string[] = []
    const originalWrite = process.stderr.write
    process.stderr.write = Object.assign(
      (chunk: string, callback?: () => void): boolean => {
        written.push(chunk)
        callback?.()
        return true
      },
      originalWrite,
    )
    context.after(() => {
      process.stderr.write = originalWrite
      process.exitCode = undefined
    })
    const beforeUpstream = seen[0]?.beforeUpstream,
      onRefused = seen[0]?.onRefused
    assert.ok(beforeUpstream)
    assert.ok(onRefused)
    // Act
    const both = Promise.all([beforeUpstream(), onRefused()])
    releaseRead()
    const answers = await both
    // Assert
    assert.deepEqual(answers, [false, false])
    assert.deepEqual(written, [
      `Codebook is running in this Devin Desktop window, but AI chat is not set up for ${workspace}. Run Codebook: Set Up AI Chat here, then reload the window.\n`,
    ])
    assert.equal(reads, 2)
  },
)

for (const [variant, replySource] of [
  ['never answers', 'new Promise(() => {})'],
  ['answers no-answer every time', "Promise.resolve({ answer: 'no-answer' })"],
] as const) {
  // protects=the bridge entry ending with exit code 1 and the could-not-check line when its receipts check gives no verdict until the deadline (Cycle 0145 /ship pass 1, FX6 item 4); fails_when=the entry names a missing Codebook, a missing setup or exits 0; no_claim=a busy or refused server, which keeps the not-running line
  test(
    `the bridge entry exits with 1 and the could-not-check line when its receipts check ${variant}`,
    { skip: process.platform === 'win32', timeout: 30_000 },
    async (context) => {
      // Arrange
      const { agentDir, workspace } = await createFolders(context)
      await writeDescriptor(agentDir, 0, workspace, process.pid)
      const preloadPath = join(agentDir, '..', 'preload.js')
      await writeFile(
        preloadPath,
        `const receipts = require(${JSON.stringify(resolve(__dirname, '../utils/checkDevinBridgeReceipts.js'))})
receipts.checkDevinBridgeReceipts = () => ${replySource}
const bridge = require(${JSON.stringify(resolve(__dirname, '../devinMcpBridge.js'))})
const original = bridge.runDevinMcpBridge
bridge.runDevinMcpBridge = (agentDirectory) =>
  original(agentDirectory, process.cwd(), process.env, { timeoutMs: 600, intervalMs: 20 })
`,
      )
      // Act
      const result = await new Promise<{ code: number | null; stderr: string }>(
        (done) => {
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
              env: { WINDSURF_EXT_HOST_PID: String(process.pid) },
              timeout: 15_000,
              killSignal: 'SIGKILL',
            },
            (_error, _stdout, stderr) => done({ code: child.exitCode, stderr }),
          )
        },
      )
      // Assert
      assert.equal(result.code, 1)
      assert.equal(
        result.stderr,
        `Codebook could not check the AI chat setup for ${await realpath(workspace)} in this Devin Desktop window, because its setup records could not be read. Reload the window to try again.\n`,
      )
    },
  )
}

// protects=a transient first failure of the receipts read not costing the connection to the same descriptor (Cycle 0145 /ship pass 1, FX6 item 4); fails_when=a read that failed once excludes the descriptor or ends the wait; no_claim=the wording of a wait that ends unread (the test above)
test(
  'a receipts read that fails once is followed by a connection to the same descriptor',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const descriptorPath = await writeDescriptor(
      agentDir,
      0,
      workspace,
      process.pid,
    )
    let reads = 0
    const connectedPaths: string[] = []
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './cursorMcpBridge': {
          runCursorMcpBridge: (path: string) => {
            connectedPaths.push(path)
            return Promise.resolve()
          },
        },
        './utils/checkDevinBridgeReceipts': {
          checkDevinBridgeReceipts: () => {
            reads += 1
            return Promise.resolve({
              answer: reads === 1 ? 'no-answer' : 'stands',
            })
          },
        },
      },
    )
    // Act
    const refusal = await bridgeModule.runDevinMcpBridge(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      { timeoutMs: 5_000, intervalMs: 20 },
    )
    // Assert
    assert.equal(refusal, undefined)
    assert.deepEqual(connectedPaths, [descriptorPath])
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
