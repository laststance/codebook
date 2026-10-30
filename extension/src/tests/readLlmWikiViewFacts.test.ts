import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { WikiUpdateMarkerLook } from '../utils/readLiveWikiUpdateMarker'
import {
  readLlmWikiViewFacts,
  type LlmWikiViewFactsDependencies,
} from '../utils/readLlmWikiViewFacts'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import { defer } from './utils/defer'

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
    isMarkerChangePending: () => false,
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

// Value: protects=the speed of a refresh and the receipt-before-manifest order (item 25 of #132, item 27); fails_when=the start block, the publish token and the marker are read one after another instead of together, or any of them starts before the receipt has been read; no_claim=how long a real disk read takes; seam=reads held open until all three have started
test('the receipt is read first, then the start block, the token and the marker start together', async () => {
  // Arrange
  const started: string[] = []
  const settleReceipt = defer<string>()
  const settleBlock = defer<undefined>()
  const settleToken = defer<string>()
  const settleMarker = defer<WikiUpdateMarkerLook>()
  const read = readLlmWikiViewFacts(
    dependencies({
      readPublication: () => {
        started.push('receipt')
        return settleReceipt.promise
      },
      findStartBlock: () => {
        started.push('start-block')
        return settleBlock.promise
      },
      readPublishToken: () => {
        started.push('token')
        return settleToken.promise
      },
      readMarker: () => {
        started.push('marker')
        return settleMarker.promise
      },
    }),
  )
  await waitUntil(() => started.length >= 1, 'the receipt read', 2_000)
  const startedBeforeTheReceipt = [...started]

  // Act
  settleReceipt.resolve('receipt@1')
  const didAllStart = await waitUntil(
    () => started.length >= 4,
    'the three independent reads to start together',
    2_000,
  ).then(
    () => true,
    () => false,
  )
  const startedWhileAllAreHeld = [...started]
  settleBlock.resolve(undefined)
  settleToken.resolve('token')
  settleMarker.resolve({ kind: 'none' })
  const facts = await read

  // Assert
  assert.deepEqual(
    [
      startedBeforeTheReceipt,
      didAllStart,
      startedWhileAllAreHeld,
      facts.kind === 'ready' ? facts.publication : 'not ready',
    ],
    [
      ['receipt'],
      true,
      ['receipt', 'start-block', 'token', 'marker'],
      'receipt@1',
    ],
  )
})

// protects=task 13 and ship review passes 1 and 2: this window's own live marker reads as settling exactly while this window's change of that marker (its removal, or its turn into a reservation) is still pending, retries included, so the view keeps its message for that time and never for a marker left standing; fails_when=a running run's own marker, or one whose change was made or given up, reads as settling, or one whose change is pending (also more than 10 s after the run's end) does not; why_new=the read loop covers the model message only; seam=none; no_claim=the file work that changes the marker
test('this window’s own live marker is settling exactly while its marker change is pending, and another window’s marker is elsewhere', async () => {
  // Arrange
  const ownLive = (windowId: string): WikiUpdateMarkerLook => ({
    kind: 'live',
    heldBy: {
      pid: 1,
      windowId,
      host: 'vscode',
      startedAtMs: NOW_MS - 60_000,
      runKind: 'update',
    },
  })
  const endedAgo = (agoMs: number): WikiUpdateStatus => ({
    state: 'cancelled',
    site: 'kept',
    host: 'vscode',
    finishedAt: new Date(NOW_MS - agoMs).toISOString(),
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  const running: WikiUpdateStatus = {
    state: 'running',
    host: 'vscode',
    startedAt: new Date(NOW_MS - 60_000).toISOString(),
    timeoutMs: 1_800_000,
    candidateStaged: false,
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }
  const pendingFor: string[] = []
  const read = (
    windowId: string,
    status: WikiUpdateStatus,
    isChangePending: boolean,
  ) =>
    readLlmWikiViewFacts(
      dependencies({
        readMarker: async () => ownLive(windowId),
        runStatus: () => status,
        isMarkerChangePending: (outputDirectory) => {
          pendingFor.push(outputDirectory)
          return isChangePending
        },
      }),
    )

  // Act
  const justEnded = await read('this-window', endedAgo(1_000), true)
  const retrying = await read('this-window', endedAgo(60_000), true)
  const givenUp = await read('this-window', endedAgo(130_000), false)
  const stillRunning = await read('this-window', running, true)
  const otherWindow = await read('other-window', endedAgo(1_000), true)

  // Assert
  assert.deepEqual(
    [justEnded, retrying, givenUp, stillRunning, otherWindow].map((facts) =>
      facts.kind === 'ready'
        ? {
            isMarkerSettling: facts.isMarkerSettling,
            elsewhere: facts.elsewhere?.kind,
          }
        : 'not ready',
    ),
    [
      { isMarkerSettling: true, elsewhere: undefined },
      { isMarkerSettling: true, elsewhere: undefined },
      { isMarkerSettling: undefined, elsewhere: undefined },
      { isMarkerSettling: undefined, elsewhere: undefined },
      { isMarkerSettling: undefined, elsewhere: 'update' },
    ],
  )
  assert.deepEqual(new Set(pendingFor), new Set(['/repo/.codebook/wiki']))
})

// protects=task 13 (ship Codex adversarial review): a run that ends while the facts are read (after the marker was read, before the manifest read finished) is seen as ended by the run facts and the marker's settle alike, so the view keeps its message instead of showing none; fails_when=the settle is judged from the run state at the marker read while the run facts come from a later moment, so the facts hold neither a run, a reservation nor a settling marker; why_new=the other settle test changes the run state before the read starts; seam=none; no_claim=the view's message (the read loop tests)
test('a run that ends during the read is seen as ended by the run facts and the marker settle together', async () => {
  // Arrange
  const markerRead = defer<void>()
  const manifestRead = defer<void>()
  let status: WikiUpdateStatus = {
    state: 'running',
    host: 'vscode',
    startedAt: new Date(NOW_MS - 60_000).toISOString(),
    timeoutMs: 1_800_000,
    candidateStaged: false,
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }
  let isChangePending = false
  const reading = readLlmWikiViewFacts(
    dependencies({
      readMarker: async () => {
        markerRead.resolve()
        return {
          kind: 'live',
          heldBy: {
            pid: 1,
            windowId: 'this-window',
            host: 'vscode',
            startedAtMs: NOW_MS - 60_000,
            runKind: 'update',
          },
        }
      },
      readGeneration: async () => {
        await manifestRead.promise
        return { revision: undefined, publishedAtMs: 1 }
      },
      runStatus: () => status,
      isMarkerChangePending: () => isChangePending,
    }),
  )
  await markerRead.promise
  await new Promise((resolve) => setImmediate(resolve))

  // Act
  status = {
    state: 'cancelled',
    site: 'kept',
    host: 'vscode',
    finishedAt: new Date(NOW_MS).toISOString(),
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }
  isChangePending = true
  manifestRead.resolve()
  const facts = await reading

  // Assert
  assert.deepEqual(
    facts.kind === 'ready'
      ? {
          isRunShown: facts.run !== undefined,
          isMarkerSettling: facts.isMarkerSettling,
        }
      : 'not ready',
    { isRunShown: false, isMarkerSettling: true },
  )
})

// protects=task 13 (local CodeRabbit CLI on the final range): this window's live marker read while its run was running is seen as settling when the run has ended by the end of the read, even if the marker change finished meanwhile, so the view keeps its message until the read that the run's end asks for; fails_when=a marker read during the run is judged by the change's state at the end of the read, so a change that finished during the read leaves facts with no run, no reservation and no settling marker; why_new=the other settle tests change the run before the marker read or keep the change pending; seam=none; no_claim=the view's re-read after the run's end
test('a marker read while the run ran is settling when the run and its marker change both ended during the read', async () => {
  // Arrange
  const markerRead = defer<void>()
  const manifestRead = defer<void>()
  let status: WikiUpdateStatus = {
    state: 'running',
    host: 'vscode',
    startedAt: new Date(NOW_MS - 60_000).toISOString(),
    timeoutMs: 1_800_000,
    candidateStaged: false,
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }
  const reading = readLlmWikiViewFacts(
    dependencies({
      readMarker: async () => {
        markerRead.resolve()
        return {
          kind: 'live',
          heldBy: {
            pid: 1,
            windowId: 'this-window',
            host: 'vscode',
            startedAtMs: NOW_MS - 60_000,
            runKind: 'update',
          },
        }
      },
      readGeneration: async () => {
        await manifestRead.promise
        return { revision: undefined, publishedAtMs: 1 }
      },
      runStatus: () => status,
      isMarkerChangePending: () => false,
    }),
  )
  await markerRead.promise
  await new Promise((resolve) => setImmediate(resolve))

  // Act
  // The run ended and its marker change finished before the manifest read did.
  status = {
    state: 'cancelled',
    site: 'kept',
    host: 'vscode',
    finishedAt: new Date(NOW_MS).toISOString(),
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }
  manifestRead.resolve()
  const facts = await reading

  // Assert
  assert.deepEqual(
    facts.kind === 'ready'
      ? {
          isRunShown: facts.run !== undefined,
          isMarkerSettling: facts.isMarkerSettling,
        }
      : 'not ready',
    { isRunShown: false, isMarkerSettling: true },
  )
})

// protects=task 9 (the flaky message test): a marker read while this window's marker change was pending is seen as settling when the change was made during the read, so the view keeps the watching message instead of showing none between the watching and the stopped-watch message; fails_when=the settle is judged only by the change's state at the end of the read, so a slow marker read that holds the marker as it was before the change leaves facts with no run, no reservation and no settling marker; why_new=the other settle tests read the marker while the run ran or keep the change pending to the end; seam=none; no_claim=the view's re-read after the change (the read loop tests)
test('a marker read while its change was pending is settling when the change was made during the read', async () => {
  // Arrange
  let isChangePending = true
  const endedStatus: WikiUpdateStatus = {
    state: 'cancelled',
    site: 'kept',
    host: 'vscode',
    finishedAt: new Date(NOW_MS).toISOString(),
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }

  // Act
  const facts = await readLlmWikiViewFacts(
    dependencies({
      readMarker: async () => {
        // The file is read as the run left it; the change is made before the read returns.
        await new Promise((resolve) => setImmediate(resolve))
        isChangePending = false
        return {
          kind: 'live',
          heldBy: {
            pid: 1,
            windowId: 'this-window',
            host: 'vscode',
            startedAtMs: NOW_MS - 60_000,
            runKind: 'update',
          },
        }
      },
      runStatus: () => endedStatus,
      isMarkerChangePending: () => isChangePending,
    }),
  )

  // Assert
  assert.deepEqual(
    facts.kind === 'ready'
      ? {
          isRunShown: facts.run !== undefined,
          isMarkerSettling: facts.isMarkerSettling,
        }
      : 'not ready',
    { isRunShown: false, isMarkerSettling: true },
  )
})
