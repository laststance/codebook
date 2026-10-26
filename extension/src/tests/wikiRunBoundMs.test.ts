import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LONGEST_WIKI_RUN_MS } from '../constants'
import { longestWikiRunMs } from '../utils/longestWikiRunMs'
import { wikiRunBoundMs } from '../utils/wikiRunBoundMs'

// Value: protects=Eng decision 74, every place that reads a run's bound; fails_when=a generation gets an update's 15 minutes in either host, an update's bounds change, or a marker of an earlier version (no kind) is read with a generation's bound; no_claim=where each place reads it (marker, leftover and host tests); seam=none
test('a generation is bounded at 55 minutes in both hosts, while an update keeps 15 minutes in each and a run without a kind is an update', () => {
  // Act
  const bounds = {
    generateInVsCode: wikiRunBoundMs('generate', 'vscode'),
    generateInCursor: wikiRunBoundMs('generate', 'cursor'),
    updateInVsCode: wikiRunBoundMs('update', 'vscode'),
    updateInCursor: wikiRunBoundMs('update', 'cursor'),
    earlierVersionInCursor: wikiRunBoundMs(undefined, 'cursor'),
  }

  // Assert
  assert.deepEqual(bounds, {
    generateInVsCode: 3_300_000,
    generateInCursor: 3_300_000,
    updateInVsCode: 900_000,
    updateInCursor: 900_000,
    earlierVersionInCursor: 900_000,
  })
})

// Value: protects=a host test that shortens the extension's own bounds; fails_when=the bounds the caller passes are ignored; no_claim=the default bounds (test above); seam=none
test('a run’s bound follows the bounds its caller passes', () => {
  // Act
  const bound = wikiRunBoundMs('update', 'cursor', {
    generateMs: 3,
    cursorUpdateMs: 2,
    watchedUpdateMs: 1,
  })

  // Assert
  assert.equal(bound, 2)
})

// Value: protects=the expiry of a marker and of an unreadable marker file; fails_when=a VS Code run's marker leaves out the chat's 30 second opening, or an unreadable marker file counts no longer than an update; no_claim=the grace and the clock tolerance added on top (readLiveWikiUpdateMarker tests); seam=none
test('the longest a run lasts adds the chat’s 30 second opening in VS Code, and an unreadable marker counts for a VS Code generation’s 55 minutes 30 seconds', () => {
  // Act
  const longest = {
    vsCodeGenerate: longestWikiRunMs('generate', 'vscode'),
    cursorGenerate: longestWikiRunMs('generate', 'cursor'),
    vsCodeUpdate: longestWikiRunMs('update', 'vscode'),
    anyRun: LONGEST_WIKI_RUN_MS,
  }

  // Assert
  assert.deepEqual(longest, {
    vsCodeGenerate: 3_330_000,
    cursorGenerate: 3_300_000,
    vsCodeUpdate: 930_000,
    anyRun: 3_330_000,
  })
})

// Value: protects=Cycle 0056 pass 1 M4, the constant an unreadable marker file counts for; fails_when=LONGEST_WIKI_RUN_MS differs from the longest run over every kind and host (a bound or the chat's opening changed and the hand-listed constant did not); no_claim=where the constant is read (readLiveWikiUpdateMarker tests); seam=none
test('the longest run any marker can stand for equals the longest of every kind and host', () => {
  // Act
  const longestOfEveryRun = Math.max(
    longestWikiRunMs('generate', 'vscode'),
    longestWikiRunMs('generate', 'cursor'),
    longestWikiRunMs('update', 'vscode'),
    longestWikiRunMs('update', 'cursor'),
    longestWikiRunMs(undefined, 'vscode'),
    longestWikiRunMs(undefined, 'cursor'),
  )

  // Assert
  assert.equal(LONGEST_WIKI_RUN_MS, longestOfEveryRun)
  assert.equal(LONGEST_WIKI_RUN_MS, 3_330_000)
})
