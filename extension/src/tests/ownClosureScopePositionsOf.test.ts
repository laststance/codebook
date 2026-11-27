import assert from 'node:assert/strict'
import { test } from 'node:test'

import { moduleBindingNamesOf } from '../utils/moduleBindingNamesOf'
import { ownClosureScopePositionsOf } from '../utils/ownClosureScopePositionsOf'

/** One closure scope as js-debug answers it for a Bun frame. */
function closure(name: string, variablesReference: number) {
  return { name, presentationHint: 'arguments', variablesReference }
}

/** A variable reader over fixed scope contents. */
function variablesOf(contents: Record<number, string[]>) {
  return async (reference: number): Promise<string[]> =>
    contents[reference] ?? []
}

// Value: protects=the Elysia route handler stop of the Cycle 0152 trial: the anonymous handler's own closures (name, query) are copied and the module's scope (app, greet) is not, though all arrive as Closure; fails_when=the module scope is copied (credentials could reach history) or the handler's own values are dropped; seam=scopes shaped as js-debug answered them in probe E1-M2; no_claim=other engines' scope shapes
test('a Bun handler stop copies its own closures and stops at the module scope that holds an import', async () => {
  // Arrange
  const scopes = [
    closure('Closure', 1),
    closure('Closure', 2),
    closure('Closure', 3),
    closure('Closure', 4),
    { name: 'Script', variablesReference: 5 },
    { name: 'Global', presentationHint: undefined, variablesReference: 6 },
  ]
  const contents = {
    1: ['name'],
    2: [],
    3: ['query'],
    4: ['app', 'greet', 'Elysia'],
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['Elysia', 'greet', 'app']),
    '<anonymous>',
  )
  // Assert
  assert.deepEqual([...own], [0, 1, 2])
})

// Value: protects=the outermost closure (the module's scope, or Bun's CommonJS wrapper) is never copied even when the source scan names none of its bindings; fails_when=a module whose declarations the scan misses (destructured exports) has its scope copied; seam=scopes with no module names found in them; no_claim=the source scan's coverage
test('the outermost closure is never copied even when none of its names are known module names', async () => {
  // Arrange
  const scopes = [
    closure('Closure (greet)', 1),
    closure('Closure (greet)', 2),
    closure('Closure', 3),
    { name: 'Script', variablesReference: 4 },
  ]
  const contents = {
    1: ['greeting'],
    2: ['arguments', 'name'],
    3: ['secretClient'],
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['unrelated']),
    'greet',
  )
  // Assert
  assert.deepEqual([...own], [0, 1])
})

// Value: protects=a module with no top-level names keeps only the closures named after the stopped function; fails_when=an unnamed closure is copied without evidence it is the function's own; seam=no module names; no_claim=translated scope labels other than the parenthesized function name
test('without module names only the closures named after the stopped function are copied', async () => {
  // Arrange
  const scopes = [
    closure('Closure (greet)', 1),
    closure('Closure', 2),
    closure('Closure', 3),
    { name: 'Script', variablesReference: 4 },
  ]
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf({}),
    new Set(),
    'greet',
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=a node stop's Local and Block scopes are not reread or doubled by the Bun rule, and a block before the closures is passed over; fails_when=the rule copies a `locals` scope twice or stops at it; seam=a block then closures; no_claim=V8 behaviour
test('a leading block scope is passed over and the closures after it are judged', async () => {
  // Arrange
  const scopes = [
    { name: 'Block', presentationHint: 'locals', variablesReference: 1 },
    closure('Closure', 2),
    closure('Closure', 3),
    { name: 'Global', variablesReference: 4 },
  ]
  const contents = { 2: ['item'], 3: ['db'] }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['db']),
    'handle',
  )
  // Assert
  assert.deepEqual([...own], [1])
})

// Value: protects=the module names include imports and top-level declarations, never a declaration inside a comment or template, so the module scope is recognised; fails_when=an import or a top-level function is missed, or commented code counts; seam=source text; no_claim=every declaration form (destructuring is caught by the outermost-closure rule)
test('module binding names are the imports and top-level declarations, not commented ones', () => {
  // Arrange
  const source = [
    "import { Elysia } from 'elysia'",
    "import { greet as hello } from './greeting'",
    'const app = new Elysia()',
    'export async function start() {}',
    'export default class Server {}',
    '// const commented = 1',
    'function inner() { const nested = 2 }',
  ].join('\n')
  // Act
  const names = moduleBindingNamesOf(source)
  // Assert
  assert.deepEqual([...names].sort(), [
    'Elysia',
    'Server',
    'app',
    'hello',
    'inner',
    'start',
  ])
})
