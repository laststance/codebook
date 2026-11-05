import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeScriptView } from '../nodeScriptRuntimeTypes'
import { projectNodeScriptState } from '../utils/projectNodeScriptState'

const view = (fields: Partial<NodeScriptView> = {}): NodeScriptView => ({
  state: 'running',
  stops: [],
  stopsReached: [],
  pauseGeneration: 0,
  captures: [],
  captureBudgetExhausted: false,
  failedStops: 0,
  ...fields,
})

const input = (
  fields: Partial<Parameters<typeof projectNodeScriptState>[0]> = {},
) => ({
  instanceId: 'i',
  runId: 'r',
  view: view(),
  itemId: undefined,
  controllable: true,
  stopped: false,
  ending: false,
  sanitize: (text: string) => text.replaceAll('/private/root', '<root>'),
  ...fields,
})

// Value: protects=a released script run reads ended when the script ended by itself and stopped when it was stopped, and a run being released or failing reads stopping with only stop left to do; fails_when=a natural exit reads stopped, a failed run keeps offering continue, or an unreleased run drops its stop action; why_new=the service tests reach ended only for a natural exit; seam=none; no_claim=the service record that feeds the input
test('a script run reads ended after its own exit, stopped after codebook_stop and stopping while it is released or failed', () => {
  // Arrange
  const exited = { kind: 'exited', exitCode: 0 } as NonNullable<
    NodeScriptView['end']
  >
  const stoppedEnd = { kind: 'stopped' } as NonNullable<NodeScriptView['end']>

  // Act
  const ended = projectNodeScriptState(
    input({ stopped: true, view: view({ end: exited }) }),
  )
  const stopped = projectNodeScriptState(
    input({ stopped: true, view: view({ end: stoppedEnd }) }),
  )
  const releasing = projectNodeScriptState(input({ ending: true }))
  const failed = projectNodeScriptState(
    input({ view: view({ runFailure: new Error('boom') as never }) }),
  )
  const early = projectNodeScriptState(input({ view: undefined }))

  // Assert
  assert.deepEqual(
    [ended.state, stopped.state, releasing.state, failed.state, early.state],
    ['ended', 'stopped', 'stopping', 'stopping', 'preparing'],
  )
  assert.deepEqual(ended.nextActions, [])
  assert.deepEqual(stopped.nextActions, [])
  assert.deepEqual(releasing.nextActions, ['stop'])
  assert.equal(early.nodeScript, undefined)
})
