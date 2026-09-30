import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { repositoryEntryPathSchema } from '../repositoryConfigSchemas'
import { resolveNextClientManifest } from '../utils/resolveNextClientManifest'
import { prepareRepositoryInputs } from '../utils/prepareRepositoryInputs'
import { Cdp } from '../runtimeSupport/cdp'

for (const path of ['/login', '/invoices/42/edit?tab=details', '/'])
  test(`same-origin entry ${path} is accepted`, () => {
    assert.equal(repositoryEntryPathSchema.parse(path), path)
  })
for (const path of [
  'https://elsewhere.invalid',
  '//elsewhere.invalid',
  '/\\elsewhere.invalid',
  '/a/../b',
  '/%2e%2e/b',
  '/a%2fb',
  '/a%5cb',
  '/a#fragment',
  '/a\nb',
  '/a%0ab',
  '/a%00b',
  '/a%7fb',
])
  test(`entry ${JSON.stringify(path)} cannot escape its declared local route`, () => {
    assert.equal(repositoryEntryPathSchema.safeParse(path).success, false)
  })

test('non-root route discovery selects the compiled page instead of assuming the root manifest', () => {
  // Arrange
  const routes = { '/page': 'app/page.js', '/login/page': 'app/login/page.js' }
  // Act / Assert
  assert.deepEqual(
    resolveNextClientManifest(routes, '/login?callbackUrl=%2Fdashboard'),
    {
      key: '/login/page',
      path: '.next/dev/server/app/login/page_client-reference-manifest.js',
    },
  )
})

test('route groups and dynamic parameters resolve through their actual generated manifest paths', () => {
  // Arrange
  const routes = {
    '/(accounts)/users/[id]/page': 'app/(accounts)/users/[id]/page.js',
    '/docs/[...slug]/page': 'app/docs/[...slug]/page.js',
    '/help/[[...slug]]/page': 'app/help/[[...slug]]/page.js',
  }
  // Act / Assert
  assert.equal(
    resolveNextClientManifest(routes, '/users/42').key,
    '/(accounts)/users/[id]/page',
  )
  assert.equal(
    resolveNextClientManifest(routes, '/docs/getting/started').key,
    '/docs/[...slug]/page',
  )
  assert.equal(
    resolveNextClientManifest(routes, '/help').key,
    '/help/[[...slug]]/page',
  )
  assert.throws(() => resolveNextClientManifest(routes, '/docs'), /no unique/)
})

test('ambiguous or escaped generated route paths never select an arbitrary source manifest', () => {
  // Arrange / Act / Assert
  assert.throws(
    () =>
      resolveNextClientManifest(
        {
          '/(a)/login/page': 'app/(a)/login/page.js',
          '/(b)/login/page': 'app/(b)/login/page.js',
        },
        '/login',
      ),
    /no unique/,
  )
  assert.throws(
    () =>
      resolveNextClientManifest(
        { '/login/page': 'app/../../elsewhere/page.js' },
        '/login',
      ),
    /no unique/,
  )
  assert.equal(
    resolveNextClientManifest(
      {
        '/users/[id]/page': 'app/users/[id]/page.js',
        '/users/new/page': 'app/users/new/page.js',
      },
      '/users/new',
    ).key,
    '/users/new/page',
  )
})

/** Runs the emitted fixed DOM functions against retained node identities through the real CDP transport. @example const controls = inputHarness(); await controls.prepare() */
function inputHarness() {
  let active: Input | undefined,
    selected: Input | undefined,
    replacements = false,
    wrongOrigin = false,
    obscured = false,
    duplicates = false,
    disconnected = false
  const commands: string[] = [],
    released: string[] = []
  class Input {
    type = 'email'
    value = ''
    disabled = false
    readOnly = false
    isConnected = true
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 100, height: 30 }
    }
    contains() {
      return false
    }
    focus() {
      active = this
    }
    select() {}
  }
  const original = new Input(),
    replacement = new Input()
  selected = original
  const environment = {
    HTMLInputElement: Input,
    HTMLTextAreaElement: class {},
    location: {
      get origin() {
        return wrongOrigin ? 'http://foreign.invalid' : 'http://127.0.0.1:4000'
      },
    },
    document: {
      querySelectorAll: () =>
        duplicates ? [selected, replacement] : [selected],
      get activeElement() {
        return active
      },
      elementFromPoint: () => (obscured ? replacement : selected),
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
  }
  class Socket extends EventTarget {
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const message: {
        id: number
        method: string
        params: {
          expression?: string
          functionDeclaration?: string
          arguments?: { value: unknown }[]
          text?: string
          objectId?: string
        }
      } = JSON.parse(String(value))
      commands.push(message.method)
      let result: unknown
      if (message.method === 'Runtime.evaluate') {
        const node = runInNewContext(message.params.expression!, environment)
        result = {
          result:
            node === original
              ? { type: 'object', subtype: 'node', objectId: 'owned-node' }
              : { type: 'undefined' },
        }
      } else if (message.method === 'Runtime.callFunctionOn') {
        const value = runInNewContext(
          `(${message.params.functionDeclaration}).call(element, input)`,
          {
            ...environment,
            element: original,
            input: message.params.arguments![0]!.value,
          },
        )
        result = { result: { type: 'object', value } }
      } else if (message.method === 'Input.insertText') {
        if (disconnected) {
          this.close()
          return
        }
        original.value = message.params.text!
        if (replacements) {
          selected = replacement
          replacement.value = message.params.text!
          active = replacement
        }
        result = {}
      } else if (message.method === 'Runtime.releaseObject') {
        released.push(message.params.objectId!)
        result = {}
      } else throw new Error(`Unexpected command ${message.method}`)
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ id: message.id, result }),
        }),
      )
    }
    close(): void {
      this.dispatchEvent(new Event('close'))
    }
  }
  const cdp = new Cdp(new Socket(), () => {})
  return {
    commands,
    released,
    original,
    close: () => cdp.close(),
    replaceOnInsert: () => {
      replacements = true
    },
    foreign: () => {
      wrongOrigin = true
    },
    obscure: () => {
      obscured = true
    },
    duplicate: () => {
      duplicates = true
    },
    disconnectOnInsert: () => {
      disconnected = true
    },
    prepare: (assertCurrent = () => {}) =>
      prepareRepositoryInputs(
        cdp,
        [{ selector: '#email', text: 'invalid@example.invalid' }],
        'http://127.0.0.1:4000',
        assertCurrent,
      ),
  }
}

test('input preparation inserts text once and releases its exact retained node', async () => {
  // Arrange
  const input = inputHarness()
  // Act
  await input.prepare()
  input.close()
  // Assert
  assert.equal(input.original.value, 'invalid@example.invalid')
  assert.deepEqual(input.released, ['owned-node'])
  assert.deepEqual(input.commands, [
    'Runtime.evaluate',
    'Runtime.callFunctionOn',
    'Input.insertText',
    'Runtime.callFunctionOn',
    'Runtime.releaseObject',
  ])
})

for (const failure of ['foreign', 'obscure', 'duplicate'] as const)
  test(`${failure} input ownership prevents text dispatch`, async () => {
    // Arrange
    const input = inputHarness()
    input[failure]()
    // Act / Assert
    await assert.rejects(input.prepare())
    input.close()
    assert.equal(input.commands.includes('Input.insertText'), false)
  })

test('a replaced control cannot inherit the original node identity even with matching text', async () => {
  // Arrange
  const input = inputHarness()
  input.replaceOnInsert()
  // Act / Assert
  await assert.rejects(input.prepare(), /unique-text-control-required/)
  input.close()
  assert.equal(
    input.commands.filter((command) => command === 'Input.insertText').length,
    1,
  )
  assert.deepEqual(input.released, ['owned-node'])
})

test('a disconnected input has no automatic retry or fabricated successful preparation', async () => {
  // Arrange
  const input = inputHarness()
  input.disconnectOnInsert()
  // Act / Assert
  await assert.rejects(input.prepare(), /disconnected/)
  input.close()
  assert.equal(
    input.commands.filter((command) => command === 'Input.insertText').length,
    1,
  )
})

test('cancellation before target acquisition sends no browser operation', async () => {
  // Arrange
  const input = inputHarness()
  // Act / Assert
  await assert.rejects(
    input.prepare(() => {
      throw new Error('Cancelled')
    }),
    /Cancelled/,
  )
  input.close()
  assert.deepEqual(input.commands, [])
})
