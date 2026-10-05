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
      ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; a stop that requires user must be on a line after line 1, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 1.',
    renamed:
      ' Line 2 declares rows, so it has no value yet when the debugger pauses before that line runs; a stop that requires rows must be on a line after line 2, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 2.',
    renamedKey: '',
    arrayRest:
      ' Line 3 declares rest, so it has no value yet when the debugger pauses before that line runs; a stop that requires rest must be on a line after line 3, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 3.',
    hoistedVar: '',
    laterUse: '',
    annotated:
      ' Line 6 declares total, so it has no value yet when the debugger pauses before that line runs; a stop that requires total must be on a line after line 6, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 6.',
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
      ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; a stop that requires user must be on a line after line 1, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 1.',
    afterComparison:
      ' Line 2 declares total, so it has no value yet when the debugger pauses before that line runs; a stop that requires total must be on a line after line 2, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 2.',
    afterStatement:
      ' Line 3 declares ready, so it has no value yet when the debugger pauses before that line runs; a stop that requires ready must be on a line after line 3, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 3.',
    endedBySemicolon: '',
    endedByComparison: '',
    keywordInsideWord: '',
    loopBinding: '',
  })
})

// Value: protects=an agent whose required value was unavailable because the stop lies before the line that declares it; fails_when=the failure gives no word about the declaring line, or its advice ("declare the stop on a later line") leads to an earlier line that declares the binding again, as the Cursor agent of N14-d moved its stop from line 21 to line 20; why_new=Cycle 0045 N14d-15 (DX-1 c); seam=none
test('a required value declared on a later line of the citation than the paused one is named with its declaring line and the line the stop must follow', () => {
  // Arrange: the debugger paused on line 1; line 2 declares state, and the citation ends on line 3.
  const source = [
    "const callbackUrl = searchParams.get('callbackUrl')",
    'const [state, dispatch] = useActionState(authenticate, undefined)',
    'return state',
  ].join('\n')
  // Act
  const hints = {
    declaredLater: selfDeclaredInspectionHint(source, 1, 'state.message', 3),
    declaredAfterCitation: selfDeclaredInspectionHint(source, 1, 'state', 1),
  }
  // Assert
  assert.deepEqual(hints, {
    declaredLater:
      ' Line 2 declares state, after line 1 where the debugger paused, so it has no value yet there; a stop that requires state must be on a line after line 2, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 1.',
    declaredAfterCitation: '',
  })
})

// Value: protects=an agent whose stop paused inside the statement its declared line begins (a callback of `useMemo`) learning which line the stop must follow; fails_when=the hint reads only from the paused line on and says nothing, or names a declaration whose statement had already ended; why_new=Cycle 0045 review of N14d-15 (HIGH); seam=none
test('a required value declared by a statement the stop paused inside is named with the statement’s last line, and a statement that had ended gives no hint', () => {
  // Arrange: line 1 begins the declaration of total, which ends on line 3; line 4 reads it.
  const source = [
    'const total = useMemo(() => {',
    '  return items.reduce(sum, 0)',
    '}, [items])',
    'render(total)',
  ].join('\n')
  // Act
  const hints = {
    pausedInside: selfDeclaredInspectionHint(source, 2, 'total', 4, 1),
    pausedAfter: selfDeclaredInspectionHint(source, 4, 'total', 4, 1),
  }
  // Assert
  assert.deepEqual(hints, {
    pausedInside:
      ' Line 1 declares total in a statement that ends on line 3, and the debugger paused on line 2 inside it, so total has no value yet there; a stop that requires total must be on a line after line 3, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 1.',
    pausedAfter: '',
  })
})
