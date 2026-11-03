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

// protects=a Cookie or Authorization label cut by a chunk boundary after other text on its line (Cycle 0073 pt1 /ship pass 1: `[info] Coo` + `kie: sid=…` released the pair); fails_when=an unfinished line that shows no quote, equals sign or Cookie word yet is released, so the label that completes in the next write is never judged with its value; no_claim=a label cut in a line longer than the 8 KiB hold, or after its first letter alone (`-> C` + `ookie:`), which is released at once
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
        'request headers -> Co',
        `okie: sid=${SESSION_VALUE}; theme=dark\n`,
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

// protects=a callback code or token in the query of a request path that a chunk boundary cuts (Cycle 0073 pt1 /ship pass 1: the query mask reads released lines, and a line is released at once when it holds no quote, equals sign or semicolon); fails_when=`GET /cb?co` is released before `de=…`, so the code is judged without its name; no_claim=a word with a question mark or a hash that no slash comes before (own test), which is released at once
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

// protects=output keeps its arrival order around a debugger stop for a prompt that ends in one letter, a question mark or a hash (Cycle 0073 pt1 /ship pass 2: `Option C`, `Type A`, `Press s`, `Ready?` and `C#` waited for the next write, so they were delivered after later output); fails_when=a partial line whose last word is one letter, or whose last word holds a `?` or `#` with no `/` before it, is held; no_claim=a line that holds a quote, an equals sign or a semicolon, which waits for its break by design
test('a partial line that ends in one letter, a question mark or a hash is released at once', () => {
  // Arrange
  const prompts = ['Type A', 'Option C', 'Press s', 'Ready?', 'Use C#']

  // Act
  const released = prompts.map((prompt) => createOutputRedactor().write(prompt))

  // Assert
  assert.deepEqual(released, prompts)
})

// protects=the cut-label and cut-query leaks stay closed after the hold is narrowed (Cycle 0073 pt1 /ship pass 2: a label needs two of its letters, a query mark needs a slash before it); fails_when=`[x] Co`, `GET /cb?` or `see https://idp.example/cb#` is released before the next write, or the Cookie value that completes `[x] Co` is printed; no_claim=a label cut after its first letter alone (`[x] C`), which is released
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
