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

// Cycle 0045 (SEC-4, ER-26): the bound is 100 ms. Measured once on the development host on 2026-10-04: the lazy pattern /\\b(?:const|let)\\s+([^=;]+?)\\s*=(?!=)/ took 1,810 ms on this line (18 times the bound), the single pass 0.14 ms in its first call (a 700th of the bound).
test('a declaration line with 2,000 spaces after const and no initializer is answered within 100 ms', () => {
  // Arrange
  const source = `const${' '.repeat(2_000)}user`
  // Act
  const startedMs = performance.now()
  const hint = selfDeclaredInspectionHint(source, 1, 'user')
  const elapsedMs = performance.now() - startedMs
  // Assert
  assert.equal(hint, '')
  assert.equal(elapsedMs < 100, true)
})

// Cycle 0045 (SEC-4, PC-4.14): the counterexample of the plan challenge. Measured once on the development host on 2026-10-04: the lazy pattern took 1,227 ms on this line and the pattern the row proposed, /\\b(?:const|let)\\s([^=;]+)=(?!=)/, 1,151 ms (12 and 11 times the bound), the single pass 0.68 ms in its first call (a 147th of the bound).
test('a line that repeats the keyword const 20,000 times without an initializer is answered within 100 ms', () => {
  // Arrange
  const source = 'const '.repeat(20_000)
  // Act
  const startedMs = performance.now()
  const hint = selfDeclaredInspectionHint(source, 1, 'const')
  const elapsedMs = performance.now() - startedMs
  // Assert
  assert.equal(hint, '')
  assert.equal(elapsedMs < 100, true)
})

// Cycle 0045 (SEC-4): the single pass reads the same declarations as the pattern it replaced.
test('the hint is still given for a declaration after long white space, after an earlier statement or a comparison on its line, and not for a head that a semicolon or a comparison ends', () => {
  // Arrange
  const source = [
    `const${' '.repeat(2_000)}user = await getUser(email)`,
    'if (a === b) { const total = sum(rows) }',
    'const pending; let ready = true',
    'const user == other',
    'letter = 5',
    'for (const row of rows) count += 1',
  ].join('\n')
  // Act
  const hints = {
    afterLongWhiteSpace: selfDeclaredInspectionHint(source, 1, 'user'),
    afterComparison: selfDeclaredInspectionHint(source, 2, 'total'),
    afterStatement: selfDeclaredInspectionHint(source, 3, 'ready'),
    endedBySemicolon: selfDeclaredInspectionHint(source, 3, 'pending'),
    endedByComparison: selfDeclaredInspectionHint(source, 4, 'user'),
    keywordInsideWord: selfDeclaredInspectionHint(source, 5, 'ter'),
    loopBinding: selfDeclaredInspectionHint(source, 6, 'row'),
  }
  // Assert
  assert.deepEqual(hints, {
    afterLongWhiteSpace:
      ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    afterComparison:
      ' Line 2 declares total, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    afterStatement:
      ' Line 3 declares ready, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.',
    endedBySemicolon: '',
    endedByComparison: '',
    keywordInsideWord: '',
    loopBinding: '',
  })
})
