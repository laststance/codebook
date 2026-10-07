import assert from 'node:assert/strict'
import { test } from 'node:test'

import { z } from 'zod'

import { SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

type NativeParticipantsHarness = Awaited<
  ReturnType<typeof nativeParticipantsHarness>
>

/** Waits until a participant's declared stop is committed, and fails with the run's own failure when the run ends first. @example const server = await pauseReady(harness, 'server') */
const pauseReady = async (
  harness: NativeParticipantsHarness,
  name: 'server' | 'browser',
) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants[name]?.snapshot
  }, `${name} committed stop`)

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'breakpoint.rule-from-break-locations') */
const journaled = (
  harness: NativeParticipantsHarness,
  type: string,
): unknown[] =>
  harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))

/** What a `breakpoint.pause-binding` entry says about the editor's answer and the column the run completed it with; the answer's file and the stop's own places are left out. */
const pauseBindingSchema = z.object({
  observed: z.object({
    id: z.number(),
    verified: z.boolean(),
    line: z.number(),
    column: z.number().optional(),
  }),
  completedColumn: z.number().optional(),
  columnFrom: z.string().optional(),
})

const MAPPING_HINTS =
  'These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.'

/** The script URL the harness's server module is announced under. */
const SERVER_MODULE_URL = 'webpack-internal:///(action-browser)/./src/mode.ts'

/** A function whose head spans lines 1 to 3 and whose first statement begins at 4:3; the sealed map puts generated 3:2 at source 4:3. */
const FUNCTION_HEAD_MODULE = {
  source:
    'export async function authenticate(\n  mode,\n) {\n  return mode\n}\n',
  mappings: 'AAAA;AACA;AACA;EACE;AACF',
}

/**
 * A module as a server action build emits it: the source, a documented function over lines 4 to 8, and one more generated line, a registration call the build appends at the module's end and maps to the function's name at 4:23.
 * Up to the function's end generated line n is source line n + 1: the comment's last line at generated 2:1 is source 3:2, the head 4:8, `mode,` at generated 4:2 is 5:3, `) {` 6:1, `return mode` at generated 6:2 is 7:3, `}` 8:1. Generated 8:0, the appended call, is source 4:23.
 */
const APPENDED_REGISTRATION_MODULE = {
  source:
    '/**\n * Authenticates.\n */\nexport async function authenticate(\n  mode,\n) {\n  return mode\n}\n',
  javascript:
    '/**\n * Authenticates.\n */\nexport async function authenticate(\n  mode,\n) {\n  return mode\n}\nregisterServerReference(authenticate)\n',
  mappings: ';;CAEC;OACM,eAAe;EACpB;AACF;EACE;AACF;AAJsB',
}

/** The break locations a debugger lists for {@link APPENDED_REGISTRATION_MODULE}: the function's first statement (source 7:3) and the appended registration call (source 4:23). */
const APPENDED_REGISTRATION_BREAK_LOCATIONS = [
  { lineNumber: 6, columnNumber: 2 },
  { lineNumber: 8, columnNumber: 0 },
]

/** Declares a participant's stop at 3:1 of {@link APPENDED_REGISTRATION_MODULE}, the line above the function, in a citation over lines 1 to 8. @example nativeParticipantsHarness(context, ['server'], appendedRegistration('server')) */
const appendedRegistration = (name: 'server' | 'browser') => ({
  mappings: { [name]: APPENDED_REGISTRATION_MODULE.mappings },
  fixture: {
    [name]: {
      source: APPENDED_REGISTRATION_MODULE.source,
      javascript: APPENDED_REGISTRATION_MODULE.javascript,
      citationEndLine: 8,
      declaredLine: 3,
    },
  },
})

// Cycle 0046 (row 76, check f21a): red while the binding read at a pause had to name its column. Both editors drop the column from the adapter's news about a breakpoint requested at column 1, so the stop declared at 27:1 that paused at 32:11 ended its run with "Pending server breakpoint did not bind to the captured source".
test('a server stop requested at column 1 whose binding the editor answers without a column at its pause is captured at the place the adapter reported, and the run goes on', async (context) => {
  // Arrange: the stop is declared at 1:1 on a function head and stays pending. After the input the adapter verifies it at 4:3 by news, the editor keeps no column of that news, and the runtime pauses at 4:3.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: FUNCTION_HEAD_MODULE.mappings },
    fixture: {
      server: { source: FUNCTION_HEAD_MODULE.source, citationEndLine: 5 },
    },
  })
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 3, columnNumber: 2 },
  ])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 3, 2)
  harness.bindAt('server', 4, 3)
  harness.movePausedFrame(4, 3)
  harness.expireSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act
  harness.announceBreakpointVerified('server', 4, 3)
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after the stop whose binding named no column',
  )
  await harness.run.stop()
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [4, 3])
  assert.deepEqual(
    pauseBindingSchema.parse(journaled(harness, 'breakpoint.pause-binding')[0]),
    {
      observed: { id: 12, verified: true, line: 4 },
      completedColumn: 3,
      columnFrom: 'adapter',
    },
  )
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
})

// Cycle 0046 (row 76): the second source of the column. Red while a binding without a column was refused although the program stands on its line.
test('a server stop whose binding names no column and whose adapter reported none is captured at the paused frame’s column on the binding’s line', async (context) => {
  // Arrange: the stop is declared at 1:1 and stays pending; the adapter's news names line 1 and no column, and the runtime pauses at 1:1.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.announceBreakpointVerified('server', 1)
  // Act
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.deepEqual(
    pauseBindingSchema.parse(journaled(harness, 'breakpoint.pause-binding')[0]),
    {
      observed: { id: 12, verified: true, line: 1 },
      completedColumn: 1,
      columnFrom: 'paused-frame',
    },
  )
})

// Cycle 0046 (row 76): the line of a binding is never taken from the paused frame; red if a column-less binding borrowed the column of a frame on another line and the run then named the wrong check.
test('a server stop whose binding names another line than the paused frame and no column is still refused as not bound to the captured source', async (context) => {
  // Arrange: the stop is declared at 1:1 in a citation over lines 1 to 2; the adapter's news names line 2 and no column, and the runtime pauses on line 1.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: 'AAAA;AACA' },
    fixture: { server: { citationEndLine: 2 } },
  })
  await harness.run.prepare()
  harness.bindAt('server', 2, 1)
  harness.announceBreakpointVerified('server', 2)
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the stop was refused or captured')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: Pending server breakpoint did not bind to the captured source',
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Cycle 0046 (row 76, the browser branch of the same read): red while a moved binding without a column was not read as moved, so the stop kept its place from arming and the run ended with "DAP frame differs from the bound configured source position".
test('a browser stop requested at column 1 whose binding the debugger moves to the next line after it was armed is captured there, although the editor keeps no column of that news', async (context) => {
  // Arrange: the browser stop is declared and armed at 1:1 in a citation over lines 1 to 2. The adapter then reports it verified at 2:1 by news, and the page pauses there.
  const harness = await nativeParticipantsHarness(
    context,
    ['browser', 'server'],
    {
      mappings: { browser: 'AAAA;AACA' },
      fixture: { browser: { citationEndLine: 2 } },
    },
  )
  await harness.run.prepare()
  harness.bindAt('browser', 2, 1)
  harness.announceBreakpointVerified('browser', 2, 1)
  harness.pauseAt('browser', 1, 0)
  harness.movePausedFrame(2, 1)
  harness.expireSourceBoundWait()
  // Act
  harness.run.action('once', 'repository-click')
  const browser = await pauseReady(harness, 'browser')
  // Assert
  assert.deepEqual([browser.source.line, browser.source.column], [2, 1])
})

// Cycle 0046 (row 76, the held pause of a browser stop): red while the binding read again for a held pause had to name its column: the pause on the moved column was adopted only when the 3 s wait ended, and then refused with "DAP frame differs from the bound configured source position".
test('a browser stop requested at column 1 whose binding the debugger moves along its line is taken at its held pause without waiting, by the column the adapter reported', async (context) => {
  // Arrange: the browser stop is declared and armed at 1:1; generated 0:6 is source 1:7. The adapter then reports the breakpoint verified at 1:7 by news and the page pauses there; the wait for the stop's own pause never ends by itself.
  const harness = await nativeParticipantsHarness(
    context,
    ['browser', 'server'],
    { mappings: { browser: 'AAAA,MAAM' }, fixture: { browser: {} } },
  )
  await harness.run.prepare()
  harness.bindAt('browser', 1, 7)
  harness.announceBreakpointVerified('browser', 1, 7)
  harness.pauseAt('browser', 0, 6)
  harness.movePausedFrame(1, 7)
  harness.holdSourceBoundWait()
  // Act
  harness.run.action('once', 'repository-click')
  const browser = await pauseReady(harness, 'browser')
  // Assert
  assert.deepEqual([browser.source.line, browser.source.column], [1, 7])
  assert.equal(
    harness.waitSubstituted(SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION),
    true,
  )
})

// Cycle 0046 (row 76, a browser stop while it is armed): red while a verified binding had to name its column: a breakpoint requested at column 1 that the adapter verifies by news after its reply never counted as verified, and arming ended at the 20 s bound.
test('a browser stop requested at column 1 that the adapter verifies only by news after its reply is armed at the place the adapter reported', async (context) => {
  // Arrange: the adapter answers the registration as unverified and at once reports the breakpoint verified at 1:3; generated 0:2 is source 1:3, where the page pauses.
  const harness = await nativeParticipantsHarness(
    context,
    ['browser', 'server'],
    { mappings: { browser: 'AAAA,EAAE' }, fixture: { browser: {} } },
  )
  harness.verifyRegistrationsByNews('browser', 1, 3)
  harness.bindAt('browser', 1, 3)
  harness.pauseAt('browser', 0, 2)
  harness.movePausedFrame(1, 3)
  // Act
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const browser = await pauseReady(harness, 'browser')
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.bound')[0], {
    verified: true,
    line: 1,
    column: 3,
    requested: { line: 1, column: 1 },
    declared: { line: 1, column: 1 },
  })
  assert.deepEqual([browser.source.line, browser.source.column], [1, 3])
})

// Cycle 0046 (row 77, check f21b): red while every source line with a break location counted, wherever that location lay in the generated module: the stop declared at 26:1, above a server action, and bound at 32:11 was refused with "line 27 between the declared line 26 and line 32 has a break location", for the registration call the build appends at the module's end and maps to the function's name.
test('a server stop declared on the line above a function whose line a statement at the module’s end is mapped to is captured at the function’s first statement, and the journal names only the lines on the way', async (context) => {
  // Arrange: the stop is declared at 3:1 and stays pending. After the input the adapter verifies it at 7:3 by news, before the run has seen the module, and the runtime pauses there (generated 6:2). The debugger lists two break locations: the first statement, and the appended call that the map puts on line 4.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    appendedRegistration('server'),
  )
  harness.listPossibleBreakLocations(
    'server',
    APPENDED_REGISTRATION_BREAK_LOCATIONS,
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 6, 2)
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.expireSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act
  harness.announceBreakpointVerified('server', 7, 3)
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after the stop bound past the function head',
  )
  await harness.run.stop()
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [7, 3])
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'server',
      declared: { line: 3, column: 1 },
      boundLine: 7,
      breakLocationLines: [7],
      generatedPlaces: {
        requested: { line: 3, column: 2 },
        bound: { line: 7, column: 3 },
      },
    },
  ])
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
})

// Cycle 0046 (row 77, the judgement before any pause): red for the same cause when the adapter's news arrives after the run has seen the module, so the news is judged as it arrives, by the sealed map's place of the reported line and column.
test('a server stop above a function whose pending breakpoint the adapter reports verified at the first statement is matched at its pause, judged once by the place the map gives that report', async (context) => {
  // Arrange: as above, but the module is announced before the adapter's news, and the runtime pauses only once the run has judged that news.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    appendedRegistration('server'),
  )
  harness.listPossibleBreakLocations(
    'server',
    APPENDED_REGISTRATION_BREAK_LOCATIONS,
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 6, 2)
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  // Act
  harness.announceBreakpointVerified('server', 7, 3)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return journaled(harness, 'breakpoint.rule-from-break-locations').length
  }, 'news judged by the break locations')
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert: one judgement, one request for the whole module's break locations, and no held pause.
  assert.deepEqual([server.source.line, server.source.column], [7, 3])
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'server',
      declared: { line: 3, column: 1 },
      boundLine: 7,
      breakLocationLines: [7],
      generatedPlaces: {
        requested: { line: 3, column: 2 },
        bound: { line: 7, column: 3 },
      },
    },
  ])
  assert.equal(
    harness.breakLocationRequests.filter((request) => !request.end).length,
    1,
  )
  assert.deepEqual(journaled(harness, 'cdp.held-pause-adopted'), [])
})

// Cycle 0046 (found with row 77 in the journals of checks f21a and f21b): red while news that arrived before the run's own channel announced the module was never judged by the break locations, so the stop's pause was held for the whole 3 s wait and adopted only then.
test('a server stop whose pending breakpoint the adapter reports verified before the run has seen its module is judged when the module is announced, and matched at its pause without waiting', async (context) => {
  // Arrange: the adapter's news names 7:3 before the module is announced, so the source map alone refuses it. The wait for the stop's own pause never ends by itself.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    appendedRegistration('server'),
  )
  harness.listPossibleBreakLocations(
    'server',
    APPENDED_REGISTRATION_BREAK_LOCATIONS,
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 6, 2)
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.holdSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceBreakpointVerified('server', 7, 3)
  // Act
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return journaled(harness, 'breakpoint.rule-from-break-locations').length
  }, 'news judged by the break locations')
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [7, 3])
  assert.deepEqual(journaled(harness, 'cdp.held-pause-adopted'), [])
})

// Cycle 0046 (row 77, a browser stop while it is armed): red for the same cause where a browser binding is judged before any pause: arming ended with "line 4 between the declared line 3 and line 7 has a break location".
test('a browser stop declared on the line above a function whose line a statement at the module’s end is mapped to is armed and captured at the function’s first statement', async (context) => {
  // Arrange: the browser stop is declared at 3:1; the debugger verifies it at 7:3 and lists the first statement and the appended call as break locations.
  const harness = await nativeParticipantsHarness(
    context,
    ['browser', 'server'],
    appendedRegistration('browser'),
  )
  harness.listPossibleBreakLocations(
    'browser',
    APPENDED_REGISTRATION_BREAK_LOCATIONS,
  )
  harness.bindAt('browser', 7, 3)
  harness.pauseAt('browser', 6, 2)
  harness.movePausedFrame(7, 3)
  // Act
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const browser = await pauseReady(harness, 'browser')
  // Assert
  assert.deepEqual([browser.source.line, browser.source.column], [7, 3])
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'browser',
      declared: { line: 3, column: 1 },
      boundLine: 7,
      breakLocationLines: [7],
      generatedPlaces: {
        requested: { line: 3, column: 2 },
        bound: { line: 7, column: 3 },
      },
    },
  ])
})

// Cycle 0046 (row 77): the refusal for a real case stays. Red while the refusal named line 4, whose break location lies at the module's end, instead of the line the debugger passed over.
test('a server stop bound past a break location between the two generated places is refused naming that line, not the line of the statement at the module’s end', async (context) => {
  // Arrange: as the first case, but the debugger also lists a break location on the parameter line (generated 4:2, source 5:3), between the requested place and the binding.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    appendedRegistration('server'),
  )
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 4, columnNumber: 2 },
    ...APPENDED_REGISTRATION_BREAK_LOCATIONS,
  ])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 6, 2)
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.expireSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act
  harness.announceBreakpointVerified('server', 7, 3)
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the stop was refused or captured')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:3 bound at 7:3, refused: line 5 between the declared line 3 and line 7 has a break location. Frozen source map positions in the selected citation: 3:2, 4:8, 5:3, 6:1, 7:3, 8:1. ${MAPPING_HINTS}`,
  )
  // The refusal judged when the module was announced stands when the receipt is read at the pause: one entry.
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'server',
      declared: { line: 3, column: 1 },
      boundLine: 7,
      breakLocationLines: [5, 7],
      generatedPlaces: {
        requested: { line: 3, column: 2 },
        bound: { line: 7, column: 3 },
      },
    },
  ])
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Cycle 0046 (row 131): red while a binding the break locations refuse was judged again at every read of its receipt, so one refused stop left two equal `breakpoint.rule-from-break-locations` entries and asked the debugger twice.
test('a server stop whose binding the break locations refuse leaves one journal entry of that judgement and one request for the break locations, although its receipt is read again at the pause', async (context) => {
  // Arrange: the function head over lines 1 to 3 is mapped, and the debugger lists a break location on the parameter line (generated 1:2) and on the first statement (generated 3:2). The module is announced, then the adapter's news names 4:3, which is judged and refused as it arrives; the runtime pauses there afterwards.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: FUNCTION_HEAD_MODULE.mappings },
    fixture: {
      server: { source: FUNCTION_HEAD_MODULE.source, citationEndLine: 5 },
    },
  })
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 1, columnNumber: 2 },
    { lineNumber: 3, columnNumber: 2 },
  ])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 3, 2)
  harness.bindAt('server', 4, 3)
  harness.movePausedFrame(4, 3)
  harness.expireSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  harness.announceBreakpointVerified('server', 4, 3)
  await waitUntil(
    () => journaled(harness, 'breakpoint.rule-from-break-locations').length,
    'news judged by the break locations',
  )
  // Act
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the stop was refused or captured')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:1 bound at 4:3, refused: line 2 between the declared line 1 and line 4 has a break location. Frozen source map positions in the selected citation: 1:1, 2:1, 3:1, 4:3, 5:1. ${MAPPING_HINTS}`,
  )
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'server',
      declared: { line: 1, column: 1 },
      boundLine: 4,
      breakLocationLines: [2, 4],
      generatedPlaces: {
        requested: { line: 1, column: 1 },
        bound: { line: 4, column: 3 },
      },
    },
  ])
  assert.equal(
    harness.breakLocationRequests.filter((request) => !request.end).length,
    1,
  )
})

// Cycle 0046 (row 77): when the binding's generated place cannot be known, every line with a break location counts, as before the generated places were compared; red if an unknown place were read as "nothing between".
test('a server stop whose reported place the debugger lists no break location at is judged by every line with a break location, and no input is sent', async (context) => {
  // Arrange: the module is announced and the adapter reports the pending breakpoint verified at 7:1, a column the debugger lists no break location at (its only one on line 7 is 7:3).
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    appendedRegistration('server'),
  )
  harness.listPossibleBreakLocations(
    'server',
    APPENDED_REGISTRATION_BREAK_LOCATIONS,
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  harness.announceBreakpointVerified('server', 7, 1)
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.operation?.inputDispatched
  }, 'the action failed or sent its input')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:3 bound at 7:1, refused: line 4 between the declared line 3 and line 7 has a break location. Frozen source map positions in the selected citation: 3:2, 4:8, 5:3, 6:1, 7:3, 8:1. ${MAPPING_HINTS}`,
  )
  // The refusal judged when the news arrived stands when the receipt is read before the input: one entry.
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'server',
      declared: { line: 3, column: 1 },
      boundLine: 7,
      breakLocationLines: [4, 7],
    },
  ])
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
})

// Cycle 0046 (row 77): at a pause the program's own generated place is the binding's. Red if the judgement made from the map's place before the pause stood although the program is paused at a later copy of that statement, past a break location.
test('a server stop judged from its reported place before the pause is judged once more when it pauses at another generated place, and refused for the break location passed on the way there', async (context) => {
  // Arrange: the build emits the function's statement twice (generated 3:2 and 6:2 are both source 4:3) and the parameter's default between them (generated 5:0, source 2:3). The adapter's news names 4:3, which the map first puts at generated 3:2 with nothing before it; the runtime then pauses at the second copy.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: 'AAAA;EACE;AACF;EACE;AACF;AAHE;EAEA' },
    fixture: {
      server: {
        source:
          'export async function authenticate(\n  mode = fallback(),\n) {\n  return mode\n}\n',
        javascript:
          'export async function authenticate(\n  mode,\n) {\n  return mode\n}\nmode = fallback()\n  return mode\n',
        citationEndLine: 5,
      },
    },
  })
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 3, columnNumber: 2 },
    { lineNumber: 5, columnNumber: 0 },
    { lineNumber: 6, columnNumber: 2 },
  ])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 6, 2)
  harness.bindAt('server', 4, 3)
  harness.movePausedFrame(4, 3)
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  harness.announceBreakpointVerified('server', 4, 3)
  await waitUntil(
    () => journaled(harness, 'breakpoint.rule-from-break-locations').length,
    'news judged by the break locations',
  )
  // Act
  harness.emitPause('server')
  await waitUntil(() => {
    const view = harness.run.view()
    return view.status === 'failed' || view.snapshots.length > 0
  }, 'the stop was refused or captured')
  await harness.run.stop()
  // Assert: the first judgement accepted the reported place, the second refused the place of the pause.
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:1 bound at 4:3, refused: line 2 between the declared line 1 and line 4 has a break location. Frozen source map positions in the selected citation: 1:1, 2:3, 3:1, 4:3, 5:1. ${MAPPING_HINTS}`,
  )
  assert.deepEqual(journaled(harness, 'breakpoint.rule-from-break-locations'), [
    {
      participant: 'server',
      declared: { line: 1, column: 1 },
      boundLine: 4,
      breakLocationLines: [4],
      generatedPlaces: {
        requested: { line: 1, column: 1 },
        bound: { line: 4, column: 3 },
      },
    },
    {
      participant: 'server',
      declared: { line: 1, column: 1 },
      boundLine: 4,
      breakLocationLines: [2, 4],
      generatedPlaces: {
        requested: { line: 1, column: 1 },
        bound: { line: 7, column: 3 },
      },
    },
  ])
})

// Cycle 0046 (row 162): red while `dap.server-breakpoint-browser-stop-resumed` was journaled before the `continue` was sent, so a resume the adapter refused left an entry that said the page was resumed.
// Cycle 0046 (row 268): red while the run ended with the adapter's bare text, "Error: Thread is not paused", which names neither the page's pause nor the declared stop. The page paused before the action here, so the run read only the debugger's report of the stop and names no place.
test('a page pause at a server stop’s breakpoint whose resume the adapter refuses leaves the request in the journal and no entry that says resumed, and the run ends naming the declared stop and the refusal', async (context) => {
  // Arrange: the server stop is armed and its breakpoint is set in the page too; the browser's adapter will refuse the run's resume.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.refuseStubResume()
  // Act: the page pauses in its stub of the server module, naming the server breakpoint.
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the run ended with the adapter’s refusal',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: The debugger reported that the page paused at the breakpoint of declared server stop src/mode.ts:1, which it also sets in the page\'s copy of that module. Codebook asked the debugger to resume the page, and the request failed: "Thread is not paused". Keep the declaration and start a new run.',
  )
  assert.deepEqual(
    journaled(harness, 'dap.server-breakpoint-browser-resume-requested'),
    [
      {
        participant: 'browser',
        threadId: 1,
        hitBreakpointIds: [12],
        declared: 'src/mode.ts:1',
        inputDispatched: false,
      },
    ],
  )
  assert.deepEqual(
    journaled(harness, 'dap.server-breakpoint-browser-stop-resumed'),
    [],
  )
})

// Cycle 0046 (row 271): the order the help states for the entries of a page pause the run resumes itself. Red if the request were journaled after the page's resume, or the answered entry before the debugger answered: here the debugger resumes the page first and answers the request afterwards, so the answered entry follows the page's resume.
test('the journal of a page pause at a server stop’s breakpoint holds Codebook’s resume request before the page’s resume, and the answered entry only after the debugger’s answer, which follows the page’s resume here', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet; the debugger answers the run's resume at once, after it resumed the page.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act: the page pauses in its stub of the server module, naming the server breakpoint, and the run resumes it.
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return journaled(harness, 'dap.server-breakpoint-browser-stop-resumed')
      .length
  }, 'the debugger answered the run’s resume')
  // Assert
  const entriesOfThePause = harness.run
    .view()
    .events.map((event) => event.type)
    .filter((type) =>
      [
        'dap.server-breakpoint-browser-resume-requested',
        'cdp.browser-adapter-pause-retired',
        'dap.server-breakpoint-browser-stop-resumed',
      ].includes(type),
    )
  assert.deepEqual(entriesOfThePause, [
    'dap.server-breakpoint-browser-resume-requested',
    'cdp.browser-adapter-pause-retired',
    'dap.server-breakpoint-browser-stop-resumed',
  ])
})

// Cycle 0046 (row 157): red while a page pause that comes after the action was accepted, in a run without browser stops, kept its 250 ms timer although the run itself was resuming it: a resume slower than that ended the run with "Unowned browser stop remained paused".
test('a page pause at a server stop’s breakpoint after the action was accepted is not ended by the 250 ms bound of an unowned page pause while the run’s own resume is under way, in a run that declares only a server stop', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet; the browser adapter answers the run's resume only when the test lets it. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const resume = harness.holdStubResume()
  // Act: the page pauses in its stub of the server module, the run sends its resume, and 300 ms pass before the adapter answers it.
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  harness.advance(300)
  const failuresWhilePaused = harness.run.view().failures.join('; ')
  resume.release()
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(failuresWhilePaused, '')
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.equal(
    journaled(harness, 'cdp.browser-adapter-pause-retired').length,
    1,
  )
})

// Cycle 0046 (row 157, the same pause in a run that declares a browser stop too): red while the held page pause was judged by how long the debugger holds a pause of its own, although the run itself resumed it: a resume slower than that bound ended the run with "Manual or competing resume invalidated live pause: ...".
test('a page pause at a server stop’s breakpoint after the action was accepted is not taken for a competing resume when the run’s own resume is slow, in a run that declares a browser stop too', async (context) => {
  // Arrange: as above, with a browser stop declared after the server stop, so the page pause is held instead of timed.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const resume = harness.holdStubResume()
  // Act: the page pauses in its stub, the run sends its resume, and 4 s pass before the adapter answers it.
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  harness.advance(4_000)
  resume.release()
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length ||
      harness.run.view().failures.length,
    'the adapter answered the resume',
  )
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.deepEqual(journaled(harness, 'cdp.unannounced-pause-resumed-late'), [])
})

// Cycle 0046 (row 157, the order the native journal shows: the adapter's `stopped` is read before the runtime's pause): red while a page pause read after the run had already sent its resume still started the 250 ms timer of an unowned page pause.
test('a page pause at a server stop’s breakpoint that is read only after the run sent its resume is not bounded as a pause nobody owns', async (context) => {
  // Arrange: the action is accepted; the adapter's `stopped` names the server breakpoint, the run sends its resume, and the adapter answers it only when the test lets it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const resume = harness.holdStubResume()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  // Act: the runtime's pause is read now, and 300 ms pass before the adapter answers the resume.
  stub.paused()
  harness.advance(300)
  const failuresWhilePaused = harness.run.view().failures.join('; ')
  resume.release()
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(failuresWhilePaused, '')
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
})

// Cycle 0046 (row 268): red while nothing named the page's pause once the run had sent its own resume of it: with the resume never answered, the action's deadline ended the run with "... declared server stop src/mode.ts:1 (registration pending) was not hit within 20 s of the accepted action; the server action's request may still be running (a first compilation after a cold start can take longer), or its line does not execute for this input. Start a new run; if the stop is not hit again, declare a line this action executes.", while the page stood paused at that stop's breakpoint waiting for Codebook's resume.
test('an action whose page stays paused at a server stop’s breakpoint because the debugger never answers Codebook’s resume ends at its deadline naming that pause, the declared stop and the unanswered resume, and not a line to declare, in a run that declares only a server stop', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet; the browser adapter never answers the run's resume. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.holdStubResume()
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  // Act: the 20 s of the action's deadline pass.
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 1:1, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run.",
  )
  assert.deepEqual(
    journaled(harness, 'dap.server-breakpoint-browser-stop-resumed'),
    [],
  )
})

// Cycle 0046 (row 268, the same pause in a run that declares a browser stop too): red while the deadline also added "The browser is paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 1:1 without a debugger stop.", although a stop announced that pause and the run was resuming it.
test('an action whose page stays paused at a server stop’s breakpoint because the debugger never answers Codebook’s resume ends at its deadline naming that pause once, as the pause Codebook is resuming and not as one without a debugger stop, in a run that declares a browser stop too', async (context) => {
  // Arrange: as above, with a browser stop declared after the server stop, so the page pause is held instead of timed.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.holdStubResume()
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  // Act: the 20 s of the action's deadline pass.
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 1:1, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 268, a resume the debugger answered): the deadline's sentence says only what was observed; red if a request the debugger answered, while the page reported no resume, were said to have had no answer.
test('an action whose page stays paused at a server stop’s breakpoint although the debugger answered Codebook’s resume ends at its deadline saying that the debugger answered and the page reported no resume', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet; the browser adapter answers the run's resume, and the page does not go on. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.answerStubResumeWithoutResuming()
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length,
    'the debugger answered the run’s resume',
  )
  // Act: the 20 s of the action's deadline pass.
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 1:1, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and the debugger answered, but the page reported no resume. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 268, the refused resume of a pause the run has read): red while the run ended with the adapter's bare text, "Error: Thread is not paused".
test('a page pause at a server stop’s breakpoint after the action was accepted whose resume the adapter refuses ends the run naming the place of that pause, the declared stop and the refusal', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet; the browser's adapter will refuse the run's resume.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.refuseStubResume()
  // Act: the page pauses in its stub of the server module, naming the server breakpoint.
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the run ended with the adapter’s refusal',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 1:1, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page\'s copy of that module. Codebook asked the debugger to resume the page, and the request failed: "Thread is not paused". Keep the declaration and start a new run.',
  )
})

// Cycle 0046 (row 268, the deadline of a continuation): red while the deadline of the next stop said "... declared stop src/mode.ts:1 (stop 2 of 2) was not hit within 20 s; its breakpoint was still pending (...). Start a new run; if the stop is not hit again, declare a line this action executes after the preceding stop." while the page stood paused at that stop's breakpoint under the run's own resume.
test('a continuation whose page stays paused at the next server stop’s breakpoint because the debugger never answers Codebook’s resume ends at its deadline naming that pause and the unanswered resume, and not a line to declare', async (context) => {
  // Arrange: the first server stop is captured and continued; the second has not paused. The browser adapter never answers the run's resume of the page.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'server'],
    { manualClock: true },
  )
  await harness.run.prepare()
  harness.holdNextPause()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  await harness.run.continue('server', first.pause)
  harness.holdStubResume()
  harness.pauseBrowserAtServerBreakpoint(harness.breakpoints.at(-1)!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  // Act: the 20 s of the continuation's deadline pass.
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the continuation’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository continuation reached no next declared pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 1:1, at the breakpoint of declared server stop src/mode.ts:1 (stop 2 of 2), which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 269): red while one flag stood for every resume of the run's own and any resume of the page cleared it: with two pauses in the stub whose `stopped` events were read before the page's events, the first pause's resume cleared the flag, the second pause got the timer of a pause nobody owns, and an adapter that answered its resume late ended the run with "Unowned browser stop remained paused".
test('a second page pause at a server stop’s breakpoint, whose stopped event was read before the first pause’s own events, is not ended by the bound of an unowned page pause while its resume is under way, and the run goes on to its server stop', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet. The adapter reports two pauses of the page at the server breakpoint, one after the other, before the run has read any event of the page; it answers each of the run's two resumes only when the test lets it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const firstResume = harness.holdStubResume()
  const firstPause = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  const secondResume = harness.holdStubResume()
  const secondPause = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length === 2,
    'the run sent both resumes of the page',
  )
  // Act: the first pause is read and the adapter resumes it; then the second pause is read, and 3,001 ms pass before the adapter answers its resume.
  firstPause.paused()
  firstResume.release()
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length ||
      harness.run.view().failures.length,
    'the adapter answered the first resume',
  )
  secondPause.paused()
  harness.advance(3_001)
  const failuresWhilePaused = harness.run.view().failures.join('; ')
  secondResume.release()
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(failuresWhilePaused, '')
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.equal(
    journaled(harness, 'cdp.browser-adapter-pause-retired').length,
    2,
  )
})

// Cycle 0046 (row 269, the same two pauses in a run that declares a browser stop too): red while the second held pause was not marked as resumed by the run, because the first pause's resume had cleared the one flag: its late resume ended the run with "Manual or competing resume invalidated live pause: ...".
test('a second page pause at a server stop’s breakpoint, whose stopped event was read before the first pause’s own events, is not taken for a competing resume when the adapter answers late, in a run that declares a browser stop too', async (context) => {
  // Arrange: as above, with a browser stop declared after the server stop, so each page pause is held instead of timed.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const firstResume = harness.holdStubResume()
  const firstPause = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  const secondResume = harness.holdStubResume()
  const secondPause = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length === 2,
    'the run sent both resumes of the page',
  )
  // Act: the first pause is read and the adapter resumes it; then the second pause is read, and 4 s pass before the adapter answers its resume.
  firstPause.paused()
  firstResume.release()
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length ||
      harness.run.view().failures.length,
    'the adapter answered the first resume',
  )
  secondPause.paused()
  harness.advance(4_000)
  secondResume.release()
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed')
        .length === 2 || harness.run.view().failures.length,
    'the adapter answered the second resume',
  )
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.deepEqual(journaled(harness, 'cdp.unannounced-pause-resumed-late'), [])
  assert.equal(journaled(harness, 'cdp.adapter-pause-retired').length, 2)
})

// Cycle 0046 (row 282, the order of the native journal f21a: one `stopped`, then the debugger's own pause at the module's first position, its resume, and only then the pause at the breakpoint): red while every resume of the page took one resume of the run's own off those under way: the resume of the debugger's own pause ended the run's one resume, the pause at the breakpoint got the timer of a pause nobody owns, and an adapter that answered later than 3 s ended the run with "Unowned browser stop remained paused".
test('a page pause at a server stop’s breakpoint that follows the debugger’s own pause at the module’s first position is not ended by the bound of an unowned page pause while the run’s resume has no answer, and the run goes on to its server stop', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet. The adapter's `stopped` names the server breakpoint, the run sends its resume, and the adapter answers it only when the test lets it. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const resume = harness.holdStubResume()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  // Act: the page's own events are read: the debugger's pause at the module's first position and its resume, then the pause at the breakpoint; 3,001 ms pass before the adapter answers the run's resume.
  stub.paused()
  harness.emitResume('browser')
  stub.pausedAtBreakpoint(10, 115)
  harness.advance(3_001)
  const failuresWhilePaused = harness.run.view().failures.join('; ')
  resume.release()
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(failuresWhilePaused, '')
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.equal(
    journaled(harness, 'cdp.browser-adapter-pause-retired').length,
    2,
  )
})

// Cycle 0046 (row 282, the same order in a run that declares a browser stop too): red while the pause at the breakpoint was not marked as resumed by the run, because the resume of the debugger's own pause had ended the run's one resume: its late resume ended the run with "Manual or competing resume invalidated live pause: ...".
test('a page pause at a server stop’s breakpoint that follows the debugger’s own pause at the module’s first position is not taken for a competing resume when the adapter answers late, in a run that declares a browser stop too', async (context) => {
  // Arrange: as above, with a browser stop declared after the server stop, so each page pause is held instead of timed.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  const resume = harness.holdStubResume()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  // Act: the debugger's pause at the module's first position and its resume, then the pause at the breakpoint; 4 s pass before the adapter answers the run's resume.
  stub.paused()
  harness.emitResume('browser')
  stub.pausedAtBreakpoint(10, 115)
  harness.advance(4_000)
  resume.release()
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length ||
      harness.run.view().failures.length,
    'the adapter answered the resume',
  )
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.deepEqual(journaled(harness, 'cdp.unannounced-pause-resumed-late'), [])
  assert.equal(journaled(harness, 'cdp.adapter-pause-retired').length, 2)
})

// Cycle 0046 (row 282, the resume never answered): the deadline's sentence of row 268 names the pause at the breakpoint, not the debugger's own pause before it; red while the resume of that first pause ended the run's resume, so the pause at the breakpoint ended the run after 3 s with "Unowned browser stop remained paused".
test('an action whose page stays paused at a server stop’s breakpoint, after the debugger’s own pause at the module’s first position was resumed, ends at its deadline naming the pause at the breakpoint and the unanswered resume', async (context) => {
  // Arrange: as in the first test of this order; the adapter never answers the run's resume.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.holdStubResume()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-resume-requested')
        .length,
    'the run’s resume of the page was sent',
  )
  stub.paused()
  harness.emitResume('browser')
  stub.pausedAtBreakpoint(10, 115)
  // Act: the 20 s of the action's deadline pass.
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 11:116, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 282, the order the native journal shows when the debugger answers at once): the debugger's answer is read before the page's own events, so no pause is the run's own any more when they are read; red if a request the debugger answered stayed under way and a deadline that expires for another reason named a pause of the page that was resumed long before.
test('an action that reaches no stop after the debugger answered Codebook’s resume of the page and the page’s two pauses were resumed ends at its deadline with the ordinary sentence, naming no pause of the page', async (context) => {
  // Arrange: the action is accepted and the server stop never pauses. The adapter's `stopped` is read first and the run's resume is answered at once; the page's own events are read afterwards: the debugger's pause at the module's first position, its resume, the pause at the breakpoint.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.answerStubResumeWithoutResuming()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length,
    'the debugger answered the run’s resume',
  )
  stub.paused()
  harness.emitResume('browser')
  stub.pausedAtBreakpoint(10, 115)
  harness.emitResume('browser')
  // Act: the 20 s of the action's deadline pass.
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause: declared server stop src/mode.ts:1 (registration pending) was not hit within 20 s of the accepted action; the server action's request may still be running (a first compilation after a cold start can take longer), or its line does not execute for this input. Start a new run; if the stop is not hit again, declare a line this action executes.",
  )
  assert.equal(
    journaled(harness, 'cdp.browser-adapter-pause-retired').length,
    2,
  )
})

// Cycle 0046 (row 289): red while a pause at the breakpoint that was read only after the debugger's answer was not the run's own: when the page never reported its resume, a run without browser stops ended after 3 s with "Unowned browser stop remained paused", which names neither the stop nor the answered resume.
test('a page pause at a server stop’s breakpoint that is read after the debugger answered Codebook’s resume and that the page never resumes ends the action at its deadline saying that the debugger answered and the page reported no resume, in a run that declares only a server stop', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet. The adapter's `stopped` is read first and the adapter answers the run's resume at once, without resuming the page. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.answerStubResumeWithoutResuming()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length,
    'the debugger answered the run’s resume',
  )
  // Act: 240 ms after the answer the page's pause at the breakpoint is read; nothing resumes it, and the 20 s of the action's deadline pass.
  harness.advance(240)
  stub.pausedAtBreakpoint(10, 115)
  harness.advance(19_760)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 11:116, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and the debugger answered, but the page reported no resume. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 289, the same pause in a run that declares a browser stop too): red while the deadline said "... was not hit within 20 s ...; ... declare a line this action executes. The browser is paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 11:116 without a debugger stop.", although a stop announced that pause and the debugger answered the run's resume of it.
test('a page pause at a server stop’s breakpoint that is read after the debugger answered Codebook’s resume and that the page never resumes is named at the deadline as the pause the debugger answered for, not as one without a debugger stop, in a run that declares a browser stop too', async (context) => {
  // Arrange: as above, with a browser stop declared after the server stop, so the page pause is held instead of timed.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.answerStubResumeWithoutResuming()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length,
    'the debugger answered the run’s resume',
  )
  // Act: 240 ms after the answer the page's pause at the breakpoint is read; nothing resumes it, and the 20 s of the action's deadline pass.
  harness.advance(240)
  stub.pausedAtBreakpoint(10, 115)
  harness.advance(19_760)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the action’s deadline ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Repository input reached no verified pause. The page paused at webpack-internal:///(app-pages-browser)/./src/mode.ts 11:116, at the breakpoint of declared server stop src/mode.ts:1, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and the debugger answered, but the page reported no resume. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 289): only a pause read within the debugger's bound of the answer is that resume's; red if an answer made every later pause in the stub the run's own, so that a pause nobody announced there had no bound of its own.
test('a page pause in the stub of the server stop’s module that is read more than 3,000 ms after the debugger answered Codebook’s resume keeps the stub’s own bound and ends a run without browser stops 3,000 ms later', async (context) => {
  // Arrange: as in the first test of this row, but the page's pause is read 3,001 ms after the answer.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.answerStubResumeWithoutResuming()
  const stub = harness.announceBrowserStopAtServerBreakpoint(
    harness.breakpoints[0]!,
  )
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length,
    'the debugger answered the run’s resume',
  )
  harness.advance(3_001)
  stub.pausedAtBreakpoint(10, 115)
  // Act
  harness.advance(2_999)
  const failuresJustBeforeTheBound = harness.run.view().failures.join('; ')
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unowned pause ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(failuresJustBeforeTheBound, '')
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser stop remained paused',
  )
})

// Cycle 0046 (row 289): only a pause in that stop's stub is the answered resume's; red if a pause of the page in any other script, read right after the answer, lost the 250 ms of a pause nobody owns.
test('a page pause outside the stub of the server stop’s module that is read right after the debugger answered Codebook’s resume still ends a run without browser stops after 250 ms', async (context) => {
  // Arrange: the debugger answered the run's resume; then the page pauses in a script of the debug adapter's own, and nobody resumes it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.answerStubResumeWithoutResuming()
  harness.announceBrowserStopAtServerBreakpoint(harness.breakpoints[0]!)
  await waitUntil(
    () =>
      journaled(harness, 'dap.server-breakpoint-browser-stop-resumed').length,
    'the debugger answered the run’s resume',
  )
  harness.emitBrowserAdapterPause()
  // Act
  harness.advance(249)
  const failuresJustBeforeTheBound = harness.run.view().failures.join('; ')
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unowned pause ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(failuresJustBeforeTheBound, '')
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser stop remained paused',
  )
})

// Cycle 0046 (row 158): red while a pause that arrived during the judgement by break locations stayed held after that judgement accepted its place: the stop was adopted only when the 3 s wait for its own pause ended, as the native journals of row 77 show.
test('a server stop that pauses while the debugger still has to answer the break-location request is taken as soon as that judgement accepts its place, without the wait and without an adoption', async (context) => {
  // Arrange: the module is announced and the adapter's news names 7:3; the debugger's answer to the judgement that news starts is kept back. The wait for the stop's own pause never ends by itself.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    appendedRegistration('server'),
  )
  harness.listPossibleBreakLocations(
    'server',
    APPENDED_REGISTRATION_BREAK_LOCATIONS,
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.pauseAt('server', 6, 2)
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.holdSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  const judgement = harness.holdBreakLocationAnswer()
  harness.announceBreakpointVerified('server', 7, 3)
  await waitUntil(
    () => harness.breakLocationRequests.length,
    'the break locations were asked for',
  )
  // Act: the runtime pauses at 7:3 and the debugger announces the stop, both before the debugger answered the judgement; then it answers.
  harness.emitPause('server')
  await waitUntil(
    () => harness.waitInProgress(SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION),
    'the run waits for the stop’s own pause',
  )
  judgement.release()
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [7, 3])
  assert.deepEqual(journaled(harness, 'cdp.held-pause-adopted'), [])
})

// Cycle 0046 (row 159): red while news read before the run had seen the module was judged by the source map alone when the input was dispatched in that window: the run ended before the input with "line 2 between the declared line 1 and line 4 has a mapped position", which the judgement at the module's announcement would have lifted.
test('a server stop whose pending breakpoint the adapter reports verified before the run has seen the module waits for the module before the input and is then judged by the break locations', async (context) => {
  // Arrange: the function head over lines 1 to 3 is mapped and the debugger lists a break location on line 4 only. The adapter's news names 4:3 before the module is announced, and the action is accepted in that window.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: FUNCTION_HEAD_MODULE.mappings },
    fixture: {
      server: { source: FUNCTION_HEAD_MODULE.source, citationEndLine: 5 },
    },
  })
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 3, columnNumber: 2 },
  ])
  await harness.run.prepare()
  harness.pauseAt('server', 3, 2)
  harness.bindAt('server', 4, 3)
  harness.movePausedFrame(4, 3)
  harness.announceBreakpointVerified('server', 4, 3)
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return harness.waitInProgress(
      'the announcement of the module of declared stop src/mode.ts:1',
    )
  }, 'the run waits for the module before the input')
  const inputSentBeforeTheModule = harness.commands.some((command) =>
    command.method.startsWith('Input.'),
  )
  // Act: the run's own channel announces the module.
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(inputSentBeforeTheModule, false)
  assert.deepEqual([server.source.line, server.source.column], [4, 3])
  assert.equal(
    journaled(harness, 'breakpoint.rule-from-break-locations').length,
    1,
  )
})

// Cycle 0046 (row 159): the map's reason is given only when the module does not arrive within the bound; red if the wait had no end or its expiry gave another text.
test('a server stop whose reported place the map refuses and whose module is not announced within the bound is refused before the input with the map’s reason', async (context) => {
  // Arrange: as above, but the module is never announced; the bound of the wait is 200 ms.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: FUNCTION_HEAD_MODULE.mappings },
    fixture: {
      server: { source: FUNCTION_HEAD_MODULE.source, citationEndLine: 5 },
    },
    runtimeConstants: { CAPTURE_TIMEOUT_MS: 200 },
  })
  await harness.run.prepare()
  harness.announceBreakpointVerified('server', 4, 3)
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'refused once the module did not arrive',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:1 bound at 4:3, refused: line 2 between the declared line 1 and line 4 has a mapped position. Frozen source map positions in the selected citation: 1:1, 2:1, 3:1, 4:3, 5:1. ${MAPPING_HINTS}`,
  )
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
})

// Cycle 0046 (row 270): red while the place judged after the wait for the module was the one read before it: news that put the breakpoint back at an accepted place during that wait was ignored, and the run ended before the input with "Declared stop src/mode.ts:1 bound at 4:3, refused: line 2 between the declared line 1 and line 4 has a mapped position", a place the breakpoint no longer had.
test('a server stop whose breakpoint the adapter first reports at a place the map refuses and then, while the run waits for the module, at an accepted place is taken as registered there, and the run goes on to its stop', async (context) => {
  // Arrange: the function head over lines 1 to 3 is mapped. The adapter's news names 4:3, which the map refuses, before the module is announced; the module is never announced, and the bound of the wait for it is 200 ms.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: FUNCTION_HEAD_MODULE.mappings },
    fixture: {
      server: { source: FUNCTION_HEAD_MODULE.source, citationEndLine: 5 },
    },
    runtimeConstants: { CAPTURE_TIMEOUT_MS: 200 },
  })
  await harness.run.prepare()
  harness.announceBreakpointVerified('server', 4, 3)
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return harness.waitInProgress(
      'the announcement of the module of declared stop src/mode.ts:1',
    )
  }, 'the run waits for the module before the input')
  // Act: during that wait the adapter reports the breakpoint verified on its declared line, 1:1; the wait then ends without the module.
  harness.announceBreakpointVerified('server', 1, 1)
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.equal(harness.run.view().failures.join('; '), '')
})

// Cycle 0046 (row 209): red while every page pause of a run without browser stops had 250 ms until someone resumed it: the pause in the stub of a declared server stop's module, whose `stopped` the adapter sent later than that, ended the run with "Unowned browser stop remained paused" before the run could know whose pause it was.
test('a page pause in the stub of a declared server stop’s module whose stopped event is read 300 ms later is resumed by the run, and the server stop is captured', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act: the page pauses in its stub of the server module; 300 ms pass before the adapter reports the stop that names the server breakpoint.
  const stub = harness.pauseBrowserInServerStub(harness.breakpoints[0]!)
  harness.advance(300)
  const failuresBeforeTheStop = harness.run.view().failures.join('; ')
  stub.stopped()
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return journaled(harness, 'dap.server-breakpoint-browser-stop-resumed')
      .length
  }, 'the run resumed the page')
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(failuresBeforeTheStop, '')
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.equal(
    journaled(harness, 'cdp.browser-adapter-pause-retired').length,
    1,
  )
})

// Cycle 0046 (row 209): the stub's pause is bounded too, by the 3,000 ms the debug adapter may take for a pause of its own; red if it had no bound, or another one.
test('a page pause in the stub of a declared server stop’s module that nobody resumes and no stopped event names ends the run after 3,000 ms, not earlier', async (context) => {
  // Arrange: as above; no `stopped` follows the page's pause.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.pauseBrowserInServerStub(harness.breakpoints[0]!)
  // Act
  harness.advance(2_999)
  const failuresJustBeforeTheBound = harness.run.view().failures.join('; ')
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unowned pause ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(failuresJustBeforeTheBound, '')
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser stop remained paused',
  )
})

// Cycle 0046 (row 209): the longer bound is the stub's alone; red if every page pause of a run without browser stops were given 3,000 ms.
test('a page pause outside the stub of a declared server stop’s module still ends a run without browser stops after 250 ms', async (context) => {
  // Arrange: the action is accepted; the page pauses in a script of the debug adapter's own, and nobody resumes it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.emitBrowserAdapterPause()
  // Act
  harness.advance(249)
  const failuresJustBeforeTheBound = harness.run.view().failures.join('; ')
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unowned pause ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(failuresJustBeforeTheBound, '')
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser stop remained paused',
  )
})

/** A page script of another file than the server stop's `src/mode.ts`, whose address contains that file's base name, `mode`. */
const OTHER_PAGE_SCRIPT = {
  scriptId: 'other-page-module',
  url: 'webpack-internal:///(app-pages-browser)/./src/my-mode.ts',
}

// Cycle 0046 (row 288): red while the debugger's own pause at the first position of another page script, which its breakpoint by the bare base name of the declared stop's file causes, had the 250 ms of a pause nobody owns: a script whose source map the debugger read for longer than that ended the run with "Unowned browser stop remained paused".
test('the debugger’s own pause at the first position of another page script named like the server stop’s file, resumed after 300 ms, does not end a run without browser stops, and the server stop is captured', async (context) => {
  // Arrange: the action is accepted and the server stop has not paused yet. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript(
    'browser',
    OTHER_PAGE_SCRIPT.scriptId,
    OTHER_PAGE_SCRIPT.url,
  )
  // Act: the page pauses at the first position of that script, at the debugger's breakpoint by the name "mode"; the debugger resumes it after 300 ms.
  harness.emitUnannouncedPause('browser', {
    scriptId: OTHER_PAGE_SCRIPT.scriptId,
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['br:2:0:0:mode'],
  })
  harness.advance(300)
  const failuresWhilePaused = harness.run.view().failures.join('; ')
  harness.emitResume('browser')
  harness.emitPause('server')
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(failuresWhilePaused, '')
  assert.deepEqual([server.source.line, server.source.column], [1, 1])
  assert.equal(
    journaled(harness, 'cdp.browser-adapter-pause-retired').length,
    1,
  )
})

// Cycle 0046 (row 288): that pause is bounded too, by the 3,000 ms the debug adapter may take for a pause of its own; red if it had no bound, or another one.
test('the debugger’s own pause at the first position of another page script that nobody resumes ends a run without browser stops after 3,000 ms, not earlier', async (context) => {
  // Arrange: as above; nothing resumes the pause.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript(
    'browser',
    OTHER_PAGE_SCRIPT.scriptId,
    OTHER_PAGE_SCRIPT.url,
  )
  harness.emitUnannouncedPause('browser', {
    scriptId: OTHER_PAGE_SCRIPT.scriptId,
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['br:2:0:0:mode'],
  })
  // Act
  harness.advance(2_999)
  const failuresJustBeforeTheBound = harness.run.view().failures.join('; ')
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unowned pause ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(failuresJustBeforeTheBound, '')
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser stop remained paused',
  )
})

// Cycle 0046 (row 288): the longer bound is the debugger's own breakpoint's alone; red if a pause at the same place with another breakpoint, such as one set on that line by the script's address, were given 3,000 ms.
test('a pause at the first position of another page script whose breakpoint was set by that script’s address still ends a run without browser stops after 250 ms', async (context) => {
  // Arrange: as above, but the breakpoint the pause hit is one set by the script's address, as a breakpoint on that line of the file is.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript(
    'browser',
    OTHER_PAGE_SCRIPT.scriptId,
    OTHER_PAGE_SCRIPT.url,
  )
  harness.emitUnannouncedPause('browser', {
    scriptId: OTHER_PAGE_SCRIPT.scriptId,
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: [
      '1:0:0:webpack-internal:///(app-pages-browser)/./src/my-mode.ts',
    ],
  })
  // Act
  harness.advance(249)
  const failuresJustBeforeTheBound = harness.run.view().failures.join('; ')
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unowned pause ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(failuresJustBeforeTheBound, '')
  assert.equal(
    harness.run.view().failures[0],
    'Unowned browser stop remained paused',
  )
})

// Cycle 0046 (row 295): red while every held page pause counted as a competing resume after 1,000 ms during the wait for an accepted browser stop's own pause: the debugger's own pause at the first position of another page script, which it resumes once it has read that script's source map, ended the run with "Manual or competing resume invalidated live pause: ... was resumed after more than 1000 ms ...".
test('the debugger’s own pause at the first position of another page script, held while an accepted browser stop awaits its own pause and resumed after 1,500 ms, is not taken for a competing resume, and the browser stop is captured', async (context) => {
  // Arrange: the server stop is captured and continued, the debugger announces the browser stop, and the wait for that stop's own pause is held open. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  const nextStop = harness.holdNextPause()
  harness.holdSourceBoundWait()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  nextStop.stopped()
  await waitUntil(
    () => harness.waitInProgress(SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION),
    'the wait for the browser stop’s own pause',
  )
  harness.announceScript(
    'browser',
    OTHER_PAGE_SCRIPT.scriptId,
    OTHER_PAGE_SCRIPT.url,
  )
  // Act: the page pauses at the first position of the other script, at the debugger's breakpoint by the name "mode"; the debugger resumes it after 1,500 ms, and then the browser stop's own pause is read.
  harness.emitUnannouncedPause('browser', {
    scriptId: OTHER_PAGE_SCRIPT.scriptId,
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['br:2:0:0:mode'],
  })
  harness.advance(1_500)
  harness.emitResume('browser')
  const failuresAfterTheResume = harness.run.view().failures.join('; ')
  nextStop.paused()
  const browser = await pauseReady(harness, 'browser')
  // Assert
  assert.equal(failuresAfterTheResume, '')
  assert.deepEqual([browser.source.line, browser.source.column], [1, 1])
  assert.deepEqual(journaled(harness, 'cdp.unannounced-pause-resumed-late'), [])
  assert.equal(journaled(harness, 'cdp.adapter-pause-retired').length, 1)
})

// Cycle 0046 (row 295): the longer bound in that phase is the debugger's own breakpoint's alone; red if a held page pause with another breakpoint, which may be the announced stop's pause or one somebody else resumes, were given 3,000 ms there.
test('a page pause at the first position of another page script whose breakpoint was set by that script’s address, held while an accepted browser stop awaits its own pause and resumed after 1,001 ms, ends the run as a manual or competing resume', async (context) => {
  // Arrange: as above, but the breakpoint the pause hit is one set by the script's address, as a breakpoint on that line of the file is.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  const nextStop = harness.holdNextPause()
  harness.holdSourceBoundWait()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  nextStop.stopped()
  await waitUntil(
    () => harness.waitInProgress(SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION),
    'the wait for the browser stop’s own pause',
  )
  harness.announceScript(
    'browser',
    OTHER_PAGE_SCRIPT.scriptId,
    OTHER_PAGE_SCRIPT.url,
  )
  harness.emitUnannouncedPause('browser', {
    scriptId: OTHER_PAGE_SCRIPT.scriptId,
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: [
      '1:0:0:webpack-internal:///(app-pages-browser)/./src/my-mode.ts',
    ],
  })
  // Act
  harness.advance(1_001)
  harness.emitResume('browser')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Manual or competing resume invalidated live pause: the browser pause at webpack-internal:///(app-pages-browser)/./src/my-mode.ts 1:1 that no debugger stop announced was resumed after more than 1000 ms, longer than the debugger holds a pause of its own',
  )
})

// Cycle 0046 (row 296): red while a page pause in the stub of a declared server stop's module, which has 3,000 ms in a run without browser stops, had 1,000 ms as a held pause while an accepted browser stop awaited its own pause: a debugger that resumed it after 1,500 ms ended the run with "Manual or competing resume invalidated live pause: ... was resumed after more than 1000 ms ...".
test('a page pause in the stub of a declared server stop’s module, held while an accepted browser stop awaits its own pause and resumed by the debugger after 1,500 ms, is not taken for a competing resume, and the browser stop is captured', async (context) => {
  // Arrange: a server stop and a browser stop. The server stop is captured and continued, the debugger announces the browser stop, and the wait for that stop's own pause is held open. The run's clock moves only when the test advances it.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  const nextStop = harness.holdNextPause()
  harness.holdSourceBoundWait()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  nextStop.stopped()
  await waitUntil(
    () => harness.waitInProgress(SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION),
    'the wait for the browser stop’s own pause',
  )
  harness.announceScript(
    'browser',
    'server-module-stub',
    'webpack-internal:///(app-pages-browser)/./src/mode.ts',
  )
  // Act: the page pauses in its stub of the server module, at a breakpoint the debugger set in that script; the debugger resumes it after 1,500 ms, and then the browser stop's own pause is read.
  harness.emitUnannouncedPause('browser', {
    scriptId: 'server-module-stub',
    lineNumber: 10,
    columnNumber: 115,
    functionName: '',
    hitBreakpoints: ['4:10:6:server-module-stub'],
  })
  harness.advance(1_500)
  harness.emitResume('browser')
  const failuresAfterTheResume = harness.run.view().failures.join('; ')
  nextStop.paused()
  const browser = await pauseReady(harness, 'browser')
  // Assert
  assert.equal(failuresAfterTheResume, '')
  assert.deepEqual([browser.source.line, browser.source.column], [1, 1])
  assert.deepEqual(journaled(harness, 'cdp.unannounced-pause-resumed-late'), [])
  assert.equal(journaled(harness, 'cdp.adapter-pause-retired').length, 1)
})

// Cycle 0046 (row 296): the longer bound is not for the module of the stop that is accepted now, where a held pause may be that stop's own, announced one; red if a pause there were given 3,000 ms because that module is also the page's stub of a server stop's module.
test('a pause held in the accepted browser stop’s own module, when that module is also the page’s stub of a server stop’s module, and resumed after 1,001 ms still ends the run as a manual or competing resume', async (context) => {
  // Arrange: as above, but the page announces the browser stop's own script under the address of its stub of the server module, as it is when both stops are declared in one file; the page pauses on another line of that script.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { manualClock: true },
  )
  await harness.run.prepare()
  const nextStop = harness.holdNextPause()
  harness.holdSourceBoundWait()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  nextStop.stopped()
  await waitUntil(
    () => harness.waitInProgress(SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION),
    'the wait for the browser stop’s own pause',
  )
  harness.announceScript(
    'browser',
    'browser',
    'webpack-internal:///(app-pages-browser)/./src/mode.ts',
  )
  harness.emitUnannouncedPause('browser', {
    scriptId: 'browser',
    lineNumber: 10,
    columnNumber: 115,
    functionName: '',
    hitBreakpoints: ['4:10:6:browser'],
  })
  // Act
  harness.advance(1_001)
  harness.emitResume('browser')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Manual or competing resume invalidated live pause: the browser pause at webpack-internal:///(app-pages-browser)/./src/mode.ts 11:116 that no debugger stop announced was resumed after more than 1000 ms, longer than the debugger holds a pause of its own',
  )
})
