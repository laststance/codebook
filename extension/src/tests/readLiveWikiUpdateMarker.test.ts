import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { openWithoutFollowing } from '../utils/openWithoutFollowing'
import type * as lookModule from '../utils/readLiveWikiUpdateMarker'
import {
  readLiveWikiUpdateMarker,
  type WikiUpdateMarkerLook,
} from '../utils/readLiveWikiUpdateMarker'
import type * as readerModule from '../utils/readWikiRegularFile'

import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'

const MINUTE_MS = 60_000

/** The present of every test with a fixed clock (epoch milliseconds). */
const NOW_MS = 1_790_000_000_000

/** This window as the tests with a fixed identity name it: a Linux process of the host "workstation" (its digest is d195d36bd79da7df) in an editor whose machine id has the digest f9c8c7ddcf3d5f56, under the kernel boot "boot-1", in the pid namespace 4026531836. Every Linux start of these tests names that namespace: a record of a project folder whose start names none is not judged by its process id. */
const THIS_WINDOW = {
  hostname: 'workstation',
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  boot: { id: 'boot-1' },
  processStart: 'linux@4026531836:16362446',
}

/** Makes a Wiki folder that is removed with the test, and puts the given text at its marker's path when one is given; `modifiedAtMs` sets when that file says it was last written. Returns the output folder. */
async function wikiWithMarkerFile(
  context: TestContext,
  text?: string,
  modifiedAtMs?: number,
): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-marker-look-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const outputDirectory = join(directory, 'wiki')
  const markerPath = `${outputDirectory}.update-run.json`
  await mkdir(outputDirectory)
  if (text !== undefined) await writeFile(markerPath, text)
  if (modifiedAtMs !== undefined)
    await utimes(markerPath, new Date(modifiedAtMs), new Date(modifiedAtMs))
  return outputDirectory
}

/** Looks at a Wiki's marker as the fixed window {@link THIS_WINDOW} does at the given time. `starts` says when the process that has each id now began; a process it does not name has a start that cannot be read. */
function lookAt(
  outputDirectory: string,
  nowMs: number,
  starts: Record<number, string> = {},
): Promise<WikiUpdateMarkerLook> {
  return readLiveWikiUpdateMarker(outputDirectory, 'own-window', {
    identity: THIS_WINDOW,
    nowMs,
    readStart: async (pid) => starts[pid],
  })
}

/** Writes a marker of another window beside a new Wiki folder; the marker's process is this test process, which runs. */
async function createMarkedWiki(marker: {
  host: 'vscode' | 'cursor'
  startedAtMs: number
  watchEndedAtMs?: number
}): Promise<{ directory: string; outputDirectory: string }> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-live-marker-')),
  )
  const outputDirectory = join(directory, 'wiki')
  await mkdir(outputDirectory)
  await writeFile(
    `${outputDirectory}.update-run.json`,
    JSON.stringify({ pid: process.pid, windowId: 'other-window', ...marker }),
  )
  return { directory, outputDirectory }
}

// Value: protects=the Update button of every window after an editor was killed or the machine lost power during an update; fails_when=a run's marker counts for as long as some process has its recorded id (ids start again at every boot), so every press is refused with "Another editor window is updating this Wiki", without "Update anyway", until the learner deletes the file by hand; why_new=Cycle 0045 local review wiki-1 #2; seam=none
test('a run marker whose process id still answers stops counting as a running update once no run of its host can still last', async () => {
  // Arrange: a VS Code run lasts at most its chat's opening (30 s) and its watch (15 minutes); a Cursor run 15 minutes. A marker counts for 60 s and the clock tolerance of 5 minutes longer.
  const nowMs = Date.now()
  const vsCodePast = await createMarkedWiki({
    host: 'vscode',
    startedAtMs: nowMs - 22 * MINUTE_MS,
  })
  const cursorPast = await createMarkedWiki({
    host: 'cursor',
    startedAtMs: nowMs - 22 * MINUTE_MS,
  })
  try {
    // Act
    const markers = [
      await readLiveWikiUpdateMarker(vsCodePast.outputDirectory, 'own-window'),
      await readLiveWikiUpdateMarker(cursorPast.outputDirectory, 'own-window'),
    ]

    // Assert
    assert.deepEqual(markers, [{ kind: 'unowned' }, { kind: 'unowned' }])
  } finally {
    await rm(vsCodePast.directory, { recursive: true, force: true })
    await rm(cursorPast.directory, { recursive: true, force: true })
  }
})

// Cycle 0046 (row 359): the marker is the reload's only protection when workspace storage refused the stopped watch's record; it describes a chat, so the former extension host's exit must not clear it before its bound.
test('a stopped watch’s reservation still protects a reloaded window after its former process ended, and expires at the watch bound', async (context) => {
  // Arrange
  const outputDirectory = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'stopped-window',
      host: 'vscode',
      startedAtMs: NOW_MS - 60_000,
      watchEndedAtMs: NOW_MS,
      ...THIS_WINDOW,
    }),
  )

  // Act
  const beforeTheBound = await lookAt(outputDirectory, NOW_MS + 899_999)
  const atTheBound = await lookAt(outputDirectory, NOW_MS + 900_000)

  // Assert
  assert.equal(beforeTheBound.kind, 'live')
  assert.deepEqual(atTheBound, { kind: 'unowned' })
})

test('a run marker of another window still counts inside its host’s longest run, and a stopped watch’s reservation is handed on for the caller to weigh', async () => {
  // Arrange
  const nowMs = Date.now()
  const startedAtMs = nowMs - 14 * MINUTE_MS
  const running = await createMarkedWiki({ host: 'vscode', startedAtMs })
  const reserved = await createMarkedWiki({
    host: 'vscode',
    startedAtMs: nowMs - 40 * MINUTE_MS,
    watchEndedAtMs: nowMs - 30 * MINUTE_MS,
  })
  try {
    // Act
    const runningMarker = await readLiveWikiUpdateMarker(
      running.outputDirectory,
      'own-window',
    )
    const reservation = await readLiveWikiUpdateMarker(
      reserved.outputDirectory,
      'own-window',
    )

    // Assert
    assert.deepEqual(runningMarker, {
      kind: 'live',
      heldBy: {
        pid: process.pid,
        windowId: 'other-window',
        host: 'vscode',
        startedAtMs,
      },
    })
    assert.deepEqual(reservation, {
      kind: 'live',
      heldBy: {
        pid: process.pid,
        windowId: 'other-window',
        host: 'vscode',
        startedAtMs: nowMs - 40 * MINUTE_MS,
        watchEndedAtMs: nowMs - 30 * MINUTE_MS,
      },
    })
  } finally {
    await rm(running.directory, { recursive: true, force: true })
    await rm(reserved.directory, { recursive: true, force: true })
  }
})

// Value: protects=the rule that only one window updates a Wiki, beside a window of 0.2.29.0 or on a file system without hard links, where a marker exists for the time of one write before it has content; fails_when=a marker file without content counts as nobody's at once, so a second window removes it under its writer's feet and both update the Wiki (row 16), or such a file counts for good and a killed writer's empty file refuses every start; why_new=Cycle 0046 row 16 (PL-8); seam=the file's modification time and the clock handed to the look
test('a marker file without content counts as one another window is writing for 2 s after its write, also when it was written up to 5 minutes ahead of the clock, and is nobody’s afterwards', async (context) => {
  // Arrange: an empty marker file and one whose writer has put half of its text, both last written at the fixed present.
  const empty = await wikiWithMarkerFile(context, '', NOW_MS)
  const halfWritten = await wikiWithMarkerFile(
    context,
    '{"pid":4242,"windowId":"oth',
    NOW_MS,
  )

  // Act
  const looks = {
    emptyAfter1999Ms: await lookAt(empty, NOW_MS + 1_999),
    emptyAfter2000Ms: await lookAt(empty, NOW_MS + 2_000),
    halfWrittenAfter1999Ms: await lookAt(halfWritten, NOW_MS + 1_999),
    halfWrittenAfter2000Ms: await lookAt(halfWritten, NOW_MS + 2_000),
    emptyWritten5MinutesAhead: await lookAt(empty, NOW_MS - 300_000),
    emptyWrittenFurtherAhead: await lookAt(empty, NOW_MS - 300_001),
  }

  // Assert
  assert.deepEqual(looks, {
    emptyAfter1999Ms: {
      kind: 'being-written',
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    },
    emptyAfter2000Ms: { kind: 'unowned' },
    halfWrittenAfter1999Ms: {
      kind: 'being-written',
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    },
    halfWrittenAfter2000Ms: { kind: 'unowned' },
    emptyWritten5MinutesAhead: {
      kind: 'being-written',
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    },
    emptyWrittenFurtherAhead: { kind: 'unowned' },
  })
})

// Value: protects=a start beside a window that removed a stale marker and is about to write its own; fails_when=a look cannot tell "no marker" from "a marker that is nobody's", so the window that found none removes the marker another window created in that instant (row 52), or an entry that is no marker (a folder a repository supplies) counts as no marker and refuses every start with a file error; why_new=Cycle 0046 row 52 (decision D12); seam=the entry's modification time and the clock handed to the look
test('a look tells a marker path that holds nothing from one that holds an entry no marker can be read from, which is nobody’s once it is older than a write takes', async (context) => {
  // Arrange: a Wiki without a marker, and one with a folder where its marker file would be, last changed at the fixed present.
  const withoutMarker = await wikiWithMarkerFile(context)
  const withFolder = await wikiWithMarkerFile(context)
  await mkdir(`${withFolder}.update-run.json`)
  await utimes(
    `${withFolder}.update-run.json`,
    new Date(NOW_MS),
    new Date(NOW_MS),
  )

  // Act
  const looks = {
    nothingAtThePath: await lookAt(withoutMarker, NOW_MS),
    folderAfter1999Ms: await lookAt(withFolder, NOW_MS + 1_999),
    folderAfter2000Ms: await lookAt(withFolder, NOW_MS + 2_000),
  }

  // Assert
  assert.deepEqual(looks, {
    nothingAtThePath: { kind: 'none' },
    folderAfter1999Ms: {
      kind: 'being-written',
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    },
    folderAfter2000Ms: { kind: 'unowned' },
  })
})

// Value: protects=a running update whose marker file another program holds open at the moment a second window starts (on Windows a scanner or an indexer: EBUSY, EPERM; a file this user may not read: EACCES); fails_when=a regular marker file that cannot be read counts as nobody's 2 s after its write, so the second window's start removes it and two agents update one Wiki, while the run's own end treats the same file as possibly its marker; why_new=Cycle 0047 row 32 (P3RT10); seam=the open of the marker file under a loaded readWikiRegularFile, which fails with EBUSY, and the clock handed to the look; no_claim=Windows' real error codes
test('a marker file that cannot be read at this moment counts as one being written for as long as any run’s marker counts after its write (61 min 30 s, a generation’s), and is nobody’s afterwards', async (context) => {
  // Arrange: a marker file of another window's run, last written at the fixed present, whose every open fails as for a file another program holds open.
  const outputDirectory = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
    }),
    NOW_MS,
  )
  const markerPath = `${outputDirectory}.update-run.json`
  const readerWhoseMarkerOpenIsRefused = await loadModule<typeof readerModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          ...openInputs: Parameters<typeof openWithoutFollowing>
        ) => {
          if (openInputs[0] === markerPath)
            throw Object.assign(
              new Error('EBUSY: resource busy or locked, open'),
              { code: 'EBUSY' },
            )
          return openWithoutFollowing(...openInputs)
        },
      },
    },
  )
  const { readLiveWikiUpdateMarker: lookInThatWindow } = await loadModule<
    typeof lookModule
  >(resolve(__dirname, '../utils/readLiveWikiUpdateMarker.js'), {
    './readWikiRegularFile': readerWhoseMarkerOpenIsRefused,
  })
  // The loaded module answers objects of its own context; a copy makes them comparable here.
  const lookAtTheHeldMarker = async (
    nowMs: number,
  ): Promise<WikiUpdateMarkerLook> =>
    structuredClone(
      await lookInThatWindow(outputDirectory, 'own-window', {
        identity: THIS_WINDOW,
        nowMs,
        readStart: async () => undefined,
      }),
    )

  // Act
  const looks = {
    after3Seconds: await lookAtTheHeldMarker(NOW_MS + 3_000),
    after61Minutes30Seconds: await lookAtTheHeldMarker(NOW_MS + 3_690_000),
    after61Minutes30SecondsAnd1Ms: await lookAtTheHeldMarker(
      NOW_MS + 3_690_001,
    ),
    written5MinutesAhead: await lookAtTheHeldMarker(NOW_MS - 300_000),
    writtenFurtherAhead: await lookAtTheHeldMarker(NOW_MS - 300_001),
  }

  // Assert: past the 2 s a write takes, the look also names the file and the last moment it counts (Cycle 0047 row 85).
  assert.deepEqual(looks, {
    after3Seconds: {
      kind: 'being-written',
      heldBy: {
        beingWrittenSinceMs: 1_790_000_000_000,
        unreadableMarkerPath: markerPath,
        countsUntilMs: 1_790_003_690_000,
      },
    },
    after61Minutes30Seconds: {
      kind: 'being-written',
      heldBy: {
        beingWrittenSinceMs: 1_790_000_000_000,
        unreadableMarkerPath: markerPath,
        countsUntilMs: 1_790_003_690_000,
      },
    },
    after61Minutes30SecondsAnd1Ms: { kind: 'unowned' },
    // A file dated ahead of the clock is named as well, so its refusal does not ask to wait a moment (Cycle 0047 row 129).
    written5MinutesAhead: {
      kind: 'being-written',
      heldBy: {
        beingWrittenSinceMs: 1_790_000_000_000,
        unreadableMarkerPath: markerPath,
        countsUntilMs: 1_790_003_690_000,
      },
    },
    writtenFurtherAhead: { kind: 'unowned' },
  })
})

// Value: protects=the learner refused beside a marker file that stays unreadable (another user's private marker, or one a Windows program holds open for long), whose refusal must name that file and when it stops counting, while a file a window is still writing keeps the short refusal; fails_when=the look names no file for one that stayed unreadable past the 2 s a write takes, so the refusal says "Wait a moment and try again" for 21 minutes 30 seconds, or names the file already within those 2 s, or stops refusing the start; why_new=Cycle 0047 row 85 (ADV-8); seam=the look loaded with loadModule, whose every open of the marker file fails with EACCES, and the clock handed to it; no_claim=the sentence (describeOtherWikiWindow.test.ts)
test('a marker file that cannot be read still counts as one being written, and names its path and the last moment it counts once it has stayed unreadable for 2 s after its write', async (context) => {
  // Arrange: a marker file of another window's run, last written at the fixed present, whose every open fails as for a file this user may not read.
  const outputDirectory = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
    }),
    NOW_MS,
  )
  const markerPath = `${outputDirectory}.update-run.json`
  const readerWhoseMarkerOpenIsRefused = await loadModule<typeof readerModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          ...openInputs: Parameters<typeof openWithoutFollowing>
        ) => {
          if (openInputs[0] === markerPath)
            throw Object.assign(
              new Error(`EACCES: permission denied, open '${markerPath}'`),
              { code: 'EACCES' },
            )
          return openWithoutFollowing(...openInputs)
        },
      },
    },
  )
  const { readLiveWikiUpdateMarker: lookInThatWindow } = await loadModule<
    typeof lookModule
  >(resolve(__dirname, '../utils/readLiveWikiUpdateMarker.js'), {
    './readWikiRegularFile': readerWhoseMarkerOpenIsRefused,
  })
  // The loaded module answers objects of its own context; a copy makes them comparable here.
  const lookAtTheUnreadableMarker = async (
    nowMs: number,
  ): Promise<WikiUpdateMarkerLook> =>
    structuredClone(
      await lookInThatWindow(outputDirectory, 'own-window', {
        identity: THIS_WINDOW,
        nowMs,
        readStart: async () => undefined,
      }),
    )

  // Act
  const looks = {
    after1999Ms: await lookAtTheUnreadableMarker(NOW_MS + 1_999),
    after2000Ms: await lookAtTheUnreadableMarker(NOW_MS + 2_000),
  }

  // Assert: both refuse the start; only the look past the 2 s names the file and the last moment it counts, 61 min 30 s after its write.
  assert.deepEqual(looks, {
    after1999Ms: {
      kind: 'being-written',
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    },
    after2000Ms: {
      kind: 'being-written',
      heldBy: {
        beingWrittenSinceMs: 1_790_000_000_000,
        unreadableMarkerPath: markerPath,
        countsUntilMs: 1_790_003_690_000,
      },
    },
  })
})

// Value: protects=the learner refused beside a marker file that cannot be read and whose modification time lies ahead of the clock (a network share's clock, a clock moved back), whose refusal must name that file and when it ends, while a file written at the moment of the look keeps the short refusal; fails_when=the look takes a file dated ahead for one written a moment ago, so the refusal says "Wait a moment and try again" for up to 5 minutes, or names the file already at the moment of its write, or stops refusing the start; why_new=Cycle 0047 row 129 (ADV2-6); seam=the look loaded with loadModule, whose every open of the marker file fails with EACCES, and the clock handed to it; no_claim=the sentence (describeOtherWikiWindow.test.ts)
test('a marker file that cannot be read and is dated ahead of the clock names its path and the last moment it counts, so its refusal does not ask to wait a moment for up to 5 minutes', async (context) => {
  // Arrange: a marker file of another window's run, last written at the fixed present, whose every open fails as for a file this user may not read.
  const outputDirectory = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
    }),
    NOW_MS,
  )
  const markerPath = `${outputDirectory}.update-run.json`
  const readerWhoseMarkerOpenIsRefused = await loadModule<typeof readerModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          ...openInputs: Parameters<typeof openWithoutFollowing>
        ) => {
          if (openInputs[0] === markerPath)
            throw Object.assign(
              new Error(`EACCES: permission denied, open '${markerPath}'`),
              { code: 'EACCES' },
            )
          return openWithoutFollowing(...openInputs)
        },
      },
    },
  )
  const { readLiveWikiUpdateMarker: lookInThatWindow } = await loadModule<
    typeof lookModule
  >(resolve(__dirname, '../utils/readLiveWikiUpdateMarker.js'), {
    './readWikiRegularFile': readerWhoseMarkerOpenIsRefused,
  })
  // The loaded module answers objects of its own context; a copy makes them comparable here.
  const lookAtTheUnreadableMarker = async (
    nowMs: number,
  ): Promise<WikiUpdateMarkerLook> =>
    structuredClone(
      await lookInThatWindow(outputDirectory, 'own-window', {
        identity: THIS_WINDOW,
        nowMs,
        readStart: async () => undefined,
      }),
    )

  // Act
  const looks = {
    atTheMomentOfItsWrite: await lookAtTheUnreadableMarker(NOW_MS),
    dated1MsAhead: await lookAtTheUnreadableMarker(NOW_MS - 1),
    dated5MinutesAhead: await lookAtTheUnreadableMarker(NOW_MS - 300_000),
  }

  // Assert: all three refuse the start; only the look at the moment of the write asks to wait a moment, and the file dated ahead is named with the last moment it counts, 61 min 30 s after its modification time.
  assert.deepEqual(looks, {
    atTheMomentOfItsWrite: {
      kind: 'being-written',
      heldBy: { beingWrittenSinceMs: 1_790_000_000_000 },
    },
    dated1MsAhead: {
      kind: 'being-written',
      heldBy: {
        beingWrittenSinceMs: 1_790_000_000_000,
        unreadableMarkerPath: markerPath,
        countsUntilMs: 1_790_003_690_000,
      },
    },
    dated5MinutesAhead: {
      kind: 'being-written',
      heldBy: {
        beingWrittenSinceMs: 1_790_000_000_000,
        unreadableMarkerPath: markerPath,
        countsUntilMs: 1_790_003_690_000,
      },
    },
  })
})

// Value: protects=the Update button in a checkout whose repository holds a marker file; fails_when=a marker with a start in the far future counts for as long as its process id answers (process 1 always does), so every start is refused with "Another editor window is updating this Wiki" until the learner deletes the file by hand, or a reservation whose watch ended in the far future counts for good and refuses a start with a sentence that names a chat that never existed (row 114); why_new=Cycle 0046 row 17 (PL-9), rule 2, and row 114 for the reservation; seam=the clock handed to the look
test('a marker whose run starts, or whose stopped watch ended, more than 5 minutes ahead of the clock is nobody’s, so a marker file a repository supplies cannot refuse every start', async (context) => {
  // Arrange: a run's marker and a stopped watch's reservation as 0.2.29.0 writes them, whose process id answers (this test process). The reservation's run began ten minutes before its watch ended.
  const marked = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
    }),
  )
  const reserved = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS - 600_000,
      watchEndedAtMs: NOW_MS,
    }),
  )

  // Act
  const looks = {
    started5MinutesAhead: (await lookAt(marked, NOW_MS - 300_000)).kind,
    startedFurtherAhead: (await lookAt(marked, NOW_MS - 300_001)).kind,
    watchEnded5MinutesAhead: (await lookAt(reserved, NOW_MS - 300_000)).kind,
    watchEndedFurtherAhead: (await lookAt(reserved, NOW_MS - 300_001)).kind,
  }

  // Assert
  assert.deepEqual(looks, {
    started5MinutesAhead: 'live',
    startedFurtherAhead: 'unowned',
    watchEnded5MinutesAhead: 'live',
    watchEndedFurtherAhead: 'unowned',
  })
})

// Value: protects=a running update after its computer's clock was corrected backwards; fails_when=the start time is weighed before the owner's process is looked at, so the running window's marker counts as one from the future, a second window removes it and both update the Wiki (decision D10), or a marker counts as verified without the proof it needs (the same start under the same boot); why_new=Cycle 0046 row 17 (ER-7 rule 1, ER-13); seam=the start reader and the clock handed to the look
test('the marker of a running window of this machine stays live after the clock was set back by 6 minutes, while a marker that far ahead without that proof is nobody’s', async (context) => {
  // Arrange: four markers of this machine whose run starts 6 minutes ahead of the clock.
  const markerOf = (owner: {
    pid: number
    boot?: { id: string }
  }): Promise<string> =>
    wikiWithMarkerFile(
      context,
      JSON.stringify({
        windowId: 'other-window',
        host: 'vscode',
        startedAtMs: NOW_MS,
        machineKey: 'f9c8c7ddcf3d5f56',
        hostKey: 'd195d36bd79da7df',
        processStart: 'linux@4026531836:500',
        ...owner,
      }),
    )
  const ofRunningWindow = await markerOf({
    pid: process.pid,
    boot: { id: 'boot-1' },
  })
  const ofProcessOne = await markerOf({ pid: 1, boot: { id: 'boot-1' } })
  const withoutBootId = await markerOf({ pid: process.pid })
  const sixMinutesBack = NOW_MS - 360_000

  // Act: the process with the recorded id began at the recorded time, except process 1, which began at another.
  const looks = {
    runningWindow: (
      await lookAt(ofRunningWindow, sixMinutesBack, {
        [process.pid]: 'linux@4026531836:500',
      })
    ).kind,
    processOneWithAnotherStart: (
      await lookAt(ofProcessOne, sixMinutesBack, { 1: 'linux@4026531836:1' })
    ).kind,
    sameStartWithoutBootId: (
      await lookAt(withoutBootId, sixMinutesBack, {
        [process.pid]: 'linux@4026531836:500',
      })
    ).kind,
    startCannotBeRead: (await lookAt(ofRunningWindow, sixMinutesBack)).kind,
  }

  // Assert
  assert.deepEqual(looks, {
    runningWindow: 'live',
    processOneWithAnotherStart: 'unowned',
    sameStartWithoutBootId: 'unowned',
    startCannotBeRead: 'unowned',
  })
})

// Value: protects=two computers that update one Wiki on a shared folder; fails_when=a marker of another machine is judged by a process id of this one, looks gone and is removed, so both machines update the Wiki (row 17), or it counts for good after its machine was switched off; why_new=Cycle 0046 row 17 (PL-9), rule 3; seam=the clock handed to the look
test('a marker of another machine is live until its run marker expires, although no process has its id here', async (context) => {
  // Arrange: the marker of a VS Code run on a machine with other digests; a VS Code run counts for 30 s, 15 minutes, 60 s and the clock tolerance of 5 minutes.
  const marked = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      boot: { id: 'boot-of-the-other-machine' },
      processStart: 'linux@4026531836:500',
    }),
  )

  // Act
  const looks = {
    atItsBound: (await lookAt(marked, NOW_MS + 1_290_000)).kind,
    pastItsBound: (await lookAt(marked, NOW_MS + 1_290_001)).kind,
  }

  // Assert
  assert.deepEqual(looks, { atItsBound: 'live', pastItsBound: 'unowned' })
})

// Value: protects=the Update button after an editor of this machine was killed during an update; fails_when=its marker counts until its run would have ended (about 21 minutes) although its process is gone, or for as long as another process has its id (process 1 answers every probe), or a running window whose start cannot be read at this moment loses its marker; why_new=Cycle 0046 row 17 (PL-9), rule 4; seam=the start reader handed to the look
test('a marker of this machine is nobody’s when no process has its id or the process that has it began at another time, and stays live while that process’s start cannot be read', async (context) => {
  // Arrange: three markers of this machine and boot, each recording the process start "linux@4026531836:500".
  const markerOf = (pid: number): Promise<string> =>
    wikiWithMarkerFile(
      context,
      JSON.stringify({
        pid,
        windowId: 'other-window',
        host: 'vscode',
        startedAtMs: NOW_MS,
        machineKey: 'f9c8c7ddcf3d5f56',
        hostKey: 'd195d36bd79da7df',
        boot: { id: 'boot-1' },
        processStart: 'linux@4026531836:500',
      }),
    )
  const ofNoProcess = await markerOf(ID_OF_NO_PROCESS)
  const ofThisProcessId = await markerOf(process.pid)
  const ofProcessOne = await markerOf(1)
  const aMinuteLater = NOW_MS + 60_000

  // Act
  const looks = {
    noProcessHasItsId: (await lookAt(ofNoProcess, aMinuteLater)).kind,
    itsIdWentToAnotherProcess: (
      await lookAt(ofThisProcessId, aMinuteLater, {
        [process.pid]: 'linux@4026531836:900',
      })
    ).kind,
    processOneWithAnotherStart: (
      await lookAt(ofProcessOne, aMinuteLater, { 1: 'linux@4026531836:1' })
    ).kind,
    startCannotBeRead: (await lookAt(ofThisProcessId, aMinuteLater)).kind,
  }

  // Assert
  assert.deepEqual(looks, {
    noProcessHasItsId: 'unowned',
    itsIdWentToAnotherProcess: 'unowned',
    processOneWithAnotherStart: 'unowned',
    startCannotBeRead: 'live',
  })
})

// Value: protects=a window of this build beside a window of 0.2.29.0 on one project folder; fails_when=a marker without the machine's digests is taken for one of no machine and never counts as gone, so a killed 0.2.29.0 editor's marker refuses every start for about 21 minutes, or its running update is not seen; why_new=Cycle 0046 row 17 (PL-9), rule 5; seam=none
test('a marker without the machine’s digests, as 0.2.29.0 writes it, is judged by a probe of its process id as before', async (context) => {
  // Arrange
  const markerOf = (pid: number): Promise<string> =>
    wikiWithMarkerFile(
      context,
      JSON.stringify({
        pid,
        windowId: 'other-window',
        host: 'cursor',
        startedAtMs: NOW_MS,
      }),
    )
  const ofRunningProcess = await markerOf(process.pid)
  const ofNoProcess = await markerOf(ID_OF_NO_PROCESS)

  // Act
  const looks = {
    itsProcessRuns: await lookAt(ofRunningProcess, NOW_MS + 60_000),
    noProcessHasItsId: await lookAt(ofNoProcess, NOW_MS + 60_000),
  }

  // Assert
  assert.deepEqual(looks, {
    itsProcessRuns: {
      kind: 'live',
      heldBy: {
        pid: process.pid,
        windowId: 'other-window',
        host: 'cursor',
        startedAtMs: 1_790_000_000_000,
      },
    },
    noProcessHasItsId: { kind: 'unowned' },
  })
})

// Value: protects=the Update button in Cursor after VS Code was killed during an update on the same computer (and the other way round); fails_when=the marker's machine is told by the editor's machine id alone, which VS Code and Cursor do not share, so the killed editor's marker counts as one of another machine and refuses every start until it expires; why_new=Cycle 0046 row 17 (ER-3, ER-7); seam=none
test('a marker of the other editor on this computer, with another machine id digest and the same host-name digest, is judged here: nobody’s once no process has its id', async (context) => {
  // Arrange
  const marked = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'other-window',
      host: 'cursor',
      startedAtMs: NOW_MS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-1' },
      processStart: 'linux@4026531836:500',
    }),
  )

  // Act
  const look = await lookAt(marked, NOW_MS + 60_000)

  // Assert
  assert.deepEqual(look, { kind: 'unowned' })
})

// Value: protects=a Windows window and a WSL window that update one Wiki on one project folder (they share a host name, never a process id); fails_when=the other system's marker is judged by a process id of this system, looks gone and is removed, so both update the Wiki; why_new=Cycle 0046 row 58 at the marker (ER-7 after package LKA); seam=the clock handed to the look
test('a marker of a window in the other system of this computer, whose process start has another form, is live until its run marker expires, although no process has its id here', async (context) => {
  // Arrange: the marker of a Cursor run in a Windows window on the host this Linux window runs on; a Cursor run counts for 15 minutes, 60 s and the clock tolerance of 5 minutes.
  const marked = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'other-window',
      host: 'cursor',
      startedAtMs: NOW_MS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    }),
  )

  // Act
  const looks = {
    atItsBound: (await lookAt(marked, NOW_MS + 1_260_000)).kind,
    pastItsBound: (await lookAt(marked, NOW_MS + 1_260_001)).kind,
  }

  // Assert
  assert.deepEqual(looks, { atItsBound: 'live', pastItsBound: 'unowned' })
})

// Value: protects=a running update whose marker is read by a window with a clock up to 5 minutes ahead, or after the clock moved forward; fails_when=the run's bound has no clock tolerance, so late in a long update the marker of the running window expires for the reader and a second update starts beside it (decision D11), or the tolerance is unbounded and a killed editor's marker never expires; why_new=Cycle 0046 row 17 (ER-7, ER-13); seam=the clock handed to the look
test('a run marker read with a clock 2 minutes ahead late in a long update is live, and it expires only past its host’s longest run plus 60 s plus the 5 minutes of clock tolerance', async (context) => {
  // Arrange: markers as 0.2.29.0 writes them, whose process id answers, so only their age decides.
  const markerOf = (host: 'vscode' | 'cursor'): Promise<string> =>
    wikiWithMarkerFile(
      context,
      JSON.stringify({
        pid: process.pid,
        windowId: 'other-window',
        host,
        startedAtMs: NOW_MS,
      }),
    )
  const cursorRun = await markerOf('cursor')
  const vsCodeRun = await markerOf('vscode')

  // Act: minute 14 of a Cursor run of at most 15, read by a clock 2 minutes ahead, is minute 16, where the bound without a clock tolerance ends.
  const looks = {
    cursorMinute14ReadTwoMinutesAhead: (
      await lookAt(cursorRun, NOW_MS + 16 * MINUTE_MS + 1)
    ).kind,
    cursorAtItsBound: (await lookAt(cursorRun, NOW_MS + 1_260_000)).kind,
    cursorPastItsBound: (await lookAt(cursorRun, NOW_MS + 1_260_001)).kind,
    vsCodeAtItsBound: (await lookAt(vsCodeRun, NOW_MS + 1_290_000)).kind,
    vsCodePastItsBound: (await lookAt(vsCodeRun, NOW_MS + 1_290_001)).kind,
  }

  // Assert
  assert.deepEqual(looks, {
    cursorMinute14ReadTwoMinutesAhead: 'live',
    cursorAtItsBound: 'live',
    cursorPastItsBound: 'unowned',
    vsCodeAtItsBound: 'live',
    vsCodePastItsBound: 'unowned',
  })
})

// Value: protects=a window's next update after its own earlier run left its marker (the run's end could not take the claim); fails_when=the window's own marker, whose process runs and has the recorded start, counts as another window's running update, so this window refuses its own start until the marker expires; why_new=the own-window rule had no test, and since Cycle 0046 a marker of a running process of this machine is live before every other rule (ER-7); seam=the start reader handed to the look
test('a window’s own marker, a leftover of a run that ended, is nobody’s although its process runs with the recorded start', async (context) => {
  // Arrange
  const marked = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: process.pid,
      windowId: 'own-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-1' },
      processStart: 'linux@4026531836:16362446',
    }),
  )

  // Act
  const look = await lookAt(marked, NOW_MS + 60_000, {
    [process.pid]: 'linux@4026531836:16362446',
  })

  // Assert
  assert.deepEqual(look, { kind: 'unowned' })
})

// Value: protects=a running update of a later build beside a window of this build; fails_when=a marker whose boot is written in a form this build does not write (a boot time instead of a kernel boot id) fails to parse as a whole, counts as a file without content, and is removed 2 s after its write, so both windows update the Wiki; why_new=the marker records a boot since Cycle 0046 (ER-6); seam=none
test('a marker whose boot is written in another form than a kernel boot id is still read, without the boot', async (context) => {
  // Arrange: a marker of another machine that records the time its machine started.
  const marked = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      boot: { startedAtMs: 1_789_990_000_000 },
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    }),
    NOW_MS,
  )

  // Act
  const look = await lookAt(marked, NOW_MS + 60_000)

  // Assert
  assert.deepEqual(look, {
    kind: 'live',
    heldBy: {
      pid: 4_194_305,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: 1_790_000_000_000,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      boot: undefined,
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    },
  })
})

// Value: protects=Eng decision 74, another window's generation of up to 55 minutes; fails_when=its marker expires at an update's 21 minutes 30 seconds, so a second window starts an agent beside it, or a marker with a kind this version does not know counts longer than an update's; no_claim=a marker whose owner is judged gone (tests above); seam=the clock handed to the look
test('a generation’s marker of another machine stays live past an update’s bound until a generation’s, and a marker of an unknown kind is an update’s', async (context) => {
  // Arrange: two markers of a VS Code run on a machine with other digests; a generation counts for 30 s, 55 minutes, 60 s and the clock tolerance of 5 minutes.
  const ofAnotherMachine = (runKind: string): string =>
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: NOW_MS,
      runKind,
      machineKey: '1fb1404a9738d5ed',
      hostKey: '5f0c1a8d2e3b4a69',
      boot: { id: 'boot-of-the-other-machine' },
      processStart: 'linux@4026531836:500',
    })
  const generation = await wikiWithMarkerFile(
    context,
    ofAnotherMachine('generate'),
  )
  const unknownKind = await wikiWithMarkerFile(
    context,
    ofAnotherMachine('rebuild'),
  )

  // Act
  const looks = {
    generationPastAnUpdatesBound: (await lookAt(generation, NOW_MS + 1_290_001))
      .kind,
    generationAtItsBound: (await lookAt(generation, NOW_MS + 3_690_000)).kind,
    generationPastItsBound: (await lookAt(generation, NOW_MS + 3_690_001)).kind,
    unknownKindPastAnUpdatesBound: (
      await lookAt(unknownKind, NOW_MS + 1_290_001)
    ).kind,
  }

  // Assert
  assert.deepEqual(looks, {
    generationPastAnUpdatesBound: 'live',
    generationAtItsBound: 'live',
    generationPastItsBound: 'unowned',
    unknownKindPastAnUpdatesBound: 'unowned',
  })
})

// Value: protects=Eng decision 74, a stopped VS Code generation whose chat may still publish for up to 55 minutes; fails_when=its reservation ends at an update's 15 minutes, so a new start sends a second chat beside it; no_claim=the publish that ends a reservation early (findUnacknowledgedWikiLeftover tests); seam=the clock handed to the look
test('a stopped generation’s reservation lasts 55 minutes after its watch ended, past an update’s 15 minutes', async (context) => {
  // Arrange
  const outputDirectory = await wikiWithMarkerFile(
    context,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'stopped-window',
      host: 'vscode',
      startedAtMs: NOW_MS - 60_000,
      watchEndedAtMs: NOW_MS,
      runKind: 'generate',
      ...THIS_WINDOW,
    }),
  )

  // Act
  const looks = {
    pastAnUpdatesBound: (await lookAt(outputDirectory, NOW_MS + 900_000)).kind,
    beforeItsBound: (await lookAt(outputDirectory, NOW_MS + 3_299_999)).kind,
    atItsBound: (await lookAt(outputDirectory, NOW_MS + 3_300_000)).kind,
  }

  // Assert
  assert.deepEqual(looks, {
    pastAnUpdatesBound: 'live',
    beforeItsBound: 'live',
    atItsBound: 'unowned',
  })
})
