import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { hasWikiPublishEndedWait } from '../utils/hasWikiPublishEndedWait'

/** When the watch of the tests ended: 2026-10-03 12:00:00 UTC. */
const WATCH_ENDED_AT_MS = Date.UTC(2026, 9, 3, 12, 0, 0)

/** Makes a Wiki folder whose manifest was written at the given time, so that time is when the site was published; `undefined` leaves the folder without a manifest. */
async function makeWikiPublishedAt(
  publishedAtMs: number | undefined,
): Promise<{ parent: string; outputDirectory: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'codebook-wiki-wait-'))
  const outputDirectory = join(parent, 'wiki')
  await mkdir(outputDirectory)
  if (publishedAtMs !== undefined) {
    const manifestPath = join(outputDirectory, 'codebook-wiki.json')
    await writeFile(manifestPath, '{}')
    await utimes(manifestPath, new Date(publishedAtMs), new Date(publishedAtMs))
  }
  return { parent, outputDirectory }
}

// Value: protects=a learner who presses Update LLM Wiki after the chat of a stopped watch has published: Codebook must not say that this chat may still be updating the Wiki; fails_when=a site published after the watch's end no longer ends the wait, so the press is refused until the watch bound, or a site from before the watch's end, or no site at all, ends it, so a second agent starts beside a chat that still works; why_new=Cycle 0046 row 335 (native run: watch ended 18:09, chat published 18:11, press at 18:23 refused until 18:24); seam=none
test('the wait for the chat of a stopped watch is over when a site was published after the watch’s end, and not for a site published two minutes before it, at its very end, or for a folder without a manifest', async () => {
  // Arrange
  const twoMinutesAfter = await makeWikiPublishedAt(
    Date.UTC(2026, 9, 3, 12, 2, 0),
  )
  const twoMinutesBefore = await makeWikiPublishedAt(
    Date.UTC(2026, 9, 3, 11, 58, 0),
  )
  const atTheEnd = await makeWikiPublishedAt(Date.UTC(2026, 9, 3, 12, 0, 0))
  const withoutManifest = await makeWikiPublishedAt(undefined)
  const awaited = { watchEndedAtMs: WATCH_ENDED_AT_MS, candidateNames: [] }
  try {
    // Act
    const answers = [
      await hasWikiPublishEndedWait(twoMinutesAfter.outputDirectory, awaited),
      await hasWikiPublishEndedWait(twoMinutesBefore.outputDirectory, awaited),
      await hasWikiPublishEndedWait(atTheEnd.outputDirectory, awaited),
      await hasWikiPublishEndedWait(withoutManifest.outputDirectory, awaited),
    ]

    // Assert
    assert.deepEqual(answers, [true, false, false, false])
  } finally {
    for (const wiki of [
      twoMinutesAfter,
      twoMinutesBefore,
      atTheEnd,
      withoutManifest,
    ])
      await rm(wiki.parent, { recursive: true, force: true })
  }
})

// Value: protects=the chat whose candidate the watch saw and which has not published it: a publish of somebody else must not end the wait for it; fails_when=any publish after the watch's end counts as the watched chat's own although the candidate the watch saw is still beside the Wiki, or the candidate's folder is not looked for where it lies, beside the Wiki; why_new=Cycle 0046 row 335 (the rule the row decided: the candidate the watch saw is gone and the site was published after the watch ended); seam=none
test('a site published after the watch’s end does not end the wait while a candidate the watch saw is still beside the Wiki, and ends it once that folder is gone', async () => {
  // Arrange: the watch saw the candidate wiki.stage-3f6c; a site was published two minutes after the watch's end.
  const wiki = await makeWikiPublishedAt(Date.UTC(2026, 9, 3, 12, 2, 0))
  const candidateFolder = join(wiki.parent, 'wiki.stage-3f6c')
  await mkdir(candidateFolder)
  const awaited = {
    watchEndedAtMs: WATCH_ENDED_AT_MS,
    candidateNames: ['wiki.stage-3f6c'],
  }
  try {
    // Act: once with the candidate still there, once after the publisher moved it away.
    const whileCandidateIsThere = await hasWikiPublishEndedWait(
      wiki.outputDirectory,
      awaited,
    )
    await rm(candidateFolder, { recursive: true })
    const afterCandidateIsGone = await hasWikiPublishEndedWait(
      wiki.outputDirectory,
      awaited,
    )

    // Assert
    assert.deepEqual(
      [whileCandidateIsThere, afterCandidateIsGone],
      [false, true],
    )
  } finally {
    await rm(wiki.parent, { recursive: true, force: true })
  }
})
