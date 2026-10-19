import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findUnacknowledgedWikiLeftover } from '../utils/findUnacknowledgedWikiLeftover'
import { formatClockTime } from '../utils/formatClockTime'
import type { WikiLeftover } from '../utils/isAcknowledgedWikiLeftover'

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

// Value: protects=the learner whose start this window's own stopped chat refuses with the candidate its watch saw: the sentence must name that chat, and the time a press goes on; fails_when=the sentence calls this window's own chat "an earlier chat or another editor window", or names the end of the candidate's wait only while the wait for the watch's chat lasts until the watch's end plus the bound, so a press at the named time is refused again, or names the watch's end although the candidate was written again after it; why_new=Cycle 0047 row 21 (P3M1 = P3OCR1-1: the time and the wording); seam=the clock and the listing of the candidates, handed over; no_claim=the sentence of a candidate the watch never saw
test('the refusal for a candidate this window’s stopped watch saw names this window’s own chat, not an earlier chat or another window, and the later end of the wait: the watch’s end plus the bound, or the candidate’s when it was written again after the watch’s end', async () => {
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
      reason: `The VS Code chat this window asked at ${clockTime(11, 58)} may still be updating this Wiki (candidate wiki.stage-1, written ${clockTime(12, 0)}); Codebook stopped watching it at ${clockTime(12, 5)} and waits for it until ${clockTime(12, 20)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
    assert.deepEqual(writtenAgainAfterIt, {
      named: [
        { kind: 'candidate', name: 'wiki.stage-1' },
        { kind: 'last-run', endedAtMs: at(12, 5) },
      ],
      reason: `The VS Code chat this window asked at ${clockTime(11, 58)} may still be updating this Wiki (candidate wiki.stage-1, written ${clockTime(12, 8)}); Codebook stopped watching it at ${clockTime(12, 5)} and waits for it until ${clockTime(12, 23)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
  } finally {
    await rm(wiki.parent, { recursive: true, force: true })
  }
})

// Value: protects=the one agent per Wiki and the way on when three chats may still publish: another window's stopped watch, a candidate this window's watch never saw, and this window's own stopped chat; fails_when=the refusals come in another order, one refusal names the leftovers of two chats, a press passes a leftover its refusal did not name, or a leftover is still refused after a press passed it; why_new=Cycle 0047 row 48 (P3dD4: covered through the flow tests only); seam=the clock, another window's marker and the listing of the candidates, handed over; no_claim=how the extension adds each press's leftovers to the earlier ones
test('the leftovers in the way of a start are refused one chat at a time, another window’s stopped watch first, then a candidate this window’s watch never saw, then this window’s own stopped chat, and each Update anyway passes only what its refusal named', async () => {
  // Arrange: another window stopped watching its chat at 11:55; this window stopped its watch at 12:00 before its chat staged anything; a candidate was written at 12:01. It is 12:02.
  const wiki = await makeUnpublishedWiki()
  const reservation: WikiLeftover = {
    kind: 'reservation',
    windowId: '3f6c2a1e',
    startedAtMs: at(11, 50),
  }
  const candidate: WikiLeftover = { kind: 'candidate', name: 'wiki.stage-2' }
  const ownRun: WikiLeftover = { kind: 'last-run', endedAtMs: at(12, 0) }
  // The same Wiki at each press; only what Update anyway passed so far differs.
  const lookWith = (
    acknowledged: readonly WikiLeftover[],
  ): Parameters<typeof findUnacknowledgedWikiLeftover>[1] => ({
    nowMs: at(12, 2),
    watchTimeoutMs: WATCH_TIMEOUT_MS,
    otherWindow: {
      pid: 4242,
      windowId: '3f6c2a1e',
      host: 'vscode',
      startedAtMs: at(11, 50),
      watchEndedAtMs: at(11, 55),
    },
    lastRun: {
      outputDirectory: wiki.outputDirectory,
      startedAtMs: at(11, 58),
      endedAtMs: at(12, 0),
      mayAgentStillWork: true,
      candidateNames: [],
    },
    acknowledged,
    listCandidates: () =>
      Promise.resolve([
        { name: 'wiki.stage-2', writtenAtMs: at(12, 1), ownedPaths: [] },
      ]),
  })
  try {
    // Act: an ordinary press, then Update anyway on each refusal, each press adding what its refusal named.
    const atTheFirstPress = await findUnacknowledgedWikiLeftover(
      wiki.outputDirectory,
      lookWith([]),
    )
    const afterTheFirstUpdateAnyway = await findUnacknowledgedWikiLeftover(
      wiki.outputDirectory,
      lookWith([reservation]),
    )
    const afterTheSecondUpdateAnyway = await findUnacknowledgedWikiLeftover(
      wiki.outputDirectory,
      lookWith([reservation, candidate]),
    )
    const afterTheThirdUpdateAnyway = await findUnacknowledgedWikiLeftover(
      wiki.outputDirectory,
      lookWith([reservation, candidate, ownRun]),
    )

    // Assert
    assert.deepEqual(atTheFirstPress, {
      named: [
        { kind: 'reservation', windowId: '3f6c2a1e', startedAtMs: at(11, 50) },
      ],
      reason: `The VS Code chat another editor window asked at ${clockTime(11, 50)} may still be updating this Wiki; that window stopped watching it at ${clockTime(11, 55)} and Codebook waits for it until ${clockTime(12, 10)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
    assert.deepEqual(afterTheFirstUpdateAnyway, {
      named: [{ kind: 'candidate', name: 'wiki.stage-2' }],
      reason: `An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-2, written ${clockTime(12, 1)}). Codebook waits for it until ${clockTime(12, 16)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
    assert.deepEqual(afterTheSecondUpdateAnyway, {
      named: [{ kind: 'last-run', endedAtMs: at(12, 0) }],
      reason: `The VS Code chat this window asked at ${clockTime(11, 58)} may still be updating this Wiki; Codebook stopped watching it at ${clockTime(12, 0)} and waits for it until ${clockTime(12, 15)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
    assert.equal(afterTheThirdUpdateAnyway, undefined)
  } finally {
    await rm(wiki.parent, { recursive: true, force: true })
  }
})

// Value: protects=the one agent per Wiki when a refusal names this window's stopped chat with a candidate its watch saw; fails_when=such a refusal is passed as soon as one of its leftovers was passed (every leftover unpassed is asked for, instead of any), so Update anyway pressed for that chat with another of its candidates starts beside the candidate that chat wrote since; why_new=Cycle 0047 row 48 (P3dD4), the unit side of row 11 (P3SM3); seam=the clock and the listing of the candidates, handed over; no_claim=which chat wrote the candidate again
test('a refusal that names this window’s stopped chat with a candidate its watch saw is not passed by an Update anyway that passed the same chat with another candidate its watch saw', async () => {
  // Arrange: the watch saw wiki.stage-1 and wiki.stage-2 and stopped at 12:05; Update anyway was pressed on the refusal that named wiki.stage-2, after wiki.stage-1 was written again at 12:08. It is 12:09.
  const wiki = await makeUnpublishedWiki()
  try {
    // Act
    const refusal = await findUnacknowledgedWikiLeftover(wiki.outputDirectory, {
      nowMs: at(12, 9),
      watchTimeoutMs: WATCH_TIMEOUT_MS,
      otherWindow: undefined,
      lastRun: {
        outputDirectory: wiki.outputDirectory,
        startedAtMs: at(11, 58),
        endedAtMs: at(12, 5),
        mayAgentStillWork: true,
        candidateNames: ['wiki.stage-1', 'wiki.stage-2'],
      },
      acknowledged: [
        { kind: 'candidate', name: 'wiki.stage-2' },
        { kind: 'last-run', endedAtMs: at(12, 5) },
      ],
      listCandidates: () =>
        Promise.resolve([
          { name: 'wiki.stage-1', writtenAtMs: at(12, 8), ownedPaths: [] },
          { name: 'wiki.stage-2', writtenAtMs: at(12, 2), ownedPaths: [] },
        ]),
    })

    // Assert
    assert.deepEqual(refusal, {
      named: [
        { kind: 'candidate', name: 'wiki.stage-1' },
        { kind: 'last-run', endedAtMs: at(12, 5) },
      ],
      reason: `The VS Code chat this window asked at ${clockTime(11, 58)} may still be updating this Wiki (candidate wiki.stage-1, written ${clockTime(12, 8)}); Codebook stopped watching it at ${clockTime(12, 5)} and waits for it until ${clockTime(12, 23)}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
    })
  } finally {
    await rm(wiki.parent, { recursive: true, force: true })
  }
})

// Value: protects=the learner's Update press once no earlier chat can publish any more; fails_when=another window's stopped watch is still waited for after its bound, a candidate older than the bound still refuses the start, or this window's run whose chat has stopped is waited for; why_new=Cycle 0047 row 48 (P3dD4); seam=the clock, another window's marker and the listing of the candidates, handed over; no_claim=the end of a wait by a publish, which the tests of hasWikiPublishEndedWait hold
test('nothing refuses a start once another window’s stopped watch is past its bound, the only candidate is older than the bound, and this window’s last run has no chat that may still work', async () => {
  // Arrange: another window stopped watching at 11:40 (its wait ended 11:55); the candidate was written at 11:30; this window's last run ended with its chat. It is 12:00.
  const wiki = await makeUnpublishedWiki()
  try {
    // Act
    const refusal = await findUnacknowledgedWikiLeftover(wiki.outputDirectory, {
      nowMs: at(12, 0),
      watchTimeoutMs: WATCH_TIMEOUT_MS,
      otherWindow: {
        pid: 4242,
        windowId: '3f6c2a1e',
        host: 'vscode',
        startedAtMs: at(11, 35),
        watchEndedAtMs: at(11, 40),
      },
      lastRun: {
        outputDirectory: wiki.outputDirectory,
        startedAtMs: at(11, 50),
        endedAtMs: at(11, 55),
        mayAgentStillWork: false,
        candidateNames: [],
      },
      acknowledged: [],
      listCandidates: () =>
        Promise.resolve([
          { name: 'wiki.stage-1', writtenAtMs: at(11, 30), ownedPaths: [] },
        ]),
    })

    // Assert
    assert.equal(refusal, undefined)
  } finally {
    await rm(wiki.parent, { recursive: true, force: true })
  }
})
