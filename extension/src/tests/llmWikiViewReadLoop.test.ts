import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  createLlmWikiView,
  type LlmWikiView,
  type LlmWikiViewOptions,
} from '../utils/llmWikiView'
import type {
  LlmWikiFreshness,
  LlmWikiViewFacts,
} from '../utils/readLlmWikiViewState'

import { defer } from './utils/defer'
import { createFakeLlmWikiEditor } from './utils/fakeLlmWikiEditor'

type ReadyFacts = Extract<LlmWikiViewFacts, { kind: 'ready' }>

const WATCHED_PROJECT = '/project'
const WATCHED_OUTPUT = '/project/.codebook/wiki'

/** Ready facts for a project with no Wiki; a test adds what it examines. */
function readyFacts(overrides: Partial<ReadyFacts> = {}): ReadyFacts {
  return {
    kind: 'ready',
    host: 'vscode',
    projectRoot: WATCHED_PROJECT,
    repositoryName: 'project',
    outputLabel: '.codebook/wiki',
    outputDirectory: WATCHED_OUTPUT,
    nowMs: 0,
    ...overrides,
  }
}

const publishedWiki: ReadyFacts['wiki'] = {
  freshness: { status: 'checking' },
  generation: { publishedAtMs: 1_000 },
}

/** Opens the view on stand-ins that count their calls; a test overrides the closure it examines. */
function openView(
  context: TestContext,
  overrides: Partial<LlmWikiViewOptions> = {},
  fakeOptions: Parameters<typeof createFakeLlmWikiEditor>[0] = {},
) {
  const fake = createFakeLlmWikiEditor(fakeOptions)
  const recordedFailures: string[] = []
  const recordedCauses: unknown[] = []
  const tellings: string[] = []
  const view = createLlmWikiView({
    editor: fake.editor,
    host: 'vscode',
    readFacts: async () => readyFacts({ wiki: publishedWiki }),
    readFreshness: async () => ({ status: 'current' }),
    findWatchedFolder: async () => WATCHED_PROJECT,
    onRunChange: () => (): void => {},
    tellPublished: (label): void => {
      tellings.push(label)
    },
    recordFailure: (message, cause) => {
      recordedFailures.push(message)
      recordedCauses.push(cause)
    },
    debounceMs: 20,
    pollMs: 50,
    ...overrides,
  })
  context.after(() => view.dispose())
  return { fake, view, recordedFailures, recordedCauses, tellings }
}

const idsOf = (fake: ReturnType<typeof createFakeLlmWikiEditor>): string[] =>
  fake.rows().map((row) => row.id)
const rowOf = (fake: ReturnType<typeof createFakeLlmWikiEditor>, id: string) =>
  fake.rows().find((row) => row.id === id)

/** Lets the event loop run so a rejection that nobody handles would surface. */
const afterEventLoopTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

/** Collects the rejections nobody handled while a test runs. */
function collectUnhandledRejections(context: TestContext): unknown[] {
  const unhandled: unknown[] = []
  const listener = (cause: unknown): void => {
    unhandled.push(cause)
  }
  process.on('unhandledRejection', listener)
  context.after(() => process.off('unhandledRejection', listener))
  return unhandled
}

const ERROR_ROW_LABEL = 'Could not read the LLM Wiki state'

// Value: protects=item 1, the error row for a failure after the facts were read; fails_when=a findWatchedFolder that rejects leaves the old rows, shows no error row, records nothing, or becomes an unhandled rejection; no_claim=the cause's wording; seam=a rejecting findWatchedFolder
test('a watcher lookup that rejects shows the error row, records the failure once and leaves no unhandled rejection', async (context) => {
  // Arrange
  const unhandled = collectUnhandledRejections(context)
  const { fake, view, recordedFailures } = openView(context, {
    findWatchedFolder: async () => {
      throw new Error('stat failed')
    },
  })

  // Act
  await view.whenIdle()
  await afterEventLoopTurn()

  // Assert
  assert.deepEqual(
    [
      fake.rows().map((row) => row.label),
      recordedFailures,
      unhandled,
      fake.contextKeys['codebook.llmWiki.state'],
    ],
    [
      [ERROR_ROW_LABEL],
      ['The LLM Wiki view could not read its state'],
      [],
      'other',
    ],
  )
})

// Value: protects=item 1, the error row for a failure in the step that turns facts into rows; fails_when=facts that make the row step throw leave the old rows, show no error row or reject unhandled; no_claim=which fact is broken; seam=ready facts with a getter that throws
test('a failure while the rows are made shows the error row, records it once and the next good read recovers', async (context) => {
  // Arrange
  const unhandled = collectUnhandledRejections(context)
  let isBroken = true
  const { fake, view, recordedFailures } = openView(context, {
    readFacts: async () => {
      const facts = readyFacts({ wiki: publishedWiki })
      // The getter is added after the facts were made, so the read succeeds and the step that makes rows from the facts throws.
      if (isBroken)
        Object.defineProperty(facts, 'run', {
          enumerable: true,
          get(): never {
            throw new Error('row step failed')
          },
        })
      return facts
    },
  })
  await view.whenIdle()
  const whileBroken = fake.rows().map((row) => row.label)
  isBroken = false

  // Act
  await view.refresh()
  await afterEventLoopTurn()

  // Assert
  assert.deepEqual(
    [whileBroken, recordedFailures.length, unhandled, idsOf(fake)],
    [[ERROR_ROW_LABEL], 1, [], ['wiki', 'output']],
  )
})

// Value: protects=item 2, one freshness check at a time; fails_when=three refreshes during a check start three checks, whenIdle resolves while the re-run still runs, or the re-run is missing; no_claim=the check's answer; seam=a freshness read held open
test('three refreshes during a freshness check start one check and one re-run, and the view is idle only after the re-run', async (context) => {
  // Arrange
  const held = [defer<LlmWikiFreshness>(), defer<LlmWikiFreshness>()]
  let checkCount = 0
  const { fake, view } = openView(context, {
    readFreshness: () => held[checkCount++]?.promise ?? Promise.reject(),
  })
  await waitUntil(() => checkCount === 1, 'the first check', 6_000)

  // Act
  await view.refresh()
  await view.refresh()
  await view.refresh()
  const checksWhileHeld = checkCount
  let isIdle = false
  const idle = view.whenIdle().then(() => {
    isIdle = true
  })
  held[0]?.resolve({ status: 'changed' })
  await waitUntil(() => checkCount === 2, 'the re-run', 6_000)
  await afterEventLoopTurn()
  const isIdleDuringReRun = isIdle
  held[1]?.resolve({ status: 'current' })
  await idle

  // Assert
  assert.deepEqual(
    [
      checksWhileHeld,
      isIdleDuringReRun,
      checkCount,
      rowOf(fake, 'wiki')?.description,
    ],
    [1, false, 2, 'Wiki source current'],
  )
})

// Value: protects=item 2, no work after dispose; fails_when=a re-run starts after dispose, or the answer of a running check is still shown; no_claim=the watcher's disposal; seam=a freshness read held open across dispose
test('after dispose no freshness re-run starts and the running check’s answer is dropped', async (context) => {
  // Arrange
  const held = defer<LlmWikiFreshness>()
  let checkCount = 0
  const { fake, view } = openView(context, {
    readFreshness: () => {
      checkCount += 1
      return held.promise
    },
  })
  await waitUntil(() => checkCount === 1, 'the first check', 6_000)
  await view.refresh()
  const descriptionBefore = rowOf(fake, 'wiki')?.description

  // Act
  view.dispose()
  held.resolve({ status: 'changed' })
  await afterEventLoopTurn()
  await afterEventLoopTurn()

  // Assert
  assert.deepEqual(
    [checkCount, descriptionBefore, rowOf(fake, 'wiki')?.description],
    [1, 'Checking freshness…', 'Checking freshness…'],
  )
})

// Value: protects=item 2, a failed check is no answer; fails_when=a check that threw is cached as an answer, so the next read shows the unknown label as if it were known instead of Checking freshness… while it asks again; no_claim=the failure's wording; seam=a freshness read that rejects once and is then held
test('a failed freshness check shows the unknown label once, and the next refresh reads Checking freshness… while it checks again', async (context) => {
  // Arrange
  const heldSecondCheck = defer<LlmWikiFreshness>()
  let checkCount = 0
  const { fake, view } = openView(context, {
    readFreshness: () => {
      checkCount += 1
      return checkCount === 1
        ? Promise.reject(new Error('git failed'))
        : heldSecondCheck.promise
    },
  })
  await waitUntil(
    () =>
      rowOf(fake, 'wiki')?.description?.startsWith('Wiki freshness unknown'),
    'the unknown label',
    6_000,
  )
  const afterFailure = rowOf(fake, 'wiki')?.description

  // Act
  await view.refresh()
  const whileCheckingAgain = rowOf(fake, 'wiki')?.description
  heldSecondCheck.resolve({ status: 'current' })
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [
      afterFailure,
      whileCheckingAgain,
      checkCount,
      rowOf(fake, 'wiki')?.description,
    ],
    [
      'Wiki freshness unknown: The freshness check failed.',
      'Checking freshness…',
      2,
      'Wiki source current',
    ],
  )
})

// Value: protects=items 2 and 4, the freshness check inspects the folder the facts name and its answer is shown for that folder only; fails_when=the check asks the setting again, or the answer of the earlier folder is shown after the rows moved to another folder; no_claim=the Git work of the check; seam=two folders and a freshness read held open
test('a freshness check inspects the folder of the facts it was asked for and its answer is not shown for another folder', async (context) => {
  // Arrange
  const heldForFirstFolder = defer<LlmWikiFreshness>()
  const requestedLocations: Array<{
    projectRoot: string
    outputDirectory: string
  }> = []
  let outputDirectory = WATCHED_OUTPUT
  const { fake, view } = openView(context, {
    readFacts: async () =>
      readyFacts({
        outputDirectory,
        publication: outputDirectory,
        wiki: publishedWiki,
      }),
    readFreshness: (location) => {
      requestedLocations.push(location)
      return requestedLocations.length === 1
        ? heldForFirstFolder.promise
        : Promise.resolve({ status: 'current' })
    },
    findWatchedFolder: async () => WATCHED_PROJECT,
  })
  await waitUntil(
    () => requestedLocations.length === 1,
    'the first check',
    6_000,
  )

  // Act
  outputDirectory = '/project/docs/wiki'
  await view.refresh()
  heldForFirstFolder.resolve({ status: 'changed' })
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [requestedLocations, rowOf(fake, 'wiki')?.description],
    [
      [
        { projectRoot: WATCHED_PROJECT, outputDirectory: WATCHED_OUTPUT },
        { projectRoot: WATCHED_PROJECT, outputDirectory: '/project/docs/wiki' },
      ],
      'Wiki source current',
    ],
  )
})

// Value: protects=item 3, a publication between the first read and the watcher's registration; fails_when=a Wiki published while the watcher lookup is held is in neither the first read nor an event, so the row never appears; no_claim=the editor's own event delivery; seam=a held findWatchedFolder
test('a Wiki published while the watcher is being made shows without any further trigger', async (context) => {
  // Arrange
  const heldLookup = defer<string>()
  let isPublished = false
  let readCount = 0
  const { fake, view } = openView(context, {
    readFacts: async () => {
      readCount += 1
      return readyFacts(isPublished ? { wiki: publishedWiki } : {})
    },
    findWatchedFolder: () => heldLookup.promise,
  })
  await waitUntil(() => readCount === 1, 'the first read', 6_000)

  // Act
  isPublished = true
  heldLookup.resolve(WATCHED_PROJECT)
  await view.whenIdle()

  // Assert
  assert.deepEqual([idsOf(fake), readCount], [['wiki', 'output'], 2])
})

// Value: protects=item 3, the follow-up read is single; fails_when=a watcher that stays where it is makes every read read twice; no_claim=the number of reads at the first start; seam=a counted readFacts
test('a read whose watcher did not move is not followed by another read', async (context) => {
  // Arrange
  let readCount = 0
  const { view } = openView(context, {
    readFacts: async () => {
      readCount += 1
      return readyFacts({ wiki: publishedWiki })
    },
  })
  await view.whenIdle()
  const readsAtStart = readCount

  // Act
  await view.refresh()
  await view.refresh()

  // Assert
  assert.deepEqual([readsAtStart, readCount - readsAtStart], [2, 2])
})

// Value: protects=item 5, the mid-publication hold ends where a cause or this window's run shows; fails_when=an unreadable manifest with a new receipt freezes the memory, so the good read after this window's own generation tells a Wiki was published again; no_claim=the notice wording; seam=scripted facts across four reads
test('an unreadable manifest with a new receipt does not freeze the memory, so a later good read after this window’s own run tells nothing', async (context) => {
  // Arrange
  let step: 'reservation' | 'unreadable' | 'run' | 'published' = 'reservation'
  const reservation: ReadyFacts['reservation'] = {
    host: 'vscode',
    startedAtMs: 0,
    retryAtMs: 60_000,
  }
  const { tellings, view } = openView(context, {
    readFacts: async () => {
      switch (step) {
        case 'reservation':
          return readyFacts({ reservation })
        case 'unreadable':
          return readyFacts({
            publication: 'receipt-new',
            attention: { cause: 'unreadable-manifest', sentence: 'x' },
          })
        case 'run':
          return readyFacts({
            publication: 'receipt-new',
            run: {
              kind: 'generate',
              startedAtMs: 0,
              timeoutMs: 3_300_000,
              isAwaitingChat: false,
            },
          })
        case 'published':
          return readyFacts({
            publication: 'receipt-new',
            wiki: publishedWiki,
          })
      }
    },
  })
  await view.whenIdle()

  // Act
  for (const next of ['unreadable', 'run', 'published'] as const) {
    step = next
    await view.refresh()
  }
  await view.whenIdle()

  // Assert
  assert.deepEqual(tellings, [])
})

// Value: protects=the late-publication notice across a read that lands mid-publication; fails_when=a read that sees the new receipt before the Wiki is readable replaces the memory, so the read that shows the Wiki tells nothing; no_claim=the notice wording; seam=scripted facts across three reads
test('a read that lands mid-publication keeps the memory, and the read that shows the Wiki tells once', async (context) => {
  // Arrange
  let step: 'reservation' | 'mid' | 'published' = 'reservation'
  const { fake, tellings, view } = openView(context, {
    readFacts: async () => {
      if (step === 'reservation')
        return readyFacts({
          reservation: { host: 'vscode', startedAtMs: 0, retryAtMs: 60_000 },
        })
      if (step === 'mid')
        return readyFacts({
          publication: 'receipt-new',
          reservation: { host: 'vscode', startedAtMs: 0, retryAtMs: 60_000 },
        })
      return readyFacts({ publication: 'receipt-new', wiki: publishedWiki })
    },
  })
  await view.whenIdle()
  step = 'mid'
  await view.refresh()
  const idsMidPublication = idsOf(fake)

  // Act
  step = 'published'
  await view.refresh()
  await view.refresh()
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [idsMidPublication, idsOf(fake), tellings],
    [['reservation', 'output'], ['wiki', 'output'], ['.codebook/wiki']],
  )
})

// Value: protects=item 27's consequence for the notice; fails_when=a Wiki whose manifest appears while the receipt read still shows none tells nothing at that read and never later; no_claim=the notice wording; seam=a read that pairs the older receipt with the newer manifest
test('a Wiki whose manifest is newer than the receipt read with it still tells the learner once', async (context) => {
  // Arrange
  let isPublished = false
  const { tellings, view } = openView(context, {
    readFacts: async () =>
      isPublished
        ? readyFacts({ wiki: publishedWiki })
        : readyFacts({
            reservation: { host: 'vscode', startedAtMs: 0, retryAtMs: 60_000 },
          }),
  })
  await view.whenIdle()

  // Act
  isPublished = true
  await view.refresh()
  await view.refresh()
  await view.whenIdle()

  // Assert
  assert.deepEqual(tellings, ['.codebook/wiki'])
})

/** Opens the view with a published Wiki, a folder to stand on and the events of its watcher reportable. */
function openWatchedView(
  context: TestContext,
  overrides: Partial<LlmWikiViewOptions> & { facts?: Partial<ReadyFacts> } = {},
) {
  const { facts, ...options } = overrides
  let readCount = 0
  const opened = openView(context, {
    readFacts: async () => {
      readCount += 1
      return readyFacts({ wiki: publishedWiki, ...facts })
    },
    ...options,
  })
  return { ...opened, readCount: () => readCount }
}

// Value: protects=item 7, a deleted or moved output folder; fails_when=a delete event of the folder itself (no file events) is dropped, so a deleted Wiki keeps showing Wiki source current; no_claim=what the real editor reports; seam=the fake file watching reporting only the folder
test('a directory-only event of the output folder or a folder above it refreshes the view', async (context) => {
  // Arrange
  const { fake, readCount, view } = openWatchedView(context)
  await view.whenIdle()
  const kinds = ['delete', 'create'] as const

  // Act
  const readsAfterEachEvent: number[] = []
  for (const [index, path] of [
    WATCHED_OUTPUT,
    '/project/.codebook',
  ].entries()) {
    const readsBefore = readCount()
    fake.files.report(kinds[index] ?? 'delete', path)
    await waitUntil(
      () => readCount() > readsBefore,
      'a read after the event',
      6_000,
    )
    readsAfterEachEvent.push(readCount() - readsBefore)
  }

  // Assert
  assert.deepEqual(
    readsAfterEachEvent.map((reads) => reads > 0),
    [true, true],
  )
})

// Value: protects=item 7, the exact-path filter; fails_when=an event of a file that is not one of the watched files refreshes the view; no_claim=the glob; seam=the fake file watching
test('an event of an unrelated file below the watched folder reads nothing', async (context) => {
  // Arrange
  const { fake, readCount, view } = openWatchedView(context)
  await view.whenIdle()
  const readsBefore = readCount()

  // Act
  fake.files.report('change', '/project/.codebook/wiki/index.html')
  // Settled: no debounced read is waiting and none runs, so a read for this event would already be counted.
  await view.whenIdle()

  // Assert
  assert.equal(readCount() - readsBefore, 0)
})

/** Facts that show this window's run row, so the view polls. */
const runningFacts = (): ReadyFacts =>
  readyFacts({
    run: {
      kind: 'generate',
      startedAtMs: 0,
      timeoutMs: 3_300_000,
      isAwaitingChat: false,
    },
  })

// Value: protects=the debounce flush; fails_when=the view reports itself settled while the debounce of a matched event is still waiting, so the read it will make is missed by a test that proves a count; no_claim=the debounce length; seam=a matched event, the debounce of 20 ms
test('a watched file’s event is read once after the debounce, before the view reports itself settled', async (context) => {
  // Arrange
  const { fake, readCount, view } = openWatchedView(context)
  await view.whenIdle()
  const readsBefore = readCount()

  // Act
  fake.files.report('change', WATCHED_OUTPUT)
  await view.whenIdle()

  // Assert
  assert.equal(readCount() - readsBefore, 1)
})

// Value: protects=the 30 second poll across a failed read; fails_when=a read that throws while a run row showed replaces the run row with the error row and the poll stops, so a run that ended elsewhere never clears the error row; no_claim=the 30 second value; seam=mocked timers, a read that succeeds with a run and then throws
test('the poll keeps reading after a read failed while a run row showed', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let isFailing = false
  let reads = 0
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (isFailing) throw new Error('disk busy')
      return runningFacts()
    },
  })
  await view.whenIdle()
  isFailing = true
  await view.refresh()
  const readsWithTheErrorRow = reads

  // Act
  context.mock.timers.tick(50)
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [fake.rows().map((row) => row.label), reads - readsWithTheErrorRow],
    [[ERROR_ROW_LABEL], 1],
  )
})

// Value: protects=the error row clears once the run is over; fails_when=the poll that continues across the error row never stops, or the next good read does not clear the error row; no_claim=the 30 second value; seam=mocked timers
test('the poll stops once a good read shows no run after the error row', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let step: 'run' | 'fail' | 'idle' = 'run'
  let reads = 0
  const { view } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (step === 'fail') throw new Error('disk busy')
      return step === 'run' ? runningFacts() : readyFacts()
    },
  })
  await view.whenIdle()
  step = 'fail'
  await view.refresh()
  step = 'idle'
  context.mock.timers.tick(50)
  await view.whenIdle()
  const readsAfterTheGoodRead = reads

  // Act
  context.mock.timers.tick(200)
  await view.whenIdle()

  // Assert
  assert.equal(reads - readsAfterTheGoodRead, 0)
})

// Value: protects=the poll runs only for a run that was shown; fails_when=an error row after a read that never showed a run starts the poll, so a broken folder is read again and again; why_new=the neighbouring poll tests start from a shown run; no_claim=the 30 second value; seam=mocked timers, a read that throws from the first call
test('the poll does not start for an error row when no run row was shown before', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let reads = 0
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      throw new Error('disk busy')
    },
  })
  await view.whenIdle()
  const readsWithTheErrorRow = reads

  // Act
  context.mock.timers.tick(200)
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [fake.rows().map((row) => row.label), reads - readsWithTheErrorRow],
    [[ERROR_ROW_LABEL], 0],
  )
})

// Value: protects=task 22 (one read when the view is shown); fails_when=showing a hidden view waits for the 1 s debounce, so stale rows stay on screen and the poll stays stopped for that second; no_claim=the editor's visibility semantics; seam=mocked timers with no tick after the view is shown
test('a hidden view that is shown reads at once without waiting for the debounce', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let reads = 0
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      return runningFacts()
    },
  })
  await view.whenIdle()
  fake.setVisible(false)
  const readsWhenHidden = reads

  // Act
  fake.setVisible(true)
  await afterEventLoopTurn()

  // Assert
  assert.equal(reads - readsWhenHidden, 1)
})

// Value: protects=no background work while hidden; fails_when=a collapsed view still polls while a run row shows, or showing it again does not read once and restart the poll; no_claim=the editor's visibility semantics; seam=mocked timers, the fake view's visibility
test('a hidden view does not poll and a shown view reads once and polls again', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let reads = 0
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      return runningFacts()
    },
  })
  await view.whenIdle()

  // Act
  fake.setVisible(false)
  const readsWhenHidden = reads
  context.mock.timers.tick(500)
  await view.whenIdle()
  const readsAfterHiddenTicks = reads
  fake.setVisible(true)
  await view.whenIdle()
  const readsAfterShown = reads
  context.mock.timers.tick(50)
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [
      readsAfterHiddenTicks - readsWhenHidden,
      readsAfterShown - readsAfterHiddenTicks,
      reads - readsAfterShown,
    ],
    [0, 1, 1],
  )
})

// Value: protects=item 8, an output outside the project whose parent is missing; fails_when=the watcher walks up to an ancestor (the home folder or the root) and watches it recursively, or the Output row does not say the view refreshes on visibility and Refresh only, or the cause is recorded more than once; no_claim=the editor's cost of a recursive watch; seam=a findWatchedFolder that answers a far ancestor
test('an output outside the project with a missing parent gets no watcher, an Output tooltip that says so and one record in Output', async (context) => {
  // Arrange
  const { fake, recordedFailures, view } = openWatchedView(context, {
    facts: {
      outputDirectory: '/elsewhere/missing/wiki',
      outputLabel: '/elsewhere/missing/wiki',
    },
    findWatchedFolder: async () => '/elsewhere',
  })
  await view.whenIdle()

  // Act
  await view.refresh()
  await view.refresh()

  // Assert
  assert.deepEqual(
    [
      fake.files.liveWatcherCount(),
      recordedFailures,
      rowOf(fake, 'output')?.tooltip?.includes('refreshes when it is shown'),
    ],
    [0, ['The LLM Wiki view could not watch the Wiki folder'], true],
  )
})

// Value: protects=item 8, a fresh project; fails_when=a missing .codebook inside the project watches anything but the project root; no_claim=the move to .codebook once a run makes it (host test); seam=the pattern handed to the fake file watching
test('a missing .codebook inside the project is watched from the project root', async (context) => {
  // Arrange
  const { fake, view } = openWatchedView(context)

  // Act
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    fake.files.watched.map(({ base }) => base),
    [WATCHED_PROJECT],
  )
})

// Value: protects=item 9, a project reached through a symbolic link; fails_when=an event spelled with the real path is dropped because only the linked spelling was computed; no_claim=macOS's /var versus /private/var itself; seam=a real symbolic link and the fake file watching reporting the real spelling
test('an event spelled with the real path of a symlinked project still refreshes the view', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-view-link-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const realProject = join(await realpath(directory), 'real')
  const linkedProject = join(directory, 'linked')
  await mkdir(join(realProject, '.codebook', 'wiki'), { recursive: true })
  await symlink(realProject, linkedProject)
  const linkedOutput = join(linkedProject, '.codebook', 'wiki')
  const { fake, readCount, view } = openWatchedView(context, {
    facts: { projectRoot: linkedProject, outputDirectory: linkedOutput },
    findWatchedFolder: async () => join(linkedProject, '.codebook'),
  })
  await view.whenIdle()
  const readsBefore = readCount()

  // Act
  fake.files.report(
    'create',
    join(linkedOutput, 'codebook-wiki.json'),
    join(realProject, '.codebook', 'wiki', 'codebook-wiki.json'),
  )
  await waitUntil(
    () => readCount() > readsBefore,
    'a read after the event',
    6_000,
  )

  // Assert
  assert.equal(readCount() > readsBefore, true)
})

// Value: protects=the handle's contract; fails_when=refresh rejects for a read that failed, so the Refresh command or a timer fails; no_claim=the error row; seam=a readFacts that rejects
test('refresh resolves even when the read failed', async (context) => {
  // Arrange
  const { view } = openView(context, {
    readFacts: async () => {
      throw new Error('disk gone')
    },
  })
  const handle: LlmWikiView = view

  // Act
  const outcome = await handle.refresh().then(
    () => 'resolved',
    () => 'rejected',
  )

  // Assert
  assert.equal(outcome, 'resolved')
})

const WATCHING_MESSAGE =
  'Codebook is watching the chat. Stop watching does not stop the chat; stop it in the chat.'

// Value: protects=RT2-A (one Output record per failure while the error row stands); fails_when=the 30 s poll that continues across the error row writes the same read failure to Output › Codebook at every tick; no_claim=the 30 second value; seam=mocked timers, a read that succeeds with a run and then keeps throwing
test('a read failure that persists across poll ticks is recorded once in Output', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let isFailing = false
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => {
      if (isFailing) throw new Error('disk busy')
      return runningFacts()
    },
  })
  await view.whenIdle()
  isFailing = true

  // Act
  await view.refresh()
  for (let tick = 0; tick < 3; tick += 1) {
    context.mock.timers.tick(50)
    await view.whenIdle()
  }

  // Assert
  assert.deepEqual(recordedFailures, [
    'The LLM Wiki view could not read its state',
  ])
})

// Value: protects=SM3 (a) (a failure in the row step is recorded once however many poll ticks meet it); fails_when=a read that fails in the step that makes rows clears the dedupe first, so every 30 s tick writes the same record to Output; no_claim=the 30 second value; seam=mocked timers, a run row shown, then facts whose row step throws on every read
test('a row-step failure that persists across poll ticks is recorded once in Output', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let isBroken = false
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => {
      const facts = runningFacts()
      if (isBroken)
        Object.defineProperty(facts, 'run', {
          enumerable: true,
          get(): never {
            throw new Error('row step failed')
          },
        })
      return facts
    },
  })
  await view.whenIdle()
  isBroken = true

  // Act
  await view.refresh()
  for (let tick = 0; tick < 3; tick += 1) {
    context.mock.timers.tick(50)
    await view.whenIdle()
  }

  // Assert
  assert.equal(recordedFailures.length, 1)
})

// Value: protects=SM3 (b) (a freshness check that cannot be shown is recorded once however many poll ticks meet it); fails_when=a good read clears the dedupe before the freshness result is shown, so each tick records the same freshness failure again and the view flips between the Wiki row and the error row; no_claim=the 30 second value; seam=mocked timers, a run row with a Wiki, a freshness read that returns a value the rows cannot be made from
test('a freshness failure that persists across poll ticks is recorded once in Output', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => ({ ...runningFacts(), wiki: publishedWiki }),
    // A freshness answer whose status getter throws when the rows are made from it.
    readFreshness: async () => {
      const freshness = {}
      Object.defineProperty(freshness, 'status', {
        enumerable: true,
        get(): never {
          throw new Error('freshness rows failed')
        },
      })
      return freshness as LlmWikiFreshness
    },
  })
  await view.whenIdle()

  // Act
  for (let tick = 0; tick < 3; tick += 1) {
    context.mock.timers.tick(50)
    await view.whenIdle()
  }

  // Assert
  assert.equal(recordedFailures.length, 1)
})

// Value: protects=RT3-b (two different failures with the same message are two records); fails_when=the dedupe keys on the message text only, so an error with the same message and another code (or a thrown non-Error with the same text) is swallowed; no_claim=the Output wording; seam=readFacts that throws the same message with two codes
test('two failures with the same message and different error codes are recorded twice', async (context) => {
  // Arrange
  const outcomes = [
    Object.assign(new Error('operation failed'), { code: 'EACCES' }),
    Object.assign(new Error('operation failed'), { code: 'EBUSY' }),
  ]
  let next = 0
  const { recordedCauses, view } = openView(context, {
    readFacts: async () => {
      throw outcomes[next++]
    },
  })

  // Act
  await view.whenIdle()
  await view.refresh()

  // Assert
  assert.deepEqual(
    recordedCauses.map((cause) => (cause as { code: string }).code),
    ['EACCES', 'EBUSY'],
  )
})

// Value: protects=RT2-A (a different failure, or one after a good read, is recorded again); fails_when=the dedupe swallows a new cause or never resets after a good read, so a later failure leaves Output silent; no_claim=the cause's wording; seam=a readFacts that throws two causes, then succeeds, then throws the first cause again
test('a different failure and a failure after a good read are recorded again', async (context) => {
  // Arrange
  const outcomes: Array<Error | 'good'> = [
    new Error('disk busy'),
    new Error('disk busy'),
    new Error('permission denied'),
    'good',
    new Error('disk busy'),
  ]
  let next = 0
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => {
      const outcome = outcomes[next++]
      if (outcome instanceof Error) throw outcome
      return readyFacts()
    },
  })

  // Act
  for (let read = 0; read < outcomes.length; read += 1) await view.refresh()

  // Assert
  assert.equal(recordedFailures.length, 3)
})

// Value: protects=SM2-1 (debounce-pending x dispose, T2); fails_when=whenIdle keeps waiting for a debounce that dispose dropped, so a test or caller hangs, or the dropped debounce still reads; no_claim=the debounce length; seam=mocked timers with no tick after dispose
test('dispose while a debounce is pending settles whenIdle without a tick and reads nothing', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let reads = 0
  const { view } = openView(context, {
    readFacts: async () => {
      reads += 1
      return readyFacts()
    },
  })
  await view.whenIdle()
  const readsBefore = reads
  view.requestRefresh()
  let isIdle = false
  const idle = view.whenIdle().then(() => {
    isIdle = true
  })

  // Act
  view.dispose()
  await idle

  // Assert
  assert.deepEqual([isIdle, reads - readsBefore], [true, 0])
})

// Value: protects=SM2-2 (reading x requestRefresh); fails_when=a debounced refresh that fires while a read runs is dropped or double-counted, so the last event is not shown or three reads happen; no_claim=the debounce length; seam=mocked timers, a held readFacts
test('a debounced refresh that fires during a read makes one more read and shows the last facts', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const held = defer<LlmWikiViewFacts>()
  let reads = 0
  let isHoldingNextRead = false
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (isHoldingNextRead) {
        // Only the first read after the arrangement is held; the re-read is not.
        isHoldingNextRead = false
        return held.promise
      }
      return readyFacts({ wiki: publishedWiki, outputLabel: '.codebook/last' })
    },
  })
  await view.whenIdle()
  const readsBefore = reads
  isHoldingNextRead = true
  const heldRefresh = view.refresh()
  await afterEventLoopTurn()

  // Act
  view.requestRefresh()
  context.mock.timers.tick(20)
  await afterEventLoopTurn()
  held.resolve(
    readyFacts({ wiki: publishedWiki, outputLabel: '.codebook/held' }),
  )
  await heldRefresh
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [reads - readsBefore, rowOf(fake, 'output')?.label],
    [2, 'Output: .codebook/last'],
  )
})

// Value: protects=SM2-3 (reading x refresh); fails_when=refreshes asked for during a read start a read each, or are dropped so the last facts are not shown; no_claim=the Refresh command's wiring; seam=a held readFacts, three refresh calls
test('three refreshes during a read make exactly one more read and show the last facts', async (context) => {
  // Arrange
  const held = defer<LlmWikiViewFacts>()
  let reads = 0
  let isHoldingNextRead = false
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (isHoldingNextRead) {
        // Only the first read after the arrangement is held; the re-read is not.
        isHoldingNextRead = false
        return held.promise
      }
      return readyFacts({ wiki: publishedWiki, outputLabel: '.codebook/last' })
    },
  })
  await view.whenIdle()
  const readsBefore = reads
  isHoldingNextRead = true
  const heldRefresh = view.refresh()
  await afterEventLoopTurn()

  // Act
  const more = [view.refresh(), view.refresh(), view.refresh()]
  held.resolve(
    readyFacts({ wiki: publishedWiki, outputLabel: '.codebook/held' }),
  )
  await Promise.all([heldRefresh, ...more])
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [reads - readsBefore, rowOf(fake, 'output')?.label],
    [2, 'Output: .codebook/last'],
  )
})

// Value: protects=SM2-4 (reading x show); fails_when=showing a hidden view while a read runs neither re-reads nor runs the freshness check, so the rows stay as that read left them; no_claim=the editor's visibility semantics; seam=a hidden view, a held readFacts, setVisible(true)
test('showing a hidden view during a read reads again and runs the freshness check', async (context) => {
  // Arrange
  const held = defer<LlmWikiViewFacts>()
  let reads = 0
  let freshnessChecks = 0
  let isHoldingNextRead = false
  const { fake, view } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (isHoldingNextRead) {
        // Only the first read after the arrangement is held; the re-read is not.
        isHoldingNextRead = false
        return held.promise
      }
      return readyFacts({ wiki: publishedWiki })
    },
    readFreshness: async () => {
      freshnessChecks += 1
      return { status: 'current' }
    },
  })
  await view.whenIdle()
  fake.setVisible(false)
  const readsBefore = reads
  const checksBefore = freshnessChecks
  isHoldingNextRead = true
  const heldRefresh = view.refresh()
  await afterEventLoopTurn()

  // Act
  fake.setVisible(true)
  held.resolve(readyFacts({ wiki: publishedWiki }))
  await heldRefresh
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [reads - readsBefore, freshnessChecks > checksBefore],
    [2, true],
  )
})

// Value: protects=SM2-5 (error-after-run-row x hide); fails_when=a collapsed view keeps polling across the error row; no_claim=the 30 second value; seam=mocked timers, a run row, a failing read, setVisible(false)
test('hiding the view while the error row follows a run row stops the poll', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let isFailing = false
  let reads = 0
  const { view, fake } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (isFailing) throw new Error('disk busy')
      return runningFacts()
    },
  })
  await view.whenIdle()
  isFailing = true
  await view.refresh()
  fake.setVisible(false)
  await view.whenIdle()
  const readsWhenHidden = reads

  // Act
  context.mock.timers.tick(200)
  await view.whenIdle()

  // Assert
  assert.equal(reads - readsWhenHidden, 0)
})

// Value: protects=SM2-6 (error-after-run-row x show); fails_when=showing the view again with a still-failing read forgets the run that was shown, so the poll never restarts and the error row stays; no_claim=the 30 second value; seam=mocked timers, a run row, a failing read, hide, show
test('showing the view again with a read that still fails restarts the poll across the error row', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let isFailing = false
  let reads = 0
  const { view, fake } = openView(context, {
    readFacts: async () => {
      reads += 1
      if (isFailing) throw new Error('disk busy')
      return runningFacts()
    },
  })
  await view.whenIdle()
  isFailing = true
  await view.refresh()
  fake.setVisible(false)
  fake.setVisible(true)
  await view.whenIdle()
  const readsAfterShown = reads

  // Act
  context.mock.timers.tick(50)
  await view.whenIdle()

  // Assert
  assert.equal(reads - readsAfterShown, 1)
})

// Value: protects=task 16 (N56 native takes: the message lagged the rows by about 200 ms with the write in getChildren, then led them by one frame when sent with the refresh request); fails_when=the new message is sent before the root read that returns the new rows (in the emission that only queues the refresh, a round trip ahead of the rows), or in a later emission than the rows; why_new=the extension host sends $setMessage at once but the refresh takes $refresh and $getChildren before the rows paint, so only a write inside that root read leaves with the rows; seam=the fake editor's model of ExtHostTreeView (leading 200 ms debounce, refresh queued asynchronously, root read); no_claim=the native editor's paint (N56 step 4)
test('a run ending sends the cleared message during the root read that returns the new rows, and not before it', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let isRunning = true
  const { fake, view } = openView(
    context,
    { readFacts: async () => (isRunning ? runningFacts() : readyFacts()) },
    { modelsExtensionHostDebounce: true },
  )
  await view.whenIdle()
  // The run's start: its trailing emission, the root read that writes the watching message, and the window that write opens.
  context.mock.timers.tick(200)
  await Promise.resolve()
  context.mock.timers.tick(200)
  const logBeforeTheEnd = fake.hostLog().length
  isRunning = false

  // Act
  await view.refresh()
  context.mock.timers.tick(200)
  await Promise.resolve()

  // Assert
  assert.deepEqual(fake.hostLog().slice(logBeforeTheEnd), [
    // The leading emission: the same-value write of the old message, which changes nothing on screen.
    `emit message(${WATCHING_MESSAGE})`,
    // The trailing emission carries only the refresh request.
    'emit refresh',
    // The cleared message leaves while the main thread reads the root, right before the new rows return.
    'root-read',
    'emit message(none)',
    'root-return()',
  ])
})

// Value: protects=SM2-7 (message cleared x getChildren) and N55-F3; fails_when=a state without a message writes the cleared message before the tree reads the new rows, or never clears the old one; why_changed=show now writes the current message again (a same-value write that opens the extension host's debounce window) before the tree change, so the log starts with a message write; no_claim=the editor's frames; seam=the fake tree's render log
test('a state without a message clears the message when the tree reads its rows, after getChildren', async (context) => {
  // Arrange
  let isRunning = true
  const { fake, view } = openView(context, {
    readFacts: async () => (isRunning ? runningFacts() : readyFacts()),
  })
  await view.whenIdle()
  fake.rows()
  isRunning = false
  await view.refresh()

  // Act
  fake.rows()

  // Assert
  assert.deepEqual(fake.renderLog(), [
    'message:undefined',
    'getChildren',
    `message:${WATCHING_MESSAGE}`,
    `message:${WATCHING_MESSAGE}`,
    'getChildren',
    'message:undefined',
  ])
})

// Value: protects=RT2-C (a root read inside createTreeView); fails_when=an editor that reads the provider while createTreeView runs makes the view throw before it has its tree view handle, or the message is lost afterwards; no_claim=a message at that moment (the first model has none); seam=a fake editor that calls getChildren synchronously from createTreeView
test('an editor that reads the root inside createTreeView still gets the rows and the message', async (context) => {
  // Arrange
  const { fake, view } = openView(
    context,
    { readFacts: async () => runningFacts() },
    { readsRootInsideCreateTreeView: true },
  )

  // Act
  await view.whenIdle()
  const rowIds = idsOf(fake)

  // Assert
  assert.deepEqual(
    [rowIds, fake.message()],
    [['run', 'output'], WATCHING_MESSAGE],
  )
})

// Value: protects=F1 (no freshness work while hidden, also for a check queued before the hide); fails_when=a check queued while another ran still starts after the view is hidden (full-source hashing and Git work for a collapsed view), or showing the view again queues no current check; no_claim=the answer of the check that was running; seam=a held first freshness check, a refresh that queues the second, setVisible(false) before the first is released
test('a freshness check queued before the view is hidden does not start while it is hidden, and showing the view checks again', async (context) => {
  // Arrange
  const heldFirstCheck = defer<LlmWikiFreshness>()
  let checkCount = 0
  const { fake, view } = openView(context, {
    readFreshness: () => {
      checkCount += 1
      return checkCount === 1
        ? heldFirstCheck.promise
        : Promise.resolve<LlmWikiFreshness>({ status: 'current' })
    },
  })
  await waitUntil(() => checkCount === 1, 'the first check', 6_000)
  await view.refresh()

  // Act
  fake.setVisible(false)
  heldFirstCheck.resolve({ status: 'changed' })
  await view.whenIdle()
  await afterEventLoopTurn()
  const checksWhileHidden = checkCount
  fake.setVisible(true)
  await view.whenIdle()

  // Assert
  assert.deepEqual(
    [checksWhileHidden, checkCount, rowOf(fake, 'wiki')?.description],
    [1, 2, 'Wiki source current'],
  )
})

// Value: protects=F4 (a cause that cannot be read still shows the error row); fails_when=a cause whose message getter throws makes the failure key throw, so refresh rejects, the error row never shows and nothing is recorded; no_claim=the wording of the record; seam=an Error whose message getter throws, thrown by readFacts twice
test('a failure whose message cannot be read still shows the error row, resolves refresh and is recorded once', async (context) => {
  // Arrange
  const unhandled = collectUnhandledRejections(context)
  const hostileCause = new Error('hidden')
  Object.defineProperty(hostileCause, 'message', {
    get(): never {
      throw new Error('message getter failed')
    },
  })
  const { fake, recordedFailures, view } = openView(context, {
    readFacts: async () => {
      throw hostileCause
    },
  })
  await view.whenIdle()

  // Act
  const outcome = await view.refresh().then(
    () => 'resolved',
    () => 'rejected',
  )
  await afterEventLoopTurn()

  // Assert
  assert.deepEqual(
    [outcome, fake.rows().map((row) => row.label), recordedFailures, unhandled],
    [
      'resolved',
      [ERROR_ROW_LABEL],
      ['The LLM Wiki view could not read its state'],
      [],
    ],
  )
})

// Value: protects=F5 (a message that embeds a changing number is one failure); fails_when=a failure whose message differs only in a number at each poll tick (a pid, a duration) is recorded at every tick, which floods Output › Codebook; no_claim=a different code with the same text (the codes test above); seam=readFacts that throws the same code with a counting number in its message
test('a failure that differs from the recorded one only in a number of its message is recorded once', async (context) => {
  // Arrange
  let attempt = 0
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => {
      attempt += 1
      throw Object.assign(new Error(`disk busy after ${attempt * 30} ms`), {
        code: 'EBUSY',
      })
    },
  })
  await view.whenIdle()

  // Act
  await view.refresh()
  await view.refresh()

  // Assert
  assert.deepEqual(recordedFailures, [
    'The LLM Wiki view could not read its state',
  ])
})

// Value: protects=F6 (a good read between two equal failures); fails_when=a good read that still waits for its freshness answer does not end the failure that stood, so the same failure after it is swallowed and Output stays silent for a real new failure; no_claim=the freshness answer; seam=a read that fails, a good read with a Wiki whose freshness check is held, the same failure again
test('a failure after a good read is recorded again even while that read’s freshness check is still running', async (context) => {
  // Arrange
  let isFailing = true
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => {
      if (isFailing) throw new Error('disk busy')
      return readyFacts({ wiki: publishedWiki })
    },
    // The check never answers during the test: the good read has not shown a freshness result.
    readFreshness: () => new Promise<LlmWikiFreshness>(() => {}),
  })
  await view.refresh()
  isFailing = false
  await view.refresh()

  // Act
  isFailing = true
  await view.refresh()

  // Assert
  assert.equal(recordedFailures.length, 2)
})

// Value: protects=F6 (a freshness check that keeps failing is recorded once, a later one after a good check again); fails_when=a failing freshness check is never written to Output (the label says unknown and nothing tells why), is written at every poll tick, or is not written again after a check succeeded; no_claim=the unknown label (the test above); seam=mocked timers, a run row with a Wiki, a freshness read that fails on three ticks, then succeeds for a new publication, then fails
test('a freshness check that keeps failing is recorded once in Output, and again after a check succeeded', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const freshnessOutcomes = ['fail', 'fail', 'fail', 'ok', 'fail']
  let checkCount = 0
  const { recordedFailures, view } = openView(context, {
    readFacts: async () => ({
      ...runningFacts(),
      // The receipt changes after the third check, so the cached answer of the successful check does not serve the last one.
      publication: checkCount >= 4 ? 'b@2' : 'a@1',
      wiki: publishedWiki,
    }),
    readFreshness: async () => {
      const outcome = freshnessOutcomes[checkCount++]
      if (outcome === 'fail') throw new Error('git failed')
      return { status: 'current' }
    },
  })
  await view.whenIdle()

  // Act
  for (let tick = 0; tick < 4; tick += 1) {
    context.mock.timers.tick(50)
    await view.whenIdle()
  }

  // Assert
  assert.deepEqual(recordedFailures, [
    'The LLM Wiki view could not check whether the Wiki is current',
    'The LLM Wiki view could not check whether the Wiki is current',
  ])
})

// Value: protects=F8 (no write on a disposed tree view); fails_when=a root read after dispose writes a message on the disposed tree view; why_changed=the message is written by the root read again, so the root read before dispose applies it and the guard is that a read after dispose changes nothing; no_claim=the message before dispose; seam=a run row's message shown, then dispose, then a root read
test('a root read after dispose writes no message on the tree view', async (context) => {
  // Arrange
  const { fake, view } = openView(context, {
    readFacts: async () => runningFacts(),
  })
  await view.whenIdle()
  fake.rows()
  view.dispose()
  const logAtDispose = fake.renderLog()

  // Act
  fake.rows()

  // Assert
  assert.deepEqual(
    [fake.renderLog(), fake.message()],
    [[...logAtDispose, 'getChildren'], WATCHING_MESSAGE],
  )
})
