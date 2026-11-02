import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ERROR_RECOVERY } from '../errors'
import { describeServerRenderFailureDetails } from '../utils/describeServerRenderFailureDetails'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'

// Value: protects=both new failures name their audience, side effects, the run-once causes as "may" and their help anchor; fails_when=a recovery loses the anchor, the side-effect sentence or states the cause as established; no_claim=the wording is helpful (reviewed in the DX phase)
test('SERVER_STOP_NOT_REACHED and ENTRY_LOAD_TIMEOUT recoveries carry audience, side effects and anchor', () => {
  // Arrange, Act
  const notReached = ERROR_RECOVERY.SERVER_STOP_NOT_REACHED
  const timeout = ERROR_RECOVERY.ENTRY_LOAD_TIMEOUT
  // Assert
  assert.match(notReached, /^Audience: chat\. /)
  assert.match(notReached, /may have run only while Codebook prepared the page/)
  assert.match(notReached, /never start again unasked/)
  assert.match(
    notReached,
    /Side effects: entry-render none; after-operation unknown/,
  )
  assert.match(notReached, /resourcesReleased/)
  assert.match(
    notReached,
    /codebook:\/\/help\/repository-browser#SERVER_STOP_NOT_REACHED\.$/,
  )
  assert.match(timeout, /^Audience: chat\. /)
  assert.match(timeout, /Side effects: none/)
  assert.match(timeout, /outputUri/)
  assert.match(
    timeout,
    /codebook:\/\/help\/repository-browser#ENTRY_LOAD_TIMEOUT\.$/,
  )
})

// Value: protects=a run's failure text led by either code is restored as that code so the agent reads the stable code; fails_when=the text restores as RUNTIME_FAILED; no_claim=none beyond protects
test('a failure text led by a server-render code is restored as that code', () => {
  // Arrange
  const text = formatRefusalFailure(
    'SERVER_STOP_NOT_REACHED',
    'The page finished without reaching declared stop app/lib/data.ts:91.',
  )
  // Act
  const restored = refusalFailureOf(text)
  // Assert
  assert.deepEqual(restored, {
    code: 'SERVER_STOP_NOT_REACHED',
    message:
      'The page finished without reaching declared stop app/lib/data.ts:91.',
  })
  assert.equal(
    refusalFailureOf(
      formatRefusalFailure(
        'ENTRY_LOAD_TIMEOUT',
        'The entry page did not finish loading.',
      ),
    )?.code,
    'ENTRY_LOAD_TIMEOUT',
  )
})

// Value: protects=an entry-render SERVER_STOP_NOT_REACHED names no operation and says the first execution was not observed; fails_when=operationIndex 0 appears or firstExecutionObserved is missing; no_claim=none beyond protects
test('an entry-render unreached stop carries phase, stops and no operation index', () => {
  // Arrange, Act
  const details = describeServerRenderFailureDetails(
    {
      code: 'SERVER_STOP_NOT_REACHED',
      operationIndex: 0,
      sent: 'not-sent',
      sideEffects: 'none',
      logId: 'run-1#start',
      serverRender: {
        phase: 'entry-render',
        stop: 'app/lib/data.ts:91',
        pausedStops: ['app/page.tsx:12'],
        notReachedStops: ['app/lib/data.ts:91'],
      },
    },
    'codebook://run/run-1',
  )
  // Assert
  assert.deepEqual(details, {
    phase: 'entry-render',
    stop: 'app/lib/data.ts:91',
    pausedStops: ['app/page.tsx:12'],
    notReachedStops: ['app/lib/data.ts:91'],
    firstExecutionObserved: false,
    runUri: 'codebook://run/run-1',
    sent: 'not-sent',
    sideEffects: 'none',
    retry: 'Fix the configuration, then start one new run.',
    logId: 'run-1#start',
  })
})

// Value: protects=an after-operation unreached stop names the operation and forbids an unasked retry; fails_when=operationIndex is dropped or the retry rule allows a new run; no_claim=none beyond protects
test('an after-operation unreached stop carries the operation index and never retries unasked', () => {
  // Arrange, Act
  const details = describeServerRenderFailureDetails({
    code: 'SERVER_STOP_NOT_REACHED',
    operationIndex: 2,
    sent: 'sent',
    sideEffects: 'unknown',
    logId: 'run-1#2',
    serverRender: {
      phase: 'after-operation',
      stop: 'app/lib/data.ts:154',
      pausedStops: [],
      notReachedStops: ['app/lib/data.ts:154'],
    },
  })
  // Assert
  assert.equal(details.phase, 'after-operation')
  assert.equal(details.operationIndex, 2)
  assert.equal(details.retry, 'Never retry automatically; ask the learner.')
  assert.equal(details.sent, 'sent')
})

// Value: protects=ENTRY_LOAD_TIMEOUT details name the route, the last paused stop and the elapsed time; fails_when=a field is missing; no_claim=none beyond protects
test('an entry load timeout carries the entry route, the last paused stop and the elapsed time', () => {
  // Arrange, Act
  const details = describeServerRenderFailureDetails({
    code: 'ENTRY_LOAD_TIMEOUT',
    operationIndex: 0,
    sent: 'not-sent',
    sideEffects: 'none',
    logId: 'run-1#start',
    entryLoad: {
      entryRoute: '/dashboard',
      lastPausedStop: 'app/lib/data.ts:91',
      elapsedMs: 20012,
    },
  })
  // Assert
  assert.deepEqual(details, {
    entryRoute: '/dashboard',
    lastPausedStop: 'app/lib/data.ts:91',
    elapsedMs: 20012,
    sent: 'not-sent',
    sideEffects: 'none',
    retry: 'Fix the configuration, then start one new run.',
    logId: 'run-1#start',
  })
})
