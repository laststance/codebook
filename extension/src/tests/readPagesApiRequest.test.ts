import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Protocol } from 'devtools-protocol'

import { readPagesApiRequest } from '../utils/readPagesApiRequest'

type Property = Protocol.Runtime.PropertyDescriptor

/** One own data property as `Runtime.getProperties` answers it. */
function data(
  name: string,
  type: 'string' | 'object',
  value: unknown,
): Property {
  return {
    name,
    value: { type, value },
    configurable: true,
    enumerable: true,
    isOwn: true,
  }
}

/** One local holding a Node object of a class, as E1b recorded `req` and `res`. */
function local(name: string, className: string, objectId: string): Property {
  return {
    name,
    value: { type: 'object', className, objectId },
    configurable: true,
    enumerable: true,
    isOwn: true,
  }
}

/** The own properties E1b recorded on the request: url, method, query and body. */
const REQUEST_PROPERTIES: Property[] = [
  data('url', 'string', '/api/data?clear=1'),
  data('method', 'string', 'GET'),
  { ...data('query', 'object', undefined), value: { type: 'object' } },
  data('body', 'string', ''),
]

/** Answers `Runtime.getProperties` for the request objects of these tests. */
const readOwn = async (): Promise<Property[]> => REQUEST_PROPERTIES

// Value: protects=E-1 the request is read from the handler's locals as E1b recorded them: method and url (path and query) of the one IncomingMessage; fails_when=the url loses its query or the method is read from the wrong object; no_claim=a real js-debug answer (E1b's shape is reproduced)
test('the request is read from the one IncomingMessage local with its method and url', async () => {
  // Arrange
  const locals = [
    local('req', 'IncomingMessage', '1'),
    local('res', 'ServerResponse', '2'),
    data('clear', 'string', '1'),
  ]
  // Act
  const request = await readPagesApiRequest(locals, readOwn)
  // Assert
  assert.deepEqual(request, { method: 'GET', url: '/api/data?clear=1' })
})

// Value: protects=DX-3 the read does not depend on the parameter's name; fails_when=only a parameter named req is found; no_claim=a request stored in a nested object
test('a request parameter named request is read the same way', async () => {
  // Arrange
  const locals = [local('request', 'IncomingMessage', '1')]
  // Act
  const request = await readPagesApiRequest(locals, readOwn)
  // Assert
  assert.deepEqual(request, { method: 'GET', url: '/api/data?clear=1' })
})

// Value: protects=DX-3 a destructured parameter leaves no request object in the locals, so the read is unreadable and the window rule applies; fails_when=a plain url or method local is taken for the request; no_claim=the window rule itself (the identity tests)
test('a destructured request parameter reads as unreadable', async () => {
  // Arrange
  const locals = [
    data('method', 'string', 'GET'),
    data('url', 'string', '/api/data?clear=1'),
  ]
  // Act
  const request = await readPagesApiRequest(locals, readOwn)
  // Assert
  assert.equal(request, undefined)
})

// Value: protects=E-1 two IncomingMessage locals (a proxied call) cannot be told apart, so the read is unreadable and nothing is guessed; fails_when=the first of two requests is taken; no_claim=which of the two the handler answers
test('two IncomingMessage locals read as unreadable', async () => {
  // Arrange
  const locals = [
    local('req', 'IncomingMessage', '1'),
    local('original', 'IncomingMessage', '3'),
  ]
  // Act
  const request = await readPagesApiRequest(locals, readOwn)
  // Assert
  assert.equal(request, undefined)
})

// Value: protects=E-1 an accessor url is never invoked and reads as unreadable (the read evaluates nothing); fails_when=a getter is read as a value or called; no_claim=a getter on method
test('a request whose url is an accessor reads as unreadable', async () => {
  // Arrange
  const locals = [local('req', 'IncomingMessage', '1')]
  const getterOwn = async (): Promise<Property[]> => [
    {
      name: 'url',
      get: { type: 'function', objectId: '9' },
      configurable: true,
      enumerable: true,
      isOwn: true,
    },
    data('method', 'string', 'GET'),
  ]
  // Act
  const request = await readPagesApiRequest(locals, getterOwn)
  // Assert
  assert.equal(request, undefined)
})

// Value: protects=E-1 an oversized url, a rejected read, a non-string method and an empty method read as unreadable so the operation window decides; fails_when=a 3000-character url or an empty method publishes a bogus request, or a rejecting reader crashes the hit; why_new=only the valid, renamed, destructured, two-request and accessor shapes were tested; seam=none; no_claim=a url of exactly 2048 characters (the bound's edge)
test('an oversized url, a rejected read, a non-string method and an empty method read as unreadable', async () => {
  // Arrange
  const locals = [local('req', 'IncomingMessage', '1')]
  const ownWith = (properties: Property[]) => async () => properties
  const cases: Record<string, () => Promise<Property[]>> = {
    oversizedUrl: ownWith([
      data('url', 'string', `/api/data?q=${'a'.repeat(3000)}`),
      data('method', 'string', 'GET'),
    ]),
    rejectedRead: async () => {
      throw new Error('object released')
    },
    nonStringMethod: ownWith([
      data('url', 'string', '/api/data'),
      data('method', 'object', null),
    ]),
    emptyMethod: ownWith([
      data('url', 'string', '/api/data'),
      data('method', 'string', ''),
    ]),
  }
  // Act
  const results: Record<string, unknown> = {}
  for (const [name, read] of Object.entries(cases))
    results[name] = await readPagesApiRequest(locals, read)
  // Assert
  assert.deepEqual(results, {
    oversizedUrl: undefined,
    rejectedRead: undefined,
    nonStringMethod: undefined,
    emptyMethod: undefined,
  })
})
