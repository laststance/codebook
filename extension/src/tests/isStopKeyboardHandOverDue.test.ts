import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isStopKeyboardHandOverDue } from '../runtimeSupport/utils/isStopKeyboardHandOverDue'

// Value: protects=the keyboard of a learner at a stop Codebook did not cause under its contributed default; fails_when=the hand-over is refused in the one case it exists for, so the paused file stays without the keyboard (BODY); why_new=Cycle 0046 finding 589 (9f and a learner's F11, both hosts)
test('a stop Codebook did not cause under the contributed default is handed to the paused file', () => {
  // Arrange
  const state = {
    recordingActive: false,
    focusEditorOnBreak: false,
    hasExplicitFocusEditorOnBreak: false,
    isCodebookCausedStop: false,
  }

  // Act
  const due = isStopKeyboardHandOverDue(state)

  // Assert
  assert.equal(due, true)
})

// Value: protects=the chat's keyboard at a stop Codebook caused (task 5); fails_when=the run's own stop is handed to the paused file; why_new=Cycle 0046 decision R7 (A′ keeps the preserving default for Codebook's stops)
test('a stop Codebook caused is not handed over', () => {
  // Arrange
  const state = {
    recordingActive: false,
    focusEditorOnBreak: false,
    hasExplicitFocusEditorOnBreak: false,
    isCodebookCausedStop: true,
  }

  // Act
  const due = isStopKeyboardHandOverDue(state)

  // Assert
  assert.equal(due, false)
})

// Value: protects=replay, whose historical debugger opens no file with the keyboard; fails_when=a stop shown while a recording is open moves the keyboard into a recorded file; why_new=Cycle 0046 decision R7 (do nothing while a recording is open)
test('a stop while a recording is open is not handed over', () => {
  // Arrange
  const state = {
    recordingActive: true,
    focusEditorOnBreak: false,
    hasExplicitFocusEditorOnBreak: false,
    isCodebookCausedStop: false,
  }

  // Act
  const due = isStopKeyboardHandOverDue(state)

  // Assert
  assert.equal(due, false)
})

// Value: protects=an editor that focuses the paused file by itself; fails_when=Codebook shows the file again although the editor already gave it the keyboard; why_new=Cycle 0046 decision R7 (do nothing while the effective value is true)
test('a stop the editor focuses by itself is not handed over', () => {
  // Arrange
  const state = {
    recordingActive: false,
    focusEditorOnBreak: true,
    hasExplicitFocusEditorOnBreak: true,
    isCodebookCausedStop: false,
  }

  // Act
  const due = isStopKeyboardHandOverDue(state)

  // Assert
  assert.equal(due, false)
})

// Value: protects=an editor without Codebook's contributed default, whose own default focuses the paused file; fails_when=an unset value is taken for false and Codebook shows the file again; why_new=Cycle 0046 decision R7 (the editor's own default focuses)
test('a stop under the editor’s own unset default is not handed over', () => {
  // Arrange
  const state = {
    recordingActive: false,
    focusEditorOnBreak: undefined,
    hasExplicitFocusEditorOnBreak: false,
    isCodebookCausedStop: false,
  }

  // Act
  const due = isStopKeyboardHandOverDue(state)

  // Assert
  assert.equal(due, false)
})

// Value: protects=a learner who set debug.focusEditorOnBreak to false on purpose; fails_when=Codebook overrides that choice and moves the keyboard into the paused file; why_new=Cycle 0046 decision R7 (do nothing when the learner set the setting explicitly)
test('a stop under an explicit false setting is not handed over', () => {
  // Arrange
  const state = {
    recordingActive: false,
    focusEditorOnBreak: false,
    hasExplicitFocusEditorOnBreak: true,
    isCodebookCausedStop: false,
  }

  // Act
  const due = isStopKeyboardHandOverDue(state)

  // Assert
  assert.equal(due, false)
})
