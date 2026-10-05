import assert from 'node:assert/strict'
import { test } from 'node:test'

import { declaredInspectionBindings } from '../utils/declaredInspectionBindings'

// Value: protects=a stop whose own line declares a binding it requires being requested on the next line that can pause, and no other stop; fails_when=a `var`, a line that only reads the name or a longer name that begins with the binding counts as declaring it, or a const, a let or a destructured name does not; why_new=Cycle 0045 N14d-15 (DX-1 a); seam=none
test('a line declares an inspected binding for const, let and destructured names, and not for a var, a read or a longer name with the same beginning', () => {
  // Arrange
  const cases = {
    plainConst: ['const user = await getUser(email)', ['user.email']],
    plainLet: ['let total = sum(rows)', ['total']],
    arrayPattern: [
      '  const [state, dispatch] = useActionState(authenticate, undefined)',
      ['state', 'dispatch', 'pending'],
    ],
    objectPattern: [
      'const { data: rows, error } = await query()',
      ['rows', 'data', 'error.message', 'rows.length'],
    ],
    hoistedVar: ['var legacy = 1', ['legacy']],
    readOnly: ['return user.name', ['user']],
    longerName: ['const callbackUrl = read()', ['callback']],
    shorterName: ['const user = read()', ['username']],
  } as const
  // Act
  const declared = Object.fromEntries(
    Object.entries(cases).map(([name, [lineText, paths]]) => [
      name,
      declaredInspectionBindings(lineText, paths),
    ]),
  )
  // Assert
  assert.deepEqual(declared, {
    plainConst: ['user'],
    plainLet: ['total'],
    arrayPattern: ['state', 'dispatch'],
    objectPattern: ['rows', 'error'],
    hoistedVar: [],
    readOnly: [],
    longerName: [],
    shorterName: [],
  })
})
