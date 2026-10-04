import assert from 'node:assert/strict'
import { test } from 'node:test'

import { focusEditorGroupCommand } from '../utils/focusEditorGroupCommand'

// Value: protects=the focus going back to the editor group of an agent chat by the editor's own command for that group; fails_when=a view column is mapped to the command of a neighbouring group, so another group gets the keyboard; why_new=Cycle 0045 cause 7; seam=none
test('the group of the fourth view column gets the focus back with the editor command for its fourth group', () => {
  // Arrange
  const viewColumn = 4
  // Act
  const command = focusEditorGroupCommand(viewColumn)
  // Assert
  assert.equal(command, 'workbench.action.focusFourthEditorGroup')
})

// Value: protects=no command being run for a group the editor cannot focus by number; fails_when=a ninth group or a column that is not a main view column is given some other group's command; why_new=Cycle 0045 cause 7; seam=none
test('a group beyond the eighth view column, or without a column, gets no focus command', () => {
  // Arrange
  const viewColumns = [9, 0, -1]
  // Act
  const commands = viewColumns.map((viewColumn) =>
    focusEditorGroupCommand(viewColumn),
  )
  // Assert
  assert.deepEqual(commands, [undefined, undefined, undefined])
})
