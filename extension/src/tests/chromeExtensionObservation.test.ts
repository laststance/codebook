import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ExtensionObservation } from '../chromeExtensionContracts'
import {
  buildExtensionObserved,
  createExtensionObservationReader,
  extensionObservationResult,
  observeAfterLastClick,
} from '../chromeExtensionObservation'
import { ExtensionPauseSet } from '../chromeExtensionPauseSet'
import { maskExtensionObservedRead } from '../utils/maskExtensionObservedRead'

import {
  fakeExtensionSurface,
  type SurfaceAnswers,
} from './utils/fakeExtensionSurface'

/** Builds a reader over a fake surface with the given answers. */
function readerOf(
  observe: ExtensionObservation,
  answers: SurfaceAnswers,
  options: {
    limitBytes?: number
    depthLimit?: number
    readTimeoutMs?: number
  } = {},
) {
  const surface = fakeExtensionSurface(answers)
  const reader = createExtensionObservationReader({
    cdp: surface.connection,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    observe,
    surfaceSessionId: () => 'surface-session',
    ...options,
  })
  return { reader, surface }
}

// Value: protects=CR13: the declared selector reaches the page as one JSON string literal, so quotes, backticks, template openers and a script end tag cannot break out; fails_when=the selector is spliced into the expression unescaped; no_claim=how the page treats the selector
test('encodes a selector with quotes, a backtick, a template opener and a script end tag as one JSON literal', async () => {
  // Arrange
  const selector = `a[title='x'] \`b\` \${c} </script>`
  const { reader, surface } = readerOf(
    { kind: 'text', selector },
    { 'Runtime.evaluate': () => ({ result: { value: { text: 'ok' } } }) },
  )
  // Act
  const read = await reader.read()
  // Assert
  assert.deepEqual(read, { value: 'ok' })
  assert.equal(
    String(surface.sent[0]?.params.expression).includes(
      `document.querySelector(${JSON.stringify(selector)})`,
    ),
    true,
  )
})

// Value: protects=CR9, ER23: an element that is not there reads missing, which is not an empty text and not a failure; fails_when=a missing element reads as '' or unavailable; no_claim=text of an existing element
test('reads a missing element as missing, not as empty text', async () => {
  // Arrange
  const { reader } = readerOf(
    { kind: 'text', selector: '#none' },
    { 'Runtime.evaluate': () => ({ result: { value: { missing: true } } }) },
  )
  // Act
  const read = await reader.read()
  // Assert
  assert.deepEqual(read, { missing: true })
})

// Value: protects=CR9, ER26: a storage observation reads the declared key through Extensions.getStorageItems on the surface session, and a key that is absent reads missing while a stored null is a value; fails_when=absent and null are confused or the read uses another method; no_claim=the real storage (real Chrome test)
test('reads storage by key, telling an absent key from a stored null', async () => {
  // Arrange
  const stored: Record<string, unknown> = { present: null }
  const answers: SurfaceAnswers = {
    'Extensions.getStorageItems': () => ({ data: stored }),
  }
  const present = readerOf({ kind: 'storage', key: 'present' }, answers)
  const absent = readerOf({ kind: 'storage', key: 'absent' }, answers)
  // Act
  const [presentRead, absentRead] = [
    await present.reader.read(),
    await absent.reader.read(),
  ]
  // Assert
  assert.deepEqual(
    [presentRead, absentRead],
    [{ value: null }, { missing: true }],
  )
  assert.deepEqual(present.surface.sent[0], {
    method: 'Extensions.getStorageItems',
    params: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      storageArea: 'local',
      keys: ['present'],
    },
    sessionId: 'surface-session',
  })
})

// Value: protects=CR9: the popup observation asks chrome.action.getPopup in the surface page and waits for its promise; fails_when=the expression or awaitPromise differs; no_claim=the popup value on a real Chrome (real Chrome test)
test('reads the popup through chrome.action.getPopup evaluated in the surface page', async () => {
  // Arrange
  const { reader, surface } = readerOf(
    { kind: 'popup' },
    {
      'Runtime.evaluate': () => ({
        result: { value: 'chrome-extension://abc/popup.html' },
      }),
    },
  )
  // Act
  const read = await reader.read()
  // Assert
  assert.deepEqual(read, { value: 'chrome-extension://abc/popup.html' })
  assert.deepEqual(
    [surface.sent[0]?.params.expression, surface.sent[0]?.params.awaitPromise],
    ['chrome.action.getPopup({})', true],
  )
})

// Value: protects=ER23: a value over the byte limit or the depth limit reads unavailable with the fixed cause; fails_when=a large value is reported or the cause differs; no_claim=the 64 KiB value
test('reads a value over the byte or depth limit as larger than the read limit', async () => {
  // Arrange
  const tooLong = readerOf(
    { kind: 'text', selector: '#a' },
    {
      'Runtime.evaluate': () => ({
        result: { value: { text: 'x'.repeat(50) } },
      }),
    },
    { limitBytes: 10 },
  )
  const tooDeep = readerOf(
    { kind: 'storage', key: 'k' },
    {
      'Extensions.getStorageItems': () => ({
        data: { k: { a: { b: { c: 1 } } } },
      }),
    },
    { depthLimit: 2 },
  )
  // Act
  const reads = [await tooLong.reader.read(), await tooDeep.reader.read()]
  // Assert
  assert.deepEqual(reads, [
    { unavailable: true, cause: 'larger than the read limit' },
    { unavailable: true, cause: 'larger than the read limit' },
  ])
})

// Value: protects=ER9: a read that never answers is cut at its own timeout and counts as a failed read; fails_when=the read waits forever; no_claim=the 2 s default
test('a read that never answers fails at its timeout instead of waiting', async () => {
  // Arrange
  const { reader } = readerOf(
    { kind: 'text', selector: '#a' },
    { 'Runtime.evaluate': () => new Promise<never>(() => undefined) },
    { readTimeoutMs: 40 },
  )
  // Act
  const read = await reader.read()
  // Assert
  assert.deepEqual(read, {
    unavailable: true,
    cause: 'the read did not answer within 40 ms',
  })
})

// Value: protects=ER9 after a lost surface: the storage read's own extension page (Target.createTarget) that never answers is cut at the read timeout, so SURFACE_LOST is not held back until the run deadline (CodeRabbit pt2 round 4); fails_when=the fallback read waits forever on a browser that does not answer; no_claim=a real Chrome's answer times
test('a storage read after the surface is lost fails at its timeout when its extension page never opens', async () => {
  // Arrange
  const surface = fakeExtensionSurface({
    'Target.createTarget': () => new Promise<never>(() => undefined),
  })
  const reader = createExtensionObservationReader({
    cdp: surface.connection,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    observe: { kind: 'storage', key: 'seeded' },
    surfaceSessionId: () => undefined,
    readTimeoutMs: 40,
  })
  // Act
  const read = await reader.read()
  // Assert
  assert.deepEqual(read, {
    unavailable: true,
    cause: 'the read did not answer within 40 ms',
  })
})

// Value: protects=CR9: a value that never holds still for two reads within the bound reads unavailable instead of an arbitrary last value; fails_when=the last changing value is reported as the result; no_claim=the 5 s bound
test('a result that keeps changing within the bound reads unavailable', async () => {
  // Arrange
  let counter = 0
  const controller = new AbortController()
  // Act
  const after = await observeAfterLastClick({
    read: async () => ({ value: `v${counter++}` }),
    pauseState: new ExtensionPauseSet(),
    signal: controller.signal,
    settleMs: 5,
    pollMs: 5,
    boundMs: 60,
  })
  // Assert
  assert.equal('unavailable' in after, true)
  assert.equal(
    'unavailable' in after ? after.cause : '',
    'the result kept changing for 60 ms',
  )
})

// Value: protects=SR23: the settle timer does not run while a stop is paused and starts anew when it ends, so the first read comes a full quiet time after the pause ended; fails_when=the timer keeps running under the pause and a read starts at once when it ends; no_claim=the debugger's pause set
test('the first read comes a full quiet time after the last pause ended', async () => {
  // Arrange
  const pauses = new ExtensionPauseSet()
  const pause = pauses.open({
    sessionId: 's',
    threadId: 1,
    context: 'page',
    reason: 'breakpoint',
    kind: 'declared',
    stopIndex: 1,
    status: 'captured',
    pausedAtMs: 0,
  })
  const settleMs = 120
  let firstReadAtMs: number | undefined
  const observation = observeAfterLastClick({
    read: async () => {
      firstReadAtMs ??= performance.now()
      return { value: 'same' }
    },
    pauseState: pauses,
    signal: new AbortController().signal,
    settleMs,
    pollMs: 5,
  })
  // Act
  await new Promise((resolve) => setTimeout(resolve, settleMs + 80))
  const firstReadWhilePaused = firstReadAtMs
  const pauseEndedAtMs = performance.now()
  pauses.close(pause.sessionId, pause.threadId)
  const after = await observation
  // Assert
  assert.equal(firstReadWhilePaused, undefined)
  // gstack-timing-ok: a lower bound only (a timer never fires early), so a slow runner cannot fail it
  assert.equal((firstReadAtMs ?? 0) - pauseEndedAtMs >= settleMs - 10, true)
  assert.deepEqual(after, { value: 'same' })
})

// Value: protects=ER23: reported values hide secret-like members whole, hide private roots and cut at 4,096 characters with truncated; fails_when=a token member, a home path or a long text reaches the report; no_claim=masking of text inside other contexts
test('masks secret-like members, hides private roots and cuts long values at 4,096 characters', () => {
  // Arrange
  const roots = { storage: [], home: ['/Users/ada'] }
  // Act
  const masked = maskExtensionObservedRead(
    {
      value: {
        accessToken: 'abc',
        note: 'saved in /Users/ada/work',
        apiKey: 'k',
      },
    },
    roots,
  )
  const cut = maskExtensionObservedRead({ value: 'y'.repeat(5_000) }, roots)
  // Assert
  assert.deepEqual(masked, {
    value: {
      accessToken: '[masked]',
      note: 'saved in ~/work',
      apiKey: '[masked]',
    },
  })
  assert.deepEqual(cut, { value: 'y'.repeat(4_096), truncated: true })
})

// Value: protects=ER23, DXR7: changed is decided on the unmasked values, so two different secrets read changed although both report masked; fails_when=changed compares the masked reports; no_claim=the secret values themselves
test('decides changed on unmasked values while reporting masked ones', () => {
  // Arrange
  const input = {
    kind: 'storage' as const,
    before: { value: { token: 'one' } },
    after: { value: { token: 'two' } },
    observedAtMs: 1_000,
    roots: { storage: [] },
  }
  // Act
  const observed = buildExtensionObserved(input)
  // Assert
  assert.deepEqual(observed, {
    kind: 'storage',
    before: { value: { token: '[masked]' } },
    after: { value: { token: '[masked]' } },
    changed: true,
    observedAtMs: 1_000,
  })
  assert.equal(extensionObservationResult(observed), 'changed')
})

// Value: protects=DXR7, CR9: a missing element, a real null and a failed read are three different results, and only a failed read is unavailable; fails_when=missing or null reads unavailable, or a failed baseline hides changed incorrectly; no_claim=the claimable flag (run tests)
test('keeps missing, null and unavailable distinct in the result word', () => {
  // Arrange
  const base = {
    kind: 'text' as const,
    observedAtMs: 1,
    roots: { storage: [] },
  }
  // Act
  const missing = buildExtensionObserved({
    ...base,
    before: { value: 'a' },
    after: { missing: true },
  })
  const nullValue = buildExtensionObserved({
    ...base,
    before: { value: 'a' },
    after: { value: null },
  })
  const failed = buildExtensionObserved({
    ...base,
    before: { value: 'a' },
    after: { unavailable: true, cause: 'gone' },
  })
  // Assert
  assert.deepEqual(
    [missing, nullValue, failed].map((observed) =>
      extensionObservationResult(observed),
    ),
    ['missing', 'changed', 'unavailable'],
  )
  assert.equal(failed.changed, undefined)
})

// Value: protects=ER23: a value nested far deeper than the limit reads unavailable at once with the limit cause, not a stack overflow; fails_when=the cause is the call-stack message; no_claim=the 64 KiB value
test('a value nested deeper than the stack reads as larger than the read limit', async () => {
  // Arrange
  let deep: unknown = 1
  for (let level = 0; level < 20000; level += 1) deep = { next: deep }
  const { reader } = readerOf(
    { kind: 'storage', key: 'k' },
    { 'Extensions.getStorageItems': () => ({ data: { k: deep } }) },
  )
  // Act
  const read = await reader.read()
  // Assert
  assert.deepEqual(read, {
    unavailable: true,
    cause: 'larger than the read limit',
  })
})
