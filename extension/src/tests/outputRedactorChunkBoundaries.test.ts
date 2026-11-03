import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createOutputRedactor } from '../utils/createOutputRedactor'

/** The mask placeholder, kept out of `label: [masked]` literals so the repository's secret scanner does not read them as credential assignments. */
const MASK = '[masked]'

// The scripted secrets are made-up opaque strings; they are split so no scanner reads them as a real credential.
const SESSION_VALUE = ['OPAQUE', 'SESSION', 'VALUE', '7c1e4b92'].join('_')
const BASIC_CREDENTIAL = ['dXNlcjpT', 'M2NyZXRQ', 'YXNz'].join('')
const FIRST_COOKIE = ['OPAQUE', 'ONE', '31ad'].join('_')
const SECOND_COOKIE = ['OPAQUE', 'TWO', '82be'].join('_')
const THIRD_COOKIE = ['OPAQUE', 'THREE', '5cf0'].join('_')

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

// protects=a quoted string above the 16,384-character scan limit that holds a session pair and is written whole with its line break (Cycle 0073 pt1 /ship pass 1: it was released raw and survived the journal's cut to 4,096); fails_when=a literal the scan skips for its length is released unmasked; no_claim=a long string that no quote encloses
test('a quoted session pair longer than the scan limit is released masked', () => {
  // Arrange
  const line = `'sid=${SESSION_VALUE}; pad=${'x'.repeat(17_000)}'\n`

  // Act
  const released = releaseAll([line])

  // Assert
  assert.equal(released, `${MASK}\n`)
})

// protects=a Cookie or Authorization label cut by a chunk boundary after other text on its line (Cycle 0073 pt1 /ship pass 1: `[info] Coo` + `kie: sid=…` released the pair); fails_when=an unfinished line that shows no quote, equals sign or Cookie word yet is released, so the label that completes in the next write is never judged with its value; no_claim=a label cut in a line longer than the 8 KiB hold
test('the output redactor masks a Cookie or Authorization header whose label is cut by a chunk boundary after other text on its line', () => {
  // Arrange
  const digest = 'Digest username="u", realm="r", nonce="n"'
  const cutLabels: Array<{ chunks: string[]; expected: string }> = [
    {
      chunks: ['[info] Coo', `kie: sid=${SESSION_VALUE}; theme=dark\n`],
      expected: `[info] Cookie: ${MASK}\n`,
    },
    {
      chunks: [
        'request headers -> C',
        `ookie: sid=${SESSION_VALUE}; theme=dark\n`,
      ],
      expected: `request headers -> Cookie: ${MASK}\n`,
    },
    {
      chunks: [
        'log: Authori',
        `zation: ${digest}, response="${SESSION_VALUE}"\n`,
      ],
      expected: `log: Authorization: ${MASK}\n`,
    },
    {
      chunks: ['res.headers COOK', `IE: sid=${SESSION_VALUE}; theme=dark\n`],
      expected: `res.headers COOKIE: ${MASK}\n`,
    },
    {
      chunks: ['sent Set-Coo', `kie: sid=${SESSION_VALUE}; theme=dark\n`],
      expected: `sent Set-Cookie: ${MASK}\n`,
    },
    {
      chunks: ['sent Proxy-Authoriz', `ation: Basic ${BASIC_CREDENTIAL}\n`],
      expected: `sent Proxy-Authorization: ${MASK}\n`,
    },
    {
      chunks: ['sent X-Co', `okie: sid=${SESSION_VALUE}; theme=dark\n`],
      expected: `sent X-Cookie: ${MASK}\n`,
    },
  ]

  // Act
  const released = cutLabels.map(({ chunks }) => releaseAll(chunks))

  // Assert
  assert.deepEqual(
    released,
    cutLabels.map(({ expected }) => expected),
  )
  for (const text of released) {
    assert.equal(text.includes(SESSION_VALUE), false)
    assert.equal(text.includes(BASIC_CREDENTIAL), false)
  }
})

// protects=a labelled header whose label is cut by a chunk boundary stays masked when a saved history is served, which reads the same stream with the same redactor; fails_when=the first half of a line that ends in the first letters of a label is released before the rest arrives; no_claim=entry boundaries after the line is masked, which move to where the line ends
test('the output redactor holds a line that ends in the first letters of a label, whatever their case, until the next write', () => {
  // Arrange
  const redactor = createOutputRedactor()

  // Act
  const afterLabelStart = redactor.write('[info] COO')
  const afterRest = redactor.write(`KIE: sid=${SESSION_VALUE}; theme=dark\n`)

  // Assert
  assert.equal(afterLabelStart, '')
  assert.equal(afterRest, `[info] COOKIE: ${MASK}\n`)
})

// protects=text that merely ends in letters is not delayed: only the first letters of a label can still become one; fails_when=every partial line is held, so output loses its order around a debugger stop; no_claim=a line that holds a quote, an equals sign or a semicolon, which waits for its break by design
test('a partial line that ends in an ordinary word is released at once', () => {
  // Arrange
  const redactor = createOutputRedactor()

  // Act
  const released = redactor.write('[info] compiled 12 modules in')

  // Assert
  assert.equal(released, '[info] compiled 12 modules in')
})

// protects=the header-value array of a secret header name that stays open over several writes (Cycle 0073 pt1 /ship pass 1: only a flag survived each write, so the array depth restarted at 0 and the second value was printed); fails_when=an element in a later write of an array that is still open is released unmasked; no_claim=an array that never closes
test('the output redactor keeps masking every element of a Set-Cookie array over several writes until the array closes', () => {
  // Arrange
  const nested = [
    "['Set-Cookie', [\n",
    `'id=${FIRST_COOKIE}',\n`,
    `'app=${SECOND_COOKIE}'\n`,
    "]], 'Via', 'proxy'\n",
  ]
  const objectForm = [
    `{'Set-Cookie': ['app=${FIRST_COOKIE}',\n`,
    `'app=${SECOND_COOKIE}', 'app=${THIRD_COOKIE}']}, 'Via', 'proxy'\n`,
  ]

  // Act
  const releasedNested = releaseAll(nested)
  const releasedObject = releaseAll(objectForm)

  // Assert
  assert.equal(
    releasedNested,
    `['Set-Cookie', [\n${MASK},\n${MASK}\n]], 'Via', 'proxy'\n`,
  )
  assert.equal(
    releasedObject,
    `{'Set-Cookie': [${MASK},\n${MASK}, ${MASK}]}, 'Via', 'proxy'\n`,
  )
})

// protects=a line longer than the 8 KiB hold that holds no credential is released whole, not wiped (Cycle 0073 pt1 /ship pass 1: 100,005 characters of JSON came out as 45); fails_when=an over-long unfinished line is replaced by the mask only because it holds a quote, and the rest of it is dropped; no_claim=a long line that holds a Cookie or Authorization label
test('a long JSON line written in 4 KiB chunks is released whole', () => {
  // Arrange
  const items = Array.from({ length: 3_600 }, (_, id) => ({
    id,
    name: `item-${id}`,
  }))
  const line = `${JSON.stringify({ items })}\n`
  const chunks: string[] = []
  for (let from = 0; from < line.length; from += 4_096)
    chunks.push(line.slice(from, from + 4_096))

  // Act
  const released = releaseAll(chunks)

  // Assert
  assert.equal(line.length > 100_000, true)
  assert.equal(released, line)
})

// protects=the fail-closed drop of an over-long line is kept for a line that still looks like a credential: a Cookie label, a cookie pair at its start, a credential scheme or the next element of a header-value array; fails_when=narrowing the drop lets such a line through in pieces; no_claim=the exact position of the cut
test('an over-long unfinished line that still looks like a credential is masked and dropped to its line break', () => {
  // Arrange
  const padding = 'y'.repeat(9_000)
  const cookiePair = `sid=${SESSION_VALUE}; pad=${padding}`
  const scheme = `Basic ${BASIC_CREDENTIAL}${padding}`
  const arrayElement = `'id=${SESSION_VALUE}${padding}`

  // Act
  const releasedPair = releaseAll([cookiePair, `${padding}\nnext\n`])
  const releasedScheme = releaseAll([scheme, `${padding}\nnext\n`])
  const releasedArrayElement = releaseAll([
    "['Set-Cookie', [\n",
    arrayElement,
    `${padding}',\n]]\nnext\n`,
  ])

  // Assert
  assert.equal(releasedPair, `${MASK}\nnext\n`)
  assert.equal(releasedScheme, `${MASK}\nnext\n`)
  assert.equal(releasedArrayElement, `['Set-Cookie', [\n${MASK}\n]]\nnext\n`)
  for (const text of [releasedPair, releasedScheme, releasedArrayElement]) {
    assert.equal(text.includes(SESSION_VALUE), false)
    assert.equal(text.includes(BASIC_CREDENTIAL), false)
  }
})

// protects=output keeps its arrival order: a partial line of one plain word is delivered when it is written, so a prompt, a reporter's dot or `loading` does not move behind later stderr output or a debugger stop; fails_when=any one-word partial line waits for its line break; no_claim=a word that may still become a label, a scheme or a secret cookie name, which waits
test('a partial line of one plain word is released at once', () => {
  // Arrange
  const redactor = createOutputRedactor()

  // Act
  const word = redactor.write('loading')
  const dot = redactor.write('.')
  const prompt = redactor.write('\n>')
  const rest = redactor.end()

  // Assert
  assert.equal(word, 'loading')
  assert.equal(dot, '.')
  assert.equal(prompt, '\n>')
  assert.equal(rest, '')
})

// protects=a one-word partial line that is released at once is still judged with the rest of its line when that arrives: a cookie header whose first name was cut before its `=` is masked, and nothing is printed twice; fails_when=the released word is forgotten, so `=dark; sid=…` is judged without its first name and printed, or the word is printed again with its line; no_claim=the text already released, which cannot be taken back
test('a plain first word released before its equals sign still lets the cookie header it starts be masked', () => {
  // Arrange
  const cookieHeader = ['theme', `=dark; sid=${SESSION_VALUE}\n`]
  const assignment = ['port', '=3000\n']
  const spacedWord = ['  prefs', ' ok\n']

  // Act
  const releasedHeader = releaseAll(cookieHeader)
  const releasedAssignment = releaseAll(assignment)
  const releasedSpaced = releaseAll(spacedWord)

  // Assert
  assert.equal(releasedHeader.includes(SESSION_VALUE), false)
  assert.equal(releasedHeader, `theme${MASK}\n`)
  assert.equal(releasedAssignment, 'port=3000\n')
  assert.equal(releasedSpaced, '  prefs ok\n')
})

// protects=a word that may still become a label, a scheme or a secret cookie name waits for the rest of its line; fails_when=the first letters of a scheme or a secret cookie name are released before the rest arrives; no_claim=words that cannot become one, which are released at once
test('a partial line whose only word may become a scheme, a label or a secret cookie name waits', () => {
  // Arrange
  const waiting = ['Bas', 'sid', 'Digest', 'Coo']

  // Act
  const released = waiting.map((word) => createOutputRedactor().write(word))

  // Assert
  assert.deepEqual(released, ['', '', '', ''])
})

// protects=the lone-carriage-return line end of the over-long header line drop (Cycle 0073 pt1 /ship pass 1: no test reached it); fails_when=a line dropped after an overflow ends only at a newline, so a progress rewrite after the return is dropped too, or a return followed by a newline in the next write is lost; no_claim=a carriage return inside the held part of the line, which ends the line before the overflow
test('an over-long shaped line is dropped up to a lone carriage return, and a return split from its newline releases both', () => {
  // Arrange
  const overlong = `{"cookie":"sid=${SESSION_VALUE}; padding=${'a'.repeat(8_300)}`
  const lone = createOutputRedactor()
  const split = createOutputRedactor()

  // Act
  const loneFirst = lone.write(overlong)
  const loneLast = lone.write(
    `b","other":"sid=${SESSION_VALUE}"}\rprogress 50%\n`,
  )
  const splitFirst = split.write(overlong)
  const splitMiddle = split.write(`b","other":"sid=${SESSION_VALUE}"}\r`)
  const splitLast = split.write('\nready\n')

  // Assert
  assert.equal(loneFirst, MASK)
  assert.equal(loneLast, '\rprogress 50%\n')
  assert.equal(splitFirst, MASK)
  assert.equal(splitMiddle, '\r')
  assert.equal(splitLast, '\nready\n')
  assert.equal(
    [loneLast, splitMiddle, splitLast].join('').includes(SESSION_VALUE),
    false,
  )
})

// protects=the end of a stream during the drop of an over-long header line; fails_when=end() releases the dropped part of the line, or leaves the redactor dropping so a later write is lost; no_claim=text written after end(), which the stream does not produce
test('ending the output during the drop of an over-long header line releases nothing of the dropped line', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const overlong = `{"cookie":"sid=${SESSION_VALUE}; padding=${'a'.repeat(8_300)}`

  // Act
  const first = redactor.write(overlong)
  const middle = redactor.write(`","other":"sid=${SESSION_VALUE}`)
  const ended = redactor.end()
  const afterEnd = redactor.write('fresh line\n')

  // Assert
  assert.equal(first, MASK)
  assert.equal(middle, '')
  assert.equal(ended, '')
  assert.equal(afterEnd, 'fresh line\n')
})

// protects=a callback code or token in the query of a request path that a chunk boundary cuts (Cycle 0073 pt1 /ship pass 1: the query mask reads released lines, and a line is released at once when it holds no quote, equals sign or semicolon); fails_when=`GET /cb?co` is released before `de=…`, so the code is judged without its name; no_claim=a bare question mark or hash at the end of a word that no slash comes before (own test), which is released at once
test('a request path whose query is cut by a chunk boundary is masked, and a prompt followed by a blank is released at once', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const cutAtName = ['GET /cb?co', `de=${SESSION_VALUE} 200\n`]
  const cutInValue = ['GET /cb?code=OPAQUE_SES', `SION_VALUE_7c1e4b92 200\n`]
  const cutAtFragment = ['redirect /cb#access_', `token=${SESSION_VALUE}\n`]

  // Act
  const prompt = redactor.write('Continue? ')

  // Assert
  assert.equal(releaseAll(cutAtName), `GET /cb?code=${MASK} 200\n`)
  assert.equal(releaseAll(cutInValue), `GET /cb?code=${MASK} 200\n`)
  assert.equal(releaseAll(cutAtFragment), `redirect /cb#access_token=${MASK}\n`)
  assert.equal(prompt, 'Continue? ')
})

// protects=output keeps its arrival order around a debugger stop for a prompt that ends in a letter that begins no label, a question mark or a hash (Cycle 0073 pt1 /ship pass 2: `Ready?` and `C#` waited for the next write, so they were delivered after later output); fails_when=a partial line whose last word is a letter outside c, a, s and p, or whose last word ends in a bare `?` or `#` with no `/` before it, is held; no_claim=a trailing c, a, s or p letter (own test), and a line that holds a quote, an equals sign or a semicolon, which waits for its break by design
test('a partial line that ends in a letter that begins no label, a question mark or a hash is released at once', () => {
  // Arrange
  const prompts = ['Type X', 'Option B', 'Press z', 'Ready?', 'Use C#']

  // Act
  const released = prompts.map((prompt) => createOutputRedactor().write(prompt))

  // Assert
  assert.deepEqual(released, prompts)
})

// protects=the cut-label and cut-query leaks stay closed after the hold is narrowed (Cycle 0073 pt1 /ship pass 2: a bare query mark at the end of a run needs a slash before it); fails_when=`[x] Co`, `GET /cb?` or `see https://idp.example/cb#` is released before the next write, or the Cookie value that completes `[x] Co` is printed; no_claim=a label cut after its first letter alone (own test)
test('a line cut after two letters of a label or after the query mark of a path still waits for the next write', () => {
  // Arrange
  const labelRedactor = createOutputRedactor()
  const queryRedactor = createOutputRedactor()
  const fragmentRedactor = createOutputRedactor()

  // Act
  const labelStart = labelRedactor.write('[x] Co')
  const labelRest = labelRedactor.write(
    `okie: sid=${SESSION_VALUE}; theme=dark\n`,
  )
  const queryStart = queryRedactor.write('GET /cb?')
  const queryRest = queryRedactor.write(`code=${SESSION_VALUE} 200\n`)
  const fragmentStart = fragmentRedactor.write('see https://idp.example/cb#')
  const fragmentRest = fragmentRedactor.write(`access_token=${SESSION_VALUE}\n`)

  // Assert
  assert.equal(labelStart, '')
  assert.equal(labelRest, `[x] Cookie: ${MASK}\n`)
  assert.equal(queryStart, 'GET ')
  assert.equal(queryRest, `/cb?code=${MASK} 200\n`)
  assert.equal(fragmentStart, 'see ')
  assert.equal(fragmentRest, `https://idp.example/cb#access_token=${MASK}\n`)
})

// protects=a Cookie or Authorization label cut after its first letter (Cycle 0073 pt1 /ship pass 2: a one-letter prefix had been released, so `Option C` + `ookie: sid=…` printed the pair); fails_when=a line that ends in `c`, `a`, `s` or `p`, any case, is released before the next write, or the value of the header it completes is printed; no_claim=the delay this costs, accepted: a prompt that ends in one of those four letters (`Option C`, `Type A`) waits until the next write or the line break, while a prompt ending in any other letter is released at once
test('a line that ends in the first letter of a label waits for the next write, and the header it completes is masked', () => {
  // Arrange
  const waiting = ['Option C', 'Type A', 'Press s', 'Run P']
  const cutCookie = ['Option C', `ookie: sid=${SESSION_VALUE}; theme=dark\n`]
  const cutAuthorization = [
    'Type A',
    `uthorization: Basic ${BASIC_CREDENTIAL}\n`,
  ]

  // Act
  const released = waiting.map((prompt) => createOutputRedactor().write(prompt))
  const releasedCookie = releaseAll(cutCookie)
  const releasedAuthorization = releaseAll(cutAuthorization)

  // Assert
  assert.deepEqual(released, ['', '', '', ''])
  assert.equal(releasedCookie, `Option Cookie: ${MASK}\n`)
  assert.equal(releasedAuthorization, `Type Authorization: ${MASK}\n`)
  for (const text of [releasedCookie, releasedAuthorization]) {
    assert.equal(text.includes(SESSION_VALUE), false)
    assert.equal(text.includes(BASIC_CREDENTIAL), false)
  }
})

// protects=a query or fragment cut inside its first parameter name when no slash comes before the mark (Cycle 0073 pt1 /ship pass 3: `?to`, `app.html?tok` and `#access_to` were released, so the `ken=…` or `en=…` that followed was judged alone and printed); fails_when=a trailing run that starts with a `?` or `#`, or holds one with more characters after it, is released before the next write, or the value that follows is printed; no_claim=a bare mark at the end of a word (own test), which is released at once
test('a query or fragment cut inside its first parameter name is masked although no slash comes before the mark', () => {
  // Arrange
  const cuts: Array<{ chunks: string[]; expected: string }> = [
    {
      chunks: ['?co', `de=${SESSION_VALUE}\n`],
      expected: `?code=${MASK}\n`,
    },
    {
      chunks: ['?to', `ken=${SESSION_VALUE}\n`],
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- the expected text holds the mask, not a credential.
      expected: `?token=${MASK}\n`,
    },
    {
      chunks: ['app.html?tok', `en=${SESSION_VALUE}\n`],
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- the expected text holds the mask, not a credential.
      expected: `app.html?token=${MASK}\n`,
    },
    {
      chunks: ['#access_to', `ken=${SESSION_VALUE}\n`],
      expected: `#access_token=${MASK}\n`,
    },
    {
      chunks: ['host.tld?co', `de=${SESSION_VALUE}\n`],
      expected: `host.tld?code=${MASK}\n`,
    },
  ]

  // Act
  const results = cuts.map((cut) => {
    const redactor = createOutputRedactor()
    const first = redactor.write(cut.chunks[0] ?? '')
    const rest = redactor.write(cut.chunks[1] ?? '') + redactor.end()
    return { first, released: first + rest, expected: cut.expected }
  })

  // Assert
  for (const result of results) {
    assert.equal(result.first, '')
    assert.equal(result.released, result.expected)
    assert.equal(result.released.includes(SESSION_VALUE), false)
  }
})

// protects=a prompt that asks a yes/no question keeps its arrival order around a debugger stop (Cycle 0073 pt1 /ship pass 3: `(y/n)?` holds a slash before its question mark, so the prompt waited for the next write like a request path); fails_when=a run whose trailing `?` or `#` directly follows `)` or `]` is held, or a request path that ends in the mark is released before its query; no_claim=a URL that itself ends in `)?` or `]?`, which is released with a prompt of that shape
test('a prompt that ends in a question mark after a closing bracket is released at once, while a request path that ends in one still waits', () => {
  // Arrange
  const prompts = ['Continue (y/n)?', 'Overwrite [Y/n]?']
  const pathRedactor = createOutputRedactor()

  // Act
  const released = prompts.map((prompt) => createOutputRedactor().write(prompt))
  const pathStart = pathRedactor.write('GET /cb?')
  const pathRest = pathRedactor.write(`code=${SESSION_VALUE} 200\n`)

  // Assert
  assert.deepEqual(released, prompts)
  assert.equal(pathStart, 'GET ')
  assert.equal(pathRest, `/cb?code=${MASK} 200\n`)
})

// protects=a header array that util.inspect prints over several lines and a chunk boundary cuts after a line break keeps the even and odd positions of its elements (Cycle 0073 pt1 /ship pass 3: the scan restarted without a position, so `'Authorization'`, a value after `'Host'`, was read as a name and the non-secret `'X-Trace-Id'` after it was masked); fails_when=the non-secret name or its value is masked after the split, or the split text differs from the same text written at once; no_claim=a header array that has no opening bracket in the text at all
test('a flat header array cut after a line break keeps its element positions, so a non-secret element stays readable', () => {
  // Arrange
  const first = "[\n  'Host',\n"
  const second = "  'Authorization',\n  'X-Trace-Id',\n  'trace'\n]\n"

  // Act
  const split = releaseAll([first, second])
  const whole = releaseAll([first + second])

  // Assert
  assert.equal(
    split,
    "[\n  'Host',\n  'Authorization',\n  'X-Trace-Id',\n  'trace'\n]\n",
  )
  assert.equal(whole, split)
})

// protects=the value that follows a secret header name stays masked when the chunk boundary falls right after the name's comma (Cycle 0073 pt1 /ship pass 3: carrying the element position must not lose the pairing); fails_when=the element after `'Authorization',` in the next write is printed, or the split text differs from the same text written at once; no_claim=a value cut inside its own quotes
test('a flat header array cut right after a secret header name still masks the value in the next write', () => {
  // Arrange
  const first = "[\n  'Host',\n  'x',\n  'Authorization',\n"
  const second = `  'Bearer ${SESSION_VALUE}',\n  'Via',\n  'proxy'\n]\n`

  // Act
  const split = releaseAll([first, second])
  const whole = releaseAll([first + second])

  // Assert
  assert.equal(
    split,
    `[\n  'Host',\n  'x',\n  'Authorization',\n  ${MASK},\n  'Via',\n  'proxy'\n]\n`,
  )
  assert.equal(whole, split)
  assert.equal(split.includes(SESSION_VALUE), false)
})

// protects=a flat header array whose elements the redactor dropped (an over-long credential line) does not leave a stale element position behind (Cycle 0073 pt1 /ship pass 3: the carried position counts only the elements the scan saw, so after a drop an odd count would read the next real header name at an odd place); fails_when=the value after `'Cookie'`, which follows the dropped line in the same array, is printed; no_claim=the masking of the dropped line itself, which is covered by the over-long line tests
test('a flat header array keeps masking a header name after an over-long credential line was dropped inside it', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const overlong = `  'x', 'y', 'cookie ${'a'.repeat(9_000)}`

  // Act
  const opening = redactor.write("[\n  'Host',\n")
  const dropped = redactor.write(overlong)
  const rest = redactor.write(`\n  'Cookie',\n  '${SESSION_VALUE}',\n]\n`)
  const ended = redactor.end()
  const released = opening + dropped + rest + ended

  // Assert
  assert.equal(released.includes(SESSION_VALUE), false)
  assert.equal(released.endsWith(`\n  'Cookie',\n  ${MASK},\n]\n`), true)
})
