import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fileSystem from 'node:fs/promises'
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
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  listProcesses,
  type ListedProcess,
} from '../runtimeSupport/utils/listProcesses'
import type * as sweepModule from '../runtimeSupport/utils/removeAbandonedProfiles'
import { removeAbandonedProfiles } from '../runtimeSupport/utils/removeAbandonedProfiles'
import { readProcessStart } from '../utils/readProcessStart'
import type * as removalModule from '../utils/removeWithoutFollowing'

import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'
import { standInForPs } from './utils/standInForPs'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

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

/**
 * Builds a process lister of the test's own for the tests that count the listings of a sweep, so that their count does not depend on this machine's own process list.
 * @returns `list`, which answers one process that uses no profile folder, and `listings`, how often it was asked.
 * @example
 * const processes = countingLister()
 * await removeAbandonedProfiles(root, identity, processes.list) // processes.listings() => 1
 */
function countingLister(): {
  list: () => Promise<ListedProcess[]>
  listings: () => number
} {
  let listings = 0
  return {
    list: async () => {
      listings += 1
      return [{ pid: 1, command: '/sbin/init' }]
    },
    listings: () => listings,
  }
}

test('a profile folder whose marker names a process that is gone is left while a process still runs with it as its profile', async (context) => {
  // Arrange: a process of this test runs with the folder as its profile, as a browser that outlived its editor does.
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-in-use')
  await profileFolder(folder, {
    pid: ID_OF_NO_PROCESS,
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
    pid: ID_OF_NO_PROCESS,
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
    pid: ID_OF_NO_PROCESS,
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

// Value: protects=the files of this user that a folder another user planted in the shared /tmp could lead the sweep to: a folder named like a profile with a marker naming a gone process of this machine is never judged unless this user owns it (F3, Cycle 0046 /ship review); fails_when=the sweep judges a folder by its marker alone, so it removes another user's folder, whose content that user may swap for a link while the removal lists it; why_new=every sweep test made its folders as this user; seam=the look without following (`lstat`) the loaded sweep is given, which names another user as the folder's owner; no_claim=Windows, which has no user id and keeps today's judgement by the marker
test(
  'a marked profile folder of a killed editor that another user owns is left untouched and not counted as removed',
  { skip: process.platform === 'win32' && 'Windows has no user id' },
  async (context) => {
    // Arrange: a folder with the marker of a gone process of this machine, whose look names another user as its owner.
    const root = await profileRoot(context)
    const folder = join(root, 'codebook-browser-of-another-user')
    await profileFolder(folder, {
      pid: ID_OF_NO_PROCESS,
      hostname: 'workstation',
    })
    const { removeAbandonedProfiles: sweepAsAnotherUsersFolder } =
      await loadModule<typeof sweepModule>(
        resolve(
          __dirname,
          '../runtimeSupport/utils/removeAbandonedProfiles.js',
        ),
        {
          'node:fs/promises': {
            ...fileSystem,
            lstat: async (path: string) => {
              const entry = await fileSystem.lstat(path)
              return Object.assign(entry, { uid: entry.uid + 1 })
            },
          },
        },
      )
    const processes = countingLister()
    // Act
    const removed = await sweepAsAnotherUsersFolder(
      root,
      { hostname: 'workstation' },
      processes.list,
    )
    // Assert: the loaded sweep's answer is copied into this test's realm before it is compared.
    assert.deepEqual([...removed], [])
    assert.equal(processes.listings(), 0)
    assert.deepEqual((await readdir(folder)).sort(), [
      'Default',
      'codebook-owner.json',
    ])
  },
)

// Value: protects=the files a link inside a profile folder of a killed editor leads to, when the system refuses to unlink that link (Windows for a link this user may not delete, a junction to a volume) (F3, Cycle 0046 /ship review); fails_when=the sweep removes the folder with the recursive `rm` of Node.js, which after the refused unlink looks at the link with `stat`, takes it for the folder it leads to and empties that folder; why_new=every sweep test removed folders without a link inside; seam=a file system whose unlink of a link answers EPERM, with the removal of Node.js as it runs on Windows for a caller that still uses it (fileSystemWhoseLinksResistRemoval), and the process lister the sweep is given
test('a profile folder of a killed editor that holds a link the system refuses to unlink is not removed through the link: the folder the link leads to keeps every file and is never listed', async (context) => {
  // Arrange: a marked folder whose editor is gone, with a link inside it to a folder of the learner outside the profile root.
  const root = await profileRoot(context),
    elsewhere = await profileRoot(context)
  const linkedFolder = join(elsewhere, 'a-folder-of-the-learner')
  await mkdir(linkedFolder)
  await writeFile(join(linkedFolder, 'notes.txt'), 'kept')
  const folder = join(root, 'codebook-browser-killed')
  await profileFolder(folder, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'workstation',
  })
  const link = join(folder, 'a-link-inside')
  await symlink(linkedFolder, link, 'junction')
  const resisting = fileSystemWhoseLinksResistRemoval()
  const walkWhereLinksResist = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    { 'node:fs/promises': resisting.fileSystem },
  )
  const { removeAbandonedProfiles: sweepWhereLinksResist } = await loadModule<
    typeof sweepModule
  >(resolve(__dirname, '../runtimeSupport/utils/removeAbandonedProfiles.js'), {
    'node:fs/promises': resisting.fileSystem,
    '../../utils/removeWithoutFollowing': walkWhereLinksResist,
  })
  // Act
  const removed = await sweepWhereLinksResist(
    root,
    { hostname: 'workstation' },
    countingLister().list,
  )
  // Assert: the link the system keeps is still in the folder, which is not counted as removed, and nothing behind the link was listed or removed. The loaded sweep's answer is copied into this test's realm.
  assert.deepEqual(
    {
      removed: [...removed],
      linkedFolder: await readdir(linkedFolder),
      listedThroughTheLink: resisting.listed.filter(
        (path) => path === link || path === linkedFolder,
      ),
      linkInTheFolder: (await readdir(folder)).includes('a-link-inside'),
    },
    {
      removed: [],
      linkedFolder: ['notes.txt'],
      listedThroughTheLink: [],
      linkInTheFolder: true,
    },
  )
})

// Value: protects=a profile folder of a killed editor whose removal stops at a file the system still holds (Windows keeps a file of an ended browser a moment, an antivirus scan holds one): the owner marker is removed last, so the folder keeps it, and the next sweep, once the file is free, removes the folder (CX10, /ship Codex adversarial review); fails_when=the walk removes the marker before the entry that refuses, so every later sweep skips the folder as one without a marker and it stays for good; why_new=every sweep test removed its folders at the first try; seam=a file system stand-in for the removal walk whose listing of the profile folder names the marker first and whose unlink refuses one file (EBUSY) until the test frees it, and the process lister the sweep is given
test('a profile folder whose removal stops at a file the system still holds keeps its marker, and the next sweep removes it once the file is free', async (context) => {
  // Arrange: a marked folder of a gone editor with a log file the system holds; the walk's listing names the marker first, as a file system may.
  const root = await profileRoot(context)
  const folder = join(root, 'codebook-browser-held')
  await profileFolder(folder, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'workstation',
  })
  const heldFile = join(folder, 'chrome_debug.log')
  await writeFile(heldFile, 'held')
  let fileHeld = true
  const walk = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        readdir: async (path: string): Promise<string[]> => {
          const names = await fileSystem.readdir(path)
          return path === folder
            ? [
                'codebook-owner.json',
                ...names.filter((name) => name !== 'codebook-owner.json'),
              ]
            : names
        },
        unlink: async (path: string): Promise<void> => {
          if (fileHeld && path === heldFile)
            throw Object.assign(
              new Error(`EBUSY: resource busy or locked, unlink '${path}'`),
              { code: 'EBUSY' },
            )
          await fileSystem.unlink(path)
        },
      },
    },
  )
  const { removeAbandonedProfiles: sweepWithHeldFile } = await loadModule<
    typeof sweepModule
  >(resolve(__dirname, '../runtimeSupport/utils/removeAbandonedProfiles.js'), {
    '../../utils/removeWithoutFollowing': walk,
  })
  const firstSweep = await sweepWithHeldFile(
    root,
    { hostname: 'workstation' },
    countingLister().list,
  )
  const markerAfterFirstSweep = await exists(
    join(folder, 'codebook-owner.json'),
  )
  // Act: the system frees the file, and the next run sweeps again.
  fileHeld = false
  const secondSweep = await sweepWithHeldFile(
    root,
    { hostname: 'workstation' },
    countingLister().list,
  )
  // Assert: the loaded sweep's answers are copied into this test's realm.
  assert.deepEqual(
    {
      firstSweep: [...firstSweep],
      markerAfterFirstSweep,
      secondSweep: [...secondSweep],
      folderLeft: await exists(folder),
    },
    {
      firstSweep: [],
      markerAfterFirstSweep: true,
      secondSweep: [folder],
      folderLeft: false,
    },
  )
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
  const owner = { pid: ID_OF_NO_PROCESS, hostname: 'workstation' }
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
    JSON.stringify({ pid: ID_OF_NO_PROCESS, hostname: 'workstation' }),
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

// Value: protects=the sweep after crashes costs one process listing, however many folders killed editors left (Cycle 0045 review PL-6); fails_when=each folder whose owner is gone runs its own `ps -axww`; why_new=no test counted the listings; seam=the process lister the sweep is given, a lister of the test's own that counts (Cycle 0046 row 99: the count no longer depends on this machine's `ps`)
test('three profile folders of killed editors are removed with one listing of the processes', async (context) => {
  // Arrange: three marked folders whose editor, an impossible process id, is gone.
  const root = await profileRoot(context)
  const owner = { pid: ID_OF_NO_PROCESS, hostname: 'workstation' }
  for (const name of [
    'codebook-browser-a',
    'codebook-browser-b',
    'codebook-browser-c',
  ])
    await profileFolder(join(root, name), owner)
  const processes = countingLister()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    processes.list,
  )
  // Assert
  assert.deepEqual([...removed].sort(), [
    join(root, 'codebook-browser-a'),
    join(root, 'codebook-browser-b'),
    join(root, 'codebook-browser-c'),
  ])
  assert.equal(processes.listings(), 1)
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
  const processes = countingLister()
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation' },
    processes.list,
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.equal(processes.listings(), 0)
  assert.deepEqual(await readdir(root), ['codebook-browser-running'])
})

// Value: protects=a process listing that hangs or fails ends the sweep of abandoned profile folders, which the browser's close awaits, with nothing removed; fails_when=the listing has no time bound, so the sweep never ends, or a folder is removed although the processes could not be listed (Cycle 0046 row 87); why_new=every sweep test listed the processes at once; seam=`ps` itself, which is a program of the test that stays silent, and the listing's time bound, shortened to 300 ms
test(
  'a sweep whose process listing never answers ends at the listing’s time bound and removes no profile folder',
  { skip: process.platform === 'win32' && 'the stand-in for ps needs /bin/sh' },
  async (context) => {
    // Arrange: one marked folder whose editor is gone, and a `ps` that prints nothing for 20 s, far beyond the bound, and then ends by itself, so that a sweep without a bound fails this test instead of holding the suite.
    const root = await profileRoot(context)
    const folder = join(root, 'codebook-browser-killed')
    await profileFolder(folder, {
      pid: ID_OF_NO_PROCESS,
      hostname: 'workstation',
    })
    await standInForPs(context, 'setTimeout(() => {}, 20_000)')
    // Act
    const removed = await removeAbandonedProfiles(
      root,
      { hostname: 'workstation' },
      () => listProcesses({ timeoutMs: 300 }),
    )
    // Assert
    assert.deepEqual(removed, [])
    assert.equal(await exists(folder), true)
  },
)

// Value: protects=the profile folders a killed editor left are removed in the same boot although another process has its process id, and the folder of a running editor is never removed; fails_when=a marker is judged by process id and kernel boot alone, so such a folder stays until the next restart (Cycle 0046 rows 2 and 9), or the judgement is not awaited, so every folder counts as abandoned; why_new=every marker test named a process id that no longer exists, a running one without a start, or another kernel boot; seam=none (the markers name this running test process, with another start and with its real one)
test('a marked profile folder of a killed editor whose process id is in use again is removed, and the folder of a running editor with that id stays', async (context) => {
  // Arrange: a killed editor began long ago; this test process has its process id now. A second folder is marked with the real start of this process.
  const root = await profileRoot(context)
  const ofKilledEditor = join(root, 'codebook-browser-of-killed-editor'),
    ofRunningEditor = join(root, 'codebook-browser-of-running-editor')
  await profileFolder(ofKilledEditor, {
    pid: process.pid,
    hostname: 'workstation',
    processStart: startOfKilledWindow(),
  })
  await profileFolder(ofRunningEditor, {
    pid: process.pid,
    hostname: 'workstation',
    processStart: await readProcessStart(process.pid),
  })
  // Act
  const removed = await removeAbandonedProfiles(root, {
    hostname: 'workstation',
  })
  // Assert
  assert.deepEqual(removed, [ofKilledEditor])
  assert.deepEqual(await readdir(root), ['codebook-browser-of-running-editor'])
})

// Value: protects=a sweep over the folders of one running editor costs one read of its start (one spawned ps or PowerShell on macOS and Windows), not one per folder; fails_when=the sweep reads the start again for every marker (ER-12, decision D7); why_new=the marker carries its owner's start since Cycle 0046; seam=the process probe and the file read of the start reader, which counts
test('three profile folders of one running editor are judged with one read of its start', async (context) => {
  // Arrange: this editor is a Linux process of the pid namespace 4026531836, begun at tick 16362446; three marked folders of running process 4194305, which began at clock tick 200. That id is none this test process can have ({@link ID_OF_NO_PROCESS}): with this process's own id, the folders would be judged as this editor's, whose start differs.
  const root = await profileRoot(context)
  for (const name of [
    'codebook-browser-a',
    'codebook-browser-b',
    'codebook-browser-c',
  ])
    await profileFolder(join(root, name), {
      pid: ID_OF_NO_PROCESS,
      hostname: 'workstation',
      processStart: 'linux@4026531836:200',
    })
  context.mock.method(process, 'kill', (): true => true)
  let startReads = 0
  // Act
  const removed = await removeAbandonedProfiles(
    root,
    { hostname: 'workstation', processStart: 'linux@4026531836:16362446' },
    countingLister().list,
    (pid, inputs) =>
      readProcessStart(pid, {
        ...inputs,
        platform: 'linux',
        readLink: () => 'pid:[4026531836]',
        readFile: async () => {
          startReads += 1
          return '4194305 (node) S 1 4194305 4194305 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 200 16637952 1813'
        },
      }),
  )
  // Assert
  assert.deepEqual(removed, [])
  assert.equal(startReads, 1)
  assert.equal((await readdir(root)).length, 3)
})
