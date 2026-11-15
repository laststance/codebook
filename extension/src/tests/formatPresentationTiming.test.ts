import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatPresentationTiming } from '../studyWorkspace/formatPresentationTiming'

// protects=Cycle 0137 C1-E: the playback timing journal line names the trigger, the position, the stop change, the controller's durations in whole milliseconds, every presentation step and the native debugger's split (select to stopped, stopped to values); fails_when=a field is missing, a duration keeps fractions, or the debugger split is measured from the wrong mark; no_claim=the steps' real durations (the record is hard-coded)
test('a presentation timing line holds the trigger, the durations, every step and the debugger split', () => {
  // Arrange
  const timing = {
    trigger: 'tick' as const,
    positionMs: 96390,
    stopChanged: true,
    totalMs: 541.6,
    frameMs: 8.2,
    presentMs: 530,
  }
  const steps = {
    steps: { retire: 4, source: 61, debugger: 310 },
    totalMs: 529,
    inspection: 'inspected' as const,
    debugger: { selectedAt: 1000, stoppedAt: 1030, inspectionReadyAt: 1290 },
  }

  // Act
  const line = formatPresentationTiming(timing, steps)

  // Assert
  assert.equal(
    line,
    'playback.presentation-timing {"trigger":"tick","positionMs":96390,"stopChanged":true,"totalMs":542,"frameMs":8,"presentMs":530,"steps":{"retire":4,"source":61,"debugger":310},"stepsTotalMs":529,"inspection":"inspected","debugger":{"selectToStoppedMs":30,"stoppedToValuesMs":260}}',
  )
})

// protects=a commit without a presentation of its own (the moment was already shown as it is) journals only the controller's report, and a stop whose values never loaded journals no values time; fails_when=the line invents steps or a values time that did not happen; no_claim=which commits run a presentation (the controller decides that)
test('a presentation timing line without steps or loaded values leaves those fields out', () => {
  // Arrange
  const timing = {
    trigger: 'command' as const,
    positionMs: 500,
    stopChanged: false,
    totalMs: 3,
    frameMs: 0,
    presentMs: 0,
  }

  // Act
  const withoutSteps = formatPresentationTiming(timing, undefined)
  const withoutValues = formatPresentationTiming(timing, {
    steps: { retire: 0 },
    totalMs: 0,
    inspection: 'uninspected',
    debugger: { selectedAt: 1000, stoppedAt: 1020 },
  })

  // Assert
  assert.equal(
    withoutSteps,
    'playback.presentation-timing {"trigger":"command","positionMs":500,"stopChanged":false,"totalMs":3,"frameMs":0,"presentMs":0}',
  )
  assert.equal(
    withoutValues,
    'playback.presentation-timing {"trigger":"command","positionMs":500,"stopChanged":false,"totalMs":3,"frameMs":0,"presentMs":0,"steps":{"retire":0},"stepsTotalMs":0,"inspection":"uninspected","debugger":{"selectToStoppedMs":20}}',
  )
})
