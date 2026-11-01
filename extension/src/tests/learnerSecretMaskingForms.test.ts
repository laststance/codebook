import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { maskLearnerSecretData } from '../utils/maskLearnerSecretData'
import { maskLearnerSecretText } from '../utils/maskLearnerSecretText'
import { readMaskedJsonPage } from '../utils/readMaskedJsonPage'

const SECRET = 'hunter2hunter2'

// protects=an identifier-keyed value that is exactly a learner secret is masked, a secret only inside an identifier keeps it; fails_when=apiKey, userId or an id array entry keeps the typed secret, or runUri is rewritten; no_claim=keys outside the identifier suffixes
test('a learner secret under an identifier-shaped key is masked while a secret inside a runUri keeps it', () => {
  // Arrange
  const secrets = new Set([SECRET, 'cafe'])
  // Act
  const direct = maskLearnerSecretData({ apiKey: SECRET }, secrets)
  const inArray = maskLearnerSecretData({ ids: ['x', SECRET] }, secrets)
  const inside = maskLearnerSecretData(
    { runUri: 'codebook://runs/cafe-1' },
    secrets,
  )
  // Assert
  assert.deepEqual(direct, { apiKey: '[masked]' })
  assert.deepEqual(inArray, { ids: ['x', '[masked]'] })
  assert.deepEqual(inside, { runUri: 'codebook://runs/cafe-1' })
})

// protects=only a record whose hash is the SHA-256 of its text stays unmasked; fails_when=any {text, hash} object is exempt; no_claim=the sealed record's other fields
test('a text-and-hash record is masked unless its hash really seals the text', () => {
  // Arrange
  const text = `x ${SECRET}`
  const secrets = new Set([SECRET])
  // Act
  const fake = maskLearnerSecretData({ text, hash: 'abc' }, secrets)
  const sealed = maskLearnerSecretData({ text, hash: sha256(text) }, secrets)
  // Assert
  assert.deepEqual(fake, { text: 'x [masked]', hash: 'abc' })
  assert.deepEqual(sealed, { text, hash: sha256(text) })
})

// protects=a secret with @, a space and & is masked in its percent-encoded, form-encoded and HTML-escaped copies; fails_when=a GET form URL or an echoed page keeps the secret; no_claim=other encodings
test('an encoded copy of a learner secret is masked in a URL query and in HTML-escaped page text', () => {
  // Arrange
  const secrets = new Set(['a@b c&d'])
  // Act
  const percent = maskLearnerSecretText('http://x/?pw=a%40b%20c%26d', secrets)
  const form = maskLearnerSecretText('http://x/?pw=a%40b+c%26d', secrets)
  const html = maskLearnerSecretText('<p>a@b c&amp;d</p>', secrets)
  const inData = maskLearnerSecretData(
    { url: 'http://x/?pw=a%40b%20c%26d' },
    secrets,
  )
  // Assert
  assert.equal(percent, 'http://x/?pw=[masked]')
  assert.equal(form, 'http://x/?pw=[masked]')
  assert.equal(html, '<p>[masked]</p>')
  assert.deepEqual(inData, { url: 'http://x/?pw=[masked]' })
})

/** A service stand-in that masks like the real one. */
function maskingService(secrets: ReadonlySet<string>) {
  return {
    maskLearnerSecretsInData: <T>(value: T): T =>
      maskLearnerSecretData(value, secrets),
  } as unknown as Parameters<typeof readMaskedJsonPage>[0]
}

/** Reads every page of a resource and joins its content. */
function readAllPages(
  service: Parameters<typeof readMaskedJsonPage>[0],
  value: unknown,
) {
  const base = 'codebook://runs/cafe-1/x'
  let page: string | undefined
  let joined = ''
  let hash = ''
  let guard = 0
  for (;;) {
    const resource = readMaskedJsonPage(service, base, value, page)
    assert.ok('text' in resource)
    const envelope = JSON.parse(resource.text) as {
      content: string
      contentHash: string
      nextUri?: string
    }
    joined += envelope.content
    hash = envelope.contentHash
    if (!envelope.nextUri) break
    page = envelope.nextUri.slice(base.length + 1)
    if (++guard > 100) throw new Error('paging did not end')
  }
  return { joined, hash }
}

// protects=a secret straddling a page boundary is absent from the joined pages, the hash covers the joined bytes, and a short secret keeps runUri and nextUri intact; fails_when=masking happens per page after slicing; no_claim=the MCP envelope, covered by the protocol tests
test('a paged resource masks the secret before slicing so the joined pages and the content hash agree', () => {
  // Arrange
  const padding = 'p'.repeat(4096 - 7)
  const value = {
    runUri: 'codebook://runs/cafe-1',
    note: `${padding}${SECRET} tail`,
  }
  const service = maskingService(new Set([SECRET, 'cafe']))
  // Act
  const { joined, hash } = readAllPages(service, value)
  // Assert
  assert.doesNotMatch(joined, new RegExp(SECRET))
  assert.deepEqual(JSON.parse(joined), {
    runUri: 'codebook://runs/cafe-1',
    note: `${padding}[masked] tail`,
  })
  assert.equal(hash, sha256(joined))
})
