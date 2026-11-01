import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maskRunSecrets, maskRunSecretsDeep } from '../utils/maskRunSecrets'

const SECRETS: ReadonlySet<string> = new Set(['hunter2', 'hunter2-long', ''])

// protects=a secret copied into a plain variable's preview text is replaced wherever it occurs; fails_when=only the first occurrence is masked or an empty secret blanks the text; no_claim=name-based masking, which is a different path
test('every occurrence of a run secret in a variable preview is masked and an empty secret is ignored', () => {
  // Arrange
  const preview = 'const value = "hunter2"; value + "hunter2"'
  // Act
  const masked = maskRunSecrets(preview, SECRETS)
  // Assert
  assert.equal(masked, 'const value = "[masked]"; value + "[masked]"')
})

// protects=a secret inside an exception message is masked; fails_when=error text keeps the secret; no_claim=that every caller applies the mask
test('a secret in an exception message is masked', () => {
  // Arrange
  const message = new Error('Login failed for password hunter2').message
  // Act
  const masked = maskRunSecrets(message, SECRETS)
  // Assert
  assert.equal(masked, 'Login failed for password [masked]')
})

// protects=when one secret contains another the longer one is masked whole and leaves no fragment; fails_when=the shorter secret is replaced first and a tail of the longer one stays visible; no_claim=secrets that overlap without containing each other
test('overlapping secrets leave no fragment of the longer one', () => {
  // Arrange
  const text = 'token hunter2-long and hunter2'
  // Act
  const masked = maskRunSecrets(text, SECRETS)
  // Assert
  assert.equal(masked, 'token [masked] and [masked]')
})

// protects=strings in nested objects and array elements are masked while other keys and values stay readable, and a key equal to a secret stays; fails_when=array elements or nested strings keep the secret or a key is rewritten; no_claim=class instances and cyclic values, which JSON-like results never hold
test('the deep variant masks nested strings and array elements and leaves other keys alone', () => {
  // Arrange
  const value = {
    values: ['safe', 'copy hunter2 here'],
    nested: { note: 'hunter2', count: 3, flag: true, none: null },
    hunter2: 'key-is-a-secret',
  }
  // Act
  const masked = maskRunSecretsDeep(value, SECRETS)
  // Assert
  assert.deepEqual(masked, {
    values: ['safe', 'copy [masked] here'],
    nested: { note: '[masked]', count: 3, flag: true, none: null },
    hunter2: 'key-is-a-secret',
  })
})

// protects=a protocol key survives a learner secret that equals it, with its value; fails_when=object keys are masked, so status or ok vanish from a tool result; no_claim=runtime data stored as keys, which Codebook's schemas do not do
test('a secret equal to a protocol key leaves the key and its value in a tool result', () => {
  // Arrange
  const result = { status: 'completed', ok: true }
  // Act
  const masked = maskRunSecretsDeep(result, new Set(['status']))
  // Assert
  assert.deepEqual(masked, { status: 'completed', ok: true })
})
