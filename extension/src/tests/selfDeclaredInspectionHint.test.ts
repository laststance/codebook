import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selfDeclaredInspectionHint } from '../utils/selfDeclaredInspectionHint'

// Cycle 0044 (0042-N11-3): the hint is given only when the paused line declares the inspected binding with const or let.
test('a required value gets the declared-on-this-line hint for a plain, a renamed and a destructured const or let, and none otherwise', () => {
  // Arrange
  const source = [
    'const user = await getUser(email)',
    'const { data: rows, error } = await query()',
    'let [first, ...rest] = items',
    'var legacy = 1',
    'return user.name',
    'const total: number = sum(rows)',
  ].join('\n')
  // Act
  const hints = {
    plain: selfDeclaredInspectionHint(source, 1, 'user.email'),
    renamed: selfDeclaredInspectionHint(source, 2, 'rows'),
    renamedKey: selfDeclaredInspectionHint(source, 2, 'data'),
    arrayRest: selfDeclaredInspectionHint(source, 3, 'rest'),
    hoistedVar: selfDeclaredInspectionHint(source, 4, 'legacy'),
    laterUse: selfDeclaredInspectionHint(source, 5, 'user'),
    annotated: selfDeclaredInspectionHint(source, 6, 'total'),
    outsideSource: selfDeclaredInspectionHint(source, 40, 'user'),
  }
  // Assert
  assert.deepEqual(hints, {
    plain:
      ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    renamed:
      ' Line 2 declares rows, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    renamedKey: '',
    arrayRest:
      ' Line 3 declares rest, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    hoistedVar: '',
    laterUse: '',
    annotated:
      ' Line 6 declares total, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    outsideSource: '',
  })
})
