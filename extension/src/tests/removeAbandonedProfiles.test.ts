import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { listProcesses } from '../runtimeSupport/utils/listProcesses'
import { removeAbandonedProfiles } from '../runtimeSupport/utils/removeAbandonedProfiles'

/**
 * Creates a profile root of the test's own, never the real `/tmp`, and removes it when the test ends.
 * @param context - The test.
 * @returns The root's resolved path.
 * @example
 * const root = await profileRoot(context) // => '/tmp/codebook-sweep-root-a1b2c3'
 */
async function profileRoot(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-sweep-root-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Creates a profile folder as a run leaves it, with one file of the browser and, when given, the owner marker.
 * @param folder - The folder to create.
 * @param owner - The marker's content; left out for a folder without a marker.
 * @example
 * await profileFolder('/root/codebook-browser-killed', { pid: 4242, hostname: 'workstation' })
 */
async function profileFolder(folder: string, owner?: object): Promise<void> {
  await mkdir(join(folder, 'Default'), { recursive: true })
  await writeFile(join(folder, 'Default', 'Preferences'), '{}')
  if (owner)
    await writeFile(join(folder, 'codebook-owner.json'), JSON.stringify(owner))
}

/** Says whether a path still exists. @example await exists('/root/codebook-browser-killed') // => false after the sweep */
function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** The id of a process that has ended, as the editor process of a killed window has: an id no process can have (above Linux's highest, 2 ** 22), because the id of a child that has just exited can be given to a new process before the sweep judges the marker. @example endedProcessId() // => 4194305 */
function endedProcessId(): number {
  return 2 ** 22 + 1
}

test('a profile folder whose marker names a process that is gone is left while a process still runs with it as its profile', async (context) => {
  // Arrange: a process of this test runs with the folder as its profile, as a browser that outlived its editor does.
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-in-use')
  await profileFolder(folder, {
    pid: endedProcessId(),
    hostname: 'workstation',
  })
  const browser = spawn(
    process.execPath,
    [
      '-e',
      'process.stdout.write("ready"); setInterval(() => {}, 1000)',
      '--',
      `--user-data-dir=${folder}`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  context.after(() => browser.kill('SIGKILL'))
  await once(browser.stdout, 'data')
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.deepEqual(removed, [])
  assert.equal(await exists(folder), true)
})

test('a profile folder whose marker names another machine is left, although no process with its id runs here', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-of-another-machine')
  await profileFolder(folder, {
    pid: endedProcessId(),
    hostname: 'another-machine',
  })
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.deepEqual(removed, [])
  assert.equal(await exists(folder), true)
})

test('a link named like a profile folder is left, and the marked folder it points to outside the root is untouched', async (context) => {
  // Arrange
  const root = await profileRoot(context),
    elsewhere = await profileRoot(context)
  const target = join(elsewhere, 'kept')
  await profileFolder(target, {
    pid: endedProcessId(),
    hostname: 'workstation',
  })
  const link = join(root, 'codebook-browser-link')
  await symlink(target, link)
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.deepEqual(removed, [])
  assert.deepEqual(await readdir(root), ['codebook-browser-link'])
  assert.deepEqual((await readdir(target)).sort(), [
    'Default',
    'codebook-owner.json',
  ])
})

test('a marked profile folder of an earlier kernel boot is removed although a process with its id runs now, and a boot time alone removes nothing', async (context) => {
  // Arrange: both markers name the id of this running process; one was written under another kernel boot id, the other under a boot time far in the past.
  const root = await profileRoot(context)
  const ofEarlierKernelBoot = join(root, 'codebook-browser-earlier-boot'),
    ofEarlierBootTime = join(root, 'codebook-browser-earlier-boot-time')
  await profileFolder(ofEarlierKernelBoot, {
    pid: process.pid,
    hostname: 'workstation',
    boot: { id: 'boot-1' },
  })
  await profileFolder(ofEarlierBootTime, {
    pid: process.pid,
    hostname: 'workstation',
    boot: { startedAtMs: 1_000 },
  })
  // Act
  const removedUnderKernelBoot = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
    boot: { id: 'boot-2' },
  })
  const removedUnderBootTime = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
    boot: { startedAtMs: 1_790_000_000_000 },
  })
  // Assert
  assert.deepEqual(removedUnderKernelBoot, [ofEarlierKernelBoot])
  assert.deepEqual(removedUnderBootTime, [])
  assert.deepEqual(await readdir(root), ['codebook-browser-earlier-boot-time'])
})

test('one sweep looks at no more than 64 profile folders, and the rest wait for a later run', async (context) => {
  // Arrange: 65 folders whose editor is gone.
  const root = await profileRoot(context)
  const owner = { pid: endedProcessId(), hostname: 'workstation' }
  for (let index = 0; index < 65; index += 1)
    await profileFolder(join(root, `codebook-browser-${index}`), owner)
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.equal(removed.length, 64)
  assert.equal((await readdir(root)).length, 1)
})

// Value: protects=the sweep reaching the folders a killed editor left when the profile root also holds many folders of builds before the owner marker; fails_when=the bound is taken from the raw listing, so 64 folders without a marker use it up and the marked folder listed after them is never looked at; why_new=Cycle 0045 local review (runtime-1 #1); seam=a profile root of the test's own, whose listing order the test reads before it marks the folder listed last
test('a marked profile folder of a killed editor is removed although 64 folders without a marker are listed before it', async (context) => {
  // Arrange: 65 folders without a marker; the one the directory lists last gets the marker of an editor that is gone. Writing into a folder does not move it in its parent's listing.
  const root = await profileRoot(context)
  for (let index = 0; index < 65; index += 1)
    await profileFolder(join(root, `codebook-browser-${index}`))
  const listedLast = join(root, (await readdir(root)).at(-1)!)
  await writeFile(
    join(listedLast, 'codebook-owner.json'),
    JSON.stringify({ pid: endedProcessId(), hostname: 'workstation' }),
  )
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.deepEqual(removed, [listedLast])
  assert.equal(await exists(listedLast), false)
  assert.equal((await readdir(root)).length, 64)
})

test('a profile root that does not exist is answered with nothing removed', async (context) => {
  // Arrange
  const root = join(await profileRoot(context), 'absent')
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.deepEqual(removed, [])
})

// Value: protects=the sweep after crashes costs one process listing, however many folders killed editors left (Cycle 0045 review PL-6); fails_when=each folder whose owner is gone runs its own `ps -axww`; why_new=no test counted the listings; seam=the process lister the sweep is given, which counts and lists the real processes
test('three profile folders of killed editors are removed with one listing of the processes', async (context) => {
  // Arrange: three marked folders whose editor, an impossible process id, is gone.
  const root = await profileRoot(context)
  const owner = { pid: 2 ** 22 + 1, hostname: 'workstation' }
  for (const name of [
    'codebook-browser-a',
    'codebook-browser-b',
    'codebook-browser-c',
  ])
    await profileFolder(join(root, name), owner)
  let processListings = 0
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    () => {
      processListings += 1
      return listProcesses()
    },
  )
  // Assert
  assert.deepEqual([...removed].sort(), [
    join(root, 'codebook-browser-a'),
    join(root, 'codebook-browser-b'),
    join(root, 'codebook-browser-c'),
  ])
  assert.equal(processListings, 1)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=a sweep that finds no folder of a killed editor does not list the processes at all; fails_when=the sweep lists the processes up front, on every managed launch; why_new=the listing is shared by the sweep since Cycle 0046; seam=the process lister the sweep is given
test('a sweep that finds only a folder of a running editor does not list the processes', async (context) => {
  // Arrange: one marked folder whose editor is this running process.
  const root = await profileRoot(context)
  await profileFolder(join(root, 'codebook-browser-running'), {
    pid: process.pid,
    hostname: 'workstation',
  })
  let processListings = 0
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    () => {
      processListings += 1
      return listProcesses()
    },
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.equal(processListings, 0)
  assert.deepEqual(await readdir(root), ['codebook-browser-running'])
})
