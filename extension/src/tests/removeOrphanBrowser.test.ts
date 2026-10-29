import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { listProcesses } from '../runtimeSupport/utils/listProcesses'
import { removeAbandonedProfiles } from '../runtimeSupport/utils/removeAbandonedProfiles'
import type { ProcessStopper } from '../runtimeSupport/utils/stopListedProcesses'

import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'

/** Makes a profile root of the test's own. */
async function profileRoot(context: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-orphan-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Makes a profile folder of a dead editor; `owned` adds the owned-browser marker that records the stand-in browser's executable (node), as the launch records Chrome's. */
async function profileFolder(
  folder: string,
  owned: boolean,
  executable: string = process.execPath,
): Promise<void> {
  await mkdir(join(folder, 'Default'), { recursive: true })
  await writeFile(
    join(folder, 'codebook-owner.json'),
    JSON.stringify({ pid: ID_OF_NO_PROCESS, hostname: 'workstation' }),
  )
  if (owned)
    await writeFile(
      join(folder, 'codebook-owned-browser'),
      JSON.stringify({ executable }),
    )
}

/** Starts a stand-in browser whose command line names `profile` as Chrome's user data directory. */
async function startBrowser(
  context: TestContext,
  profile: string,
  /** Puts a switch terminator (`--`) before the profile switch, so Chrome would read it as a loose argument. */
  afterTerminator = false,
): Promise<ChildProcess> {
  const browser = spawn(
    process.execPath,
    [
      '-e',
      'process.stdout.write("ready"); setInterval(() => {}, 1000)',
      // A loose argument ends Node's own options without a switch terminator.
      'chrome',
      ...(afterTerminator ? ['--'] : []),
      `--user-data-dir=${profile}`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  context.after(() => browser.kill('SIGKILL'))
  await once(browser.stdout, 'data')
  return browser
}

/** Says whether a path exists. */
function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** A stopper that records the signalled processes and signals none. */
function recordingStopper(): { stopper: ProcessStopper; pids: number[] } {
  const pids: number[] = []
  return {
    pids,
    stopper: {
      platform: 'linux',
      signal: (pid, signal): void => {
        if (signal !== 0) pids.push(pid)
      },
      taskkill: async () => undefined,
      sleep: async () => undefined,
    },
  }
}

// Value: protects=ER18, with SIGTERM on Linux and macOS and taskkill /T /F on Windows (the Windows job runs this file); fails_when=a live browser of a crashed editor's owned profile survives the sweep or the folder stays; no_claim=Chrome helper processes
test('the sweep stops the live browser that names an owned profile of a dead editor and removes the folder', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true)
  const browser = await startBrowser(context, folder)
  const exited = once(browser, 'exit')
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  await exited
  // Assert
  assert.deepEqual(removed, [folder])
  assert.equal(await exists(folder), false)
  // POSIX ends the browser with SIGTERM; Windows ends its tree with taskkill /F, which leaves exit code 1 and no signal.
  if (process.platform === 'win32') assert.equal(browser.exitCode, 1)
  else assert.equal(browser.signalCode, 'SIGTERM')
})

// Value: protects=ER18's exact-match rule; fails_when=a process whose --user-data-dir only shares a prefix with the folder is signalled; no_claim=every command-line spelling (profileProcesses tests)
test('the sweep signals no process whose command line merely shares a prefix with the owned folder, and still removes the folder', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true)
  const bystander = await startBrowser(context, `${folder}-other`)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    undefined,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [folder])
  assert.deepEqual(signalling.pids, [])
  assert.equal(bystander.exitCode, null)
})

// Value: protects=existing sweep behaviour; fails_when=a folder without the owned-browser marker has its live process signalled; no_claim=other markers
test('the sweep leaves the live process and the folder of a profile without the owned-browser marker alone', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-managed')
  await profileFolder(folder, false)
  await startBrowser(context, folder)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    undefined,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(signalling.pids, [])
  assert.equal(await exists(folder), true)
})

// Value: protects=ER18 (a listing that fails leaves everything); fails_when=an unreadable process list leads to a signal or a removal; no_claim=the real listing's failure modes
test('the sweep leaves an owned profile and signals nothing when the processes cannot be listed', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    async () => {
      throw new Error('ps failed')
    },
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(signalling.pids, [])
  assert.equal(await exists(folder), true)
})

// Value: protects=ER18's owner rule; fails_when=a live editor's owned browser is stopped; no_claim=process identity beyond the marker
test('the sweep leaves the browser and folder of an owned profile whose editor still runs', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await mkdir(join(folder, 'Default'), { recursive: true })
  await writeFile(join(folder, 'codebook-owned-browser'), '')
  await writeFile(
    join(folder, 'codebook-owner.json'),
    JSON.stringify({ pid: process.pid, hostname: 'workstation' }),
  )
  await startBrowser(context, folder)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    undefined,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(signalling.pids, [])
  assert.equal(await exists(folder), true)
})

// Value: protects=ER18 (a process that does not match exactly is never signalled; B1); fails_when=the sweep signals a pid from a listing made before it, for example a pid that was reused since; no_claim=the real reuse of a pid
test('the sweep lists the processes again before it signals and signals nothing when the browser is gone from the new listing', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true)
  await startBrowser(context, folder)
  const signalling = recordingStopper()
  let listings = 0
  // The first listing still holds the stand-in browser; every later one is the machine after it ended.
  const listing = async (inputs: Parameters<typeof listProcesses>[0]) =>
    ++listings === 1 ? listProcesses(inputs) : []
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    listing,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [folder])
  assert.deepEqual(signalling.pids, [])
})

// Value: protects=ER18 and B2 (only the recorded executable is signalled); fails_when=a process that is not the recorded browser but prints --user-data-dir=<folder> is signalled; no_claim=Chrome helper executables
test('the sweep signals no process whose executable is not the one recorded for the owned profile, and keeps the folder', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true, '/opt/google/chrome/chrome')
  const impostor = await startBrowser(context, folder)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    undefined,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(signalling.pids, [])
  assert.equal(impostor.exitCode, null)
  assert.equal(await exists(folder), true)
})

// Value: protects=ER18 and B2 (the exact switch before any terminator); fails_when=a process that carries --user-data-dir=<folder> only after a -- is signalled; no_claim=Windows (the Windows job runs this file with its own parsing)
test('the sweep signals no process that names the folder only after a switch terminator, and keeps the folder', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true)
  const loose = await startBrowser(context, folder, true)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    undefined,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(signalling.pids, [])
  assert.equal(loose.exitCode, null)
})

// Value: protects=ER18 for folders an older launch made; fails_when=an owned-browser marker without a recorded executable lets the sweep signal a process; no_claim=migration of old folders
test('the sweep signals nothing for an owned profile whose marker records no executable', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-owned')
  await profileFolder(folder, true)
  await writeFile(join(folder, 'codebook-owned-browser'), '')
  await startBrowser(context, folder)
  const signalling = recordingStopper()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    undefined,
    undefined,
    undefined,
    signalling.stopper,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(signalling.pids, [])
})
