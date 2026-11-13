import assert from 'node:assert/strict'
import { test } from 'node:test'

import { declaredNamesOf } from '../utils/declaredNamesOf'

/** One row of Issue #320's table: a trimmed source line and the names it declares. */
const DECLARATION_ROWS: { line: string; names: string[]; behavior: string }[] =
  [
    {
      line: 'export async function pasteItem(paneNum) {',
      names: ['pasteItem'],
      behavior: 'an exported async function declaration names the function',
    },
    {
      line: 'function save(',
      names: ['save'],
      behavior:
        'a function whose parameters start on the next line still names the function',
    },
    {
      line: 'export default class Store {',
      names: ['Store'],
      behavior: 'an exported default class names the class',
    },
    {
      line: 'const load = async () => {',
      names: ['load'],
      behavior: 'a constant holding an async arrow function names the constant',
    },
    {
      line: 'const f = <T,>(x: T) => {',
      names: ['f'],
      behavior:
        'a constant holding a generic arrow function names the constant',
    },
    {
      line: 'const f: Handler = (x) => {',
      names: ['f'],
      behavior:
        'a constant with a type annotation holding an arrow function names the constant',
    },
    {
      line: 'const handle = item => item.id',
      names: ['handle'],
      behavior:
        'a constant holding a single-parameter arrow function names the constant',
    },
    {
      line: 'const g = function () {',
      names: ['g'],
      behavior: 'a constant holding a function expression names the constant',
    },
    {
      line: 'static async refresh(id) {',
      names: ['refresh'],
      behavior: 'a static async method head names the method',
    },
    {
      line: 'get size() {',
      names: ['size'],
      behavior: 'a getter head names the accessor',
    },
    {
      line: 'pasteItem(source) {',
      names: ['pasteItem'],
      behavior: 'a bare method head names the method',
    },
    {
      line: 'const pasteItem =',
      names: [],
      behavior:
        'a constant whose value starts on the next line declares no name',
    },
    {
      line: 'save(item: Item)',
      names: [],
      behavior:
        'a method head whose brace is on the next line declares no name',
    },
    {
      line: 'const state = {',
      names: [],
      behavior: 'a constant holding an object declares no name',
    },
    {
      line: 'if (ready) {',
      names: [],
      behavior: 'a control statement declares no name',
    },
    {
      line: 'pasteItem(() => {',
      names: [],
      behavior: 'a call that opens a callback declares no name',
    },
    {
      line: 'function* gen() {',
      names: ['gen'],
      behavior:
        'a generator declaration with the star beside the keyword names the generator',
    },
    {
      line: 'function *gen() {',
      names: ['gen'],
      behavior:
        'a generator declaration with the star beside the name names the generator',
    },
    {
      line: 'function*gen() {',
      names: ['gen'],
      behavior:
        'a generator declaration with no space around the star names the generator',
    },
    {
      line: 'function foo(a) {',
      names: ['foo'],
      behavior: 'a function declaration names the function',
    },
    {
      line: 'functionName(a) {',
      names: ['functionName'],
      behavior:
        'a method whose name starts with the word function names the method',
    },
    {
      line: 'functions.push(x)',
      names: [],
      behavior: 'a call on a variable named functions declares no name',
    },
    {
      line: 'functionCall()',
      names: [],
      behavior:
        'a call to a function whose name starts with function declares no name',
    },
    {
      line: 'functionExists(value)',
      names: [],
      behavior: 'a call to functionExists declares no name',
    },
    {
      line: 'functionality = 1',
      names: [],
      behavior:
        'an assignment to a variable starting with function declares no name',
    },
    {
      line: 'transform(fn: (value: string) => string) {',
      names: ['transform'],
      behavior: 'a method with a function-typed parameter names the method',
    },
    {
      line: 'run(callback = () => {}) {',
      names: ['run'],
      behavior: 'a method with an arrow default value names the method',
    },
    {
      line: 'save(item: Item): Promise<void> {',
      names: ['save'],
      behavior: 'a method with a return type annotation names the method',
    },
    {
      line: 'setState({',
      names: [],
      behavior: 'a call that opens an object argument declares no name',
    },
    {
      line: 'fetch(url, {',
      names: [],
      behavior: 'a call with an options object declares no name',
    },
    {
      line: 'dispatch({',
      names: [],
      behavior: 'a dispatch call that opens an object declares no name',
    },
    {
      line: 'onClick(e => {',
      names: [],
      behavior:
        'a call that opens a single-parameter callback declares no name',
    },
    {
      line: 'pasteItem(function () {',
      names: [],
      behavior: 'a call that opens a function expression declares no name',
    },
    {
      line: 'const result = (items.map(item => item))',
      names: [],
      behavior:
        'a constant holding a parenthesized call with an arrow inside declares no name',
    },
    {
      line: 'const f = (a, b) => {',
      names: ['f'],
      behavior:
        'a constant holding an arrow with two parameters names the constant',
    },
    {
      line: 'const g = async (x: T): Promise<void> => {',
      names: ['g'],
      behavior:
        'a constant holding an async arrow with a return type names the constant',
    },
    {
      line: 'const h = (cb: (v: string) => void) => {',
      names: ['h'],
      behavior:
        'a constant holding an arrow with a function-typed parameter names the constant',
    },
    {
      line: 'set size(value) {',
      names: ['size'],
      behavior: 'a setter head names the accessor',
    },
    {
      line: 'class extends Base {',
      names: [],
      behavior: 'a class expression without a name declares no name',
    },
    {
      line: 'let handler = (event) => {',
      names: ['handler'],
      behavior: 'a let holding an arrow function names the variable',
    },
    {
      line: 'var legacy = function () {',
      names: ['legacy'],
      behavior: 'a var holding a function expression names the variable',
    },
    {
      line: '/* function old() {',
      names: [],
      behavior: 'a block comment opening declares no name',
    },
    {
      line: '* function old() {',
      names: [],
      behavior: 'a block comment continuation declares no name',
    },
    {
      line: 'for (const item of items) {',
      names: [],
      behavior: 'a for statement declares no name',
    },
    {
      line: 'while (running) {',
      names: [],
      behavior: 'a while statement declares no name',
    },
    {
      line: 'switch (kind) {',
      names: [],
      behavior: 'a switch statement declares no name',
    },
    {
      line: 'catch (error) {',
      names: [],
      behavior: 'a catch clause declares no name',
    },
    {
      line: 'with (scope) {',
      names: [],
      behavior: 'a with statement declares no name',
    },
    {
      line: 'return (value) {',
      names: [],
      behavior: 'a return of a parenthesis and brace declares no name',
    },
    {
      line: 'function (value) {',
      names: [],
      behavior: 'an anonymous function expression declares no name',
    },
    {
      line: 'run(options, async function () {',
      names: [],
      behavior:
        'a call that passes an async function expression after another argument declares no name',
    },
    {
      line: '// function old() {',
      names: [],
      behavior: 'a commented-out declaration declares no name',
    },
  ]

for (const row of DECLARATION_ROWS) {
  // Value: protects=the names a long source offers a Wiki route request (the row of Issue #320's table for this line): the line's declared name is listed, or nothing when the line declares none; fails_when=a function, class or method name is dropped (the model cannot route to a function no page names, Cycle 0124 6F) or a value, call, statement or comment adds a name the source does not declare; why_new=Cycle 0125 F3b (Issue #320); seam=none; no_claim=that the model picks the listed name
  test(`${row.behavior}: ${row.line}`, () => {
    // Arrange
    const lines = [row.line]

    // Act
    const names = declaredNamesOf(lines)

    // Assert
    assert.deepEqual(names, row.names)
  })
}

// Value: protects=the order and spelling of a source's declared names: source order, one entry per name, case kept; fails_when=names are sorted, lowercased or repeated, so a 9-name budget is spent on repeats or the model sees `pasteitem` for `pasteItem`; why_new=Cycle 0125 F3b (Issue #320); seam=none; no_claim=that a name is unique in the repository
test('a source lists its declared names in source order, once each, with their case kept', () => {
  // Arrange
  const lines = [
    'function zeta() {',
    'class Alpha {',
    '  pasteItem(source) {',
    '  }',
    '}',
    'function zeta() {',
    'const Beta = () => {',
  ]

  // Act
  const names = declaredNamesOf(lines)

  // Assert
  assert.deepEqual(names, ['zeta', 'Alpha', 'pasteItem', 'Beta'])
})
