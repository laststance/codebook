import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import { openFakeWikiPage } from './utils/fakeWikiPage'
import { loadModule } from './utils/loadModule'

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
  // Assert: the browser's error, and the body keeps its two children.
  assert.throws(inserting, {
    name: 'NotFoundError',
    message:
      "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
  })
  assert.deepEqual(
    page.body.childNodes.map((child) =>
      typeof child === 'string' ? child : child.tagName,
    ),
    ['header', 'aside'],
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
