import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerHit,
  apiServerRunHarness,
  endApiRequest,
  sendApiRequest,
} from './utils/apiServerRunHarness'
import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './utils/configuredRuntimeHarness'
import {
  routeHandlerHit,
  routeHandlerRunHarness,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

const OPERATION_ACTION = 'repository-operation'
const SUBMIT: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** A route file with code on lines 1 and 3, the map that sends generated lines 0 and 2 to them, and the same map for the paused script, whose first line is the `"use strict";` the instance text starts with. */
const TWO_STOP_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
const TWO_STOP_MAP = 'AAAA;AACA;AACA'
const INSTANCE_MAP = ';AAAA;AACA;AACA'

/** Copies a value out of the run module's realm so a strict deep comparison accepts it. @example plain(run.view().recordedStops) // [0] */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Opens a prepared version 3 browser run with one click operation and a stop per entry of `holds`, all declared after operation 1.
 * @param context - The test.
 * @param holds - The `hold` each stop declares, the first stop first.
 * @example const harness = await openRun(context, ['record', undefined])
 */
async function openRun(
  context: TestContext,
  holds: Array<'explain' | 'record' | undefined>,
) {
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    holds.slice(1).map(() => ({
      line: 1,
      column: 7,
      inspections: [...ENABLED_STOP],
    })),
    {
      operations: {
        operations: [SUBMIT],
        stopOperations: holds.map(() => 1),
        stopHolds: holds,
      },
    },
  )
  await harness.run.prepare()
  return harness
}

/**
 * Tells whether a participant's view offers a chat something to continue: a snapshot while its gate is paused.
 * A snapshot read while the gate is `resume-requested` (the run's own resume is in flight) is not an offer: `codebook_continue` refuses it as stale.
 * @example isOffered(run.view().participants.browser) // false while the run resumes its recorded stop
 */
function isOffered(participant?: { snapshot?: unknown; phase?: string }) {
  return Boolean(participant?.snapshot) && participant?.phase === 'paused'
}

/**
 * Records every state the run publishes from now on: each `view()` call (the run's own persists included) and a poll between turns, so a paused state a reader could act on cannot slip by.
 * @param harness - The run's harness.
 * @returns The statuses seen, and whether any read offered a continuation (a snapshot of a participant whose gate is paused).
 * @example const seen = watchPublishedStates(harness); … seen.statuses.has('paused-browser') // false
 */
function watchPublishedStates(harness: ConfiguredRuntimeHarness) {
  const seen = { statuses: new Set<string>(), offeredContinuation: false }
  const { run } = harness
  const view = run.view.bind(run)
  const note = (read: ReturnType<typeof view>): void => {
    seen.statuses.add(read.status)
    if (isOffered(read.participants.browser)) seen.offeredContinuation = true
  }
  run.view = () => {
    const read = view()
    note(read)
    return read
  }
  return seen
}

/** Counts the `continue` requests the run sent to the debug adapter. @example continueCount(harness) // 1 */
function continueCount(harness: ConfiguredRuntimeHarness): number {
  return harness.commands.filter((command) => command === 'continue').length
}

/** What the run resource showed at the moment the run asked the debugger to resume. */
type ResumeMoment = { snapshots: number; recordedStops: number[] }

/**
 * Records, at the moment each resume is requested, how many observations the run had committed and which stops it listed as recorded.
 * Why it exists: a resume sent before the observation is committed would lose the values the learner is waiting for; the hook runs inside the debugger request, so it sees the state the request was made in.
 * @param requests - The list the fake debug session appends every resume request to (it appends before the adapter answers).
 * @param isResume - Whether one entry of that list is a resume.
 * @param read - Reads the run resource.
 * @returns The moments, one per resume, in order.
 * @example const moments = watchResumeMoments(harness.commands, (command) => command === 'continue', () => harness.run.view())
 */
function watchResumeMoments<Request>(
  requests: Request[],
  isResume: (request: Request) => boolean,
  read: () => { snapshots: unknown[]; recordedStops?: number[] },
): ResumeMoment[] {
  const moments: ResumeMoment[] = []
  const append = requests.push.bind(requests)
  requests.push = (...added: Request[]): number => {
    for (const request of added) {
      if (!isResume(request)) continue
      const view = read()
      moments.push({
        snapshots: view.snapshots.length,
        recordedStops: plain(view.recordedStops ?? []),
      })
    }
    return append(...added)
  }
  return moments
}

/** Watches the browser debug session's `continue` requests of a harness. @example const moments = watchBrowserResumes(harness) */
function watchBrowserResumes(harness: ConfiguredRuntimeHarness) {
  return watchResumeMoments(
    harness.commands,
    (command) => command === 'continue',
    () => ownView(harness.run),
  )
}

/** Reads a run with its own `view`, not a test wrapper on the instance: a wrapper would count a read made inside the resume request as one a reader made. @example ownView(harness.run).snapshots.length // 1 */
function ownView(run: ConfiguredRuntimeHarness['run']) {
  return Object.getPrototypeOf(run).view.call(run) as ReturnType<
    typeof run.view
  >
}

// Value: protects=a browser stop declared hold "record" commits its observation, sends exactly one resume without a chat call, never publishes paused-browser, and the run reaches its after-condition; fails_when=the run waits for codebook_continue, resumes twice, offers a continuation to a reader, or never completes; no_claim=a real debugger or page: the configured runtime harness stands in for js-debug and the page
test('a recorded browser stop resumes once on its own and the run completes without ever publishing a paused state', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  const seen = watchPublishedStates(harness)
  const resumes = watchBrowserResumes(harness)
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the recorded stop',
  )
  // Assert: the observation was committed and listed before the one resume, and no second resume followed the result.
  assert.deepEqual(resumes, [{ snapshots: 1, recordedStops: [0] }])
  assert.equal(continueCount(harness), 1)
  assert.equal(seen.statuses.has('paused-browser'), false)
  assert.equal(seen.offeredContinuation, false)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().finalOutcome, 'pending-teardown')
  assert.equal(harness.run.view().operation?.afterVerified, true)
})

// Value: protects=a run that mixes a recorded stop and a held stop of one operation: the recorded one resumes alone and the held one still waits for codebook_continue; fails_when=the held stop is resumed without the chat, or the run stays paused at the recorded stop; no_claim=a real debugger
test('in a run that mixes modes the held stop still waits after the recorded stop resumed', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined])
  const resumes = watchBrowserResumes(harness)
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () =>
      harness.run.view().snapshots[1] &&
      harness.run.view().participants.browser.snapshot,
    'the held stop after the recorded one',
  )
  // Assert: the recorded stop resumed once, the held one is paused and nothing resumed it.
  assert.equal(harness.run.view().status, 'paused-browser')
  assert.equal(continueCount(harness), 1)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  // Act
  await harness.run.continue('browser', held.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the held stop',
  )
  // Assert
  assert.equal(continueCount(harness), 2)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  // The recorded stop resumed with one observation committed; the held one only after the chat's call, with two.
  assert.deepEqual(resumes, [
    { snapshots: 1, recordedStops: [0] },
    { snapshots: 2, recordedStops: [0] },
  ])
})

// Value: protects=recordedStops lists the zero-based declared index of each recorded stop and leaves out the index of a held stop between two recorded ones, each recorded stop resuming after its own commit; fails_when=the list is empty, counts the held stop, lists a position instead of the declared index, or a recorded stop resumes before its observation is committed; no_claim=that the list is in recording order (stops run in declared order, so ascending order cannot tell the two apart) or a real debugger
test('recordedStops lists the declared index of each recorded stop and leaves out the held stop between them', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined, 'record'])
  const resumes = watchBrowserResumes(harness)
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () =>
      harness.run.view().snapshots[1] &&
      harness.run.view().participants.browser.snapshot,
    'the held stop',
  )
  // Assert: only the first stop is recorded while the second is held.
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  // Act
  await harness.run.continue('browser', held.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the last recorded stop',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().recordedStops), [0, 2])
  assert.equal(continueCount(harness), 3)
  assert.deepEqual(resumes, [
    { snapshots: 1, recordedStops: [0] },
    { snapshots: 2, recordedStops: [0] },
    { snapshots: 3, recordedStops: [0, 2] },
  ])
})

// Value: protects=a version 3 run without any recorded stop lists recordedStops as an empty array, and a held stop is never listed; fails_when=the field is absent or lists a held stop; no_claim=the service resource around it
test('a run with only held stops reports an empty recordedStops list', async (context) => {
  // Arrange
  const harness = await openRun(context, [undefined])
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the held stop',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().recordedStops), [])
  await harness.run.continue('browser', held.pause)
})

// Value: protects=the recorded observation carries the same values, unavailable values, debugger frames and scopes, source, stop identity and pause shape as a held observation of the same line; fails_when=a recorded stop commits fewer or different values, frames, stop identity or pause fields than a held one; no_claim=the stop's image (a recorded run also captures its result, so the stand-in page's screenshot counts differ by design) or js-debug's real values: both runs read the harness page's one fake scope
test('a recorded observation equals the observation of a held stop on the same line', async (context) => {
  // Arrange
  const recorded = await openRun(context, ['record'])
  const held = await openRun(context, [undefined])
  // Act
  recorded.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => recorded.run.view().status === 'completed',
    'the recorded run',
  )
  held.run.action('op-1', OPERATION_ACTION)
  const heldSnapshot = await waitUntil(
    () => held.run.view().participants.browser.snapshot,
    'the held stop',
  )
  const comparable = (snapshot: typeof heldSnapshot) =>
    // The two runs seal their own temporary repositories, so the map hash differs by construction.
    plain({
      values: snapshot.values,
      unavailableValues: snapshot.unavailableValues,
      debugger: snapshot.debugger,
      source: { ...snapshot.source, mapHash: undefined },
      participant: snapshot.participant,
      capturePhase: snapshot.capturePhase,
      execution: snapshot.execution,
      declaredIndex: snapshot.declaredIndex,
      executionIndex: snapshot.executionIndex,
      itemId: snapshot.itemId,
      // The pause identity's shape: its generation is the gate's own counter, so the fields are compared, not the counter.
      pause: {
        fields: Object.keys(snapshot.pause).sort(),
        threadId: snapshot.pause.threadId,
      },
    })
  // Assert
  assert.deepEqual(
    comparable(recorded.run.view().snapshots[0]!),
    comparable(heldSnapshot),
  )
  assert.equal(comparable(heldSnapshot).values?.['value:nextTheme'], 'dark')
  assert.deepEqual(comparable(heldSnapshot).pause.fields, [
    'generation',
    'sessionId',
    'threadId',
  ])
  await held.run.continue('browser', heldSnapshot.pause)
})

// Value: protects=codebook_continue with a recorded stop's arguments is refused as a stale pause while a later held stop is paused, and that stop stays paused; fails_when=the late call is accepted, resumes the held stop or ends the run; no_claim=the service tool wrapper around run.continue
test('a late continue naming a recorded stop is refused as stale and the later held stop stays paused', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined])
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () =>
      harness.run.view().snapshots[1] &&
      harness.run.view().participants.browser.snapshot,
    'the held stop',
  )
  const recordedPause = harness.run.view().snapshots[0]!.pause
  // Act / Assert
  await assert.rejects(
    harness.run.continue('browser', recordedPause),
    /conflict: stale, foreign or unverified pause/,
  )
  assert.equal(harness.run.view().status, 'paused-browser')
  assert.equal(continueCount(harness), 1)
  assert.deepEqual(
    plain(harness.run.view().participants.browser.snapshot?.pause),
    plain(held.pause),
  )
  await harness.run.continue('browser', held.pause)
})

// Value: protects=a recorded stop whose required inspection is unavailable ends the run as a held stop's failure does and sends no resume; fails_when=the run resumes the program or reports the stop as recorded; no_claim=a real debugger
test('a recorded stop whose inspection fails ends the run and sends no resume', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  harness.requireUnavailableValue()
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the failed inspection',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.deepEqual(plain(harness.run.view().recordedStops), [])
  assert.equal(harness.run.view().snapshots.length, 1)
  await harness.run.stop()
})

// Value: protects=a recorded stop whose next stop cannot be armed ends the run with the not-armed reason, sends no resume and keeps the committed observation; fails_when=the program is resumed anyway, the reason differs or the observation is lost; no_claim=a real debugger: the arming failure is injected
test('a recorded stop whose next stop cannot be armed ends the run with that reason and keeps its observation', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined])
  harness.run['armStopSet'] = async () => {
    throw new Error('adapter refused the next breakpoint')
  }
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the arming failure',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.equal(
    harness.run.view().failures[0],
    'Next declared stop was not armed and no resume was sent: adapter refused the next breakpoint',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  await harness.run.stop()
})

// Value: protects=a recorded stop whose cited source the learner changes in the editor after the observation was committed ends the run with the not-confirmed reason, sends no resume and keeps the observation; fails_when=the program is resumed anyway, the run ends as an uncertain continuation, or the observation is lost; no_claim=a real editor: the document is the harness's text document
test('a recorded stop whose cited source changed after its observation ends the run with the not-confirmed reason and sends no resume', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  const resumes = watchBrowserResumes(harness)
  // The learner edits the file between the commit and the resume: the run's own save of the evidence is the first point after the commit.
  const persist = harness.run['persist'].bind(harness.run)
  harness.run['persist'] = async (): Promise<void> => {
    await persist()
    if (ownView(harness.run).recordedStops?.length) {
      harness.documents[0]!.text = 'const nextTheme = "light";\n'
      harness.documents[0]!.isDirty = true
    }
  }
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the unconfirmed source',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.deepEqual(resumes, [])
  assert.equal(
    harness.run.view().failures[0],
    'Sources were not confirmed before the continuation and no resume was sent: The cited source src/theme.ts is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  await harness.run.stop()
})

// Value: protects=when the evidence save rejects after a recorded stop's observation is committed, the run ends failed with the save's error text and sends no resume; fails_when=the program is resumed before the save, or the save error is swallowed and the run resumes; no_claim=real disk: a wrapped persist stands in
test('a recorded stop whose evidence save fails ends the run with the save error and sends no resume', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  const resumes = watchBrowserResumes(harness)
  const persist = harness.run['persist'].bind(harness.run)
  harness.run['persist'] = async (): Promise<void> => {
    // The first save after the commit lists the recorded stop: that is the save recordAndContinue awaits before any resume.
    if (ownView(harness.run).recordedStops?.length)
      throw new Error('disk full while saving the evidence')
    await persist()
  }
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the failed evidence save',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.deepEqual(resumes, [])
  assert.equal(
    harness.run.view().failures[0],
    'Error: disk full while saving the evidence',
  )
  await harness.run.stop()
})

// Value: protects=a recorded stop declared on a source the learner had already changed in the editor ends the run before any resume; fails_when=the stop is recorded and the program resumed over a source that differs from the article; no_claim=which sentence the run reports first (the not-confirmed sentence is the test above)
test('a recorded stop on a source changed before the stop sends no resume', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  const resumes = watchBrowserResumes(harness)
  harness.documents[0]!.text = 'const nextTheme = "light";\n'
  harness.documents[0]!.isDirty = true
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the changed source',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.deepEqual(resumes, [])
  await harness.run.stop()
})

// Value: protects=a version 1 and a version 2 run resource carries no recordedStops key, while a version 3 run always has one; fails_when=an older run lists the field (an empty list included) or the version 3 run omits it; no_claim=the service resource around the run
test('a version 1 and a version 2 run resource has no recordedStops key', async (context) => {
  // Arrange
  const versionOne = await configuredRuntimeHarness(context)
  const versionTwo = await configuredRuntimeHarness(context, undefined, [], {
    participant: 'browser',
  })
  const versionThree = await openRun(context, [undefined])
  // Act
  await versionOne.run.prepare()
  await versionTwo.run.prepare()
  const keys = [versionOne, versionTwo, versionThree].map(({ run }) =>
    Object.keys(run.view()).includes('recordedStops'),
  )
  // Assert
  assert.deepEqual(keys, [false, false, true])
})

// Value: protects=a server (API) stop declared hold "record" commits its observation and resumes the handler once without a chat call, never publishing paused-server, with its request attribution kept; fails_when=the handler waits for codebook_continue, resumes twice or the pause is offered to a reader; no_claim=a real js-debug session or Node API: the fake debug session and the page's Network events stand in
test('a recorded API stop resumes the handler once on its own and never publishes paused-server', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    stopHolds: ['record'],
  })
  await harness.run.prepare()
  const view = harness.run.view.bind(harness.run)
  const statuses = new Set<string>()
  let didOfferContinuation = false
  harness.run.view = () => {
    const read = view()
    statuses.add(read.status)
    if (isOffered(read.participants.server)) didOfferContinuation = true
    return read
  }
  const resumes = watchResumeMoments(
    harness.server!.continues,
    () => true,
    () => ownView(harness.run),
  )
  // The API's entry pause was continued during prepare().
  const continuesBefore = harness.server!.continues.length
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/switches/switchTo' })
  // Act
  await apiServerHit(harness)
  endApiRequest(harness, '7', 100.2)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the recorded API stop',
  )
  // Assert: one resume, sent after the observation was committed and listed, and none after the result.
  assert.deepEqual(resumes, [{ snapshots: 1, recordedStops: [0] }])
  assert.equal(harness.server!.continues.length, continuesBefore + 1)
  assert.equal(statuses.has('paused-server'), false)
  assert.equal(didOfferContinuation, false)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  assert.equal(harness.run.view().snapshots[0]?.apiRequest?.state, 'attributed')
})

// Value: protects=two route-handler stops of one request, both declared hold "record", each commit before its own resume, resume once without a chat call, never publish paused-server, and the run completes with recordedStops [0, 1]; fails_when=the first resume hides the second stop, a stop is resumed before its commit or twice, or a pause is offered to a reader; no_claim=a real Next route handler: the stand-in server's hits and the page's Network events stand in
test('two recorded route-handler stops of one request each resume once on their own and the run completes', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [1, 1],
    stopHolds: ['record', 'record'],
    additionalStops: [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    extra: {
      mappings: TWO_STOP_MAP,
      fixture: { source: TWO_STOP_SOURCE, citationEndLine: 3 },
    },
  })
  await harness.run.prepare()
  const seen = { statuses: new Set<string>(), offeredContinuation: false }
  const view = harness.run.view.bind(harness.run)
  harness.run.view = () => {
    const read = view()
    seen.statuses.add(read.status)
    if (isOffered(read.participants.server)) seen.offeredContinuation = true
    return read
  }
  const resumes = watchResumeMoments(
    harness.server!.continues,
    () => true,
    () => ownView(harness.run),
  )
  const continuesBefore = harness.server!.continues.length
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(
    harness,
    { hitBreakpoints: ['owned-breakpoint'] },
    undefined,
    INSTANCE_MAP,
  )
  await waitUntil(
    () => harness.server!.continues.length === continuesBefore + 1,
    'the first recorded stop resumed',
  )
  routeHandlerHit(
    harness,
    {
      hitBreakpoints: ['owned-breakpoint-2'],
      generated: { line: 3, column: 0 },
      source: { line: 3, column: 1 },
    },
    undefined,
    INSTANCE_MAP,
  )
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after both recorded stops',
  )
  // Assert
  assert.deepEqual(resumes, [
    { snapshots: 1, recordedStops: [0] },
    { snapshots: 2, recordedStops: [0, 1] },
  ])
  assert.equal(harness.server!.continues.length, continuesBefore + 2)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0, 1])
  assert.equal(seen.statuses.has('paused-server'), false)
  assert.equal(seen.offeredContinuation, false)
  assert.deepEqual(
    plain(
      harness.run.view().snapshots.map((snapshot) => snapshot.declaredIndex),
    ),
    [0, 1],
  )
})
