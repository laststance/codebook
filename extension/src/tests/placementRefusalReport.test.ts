import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describePlacementRefusal,
  PlacementEventLog,
} from '../utils/placementRefusalReport'

// Value: protects=refusal report bounded: 8 tabs per group, 48 chars per label, rest counted; fails_when=a group lists every tab in full; why_new=only short groups asserted; seam=none; no_claim=guard choice
test('cuts a crowded group to eight tabs and long labels to 48 characters in the refusal report', () => {
  // Arrange
  const tabs = Array.from({ length: 10 }, (_, index) => ({
    label: index === 0 ? 'x'.repeat(60) : `t${index}`,
    kind: 'text',
  }))
  const group = { viewColumn: 2, isActive: true, tabs }

  // Act
  const report = describePlacementRefusal({
    guard: 'placement',
    armedAtMs: 100,
    nowMs: 230,
    before: [group],
    after: [{ viewColumn: 1, isActive: false, tabs: [] }],
    events: [],
  })

  // Assert
  assert.equal(
    report,
    [
      'Guard: placement',
      'Armed 130 ms before the refusal',
      `Groups before: 2* [${'x'.repeat(48)} (text), t1 (text), t2 (text), t3 (text), t4 (text), t5 (text), t6 (text), t7 (text), +2 more]`,
      'Groups after: 1 []',
      'Events while armed:',
      '  none',
    ].join('\n'),
  )
})

// Value: protects=report lists last 24 editor events as ms since arming; fails_when=more than 24 kept or absolute times shown; why_new=cap and since() untested; seam=none; no_claim=editor events
test('keeps the last 24 editor events and lists those since the guard was armed', () => {
  // Arrange
  const log = new PlacementEventLog()
  for (let index = 0; index < 30; index += 1)
    log.record(index * 10, `event ${index}`)

  // Act
  const events = log.since(280)
  const all = log.since(0)
  const report = describePlacementRefusal({
    guard: 'placement',
    armedAtMs: 270,
    nowMs: 300,
    before: [],
    after: [],
    events,
  })

  // Assert
  assert.equal(all.length, 24)
  assert.equal(all[0]!.what, 'event 6')
  assert.deepEqual(
    events.map((event) => event.what),
    ['event 28', 'event 29'],
  )
  assert.match(
    report,
    /Events while armed:\n  \+10 ms event 28\n  \+20 ms event 29$/,
  )
})
