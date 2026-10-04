import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { thrownMessage } from '../utils/thrownMessage'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { retainStoppedRun } from './utils/retainStoppedRun'

test('internal browser setup stops do not consume the configured learning pause or prevent its later completion', async (context) => {
  // Arrange
  const { run, resumeDuringPreparation, mouse, commands } =
    await configuredRuntimeHarness(context)
  resumeDuringPreparation()
  // Act
  await run.prepare()
  // Assert: setup notifications grant no learner pause or input authority.
  assert.equal(run.view().status, 'ready')
  assert.equal(run.view().snapshots.length, 0)
  assert.equal(mouse.length, 0)
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'configured learning pause',
  )
  await run.continue('browser', snapshot.pause)
  await waitUntil(
    () => run.view().status === 'completed',
    'configured completion',
  )
  await run.stop()
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(mouse.length, 2)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
})

test('a required value inspection of an object commits the stop with an object marker and the run continues to completion', async (context) => {
  // Arrange: the agent asked for value:nextTheme, which is an application object at the pause.
  const { run, useObjectValue, commands } =
    await configuredRuntimeHarness(context)
  useObjectValue()
  await run.prepare()
  // Act
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'configured learning pause',
  )
  await run.continue('browser', snapshot.pause)
  await waitUntil(
    () => run.view().status === 'completed',
    'configured completion',
  )
  await run.stop()
  // Assert: the pause is not the end of the run; the object's members are not captured facts.
  assert.deepEqual(snapshot.values['value:nextTheme'], { type: 'object' })
  assert.deepEqual(
    snapshot.unavailableValues.map((value) => value.path),
    ['value:renderLocal'],
  )
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
})

test('VS Code startup cannot hit Codebook’s click breakpoint before the learner input', async (context) => {
  // Arrange: the installed host can report a breakpoint stop while the page hydrates.
  const { run, stopOnStartupWhenOwnedBreakpointPresent, mouse, commands } =
    await configuredRuntimeHarness(context)
  stopOnStartupWhenOwnedBreakpointPresent()
  // Act
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'configured learning pause',
  )
  await run.continue('browser', snapshot.pause)
  await waitUntil(
    () => run.view().status === 'completed',
    'configured completion',
  )
  await run.stop()
  // Assert: the only accepted debugger stop follows Codebook's own click.
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(mouse.length, 2)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
})

// Value: protects=a browser stop committing where the debugger has its breakpoint at the pause; fails_when=the binding read at arming is kept, so a breakpoint the debugger moved afterwards fails the run with a frame mismatch; why_new=Cycle 0036 C04b; seam=bindFirstStopAt after arming
test('a browser stop whose binding the debugger moved to another column after arming commits at the column read again at its pause', async (context) => {
  // Arrange: the stop is armed at 1:1; afterwards the adapter reports the breakpoint, and pauses, at 1:7. A pause away from the armed column is taken as the stop's only when the wait for a pause at that column has ended (0042-SR14), so the test ends that wait itself instead of spending its 3 s.
  const { run, bindFirstStopAt, holdSourceBoundWait } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: 'AAAA,MAAM',
    })
  await run.prepare()
  bindFirstStopAt(1, 7)
  const sourceBoundWait = holdSourceBoundWait()

  // Act
  run.action('moved-after-arming', 'repository-click')
  await waitUntil(
    () => run.view().events.some((event) => event.type === 'dap.stopped'),
    'stop announced',
  )
  sourceBoundWait.release()
  const stop = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'stop committed at the re-read column')
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()

  // Assert
  assert.equal(stop.source.line, 1)
  assert.equal(stop.source.column, 7)
  assert.equal(run.view().finalOutcome, 'demonstrated')
})

// Value: protects=a run whose sealed source map the position scanner rejects; fails_when=the scanner's error escapes as an unexplained crash after input, or the run is prepared on a map it cannot read; why_new=Cycle 0036 C07d (no test fed the scanner a rejected map); seam=none
test('a sealed source map with a malformed segment is refused at preparation, before any input', async (context) => {
  // Arrange: 'AA' is a segment of two fields, which no source map allows.
  const { run, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { mappings: 'AA' },
  )

  // Act
  const refusal = await run.prepare().then(
    () => 'prepared',
    (error: unknown) => thrownMessage(error),
  )
  await run.stop()

  // Assert
  assert.equal(refusal, 'Invalid source map segment')
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('an unbound configured stop reports sealed map positions as unverified hints without clicking the application', async (context) => {
  // Arrange: the debugger never verifies a binding even though the frozen source map has a position on the declared line.
  const { run, rejectBreakpointBinding, mouse } =
    await configuredRuntimeHarness(context)
  rejectBreakpointBinding()
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.ok(
      error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string',
    )
    assert.match(
      error.message,
      /^Timed out waiting for a verified binding of declared stop src\/theme\.ts:1 on its declared line or a later line its binding rule accepts \(requested column 1\)/,
    )
    assert.match(
      error.message,
      /Frozen source map positions in the selected citation: 1:1\. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them/,
    )
    return true
  })
  await run.stop()
  // Assert: a mapping hint cannot authorize input or mark the run demonstrated.
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('an unsatisfied before condition names the failing predicate without clicking the application', async (context) => {
  // Arrange: preparation observes a consistently hidden declared element.
  const { run, setReady, mouse } = await configuredRuntimeHarness(context)
  setReady(false)
  // Act / Assert
  await assert.rejects(
    run.prepare(),
    /configured before conditions: condition 1 \(visible\) not-visible/,
  )
  await run.stop()
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=the agent reading in the run's failure that its text is on the page beside other text and how to correct a before condition; fails_when=the relation the page reported is dropped on the way to the timeout text, or the fix sentence drifts; why_new=a text mismatch ended a natural run with only "text-mismatch" (Cycle 0039, N8-a); seam=none
test('a before text condition whose element holds more text ends the run with the rule and the fix, without clicking the application', async (context) => {
  // Arrange: the declared before condition is a text condition, and the page keeps answering that the element holds the text beside other text.
  const { run, failBeforeWith, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { before: [{ kind: 'text', selector: 'button', equals: 'Log in' }] },
  )
  failBeforeWith({
    conditionIndex: 0,
    reason: 'text-mismatch',
    textDifference: 'surrounding-text',
  })
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert
  // The run is loaded in its own module context, so its error is read by shape, not by `instanceof`.
  assert.equal(
    thrownMessage(failure),
    "Timed out waiting for configured before conditions: condition 1 (text) text-mismatch. A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied. Here the element holds the expected text beside other text; use a visible condition, or a selector whose element holds only that text.",
  )
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a plain text mismatch telling the agent what a text condition compares; fails_when=the rule sentence is missing from the timeout text; why_new=a text mismatch had no hint; seam=none
test('a before text condition on other text ends the run with the comparison rule', async (context) => {
  // Arrange
  const { run, failBeforeWith, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { before: [{ kind: 'text', selector: 'button', equals: 'Log in' }] },
  )
  failBeforeWith({ conditionIndex: 0, reason: 'text-mismatch' })
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert
  // The run is loaded in its own module context, so its error is read by shape, not by `instanceof`.
  assert.equal(
    thrownMessage(failure),
    "Timed out waiting for configured before conditions: condition 1 (text) text-mismatch. A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied.",
  )
  assert.equal(mouse.length, 0)
})

// Value: protects=a relation the run does not know failing the read at once instead of being dropped and polled for twenty seconds; fails_when=the result schema strips or accepts an unknown textDifference; why_new=the field is new and the base schema dropped unknown keys; seam=none
// Cycle 0044 (0041-F1): red while the run's own 20 s deadline, armed before the after wait with the same bound, ended the run with "Repository after condition or input acknowledgement timed out" and the hint was lost.
test('an after text condition that never holds ends the run with the after timeout text and its hint, not the plain deadline text', async (context) => {
  // Arrange
  const { run, advance, failAfterWith, afterReads } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'captured pause',
  )
  failAfterWith({
    conditionIndex: 0,
    reason: 'text-mismatch',
    textDifference: 'surrounding-text',
  })
  await run.continue('browser', snapshot.pause)
  await waitUntil(() => afterReads() > 0, 'after condition read')
  // Act
  advance(20_000)
  await run.stop()
  // Assert
  assert.deepEqual(
    [...run.view().failures],
    [
      "Timed out waiting for configured after conditions: condition 1 (text) text-mismatch. A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied. Here the element holds the expected text beside other text; keep the text check and choose a selector whose element holds only that text.",
    ],
  )
  assert.equal(run.view().operation?.afterVerified, false)
})

test('a text relation the run does not know fails the read at once instead of timing out', async (context) => {
  // Arrange
  const { run, failBeforeWith, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { before: [{ kind: 'text', selector: 'button', equals: 'Log in' }] },
  )
  failBeforeWith({
    conditionIndex: 0,
    reason: 'text-mismatch',
    textDifference: 'longer',
  })
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert
  assert.match(thrownMessage(failure), /textDifference/)
  assert.doesNotMatch(thrownMessage(failure), /Timed out/)
  assert.equal(mouse.length, 0)
})

// Value: protects=the attribute hints reaching the timeout text unchanged after they moved into the hint utility; fails_when=the run stops passing the phase or the declared condition to the utility; why_new=the two sentences had no run-level test; seam=none
test('a before value attribute condition still ends the run with the before-input sentence, and another attribute with the entire-value sentence', async (context) => {
  // Arrange
  const valueRun = await configuredRuntimeHarness(context, undefined, [], {
    before: [
      {
        kind: 'attribute',
        selector: 'input',
        attribute: 'value',
        equals: 'user@example.com',
      },
    ],
  })
  valueRun.failBeforeWith({ conditionIndex: 0, reason: 'attribute-mismatch' })
  const classRun = await configuredRuntimeHarness(context, undefined, [], {
    before: [
      {
        kind: 'attribute',
        selector: 'button',
        attribute: 'class',
        equals: 'primary',
      },
    ],
  })
  classRun.failBeforeWith({ conditionIndex: 0, reason: 'attribute-mismatch' })
  // Act
  const valueFailure = await valueRun.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await valueRun.run.stop()
  const classFailure = await classRun.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await classRun.run.stop()
  // Assert
  assert.equal(
    thrownMessage(valueFailure),
    'Timed out waiting for configured before conditions: condition 1 (attribute) attribute-mismatch. Before conditions are checked before initialInputs are inserted; choose a condition observable on the fresh page.',
  )
  assert.equal(
    thrownMessage(classFailure),
    'Timed out waiting for configured before conditions: condition 1 (attribute) attribute-mismatch. An attribute condition compares the entire value; use a CSS class selector to test class membership.',
  )
})

test('a real debugger stop before configured input still fails instead of being ignored as browser setup', async (context) => {
  // Arrange
  const { run, emitPause, mouse, commands } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  // Act
  emitPause()
  await run.stop()
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().snapshots.length, 0)
  assert.equal(mouse.length, 0)
  assert.match(
    run.view().failures.join('\n'),
    /Unexpected or additional browser stop/,
  )
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
})

test('a debugger-revealed raw source tab does not prevent the matching configured pause image or alter the learner document', async (context) => {
  // Arrange
  const { run, hideViewportOnPause, documents, commands } =
      await configuredRuntimeHarness(context),
    document = documents[0]!
  await run.prepare()
  hideViewportOnPause()
  // Act
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'captured pause',
  )
  // Assert
  assert.equal(run.view().status, 'paused-browser')
  assert.equal(run.view().captures['paused-browser']?.status, 'captured')
  assert.equal(documents[0], document)
  assert.equal(document.text, 'const nextTheme = "dark";\n')
  assert.equal(document.isDirty, false)
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  await run.continue('browser', snapshot.pause)
  await waitUntil(
    () => run.view().status === 'completed',
    'configured completion',
  )
  await run.stop()
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(run.view().captureOutcome, 'complete')
})

test('an input-time browser resume fails before its stop can obtain DAP correlation or continuation authority', async (context) => {
  // Arrange
  const {
    run,
    suppressInputPause,
    emitCdpPause,
    manualResume,
    mouse,
    commands,
  } = await configuredRuntimeHarness(context)
  await run.prepare()
  suppressInputPause()
  run.action('one', 'repository-click')
  await waitUntil(() => mouse.length === 2, 'configured input')
  // Act
  emitCdpPause()
  manualResume()
  await run.stop()
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().snapshots.length, 0)
  assert.equal(mouse.length, 2)
  assert.equal(run.view().operation?.afterVerified, false)
  assert.match(
    run.view().failures.join('\n'),
    /resumed outside its owned continuation/,
  )
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
})

test('a second browser-only stop during capture revokes continuation before any second DAP stop arrives', async (context) => {
  // Arrange
  const { run, emitCdpPause, holdCapture, mouse, commands } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  const held = holdCapture('paused-browser')
  run.action('one', 'repository-click')
  await held.started
  // Act
  emitCdpPause()
  held.release()
  await run.stop()
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().snapshots.length, 0)
  assert.equal(mouse.length, 2)
  assert.equal(run.view().operation?.afterVerified, false)
  assert.match(run.view().failures.join('\n'), /Additional browser stop/)
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
})

test('one configured browser action keeps a 70-second pause controllable and completes only after original continuation input and renderer ACKs', async (context) => {
  // Arrange
  const { run, advance, mouse, breakpoints, userBreakpoint, commands } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  // Act
  const accepted = run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'configured captured stop',
  )
  advance(70000)
  // Assert: synthetic protocol timing, not native motion or latency evidence.
  assert.equal(run.view().status, 'paused-browser')
  assert.equal(run.view().operation?.inputAcknowledged, false)
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.values)), {
    'value:nextTheme': 'dark',
    'type:setTheme': 'function',
    'value:enabled': false,
    'value:selection': null,
  })
  assert.deepEqual(breakpoints, [userBreakpoint])
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  assert.deepEqual(mouse, [
    { type: 'mousePressed', timeout: 600000 },
    { type: 'mouseReleased', timeout: 600000 },
  ])
  await run.continue('browser', snapshot.pause)
  await waitUntil(
    () => run.view().status === 'completed',
    'configured completion',
  )
  await run.stop()
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(run.view().resourcesReleased, true)
  assert.equal(run.view().operation?.afterVerified, true)
  assert.deepEqual(run.action('one', 'repository-click'), accepted)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
  assert.deepEqual(Object.keys(run.view().participants), ['browser'])
  assert.deepEqual(breakpoints, [userBreakpoint])
})

test('a second selected stop during capture cancels the observation instead of overwriting it or granting continuation', async (context) => {
  // Arrange
  const { run, holdCapture, emitPause, commands } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  const held = holdCapture('paused-browser')
  run.action('one', 'repository-click')
  await held.started
  // Act
  emitPause()
  held.release()
  await run.stop()
  // Assert
  assert.equal(run.view().status, 'failed')
  assert.equal(run.view().snapshots.length, 0)
  assert.equal(run.view().operation?.afterVerified, false)
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  assert.equal(run.view().participants.browser.pause, undefined)
})

for (const missing of ['response', 'dap', 'cdp', 'input'] as const)
  test(`configured Continue cannot certify completion without its ${missing} acknowledgement`, async (context) => {
    // Arrange
    const { run, holdContinuation, advance, commands, mouse } =
        await configuredRuntimeHarness(context),
      receipts = holdContinuation()
    await run.prepare()
    run.action('one', 'repository-click')
    const snapshot = await waitUntil(
      () => run.view().snapshots[0],
      'captured pause',
    )
    const continuation = run.continue('browser', snapshot.pause).then(
      () => 'acknowledged',
      () => 'rejected',
    )
    await receipts.started
    // Act: the other independent receipts cannot stand in for the missing one.
    for (const receipt of ['response', 'dap', 'cdp', 'input'] as const)
      if (receipt !== missing) receipts[receipt]()
    await new Promise<void>((resolve) => setImmediate(resolve))
    // Assert
    assert.equal(run.view().operation?.afterVerified, false)
    assert.equal(run.view().captures.after, undefined)
    advance(20000)
    await run.stop()
    assert.equal(
      await continuation,
      missing === 'response' ? 'rejected' : 'acknowledged',
    )
    assert.equal(run.view().finalOutcome, 'not-demonstrated')
    assert.equal(run.view().resourcesReleased, true)
    assert.equal(run.view().snapshots[0], snapshot)
    assert.equal(mouse.length, 2)
    assert.equal(commands.filter((command) => command === 'continue').length, 1)
  })

for (const order of [
  ['response', 'dap', 'cdp'],
  ['response', 'cdp', 'dap'],
  ['dap', 'response', 'cdp'],
  ['dap', 'cdp', 'response'],
  ['cdp', 'response', 'dap'],
  ['cdp', 'dap', 'response'],
] as const)
  test(`configured Continue completes once when acknowledgements arrive ${order.join(' then ')}`, async (context) => {
    // Arrange
    const { run, holdContinuation, commands, mouse } =
        await configuredRuntimeHarness(context),
      receipts = holdContinuation()
    await run.prepare()
    run.action('one', 'repository-click')
    const snapshot = await waitUntil(
      () => run.view().snapshots[0],
      'captured pause',
    )
    const continuation = run.continue('browser', snapshot.pause)
    await receipts.started
    receipts.input()
    // Act / Assert: every proper prefix remains incomplete, independent of receipt order.
    for (const [index, receipt] of order.entries()) {
      receipts[receipt]()
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (index < 2) assert.equal(run.view().operation?.afterVerified, false)
    }
    await continuation
    await waitUntil(
      () => run.view().status === 'completed',
      'verified after state',
    )
    await run.stop()
    assert.equal(run.view().finalOutcome, 'demonstrated')
    assert.equal(run.view().operation?.afterVerified, true)
    assert.equal(
      run.view().events.filter((event) => event.type === 'screen.observed')
        .length,
      1,
    )
    assert.equal(mouse.length, 2)
    assert.equal(commands.filter((command) => command === 'continue').length, 1)
  })

// Cycle 0044 (0042-SR4): the duplicate-continued row is gone; since ER2 a second continued after a complete continuation is the adapter's idle one and must not revoke (nativeParticipants "a continued and a pause the debugger makes for itself after the last continuation do not end the run, and it completes"). The foreign-thread row now asserts the revocation itself, which run.stop() alone also produced.
test('a continued for another thread after authorized Continue revokes completion as an unowned continuation without another input', async (context) => {
  // Arrange
  const { run, holdContinuation, commands, mouse } =
      await configuredRuntimeHarness(context),
    receipts = holdContinuation()
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'captured pause',
  )
  const continuation = run
    .continue('browser', snapshot.pause)
    .catch(() => undefined)
  await receipts.started
  // Act: the foreign notification races the authorized continuation while its own continued is still missing.
  receipts.response()
  receipts.input()
  receipts.dap(99)
  receipts.cdp()
  await continuation
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Unowned continuation invalidated live pause',
  )
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().operation?.afterVerified, false)
  assert.equal(run.view().snapshots[0], snapshot)
  assert.equal(run.view().resourcesReleased, true)
  assert.equal(mouse.length, 2)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
})

test('a second selected stop racing the after renderer cannot replace the first observation or certify completion', async (context) => {
  // Arrange
  const { run, holdCapture, emitPause } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'first stop'),
    held = holdCapture('after')
  await run.continue('browser', snapshot.pause)
  await held.started
  // Act
  emitPause()
  held.release()
  await run.stop()
  // Assert
  assert.equal(run.view().snapshots[0], snapshot)
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(run.view().operation?.afterVerified, false)
  assert.equal(run.view().captures.after?.status, 'failed')
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('removing an editor breakpoint without the adapter acknowledgement grants no captured pause or Continue', async (context) => {
  // Arrange
  const { run, suppressRetirementAck, commands, breakpoints, userBreakpoint } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  suppressRetirementAck()
  run.action('one', 'repository-click')
  await waitUntil(
    () =>
      run.view().captures['paused-browser']?.status === 'captured' &&
      breakpoints.length === 1,
    'retirement pending',
  )
  // Act / Assert
  assert.equal(run.view().snapshots.length, 0)
  await assert.rejects(
    run.continue('browser', {
      sessionId: 'browser-session',
      threadId: 1,
      generation: 1,
    }),
    /conflict/,
  )
  await run.stop()
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  assert.deepEqual(breakpoints, [userBreakpoint])
})

test('a dirty target buffer rejects preparation before application effects without saving reverting or removing its tab', async (context) => {
  // Arrange
  const { run, documents, releases, mouse } =
      await configuredRuntimeHarness(context),
    document = documents[0]!
  document.text = 'unsaved learner changes'
  document.isDirty = true
  // Act / Assert
  await assert.rejects(run.prepare(), { code: 'SOURCE_CHANGED' })
  await run.stop()
  assert.equal(releases.includes('application acquired'), false)
  assert.equal(mouse.length, 0)
  assert.equal(documents[0], document)
  assert.equal(document.text, 'unsaved learner changes')
  assert.equal(document.isDirty, true)
})

test('a target buffer changed during the hold rejects Continue and preserves the first captured source and dirty text', async (context) => {
  // Arrange
  const { run, documents, commands } = await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'captured stop',
  )
  documents[0]!.text = 'unsaved change'
  documents[0]!.isDirty = true
  // Act / Assert
  await assert.rejects(run.continue('browser', snapshot.pause), {
    code: 'SOURCE_CHANGED',
  })
  await run.stop()
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  assert.equal(
    run.view().snapshots[0]?.source.text,
    'const nextTheme = "dark";\n',
  )
  assert.equal(documents[0]?.text, 'unsaved change')
  assert.equal(documents[0]?.isDirty, true)
})

test('manual CDP resume revokes the exact pause and after completion even before a DAP continued event arrives', async (context) => {
  // Arrange
  const { run, manualResume } = await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'captured stop',
  )
  // Act
  manualResume()
  await run.stop()
  // Assert
  assert.equal(run.view().participants.browser.pause, undefined)
  assert.equal(run.view().snapshots[0], snapshot)
  assert.equal(run.view().operation?.afterVerified, false)
  await assert.rejects(run.continue('browser', snapshot.pause), /conflict/)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('a changed click target is rejected after readiness without a pointer event or automatic retry', async (context) => {
  // Arrange
  const { run, setReady, mouse } = await configuredRuntimeHarness(context)
  await run.prepare()
  setReady(false)
  // Act
  run.action('one', 'repository-click')
  await waitUntil(
    () => run.view().status === 'failed',
    'changed target rejection',
  )
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().operation?.inputDispatched, false)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.throws(() => run.action('another', 'repository-click'), /conflict/)
})

test('a pending configured input expires the active wait without redispatch and closes transport before waiting for its acknowledgement', async (context) => {
  // Arrange
  const { run, suppressInputPause, advance, mouse, releases } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  suppressInputPause()
  run.action('one', 'repository-click')
  await waitUntil(() => mouse.length === 2, 'pending input')
  // Act
  advance(20000)
  await run.stop()
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().resourcesReleased, true)
  assert.equal(mouse.length, 2)
  assert.equal(releases[0], 'application acquired')
  assert.equal(releases.indexOf('cdp') < releases.indexOf('application'), true)
})

test('a held configured pause expires at five minutes while retaining its original observation and learner breakpoint', async (context) => {
  // Arrange
  const { run, advance, breakpoints, userBreakpoint } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'held pause')
  advance(299999)
  assert.equal(run.view().status, 'paused-browser')
  // Act
  advance(1)
  await run.stop()
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().snapshots[0], snapshot)
  assert.equal(run.view().participants.browser.pause, undefined)
  assert.deepEqual(breakpoints, [userBreakpoint])
  assert.match(run.view().failures.join('\n'), /pause hold deadline/)
})

// Value: protects=a live pause the learner keeps while reading a replay longer than five minutes; fails_when=reading cannot renew the hold and the pause is released at 300 s; why_new=Cycle 0035 O3; seam=none
test('a held configured pause that is renewed while a replay is read is still held at five minutes and expires five minutes after the renewal', async (context) => {
  // Arrange
  const { run, advance } = await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  await waitUntil(() => run.view().snapshots[0], 'held pause')
  advance(200000)

  // Act
  run.renewPauseHold()
  advance(100000)
  const statusAtFiveMinutes = run.view().status
  advance(199999)
  const statusBeforeRenewedExpiry = run.view().status
  advance(1)
  await run.stop()

  // Assert
  assert.equal(statusAtFiveMinutes, 'paused-browser')
  assert.equal(statusBeforeRenewedExpiry, 'paused-browser')
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.match(run.view().failures.join('\n'), /pause hold deadline/)
})

// Value: protects=the run's bounded evidence journal while a replay plays beside a paused live run; fails_when=each renewal of the pause hold (one per presented replay frame) writes a journal event and long reading overflows the journal, failing the live run; why_new=Cycle 0035 O3 renews on every presented moment; seam=none
test('renewing a held pause for every replay frame adds no events to the run journal', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(context)
  await run.prepare()
  run.action('one', 'repository-click')
  await waitUntil(() => run.view().snapshots[0], 'held pause')
  const eventsBeforeRenewals = run.view().events.length

  // Act
  for (let frame = 0; frame < 200; frame++) run.renewPauseHold()
  const eventsAfterRenewals = run.view().events.length
  await run.stop()

  // Assert
  assert.equal(eventsAfterRenewals, eventsBeforeRenewals)
})

test('a late action cannot reset the original ten-minute run deadline', async (context) => {
  // Arrange
  const { run, advance } = await configuredRuntimeHarness(context)
  await run.prepare()
  advance(500000)
  run.action('late', 'repository-click')
  await waitUntil(() => run.view().snapshots[0], 'late pause')
  advance(99999)
  assert.equal(run.view().status, 'paused-browser')
  // Act
  advance(1)
  await run.stop()
  // Assert
  assert.equal(run.view().resourcesReleased, true)
  assert.equal(run.view().operation?.afterVerified, false)
  assert.match(run.view().failures.join('\n'), /whole-run deadline/)
})

test('the service cancellation signal retires an already held configured runtime without requiring another click or manual debugger action', async (context) => {
  // Arrange
  const cancellation = new AbortController(),
    now = Date.now(),
    { run, mouse } = await configuredRuntimeHarness(context, {
      signal: cancellation.signal,
      deadlineAt: now + 600000,
      preparationDeadlineAt: now + 90000,
    })
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(
    () => run.view().snapshots[0],
    'captured pause',
  )
  // Act
  cancellation.abort()
  await run.stop()
  // Assert
  assert.equal(run.view().resourcesReleased, true)
  assert.equal(run.view().participants.browser.pause, undefined)
  assert.equal(run.view().snapshots[0], snapshot)
  assert.equal(mouse.length, 2)
})

test('the pre-input configured manifest retains the full accepted intent and complete citation identity without source-code blobs', async (context) => {
  // Arrange
  const { run, mouse } = await configuredRuntimeHarness(context)
  // Act
  await run.prepare()
  const manifest = run.view().manifest
  // Assert
  assert.ok(manifest)
  assert.equal(manifest.configuration.source.path, 'src/theme.ts')
  assert.equal(manifest.configuration.action.title, 'Change theme')
  assert.equal(manifest.descriptor.itemId, 'repository/interface/theme')
  assert.equal(manifest.descriptor.citationContext.anchors.length, 2)
  assert.equal(manifest.configurationHash, run.definition.configurationHash)
  assert.equal('sources' in manifest.descriptor, false)
  assert.equal(mouse.length, 0)
})

test('one click retains two ordered source stops and waits for the final continuation before completion', async (context) => {
  // Arrange
  const { run, mouse, commands, breakpoints, userBreakpoint } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  await run.prepare()
  // Act
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first verified stop',
  )
  await run.continue('browser', first.pause)
  const second = await waitUntil(
    () => run.view().snapshots[1] && run.view().participants.browser.snapshot,
    'second verified stop',
  )
  // Assert: the next stop raced the preceding response but never replaced historical facts.
  assert.equal(first.source.column, 1)
  assert.equal(second.source.column, 7)
  assert.equal(first.pause.generation, 1)
  assert.equal(second.pause.generation, 2)
  assert.deepEqual(second.values, { 'value:enabled': false })
  assert.equal(run.view().operation?.afterVerified, false)
  assert.equal(run.view().snapshots[0], first)
  await assert.rejects(
    run.continue('browser', first.pause),
    /stale, foreign or unverified/,
  )
  await run.continue('browser', second.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(run.view().snapshots.length, 2)
  assert.equal(run.view().operation?.continuedPause?.generation, 2)
  assert.equal(mouse.length, 2)
  assert.equal(commands.filter((command) => command === 'continue').length, 2)
  assert.deepEqual(breakpoints, [userBreakpoint])
})

for (const order of [
  ['response', 'dap', 'cdp'],
  ['response', 'cdp', 'dap'],
  ['dap', 'response', 'cdp'],
  ['dap', 'cdp', 'response'],
  ['cdp', 'response', 'dap'],
  ['cdp', 'dap', 'response'],
] as const)
  test(`the next declared stop stays unauthorized until prior receipts arrive ${order.join(' then ')}`, async (context) => {
    // Arrange
    const { run, holdContinuation, emitPause, mouse } =
      await configuredRuntimeHarness(context, undefined, [
        {
          line: 1,
          column: 7,
          inspections: [{ path: 'enabled', mode: 'value', required: true }],
        },
      ])
    const receipts = holdContinuation()
    await run.prepare()
    run.action('ordered', 'repository-click')
    const first = await waitUntil(
      () => run.view().participants.browser.snapshot,
      'first stop',
    )
    const continuation = run.continue('browser', first.pause)
    await receipts.started
    // Act: when both event channels resumed, a new stop may race the command response.
    const delivered = new Set<string>()
    let emitted = false
    for (const [index, receipt] of order.entries()) {
      receipts[receipt]()
      delivered.add(receipt)
      if (delivered.has('dap') && delivered.has('cdp') && !emitted) {
        emitPause(7)
        emitted = true
      }
      if (index < 2) {
        assert.equal(run.view().participants.browser.phase, 'running')
        assert.equal(run.view().operation?.afterVerified, false)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    await continuation
    const second = await waitUntil(
      () => run.view().snapshots[1] && run.view().participants.browser.snapshot,
      'next verified stop',
    )
    // Assert
    assert.equal(second.pause.generation, 2)
    assert.equal(second.source.column, 7)
    assert.equal(run.view().operation?.continuedPause?.generation, 1)
    assert.equal(run.view().operation?.afterVerified, false)
    assert.equal(mouse.length, 2)
    await run.stop()
  })

test('an unbound second position leaves the application paused and never sends Continue or another click', async (context) => {
  // Arrange
  const { run, rejectBreakpointBinding, commands, mouse } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  rejectBreakpointBinding()
  // Act / Assert
  await assert.rejects(
    run.continue('browser', first.pause),
    /a verified binding of declared stop src\/theme\.ts:1 \(stop 2 of 2\) on its declared line or a later line its binding rule accepts \(requested column 7\)/,
  )
  await run.stop()
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
  assert.equal(mouse.length, 2)
  assert.match(
    run.view().failures[0] ?? '',
    /^Next declared stop was not armed and no resume was sent: Timed out waiting for a verified binding of declared stop src\/theme\.ts:1 \(stop 2 of 2\)/,
  )
})

// Value: protects=an agent knowing which declared stop's module changed and in which phase; fails_when=the failure says "Pre-input executed module differs from sealed bundle" with no stop, also for a stop armed inside a continuation; why_new=Cycle 0036 OCR2; seam=replaceExecutedModule changes the bytes the page reports
test('a first stop whose executed module differs from the sealed bundle is refused before input naming the stop', async (context) => {
  // Arrange
  const { run, replaceExecutedModule, mouse } =
    await configuredRuntimeHarness(context)
  replaceExecutedModule('rebuilt()')

  // Act
  const refusal = await run.prepare().then(
    () => 'prepared',
    (error: unknown) => thrownMessage(error),
  )
  await run.stop()

  // Assert
  assert.equal(
    refusal,
    'Executed module of declared stop src/theme.ts:1 differs from its sealed bundle (checked before input)',
  )
  assert.equal(mouse.length, 0)
})

// Value: protects=the phase named for a later stop's changed module; fails_when=a stop armed inside a continuation is still called "Pre-input", or names no stop; why_new=Cycle 0036 OCR2; seam=replaceExecutedModule changes the bytes the page reports
test('a later stop whose executed module differs from the sealed bundle ends the run naming the stop and that it was being armed inside the continuation', async (context) => {
  // Arrange
  const { run, replaceExecutedModule, commands } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  replaceExecutedModule('rebuilt()')

  // Act
  const refusal = await run.continue('browser', first.pause).then(
    () => 'continued',
    (error: unknown) => thrownMessage(error),
  )
  await run.stop()

  // Assert
  assert.equal(
    refusal,
    'Executed module of declared stop src/theme.ts:1 (stop 2 of 2) differs from its sealed bundle (checked while arming it inside the preceding continuation)',
  )
  assert.equal(
    run.view().failures[0],
    'Next declared stop was not armed and no resume was sent: Executed module of declared stop src/theme.ts:1 (stop 2 of 2) differs from its sealed bundle (checked while arming it inside the preceding continuation)',
  )
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
})

// Value: protects=an agent knowing which declared line its action never ran; fails_when=the deadline of an unmoved first stop says only "Repository input reached no verified pause"; why_new=Cycle 0036 P03 (0043 named the stop only when its binding had moved); seam=none
test('an accepted action whose first stop is never hit ends the run naming that declared stop and that its line must run after the input', async (context) => {
  // Arrange
  const { run, suppressInputPause, advance, mouse } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  suppressInputPause()
  run.action('one', 'repository-click')
  await waitUntil(() => mouse.length === 2, 'pending input')

  // Act
  advance(20000)
  await run.stop()

  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository input reached no verified pause: declared stop src/theme.ts:1 was not hit within 20 s of the accepted action; its line must execute after the input',
  )
})

// Value: protects=bounded mapping hints that still show the citation's edges and the lines next to the attempted one; fails_when=a long citation lists every mapped line, or the sample loses its first lines, its last lines or the neighbourhood of the declared line; why_new=Cycle 0036 C07f (the sampling had no test); seam=none
test('an unbound stop in a 120-line citation lists the first 20 mapped lines, the 40 nearest its declared line 60 and the last 20', async (context) => {
  // Arrange: every one of the 120 cited lines has a mapped position and the debugger verifies no binding.
  const { run, rejectBreakpointBinding } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: `AAAA${';AACA'.repeat(119)}`,
      fixture: {
        source: 'const nextTheme = "dark";\n'.repeat(120),
        citationEndLine: 120,
        declaredLine: 60,
      },
    },
  )
  rejectBreakpointBinding()

  // Act
  const refusal = await run.prepare().then(
    () => 'prepared',
    (error: unknown) => thrownMessage(error),
  )
  await run.stop()

  // Assert
  assert.equal(
    refusal,
    'Timed out waiting for a verified binding of declared stop src/theme.ts:60 on its declared line or a later line its binding rule accepts (requested column 1); choose an executable statement reached by the requested action. Frozen source map positions in the selected citation: 1:1, 2:1, 3:1, 4:1, 5:1, 6:1, 7:1, 8:1, 9:1, 10:1, 11:1, 12:1, 13:1, 14:1, 15:1, 16:1, 17:1, 18:1, 19:1, 20:1, 40:1, 41:1, 42:1, 43:1, 44:1, 45:1, 46:1, 47:1, 48:1, 49:1, 50:1, 51:1, 52:1, 53:1, 54:1, 55:1, 56:1, 57:1, 58:1, 59:1, 60:1, 61:1, 62:1, 63:1, 64:1, 65:1, 66:1, 67:1, 68:1, 69:1, 70:1, 71:1, 72:1, 73:1, 74:1, 75:1, 76:1, 77:1, 78:1, 79:1, 101:1, 102:1, 103:1, 104:1, 105:1, 106:1, 107:1, 108:1, 109:1, 110:1, 111:1, 112:1, 113:1, 114:1, 115:1, 116:1, 117:1, 118:1, 119:1, 120:1. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.',
  )
})

test('a browser stop the debugger binds at another column of its declared line is armed at once and commits at the bound column', async (context) => {
  // Arrange: the request is 1:1 and the adapter verifies the breakpoint at 1:7 of the same line.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { mappings: 'AAAA,MAAM' },
  )
  bindFirstStopAt(1, 7)
  // Act: preparation resolves only for an accepted binding; a binding wait that expired would reject it.
  await run.prepare()
  run.action('moved-column', 'repository-click')
  const stop = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'stop committed at the bound column')
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  // Assert
  const bound = run
    .view()
    .events.find((event) => event.type === 'breakpoint.bound')
  assert.equal(
    JSON.stringify(bound?.detail),
    '{"verified":true,"line":1,"column":7,"requested":{"line":1,"column":1},"declared":{"line":1,"column":1}}',
  )
  assert.equal(stop.source.line, 1)
  assert.equal(stop.source.column, 7)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(mouse.length, 2)
})

test('a browser stop the debugger binds on another line fails at once and names the declared stop and where it landed', async (context) => {
  // Arrange
  const { run, bindFirstStopAt, mouse } =
    await configuredRuntimeHarness(context)
  bindFirstStopAt(2, 1)
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    // This text is the at-once refusal; a spent 20 s binding wait says "Timed out waiting for a verified binding" instead.
    assert.equal(
      String(error),
      'Error: Declared stop src/theme.ts:1 bound at 2:1, refused: line 2 is after the last line 1 of the citation. Frozen source map positions in the selected citation: 1:1. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.',
    )
    return true
  })
  await run.stop()
  // Assert: nothing was clicked.
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('a declared line the sealed map is too large to scan completely does not refuse the stop at preparation', async (context) => {
  // Arrange: the only mapped segment lies beyond the scan's generated-line limit, so the scan finds nothing and is incomplete.
  const { run, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { mappings: `${';'.repeat(100_000)}AAAA` },
  )
  // Act
  await run.prepare()
  // Assert
  assert.equal(run.view().status, 'ready')
  assert.equal(run.view().failures.length, 0)
  assert.equal(mouse.length, 0)
  await run.stop()
})

// Value: protects=a binding failure telling the agent its mapped-position hints come from an incomplete map scan; fails_when=the failure builder drops the partial-scan qualifier, so "none" reads as "no line of the citation is mapped"; why_new=the partial flag is asserted on the verifier only and preparation's exemption has no failure text, so no test reads the qualifier in a run failure; seam=none
test('a binding failure on a sealed map too large to scan completely says its mapped positions come from a partial scan', async (context) => {
  // Arrange: the scan stops at its generated-line limit before the only mapped segment, and the debugger binds the stop on line 2.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { mappings: `${';'.repeat(100_000)}AAAA` },
  )
  bindFirstStopAt(2, 1)
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      'Error: Declared stop src/theme.ts:1 bound at 2:1, refused: line 2 is after the last line 1 of the citation. Frozen source map positions in the selected citation (partial map scan): none. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.',
    )
    return true
  })
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=an adapter failure while a stop is armed reaching the agent as that failure, not as a binding problem with mapped-position hints; fails_when=every failed arming wait becomes a binding failure, so hints about choosing another line are attached to an adapter error; why_new=the arming tests end in a timeout or a binding on another line, and none makes the adapter's binding lookup itself fail; seam=none
test('an adapter failure while the first stop is being armed is reported as that failure, without mapped-position hints and without clicking the application', async (context) => {
  // Arrange: the debug session answers the binding lookup with its own failure.
  const { run, failBindingLookup, mouse } =
    await configuredRuntimeHarness(context)
  failBindingLookup('Debug adapter lost the session')
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(String(error), 'Error: Debug adapter lost the session')
    return true
  })
  await run.stop()
  // Assert
  assert.equal(
    run
      .view()
      .events.some((event) => event.type === 'breakpoint.mapping-hints'),
    false,
  )
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('a later stop whose line never runs after the preceding continuation ends the run naming that stop and the order rule', async (context) => {
  // Arrange
  const { run, suppressNextPause, advance, commands } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  suppressNextPause()
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  await run.continue('browser', first.pause)
  // Act: the active-progress budget passes without the second stop pausing.
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'next stop not hit')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository continuation reached no next declared pause: declared stop src/theme.ts:1 (stop 2 of 2) was not hit within 20 s; its line must execute after the preceding continuation',
  )
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

test('missing required facts at the second position retain both histories without reusing prior pixels but cannot continue or complete', async (context) => {
  // Arrange
  const { run, commands, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'missing', mode: 'value', required: true }],
      },
    ],
  )
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  // Act
  await run.continue('browser', first.pause)
  await waitUntil(
    () => run.view().status === 'failed',
    'second inspection failure',
  )
  await run.stop()
  // Assert
  assert.equal(run.view().snapshots.length, 2)
  assert.equal(
    run.view().snapshots[1]?.unavailableValues[0]?.path,
    'value:missing',
  )
  assert.equal(run.view().captures['paused-browser']?.status, 'failed')
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().operation?.continuedPause?.generation, 1)
  assert.equal(run.view().participants.browser.pause, undefined)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
  assert.equal(mouse.length, 2)
})

test('a queued next stop that resumes before the prior command response cannot acquire stale pause authority', async (context) => {
  // Arrange
  const { run, holdContinuation, emitPause, manualResume, commands } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  const receipts = holdContinuation()
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  const continuation = run
    .continue('browser', first.pause)
    .catch(() => undefined)
  await receipts.started
  receipts.dap()
  receipts.cdp()
  emitPause(7)
  // Act
  manualResume()
  receipts.response()
  await continuation
  await run.stop()
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(run.view().participants.browser.pause, undefined)
  assert.match(run.view().failures.join('\n'), /Queued browser stop resumed/)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
})

// Value: protects=the run journal naming where a pause is when the debug adapter makes and resumes it by itself; fails_when=the URL of a late script, the position, the function or the hit breakpoint ids are missing from the journal; why_new=the journal held only a script id and a count, and no URL after the first 200 scripts; seam=none
test('a pause in a script announced after the first two hundred is journaled with its script URL, position, function and hit breakpoints', async (context) => {
  // Arrange
  const { run, announceScript, emitCdpPauseAt } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  for (let index = 0; index < 200; index++)
    announceScript(
      `filler-${index}`,
      `webpack-internal:///(rsc)/./filler-${index}.ts`,
    )
  announceScript('late', 'webpack-internal:///(action-browser)/./auth.ts')
  // Act
  emitCdpPauseAt({
    scriptId: 'late',
    lineNumber: 22,
    columnNumber: 4,
    functionName: 'getUser',
    hitBreakpoints: ['1:22:4:webpack-internal:///(action-browser)/./auth.ts'],
  })
  await run.stop()
  // Assert
  assert.deepEqual(
    run
      .view()
      .events.filter((event) => event.type === 'cdp.pause-observed')
      .at(-1)?.detail,
    {
      participant: 'browser',
      reason: 'other',
      scriptId: 'late',
      hitBreakpointCount: 1,
      inputDispatched: false,
      url: 'webpack-internal:///(action-browser)/./auth.ts',
      line: 23,
      column: 5,
      functionName: 'getUser',
      hitBreakpoints: ['1:22:4:webpack-internal:///(action-browser)/./auth.ts'],
      stopIndex: 0,
      continuation: null,
    },
  )
})

// Value: protects=the journal saying how far an owned continuation was when another pause arrived, which decides whether that pause was queued, refused or foreign; fails_when=the receipts are missing or copied from another moment; why_new=the journal did not hold them; seam=none
test('a pause that arrives during a continuation is journaled with the receipts that continuation already has', async (context) => {
  // Arrange
  const { run, holdContinuation, emitCdpPauseAt } =
    await configuredRuntimeHarness(context)
  const receipts = holdContinuation()
  await run.prepare()
  run.action('one', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  const continuation = run
    .continue('browser', first.pause)
    .catch(() => undefined)
  await receipts.started
  receipts.dap()
  // Act
  emitCdpPauseAt({
    scriptId: 'actual',
    lineNumber: 0,
    columnNumber: 0,
    functionName: 'configured',
    hitBreakpoints: ['mapped-source'],
  })
  receipts.response()
  await continuation
  await run.stop()
  // Assert
  const detail = run
    .view()
    .events.filter((event) => event.type === 'cdp.pause-observed')
    .at(-1)?.detail
  assert.deepEqual(
    detail && typeof detail === 'object' && 'continuation' in detail
      ? detail.continuation
      : undefined,
    { response: false, dap: true, cdp: false },
  )
})

// Value: protects=the journal saying how long an observed pause lasted, which tells a pause the adapter resumed at once from one a learner looked at; fails_when=the resume entry has no duration after a pause, or carries one without a pause; why_new=the resume entry held no duration; seam=none
test('a resume after an observed pause is journaled with how long that pause lasted, and a resume without one is not', async (context) => {
  // Arrange
  const { run, emitCdpPause, manualResume } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  const durations = (): unknown[] =>
    run
      .view()
      .events.filter((event) => event.type === 'cdp.resumed')
      .map((event) =>
        event.detail &&
        typeof event.detail === 'object' &&
        'pausedForMs' in event.detail
          ? event.detail.pausedForMs
          : 'absent',
      )
  const before = durations().length
  // Act
  emitCdpPause()
  manualResume()
  manualResume()
  await run.stop()
  // Assert
  const [afterPause, withoutPause] = durations().slice(before)
  assert.equal(Number.isInteger(afterPause), true)
  assert.equal(typeof afterPause === 'number' && afterPause >= 0, true)
  assert.equal(typeof afterPause === 'number' && afterPause < 1000, true)
  assert.equal(withoutPause, 'absent')
})

// Value: protects=an agent learning why a continuation reached no next stop: the page is still paused where the debug adapter paused it for itself (Cycle 0042 P2-1, the WebAssembly hook); fails_when=the deadline text ends without the sentence that names the participant and the place; why_new=a pause nobody announced was stored as the next stop's candidate and the deadline text did not mention it; seam=the run's timers, driven by the test clock
test('a continuation that reaches no next stop while the browser stays paused with no debugger stop ends the run naming where it is paused', async (context) => {
  // Arrange
  const { run, suppressNextPause, announceScript, emitCdpPauseAt, advance } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  suppressNextPause()
  await run.prepare()
  announceScript('hook', 'eval-ca9ab6a4.cdp')
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  await run.continue('browser', first.pause)
  // Act: the adapter's hook pauses the page, nothing resumes it, and the active-progress budget passes.
  emitCdpPauseAt({
    scriptId: 'hook',
    lineNumber: 0,
    columnNumber: 219,
    functionName: '',
    hitBreakpoints: [],
  })
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'next stop not hit')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository continuation reached no next declared pause: declared stop src/theme.ts:1 (stop 2 of 2) was not hit within 20 s; its line must execute after the preceding continuation. The browser is paused at eval-ca9ab6a4.cdp 1:220 without a debugger stop.',
  )
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Cycle 0044 (0042-SR3): red while the pause's script URL and function name went uncut into the journal and the deadline's place sentence, so a 9,000-char URL made a terminal reason the saved study (8,192 chars) refuses.
test('a pause in a script with a 9,000-character URL is journaled and named in the deadline text by a bounded prefix of that URL', async (context) => {
  // Arrange
  const longUrl = `https://cdn.example.test/${'a'.repeat(9_000)}.js`
  const longFunctionName = 'f'.repeat(1_000)
  const { run, suppressNextPause, announceScript, emitCdpPauseAt, advance } =
    await configuredRuntimeHarness(context, undefined, [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ])
  suppressNextPause()
  await run.prepare()
  announceScript('long', longUrl)
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  await run.continue('browser', first.pause)
  // Act
  emitCdpPauseAt({
    scriptId: 'long',
    lineNumber: 0,
    columnNumber: 0,
    functionName: longFunctionName,
    hitBreakpoints: [],
  })
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'next stop not hit')
  await run.stop()
  // Assert
  const urlPrefix = longUrl.slice(0, 512)
  assert.equal(
    run.view().failures[0],
    `Repository continuation reached no next declared pause: declared stop src/theme.ts:1 (stop 2 of 2) was not hit within 20 s; its line must execute after the preceding continuation. The browser is paused at ${urlPrefix} 1:1 without a debugger stop.`,
  )
  const observed = run
    .view()
    .events.filter((event) => event.type === 'cdp.pause-observed')
    .at(-1)?.detail
  assert.equal(
    observed && typeof observed === 'object' && 'url' in observed
      ? observed.url
      : undefined,
    urlPrefix,
  )
  assert.equal(
    observed && typeof observed === 'object' && 'functionName' in observed
      ? observed.functionName
      : undefined,
    'f'.repeat(256),
  )
})

// Value: protects=a run with two browser stops going on to the second when the browser's adapter pauses for its own entry breakpoint in another script and resumes it; fails_when=that pause is taken for the next declared stop, so its resume ends the run ("Selected browser resumed outside its owned continuation"); why_new=the short bound for the adapter's own browser pauses applies only to a run that declares no browser stop (Cycle 0042 ER1, ER7); seam=none
test('a pause the debugger makes for itself in another script between two browser stops is retired, and the second stop is captured', async (context) => {
  // Arrange
  const {
    run,
    suppressNextPause,
    announceScript,
    emitCdpPauseAt,
    manualResume,
    emitPause,
  } = await configuredRuntimeHarness(context, undefined, [
    {
      line: 1,
      column: 7,
      inspections: [{ path: 'enabled', mode: 'value', required: true }],
    },
  ])
  suppressNextPause()
  await run.prepare()
  announceScript(
    'actions',
    'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts',
  )
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  await run.continue('browser', first.pause)
  // Act: the adapter's entry breakpoint pauses and is resumed with no stopped event; then the second declared stop is hit.
  emitCdpPauseAt({
    scriptId: 'actions',
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['br:2:0:0:actions'],
  })
  manualResume()
  emitPause(7)
  const second = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[1] && view.participants.browser.snapshot
  }, 'second verified stop')
  await run.continue('browser', second.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  // Assert
  assert.equal(run.view().failures.join('; '), '')
  assert.equal(second.pause.generation, 2)
  assert.equal(second.source.column, 7)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  const retired = run
    .view()
    .events.filter((event) => event.type === 'cdp.adapter-pause-retired')
  assert.equal(retired.length, 1)
  const detail = JSON.parse(JSON.stringify(retired[0]?.detail))
  assert.equal(Number.isInteger(detail.pausedForMs), true)
  assert.deepEqual(
    { ...detail, pausedForMs: 'an integer, checked above' },
    {
      participant: 'browser',
      url: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts',
      line: 1,
      column: 1,
      functionName: '',
      hitBreakpoints: ['br:2:0:0:actions'],
      place: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 1:1',
      pausedForMs: 'an integer, checked above',
    },
  )
})

// Value: protects=a run never being certified as completed while the page is paused at a pause the debugger made for itself during the after capture; fails_when=the wait after the after capture is removed, so completion is certified while the page is paused, or the run fails or never completes once that pause is resumed; why_new=the server test of ER5 sends its pause before the after capture, so only the wait before the capture is exercised; seam=none
test('a run does not complete while the page is paused at a pause the debugger made for itself during the after capture, and completes once that pause is resumed', async (context) => {
  // Arrange: the last continuation is acknowledged and the after image is being presented.
  const { run, holdCapture, announceScript, emitCdpPauseAt, manualResume } =
    await configuredRuntimeHarness(context)
  await run.prepare()
  announceScript('hook', 'eval-ca9ab6a4.cdp')
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'first stop'),
    held = holdCapture('after')
  await run.continue('browser', snapshot.pause)
  await held.started
  // Act: the adapter's hook pauses the page during the capture; three polling intervals pass after the capture before it resumes.
  emitCdpPauseAt({
    scriptId: 'hook',
    lineNumber: 0,
    columnNumber: 219,
    functionName: '',
    hitBreakpoints: [],
  })
  held.release()
  await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.captures.after?.status === 'captured'
  }, 'after image captured')
  const threePollingIntervalsMs = 150
  await setTimeout(threePollingIntervalsMs)
  const whilePaused = {
    status: run.view().status,
    afterVerified: run.view().operation?.afterVerified,
    failures: run.view().failures.join('; '),
  }
  manualResume()
  await waitUntil(
    () => run.view().status === 'completed',
    'completed after the resume',
  )
  await run.stop()
  // Assert
  assert.deepEqual(whilePaused, {
    status: 'resuming',
    afterVerified: false,
    failures: '',
  })
  assert.equal(run.view().operation?.afterVerified, true)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(
    run
      .view()
      .events.filter((event) => event.type === 'cdp.adapter-pause-retired')
      .length,
    1,
  )
})

// Cycle 0045 (X7-B.1): red while the after conditions were read only before the after image was captured, so a page that changed during the capture completed as demonstrated.
test('a page that changed while the after image was captured is not saved as demonstrated, and the run ends naming the after condition that no longer held', async (context) => {
  // Arrange: the last continuation is acknowledged, the after conditions held and the after image is being presented.
  const {
    run,
    holdCapture,
    announceScript,
    emitCdpPauseAt,
    manualResume,
    failAfterWith,
  } = await configuredRuntimeHarness(context)
  await run.prepare()
  announceScript('hook', 'eval-ca9ab6a4.cdp')
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'first stop'),
    held = holdCapture('after')
  await run.continue('browser', snapshot.pause)
  await held.started
  // Act: the adapter's hook pauses the page during the capture, and the page's text is replaced before that pause is resumed.
  emitCdpPauseAt({
    scriptId: 'hook',
    lineNumber: 0,
    columnNumber: 219,
    functionName: '',
    hitBreakpoints: [],
  })
  failAfterWith({ conditionIndex: 0, reason: 'text-mismatch' })
  held.release()
  await waitUntil(
    () => run.view().captures.after?.status === 'captured',
    'after image captured',
  )
  manualResume()
  await waitUntil(
    () => ['completed', 'failed'].includes(run.view().status),
    'the run ended',
  )
  await run.stop()
  // Assert
  assert.deepEqual(
    [...run.view().failures],
    [
      "Repository after conditions held before the after image was captured and no longer held when they were read again after it: condition 1 (text) text-mismatch. A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied. The page changed during the capture, so the result is not demonstrated. Declare in configuration.action.after a condition that still holds once the action has finished, then start a new run.",
    ],
  )
  assert.equal(run.view().operation?.afterVerified, false)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

/** The hints sentence every binding failure ends with. */
const MAPPED_POSITION_HINTS =
  'These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.'

/** A source whose citation covers lines 1 to 2, sealed under a map that puts generated line n on source line n + 1. */
const TWO_LINE_CITATION = {
  mappings: 'AAAA;AACA',
  fixture: { citationEndLine: 2 },
}

/** A three-line source cited whole, for a binding two lines below the declared one. */
const THREE_LINE_SOURCE = 'const nextTheme = "dark";\n\n'

// Value: protects=a live run going on when the debugger moves a browser stop from a line it cannot pause on to the next line (`return (` onto the `<form>` line); fails_when=arming refuses a verified binding on the next line of the stop's citation, or the stop is committed at the declared line instead of the bound one; why_new=every binding on another line was refused (Cycle 0043, criterion 1); seam=none
test('a browser stop the debugger binds on the next line of its citation is armed, pauses there and commits at the bound line', async (context) => {
  // Arrange: the stop is declared at 1:1, its citation covers lines 1 to 2 and the adapter verifies the breakpoint at 2:1.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    TWO_LINE_CITATION,
  )
  bindFirstStopAt(2, 1)
  // Act
  await run.prepare()
  run.action('moved-line', 'repository-click')
  const stop = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'stop committed at the bound line')
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  // Assert
  const bound = run
    .view()
    .events.find((event) => event.type === 'breakpoint.bound')
  assert.equal(
    JSON.stringify(bound?.detail),
    '{"verified":true,"line":2,"column":1,"requested":{"line":1,"column":1},"declared":{"line":1,"column":1}}',
  )
  assert.equal(stop.source.line, 2)
  assert.equal(stop.source.column, 1)
  assert.equal(run.view().failures.length, 0)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(mouse.length, 2)
})

// Value: protects=a pause at the accepted bound place being the stop's own pause at once; fails_when=the position test compares the pause with the declared line only, so the pause is held as nobody's and reaches its stop only when the 3 s wait for the stop's own pause ends; why_new=the position test knew the declared line only (Cycle 0043, criterion 3); seam=the run's wait for the accepted stop's own pause, held open by the harness so that only a pause admitted at once can be captured
test('a pause at the line the debugger moved a browser stop to is captured as that stop’s own pause, without waiting for a pause on the declared line', async (context) => {
  // Arrange: the wait for a pause on the stop's line never ends by itself.
  const { run, bindFirstStopAt, holdSourceBoundWait } =
    await configuredRuntimeHarness(context, undefined, [], TWO_LINE_CITATION)
  bindFirstStopAt(2, 1)
  holdSourceBoundWait()
  await run.prepare()
  // Act
  run.action('moved-line', 'repository-click')
  const stop = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'stop captured while the wait for its own pause is held open')
  await run.stop()
  // Assert
  assert.equal(stop.source.line, 2)
  assert.equal(stop.source.column, 1)
})

// Value: protects=the deadline telling an agent which line has to run when its later stop was moved into a branch the action skips; fails_when=the text names only the declared line, whose code did run, or the run ends at arming; why_new=a moved binding never got as far as the deadline (Cycle 0043, criterion 7, DX2); seam=the harness clock
test('a later stop the debugger moved to the next line that is not reached ends the run naming the bound place and that this line must run', async (context) => {
  // Arrange: the second stop is declared at 1:7 and the adapter verifies it at 2:1, a line the continuation never runs.
  const { run, bindLaterStopsAt, suppressNextPause, advance, commands } =
    await configuredRuntimeHarness(
      context,
      undefined,
      [
        {
          line: 1,
          column: 7,
          inspections: [{ path: 'enabled', mode: 'value', required: true }],
        },
      ],
      { mappings: 'AAAA,MAAM;AACN', fixture: { citationEndLine: 2 } },
    )
  bindLaterStopsAt(2, 1)
  suppressNextPause()
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  await run.continue('browser', first.pause)
  // Act: the active-progress budget passes without the second stop pausing.
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'next stop not hit')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository continuation reached no next declared pause: declared stop src/theme.ts:1 (stop 2 of 2) (bound at 2:1) was not hit within 20 s; the bound line, not the declared one, must execute after the preceding continuation',
  )
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(commands.filter((command) => command === 'continue').length, 1)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=the deadline of an action whose first stop was moved into a branch the click skips naming that stop and its bound place; fails_when=the run ends with "Repository input reached no verified pause" and no stop or place, or at arming; why_new=a moved first stop never got as far as the deadline, and its text named nothing (Cycle 0043, criterion 7b, DX3); seam=the harness clock
test('a first stop the debugger moved to the next line that the click does not reach ends the run naming the bound place and that this line must run', async (context) => {
  // Arrange: the click is sent and the bound line never pauses.
  const { run, bindFirstStopAt, suppressInputPause, advance, mouse } =
    await configuredRuntimeHarness(context, undefined, [], TWO_LINE_CITATION)
  bindFirstStopAt(2, 1)
  suppressInputPause()
  await run.prepare()
  run.action('moved-line', 'repository-click')
  await waitUntil(
    () => run.view().operation?.inputDispatched,
    'input dispatched',
  )
  // Act: 20 s pass after the action was accepted.
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'first stop not hit')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository input reached no verified pause: declared stop src/theme.ts:1 (bound at 2:1) was not hit within 20 s of the accepted action; the bound line, not the declared one, must execute after the input',
  )
  assert.equal(mouse.length, 2)
  assert.equal(run.view().snapshots.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=the deadline never blaming a line for not running when the input that would run it was not sent yet; fails_when=the bound place is named whenever the first stop moved, also for an expiry before the click; why_new=the deadline starts when the action is accepted, before the input is sent (Cycle 0043, DX3); seam=the harness clock
test('an action deadline that expires before the click was sent keeps its text although the first stop was moved to the next line', async (context) => {
  // Arrange
  const { run, bindFirstStopAt, advance, mouse } =
    await configuredRuntimeHarness(context, undefined, [], TWO_LINE_CITATION)
  bindFirstStopAt(2, 1)
  await run.prepare()
  // Act: the deadline expires in the same turn the action was accepted in, before its input could be dispatched.
  run.action('moved-line', 'repository-click')
  advance(20_000)
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository input reached no verified pause',
  )
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a run never taking a breakpoint the debugger put before the declared line for that stop; fails_when=a binding on an earlier line inside the citation is accepted; why_new=the existing refusal tests bind after the declared line and outside a one-line citation (Cycle 0043, criterion 6); seam=none
test('a browser stop the debugger binds on an earlier line of its citation is refused at once with the declared stop and where it landed', async (context) => {
  // Arrange: the stop is declared on line 2 and the adapter verifies it at 1:1.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    { mappings: 'AAAA;AACA', fixture: { citationEndLine: 2, declaredLine: 2 } },
  )
  bindFirstStopAt(1, 1)
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      `Error: Declared stop src/theme.ts:2 bound at 1:1, refused: line 1 is before the declared line 2. Frozen source map positions in the selected citation: 1:1, 2:1. ${MAPPED_POSITION_HINTS}`,
    )
    return true
  })
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a run never reporting a stop past code that could run between the declared line and the pause; fails_when=a binding two lines below is accepted although the line between has a mapped position; why_new=the existing refusal tests have no line between the declared and the bound one (Cycle 0043, criterion 6); seam=none
test('a browser stop the debugger binds across a line that has a mapped position is refused at once with the declared stop and where it landed', async (context) => {
  // Arrange: lines 1, 2 and 3 are mapped and the adapter verifies the stop declared on line 1 at 3:1.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: 'AAAA;AACA;AACA',
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
    },
  )
  bindFirstStopAt(3, 1)
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      `Error: Declared stop src/theme.ts:1 bound at 3:1, refused: line 2 between the declared line 1 and line 3 has a mapped position. Frozen source map positions in the selected citation: 1:1, 2:1, 3:1. ${MAPPED_POSITION_HINTS}`,
    )
    return true
  })
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a sealed map too large to scan never being read as "no code between"; fails_when=a binding two lines below is accepted because the incomplete scan found nothing between; why_new=the partial-scan tests bind outside a one-line citation (Cycle 0043, criterion 6); seam=none
test('a browser stop the debugger binds two lines below is refused when the sealed map is too large to scan the line between', async (context) => {
  // Arrange: the scan stops at its generated-line limit before the only mapped segment.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: `${';'.repeat(100_000)}AAAA`,
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
    },
  )
  bindFirstStopAt(3, 1)
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      `Error: Declared stop src/theme.ts:1 bound at 3:1, refused: the sealed map was too large to scan completely, so lines 2 to 2 between the declared line and line 3 may hold code. Frozen source map positions in the selected citation (partial map scan): none. ${MAPPED_POSITION_HINTS}`,
    )
    return true
  })
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a live run going on when the debugger moves a browser stop across a line that holds no code (a blank line) to the line after it; fails_when=the run's rule refuses a binding two lines below although the sealed map has no position on the line between, or commits the stop at the declared line; why_new=every run-level acceptance binds on the very next line, which never asks the sealed map, and the two-lines-below runs are refusals only; seam=none
test('a browser stop the debugger binds two lines below, across a line the sealed map has no position on, is armed, pauses there and commits at the bound line', async (context) => {
  // Arrange: lines 1 and 3 are mapped, the blank line 2 is not, and the adapter verifies the stop declared at 1:1 at 3:1.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: 'AAAA;;AAEA',
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
    },
  )
  bindFirstStopAt(3, 1)
  // Act
  await run.prepare()
  run.action('moved-two-lines', 'repository-click')
  const stop = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'stop committed two lines below its declared line')
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  // Assert
  const bound = run
    .view()
    .events.find((event) => event.type === 'breakpoint.bound')
  assert.equal(
    JSON.stringify(bound?.detail),
    '{"verified":true,"line":3,"column":1,"requested":{"line":1,"column":1},"declared":{"line":1,"column":1}}',
  )
  assert.equal(stop.source.line, 3)
  assert.equal(stop.source.column, 1)
  assert.equal(run.view().failures.length, 0)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(mouse.length, 2)
})

/** Reads the detail of every journal entry of one type of a run. @example journalDetails(run, 'cdp.resumed').length // 2 */
const journalDetails = (
  run: Awaited<ReturnType<typeof configuredRuntimeHarness>>['run'],
  type: string,
): unknown[] =>
  run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))

const SECOND_STOP = [
  {
    line: 1,
    column: 7,
    inspections: [{ path: 'enabled', mode: 'value' as const, required: true }],
  },
]

// Cycle 0044 (0042-SR2): red while the replay of a queued pause journaled it a second time and restarted its clock, so its resume understated how long it lasted.
test('a next stop’s pause that waited for the preceding continuation’s receipts is journaled once, and its resume counts from when it was first observed', async (context) => {
  // Arrange: the first stop is being continued and only its command response is still missing.
  const { run, holdContinuation, emitCdpPauseAt, emitStopped, setPausedFrame } =
    await configuredRuntimeHarness(context, undefined, SECOND_STOP)
  const receipts = holdContinuation()
  await run.prepare()
  run.action('ordered', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  const firstContinuation = run.continue('browser', first.pause)
  await receipts.started
  receipts.dap()
  receipts.cdp()
  // Act: the second stop's pause is observed and queued, 60 ms pass, and then the first continuation completes.
  emitCdpPauseAt({
    scriptId: 'actual',
    lineNumber: 0,
    columnNumber: 6,
    functionName: 'configured',
    hitBreakpoints: ['mapped-source'],
  })
  await setTimeout(60)
  receipts.response()
  await firstContinuation
  setPausedFrame(7)
  emitStopped()
  const second = await waitUntil(() => {
    const snapshot = run.view().participants.browser.snapshot
    return snapshot && snapshot.id !== first.id ? snapshot : undefined
  }, 'second stop')
  const secondContinuation = run
    .continue('browser', second.pause)
    .catch(() => undefined)
  await waitUntil(
    () => journalDetails(run, 'continue.accepted').length === 2,
    'second continuation accepted',
  )
  receipts.dap()
  receipts.cdp()
  receipts.response()
  await secondContinuation
  await run.stop()
  // Assert
  const resumed = journalDetails(run, 'cdp.resumed').at(-1)
  assert.equal(journalDetails(run, 'cdp.pause-observed').length, 2)
  assert.ok(resumed && typeof resumed === 'object' && 'pausedForMs' in resumed)
  assert.equal(
    typeof resumed.pausedForMs === 'number' && resumed.pausedForMs >= 60,
    true,
  )
})

// Cycle 0044 (0042-SR14 / 0042-ER-limit1): red while a pause on the expected stop's line at another column counted as that stop, so the adapter's resume of it ended the run as a foreign resume.
test('a pause the debugger makes at another column of the expected stop’s line and resumes is retired, and the stop itself is then captured', async (context) => {
  // Arrange: the first stop is bound at 1:1; generated 0:6 is another statement of that line, at source 1:7.
  const { run, suppressInputPause, emitCdpPauseAt, manualResume, emitPause } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: 'AAAA,MAAM',
    })
  suppressInputPause()
  await run.prepare()
  run.action('one', 'repository-click')
  await waitUntil(
    () => run.view().operation?.inputDispatched,
    'input dispatched',
  )
  // Act
  emitCdpPauseAt({
    scriptId: 'actual',
    lineNumber: 0,
    columnNumber: 6,
    functionName: '',
    hitBreakpoints: ['adapter-internal'],
  })
  manualResume()
  emitPause()
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'the stop itself captured')
  await run.stop()
  // Assert
  assert.equal(snapshot.source.column, 1)
  assert.equal(journalDetails(run, 'cdp.adapter-pause-retired').length, 1)
})

// Cycle 0044 (0042-SR21): red while the first stop's turn began when the action was accepted, so a pause on its line before the click was captured as the click's effect.
test('a pause on the first stop’s line before the input is sent is not captured as that stop when the debugger announces it later', async (context) => {
  // Arrange
  const { run, suppressInputPause, emitCdpPause, emitStopped, mouse } =
    await configuredRuntimeHarness(context)
  suppressInputPause()
  await run.prepare()
  // Act: the line runs while the accepted action is still checking its input; the debugger announces that pause after the click.
  run.action('one', 'repository-click')
  emitCdpPause()
  await waitUntil(() => mouse.length === 2, 'click sent')
  emitStopped()
  await waitUntil(() => run.view().status === 'failed', 'early pause rejected')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Error: Declared stop src/theme.ts:1 paused at src/theme.ts:1 before its turn: its line ran before the input was sent, so that pause is no observation of this stop; declare a line that runs only after the input',
  )
  assert.equal(run.view().snapshots.length, 0)
})

// Cycle 0044 (0042-SR28): red while only the progress and hold deadlines added where a participant is paused.
test('the whole-run deadline that expires while the page is paused with no debugger stop names where it is paused', async (context) => {
  // Arrange: the run is ready for 590 s, then its action is accepted and the adapter's hook pauses the page.
  const { run, suppressInputPause, announceScript, emitCdpPauseAt, advance } =
    await configuredRuntimeHarness(context)
  suppressInputPause()
  await run.prepare()
  announceScript('hook', 'eval-ca9ab6a4.cdp')
  advance(590_000)
  run.action('one', 'repository-click')
  emitCdpPauseAt({
    scriptId: 'hook',
    lineNumber: 0,
    columnNumber: 219,
    functionName: '',
    hitBreakpoints: [],
  })
  // Act: the ten-minute budget passes before the 20 s progress deadline of the action.
  advance(10_000)
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository whole-run deadline exceeded. The browser is paused at eval-ca9ab6a4.cdp 1:220 without a debugger stop.',
  )
})

// Cycle 0044 (0042-SR31): red while a browser stop whose binding the debugger moved after arming failed with "DAP frame differs from exact configured source" instead of saying where it bound.
test('a browser stop the debugger moves to another line after it was armed fails naming the declared stop and where it is bound now', async (context) => {
  // Arrange: the stop is verified at 1:1 while it is armed; afterwards the debugger reports it at 2:1 and pauses there.
  const { run, bindFirstStopAt, holdSourceBoundWait } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: 'AAAA;AACA',
      fixture: { source: 'const nextTheme = "dark";\nsetTheme(nextTheme);\n' },
    })
  await run.prepare()
  bindFirstStopAt(2, 1)
  const wait = holdSourceBoundWait()
  // Act
  run.action('one', 'repository-click')
  await waitUntil(
    () => journalDetails(run, 'dap.stopped').length === 1,
    'stop announced',
  )
  wait.release()
  await waitUntil(() => run.view().status === 'failed', 'moved stop rejected')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Error: Declared stop src/theme.ts:1 bound at 2:1, refused: line 2 is after the last line 1 of the citation. Frozen source map positions in the selected citation: 1:1. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.',
  )
  assert.equal(run.view().snapshots.length, 0)
})

// Cycle 0044 (0041-N10-1b): red while a stop declared on a line the sealed map has no position on was requested on that line. A debugger verifies no breakpoint there (seen natively: the run was admitted and then lost after 20 s), so the first declaration was lost.
test('a stop declared on a line the sealed map has no position on is requested at the first mapped position after it in its citation, pauses there and commits at that place', async (context) => {
  // Arrange: line 1 is a comment the map never reaches, line 2 is the statement; the citation covers both, and the debugger verifies a breakpoint on line 2 only.
  const { run, breakpoints, verifyBreakpointsOnlyOnLines, mouse } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: ';AACA',
      fixture: {
        source: '// toggles the theme\nconst nextTheme = "dark";\n',
        citationEndLine: 2,
      },
    })
  verifyBreakpointsOnlyOnLines([2])
  // Act
  await run.prepare()
  const requested = breakpoints.find(
    (breakpoint) => breakpoint.id === 'owned-breakpoint',
  )?.location.range.start
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured at the first mapped position after its declared line')
  const armed = run
    .view()
    .events.find(
      (event) => event.type === 'breakpoint.armed-after-declared-line',
    )
  await run.stop()
  // Assert
  assert.equal(requested?.line, 1)
  assert.equal(requested?.character, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(armed?.detail)), {
    participant: 'browser',
    declared: { line: 1, column: 1 },
    armed: { line: 2, column: 1 },
  })
  assert.equal(snapshot.source.line, 2)
  assert.equal(snapshot.source.column, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.source.binding)), {
    declaredLine: 1,
    requestedLine: 2,
    boundLine: 2,
    mappedLinesBetween: 0,
  })
  assert.equal(mouse.length, 2)
})

// Cycle 0045 (ST-14): every live-run test declared 1:1 and mapped the next line at column 1, so the requested column could not be told from the declared one; green on 6a7a0b8, its controls are the column handed to the owned breakpoint and the column of the requested place.
test('a stop declared at column 1 of an unmapped line is requested and captured at the column of the first mapped position on the next line', async (context) => {
  // Arrange: line 1 is a comment the map never reaches; line 2 holds an indented statement, mapped at its column 3.
  const { run, breakpoints, verifyBreakpointsOnlyOnLines } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: ';AACE',
      fixture: {
        source: '// toggles the theme\n  const nextTheme = "dark";\n',
        citationEndLine: 2,
      },
    })
  verifyBreakpointsOnlyOnLines([2])
  // Act
  await run.prepare()
  const requested = breakpoints.find(
    (breakpoint) => breakpoint.id === 'owned-breakpoint',
  )?.location.range.start
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured at the requested column')
  const armed = run
    .view()
    .events.find(
      (event) => event.type === 'breakpoint.armed-after-declared-line',
    )
  await run.stop()
  // Assert
  assert.deepEqual(
    { line: requested?.line, character: requested?.character },
    { line: 1, character: 2 },
  )
  assert.deepEqual(JSON.parse(JSON.stringify(armed?.detail)), {
    participant: 'browser',
    declared: { line: 1, column: 1 },
    armed: { line: 2, column: 3 },
  })
  assert.equal(snapshot.source.line, 2)
  assert.equal(snapshot.source.column, 3)
})

// Cycle 0045 (SP-7, SS-12, SS-13, PC-3.9): red while the place and the two checks of the preparation refusal each scanned the sealed map (three scans for this stop; a fourth by the binding rule when the requested line is not the citation's last).
test('preparing a stop declared on an unmapped line scans its sealed map once', async (context) => {
  // Arrange: line 1 is a comment the map never reaches, line 2 is the statement; the citation covers both.
  const { run, verifyBreakpointsOnlyOnLines, mapScans } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: ';AACA',
      fixture: {
        source: '// toggles the theme\nconst nextTheme = "dark";\n',
        citationEndLine: 2,
      },
    })
  verifyBreakpointsOnlyOnLines([2])
  // Act: the whole preparation, then the pause, whose handler asks the stop's rule.
  await run.prepare()
  const scansOfPreparation = [...mapScans]
  run.action('one', 'repository-click')
  await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured at the first mapped position after its declared line')
  await run.stop()
  // Assert: one scan, from the declared line to the end of the citation, and no further one at the pause.
  assert.deepEqual(scansOfPreparation, [{ startLine: 1, endLine: 2 }])
  assert.deepEqual(mapScans, [{ startLine: 1, endLine: 2 }])
})

// Value: protects=an agent and kept evidence telling a stop's declared place from the place its breakpoint was requested at and from where it paused; fails_when=the inspection or the journal names the declared place only under "requested", so the requested place is nowhere; why_new=Cycle 0045 ER-8 (API 1.6 adds declaredSource and armed, no existing key changes its meaning); seam=the runtime harness's adapter, which verifies a breakpoint on line 2 only
test('the inspection and the journal of a stop declared on an unmapped line name its declared, its armed and its bound place', async (context) => {
  // Arrange: line 1 is a comment the map never reaches, line 2 is the statement; the citation covers both, and the debugger verifies a breakpoint on line 2 only.
  const { run, verifyBreakpointsOnlyOnLines } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: ';AACA',
      fixture: {
        source: '// toggles the theme\nconst nextTheme = "dark";\n',
        citationEndLine: 2,
      },
    },
  )
  verifyBreakpointsOnlyOnLines([2])
  await run.prepare()
  run.action('one', 'repository-click')
  await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured at the first mapped position after its declared line')
  await run.stop()
  const { service, record } = retainStoppedRun(
    context,
    run,
    run.view().artifactDirectory,
  )

  // Act
  const inspection = await readResource(
      service,
      service.state(record).observations[0]!.inspectionUri,
    ),
    bound = run.view().events.find((event) => event.type === 'breakpoint.bound')

  // Assert
  assert.ok('text' in inspection)
  const facts = JSON.parse(JSON.parse(inspection.text).content)
  assert.equal(JSON.stringify(facts.declaredSource), '{"line":1,"column":1}')
  assert.equal(JSON.stringify(facts.armed), '{"line":2,"column":1}')
  assert.equal(facts.source.line, 2)
  assert.equal(facts.source.column, 1)
  assert.equal(JSON.stringify(facts.requestedSource), '{"line":1,"column":1}')
  assert.equal(
    JSON.stringify(bound?.detail),
    '{"verified":true,"line":2,"column":1,"requested":{"line":1,"column":1},"declared":{"line":1,"column":1},"armed":{"line":2,"column":1}}',
  )
})

// Cycle 0044 (0041-N10-1b): red while the binding rule of such a stop was measured from its declared line: the debugger moved the requested 74:12 to 75:13 and the run ended "bound at 75:13, refused: line 74 between the declared line 73 and line 75 has a mapped position" (native, both hosts).
test('a stop requested after its unmapped declared line that the debugger then binds on the next line commits there, as a stop declared on the requested line would', async (context) => {
  // Arrange: line 1 is a comment without a mapping, lines 2 and 3 are mapped; the debugger takes the request on line 2 and verifies it at 3:1.
  const { run, breakpoints, verifyBreakpointsOnlyOnLines, bindFirstStopAt } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: ';AACA;AACA',
      fixture: {
        source: '// toggles the theme\nconst nextTheme =\n  "dark";\n',
        citationEndLine: 3,
      },
    })
  verifyBreakpointsOnlyOnLines([2])
  bindFirstStopAt(3, 1)
  // Act
  await run.prepare()
  const requested = breakpoints.find(
    (breakpoint) => breakpoint.id === 'owned-breakpoint',
  )?.location.range.start
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured on the line after the requested one')
  await run.stop()
  // Assert
  assert.equal(requested?.line, 1)
  assert.equal(snapshot.source.line, 3)
  assert.equal(snapshot.source.column, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.source.binding)), {
    declaredLine: 1,
    requestedLine: 2,
    boundLine: 3,
    mappedLinesBetween: 0,
  })
})

// Cycle 0044 (0041-N10-1b): the declared position is still what is requested when its line has a mapped position, also when the debugger then binds it on the next line.
test('a stop declared on a line with a mapped position is requested at its declared position', async (context) => {
  // Arrange: lines 1 and 2 are both mapped and the citation covers both.
  const { run, breakpoints } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: 'AAAA;AACA',
      fixture: { citationEndLine: 2 },
    },
  )
  // Act
  await run.prepare()
  const requested = breakpoints.find(
    (breakpoint) => breakpoint.id === 'owned-breakpoint',
  )?.location.range.start
  const armedElsewhere = run
    .view()
    .events.some(
      (event) => event.type === 'breakpoint.armed-after-declared-line',
    )
  await run.stop()
  // Assert
  assert.equal(requested?.line, 0)
  assert.equal(requested?.character, 0)
  assert.equal(armedElsewhere, false)
})

// Cycle 0044 (0042-N11-2): red while a click target that matches nothing timed out with "click target click-target-missing." and no hint.
test('a click target that matches no element ends preparation saying so, with the page’s control counts and what to read', async (context) => {
  // Arrange
  const { run, failBeforeWith, mouse } = await configuredRuntimeHarness(context)
  failBeforeWith({
    reason: 'click-target-missing',
    candidates: { button: 2, link: 5, field: 3 },
  })
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert
  assert.equal(
    thrownMessage(failure),
    "Timed out waiting for configured before conditions: click target click-target-missing. The action selector matched no element on the page. The page holds 2 button, 5 link and 3 form field elements. Read the component's source for the control's tag, id, name or attributes and declare a browser-native CSS selector that matches exactly one element; check entryPath when the page holds no such control.",
  )
  assert.equal(mouse.length, 0)
})

// Cycle 0044 (0042-N11-3): red while a required value that the stopped line itself declares ended the run with "is unavailable" and no word about why.
test('a required value that the stopped line itself declares fails saying that the line declares it and where to declare the stop instead', async (context) => {
  // Arrange: the stop is on `const nextTheme = "dark";` and requires value:nextTheme, which has no value before that line runs.
  const { run, requireUnavailableValue } =
    await configuredRuntimeHarness(context)
  requireUnavailableValue()
  await run.prepare()
  // Act
  run.action('one', 'repository-click')
  await waitUntil(
    () => run.view().status === 'failed',
    'required value missing',
  )
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Error: Required inspection value:nextTheme is unavailable; captured facts remain readable. Line 1 declares nextTheme, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
  )
})

// Value: protects=a stop declared above a comment that the development build keeps (Next keeps `// Auth.js error messages…` and maps it) being accepted on the code line after it; fails_when=a mapping onto a kept comment counts as a line that could run and refuses the binding; why_new=Cycle 0043 N-2 (N12-d′ refused actions.ts 33 bound at 35 across comment line 34); seam=none
test('a browser stop the debugger binds two lines below, across a comment the generated module kept and mapped, is armed and commits at the bound line', async (context) => {
  // Arrange: the module mirrors the source, so line 2 of the map points at the kept comment.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: 'AAAA;AACA;AACA',
      fixture: {
        source: 'const nextTheme = "dark";\n// Keep the saved theme.\n',
        citationEndLine: 3,
      },
    },
  )
  bindFirstStopAt(3, 1)
  // Act
  await run.prepare()
  run.action('across-comment', 'repository-click')
  const stop = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'stop committed below the kept comment')
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  // Assert
  assert.equal(stop.source.line, 3)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(mouse.length, 2)
})

// Value: protects=a stop declared on a blank or comment line that no later line of its citation can stand in for being refused before any input whatever the size of the sealed map; fails_when=a map over the scan limit skips the preparation check and the click is sent; why_new=Cycle 0043 R3, one rule with 0041-N10-1b (Cycle 0044); seam=none
test('a stop declared on a blank line with only blank or comment lines after it in its citation is refused before any click, also when the sealed map is too large to scan completely', async (context) => {
  // Arrange: the stop is declared on the blank line 2, the only later line of its citation (3) is blank too, and the scan stops at its generated-line limit.
  const { run, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: `${';'.repeat(100_000)}AAAA`,
      fixture: {
        source: THREE_LINE_SOURCE,
        citationEndLine: 3,
        declaredLine: 2,
      },
    },
  )
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      `Error: Declared stop src/theme.ts:2 has no mapped position on that line in the sealed module. Frozen source map positions in the selected citation (partial map scan): none. ${MAPPED_POSITION_HINTS}`,
    )
    return true
  })
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=the first admitted run of a stop declared on a blank line above its statement going on in a module whose map is too large to scan; fails_when=preparation refuses every blank or comment-only declared line of an oversized map, although a later line of the citation holds code the debugger binds; why_new=Cycle 0044 merge of 0041-N10-1b with R3 (one rule whatever the map's size: the source text decides when the map cannot); seam=none
test('a stop declared on a blank line with a code line after it in its citation is armed, also when the sealed map is too large to scan completely', async (context) => {
  // Arrange: line 2 is blank and line 3 is the statement; the scan stops at its segment limit on generated line 0, before the mapping of line 3, and the debugger verifies the binding at 3:1.
  const { run, bindFirstStopAt, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      mappings: `${'A,'.repeat(200_000)}A;;AAEA`,
      fixture: {
        source: '// toggles the theme\n\nconst nextTheme = "dark";\n',
        citationEndLine: 3,
        declaredLine: 2,
      },
    },
  )
  bindFirstStopAt(3, 1)
  // Act
  await run.prepare()
  run.action('oversized-map', 'repository-click')
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured at the bound line')
  await run.stop()
  // Assert
  assert.equal(snapshot.source.line, 3)
  assert.equal(snapshot.source.column, 1)
  assert.equal(mouse.length, 2)
})

// Value: protects=a later line being taken as the stop only when the debugger could not pause on the declared line, not when the requested column lay after the declared statement; fails_when=a binding slid to the next line is accepted although the declared line has a break location; why_new=Cycle 0043 R12(b); seam=the adapter's possible break locations
test('a browser stop slid to the next line although its declared line has a break location is refused at arming without a click', async (context) => {
  // Arrange: the adapter verifies the stop declared at 1:1 at 2:1 and lists a break location on generated line 0, which the map puts on line 1.
  const { run, bindFirstStopAt, listPossibleBreakLines, mouse } =
    await configuredRuntimeHarness(context, undefined, [], TWO_LINE_CITATION)
  bindFirstStopAt(2, 1)
  listPossibleBreakLines([0, 1])
  // Act
  await assert.rejects(run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      `Error: Declared stop src/theme.ts:1 bound at 2:1, refused: the debugger can pause on the declared line 1, so requested column 1 lies after its statement; declare the column where the statement begins (configuration.source.column). Frozen source map positions in the selected citation: 1:1, 2:1. ${MAPPED_POSITION_HINTS}`,
    )
    return true
  })
  await run.stop()
  // Assert
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Cycle 0045 (ST-1): the accept path of the slide check had no answering debugger; green on 6a7a0b8, its control is the comparison of each answered location's line with the requested line.
test('a browser stop bound on the next line is armed and captured there when the debugger lists break locations only on that line', async (context) => {
  // Arrange: source line 1 is generated lines 0 and 2, source line 2 is generated line 1 between them, so the range asked for line 1 also holds the place of line 2; the debugger can pause only there and verifies the stop declared at 1:1 at 2:1.
  const {
    run,
    bindFirstStopAt,
    listPossibleBreakLines,
    breakLocationRequests,
  } = await configuredRuntimeHarness(context, undefined, [], {
    mappings: 'AAAA;AACA;AADA',
    fixture: {
      source: 'const nextTheme = "dark";\nsetTheme(nextTheme);\nrender();\n',
      citationEndLine: 2,
    },
  })
  bindFirstStopAt(2, 1)
  listPossibleBreakLines([1])
  // Act
  await run.prepare()
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured on the line the debugger bound')
  await run.stop()
  // Assert: the debugger was asked, and its only break location lies on line 2, so line 2 is the stop.
  assert.deepEqual(breakLocationRequests, [
    {
      start: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 },
      end: { scriptId: 'actual', lineNumber: 3, columnNumber: 0 },
    },
  ])
  assert.equal(snapshot.source.line, 2)
  assert.equal(snapshot.source.column, 1)
})

// Cycle 0045 (B-L6, SP-3, ER-21, PC-3.1): red while the debugger was asked for every break location of the module from 0:0 with no end.
test('a browser stop moved to a later line asks the debugger for the break locations of the requested line only, and is refused when one lies on it', async (context) => {
  // Arrange: the adapter verifies the stop declared at 1:1 at 2:1; generated line 0 is source line 1 and holds a break location at column 6, after that line's only mapping, and generated line 1 holds one too.
  const {
    run,
    bindFirstStopAt,
    listPossibleBreakLocations,
    breakLocationRequests,
    mouse,
  } = await configuredRuntimeHarness(context, undefined, [], TWO_LINE_CITATION)
  bindFirstStopAt(2, 1)
  listPossibleBreakLocations([
    { lineNumber: 0, columnNumber: 6 },
    { lineNumber: 1, columnNumber: 0 },
  ])
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert: the range ends, exclusively, where generated line 1 begins.
  assert.deepEqual(breakLocationRequests, [
    {
      start: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 },
      end: { scriptId: 'actual', lineNumber: 1, columnNumber: 0 },
    },
  ])
  assert.equal(
    String(failure),
    `Error: Declared stop src/theme.ts:1 bound at 2:1, refused: the debugger can pause on the declared line 1, so requested column 1 lies after its statement; declare the column where the statement begins (configuration.source.column). Frozen source map positions in the selected citation: 1:1, 2:1. ${MAPPED_POSITION_HINTS}`,
  )
  assert.equal(mouse.length, 0)
})

// Cycle 0045 (CX-A1, ER-9): red while a binding that slid to the next line although its own line can pause was refused at once ("bound at 2:1, refused: the debugger can pause on the declared line 1 …").
test('a browser stop whose verified binding moved to the next line although its own line can pause is requested again on its line and pauses there', async (context) => {
  // Arrange: the stop is declared at 1:7; the debugger verifies that request at 2:1, lists a break location at the start of line 1, and binds a request there where it was made.
  const { run, breakpoints, bindFirstStopAt, listPossibleBreakLines, mouse } =
    await configuredRuntimeHarness(context, undefined, [], {
      mappings: 'AAAA;AACA',
      fixture: { citationEndLine: 2, declaredColumn: 7 },
    })
  bindFirstStopAt(2, 1)
  listPossibleBreakLines([0, 1])
  // Act
  await run.prepare()
  const ownedAfterArming = breakpoints
    .filter((breakpoint) => breakpoint.id.startsWith('owned-breakpoint'))
    .map((breakpoint) => ({
      id: breakpoint.id,
      ...breakpoint.location.range.start,
    }))
  run.action('one', 'repository-click')
  const snapshot = await waitUntil(() => {
    const view = run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[0]
  }, 'stop captured on its declared line')
  const rearmed = run
    .view()
    .events.filter(
      (event) => event.type === 'breakpoint.rearmed-on-requested-line',
    )
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
  await run.continue('browser', snapshot.pause)
  await waitUntil(() => run.view().status === 'completed', 'final result')
  await run.stop()
  // Assert: exactly one owned breakpoint after the second request, at the line's break location, and the stop is committed there.
  assert.deepEqual(ownedAfterArming, [
    { id: 'owned-breakpoint-2', line: 0, character: 0 },
  ])
  assert.deepEqual(rearmed, [
    {
      participant: 'browser',
      declared: { line: 1, column: 7 },
      armed: { line: 1, column: 1 },
      firstRequest: { line: 1, column: 7 },
      firstBinding: { line: 2, column: 1 },
    },
  ])
  assert.equal(snapshot.source.line, 1)
  assert.equal(snapshot.source.column, 1)
  assert.equal(run.view().finalOutcome, 'demonstrated')
  assert.equal(mouse.length, 2)
})

// Cycle 0045 (CX-A1, ER-9, SM-18): the refusal after the one new request; red while no second request was made.
test('a browser stop that still cannot be bound on its line after one new request is refused and told to declare the statement’s column', async (context) => {
  // Arrange: the debugger verifies the request at 1:7 and the second request at 1:1 both at 2:1.
  const {
    run,
    breakpoints,
    bindFirstStopAt,
    bindLaterStopsAt,
    listPossibleBreakLines,
    mouse,
  } = await configuredRuntimeHarness(context, undefined, [], {
    mappings: 'AAAA;AACA',
    fixture: { citationEndLine: 2, declaredColumn: 7 },
  })
  bindFirstStopAt(2, 1)
  bindLaterStopsAt(2, 1)
  listPossibleBreakLines([0, 1])
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert: no owned breakpoint is left, and nothing was clicked.
  assert.equal(
    String(failure),
    `Error: Declared stop src/theme.ts:1 bound at 2:1, refused: the debugger can pause on the declared line 1, so requested column 7 lies after its statement, and a second request at 1:1 was bound on line 2 again; declare the column where the statement begins (configuration.source.column). Frozen source map positions in the selected citation: 1:1, 2:1. ${MAPPED_POSITION_HINTS}`,
  )
  assert.deepEqual(
    breakpoints.map((breakpoint) => breakpoint.id),
    ['learner-owned'],
  )
  assert.equal(mouse.length, 0)
  assert.equal(run.view().finalOutcome, 'not-demonstrated')
})

// Cycle 0045 (ST-15, SM-18, ER-9): red while the refusal on the requested line was never executed with an answering debugger and told the agent to "request the column where the statement begins" about a column Codebook chose.
test('a stop requested after its unmapped declared line that the debugger slides past a requested line it can pause on is refused naming the requested line', async (context) => {
  // Arrange: line 1 is a comment without a mapping, lines 2 and 3 are mapped; the debugger takes the request at 2:1, verifies it at 3:1 and lists break locations on lines 2 and 3.
  const {
    run,
    verifyBreakpointsOnlyOnLines,
    bindFirstStopAt,
    listPossibleBreakLines,
    mouse,
  } = await configuredRuntimeHarness(context, undefined, [], {
    mappings: ';AACA;AACA',
    fixture: {
      source: '// toggles the theme\nconst nextTheme =\n  "dark";\n',
      citationEndLine: 3,
    },
  })
  verifyBreakpointsOnlyOnLines([2])
  bindFirstStopAt(3, 1)
  listPossibleBreakLines([1, 2])
  // Act
  const failure = await run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await run.stop()
  // Assert: no break location lies before the requested column 1, so no second request is made.
  assert.equal(
    String(failure),
    `Error: Declared stop src/theme.ts:1 bound at 3:1, refused: the debugger can pause on line 2, where the stop was requested, so requested column 1 lies after its statement; declare the stop on line 2 at the column where its statement begins (configuration.source). Frozen source map positions in the selected citation: 2:1, 3:1. ${MAPPED_POSITION_HINTS}`,
  )
  assert.equal(mouse.length, 0)
})

// Cycle 0045 (PC-2.1): the second request takes its column from the line the stop was requested on, not from the declared column.
test('a stop requested after its unmapped declared line that slid past the requested line is requested again at that line’s break location before the requested column', async (context) => {
  // Arrange: line 1 is a comment without a mapping. The generated module keeps a comment on its line 1, which the map attributes to source 3:1, and has the code of source line 3 on its line 2, mapped at 3:7; a mapping onto a kept comment is no position, so the stop declared at 1:1 is requested at 3:7. The debugger verifies that request at 4:1 and lists a break location at the comment's place and on line 4.
  const {
    run,
    breakpoints,
    verifyBreakpointsOnlyOnLines,
    bindFirstStopAt,
    listPossibleBreakLines,
  } = await configuredRuntimeHarness(context, undefined, [], {
    mappings: ';AAEA;AAAM;AACN',
    fixture: {
      source:
        '// toggles the theme\n/* why */\nconst nextTheme = "dark";\nrender();\n',
      citationEndLine: 4,
    },
  })
  verifyBreakpointsOnlyOnLines([3])
  bindFirstStopAt(4, 1)
  listPossibleBreakLines([1, 3])
  // Act
  await run.prepare()
  const requestedAgain = breakpoints.find((breakpoint) =>
    breakpoint.id.startsWith('owned-breakpoint'),
  )?.location.range.start
  const events = run.view().events,
    journal = (type: string): unknown =>
      JSON.parse(
        JSON.stringify(events.find((event) => event.type === type)?.detail),
      )
  await run.stop()
  // Assert: the second request is made on line 3 at column 1, before the requested column 7; a candidate "before the declared column 1" would not exist.
  assert.deepEqual(journal('breakpoint.armed-after-declared-line'), {
    participant: 'browser',
    declared: { line: 1, column: 1 },
    armed: { line: 3, column: 7 },
  })
  assert.deepEqual(journal('breakpoint.rearmed-on-requested-line'), {
    participant: 'browser',
    declared: { line: 1, column: 1 },
    armed: { line: 3, column: 1 },
    firstRequest: { line: 3, column: 7 },
    firstBinding: { line: 4, column: 1 },
  })
  assert.deepEqual(
    { line: requestedAgain?.line, character: requestedAgain?.character },
    { line: 2, character: 0 },
  )
})

// Value: protects=the deadline of a first browser stop that was not moved still naming that stop once the click was sent; fails_when=the run ends with the bare "Repository input reached no verified pause"; why_new=Cycle 0043 N-3; seam=the harness clock
test('a first stop on its declared line that the click does not reach ends the run naming the stop and that its line must run', async (context) => {
  // Arrange
  const { run, suppressInputPause, advance } =
    await configuredRuntimeHarness(context)
  suppressInputPause()
  await run.prepare()
  run.action('not-reached', 'repository-click')
  await waitUntil(
    () => run.view().operation?.inputDispatched,
    'input dispatched',
  )
  // Act
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'first stop not hit')
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository input reached no verified pause: declared stop src/theme.ts:1 was not hit within 20 s of the accepted action; its line must execute after the input',
  )
})

// Value: protects=one statement never being committed twice as two different declared stops, and a later stop never waiting for a line that already ran as an earlier one; fails_when=a stop declared on the line an earlier stop was moved to is armed on that same bound place; why_new=Cycle 0043 R4; seam=none
test('two stops declared on different lines that bind on one place fail when the second is armed, naming both declared stops and the place, without a resume', async (context) => {
  // Arrange: the first stop is declared at 1:1 and the adapter moves it to 2:1; the second is declared at 2:1.
  const { run, bindFirstStopAt, commands } = await configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 2,
        column: 1,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ],
    TWO_LINE_CITATION,
  )
  bindFirstStopAt(2, 1)
  await run.prepare()
  run.action('same-place', 'repository-click')
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'first stop',
  )
  // Act / Assert
  await assert.rejects(
    run.continue('browser', first.pause),
    (error: unknown) => {
      assert.equal(
        String(error),
        `Error: Declared stops src/theme.ts:1 and src/theme.ts:2 both bound at 2:1; one bound place is one stop, so declare it once. Frozen source map positions in the selected citation: 1:1, 2:1. ${MAPPED_POSITION_HINTS}`,
      )
      return true
    },
  )
  await run.stop()
  assert.equal(run.view().snapshots.length, 1)
  assert.equal(commands.filter((command) => command === 'continue').length, 0)
})
