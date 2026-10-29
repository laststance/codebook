import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { createChromeExtensionActionExecutor } from '../chromeExtensionActionExecutor'
import type { ResolvedExtensionClick } from '../chromeExtensionContracts'
import { ExtensionPauseSet } from '../chromeExtensionPauseSet'
import { StudyError } from '../errors'

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
    record: (type, detail) => events.push({ type, detail }),
    stepTimeoutMs: options.stepTimeoutMs ?? 2_000,
    returnBoundMs: options.returnBoundMs ?? 2_000,
    settleMs: options.settleMs ?? 10,
  })
  return { executor, surface, pauses, events }
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
    { stepTimeoutMs: 40 },
  )
  const click: ResolvedExtensionClick = {
    ...CLICK,
    inputs: [{ selector: '#name', text: 'a' }],
  }
  // Act
  const call = executor.run(click)
  await sleep(10)
  const pause = openDeclaredPause(pauses)
  const receipt = await call
  await sleep(150)
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
    { returnBoundMs: 30 },
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
  await sleep(20)
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  await sleep(5)
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
      detail: { clickIndex: 1, type: 'confirm', answer: 'accept' },
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
  await sleep(20)
  surface.emit(
    'Page.javascriptDialogOpening',
    { type: 'confirm' },
    SURFACE_SESSION,
  )
  await sleep(5)
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
  await sleep(20)
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
