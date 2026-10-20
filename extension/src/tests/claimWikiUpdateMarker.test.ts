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
  symlink,
  truncate,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as takeoverModule from '../utils/claimStorageLockTakeover'
import { claimStorageLockTakeover } from '../utils/claimStorageLockTakeover'
import type * as claimModule from '../utils/claimWikiUpdateMarker'
import { claimWikiUpdateMarker } from '../utils/claimWikiUpdateMarker'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import type * as lookModule from '../utils/isFolderOfItsOwn'
import { openWithoutFollowing } from '../utils/openWithoutFollowing'
import type * as placeModule from '../utils/placeStorageLock'
import { placeStorageLock } from '../utils/placeStorageLock'
import type * as markerLookModule from '../utils/readLiveWikiUpdateMarker'
import {
  readLiveWikiUpdateMarker,
  type WikiUpdateMarkerJudgement,
} from '../utils/readLiveWikiUpdateMarker'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import { readRecordedOwner } from '../utils/readRecordedOwner'
import type * as readerModule from '../utils/readWikiRegularFile'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'
import type * as removalModule from '../utils/removeWithoutFollowing'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'
import { requireOwnPidNamespace } from './utils/requireOwnPidNamespace'

/** Answers the start of this test process as the fixed window {@link AS_THIS_WINDOW} records it; the start of any other process cannot be read. */
const readStartOfThisWindow: ProcessStartReader = async (pid) =>
  pid === process.pid ? 'linux@4026531836:16362446' : undefined

/**
 * A window with a fixed identity, for the tests that state a marker or a claim file byte for byte: a Linux process of the host "workstation" (its digest is d195d36bd79da7df) in an editor with the machine id "machine-a" (digest f9c8c7ddcf3d5f56), under the kernel boot "boot-1", in the pid namespace 4026531836, begun at clock tick 16362446.
 * Every window of such a test is this test process, so the start reader answers that start for its process id.
 * Every Linux start of this file names that namespace: a marker or a claim of a project folder whose start names none is not judged by its process id, and the time rules alone would decide it.
 */
const AS_THIS_WINDOW = {
  identity: {
    hostname: 'workstation',
    machineId: 'machine-a',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-1' },
    processStart: 'linux@4026531836:16362446',
  },
  readStart: readStartOfThisWindow,
}

/** How {@link AS_THIS_WINDOW} names its machine and its process in a marker: by digests, boot and process start, never by host name or machine id. */
const OWNER_OF_THIS_WINDOW = {
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  boot: { id: 'boot-1' },
  processStart: 'linux@4026531836:16362446',
}

/** A window on another machine that works on the same project folder (a shared folder): the host "laptop", with digests of its own. Its process has this test process's id in its own space of process ids. */
const AS_WINDOW_OF_ANOTHER_MACHINE = {
  identity: {
    hostname: 'laptop',
    machineKey: '1fb1404a9738d5ed',
    hostKey: '5f0c1a8d2e3b4a69',
    boot: { id: 'boot-of-the-laptop' },
    processStart: 'linux@4026531836:777',
  },
  readStart: readStartOfTheLaptopWindow,
}

/** Answers the start of the window {@link AS_WINDOW_OF_ANOTHER_MACHINE} for this test process's id; the start of any other process cannot be read. */
async function readStartOfTheLaptopWindow(
  pid: number,
): Promise<string | undefined> {
  return pid === process.pid ? 'linux@4026531836:777' : undefined
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
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux@4026531836:16362446"}',
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
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux@4026531836:16362446"}',
    )
    assert.equal(
      await readFile(wiki.markerPath, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux@4026531836:16362446","watchEndedAtMs":1790000060000}',
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
      pid: ID_OF_NO_PROCESS,
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
      if ('isMarkerInChange' in claim.heldBy)
        return 'refused while another window changes the marker'
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
      pid: ID_OF_NO_PROCESS,
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
    './removeWithoutFollowing': {
      removeWithoutFollowing: async (path: string) => {
        // Only the first removal of the marker itself is the moment the other windows arrive at.
        if (path !== wiki.markerPath || secondStart) {
          await removeWithoutFollowing(path)
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
        await removeWithoutFollowing(path)
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

    // Assert: the second window finds the first one removing the marker and is refused as beside a window that changes the marker (the editor says "Another editor window is starting or ending an update of this Wiki. Wait a moment and try again."); the third writes onto the emptied path and is the one that runs.
    assert.deepEqual(
      { firstWindow, secondWindow, thirdWindow },
      {
        firstWindow: 'held by window-c',
        secondWindow: 'refused while another window changes the marker',
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
    './removeWithoutFollowing': {
      removeWithoutFollowing: async (path: string) => {
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
        await removeWithoutFollowing(path)
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

    // Assert: the other window is refused in a sentence of the editor ("Another editor window is starting or ending an update of this Wiki. Wait a moment and try again."), not with the file error of its creation.
    assert.equal(otherWindow, 'refused while another window changes the marker')
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
  // Arrange: a killed editor's marker, and a claim written just now that records this machine, the id of this test process, which runs, and the start of a process that began long ago (clock tick 1; the fixed window's reader answers tick 16362446 for this process).
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'left-by-a-killed-window'),
    JSON.stringify({
      pid: process.pid,
      ...OWNER_OF_THIS_WINDOW,
      processStart: 'linux@4026531836:1',
    }),
  )
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
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
      pid: ID_OF_NO_PROCESS,
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
      processStart: 'linux@4026531836:16362446',
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
        ',"windowId":"window-a","host":"cursor","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux@4026531836:16362446"}',
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
      processStart: 'linux@4026531836:16362446',
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
        ',"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux@4026531836:16362446"}',
    ])
    assert.equal(
      await readFile(wiki.markerPath, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux@4026531836:16362446"}',
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
        startAfter60Seconds: 'refused while another window changes the marker',
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
  // Arrange: a killed editor's marker, and a claim that records this machine, this test process, which runs, and the start the fixed window's reader answers for it, last written two minutes ago.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const heldClaim = join(claimDirectory, 'held-by-a-suspended-window')
  await mkdir(claimDirectory)
  await writeFile(
    heldClaim,
    JSON.stringify({ pid: process.pid, ...OWNER_OF_THIS_WINDOW }),
  )
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
  await utimes(heldClaim, twoMinutesAgo, twoMinutesAgo)
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
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

    // Assert
    assert.equal(start, 'refused while another window changes the marker')
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
      processStart: 'linux@4026531836:777',
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

/**
 * A `node:fs/promises` for a claim beside a file server whose clock runs 2 minutes behind this window's: a file the claim creates beside the marker now (`<marker>.pending-<name>`, as the clock probe is named) is stamped 120 s before this window's present, by whichever look reads its time, a look at its path or the handle that created it.
 * @param markerPath - The marker beside which the claim creates its files.
 * @param options - `isProbeRemovedAtOnce`: whether another window's sweep removes an empty file created there right after its creation, before this window reads its time, whichever call created it.
 * @returns The module to load the claim with ({@link loadModule}).
 * @example
 * await loadModule<typeof claimModule>(path, { 'node:fs/promises': fileSystemOfAFileServerTwoMinutesBehind(wiki.markerPath, { isProbeRemovedAtOnce: true }) })
 */
function fileSystemOfAFileServerTwoMinutesBehind(
  markerPath: string,
  { isProbeRemovedAtOnce }: { isProbeRemovedAtOnce: boolean },
): Record<string, unknown> {
  const isBesideTheMarker = (path: unknown): path is string =>
    typeof path === 'string' && path.startsWith(`${markerPath}.pending-`)
  const stampedTwoMinutesBehind = <Entry extends { mtimeMs: number }>(
    entry: Entry,
  ): Entry => Object.assign(entry, { mtimeMs: entry.mtimeMs - 120_000 })
  return {
    ...fileSystem,
    lstat: async (path: string) => {
      const entry = await fileSystem.lstat(path)
      return isBesideTheMarker(path) ? stampedTwoMinutesBehind(entry) : entry
    },
    writeFile: async (
      ...writeInputs: Parameters<typeof writeFile>
    ): Promise<void> => {
      await writeFile(...writeInputs)
      // Another window's sweep takes an empty file beside the marker at once.
      if (
        isProbeRemovedAtOnce &&
        isBesideTheMarker(writeInputs[0]) &&
        writeInputs[1] === ''
      )
        await unlink(writeInputs[0])
    },
    open: async (...openInputs: Parameters<typeof fileSystem.open>) => {
      const handle = await fileSystem.open(...openInputs)
      if (!isBesideTheMarker(openInputs[0])) return handle
      // Another window's sweep takes the file at once; the handle still names it.
      if (isProbeRemovedAtOnce) await unlink(openInputs[0])
      const statOfTheHandle = handle.stat.bind(handle)
      return Object.assign(handle, {
        stat: async () => stampedTwoMinutesBehind(await statOfTheHandle()),
      })
    },
  }
}

// Value: protects=the claim a window of another machine holds on the marker of a shared project folder whose file server's clock runs behind this window's (or the Windows host's clock under a WSL2 window after a sleep); fails_when=the claim's age is this window's clock minus the time the file system stamped, so a claim placed 30 s ago counts as 2 min 30 s old, is removed while its window changes the marker, and two windows change the marker at once; why_new=Cycle 0047 row 34 (P3RT12); seam=a claim loaded with loadModule whose every look at a file it creates beside the marker, at its path or through the handle that created it, reads that file's stamp 2 minutes behind, as a file server's, and the claim file's modification time; no_claim=a real file server
test('a claim on the marker that a window of another machine placed 30 s ago by a file server’s clock keeps a stale marker in place while that clock runs 2 minutes behind this window’s', async () => {
  // Arrange: a killed editor's marker, and a claim with the digests of another machine that a file server 2 minutes behind stamped 30 s ago by its clock.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const placedClaim = join(
    claimDirectory,
    'placed-by-a-window-of-another-machine',
  )
  await mkdir(claimDirectory)
  await writeFile(
    placedClaim,
    JSON.stringify({
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      processStart: 'linux@4026531836:777',
    }),
  )
  const placedAt = new Date(Date.now() - 150_000)
  await utimes(placedClaim, placedAt, placedAt)
  const { claimWikiUpdateMarker: claimBesideTheFileServer } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': fileSystemOfAFileServerTwoMinutesBehind(
      wiki.markerPath,
      { isProbeRemovedAtOnce: false },
    ),
  })
  try {
    // Act
    const start = await outcomeOf(
      claimBesideTheFileServer(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert
    assert.deepEqual(
      {
        start,
        claimsAfterTheStart: await readdir(claimDirectory).catch(
          () => 'no claim folder',
        ),
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
      },
      {
        start: 'refused while another window changes the marker',
        claimsAfterTheStart: ['placed-by-a-window-of-another-machine'],
        besideTheWiki: [
          'wiki',
          'wiki.update-run.json',
          'wiki.update-run.json.takeover',
        ],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the claim a window of another machine holds on the marker of a shared project folder whose file server's clock runs behind this window's, at the moment another window's sweep takes the empty file this window creates to read that clock; fails_when=the time of that file is read by a look at its path after the other window removed it, so the look answers nothing, the claim placed 30 s ago is judged by this window's clock alone as 2 min 30 s old and removed while its window changes the marker, and two windows change the marker at once; why_new=Cycle 0047 row 193 (S2CXA-C1-1, S2TEST-3, S2SM-U27); seam=a claim loaded with loadModule whose every file created beside the marker is stamped 2 minutes behind, as a file server's, and whose empty file created there is removed right after its creation, as another window's sweep by its own clock removes it, and the claim file's modification time; no_claim=a real file server, a real second window
test('a claim on the marker that a window of another machine placed 30 s ago by a file server’s clock keeps a stale marker in place while that clock runs 2 minutes behind, although another window removes the file that reads that clock right after its creation', async () => {
  // Arrange: a killed editor's marker, and a claim with the digests of another machine that a file server 2 minutes behind stamped 30 s ago by its clock.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const placedClaim = join(
    claimDirectory,
    'placed-by-a-window-of-another-machine',
  )
  await mkdir(claimDirectory)
  await writeFile(
    placedClaim,
    JSON.stringify({
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      processStart: 'linux@4026531836:777',
    }),
  )
  const placedAt = new Date(Date.now() - 150_000)
  await utimes(placedClaim, placedAt, placedAt)
  const { claimWikiUpdateMarker: claimBesideTheFileServer } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': fileSystemOfAFileServerTwoMinutesBehind(
      wiki.markerPath,
      { isProbeRemovedAtOnce: true },
    ),
  })
  try {
    // Act
    const start = await outcomeOf(
      claimBesideTheFileServer(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert
    assert.deepEqual(
      {
        start,
        claimsAfterTheStart: await readdir(claimDirectory).catch(
          () => 'no claim folder',
        ),
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
      },
      {
        start: 'refused while another window changes the marker',
        claimsAfterTheStart: ['placed-by-a-window-of-another-machine'],
        besideTheWiki: [
          'wiki',
          'wiki.update-run.json',
          'wiki.update-run.json.takeover',
        ],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later start on a shared project folder whose file server's clock runs behind this window's, after a window of another machine was killed while it held the claim on the marker; fails_when=the file that reads the file server's clock answers nothing once another window's sweep removed it right after its creation, so a claim that is old by both clocks is kept as one whose age cannot be told, and every start on a stale marker is refused while such sweeps run; why_new=Cycle 0047 row 193 (S2CXA-C1-1): the time of that file is read through the handle that created it; seam=a claim loaded with loadModule whose every file created beside the marker is stamped 2 minutes behind, as a file server's, and whose empty file created there is removed right after its creation, as another window's sweep removes it, and the claim file's modification time; no_claim=a real file server, a real second window
test('a claim on the marker that a window of another machine left 90 s ago by a file server’s clock does not keep a stale marker in place while that clock runs 2 minutes behind, although another window removes the file that reads that clock right after its creation', async () => {
  // Arrange: a killed editor's marker, and a claim with the digests of another machine that a file server 2 minutes behind stamped 90 s ago by its clock, 210 s ago by this window's.
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
      processStart: 'linux@4026531836:777',
    }),
  )
  const leftAt = new Date(Date.now() - 210_000)
  await utimes(leftClaim, leftAt, leftAt)
  const { claimWikiUpdateMarker: claimBesideTheFileServer } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': fileSystemOfAFileServerTwoMinutesBehind(
      wiki.markerPath,
      { isProbeRemovedAtOnce: true },
    ),
  })
  try {
    // Act
    const start = await outcomeOf(
      claimBesideTheFileServer(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert
    assert.deepEqual(
      {
        start,
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
        windowOfTheMarker: JSON.parse(await readFile(wiki.markerPath, 'utf8'))
          .windowId,
      },
      {
        start: 'holds the claim',
        besideTheWiki: ['wiki', 'wiki.update-run.json'],
        windowOfTheMarker: 'window-a',
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the claim a window of another machine holds on the marker of a shared project folder whose clock this window cannot read at that moment; fails_when=a file created beside the marker whose time cannot be read counts as no file system clock at all, so the claim is judged by this window's clock alone, which may run minutes ahead of the clock that stamped it, and a live claim is removed while its window changes the marker; why_new=Cycle 0047 row 193 (S2CXA-C1-1): a probe that was made but answers nothing keeps the claim; seam=a claim loaded with loadModule whose every read of the time of a file it creates beside the marker, at its path or through the handle that created it, fails with EIO, and the claim file's modification time; no_claim=a real failing disk
test('a claim on the marker that a window of another machine placed 150 s ago by this window’s clock keeps a stale marker in place while the time of the file that reads the file system’s clock cannot be read', async () => {
  // Arrange: a killed editor's marker, a claim with the digests of another machine stamped 150 s ago, and a file system that refuses to tell the time of a file created beside the marker.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const placedClaim = join(
    claimDirectory,
    'placed-by-a-window-of-another-machine',
  )
  await mkdir(claimDirectory)
  await writeFile(
    placedClaim,
    JSON.stringify({
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      processStart: 'linux@4026531836:777',
    }),
  )
  const placedAt = new Date(Date.now() - 150_000)
  await utimes(placedClaim, placedAt, placedAt)
  const isBesideTheMarker = (path: unknown): boolean =>
    typeof path === 'string' && path.startsWith(`${wiki.markerPath}.pending-`)
  const refusedTime = (): Error =>
    Object.assign(new Error('EIO: i/o error, stat'), { code: 'EIO' })
  const { claimWikiUpdateMarker: claimBesideTheFailingDisk } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (path: string) => {
        if (isBesideTheMarker(path)) throw refusedTime()
        return fileSystem.lstat(path)
      },
      open: async (...openInputs: Parameters<typeof fileSystem.open>) => {
        const handle = await fileSystem.open(...openInputs)
        if (!isBesideTheMarker(openInputs[0])) return handle
        return Object.assign(handle, {
          stat: async () => {
            throw refusedTime()
          },
        })
      },
    },
  })
  try {
    // Act
    const start = await outcomeOf(
      claimBesideTheFailingDisk(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert: the file made to read the clock is gone again.
    assert.deepEqual(
      {
        start,
        claimsAfterTheStart: await readdir(claimDirectory).catch(
          () => 'no claim folder',
        ),
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
      },
      {
        start: 'refused while another window changes the marker',
        claimsAfterTheStart: ['placed-by-a-window-of-another-machine'],
        besideTheWiki: [
          'wiki',
          'wiki.update-run.json',
          'wiki.update-run.json.takeover',
        ],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later start on a nearly full disk (or a quota, or a read-only folder) after a window of another machine was killed while it held the claim on the marker; fails_when=a claim is kept wherever the file system's clock cannot be read, also where no file can be created beside the marker at all, so the killed window's claim stays for good and every start on a stale marker is refused, or the failed creation leaves a file behind; why_new=Cycle 0047 row 193 (S2TEST-3, S2SM-U27): the fallback by this window's clock had no test; seam=a claim loaded with loadModule whose creation of the file that reads the file system's clock fails with ENOSPC, and the claim file's modification time; no_claim=a real full disk, on which the marker's own creation may fail as well
test('a claim on the marker that a window of another machine left 150 s ago by this window’s clock does not keep a stale marker in place where no file can be created to read the file system’s clock, and no such file is left', async () => {
  // Arrange: a killed editor's marker, a claim with the digests of another machine stamped 150 s ago, and a file system that refuses the empty file created beside the marker to read its clock.
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
      processStart: 'linux@4026531836:777',
    }),
  )
  const leftAt = new Date(Date.now() - 150_000)
  await utimes(leftClaim, leftAt, leftAt)
  const isBesideTheMarker = (path: unknown): boolean =>
    typeof path === 'string' && path.startsWith(`${wiki.markerPath}.pending-`)
  const noSpaceLeft = (): Error =>
    Object.assign(new Error('ENOSPC: no space left on device'), {
      code: 'ENOSPC',
    })
  const { claimWikiUpdateMarker: claimOnAFullDisk } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      writeFile: async (
        ...writeInputs: Parameters<typeof writeFile>
      ): Promise<void> => {
        if (isBesideTheMarker(writeInputs[0]) && writeInputs[1] === '')
          throw noSpaceLeft()
        await writeFile(...writeInputs)
      },
      open: async (...openInputs: Parameters<typeof fileSystem.open>) => {
        if (isBesideTheMarker(openInputs[0])) throw noSpaceLeft()
        return fileSystem.open(...openInputs)
      },
    },
  })
  try {
    // Act
    const start = await outcomeOf(
      claimOnAFullDisk(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert: the run's marker is in place, and neither the claim nor a file beside the marker is left.
    assert.deepEqual(
      {
        start,
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
        windowOfTheMarker: JSON.parse(await readFile(wiki.markerPath, 'utf8'))
          .windowId,
      },
      {
        start: 'holds the claim',
        besideTheWiki: ['wiki', 'wiki.update-run.json'],
        windowOfTheMarker: 'window-a',
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the claim a window of another machine holds on the marker of a shared project folder while this window cannot create the file that reads the file system's clock for a passing reason (too many open files, a busy or failing disk); fails_when=every failure to create that file counts as a folder that takes no new file, so the claim is judged by this window's clock alone, which may run minutes ahead of the clock that stamped it, and a live claim is removed while its window changes the marker; why_new=Cycle 0047 row 255 (P3CLA-10): only ENOSPC had a test; seam=a claim loaded with loadModule whose creation of the file that reads the file system's clock fails with EMFILE, and the claim file's modification time; no_claim=a real process out of file handles
test('a claim on the marker that a window of another machine placed 150 s ago by this window’s clock keeps a stale marker in place while the file that reads the file system’s clock cannot be created for want of a file handle', async () => {
  // Arrange: a killed editor's marker, a claim with the digests of another machine stamped 150 s ago, and a process that has no file handle left for the empty file created beside the marker to read its clock.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const placedClaim = join(
    claimDirectory,
    'placed-by-a-window-of-another-machine',
  )
  await mkdir(claimDirectory)
  await writeFile(
    placedClaim,
    JSON.stringify({
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      processStart: 'linux@4026531836:777',
    }),
  )
  const placedAt = new Date(Date.now() - 150_000)
  await utimes(placedClaim, placedAt, placedAt)
  const isBesideTheMarker = (path: unknown): boolean =>
    typeof path === 'string' && path.startsWith(`${wiki.markerPath}.pending-`)
  const { claimWikiUpdateMarker: claimWithoutAFileHandle } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': {
      ...fileSystem,
      open: async (...openInputs: Parameters<typeof fileSystem.open>) => {
        if (isBesideTheMarker(openInputs[0]))
          throw Object.assign(new Error('EMFILE: too many open files, open'), {
            code: 'EMFILE',
          })
        return fileSystem.open(...openInputs)
      },
    },
  })
  try {
    // Act
    const start = await outcomeOf(
      claimWithoutAFileHandle(wiki.outputDirectory, {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      }),
    )

    // Assert: the claim of the other machine stays, and so does the stale marker it guards.
    assert.deepEqual(
      {
        start,
        claimsAfterTheStart: await readdir(claimDirectory).catch(
          () => 'no claim folder',
        ),
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
        windowOfTheMarker: JSON.parse(await readFile(wiki.markerPath, 'utf8'))
          .windowId,
      },
      {
        start: 'refused while another window changes the marker',
        claimsAfterTheStart: ['placed-by-a-window-of-another-machine'],
        besideTheWiki: [
          'wiki',
          'wiki.update-run.json',
          'wiki.update-run.json.takeover',
        ],
        windowOfTheMarker: 'killed-editor',
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the running update of another computer on a shared project folder (iCloud Documents, NFS, a synced folder) when both computers have one host name, as two Macs with the default "<User>s-MacBook-Pro" do; fails_when=an equal host-name digest makes the other computer's marker this machine's although its machine-id digest and its boot id differ, so its boot id is read as an earlier boot of this machine (or its process id is probed here), its live marker is removed and a second update of the same Wiki starts beside the first; why_new=Cycle 0046 second ship, red team RT1; seam=none; no_claim=two computers with one host name where either side names no boot id (Windows) still look like one machine
test('a marker of another computer with the same host name, another editor machine id and another boot is not removed, and a start beside it is refused', async () => {
  // Arrange: the marker of a running update on another computer also named "workstation": this window's host-name digest, its own machine-id digest and kernel boot id, and a Linux start in the initial pid namespace 4026531836, which every Linux computer has. No process of this machine has its process id.
  const wiki = await createWikiFolder()
  const markerOfTheOtherComputer = {
    pid: ID_OF_NO_PROCESS,
    windowId: 'window-of-the-other-computer',
    host: 'vscode',
    startedAtMs: 1_790_000_000_000,
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-other-computer' },
    processStart: 'linux@4026531836:777',
  }
  await writeFile(wiki.markerPath, JSON.stringify(markerOfTheOtherComputer))
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: 1_790_000_060_000,
        },
        { ...AS_THIS_WINDOW, now: () => 1_790_000_060_000 },
      ),
    )

    // Assert
    assert.equal(start, 'held by window-of-the-other-computer')
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      pid: ID_OF_NO_PROCESS,
      windowId: 'window-of-the-other-computer',
      host: 'vscode',
      startedAtMs: 1_790_000_000_000,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-of-the-other-computer' },
      processStart: 'linux@4026531836:777',
    })
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
        processStart: 'linux@4026531836:777',
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

// Value: protects=the update of a window on another computer that took a Wiki over while this window's extension host was suspended at the end of its own watch; fails_when=the resumed window turns "its" marker into a reservation under a claim it no longer holds (the other window cleared it by its age), and what it replaces is the other window's fresh marker, so a third window is offered Update anyway beside a running update; why_new=Cycle 0047 row 194 (S2SM-U25): the cell of reserve after the claim was lost had no test, only release's twin above; seam=the suspended window's read of its own marker under its claim, after which the other window's whole start runs
test('a window that was suspended under its claim at the end of its watch, while a window of another machine cleared that claim by its age and started an update, writes no reservation over that window’s marker', async () => {
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
    assert.ok('reserve' in outlasted)

    // Act
    const ended = await outlasted.reserve(Date.now())
    const otherWindow = await otherStart

    // Assert: the claim was lost, so the end says that its change was not made.
    assert.deepEqual(
      { ended, otherWindow },
      { ended: false, otherWindow: 'holds the claim' },
    )
    assert.deepEqual(
      JSON.parse(
        await readFile(wiki.markerPath, 'utf8').catch(() => '"no marker file"'),
      ),
      {
        ...windowOfTheOtherMachine,
        machineKey: '1fb1404a9738d5ed',
        hostKey: '5f0c1a8d2e3b4a69',
        boot: { id: 'boot-of-the-laptop' },
        processStart: 'linux@4026531836:777',
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

/** Places a claim on the marker as another running window of this machine holds it: it records this test process, which runs, with the start the reader of {@link AS_THIS_WINDOW} answers for it, so no window with that identity removes it. */
async function holdClaimAsAnotherRunningWindow(
  markerPath: string,
): Promise<void> {
  const claimDirectory = `${markerPath}.takeover`
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'held-by-another-window'),
    JSON.stringify({ pid: process.pid, ...OWNER_OF_THIS_WINDOW }),
  )
}

// Value: protects=the end of an update at the moment another window holds the claim on the marker (it is looking at the marker for its own start); fails_when=the end asks for the claim once and gives up, so the run's marker stays behind and every window is refused with "Another editor window is updating this Wiki" until it expires (row 35, PL-27); why_new=Cycle 0046 row 35: no test reached the second attempt; seam=the wait between two attempts, which counts and at the third lets the other window release its claim
test('the end of a run waits for another window’s claim on the marker and removes its marker once that claim is released, here after three waits of 25 ms', async () => {
  // Arrange: a window that runs, and another window's claim that is released during the third wait.
  const wiki = await createWikiFolder()
  const waitsMs: number[] = []
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
    const claim = await claimWithCountedWaits(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    await holdClaimAsAnotherRunningWindow(wiki.markerPath)

    // Act
    await claim.release()

    // Assert
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
      { ...AS_THIS_WINDOW, now: () => 1_790_000_000_000 },
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

// Value: protects=other editor windows after a run's end could not get the claim on its marker (another window held it longer than the end waits, or the system refused the claim): the window learns that its marker stayed and can ask again; fails_when=the end answers the same for a marker that stayed and one that left, so the window never asks again and every other window is refused as beside a running update until the run's bound has passed (about 16 minutes), or the same end asked a second time no longer removes the marker; why_new=Cycle 0046 second ship, red team RT3; seam=the wait between two attempts, which passes at once
test('the end of a run says that its marker stayed while another window held the claim at every attempt, and the same end asked again once the claim is free removes the marker and says so', async () => {
  // Arrange: a window that runs, and another running window's claim that stays for the twenty attempts of the first end.
  const wiki = await createWikiFolder()
  const { claimWikiUpdateMarker: claimWithoutWaits } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:timers/promises': { setTimeout: async () => undefined },
  })
  try {
    const claim = await claimWithoutWaits(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: 1_790_000_000_000,
      },
      { ...AS_THIS_WINDOW, now: () => 1_790_000_000_000 },
    )
    assert.ok('release' in claim)
    await holdClaimAsAnotherRunningWindow(wiki.markerPath)

    // Act
    const firstEnd = await claim.release()
    const markerAfterTheFirstEnd = JSON.parse(
      await readFile(wiki.markerPath, 'utf8'),
    ).windowId
    await rm(`${wiki.markerPath}.takeover`, { recursive: true })
    const secondEnd = await claim.release()

    // Assert
    assert.deepEqual(
      { firstEnd, markerAfterTheFirstEnd, secondEnd },
      { firstEnd: false, markerAfterTheFirstEnd: 'window-a', secondEnd: true },
    )
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=other editor windows after a stopped watch could not get the claim on its marker: the window learns that the run's marker stayed in place of the reservation and can ask again, so other windows are offered Update anyway instead of a refusal as beside a running update; fails_when=the end of the watch answers the same for a reservation that was written and one that was not, or the same end asked a second time no longer writes it; why_new=Cycle 0046 second ship, red team RT3; seam=the wait between two attempts, which passes at once
test('the end of a stopped watch says that its reservation was not written while another window held the claim at every attempt, and the same end asked again once the claim is free writes it and says so', async () => {
  // Arrange: a window that runs, and another running window's claim that stays for the twenty attempts of the first end.
  const wiki = await createWikiFolder()
  const { claimWikiUpdateMarker: claimWithoutWaits } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:timers/promises': { setTimeout: async () => undefined },
  })
  try {
    const claim = await claimWithoutWaits(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: 1_790_000_000_000,
      },
      { ...AS_THIS_WINDOW, now: () => 1_790_000_000_000 },
    )
    assert.ok('reserve' in claim)
    await holdClaimAsAnotherRunningWindow(wiki.markerPath)

    // Act
    const firstEnd = await claim.reserve(1_790_000_060_000)
    const markerAfterTheFirstEnd = JSON.parse(
      await readFile(wiki.markerPath, 'utf8'),
    ).watchEndedAtMs
    await rm(`${wiki.markerPath}.takeover`, { recursive: true })
    const secondEnd = await claim.reserve(1_790_000_060_000)

    // Assert
    assert.deepEqual(
      { firstEnd, markerAfterTheFirstEnd, secondEnd },
      { firstEnd: false, markerAfterTheFirstEnd: undefined, secondEnd: true },
    )
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: 1_790_000_000_000,
      ...OWNER_OF_THIS_WINDOW,
      watchEndedAtMs: 1_790_000_060_000,
    })
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the window that took over a run's marker, and the end that must stop asking: a marker that is no longer this run's leaves nothing for its end to remove; fails_when=the end answers that its marker stayed although another window's marker is in its place, so the window asks again and again for a change it may never make; why_new=Cycle 0046 second ship, red team RT3; seam=none
test('the end of a run whose outlasted marker another window took over says that nothing of this run is left, and leaves that window’s marker in place', async () => {
  // Arrange: a run that started twenty-three minutes ago, longer than any run's marker counts, and a second window that took its marker over.
  const wiki = await createWikiFolder()
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
    assert.ok('release' in outlasted)
    const takenOver = await outcomeOf(
      claimWikiUpdateMarker(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-b',
          host: 'vscode',
          startedAtMs: Date.now(),
        },
        AS_THIS_WINDOW,
      ),
    )

    // Act
    const ended = await outlasted.release()

    // Assert
    assert.deepEqual(
      {
        takenOver,
        ended,
        markerAfterTheEnd: JSON.parse(await readFile(wiki.markerPath, 'utf8'))
          .windowId,
      },
      {
        takenOver: 'holds the claim',
        ended: true,
        markerAfterTheEnd: 'window-b',
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=other editor windows after a run's end met its marker at a moment the file could not be read (on Windows a scanner or an indexer holds it open: EBUSY or EPERM); fails_when=a failed read of the marker counts as a marker that is no longer this window's, so the end answers that nothing of the run is left, is never asked again, and the marker stays on disk as a running update with no Update anyway until the run's bound has passed; why_new=Cycle 0046 second ship, red team P2RT2 (the RT3 fix took every failed read for another window's marker); seam=the open of the marker file for the end's read, which fails once with EBUSY
test('the end of a run whose marker could not be read at that moment says that its marker stayed, and the same end asked again removes the marker and says so', async () => {
  // Arrange: a window whose next open of the marker file for a read fails once, as for a file another program holds open.
  const wiki = await createWikiFolder()
  let isNextMarkerOpenRefused = false
  const readerWithOneRefusedOpen = await loadModule<typeof readerModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          ...openInputs: Parameters<typeof openWithoutFollowing>
        ) => {
          if (isNextMarkerOpenRefused && openInputs[0] === wiki.markerPath) {
            isNextMarkerOpenRefused = false
            throw Object.assign(
              new Error('EBUSY: resource busy or locked, open'),
              { code: 'EBUSY' },
            )
          }
          return openWithoutFollowing(...openInputs)
        },
      },
    },
  )
  const { claimWikiUpdateMarker: claimInThatWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readWikiRegularFile': readerWithOneRefusedOpen,
  })
  try {
    const claim = await claimInThatWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    isNextMarkerOpenRefused = true

    // Act
    const firstEnd = await claim.release()
    const markerAfterTheFirstEnd = JSON.parse(
      await readFile(wiki.markerPath, 'utf8'),
    ).windowId
    const secondEnd = await claim.release()

    // Assert
    assert.deepEqual(
      { firstEnd, markerAfterTheFirstEnd, secondEnd },
      { firstEnd: false, markerAfterTheFirstEnd: 'window-a', secondEnd: true },
    )
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=other editor windows after a stopped watch met its marker at a moment the file could not be read (on Windows a scanner or an indexer holds it open: EBUSY or EPERM); fails_when=a failed read of the marker counts as a marker that is no longer this window's, so the end of the watch answers that nothing of the run is left, is never asked again, and the run's marker stays on disk as a running update with no Update anyway until the run's bound has passed; why_new=Cycle 0047 row 194 (S2SM-U24): the cell of reserve with the marker unreadable had no test, only release's twin above; seam=the open of the marker file for the end's read, which fails once with EBUSY
test('the end of a stopped watch whose marker could not be read at that moment says that the run’s marker stayed unchanged, and the same end asked again writes the reservation and says so', async () => {
  // Arrange: a window whose next open of the marker file for a read fails once, as for a file another program holds open.
  const wiki = await createWikiFolder()
  let isNextMarkerOpenRefused = false
  const readerWithOneRefusedOpen = await loadModule<typeof readerModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          ...openInputs: Parameters<typeof openWithoutFollowing>
        ) => {
          if (isNextMarkerOpenRefused && openInputs[0] === wiki.markerPath) {
            isNextMarkerOpenRefused = false
            throw Object.assign(
              new Error('EBUSY: resource busy or locked, open'),
              { code: 'EBUSY' },
            )
          }
          return openWithoutFollowing(...openInputs)
        },
      },
    },
  )
  const { claimWikiUpdateMarker: claimInThatWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readWikiRegularFile': readerWithOneRefusedOpen,
  })
  try {
    const claim = await claimInThatWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: 1_790_000_000_000,
      },
      { ...AS_THIS_WINDOW, now: () => 1_790_000_000_000 },
    )
    assert.ok('reserve' in claim)
    isNextMarkerOpenRefused = true

    // Act
    const firstEnd = await claim.reserve(1_790_000_060_000)
    const markerAfterTheFirstEnd = JSON.parse(
      await readFile(wiki.markerPath, 'utf8'),
    )
    const secondEnd = await claim.reserve(1_790_000_060_000)

    // Assert
    assert.deepEqual(
      { firstEnd, markerAfterTheFirstEnd, secondEnd },
      {
        firstEnd: false,
        markerAfterTheFirstEnd: {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: 1_790_000_000_000,
          ...OWNER_OF_THIS_WINDOW,
        },
        secondEnd: true,
      },
    )
    assert.deepEqual(JSON.parse(await readFile(wiki.markerPath, 'utf8')), {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: 1_790_000_000_000,
      ...OWNER_OF_THIS_WINDOW,
      watchEndedAtMs: 1_790_000_060_000,
    })
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end that must stop asking once its marker is gone (removed by hand, or by a window that judged it nobody's); fails_when=a missing marker file is taken for one that could not be read, so the window asks again and again for a change it can never make; why_new=Cycle 0046 second ship, red team P2RT2: since a failed read asks again, a missing file must be told from it; seam=none
test('the end of a run whose marker file is gone says that nothing of this run is left, and leaves no marker', async () => {
  // Arrange: a run whose marker somebody removed while it ran.
  const wiki = await createWikiFolder()
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    await unlink(wiki.markerPath)

    // Act
    const ended = await claim.release()

    // Assert
    assert.equal(ended, true)
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=other editor windows after a stopped watch whose run's marker is gone (removed by hand, or by a window that judged it nobody's); fails_when=a gone marker goes on to the change, so the reservation is written where no marker was and other windows are refused beside a run that ended, or it is taken for one that could not be read, so the window asks again and again; why_new=Cycle 0047 row 194 (S2SM-U22): the cell of reserve with the marker gone had no test, only release's twin above; seam=none
test('the end of a stopped watch whose marker file is gone says that nothing of this run is left, and writes no reservation', async () => {
  // Arrange: a run whose marker somebody removed while it ran.
  const wiki = await createWikiFolder()
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in claim)
    await unlink(wiki.markerPath)

    // Act
    const ended = await claim.reserve(1_790_000_060_000)

    // Assert
    assert.equal(ended, true)
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end of a run whose marker path came to hold a folder (put there by hand, or by a checkout); fails_when=an entry that is no regular file counts as a marker that could not be read at this moment, so the end answers that its marker stayed and the window asks again every 10 seconds for a change it can never make; why_new=Cycle 0047 row 13 (P3CR-2); seam=none; no_claim=a link at the path, which the same look at the entry decides
test('the end of a run whose marker path came to hold a folder says at once that nothing of this run is left, and leaves the folder', async () => {
  // Arrange: a run whose marker was replaced by a folder while it ran.
  const wiki = await createWikiFolder()
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    await unlink(wiki.markerPath)
    await mkdir(wiki.markerPath)

    // Act
    const ended = await claim.release()

    // Assert
    assert.deepEqual(
      {
        ended,
        isFolderAtTheMarkerPath: (await lstat(wiki.markerPath)).isDirectory(),
      },
      { ended: true, isFolderAtTheMarkerPath: true },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end of a run whose marker path came to hold a file larger than any marker (64 MiB and one byte); fails_when=a file over the read's limit counts as a marker that could not be read at this moment, so the end answers that its marker stayed and the window asks again every 10 seconds for a change it can never make; why_new=Cycle 0047 row 13 (P3CR-2); seam=none (a sparse file, so no 64 MiB are written)
test('the end of a run whose marker path came to hold a file larger than any marker says at once that nothing of this run is left, and leaves the file', async () => {
  // Arrange: a run whose marker was replaced by a file of 67_108_865 bytes while it ran.
  const wiki = await createWikiFolder()
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    await unlink(wiki.markerPath)
    await writeFile(wiki.markerPath, '')
    await truncate(wiki.markerPath, 67_108_865)

    // Act
    const ended = await claim.release()

    // Assert
    assert.deepEqual(
      { ended, sizeAtTheMarkerPath: (await lstat(wiki.markerPath)).size },
      { ended: true, sizeAtTheMarkerPath: 67_108_865 },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end of a stopped watch whose marker path came to hold a folder (put there by hand, or by a checkout); fails_when=an entry that cannot be this window's marker goes on to the change, so the move of the reservation over the folder fails and the end of the watch ends with the file system's error, or it counts as a marker that could not be read and the window asks again every 10 seconds; why_new=Cycle 0047 row 194 (S2SM-U23): the cell of reserve with a foreign entry had no test, only release's twins above; seam=none; no_claim=a link at the path, which the same look at the entry decides
test('the end of a stopped watch whose marker path came to hold a folder says at once that nothing of this run is left, writes no reservation, and leaves the folder', async () => {
  // Arrange: a run whose marker was replaced by a folder while it ran.
  const wiki = await createWikiFolder()
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in claim)
    await unlink(wiki.markerPath)
    await mkdir(wiki.markerPath)

    // Act
    const ended = await claim
      .reserve(1_790_000_060_000)
      .catch((error: { code?: string }) => `failed with ${error.code}`)

    // Assert
    assert.deepEqual(
      {
        ended,
        isFolderAtTheMarkerPath: (await lstat(wiki.markerPath)).isDirectory(),
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
      },
      {
        ended: true,
        isFolderAtTheMarkerPath: true,
        besideTheWiki: ['wiki', 'wiki.update-run.json'],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the end of a stopped watch whose marker path came to hold a file larger than any marker (64 MiB and one byte); fails_when=an entry that cannot be this window's marker goes on to the change, so the reservation is moved over that file and replaces it, or it counts as a marker that could not be read and the window asks again every 10 seconds; why_new=Cycle 0047 row 194 (S2SM-U23): the cell of reserve with a foreign entry had no test, only release's twins above; seam=none (a sparse file, so no 64 MiB are written)
test('the end of a stopped watch whose marker path came to hold a file larger than any marker says at once that nothing of this run is left, writes no reservation, and leaves the file', async () => {
  // Arrange: a run whose marker was replaced by a file of 67_108_865 bytes while it ran.
  const wiki = await createWikiFolder()
  try {
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in claim)
    await unlink(wiki.markerPath)
    await writeFile(wiki.markerPath, '')
    await truncate(wiki.markerPath, 67_108_865)

    // Act
    const ended = await claim.reserve(1_790_000_060_000)

    // Assert
    assert.deepEqual(
      {
        ended,
        sizeAtTheMarkerPath: (await lstat(wiki.markerPath)).size,
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
      },
      {
        ended: true,
        sizeAtTheMarkerPath: 67_108_865,
        besideTheWiki: ['wiki', 'wiki.update-run.json'],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the rule that only one window updates a Wiki, when the running window's marker cannot be read at the moment a second window starts (on Windows a scanner or an indexer holds it open: EBUSY, EPERM); fails_when=the second window's start takes a regular marker file it cannot read for nobody's once it is 2 s old, removes it under its claim and starts beside the running update; why_new=Cycle 0047 row 32 (P3RT10); seam=the second window's claim loaded with loadModule, whose every open of the marker file fails with EBUSY, and the clock handed to it; no_claim=Windows' real error codes
test('a start in a second window whose open of the running window’s marker fails leaves that marker in place 3 s after its write and is refused', async () => {
  // Arrange: window A runs; its marker was last written at a fixed time, and window B cannot open the marker file.
  const wiki = await createWikiFolder()
  const refuseMarkerOpen = {
    './openWithoutFollowing': {
      openWithoutFollowing: async (
        ...openInputs: Parameters<typeof openWithoutFollowing>
      ) => {
        if (openInputs[0] === wiki.markerPath)
          throw Object.assign(
            new Error('EBUSY: resource busy or locked, open'),
            { code: 'EBUSY' },
          )
        return openWithoutFollowing(...openInputs)
      },
    },
  }
  const readerOfWindowB = await loadModule<typeof readerModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    refuseMarkerOpen,
  )
  const lookOfWindowB = await loadModule<typeof markerLookModule>(
    resolve(__dirname, '../utils/readLiveWikiUpdateMarker.js'),
    {
      './readWikiRegularFile': readerOfWindowB,
    },
  )
  const { claimWikiUpdateMarker: claimInWindowB } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readWikiRegularFile': readerOfWindowB,
    './readLiveWikiUpdateMarker': lookOfWindowB,
  })
  try {
    const runOfWindowA = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: 1_790_000_000_000,
      },
      { ...AS_THIS_WINDOW, now: () => 1_790_000_000_000 },
    )
    assert.ok('release' in runOfWindowA)
    const writtenAt = new Date(1_790_000_000_000)
    await utimes(wiki.markerPath, writtenAt, writtenAt)

    // Act
    const startOfWindowB = await claimInWindowB(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-b',
        host: 'vscode',
        startedAtMs: 1_790_000_003_000,
      },
      { ...AS_THIS_WINDOW, now: () => 1_790_000_003_000 },
    )

    // Assert: the loaded module answers objects of its own context; a copy makes them comparable here.
    assert.deepEqual(
      {
        startOfWindowB:
          'heldBy' in startOfWindowB
            ? { heldBy: { ...startOfWindowB.heldBy } }
            : 'holds the claim',
        markerAfterTheStart: JSON.parse(await readFile(wiki.markerPath, 'utf8'))
          .windowId,
      },
      {
        // Past the 2 s a write takes, the holder also names the file and the last moment it counts (Cycle 0047 row 85).
        startOfWindowB: {
          heldBy: {
            beingWrittenSinceMs: 1_790_000_000_000,
            unreadableMarkerPath: wiki.markerPath,
            countsUntilMs: 1_790_001_290_000,
          },
        },
        markerAfterTheStart: 'window-a',
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=other editor windows after a run's end met its marker at a moment the system refused both its read and the look at its path (EBUSY); fails_when=a failed look that is no ENOENT counts as a marker that is gone, so the end answers that nothing is left and is never asked again, and the marker stays on disk as a running update; why_new=Cycle 0046 second ship, coverage audit of fixing cycle 2 (Step 7 pass 3, G6): the P2RT2 test's look at the path succeeds; seam=the claim loaded with loadModule, with a reader whose next read of the marker finds nothing and a file system whose next lstat of the marker fails with EBUSY; no_claim=Windows' real error codes
test('the end of a run whose marker could neither be read nor looked at says that its marker stayed, and the same end asked again removes the marker', async () => {
  // Arrange: a window whose next read of the marker file and next look at its path both fail, as for a file another program holds.
  const wiki = await createWikiFolder()
  let isNextMarkerLookRefused = false
  const { claimWikiUpdateMarker: claimInThatWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './readWikiRegularFile': {
      readWikiRegularFile: async (
        ...readInputs: Parameters<typeof readWikiRegularFile>
      ) =>
        isNextMarkerLookRefused && readInputs[0] === wiki.markerPath
          ? undefined
          : readWikiRegularFile(...readInputs),
    },
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (...lookInputs: Parameters<typeof fileSystem.lstat>) => {
        if (isNextMarkerLookRefused && lookInputs[0] === wiki.markerPath) {
          isNextMarkerLookRefused = false
          throw Object.assign(new Error('EBUSY: resource busy or locked'), {
            code: 'EBUSY',
          })
        }
        return fileSystem.lstat(...lookInputs)
      },
    },
  })
  try {
    const claim = await claimInThatWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    isNextMarkerLookRefused = true

    // Act
    const firstEnd = await claim.release()
    const markerAfterTheFirstEnd = JSON.parse(
      await readFile(wiki.markerPath, 'utf8'),
    ).windowId
    const secondEnd = await claim.release()

    // Assert
    assert.deepEqual(
      { firstEnd, markerAfterTheFirstEnd, secondEnd },
      { firstEnd: false, markerAfterTheFirstEnd: 'window-a', secondEnd: true },
    )
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=other editor windows after a run's end met a system that refused the removal of its marker once (on Windows a scanner or an indexer holds it open: EPERM); fails_when=the refused removal is answered as done, so the window is never asked again and its marker stays on disk as a running update until the run's bound has passed, or the claim is kept after the failure, so every later change of the marker waits for it; why_new=Cycle 0047 row 194 (S2SM-U26): the cell of release with a refused removal had no test; seam=the claim loaded with loadModule, whose next removal of the marker's path fails with EPERM; no_claim=Windows' real error codes
test('the end of a run whose marker the system refused to remove once reports the failure and leaves no claim, and the same end asked again removes the marker', async () => {
  // Arrange: a window whose next removal of the marker file fails once, as for a file another program holds open.
  const wiki = await createWikiFolder()
  let isNextMarkerRemovalRefused = false
  const { claimWikiUpdateMarker: claimInThatWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './removeWithoutFollowing': {
      removeWithoutFollowing: async (
        ...removalInputs: Parameters<typeof removeWithoutFollowing>
      ) => {
        if (
          isNextMarkerRemovalRefused &&
          removalInputs[0] === wiki.markerPath
        ) {
          isNextMarkerRemovalRefused = false
          throw Object.assign(
            new Error('EPERM: operation not permitted, unlink'),
            { code: 'EPERM' },
          )
        }
        return removeWithoutFollowing(...removalInputs)
      },
    },
  })
  try {
    const claim = await claimInThatWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    isNextMarkerRemovalRefused = true

    // Act
    const firstEnd = await claim.release().then(
      (answer) => `answered ${answer}`,
      (error: { code?: string }) => `failed with ${error.code}`,
    )
    const markerAfterTheFirstEnd = JSON.parse(
      await readFile(wiki.markerPath, 'utf8'),
    ).windowId
    const besideTheWikiAfterTheFirstEnd = (
      await readdir(wiki.directory)
    ).toSorted()
    const secondEnd = await claim.release()

    // Assert
    assert.deepEqual(
      {
        firstEnd,
        markerAfterTheFirstEnd,
        besideTheWikiAfterTheFirstEnd,
        secondEnd,
      },
      {
        firstEnd: 'failed with EPERM',
        markerAfterTheFirstEnd: 'window-a',
        besideTheWikiAfterTheFirstEnd: ['wiki', 'wiki.update-run.json'],
        secondEnd: true,
      },
    )
    assert.deepEqual(await readdir(wiki.directory), ['wiki'])
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
  // Arrange: a window that runs, and a claim held by a real running process of this machine, recorded with its real start. The window is this test process with its real identity, which judges the holder's claim only where it names its pid namespace (Cycle 0046 row 195).
  requireOwnPidNamespace()
  const wiki = await createWikiFolder()
  context.after(() => rm(wiki.directory, { recursive: true, force: true }))
  const holder = await idleChild(context)
  const holderPid = holder.pid
  assert.ok(holderPid, 'the holder runs')
  const startOfTheHolder = await readProcessStart(holderPid)
  // This is the file's one case with a real process and its real start; every other case names a fixed start.
  if (startOfTheHolder === undefined) {
    context.skip(
      'the start of a running process could not be read on this machine within the bound of the query (on Windows a PowerShell that starts cold)',
    )
    return
  }
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
      processStart: startOfTheHolder,
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
  // Arrange: a prepared marker of this machine, of this boot and of this pid namespace, whose process is gone. The windows are fixed: nothing here needs the identity of this test process.
  const wiki = await createWikiFolder()
  await writeFile(
    `${wiki.markerPath}.pending-left-by-a-killed-window`,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'killed-editor',
      host: 'vscode',
      startedAtMs: Date.now(),
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-1' },
      processStart: 'linux@4026531836:500',
    }),
  )
  try {
    // Act
    const claim = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
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
      processStart: 'linux@4026531836:777',
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
  // Arrange: a window whose recorded process no longer exists and which is killed between writing its reservation beside the marker and moving it into place. Both windows are fixed, of one machine, boot and pid namespace: nothing here needs the identity of this test process or its start.
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
    },
    './removeWithoutFollowing': {
      removeWithoutFollowing: async (path: string) => {
        // A killed window cleans nothing up.
        if (!isKilled) await removeWithoutFollowing(path)
      },
    },
  })
  try {
    const killed = await claimAsKilledWindow(
      wiki.outputDirectory,
      {
        pid: ID_OF_NO_PROCESS,
        windowId: 'killed-editor',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('reserve' in killed)
    const reserving = await killed.reserve(Date.now()).then(
      () => 'reserved',
      (error: Error) => error.message,
    )
    const leftBesideTheMarker = (await readdir(wiki.directory)).filter((name) =>
      name.startsWith('wiki.update-run.json.'),
    ).length

    // Act: another window starts on the killed window's marker, runs and ends.
    const next = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
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

// Value: protects=two users of one computer who work on one shared project folder; fails_when=the marker is created private to its writer like a storage lock, so the other user's window cannot read whose update runs, takes the file for an entry that is nobody's and removes it, and both update the Wiki; or the claim on the marker is private to its creator, so the other user's window can neither judge nor clear the claim a killed window left, and its starts on a stale marker and the ends of its runs fail until the first user starts Codebook again (row 116); why_new=Cycle 0046 row 16: the marker is created by placeStorageLock, which creates private files unless told otherwise, and row 116 for the claim; seam=the process's file mode mask, set for the test, and the read of the marker under the claim, at which the claim's modes are noted
test(
  'a marker, the reservation that replaces it and the claim under which it is replaced are readable for the other users of the project folder, as the file mode mask allows',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows has no permission bits for a group and for others'
        : false,
  },
  async () => {
    // Arrange: the usual file mode mask, which takes the write permission from group and others; the claim's modes are read while the claim is held.
    const wiki = await createWikiFolder()
    const claimFolder = `${wiki.markerPath}.takeover`
    let modesOfTheClaim: { folder: number; file: number } | undefined
    const { claimWikiUpdateMarker: claimAndNoteTheClaimsModes } =
      await loadModule<typeof claimModule>(
        resolve(__dirname, '../utils/claimWikiUpdateMarker.js'),
        {
          './readWikiRegularFile': {
            readWikiRegularFile: async (path: string) => {
              const [claimName] = await readdir(claimFolder)
              assert.ok(claimName, 'the claim is held at this read')
              modesOfTheClaim = {
                folder: (await stat(claimFolder)).mode & 0o777,
                file: (await stat(join(claimFolder, claimName))).mode & 0o777,
              }
              return readWikiRegularFile(path)
            },
          },
        },
      )
    const previousMask = process.umask(0o022)
    try {
      // Act
      const claim = await claimAndNoteTheClaimsModes(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: Date.now(),
        },
        AS_THIS_WINDOW,
      )
      assert.ok('reserve' in claim)
      const modeOfTheMarker = (await stat(wiki.markerPath)).mode & 0o777
      await claim.reserve(Date.now())
      const modeOfTheReservation = (await stat(wiki.markerPath)).mode & 0o777

      // Assert
      assert.deepEqual(
        { modeOfTheMarker, modeOfTheReservation, modesOfTheClaim },
        {
          modeOfTheMarker: 0o644,
          modeOfTheReservation: 0o644,
          modesOfTheClaim: { folder: 0o755, file: 0o644 },
        },
      )
    } finally {
      process.umask(previousMask)
      await rm(wiki.directory, { recursive: true, force: true })
    }
  },
)

// Value: protects=the takeover claim of a storage lock, which lies in the editor's private storage and names the computer by its host name and the editor's machine id; fails_when=the modes a marker's claim gets in a project folder since row 116 become the claim's modes everywhere, so another user of the computer can read the record; why_new=Cycle 0046 row 116: the claim's modes are named by its caller since then; seam=the process's file mode mask, set for the test
test(
  'the takeover claim of a storage lock stays private to its user: its folder and its file give group and others no permission, whatever the file mode mask allows',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows has no permission bits for a group and for others'
        : false,
  },
  async () => {
    // Arrange: a storage directory, and the usual file mode mask, which would leave group and others the read permission.
    const storage = await createWikiFolder()
    const claimFolder = join(storage.directory, 'writer.lock.takeover')
    const previousMask = process.umask(0o022)
    try {
      // Act
      const claim = await claimStorageLockTakeover(
        join(storage.directory, 'writer.lock'),
        AS_THIS_WINDOW.identity,
        readStartOfThisWindow,
      )
      assert.ok(claim)
      const [claimName] = await readdir(claimFolder)
      assert.ok(claimName, 'the claim is held')
      const modesOfTheClaim = {
        folder: (await stat(claimFolder)).mode & 0o777,
        file: (await stat(join(claimFolder, claimName))).mode & 0o777,
      }
      await claim.release()

      // Assert
      assert.deepEqual(modesOfTheClaim, { folder: 0o700, file: 0o600 })
    } finally {
      process.umask(previousMask)
      await rm(storage.directory, { recursive: true, force: true })
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

/**
 * Makes a project as a cloned repository holds it, with an empty Wiki output folder in `.codebook`, and a folder beside the project. Every file and folder of both was last changed two minutes ago, longer than a claim on the marker may stay without an owner.
 * All of it lies in one temporary folder of the test, which is removed with the test; a link of a test leads only to one of these two folders.
 * @example const cloned = await createClonedProject(context)
 */
async function createClonedProject(context: TestContext): Promise<{
  project: string
  besideTheProject: string
  outputDirectory: string
  markerPath: string
}> {
  const temporaryFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-claim-link-')),
  )
  context.after(() => rm(temporaryFolder, { recursive: true, force: true }))
  const project = join(temporaryFolder, 'project')
  const besideTheProject = join(temporaryFolder, 'beside-the-project')
  const outputDirectory = join(project, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await mkdir(join(project, 'src', 'utils'), { recursive: true })
  await mkdir(join(project, 'docs'))
  await mkdir(join(besideTheProject, 'photos'), { recursive: true })
  const files = [
    join(project, 'package.json'),
    join(project, 'src', 'main.ts'),
    join(project, 'src', 'utils', 'helper.ts'),
    join(project, 'docs', 'guide.md'),
    join(besideTheProject, 'notes.txt'),
    join(besideTheProject, 'photos', 'holiday.txt'),
  ]
  for (const file of files) await writeFile(file, 'kept')
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
  const folders = [
    join(project, 'src', 'utils'),
    join(project, 'src'),
    join(project, 'docs'),
    join(besideTheProject, 'photos'),
    besideTheProject,
  ]
  for (const path of [...files, ...folders])
    await utimes(path, twoMinutesAgo, twoMinutesAgo)
  return {
    project,
    besideTheProject,
    outputDirectory,
    markerPath: `${outputDirectory}.update-run.json`,
  }
}

/** Lists every file, folder and link below a folder as `/`-separated paths, sorted; a link is named and not followed. @example await entriesBelow('/tmp/project') // => ['docs', 'docs/guide.md', 'package.json'] */
async function entriesBelow(folder: string): Promise<string[]> {
  // With entry types the listing names a link and does not go into it.
  return (await readdir(folder, { recursive: true, withFileTypes: true }))
    .map((entry) =>
      relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'),
    )
    .toSorted()
}

// Value: protects=the learner's own files in a project whose repository carries a link at `.codebook/wiki.update-run.json.takeover` (row 109, critical: one Update press deleted `src/`, `docs/` and `package.json`); fails_when=the claim's age sweep lists the claim folder's path through the link and removes every entry of the link's target that is older than 60 s as a claim nobody owns; why_new=Cycle 0046 row 109: no test put a link at the claim folder's path; seam=none (a junction on Windows, which needs no right)
test('a link at the claim folder’s path that leads to the project folder is removed as a link when an update starts on a killed editor’s marker: every file and folder of the project stays, although each is older than a claim may be', async (context) => {
  // Arrange: a killed editor's marker, so the start asks for the claim, and the link a repository carries.
  const cloned = await createClonedProject(context)
  await leaveKilledEditorsMarker(cloned.markerPath)
  await symlink(cloned.project, `${cloned.markerPath}.takeover`, 'junction')

  // Act
  const start = await outcomeOf(
    claimWikiUpdateMarker(
      cloned.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    ),
  )

  // Assert
  assert.deepEqual(
    { start, project: await entriesBelow(cloned.project) },
    {
      start: 'holds the claim',
      project: [
        '.codebook',
        '.codebook/wiki',
        '.codebook/wiki.update-run.json',
        'docs',
        'docs/guide.md',
        'package.json',
        'src',
        'src/main.ts',
        'src/utils',
        'src/utils/helper.ts',
      ],
    },
  )
  assert.equal(
    JSON.parse(await readFile(cloned.markerPath, 'utf8')).windowId,
    'window-a',
  )
})

// Value: protects=the learner's own files in a project whose repository carries a link at `.codebook/wiki.update-run.json.takeover`, at the end of an update that started without a marker in the way (row 109); fails_when=the end of the run asks for the claim, and the claim's age sweep lists the link's target and removes what is older than 60 s; why_new=Cycle 0046 row 109; seam=none
test('a link at the claim folder’s path that leads to the project folder is removed as a link when a run ends: every file and folder of the project stays and the run’s marker is removed', async (context) => {
  // Arrange: a run that began with no marker in the way, so nothing looked at the claim folder yet.
  const cloned = await createClonedProject(context)
  await symlink(cloned.project, `${cloned.markerPath}.takeover`, 'junction')
  const claim = await claimWikiUpdateMarker(
    cloned.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    },
    AS_THIS_WINDOW,
  )
  assert.ok('release' in claim)

  // Act
  await claim.release()

  // Assert
  assert.deepEqual(await entriesBelow(cloned.project), [
    '.codebook',
    '.codebook/wiki',
    'docs',
    'docs/guide.md',
    'package.json',
    'src',
    'src/main.ts',
    'src/utils',
    'src/utils/helper.ts',
  ])
})

// Value: protects=a folder outside the project (the learner's home, another checkout) when a repository carries a link to it at `.codebook/wiki.update-run.json.takeover` (row 109: the folder was emptied); fails_when=the claim's age sweep lists the claim folder's path through the link; why_new=Cycle 0046 row 109; seam=none
test('a link at the claim folder’s path that leads out of the project is removed as a link when an update starts on a killed editor’s marker: the folder it leads to keeps every file', async (context) => {
  // Arrange
  const cloned = await createClonedProject(context)
  await leaveKilledEditorsMarker(cloned.markerPath)
  await symlink(
    cloned.besideTheProject,
    `${cloned.markerPath}.takeover`,
    'junction',
  )

  // Act
  const start = await outcomeOf(
    claimWikiUpdateMarker(
      cloned.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      start,
      besideTheProject: await entriesBelow(cloned.besideTheProject),
      besideTheWiki: await entriesBelow(join(cloned.project, '.codebook')),
    },
    {
      start: 'holds the claim',
      besideTheProject: ['notes.txt', 'photos', 'photos/holiday.txt'],
      besideTheWiki: ['wiki', 'wiki.update-run.json'],
    },
  )
})

// Value: protects=a folder outside the project when a repository carries a link to it at `.codebook/wiki.update-run.json.takeover`, at the end of an update (row 109); fails_when=the end of the run asks for the claim, and the claim's age sweep lists the link's target; why_new=Cycle 0046 row 109; seam=none
test('a link at the claim folder’s path that leads out of the project is removed as a link when a run ends: the folder it leads to keeps every file and the run’s marker is removed', async (context) => {
  // Arrange
  const cloned = await createClonedProject(context)
  await symlink(
    cloned.besideTheProject,
    `${cloned.markerPath}.takeover`,
    'junction',
  )
  const claim = await claimWikiUpdateMarker(
    cloned.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now(),
    },
    AS_THIS_WINDOW,
  )
  assert.ok('release' in claim)

  // Act
  await claim.release()

  // Assert
  assert.deepEqual(
    {
      besideTheProject: await entriesBelow(cloned.besideTheProject),
      besideTheWiki: await entriesBelow(join(cloned.project, '.codebook')),
    },
    {
      besideTheProject: ['notes.txt', 'photos', 'photos/holiday.txt'],
      besideTheWiki: ['wiki'],
    },
  )
})

// Value: protects=the folders that links lead to which a repository carries where a killed window's claim, prepared claim folder or prepared marker would lie; fails_when=an entry that is nobody's by its age is removed through the link (its target is emptied) instead of by its own name; why_new=Cycle 0046 row 109, the audit of every removal beside the marker: these three removals take a link as a link, and nothing stated it; seam=the clock handed to the claim
test('links where a killed window’s claim, its prepared claim folder and its prepared marker would lie are removed as links once they are older than 60 s, and the folders they lead to keep every file', async (context) => {
  // Arrange: a real claim folder that holds a link, and two links beside the marker with the names of prepared entries.
  const cloned = await createClonedProject(context)
  await mkdir(`${cloned.markerPath}.takeover`)
  await symlink(
    cloned.besideTheProject,
    join(`${cloned.markerPath}.takeover`, 'left-by-a-killed-window'),
    'junction',
  )
  await symlink(
    join(cloned.project, 'src'),
    `${cloned.markerPath}.takeover-left-by-a-killed-window`,
    'junction',
  )
  await symlink(
    join(cloned.project, 'docs'),
    `${cloned.markerPath}.pending-left-by-a-killed-window`,
    'junction',
  )
  const aMinuteAndASecondLater = Date.now() + 61_000
  const claim = await claimWikiUpdateMarker(
    cloned.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: aMinuteAndASecondLater,
    },
    { ...AS_THIS_WINDOW, now: () => aMinuteAndASecondLater },
  )
  assert.ok('release' in claim)

  // Act
  await claim.release()

  // Assert
  assert.deepEqual(
    {
      project: await entriesBelow(cloned.project),
      besideTheProject: await entriesBelow(cloned.besideTheProject),
    },
    {
      project: [
        '.codebook',
        '.codebook/wiki',
        'docs',
        'docs/guide.md',
        'package.json',
        'src',
        'src/main.ts',
        'src/utils',
        'src/utils/helper.ts',
      ],
      besideTheProject: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})

// Value: protects=the time and the memory of an Update press in a project whose repository carries links to an endless device where a claim, a prepared claim's record and a prepared marker would lie (row 110: one start and its end took 1.8 s and 700 MiB for a single link); fails_when=the owner record of each entry is read with an unbounded read that follows the link, before the entry's age is looked at; why_new=Cycle 0046 row 110; seam=the clock handed to the claim (the test's time bound is the observation: every read of the device takes about a second)
test(
  'links to an endless device where a claim, the record of a prepared claim and a prepared marker would lie are never read: a start returns at once while they are young, and 61 s later they are removed by their age',
  {
    timeout: 2_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no endless device at a path of the file system'
        : false,
  },
  async () => {
    // Arrange: a killed editor's marker, so each start asks for the claim, and a link to /dev/zero at each of the three names.
    const wiki = await createWikiFolder()
    await leaveKilledEditorsMarker(wiki.markerPath)
    await mkdir(`${wiki.markerPath}.takeover`)
    await symlink('/dev/zero', join(`${wiki.markerPath}.takeover`, 'left'))
    await mkdir(`${wiki.markerPath}.takeover-left`)
    await symlink('/dev/zero', join(`${wiki.markerPath}.takeover-left`, 'left'))
    await symlink('/dev/zero', `${wiki.markerPath}.pending-left`)
    const linkedAtMs = Date.now()
    const startingWindow = {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode' as const,
      startedAtMs: linkedAtMs,
    }
    try {
      // Act: a link among the claims counts as a claim nobody can judge for 60 s, so the first start is refused.
      const startWhileTheLinksAreYoung = await outcomeOf(
        claimWikiUpdateMarker(wiki.outputDirectory, startingWindow, {
          ...AS_THIS_WINDOW,
          now: () => linkedAtMs,
        }),
      )
      const later = await claimWikiUpdateMarker(
        wiki.outputDirectory,
        startingWindow,
        { ...AS_THIS_WINDOW, now: () => linkedAtMs + 61_000 },
      )
      assert.ok('release' in later)
      await later.release()

      // Assert
      assert.deepEqual(
        {
          startWhileTheLinksAreYoung,
          besideTheWikiAfterTheLaterRun: await readdir(wiki.directory),
        },
        {
          startWhileTheLinksAreYoung:
            'refused while another window changes the marker',
          besideTheWikiAfterTheLaterRun: ['wiki'],
        },
      )
    } finally {
      await rm(wiki.directory, { recursive: true, force: true })
    }
  },
)

// Value: protects=the rule that what a repository puts beside the marker is judged by itself and never by what it leads to; fails_when=the owner record is read through a link (a link to a file at a claim's or a prepared marker's name, a link to a folder at a prepared claim's name), so a record elsewhere that names a running window keeps the link in place for good and with it the claim on the marker; why_new=Cycle 0046 row 110: "a link is removed by its age without being read"; seam=the clock handed to the claim
test('links that lead to the record of a running window, where a claim, a prepared claim folder and a prepared marker would lie, are judged by their age alone and removed 61 s later', async (context) => {
  // Arrange: a record that names this window, which runs, in a folder of the project; and a link to it, or to its folder, at each of the three names.
  const cloned = await createClonedProject(context)
  const recordOfARunningWindow = join(cloned.project, 'docs', 'left')
  await writeFile(
    recordOfARunningWindow,
    JSON.stringify({ pid: process.pid, ...OWNER_OF_THIS_WINDOW }),
  )
  await mkdir(`${cloned.markerPath}.takeover`)
  // The links to a file are tried on every system; only a user whom the system refuses their creation skips.
  const mayCreateLinks =
    (await createLinkIfAllowed(
      recordOfARunningWindow,
      join(`${cloned.markerPath}.takeover`, 'left'),
    )) &&
    (await createLinkIfAllowed(
      recordOfARunningWindow,
      `${cloned.markerPath}.pending-left`,
    ))
  if (!mayCreateLinks) return context.skip(LINK_NOT_ALLOWED)
  await symlink(
    join(cloned.project, 'docs'),
    `${cloned.markerPath}.takeover-left`,
    'junction',
  )
  const aMinuteAndASecondLater = Date.now() + 61_000
  const claim = await claimWikiUpdateMarker(
    cloned.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: aMinuteAndASecondLater,
    },
    { ...AS_THIS_WINDOW, now: () => aMinuteAndASecondLater },
  )
  assert.ok('release' in claim)

  // Act
  await claim.release()

  // Assert
  assert.deepEqual(
    {
      besideTheWiki: await readdir(join(cloned.project, '.codebook')),
      docs: (await readdir(join(cloned.project, 'docs'))).toSorted(),
    },
    { besideTheWiki: ['wiki'], docs: ['guide.md', 'left'] },
  )
})

// Value: protects=the Update button in a checkout whose repository holds a folder at the marker's path (row 111: every start ended with the file error EISDIR, although the look calls such an entry nobody's); fails_when=the marker in the way is removed as a file only, which fails for a folder; why_new=Cycle 0046 row 111: the existing test of a folder asserts only the look's kind; seam=the clock handed to the claim
test('a folder with content at the marker’s path does not refuse every start: once it is older than a write takes it is removed with its content as nobody’s marker, and the update runs', async () => {
  // Arrange: a folder that holds a file, where the marker file would lie.
  const wiki = await createWikiFolder()
  await mkdir(wiki.markerPath)
  await writeFile(join(wiki.markerPath, 'supplied-by-a-repository'), 'x')
  const createdAtMs = (await lstat(wiki.markerPath)).mtimeMs
  try {
    // Act
    const start = await outcomeOf(
      claimWikiUpdateMarker(
        wiki.outputDirectory,
        {
          pid: process.pid,
          windowId: 'window-a',
          host: 'vscode',
          startedAtMs: createdAtMs,
        },
        { ...AS_THIS_WINDOW, now: () => createdAtMs + 2_000 },
      ),
    )

    // Assert
    assert.deepEqual(
      {
        start,
        isTheMarkerAFile: (await lstat(wiki.markerPath)).isFile(),
        besideTheWiki: (await readdir(wiki.directory)).toSorted(),
      },
      {
        start: 'holds the claim',
        isTheMarkerAFile: true,
        besideTheWiki: ['wiki', 'wiki.update-run.json'],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder that a link at the marker's path leads to; fails_when=the removal of an entry that is nobody's marker, which also removes a folder with its content since row 111, goes into a link's target instead of removing the link; why_new=Cycle 0046 rows 109 and 111: the existing test has a link to a file; seam=the clock handed to the claim
test('a link to a folder at the marker’s path is removed as a link once it is older than a write takes: the folder keeps every file, and the update runs', async (context) => {
  // Arrange
  const cloned = await createClonedProject(context)
  await symlink(cloned.besideTheProject, cloned.markerPath, 'junction')
  const linkedAtMs = (await lstat(cloned.markerPath)).mtimeMs

  // Act
  const start = await outcomeOf(
    claimWikiUpdateMarker(
      cloned.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: linkedAtMs,
      },
      { ...AS_THIS_WINDOW, now: () => linkedAtMs + 2_000 },
    ),
  )

  // Assert
  assert.deepEqual(
    {
      start,
      isTheMarkerAFile: (await lstat(cloned.markerPath)).isFile(),
      besideTheProject: await entriesBelow(cloned.besideTheProject),
    },
    {
      start: 'holds the claim',
      isTheMarkerAFile: true,
      besideTheProject: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})

// Value: protects=every Wiki update in a checkout whose repository holds a file at `.codebook/wiki.update-run.json.takeover` (row 112: the first update's end left its marker, and every later start failed with a raw EEXIST for good); fails_when=a file at the claim folder's path is neither a folder to list nor removed, so no claim can ever be placed there; why_new=Cycle 0046 row 112; seam=none
test('a file at the claim folder’s path does not keep the claim from being taken: the end of a run removes its marker, and the next start on a killed editor’s marker runs', async () => {
  // Arrange: a file where the claim folder would lie, and a run that began with no marker in the way.
  const wiki = await createWikiFolder()
  await writeFile(`${wiki.markerPath}.takeover`, 'supplied by a repository')
  const windowA = {
    pid: process.pid,
    windowId: 'window-a',
    host: 'vscode' as const,
    startedAtMs: Date.now(),
  }
  try {
    const firstRun = await claimWikiUpdateMarker(
      wiki.outputDirectory,
      windowA,
      AS_THIS_WINDOW,
    )
    assert.ok('release' in firstRun)

    // Act
    await firstRun.release()
    const besideTheWikiAfterTheFirstRun = await readdir(wiki.directory)
    await leaveKilledEditorsMarker(wiki.markerPath)
    const nextStart = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, windowA, AS_THIS_WINDOW),
    )

    // Assert
    assert.deepEqual(
      { besideTheWikiAfterTheFirstRun, nextStart },
      { besideTheWikiAfterTheFirstRun: ['wiki'], nextStart: 'holds the claim' },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later update of a window whose claim file on the marker could not be removed once (on Windows a file another program holds open, a scanner or an indexer); fails_when=the release swallows the failed removal, and the claim, which names a running process of this machine, has no age rule and an owner that is never gone, so the window's later runs leave their markers and every start on a marker in the way fails (row 113); why_new=Cycle 0046 row 113: the trigger cannot be produced on Linux; seam=the file system's removal of the claim file, which fails once, and the answers of the claim's releases
test('a window whose claim on the marker could not be removed at the end of one run says so, and its next run removes that claim first and ends without leaving its marker', async () => {
  // Arrange: a window whose first removal of a claim file fails, as for a file another program holds open.
  const wiki = await createWikiFolder()
  const claimFolder = `${wiki.markerPath}.takeover${sep}`
  let failedRemovals = 0
  const takeoverWithOneFailedRemoval = await loadModule<typeof takeoverModule>(
    resolve(__dirname, '../utils/claimStorageLockTakeover.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        unlink: async (path: string) => {
          if (path.startsWith(claimFolder) && failedRemovals === 0) {
            failedRemovals += 1
            throw Object.assign(
              new Error('EPERM: operation not permitted, unlink'),
              { code: 'EPERM' },
            )
          }
          await unlink(path)
        },
      },
    },
  )
  const answersOfTheReleases: boolean[] = []
  const { claimWikiUpdateMarker: claimInThatWindow } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    './claimStorageLockTakeover': {
      claimStorageLockTakeover: async (
        ...claimInputs: Parameters<
          typeof takeoverModule.claimStorageLockTakeover
        >
      ) => {
        const claim =
          await takeoverWithOneFailedRemoval.claimStorageLockTakeover(
            ...claimInputs,
          )
        // The claim as it is, with the answer of its release noted.
        return (
          claim && {
            ...claim,
            release: async () => {
              const isReleased = await claim.release()
              answersOfTheReleases.push(isReleased)
              return isReleased
            },
          }
        )
      },
    },
    'node:timers/promises': { setTimeout: async () => undefined },
  })
  /** One update of the window from its start to its end; answers what lies beside the Wiki afterwards. */
  const besideTheWikiAfterARun = async (): Promise<string[]> => {
    const claim = await claimInThatWindow(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: Date.now(),
      },
      AS_THIS_WINDOW,
    )
    assert.ok('release' in claim)
    await claim.release()
    return (await readdir(wiki.directory)).toSorted()
  }
  try {
    // Act
    const afterTheFirstRun = await besideTheWikiAfterARun()
    const afterTheSecondRun = await besideTheWikiAfterARun()

    // Assert: the first run removed its marker under the claim it could not remove afterwards; the second run removed that claim and its own.
    assert.deepEqual(
      { afterTheFirstRun, afterTheSecondRun, answersOfTheReleases },
      {
        afterTheFirstRun: ['wiki', 'wiki.update-run.json.takeover'],
        afterTheSecondRun: ['wiki'],
        answersOfTheReleases: [false, true],
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

/**
 * Loads the marker's claim on a file system on which a link cannot be removed as a file ({@link fileSystemWhoseLinksResistRemoval}): the claim and its removal walk both see that file system, and a removal through the recursive `rm` there goes on as the removal of Node.js does on Windows after `EPERM`.
 * @returns The claim to call, and the paths of every listing the claim and its walk made.
 * @example
 * const { claimWhereLinksResist, listed } = await loadClaimWhereLinksResistRemoval()
 */
async function loadClaimWhereLinksResistRemoval(): Promise<{
  claimWhereLinksResist: typeof claimWikiUpdateMarker
  listed: string[]
}> {
  const resisting = fileSystemWhoseLinksResistRemoval()
  const walkWhereLinksResist = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    { 'node:fs/promises': resisting.fileSystem },
  )
  const { claimWikiUpdateMarker: claimWhereLinksResist } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': resisting.fileSystem,
    './removeWithoutFollowing': walkWhereLinksResist,
  })
  return { claimWhereLinksResist, listed: resisting.listed }
}

// Value: protects=the learner's folders behind links that a repository puts where a prepared claim folder and a prepared marker would lie, on a system that refuses to unlink them (on Windows `EPERM`); fails_when=the sweep removes such an entry with the recursive removal of Node.js, which after the refused unlink looks again with `stat`, follows the link and empties the folder behind it (row 187); why_new=Cycle 0046 row 187: the removal at the marker's paths is a walk of Codebook's own; seam=a file system whose unlink of a link answers EPERM, with the removal of Node.js as it runs on Windows for a caller that still uses it
test('links beside the marker that the system refuses to unlink are left in place when they are older than 60 s: the folders they lead to are not listed and keep every file, and the run still ends', async (context) => {
  // Arrange: a link to the project's sources where a prepared claim folder would lie, and one to its documents where a prepared marker would lie.
  const cloned = await createClonedProject(context)
  const sources = join(cloned.project, 'src')
  const documents = join(cloned.project, 'docs')
  await symlink(sources, `${cloned.markerPath}.takeover-left`, 'junction')
  await symlink(documents, `${cloned.markerPath}.pending-left`, 'junction')
  const { claimWhereLinksResist, listed } =
    await loadClaimWhereLinksResistRemoval()
  const aMinuteAndASecondLater = Date.now() + 61_000
  const claim = await claimWhereLinksResist(
    cloned.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: aMinuteAndASecondLater,
    },
    { ...AS_THIS_WINDOW, now: () => aMinuteAndASecondLater },
  )
  assert.ok('release' in claim)

  // Act
  await claim.release()

  // Assert: the run's marker is gone, both links stay, and no listing went below a link.
  assert.deepEqual(
    {
      project: await entriesBelow(cloned.project),
      listedBelowALink: listed.filter(
        (path) => path === sources || path === documents,
      ),
    },
    {
      project: [
        '.codebook',
        '.codebook/wiki',
        '.codebook/wiki.update-run.json.pending-left',
        '.codebook/wiki.update-run.json.takeover-left',
        'docs',
        'docs/guide.md',
        'package.json',
        'src',
        'src/main.ts',
        'src/utils',
        'src/utils/helper.ts',
      ],
      listedBelowALink: [],
    },
  )
})

// Value: protects=the folder behind a link at the marker's own path on a system that refuses to unlink the link; fails_when=the marker in the way is removed with the recursive removal of Node.js, which follows the link after the refused unlink and empties the folder (row 187), or the start goes on as if the entry were gone; why_new=Cycle 0046 row 187; seam=a file system whose unlink of a link answers EPERM
test('a link to a folder at the marker’s path that the system refuses to unlink ends the start with the file system’s error: the link stays, and the folder it leads to keeps every file', async (context) => {
  // Arrange
  const cloned = await createClonedProject(context)
  await symlink(cloned.besideTheProject, cloned.markerPath, 'junction')
  const linkedAtMs = (await lstat(cloned.markerPath)).mtimeMs
  const { claimWhereLinksResist } = await loadClaimWhereLinksResistRemoval()

  // Act
  const start = await outcomeOf(
    claimWhereLinksResist(
      cloned.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: linkedAtMs,
      },
      { ...AS_THIS_WINDOW, now: () => linkedAtMs + 2_000 },
    ),
  )

  // Assert
  assert.deepEqual(
    {
      start,
      isTheLinkStillThere: (await lstat(cloned.markerPath)).isSymbolicLink(),
      besideTheProject: await entriesBelow(cloned.besideTheProject),
    },
    {
      start: 'refused with EPERM',
      isTheLinkStillThere: true,
      besideTheProject: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})

// Value: protects=a file behind an entry at a prepared claim's name that the look without following calls a directory although it leads elsewhere (on Windows a junction whose target is a volume); fails_when=the claim's age sweep reads the owner file below every entry that look calls a directory, so the file behind the entry is opened and the entry is judged by it: a record that names a running window keeps it in place for good (rows 227 and 228); why_new=Cycle 0046 row 228: the other places that join a name onto a path a repository can supply and then open it; seam=a file system whose lstat calls a link a directory and whose rmdir removes it as a name, and the reader of owner records, which notes every file it is asked to open
test('an entry where a prepared claim folder would lie that the look calls a directory although it leads elsewhere is judged by its age alone: the record of a running window behind it is never opened, and 61 s later the entry is removed as a name', async (context) => {
  // Arrange: a record that names this window, which runs, in a folder of the project, and a link to that folder at a prepared claim's name, on a file system whose look is wrong about the link.
  const cloned = await createClonedProject(context)
  await writeFile(
    join(cloned.project, 'docs', 'left'),
    JSON.stringify({ pid: process.pid, ...OWNER_OF_THIS_WINDOW }),
  )
  await symlink(
    join(cloned.project, 'docs'),
    `${cloned.markerPath}.takeover-left`,
    'junction',
  )
  const wrongLook = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
    rmdirOfALink: 'removes it',
  })
  const look = await loadModule<typeof lookModule>(
    resolve(__dirname, '../utils/isFolderOfItsOwn.js'),
    { 'node:fs/promises': wrongLook.fileSystem },
  )
  const walk = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    { 'node:fs/promises': wrongLook.fileSystem, './isFolderOfItsOwn': look },
  )
  const ownerFilesOpened: string[] = []
  const { claimWikiUpdateMarker: claimWhereTheLookIsWrong } = await loadModule<
    typeof claimModule
  >(resolve(__dirname, '../utils/claimWikiUpdateMarker.js'), {
    'node:fs/promises': wrongLook.fileSystem,
    './isFolderOfItsOwn': look,
    './removeWithoutFollowing': walk,
    './readRecordedOwner': {
      readRecordedOwner: (path: string) => {
        ownerFilesOpened.push(path)
        return readRecordedOwner(path)
      },
    },
  })
  const aMinuteAndASecondLater = Date.now() + 61_000
  const claim = await claimWhereTheLookIsWrong(
    cloned.outputDirectory,
    {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: aMinuteAndASecondLater,
    },
    { ...AS_THIS_WINDOW, now: () => aMinuteAndASecondLater },
  )
  assert.ok('release' in claim)

  // Act
  await claim.release()

  // Assert
  assert.deepEqual(
    {
      ownerFilesOpened,
      besideTheWiki: await readdir(join(cloned.project, '.codebook')),
      docs: (await readdir(join(cloned.project, 'docs'))).toSorted(),
    },
    {
      ownerFilesOpened: [],
      besideTheWiki: ['wiki'],
      docs: ['guide.md', 'left'],
    },
  )
})
