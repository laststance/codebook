import assert from 'node:assert/strict'
import { test } from 'node:test'

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
