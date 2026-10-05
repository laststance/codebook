import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as claimModule from '../utils/claimWikiUpdateMarker'
import { claimWikiUpdateMarker } from '../utils/claimWikiUpdateMarker'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import type * as placeModule from '../utils/placeStorageLock'
import { placeStorageLock } from '../utils/placeStorageLock'
import {
  readLiveWikiUpdateMarker,
  type WikiUpdateMarkerJudgement,
} from '../utils/readLiveWikiUpdateMarker'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { idleChild } from './utils/idleChild'
import { loadModule } from './utils/loadModule'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

/** A process id that names no process on the machine the tests run on. */
const PID_OF_NO_PROCESS = 2 ** 22 + 1

/** Answers the start of this test process as the fixed window {@link AS_THIS_WINDOW} records it; the start of any other process cannot be read. */
const readStartOfThisWindow: ProcessStartReader = async (pid) =>
  pid === process.pid ? 'linux:16362446' : undefined

/**
 * A window with a fixed identity, for the tests that state a marker or a claim file byte for byte: a Linux process of the host "workstation" (its digest is d195d36bd79da7df) in an editor with the machine id "machine-a" (digest f9c8c7ddcf3d5f56), under the kernel boot "boot-1", begun at clock tick 16362446.
 * Every window of such a test is this test process, so the start reader answers that start for its process id.
 */
const AS_THIS_WINDOW = {
  identity: {
    hostname: 'workstation',
    machineId: 'machine-a',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-1' },
    processStart: 'linux:16362446',
  },
  readStart: readStartOfThisWindow,
}

/** How {@link AS_THIS_WINDOW} names its machine and its process in a marker: by digests, boot and process start, never by host name or machine id. */
const OWNER_OF_THIS_WINDOW = {
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  boot: { id: 'boot-1' },
  processStart: 'linux:16362446',
}

/** A window on another machine that works on the same project folder (a shared folder): the host "laptop", with digests of its own. Its process has this test process's id in its own space of process ids. */
const AS_WINDOW_OF_ANOTHER_MACHINE = {
  identity: {
    hostname: 'laptop',
    machineKey: '1fb1404a9738d5ed',
    hostKey: '5f0c1a8d2e3b4a69',
    boot: { id: 'boot-of-the-laptop' },
    processStart: 'linux:777',
  },
  readStart: readStartOfTheLaptopWindow,
}

/** Answers the start of the window {@link AS_WINDOW_OF_ANOTHER_MACHINE} for this test process's id; the start of any other process cannot be read. */
async function readStartOfTheLaptopWindow(
  pid: number,
): Promise<string | undefined> {
  return pid === process.pid ? 'linux:777' : undefined
}

/** A point that one window of a test waits at until another window has passed it. @example const markerRemoved = gate(); await markerRemoved.passed */
function gate(): { passed: Promise<void>; open: () => void } {
  let open = (): void => undefined
  const passed = new Promise<void>((resolvePassed) => {
    open = resolvePassed
  })
  return { passed, open }
}

/** Makes an empty Wiki output folder in a temporary project and names its marker file. */
async function createWikiFolder(): Promise<{
  directory: string
  outputDirectory: string
  markerPath: string
}> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-marker-')),
  )
  const outputDirectory = join(directory, 'wiki')
  await mkdir(outputDirectory)
  return {
    directory,
    outputDirectory,
    markerPath: `${outputDirectory}.update-run.json`,
  }
}

// Value: protects=other editor windows after a stopped VS Code watch whose reservation could not be written (a full disk, changed permissions); fails_when=the claim takes the reservation for written before the write succeeded, so the end of the watch finds another text on disk, removes nothing, and other windows are refused with "Another editor window is updating this Wiki" until this window closes; why_new=Cycle 0045 local review wiki-1 #6 (a); seam=the file system's write of the reservation, which is made to fail
test('a reservation that cannot be written leaves the run’s marker, and the end of the watch still removes it', async () => {
  // Arrange: a claim whose file system refuses every write of a reservation.
  const wiki = await createWikiFolder()
  const { claimWikiUpdateMarker: claimOnAFullDisk } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      writeFile: async (
        path: string,
        text: string,
        options?: { flag?: string },
      ) => {
        if (text.includes('watchEndedAtMs'))
          throw Object.assign(new Error('ENOSPC: no space left on device'), {
            code: 'ENOSPC',
          })
        await writeFile(path, text, options)
      },
    },
  })
  const runMarker = {
    pid: process.pid,
    windowId: 'window-a',
    host: 'vscode' as const,
    startedAtMs: 1_790_000_000_000,
  }
  try {
    const claim = await claimOnAFullDisk(
      wiki.outputDirectory,
      runMarker,
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in claim)

    // Act
    const reservation = await claim.reserve(1_790_000_060_000).then(
      () => 'written',
      (error: Error) => error.message,
    )
    const markerAfterTheFailedWrite = await readFile(wiki.markerPath, 'utf8')
    await claim.release()

    // Assert
    assert.equal(reservation, 'ENOSPC: no space left on device')
    assert.equal(
      markerAfterTheFailedWrite,
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446"}',
    )
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the look of a second window at the marker at the moment the first window's watch stops; fails_when=the reservation is written into the marker file in place, which empties the file first, so a window that reads then finds no marker and starts without "Update anyway"; why_new=Cycle 0045 local review wiki-1 #6 (b); seam=none (a second name of the marker file shows whether the file itself was rewritten)
test('the marker file a second window may be reading is not rewritten when it becomes a reservation: the reservation is a new file moved over it', async () => {
  // Arrange: a second name of the run's marker file stands for a reader that has it open.
  const wiki = await createWikiFolder()
  const openedByAReader = join(wiki.directory, 'opened-by-a-reader')
  const runMarker = {
    pid: process.pid,
    windowId: 'window-a',
    host: 'vscode' as const,
    startedAtMs: 1_790_000_000_000,
  }
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      runMarker,
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in claim)
    await link(wiki.markerPath, openedByAReader)

    // Act
    await claim.reserve(1_790_000_060_000)

    // Assert
    assert.equal(
      await readFile(openedByAReader, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446"}',
    )
    assert.equal(
      await readFile(wiki.markerPath, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446","watchEndedAtMs":1790000060000}',
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'opened-by-a-reader',
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the rule that of two windows that start at the same moment only one runs, when a killed editor's marker is in the way; fails_when=the second window removes "the stale marker" by its path after the first one has replaced it by its own, so both hold a claim and two agents update one Wiki; why_new=Cycle 0045 local review wiki-1 #7; seam=the second window's look at the marker, after which the first window's claim is let through
test('of two windows that start on a killed editor’s marker at the same moment only one runs', async () => {
  // Arrange: a marker of a process that is gone, and a second window whose look at it is followed by the first window's whole claim.
  const wiki = await createWikiFolder()
  const startedAtMs = Date.now()
  await writeFile(
    wiki.markerPath,
    JSON.stringify({
      pid: 2 ** 22 + 1,
      windowId: 'killed-editor',
      host: 'vscode',
      startedAtMs,
    }),
  )
  const firstWindow = {
    pid: process.pid,
    windowId: 'window-a',
    host: 'vscode' as const,
    startedAtMs,
  }
  let firstWindowClaim: Promise<claimModule.WikiUpdateMarkerClaim> | undefined
  const { claimWikiUpdateMarker: claimAsSecondWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readLiveWikiUpdateMarker': {
      readLiveWikiUpdateMarker: async (
        outputDirectory: string,
        ownWindowId: string,
        judgement?: Partial<WikiUpdateMarkerJudgement>,
      ) => {
        const looked = await readLiveWikiUpdateMarker(
          outputDirectory,
          ownWindowId,
          judgement,
        )
        // Once: right after the second window saw the stale marker, the first window removes it and writes its own.
        firstWindowClaim ??= claimWikiUpdateMarker(
          wiki.outputDirectory,
          firstWindow,
          AS_THIS_WINDOW,
        )
        await firstWindowClaim
        return looked
      },
    },
  })
  try {
    // Act
    const secondClaim = await claimAsSecondWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-b',
        host: 'vscode',
        startedAtMs,
      },
      AS_THIS_WINDOW,
    )

    const firstClaim = await firstWindowClaim

    // Assert
    assert.ok(firstClaim && 'release' in firstClaim)
    assert.deepEqual(JSON.parse(JSON.stringify(secondClaim)), {
      heldBy: { ...firstWindow, ...OWNER_OF_THIS_WINDOW },
    })
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      ...firstWindow,
      ...OWNER_OF_THIS_WINDOW,
    })
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

/** Says in words how one window's claim ended, so a test states the outcome of every window side by side. */
function outcomeOf(
  claiming: Promise<claimModule.WikiUpdateMarkerClaim>,
): Promise<string> {
  return claiming.then(
    (claim) => {
      if ('release' in claim) return 'holds the claim'
      return 'windowId' in claim.heldBy
        ? `held by ${claim.heldBy.windowId}`
        : 'refused while another window writes its marker'
    },
    (error: { code?: string }) => `refused with ${error.code}`,
  )
}

/** Writes the marker of an editor that was killed: its recorded process no longer exists. */
async function leaveKilledEditorsMarker(markerPath: string): Promise<void> {
  await writeFile(
    markerPath,
    JSON.stringify({
      pid: PID_OF_NO_PROCESS,
      windowId: 'killed-editor',
      host: 'vscode',
      startedAtMs: Date.now(),
    }),
  )
}

// Value: protects=the rule that only one window updates a Wiki, when three start on a killed editor's marker at once; fails_when=a window removes "the stale marker" after another window has replaced it by its own, and a third window writes onto the path that removal emptied, so two windows hold a claim and two agents update one Wiki; why_new=Cycle 0045 local review wiki-1 #7, the three-window case the first fix left; seam=the first window's removal of the marker: the second window's whole claim runs right before it and the third window's right after it
test('of three windows that start on a killed editor’s marker at the same moment only one runs', async () => {
  // Arrange: a killed editor's marker, and a first window whose removal of it lets the second window in right before and the third right after.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const startedAtMs = Date.now()
  const windowNamed = (windowId: string) => ({
    pid: process.pid,
    windowId,
    host: 'vscode' as const,
    startedAtMs,
  })
  let secondStart: Promise<string> | undefined
  let thirdStart: Promise<string> | undefined
  const { claimWikiUpdateMarker: claimAsFirstWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      rm: async (path: string, options?: { force?: boolean }) => {
        // Only the first removal of the marker itself is the moment the other windows arrive at.
        if (path !== wiki.markerPath || secondStart) {
          await rm(path, options)
          return
        }
        secondStart = outcomeOf(
          claimWikiUpdateMarker(
            wiki.outputDirectory,
            windowNamed('window-b'),
            AS_THIS_WINDOW,
          ),
        )
        await secondStart
        await rm(path, options)
        thirdStart = outcomeOf(
          claimWikiUpdateMarker(
            wiki.outputDirectory,
            windowNamed('window-c'),
            AS_THIS_WINDOW,
          ),
        )
        await thirdStart
      },
    },
  })
  try {
    // Act
    const firstWindow = await outcomeOf(
      claimAsFirstWindow(
        wiki.outputDirectory,
        windowNamed('window-a'),
        AS_THIS_WINDOW,
      ),
    )
    const secondWindow = await secondStart
    const thirdWindow = await thirdStart

    // Assert: the second window finds the first one removing the marker and is refused as for a marker that stays in the way; the third writes onto the emptied path and is the one that runs.
    assert.deepEqual(
      { firstWindow, secondWindow, thirdWindow },
      {
        firstWindow: 'held by window-c',
        secondWindow: 'refused with EEXIST',
        thirdWindow: 'holds the claim',
      },
    )
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      ...windowNamed('window-c'),
      ...OWNER_OF_THIS_WINDOW,
    })
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=a window that takes an update over at the moment the first window removes its stopped watch's reservation (the reservation's timer and the watch bound, after which other windows may pass it, fall on the same moment); fails_when=the first window checks that the file is its reservation and removes it in two steps without the claim, so the marker the other window wrote in between is removed and a further window can start beside it; why_new=Cycle 0045 local review wiki-1 #7, follow-up; seam=the first window's removal of its reservation, right before which the other window's whole claim runs
test('a window that starts at the moment a stopped watch’s reservation is removed is refused for that moment and never has its marker removed', async () => {
  // Arrange: a window whose watch stopped, and whose removal of its reservation lets another window's start in right before it.
  const wiki = await createWikiFolder()
  let otherStart: Promise<string> | undefined
  const { claimWikiUpdateMarker: claimAsWatchingWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      rm: async (path: string, options?: { force?: boolean }) => {
        if (path === wiki.markerPath && !otherStart) {
          otherStart = outcomeOf(
            claimWikiUpdateMarker(wiki.outputDirectory, {
              pid: process.pid,
              windowId: 'window-b',
              host: 'vscode',
              startedAtMs: Date.now(),
            }),
          )
          await otherStart
        }
        await rm(path, options)
      },
    },
  })
  try {
    const claim = await claimAsWatchingWindow(wiki.outputDirectory, {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    })
    assert.ok('reserve' in claim)
    await claim.reserve(Date.now())

    // Act
    await claim.release()
    const otherWindow = await otherStart

    // Assert
    assert.equal(otherWindow, 'refused with EEXIST')
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the window that took over a run's marker which had outlasted its bound; fails_when=the first window's watch, ending late, writes its reservation over whatever the marker file holds, so the running window's marker is replaced and later removed; why_new=Cycle 0045 local review wiki-1 #7, follow-up; seam=none
test('a watch that ends after another window took its outlasted marker over leaves that window’s marker in place', async () => {
  // Arrange: a run that started twenty-three minutes ago, longer than any run's marker counts (21 minutes and 30 s), and a second window that took its marker over.
  const wiki = await createWikiFolder()
  const takingOver = {
    pid: process.pid,
    windowId: 'window-b',
    host: 'vscode' as const,
    startedAtMs: Date.now(),
  }
  try {
    const outlasted = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now() - 23 * 60_000,
      },
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in outlasted)
    const takenOver = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, takingOver, AS_THIS_WINDOW),
    )

    // Act: the first window's watch ends now and its run is recorded.
    await outlasted.reserve(Date.now())
    const markerAfterTheReservation = await readFile(wiki.markerPath, 'utf8')
    await outlasted.release()

    // Assert
    assert.equal(takenOver, 'holds the claim')
    assert.deepEqual(JSON.parse(markerAfterTheReservation), {
      ...takingOver,
      ...OWNER_OF_THIS_WINDOW,
    })
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      ...takingOver,
      ...OWNER_OF_THIS_WINDOW,
    })
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later start after a window was killed while it held the claim on the marker and its process id went to another process; fails_when=such a claim counts for as long as a process has its id, so a stale marker can never be removed and every start ends with a file error; why_new=Cycle 0045 local review wiki-1 #7, follow-up, rewritten in Cycle 0046 (row 2, ER-9): the claim is removed by the start its owner recorded, at once, and no longer by its age; seam=none
test('a claim on the marker that a killed window left a moment ago does not keep a stale marker in place, although a process has its id: that process began at another time', async () => {
  // Arrange: a killed editor's marker, and a claim written just now that records this machine, the id of this test process, which runs, and the start of a process that began long ago.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const { machineKey, hostKey } = await currentStorageOwner()
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'left-by-a-killed-window'),
    JSON.stringify({
      pid: process.pid,
      machineKey,
      hostKey,
      processStart: startOfKilledWindow(),
    }),
  )
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert
    assert.equal(start, 'holds the claim')
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

test('a claim on the marker whose window was killed a moment ago does not keep a stale marker in place', async () => {
  // Arrange: a killed editor's marker, and a claim written just now whose recorded process no longer exists.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'left-by-a-killed-window'),
    JSON.stringify({
      pid: PID_OF_NO_PROCESS,
      ...(await currentStorageOwner()),
    }),
  )
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert
    assert.equal(start, 'holds the claim')
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the rule that only one window updates a Wiki, at the moment a window creates its marker; fails_when=the marker is created in place and written afterwards, so for the time of one write it exists without content, a second window takes it for nobody's, removes it and starts, and both update the Wiki (row 16, PL-8); why_new=Cycle 0046 row 16; seam=the first window's exclusive write, which creates its file, lets the second window start and only then writes the content
test('a second window never finds a marker file without content while the first window writes its marker, and only one of the two runs', async () => {
  // Arrange: a first window whose file system creates the file of an exclusive write, then lets the second window start, and only then writes the content.
  const wiki = await createWikiFolder()
  const startedAtMs = Date.now()
  let markerWhileTheWriteIsPaused: string | undefined
  let secondStart: Promise<string> | undefined
  let hasPausedAWrite = false
  const pausedBetweenCreationAndContent = {
    ...fileSystem,
    writeFile: async (
      path: string,
      text: string,
      options?: { flag?: string },
    ): Promise<void> => {
      // Only the first exclusive write is paused.
      if (options?.flag !== 'wx' || hasPausedAWrite) {
        await writeFile(path, text, options)
        return
      }
      hasPausedAWrite = true
      await writeFile(path, '', options)
      markerWhileTheWriteIsPaused = await readFile(
        wiki.markerPath,
        'utf8',
      ).catch(() => 'no marker file')
      secondStart = outcomeOf(
        claimWikiUpdateMarker(
          wiki.outputDirectory,
          {
            pid: process.pid,
            windowId: 'window-b',
            host: 'vscode',
            startedAtMs,
          },
          AS_THIS_WINDOW,
        ),
      )
      await secondStart
      await writeFile(path, text)
    },
  }
  const placeWithAPausedWrite = await loadModule<typeof placeModule>(
    resolve(__dirname, '../utils/placeStorageLock.js'),
    { 'node:fs/promises': pausedBetweenCreationAndContent },
  )
  const { claimWikiUpdateMarker: claimAsFirstWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': pausedBetweenCreationAndContent,
    './placeStorageLock': placeWithAPausedWrite,
  })
  try {
    // Act
    const firstWindow = await outcomeOf(
      claimAsFirstWindow(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs,
        },
        AS_THIS_WINDOW,
      ),
    )
    const secondWindow = await secondStart

    // Assert: the first window wrote beside the marker's path, so the second found no marker file, created its own and runs.
    assert.deepEqual(
      { markerWhileTheWriteIsPaused, firstWindow, secondWindow },
      {
        markerWhileTheWriteIsPaused: 'no marker file',
        firstWindow: 'held by window-b',
        secondWindow: 'holds the claim',
      },
    )
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      pid: process.pid,
      windowId: 'window-b',
      host: 'vscode',
      startedAtMs,
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-1' },
      processStart: 'linux:16362446',
    })
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=Wiki updates in a project on a file system that cannot hard-link (some network and container mounts); fails_when=the marker's creation needs the link, so every start there ends with a file error, or the fallback leaves the marker without its content or lets a second window in; why_new=Cycle 0046 row 16 (ER-6): the marker is created by placeStorageLock; seam=the file system's link, which is made to fail
test('on a file system without hard links the marker is still created with its whole content, and a second window is refused', async () => {
  // Arrange
  const wiki = await createWikiFolder()
  const placeWithoutHardLinks = await loadModule<typeof placeModule>(
    resolve(__dirname, '../utils/placeStorageLock.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        link: async () => {
          throw Object.assign(
            new Error('EPERM: operation not permitted, link'),
            { code: 'EPERM' },
          )
        },
      },
    },
  )
  const { claimWikiUpdateMarker: claimWithoutHardLinks } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './placeStorageLock': placeWithoutHardLinks,
  })
  const windowNamed = (windowId: string) => ({
    pid: process.pid,
    windowId,
    host: 'cursor' as const,
    startedAtMs: 1_790_000_000_000,
  })
  try {
    // Act
    const firstWindow = await outcomeOf(
      claimWithoutHardLinks(
        wiki.outputDirectory,
        windowNamed('window-a'),
        AS_THIS_WINDOW,
      ),
    )
    const secondWindow = await outcomeOf(
      claimWithoutHardLinks(wiki.outputDirectory, windowNamed('window-b'), {
        ...AS_THIS_WINDOW,
        now: () => 1_790_000_000_000,
      }),
    )

    // Assert
    assert.deepEqual(
      { firstWindow, secondWindow },
      { firstWindow: 'holds the claim', secondWindow: 'held by window-a' },
    )
    assert.equal(
      await readFile(wiki.markerPath, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"cursor","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446"}',
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=a window of 0.2.29.0, or one on a file system without hard links, at the moment it has created its marker and not yet written it; fails_when=a window that meets the empty file removes it at once and starts beside its writer (row 16), or never removes it and a killed writer's empty file refuses every start; why_new=Cycle 0046 row 16 (ER-6); seam=the file's modification time and the clock handed to the claim
test('a window that meets a marker file without content written less than 2 s ago is refused as beside a starting update and leaves the file, and 2 s after the write it removes the file and runs', async () => {
  // Arrange: an empty marker file, last written at a fixed time.
  const wiki = await createWikiFolder()
  await writeFile(wiki.markerPath, '')
  const writtenAt = new Date(1_790_000_000_000)
  await utimes(wiki.markerPath, writtenAt, writtenAt)
  const startingWindow = {
    pid: process.pid,
    windowId: 'window-a',
    host: 'vscode' as const,
    startedAtMs: 1_790_000_000_000,
  }
  try {
    // Act
    const startAfter1999Ms = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      startingWindow,
      { ...AS_THIS_WINDOW, now: () => 1_790_000_001_999 },
    )
    const markerAfterTheRefusal = await readFile(wiki.markerPath, 'utf8')
    const startAfter2000Ms = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, startingWindow, {
        ...AS_THIS_WINDOW,
        now: () => 1_790_000_002_000,
      }),
    )

    // Assert
    assert.deepEqual(startAfter1999Ms, {
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    })
    assert.equal(markerAfterTheRefusal, '')
    assert.equal(startAfter2000Ms, 'holds the claim')
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the rule that only one window updates a Wiki, when two start on one stale marker a moment apart; fails_when=the second window, which finds no marker under its claim because the first has just removed the stale one, still removes "the marker" by its path, which by then is the first window's fresh marker, and both update the Wiki (row 52, a defect of 0.2.29.0); why_new=Cycle 0046 row 52 (decision D12); seam=the second window's looks at the marker and the first window's second creation, which are let through in the order of the defect
test('a window that finds no marker under its claim removes nothing: the marker another window created in that instant stays, and the window is refused', async () => {
  // Arrange: a killed editor's marker. The second window looks at it; then the first window removes it under its claim and waits before it creates its own, until the second window has looked again under its claim and found nothing.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const startedAtMs = Date.now()
  const staleMarkerRemoved = gate()
  const secondWindowLookedUnderItsClaim = gate()
  const freshMarkerCreated = gate()
  let creationsOfTheFirstWindow = 0
  const { claimWikiUpdateMarker: claimAsFirstWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './placeStorageLock': {
      placeStorageLock: async (
        ...placement: Parameters<typeof placeStorageLock>
      ) => {
        creationsOfTheFirstWindow += 1
        // The first creation meets the stale marker; the second follows its removal.
        if (creationsOfTheFirstWindow === 1) {
          await placeStorageLock(...placement)
          return
        }
        staleMarkerRemoved.open()
        await secondWindowLookedUnderItsClaim.passed
        await placeStorageLock(...placement)
        freshMarkerCreated.open()
      },
    },
  })
  let firstStart: Promise<string> | undefined
  const looksOfTheSecondWindow: string[] = []
  const { claimWikiUpdateMarker: claimAsSecondWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readLiveWikiUpdateMarker': {
      readLiveWikiUpdateMarker: async (
        outputDirectory: string,
        ownWindowId: string,
        judgement?: Partial<WikiUpdateMarkerJudgement>,
      ) => {
        const look = await readLiveWikiUpdateMarker(
          outputDirectory,
          ownWindowId,
          judgement,
        )
        looksOfTheSecondWindow.push(look.kind)
        // After its first look the first window removes the stale marker; after its look under the claim the first window creates its own.
        if (looksOfTheSecondWindow.length === 1) {
          firstStart = outcomeOf(
            claimAsFirstWindow(
              wiki.outputDirectory,
              {
                pid: process.pid,
                windowId: 'window-a',
                host: 'vscode',
                startedAtMs,
              },
              AS_THIS_WINDOW,
            ),
          )
          await staleMarkerRemoved.passed
        }
        if (looksOfTheSecondWindow.length === 2) {
          secondWindowLookedUnderItsClaim.open()
          await freshMarkerCreated.passed
        }
        return look
      },
    },
  })
  try {
    // Act
    const secondWindow = await outcomeOf(
      claimAsSecondWindow(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-b',
          host: 'vscode',
          startedAtMs,
        },
        AS_THIS_WINDOW,
      ),
    )
    const firstWindow = await firstStart

    // Assert
    assert.deepEqual(
      { looksOfTheSecondWindow, firstWindow, secondWindow },
      {
        looksOfTheSecondWindow: ['unowned', 'none', 'live'],
        firstWindow: 'holds the claim',
        secondWindow: 'held by window-a',
      },
    )
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs,
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-1' },
      processStart: 'linux:16362446',
    })
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner's computer name and editor machine id, which must not reach a file of the project folder (`.codebook/` is not ignored by Git, so a commit would publish them); fails_when=the claim on the marker records the whole storage identity as the storage lock's claim does, with `hostname` and `machineId` (row 18, PL-10); why_new=Cycle 0046 row 18; seam=the look under the claim, at which the claim file is read
test('the claim on the marker, a file in the learner’s project folder, names its window by digests, boot and process start, never by the host name or the editor’s machine id', async () => {
  // Arrange: a killed editor's marker, so the start takes the claim; the claim's files are read while it is held.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  let looks = 0
  let claimFilesWhileTheClaimIsHeld: string[] = []
  const { claimWikiUpdateMarker: claimAndReadTheClaim } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readLiveWikiUpdateMarker': {
      readLiveWikiUpdateMarker: async (
        outputDirectory: string,
        ownWindowId: string,
        judgement?: Partial<WikiUpdateMarkerJudgement>,
      ) => {
        looks += 1
        // The second look is the one under the claim.
        if (looks === 2)
          claimFilesWhileTheClaimIsHeld = await Promise.all(
            (await readdir(claimDirectory)).map((claimName) =>
              readFile(join(claimDirectory, claimName), 'utf8'),
            ),
          )
        return readLiveWikiUpdateMarker(outputDirectory, ownWindowId, judgement)
      },
    },
  })
  try {
    // Act: the window's host is "workstation" and its editor's machine id "machine-a".
    const start = await outcomeOf(
      claimAndReadTheClaim(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: 1_790_000_000_000,
        },
        AS_THIS_WINDOW,
      ),
    )

    // Assert
    assert.equal(start, 'holds the claim')
    assert.deepEqual(claimFilesWhileTheClaimIsHeld, [
      '{"pid":' +
        process.pid +
        ',"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446"}',
    ])
    assert.equal(
      await readFile(wiki.markerPath, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446"}',
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later start beside a window of 0.2.29.0 that was killed while it held the claim on the marker and whose process id went to another process; fails_when=a claim without a process start, which cannot be judged by a start, loses its 60 s age rule and stays for as long as a process has its id, so a stale marker is never removed (decision D8), or the rule removes a claim that a running window of 0.2.29.0 took a moment ago; why_new=Cycle 0046 row 2 (ER-4); seam=the claim file's modification time and the clock handed to the claim
test('a claim on the marker without a process start, as 0.2.29.0 writes it, keeps a stale marker in place for 60 s and is removed after that, although a process has its id', async () => {
  // Arrange: a killed editor's marker, and a claim of this machine and boot that records the id of this test process, which runs, and no process start.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const leftClaim = join(claimDirectory, 'left-by-a-killed-window')
  const { boot } = await currentStorageOwner()
  await mkdir(claimDirectory)
  await writeFile(
    leftClaim,
    JSON.stringify({ pid: process.pid, hostname: hostname(), boot }),
  )
  const claimedAt = new Date(1_790_000_000_000)
  await utimes(leftClaim, claimedAt, claimedAt)
  const startingWindow = {
    pid: process.pid,
    windowId: 'window-a',
    host: 'vscode' as const,
    startedAtMs: 1_790_000_000_000,
  }
  try {
    // Act
    const startAfter60Seconds = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, startingWindow, {
        now: () => 1_790_000_060_000,
      }),
    )
    const startAMillisecondLater = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, startingWindow, {
        now: () => 1_790_000_060_001,
      }),
    )

    // Assert
    assert.deepEqual(
      { startAfter60Seconds, startAMillisecondLater },
      {
        startAfter60Seconds: 'refused with EEXIST',
        startAMillisecondLater: 'holds the claim',
      },
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=a running window of this machine that holds the claim on the marker while its extension host is suspended for more than a minute (a debugger, a sleeping laptop); fails_when=its claim is removed by age after 60 s although its process runs, so a second window takes the claim and both change the marker (row 2, decision D8); why_new=Cycle 0046 row 2 (ER-4): the 60 s lease is dropped for a claim whose owner can be judged here; seam=the claim file's modification time
test('a claim on the marker that a running window of this machine has held for two minutes stays in place, and a start on a stale marker is refused for that time', async () => {
  // Arrange: a killed editor's marker, and a claim that records this machine, this test process, which runs, and its real start, last written two minutes ago.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const heldClaim = join(claimDirectory, 'held-by-a-suspended-window')
  const { machineKey, hostKey, processStart } = await currentStorageOwner()
  assert.ok(processStart, 'the start of this process can be read')
  await mkdir(claimDirectory)
  await writeFile(
    heldClaim,
    JSON.stringify({ pid: process.pid, machineKey, hostKey, processStart }),
  )
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
  await utimes(heldClaim, twoMinutesAgo, twoMinutesAgo)
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert
    assert.equal(start, 'refused with EEXIST')
    assert.deepEqual(await readdir(claimDirectory), [
      'held-by-a-suspended-window',
    ])
    assert.equal(
      JSON.parse(await readFile(wiki.markerPath, 'utf8')).windowId,
      'killed-editor',
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later start on a shared project folder after a window of another computer was killed while it held the claim on the marker; fails_when=a claim of another machine, whose process cannot be probed here, has no age rule, so it stays for good and a stale marker is never removed (decision D8); why_new=Cycle 0046 row 2 (ER-4, ER-13); seam=the claim file's modification time and the clock handed to the claim
test('a claim on the marker that a window of another machine left more than 60 s ago does not keep a stale marker in place', async () => {
  // Arrange: a killed editor's marker, and a claim with the digests of another machine, whose process id a process of this machine happens to have.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const leftClaim = join(claimDirectory, 'left-by-a-window-of-another-machine')
  await mkdir(claimDirectory)
  await writeFile(
    leftClaim,
    JSON.stringify({
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      processStart: 'linux:777',
    }),
  )
  const claimedAt = new Date(1_790_000_000_000)
  await utimes(leftClaim, claimedAt, claimedAt)
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: 1_790_000_000_000,
        },
        { now: () => 1_790_000_060_001 },
      ),
    )

    // Assert
    assert.equal(start, 'holds the claim')
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the update of a window on another computer that took a Wiki over while this window's extension host was suspended at the end of its own run; fails_when=the resumed window removes "its" marker under a claim it no longer holds (the other window cleared it by its age), and what it removes is the other window's fresh marker, so a third window can start beside a running update (decision D9); why_new=Cycle 0046 row 2 (ER-4): a holder checks its claim before every change; seam=the suspended window's read of its own marker under its claim, after which the other window's whole start runs
test('a window that was suspended under its claim at the end of its run, while a window of another machine cleared that claim by its age and started an update, leaves that window’s marker in place', async () => {
  // Arrange: a run that outlasted its bound, whose window is suspended for two minutes right after it read its own marker under its claim.
  const wiki = await createWikiFolder()
  const claimDirectory = `${wiki.markerPath}.takeover`
  const windowOfTheOtherMachine = {
    pid: process.pid,
    windowId: 'window-b',
    host: 'vscode' as const,
    startedAtMs: Date.now(),
  }
  let otherStart: Promise<string> | undefined
  let readsOfItsMarker = 0
  const { claimWikiUpdateMarker: claimAsSuspendedWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readWikiRegularFile': {
      readWikiRegularFile: async (path: string) => {
        readsOfItsMarker += 1
        const isFirstRead = readsOfItsMarker === 1
        const markerFile = await readWikiRegularFile(path)
        if (isFirstRead) {
          // The suspension: the claim is two minutes old when the other machine's window meets it.
          const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
          for (const claimName of await readdir(claimDirectory))
            await utimes(
              join(claimDirectory, claimName),
              twoMinutesAgo,
              twoMinutesAgo,
            )
          otherStart = outcomeOf(
            claimWikiUpdateMarker(
              wiki.outputDirectory,
              windowOfTheOtherMachine,
              AS_WINDOW_OF_ANOTHER_MACHINE,
            ),
          )
          await otherStart
        }
        return markerFile
      },
    },
  })
  try {
    const outlasted = await claimAsSuspendedWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now() - 30 * 60_000,
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in outlasted)

    // Act
    await outlasted.release()
    const otherWindow = await otherStart

    // Assert
    assert.equal(otherWindow, 'holds the claim')
    assert.deepEqual(
      JSON.parse(
        await readFile(wiki.markerPath, 'utf8').catch(() => '"no marker file"'),
      ),
      {
        ...windowOfTheOtherMachine,
        machineKey: '1fb1404a9738d5ed',
        hostKey: '5f0c1a8d2e3b4a69',
        boot: { id: 'boot-of-the-laptop' },
        processStart: 'linux:777',
      },
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the update of a window on another computer that took a stale marker over while this window's extension host was suspended in the middle of its own start; fails_when=the resumed window removes the marker it looked at before the suspension under a claim it no longer holds, and what it removes is the other window's fresh marker, so both update the Wiki (decision D9); why_new=Cycle 0046 row 2 (ER-4): a holder checks its claim before every change; seam=the suspended window's look under its claim, after which the other window's whole start runs
test('a window that was suspended under its claim in the middle of its start, while a window of another machine cleared that claim by its age and started an update, leaves that window’s marker in place and is refused', async () => {
  // Arrange: a killed editor's marker, and a window that is suspended for two minutes right after its look under its claim.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  let looks = 0
  let otherStart: Promise<string> | undefined
  const { claimWikiUpdateMarker: claimAsSuspendedWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readLiveWikiUpdateMarker': {
      readLiveWikiUpdateMarker: async (
        outputDirectory: string,
        ownWindowId: string,
        judgement?: Partial<WikiUpdateMarkerJudgement>,
      ) => {
        const look = await readLiveWikiUpdateMarker(
          outputDirectory,
          ownWindowId,
          judgement,
        )
        looks += 1
        // The second look is the one under the claim.
        if (looks === 2) {
          const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
          for (const claimName of await readdir(claimDirectory))
            await utimes(
              join(claimDirectory, claimName),
              twoMinutesAgo,
              twoMinutesAgo,
            )
          otherStart = outcomeOf(
            claimWikiUpdateMarker(
              wiki.outputDirectory,
              {
                pid: process.pid,
                windowId: 'window-b',
                host: 'vscode',
                startedAtMs: Date.now(),
              },
              AS_WINDOW_OF_ANOTHER_MACHINE,
            ),
          )
          await otherStart
        }
        return look
      },
    },
  })
  try {
    // Act
    const suspendedWindow = await outcomeOf(
      claimAsSuspendedWindow(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: Date.now(),
        },
        AS_THIS_WINDOW,
      ),
    )
    const otherWindow = await otherStart

    // Assert
    assert.deepEqual(
      { suspendedWindow, otherWindow },
      { suspendedWindow: 'held by window-b', otherWindow: 'holds the claim' },
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

/** Places a claim on the marker as another running window of this machine holds it: it records this test process, which runs, with its real start, so no window removes it. Returns the claim file's path. */
async function holdClaimAsAnotherRunningWindow(
  markerPath: string,
): Promise<string> {
  const claimDirectory = `${markerPath}.takeover`
  const heldClaim = join(claimDirectory, 'held-by-another-window')
  const { machineKey, hostKey, processStart } = await currentStorageOwner()
  assert.ok(processStart, 'the start of this process can be read')
  await mkdir(claimDirectory)
  await writeFile(
    heldClaim,
    JSON.stringify({ pid: process.pid, machineKey, hostKey, processStart }),
  )
  return heldClaim
}

// Value: protects=the end of an update at the moment another window holds the claim on the marker (it is looking at the marker for its own start); fails_when=the end asks for the claim once and gives up, so the run's marker stays behind and every window is refused with "Another editor window is updating this Wiki" until it expires (row 35, PL-27); why_new=Cycle 0046 row 35: no test reached the second attempt; seam=the wait between two attempts, which counts and at the third lets the other window release its claim
test('the end of a run waits for another window’s claim on the marker and removes its marker once that claim is released, here after three waits of 25 ms', async () => {
  // Arrange: a window that runs, and another window's claim that is released during the third wait.
  const wiki = await createWikiFolder()
  const waitsMs: number[] = []
  let heldClaim = ''
  const { claimWikiUpdateMarker: claimWithCountedWaits } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:timers/promises': {
      setTimeout: async (waitMs: number) => {
        waitsMs.push(waitMs)
        if (waitsMs.length === 3)
          await rm(`${wiki.markerPath}.takeover`, { recursive: true })
      },
    },
  })
  try {
    const claim = await claimWithCountedWaits(wiki.outputDirectory, {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    })
    assert.ok('release' in claim)
    heldClaim = await holdClaimAsAnotherRunningWindow(wiki.markerPath)

    // Act
    await claim.release()

    // Assert
    assert.equal(heldClaim.endsWith('held-by-another-window'), true)
    assert.deepEqual(waitsMs, [25, 25, 25])
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end of an update while another window holds the claim on the marker for longer than the end waits; fails_when=the end waits without a bound, so the run never ends and the window's Update button stays busy, or it removes the marker without the claim and takes another window's marker with it; why_new=Cycle 0046 row 35: no test reached the last attempt; seam=the wait between two attempts, which counts
test('the end of a run that never gets the claim on the marker gives up after twenty attempts, 25 ms apart, and leaves its marker and the other window’s claim in place', async () => {
  // Arrange: a window that runs, and another running window's claim that stays.
  const wiki = await createWikiFolder()
  const waitsMs: number[] = []
  const { claimWikiUpdateMarker: claimWithCountedWaits } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:timers/promises': {
      setTimeout: async (waitMs: number) => {
        waitsMs.push(waitMs)
      },
    },
  })
  try {
    const claim = await claimWithCountedWaits(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: 1_790_000_000_000,
      },
      { now: () => 1_790_000_000_000 },
    )
    assert.ok('release' in claim)
    await holdClaimAsAnotherRunningWindow(wiki.markerPath)

    // Act
    await claim.release()

    // Assert: nineteen waits lie between twenty attempts.
    assert.deepEqual(
      { waits: waitsMs.length, lengthsOfTheWaitsMs: [...new Set(waitsMs)] },
      { waits: 19, lengthsOfTheWaitsMs: [25] },
    )
    assert.equal(
      JSON.parse(await readFile(wiki.markerPath, 'utf8')).windowId,
      'window-a',
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
      'wiki.update-run.json.takeover',
    ])
    assert.deepEqual(await readdir(`${wiki.markerPath}.takeover`), [
      'held-by-another-window',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner's project folder after a window of 0.2.29.0 (or of another machine) was killed while it prepared its claim on the marker; fails_when=the prepared claim folder, whose owner cannot be judged by a process start, is never removed and stays in `.codebook/` for good (row 35, PL-27: removeExpiredPreparedClaims had no test); why_new=Cycle 0046 row 35; seam=the folder's modification time and the clock handed to the claim
test('a claim folder that a window prepared beside the marker and never put into place is removed by the next start once it is older than 60 s, although a process has its owner’s id', async () => {
  // Arrange: a killed editor's marker, so the start takes the claim, and a prepared claim folder whose owner file records this machine, this test process, which runs, and no process start.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const preparedClaim = `${wiki.markerPath}.takeover-left`
  const { boot } = await currentStorageOwner()
  await mkdir(preparedClaim)
  await writeFile(
    join(preparedClaim, 'left'),
    JSON.stringify({ pid: process.pid, hostname: hostname(), boot }),
  )
  const preparedAt = new Date(1_790_000_000_000)
  await utimes(preparedClaim, preparedAt, preparedAt)
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: 1_790_000_000_000,
        },
        { now: () => 1_790_000_060_001 },
      ),
    )

    // Assert
    assert.equal(start, 'holds the claim')
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end of an update on Windows and macOS, where the start of another process is read by starting PowerShell or ps; fails_when=each of the twenty attempts reads the start of the window that holds the claim anew, so the end of a run starts twenty queries of up to 3 s each (decision D7); why_new=Cycle 0046 rows 2 and 9 (ER-12): one cache for the whole attempt loop; seam=the start reader, which counts and reads the real start of a real process
test('the twenty attempts of a run’s end read the start of the running window that holds the claim once', async (context) => {
  // Arrange: a window that runs, and a claim held by a real running process of this machine, recorded with its real start.
  const wiki = await createWikiFolder()
  context.after(() => rm(wiki.directory, { recursive: true, force: true }))
  const holder = await idleChild(context)
  const holderPid = holder.pid
  assert.ok(holderPid, 'the holder runs')
  const { machineKey, hostKey } = await currentStorageOwner()
  let judgementsOfTheHolder = 0
  let readsOfItsStart = 0
  const readStart: ProcessStartReader = (pid, inputs) => {
    if (pid === holderPid) {
      judgementsOfTheHolder += 1
      // A start the attempts kept for this process id is answered without a read.
      if (!inputs?.cache?.has(pid)) readsOfItsStart += 1
    }
    return readProcessStart(pid, inputs)
  }
  const { claimWikiUpdateMarker: claimWithoutWaits } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:timers/promises': { setTimeout: async () => undefined },
  })
  const claim = await claimWithoutWaits(
    wiki.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    },
    { readStart },
  )
  assert.ok('release' in claim)
  const claimDirectory = `${wiki.markerPath}.takeover`
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'held-by-another-window'),
    JSON.stringify({
      pid: holderPid,
      machineKey,
      hostKey,
      processStart: await readProcessStart(holderPid),
    }),
  )

  // Act
  await claim.release()

  // Assert
  assert.deepEqual(
    { judgementsOfTheHolder, readsOfItsStart },
    { judgementsOfTheHolder: 20, readsOfItsStart: 1 },
  )
  assert.deepEqual(await readdir(claimDirectory), ['held-by-another-window'])
})

// Value: protects=the learner's project folder after an editor was killed between writing its marker beside the marker's path and linking it into place; fails_when=the prepared marker file `<marker>.pending-<id>` is never removed and stays in `.codebook/` for good; why_new=Cycle 0046 row 16 (ER-6, ER-13): the marker is created from a prepared file since this cycle; seam=none
test('the prepared marker file a killed window left beside the marker is removed when the next update ends', async () => {
  // Arrange: a prepared marker of this machine whose process is gone.
  const wiki = await createWikiFolder()
  const { machineKey, hostKey } = await currentStorageOwner()
  await writeFile(
    `${wiki.markerPath}.pending-left-by-a-killed-window`,
    JSON.stringify({
      pid: PID_OF_NO_PROCESS,
      windowId: 'killed-editor',
      host: 'vscode',
      startedAtMs: Date.now(),
      machineKey,
      hostKey,
      processStart: startOfKilledWindow(),
    }),
  )
  try {
    // Act
    const claim = await claimWikiUpdateMarker(wiki.outputDirectory, {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    })
    assert.ok('release' in claim)
    await claim.release()

    // Assert
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner's project folder on a share two computers work on (or a Windows window and a WSL window of one computer), after an editor of the other one was killed between writing its marker beside the marker's path and linking it into place; fails_when=the prepared marker file of an owner that cannot be judged here has no age rule, so no window ever removes it and it stays in `.codebook/` for good; why_new=Cycle 0046 row 16 (ER-6): the marker is created from a prepared file since this cycle, and the storage sweep removes one only with an owner of this machine; seam=the file's modification time and the clock handed to the claim
test('the prepared marker file a killed window of another machine left beside the marker stays for 60 s and is removed when an update ends after that', async () => {
  // Arrange: a prepared marker with the digests of another machine, whose process id a process of this machine happens to have, last written at a fixed time.
  const wiki = await createWikiFolder()
  const preparedMarker = `${wiki.markerPath}.pending-left-by-a-window-of-another-machine`
  await writeFile(
    preparedMarker,
    JSON.stringify({
      pid: process.pid,
      windowId: 'killed-editor',
      host: 'vscode',
      startedAtMs: 1_790_000_000_000,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      processStart: 'linux:777',
    }),
  )
  const preparedAt = new Date(1_790_000_000_000)
  await utimes(preparedMarker, preparedAt, preparedAt)
  /** Runs one update of this window that begins and ends at the given time, and lists what lies beside the Wiki afterwards. */
  const besideTheWikiAfterAnUpdateAt = async (
    nowMs: number,
  ): Promise<string[]> => {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: nowMs,
      },
      { now: () => nowMs },
    )
    assert.ok('release' in claim)
    await claim.release()
    return (await readdir(wiki.directory)).toSorted()
  }
  try {
    // Act
    const after60Seconds = await besideTheWikiAfterAnUpdateAt(1_790_000_060_000)
    const aMillisecondLater =
      await besideTheWikiAfterAnUpdateAt(1_790_000_060_001)

    // Assert
    assert.deepEqual(
      { after60Seconds, aMillisecondLater },
      {
        after60Seconds: [
          'wiki',
          'wiki.update-run.json.pending-left-by-a-window-of-another-machine',
        ],
        aMillisecondLater: ['wiki'],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner's project folder after an editor was killed while its stopped watch replaced its marker by a reservation; fails_when=the reservation written beside the marker has a name no sweep knows (`<marker>.<id>.tmp`), so it stays in `.codebook/` for good; why_new=found in Cycle 0046 while the marker's prepared file got the sweep (package MKR); seam=the killed window's move of the reservation over the marker, after which nothing of that window runs
test('the reservation a window wrote beside the marker and could not move over it before it was killed is removed when the next update ends', async () => {
  // Arrange: a window whose recorded process no longer exists and which is killed between writing its reservation beside the marker and moving it into place.
  const wiki = await createWikiFolder()
  let isKilled = false
  const { claimWikiUpdateMarker: claimAsKilledWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      rename: async () => {
        isKilled = true
        throw new Error('the window was killed')
      },
      rm: async (path: string, options?: { force?: boolean }) => {
        // A killed window cleans nothing up.
        if (!isKilled) await rm(path, options)
      },
    },
  })
  try {
    const killed = await claimAsKilledWindow(wiki.outputDirectory, {
      pid: PID_OF_NO_PROCESS,
      windowId: 'killed-editor',
      host: 'vscode',
      startedAtMs: Date.now(),
    })
    assert.ok('reserve' in killed)
    const reserving = await killed.reserve(Date.now()).then(
      () => 'reserved',
      (error: Error) => error.message,
    )
    const leftBesideTheMarker = (await readdir(wiki.directory)).filter((name) =>
      name.startsWith('wiki.update-run.json.'),
    ).length

    // Act: another window starts on the killed window's marker, runs and ends.
    const next = await claimWikiUpdateMarker(wiki.outputDirectory, {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    })
    assert.ok('release' in next)
    await next.release()

    // Assert
    assert.equal(reserving, 'the window was killed')
    assert.equal(leftBesideTheMarker, 1)
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=two users of one computer who work on one shared project folder; fails_when=the marker is created private to its writer like a storage lock, so the other user's window cannot read whose update runs, takes the file for an entry that is nobody's and removes it, and both update the Wiki; why_new=Cycle 0046 row 16: the marker is created by placeStorageLock, which creates private files unless told otherwise; seam=the process's file mode mask, set for the test
test(
  'a marker and the reservation that replaces it are readable for the other users of the project folder, as the file mode mask allows',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows has no permission bits for a group and for others'
        : false,
  },
  async () => {
    // Arrange: the usual file mode mask, which takes the write permission from group and others.
    const wiki = await createWikiFolder()
    const previousMask = process.umask(0o022)
    try {
      // Act
      const claim = await claimWikiUpdateMarker(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      })
      assert.ok('reserve' in claim)
      const modeOfTheMarker = (await stat(wiki.markerPath)).mode & 0o777
      await claim.reserve(Date.now())
      const modeOfTheReservation = (await stat(wiki.markerPath)).mode & 0o777

      // Assert
      assert.deepEqual(
        { modeOfTheMarker, modeOfTheReservation },
        { modeOfTheMarker: 0o644, modeOfTheReservation: 0o644 },
      )
    } finally {
      process.umask(previousMask)
      await rm(wiki.directory, { recursive: true, force: true })
    }
  },
)

// Value: protects=the Update button in a checkout whose repository holds a link (or another entry that is no marker file) at the marker's path; fails_when=an entry no marker can be read from counts as "no marker", which is never removed, so every start ends with the file error EEXIST until the learner deletes the entry by hand; why_new=Cycle 0046 row 52: since a start removes nothing where it found no marker, an unreadable entry must be told from an empty path; seam=the clock handed to the claim
test('a link at the marker’s path does not refuse every start: once it is older than a write takes it is removed as nobody’s marker, its target stays, and the update runs', async (context) => {
  // Arrange: a link at the marker's path to a file of the project.
  const wiki = await createWikiFolder()
  const target = join(wiki.directory, 'a-file-of-the-project')
  await writeFile(target, 'kept')
  try {
    // The case runs wherever a link can be created, on Windows too; only a user without that right skips it, with the reason.
    if (!(await createLinkIfAllowed(target, wiki.markerPath)))
      return context.skip(LINK_NOT_ALLOWED)
    const linkedAtMs = (await lstat(wiki.markerPath)).mtimeMs

    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: linkedAtMs,
        },
        { now: () => linkedAtMs + 2_000 },
      ),
    )

    // Assert
    assert.equal(start, 'holds the claim')
    assert.equal(await readFile(target, 'utf8'), 'kept')
    assert.equal((await lstat(wiki.markerPath)).isFile(), true)
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})
