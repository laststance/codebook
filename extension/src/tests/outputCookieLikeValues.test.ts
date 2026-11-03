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

// protects=a Cookie value inside one header line longer than the 8 KiB hold, written in two parts (Cycle 0073 task 0 review: 31 of 70 cut positions printed it); fails_when=the line is released in pieces, so a cut inside the quoted value hides it from the mask; no_claim=the exact text around the mask, which depends on where the carry cuts
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
  // The part before the Cookie label is no credential, so it is released with a short carry and the label and its value are judged together in the next write.
  assert.equal(
    cutPastHoldLimit,
    `{"host":"localhost","padding":"${padding}","cookie":[masked]}\nready\n`,
  )
})

// protects=the rest of an over-long header line is dropped across several writes and output resumes at its line break; fails_when=a middle write of the dropped line is released, or the line after it is lost; no_claim=a long line that shows no Cookie or Authorization label, cookie pair, scheme or open header array (a JSON document), which is released with a short carry
test('an over-long header line is dropped across writes and the next line is released', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const overlong = `{"cookie":"sid=${COOKIE_VALUE}; padding=${'a'.repeat(8_300)}`

  // Act
  const first = redactor.write(overlong)
  const middle = redactor.write(`b","other":"sid=${COOKIE_VALUE}; theme=dark`)
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

// protects=the quoted-key colon branch of the header-list rule: a logged header object names `x-api-key` and `set-cookie` as quoted keys; fails_when=the value after a quoted credential key is printed; no_claim=an object whose keys are no credential header
test('a logged header object masks the values of a quoted x-api-key and a quoted set-cookie key and keeps the host', () => {
  // Arrange
  const apiKey = ['k', '123'].join('-')
  const output = `{ host: 'x', 'x-api-key': '${apiKey}', 'set-cookie': [ 'opaque' ] }`

  // Act
  const masked = maskSecretShapesInOutput(output).text

  // Assert
  assert.equal(
    masked,
    `{ host: 'x', 'x-api-key': ${MASK}, 'set-cookie': [ ${MASK} ] }`,
  )
})

// protects=lines that are a credential by themselves: an assignment of a secret name, a plain assignment and an Authorization value with a trailing comma; fails_when=API_KEY=… keeps its value, port=3000 is masked, or the comma of a logged list is lost with the credential; no_claim=a line of prose
test('a bare secret assignment is masked, a plain assignment is kept and a Basic credential keeps its trailing comma', () => {
  // Arrange
  const lines = [
    ['API_KEY', 'abc123xyz'].join('='),
    'port=3000',
    `  Basic ${BASIC_CREDENTIAL},`,
  ]

  // Act
  const masked = lines.map((line) => maskSecretShapesInOutput(line).text)

  // Assert
  assert.deepEqual(masked, [`API_KEY=${MASK}`, 'port=3000', `  ${MASK},`])
})

// protects=a printed cookie record in output, which the debugger preview already masks: the value beside a secret `name` or `key` member, also in a cookies array, in JSON, over several lines and when the value comes first (Cycle 0073 pt1 /ship pass 1: `{ name: 'sid', value: … }` was printed); fails_when=the record's value is printed, or the value of a record named by a plain word is masked with it; no_claim=a record split over two writes, which the redactor does not pair
test('a printed record named by a secret cookie name has its value masked and a record named by a plain word keeps it', () => {
  // Arrange
  const records = [
    `{ name: 'sid', value: '${COOKIE_VALUE}' }`,
    `{ cookies: [ { name: 'sid', value: '${COOKIE_VALUE}' } ] }`,
    `[ { name: 'sid', value: '${COOKIE_VALUE}' }, { name: 'theme', value: 'dark' } ]`,
    `{ value: '${COOKIE_VALUE}', name: 'session' }`,
    `{"name":"JSESSIONID","value":"${COOKIE_VALUE}","path":"/"}`,
    `{\n  name: 'sid',\n  value: '${COOKIE_VALUE}',\n  path: '/'\n}`,
    `{ key: 'session', value: ${COOKIE_VALUE.length} }`,
    "{ name: 'theme', value: 'dark' }",
  ]

  // Act
  const masked = records.map((record) => maskSecretShapesInOutput(record).text)

  // Assert
  assert.deepEqual(masked, [
    `{ name: 'sid', value: ${MASK} }`,
    `{ cookies: [ { name: 'sid', value: ${MASK} } ] }`,
    `[ { name: 'sid', value: ${MASK} }, { name: 'theme', value: 'dark' } ]`,
    `{ value: ${MASK}, name: 'session' }`,
    `{"name":"JSESSIONID","value":${MASK},"path":"/"}`,
    `{\n  name: 'sid',\n  value: ${MASK},\n  path: '/'\n}`,
    `{ key: 'session', value: ${MASK} }`,
    "{ name: 'theme', value: 'dark' }",
  ])
  assert.equal(masked.join('').includes(COOKIE_VALUE), false)
})

// protects=the printed record rule runs in released output lines as well as in the preview, in linear time; fails_when=the record scan rescans the text for each member; no_claim=the exact wall time of any machine
test('a long line of printed records is masked in linear time', () => {
  // Arrange
  const output = `${"{ name: 'sid', value: 'x' }, ".repeat(5_000)}\n`
  const startedAt = performance.now()

  // Act
  const masked = maskSecretShapesInOutput(output).text
  const tookMs = performance.now() - startedAt

  // Assert
  assert.equal(masked, `${`{ name: 'sid', value: ${MASK} }, `.repeat(5_000)}\n`)
  // gstack-timing-ok: the bound is the contract (linear-time output masking); the measured time is a few ms against a bound of hundreds of ms.
  assert.ok(tookMs < 500, `masking took ${Math.round(tookMs)} ms`)
})

// protects=an OAuth callback code or a token in the path of a logged request line, which the README promises shows as [masked] in output (Cycle 0073 pt1 /ship pass 1: `GET /cb?code=… 200` stayed visible outside a Pages workspace); fails_when=a bare path with a secret or code query value, or a fragment token, is released unmasked, or an ordinary query is masked; no_claim=a query value that is no secret name, which stays readable
test('a logged request path masks the code and secret query values, in the query and in the fragment, and keeps the other values', () => {
  // Arrange
  const callbackCode = ['callback', 'code', '8e1b3a65'].join('-')
  const lines = [
    `GET /cb?code=${callbackCode}&state=xyz 200 in 12ms\n`,
    `GET /items?page=2&sort=name 200 in 3ms\n`,
    `redirect to https://idp.example/cb#access_token=${callbackCode}&state=1\n`,
    `GET /login?next=/cb?code=${callbackCode} 302\n`,
  ]

  // Act
  const released = lines.map((line) => releaseAll([line]))

  // Assert
  assert.deepEqual(released, [
    `GET /cb?code=${MASK}&state=xyz 200 in 12ms\n`,
    'GET /items?page=2&sort=name 200 in 3ms\n',
    `redirect to https://idp.example/cb#access_token=${MASK}&state=1\n`,
    `GET /login?next=/cb?code=${MASK} 302\n`,
  ])
  assert.equal(released.join('').includes(callbackCode), false)
})

// protects=the marker a caller keeps for its own output (Cycle 0073 pt1 /ship pass 2: the URL mask always wrote `[masked]`, so Next's `<redacted>` pass peeled the `]` and printed `?code=<redacted>] 200`); fails_when=a secret query or fragment value of a logged request line, a quoted URL or a cut quoted URL carries any other marker than the one the caller passed, or the line keeps a stray bracket or more than one marker; no_claim=the masking of the secret-named assignments and the other query values of Next output (nextPagesMessageParts)
test('Next server output ends a masked request path with one marker and no stray bracket when the secret pair is last before a blank', () => {
  // Arrange
  const callbackCode = ['callback', 'code', '8e1b3a65'].join('-')
  const lines = [
    `GET /cb?code=${callbackCode} 200\n`,
    `GET /cb?state=xyz&code=${callbackCode} 200 in 12ms\n`,
    `GET /login?next=/cb?code=${callbackCode} 302\n`,
    `redirect https://idp.example/cb#access_token=${callbackCode} 302\n`,
    `{"url":"/cb?code=${callbackCode}"}\n`,
  ]

  // Act
  const masked = lines.map((line) => maskNextServerOutput(line))

  // Assert
  assert.deepEqual(masked, [
    'GET /cb?code=<redacted> 200\n',
    'GET /cb?state=<redacted>&code=<redacted> 200 in 12ms\n',
    'GET /login?next=<redacted> 302\n',
    'redirect https://idp.example/cb#access_token=<redacted> 302\n',
    '{"url":"/cb?code=<redacted>"}\n',
  ])
  for (const line of masked) {
    assert.equal(line.includes(callbackCode), false)
    assert.equal(line.includes(']'), false)
    assert.equal(line.includes(MASK), false)
  }
})

// protects=the URL mask of a line whose Cookie or Set-Cookie label masked something (Cycle 0073 pt1 /ship pass 2: the labelled result was returned at once, so a callback code before or after the header stayed visible); fails_when=a line with both a secret URL query value and a labelled cookie value prints either one, or a quoted label value (`cookie: "theme=dark" then …`) drops the URL mask for the text after its closing quote; no_claim=a URL inside the masked cookie value, which the label mask covers whole
test('a line with a callback code and a Cookie header masks both values', () => {
  // Arrange
  const callbackCode = ['callback', 'code', '8e1b3a65'].join('-')
  const lines = [
    `GET /cb?code=${callbackCode} cookie: sid=${COOKIE_VALUE}`,
    `cookie: "theme=dark" then GET /cb?code=${callbackCode} 200`,
    `redirect /cb#access_token=${callbackCode} Set-Cookie: sid=${COOKIE_VALUE}; Path=/`,
  ]

  // Act
  const masked = lines.map((line) => maskSecretShapesInOutput(line).text)

  // Assert
  assert.deepEqual(masked, [
    `GET /cb?code=${MASK} cookie: ${MASK}`,
    `cookie: "${MASK}" then GET /cb?code=${MASK} 200`,
    `redirect /cb#access_token=${MASK} Set-Cookie: ${MASK}`,
  ])
  for (const line of masked) {
    assert.equal(line.includes(callbackCode), false)
    assert.equal(line.includes(COOKIE_VALUE), false)
  }
})

// protects=the marker a caller passes to the output masking reaches every URL rule (Cycle 0073 pt1 /ship pass 2: the bare line, a quoted URL and a URL in a cut element wrote the default marker whatever the caller passed); fails_when=a secret query or fragment value in a bare line, a quoted URL, an element a cap cut or a line with a Cookie label reads `[masked]` instead of the caller's `<redacted>`; no_claim=the default marker, which every other test of this file covers
test('a caller that keeps its own marker gets it for every secret URL value of an output line', () => {
  // Arrange
  const callbackCode = ['callback', 'code', '8e1b3a65'].join('-')
  const ownMarker = '<redacted>'
  const lines = [
    `GET /cb?code=${callbackCode} 200`,
    `{"url":"/cb?code=${callbackCode}"}`,
    `'/cb?code=${callbackCode}&page=2… [truncated]`,
    `redirect /cb#access_token=${callbackCode} 302`,
    `GET /cb?code=${callbackCode} cookie: sid=${COOKIE_VALUE}`,
  ]

  // Act
  const masked = lines.map(
    (line) => maskSecretShapesInOutput(line, false, ownMarker).text,
  )

  // Assert
  assert.deepEqual(masked, [
    'GET /cb?code=<redacted> 200',
    '{"url":"/cb?code=<redacted>"}',
    "'/cb?code=<redacted>&page=2… [truncated]",
    'redirect /cb#access_token=<redacted> 302',
    'GET /cb?code=<redacted> cookie: <redacted>',
  ])
  for (const line of masked) {
    assert.equal(line.includes(callbackCode), false)
    assert.equal(line.includes(MASK), false)
  }
})
