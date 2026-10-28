import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeServerConfigSchema } from '../nodeServerConfigSchemas'
import { maskNodeServerConfiguration } from '../utils/maskNodeServerConfiguration'
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
