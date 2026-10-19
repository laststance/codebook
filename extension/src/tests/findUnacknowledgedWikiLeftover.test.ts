import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findUnacknowledgedWikiLeftover } from '../utils/findUnacknowledgedWikiLeftover'
import { formatClockTime } from '../utils/formatClockTime'

/** The watch bound of the tests: 15 minutes, as the extension passes it. */
const WATCH_TIMEOUT_MS = 900_000

/** A moment of 2026-10-03 (UTC) at the given hour and minute, in epoch milliseconds. */
const at = (hour: number, minute: number): number =>
  Date.UTC(2026, 9, 3, hour, minute)

/** The hour and minute of a moment of 2026-10-03 (UTC) as a refusal writes it: in the host's own zone and language, with the zone. */
const clockTime = (hour: number, minute: number): string =>
  formatClockTime(at(hour, minute), {})

/** Makes a Wiki folder with no site published in it, so no publish has ended the wait for any chat. */
async function makeUnpublishedWiki(): Promise<{
  parent: string
  outputDirectory: string
}> {
  const parent = await mkdtemp(join(tmpdir(), 'codebook-wiki-leftover-'))
  return { parent, outputDirectory: join(parent, 'wiki') }
}

// Value: protects=the learner who waits until the time the refusal for this window's own stopped chat names, then presses Update again; fails_when=the one refusal that names the candidate the stopped watch saw names the end of the candidate's wait only, while the wait for the watch's chat lasts until the watch's end plus the bound, so a press at the named time is refused again; or the sentence names the watch's end although the candidate was written again after it; why_new=Cycle 0047 row 21 (P3M1 = P3OCR1-1); seam=the clock and the listing of the candidates, handed over; no_claim=the wording of the sentence besides its times
test('the refusal for a candidate this window’s stopped watch saw names the later end of the wait: the watch’s end plus the bound, or the candidate’s when it was written again after the watch’s end', async () => {
  // Arrange: the watch started at 11:58, saw wiki.stage-1 and stopped at 12:05; the chat may still work.
  const wiki = await makeUnpublishedWiki()
  const lastRun = {
    outputDirectory: wiki.outputDirectory,
    startedAtMs: at(11, 58),
    endedAtMs: at(12, 5),
    mayAgentStillWork: true,
    candidateNames: ['wiki.stage-1'],
  }
  try {
    // Act: once with the candidate as the watch saw it (written 12:00), once after the chat wrote it again at 12:08.
    const writtenBeforeTheWatchsEnd = await findUnacknowledgedWikiLeftover(
      wiki.outputDirectory,
      {
        nowMs: at(12, 6),
        watchTimeoutMs: WATCH_TIMEOUT_MS,
        otherWindow: undefined,
        lastRun,
        acknowledged: [],
        listCandidates: () =>
          Promise.resolve([
            { name: 'wiki.stage-1', writtenAtMs: at(12, 0), ownedPaths: [] },
          ]),
      },
    )
    const writtenAgainAfterIt = await findUnacknowledgedWikiLeftover(
      wiki.outputDirectory,
      {
        nowMs: at(12, 9),
        watchTimeoutMs: WATCH_TIMEOUT_MS,
        otherWindow: undefined,
        lastRun,
        acknowledged: [],
        listCandidates: () =>
          Promise.resolve([
            { name: 'wiki.stage-1', writtenAtMs: at(12, 8), ownedPaths: [] },
          ]),
      },
    )

    // Assert
    assert.deepEqual(writtenBeforeTheWatchsEnd, {
      named: [
        { kind: 'candidate', name: 'wiki.stage-1' },
        { kind: 'last-run', endedAtMs: at(12, 5) },
      ],
      reason: `An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-1, written ${clockTime(12, 0)}). Codebook waits for it until ${clockTime(12, 20)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
    assert.deepEqual(writtenAgainAfterIt, {
      named: [
        { kind: 'candidate', name: 'wiki.stage-1' },
        { kind: 'last-run', endedAtMs: at(12, 5) },
      ],
      reason: `An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-1, written ${clockTime(12, 8)}). Codebook waits for it until ${clockTime(12, 23)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
  } finally {
    await rm(wiki.parent, { recursive: true, force: true })
  }
})
