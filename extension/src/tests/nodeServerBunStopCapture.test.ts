import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPLAY_SCOPE_NOT_CAPTURED_TEXT } from '../constants'
import type {
  NodeServerHistoryEntry,
  NodeServerHistoryHeader,
} from '../nodeServerHistorySchemas'
import { evaluateNodeServerCapture } from '../utils/evaluateNodeServerCapture'

import {
  nodeServerHistoryHeader,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'

/** A header whose configuration runs on `loader`. */
function headerWithLoader(loader: 'bun' | 'tsx' | 'node') {
  const header = nodeServerHistoryHeader(
    SERVER_WORKSPACE_KEY,
  ) as NodeServerHistoryHeader
  return {
    declaredStops: header.declaredStops,
    configuration: { ...header.configuration, loader },
  }
}

/** One stop entry whose top-frame scopes are the given ones, with matching identity and a present fact. */
function stopEntryWithScopes(
  scopes: Array<{
    name: string
    variables: number[]
    unavailable?: string
  }>,
): NodeServerHistoryEntry {
  const capture = serverStopCapture({
    declaredStopIndex: 0,
    hit: 1,
    line: 2,
    elapsedMs: 10,
  })
  const frame = capture.snapshot.frames[0]
  if (!frame) throw new Error('The fixture stop has no frame.')
  return {
    type: 'stop',
    sequence: 1,
    elapsedMs: capture.elapsedMs,
    declaredStopIndex: 0,
    hit: 1,
    generation: 1,
    source: capture.source,
    frame: { name: 'handler' },
    facts: capture.facts,
    unavailable: [],
    debuggerSnapshot: {
      ...capture.snapshot,
      frames: [{ ...frame, scopes }],
    },
  }
}

const NOT_CAPTURED_SCOPES = [
  {
    name: 'Local',
    variables: [],
    unavailable: REPLAY_SCOPE_NOT_CAPTURED_TEXT,
  },
  {
    name: 'Closure',
    variables: [],
    unavailable: REPLAY_SCOPE_NOT_CAPTURED_TEXT,
  },
]

const SNAPSHOT_MISSING = 'SERVER_HISTORY_SNAPSHOT_MISSING'

// protects=a Bun run whose policy saves no scope values seals complete; fails_when=every Bun stop is judged to lack its debugger state; no_claim=the replay shows scope values
test('a Bun run whose stops keep no scope values by policy is a complete capture', () => {
  // Arrange
  const header = headerWithLoader('bun')
  const entries = [stopEntryWithScopes(NOT_CAPTURED_SCOPES)]

  // Act
  const reasons = evaluateNodeServerCapture(header, entries, {})

  // Assert
  assert.equal(
    reasons.some((reason) => reason.code === SNAPSHOT_MISSING),
    false,
  )
})

// protects=a Node run keeps requiring one read scope; fails_when=a Node stop with nothing read is called complete; no_claim=Bun runs
for (const loader of ['tsx', 'node'] as const) {
  test(`a ${loader} Node run whose stop read no scope is still missing its debugger state`, () => {
    // Arrange
    const header = headerWithLoader(loader)
    const entries = [stopEntryWithScopes(NOT_CAPTURED_SCOPES)]

    // Act
    const reasons = evaluateNodeServerCapture(header, entries, {})

    // Assert
    assert.deepEqual(
      reasons.map((reason) => reason.code),
      [SNAPSHOT_MISSING],
    )
  })
}

// protects=a Bun stop with a scope that failed to read is still not presentable; fails_when=the Bun rule accepts any unread scope; no_claim=which scope failed
test('a Bun stop with a scope whose read failed is still missing its debugger state', () => {
  // Arrange
  const header = headerWithLoader('bun')
  const entries = [
    stopEntryWithScopes([
      ...NOT_CAPTURED_SCOPES,
      { name: 'Block', variables: [], unavailable: 'The debugger refused.' },
    ]),
  ]

  // Act
  const reasons = evaluateNodeServerCapture(header, entries, {})

  // Assert
  assert.deepEqual(
    reasons.map((reason) => reason.code),
    [SNAPSHOT_MISSING],
  )
})
