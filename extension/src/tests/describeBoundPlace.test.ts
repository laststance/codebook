import assert from 'node:assert/strict'
import { test } from 'node:test'

import { declaredStopOfSnapshot } from '../utils/declaredStopOfSnapshot'
import { describeBoundPlace } from '../utils/describeBoundPlace'
import { explanationPlace } from '../utils/explanationPlace'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

const HASH = 'a'.repeat(64)

/** A cross-runtime (version 2) configuration with a browser stop and two later stops, the last one a server stop in another file. @example crossRuntimeConfiguration().additionalStops?.[1]?.source.line // 22 */
const crossRuntimeConfiguration = () => ({
  ...createConfiguredStudy().configuration,
  version: 2 as const,
  participant: 'browser' as const,
  additionalStops: [
    {
      participant: 'browser' as const,
      source: { path: 'src/theme.ts', hash: HASH, line: 1, column: 7 },
      anchorIndex: 0,
      inspections: [
        { path: 'nextTheme', mode: 'value' as const, required: true },
      ],
    },
    {
      participant: 'server' as const,
      source: { path: 'src/mode.ts', hash: HASH, line: 22, column: 3 },
      anchorIndex: 1,
      inspections: [{ path: 'mode', mode: 'value' as const, required: true }],
    },
  ],
})

// Value: protects=the sentence of a moved stop naming the file, the paused line and column, the declared line and where the agent wrote it; fails_when=a later stop is paired with the first declared stop, or its configuration path names another field; why_new=Cycle 0045 cause 1 (ER-5: one utility for the three numbers, shared with the Study pane's label); seam=none
test('a later stop the debugger moved to the next line is described with its own file, lines and configuration path', () => {
  // Arrange: three snapshots were committed in declared order; the third stop, declared at src/mode.ts 22:3, paused at 23:5.
  const snapshots = [
    { id: 'browser:1' },
    { id: 'browser:2' },
    { id: 'server:1' },
  ]
  const declared = declaredStopOfSnapshot(
    crossRuntimeConfiguration(),
    snapshots,
    'server:1',
  )
  assert.ok(declared)

  // Act
  const place = describeBoundPlace({
    declared,
    bound: { line: 23, column: 5 },
  })

  // Assert
  assert.equal(
    JSON.stringify(place),
    '{"path":"src/mode.ts","configurationPath":"configuration.additionalStops[1].source","declaredLine":22,"declaredColumn":3,"boundLine":23,"boundColumn":5,"isMoved":true,"place":"src/mode.ts: this stop paused on line 23, column 5. You declared line 22 (configuration.additionalStops[1].source); the debugger bound the breakpoint on line 23. Name line 23 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner."}',
  )
  assert.equal(
    JSON.stringify(explanationPlace(place)),
    '{"path":"src/mode.ts","declaredLine":22,"boundLine":23,"boundColumn":5}',
  )
})

// Value: protects=a stop that paused on its declared line staying without a second place; fails_when=a moved column, a requested place or the time of the acknowledgement makes the stop count as moved; why_new=Cycle 0045 cause 1 (ER-5: "an observation that paused on its declared line carries no place"); seam=none
test('a stop that paused at another column of its declared line is not moved, and keeps where it was requested and when its binding was known', () => {
  // Arrange: the first stop, declared at src/theme.ts 1:1, was requested at 1:3 and paused at 1:7; the adapter acknowledged the binding while the stop was armed.
  const declared = declaredStopOfSnapshot(
    crossRuntimeConfiguration(),
    [{ id: 'browser:1' }],
    'browser:1',
  )
  assert.ok(declared)

  // Act
  const place = describeBoundPlace({
    declared,
    bound: { line: 1, column: 7 },
    armed: { line: 1, column: 3 },
    acknowledged: 'before-pause',
  })

  // Assert
  assert.equal(
    JSON.stringify(place),
    '{"path":"src/theme.ts","configurationPath":"configuration.source","declaredLine":1,"declaredColumn":1,"boundLine":1,"boundColumn":7,"armed":{"line":1,"column":3},"acknowledged":"before-pause","isMoved":false}',
  )
  assert.equal(explanationPlace(place), undefined)
})

// Value: protects=the configuration path the sentence gives an agent being a field that exists; fails_when=a later stop of a version 1 configuration is named "…additionalStops[0].source", a field version 1 does not have; why_new=Cycle 0045 cause 1 (DX-1 c: the declared field by its configuration path); seam=none
test('a later stop of a version 1 configuration is named by the stop entry that holds its line and column', () => {
  // Arrange: version 1 declares later stops as { line, column, inspections } in the first stop's file.
  const configuration = {
    ...createConfiguredStudy().configuration,
    additionalStops: [
      {
        line: 1,
        column: 7,
        inspections: [
          { path: 'nextTheme', mode: 'value' as const, required: true },
        ],
      },
    ],
  }

  // Act
  const first = declaredStopOfSnapshot(
      configuration,
      [{ id: 'browser:1' }, { id: 'browser:2' }],
      'browser:1',
    ),
    later = declaredStopOfSnapshot(
      configuration,
      [{ id: 'browser:1' }, { id: 'browser:2' }],
      'browser:2',
    ),
    uncommitted = declaredStopOfSnapshot(
      configuration,
      [{ id: 'browser:1' }, { id: 'browser:2' }],
      'browser:3',
    )

  // Assert
  assert.equal(first?.configurationPath, 'configuration.source')
  assert.equal(first?.index, 0)
  assert.equal(later?.configurationPath, 'configuration.additionalStops[0]')
  assert.equal(later?.index, 1)
  assert.equal(later?.stop.source.column, 7)
  assert.equal(uncommitted, undefined)
})

// Cycle 0045 (ER-9, CX-A1): a binding first known at a pause that lies past a requested line that can pause is accepted, and the sentence says which column pauses on that line.
test('a moved stop whose requested line can pause is told which column to declare to stop there, with the line when Codebook requested it after the declared one', () => {
  // Arrange: the first stop, declared on line 1 of src/theme.ts, paused on a later line.
  const declared = declaredStopOfSnapshot(
    crossRuntimeConfiguration(),
    [{ id: 'browser:1' }],
    'browser:1',
  )
  assert.ok(declared)

  // Act
  const onDeclaredLine = describeBoundPlace({
      declared,
      bound: { line: 2, column: 1 },
      pausable: { line: 1, column: 3 },
    }),
    afterDeclaredLine = describeBoundPlace({
      declared,
      bound: { line: 3, column: 1 },
      armed: { line: 2, column: 9 },
      pausable: { line: 2, column: 5 },
    })

  // Assert
  assert.equal(
    onDeclaredLine.place,
    'src/theme.ts: this stop paused on line 2, column 1. You declared line 1 (configuration.source); the debugger bound the breakpoint on line 2. Name line 2 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner. Line 1 can pause at column 3; declare that column to stop there.',
  )
  assert.equal(
    afterDeclaredLine.place,
    'src/theme.ts: this stop paused on line 3, column 1. You declared line 1 (configuration.source); the debugger bound the breakpoint on line 3. Name line 3 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner. Line 2 can pause at column 5; declare line 2 at that column to stop there.',
  )
  assert.equal(JSON.stringify(onDeclaredLine.pausable), '{"line":1,"column":3}')
})
