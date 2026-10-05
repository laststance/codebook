import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  declarationStatementEndLine,
  sourceLineCode,
} from '../utils/declarationStatementEndLine'

// Value: protects=a stop whose own line begins a declaration over several lines being requested after the whole statement, not inside its callback, its object literal or its call; fails_when=the end is taken from the declared line alone, a bracket inside a string, a template literal or a comment is counted, a continuation line is cut off, a statement that never closes in the citation is given an end, an escaped quote or an escaped backtick closes its literal, a block comment is forgotten at the end of its first line, or a `;` outside every bracket does not end the statement; why_new=Cycle 0045 review of N14d-15 (HIGH: useMemo and object-literal declarations were requested inside the statement), and its pre-landing review PL-28 for the last four rows (row 36 of Cycle 0046); seam=none
test('the last line of a declaration statement is found over a call, an arrow body and an object literal, past brackets in strings, templates and comments, and not for a statement that does not close in the citation', () => {
  // Arrange: each case is the source's lines, the declared line and the citation's last line.
  const cases = {
    singleLine: [['const user = find(email)', 'if (!user) return null'], 1, 2],
    multiLineCall: [
      [
        'const user = await db.user.findUnique({',
        '  where: { email },',
        '})',
        'return user',
      ],
      1,
      4,
    ],
    arrowBody: [
      [
        'const total = useMemo(() => {',
        '  return items.reduce(sum, 0)',
        '}, [items])',
        'return total',
      ],
      1,
      4,
    ],
    handlerBody: [
      [
        '  const onSubmit = async (event) => {',
        '    event.preventDefault()',
        '  }',
        '  return onSubmit',
      ],
      1,
      4,
    ],
    objectLiteral: [
      ['const options = {', "  mode: 'dark',", '}', 'apply(options)'],
      1,
      4,
    ],
    bracketInString: [["const label = '(' + name", 'render(label)'], 1, 2],
    templateAndComment: [
      [
        'const text = `a ${items.map((item) => `(${item})`).join(",")} {`',
        '// ) a closing bracket in a comment',
        'show(text) /* ( */',
      ],
      1,
      3,
    ],
    continuationLine: [
      [
        'const rows = items',
        '  .filter(isOpen)',
        '  // keep the order',
        '  .map(toRow)',
        'render(rows)',
      ],
      1,
      5,
    ],
    operatorAtEnd: [['const mode = ready &&', '  dark', 'apply(mode)'], 1, 3],
    neverCloses: [
      ['const total = useMemo(() => {', '  return items.reduce(sum, 0)'],
      1,
      2,
    ],
    continuesPastCitation: [
      ['const rows = items', '  .filter(isOpen)', '  .map(toRow)'],
      1,
      2,
    ],
    enclosingBlockCloses: [
      ['if (ready) { const total = sum(rows) }', 'render()'],
      1,
      2,
    ],
    // The escaped quote stays inside the string, so the `(` after it is text.
    escapedQuoteInString: [
      ["const label = 'it\\'s (' + name", 'render(label)'],
      1,
      2,
    ],
    // The comment opened on the first line hides the `)` and the `;` of the second.
    blockCommentAcrossLines: [
      [
        'const total = sum( /* the rows',
        '  ) are counted; */',
        '  rows)',
        'render(total)',
      ],
      1,
      4,
    ],
    // The `;` ends the first statement; the `[` after it belongs to the next one.
    semicolonMidLine: [
      ['const first = head; const rest = [', '  tail,', ']'],
      1,
      3,
    ],
    // The scanner skips an escape in a template literal as it does in a string: the escaped backtick does not close the literal and the escaped `${` opens no substitution, so the statement ends on its own line.
    escapeInTemplate: [
      ['const text = `a \\` ( \\${` + name', 'render(text)'],
      1,
      2,
    ],
  } as const
  // Act
  const ends = Object.fromEntries(
    Object.entries(cases).map(([name, [lines, startLine, endLine]]) => [
      name,
      declarationStatementEndLine(lines, startLine, endLine),
    ]),
  )
  // Assert
  assert.deepEqual(ends, {
    singleLine: 1,
    multiLineCall: 3,
    arrowBody: 3,
    handlerBody: 3,
    objectLiteral: 3,
    bracketInString: 1,
    templateAndComment: 1,
    continuationLine: 4,
    operatorAtEnd: 2,
    neverCloses: undefined,
    continuesPastCitation: undefined,
    enclosingBlockCloses: undefined,
    escapedQuoteInString: 1,
    blockCommentAcrossLines: 3,
    semicolonMidLine: 1,
    escapeInTemplate: 1,
  })
})

// Value: protects=the end of a declaration statement being searched from the declaration's own keyword, not from a `const` or `let` in a string, a template literal or a comment before it on the line; fails_when=the keyword search reads the line with its strings and comments, so the scan starts inside them and finds no end (the stop is then left on a line whose statement has not run); why_new=Cycle 0045 PL-15 (row 23 of Cycle 0046); seam=none
test('the statement end is searched from the declaration in code, past a const or let in a string, a template literal, a line comment or a block comment', () => {
  // Arrange: each case is the source's lines, the declared line and the citation's last line.
  const cases = {
    keywordInString: [
      ["log('let a'); const total = sum(rows)", 'render(total)'],
      1,
      2,
    ],
    keywordInTemplate: [
      ['log(`const ${name} = (`); let total = 0', 'render(total)'],
      1,
      2,
    ],
    keywordInLineComment: [
      ['count += 1; // const total = (', 'render(total)'],
      1,
      2,
    ],
    keywordInBlockComment: [
      ['/* let draft = ( */ const total = sum(rows)', 'render(total)'],
      1,
      2,
    ],
  } as const
  // Act
  const ends = Object.fromEntries(
    Object.entries(cases).map(([name, [lines, startLine, endLine]]) => [
      name,
      declarationStatementEndLine(lines, startLine, endLine),
    ]),
  )
  // Assert
  assert.deepEqual(ends, {
    keywordInString: 1,
    keywordInTemplate: 1,
    keywordInLineComment: 1,
    keywordInBlockComment: 1,
  })
})

// Value: protects=the declaration search and the statement-end search reading only a line's code at the columns the line has; fails_when=a comment, a string or a template literal is kept, an escaped quote ends its string, a template substitution is blanked, or the line changes its length so a found keyword points at another column; why_new=Cycle 0045 PL-15 (row 23 of Cycle 0046); seam=none
test('the code of a line keeps every column and blanks its comments, strings and template literals, an escaped quote and a template substitution included', () => {
  // Arrange
  const lines = [
    'count += 1; // Previously: const count = initial',
    "log('it\\'s', \"a;b\"); /* let x */ go()",
    'log(`let ${value} = 1`)',
  ]
  // Act
  const codes = lines.map((lineText) => sourceLineCode(lineText))
  // Assert
  assert.deepEqual(codes, [
    'count += 1;                                     ',
    'log(       ,      );             go()',
    'log(       value      )',
  ])
})
