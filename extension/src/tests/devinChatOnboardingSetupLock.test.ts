import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
  DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
} from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StorageLockHeldError } from '../utils/storageLockHeldError'
import { withDevinSetupLock } from '../utils/withDevinSetupLock'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { removeTestFolder } from './utils/removeTestFolder'

/**
 * Holds the setup lock of a Devin Desktop window from a separate Node process, as another Devin Desktop window (another extension host) holds it.
 * The process says so when it holds the lock and releases it only when the test asks, so no run depends on how long a timer takes.
 * @param context - The test, which ends the process afterwards, also when the test failed before it released the lock.
 * @param storageDirectory - The global storage folder the window shares.
 * @returns Resolves once the process holds the lock, with `release`, which lets the process release the lock and resolves when it has ended.
 * @example const holder = await holdSetupLockInOtherProcess(context, directory); await holder.release()
 */
async function holdSetupLockInOtherProcess(
  context: { after: (callback: () => Promise<void>) => void },
  storageDirectory: string,
): Promise<{ release: () => Promise<void> }> {
  const script = `
    const { withStorageLock } = require(process.argv[1])
    withStorageLock(process.argv[2], async () => {
      console.log('held')
      // The lock stays until the parent writes to stdin, or ends it by exiting.
      await new Promise((release) => {
        process.stdin.once('data', release)
        process.stdin.once('end', release)
      })
    }).then(() => process.exit(0))
  `
  const child = spawn(
    process.execPath,
    [
      '-e',
      script,
      resolve(__dirname, '../utils/withStorageLock.js'),
      join(storageDirectory, 'devin-setup'),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  // `close` also fires after a failed spawn (`error`), where `exit` may never fire.
  const ended = new Promise<void>((resolveEnded) => {
    child.once('close', () => resolveEnded())
  })
  // The process ends with the test, whatever the test's outcome.
  context.after(async () => {
    child.kill()
    await ended
  })
  await new Promise<void>((resolveHeld, rejectHeld) => {
    child.stdout.once('data', () => resolveHeld())
    child.once('error', rejectHeld)
    child.once('exit', () => rejectHeld(new Error('the lock holder ended')))
  })
  return {
    release: async (): Promise<void> => {
      child.stdin.end('release\n')
      await ended
    },
  }
}

// Value: protects=windows opened together wait for each other's lock on the entry instead of giving up with an Output line; fails_when=the first held-lock refusal ends the refresh and the entry stays on the old bridge; why_new=review finding C9 (retry a held lock); seam=an entry refresh stand-in that meets a held lock twice
test('a Devin Desktop refresh retries a held storage lock and then refreshes the entry', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
    entryRefreshBusy: 2,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'refresh MCP entry',
      'refresh MCP entry',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [])
    assert.equal(window.notices.length, 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that opens on a set-up workspace while another window's setup holds the setup lock refreshes the MCP entry only once that setup ended, so the refresh never rewrites the entry between that setup's entry write and its end or take-back; fails_when=the activation refresh rewrites the entry while the other window's setup still runs, so a failed first setup's take-back finds a newer generation, answers superseded and leaves its failed entry installed (Cycle 0146 /ship pass 1, codex-structured extension.ts:1626); why_new=only setups and removals took the setup lock; seam=two windows on one storage folder in one extension host, a held final skill check of the first window's setup; no_claim=a window of another extension host (the lock's cross-process wait has its own tests) and a refresh refused after the lock's wait (it goes to the Output like any refused refresh)
test("a Devin Desktop window's activation refresh waits for another window's setup that holds the setup lock", async (context) => {
  // Arrange
  const first = await devinWindow(context, { holdSkillCheck: true })
  try {
    const setup = first.commands.get('codebook.setupAiChat')!()
    await waitUntil(
      () => first.holds.skillCheck.reachedAtMs(),
      "the first window's final skill check",
    )
    // Act
    const second = await devinWindow(context, {
      storageDirectory: first.directory,
      instanceLabel: 'second',
      savedSetup: true,
    })
    try {
      // Without the lock the refresh follows the skill check and Node within milliseconds; half a second without it shows it waits.
      await assert.rejects(
        waitUntil(
          () => second.steps.includes('refresh MCP entry'),
          "the second window's refresh to run during the first window's setup",
          500,
        ),
        {
          message:
            "Timed out waiting for the second window's refresh to run during the first window's setup",
        },
      )
      first.holds.skillCheck.release()
      await setup
      await second.whenReconnected()
      // Assert
      assert.deepEqual(second.steps, [
        'verify Devin skill',
        'resolve Node',
        'refresh MCP entry',
        'start server',
      ])
    } finally {
      await second.loaded.deactivate()
    }
  } finally {
    first.holds.skillCheck.release()
    await first.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads on a set-up workspace while another window holds the setup lock for about 14 seconds (a long setup, or a take-back on slow storage) gives up on that lock within seconds, says so in the Output and publishes its server's descriptor within 6 seconds of its load, well inside the 15 seconds the Devin bridge waits for it (Cycle 0146 /ship pass 2, red-team 2); fails_when=the activation refresh waits a setup's 7 to 14 seconds (up to 15) for the lock before the server starts, so the bridge Devin Local started at the window load gives up and the window's chat has no Codebook until a reload; no_claim=the bridge's own wait (its tests) and a lock this window's own take-back holds while storage stalls (the same acquisition budget bounds it, not run here); a separate Node process holds the real setup lock
test("a Devin Desktop window's activation refresh gives up within seconds on a setup lock another window holds and still publishes its descriptor", async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
  try {
    const loadedAtMs = performance.now()
    // Act
    const window = await devinWindow(context, {
      storageDirectory,
      savedSetup: true,
    })
    try {
      // The other window keeps the lock for up to 14 seconds, past the bridge's wait: only a refresh that gives up first publishes in time.
      const publishedAtMs = await waitUntil(
        async () =>
          (await window.descriptorReadable()) ? performance.now() : undefined,
        "the reconnected server's descriptor while the other window holds the setup lock",
        14_000,
      )
      await window.whenReconnected()
      // Assert
      const publishedAfterMs = publishedAtMs - loadedAtMs
      assert.ok(
        publishedAfterMs < 6_000,
        `the descriptor was published ${Math.round(publishedAfterMs)} ms after the window loaded`,
      )
      assert.deepEqual(window.steps, [
        'verify Devin skill',
        'resolve Node',
        'start server',
      ])
      assert.deepEqual(window.outputLines, [
        'Codebook did not refresh its Devin Desktop MCP entry: Another Codebook window is changing the Devin Desktop setup. Try again in a moment.',
      ])
    } finally {
      await window.loaded.deactivate()
    }
  } finally {
    await holder.release()
  }
})

// Value: protects=a removal from a second Devin Desktop window of the same extension host queues behind a setup that is deploying the skill, so it never lands between that setup's skill deployment and entry write; fails_when=the removal runs while the other window's setup is mid-way and leaves an entry with no skill; why_new=review finding C1 (one lock for setup and removal), renamed in Cycle 0143 /ship pass 2 because both windows run in one process here and the cross-process wait has its own tests below; seam=two windows on one storage folder, a held skill deployment
test('a removal from a second Devin Desktop window in the same extension host queues behind a running setup', async (context) => {
  // Arrange
  const first = await devinWindow(context, { holdDeploy: true })
  const second = await devinWindow(context, {
    storageDirectory: first.directory,
    confirmRemoval: true,
  })
  try {
    const setup = first.commands.get('codebook.setupAiChat')!()
    await first.deployReached
    // Act
    const removal = second.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    // Without the lock the removal's first step follows within milliseconds; half a second without it shows it waits.
    await assert.rejects(
      waitUntil(
        () => second.steps.includes('remove Devin skill'),
        'the removal to run during the setup',
        500,
      ),
      { message: 'Timed out waiting for the removal to run during the setup' },
    )
    first.releaseDeploy()
    await setup
    await removal
    assert.deepEqual(second.steps, ['remove Devin skill', 'remove MCP entry'])
    assert.deepEqual(first.steps.slice(-1), ['verify Devin skill'])
  } finally {
    first.releaseDeploy()
    await first.loaded.deactivate()
    await second.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop setup started while another Devin Desktop window (another process) changes the setup waits for it and then runs; fails_when=the setup gives up at the first held-lock refusal, or runs before the other window has finished; why_new=review finding F3 (Cycle 0143 /ship pass 2, cross-process wait); seam=a separate Node process that holds the real setup lock
test('a Devin Desktop setup waits for the setup lock another process holds and then runs', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, { storageDirectory })
  try {
    const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // gstack-timing-ok: the setup must show it ran nothing while another process holds the lock, which only elapsed time can show; three retry pauses of the wait
    await delay(DEVIN_SETUP_LOCK_RETRY_DELAY_MS * 3)
    const stepsWhileHeld = [...window.steps]
    await holder.release()
    await setup
    // Assert
    assert.deepEqual(stepsWhileHeld, [])
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop removal started while another Devin Desktop window (another process) changes the setup waits for it and then runs; fails_when=the removal refuses at the first held-lock refusal; why_new=review finding F3 (Cycle 0143 /ship pass 2, cross-process wait); seam=a separate Node process that holds the real setup lock
test('a Devin Desktop removal waits for the setup lock another process holds and then runs', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, {
    storageDirectory,
    confirmRemoval: true,
  })
  try {
    const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    // gstack-timing-ok: the removal must show it ran nothing while another process holds the lock, which only elapsed time can show; three retry pauses of the wait
    await delay(DEVIN_SETUP_LOCK_RETRY_DELAY_MS * 3)
    const stepsWhileHeld = [...window.steps]
    await holder.release()
    await removal
    // Assert
    assert.deepEqual(stepsWhileHeld, [])
    assert.deepEqual(window.steps, ['remove Devin skill', 'remove MCP entry'])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a setup lock that another process never frees ends the Devin Desktop setup or removal with one fixed sentence after the wait, with no step run and never the learning-storage message; fails_when=the refusal is the lock's own Learning storage sentence, or the operation runs without the lock; why_new=review finding F3 (Cycle 0143 /ship pass 2, refusal sentence); seam=a separate Node process that holds the real setup lock, a wait of three short attempts
test('a Devin Desktop setup lock that stays held refuses with a try-again sentence and runs nothing', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
  let operationRuns = 0
  // Act
  const refused = withDevinSetupLock(
    join(storageDirectory, 'devin-setup'),
    async () => {
      operationRuns += 1
    },
    { attempts: 3, delayMs: 10 },
  )
  // Assert
  try {
    await assert.rejects(refused, {
      message:
        'Another Codebook window is changing the Devin Desktop setup. Try again in a moment.',
    })
    assert.equal(operationRuns, 0)
  } finally {
    await holder.release()
  }
})

// Value: protects=a held-lock refusal of a lock the operation itself takes (the MCP config's) reaches the learner as it is and the setup steps run once; fails_when=the setup lock's retry reruns a half-done setup, or rewrites that refusal as the other window's sentence; why_new=review finding F3 (Cycle 0143 /ship pass 2, only the taking of the lock is waited for); seam=an operation stand-in that throws the held-lock error
test('a held-lock refusal thrown inside a Devin Desktop setup is not retried and keeps its own sentence', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  let operationRuns = 0
  // Act
  const refused = withDevinSetupLock(
    join(storageDirectory, 'devin-setup'),
    async () => {
      operationRuns += 1
      throw new StorageLockHeldError('Learning storage is locked: config')
    },
    { attempts: 3, delayMs: 10 },
  )
  // Assert
  await assert.rejects(refused, {
    message: 'Learning storage is locked: config',
  })
  assert.equal(operationRuns, 1)
})

// Value: protects=the wait for another window's setup lasts about ten seconds, not the Cursor reconnect's two; fails_when=the attempts or the pause shrink so that a setup running in another window ends the second one with a refusal; why_new=review finding F3 (Cycle 0143 /ship pass 2, bounded wait of about ten seconds); seam=the constants of the wait
test('the Devin Desktop setup lock wait lasts between seven and fourteen seconds', () => {
  // Arrange
  const pauses = DEVIN_SETUP_LOCK_WAIT_ATTEMPTS - 1
  // Act
  // Each pause is the delay plus a random share of up to the same delay.
  const waitRangeMs = [
    pauses * DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
    pauses * DEVIN_SETUP_LOCK_RETRY_DELAY_MS * 2,
  ]
  // Assert
  assert.deepEqual(waitRangeMs, [6_900, 13_800])
})
