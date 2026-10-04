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
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import * as claimModule from '../utils/claimWikiUpdateMarker'
import { claimWikiUpdateMarker } from '../utils/claimWikiUpdateMarker'
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
  let firstClaim: claimModule.WikiUpdateMarkerClaim | undefined
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
        firstClaim ??= await claimWikiUpdateMarker(
          wiki.outputDirectory,
          firstWindow,
        )
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
