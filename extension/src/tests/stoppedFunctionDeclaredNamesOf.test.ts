import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ownClosureScopePositionsOf } from '../utils/ownClosureScopePositionsOf'
import { stoppedFunctionDeclaredNamesOf } from '../utils/stoppedFunctionDeclaredNamesOf'

/** Sorted names of a result, for a stable comparison. */
function sorted(names: ReadonlySet<string> | undefined): string[] | undefined {
  return names && [...names].sort()
}

// Value: protects=the Cycle 0152 trial handler's declared names: the destructured parameter and the const, nothing from the module; fails_when=a parameter pattern's property key or a default expression counts, or the handler's own const is missed; seam=source text at the stop's line and column; no_claim=other languages
test('an arrow handler declares its destructured parameter and its own consts', () => {
  // Arrange
  const source = [
    "import { Elysia } from 'elysia'",
    'const app = new Elysia()',
    "  .get('/greet', ({ query }) => {",
    "    const name = query.name ?? 'Elysia'",
    '    return greet(name)',
    '  })',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 5, 5)
  // Assert
  assert.deepEqual(sorted(names), ['name', 'query'])
})

// Value: protects=a destructuring binds its local names only; fails_when=`b` (the key) or `x` (the default's expression) counts as declared; seam=const and parameter patterns; no_claim=computed keys
test('destructuring binds local names, never property keys or default expressions', () => {
  // Arrange
  const source = [
    'const run = ({ a, b: c, d = x }, [e, , f = 1], ...rest) => {',
    '  const { g, h: { i }, j: [k] } = value',
    '  return a',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 3, 3)
  // Assert
  assert.deepEqual(sorted(names), [
    'a',
    'c',
    'd',
    'e',
    'f',
    'g',
    'i',
    'k',
    'rest',
  ])
})

// Value: protects=a named function declares its own parameters and locals, but not its own name or a TypeScript return type; fails_when=the function's name counts as declared or a TypeScript parameter annotation is read as a name; seam=`function greet(name: string): string`; no_claim=overloads
test('a named function declares its parameters and locals', () => {
  // Arrange
  const source = [
    'function greet(name: string, count?: number = 1): string {',
    '  const greeting = `Hello ${name}`',
    '  return greeting',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 3, 3)
  // Assert
  assert.deepEqual(sorted(names), ['count', 'greeting', 'name'])
})

// Value: protects=an arrow whose parameters cannot be read with confidence (a TypeScript return type before `=>`) declares no parameter; fails_when=the return type's name is guessed as a parameter or the parameter is guessed; seam=`(request): Response =>`; no_claim=every TypeScript form
test('an arrow with a return type before the arrow declares no parameter', () => {
  // Arrange
  const source = [
    'const handler = (request): Response => {',
    '  const answer = 1',
    '  return answer',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 3, 3)
  // Assert
  assert.deepEqual(sorted(names), ['answer'])
})

// Value: protects=the innermost function holding the stop is chosen, not its enclosing factory; fails_when=the factory's parameter `tenantName` counts as declared by the inner handler; seam=anonymous handler inside an anonymous factory; no_claim=methods without the function keyword
test('an inner handler does not declare its enclosing factory names', () => {
  // Arrange
  const source = [
    'const factory = (tenantName) => {',
    '  const normalize = (value) => value.trim()',
    '  return (request) => {',
    '    return normalize(tenantName)',
    '  }',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 4, 5)
  // Assert
  assert.deepEqual(sorted(names), ['request'])
})

// Value: protects=comments, strings and templates never declare a name; fails_when=`const hidden` in a comment or string counts; seam=blanked source; no_claim=regular expression literals
test('declarations inside comments and strings declare nothing', () => {
  // Arrange
  const source = [
    'const run = () => {',
    '  // const hidden = 1',
    "  const text = 'const alsoHidden = 2'",
    '  return text',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 4, 3)
  // Assert
  assert.deepEqual(sorted(names), ['text'])
})

// Value: protects=a closed arrow written before the stop line in the stopped function without a terminator makes the span start after that arrow, so values declared before it are not claimed (fail-closed); fails_when=an earlier declaration is claimed from a span it cannot prove; seam=an expression-bodied arrow followed by the stop line; no_claim=semicolon-terminated code, where the span stays whole
test('a declaration before an unterminated inner arrow is not claimed', () => {
  // Arrange
  const source = [
    "  .get('/greet', ({ query }) => {",
    '    const name = query.name',
    '    const upper = (text) => text.toUpperCase()',
    '    return greet(name)',
    '  })',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 4, 5)
  // Assert
  assert.deepEqual(sorted(names), ['text'])
})

// Value: protects=an unknown stop position or text without a function declares nothing; fails_when=a guess is returned; seam=line past the end and top-level code; no_claim=column handling
test('without a function holding the stop there are no declared names', () => {
  // Arrange
  const source = 'const value = 1\nconsole.log(value)'
  // Act
  const pastEnd = stoppedFunctionDeclaredNamesOf(source, 9, 1)
  const topLevel = stoppedFunctionDeclaredNamesOf(source, 2, 1)
  // Assert
  assert.equal(pastEnd, undefined)
  assert.equal(topLevel, undefined)
})

// Value: protects=a parameter default that reads an enclosing factory variable (`(x = tenantName) =>`) does not declare that variable, so the factory closure holding it stays out of replay history; fails_when=the default's expression is read as a binding; seam=an arrow parameter with a default; no_claim=side effects of defaults
test('a parameter default referencing a factory variable does not declare it', () => {
  // Arrange
  const source = [
    'const factory = (tenantName) => {',
    '  return (x = tenantName) => {',
    '    return x',
    '  }',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 3, 5)
  // Assert
  assert.deepEqual(sorted(names), ['x'])
})

// Value: protects=two nested functions with the same name: the span is the inner one, so the outer one's locals are not declared; fails_when=the outer greet's declarations count; seam=nested `function greet`; no_claim=hoisting
test('nested functions with one name declare only the inner one own names', () => {
  // Arrange
  const source = [
    'function greet(outerClient) {',
    '  function greet(name) {',
    '    return name',
    '  }',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 3, 5)
  // Assert
  assert.deepEqual(sorted(names), ['name'])
})

// Value: protects=a name declared in an inner function that closed before the stop is not declared at the stop, so the enclosing factory's `apiKey` is not claimed; fails_when=the closed inner arrow's `const apiKey` counts; seam=a factory holding `apiKey` around a handler with a closed inner arrow; no_claim=values the inner arrow held
test('a name declared in an inner function closed before the stop is not declared', () => {
  // Arrange
  const source = [
    'const make = (apiKey) => (req) => {',
    '  const run = () => {',
    '    const apiKey = 1',
    '    return apiKey',
    '  }',
    '  return req',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 6, 3)
  // Assert
  assert.deepEqual(sorted(names), ['req', 'run'])
})

// Value: protects=a const inside a block that closed before the stop is not declared at the stop; fails_when=the closed `if` block's const counts; seam=a closed `if` block before the stop line; no_claim=block-scoped values the block held
test('a const in a closed if block is not declared after the block', () => {
  // Arrange
  const source = [
    'const handle = (req) => {',
    '  if (req) {',
    '    const hidden = 1',
    '  }',
    '  return req',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 5, 3)
  // Assert
  assert.deepEqual(sorted(names), ['req'])
})

// Value: protects=a const in a block that still holds the stop is declared; fails_when=an open enclosing block hides its own const and the replay loses a value it should keep; seam=a stop inside an `if` block; no_claim=consts of sibling blocks
test('a const in a block that holds the stop is declared', () => {
  // Arrange
  const source = [
    'const handle = (req) => {',
    '  if (req) {',
    '    const visible = 1',
    '    return visible',
    '  }',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 4, 5)
  // Assert
  assert.deepEqual(sorted(names), ['req', 'visible'])
})

// Value: protects=a catch binding is declared only while the stop is inside its catch block; fails_when=a closed catch block's binding counts after it, or the binding is lost inside the block; seam=a closed catch before the stop and a stop inside a catch; no_claim=finally blocks
test('a catch binding is declared only inside its catch block', () => {
  // Arrange
  const source = [
    'const handle = (req) => {',
    '  try {',
    '    run()',
    '  } catch (error) {',
    '    log(error)',
    '  }',
    '  return req',
    '}',
  ].join('\n')
  // Act
  const insideCatch = stoppedFunctionDeclaredNamesOf(source, 5, 5)
  const afterCatch = stoppedFunctionDeclaredNamesOf(source, 7, 3)
  // Assert
  assert.deepEqual(sorted(insideCatch), ['error', 'req'])
  assert.deepEqual(sorted(afterCatch), ['req'])
})

// Value: protects=a for-of loop variable is declared only while the stop is inside the loop; fails_when=a finished loop's variable counts after it, or is lost inside the body; seam=a stop inside and after a `for...of` loop; no_claim=loops without braces
test('a for-of loop variable is declared only inside its loop', () => {
  // Arrange
  const source = [
    'const handle = (req) => {',
    '  for (const item of req.items) {',
    '    use(item)',
    '  }',
    '  return req',
    '}',
  ].join('\n')
  // Act
  const insideLoop = stoppedFunctionDeclaredNamesOf(source, 3, 5)
  const afterLoop = stoppedFunctionDeclaredNamesOf(source, 5, 3)
  // Assert
  assert.deepEqual(sorted(insideLoop), ['item', 'req'])
  assert.deepEqual(sorted(afterLoop), ['req'])
})

// Value: protects=a function written on the stop line after the stop column declares nothing at the stop; fails_when=the inline callback's const counts; seam=`items.forEach((item) => { const inner = item })` with the stop at the line start; no_claim=a stop inside the callback
test('a const in an inline function after the stop column is not declared', () => {
  // Arrange
  const source = [
    'const handle = (req) => {',
    '  items.forEach((item) => { const inner = item })',
    '}',
  ].join('\n')
  // Act
  const names = stoppedFunctionDeclaredNamesOf(source, 2, 3)
  // Assert
  assert.deepEqual(sorted(names), ['req'])
})

// Value: protects=the replay privacy outcome: a factory closure holding `apiKey` is not copied when only a closed inner arrow declares that name; fails_when=the factory closure's position is copied into replay history; seam=the names this source yields at `return req` fed to the replay policy with JavaScriptCore-shaped scopes; no_claim=other engines' scope shapes
test('a factory closure holding apiKey is not copied when only a closed inner arrow declares that name', async () => {
  // Arrange
  const source = [
    'const make = (apiKey) => (req) => {',
    '  const run = () => {',
    '    const apiKey = 1',
    '    return apiKey',
    '  }',
    '  return req',
    '}',
  ].join('\n')
  const declaredNames = stoppedFunctionDeclaredNamesOf(source, 6, 3)
  const scopes = [
    { name: 'Closure', presentationHint: 'arguments', variablesReference: 1 },
    { name: 'Closure', presentationHint: 'arguments', variablesReference: 2 },
    { name: 'Closure', presentationHint: 'arguments', variablesReference: 3 },
    { name: 'Script', variablesReference: 4 },
    { name: 'Global', variablesReference: 5 },
  ]
  const contents: Record<number, string[]> = {
    1: ['arguments', 'req', 'run'],
    2: ['apiKey'],
    3: ['make'],
  }
  // Act
  const own = await ownClosureScopePositionsOf(
    scopes,
    async (reference) => contents[reference] ?? [],
    declaredNames,
    '<anonymous>',
    100,
  )
  // Assert
  assert.deepEqual([...own], [0])
})
