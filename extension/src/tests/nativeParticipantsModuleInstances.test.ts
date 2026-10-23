import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

const pauseReady = async (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'server committed stop')

const hasEvent = (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
  type: string,
): boolean => harness.run.view().events.some((event) => event.type === type)

/** Sends the click and waits until the server runs, with the first declared pause held back. */
const startActionWithoutPause = async (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
): Promise<void> => {
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
}

// Value: protects=a server stop whose line runs in the module Next parsed for another webpack layer than the sealed one (the (middleware) copy of auth.config.ts) being captured as the stop (F435, native run 2 of cycle 0050); fails_when=a pause is accepted only in the one script that was sealed, so the declared stop times out waiting for a pause that already happened elsewhere; no_claim=that js-debug pauses in every layer's script, or that the real Next layers map this way (native trial)
test('a server stop is captured when its line runs in the module parsed for another webpack layer than the sealed one', async (context) => {
  // Arrange: the sealed module is the (action-browser) one; the (middleware) copy has an extra leading line, so its declared line is generated line 2.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.line, 1)
  assert.equal(server.source.column, 1)
  assert.equal(server.source.scriptId, 'middleware')
  assert.equal(
    server.source.scriptUrl,
    'webpack-internal:///(middleware)/./src/mode.ts',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
})

// Value: protects=a stop registered before the executing layer's module loads still being captured when that module is parsed right before the pause, while its text is still being read; fails_when=a pause that arrives before the new script is accepted stays held as a foreign pause and the stop times out; no_claim=how long js-debug takes to pause after it parses a script
test('a server stop is captured when the other layer’s module is parsed in the instant before its pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  // Act: the module is parsed and the debugger pauses in it before the run has read its text.
  harness.announceModuleInAnotherLayer('server', 'rsc', 'rsc', ';AAAA')
  harness.pauseInScript('server', 'rsc', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.line, 1)
  assert.equal(server.source.scriptId, 'rsc')
  assert.equal(harness.run.view().snapshots.length, 1)
})

// Value: protects=a pause in another layer's module whose map retains a different original never being taken for the declared stop; fails_when=any script of the same address pattern is accepted without checking that its map maps onto the frozen original; no_claim=that the sealed module's own checks are enough for it
test('a pause in another layer’s module whose map retains another original is never captured as the stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
    'export var mode = "other";\n',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-refused'),
    'the foreign original refused',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
  assert.equal(hasEvent(harness, 'stop.instance-sealed'), false)
})

// Value: protects=a pause in another layer's module at a generated place its own map does not put on the declared line (here the unmapped leading line) being judged as a pause elsewhere and never committed as the stop; fails_when=the stop is accepted by the sealed map's coordinates (generated line 0 is the declared line there) while the pause is in the other script; no_claim=what the run reports for such a pause beyond refusing to commit it
test('a pause at an unmapped place of another layer’s module is never captured as the stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act: generated 0:0 is the leading line of the instance, which sits at the declared place only in the sealed module.
  harness.pauseInScript('server', 'middleware', 0, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})
