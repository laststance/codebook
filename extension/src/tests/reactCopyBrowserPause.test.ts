import assert from 'node:assert/strict'
import { test } from 'node:test'

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

// protects=a page pause in React's copy of a server component that names only a declared server stop's breakpoint, before the operation's input (the entry load's window), is resumed and journaled as breakpoint.react-copy; fails_when=the pause is not journaled with its address and place, or ends the run; no_claim=the harness's adapter stands in for js-debug, and its load is not a Next.js entry load (the native Cursor run does)
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
})

// protects=the same pause during an operation, after its input was sent, is resumed and the run goes on to commit the server stop; fails_when=the pause ends the run as an unowned browser stop or is not journaled; no_claim=a harness adapter, not js-debug
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

// protects=the same pause between two server stops (after the first was continued) is resumed and the run reaches the second stop; fails_when=the pause ends the continuation or is not journaled; no_claim=a harness adapter, not js-debug
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
    },
  ])
})
