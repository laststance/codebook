import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { createChromeExtensionActionExecutor } from '../chromeExtensionActionExecutor'
import type { ResolvedExtensionClick } from '../chromeExtensionContracts'
import { ExtensionPauseSet } from '../chromeExtensionPauseSet'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { defer } from './utils/defer'
import {
  fakeExtensionSurface,
  type SurfaceAnswers,
} from './utils/fakeExtensionSurface'

const SURFACE_SESSION = 'surface-session'

const CLICK: ResolvedExtensionClick = {
  index: 1,
  title: 'Create folder',
  selector: '#new-folder',
  kind: 'click',
  inputs: [],
}

/** Opens a declared pause in a set, as the debugger does when a stop is reached. */
function openDeclaredPause(pauses: ExtensionPauseSet) {
  return pauses.open({
    sessionId: 'worker-session',
    threadId: 1,
    context: 'service-worker',
    reason: 'breakpoint',
    kind: 'declared',
    stopIndex: 1,
    status: 'capturing',
    pausedAtMs: 0,
  })
}

/** Builds an executor over a fake surface with short bounds so a test waits milliseconds. */
function executorFor(
  answers: SurfaceAnswers = {},
  options: {
    stepTimeoutMs?: number
    returnBoundMs?: number
    settleMs?: number
    /** Replaces the journal sink, for a test whose journal fails. */
    record?: (type: string, detail: unknown) => void
    /** The per-step source check (ER20); absent → none. */
    assertSourcesUnchanged?: () => void | Promise<void>
  } = {},
) {
  const surface = fakeExtensionSurface(answers)
  const pauses = new ExtensionPauseSet()
  const events: Array<{ type: string; detail: unknown }> = []
  const executor = createChromeExtensionActionExecutor({
    cdp: surface.connection,
    surfaceSessionId: SURFACE_SESSION,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    pauseState: pauses,
    assertActionCurrent: () => {},
    ...(options.assertSourcesUnchanged && {
      assertSourcesUnchanged: options.assertSourcesUnchanged,
    }),
    record:
      options.record ?? ((type, detail) => void events.push({ type, detail })),
    roots: { storage: [], workspace: '/Users/ada/secret-repo' },
    stepTimeoutMs: options.stepTimeoutMs ?? 2_000,
    returnBoundMs: options.returnBoundMs ?? 2_000,
    settleMs: options.settleMs ?? 10,
  })
  return { executor, surface, pauses, events }
}

/** Resolves once the fake surface has been sent a request of this method, so a test acts on the step's request instead of a timer. */
function requestSent(surface: { methods: () => string[] }, method: string) {
  return waitUntil(
    () => surface.methods().includes(method),
    `the ${method} request is sent`,
  )
}

/** The phase an in-page inspection of an input was asked for. */
function inspectionPhase(params: Record<string, unknown>): unknown {
  const [argument] = params.arguments as Array<{ value?: { phase?: string } }>
  return argument?.value?.phase
}

// protects=a click with one text input runs focusing, inserting, verifying, clicking in order with a trusted press at the element centre; fails_when=a step is skipped, reordered or the press misses the centre; no_claim=real Chrome hit testing
test('a click with one input focuses, inserts, verifies and then presses the mouse at the centre', async () => {
  // Arrange
  const { executor, surface } = executorFor()
  const click: ResolvedExtensionClick = {
    ...CLICK,
    inputs: [{ selector: '#name', text: 'New Folder' }],
  }
  // Act
  const receipt = await executor.run(click)
  await receipt.completed
  // Assert
  assert.deepEqual(surface.methods(), [
    'Page.enable',
    'Runtime.evaluate',
    'Runtime.callFunctionOn',
    'Input.insertText',
    'Runtime.callFunctionOn',
    'Runtime.releaseObject',
    'Runtime.evaluate',
    'Runtime.callFunctionOn',
    'Runtime.releaseObject',
    'Input.dispatchMouseEvent',
    'Input.dispatchMouseEvent',
  ])
  assert.deepEqual(surface.sent[3]?.params, { text: 'New Folder' })
  assert.deepEqual(surface.sent[9]?.params, {
    type: 'mousePressed',
    x: 120,
    y: 48,
    button: 'left',
    clickCount: 1,
  })
  assert.equal(receipt.outcome, 'settled')
  assert.deepEqual(receipt.progress(), {
    inputsApplied: 1,
    clickDispatched: true,
    inputEffects: ['confirmed'],
    clickEffect: 'confirmed',
  })
})

// protects=a declared double click reaches the page as two press-release pairs with click counts 1 and 2; fails_when=one pair is sent or both carry count 1; no_claim=that the page's dblclick handler runs
test('a double click dispatches press and release pairs with click counts 1 and 2', async () => {
  // Arrange
  const { executor, surface } = executorFor()
  // Act
  const receipt = await executor.run({ ...CLICK, kind: 'dblclick' })
  await receipt.completed
  // Assert
  const mouse = surface.sent
    .filter((request) => request.method === 'Input.dispatchMouseEvent')
    .map((request) => `${request.params.type}:${request.params.clickCount}`)
  assert.deepEqual(mouse, [
    'mousePressed:1',
    'mouseReleased:1',
    'mousePressed:2',
    'mouseReleased:2',
  ])
})

// protects=a selector reaches page code only as a JSON literal, never concatenated; fails_when=a quote, backtick, template or script end in a selector changes the evaluated code; no_claim=other injection routes
test('a selector with quotes, backticks, template markers and a script end reaches the page as one JSON literal', async () => {
  // Arrange
  const selector = `a[title='x'] \`\${1}\` </script>`
  const { executor, surface } = executorFor()
  // Act
  const receipt = await executor.run({ ...CLICK, selector })
  await receipt.completed
  // Assert
  const expression = String(surface.sent[1]?.params.expression)
  assert.ok(
    expression.endsWith(
      `(${JSON.stringify(selector)},["chrome-extension://abcdefghijklmnopabcdefghijklmnop"])`,
    ),
  )
})

// protects=a selector that matches nothing is refused before any effect; fails_when=an input or press is sent or the side effect is not none; no_claim=retry behaviour of the run
test('a selector that matches no element is refused with SELECTOR_NOT_FOUND and sends no input', async () => {
  // Arrange
  const { executor, surface } = executorFor({
    'Runtime.evaluate': () => ({ result: { subtype: 'null' } }),
  })
  // Act
  const refusal = executor.run(CLICK)
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'SELECTOR_NOT_FOUND' &&
      error.message ===
        'No element matches #new-folder in the extension surface.',
  )
  assert.deepEqual(
    surface.methods().filter((method) => method.startsWith('Input.')),
    [],
  )
})

// protects=a pause longer than the step deadline during the first input is no lost answer and the sent request is not resent; fails_when=the step times out while paused or the insert is sent twice; no_claim=a real 20 s wait
test('a stop paused longer than the step deadline during the first input returns paused and resumes the same insert once', async () => {
  // Arrange
  const answerInsert = defer<Record<string, unknown>>()
  const { executor, surface, pauses } = executorFor(
    { 'Input.insertText': () => answerInsert.promise },
    { stepTimeoutMs: 500 },
  )
  const click: ResolvedExtensionClick = {
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  }
  // Act
  const call = executor.run(click)
  await requestSent(surface, 'Input.insertText')
  const pause = openDeclaredPause(pauses)
  const receipt = await call
  // gstack-timing-ok: the contract is that the pause outlasts the 500 ms step deadline without a timeout, so the hold is real time
  await sleep(700)
  pauses.close(pause.sessionId, pause.threadId)
  answerInsert.resolve({})
  await receipt.completed
  // Assert
  assert.equal(receipt.outcome, 'paused')
  assert.equal(
    surface.methods().filter((method) => method === 'Input.insertText').length,
    1,
  )
  assert.equal(receipt.progress().clickDispatched, true)
})

// protects=a lost answer after the focus request is a partial input; fails_when=it reads as a refusal that consumed nothing; no_claim=which request was lost on the wire
test('a lost answer after the focus request ends the click with INPUT_PARTIAL', async () => {
  // Arrange
  const { executor } = executorFor({
    'Runtime.callFunctionOn': (params) => {
      if (inspectionPhase(params) === 'focus') throw new Error('socket closed')
      return { result: { value: { ready: true } } }
    },
  })
  // Act
  const refusal = executor.run({
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  })
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'INPUT_PARTIAL' &&
      error.message ===
        'Input 1 of click 1 failed after earlier inputs were typed; the extension may have reacted.',
  )
})

// protects=a lost answer after the text insertion is a partial input; fails_when=the click still presses or the failure is another code; no_claim=real Input.insertText semantics
test('a lost answer after the text insertion ends the click with INPUT_PARTIAL and never presses', async () => {
  // Arrange
  const { executor, surface } = executorFor({
    'Input.insertText': () => {
      throw new Error('timed out')
    },
  })
  // Act
  const refusal = executor.run({
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  })
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'INPUT_PARTIAL',
  )
  assert.equal(surface.methods().includes('Input.dispatchMouseEvent'), false)
})

// protects=a second input whose selector vanished after the first was typed is partial, not a free retry; fails_when=SELECTOR_NOT_FOUND is raised after typing; no_claim=page changes between inputs
test('a missing second input after the first was typed ends the click with INPUT_PARTIAL', async () => {
  // Arrange
  let evaluations = 0
  const { executor } = executorFor({
    'Runtime.evaluate': () =>
      ++evaluations === 1
        ? { result: { subtype: 'node', objectId: 'node-1' } }
        : { result: { subtype: 'null' } },
  })
  // Act
  const refusal = executor.run({
    ...CLICK,
    inputs: [
      { selector: '#first', text: 'a' },
      { selector: '#second', text: 'b' },
    ],
  })
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'INPUT_PARTIAL' &&
      error.message ===
        'Input 2 of click 1 failed after earlier inputs were typed; the extension may have reacted.',
  )
})

// protects=ER20 (Cycle 0062 task 15): the source check runs before each input step and before the press, so a source change between two inputs stops the click with SOURCE_CHANGED before the next input is sent; fails_when=the check runs once per click and a second input is typed or the mouse pressed from changed sources; no_claim=what the check compares (run tests)
test('a source change between two inputs stops the click with SOURCE_CHANGED before the second input and the press', async () => {
  // Arrange
  let checks = 0
  const { executor, surface } = executorFor(
    {},
    {
      assertSourcesUnchanged: () => {
        checks += 1
        if (checks === 2)
          throw new StudyError('SOURCE_CHANGED', 'A pinned source changed.')
      },
    },
  )
  // Act
  const click = executor.run({
    ...CLICK,
    inputs: [
      { selector: '#first', text: 'a' },
      { selector: '#second', text: 'b' },
    ],
  })
  // Assert
  await assert.rejects(
    click,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'SOURCE_CHANGED',
  )
  assert.equal(
    surface.methods().filter((method) => method === 'Input.insertText').length,
    1,
  )
  assert.equal(surface.methods().includes('Input.dispatchMouseEvent'), false)
})

// protects=a lost answer after the mouse press is an unknown outcome; fails_when=it reads as partial input or as success; no_claim=whether the page reacted
test('a lost answer after the mouse press ends the click with CLICK_OUTCOME_UNKNOWN', async () => {
  // Arrange
  const { executor } = executorFor({
    'Input.dispatchMouseEvent': (params) => {
      if (params.type === 'mouseReleased') throw new Error('socket closed')
      return {}
    },
  })
  // Act
  const refusal = executor.run(CLICK)
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'CLICK_OUTCOME_UNKNOWN' &&
      error.message ===
        "The click's outcome is unknown; the extension may have reacted.",
  )
})

// protects=a click whose dispatch is unanswered at the return bound answers running and still completes later; fails_when=the call waits for the slow handler or loses the click; no_claim=the 10 s production bound
test('a slow click handler returns running at the bound and completes later', async () => {
  // Arrange
  const release = defer<Record<string, unknown>>()
  const { executor } = executorFor(
    {
      'Input.dispatchMouseEvent': (params) =>
        params.type === 'mouseReleased' ? release.promise : {},
    },
    { returnBoundMs: 1_000 },
  )
  // Act
  const receipt = await executor.run(CLICK)
  const dispatchedWhenReturned = receipt.progress().clickDispatched
  release.resolve({})
  await receipt.completed
  // Assert
  assert.equal(receipt.outcome, 'running')
  assert.equal(dispatchedWhenReturned, false)
  assert.equal(receipt.progress().clickDispatched, true)
})

// protects=a dialog the click opens is answered as declared and journaled; fails_when=the dialog stays open or the answer is the opposite; no_claim=real dialog blocking
test('a confirm dialog opened by the click is accepted as declared and journaled', async () => {
  // Arrange
  const gate = defer<Record<string, unknown>>()
  const { executor, surface, events } = executorFor({
    'Input.dispatchMouseEvent': (params) =>
      params.type === 'mouseReleased' ? gate.promise : {},
  })
  // Act
  const call = executor.run({ ...CLICK, dialog: 'accept' })
  await waitUntil(
    () =>
      surface.sent.some(
        (request) =>
          request.method === 'Input.dispatchMouseEvent' &&
          request.params.type === 'mouseReleased',
      ),
    'the mouse release is in flight',
  )
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  await requestSent(surface, 'Page.handleJavaScriptDialog')
  gate.resolve({})
  const receipt = await call
  await receipt.completed
  // Assert
  const handled = surface.sent.find(
    (request) => request.method === 'Page.handleJavaScriptDialog',
  )
  assert.deepEqual(handled?.params, { accept: true })
  assert.deepEqual(events, [
    {
      type: 'chrome-extension.dialog',
      detail: {
        clickIndex: 1,
        type: 'confirm',
        answer: 'accept',
        message: '',
      },
    },
  ])
})

// protects=a declared dismiss answers the dialog with accept false; fails_when=dismiss is sent as accept; no_claim=prompt text handling
test('a dialog declared as dismiss is dismissed', async () => {
  // Arrange
  const gate = defer<Record<string, unknown>>()
  const { executor, surface } = executorFor({
    'Input.dispatchMouseEvent': (params) =>
      params.type === 'mouseReleased' ? gate.promise : {},
  })
  // Act
  const call = executor.run({ ...CLICK, dialog: 'dismiss' })
  await waitUntil(
    () =>
      surface.sent.some(
        (request) =>
          request.method === 'Input.dispatchMouseEvent' &&
          request.params.type === 'mouseReleased',
      ),
    'the mouse release is in flight',
  )
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  await requestSent(surface, 'Page.handleJavaScriptDialog')
  gate.resolve({})
  await (
    await call
  ).completed
  // Assert
  const handled = surface.sent.find(
    (request) => request.method === 'Page.handleJavaScriptDialog',
  )
  assert.deepEqual(handled?.params, { accept: false })
})

// protects=a dialog without a declared answer fails the click instead of answering for the learner; fails_when=the dialog is answered or the run continues; no_claim=that the dialog is closed afterwards
test('a dialog without a declared answer fails the click with DIALOG_UNDECLARED', async () => {
  // Arrange
  const gate = defer<Record<string, unknown>>()
  const { executor, surface } = executorFor({
    'Input.dispatchMouseEvent': (params) =>
      params.type === 'mouseReleased' ? gate.promise : {},
  })
  // Act
  const call = executor.run(CLICK)
  await waitUntil(
    () =>
      surface.sent.some(
        (request) =>
          request.method === 'Input.dispatchMouseEvent' &&
          request.params.type === 'mouseReleased',
      ),
    'the mouse release is in flight',
  )
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  // Assert
  await assert.rejects(
    call,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'DIALOG_UNDECLARED' &&
      error.message ===
        'Click 1 opened a confirm dialog; declare dialog: accept or dismiss for it.',
  )
  assert.equal(surface.methods().includes('Page.handleJavaScriptDialog'), false)
})

/** A click-centre answer that is not ready, for the surface's `locateClickCentre` call. */
function centreRefusal(reason: string) {
  return (params: Record<string, unknown>) =>
    String(params.functionDeclaration).includes('element-has-no-size')
      ? { result: { value: { ready: false, reason } } }
      : { result: { value: { ready: true } } }
}

/** Runs a one-input click whose focus answer is held, returns the receipt as `paused`, then answers the focus with the given reason. */
async function focusRefusedAfterReturn(reason: string) {
  const focusAnswer = defer<Record<string, unknown>>()
  const { executor, surface, pauses } = executorFor({
    'Runtime.callFunctionOn': () => focusAnswer.promise,
  })
  const call = executor.run({
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  })
  await requestSent(surface, 'Runtime.callFunctionOn')
  openDeclaredPause(pauses)
  const receipt = await call
  focusAnswer.resolve({ result: { value: { ready: false, reason } } })
  await receipt.completed.catch(() => {})
  return receipt
}

// protects=a lost answer of the second input's element lookup (after the first input was typed) is a partial input, never a raw error; fails_when=the raw error of Runtime.evaluate escapes; no_claim=which lookup was lost on the wire
test('a lost answer of the second input lookup after the first was typed ends the click with INPUT_PARTIAL', async () => {
  // Arrange
  let evaluations = 0
  const { executor } = executorFor({
    'Runtime.evaluate': () => {
      if (++evaluations === 2) throw new Error('socket closed')
      return { result: { subtype: 'node', objectId: 'node-1' } }
    },
  })
  // Act
  const refusal = executor.run({
    ...CLICK,
    inputs: [
      { selector: '#first', text: 'a' },
      { selector: '#second', text: 'b' },
    ],
  })
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'INPUT_PARTIAL' &&
      error.message ===
        'Input 2 of click 1 failed after earlier inputs were typed; the extension may have reacted.',
  )
})

// protects=a lost answer of the click-centre call after an input was typed is a partial input named by the click step, not by a nonexistent input; fails_when=the raw error escapes or the message names Input 2 of a one-input click; no_claim=real DOM
test('a lost answer of the click-centre call after an input was typed ends the click with INPUT_PARTIAL naming the press', async () => {
  // Arrange
  const { executor } = executorFor({
    'Runtime.callFunctionOn': (params) => {
      if (String(params.functionDeclaration).includes('element-has-no-size'))
        throw new Error('socket closed')
      return { result: { value: { ready: true } } }
    },
  })
  // Act
  const refusal = executor.run({
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  })
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'INPUT_PARTIAL' &&
      error.message ===
        'The press of click 1 could not start after its inputs were typed; the extension may have reacted.',
  )
})

// protects=an answer of the wrong shape after an input was typed is a partial input (zod errors never escape); fails_when=a ZodError reaches the caller; no_claim=that Chrome sends such an answer
test('a click-centre answer of the wrong shape after an input was typed ends the click with INPUT_PARTIAL', async () => {
  // Arrange
  const { executor } = executorFor({
    'Runtime.callFunctionOn': (params) =>
      String(params.functionDeclaration).includes('element-has-no-size')
        ? { result: { value: { ready: 'yes' } } }
        : { result: { value: { ready: true } } },
  })
  // Act
  const refusal = executor.run({
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  })
  // Assert
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'INPUT_PARTIAL',
  )
})

// protects=a raw failure before any effect is a StudyError that says nothing was typed or pressed; fails_when=the raw error escapes or the failure claims a partial effect; no_claim=retry behaviour of the run
test('a lost answer of Page.enable fails with RUNTIME_FAILED and no side effect', async () => {
  // Arrange
  const { executor, surface } = executorFor({
    'Page.enable': () => {
      throw new Error('socket closed')
    },
  })
  // Act
  const refusal = executor.run(CLICK)
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'RUNTIME_FAILED')
    assert.equal(
      error.message,
      'Click 1 could not start; nothing was typed or pressed.',
    )
    assert.match(error.describe().recovery, /Side effects: none\./)
    return true
  })
  assert.deepEqual(
    surface.methods().filter((method) => method.startsWith('Input.')),
    [],
  )
})

// protects=the fixed SELECTOR_NOT_FOUND sentence of the contract, with the reason in the cause; fails_when=the reason is appended to the message; no_claim=wording of other codes
test('a click whose centre is covered fails with the fixed SELECTOR_NOT_FOUND sentence and the reason in the cause', async () => {
  // Arrange
  const { executor } = executorFor({
    'Runtime.callFunctionOn': centreRefusal('element-obscured'),
  })
  // Act
  const refusal = executor.run(CLICK)
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'SELECTOR_NOT_FOUND')
    assert.equal(
      error.message,
      'No element matches #new-folder in the extension surface.',
    )
    assert.equal(
      error.causeDetail,
      'No element matches #new-folder in the extension surface. (element-obscured)',
    )
    return true
  })
})

// protects=a focus refused before focus() ran records no effect on the input; fails_when=the input effect reads confirmed for an obscured first input; no_claim=real hit testing
test('a first input that is obscured is refused with no side effect on the input', async () => {
  // Arrange and Act
  const receipt = await focusRefusedAfterReturn('input-obscured')
  // Assert
  assert.deepEqual(receipt.progress().inputEffects, ['none'])
})

// protects=a focus that ran and did not land counts as a confirmed effect; fails_when=it stays none although element.focus() ran; no_claim=real focus semantics
test('a focus that ran but did not land is a confirmed effect on the input', async () => {
  // Arrange and Act
  const receipt = await focusRefusedAfterReturn('input-focus-changed')
  // Assert
  assert.deepEqual(receipt.progress().inputEffects, ['confirmed'])
})

// protects=a first input whose focus ran but did not land fails the click as partial, matching its confirmed effect; fails_when=the click is refused with SELECTOR_NOT_FOUND (side effects none) while the input effect reads confirmed; no_claim=real focus semantics
test('a first input whose focus ran but did not land fails the click with INPUT_PARTIAL', async () => {
  // Arrange
  const receipt = await focusRefusedAfterReturn('input-focus-changed')
  // Act
  const failure = await receipt.completed.then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'INPUT_PARTIAL')
})

// protects=a dialog opened while the second click's press is unanswered belongs to the second click even though the first declared nothing (the N61 flow); fails_when=the first click's missing declaration refuses it or the second click does not answer it; no_claim=real dialogs
test('a dialog opened during the second click press is accepted as the second click declares although the first declared nothing', async () => {
  // Arrange
  const gate = defer<Record<string, unknown>>()
  let isSecondClick = false
  const { executor, surface, events } = executorFor({
    'Input.dispatchMouseEvent': (params) =>
      isSecondClick && params.type === 'mouseReleased' ? gate.promise : {},
  })
  const first = await executor.run(CLICK)
  await first.completed
  isSecondClick = true
  // Act
  const second = executor.run({
    ...CLICK,
    index: 2,
    title: 'Confirm folder',
    selector: '#confirm',
    dialog: 'accept',
  })
  await waitUntil(
    () =>
      surface.sent.filter(
        (request) => request.method === 'Input.dispatchMouseEvent',
      ).length === 4,
    'the second click press is in flight',
  )
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm', message: 'Create the folder?' },
    SURFACE_SESSION,
  )
  await waitUntil(
    () => surface.methods().includes('Page.handleJavaScriptDialog'),
    'the second click answers the dialog',
  )
  gate.resolve({})
  await (
    await second
  ).completed
  // Assert
  assert.deepEqual(
    surface.sent
      .filter((request) => request.method === 'Page.handleJavaScriptDialog')
      .map((request) => request.params),
    [{ accept: true }],
  )
  assert.deepEqual(
    events.filter((event) => event.type === 'chrome-extension.dialog'),
    [
      {
        type: 'chrome-extension.dialog',
        detail: {
          clickIndex: 2,
          type: 'confirm',
          answer: 'accept',
          message: 'Create the folder?',
        },
      },
    ],
  )
  assert.equal(executor.lateDialogRefusal(), undefined)
})

// protects=a dialog a timer opens after the click settled is still answered and journaled with a masked message; fails_when=the listener is gone after the steps ended (the page stays blocked) or the message shows the private root; no_claim=real dialogs
test('a dialog opened after the click settled is answered as declared and journaled with the private root hidden', async () => {
  // Arrange
  const { executor, surface, events } = executorFor()
  const receipt = await executor.run({ ...CLICK, dialog: 'accept' })
  await receipt.completed
  // Act
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'alert', message: 'Saved /Users/ada/secret-repo/notes.md' },
    SURFACE_SESSION,
  )
  await waitUntil(
    () => surface.methods().includes('Page.handleJavaScriptDialog'),
    'the late dialog is answered',
  )
  // Assert
  const answered = surface.sent.filter(
    (request) => request.method === 'Page.handleJavaScriptDialog',
  )
  assert.deepEqual(
    answered.map((request) => request.params),
    [{ accept: true }],
  )
  assert.deepEqual(
    events.filter((event) => event.type === 'chrome-extension.dialog'),
    [
      {
        type: 'chrome-extension.dialog',
        detail: {
          clickIndex: 1,
          type: 'alert',
          answer: 'accept',
          message: 'Saved <workspace>/notes.md',
        },
      },
    ],
  )
})

// protects=dispose ends the dialog listener so a finished run answers nothing; fails_when=a dialog after dispose is still answered; no_claim=cleanup of the connection
test('a dialog opened after the run ended and the executor was disposed is not answered', async () => {
  // Arrange
  const { executor, surface } = executorFor()
  const receipt = await executor.run({ ...CLICK, dialog: 'accept' })
  await receipt.completed
  executor.dispose()
  // Act
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'alert' },
    SURFACE_SESSION,
  )
  // gstack-timing-ok: asserts a dialog is NOT answered after dispose, so a short fixed wait is the contract
  await sleep(10)
  // Assert
  assert.equal(surface.methods().includes('Page.handleJavaScriptDialog'), false)
})

// protects=an undeclared dialog opened after the click settled is reported to the run; fails_when=nothing tells the run that the page is blocked by an undeclared dialog; no_claim=that the dialog is dismissed
test('an undeclared dialog opened after the click settled is reported by lateDialogRefusal', async () => {
  // Arrange
  const { executor, surface } = executorFor()
  const receipt = await executor.run(CLICK)
  await receipt.completed
  // Act
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  await waitUntil(
    () => executor.lateDialogRefusal(),
    'the late undeclared dialog is reported',
  )
  // Assert
  const refusal = executor.lateDialogRefusal()
  assert.equal(refusal?.code, 'DIALOG_UNDECLARED')
  assert.equal(
    refusal?.message,
    'Click 1 opened a confirm dialog; declare dialog: accept or dismiss for it.',
  )
})

// protects=a dialog the extension opens before any click fails the run as DIALOG_UNDECLARED; fails_when=the dialog is left unanswered without a refusal, so the first click hangs on the blocked page and fails 20 s later as RUNTIME_FAILED with a retry that cannot help; no_claim=what opened the dialog in the extension
test('a dialog the extension opens before any click is refused as undeclared, journaled without a click and left unanswered', async () => {
  // Arrange
  const { executor, surface, events } = executorFor()
  // Act
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'alert', message: 'Welcome' },
    SURFACE_SESSION,
  )
  await waitUntil(
    () => executor.lateDialogRefusal(),
    'the dialog before any click is reported',
  )
  // Assert
  const refusal = executor.lateDialogRefusal()
  assert.equal(refusal?.code, 'DIALOG_UNDECLARED')
  assert.equal(
    refusal?.message,
    'The extension opened its own alert dialog before any click; only a dialog that a declared click opens can be answered.',
  )
  assert.equal(
    refusal?.describe().recovery,
    'Nothing was clicked or typed: the extension opened a JavaScript dialog by itself before the first click. Recovery: none in this run; the chat can explain this part from source. See codebook://help/chrome-extension#DIALOG_UNDECLARED.',
  )
  assert.deepEqual(events, [
    {
      type: 'chrome-extension.dialog',
      detail: { type: 'alert', answer: 'none', message: 'Welcome' },
    },
  ])
  assert.equal(surface.methods().includes('Page.handleJavaScriptDialog'), false)
})

/** Runs the given clicks to completion one after the other, then emits one late confirm dialog and waits until the run has reacted. */
async function lateConfirmAfter(clicks: ResolvedExtensionClick[]) {
  const harness = executorFor()
  for (const click of clicks)
    await (
      await harness.executor.run(click)
    ).completed
  harness.surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  // gstack-timing-ok: a refusal leaves no request to wait for, so the dialog event is given a short fixed time to be processed
  await sleep(20)
  return harness
}

// protects=a dialog with no click in progress after exactly one click is that click's; fails_when=the late dialog is answered differently from the click's declaration or not at all; no_claim=real dialogs
test('a late dialog after one click is dismissed as that click declares', async () => {
  // Arrange
  const clicks: ResolvedExtensionClick[] = [{ ...CLICK, dialog: 'dismiss' }]
  // Act
  const { surface, events } = await lateConfirmAfter(clicks)
  // Assert
  assert.deepEqual(
    surface.sent
      .filter((request) => request.method === 'Page.handleJavaScriptDialog')
      .map((request) => request.params),
    [{ accept: false }],
  )
  assert.deepEqual(
    events.map((event) => event.detail),
    [{ clickIndex: 1, type: 'confirm', answer: 'dismiss', message: '' }],
  )
})

// protects=a late dialog is not attributed by temporal proximity when the clicks disagree; fails_when=the later click's accept answers a dialog the first click may have opened, or the run is not told; no_claim=which click opened the dialog
test('a late dialog after a click without a declaration and a click that accepts is refused and left unanswered', async () => {
  // Arrange
  const clicks: ResolvedExtensionClick[] = [
    CLICK,
    { ...CLICK, index: 2, selector: '#confirm', dialog: 'accept' },
  ]
  // Act
  const { executor, surface, events } = await lateConfirmAfter(clicks)
  // Assert
  assert.equal(surface.methods().includes('Page.handleJavaScriptDialog'), false)
  const refusal = executor.lateDialogRefusal()
  assert.equal(refusal?.code, 'DIALOG_UNDECLARED')
  assert.equal(
    refusal?.message,
    'A confirm dialog opened while no click was in progress and clicks 1 and 2 declare different answers; declare the same dialog answer for them.',
  )
  assert.deepEqual(
    events.map((event) => event.detail),
    [{ clickIndex: 2, type: 'confirm', answer: 'none', message: '' }],
  )
})

// protects=clicks that agree on the dialog answer answer a late dialog; fails_when=agreement is not enough and the page stays blocked; no_claim=which click opened the dialog
test('a late dialog after two clicks that both declare dismiss is dismissed for the latest click', async () => {
  // Arrange
  const clicks: ResolvedExtensionClick[] = [
    { ...CLICK, dialog: 'dismiss' },
    { ...CLICK, index: 2, selector: '#confirm', dialog: 'dismiss' },
  ]
  // Act
  const { executor, surface, events } = await lateConfirmAfter(clicks)
  // Assert
  assert.deepEqual(
    surface.sent
      .filter((request) => request.method === 'Page.handleJavaScriptDialog')
      .map((request) => request.params),
    [{ accept: false }],
  )
  assert.deepEqual(
    events.map((event) => event.detail),
    [{ clickIndex: 2, type: 'confirm', answer: 'dismiss', message: '' }],
  )
  assert.equal(executor.lateDialogRefusal(), undefined)
})

// protects=an undeclared dialog during a click's own press refuses that click; fails_when=the dialog is answered or refused for another click; no_claim=that the dialog is closed afterwards
test('an undeclared dialog during the first click press is refused for the first click', async () => {
  // Arrange
  const gate = defer<Record<string, unknown>>()
  const { executor, surface } = executorFor({
    'Input.dispatchMouseEvent': (params) =>
      params.type === 'mouseReleased' ? gate.promise : {},
  })
  // Act
  const call = executor.run(CLICK)
  await waitUntil(
    () => surface.methods().includes('Input.dispatchMouseEvent'),
    'the first click press is in flight',
  )
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  // Assert
  await assert.rejects(
    call,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'DIALOG_UNDECLARED' &&
      error.message ===
        'Click 1 opened a confirm dialog; declare dialog: accept or dismiss for it.',
  )
  assert.equal(surface.methods().includes('Page.handleJavaScriptDialog'), false)
})

// protects=a call already decided as paused arms no return or settle timer afterwards; fails_when=the click's timers are armed after the pause decided the call; no_claim=timing of the outcome
test('a click whose call returned paused during an input arms no return or settle timer for the press', async () => {
  // Arrange
  const answerFocus = defer<Record<string, unknown>>()
  const { executor, surface, pauses } = executorFor(
    {
      'Runtime.callFunctionOn': (params) =>
        params.arguments && inspectionPhase(params) === 'focus'
          ? answerFocus.promise
          : {
              result: { value: { ready: true, x: 1, y: 1 } },
            },
    },
    { returnBoundMs: 4_321, settleMs: 8_765 },
  )
  const delays: unknown[] = []
  const realSetTimeout = globalThis.setTimeout
  mock.method(
    globalThis,
    'setTimeout',
    (...args: Parameters<typeof setTimeout>) => {
      delays.push(args[1])
      return realSetTimeout(...args)
    },
  )
  try {
    const call = executor.run({
      ...CLICK,
      inputs: [{ selector: '#name', text: 'a' }],
    })
    await requestSent(surface, 'Runtime.callFunctionOn')
    openDeclaredPause(pauses)
    const receipt = await call
    // Act
    answerFocus.resolve({ result: { value: { ready: true } } })
    await receipt.completed
    // Assert
    assert.equal(receipt.outcome, 'paused')
    assert.deepEqual(
      delays.filter((delay) => delay === 4_321 || delay === 8_765),
      [],
    )
  } finally {
    mock.restoreAll()
  }
})

// protects=a journal that throws while a dialog is answered never becomes an unhandled rejection and is itself journaled masked and root-hidden; fails_when=the throw escapes the listener or the debugger-error is missing or unmasked; no_claim=what the run does with the journal afterwards
test('a journal failure while answering a dialog is recorded as a masked debugger error instead of an unhandled rejection', async () => {
  // Arrange
  const recorded: Array<{ type: string; detail: unknown }> = []
  let shouldThrow = true
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  const gate = defer<Record<string, unknown>>()
  const { executor, surface } = executorFor(
    {
      'Input.dispatchMouseEvent': (params) =>
        params.type === 'mouseReleased' ? gate.promise : {},
    },
    {
      record: (type, detail) => {
        if (shouldThrow) {
          shouldThrow = false
          throw new Error(
            'disk full at /Users/ada/secret-repo/out.log token Bearer abcdefghijklmnop1234567890',
          )
        }
        recorded.push({ type, detail })
      },
    },
  )
  try {
    // Act
    const call = executor.run({ ...CLICK, dialog: 'accept' })
    await waitUntil(
      () =>
        surface.sent.some(
          (request) =>
            request.method === 'Input.dispatchMouseEvent' &&
            request.params.type === 'mouseReleased',
        ),
      'the mouse release is in flight',
    )
    surface.emit(
      'Page.javascriptDialogOpening',
      { type: 'confirm' },
      SURFACE_SESSION,
    )
    await waitUntil(() => recorded.length > 0, 'the debugger error is recorded')
    // The declared answer is still sent although the journal threw.
    await waitUntil(
      () =>
        surface.sent.some(
          (request) => request.method === 'Page.handleJavaScriptDialog',
        ),
      'the declared dialog answer is sent',
    )
    gate.resolve({})
    await (
      await call
    ).completed
    // gstack-timing-ok: asserts nothing is raised later, so a short fixed wait lets a stray rejection surface
    await sleep(20)
    // Assert
    assert.equal(recorded[0]?.type, 'chrome-extension.debugger-error')
    const { message } = recorded[0]?.detail as { message: string }
    assert.equal(message.includes('/Users/ada/secret-repo'), false)
    assert.equal(message.includes('abcdefghijklmnop1234567890'), false)
    assert.deepEqual(
      surface.sent
        .filter((request) => request.method === 'Page.handleJavaScriptDialog')
        .map((request) => request.params),
      [{ accept: true }],
    )
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
