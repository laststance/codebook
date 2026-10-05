import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as claimModule from '../utils/claimWikiUpdateMarker'
import { claimWikiUpdateMarker } from '../utils/claimWikiUpdateMarker'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import { readLiveWikiUpdateMarker } from '../utils/readLiveWikiUpdateMarker'

import { loadModule } from './utils/loadModule'

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
    const claim = await claimOnAFullDisk(wiki.outputDirectory, runMarker)
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
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000}',
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
    const claim = await claimWikiUpdateMarker(wiki.outputDirectory, runMarker)
    assert.ok('reserve' in claim)
    await link(wiki.markerPath, openedByAReader)

    // Act
    await claim.reserve(1_790_000_060_000)

    // Assert
    assert.equal(
      await readFile(openedByAReader, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000}',
    )
    assert.equal(
      await readFile(wiki.markerPath, 'utf8'),
      '{"pid":' +
        process.pid +
        ',"windowId":"window-a","host":"vscode","startedAtMs":1790000000000,"watchEndedAtMs":1790000060000}',
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
      ) => {
        const looked = await readLiveWikiUpdateMarker(
          outputDirectory,
          ownWindowId,
        )
        // Once: right after the second window saw the stale marker, the first window removes it and writes its own.
        firstWindowClaim ??= claimWikiUpdateMarker(
          wiki.outputDirectory,
          firstWindow,
        )
        await firstWindowClaim
        return looked
      },
    },
  })
  try {
    // Act
    const secondClaim = await claimAsSecondWindow(wiki.outputDirectory, {
      pid: process.pid,
      windowId: 'window-b',
      host: 'vscode',
      startedAtMs,
    })

    const firstClaim = await firstWindowClaim

    // Assert
    assert.ok(firstClaim && 'release' in firstClaim)
    assert.deepEqual(JSON.parse(JSON.stringify(secondClaim)), {
      heldBy: firstWindow,
    })
    assert.deepEqual(
      JSON.parse(await readFile(wiki.markerPath, 'utf8')),
      firstWindow,
    )
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
    (claim) =>
      'release' in claim
        ? 'holds the claim'
        : `held by ${claim.heldBy.windowId}`,
    (error: { code?: string }) => `refused with ${error.code}`,
  )
}

/** Writes the marker of an editor that was killed: its recorded process no longer exists. */
async function leaveKilledEditorsMarker(markerPath: string): Promise<void> {
  await writeFile(
    markerPath,
    JSON.stringify({
      pid: 2 ** 22 + 1,
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
          claimWikiUpdateMarker(wiki.outputDirectory, windowNamed('window-b')),
        )
        await secondStart
        await rm(path, options)
        thirdStart = outcomeOf(
          claimWikiUpdateMarker(wiki.outputDirectory, windowNamed('window-c')),
        )
        await thirdStart
      },
    },
  })
  try {
    // Act
    const firstWindow = await outcomeOf(
      claimAsFirstWindow(wiki.outputDirectory, windowNamed('window-a')),
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
    assert.deepEqual(
      JSON.parse(await readFile(wiki.markerPath, 'utf8')),
      windowNamed('window-c'),
    )
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
  // Arrange: a run that started seventeen minutes ago, longer than any run lasts, and a second window that took its marker over.
  const wiki = await createWikiFolder()
  const takingOver = {
    pid: process.pid,
    windowId: 'window-b',
    host: 'vscode' as const,
    startedAtMs: Date.now(),
  }
  try {
    const outlasted = await claimWikiUpdateMarker(wiki.outputDirectory, {
      pid: process.pid,
      windowId: 'window-a',
      host: 'vscode',
      startedAtMs: Date.now() - 17 * 60_000,
    })
    assert.ok('reserve' in outlasted)
    const takenOver = await outcomeOf(
      claimWikiUpdateMarker(wiki.outputDirectory, takingOver),
    )

    // Act: the first window's watch ends now and its run is recorded.
    await outlasted.reserve(Date.now())
    const markerAfterTheReservation = await readFile(wiki.markerPath, 'utf8')
    await outlasted.release()

    // Assert
    assert.equal(takenOver, 'holds the claim')
    assert.deepEqual(JSON.parse(markerAfterTheReservation), takingOver)
    assert.deepEqual(
      JSON.parse(await readFile(wiki.markerPath, 'utf8')),
      takingOver,
    )
    assert.deepEqual((await readdir(wiki.directory)).toSorted(), [
      'wiki',
      'wiki.update-run.json',
    ])
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=every later start after a window was killed while it held the claim on the marker and its process id went to another process; fails_when=such a claim counts for as long as a process has its id, so a stale marker can never be removed and every start ends with a file error; why_new=Cycle 0045 local review wiki-1 #7, follow-up (the claim must not stay behind for good); seam=none
test('a claim on the marker that a killed window left two minutes ago does not keep a stale marker in place, although a process has its id', async () => {
  // Arrange: a killed editor's marker, and a claim whose recorded process is this test process, which runs.
  const wiki = await createWikiFolder()
  await leaveKilledEditorsMarker(wiki.markerPath)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const leftClaim = join(claimDirectory, 'left-by-a-killed-window')
  await mkdir(claimDirectory)
  await writeFile(
    leftClaim,
    JSON.stringify({ pid: process.pid, ...(await currentStorageOwner()) }),
  )
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
  await utimes(leftClaim, twoMinutesAgo, twoMinutesAgo)
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
    JSON.stringify({ pid: 2 ** 22 + 1, ...(await currentStorageOwner()) }),
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
