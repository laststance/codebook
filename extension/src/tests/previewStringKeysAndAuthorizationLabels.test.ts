import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REDACTION_MASK } from '../constants'
import { createOutputRedactor } from '../utils/createOutputRedactor'
import { maskFactString } from '../utils/maskFactString'
import { maskSecretShapesInOutput } from '../utils/maskSecretShapesInOutput'
import {
  previewShowsCredentialShape,
  redactValuePreview,
} from '../utils/redactValuePreview'
import {
  applyTextReplacements,
  isSecretHeaderName,
} from '../utils/secretShapes'

/** The mask placeholder, kept out of `label: [masked]` literals so the repository's secret scanner does not read them as credential assignments. */
const MASK = '[masked]'

// The scripted secrets are made-up opaque strings, split so no scanner reads them as a real credential.
const OPAQUE_VALUE = ['opaque', 'value', '4d1c'].join('')
const API_KEY_VALUE = ['8f3a9c1d', '2e4b'].join('')
const AWS_ACCESS_KEY = ['AKID', 'EXAMPLE'].join('')
const AWS_SIGNATURE = ['5fa3c2d1', 'e8b94a70'].join('')
const AWS_AUTHORIZATION = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/20260101/us-east-1/s3/aws4_request,SignedHeaders=host;x-amz-date,Signature=${AWS_SIGNATURE}`

/** Runs `work` and fails when it takes longer than the bound, which only a quadratic scan of the input would. */
function assertFinishesWithin(
  boundMs: number,
  label: string,
  work: () => void,
): void {
  const startedAt = performance.now()
  work()
  const tookMs = performance.now() - startedAt
  // gstack-timing-ok: the bound is the contract (linear-time shape scans); measured times are a few ms against a bound of hundreds of ms, so only the quadratic regression it guards fails it.
  assert.ok(tookMs < boundMs, `${label} took ${Math.round(tookMs)} ms`)
}

// protects=a secret-named key inside an object that a string value holds (util.inspect output kept in a string, a logged object, a nested one, over several lines), quoted on the outside with either quote or escaped inside; fails_when=the quoted-string rule that spares prose also spares the member keys of an object printed in a string, so its password, token or apiKey is printed, or the mask eats the string's closing quote; no_claim=a secret word with a colon at the start of a string or after a word, which stays prose
test('a secret-named key inside an object printed in a string value is masked and the closing quote stays', () => {
  // Arrange
  const previews = [
    `"{ password: '${OPAQUE_VALUE}', n: 1 }"`,
    `'{ password: \\'${OPAQUE_VALUE}\\', n: 1 }'`,
    `{ msg: '{ password: ${OPAQUE_VALUE}, n: 1 }' }`,
    `{ body: '{ user: { id: 7, apiKey: ${OPAQUE_VALUE}}, n: 1 }' }`,
    `'{\n  token: ${OPAQUE_VALUE},\n  n: 1\n}'`,
    `{ note: 'failed, retrying: [ token: ${OPAQUE_VALUE} ]', n: 1 }`,
  ]
  // Act
  const redacted = previews.map((preview) => redactValuePreview(preview))
  const redactedFacts = previews.map((preview) => maskFactString(preview))
  // Assert
  const expected = [
    `"{ password: ${MASK}, n: 1 }"`,
    `'{ password: ${MASK}, n: 1 }'`,
    `{ msg: '{ password: ${MASK}, n: 1 }' }`,
    `{ body: '{ user: { id: 7, apiKey: ${MASK}}, n: 1 }' }`,
    `'{\n  token: ${MASK},\n  n: 1\n}'`,
    `{ note: 'failed, retrying: [ token: ${MASK} ]', n: 1 }`,
  ]
  assert.deepEqual(redacted, expected)
  assert.deepEqual(redactedFacts, expected)
  for (const text of [...redacted, ...redactedFacts])
    assert.equal(text.includes(OPAQUE_VALUE), false)
})

// protects=prose that holds a secret word and a colon beside the object rule; fails_when=a secret word after a word or at the start of a string, with a colon, is read as the key of an object member and the sentence loses its text; no_claim=a sentence whose secret word follows a comma, a bracket or a semicolon, which has the shape of a member
test('prose with a secret word and a colon stays readable beside an object printed in a string', () => {
  // Arrange
  const previews = [
    "'Invalid session: expired'",
    "{ msg: 'Invalid session: expired', n: 1 }",
    "{ note: 'password: reset', other: 'the token: none' }",
    `{ msg: 'Invalid session: expired', body: '{ n: 1, theme: "dark" }' }`,
  ]
  // Act
  const redacted = previews.map((preview) => redactValuePreview(preview))
  // Assert
  assert.deepEqual(redacted, previews)
})

// protects=the labelled Authorization rule of output lines, whatever the scheme (Cycle 0073 task 0 review: ApiKey, AWS4-HMAC-SHA256 and a short Basic value stayed readable after the label); fails_when=a value after an Authorization or Proxy-Authorization label with a colon or an equals sign stays readable because its scheme is not Basic, Negotiate, NTLM, Token or Digest or its credential is shorter than eight characters; no_claim=a Bearer value, which the secret text rule masks and keeps the word of
test('output masks the whole value after an Authorization or Proxy-Authorization label with a colon or an equals sign, whatever the scheme', () => {
  // Arrange
  const output = [
    `Authorization: ApiKey ${API_KEY_VALUE}`,
    `Authorization=ApiKey ${API_KEY_VALUE}`,
    `Proxy-Authorization: ApiKey ${API_KEY_VALUE}`,
    `Authorization: ${AWS_AUTHORIZATION}`,
    'Authorization: Basic YTpi',
    'Authorization: Token expired',
    `request failed. Authorization: ApiKey ${API_KEY_VALUE}`,
    `(Authorization: ApiKey ${API_KEY_VALUE}) retried`,
    '',
  ].join('\n')
  // Act
  const masked = maskSecretShapesInOutput(output).text
  // Assert
  assert.equal(
    masked,
    [
      `Authorization: ${MASK}`,
      `Authorization=${MASK}`,
      `Proxy-Authorization: ${MASK}`,
      `Authorization: ${MASK}`,
      `Authorization: ${MASK}`,
      `Authorization: ${MASK}`,
      `request failed. Authorization: ${MASK}`,
      `(Authorization: ${MASK}) retried`,
      '',
    ].join('\n'),
  )
  for (const secret of [API_KEY_VALUE, AWS_ACCESS_KEY, AWS_SIGNATURE])
    assert.equal(masked.includes(secret), false)
})

// protects=one masking for a Bearer value after an Authorization label; fails_when=the word `Bearer` is lost, or the token is masked twice (`Bearer [masked]` becomes `[masked] [masked]` or a second pass changes the line); no_claim=a Bearer token of other shapes (own test)
test('an Authorization label with a Bearer value keeps the word and masks the token once', () => {
  // Arrange
  const line = `Authorization: Bearer ${API_KEY_VALUE}\n`
  // Act
  const shapesOnly = maskSecretShapesInOutput(line).text
  const released = createOutputRedactor()
  const viaRedactor = released.write(line) + released.end()
  // Assert
  assert.equal(shapesOnly, `Authorization: Bearer ${MASK}\n`)
  assert.equal(viaRedactor, `Authorization: Bearer ${MASK}\n`)
})

// protects=an Authorization line that the process prints in two writes; fails_when=the redactor releases the first half of the line before the rest arrives, or judges the halves apart, so a scheme the older rule misses (ApiKey) is printed; no_claim=a line that grows past the redactor's hold limit, which fails closed
test('the output redactor judges an Authorization line split over two writes whole, whatever the scheme', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const firstWrite = 'Authorization: Api'
  const secondWrite = `Key ${API_KEY_VALUE}\nlistening on 3000\n`
  // Act
  const released =
    redactor.write(firstWrite) + redactor.write(secondWrite) + redactor.end()
  // Assert
  assert.equal(released, `Authorization: ${MASK}\nlistening on 3000\n`)
  assert.equal(released.includes(API_KEY_VALUE), false)
})

// protects=masking that can run again over masked text (a saved history is masked when it is served, after the output was masked when it was printed); fails_when=a second pass over an Authorization line, a fact or a preview whose value is already the mask adds a bracket, changes the mask or shows a credential shape; no_claim=text whose value is another marker than the mask
test('masked Authorization values stay unchanged when they are masked again', () => {
  // Arrange
  const maskedLines = [
    `Authorization: ${MASK}`,
    `Proxy-Authorization: ${MASK}`,
    `Authorization: Bearer ${MASK}`,
  ]
  const maskedPreview = `{ h: 'Authorization: ${MASK}', n: 1 }`
  // Act
  const lines = maskedLines.map((text) => maskSecretShapesInOutput(text).text)
  const facts = maskedLines.map((text) => maskFactString(text))
  const previewFact = maskFactString(maskedPreview)
  const preview = redactValuePreview(maskedPreview)
  const previewShowsShape = previewShowsCredentialShape(maskedPreview)
  // Assert
  assert.deepEqual(lines, maskedLines)
  // The member rule of a fact masks the Bearer word too, as it did before the label rule.
  assert.deepEqual(facts, [
    `Authorization: ${MASK}`,
    `Proxy-Authorization: ${MASK}`,
    `Authorization: ${MASK}`,
  ])
  assert.equal(previewFact, maskedPreview)
  assert.equal(preview, maskedPreview)
  assert.equal(previewShowsShape, false)
})

// protects=text that only mentions the Authorization word and a bare scheme string; fails_when=the label rule masks a line without a colon or an equals sign, an empty value, or the prose guard of the unlabelled Authorization shape is lost; no_claim=a line that has an Authorization label, a colon and prose after it, which is masked whole
test('Authorization words without a separator or a value and bare scheme prose stay readable', () => {
  // Arrange
  const output = [
    'Authorization header missing',
    'Authorization:',
    'Authorization:   ',
    'Basic usage',
    'Token expired',
    'authorization_endpoint is set',
    '',
  ].join('\n')
  // Act
  const masked = maskSecretShapesInOutput(output).text
  const facts = ['Basic usage', 'Token expired', 'Authorization header missing']
  // Assert
  assert.equal(masked, output)
  assert.deepEqual(
    facts.map((fact) => maskFactString(fact)),
    facts,
  )
})

// protects=the labelled Authorization rule in a fact string and in a preview (Cycle 0073 task 0 review: a fact with an equals sign, a scheme with commas and a header line held in a quoted preview element kept their credential); fails_when=a bare fact with Authorization, an equals sign or a scheme whose credential holds commas, or a quoted header line inside a preview, prints its value, or a mask eats the closing quote or the members beside it; no_claim=a header line whose label is inside a longer word
test('a fact string and a preview mask the value after an Authorization label whatever the scheme and keep the quote and the members around it', () => {
  // Arrange
  const facts = [
    `Authorization=ApiKey ${API_KEY_VALUE}`,
    `Authorization: ${AWS_AUTHORIZATION}`,
    `Proxy-Authorization: ApiKey ${API_KEY_VALUE}`,
    `'Authorization: ApiKey ${API_KEY_VALUE}'`,
    `'Authorization: ${AWS_AUTHORIZATION}'`,
    `{ h: 'Authorization: ApiKey ${API_KEY_VALUE}', n: 1 }`,
    `{ h: 'Authorization=ApiKey ${API_KEY_VALUE}', n: 1 }`,
    `{ authorization: undefined, n: 1 }`,
  ]
  // Act
  const masked = facts.map((fact) => maskFactString(fact))
  const previews = facts.map((fact) => redactValuePreview(fact))
  // Assert
  const expected = [
    `Authorization=${MASK}`,
    `Authorization: ${MASK}`,
    `Proxy-Authorization: ${MASK}`,
    `'Authorization: ${MASK}'`,
    `'Authorization: ${MASK}'`,
    `{ h: 'Authorization: ${MASK}', n: 1 }`,
    `{ h: 'Authorization=${MASK}', n: 1 }`,
    `{ authorization: ${MASK}, n: 1 }`,
  ]
  assert.deepEqual(masked, expected)
  assert.deepEqual(previews, expected)
  for (const text of [...masked, ...previews])
    for (const secret of [API_KEY_VALUE, AWS_ACCESS_KEY, AWS_SIGNATURE])
      assert.equal(text.includes(secret), false)
})

// protects=the parent preview rule for a header line held in a string; fails_when=a preview that shows an Authorization header line with a scheme the older shapes miss is kept as readable text instead of being judged a credential shape; no_claim=a preview whose Authorization member is a plain object member, which the member rule masks
test('a preview that holds an Authorization header line with any scheme shows a credential shape', () => {
  // Arrange
  const withHeader = `{ h: 'Authorization: ApiKey ${API_KEY_VALUE}', n: 1 }`
  const withoutHeader = "{ h: 'Authorization header missing', n: 1 }"
  // Act
  const showsHeader = previewShowsCredentialShape(withHeader)
  const showsNothing = previewShowsCredentialShape(withoutHeader)
  // Assert
  assert.equal(showsHeader, true)
  assert.equal(showsNothing, false)
})

// protects=the linear-time scan of an Authorization-shaped string whose token is a word followed by dots; fails_when=the check for a mark in the token rescans the trailing dots for every dot (8.1 s at 262,144 characters before the fix), which blocks the extension host in a fact, a replay value or the output journal; no_claim=the exact wall time of any machine
test('a bare scheme word with a very long run of dots is judged in linear time and left unchanged', () => {
  // Arrange
  const text = `Basic aaaaaaaa${'.'.repeat(200_000)}`
  // Act and Assert
  assertFinishesWithin(500, 'maskFactString on a dot run', () => {
    assert.equal(maskFactString(text), text)
  })
  assertFinishesWithin(500, 'maskSecretShapesInOutput on a dot run', () => {
    assert.equal(maskSecretShapesInOutput(text).text, text)
  })
})

// protects=the fail-closed merge of replacements that cut across each other; fails_when=two stretches that overlap without one holding the other keep a readable gap or the second replacement's text, so part of a secret is printed; no_claim=stretches that only touch, which stay two replacements
test('two replaced stretches that cut across each other become one mask over both', () => {
  // Arrange
  const text = 'abcdefgh'
  // Act
  const crossing = applyTextReplacements(text, [
    { start: 3, end: 5, text: 'Y' },
    { start: 1, end: 4, text: 'X' },
  ])
  const nested = applyTextReplacements(text, [
    { start: 2, end: 3, text: 'Y' },
    { start: 1, end: 6, text: 'X' },
  ])
  const touching = applyTextReplacements(text, [
    { start: 1, end: 3, text: 'X' },
    { start: 3, end: 5, text: 'Y' },
  ])
  // Assert
  assert.equal(crossing, `a${REDACTION_MASK}fgh`)
  assert.equal(nested, 'aXgh')
  assert.equal(touching, 'aXYfgh')
})

// protects=the header-name guard of the cookie record rule; fails_when=a name member with a blank in it (prose such as `invalid token`) is read as a secret header name, so the value beside it is masked; no_claim=a name without a blank that is a secret name, which masks its value
test('a record whose name member is prose with a secret word keeps its value readable', () => {
  // Arrange
  const readable = "{name: 'invalid token', value: 'expired'}"
  const secret = "{name: 'session', value: 'expired'}"
  // Act
  const readableVerdict = isSecretHeaderName('invalid token')
  const secretVerdict = isSecretHeaderName('session')
  const redactedReadable = redactValuePreview(readable)
  const redactedSecret = redactValuePreview(secret)
  // Assert
  assert.equal(readableVerdict, false)
  assert.equal(secretVerdict, true)
  assert.equal(redactedReadable, readable)
  assert.equal(redactedSecret, `{name: 'session', value: ${MASK}}`)
})

// protects=a Bearer value after an Authorization label whose token the text rule for Bearer tokens does not take for one (Cycle 0073 pt1 /ship pass 2: `Bearer 12|abcdefgh`, `Bearer v2:abcdefgh` and `Bearer short` stayed visible, against the README sentence that any scheme after the label is masked); fails_when=such a token is printed in a line, through the output redactor, in a fact string or in a quoted preview element, or the word `Bearer` is lost, or a second pass changes the masked text; no_claim=a Bearer word with no Authorization label before it (`Bearer short` alone), which stays prose
test('an Authorization label masks everything after a Bearer word, a short or punctuated token included, and keeps the word', () => {
  // Arrange
  const tokens = [
    ['12', 'abcdefgh'].join('|'),
    ['v2', 'abcdefgh'].join(':'),
    'short',
  ]
  const lines = tokens.map((token) => `Authorization: Bearer ${token}`)
  const proxyLine = `Proxy-Authorization: Bearer ${tokens[0]}`
  const quotedValue = `{ authorization: "Bearer ${tokens[2]}", n: 1 }`
  // Act
  const masked = lines.map((line) => maskSecretShapesInOutput(line).text)
  const maskedAgain = masked.map((line) => maskSecretShapesInOutput(line).text)
  const proxyMasked = maskSecretShapesInOutput(proxyLine).text
  const quotedMasked = maskSecretShapesInOutput(quotedValue).text
  const viaRedactor = lines.map((line) => {
    const redactor = createOutputRedactor()
    return redactor.write(`${line}\n`) + redactor.end()
  })
  const previews = tokens.map((token) =>
    redactValuePreview(`{ h: 'Authorization: Bearer ${token}', n: 1 }`),
  )
  const facts = lines.map((line) => maskFactString(line))
  // Assert
  assert.deepEqual(masked, [
    `Authorization: Bearer ${MASK}`,
    `Authorization: Bearer ${MASK}`,
    `Authorization: Bearer ${MASK}`,
  ])
  assert.deepEqual(maskedAgain, masked)
  assert.equal(proxyMasked, `Proxy-Authorization: Bearer ${MASK}`)
  assert.equal(quotedMasked, `{ authorization: "Bearer ${MASK}", n: 1 }`)
  assert.deepEqual(viaRedactor, [
    `Authorization: Bearer ${MASK}\n`,
    `Authorization: Bearer ${MASK}\n`,
    `Authorization: Bearer ${MASK}\n`,
  ])
  assert.deepEqual(previews, [
    `{ h: 'Authorization: Bearer ${MASK}', n: 1 }`,
    `{ h: 'Authorization: Bearer ${MASK}', n: 1 }`,
    `{ h: 'Authorization: Bearer ${MASK}', n: 1 }`,
  ])
  // The member rule of a fact masks the Bearer word too, as it did before the label rule.
  assert.deepEqual(facts, [
    `Authorization: ${MASK}`,
    `Authorization: ${MASK}`,
    `Authorization: ${MASK}`,
  ])
  for (const text of [
    ...masked,
    proxyMasked,
    quotedMasked,
    ...viaRedactor,
    ...previews,
    ...facts,
  ])
    for (const token of tokens) assert.equal(text.includes(token), false)
})
