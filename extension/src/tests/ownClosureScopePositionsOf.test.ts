import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ownClosureScopePositionsOf } from '../utils/ownClosureScopePositionsOf'

/** The most names one scope may hold in these tests. */
const MAX_NAMES = 100

/** One closure scope as js-debug answers it for a Bun frame. */
function closure(name: string, variablesReference: number) {
  return { name, presentationHint: 'arguments', variablesReference }
}

/** A variable reader over fixed scope contents. */
function variablesOf(contents: Record<number, string[]>) {
  return async (reference: number): Promise<string[]> =>
    contents[reference] ?? []
}

// Value: protects=the Elysia route handler stop of the Cycle 0152 trial: the anonymous handler's own closures (name, query) are copied, the empty closure between them is passed over, and the module's scope is never copied; fails_when=the module scope is copied (credentials could reach history), the handler's own values are dropped, or the empty closure ends the copy; seam=scopes shaped as the Cycle 0152 trace answered them; no_claim=other engines' scope shapes
test('a Bun handler stop copies its own closures, passes over an empty one and stops at the module scope', async () => {
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
    1: ['arguments', 'name'],
    2: [],
    3: ['query'],
    4: ['app', 'greet', 'Elysia'],
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['name', 'query']),
    '<anonymous>',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0, 2])
})

// Value: protects=a named function's own closures are copied, the module's scope is not; fails_when=the labelled own scopes are dropped or the outermost closure is copied; seam=scopes labelled as JavaScriptCore labels them (Cycle 0152 trace of `greet`); no_claim=the source scan (covered by stoppedFunctionDeclaredNamesOf tests)
test('a named function stop copies both of its labelled closures and never the outermost one', async () => {
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
    new Set(['greeting', 'name']),
    'greet',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0, 1])
})

// Value: protects=an anonymous handler inside an anonymous factory never copies the factory's closure (a tenant name, a client); fails_when=an unlabelled closure with no module name is judged the handler's own (Cycle 0152 review finding); seam=the QA reproduction: two unlabelled closures, then the module's; no_claim=source scanning
test('an anonymous handler inside an anonymous factory does not copy the factory closure', async () => {
  // Arrange
  const scopes = [
    closure('Closure', 1),
    closure('Closure', 2),
    closure('Closure', 3),
    { name: 'Script', variablesReference: 4 },
    { name: 'Global', variablesReference: 5 },
  ]
  const contents = {
    1: ['this', 'name'],
    2: ['tenantName'],
    3: ['Elysia', 'greet', 'app'],
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['name']),
    '<anonymous>',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=a closure labelled with the stopped function's own name still needs its names declared in the function: an enclosing function with the same name does not leak its closure; fails_when=the label alone makes the outer `greet` closure the inner function's own; seam=two nested functions named greet; no_claim=source scanning
test('a same-named enclosing function closure is not copied', async () => {
  // Arrange
  const scopes = [
    closure('Closure (greet)', 1),
    closure('Closure (greet)', 2),
    closure('Closure', 3),
    { name: 'Script', variablesReference: 4 },
  ]
  const contents = { 1: ['name'], 2: ['outerClient'], 3: ['greet'] }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['name']),
    'greet',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=a method made by a named factory copies only its own closure: the factory's closure with the database and API clients never reaches replay history; fails_when=a closure labelled with another function's name is copied; seam=the method frame named as js-debug names it (`Object.GET`); no_claim=redaction of values inside a copied scope
test('a method made by a named factory never copies the factory closure that holds its clients', async () => {
  // Arrange
  const scopes = [
    closure('Closure (GET)', 1),
    closure('Closure (makeRoutes)', 2),
    closure('Closure', 3),
    { name: 'Script', variablesReference: 4 },
  ]
  const contents = {
    1: ['request', 'user'],
    2: ['db', 'apiClient'],
    3: ['makeRoutes', 'Elysia'],
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['request', 'user', 'db', 'apiClient']),
    'Object.GET',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=a block scope before the closures is own (returned with its position) and the closures after it are judged; fails_when=the leading block is left out of the own set or stops the judgement; seam=a block then closures of an anonymous function; no_claim=V8 behaviour
test('a leading block scope is own and the closures after it are judged', async () => {
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
    new Set(['item']),
    '<anonymous>',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0, 1])
})

// Value: protects=a block after any closure (an enclosing catch or block a callback retains) is never own, and nothing after it is read; fails_when=a later `locals` scope is copied or the rule goes on past it; seam=[own closure, catch block, factory closure, module closure]; no_claim=js-debug's real scope hints
test('a block scope after a closure ends the copy', async () => {
  // Arrange
  const scopes = [
    closure('Closure', 1),
    { name: 'Catch Block', presentationHint: 'locals', variablesReference: 2 },
    closure('Closure', 3),
    closure('Closure', 4),
    { name: 'Global', variablesReference: 5 },
  ]
  const contents = { 1: ['item'], 3: ['item'] }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['item']),
    '<anonymous>',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=without a stop file text or position nothing is copied (fail-closed); fails_when=closures are copied with no evidence of what the function declares; seam=undefined declared names; no_claim=why the names are unknown
test('without declared names no closure is copied', async () => {
  // Arrange
  const scopes = [
    closure('Closure (greet)', 1),
    closure('Closure', 2),
    { name: 'Script', variablesReference: 3 },
  ]
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf({ 1: ['name'] }),
    undefined,
    'greet',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [])
})

// Value: protects=classification reads only scopes that can still be copied: it stops at the first scope holding an undeclared name and never reads the outermost closure; fails_when=every one of 20 later closures is read after a non-own one (a slow adapter eats the capture deadline); seam=a read counter over 22 closures; no_claim=the adapter's real latency
test('classification stops reading at the first closure holding an undeclared name', async () => {
  // Arrange
  const reads: number[] = []
  const scopes = [
    closure('Closure', 1),
    closure('Closure', 2),
    ...Array.from({ length: 20 }, (_, offset) =>
      closure('Closure', 3 + offset),
    ),
    { name: 'Script', variablesReference: 99 },
  ]
  const readVariableNames = async (reference: number): Promise<string[]> => {
    reads.push(reference)
    return reference === 1 ? ['name'] : ['foreignClient']
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    readVariableNames,
    new Set(['name']),
    '<anonymous>',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
  assert.deepEqual(reads, [1, 2])
})

// Value: protects=a scope holding more names than the capture's variable limit is not the function's own and its names are not trusted; fails_when=a huge scope is copied because the first names read are declared; seam=a limit of 2 and three names; no_claim=paging
test('a closure with more names than the variable limit is not copied', async () => {
  // Arrange
  const scopes = [
    closure('Closure', 1),
    closure('Closure', 2),
    { name: 'Script', variablesReference: 3 },
  ]
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf({ 1: ['a', 'b', 'c'] }),
    new Set(['a', 'b', 'c']),
    '<anonymous>',
    2,
  )
  // Assert
  assert.deepEqual([...own], [])
})

// Value: protects=a constructor frame (`Server.constructor`) copies a closure labelled with its class when every name in it is declared; fails_when=the class label is not accepted for a constructor frame, so the constructor's own values are dropped; seam=scopes labelled `Closure (Server)` as JavaScriptCore labels a constructor; no_claim=other class members
test('a constructor stop copies the closure labelled with its class', async () => {
  // Arrange
  const scopes = [
    closure('Closure (Server)', 1),
    closure('Closure', 2),
    { name: 'Script', variablesReference: 3 },
  ]
  const contents = { 1: ['port'], 2: ['secretClient'] }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['port']),
    'Server.constructor',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=an unlabelled closure of a named function is an enclosing function's and ends the copy with everything after it; fails_when=the unlabelled closure or a later one is copied or read; seam=`Closure (greet)`, an unlabelled closure, a labelled one, then the module's closure; no_claim=the module scope rule
test('a named function stop ends the copy at an unlabelled closure', async () => {
  // Arrange
  const scopes = [
    closure('Closure (greet)', 1),
    closure('Closure', 2),
    closure('Closure (greet)', 3),
    closure('Closure', 4),
    { name: 'Script', variablesReference: 5 },
  ]
  const contents = { 1: ['name'], 2: ['name'], 3: ['name'], 4: ['module'] }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf(contents),
    new Set(['name']),
    'greet',
    MAX_NAMES,
  )
  // Assert
  assert.deepEqual([...own], [0])
})

// Value: protects=a page of limit+1 names that includes `arguments` is an overflow: an unread name may remain; fails_when=`arguments` is filtered before the size check so a full page of declared names is copied; seam=a limit of 2 and the names arguments, a, b; no_claim=paging
test('a full page that includes arguments is not copied', async () => {
  // Arrange
  const scopes = [
    closure('Closure', 1),
    closure('Closure', 2),
    { name: 'Script', variablesReference: 3 },
  ]
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    variablesOf({ 1: ['arguments', 'a', 'b'] }),
    new Set(['a', 'b']),
    '<anonymous>',
    2,
  )
  // Assert
  assert.deepEqual([...own], [])
})
