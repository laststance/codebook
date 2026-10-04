import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createManualClock } from './utils/createManualClock'
import { createSourceBoundWaitHold } from './utils/createSourceBoundWaitHold'
import {
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
import {
  createFakeFileWatching,
  FakeRelativePattern,
} from './utils/fakeFileWatching'
import { openFakeWikiPage } from './utils/fakeWikiPage'
import { loadModule } from './utils/loadModule'
import { publishedWikiFixture } from './utils/publishedWikiFixture'
import type * as ServeMinimalWikiModule from './utils/serveMinimalWiki'

// Value: protects=deadline tests firing a run's timers as real time would; fails_when=a timer cleared by an earlier callback of the same advance still fires, or timers fire in the order they were set instead of the order they fall due; why_new=Cycle 0043 R15 (the clock fired a snapshot in insertion order); seam=none
test('a manual clock fires due timers in the order they fall due and never one an earlier callback cleared', () => {
  // Arrange: the later-due timer is set first; the first to fall due clears a third one.
  const clock = createManualClock(),
    fired: string[] = []
  clock.setTimeout(() => fired.push('due at 20 s'), 20_000)
  const clearedId = clock.setTimeout(() => fired.push('cleared'), 15_000)
  clock.setTimeout(() => {
    fired.push('due at 10 s')
    clock.clearTimeout(clearedId)
  }, 10_000)
  clock.setTimeout(() => fired.push('due at 30 s'), 30_000)
  // Act
  clock.advance(20_000)
  // Assert
  assert.deepEqual(fired, ['due at 10 s', 'due at 20 s'])
})

// Value: protects=deadline tests of a run whose timers follow one another (a retry set by a deadline's callback) seeing them at the times real time would give; fails_when=the clock jumps to the end of the advance before it calls the due timers, so a timer set by a callback counts from that end and each callback reads the end time; why_new=Cycle 0045 D-L3; seam=none
test('a timer a callback sets during an advance fires within that advance when it falls due before its end, and each callback reads the time it was due', () => {
  // Arrange: the timer due at 10 s sets one that falls due 5 s after it.
  const clock = createManualClock(),
    fired: string[] = []
  clock.setTimeout(() => {
    fired.push(`first timer at ${clock.now()} ms`)
    clock.setTimeout(
      () => fired.push(`timer set by its callback at ${clock.now()} ms`),
      5_000,
    )
  }, 10_000)
  // Act
  clock.advance(20_000)
  // Assert
  assert.deepEqual(fired, [
    'first timer at 10000 ms',
    'timer set by its callback at 15000 ms',
  ])
  assert.equal(clock.now(), 20_000)
})

// Value: protects=a fake-clock wait that gives up leaving every product timer past its limit unfired, so the reported limit is the time that passed; fails_when=the wait takes one more 50 ms step than its limit, or a full step where less than one is left; why_new=Cycle 0045 D-L2 (it stepped limit + 50 ms and reported the limit); seam=node:test setTimeout mock
test('advanceClockUntil moves the clock no further than its limit: a timer set 25 ms past the limit has not fired when it gives up', async (context) => {
  // Arrange: a limit that is not a whole number of 50 ms steps.
  enableFakeClock(context)
  const fired: string[] = []
  setTimeout(() => fired.push('at the limit'), 120)
  setTimeout(() => fired.push('25 ms past the limit'), 145)
  // Act
  const reachedAfterMs = await advanceClockUntil(context, () => false, 120)
  resetFakeClock(context)
  // Assert
  assert.equal(reachedAfterMs, undefined)
  assert.deepEqual(fired, ['at the limit'])
})

// Value: protects=a module under test cancelling its own timer after the test faked the clock; fails_when=the loaded module's clearTimeout reaches only the faked timers, so a real timer it armed before the clock was faked still fires; why_new=Cycle 0045 D-L1; seam=a module written for this test, loaded as the suites load compiled boundary modules
test('a timer a loaded module armed before the clock was faked is cancelled by its clearTimeout afterwards and never fires', async (context) => {
  // Arrange: the loaded module arms a real 20 ms timer, then the test fakes the clock.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-loaded-timer-'))
  try {
    const modulePath = join(directory, 'armedTimer.js')
    await writeFile(
      modulePath,
      [
        'let timer',
        'exports.arm = (onFire) => { timer = setTimeout(onFire, 20) }',
        'exports.disarm = () => clearTimeout(timer)',
      ].join('\n'),
    )
    const armedTimer = await loadModule<{
      arm(onFire: () => void): void
      disarm(): void
    }>(modulePath, {})
    let fired = false
    armedTimer.arm(() => {
      fired = true
    })
    enableFakeClock(context)
    // Act: the module cancels its timer while the clock is faked; then 60 real ms pass.
    armedTimer.disarm()
    resetFakeClock(context)
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
    // Assert
    assert.equal(fired, false)
  } finally {
    resetFakeClock(context)
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=a held wait for a stop's own pause never spinning forever when nothing can cancel it; fails_when=a held wait without an abort signal loops on setImmediate until the test runner's timeout; why_new=Cycle 0043 O7 (the loop was written twice and `signal` was optional); seam=none
test('a held wait without an abort signal ends as a timeout at its turn limit instead of hanging, and one whose pause arrives returns it', async () => {
  // Arrange
  const hold = createSourceBoundWaitHold(3)
  hold.hold()
  let looks = 0
  // Act
  const arriving = await hold.wait(
    () => (++looks === 2 ? 'paused' : undefined),
    'source-bound CDP stop',
  )
  // Assert
  assert.equal(arriving, 'paused')
  assert.equal(hold.holds('source-bound CDP stop'), true)
  assert.equal(hold.holds('configured before conditions'), false)
  await assert.rejects(
    hold.wait(() => undefined, 'source-bound CDP stop'),
    /Timed out waiting for source-bound CDP stop/,
  )
})

// Value: protects=a held wait ending at once when its run is cancelled; fails_when=an aborted signal is not read and the wait keeps looking; why_new=Cycle 0043 O7; seam=none
test('a held wait with an abort signal looks until the run is cancelled', async () => {
  // Arrange
  const hold = createSourceBoundWaitHold(1),
    cancellation = new AbortController()
  hold.hold()
  let looks = 0
  // Act: the run is cancelled at the fifth look, past the turn limit of a wait without a signal.
  const waiting = hold.wait(
    () => {
      if (++looks === 5) cancellation.abort(new Error('run stopped'))
      return undefined
    },
    'source-bound CDP stop',
    cancellation.signal,
  )
  // Assert
  await assert.rejects(waiting, /run stopped/)
  assert.equal(looks, 5)
})

// Cycle 0045 (X7-D.1): red while the held wait returned a truthy read although its signal had been aborted during that read; the real waitUntil reads the signal again after the read and throws.
test('a held wait whose run is cancelled during a look that finds the pause rejects with the cancellation, as the real wait does', async () => {
  // Arrange
  const hold = createSourceBoundWaitHold(),
    cancellation = new AbortController()
  hold.hold()
  // Act: the look that finds the pause is the one during which the run is cancelled.
  const outcome = await hold
    .wait(
      () => {
        cancellation.abort(new Error('run stopped'))
        return 'paused'
      },
      'source-bound CDP stop',
      cancellation.signal,
    )
    .then(
      (value) => `returned ${value}`,
      (error: unknown) => String(error),
    )
  // Assert
  assert.equal(outcome, 'Error: run stopped')
})

// Value: protects=a test acting while the wait for a stop's own pause is open and then letting it expire; fails_when=a released hold keeps looking until the run is cancelled; why_new=Cycle 0044 merge of 0042-SR15/SR31 (their tests release the hold) with R9 (the handle had no user before); seam=none
test('a held wait that the test releases ends as a timeout although its run is not cancelled', async () => {
  // Arrange
  const hold = createSourceBoundWaitHold(),
    cancellation = new AbortController()
  const held = hold.hold()
  let looks = 0
  // Act: the hold is released at the third look.
  const waiting = hold.wait(
    () => {
      if (++looks === 3) held.release()
      return undefined
    },
    'source-bound CDP stop',
    cancellation.signal,
  )
  // Assert
  await assert.rejects(waiting, /Timed out waiting for source-bound CDP stop/)
  assert.equal(looks, 3)
})

// Value: protects=a page test that looks for an element by a selector the fake page cannot evaluate failing instead of passing on the wrong element; fails_when=a bracket group that is neither `[attribute]` nor `[attribute=value]` is dropped from the selector, so it matches every element and the first one is returned; why_new=Cycle 0045 D-L4 (the fake said such selectors throw and matched everything); seam=none
test('the fake Wiki page refuses an attribute selector with an operator instead of matching every element', async () => {
  // Arrange: a page whose update link has an href that starts with "vscode://".
  const page = await openFakeWikiPage('', 'current-shell')
  // Act
  const finding = (): unknown => page.find('[href^="vscode://"]')
  // Assert
  assert.throws(finding, {
    message: 'The fake page cannot match the selector [href^="vscode://"]',
  })
})

// Value: protects=a page script that inserts beside a node it no longer owns failing in the page tests as it fails in a browser; fails_when=the fake page puts the node in front of the parent's last child when the reference is no child of that parent, so a wrong insert passes; why_new=Cycle 0045 D-L4; seam=none
test('inserting before a node that is not a child fails as it does in a browser', async () => {
  // Arrange: the update link sits inside the right rail's group, so it is no child of the body.
  const page = await openFakeWikiPage('', 'current-shell')
  const updateLink = page.find('.wiki-update')
  assert.ok(updateLink)
  // Act
  const inserting = (): void =>
    page.body.insertBefore('a text node', updateLink)
  // Assert: the browser's error, and the body keeps its three children.
  assert.throws(inserting, {
    name: 'NotFoundError',
    message:
      "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
  })
  assert.deepEqual(
    page.body.childNodes.map((child) =>
      typeof child === 'string' ? child : child.tagName,
    ),
    ['header', 'main', 'aside'],
  )
})

// Value: protects=a page test whose selector found nothing failing at its click; fails_when=a click on an undefined element dispatches nothing and answers "not swallowed", which is the answer of a link the page let through; why_new=Cycle 0045 D-L5; seam=none
test('clicking an element the fake Wiki page does not have fails the test instead of reporting a click that was not swallowed', async () => {
  // Arrange: a page without a right rail has no update link.
  const page = await openFakeWikiPage('', 'no-rail')
  // Act
  const clicking = page.click(page.find('.wiki-update'))
  // Assert
  await assert.rejects(clicking, {
    message:
      'The fake page has no element to click: the selector found nothing in this layout.',
  })
})

// Value: protects=a page test that holds an answer back and releases it stating an order that happened; fails_when=`release` succeeds although the page never made the held request, so the test's "answer arrives late" step delivers nothing and a request made afterwards is answered at once; why_new=review of Cycle 0045, tests-1 #5; seam=none
test('releasing a held answer the fake Wiki page has not asked for fails the test, and the hold stays for the request that comes later', async () => {
  // Arrange: a page whose script asks for freshness only when the window gets focus; the test holds that answer back.
  const page = await openFakeWikiPage(
    [
      "window.addEventListener('focus', function () {",
      "  fetch('/w/fake-reader-token/api/freshness').then(function () {",
      "    document.body.setAttribute('data-freshness-answered', 'yes')",
      '  })',
      '})',
    ].join('\n'),
    'no-rail',
  )
  page.holdNext('api/freshness')

  // Act: the release comes before the page asked; then the page asks, and the answer is released again.
  const releasedBeforeTheRequest = await page.release('api/freshness').then(
    () => 'released',
    (error: unknown) => String(error),
  )
  await page.focusWindow()
  const answeredWhileHeld = page.body.getAttribute('data-freshness-answered')
  await page.release('api/freshness')

  // Assert
  assert.equal(
    releasedBeforeTheRequest,
    'Error: The fake page has not asked for api/freshness since its answer was to be held back, so there is no answer to release.',
  )
  assert.equal(answeredWhileHeld, null)
  assert.equal(page.body.getAttribute('data-freshness-answered'), 'yes')
})

// Value: protects=a page test standing at the faked time it asked for, between two of the page's timers; fails_when=an advance is rounded up to whole seconds, so a test that advances 1,200 ms already sees what the page does at 2,000 ms; why_new=Cycle 0045 D-L6; seam=none
test("the fake Wiki page's clock moves exactly the time asked for: a timer due after 1,500 ms has not fired after an advance of 1,200 ms", async () => {
  // Arrange: the page script sets one timer that notes how long after the load it fired.
  const page = await openFakeWikiPage(
    [
      'var loadedAtMs = Date.now()',
      'window.setTimeout(function () {',
      "  document.body.setAttribute('data-fired-after-ms', String(Date.now() - loadedAtMs))",
      '}, 1500)',
    ].join('\n'),
    'no-rail',
  )
  // Act
  await page.advance(1_200)
  const afterTheShortAdvance = {
    pendingTimers: page.pendingTimerCount(),
    firedAfterMs: page.body.getAttribute('data-fired-after-ms'),
  }
  await page.advance(300)
  // Assert
  assert.deepEqual(afterTheShortAdvance, {
    pendingTimers: 1,
    firedAfterMs: null,
  })
  assert.equal(page.body.getAttribute('data-fired-after-ms'), '1500')
})

// Value: protects=a test of the product's file watching failing when the product keeps reacting to a listener it disposed; fails_when=the fake watcher's listener registration cannot be disposed, so a product that disposes its listener and keeps the watcher still gets every event; why_new=review of Cycle 0045, tests-1 #10 (`dispose()` of a listener did nothing); seam=none
test('a file listener whose registration was disposed gets no further event from the fake watcher, while the watcher and its other listeners live on', () => {
  // Arrange: one watcher with two change listeners.
  const files = createFakeFileWatching()
  const watcher = files.createFileSystemWatcher(
    new FakeRelativePattern('/repo', '**'),
  )
  const heard: string[] = []
  const firstListener = watcher.onDidChange((file) =>
    heard.push(`first: ${file.fsPath}`),
  )
  watcher.onDidChange((file) => heard.push(`second: ${file.fsPath}`))
  files.report('change', '/repo/src/a.ts')

  // Act: the first listener is disposed; the watcher is not.
  firstListener.dispose()
  files.report('change', '/repo/src/b.ts')

  // Assert
  assert.deepEqual(heard, [
    'first: /repo/src/a.ts',
    'second: /repo/src/a.ts',
    'second: /repo/src/b.ts',
  ])
  assert.equal(files.liveWatcherCount(), 1)
})

// Value: protects=a test that reports a file outside the watched project showing that the product does not hear of it; fails_when=the fake delivers a report to every live watcher whatever folder it watches, so a file of another project reaches the product; why_new=review of Cycle 0045, tests-1 #10; seam=none
test('the fake watcher reports a file only to the watchers whose folder contains it', () => {
  // Arrange: one watcher on a project, one on a folder beside it whose name starts alike.
  const files = createFakeFileWatching()
  const heard: string[] = []
  files
    .createFileSystemWatcher(new FakeRelativePattern('/repo', '**'))
    .onDidCreate((file) => heard.push(`repo: ${file.fsPath}`))
  files
    .createFileSystemWatcher(new FakeRelativePattern('/repository', '**'))
    .onDidCreate((file) => heard.push(`repository: ${file.fsPath}`))

  // Act: a file of each project, the first project's own folder, and a file above both.
  files.report('create', '/repo/src/new.ts')
  files.report('create', '/repository/notes.md')
  files.report('create', '/repo')
  files.report('create', '/elsewhere.ts')

  // Assert
  assert.deepEqual(heard, [
    'repo: /repo/src/new.ts',
    'repository: /repository/notes.md',
  ])
})

// Value: protects=the machine's temporary folder staying free of Wiki projects that a failed fixture created; fails_when=the fixture rejects after it created its temporary project and leaves it there, although no caller holds its cleanup; why_new=Cycle 0045 X7-D.3; seam=TMPDIR of this test process, so the fixture's project is the only thing in a folder the test owns
test('a published Wiki fixture whose first publish is refused removes the temporary project it created', async () => {
  // Arrange: temporary projects are created in a folder of this test; the publisher refuses the project root as output folder.
  const temporaryFolder = await mkdtemp(
    join(tmpdir(), 'codebook-fixture-cleanup-'),
  )
  const previousTemporaryFolder = process.env.TMPDIR
  process.env.TMPDIR = temporaryFolder
  try {
    // Act
    const publishing = publishedWikiFixture('.')
    // Assert
    await assert.rejects(publishing, {
      message:
        'The Wiki output cannot be the project root or a folder that contains it. A folder inside the project, such as .codebook/wiki, is accepted.',
    })
    assert.deepEqual(await readdir(temporaryFolder), [])
  } finally {
    if (previousTemporaryFolder === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTemporaryFolder
    await rm(temporaryFolder, { recursive: true, force: true })
  }
})

// Value: protects=the machine's temporary folder staying free of the Wiki project of a test whose reader failed to close; fails_when=the served Wiki's `close` stops at the reader's rejected close and never removes the project it created; why_new=review of Cycle 0045, tests-1 #14 (X7-D.3 made the failed start remove the project and left this path); seam=TMPDIR of this test process, and the fixture loaded with a reader whose close rejects
test('a served minimal Wiki whose reader fails to close still removes the temporary project it created', async () => {
  // Arrange: temporary projects are created in a folder of this test, and the fixture's reader starts but refuses to close.
  const temporaryFolder = await mkdtemp(
    join(tmpdir(), 'codebook-fixture-cleanup-'),
  )
  const previousTemporaryFolder = process.env.TMPDIR
  process.env.TMPDIR = temporaryFolder
  try {
    const fixture = await loadModule<typeof ServeMinimalWikiModule>(
      join(__dirname, 'utils', 'serveMinimalWiki.js'),
      {
        '../../deepWikiReader': {
          startDeepWikiReader: async () => ({
            url: 'http://127.0.0.1:4100/w/reader-token/index.html',
            close: async () => {
              throw new Error('The reader could not close.')
            },
          }),
        },
      },
    )
    const wiki = await fixture.serveMinimalWiki()
    const projectsWhileServed = (await readdir(temporaryFolder)).length
    // Act
    const closing = wiki.close()
    // Assert: the reader's error is passed on, and the project is gone.
    await assert.rejects(closing, { message: 'The reader could not close.' })
    assert.equal(projectsWhileServed, 1)
    assert.deepEqual(await readdir(temporaryFolder), [])
  } finally {
    if (previousTemporaryFolder === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTemporaryFolder
    await rm(temporaryFolder, { recursive: true, force: true })
  }
})

// Value: protects=the machine's temporary folder staying free of Wiki projects that a failed fixture created; fails_when=the served Wiki's reader does not start and the project written for it stays, although no caller holds its `close`; why_new=Cycle 0045 X7-D.3; seam=TMPDIR of this test process, and the fixture loaded with a reader that refuses to start
test('a served minimal Wiki whose reader does not start removes the temporary project it created', async () => {
  // Arrange: temporary projects are created in a folder of this test, and the fixture's reader refuses to start.
  const temporaryFolder = await mkdtemp(
    join(tmpdir(), 'codebook-fixture-cleanup-'),
  )
  const previousTemporaryFolder = process.env.TMPDIR
  process.env.TMPDIR = temporaryFolder
  try {
    const fixture = await loadModule<typeof ServeMinimalWikiModule>(
      join(__dirname, 'utils', 'serveMinimalWiki.js'),
      {
        '../../deepWikiReader': {
          startDeepWikiReader: async () => {
            throw new Error('The reader could not start.')
          },
        },
      },
    )
    // Act
    const serving = fixture.serveMinimalWiki()
    // Assert
    await assert.rejects(serving, { message: 'The reader could not start.' })
    assert.deepEqual(await readdir(temporaryFolder), [])
  } finally {
    if (previousTemporaryFolder === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTemporaryFolder
    await rm(temporaryFolder, { recursive: true, force: true })
  }
})
