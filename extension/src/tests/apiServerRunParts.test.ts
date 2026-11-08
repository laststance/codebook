import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { ApiEntryGate } from '../utils/apiEntryGate'
import { apiServerRefusalOf } from '../utils/apiServerRefusalOf'
import { resolveApiLoss } from '../utils/resolveApiLoss'
import {
  isNodeApiHit,
  routeHandlerAcceptsLine,
} from '../utils/routeHandlerProfile'

const CONTEXT = {
  port: 4100,
  step: 'api-server-listen',
  cause: 'cause',
  journalUri: 'events',
} as const

// Value: protects=E-3 exactly-once release: the gate holds the entry pause of a session, continues it once for the selected session, and lets later stops through; fails_when=the entry is continued twice, a later stop is swallowed, or the thread is wrong; no_claim=js-debug's event order (apiServerRunPauses.test.ts runs the gate in a run)
test('the entry gate holds the entry pause, continues it once and lets later stops through', async () => {
  // Arrange
  const gate = new ApiEntryGate()
  const continued: number[] = []
  const held = gate.capture('child', 7)
  // Act
  await gate.release(
    'child',
    async (threadId) => void continued.push(threadId),
    AbortSignal.timeout(2_000),
  )
  await gate.release(
    'child',
    async (threadId) => void continued.push(threadId),
    AbortSignal.timeout(2_000),
  )
  const laterStopHeld = gate.capture('child', 8)
  // Assert
  assert.deepEqual(
    { held, continued, laterStopHeld, releases: gate.releaseCount },
    { held: true, continued: [7], laterStopHeld: false, releases: 1 },
  )
})

// Value: protects=E-3 cancel before release: a cancelled gate continues nothing even when the entry pause is there; fails_when=a cancelled run continues the process; no_claim=the kill that follows (apiServerRunLifecycle.test.ts)
test('a cancelled entry gate continues nothing', async () => {
  // Arrange
  const gate = new ApiEntryGate()
  gate.capture('child', 7)
  gate.cancel()
  const continued: number[] = []
  // Act
  await gate.release(
    'child',
    async (threadId) => void continued.push(threadId),
    AbortSignal.timeout(2_000),
  )
  // Assert
  assert.deepEqual(
    { continued, isReleased: gate.isReleased },
    { continued: [], isReleased: false },
  )
})

// Value: protects=D19 and E-1: a pause matches an API stop only by the file URL of the real path together with the stop's own acknowledged breakpoint id, so a webpack address, another file or a pause that names no id never matches; fails_when=Next's address spelling or an unnamed pause matches; no_claim=js-debug's real script URL spelling (the native check)
test('an API stop matches the file URL and its own acknowledged breakpoint only', () => {
  // Arrange
  const hit = {
    realSourcePath: '/repo/apps/api/src/a.ts',
    scriptUrl: 'file:///repo/apps/api/src/a.ts',
    acknowledgedId: 41,
    hitIds: [41],
  }
  // Act
  const results = {
    own: isNodeApiHit(hit),
    otherFile: isNodeApiHit({
      ...hit,
      scriptUrl: 'file:///repo/apps/api/src/b.ts',
    }),
    webpack: isNodeApiHit({
      ...hit,
      scriptUrl: 'webpack-internal:///(api-node)/./apps/api/src/a.ts',
    }),
    otherBreakpoint: isNodeApiHit({ ...hit, hitIds: [42] }),
    unnamedPause: isNodeApiHit({ ...hit, hitIds: [] }),
    unacknowledged: isNodeApiHit({ ...hit, acknowledgedId: undefined }),
  }
  // Assert
  assert.deepEqual(results, {
    own: true,
    otherFile: false,
    webpack: false,
    otherBreakpoint: false,
    unnamedPause: false,
    unacknowledged: false,
  })
})

// Value: protects=D19 line policy: an API stop accepts only its requested line while a route handler keeps the citation range; fails_when=an API stop binds to a later line of its citation; no_claim=js-debug's bound column (the policy ignores columns)
test('an API stop accepts only its requested line and a route handler keeps its citation range', () => {
  // Arrange
  const place = { declaredLine: 7, requestedLine: 7, citationEndLine: 20 }
  // Act
  const lines = {
    apiDeclared: routeHandlerAcceptsLine('node-api', 7, place),
    apiLater: routeHandlerAcceptsLine('node-api', 8, place),
    routeLater: routeHandlerAcceptsLine('app-route', 8, place),
    routeAfterCitation: routeHandlerAcceptsLine('pages-api', 21, place),
  }
  // Assert
  assert.deepEqual(lines, {
    apiDeclared: true,
    apiLater: false,
    routeLater: true,
    routeAfterCitation: false,
  })
})

// Value: protects=E-6: the arbiter returns the exit fact when the API exited within the bound and nothing while it runs; fails_when=a running API is reported as exited or an exit is missed; no_claim=real process timing
test('the loss arbiter returns the exit within the bound and nothing for a running API', async () => {
  // Arrange
  const exit = { exitCode: 2, signal: null, outputTail: 'boom' }
  // Act
  const exited = await resolveApiLoss(
    { whenExited: () => Promise.resolve(exit) },
    1_000,
  )
  const running = await resolveApiLoss(
    { whenExited: () => new Promise<never>(() => {}) },
    20,
  )
  // Assert
  assert.deepEqual({ exited, running }, { exited: exit, running: undefined })
})

// Value: protects=DX-3, DX-6, DX-10 and DX-11: each node-server code of the API path is worded as the apiServer refusal of its code, an uncoded failure as RUNTIME_FAILED with the step, and any other coded refusal stays as it is; fails_when=a node-server wording or a missing step reaches the chat; no_claim=the wording itself (apiServerRefusals.test.ts)
test('errors of the API path are worded as apiServer refusals with the step of an uncoded failure', async () => {
  // Arrange
  const exit = { exitCode: 4, signal: null, outputTail: 'tail' }
  const own = new StudyError('EXPO_WEB_SEAL_FAILED', 'sealed')
  // Act
  const refusals = {
    notListening: await apiServerRefusalOf(
      new StudyError(
        'SERVER_NOT_LISTENING',
        'x. The launched process listens on port 4200: declare port: 4200.',
      ),
      CONTEXT,
    ),
    exited: await apiServerRefusalOf(new StudyError('SERVER_EXITED', 'x'), {
      ...CONTEXT,
      exit,
    }),
    uncoded: await apiServerRefusalOf(new Error('refused'), {
      ...CONTEXT,
      step: 'api-server-attach',
    }),
    coded: await apiServerRefusalOf(own, CONTEXT),
  }
  // Assert
  assert.deepEqual(
    {
      listeningPort: (refusals.notListening as StudyError).message.includes(
        'declare apiServer.port 4200',
      ),
      exitCode: (refusals.exited as StudyError).details?.exitCode,
      step: (refusals.uncoded as StudyError).details?.step,
      code: (refusals.uncoded as StudyError).code,
      codedKept: refusals.coded === own,
    },
    {
      listeningPort: true,
      exitCode: 4,
      step: 'api-server-attach',
      code: 'RUNTIME_FAILED',
      codedKept: true,
    },
  )
})
