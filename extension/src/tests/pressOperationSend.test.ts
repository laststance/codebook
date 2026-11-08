import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import {
  OperationRefusal,
  prepareOperation,
  type OperationPort,
  type OperationSendHooks,
} from '../configuredOperations'
import { PRESS_RELEASE_TIMEOUT_MS } from '../constants'
import type { Cdp } from '../runtimeSupport/cdp'
import { describePressRefusal } from '../utils/describePressRefusal'

/** What the fake page reports of the focused element: the body, which takes keys. */
const BODY_READING = {
  ready: true,
  tagName: 'body',
  type: '',
  name: '',
  id: '',
  autocomplete: '',
  isTextEntry: false,
  isInFrame: false,
  isFocused: true,
}

type KeyRequest = { type: string; timeoutMs: number | undefined }

/** A fake page channel: answers the focus read with `reading` and records every key request, failing the ones `failOn` names. */
function fakePage(options: {
  reading?: () => Record<string, unknown>
  keyDownGate?: Promise<void>
  failOn?: 'keyDown' | 'keyUp'
  /** Called when a key request is received, before it is answered. */
  onKeyRequest?: (type: string) => void
}) {
  const keyRequests: KeyRequest[] = []
  const cdp = {
    request: async (
      method: string,
      params: { type?: string },
      timeoutMs?: number,
    ) => {
      if (method === 'Runtime.evaluate')
        return {
          result: { value: (options.reading ?? (() => BODY_READING))() },
        }
      keyRequests.push({ type: String(params.type), timeoutMs })
      options.onKeyRequest?.(String(params.type))
      if (params.type === 'keyDown') await options.keyDownGate
      if (params.type === options.failOn) throw new Error('transport lost')
      return {}
    },
  } as unknown as Cdp
  return { cdp, keyRequests }
}

/** Builds the port a run gives the engine; `isPaused` is read live, `assertCurrent` may be told to throw. */
function portOf(
  cdp: Cdp,
  state: { isPaused: () => boolean; isCancelled?: () => boolean },
): OperationPort {
  return {
    pageCdp: async () => cdp,
    origins: () => ['http://127.0.0.1:1'],
    assertCurrent: (): void => {
      if (state.isCancelled?.()) throw new Error('The run was cancelled.')
    },
    millisecondsSinceNavigation: () => Number.POSITIVE_INFINITY,
    isPagePaused: () => state.isPaused(),
    sleep: async (): Promise<void> => {},
    readClickPoint: async () => ({ x: 0, y: 0 }),
  }
}

/** Records the moments of one operation's input. */
function recordingHooks(): { moments: string[]; hooks: OperationSendHooks } {
  const moments: string[] = []
  return {
    moments,
    hooks: {
      beforeInput: () => moments.push('before-input'),
      acknowledged: () => moments.push('acknowledged'),
      valueChecked: () => moments.push('value-checked'),
    },
  }
}

const PRESS = {
  kind: 'press',
  title: 'Open palette',
  key: 'Control+k',
} as const

// Value: protects=a key press is a keyDown then one keyUp, and the run is told of the input before the key and of the acknowledgement after the release; fails_when=the order changes, a text field appears on a chord, or the acknowledgement comes before keyUp returns; no_claim=what a real page receives (pressOperation.test.ts)
test('a press sends keyDown, then keyUp, and acknowledges only after keyUp returned', async () => {
  // Arrange
  const page = fakePage({})
  const recorded = recordingHooks()
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  await prepared.send(recorded.hooks)
  // Assert
  assert.deepEqual(
    page.keyRequests.map((request) => request.type),
    ['keyDown', 'keyUp'],
  )
  assert.deepEqual(recorded.moments, ['before-input', 'acknowledged'])
})

// Value: protects=keyUp follows only a returned keyDown, so a stop inside the key handler (E1b) never gets a second event while it holds the page; fails_when=keyUp is sent while the keyDown call is still pending; no_claim=the stop itself (real Chrome pause test)
test('a press sends keyUp only after the pending keyDown call returned', async () => {
  // Arrange
  let openGate = (): void => {}
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const page = fakePage({ keyDownGate: gate })
  const recorded = recordingHooks()
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  const sending = prepared.send(recorded.hooks)
  await new Promise((resolve) => setImmediate(resolve))
  const typesWhilePending = page.keyRequests.map((request) => request.type)
  openGate()
  await sending
  // Assert
  assert.deepEqual(typesWhilePending, ['keyDown'])
  assert.deepEqual(
    page.keyRequests.map((request) => request.type),
    ['keyDown', 'keyUp'],
  )
})

// Value: protects=the release waits until the page runs again, so a key sent into a paused page is not lost; fails_when=keyUp is sent while the run's browser pause state holds; no_claim=the pause state itself (run tests)
test('a press holds keyUp while the page is paused and sends it once the page runs', async () => {
  // Arrange
  let isAfterKeyDown = false
  let pausedReads = 0
  const readsAtKeyUp: number[] = []
  const page = fakePage({
    onKeyRequest: (type) => {
      if (type === 'keyDown') isAfterKeyDown = true
      if (type === 'keyUp') readsAtKeyUp.push(pausedReads)
    },
  })
  const prepared = await prepareOperation(
    portOf(page.cdp, {
      // Running before keyDown; paused for the first three reads after it.
      isPaused: () => {
        if (!isAfterKeyDown) return false
        pausedReads += 1
        return pausedReads <= 3
      },
    }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  await prepared.send(recordingHooks().hooks)
  // Assert
  assert.deepEqual(readsAtKeyUp, [4])
})

// Value: protects=a press is never sent into a paused page, where the key is acknowledged and lost; fails_when=a paused page receives keyDown or the run is told the input began; no_claim=how the run reads its pause state
test('a press into a paused page is refused with nothing sent', async () => {
  // Arrange
  const page = fakePage({})
  const recorded = recordingHooks()
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => true }),
    { index: 2, total: 2, operation: PRESS },
  )
  // Act
  const failure = await prepared.send(recorded.hooks).catch((error) => error)
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.code, 'RUN_FAILED_UNEXPECTEDLY')
  assert.equal(failure.sent, 'not-sent')
  assert.equal(
    failure.message,
    'Operation 2 (Open palette) was not sent: the page was paused at the press.',
  )
  assert.deepEqual(page.keyRequests, [])
  assert.deepEqual(recorded.moments, [])
})

// Value: protects=a failed keyDown is released once with a short bound and the original error reaches the run; fails_when=no release is tried, the release uses the run's long bound, or the error is replaced; no_claim=the browser's handling of the late keyUp
test('a failed keyDown is released by one keyUp with the release bound and rethrown', async () => {
  // Arrange
  const page = fakePage({ failOn: 'keyDown' })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  const failure = await prepared
    .send(recordingHooks().hooks)
    .catch((error) => error)
  // Assert
  assert.equal(failure.message, 'transport lost')
  assert.deepEqual(page.keyRequests, [
    { type: 'keyDown', timeoutMs: 600_000 },
    { type: 'keyUp', timeoutMs: PRESS_RELEASE_TIMEOUT_MS },
  ])
})

// Value: protects=at most one keyUp is ever issued, because a second keyup can toggle a keyup shortcut twice; fails_when=a failed keyUp is repeated; no_claim=whether the page saw the first keyUp
test('a failed keyUp is never repeated', async () => {
  // Arrange
  const page = fakePage({ failOn: 'keyUp' })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  await prepared.send(recordingHooks().hooks).catch(() => {})
  // Assert
  assert.deepEqual(
    page.keyRequests.map((request) => request.type),
    ['keyDown', 'keyUp'],
  )
})

// Value: protects=a cancelled run sends no release; fails_when=keyUp is tried after the run was cancelled; no_claim=the browser teardown
test('a failed press sends no release when the run was cancelled', async () => {
  // Arrange
  let isCancelled = false
  const page = fakePage({
    failOn: 'keyDown',
    onKeyRequest: () => {
      isCancelled = true
    },
  })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false, isCancelled: () => isCancelled }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  const failure = await prepared
    .send(recordingHooks().hooks)
    .catch((error) => error)
  // Assert
  assert.equal(failure.message, 'The run was cancelled.')
  assert.deepEqual(
    page.keyRequests.map((request) => request.type),
    ['keyDown'],
  )
})

// Value: protects=no release is sent into a paused page, where it would be acknowledged and lost; fails_when=a failed press tries keyUp while the page is paused; no_claim=what the pause is
test('a failed press sends no release while the page is paused', async () => {
  // Arrange
  let isPaused = false
  const page = fakePage({
    failOn: 'keyDown',
    onKeyRequest: () => {
      isPaused = true
    },
  })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => isPaused }),
    { index: 1, total: 1, operation: PRESS },
  )
  // Act
  await prepared.send(recordingHooks().hooks).catch(() => {})
  // Assert
  assert.deepEqual(
    page.keyRequests.map((request) => request.type),
    ['keyDown'],
  )
})

// Value: protects=a key never goes to a control other than the one classified at preparation; fails_when=focus moved between the check and the send and the key is still sent; no_claim=real focus handlers (real Chrome tests)
test('a press is refused with nothing sent when focus moved since the check', async () => {
  // Arrange
  let reading: Record<string, unknown> = BODY_READING
  const page = fakePage({ reading: () => reading })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 3, total: 3, operation: PRESS },
  )
  reading = { ...BODY_READING, tagName: 'button', id: 'go' }
  // Act
  const failure = await prepared
    .send(recordingHooks().hooks)
    .catch((error) => error)
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.reason, 'press-focus-changed')
  assert.equal(failure.path, 'operations[2]')
  assert.equal(failure.sent, 'not-sent')
  assert.deepEqual(page.keyRequests, [])
})

// Value: protects=refusal messages name an element by tag, type, id and name only, cut at 64 characters, and carry the path to fix; fails_when=a value or text leaks, a long attribute is not cut, or a path is wrong; no_claim=the page's attributes (real Chrome tests)
test('press refusal messages name elements without values and point at the field to fix', () => {
  // Arrange
  const longId = 'x'.repeat(80)
  // Act
  const secret = describePressRefusal('press-secret-control', {
    index: 2,
    title: 'Open',
    element: { tagName: 'input', type: 'password', id: longId, name: '' },
    classification: 'type=password',
  })
  const alreadyHolds = describePressRefusal('press-after-already-holds', {
    index: 1,
    title: 'Open',
    element: { tagName: 'body' },
  })
  const notFocusable = describePressRefusal('press-target-not-focusable', {
    index: 1,
    title: 'Open',
    selector: '#panel',
    element: { tagName: 'div', id: 'panel' },
  })
  // Assert
  assert.equal(
    secret.message,
    `Operation 2 (Open) was not sent: the key would go to <input type="password" id="${'x'.repeat(64)}">, which reads as a secret control (type=password). A key never goes to a secret control: click the submit control, or use secret: "ask-learner" on a text operation.`,
  )
  assert.equal(secret.path, 'operations[1]')
  assert.equal(alreadyHolds.path, 'operations[0].after')
  assert.equal(notFocusable.path, 'operations[0].selector')
  assert.equal(
    notFocusable.message,
    'Operation 1 (Open) was not sent: #panel names <div id="panel">, which cannot take focus. Omit selector to send the key to the page, or name a focusable element.',
  )
})

// Value: protects=a press without a selector on a page that left the application's origin is worded as the page's problem at the operation path; fails_when=the sentence prints an undefined selector or points at operations[k].selector; no_claim=the real origin check (real Chrome tests)
test('a press on a page outside the application origin is refused without naming a selector', async () => {
  // Arrange
  const page = fakePage({
    reading: () => ({ ready: false, reason: 'wrong-origin' }),
  })
  // Act
  const failure = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 2, total: 2, operation: PRESS },
  ).catch((error) => error)
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(
    failure.message,
    "Operation 2 (Open palette) was not sent: the page left the application's origin (wrong-origin).",
  )
  assert.equal(failure.path, 'operations[1]')
  assert.deepEqual(page.keyRequests, [])
})

// Value: protects=a refusal names the shadow host when it differs from the recipient, still without a value; fails_when=the host is dropped from the sentence or a value appears; no_claim=the page's shadow tree detection (real Chrome tests)
test('a secret control inside a shadow host is refused naming the host', () => {
  // Arrange
  const element = { tagName: 'input', type: 'password', hostTagName: 'x-field' }
  // Act
  const refusal = describePressRefusal('press-secret-control', {
    index: 1,
    title: 'Open',
    element,
    classification: 'type=password',
  })
  // Assert
  assert.equal(
    refusal.message,
    'Operation 1 (Open) was not sent: the key would go to <input type="password"> inside <x-field>, which reads as a secret control (type=password). A key never goes to a secret control: click the submit control, or use secret: "ask-learner" on a text operation.',
  )
})

const PRESS_WITH_SELECTOR = {
  kind: 'press',
  title: 'Open palette',
  key: 'Control+k',
  selector: '#opener',
} as const

/** The refusal a run's `beforeKey` hook raises when the press's own after already holds. */
function afterAlreadyHolds(): OperationRefusal {
  return new OperationRefusal(
    'INPUT_NOT_ACCEPTED',
    'The after already holds.',
    {
      operationIndex: 1,
      path: 'operations[0].after',
      reason: 'press-after-already-holds',
    },
  )
}

/** Prepares a press on a fake body page and sends it with the hooks, returning what it threw. */
async function sendFailureOf(
  operation: typeof PRESS | typeof PRESS_WITH_SELECTOR,
  hooks: OperationSendHooks,
  state: { isPaused: () => boolean } = { isPaused: () => false },
) {
  const prepared = await prepareOperation(portOf(fakePage({}).cdp, state), {
    index: 1,
    total: 1,
    operation,
  })
  return prepared.send(hooks).catch((error) => error)
}

// Value: protects=B2: the press's own after is read again after the send-time focus step, before any key, so a focus handler that satisfies it cannot let an ignored key pass as verified; fails_when=the key is sent although the beforeKey hook refused, or the input moment is reported; no_claim=the run's reading of the conditions (pressOperationRun.test.ts)
test('a press whose after holds once its target took focus sends no key and reports no input', async () => {
  // Arrange
  const page = fakePage({})
  const recorded = recordingHooks()
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS_WITH_SELECTOR },
  )
  // Act
  const failure = await prepared
    .send({
      ...recorded.hooks,
      beforeKey: async () => {
        throw afterAlreadyHolds()
      },
    })
    .catch((error) => error)
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.reason, 'press-after-already-holds')
  assert.deepEqual(page.keyRequests, [])
  assert.deepEqual(recorded.moments, [])
})

// Value: protects=B4: once the send-time focus step ran on a declared target (the app's focus handlers executed), a refusal still sent no key but reports side effects unknown; fails_when=the refusal claims side effects none after the focus step, or turns unknown for a press that never focused anything; no_claim=which refusals the page raises
test('a refusal after the focus step of a declared selector reports side effects unknown, and none without a selector', async () => {
  // Arrange
  const hooks: OperationSendHooks = {
    ...recordingHooks().hooks,
    beforeKey: async () => {
      throw afterAlreadyHolds()
    },
  }
  // Act
  const withSelector = await sendFailureOf(PRESS_WITH_SELECTOR, hooks)
  const withoutSelector = await sendFailureOf(PRESS, hooks)
  // Assert
  assert.deepEqual(
    [withSelector.sent, withSelector.sideEffects],
    ['not-sent', 'unknown'],
  )
  assert.deepEqual(
    [withoutSelector.sent, withoutSelector.sideEffects],
    ['not-sent', 'none'],
  )
})

// Value: protects=B4: a page paused right before the key, after the focus step, is refused with side effects unknown; fails_when=the late pause claims none although the focus handlers ran; no_claim=the run's pause state
test('a pause that begins after the focus step reports side effects unknown', async () => {
  // Arrange
  let pauseReads = 0
  // The check at the start of the send passes; the guard right before the key sees the pause.
  const isPaused = (): boolean => {
    pauseReads += 1
    return pauseReads >= 2
  }
  // Act
  const failure = await sendFailureOf(
    PRESS_WITH_SELECTOR,
    recordingHooks().hooks,
    { isPaused },
  )
  // Assert
  assert.equal(failure.code, 'RUN_FAILED_UNEXPECTEDLY')
  assert.deepEqual([failure.sent, failure.sideEffects], ['not-sent', 'unknown'])
})

// Value: protects=L3: a page that is paused when the press is sent is refused before the focus read, which would wait for the request timeout on a paused page; fails_when=the focus read is still issued on a paused page; no_claim=the wording of the refusal
test('a press into a page paused before the send issues no focus read', async () => {
  // Arrange
  let isPaused = false
  let focusReads = 0
  const page = fakePage({
    reading: () => {
      focusReads += 1
      return BODY_READING
    },
  })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => isPaused }),
    { index: 1, total: 1, operation: PRESS },
  )
  isPaused = true
  // Act
  const failure = await prepared
    .send(recordingHooks().hooks)
    .catch((error) => error)
  // Assert
  assert.equal(failure.code, 'RUN_FAILED_UNEXPECTEDLY')
  assert.deepEqual([failure.sent, failure.sideEffects], ['not-sent', 'none'])
  assert.equal(focusReads, 1)
})

// Value: protects=L2: an unready reading with a reason no rule lists never falls through to a send; fails_when=a key is sent although the page said the target is not ready; no_claim=the reasons the page can give
test('a press is refused as an unusable target when the page reports not ready with an unlisted reason', async () => {
  // Arrange
  const page = fakePage({
    reading: () => ({ ...BODY_READING, ready: false, reason: 'unlisted' }),
  })
  // Act
  const failure = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS },
  ).catch((error) => error)
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.code, 'INPUT_NOT_ACCEPTED')
  assert.equal(failure.reason, undefined)
  assert.equal(failure.path, 'operations[0]')
  assert.deepEqual(page.keyRequests, [])
})

// Value: protects=B3: a recipient the page says is another element than the classified one is refused as moved focus although every attribute matches; fails_when=an attribute-identical other element receives the key; no_claim=how the page decides identity (pressOperation.test.ts, real Chrome)
test('a press is refused when the page reports another recipient with the same attributes', async () => {
  // Arrange
  let isSend = false
  const page = fakePage({
    reading: () =>
      isSend ? { ...BODY_READING, isSameRecipient: false } : BODY_READING,
  })
  const prepared = await prepareOperation(
    portOf(page.cdp, { isPaused: () => false }),
    { index: 1, total: 1, operation: PRESS },
  )
  isSend = true
  // Act
  const failure = await prepared
    .send(recordingHooks().hooks)
    .catch((error) => error)
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.reason, 'press-focus-changed')
  assert.deepEqual(page.keyRequests, [])
})

// Value: protects=L4: the wait for a paused page ends by elapsed time, so slow polls cannot stretch the bound past the run timeout; fails_when=the wait counts nominal poll intervals and keeps polling after the clock passed the bound; no_claim=the wait before the first poll
test('a key release waiting on a paused page gives up by elapsed time, not by counted polls', async () => {
  // Arrange
  let nowMs = 0
  let sleeps = 0
  let isAfterKeyDown = false
  const clock = mock.method(performance, 'now', () => nowMs)
  const page = fakePage({
    onKeyRequest: (type) => {
      if (type === 'keyDown') isAfterKeyDown = true
    },
  })
  const port: OperationPort = {
    ...portOf(page.cdp, { isPaused: () => isAfterKeyDown }),
    sleep: async (): Promise<void> => {
      sleeps += 1
      // Each real poll takes far longer than its nominal interval.
      nowMs += 400_000
    },
  }
  const prepared = await prepareOperation(port, {
    index: 1,
    total: 1,
    operation: PRESS,
  })
  // Act
  const failure = await prepared
    .send(recordingHooks().hooks)
    .catch((error) => error)
  clock.mock.restore()
  // Assert
  assert.equal(
    failure.message,
    'The page stayed paused before the key was released.',
  )
  assert.equal(sleeps, 2)
})
