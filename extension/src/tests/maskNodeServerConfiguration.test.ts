import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeServerConfigSchema } from '../nodeServerConfigSchemas'
import { nodeServerHistoryHeaderSchema } from '../nodeServerHistorySchemas'
import { maskNodeServerConfiguration } from '../utils/maskNodeServerConfiguration'
import { maskSavedServerHeader } from '../utils/maskSavedServerHeader'
import { maskSecretFormPairs } from '../utils/maskSecretFormPairs'

import { nodeServerHistoryHeader } from './utils/nodeServerHistoryFixture'

/** The fixture's declaration parsed, with `request` replaced by `request`. */
function declarationWith(request: Record<string, unknown>) {
  const { configuration } = nodeServerHistoryHeader('a'.repeat(64))
  return nodeServerConfigSchema.parse({
    ...configuration,
    request,
  })
}

// protects=a form pair whose name cannot be percent-decoded is masked whole, as it cannot be told from a secret; fails_when=the undecodable name keeps its value or throws; no_claim=names that decode
test('a form pair whose name is not valid percent-encoding has its value masked', () => {
  // Arrange
  const pairs = 'page=2&%E0%A4%A=hunter2&plain'

  // Act
  const masked = maskSecretFormPairs(pairs)

  // Assert
  assert.equal(masked, 'page=2&%E0%A4%A=[masked]&plain')
})

// protects=a declaration with no request body is masked without inventing a body; fails_when=the mask adds a body key or throws when body is absent; no_claim=the query mask itself
test('masking a declaration with no request body masks the path and adds no body', () => {
  // Arrange
  const configuration = declarationWith({
    method: 'GET',
    path: '/api/items?id=3&api_key=k3',
  })

  // Act
  const masked = maskNodeServerConfiguration(configuration)

  // Assert
  assert.equal(masked.request.path, '/api/items?id=3&api_key=[masked]')
  assert.equal('body' in masked.request, false)
})

// protects=the mask composes: path query values and body fields are masked together and every other declared field is unchanged; fails_when=one of them keeps a secret or the mask edits the port, entry or source; no_claim=the original declaration (it stays untouched)
test('masking a declaration masks the path and the JSON body together and leaves the rest and the original unchanged', () => {
  // Arrange
  const configuration = declarationWith({
    method: 'POST',
    path: '/api/login?access_token=abc&next=/home',
    contentType: 'application/json',
    body: '{"user":"ada","password":"hunter2"}',
  })

  // Act
  const masked = maskNodeServerConfiguration(configuration)

  // Assert
  assert.equal(
    masked.request.path,
    '/api/login?access_token=[masked]&next=/home',
  )
  assert.equal(masked.request.body, '{"user":"ada","password":"[masked]"}')
  assert.equal(masked.port, configuration.port)
  assert.equal(masked.entry, configuration.entry)
  assert.deepEqual(masked.source, configuration.source)
  assert.equal(
    configuration.request.body,
    '{"user":"ada","password":"hunter2"}',
  )
})

/** The fixture's declaration with a `signIn` whose route is `path`. */
function declarationSigningInAt(path: string) {
  const { configuration } = nodeServerHistoryHeader('a'.repeat(64))
  return nodeServerConfigSchema.parse({
    ...configuration,
    signIn: {
      path,
      fields: { email: 'learner@example.test' },
      secretField: 'password',
      secret: 'ask-learner',
    },
  })
}

// protects=a sign-in route that carries a secret query value is stored masked; fails_when=the stored signIn.path keeps the token; no_claim=the sign-in request actually sent, or the fields
test('masking a declaration masks the secret query value of the sign-in path', () => {
  // Arrange
  const configuration = declarationSigningInAt(
    '/api/login?api_key=abc123&next=/home',
  )

  // Act
  const masked = maskNodeServerConfiguration(configuration)

  // Assert
  assert.equal(masked.signIn?.path, '/api/login?api_key=[masked]&next=/home')
  assert.equal(
    configuration.signIn?.path,
    '/api/login?api_key=abc123&next=/home',
  )
})

// protects=a 2,048-character sign-in path that the mask lengthens is cut to the bound, so the saved header still parses; fails_when=the stored sign-in path passes 2,048 characters and the header schema refuses it, losing the history; no_claim=which part of the cut mask stays
test('masking a sign-in path at the length limit cuts it to the limit and the header still parses', () => {
  // Arrange
  const path = `/cb?pad=${'a'.repeat(2_033)}&code=x`
  const configuration = declarationSigningInAt(path)
  const header = {
    ...nodeServerHistoryHeader('a'.repeat(64)),
    formatVersion: 3 as const,
    configuration,
  }

  // Act
  const masked = maskNodeServerConfiguration(configuration)
  const served = maskSavedServerHeader(header)

  // Assert
  assert.equal(path.length, 2_048)
  assert.equal(masked.signIn?.path.length, 2_048)
  assert.equal(masked.signIn?.path.includes('code=x'), false)
  assert.equal(served.configuration.signIn?.path.length, 2_048)
  assert.equal(nodeServerHistoryHeaderSchema.safeParse(served).success, true)
})

// protects=a saved header whose sign-in path was stored unmasked is served masked; fails_when=the served configuration.signIn.path keeps the token; no_claim=the entries of the history
test('serving a saved header masks a secret query value left in its sign-in path', () => {
  // Arrange
  const header = {
    ...nodeServerHistoryHeader('a'.repeat(64)),
    formatVersion: 3 as const,
    configuration: declarationSigningInAt('/api/login?api_key=abc123'),
  }

  // Act
  const served = maskSavedServerHeader(header)

  // Assert
  assert.equal(served.configuration.signIn?.path, '/api/login?api_key=[masked]')
})
