import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReplayDebugger, ReplayInspection } from '../replayDebugger'
import {
  presentNodeHistoryMoment,
  ReplayDebuggerSlot,
  type NodeHistoryMomentInput,
} from '../replayDebuggerSlot'

/** One fake historical debugger whose disposal and presentation the test releases by hand. */
interface FakeDebugger {
  view: ReplayDebugger
  disposals: string[]
  presentations: (string | undefined)[]
  releaseDisposal: () => void
  failDisposal: (error: Error) => void
  setAvailable: (available: boolean) => void
}

/**
 * Makes a fake owner. Its `dispose` stays pending until released or failed when `holdDisposal` is set.
 * @param name - Recorded in `log` when the owner is disposed.
 * @param log - The shared order of disposals across owners.
 * @param options - `holdDisposal` keeps the disposal pending; `inspection` is what `present` answers.
 * @example const first = fakeDebugger('first', log, { holdDisposal: true })
 */
function fakeDebugger(
  name: string,
  log: string[],
  options: { holdDisposal?: boolean; inspection?: ReplayInspection } = {},
): FakeDebugger {
  let available = true
  let release = (): void => {}
  let fail = (_error: Error): void => {}
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  // A failure released before the retirement awaits the gate is handled by the retirement later, never unhandled.
  gate.catch(() => {})
  const disposals: string[] = []
  const presentations: (string | undefined)[] = []
  const view = {
    get available(): boolean {
      return available
    },
    async dispose(): Promise<void> {
      disposals.push(name)
      log.push(`${name}:dispose-start`)
      if (options.holdDisposal) await gate
      log.push(`${name}:dispose-end`)
    },
    async present(
      _snapshot: unknown,
      label: string,
    ): Promise<ReplayInspection> {
      presentations.push(label)
      return options.inspection ?? 'inspected'
    },
    invalidate(): void {},
  } as unknown as ReplayDebugger
  return {
    view,
    disposals,
    presentations,
    releaseDisposal: release,
    failDisposal: fail,
    setAvailable: (value): void => {
      available = value
    },
  }
}

/** A slot over a queue of fake owners, with the disposal callbacks recorded. */
function slotOver(owners: FakeDebugger[]) {
  const reports: unknown[] = []
  const clears: string[] = []
  const created: ReplayDebugger[] = []
  let next = 0
  const slot = new ReplayDebuggerSlot(
    () => {
      const owner = owners[next++]!.view
      created.push(owner)
      return owner
    },
    (error) => reports.push(error),
    () => clears.push('cleared'),
  )
  return { slot, reports, clears, created }
}

/** Lets pending promise callbacks and the retirement's `finally` run. */
async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

const STOP = {
  index: 1,
  source: { path: 'src/theme.ts', hash: 'hash-1' },
  frame: { line: 7 },
  debuggerSnapshot: {},
  facts: [],
} as unknown as NonNullable<NodeHistoryMomentInput['verifiedStop']>

/** Builds the reader-side input of {@link presentNodeHistoryMoment}; the request is current while `current.value` is true. */
function momentInput(
  verifiedStop: NodeHistoryMomentInput['verifiedStop'],
  current: { value: boolean },
): NodeHistoryMomentInput {
  return {
    verifiedStop,
    slotUri: 'codebook-source:/recorded.ts',
    request: 4,
    isRequestCurrent: (request) => request === 4 && current.value,
    serverStopThread: () => undefined,
  }
}

// protects=a new historical debugger owner never starts disposing before the earlier owner finished, so the editor's descriptor factory is registered once (F275); fails_when=two disposals overlap; no_claim=the editor's real session stop (fake owners stand in for ReplayDebugger)
test('retiring a second owner waits until the first owner is fully disposed', async () => {
  // Arrange
  const log: string[] = []
  const first = fakeDebugger('first', log, { holdDisposal: true })
  const second = fakeDebugger('second', log)
  const { slot } = slotOver([first, second])
  const firstRetirement = slot.retire(first.view)

  // Act
  const secondRetirement = slot.retire(second.view)
  await flushMicrotasks()
  const logBeforeRelease = [...log]
  first.releaseDisposal()
  await Promise.all([firstRetirement, secondRetirement])

  // Assert
  assert.deepEqual(logBeforeRelease, ['first:dispose-start'])
  assert.deepEqual(log, [
    'first:dispose-start',
    'first:dispose-end',
    'second:dispose-start',
    'second:dispose-end',
  ])
})

// protects=a debugger the learner stopped is replaced and a running one is kept; fails_when=replaceUnavailable disposes an available owner or leaves an unavailable one current; no_claim=who calls it
test('replaceUnavailable retires only an owner that is no longer available', async () => {
  // Arrange
  const log: string[] = []
  const running = fakeDebugger('running', log)
  const { slot } = slotOver([running])
  const view = slot.ensure()

  // Act
  await slot.replaceUnavailable()
  const keptWhileAvailable = slot.current
  running.setAvailable(false)
  await slot.replaceUnavailable()

  // Assert
  assert.equal(keptWhileAvailable, view)
  assert.equal(slot.current, undefined)
  assert.deepEqual(running.disposals, ['running'])
})

// protects=two overlapping replaceUnavailable calls dispose a stopped owner once; fails_when=the second call disposes the owner again; no_claim=the order of other owners
test('overlapping replaceUnavailable calls dispose the stopped owner once', async () => {
  // Arrange
  const log: string[] = []
  const stopped = fakeDebugger('stopped', log, { holdDisposal: true })
  const { slot } = slotOver([stopped])
  slot.ensure()
  stopped.setAvailable(false)

  // Act
  const firstCall = slot.replaceUnavailable()
  const secondCall = slot.replaceUnavailable()
  await flushMicrotasks()
  stopped.releaseDisposal()
  await Promise.all([firstCall, secondCall])

  // Assert
  assert.deepEqual(stopped.disposals, ['stopped'])
  assert.equal(slot.retiring, false)
})

// protects=a presentation failure of a superseded selection stays quiet while the current selection reports it; fails_when=a superseded failure is thrown or a current one is swallowed; no_claim=the debugger's own failure causes
test('presentFor swallows a superseded failure and rethrows a current one', async () => {
  // Arrange
  const log: string[] = []
  const { slot } = slotOver([fakeDebugger('only', log)])
  const failure = new Error('The historical debugger could not start.')
  const failing = async (): Promise<string> => {
    throw failure
  }

  // Act
  const superseded = await slot.presentFor(() => true, failing)
  const current = await slot
    .presentFor(() => false, failing)
    .catch((error: unknown) => error)

  // Assert
  assert.equal(superseded, undefined)
  assert.equal(current, failure)
})

// protects=a caller that skipped waiting for the retirement fails loudly instead of registering a second descriptor factory (F275); fails_when=ensure or presentFor create an owner while an earlier one is still disposed; no_claim=the message wording beyond its subject
test('ensure and presentFor refuse to create an owner while a retirement runs', async () => {
  // Arrange
  const log: string[] = []
  const retiring = fakeDebugger('retiring', log, { holdDisposal: true })
  const { slot, created } = slotOver([retiring, fakeDebugger('next', log)])
  const owner = slot.ensure()
  const retirement = slot.retire(owner)

  // Act
  const ensureFailure = (() => {
    try {
      slot.ensure()
    } catch (error) {
      return error
    }
  })()
  const presentFailure = await slot
    .presentFor(
      () => false,
      async () => 'presented',
    )
    .catch((error: unknown) => error)
  retiring.releaseDisposal()
  await retirement

  // Assert
  assert.match(String(ensureFailure), /still being disposed/)
  assert.match(String(presentFailure), /still being disposed/)
  assert.equal(created.length, 1)
  assert.equal(slot.retiring, false)
})

// protects=an abandoned request leaves the wait without cancelling the shared disposal; fails_when=an aborted waiter keeps waiting, or its abort stops the disposal other waiters need; no_claim=the signal's reason text
test('an aborted retired() waiter leaves at once while the disposal keeps running', async () => {
  // Arrange
  const log: string[] = []
  const retiring = fakeDebugger('retiring', log, { holdDisposal: true })
  const { slot } = slotOver([retiring])
  const retirement = slot.retire(slot.ensure())
  const controller = new AbortController()
  const waiter = slot
    .retired(controller.signal)
    .catch((error: unknown) => error)

  // Act
  const reason = new Error('The request was cancelled.')
  controller.abort(reason)
  const waiterResult = await waiter
  const stillRetiring = slot.retiring
  retiring.releaseDisposal()
  await retirement

  // Assert
  assert.equal(waiterResult, reason)
  assert.equal(stillRetiring, true)
  assert.deepEqual(log, ['retiring:dispose-start', 'retiring:dispose-end'])
  assert.equal(slot.retiring, false)
})

// protects=a waiter in retired() also waits for a retirement queued behind the one it saw, so ensure() then creates the owner instead of throwing (D29); fails_when=retired() returns when only the first disposal settled while a second still runs; no_claim=the editor's real session stop (fake owners stand in for ReplayDebugger)
test('retired() keeps waiting for a retirement queued while the caller waits', async () => {
  // Arrange
  const log: string[] = []
  const first = fakeDebugger('first', log, { holdDisposal: true })
  const second = fakeDebugger('second', log, { holdDisposal: true })
  const next = fakeDebugger('next', log)
  const { slot, created } = slotOver([first, next])
  const firstRetirement = slot.retire(slot.ensure())
  let didWake = false
  const waiter = slot.retired().then(() => {
    didWake = true
  })
  const secondRetirement = slot.retire(second.view)

  // Act
  first.releaseDisposal()
  await flushMicrotasks()
  const didWakeAfterFirst = didWake
  second.releaseDisposal()
  await waiter
  const ensured = slot.ensure()
  await Promise.all([firstRetirement, secondRetirement])

  // Assert
  assert.equal(didWakeAfterFirst, false)
  assert.equal(ensured, next.view)
  assert.equal(created.length, 2)
  assert.deepEqual(log, [
    'first:dispose-start',
    'first:dispose-end',
    'second:dispose-start',
    'second:dispose-end',
  ])
})

// protects=an aborted signal still ends the wait at once while a second retirement is queued; fails_when=the loop keeps an aborted waiter waiting for the later retirement; no_claim=the signal's reason text
test('an aborted retired() waiter leaves at once although a second retirement is queued', async () => {
  // Arrange
  const log: string[] = []
  const first = fakeDebugger('first', log, { holdDisposal: true })
  const second = fakeDebugger('second', log, { holdDisposal: true })
  const { slot } = slotOver([first])
  const firstRetirement = slot.retire(slot.ensure())
  const secondRetirement = slot.retire(second.view)
  const controller = new AbortController()
  const waiter = slot
    .retired(controller.signal)
    .catch((error: unknown) => error)

  // Act
  const reason = new Error('The request was cancelled.')
  controller.abort(reason)
  const waiterResult = await waiter
  const stillRetiring = slot.retiring
  first.releaseDisposal()
  second.releaseDisposal()
  await Promise.all([firstRetirement, secondRetirement])

  // Assert
  assert.equal(waiterResult, reason)
  assert.equal(stillRetiring, true)
  assert.equal(slot.retiring, false)
})

// protects=a superseded request whose ensure() refuses during a retirement ends quietly while the current request rethrows the refusal; fails_when=presentFor throws for a superseded request or swallows the refusal for the current one; no_claim=the message wording beyond its subject
test('presentFor returns undefined for a superseded request refused during a retirement and rethrows for the current one', async () => {
  // Arrange
  const log: string[] = []
  const retiring = fakeDebugger('retiring', log, { holdDisposal: true })
  const { slot } = slotOver([retiring])
  const retirement = slot.retire(slot.ensure())
  const present = async (): Promise<string> => 'presented'

  // Act
  const superseded = await slot.presentFor(() => true, present)
  const current = await slot
    .presentFor(() => false, present)
    .catch((error: unknown) => error)
  retiring.releaseDisposal()
  await retirement

  // Assert
  assert.equal(superseded, undefined)
  assert.match(String(current), /still being disposed/)
})

// protects=a failed disposal is told once and never thrown, and a later clean disposal withdraws it; fails_when=the failure is reported twice, thrown to the caller, or never cleared; no_claim=how the reader words the failure row
test('a disposal failure is reported once and a later clean disposal clears it', async () => {
  // Arrange
  const log: string[] = []
  const failing = fakeDebugger('failing', log, { holdDisposal: true })
  const clean = fakeDebugger('clean', log)
  const { slot, reports, clears } = slotOver([failing, clean])
  const failure = new Error('The historical debugger did not stop.')
  const failedRetirement = slot.retire(slot.ensure())
  failing.failDisposal(failure)

  // Act
  await failedRetirement
  const reportsAfterFailure = [...reports]
  const clearsAfterFailure = clears.length
  await slot.retire(clean.view)

  // Assert
  assert.deepEqual(reportsAfterFailure, [failure])
  assert.equal(clearsAfterFailure, 0)
  assert.deepEqual(reports, [failure])
  assert.equal(clears.length, 1)
})

// protects=the live owner is one object across awaits, so a presentation and the reader's invalidation address the same debugger; fails_when=ensure or presentFor replace the owner while it is live; no_claim=the owner after a retirement
test('current stays the same owner across ensure and awaited presentations', async () => {
  // Arrange
  const log: string[] = []
  const { slot, created } = slotOver([fakeDebugger('only', log)])
  const first = slot.ensure()

  // Act
  await slot.presentFor(
    () => false,
    async (debuggerView) => debuggerView,
  )
  await Promise.resolve()
  const second = slot.ensure()

  // Assert
  assert.equal(second, first)
  assert.equal(slot.current, first)
  assert.equal(created.length, 1)
})

// protects=a verified stop reports the debugger as available and its values as inspected; fails_when=the flags are swapped or the stop is not presented; no_claim=the reader's commit of the flags
test('presentNodeHistoryMoment reports an inspected verified stop', async () => {
  // Arrange
  const owner = fakeDebugger('owner', [], { inspection: 'inspected' })
  const { slot } = slotOver([owner])

  // Act
  const result = await presentNodeHistoryMoment(
    slot,
    momentInput(STOP, { value: true }),
  )

  // Assert
  assert.deepEqual(result, {
    presented: true,
    debugAvailable: true,
    valuesUninspected: false,
  })
  assert.deepEqual(owner.presentations, [
    'Recorded test stop 2 · src/theme.ts:7',
  ])
})

// protects=a stop whose values were not loaded in time keeps the uninspected hint; fails_when=valuesUninspected stays false after an 'uninspected' answer; no_claim=the hint's wording
test('presentNodeHistoryMoment reports uninspected values of a verified stop', async () => {
  // Arrange
  const owner = fakeDebugger('owner', [], { inspection: 'uninspected' })
  const { slot } = slotOver([owner])

  // Act
  const result = await presentNodeHistoryMoment(
    slot,
    momentInput(STOP, { value: true }),
  )

  // Assert
  assert.deepEqual(result, {
    presented: true,
    debugAvailable: true,
    valuesUninspected: true,
  })
})

// protects=a moment without a recorded stop starts the debugger on the Not recorded thread and reports no debug stop; fails_when=debugAvailable is true for a gap or the thread is not presented; no_claim=the debugger's frames
test('presentNodeHistoryMoment starts the Not recorded thread for a moment without a stop', async () => {
  // Arrange
  const owner = fakeDebugger('owner', [])
  const { slot } = slotOver([owner])

  // Act
  const result = await presentNodeHistoryMoment(
    slot,
    momentInput(undefined, { value: true }),
  )

  // Assert
  assert.deepEqual(result, {
    presented: true,
    debugAvailable: false,
    valuesUninspected: false,
  })
  assert.deepEqual(owner.presentations, ['Not recorded at this moment'])
})

// protects=a selection overtaken while a retirement runs creates and presents nothing, for a stop and for a gap; fails_when=the overtaken selection still creates an owner; no_claim=the newer selection's own presentation
test('presentNodeHistoryMoment presents nothing for a selection superseded during a retirement', async () => {
  // Arrange
  const log: string[] = []
  const retiring = fakeDebugger('retiring', log, { holdDisposal: true })
  const next = fakeDebugger('next', log)
  const { slot, created } = slotOver([retiring, next])
  const retirement = slot.retire(slot.ensure())
  const current = { value: true }
  const stopResult = presentNodeHistoryMoment(slot, momentInput(STOP, current))
  const gapResult = presentNodeHistoryMoment(
    slot,
    momentInput(undefined, current),
  )

  // Act
  current.value = false
  retiring.releaseDisposal()
  await retirement

  // Assert
  assert.deepEqual(await stopResult, { presented: false })
  assert.deepEqual(await gapResult, { presented: false })
  assert.equal(created.length, 1)
  assert.deepEqual(next.presentations, [])
})
