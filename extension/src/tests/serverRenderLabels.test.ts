import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeOperationStatus } from '../utils/describeOperationStatus'
import { describePageLoadStatus } from '../utils/describePageLoadStatus'
import { describePauseName } from '../utils/describePauseName'
import {
  hasServerRenderPause,
  projectPauseNames,
} from '../utils/projectPauseNames'

const STOPS = [
  { participant: 'server', source: { path: 'app/lib/data.ts', line: 23 } },
  { participant: 'server', source: { path: 'app/ui/table.tsx', line: 8 } },
  { participant: 'server', source: { path: 'app/lib/actions.ts', line: 5 } },
]

// Value: protects=the entry-render pause reads "Page load" and never "Operation 0"; fails_when=an entry pause is named after operation 0 or loses its kind; no_claim=where the name is drawn
test('an entry-render pause is named Page load with Server render and its path and line', () => {
  // Arrange
  const input = {
    execution: 'server-render' as const,
    attribution: 'entry-load' as const,
    operationIndex: 0,
    path: 'app/lib/data.ts',
    line: 23,
  }
  // Act
  const name = describePauseName(input)
  // Assert
  assert.equal(name?.text, 'Page load · Server render · app/lib/data.ts:23')
})

// Value: protects=a render observed after operation k says so, and an unconfirmed route says it in words; fails_when=the suffix is missing or the operation number is lost; no_claim=route comparison itself (runtime lane)
test('a render after operation 2 with an unconfirmed route reads the operation and route not confirmed', () => {
  // Arrange
  const input = {
    execution: 'server-render' as const,
    attribution: 'unconfirmed' as const,
    operationIndex: 2,
    path: 'app/ui/table.tsx',
    line: 8,
  }
  // Act
  const name = describePauseName(input)
  // Assert
  assert.equal(
    name?.text,
    'After operation 2 · Server render · app/ui/table.tsx:8 · route not confirmed',
  )
})

// Value: protects=a server action and a format 7 server pause (no execution field) read Server action; a browser pause keeps its own name; fails_when=a format 7 server pause reads as a render or a browser pause gets a server name; no_claim=none beyond protects
test('a server action and a format 7 server pause read Server action while a browser pause gets no server name', () => {
  // Arrange
  const action = {
    execution: 'server-action' as const,
    operationIndex: 1,
    path: 'a.ts',
    line: 5,
  }
  const format7 = { participant: 'server' as const, path: 'b.ts', line: 6 }
  const browser = { participant: 'browser' as const, path: 'c.ts', line: 7 }
  // Act
  const names = [action, format7, browser].map(
    (input) => describePauseName(input)?.text,
  )
  // Assert
  assert.deepEqual(names, [
    'After operation 1 · Server action · a.ts:5',
    'Server action · b.ts:6',
    undefined,
  ])
})

// Value: protects=a set listed in the order the run paused it, with the declared position added only where it differs; fails_when=the list keeps declared order or every pause gets a declared note; no_claim=how the run orders its pauses
test('a set paused out of declared order is listed in execution order with its declared position', () => {
  // Arrange
  const observation = (
    declaredIndex: number,
    executionIndex: number,
    line: number,
  ) => ({
    participant: 'server',
    execution: 'server-render',
    attribution: 'entry-load',
    declaredIndex,
    executionIndex,
    source: { line },
  })
  const saved = [observation(0, 1, 23), observation(1, 0, 8)]
  // Act
  const listed = projectPauseNames(saved, STOPS).map(
    (pause) => pause.name?.text,
  )
  // Assert
  assert.deepEqual(listed, [
    'Page load · Server render · app/ui/table.tsx:8 (declared 2)',
    'Page load · Server render · app/lib/data.ts:23 (declared 1)',
  ])
})

// Value: protects=the first-execution note appears exactly for a study with a server-render pause; fails_when=a format 7 study shows the note or a render study hides it; no_claim=the note's drawing
test('only a study with a server-render pause carries the first-execution note', () => {
  // Arrange
  const render = [{ execution: 'server-render' }]
  const format7 = [{ participant: 'server' }]
  // Act
  const results = [hasServerRenderPause(render), hasServerRenderPause(format7)]
  // Assert
  assert.deepEqual(results, [true, false])
})

// Value: protects=the status words of a held entry pause, a finishing load, a set in progress and a complete zero-operation run; fails_when=any of the four texts differs; no_claim=run states of a real server (view fixtures)
test('the entry-load status reads paused in server render, finishing and complete, with a set count', () => {
  // Arrange
  const base = {
    hasOperations: false,
    enteredPageLoad: true,
    operationStarted: false,
  }
  // Act
  const held = describePageLoadStatus({
    ...base,
    runState: 'paused-server',
    held: { isServerRender: true, group: 0, paused: 1, declared: 1 },
  })
  const set = describePageLoadStatus({
    ...base,
    runState: 'paused-server',
    held: { isServerRender: true, group: 0, paused: 2, declared: 3 },
  })
  const finishing = describePageLoadStatus({ ...base, runState: 'resuming' })
  const complete = describePageLoadStatus({ ...base, runState: 'completed' })
  // Assert
  assert.deepEqual(
    [held, set, finishing, complete],
    [
      'Page load · paused in server render',
      'Page load · paused in server render (2 of 3)',
      'Page load · finishing',
      'Page load · complete',
    ],
  )
})

// Value: protects=the entry-load words replace the operation words but never a failure; fails_when=a failed run reads Page load; no_claim=none beyond protects
test('a failure keeps its Stopped words over the page-load status', () => {
  // Arrange
  const pageLoad = 'Page load · finishing'
  // Act
  const running = describeOperationStatus(
    undefined,
    'resuming',
    undefined,
    pageLoad,
  )
  const failed = describeOperationStatus(
    [
      {
        index: 1,
        kind: 'click',
        title: 'Go',
        state: 'failed',
        ack: 'pending',
        valueCheck: 'pending',
        effect: 'pending',
      },
    ],
    'failed',
    { code: 'OPERATION_AFTER_NOT_MET', operationIndex: 1 },
    pageLoad,
  )
  // Assert
  assert.deepEqual(
    [running, failed],
    ['Page load · finishing', 'Stopped at operation 1 · result not confirmed'],
  )
})
