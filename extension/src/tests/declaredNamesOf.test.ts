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
