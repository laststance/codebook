import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readsExplicitFocusEditorOnBreak } from '../runtimeSupport/utils/readsExplicitFocusEditorOnBreak'

// Value: protects=the hand-over that compensates Codebook's contributed default; fails_when=the contributed configurationDefaults value is taken for the learner's own setting, so the paused file never gets the keyboard; why_new=Cycle 0046 decision R7 (the contributed default alone is what A′ compensates)
test('the contributed default alone is no explicit setting', () => {
  // Arrange
  const inspection = { key: 'debug.focusEditorOnBreak', defaultValue: false }

  // Act
  const explicit = readsExplicitFocusEditorOnBreak(inspection)

  // Assert
  assert.equal(explicit, false)
})

// Value: protects=a learner who turned debug.focusEditorOnBreak off in the user settings; fails_when=Codebook still hands the keyboard to the paused file against that choice; why_new=Cycle 0046 decision R7 (do nothing when the learner set the setting in a user layer)
test('a user setting is explicit even when it is false', () => {
  // Arrange
  const inspection = {
    key: 'debug.focusEditorOnBreak',
    defaultValue: false,
    globalValue: false,
  }

  // Act
  const explicit = readsExplicitFocusEditorOnBreak(inspection)

  // Assert
  assert.equal(explicit, true)
})

// Value: protects=a project that sets debug.focusEditorOnBreak in its workspace settings; fails_when=a workspace value is ignored and Codebook decides the focus; why_new=Cycle 0046 decision R7 (do nothing when the setting is set in a workspace layer)
test('a workspace setting is explicit', () => {
  // Arrange
  const inspection = {
    key: 'debug.focusEditorOnBreak',
    defaultValue: false,
    workspaceValue: true,
  }

  // Act
  const explicit = readsExplicitFocusEditorOnBreak(inspection)

  // Assert
  assert.equal(explicit, true)
})

// Value: protects=a workspace folder that sets debug.focusEditorOnBreak; fails_when=a folder value is ignored and Codebook decides the focus; why_new=Cycle 0046 decision R7 (do nothing when the setting is set in a workspace-folder layer)
test('a workspace-folder setting is explicit', () => {
  // Arrange
  const inspection = {
    key: 'debug.focusEditorOnBreak',
    defaultValue: false,
    workspaceFolderValue: false,
  }

  // Act
  const explicit = readsExplicitFocusEditorOnBreak(inspection)

  // Assert
  assert.equal(explicit, true)
})

// Value: protects=the reader on an editor that does not register the setting; fails_when=a missing inspection throws inside the active-editor listener; why_new=Cycle 0046 decision R7 (inspect answers undefined for an unknown setting)
test('no inspection is no explicit setting', () => {
  // Arrange
  const inspection = undefined

  // Act
  const explicit = readsExplicitFocusEditorOnBreak(inspection)

  // Assert
  assert.equal(explicit, false)
})
