import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { WikiUpdateMarkerLook } from '../utils/readLiveWikiUpdateMarker'
import {
  readLlmWikiViewFacts,
  type LlmWikiViewFactsDependencies,
} from '../utils/readLlmWikiViewFacts'

const NOW_MS = 1_790_000_000_000
const GENERATE_BOUND_MS = 3_300_000

/** Dependencies for a project with a published Wiki and nothing else; a test overrides what it examines. */
function dependencies(
  overrides: Partial<LlmWikiViewFactsDependencies> = {},
): LlmWikiViewFactsDependencies {
  return {
    host: 'vscode',
    isFolderOpen: () => true,
    isTrusted: () => true,
    wikiLocation: async () => ({
      projectRoot: '/repo',
      outputDirectory: '/repo/.codebook/wiki',
    }),
    readPublishToken: async () => 'token',
    readPublication: async () => 'receipt@1',
    findStartBlock: async () => undefined,
    readGeneration: async () => ({ revision: undefined, publishedAtMs: 1 }),
    isWikiOwnedBy: async () => true,
    readMarker: async () => ({ kind: 'none' }),
    ownWindowId: 'this-window',
    isStartUnderWay: () => false,
    hasPublishEndedWait: async () => false,
    runStatus: () => ({ state: 'idle' }),
    isAwaitingChat: () => false,
    lastAgentExit: () => undefined,
    now: () => NOW_MS,
    ...overrides,
  }
}

/** A reservation a stopped VS Code watch left, whose watch ended `endedAgoMs` ago. */
function reservationLook(endedAgoMs: number): WikiUpdateMarkerLook {
  return {
    kind: 'live',
    heldBy: {
      pid: 1,
      windowId: 'spoof',
      host: 'vscode',
      startedAtMs: NOW_MS - endedAgoMs - 60_000,
      watchEndedAtMs: NOW_MS - endedAgoMs,
      runKind: 'generate',
    },
  }
}

// Value: protects=Generate and Update staying available after a reservation ran out (item 12); fails_when=a reservation whose deadline has passed, kept alive by a live owner process, still reads as Waiting for chat; no_claim=the start check's own refusal; seam=the facts reader with a marker look and a fixed clock
test('a reservation past its deadline yields no reservation fact, one inside its window does', async () => {
  // Arrange
  const readMarkerFor = (endedAgoMs: number) =>
    dependencies({ readMarker: async () => reservationLook(endedAgoMs) })

  // Act
  const expired = await readLlmWikiViewFacts(
    readMarkerFor(GENERATE_BOUND_MS + 1),
  )
  const atDeadline = await readLlmWikiViewFacts(
    readMarkerFor(GENERATE_BOUND_MS),
  )
  const inside = await readLlmWikiViewFacts(readMarkerFor(60_000))

  // Assert
  assert.deepEqual(
    [expired, atDeadline, inside].map((facts) =>
      facts.kind === 'ready' ? facts.reservation?.retryAtMs : 'not ready',
    ),
    [undefined, undefined, NOW_MS - 60_000 + GENERATE_BOUND_MS],
  )
})

// Value: protects=the pairing of the receipt with the manifest it names (item 27); fails_when=a publication that lands between the two reads pairs the old manifest with the new receipt, so the view shows the old Wiki under the new receipt; no_claim=which of the two the next refresh shows; seam=a world that changes right after the first of the two reads
test('a publication landing between the receipt read and the manifest read pairs the older receipt with the newer manifest, never the reverse', async () => {
  // Arrange
  let world: 'before' | 'after' = 'before'
  const readOnceThenPublish = async <Value>(
    values: Record<typeof world, Value>,
  ): Promise<Value> => {
    const value = values[world]
    // The publication lands right after whichever of the two reads comes first.
    world = 'after'
    return value
  }
  const facts = await readLlmWikiViewFacts(
    dependencies({
      readPublication: () =>
        readOnceThenPublish({ before: 'receipt-old', after: 'receipt-new' }),
      readGeneration: () =>
        readOnceThenPublish({
          before: { revision: undefined, publishedAtMs: 111 },
          after: { revision: undefined, publishedAtMs: 222 },
        }),
    }),
  )

  // Act
  const pairing =
    facts.kind === 'ready'
      ? [facts.publication, facts.wiki?.generation.publishedAtMs]
      : []

  // Assert
  assert.deepEqual(pairing, ['receipt-old', 222])
})

// Value: protects=the attention cause for a manifest whose token cannot be read (item 13); fails_when=a token read that rejects no longer counts as a manifest standing there, so the unreadable manifest shows no row; no_claim=the wording of the cause; seam=a rejected token read
test('a publish token that cannot be read still shows the unreadable-manifest cause', async () => {
  // Arrange
  const unreadable = dependencies({
    readPublishToken: async () => {
      throw new Error('EACCES')
    },
    readGeneration: async () => {
      throw new Error('not a Wiki of this project')
    },
    isWikiOwnedBy: async () => {
      throw new Error('EACCES')
    },
  })

  // Act
  const facts = await readLlmWikiViewFacts(unreadable)

  // Assert
  assert.equal(
    facts.kind === 'ready' ? facts.attention?.cause : 'not ready',
    'unreadable-manifest',
  )
})

// Value: protects=the project the freshness check inspects (item 4); fails_when=the facts omit the project root, so the check must ask the setting again; no_claim=the check itself; seam=the facts reader
test('the ready facts name the project root next to the output folder', async () => {
  // Arrange
  const reader = dependencies()

  // Act
  const facts = await readLlmWikiViewFacts(reader)

  // Assert
  assert.deepEqual(
    facts.kind === 'ready' ? [facts.projectRoot, facts.outputDirectory] : [],
    ['/repo', '/repo/.codebook/wiki'],
  )
})
