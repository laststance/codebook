import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

type Harness = Awaited<ReturnType<typeof nativeParticipantsHarness>>

/** The script URL the harness's server module is sealed and announced under. */
const SERVER_MODULE_URL = 'webpack-internal:///(action-browser)/./src/mode.ts'

/**
 * A module as a server action build emits it, as in the module-instance tests: a documented function over lines 4 to 8 and a registration call appended at the module's end. The declared stop is on line 3, above the function.
 */
const APPENDED_REGISTRATION_MODULE = {
  source:
    '/**\n * Authenticates.\n */\nexport async function authenticate(\n  mode,\n) {\n  return mode\n}\n',
  javascript:
    '/**\n * Authenticates.\n */\nexport async function authenticate(\n  mode,\n) {\n  return mode\n}\nregisterServerReference(authenticate)\n',
  mappings: ';;CAEC;OACM,eAAe;EACpB;AACF;EACE;AACF;AAJsB',
}

const pauseReady = async (harness: Harness) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'server committed stop')

/** Reads the details of every journal entry of a type, as plain data. */
const journaled = (harness: Harness, type: string): unknown[] =>
  harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))

/** Lets the reads and journal writes that are already settled run. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 3; turn++)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
}

/** Sends the click with the first declared pause held back and announces the sealed script A. */
const startWithSealedScript = async (harness: Harness): Promise<void> => {
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
}

const coexistingCount = (harness: Harness): number =>
  journaled(harness, 'stop.instance-coexisting').length

/** Announces a coexisting instance and waits until the run accepted it. */
const acceptInstance = async (
  harness: Harness,
  scriptId: string,
  mappings = ';AAAA',
): Promise<void> => {
  const before = coexistingCount(harness)
  harness.announceModuleAgain('server', scriptId, mappings)
  await waitUntil(
    () => coexistingCount(harness) === before + 1,
    `${scriptId} accepted as a coexisting instance`,
  )
}

// Value: protects=a shared server module parsed again for a later route (script ids 3794, 5036, 6507 in the spike) keeping the run and every earlier instance alive, so the editor breakpoint's pause in the second instance is still the stop's; fails_when=the new announcement fails the run with "Selected module changed after sealing" or the third script evicts the second instance before its first hit; no_claim=that the real Next compiles the ids in this order (native trial)
test('a server stop is captured in a coexisting instance after a third script of the same module was accepted before its first hit', async (context) => {
  // Arrange: sealed A, then B and C parsed under new ids at the sealed address
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startWithSealedScript(harness)
  await acceptInstance(harness, 'B')
  await acceptInstance(harness, 'C')
  // Act
  harness.pauseInScript('server', 'B', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.scriptId, 'B')
  assert.equal(server.source.line, 1)
  assert.deepEqual([...harness.run['stops'][0]!.instances.keys()].sort(), [
    'B',
    'C',
  ])
  assert.equal(harness.run['stops'][0]!.script?.scriptId, 'server')
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=an instance whose text is still being read when a newer script of the same module is accepted being adopted when its read ends; fails_when=the newer script removes the older entry still being read, so the older instance is never adopted and its pause is not the stop's; no_claim=the length of a real read
test('a coexisting instance whose text was in flight when a newer one was accepted is adopted later and captures', async (context) => {
  // Arrange: B's read is held
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startWithSealedScript(harness)
  const read = harness.holdScriptSourceRead('server', 'B')
  harness.announceModuleAgain('server', 'B', ';AAAA')
  await settle()
  // Act: C is accepted while B is in flight, then B's read ends
  await acceptInstance(harness, 'C')
  read.release()
  await waitUntil(() => coexistingCount(harness) === 2, 'B adopted later')
  harness.pauseInScript('server', 'B', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.scriptId, 'B')
  assert.deepEqual([...harness.run['stops'][0]!.instances.keys()].sort(), [
    'B',
    'C',
  ])
})

// Value: protects=a captured pause in a coexisting instance keeping its snapshot and its continue when a later route compiles another instance; fails_when=C's acceptance evicts B or fails the run while B's pause is held, so the continue fails or the snapshot is lost; no_claim=that js-debug resumes the pause in a real run
test('a pause captured in a coexisting instance keeps its snapshot and continues after another instance is accepted', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startWithSealedScript(harness)
  await acceptInstance(harness, 'B')
  harness.pauseInScript('server', 'B', 1, 0)
  const server = await pauseReady(harness)
  // Act
  await acceptInstance(harness, 'C')
  await harness.run.continue('server', server.pause)
  await waitUntil(
    () => harness.run.view().operation?.afterVerified,
    'the operation completed after the continue',
  )
  // Assert
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().snapshots[0]!.id, server.id)
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(harness.run['stops'][0]!.instances.has('B'), true)
})

// Value: protects=a binding judgement taken in one coexisting instance not being reused for another whose generated code and break locations differ; fails_when=the second instance's pause at the same generated place is accepted by the kept judgement of the first, so the debugger is not asked for the second instance's break locations; no_claim=that js-debug lists these locations (native trial)
test('an identical original with other generated code is judged again in the new coexisting instance', async (context) => {
  // Arrange: the stop is bound at 7:3 past the function head; B and C hold the same original under their own break locations
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: APPENDED_REGISTRATION_MODULE.mappings },
    fixture: {
      server: {
        source: APPENDED_REGISTRATION_MODULE.source,
        javascript: APPENDED_REGISTRATION_MODULE.javascript,
        citationEndLine: 8,
        declaredLine: 3,
      },
    },
  })
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 6, columnNumber: 2 },
    { lineNumber: 8, columnNumber: 0 },
  ])
  const shifted = [
    { lineNumber: 7, columnNumber: 2 },
    { lineNumber: 9, columnNumber: 0 },
  ]
  harness.listPossibleBreakLocations('server', shifted, 'B')
  harness.listPossibleBreakLocations(
    'server',
    [{ lineNumber: 4, columnNumber: 0 }, ...shifted],
    'C',
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.expireSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  await acceptInstance(
    harness,
    'B',
    `;${APPENDED_REGISTRATION_MODULE.mappings}`,
  )
  await acceptInstance(
    harness,
    'C',
    `;${APPENDED_REGISTRATION_MODULE.mappings}`,
  )
  // Act: the same binding at the same generated place is judged in B, then in C
  const stop = harness.run['stops'][0]!
  const bound = { line: 7, column: 3 }
  const judgeIn = (scriptId: string) =>
    harness.run['acceptsByBreakLocations'](stop, bound, {
      scriptId,
      lineNumber: 7,
      columnNumber: 2,
    })
  const acceptedInB = await judgeIn('B')
  const acceptedInC = await judgeIn('C')
  await harness.run.stop()
  // Assert
  const scripts = harness.breakLocationRequests.map(
    (request) => request.start.scriptId,
  )
  assert.deepEqual([acceptedInB, acceptedInC], [true, true])
  assert.equal(scripts.filter((id) => id === 'B').length, 1)
  assert.equal(scripts.filter((id) => id === 'C').length, 1)
  assert.equal(stop.judgedBinding?.scriptId, 'C')
})

// Value: protects=a shared module parsed again with another original text ending the run with SOURCE_CHANGED when it is verified, with no hit; fails_when=the mismatch is swallowed as a refused instance, so the run waits for a pause and times out; no_claim=what a rebuild between routes does in a real server
test('a module parsed again with another original text ends the run with SOURCE_CHANGED without any hit', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startWithSealedScript(harness)
  // Act: no pause is sent
  harness.announceModuleAgain(
    'server',
    'B',
    ';AAAA',
    'export var mode = "other";\n',
  )
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the run failed on verification',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "SOURCE_CHANGED: src/mode.ts changed during the run, so Codebook stopped it. Earlier captured observations remain readable. The click's result was not verified.",
  )
  assert.equal(journaled(harness, 'stop.instance-refused').length, 0)
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a read failure of a coexisting instance staying a refused instance and not a changed source; fails_when=every refusal of a same-address script ends the run with SOURCE_CHANGED; no_claim=the length of the real read deadline
test('a coexisting instance whose text cannot be read is refused and the run goes on', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startWithSealedScript(harness)
  harness.failScriptSourceRead('server', 'B', 'No script with this id')
  // Act
  harness.announceModuleAgain('server', 'B', ';AAAA')
  await waitUntil(
    () => journaled(harness, 'stop.instance-refused').length === 1,
    'B refused',
  )
  await acceptInstance(harness, 'C')
  // Assert
  assert.equal(harness.run.view().status === 'failed', false)
  assert.deepEqual([...harness.run['stops'][0]!.instances.keys()], ['C'])
})
