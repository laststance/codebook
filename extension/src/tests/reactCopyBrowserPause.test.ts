import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

type NativeParticipantsHarness = Awaited<
  ReturnType<typeof nativeParticipantsHarness>
>

/** The address React gives its copy of the declared server stop's module (the harness stop is `src/mode.ts`). */
const REACT_COPY_URL =
  'about://React/Server/webpack-internal:///(rsc)/./src/mode.ts?107'

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'breakpoint.react-copy') */
const journaled = (
  harness: NativeParticipantsHarness,
  type: string,
): unknown[] =>
  harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))

/** Waits until the run resumed the page pause or failed, and throws the failure so a test names it. */
const resumedOrFailed = (harness: NativeParticipantsHarness) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return journaled(harness, 'dap.server-breakpoint-browser-stop-resumed')
      .length
  }, 'the run resumed the page pause in React’s copy')

/** What `breakpoint.react-copy` must say for a pause at the harness stop: the copy's address, its 1-based place and the adapter id 12 of the stop's breakpoint. */
const REACT_COPY_ENTRY = {
  url: REACT_COPY_URL,
  line: 1,
  column: 1,
  hitBreakpoints: ['2:0:0:mode'],
  hitBreakpointIds: [12],
}

// protects=a page pause in React's copy of a server component that names only a declared server stop's breakpoint, before the operation's input (the entry load's window), is resumed at once (no hold) and journaled as breakpoint.react-copy; fails_when=the pause is not journaled with its address and place, is held, or ends the run; no_claim=a regression of the path before F2's fix: the page answers the registration at once at an accepted place; the harness's adapter stands in for js-debug, and its load is not a Next.js entry load
test('a page pause in React’s copy of a server component at a declared server stop is resumed and journaled before the operation’s input', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
  await resumedOrFailed(harness)
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [
    { sessionId: 'browser-session', ...REACT_COPY_ENTRY },
  ])
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [])
})

// protects=the same pause during an operation, after its input was sent, is resumed and the run goes on to commit the server stop; fails_when=the pause ends the run as an unowned browser stop or is not journaled; no_claim=a regression of the path before F2's fix (the page answers at once at an accepted place); a harness adapter, not js-debug
test('a page pause in React’s copy of a server component at a declared server stop is resumed and journaled during an operation', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
  await resumedOrFailed(harness)
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [
    { sessionId: 'browser-session', ...REACT_COPY_ENTRY },
  ])
})

// protects=the same pause between two server stops (after the first was continued) is resumed and the run reaches the second stop; fails_when=the pause ends the continuation or is not journaled; no_claim=a regression of the path before F2's fix (the page answers at once at an accepted place); a harness adapter, not js-debug
test('a page pause in React’s copy of a server component at the next server stop is resumed and journaled between two server stops', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server', 'server'])
  await harness.run.prepare()
  harness.holdNextPause()
  harness.run.action('once', 'repository-click')
  const first = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'the first server stop was captured')
  await harness.run.continue('server', first.pause)
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints.at(-1)!)
  await resumedOrFailed(harness)
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(journaled(harness, 'breakpoint.react-copy').length, 1)
})

// protects=a page pause in React's copy that also names a breakpoint of the page's own is not resumed past: it ends the run and the journal says why; fails_when=the pause is resumed although another breakpoint was hit; no_claim=a harness adapter, not js-debug
test('a page pause in React’s copy that also names a breakpoint of the page’s own is not resumed and ends the run for the unowned page stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!, [999])
  await waitUntil(() => harness.run.view().status === 'failed', 'run ended')
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser DAP stop invalidated the declared operation',
  )
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [])
  assert.deepEqual(journaled(harness, 'browser.unowned-stop'), [
    {
      sessionId: 'browser-session',
      ownsSession: true,
      ...REACT_COPY_ENTRY,
      hitBreakpointIds: [12, 999],
      awaitedStops: [],
    },
  ])
})

// protects=a page pause in the page's own script that no declared stop owns still ends the run, and the journal names the session, script address, place and breakpoint ids; fails_when=the failure leaves no browser.unowned-stop entry or the entry lacks the address or place; no_claim=a harness adapter, not js-debug
test('a page pause in the page’s own script that no stop owns ends the run and the journal names its script address and place', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act
  harness.pauseBrowserInOwnScript(
    'webpack-internal:///(app-pages-browser)/./app/ui/search.tsx',
    { lineNumber: 4, columnNumber: 2 },
  )
  await waitUntil(() => harness.run.view().status === 'failed', 'run ended')
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser DAP stop invalidated the declared operation',
  )
  assert.deepEqual(journaled(harness, 'browser.unowned-stop'), [
    {
      sessionId: 'browser-session',
      ownsSession: true,
      url: 'webpack-internal:///(app-pages-browser)/./app/ui/search.tsx',
      line: 5,
      column: 3,
      hitBreakpoints: ['page-own'],
      hitBreakpointIds: [999],
      awaitedStops: [],
    },
  ])
})

/** How late the browser's adapter answers the held registration in the tests below: longer than the 250 ms a page pause nobody owns may last, so the answer comes only after that bound would have ended the run. */
const LATE_ANSWER_MS = 400

// protects=F2 (Cycle 0135 run 22ed260d, Cycle 0136 E-F2): a page pause in React's copy that names a declared server stop's breakpoint before the browser's adapter has answered that breakpoint's registration is held until the answer, then resumed as the stop's copy, and the server stop still commits; fails_when=the pause is judged at once and ends the run ("Unowned browser DAP stop invalidated the declared operation"), or the 250 ms bound of a page pause nobody owns ends it while the answer is awaited ("Unowned browser stop remained paused"); no_claim=the harness keeps the page's first reply back to stand in for js-debug's late reply while a Next.js entry load runs, and its React copy is a stand-in script; the native E-F2 runs answered before the pause, so this order is not yet observed natively
test('a page pause in React’s copy that names a server stop’s breakpoint before the browser has answered its registration is resumed once the answer arrives', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  const answers = harness.holdBrowserAnswers()
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
  // gstack-timing-ok: real time must pass the 250 ms bound of a page pause nobody owns while the answer is held; a timer that fires late under load only delays a failure the assertions below still read
  await setTimeout(LATE_ANSWER_MS)
  const failuresBeforeAnswer = harness.run.view().failures.join('; ')
  answers.answer()
  await resumedOrFailed(harness)
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(failuresBeforeAnswer, '')
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [
    {
      sessionId: 'browser-session',
      hitBreakpointIds: [12],
      awaitedStops: [0],
      answered: true,
      resumedMeanwhile: false,
    },
  ])
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [
    { sessionId: 'browser-session', ...REACT_COPY_ENTRY },
  ])
})

// protects=the hold has a bound: a page pause in React's copy whose server stop's registration the browser never answers is judged when the bound passes and still ends the run, and the journal names the stop it waited for and each session's registration of its breakpoint; fails_when=the pause is resumed although no reply named its breakpoint, the run waits without end, or the journal leaves out the awaited stop or the registrations; no_claim=the bound is shortened to 300 ms for the test (the product waits 2 s), and the harness adapter stands in for js-debug
test('a page pause in React’s copy whose server stop’s registration the browser never answers still ends the run once the hold’s bound passes', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'], {
    runtimeConstants: { BROWSER_STOP_REGISTRATION_ANSWER_MS: 300 },
  })
  harness.holdBrowserAnswers()
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
  await waitUntil(() => harness.run.view().status === 'failed', 'run ended')
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser DAP stop invalidated the declared operation',
  )
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [
    {
      sessionId: 'browser-session',
      hitBreakpointIds: [12],
      awaitedStops: [0],
      answered: false,
      resumedMeanwhile: false,
    },
  ])
  assert.deepEqual(journaled(harness, 'browser.unowned-stop'), [
    {
      sessionId: 'browser-session',
      ownsSession: true,
      ...REACT_COPY_ENTRY,
      awaitedStops: [0],
    },
  ])
  assert.deepEqual(journaled(harness, 'browser.unowned-stop-registrations'), [
    {
      stops: [
        {
          declaredIndex: 0,
          sessions: [
            {
              sessionId: 'browser-session',
              state: 'awaiting',
              answeredIds: [],
            },
            {
              sessionId: 'server-session',
              state: 'acknowledged',
              breakpointId: 12,
              answeredIds: [12],
            },
          ],
        },
      ],
      provisional: [],
      retiredProvisionalIds: {},
    },
  ])
})

// protects=E-F2's diagnosis: a page pause that ends the run because it paused out of turn (no rule owns it and the run's next stop is a server stop) journals its script address, place and breakpoint ids too, as the native E-F2 run's failure did not; fails_when=the failure "Unexpected or additional browser stop invalidated the declared operation" leaves no browser.unowned-stop entry; no_claim=a harness adapter, not js-debug
test('a page pause that ends the run out of turn before the operation’s input journals its script address, place and breakpoint ids', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  // Act
  harness.pauseBrowserInOwnScript(
    'webpack-internal:///(app-pages-browser)/./app/ui/invoices/pagination.tsx',
    { lineNumber: 9, columnNumber: 4 },
  )
  await waitUntil(() => harness.run.view().status === 'failed', 'run ended')
  // Assert
  assert.match(
    harness.run.view().failures[0] ?? '',
    /^Unexpected or additional browser stop invalidated the declared operation/,
  )
  assert.deepEqual(journaled(harness, 'browser.unowned-stop'), [
    {
      sessionId: 'browser-session',
      ownsSession: true,
      url: 'webpack-internal:///(app-pages-browser)/./app/ui/invoices/pagination.tsx',
      line: 10,
      column: 5,
      hitBreakpoints: ['page-own'],
      hitBreakpointIds: [999],
      awaitedStops: [],
    },
  ])
})

// protects=F2's located cause (Cycle 0136 E-F2, Cursor run b7e60f6b on build ff9c3973): the page answered the registration of the server stop app/ui/invoices/table.tsx:17 with id 9 at a place the stop refuses, then paused in React's copy of the module under id 9; that pause is resumed as the stop's copy and the server stop still commits; fails_when=the refused answer leaves the id unknown and the pause ends the run ("Unowned browser DAP stop invalidated the declared operation", natively "Unexpected or additional browser stop invalidated the declared operation"); no_claim=the harness page answers every registration at line 40 to stand in for js-debug's binding in React's copy, and its copy is a stand-in script (the native Cursor run shows the real answer)
test('a page pause in React’s copy under the id the page gave a server stop’s breakpoint at a refused place is resumed as that stop’s copy', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.answerBrowserRegistrationsAt(40, 1)
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
  await resumedOrFailed(harness)
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [
    { sessionId: 'browser-session', ...REACT_COPY_ENTRY },
  ])
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [])
})

// protects=a page pause held for the page's registration answer whose runtime resumed meanwhile is journaled and dropped: the run neither resumes nor judges a pause that no longer exists, and the server stop still commits; fails_when=the held event is judged after the resume (a continue sent for an ended pause, or the run ended as an unowned page stop); no_claim=the harness reports the page's resume directly, not a js-debug or learner resume
test('a page pause held for the page’s registration answer is dropped when the page resumed meanwhile', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  const answers = harness.holdBrowserAnswers()
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
  // Act
  harness.emitResume('browser')
  answers.answer()
  await waitUntil(
    () => journaled(harness, 'breakpoint.browser-stop-held').length,
    'the held page pause was released',
  )
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [
    {
      sessionId: 'browser-session',
      hitBreakpointIds: [12],
      awaitedStops: [0],
      answered: true,
      resumedMeanwhile: true,
    },
  ])
  assert.deepEqual(
    journaled(harness, 'dap.server-breakpoint-browser-stop-resumed'),
    [],
  )
})

// protects=Cycle 0136 review (Codex, pass 1): natively the adapter's `stopped` of a page pause at a server stop's breakpoint is read before the page's own events (Cycle 0046), so the resume of the runtime's instrumentation pause before the breakpoint pause can arrive while that `stopped` is held for the page's registration answer; that resume does not end the held pause: the run resumes the page once the answer arrives and the server stop commits; fails_when=the instrumentation pause's resume drops the held `stopped` (journaled resumedMeanwhile: true), the page stays paused at the breakpoint and the run ends "Unowned browser stop remained paused"; no_claim=the harness sends the runtime's events and the adapter's `stopped` in the order of Cycle 0046's native journals and holds the page's reply to stand in for js-debug's late answer; its instrumentation pause stands in for js-debug's source-map pause, and this order with a held answer is not observed natively
test('a page pause held for the page’s registration answer is resumed when only the runtime’s instrumentation pause before it resumed meanwhile', async (context) => {
  // Arrange: the page's answers are held, the operation's input is sent, and the page is in the runtime's instrumentation pause.
  const harness = await nativeParticipantsHarness(context, ['server'])
  const answers = harness.holdBrowserAnswers()
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  harness.announceScript(
    'browser',
    'chunk',
    'webpack-internal:///(app-pages-browser)/./app/ui/chunk.ts',
  )
  harness.emitUnannouncedPause('browser', {
    scriptId: 'chunk',
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: [],
    reason: 'instrumentation',
  })
  // Act: the adapter's `stopped` at the server breakpoint is read first, then the instrumentation pause's resume, the page's pause at the breakpoint and the page's answer.
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  harness.emitResume('browser')
  stub.paused()
  answers.answer()
  await resumedOrFailed(harness)
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [
    {
      sessionId: 'browser-session',
      hitBreakpointIds: [12],
      awaitedStops: [0],
      answered: true,
      resumedMeanwhile: false,
    },
  ])
})

// protects=the same for js-debug's own pause at the first position of the declared stop's module, in the order Cycle 0046's native journals show (the adapter's `stopped`, then the debugger's pause at the module's first position, which it resumes itself, then the pause at the breakpoint): that resume does not end the held `stopped` either, and the server stop commits; fails_when=the module-entry pause's resume drops the held `stopped` (journaled resumedMeanwhile: true) and the run ends "Unowned browser stop remained paused"; no_claim=the harness stands in for js-debug with the entry breakpoint id of Cycle 0046's journals (br:2:0:0: and the file's base name) and holds the page's reply; this order with a held answer is not observed natively
test('a page pause held for the page’s registration answer is resumed when only the debugger’s own pause at the module’s first position resumed meanwhile', async (context) => {
  // Arrange: the page's answers are held and the operation's input is sent.
  const harness = await nativeParticipantsHarness(context, ['server'])
  const answers = harness.holdBrowserAnswers()
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(() => harness.run.view().operation?.inputDispatched, 'input')
  // Act: the adapter's `stopped` at the server breakpoint is read first; then the debugger's own pause at the stub's first position and its resume, the page's pause at the breakpoint and the page's answer.
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  harness.emitUnannouncedPause('browser', {
    scriptId: 'server-module-stub',
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['br:2:0:0:mode'],
  })
  harness.emitResume('browser')
  stub.pausedAtBreakpoint(10, 115)
  answers.answer()
  await resumedOrFailed(harness)
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the server stop was captured')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.browser-stop-held'), [
    {
      sessionId: 'browser-session',
      hitBreakpointIds: [12],
      awaitedStops: [0],
      answered: true,
      resumedMeanwhile: false,
    },
  ])
})

// Value: protects=F2's journal cap: a page that keeps pausing in React's copies is still resumed every time but journals breakpoint.react-copy only up to the shared cap; fails_when=the journal grows past the cap or a copy past it is no longer resumed; why_new=the cap of the page-side entry is separate from the server-side copy-hit cap test; seam=none; no_claim=js-debug's real pause rate
test('page pauses in React’s copies past the journal cap are still resumed but not journaled', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  // Three pauses past the shared cap of 100 entries.
  const copies = 103
  // Act
  for (let copy = 1; copy <= copies; copy++) {
    harness.pauseBrowserInReactServerCopy(harness.breakpoints[0]!)
    await waitUntil(() => {
      const view = harness.run.view()
      if (view.failures.length) throw new Error(view.failures.join('; '))
      return (
        journaled(harness, 'dap.server-breakpoint-browser-stop-resumed')
          .length >= copy
      )
    }, `page pause ${copy} was resumed`)
  }
  // Assert
  assert.equal(journaled(harness, 'breakpoint.react-copy').length, 100)
  assert.equal(harness.run.view().failures.length, 0)
})
