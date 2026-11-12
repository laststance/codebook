import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectWikiSourceLines } from '../utils/selectWikiSourceLines'

// Value: protects=the excerpt of a long file whose question words match 80 or more lines: a doc comment inside an object literal brings the method it documents, closed by `},`, whole into the excerpt; fails_when=the excerpt keeps only the matching lines, so the comment arrives without the method body (Cycle 0121 F3, P03 createStore.ts:347-374), or the method's block is ended at the object's closing brace instead of its own; why_new=Cycle 0122 F3 (hypothesis A); seam=none; no_claim=that an editor model answers from the body
test('a doc comment matching the question brings the object method it documents into a long file excerpt', () => {
  // Arrange
  const lines = [
    'export function createSource(getState) {',
    '  return {',
    '    /**',
    "     * Sends the observable's current store value.",
    '     */',
    '    watch(observer) {',
    '      observer.next(getState())',
    '      return () => undefined',
    '    },',
    '    close() {',
    '      return undefined',
    '    },',
    '  }',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  for (const unitLine of [2, 3, 4, 5, 6, 7, 8])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
  assert.equal(selected.includes(9), false, 'close() stays out')
  assert.equal(selected.length, 80)
})

// Value: protects=a matching comment too long to travel with its function: the anchor line still comes with the declaration it documents, without the rest of the comment, so the unit stays within 40 lines; fails_when=the comment's length drops the declaration too (the anchor arrives alone, as before Cycle 0122), or the whole 41-line unit is taken past its 40-line limit; why_new=Cycle 0122 F3 (hypothesis A, the 40-line unit cap of D3); seam=none; no_claim=that 40 lines is the best cap for every repository
test('a comment that would take its function past 40 lines stays behind while the matching line brings the function', () => {
  // Arrange
  const lines = [
    '/**',
    " * Explains the store's observable bridge.",
    ...Array.from({ length: 35 }, (_, index) => ` * Detail ${index + 1}.`),
    ' */',
    'function bridge(getState) {',
    '  return getState()',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(1), 'the matching comment line is selected')
  for (const declarationLine of [38, 39, 40])
    assert.ok(
      selected.includes(declarationLine),
      `line ${declarationLine + 1} of bridge() is selected`,
    )
  assert.equal(selected.includes(0), false, 'the comment opener stays out')
  assert.equal(selected.includes(37), false, 'the comment closer stays out')
})

// Value: protects=an anchor in the doc comment of a function longer than the 40-line unit cap: it stays one line, so one long function cannot take half an excerpt; fails_when=the unit limit is not enforced and the 43-line function fills the excerpt in place of other matching lines; why_new=Cycle 0122 F3 (hypothesis A, D3); seam=none; no_claim=which lines of a long function would have answered
test('a matching doc comment of a function longer than 40 lines stays one line of the excerpt', () => {
  // Arrange
  const lines = [
    '/**',
    ' * Runs the observable store loop.',
    ' */',
    'function longLoop() {',
    ...Array.from({ length: 41 }, (_, index) => `  step(${index + 1})`),
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(1), 'the matching comment line is selected')
  assert.equal(selected.includes(3), false, 'longLoop() stays out')
  assert.equal(selected.includes(4), false, 'its first step stays out')
})

// Value: protects=a block whose closing brace is not at its declaration's indentation: the unit rule gives no unit rather than guessing an end; fails_when=the block end is taken from a brace at another indentation or from the first `}` anywhere, so a wrong span enters the excerpt; why_new=Cycle 0122 F3 (hypothesis A, the block-end rule); seam=none; no_claim=support for unformatted source
test('a block whose closing brace is not at its declaration indentation brings no unit', () => {
  // Arrange
  const lines = [
    '/**',
    ' * Reads the observable store.',
    ' */',
    'function misaligned() {',
    '    return 1',
    '  }',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(1), 'the matching comment line is selected')
  assert.equal(selected.includes(3), false, 'misaligned() stays out')
  assert.equal(selected.includes(4), false, 'its body stays out')
})

// Value: protects=a comment separated from the next code by a blank line: it documents nothing, so it brings no code; fails_when=the code after a blank line is taken as the comment's subject and enters the excerpt; why_new=Cycle 0122 F3 (hypothesis A, the comment rule); seam=none; no_claim=what the comment itself describes
test('a matching comment followed by a blank line brings no code into the excerpt', () => {
  // Arrange
  const lines = [
    '// The observable store keeps no history.',
    '',
    'function unrelated() {',
    '  return 1',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(0), 'the matching comment is selected')
  assert.equal(selected.includes(2), false, 'unrelated() stays out')
  assert.equal(selected.includes(3), false, 'its body stays out')
})

// Value: protects=an anchor on a declaration whose signature runs over several lines (generic parameters, a destructured parameter closed by `}: Props) {`): the whole signature, its block and the comment above come into the excerpt; fails_when=the signature's continued lines end the unit early, the `}` that closes the parameter object is read as the block's end, or the comment above is dropped; why_new=Cycle 0122 F3 (hypothesis A, multi-line signatures, as P03's createStore overloads have); seam=none; no_claim=every signature style a formatter can produce
test('a matching declaration with a signature over several lines comes whole with the comment above it', () => {
  // Arrange
  const lines = [
    '/** Builds the panel. */',
    'export function ObservableStorePanel<',
    '  State,',
    '>({',
    '  title,',
    '}: Props<State>) {',
    '  return render(title)',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4, 5, 6, 7])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=a run of `//` lines that documents a function: a matching line in the run brings the function and the whole run; fails_when=only block comments are recognized, so a `//` comment's function stays out of the excerpt; why_new=Cycle 0122 F3 (hypothesis A, the comment rule for `//` runs); seam=none; no_claim=that every `//` run documents the code below it
test('a matching line comment run brings the function it documents into the excerpt', () => {
  // Arrange
  const lines = [
    '// Hands the observable to the store.',
    '// Values arrive after each dispatch.',
    'function connect(source) {',
    '  source.listen(update)',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})
