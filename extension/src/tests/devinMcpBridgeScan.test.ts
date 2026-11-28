import assert from 'node:assert/strict'
import { readdir, symlink, utimes } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as DevinMcpBridgeModule from '../devinMcpBridge'
import {
  createDevinSelectState,
  selectDevinDescriptor,
} from '../devinMcpBridge'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import { createFolders } from './utils/createFolders'
import { loadModule } from './utils/loadModule'
import { writeDescriptor } from './utils/writeDescriptor'

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
      // The answer comes 1,000 ms after the first scan's wait ended and 2,000 ms before the next scan starts (4,000 ms pause).
      return new Promise<string>((resolveLater) =>
        setTimeout(() => resolveLater(workspace), 2_000),
      )
    }
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 12_000, intervalMs: 4_000, resolveWorkspace },
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
        ? // The answer comes 1,000 ms after the first scan's wait ended and 2,000 ms before the next scan starts.
          new Promise<string>((resolveLater) =>
            setTimeout(() => resolveLater(workspace), 2_000),
          )
        : Promise.resolve(path)
    // Act
    const selection = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 12_000, intervalMs: 4_000, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, newerPath)
  },
)

// protects=a workspace whose resolution failed late being asked again by the next scan; fails_when=the fallback spelling is kept like a resolved answer, so the next scan judges the stale spelling and the repaired link never matches; no_claim=a real failing realpath (the stand-in rejects after 1,300 ms once)
test(
  'a workspace lookup that failed late is not kept and the next scan asks again',
  { timeout: 20_000 },
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
    let brokenLookups = 0,
      judgedCandidates = 0
    // Each scan judges the one candidate once, through the liveness check, before it asks for the workspace: the count of judgements is the number of the scan that runs.
    const scanNumberOfLookups: number[] = []
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== brokenFolder) return Promise.resolve(path)
      brokenLookups += 1
      scanNumberOfLookups.push(judgedCandidates)
      // The first lookup fails 1,000 ms after the first scan's wait ended and 2,000 ms before the next scan; the link is repaired by the second.
      return brokenLookups === 1
        ? new Promise<string>((_resolve, rejectLater) =>
            setTimeout(() => rejectLater(new Error('ENOENT')), 2_000),
          )
        : Promise.resolve(workspace)
    }
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/evidenceInUseElsewhere': {
          isDescriptorOwnerGone: () => {
            judgedCandidates += 1
            return Promise.resolve(false)
          },
        },
      },
    )
    // Act
    const selection = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      { timeoutMs: 12_000, intervalMs: 4_000, resolveWorkspace },
    )
    // Assert
    assert.equal(selection?.descriptorPath, descriptorPath)
    assert.equal(brokenLookups, 2)
    // The second lookup starts in the second scan; a cached fallback consumed by the second scan would move it to the third.
    assert.deepEqual(scanNumberOfLookups, [1, 2])
  },
)

// protects=an expired scan's late candidate leaving the kept workspace answer for the next live scan; fails_when=a candidate whose liveness check finishes after its scan returned takes the kept answer, so the next scan starts the slow lookup again and misses the window; no_claim=a real mount (stand-ins for the slow lookup and the slow liveness check, both released by the test)
test(
  'a candidate of an expired scan leaves the kept workspace answer to the next scan',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const slowFolder = join(agentDir, '..', 'slow-workspace')
    const healthyPath = await writeDescriptor(
      agentDir,
      0,
      slowFolder,
      process.pid,
    )
    const stalledPath = await writeDescriptor(
      agentDir,
      1,
      slowFolder,
      process.pid,
    )
    let slowLookups = 0,
      isSlowAnswered = false,
      isLivenessAnswered = false
    let releaseSlowLookup = (): void => undefined,
      releaseLiveness = (): void => undefined
    const slowGate = new Promise<void>((resolveLater) => {
      releaseSlowLookup = resolveLater
    })
    const livenessGate = new Promise<void>((resolveLater) => {
      releaseLiveness = resolveLater
    })
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== slowFolder) return Promise.resolve(path)
      slowLookups += 1
      // Only the first lookup is released; a new one stays unanswered, like the mount that is slow again.
      if (slowLookups > 1) return new Promise<string>(() => undefined)
      return slowGate.then(() => {
        isSlowAnswered = true
        return workspace
      })
    }
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/evidenceInUseElsewhere': {
          // One candidate's liveness check stalls until the test releases it; the other answers at once.
          isDescriptorOwnerGone: (descriptorPath: string) =>
            descriptorPath === stalledPath
              ? livenessGate.then(() => {
                  isLivenessAnswered = true
                  return false
                })
              : Promise.resolve(false),
        },
      },
    )
    const state = bridgeModule.createDevinSelectState()
    const options = {
      timeoutMs: 1_100,
      intervalMs: 20,
      resolveWorkspace,
      state,
    }
    // Act
    const first = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    await waitUntil(
      () => state.waitingScans.get(slowFolder) === 0,
      "the first selection's scan giving up its wait",
      5_000,
    )
    releaseSlowLookup()
    await waitUntil(
      () => isSlowAnswered,
      'the slow workspace lookup answering',
      5_000,
    )
    // The stalled candidate of the expired scan now continues; it must leave the kept answer where it is.
    releaseLiveness()
    await waitUntil(
      () => isLivenessAnswered,
      "the stalled candidate's liveness check answering",
      5_000,
    )
    // The candidate's remaining steps up to its workspace step are microtasks, which all run before this macrotask.
    await new Promise((resolveLater) => setImmediate(resolveLater))
    const second = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    // Assert
    assert.equal(first, undefined)
    assert.notEqual(second, undefined)
    assert.equal(
      [healthyPath, stalledPath].includes(second?.descriptorPath ?? ''),
      true,
    )
    assert.equal(slowLookups, 1)
  },
)

// protects=a late real path still being kept for the next scan after a candidate's owner check returned when its scan had already ended (Cycle 0145 last-round review, CodeRabbit final-range G1, Codex structured review, Codex outside voice 9); fails_when=the ended scan's candidate joins the pending lookup and counts as a waiter nothing gives back, so the answer that arrives later is dropped; no_claim=a real mount (stand-ins for the slow lookup and the slow owner check, both released by the test)
test(
  'a late real path is still kept after a candidate of an ended scan finished its owner check meanwhile',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const slowFolder = join(agentDir, '..', 'slow-workspace')
    await writeDescriptor(agentDir, 0, slowFolder, process.pid)
    const stalledPath = await writeDescriptor(
      agentDir,
      1,
      slowFolder,
      process.pid,
    )
    let isOwnerCheckAnswered = false
    let releaseSlowLookup = (): void => undefined,
      releaseOwnerCheck = (): void => undefined
    const slowGate = new Promise<void>((resolveLater) => {
      releaseSlowLookup = resolveLater
    })
    const ownerCheckGate = new Promise<void>((resolveLater) => {
      releaseOwnerCheck = resolveLater
    })
    const resolveWorkspace = (path: string): Promise<string> =>
      path === slowFolder
        ? slowGate.then(() => workspace)
        : Promise.resolve(path)
    const bridgeModule = await loadModule<typeof DevinMcpBridgeModule>(
      resolve(__dirname, '../devinMcpBridge.js'),
      {
        './utils/evidenceInUseElsewhere': {
          // One candidate's owner check stalls until the test releases it, after its scan ended.
          isDescriptorOwnerGone: (descriptorPath: string) =>
            descriptorPath === stalledPath
              ? ownerCheckGate.then(() => {
                  isOwnerCheckAnswered = true
                  return false
                })
              : Promise.resolve(false),
        },
      },
    )
    const state = bridgeModule.createDevinSelectState()
    const options = {
      timeoutMs: 1_100,
      intervalMs: 20,
      resolveWorkspace,
      state,
    }
    const first = await bridgeModule.selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    await waitUntil(
      () => state.waitingScans.get(slowFolder) === 0,
      "the first selection's scan giving up its wait",
      5_000,
    )
    // Act
    // The ended scan's candidate finishes its owner check while the slow lookup is still pending.
    releaseOwnerCheck()
    await waitUntil(
      () => isOwnerCheckAnswered,
      "the stalled candidate's owner check answering",
      5_000,
    )
    // The candidate's remaining steps up to its workspace step are microtasks, which all run before this macrotask.
    await new Promise((resolveLater) => setImmediate(resolveLater))
    releaseSlowLookup()
    await waitUntil(
      () => state.lateWorkspaceAnswers.get(slowFolder),
      'the late real path being kept for the next scan',
      5_000,
    )
    // Assert
    assert.equal(first, undefined)
    assert.equal(state.lateWorkspaceAnswers.get(slowFolder), workspace)
    assert.equal(state.waitingScans.get(slowFolder), 0)
  },
)

// protects=a late real path being kept when the scan that waited for it already returned with an older match (Cycle 0145 final-range review, CodeRabbit final-range F6); fails_when=the ended scan still counts as waiting, so the answer is dropped and the next scan starts the slow lookup again and misses the newer candidate; no_claim=a real mount (the slow lookup is a stand-in released by the test)
test(
  'a real path that answers after its scan returned with an older match is kept for the next selection',
  { timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    const slowFolder = join(agentDir, '..', 'slow-workspace')
    const olderPath = await writeDescriptor(agentDir, 0, workspace, process.pid)
    const newerPath = await writeDescriptor(
      agentDir,
      1,
      slowFolder,
      process.pid,
    )
    // The newer descriptor is the slow candidate, so the scan returns with the older match first.
    await utimes(olderPath, new Date(1_000_000), new Date(1_000_000))
    await utimes(newerPath, new Date(2_000_000), new Date(2_000_000))
    let slowLookups = 0,
      isSlowAnswered = false
    let releaseSlowLookup = (): void => undefined
    const slowGate = new Promise<void>((resolveLater) => {
      releaseSlowLookup = resolveLater
    })
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== slowFolder) return Promise.resolve(path)
      slowLookups += 1
      // Only the first lookup is released; a new one stays unanswered, like the mount that is slow again.
      if (slowLookups > 1) return new Promise<string>(() => undefined)
      return slowGate.then(() => {
        isSlowAnswered = true
        return workspace
      })
    }
    const options = {
      timeoutMs: 1_100,
      intervalMs: 20,
      resolveWorkspace,
      state: createDevinSelectState(),
    }
    // Act
    const first = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    releaseSlowLookup()
    await waitUntil(
      () => isSlowAnswered,
      'the slow workspace lookup answering',
      5_000,
    )
    const second = await selectDevinDescriptor(
      agentDir,
      workspace,
      process.pid,
      options,
    )
    // Assert
    assert.equal(first?.descriptorPath, olderPath)
    assert.equal(second?.descriptorPath, newerPath)
    assert.equal(slowLookups, 1)
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
    let slowLookups = 0,
      isSlowAnswered = false
    // The slow lookup answers only when the test releases it, after the first selection has returned.
    let releaseSlowLookup = (): void => undefined
    const slowGate = new Promise<void>((resolveLater) => {
      releaseSlowLookup = resolveLater
    })
    const resolveWorkspace = (path: string): Promise<string> => {
      if (path !== slowFolder) return Promise.resolve(path)
      slowLookups += 1
      // Only the first lookup is released; a new one stays unanswered, like the mount that is slow again.
      if (slowLookups > 1) return new Promise<string>(() => undefined)
      return slowGate.then(() => {
        isSlowAnswered = true
        return workspace
      })
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
    // The first selection's scan stops waiting a moment after the selection returned; only an answer that no scan waits for is kept.
    await waitUntil(
      () => state.waitingScans.get(slowFolder) === 0,
      "the first selection's scan giving up its wait",
      5_000,
    )
    releaseSlowLookup()
    await waitUntil(
      () => isSlowAnswered,
      'the slow workspace lookup answering',
      5_000,
    )
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
  'a receipts check that never answers ends the wait with the could-not-check line, not the not-set-up line',
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
      `Codebook could not check the AI chat setup for ${workspace} in this Devin Desktop window, because its setup records could not be read. Reload the window to try again.`,
    )
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
            try {
              // A pause keeps the read open long enough for the others to start; the count drops only when the real read ends.
              await new Promise<void>((done) => setTimeout(done, 30))
              return await readWikiRegularFile(...parameters)
            } finally {
              open -= 1
            }
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
