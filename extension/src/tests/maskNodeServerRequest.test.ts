import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maskNodeServerRequestBody } from '../utils/maskNodeServerRequestBody'
import { maskSecretQueryValues } from '../utils/maskSecretQueryValues'

// protects=secret-named values of a declared request never reach a history header; fails_when=a nested JSON field, a form field or a query value keeps its secret; no_claim=a secret in a field with an innocent name
test('a nested JSON password, a form token and a query api key are masked while innocent fields stay', () => {
  // Arrange
  const json =
    '{"user":{"name":"ada","password":"p1"},"items":[{"accessToken":"t1","sku":"a"}]}'
  const form = 'name=ada&access_token=t2&page=2'
  const path = '/api/users?id=3&api_key=k3&redirect=%2Fhome'

  // Act
  const maskedJson = maskNodeServerRequestBody(json, 'application/json')
  const maskedForm = maskNodeServerRequestBody(
    form,
    'application/x-www-form-urlencoded',
  )
  const maskedPath = maskSecretQueryValues(path)

  // Assert
  assert.equal(
    maskedJson,
    '{"user":{"name":"ada","password":"[masked]"},"items":[{"accessToken":"[masked]","sku":"a"}]}',
  )
  assert.equal(maskedForm, 'name=ada&access_token=[masked]&page=2')
  assert.equal(maskedPath, '/api/users?id=3&api_key=[masked]&redirect=%2Fhome')
})

test('a body that does not parse as its content type is masked as plain text', () => {
  // Arrange
  const body = 'not json Bearer abcdefgh12345'

  // Act
  const masked = maskNodeServerRequestBody(body, 'application/json')

  // Assert
  assert.equal(masked, 'not json Bearer [masked]')
})
