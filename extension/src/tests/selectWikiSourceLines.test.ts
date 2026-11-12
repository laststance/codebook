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

// Value: protects=the lines of every route identifier in a long file whose identifiers each begin a 40-line function: the first function comes whole, and the other identifiers' lines keep their places in the 80-line excerpt; fails_when=units are admitted greedily, so the first two whole functions fill the budget and the later identifiers' lines are left out (Cycle 0122 review round, OCR P1: Cycle 0119's priority rule partly undone); why_new=Cycle 0122 review round; seam=none; no_claim=which function a real route reply names first
test('route identifiers that each begin a long function all keep their lines in the excerpt', () => {
  // Arrange
  const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']
  const lines = names.flatMap((name) => [
    `export function ${name}Target() {`,
    ...Array.from({ length: 38 }, (_, index) => `  step(${index + 1})`),
    '}',
  ])

  // Act
  const selected = selectWikiSourceLines(
    lines,
    [],
    names.map((name) => `${name}target`),
  )

  // Assert
  for (const declarationLine of [0, 40, 80, 120, 160, 200])
    assert.ok(
      selected.includes(declarationLine),
      `line ${declarationLine + 1} is selected`,
    )
  assert.ok(selected.includes(39), 'the first function comes whole')
  assert.equal(selected.length, 80)
})

// Value: protects=a matching control-flow line: `if (…) {` stays one line instead of bringing its block, so blocks of common words do not take the excerpt from other matching lines; fails_when=every line ending with `{` brings its block, so an `if` body fills the budget (Cycle 0122 review round, OCR P2); why_new=Cycle 0122 review round; seam=none; no_claim=that the block's lines never matter
test('a matching if line brings no block of its own into the excerpt', () => {
  // Arrange
  const lines = [
    'if (storeReady) {',
    ...Array.from({ length: 10 }, (_, index) => `  prepare(${index + 1})`),
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store'])

  // Assert
  assert.ok(selected.includes(0), 'the if line is selected')
  assert.equal(selected.includes(1), false, 'its body stays out')
  assert.equal(selected.includes(11), false, 'its closer stays out')
})

// Value: protects=a comment that documents an if-else chain: the unit runs past `} else {` to the chain's last `}`; fails_when=the first `}` at the statement's indentation ends the unit, so the else branch is cut off (Cycle 0122 review round, OCR P2 and CodeRabbit major); why_new=Cycle 0122 review round; seam=none; no_claim=a chain longer than the 40-line cap
test('a comment documenting an if-else chain brings the whole chain', () => {
  // Arrange
  const lines = [
    '// Picks the observable store source.',
    'if (useCache) {',
    '  source = cache',
    '} else {',
    '  source = fetchSource()',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4, 5])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=a documented function whose return type is an object literal: the unit runs past the type's `} {` into the body; fails_when=the `{` of `): {` is taken as the body's opener and `} {` as its closer, so the body is cut off (Cycle 0122 review round, OCR P2); why_new=Cycle 0122 review round; seam=none; no_claim=every return type a formatter can produce
test('a documented function with an object return type comes whole', () => {
  // Arrange
  const lines = [
    '/** Builds the observable store view. */',
    'export function buildView(',
    '  options: Options,',
    '): {',
    '  title: string',
    '} {',
    '  return render(options)',
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

// Value: protects=a documented function whose parameter has an object type opened on the declaration line: the unit runs past `}) {` into the body; fails_when=the parameter type's `{` is taken as the body's opener and `}) {` as its closer, so the body is cut off (Cycle 0122 review round, OCR P2 and CodeRabbit major); why_new=Cycle 0122 review round; seam=none; no_claim=parameter types spread over other shapes
test('a documented function with an object parameter type comes whole', () => {
  // Arrange
  const lines = [
    '/** Reads the observable store options. */',
    'export function readOptions(options: {',
    '  path: string',
    '}) {',
    '  return load(options.path)',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4, 5])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=a documented call whose callback opens on a deeper line: the unit ends at the callback's own closer, never at a later declaration's; fails_when=the closer is searched at the declaration's indentation, so the scan runs past the call into the next function and the unit holds unrelated code (Cycle 0122 review round, OCR P2); why_new=Cycle 0122 review round; seam=none; no_claim=that the call's last `)` line is included
test('a documented call with a callback stops at the callback closer, not at the next function', () => {
  // Arrange
  const lines = [
    '// Wraps the observable store handler.',
    'export const handler = withAuth(',
    '  async (request) => {',
    '    return respond(request)',
    '  },',
    ')',
    'export function unrelated() {',
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
  for (const unitLine of [0, 1, 2, 3, 4])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
  assert.equal(selected.includes(6), false, 'unrelated() stays out')
  assert.equal(selected.includes(8), false, 'its closer stays out')
})

// Value: protects=a doc comment above a decorated class: the unit passes the decorator and brings the class; fails_when=the decorator line is taken as the documented code, so the unit is the comment and the decorator without the class (Cycle 0122 review round, OCR P2); why_new=Cycle 0122 review round; seam=none; no_claim=decorators written over several lines
test('a doc comment above a decorated class brings the class into the excerpt', () => {
  // Arrange
  const lines = [
    '/** Serves the observable store. */',
    '@Injectable()',
    'export class CacheService {',
    '  read() {',
    '    return 1',
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
  for (const unitLine of [0, 1, 2, 3, 4, 5, 6])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=a documented member signature without a body, last in its interface: the unit ends at the signature and leaves the interface's closing brace out; fails_when=a `}` that closes the scope around the declaration is taken as a continued signature line (Cycle 0122 review round, OCR P3); why_new=Cycle 0122 review round; seam=none; no_claim=members declared over several lines
test('a documented interface member keeps the interface closing brace out of its unit', () => {
  // Arrange
  const lines = [
    'export interface ReaderApi {',
    '  /** Reads the observable store. */',
    '  read(): State',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(1), 'the matching comment is selected')
  assert.ok(selected.includes(2), 'read() is selected')
  assert.equal(selected.includes(3), false, 'the closing brace stays out')
})

// Value: protects=the unit that answers when a route identifier matches nearly every line of a long file: each identifier keeps one place, not one per matching line, so the documented function still comes whole; fails_when=the reservation counts every line the identifier matches (78 here), leaving no room for the 6-line unit, which is F3 again under a route that names a common identifier such as `dispatch`; why_new=Cycle 0122 review round (the identifier reservation's own regression, found by rerunning the P03 reproduction); seam=none; no_claim=how a real route reply words its identifiers
test('a route identifier matching nearly every line keeps one place and leaves room for the unit that answers', () => {
  // Arrange
  const lines = [
    '/**',
    ' * Sends each dispatch to the observable store.',
    ' */',
    'function forward(observer) {',
    '  observer.next(state)',
    '}',
    ...Array.from({ length: 78 }, (_, index) => `dispatch(step${index + 1})`),
  ]

  // Act
  const selected = selectWikiSourceLines(
    lines,
    ['store', 'observable'],
    ['dispatch'],
  )

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4, 5])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
  assert.equal(selected.length, 80)
})

// Value: protects=a doc comment on the first overload of a function: the unit runs through the other overloads to the implementation's body; fails_when=the first overload's signature ends the unit, so the implementation the comment describes stays out of the excerpt (Cycle 0122 review round, CodeRabbit major); why_new=Cycle 0122 review round; seam=none; no_claim=overloads and an implementation longer than the 40-line cap together
test('a doc comment on the first overload brings the overloads and the implementation', () => {
  // Arrange
  const lines = [
    '/** Reads the observable store. */',
    'export function readCache(): Cache',
    'export function readCache(name: string): Cache',
    'export function readCache(name?: string): Cache {',
    '  return caches.get(name)',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4, 5])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=the third-best matching line of a long file whose two best matches each begin a 40-line function: the first function comes whole and the third match keeps its place; fails_when=units are admitted until the budget is full, so the two whole functions take all 80 lines and the third-best match, which may hold the answer, is dropped (Cycle 0122 review round, CodeRabbit minor); why_new=Cycle 0122 review round; seam=none; no_claim=that three kept lines suit every question
test('the three best matching lines keep their places when the two best bring 40-line functions', () => {
  // Arrange
  const lines = [
    'export function storeObservableOne() {',
    ...Array.from({ length: 38 }, (_, index) => `  step(${index + 1})`),
    '}',
    'export function storeObservableTwo() {',
    ...Array.from({ length: 38 }, (_, index) => `  step(${index + 1})`),
    '}',
    'export const storeOnly = 1',
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(39), 'the first function comes whole')
  assert.ok(selected.includes(40), 'the second function line is selected')
  assert.ok(selected.includes(80), 'the third-best match is selected')
  assert.equal(selected.length, 80)
})

// Value: protects=a matching `type` alias whose declaration opens no brace: its continued union lines come with it into the excerpt; fails_when=a declaration without `{` is read as one line, so the union members that answer the question are dropped; why_new=Cycle 0122 F3 audit: no test reaches DECLARATION_START or a signature with no block; seam=none; no_claim=that every brace-less declaration is complete
test('a matching type alias brings the union members on its continued lines into a long file excerpt', () => {
  // Arrange
  const lines = [
    'export type StoreObservable =',
    "  | 'idle'",
    "  | 'busy'",
    ...Array.from(
      { length: 100 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store'])

  // Assert
  assert.ok(selected.includes(0), 'the alias line is selected')
  assert.ok(selected.includes(1), 'the first union member is selected')
  assert.ok(selected.includes(2), 'the last union member is selected')
  assert.equal(selected.length, 80)
})

// Value: protects=a matching block comment followed by a `//` note: the comment documents no code, so the function after the note stays out; fails_when=the code after another comment is taken as the block comment's subject and enters the excerpt; why_new=Cycle 0122 F3 audit: no test covers a comment followed by another comment; seam=none; no_claim=what the note refers to
test('a matching block comment followed by a line comment brings no code into the excerpt', () => {
  // Arrange
  const lines = [
    '/** The observable store keeps no history. */',
    '// Kept for later.',
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
  assert.equal(
    selected.includes(1),
    false,
    'the line comment after it stays out',
  )
  assert.equal(selected.includes(2), false, 'unrelated() stays out')
  assert.equal(selected.includes(3), false, 'its body stays out')
})

// Value: protects=a 40-line function whose matching line ranks after 60 better lines: the budget left cannot hold it, so only its anchor line comes and the excerpt stays at 80 lines; fails_when=the budget check is dropped and the unit overfills the excerpt, or the anchor is lost with the unit; why_new=Cycle 0122 F3 audit: no test makes a unit give way to its anchor line for the budget left; seam=none; no_claim=which lines the dropped function would have shown
test('a function that does not fit the budget left gives way to its matching line', () => {
  // Arrange
  const lines = [
    ...Array.from(
      { length: 60 },
      (_, index) => `export const storeObservable${index} = ${index}`,
    ),
    'export function storeBridge() {',
    ...Array.from({ length: 38 }, (_, index) => `  step(${index + 1})`),
    '}',
    ...Array.from(
      { length: 40 },
      (_, index) => `export const storeSetting${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['store', 'observable'])

  // Assert
  assert.ok(selected.includes(60), 'the matching line is selected')
  assert.equal(selected.includes(70), false, 'the function body stays out')
  assert.equal(selected.length, 80)
})
