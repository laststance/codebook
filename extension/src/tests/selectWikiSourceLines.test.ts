import assert from 'node:assert/strict'
import { test } from 'node:test'

import { longDeclarationHeadOfLine } from '../utils/codeUnitOfLine'
import { declaresPriorityTerm } from '../utils/declaresPriorityTerm'
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

// Value: protects=a route identifier's only line after many lines of another identifier: ordinary anchors leave the places reserved for kept lines, so `beta()` stays in the excerpt; fails_when=the single-line fallback takes a reserved place anyway, so 50 `alpha()` calls fill the budget and the identifier the route reply named is dropped (Cycle 0122 /ship pass 1, Codex P2 and outside voice, Blocks: yes); why_new=Cycle 0122 /ship pass 1; seam=none; no_claim=which identifiers a real route reply names
test('ordinary matches leave the reserved place of a route identifier whose only line comes last', () => {
  // Arrange
  const lines = [
    'function alpha() {',
    ...Array.from({ length: 38 }, () => '  step()'),
    '}',
    ...Array.from({ length: 50 }, (_, index) => `alpha(${index})`),
    'beta()',
  ]

  // Act
  const selected = selectWikiSourceLines(lines, [], ['alpha', 'beta'])

  // Assert
  assert.ok(selected.includes(90), "beta()'s line is selected")
  assert.ok(selected.includes(39), 'the alpha function comes whole')
  assert.equal(selected.length, 80)
})

// Value: protects=a documented function whose parameter object type opens on an indented line of its multi-line signature: the unit runs past the type's closer to the body; fails_when=the type's `{` is taken as the body's opener and its `},` as the closer, so the body is cut off (Cycle 0122 /ship pass 1, Codex P2 and outside voice, Blocks: yes); why_new=Cycle 0122 /ship pass 1; seam=none; no_claim=type literals nested several levels deep
test('a documented function whose parameter type opens on an indented signature line comes whole', () => {
  // Arrange
  const lines = [
    '/** observable store */',
    'export function read(',
    '  options: {',
    '    path: string',
    '  },',
    ') {',
    '  return load(options.path)',
    '}',
    ...Array.from(
      { length: 100 },
      (_, index) => `const store${index} = ${index}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['observable', 'store'])

  // Assert
  for (const unitLine of [0, 1, 2, 3, 4, 5, 6, 7])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=a matching method whose signature goes on over the next lines: the anchor on `observableStore(` brings the method and its body; fails_when=only a keyword declaration or a line ending with `{` begins a unit, so a split method signature stays one line (Cycle 0122 /ship pass 1, Codex P2); why_new=Cycle 0122 /ship pass 1; seam=none; no_claim=method signatures split before the name
test('a matching method signature split over lines brings the method into the excerpt', () => {
  // Arrange
  const lines = [
    'class Reader {',
    '  observableStore(',
    '    options: Options,',
    '  ) {',
    '    return load(options.path)',
    '  }',
    '}',
    ...Array.from({ length: 100 }, () => 'store()'),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['observable', 'store'])

  // Assert
  for (const unitLine of [1, 2, 3, 4, 5])
    assert.ok(selected.includes(unitLine), `line ${unitLine + 1} is selected`)
})

// Value: protects=the 40-line unit cap when a matching comment sits above a 40-line function: the comment cannot travel with it, and the anchor line plus the function would make 41 lines, so the anchor stays one line; fails_when=the detached anchor line is added back after the size check, giving a 41-line unit past WIKI_CONTEXT_UNIT_LINE_LIMIT and the README's 40 lines (Cycle 0122 /ship pass 1, Codex P3); why_new=Cycle 0122 /ship pass 1; seam=none; no_claim=which lines of that function would answer
test('a matching comment above a 40-line function stays one line, keeping units within 40 lines', () => {
  // Arrange
  const lines = [
    '/** observable store */',
    'function read() {',
    ...Array.from({ length: 38 }, () => '  step()'),
    '}',
    ...Array.from({ length: 100 }, () => 'store()'),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['observable', 'store'])

  // Assert
  assert.ok(selected.includes(0), 'the matching comment is selected')
  assert.equal(selected.includes(1), false, 'read() stays out')
  assert.equal(selected.length, 80)
})

/**
 * Builds a function of `lineCount` lines, closing brace included, that begins at its first line.
 * @param name - The function's name, printed on the declaration line.
 * @param lineCount - The function's total line count, at least 3.
 * @param indentation - The text before every line.
 * @returns The function's source lines.
 * @example
 * functionOf('pasteItem', 3, '') // => ['function pasteItem() {', '  step(1)', '}']
 */
function functionOf(
  name: string,
  lineCount: number,
  indentation = '',
): string[] {
  return [
    `${indentation}function ${name}() {`,
    ...Array.from(
      { length: lineCount - 2 },
      (_, index) => `${indentation}  step(${index + 1})`,
    ),
    `${indentation}}`,
  ]
}

/**
 * Builds lines that each match the ordinary term `filler`, so each is a ranked anchor of its own.
 * @param count - How many lines to build.
 * @returns The lines `export const filler0 = 0`, `export const filler1 = 1`, and so on.
 * @example
 * fillerLines(2) // => ['export const filler0 = 0', 'export const filler1 = 1']
 */
function fillerLines(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `export const filler${index} = ${index}`,
  )
}

/**
 * Builds lines that match no test term.
 * @param count - How many lines to build.
 * @returns The lines `export const other0 = 0`, and so on.
 * @example
 * otherLines(1) // => ['export const other0 = 0']
 */
function otherLines(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `export const other${index} = ${index}`,
  )
}

// Value: protects=the head of a function just over the 40-line unit cap (P06's 44-line pasteItem): the excerpt takes its first 40 lines, so the branches that create the pasted bookmark and folder reach the editor model; fails_when=a function past the cap falls back to scattered lines again (Cycle 0123 F3, Issue 316), or the head is taken from the comment or past line 40; why_new=Cycle 0123 F3; seam=none; no_claim=that every long function answers from its first 40 lines
test('a 44-line function matching a route identifier brings its first 40 lines into a long file excerpt', () => {
  // Arrange
  const lines = [
    ...functionOf('pasteItem', 44),
    ...otherLines(60),
    ...fillerLines(20),
    ...otherLines(100),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['filler'], ['pasteitem'])

  // Assert
  for (let line = 0; line < 40; line++)
    assert.ok(
      selected.includes(line),
      `line ${line + 1} of pasteItem is selected`,
    )
  assert.equal(selected.includes(43), false, 'the closing brace stays out')
  assert.equal(selected.length, 80)
})

// Value: protects=whole units over heads: a whole function ranked after a long function's anchor is placed whole before the long function's head takes what is left; fails_when=heads are placed with the anchors in rank order, so the 40-line head takes the places a whole unit needed and the unit arrives cut; why_new=Cycle 0123 F3 design (second pass after the whole units); seam=none; no_claim=which of the two the model needs more
test('a whole function ranked after a long function is never displaced by the long function head', () => {
  // Arrange
  const lines = [
    ...functionOf('longPaste', 44),
    ...functionOf('shortUnit', 30),
    ...fillerLines(25),
    ...otherLines(100),
  ]

  // Act
  const selected = selectWikiSourceLines(
    lines,
    ['filler', 'shortunit'],
    ['longpaste'],
  )

  // Assert
  for (let line = 44; line < 74; line++)
    assert.ok(
      selected.includes(line),
      `line ${line + 1} of shortUnit is selected`,
    )
  assert.ok(selected.includes(0), 'the long function declaration is selected')
  assert.ok(
    selected.includes(20),
    'the long function head is cut to the places left',
  )
  assert.equal(selected.length, 80)
})

// Value: protects=the 10-line minimum of a head: with fewer places left only the anchor line comes, so a sliver of a function does not displace matches; fails_when=a head is cut to any length, taking the last places for 4 lines that explain nothing; why_new=Cycle 0123 F3 design (minimum head); seam=none; no_claim=that 10 lines is the best minimum
test('a long function whose head cannot get 10 lines in the places left brings only its anchor line', () => {
  // Arrange
  const lines = [
    ...functionOf('longPaste', 44),
    ...fillerLines(75),
    ...otherLines(50),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['filler', 'longpaste'], [])

  // Assert
  assert.ok(selected.includes(0), 'the anchor line is selected')
  assert.equal(selected.includes(20), false, 'the function body stays out')
  assert.equal(selected.length, 80)
})

// Value: protects=a long block left by a dedent: a line less indented than the declaration before the block closes brings no head, as it brought no unit; fails_when=the head is taken for a malformed block, so lines of the next scope enter the excerpt; why_new=Cycle 0123 F3 design (too long versus malformed); seam=none; no_claim=support for unformatted source
test('a long block left by a dedent before it closes brings no head', () => {
  // Arrange
  const body = functionOf('longPaste', 44, '  ')
  body[10] = 'misplaced()'
  const lines = [
    ...body,
    ...otherLines(60),
    ...fillerLines(20),
    ...otherLines(100),
  ]

  // Act
  const selected = selectWikiSourceLines(lines, ['filler'], ['longpaste'])

  // Assert
  assert.ok(selected.includes(0), 'the anchor line is selected')
  assert.equal(selected.includes(30), false, 'the function body stays out')
})

// Value: protects=the answer to a question about a paste in P06's fullpage.js: with the route identifiers pasteItem and clipboard, the 44-line pasteItem brings the lines that create the bookmark and the folder; fails_when=the create branches fall out of the excerpt as in H1 run 2, so the answer says what is duplicated cannot be determined; why_new=Cycle 0123 F3 end-to-end; seam=none; no_claim=the real file's exact line numbers
test('a question routed to a 44-line paste function brings the lines that create the bookmark and the folder', () => {
  // Arrange
  const pasteItem = [
    'async function pasteItem() {',
    '  const folderId = pane.currentFolderId',
    '  const source = clipboard.item',
    ...Array.from({ length: 18 }, (_, index) => `  guard(${index})`),
    '  if (source.url) {',
    '    await chrome.bookmarks.create({ parentId: folderId, url: source.url })',
    '  } else {',
    '    // Copy folder (shallow - just the folder itself)',
    '    await chrome.bookmarks.create({ parentId: folderId, title: source.title })',
    '  }',
    ...Array.from({ length: 17 }, (_, index) => `  refresh(${index})`),
    '}',
  ]
  const lines = [
    ...Array.from({ length: 30 }, (_, index) => [
      `clipboardNoise${index}()`,
      ...otherLines(9),
    ]).flat(),
    ...pasteItem,
    ...Array.from(
      { length: 200 },
      (_, index) => `function unrelated${index}() {}`,
    ),
  ]

  // Act
  const selected = selectWikiSourceLines(
    lines,
    ['paste'],
    ['pasteitem', 'clipboard', 'currentfolderid'],
  )

  // Assert
  for (let line = 321; line <= 326; line++)
    assert.ok(selected.includes(line), `line ${line + 1} is selected`)
  assert.equal(selected.length, 80)
})

// Value: protects=the boundary between a whole unit and a head: a function of exactly 40 lines is a whole unit with no head, and one of 41 lines has the head of its first 40; fails_when=the boundary moves by one line, so a unit also gets a head or a long function gets none; why_new=Cycle 0123 F3; seam=none; no_claim=lines outside the declaration
test('a function has a head only when it is longer than 40 lines', () => {
  // Arrange
  const exactlyFortyLines = functionOf('fits', 40)
  const fortyOneLines = functionOf('exceeds', 41)

  // Act
  const fitsHead = longDeclarationHeadOfLine(exactlyFortyLines, 0)
  const exceedsHead = longDeclarationHeadOfLine(fortyOneLines, 0)

  // Assert
  assert.equal(fitsHead, undefined)
  assert.equal(exceedsHead?.length, 40)
  assert.equal(exceedsHead?.[39], 39)
})

// Value: protects=the head of the function a route names when other route identifiers are common members that match many lines (chrome.bookmarks.create and its member create across the file): the declaration of the named function ranks first, so its head is placed before single lines of the members; fails_when=the declaration ranks with the call sites and 60 create lines take every place before pasteItem's head, so its create branches are missing (Cycle 0123 F3, realistic route reply: 2 of 13 lines); why_new=Cycle 0123 F3 design v3; seam=none; no_claim=which identifiers a real route reply names
test('a route naming a function, a dotted member and its common last part still brings the head of the function', () => {
  // Arrange
  const pasteItem = [
    'async function pasteItem() {',
    '  const folderId = pane.currentFolderId',
    ...Array.from({ length: 20 }, (_, index) => `  guard(${index})`),
    '  if (source.url) {',
    '    await chrome.bookmarks.create({ parentId: folderId, url: source.url })',
    '  } else {',
    '    await chrome.bookmarks.create({ parentId: folderId, title: source.title })',
    '  }',
    ...Array.from({ length: 17 }, (_, index) => `  refresh(${index})`),
    '}',
  ]
  const lines = [
    ...otherLines(10),
    ...Array.from({ length: 60 }, (_, index) => [
      `await chrome.bookmarks.create({ title: "other${index}" })`,
      ...otherLines(5),
    ]).flat(),
    ...pasteItem,
  ]

  // Act
  const selected = selectWikiSourceLines(
    lines,
    ['paste'],
    ['pasteitem', 'chrome.bookmarks.create', 'create', 'currentfolderid'],
  )

  // Assert
  const declarationLine = lines.length - pasteItem.length
  for (let offset = 0; offset < 40; offset++)
    assert.ok(
      selected.includes(declarationLine + offset),
      `line ${offset + 1} of pasteItem is selected`,
    )
  assert.equal(selected.length, 80)
})

// Value: protects=a dotted route identifier and its last part counting once on a line: a line holding chrome.bookmarks.create does not score two matches and outrank a line holding two different identifiers; fails_when=the member is counted again, so the call line ties with and beats a line of two identifiers and takes the 80th place; why_new=Cycle 0123 F3 design v3; seam=none; no_claim=which identifiers a real route reply names
test('a line holding a dotted route identifier counts one match, not one for the identifier and one for its last part', () => {
  // Arrange
  const lines = [
    'await clipboard.read(); const folder = currentFolderId',
    ...Array.from({ length: 80 }, () => 'clipboard.write()'),
    ...otherLines(100),
    'await chrome.bookmarks.create(details)',
    ...otherLines(100),
  ]
  const callLine = lines.length - 101

  // Act
  const selected = selectWikiSourceLines(
    lines,
    [],
    ['clipboard', 'currentfolderid', 'chrome.bookmarks.create', 'create'],
  )

  // Assert
  assert.ok(selected.includes(0), 'the line of two identifiers is selected')
  assert.equal(
    selected.includes(callLine),
    false,
    'the dotted call line ranks last',
  )
})

// Value: protects=the declaration of a route identifier ranking above call sites of two other identifiers: 85 lines that each hold two other identifiers cannot push the named function out of the 80 anchors; fails_when=lines are ranked by the number of identifiers they hold, so the declaration (one identifier) ranks 86th and its whole unit never enters the excerpt; why_new=Cycle 0123 F3 design v3; seam=none; no_claim=which identifiers a real route reply names
test('the declaration of a route identifier outranks call sites of two other route identifiers', () => {
  // Arrange
  const lines = [
    ...Array.from({ length: 85 }, (_, index) => [
      `alpha(beta, ${index})`,
      ...otherLines(2),
    ]).flat(),
    ...otherLines(100),
    ...functionOf('pasteItem', 6),
  ]
  const declarationLine = lines.length - 6

  // Act
  const selected = selectWikiSourceLines(
    lines,
    [],
    ['alpha', 'beta', 'pasteitem'],
  )

  // Assert
  for (let offset = 0; offset < 6; offset++)
    assert.ok(
      selected.includes(declarationLine + offset),
      `line ${offset + 1} of pasteItem is selected`,
    )
})

// Value: protects=only a real declaration of a route identifier earns the declaration bonus; fails_when=a callback or call line, or an empty or path-like term, is scored as a declaration, or a function, const or method head is not; why_new=only keyword and dotted cases are hit indirectly; seam=none; no_claim=route ranking quality (pure function)
test('declaresPriorityTerm accepts function, const and method heads and rejects callbacks and non-identifier terms', () => {
  // Arrange
  const cases: [string, string, boolean][] = [
    ['function f(a) {', 'f', true],
    ['const f = async () => {', 'f', true],
    ['  f(a) {', 'f', true],
    ['  f(() => {', 'f', false],
    ['function a() {', 'a.', false],
    ['function a() {', 'a/b', false],
  ]

  // Act
  const results = cases.map(([line, term]) =>
    declaresPriorityTerm(line, [term]),
  )

  // Assert
  assert.deepEqual(
    results,
    cases.map(([, , expected]) => expected),
  )
})
