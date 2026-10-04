import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readLiveWikiUpdateMarker } from '../utils/readLiveWikiUpdateMarker'

const MINUTE_MS = 60_000

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
  // Arrange: a VS Code run lasts at most its chat's opening (30 s) and its watch (15 minutes); a Cursor run 15 minutes.
  const nowMs = Date.now()
  const vsCodePast = await createMarkedWiki({
    host: 'vscode',
    startedAtMs: nowMs - 17 * MINUTE_MS,
  })
  const cursorPast = await createMarkedWiki({
    host: 'cursor',
    startedAtMs: nowMs - 17 * MINUTE_MS,
  })
  try {
    // Act
    const markers = [
      await readLiveWikiUpdateMarker(vsCodePast.outputDirectory, 'own-window'),
      await readLiveWikiUpdateMarker(cursorPast.outputDirectory, 'own-window'),
    ]

    // Assert
    assert.deepEqual(markers, [undefined, undefined])
  } finally {
    await rm(vsCodePast.directory, { recursive: true, force: true })
    await rm(cursorPast.directory, { recursive: true, force: true })
  }
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
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs,
    })
    assert.deepEqual(reservation, {
      pid: process.pid,
      windowId: 'other-window',
      host: 'vscode',
      startedAtMs: nowMs - 40 * MINUTE_MS,
      watchEndedAtMs: nowMs - 30 * MINUTE_MS,
    })
  } finally {
    await rm(running.directory, { recursive: true, force: true })
    await rm(reserved.directory, { recursive: true, force: true })
  }
})
