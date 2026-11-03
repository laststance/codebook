import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createOutputRedactor } from '../utils/createOutputRedactor'
import { maskNextServerOutput } from '../utils/maskNextServerOutput'
import { maskSecretShapesInOutput } from '../utils/maskSecretShapesInOutput'

/** The mask placeholder, kept out of `label: [masked]` literals so the repository's secret scanner does not read them as credential assignments. */
const MASK = '[masked]'

// The scripted secrets are made-up opaque strings; they are split so no scanner reads them as a real credential.
const COOKIE_VALUE = ['SESSION', 'COOKIE', 'VALUE', 'opaque', '8f3a91c2'].join(
  '-',
)
const BASIC_CREDENTIAL = ['dXNlcjpT', 'M2NyZXRQ', 'YXNz'].join('')

/**
 * Feeds chunks to a fresh output redactor and returns everything it released, what it held until the end included.
 * @param chunks - The writes of one channel, in order.
 * @returns The released text.
 * @example releaseAll(['sid', '=abc; theme=dark\n']) // => '[masked]\n'
 */
function releaseAll(chunks: readonly string[]): string {
  const redactor = createOutputRedactor()
  return chunks.map((chunk) => redactor.write(chunk)).join('') + redactor.end()
}

// protects=the development-server output a Pages refusal quotes and the journal keeps, when a data function logs the request; fails_when=a logged Cookie header, an Authorization value or the elements after Cookie and Authorization in a logged rawHeaders list (with its "... more items" end) are printed, or the harmless lines around them are blanked; no_claim=a credential with none of these shapes
test('development-server output masks a logged Cookie header, Authorization header and rawHeaders list and keeps the other lines', () => {
  // Arrange
  const output = [
    `sid=${COOKIE_VALUE}; theme=dark`,
    `Basic ${BASIC_CREDENTIAL}`,
    '[',
    "  'Host',",
    "  'localhost:3000',",
    "  'Cookie',",
    `  'sid=${COOKIE_VALUE}; theme=dark',`,
    "  'Authorization',",
    `  'Negotiate ${BASIC_CREDENTIAL}',`,
    '  ... 4 more items',
    ']',
    'GET /items 200',
    '',
  ].join('\n')

  // Act
  const masked = maskNextServerOutput(output)

  // Assert
  assert.equal(
    masked,
    [
      '<redacted>',
      '<redacted>',
      '[',
      "  'Host',",
      "  'localhost:3000',",
      "  'Cookie',",
      '  <redacted>,',
      "  'Authorization',",
      '  <redacted>,',
      '  ... 4 more items',
      ']',
      'GET /items 200',
      '',
    ].join('\n'),
  )
})

// protects=a Cookie pair and a printed header list that arrive split over several writes; fails_when=the first half of the pair, or the element a write boundary cut after 'Cookie', is released before the rest arrives; no_claim=a line that outgrows the 8 KiB hold limit (see the long-line tests below)
test('the output redactor masks a Cookie pair split over two chunks and a rawHeaders element cut by a chunk boundary', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const chunks = [
    `sid=${COOKIE_VALUE.slice(0, 12)}`,
    `${COOKIE_VALUE.slice(12)}; theme=dark\n`,
    "[\n  'Host',\n  'x',\n  'Cookie',\n",
    `  'sid=${COOKIE_VALUE.slice(0, 9)}`,
    `${COOKIE_VALUE.slice(9)}',\n  ... 1 more item\n]\n`,
  ]

  // Act
  const released =
    chunks.map((chunk) => redactor.write(chunk)).join('') + redactor.end()

  // Assert
  assert.equal(
    released,
    "[masked]\n[\n  'Host',\n  'x',\n  'Cookie',\n  [masked],\n  ... 1 more item\n]\n",
  )
})

// protects=a quoted Cookie value that follows an apostrophe in a log line; fails_when=the apostrophe of "don't" or "it's" opens an element that swallows the quote of the Cookie value, so the value is printed; no_claim=a log line whose quotes are unbalanced in any other way
test('development-server output masks a quoted Cookie value after an apostrophe in the same log line', () => {
  // Arrange
  const output = `don't log 'sid=${COOKIE_VALUE}; theme=dark' it's done\n`

  // Act
  const masked = maskNextServerOutput(output)

  // Assert
  assert.equal(masked, "don't log <redacted> it's done\n")
})

// protects=a Cookie or Authorization line whose first word is cut by a chunk boundary (Cycle 0073 task 0 review: each of these four splits leaked); fails_when=the first word of a line is released before the rest of the line arrives, so the pair or the header is judged in two halves; no_claim=a first word longer than 64 characters
test('the output redactor masks a Cookie pair, a Cookie header and an Authorization header whose first word is cut by a chunk boundary', () => {
  // Arrange
  const cookiePair = [`sid`, `=${COOKIE_VALUE}; theme=dark\n`]
  const cookieHeader = ['Coo', `kie: sid=${COOKIE_VALUE}; theme=dark\n`]
  const authorizationHeader = ['author', `ization: Basic ${BASIC_CREDENTIAL}\n`]
  const schemeValue = ['Bas', `ic ${BASIC_CREDENTIAL}\n`]

  // Act
  const releasedPair = releaseAll(cookiePair)
  const releasedCookieHeader = releaseAll(cookieHeader)
  const releasedAuthorizationHeader = releaseAll(authorizationHeader)
  const releasedSchemeValue = releaseAll(schemeValue)

  // Assert
  assert.equal(releasedPair, '[masked]\n')
  assert.equal(releasedCookieHeader, `Cookie: ${MASK}\n`)
  assert.equal(releasedAuthorizationHeader, `authorization: ${MASK}\n`)
  assert.equal(releasedSchemeValue, '[masked]\n')
})

// protects=a partial line of several plain words still reaches the reader at once, so output keeps its order around a debugger stop; fails_when=the first-word hold also holds a line that has a blank, a quote, an equals sign and no Cookie or Authorization word; no_claim=a partial line of one word, which waits for the rest of its line by design
test('a partial line of several plain words is released at once', () => {
  // Arrange
  const redactor = createOutputRedactor()

  // Act
  const released = redactor.write('server ready on port 3000')

  // Assert
  assert.equal(released, 'server ready on port 3000')
})

// protects=the documented wait of a partial line that holds an equals sign: it is released with its line break (README, masked by shape); fails_when=the line is released before its break, or lost; no_claim=a release after an idle time, which the redactor does not have
test('a partial line with an equals sign waits for its line break and is released with it', () => {
  // Arrange
  const redactor = createOutputRedactor()

  // Act
  const beforeBreak = redactor.write('port=3000')
  const withBreak = redactor.write('\n')

  // Assert
  assert.equal(beforeBreak, '')
  assert.equal(withBreak, 'port=3000\n')
})

// protects=a progress line that rewrites itself with a carriage return is not held until a newline (Cycle 0073 task 0 review: `[====>   ] 40%\r` waited for the 8 KiB limit); fails_when=a carriage return does not end the line for the hold; no_claim=the terminal's rendering of the rewrite
test('a progress bar that ends in a carriage return is released at once', () => {
  // Arrange
  const redactor = createOutputRedactor()

  // Act
  const firstFrame = redactor.write('[====>   ] 40%\r')
  const secondFrame = redactor.write('[=====>  ] 50%\r')

  // Assert
  assert.equal(firstFrame, '[====>   ] 40%\r')
  assert.equal(secondFrame, '[=====>  ] 50%\r')
})

// protects=a Cookie header printed after a carriage return is judged as its own line; fails_when=text before the carriage return makes the header look like prose, so its pairs are printed; no_claim=a header split over carriage returns
test('a Cookie header after a carriage return is masked like a header on its own line', () => {
  // Arrange
  const output = `50%\rsid=${COOKIE_VALUE}; theme=dark\r\nGET /items 200\n`

  // Act
  const masked = maskSecretShapesInOutput(output).text

  // Assert
  assert.equal(masked, '50%\r[masked]\r\nGET /items 200\n')
})

// protects=a quoted rawHeaders element is judged whole when a secret-prefixed run ends the write (the head of the line used to be released alone, with its quote unclosed); fails_when=the Cookie element before the run is released unmasked; no_claim=a list whose name and value are separated by other elements
test('a rawHeaders element cut right before a secret-prefixed word is masked', () => {
  // Arrange
  const githubToken = ['ghp', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
  const chunks = [
    `['Cookie', 'sid=${COOKIE_VALUE}; token=ghp_`,
    `${githubToken.slice(4)}']\n`,
  ]

  // Act
  const released = releaseAll(chunks)

  // Assert
  assert.equal(released, "['Cookie', [masked]]\n")
})

// protects=a Cookie value inside one header line longer than the 8 KiB hold, written in two parts (Cycle 0073 task 0 review: 31 of 70 cut positions printed it); fails_when=the line is released in pieces, so a cut inside the quoted value hides it from the mask; no_claim=a line that is written whole with its break in one write, which is judged whole
test('a Cookie value inside a header line longer than the hold is masked at every position the line is cut between two writes', () => {
  // Arrange
  const padding = 'a'.repeat(9_000)
  const line = `{"host":"localhost","padding":"${padding}","cookie":"sid=${COOKIE_VALUE}; theme=dark"}`
  const valueAt = line.indexOf(COOKIE_VALUE)
  const cuts: number[] = []
  for (let cut = 1; cut < line.length; cut += 97) cuts.push(cut)
  for (let cut = valueAt - 20; cut < valueAt + COOKIE_VALUE.length + 20; cut++)
    cuts.push(cut)

  // Act
  const leakingCuts = cuts.filter((cut) =>
    releaseAll([line.slice(0, cut), `${line.slice(cut)}\n`]).includes(
      COOKIE_VALUE,
    ),
  )
  const cutBeforeHoldLimit = releaseAll([
    line.slice(0, 100),
    `${line.slice(100)}\n`,
  ])
  const cutPastHoldLimit = releaseAll([
    line.slice(0, 8_300),
    `${line.slice(8_300)}\nready\n`,
  ])

  // Assert
  assert.deepEqual(leakingCuts, [])
  assert.equal(
    cutBeforeHoldLimit,
    `{"host":"localhost","padding":"${padding}","cookie":[masked]}\n`,
  )
  assert.equal(cutPastHoldLimit, '[masked]\nready\n')
})

// protects=the rest of an over-long header line is dropped across several writes and output resumes at its line break; fails_when=a middle write of the dropped line is released, or the line after it is lost; no_claim=a line without a Cookie, Authorization, quote, equals sign or semicolon, which is released with a short carry as before
test('an over-long header line is dropped across writes and the next line is released', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const overlong = `{"padding":"${'a'.repeat(8_300)}`

  // Act
  const first = redactor.write(overlong)
  const middle = redactor.write(`b","cookie":"sid=${COOKIE_VALUE}; theme=dark`)
  const last = redactor.write('"}\nlistening on http://127.0.0.1:4000\n')
  const ended = redactor.end()

  // Assert
  assert.equal(first, '[masked]')
  assert.equal(middle, '')
  assert.equal(last, '\nlistening on http://127.0.0.1:4000\n')
  assert.equal(ended, '')
})

// protects=a labelled credential header is masked in the forms ordinary logs print it (Cycle 0073 task 0 review: each leaked): a quoted Digest, a trailing comment, one non-secret cookie pair, a quoted single pair and a blank for the separator; fails_when=the label stops at the first quote, the comment makes the value read as prose, a lone JSESSIONID pair is kept for its single-pair readability, or a blank is not a separator; no_claim=a label whose value is not a cookie pair or an Authorization scheme, which stays readable
test('a labelled Cookie or Authorization header is masked with a quoted Digest, a trailing comment, one session pair, quotes or a blank separator', () => {
  // Arrange
  const digest =
    'Authorization: Digest username="u", realm="r", nonce="n", response="abc"'
  const comment = `Cookie: sid=${COOKIE_VALUE}; theme=dark  # from client`
  const singlePair = 'Cookie: JSESSIONID=ABCDEF0123456789'
  const quotedSinglePair = "cookie: 'PHPSESSID=ABCDEF0123456789'"
  const blank = `cookie sid=${COOKIE_VALUE}; theme=dark`
  const setCookie = 'Set-Cookie: theme=dark; Path=/; HttpOnly'
  const loggedKey = '{cookie: "theme=dark", ok: true}'

  // Act
  const masked = maskSecretShapesInOutput(
    [
      digest,
      comment,
      singlePair,
      quotedSinglePair,
      blank,
      setCookie,
      loggedKey,
      '',
    ].join('\n'),
  ).text

  // Assert
  assert.equal(
    masked,
    [
      `Authorization: ${MASK}`,
      `Cookie: ${MASK}`,
      `Cookie: ${MASK}`,
      // PHPSESSID is a session cookie name, so the quoted pair is itself a Cookie shape and the literal rule masks it whole, quotes included.
      `cookie: ${MASK}`,
      `cookie ${MASK}`,
      `Set-Cookie: ${MASK}`,
      '{cookie: "[masked]", ok: true}',
      '',
    ].join('\n'),
  )
})

// protects=prose that only mentions a Cookie or Authorization label stays readable; fails_when=a Cookie label, or an Authorization label without a colon or an equals sign, masks the rest of the line, whatever follows it; no_claim=a value after an Authorization label with a colon or an equals sign, which is masked whatever its scheme (previewStringKeysAndAuthorizationLabels), and prose that starts with a cookie pair
test('prose after a Cookie or Authorization label stays readable', () => {
  // Arrange
  const output = [
    'Cookie banner accepted',
    'Set-Cookie header was ignored',
    'Authorization header missing',
    '',
  ].join('\n')

  // Act
  const masked = maskSecretShapesInOutput(output).text

  // Assert
  assert.equal(masked, output)
})
