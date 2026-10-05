import assert from 'node:assert/strict'
import { test } from 'node:test'

import { declaredInspectionBindings } from '../utils/declaredInspectionBindings'

// Value: protects=a stop whose own line declares a binding it requires being requested on the next line that can pause, and no other stop; fails_when=a `var`, a line that only reads the name, a longer name that begins with the binding, a name assigned in a loop body after `for (const item of items)` or a member of a plain declaration's type counts as declaring it, or a const, a let or a destructured name does not; why_new=Cycle 0045 N14d-15 (DX-1 a); seam=none
test("a line declares an inspected binding for const, let and destructured names, and not for a var, a read, a longer name with the same beginning, the type annotation after a pattern, a name in a loop body after the head or a member of a plain declaration's type", () => {
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
    annotatedObjectPattern: [
      'const { user }: Session = await load()',
      ['Session', 'user'],
    ],
    annotatedArrayPattern: [
      'const [first]: Tuple = read()',
      ['Tuple', 'first'],
    ],
    hoistedVar: ['var legacy = 1', ['legacy']],
    readOnly: ['return user.name', ['user']],
    longerName: ['const callbackUrl = read()', ['callback']],
    shorterName: ['const user = read()', ['username']],
    loopBodyAssignment: [
      'for (const item of items) { total = total + item.price }',
      ['total'],
    ],
    annotatedObjectType: [
      'const config: { user: User } = load()',
      ['user', 'config.user'],
    ],
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
    annotatedObjectPattern: ['user'],
    annotatedArrayPattern: ['first'],
    hoistedVar: [],
    readOnly: [],
    longerName: [],
    shorterName: [],
    loopBodyAssignment: [],
    annotatedObjectType: ['config'],
  })
})

// Value: protects=a stop declared on a line whose code changes a required value, with a declaration of that name only in a comment or a string on the same line, staying on its line so it reads the value before the change; fails_when=the declaration search reads a `const` or `let` in a line comment, a block comment, a string or a template literal, so the stop is requested after the line and reads the value after the increment, or a string with an escaped quote hides a real declaration after it; why_new=Cycle 0045 PL-15 (row 23 of Cycle 0046); seam=none
test('a const or let that stands only in a comment, a string or a template literal declares nothing, so a stop on `count += 1; // Previously: const count = initial` stays on its declared line', () => {
  // Arrange
  const cases = {
    lineCommentAfterCode: [
      'count += 1; // Previously: const count = initial',
      ['count'],
    ],
    blockCommentBeforeCode: ['/* const count = 0 */ count += 1', ['count']],
    doubleQuotedString: ['log("const count = 1"); count += 1', ['count']],
    templateLiteral: ['log(`let count = ${count}`); count += 1', ['count']],
    escapedQuoteBeforeDeclaration: [
      "log('it\\'s'); const count = next()",
      ['count'],
    ],
    declarationBeforeComment: [
      'const count = initial // the first count',
      ['count'],
    ],
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
    lineCommentAfterCode: [],
    blockCommentBeforeCode: [],
    doubleQuotedString: [],
    templateLiteral: [],
    escapedQuoteBeforeDeclaration: ['count'],
    declarationBeforeComment: ['count'],
  })
})
