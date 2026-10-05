import assert from 'node:assert/strict'
import { test } from 'node:test'

import { numberSourceLines } from '../utils/numberSourceLines'

// Value: protects=the line numbers codebook_source gives for CRLF and CR sources matching the lines lineCount and citation checks count; fails_when=only LF ends a line, so a CR stays in the copy or a CR-only file is one line; why_new=the protocol test uses LF only; seam=none
test('a numbered source counts a line at every CRLF, CR and LF, drops the line endings and numbers the empty line after a final line end', () => {
  // Arrange: each case is a source text as a tracked file may hold it.
  const sources = {
    windowsLineEnds:
      'const email = read()\r\n\r\nexport const user = find(email)',
    classicMacLineEnds: 'const email = read()\rexport const user = find(email)',
    mixedLineEnds: 'first()\r\nsecond()\nthird()\rfourth()',
    finalLineEnd: 'const email = read()\r\n',
    emptyText: '',
  }
  // Act
  const numbered = Object.fromEntries(
    Object.entries(sources).map(([name, text]) => [
      name,
      numberSourceLines(text),
    ]),
  )
  // Assert
  assert.deepEqual(numbered, {
    windowsLineEnds:
      '1\tconst email = read()\n2\t\n3\texport const user = find(email)',
    classicMacLineEnds:
      '1\tconst email = read()\n2\texport const user = find(email)',
    mixedLineEnds: '1\tfirst()\n2\tsecond()\n3\tthird()\n4\tfourth()',
    finalLineEnd: '1\tconst email = read()\n2\t',
    emptyText: '1\t',
  })
})
