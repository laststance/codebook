import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildWxtBuildEnvironment } from '../utils/buildWxtBuildEnvironment'
import { createBuildOutputTail } from '../utils/createBuildOutputTail'
import { findChangedTrackedFile } from '../utils/findChangedTrackedFile'
import { hashTrackedFiles } from '../utils/hashTrackedFiles'
import { observeWxtBuildExit } from '../utils/observeWxtBuildExit'
import { watchWxtBuildTree } from '../utils/watchWxtBuildTree'

// protects=a secret, NODE_OPTIONS and ELECTRON_RUN_AS_NODE of the host stay out of the build environment while PATH and the Next-free basics stay in; fails_when=the host environment is copied whole or Next-only settings leak in; no_claim=that WXT builds with this environment (native check)
test('builds the WXT environment from the allow-list without credentials or Node switches', () => {
  // Arrange
  const host = {
    PATH: '/usr/bin',
    HOME: '/home/learner',
    GITHUB_TOKEN: 'from-host',
    NODE_OPTIONS: '--require /tmp/evil.js',
    ELECTRON_RUN_AS_NODE: '1',
  }
  // Act
  const environment = buildWxtBuildEnvironment(host)
  // Assert
  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.HOME, '/home/learner')
  assert.equal(environment.CI, 'true')
  assert.equal(environment.GITHUB_TOKEN, undefined)
  assert.equal(environment.NODE_OPTIONS, undefined)
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(environment.NEXT_TELEMETRY_DISABLED, undefined)
})

// protects=a probe that throws (EPERM) reads as not confirmed gone, stops polling and never escapes as an uncaught error; fails_when=the throw reaches the caller or the timer keeps probing; no_claim=real process groups (the probe is injected)
test('treats a throwing process-group probe as not confirmed gone and stops polling', async () => {
  // Arrange
  let probeCalls = 0
  const watch = watchWxtBuildTree({
    hasLeaderExited: () => true,
    probe() {
      probeCalls += 1
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    },
    pollMs: 1,
  })
  // Act
  // gstack-timing-ok: the contract is that no probe follows a failed one, so the test waits about 30 poll intervals and counts the calls
  await new Promise((resolve) => setTimeout(resolve, 30))
  const callsAfterWaiting = probeCalls
  // Assert
  assert.equal(watch.isTreeGone(), false)
  assert.equal(callsAfterWaiting, 1)
})

// protects=a tree that the probe confirms gone after the leader exited settles treeGone; fails_when=treeGone never settles for a healthy probe; no_claim=real process groups (the probe is injected)
test('settles treeGone once the leader exited and the probe reports the group gone', async () => {
  // Arrange
  const probeAnswers = [false, true]
  const watch = watchWxtBuildTree({
    hasLeaderExited: () => true,
    probe: () => probeAnswers.shift() ?? true,
    pollMs: 1,
  })
  // Act
  await watch.treeGone
  // Assert
  assert.deepEqual(probeAnswers, [])
})

// protects=a finished build reads as exited even when a grandchild keeps the output pipes open so close never comes; fails_when=exited waits for close and a finished build reads as a timeout; no_claim=real pipes (the child is an EventEmitter)
test('settles exited shortly after the leader exit although close never arrives', async () => {
  // Arrange
  const child = new EventEmitter()
  const { exited, hasLeaderExited } = observeWxtBuildExit(child, 5)
  // Act
  child.emit('exit', 0, null)
  const status = await exited
  // Assert
  assert.deepEqual(status, { code: 0, signal: null })
  assert.equal(hasLeaderExited(), true)
})

// protects=when close follows the exit at once, exited settles on close with its status without waiting for the flush bound; fails_when=exited waits the full bound; no_claim=timing precision (bound is one hour here)
test('settles exited on close without waiting for the flush bound', async () => {
  // Arrange
  const child = new EventEmitter()
  const { exited } = observeWxtBuildExit(child, 3_600_000)
  // Act
  child.emit('exit', 2, null)
  child.emit('close', 2, null)
  const status = await exited
  // Assert
  assert.deepEqual(status, { code: 2, signal: null })
})

// protects=a build failure quotes only the last twenty non-empty output lines, so a chatty build never floods the refusal; fails_when=the tail keeps every line, keeps blank lines or drops the newest; no_claim=the masking of secrets (the redactor's own tests)
test('keeps only the last twenty non-empty build output lines in order', () => {
  // Arrange
  const tail = createBuildOutputTail()
  const lines = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`)
  // Act
  tail.push(`${lines.slice(0, 12).join('\n\n')}\n`, 'stdout')
  tail.push(`${lines.slice(12).join('\n')}\n`, 'stderr')
  const kept = tail.finish()
  // Assert
  assert.equal(kept.length, 20)
  assert.equal(kept[0], 'line 6')
  assert.equal(kept[19], 'line 25')
})

// protects=a file a build deleted or rewrote counts as a tracked-file change, while an untouched file does not; fails_when=a deleted file hashes like its old content or an unchanged file is flagged; no_claim=that Git tracks these files (the caller lists them)
test('names a tracked file the build deleted and ignores one it left alone', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'wxt-hash-'))
  await writeFile(join(root, 'a.ts'), 'one')
  await writeFile(join(root, 'b.ts'), 'two')
  const snapshot = await hashTrackedFiles(root, ['b.ts', 'a.ts'])
  const unchanged = await findChangedTrackedFile(root, snapshot)
  // Act
  await unlink(join(root, 'b.ts'))
  const changed = await findChangedTrackedFile(root, snapshot)
  await rm(root, { recursive: true, force: true })
  // Assert
  assert.equal(unchanged, undefined)
  assert.equal(snapshot.get('a.ts')?.length, 64)
  assert.equal(changed, 'b.ts')
})

// protects=a build that edits one of more files than a single hash batch is still caught; fails_when=files after the first batch of 32 are left out of the snapshot or the comparison; no_claim=the batch size itself
test('hashes every tracked file beyond one batch and catches a change in the last one', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'wxt-hash-'))
  const paths = Array.from({ length: 70 }, (_, index) => `f${index}.ts`)
  for (const path of paths) await writeFile(join(root, path), path)
  const snapshot = await hashTrackedFiles(root, paths)
  // Act
  await writeFile(join(root, 'f69.ts'), 'edited by the build')
  const changed = await findChangedTrackedFile(root, snapshot)
  await rm(root, { recursive: true, force: true })
  // Assert
  assert.equal(snapshot.size, 70)
  assert.equal(changed, 'f69.ts')
})
