import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSecretName } from '../utils/isSecretName'
import { maskFactString } from '../utils/maskFactString'
import { redactValuePreview } from '../utils/redactValuePreview'
import {
  isAuthorizationShape,
  isCookieHeaderShape,
  maskShapedLiterals,
} from '../utils/secretShapes'

// The values below are made up: only their shape marks them as credentials.
const SET_COOKIE =
  'sid=abc123; Path=/; Expires=Wed, 21 Oct 2025 07:28:00 GMT; HttpOnly'

/** Runs `work` and fails when it takes longer than the bound, which only a quadratic scan of the input would. */
function assertFinishesWithin(
  boundMs: number,
  label: string,
  work: () => void,
): void {
  const startedAt = performance.now()
  work()
  const tookMs = performance.now() - startedAt
  // gstack-timing-ok: the bound is the contract (linear-time shape scans); measured times are 2–14 ms against a bound of hundreds of ms, so only the quadratic regression it guards fails it.
  assert.ok(tookMs < boundMs, `${label} took ${Math.round(tookMs)} ms`)
}

// protects=the Set-Cookie header a response preview shows; fails_when=an Expires attribute (blank and comma inside) makes the header read as prose in a fact, a preview or a quoted element; no_claim=a Cookie value without any pair or attribute
test('a Set-Cookie value with an Expires attribute is masked as a fact, as a preview and as a quoted element', () => {
  // Arrange
  const quoted = `'${SET_COOKIE}'`
  // Act
  const asFact = maskFactString(SET_COOKIE)
  const asQuotedFact = maskFactString(quoted)
  const inPreview = redactValuePreview(`{h: ${quoted}, n: 1}`)
  const inDoubleQuotes = redactValuePreview(`{h: "${SET_COOKIE}"}`)
  // Assert
  assert.equal(asFact, '[masked]')
  assert.equal(asQuotedFact, '[masked]')
  assert.equal(inPreview, '{h: [masked], n: 1}')
  assert.equal(inDoubleQuotes, '{h: [masked]}')
})

// protects=every attribute spelling of Set-Cookie; fails_when=one attribute word (any letter case) or a flag stops a pair from reading as a cookie header; no_claim=a first segment that is no pair
test('a pair followed by any Set-Cookie attribute in any letter case reads as a cookie header', () => {
  // Arrange
  const headers = [
    'sid=abc123; expires=Wed, 21 Oct 2025 07:28:00 GMT',
    'id=7; Max-Age=3600',
    'id=7; SameSite=Lax; Secure',
    'id=7; Domain=app.test',
    'id=7; PRIORITY=High',
    'id=7; Partitioned',
  ]
  // Act
  const verdicts = headers.map((header) => isCookieHeaderShape(header))
  // Assert
  assert.deepEqual(verdicts, [true, true, true, true, true, true])
})

// protects=a preview an adapter trimmed; fails_when=a header whose last segment was cut by the trim mark or the capture's truncation marker reads as prose; no_claim=a trimmed text whose first segment is no pair
test('a trimmed Set-Cookie preview is still masked and a trimmed prose stays readable', () => {
  // Arrange
  const trimmed = [
    'sid=abc123; Path=/; HttpOn…',
    'sid=abc123; Expires=Wed, 21 Oct 2025 07:2…',
    'sid=abc12… [truncated]',
    'sid=abc123; theme=da… [truncated]',
  ]
  // Act
  const trimmedVerdicts = trimmed.map((header) => isCookieHeaderShape(header))
  const proseVerdict = isCookieHeaderShape('theme=dark; extra…')
  // Assert
  assert.deepEqual(trimmedVerdicts, [true, true, true, true])
  assert.equal(proseVerdict, false)
})

// protects=readable evidence beside the Set-Cookie rule; fails_when=a single non-secret pair, a lone Expires text or prose after a pair is masked; no_claim=a pair whose name is secret
test('values that only look like attributes or pairs stay readable', () => {
  // Arrange
  const readable = [
    'theme=dark',
    'page=2',
    'a=1; this is prose',
    'Expires=Wed, 21 Oct 2025 07:28:00 GMT',
    'theme=dark; foo bar',
  ]
  // Act
  const verdicts = readable.map((text) => isCookieHeaderShape(text))
  // Assert
  assert.deepEqual(verdicts, [false, false, false, false, false])
})

// protects=a cookie hidden in a quoted string after prose that holds a secret word and a colon; fails_when=the secret word's colon inside a quoted string is read as a member, its mask eats the closing quote, and the next cookie, Basic value, callback code or rawHeaders list stays readable; no_claim=text that is no credential shape
test('a secret word and a colon inside a quoted string do not shift the quote pairing of the credentials after it', () => {
  // Arrange
  const previews = [
    "{msg: 'Invalid session: expired', h: 'sid=abc123; theme=dark'}",
    "{note: 'password: reset', auth: 'Basic dXNlcjpwYXNz'}",
    "{note: 'token: none', next: '/cb?code=abc123', other: 1}",
    "{note: 'token: none', raw: ['Host', 'x', 'Cookie', 'sid=abc123']}",
    '{"msg": "token: x", "h": "sid=1; theme=dark"}',
    "{msg: 'it\\'s a session: ok', h: 'sid=abc123; theme=dark'}",
  ]
  // Act
  const redacted = previews.map((preview) => redactValuePreview(preview))
  // Assert
  assert.deepEqual(redacted, [
    "{msg: 'Invalid session: expired', h: [masked]}",
    "{note: 'password: reset', auth: [masked]}",
    "{note: 'token: none', next: '/cb?code=[masked]', other: 1}",
    "{note: 'token: none', raw: ['Host', 'x', 'Cookie', [masked]]}",
    '{"msg": "token: x", "h": [masked]}',
    "{msg: 'it\\'s a session: ok', h: [masked]}",
  ])
})

// protects=real secret members beside a string that quotes a secret word; fails_when=the quoted-string rule also stops a real secret-named member from being masked; no_claim=members of a Map whose keys are not secret
test('a real secret-named member after a quoted string with a secret word is still masked', () => {
  // Arrange
  const preview = "{msg: 'a token: b', apiKey: 'plain-secret'}"
  const mapPreview =
    "Map(2) {'a token: b' => 'x', 'authorization' => 'Basic zzzz'}"
  // Act
  const redacted = redactValuePreview(preview)
  const redactedMap = redactValuePreview(mapPreview)
  // Assert
  assert.equal(redacted, "{msg: 'a token: b', apiKey: [masked]}")
  assert.equal(
    redactedMap,
    "Map(2) {'a token: b' => 'x', 'authorization' => [masked]}",
  )
})

// protects=a serialised object held in a string (a JSON body, JSON.stringify of a cookie record); fails_when=the quoted-string rule that spares prose also spares the secret-named keys of a JSON string, or a mask eats the string's closing quote; no_claim=a JSON string whose keys are not secret names, which stays readable
test('a secret-named key inside a JSON string is masked up to the string end and the closing quote stays', () => {
  // Arrange
  const previews = [
    `{body: '{"token":"abc123","n":1}', n: 2}`,
    `{body: '{"id":4,"password":"hunter2"}'}`,
    `{body: '{"api_key":12345,"n":1}'}`,
    `{body: '{"name":"sid","value":"x"}', value: 'outer'}`,
    `{body: "{'token':'abc123'}"}`,
    `{a: 'x', body: '{"token":"abc', c: 3}`,
    `{body: '{"id":4,"theme":"dark"}'}`,
  ]
  // Act
  const redacted = previews.map((preview) => redactValuePreview(preview))
  // Assert
  assert.deepEqual(redacted, [
    `{body: '{"token":[masked],"n":1}', n: 2}`,
    `{body: '{"id":4,"password":[masked]}'}`,
    `{body: '{"api_key":[masked],"n":1}'}`,
    `{body: '{"name":"sid","value":[masked]}', value: 'outer'}`,
    `{body: "{'token':[masked]}"}`,
    `{a: 'x', body: '{"token":[masked]', c: 3}`,
    `{body: '{"id":4,"theme":"dark"}'}`,
  ])
})

// protects=session and CSRF cookie names; fails_when=sessionid, sessid, JSESSIONID, PHPSESSID, ASPSESSIONID with a suffix or csrftoken read as plain names; no_claim=names that only contain session or token as a prefix word
test('one-word session and CSRF cookie names are secret names while ordinary session words stay visible', () => {
  // Arrange
  const secret = [
    'sessionid',
    'sessid',
    'JSESSIONID',
    'PHPSESSID',
    'ASPSESSIONIDQASQTQDA',
    'csrftoken',
    'xsrf-token',
    'sessionId',
    'ASP.NET_SessionId',
  ]
  const visible = [
    'sessionCount',
    'sessionStart',
    'sessions_per_day',
    'tokenCount',
  ]
  // Act
  const secretVerdicts = secret.map((name) => isSecretName(name))
  const visibleVerdicts = visible.map((name) => isSecretName(name))
  // Assert
  assert.deepEqual(
    secretVerdicts,
    secret.map(() => true),
  )
  // `sessions_per_day` ends in the word day, so no secret word is final.
  assert.deepEqual(
    visibleVerdicts,
    visible.map(() => false),
  )
})

// protects=cookie records and single pairs of the Java, PHP and Django session cookies; fails_when={name: 'JSESSIONID', value} keeps its value or the single pair JSESSIONID=ABC stays readable; no_claim=a cookie whose name is no secret name
test('a JSESSIONID record, a PHPSESSID pair and a csrftoken record are masked', () => {
  // Arrange
  const record = "{name: 'JSESSIONID', value: 'ABC123'}"
  const csrfRecord = "{name: 'csrftoken', value: 'ABC123'}"
  // Act
  const redactedRecord = redactValuePreview(record)
  const redactedCsrf = redactValuePreview(csrfRecord)
  const javaPair = maskFactString('JSESSIONID=ABC')
  const phpPair = maskFactString('PHPSESSID=ABC')
  // Assert
  assert.equal(redactedRecord, "{name: 'JSESSIONID', value: [masked]}")
  assert.equal(redactedCsrf, "{name: 'csrftoken', value: [masked]}")
  assert.equal(javaPair, '[masked]')
  assert.equal(phpPair, '[masked]')
})

// protects=the OAuth implicit flow and nested callbacks; fails_when=#access_token=…, /login?next=/cb?code=… or /cb?a=1;token=… stays readable; no_claim=a fragment without a pair
test('secret parameters in a URL fragment, in a nested query and after a semicolon are masked', () => {
  // Arrange
  const urls = [
    'https://app.test/cb#access_token=abc123&state=xyz',
    '/login?next=/cb?code=abc123',
    '/cb?a=1;token=abc123',
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a made-up value whose shape the test checks.
    '/cb#/route?token=abc123',
    '/x?y=1&code=7#k=1',
  ]
  // Act
  const masked = urls.map((url) => maskFactString(url))
  const inPreview = redactValuePreview(
    "{u: '/login?next=/cb?code=abc123', f: 'https://a.test/#id_token=zzz'}",
  )
  // Assert
  assert.deepEqual(masked, [
    'https://app.test/cb#access_token=[masked]&state=xyz',
    '/login?next=/cb?code=[masked]',
    '/cb?a=1;token=[masked]',
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a made-up value whose shape the test checks.
    '/cb#/route?token=[masked]',
    '/x?y=1&code=[masked]#k=1',
  ])
  assert.equal(
    inPreview,
    "{u: '/login?next=/cb?code=[masked]', f: 'https://a.test/#id_token=[masked]'}",
  )
})

// protects=readable URLs; fails_when=a fragment anchor, a numeric fragment or a nested query without a secret parameter is masked; no_claim=a URL with a secret parameter
test('a fragment anchor and a nested query without secret parameters stay readable', () => {
  // Arrange
  const urls = ['/docs#install', '/items#42', '/login?next=/home?page=2']
  // Act
  const masked = urls.map((url) => maskFactString(url))
  // Assert
  assert.deepEqual(masked, urls)
})

// protects=readable word lists; fails_when=the element after pass, token or Authorization-as-a-value in a list of words is masked; no_claim=a flat header list that starts with the header name
test('a list of words keeps its elements readable even when one is a secret word', () => {
  // Arrange
  const lists = [
    "['pass', 'fail', 'skip']",
    "['token', 'expiresIn']",
    "['Content-Type', 'Authorization', 'X-Trace-Id']",
  ]
  // Act
  const redacted = lists.map((list) => redactValuePreview(list))
  // Assert
  assert.deepEqual(redacted, lists)
})

// protects=the flat rawHeaders rule after the narrowing; fails_when=Cookie, Set-Cookie, X-Api-Key or X-Auth-Token no longer hides the element after it; no_claim=a header name written without a hyphen that is no credential header
test('the element after a credential header name of a flat header list is masked and the other headers stay readable', () => {
  // Arrange
  const lists = [
    "['Host', 'x', 'X-Api-Key', 'k-123', 'Cookie', 'sid']",
    "['x-auth-token', 'abc']",
    "['Set-Cookie', 'a=1', 'Content-Type', 'text/plain']",
  ]
  // Act
  const redacted = lists.map((list) => redactValuePreview(list))
  // Assert
  assert.deepEqual(redacted, [
    "['Host', 'x', 'X-Api-Key', [masked], 'Cookie', [masked]]",
    "['x-auth-token', [masked]]",
    "['Set-Cookie', [masked], 'Content-Type', 'text/plain']",
  ])
})

// protects=Authorization-like prose; fails_when=Basic information, Token validation or Token generated is masked as a credential; no_claim=a Negotiate or NTLM blob, which keeps the base64 rule
test('prose that starts with an Authorization scheme stays readable and real credentials are still masked', () => {
  // Arrange
  const prose = [
    'Basic information',
    'Token validation',
    'Token generated',
    'Token generated.',
    'Basic Information',
  ]
  const credentials = [
    'Basic dXNlcjpwYXNz',
    'Token abcd1234',
    'Basic Zm9vOmJhcg==',
    'NTLM TlRMTVNTUAAB',
    'Negotiate YIIabcdefgh',
    'Token eyJhbGci.eyJzdWIi.sig',
    'Digest username="u", realm="r"',
  ]
  // Act
  const proseVerdicts = prose.map((text) => isAuthorizationShape(text))
  const credentialVerdicts = credentials.map((text) =>
    isAuthorizationShape(text),
  )
  // Assert
  assert.deepEqual(
    proseVerdicts,
    prose.map(() => false),
  )
  assert.deepEqual(
    credentialVerdicts,
    credentials.map(() => true),
  )
})

// protects=a cookie record written with quoted keys; fails_when={"name": "sid", "value": "x"} loses its "value" key to the mask; no_claim=the value of a record whose name is no secret
test('a record with quoted keys keeps its value key readable and masks its value', () => {
  // Arrange
  const records = [
    '{"name": "sid", "value": "x"}',
    '{"id": 4, "name": "sid", "path": "/", "value": "x"}',
    "{name: 'sid', value: 'x'}",
  ]
  // Act
  const redacted = records.map((record) => redactValuePreview(record))
  // Assert
  assert.deepEqual(redacted, [
    '{"name": "sid", "value": [masked]}',
    '{"id": 4, "name": "sid", "path": "/", "value": [masked]}',
    "{name: 'sid', value: [masked]}",
  ])
})

// protects=Set-Cookie whose value is an array; fails_when=the strings inside ['Set-Cookie', [...]] stay readable or the mask runs past the array's closing bracket; no_claim=an array after a header that is no credential header
test('every quoted element of an array that is the value of a secret header name is masked up to its closing bracket', () => {
  // Arrange
  const lists = [
    "['Set-Cookie', ['JSESSIONID=1']]",
    "['Set-Cookie', ['abc', 'def']]",
    "['Set-Cookie', ['abc'], 'Host', 'x']",
    "['Host', 'x', 'Set-Cookie', ['a1', ['b2']], 'Via', 'y']",
  ]
  // Act
  const redacted = lists.map((list) => redactValuePreview(list))
  // Assert
  assert.deepEqual(redacted, [
    "['Set-Cookie', [[masked]]]",
    "['Set-Cookie', [[masked], [masked]]]",
    "['Set-Cookie', [[masked]], 'Host', 'x']",
    "['Host', 'x', 'Set-Cookie', [[masked], [[masked]]], 'Via', 'y']",
  ])
})

// protects=a header array that a chunk boundary cuts after its opening bracket; fails_when=a text that ends inside the array of a secret header name does not carry the pairing to the next chunk; no_claim=the elements of the array after the first one of the next chunk
test('a text that ends inside the array of a secret header name asks the next chunk to mask its first element', () => {
  // Arrange
  const firstChunk = "['Set-Cookie', ["
  // Act
  const result = maskShapedLiterals(firstChunk, false)
  const next = maskShapedLiterals("'a1', 'b2' ]]", result.afterHeaderName)
  // Assert
  assert.equal(result.afterHeaderName, true)
  assert.equal(next.text.startsWith('[masked]'), true)
})

// protects=the linear-time scan of quoted elements; fails_when=a line of unclosed quote openers is rescanned to its end for every opener (11 s at 120 KB before the fix); no_claim=the exact wall time of any machine
test('a long line of unclosed quote openers is scanned in linear time and left unchanged', () => {
  // Arrange
  const singleQuotes = " 'a".repeat(40_000)
  const doubleQuotes = ' "a'.repeat(40_000)
  const backticks = ' `a'.repeat(40_000)
  // Act and Assert
  for (const text of [singleQuotes, doubleQuotes, backticks]) {
    assertFinishesWithin(500, 'maskShapedLiterals on unclosed quotes', () => {
      assert.equal(maskShapedLiterals(text).text, text)
    })
    assertFinishesWithin(500, 'redactValuePreview on unclosed quotes', () => {
      assert.equal(redactValuePreview(text), text)
    })
    assertFinishesWithin(500, 'maskFactString on unclosed quotes', () => {
      assert.equal(maskFactString(text), text)
    })
  }
})

// protects=the member-key pattern; fails_when=a hyphen run (a-a-a-…) is tried from every letter again (4.9 s at 100 KB before the fix); no_claim=the exact wall time of any machine
test('a long hyphenated run without a colon is previewed in linear time', () => {
  // Arrange
  const text = 'a-'.repeat(50_000)
  // Act and Assert
  assertFinishesWithin(500, 'redactValuePreview on a hyphen run', () => {
    assert.equal(redactValuePreview(text), text)
  })
})

// protects=the member scan of a preview; fails_when=every unclosed bracketed or bare member rescans the rest of the preview to its end; no_claim=the exact wall time of any machine
test('a long preview of nested unclosed members is scanned in linear time', () => {
  // Arrange
  const unclosedObjects = '{a: '.repeat(30_000)
  const bareMembers = 'a: '.repeat(40_000)
  const quotedMembers = "{a: '".repeat(20_000)
  // Act and Assert
  for (const text of [unclosedObjects, bareMembers, quotedMembers])
    assertFinishesWithin(500, 'redactValuePreview on unclosed members', () => {
      redactValuePreview(text)
    })
})

/** The mask placeholder, kept out of `label: [masked]` literals so the repository's secret scanner does not read them as credential assignments. */
const MASK = '[masked]'

// The scripted secrets are made-up opaque strings; they are split so no scanner reads them as a real credential.
const OPAQUE_SESSION = ['OPAQUE', 'SESSION', 'VALUE', '7c1e4b92'].join('_')

// protects=the pairing state a scan hands to the next chunk when the array of a secret header name is still open; fails_when=the result tells only that the next element is a value, so a chunk that starts inside the array restarts at depth 0 and reads its second element as an ordinary one; no_claim=an array that never closes
test('a scan that ends inside the array of a secret header name hands its open depth to the next chunk', () => {
  // Arrange
  const first = maskShapedLiterals("['Set-Cookie', [\n", false)
  // Act
  const second = maskShapedLiterals(
    "'id=one',\n'app=two'\n",
    first.afterHeaderName,
    MASK,
    first.headerArrayDepth,
  )
  const closing = maskShapedLiterals(
    "]], 'Via', 'proxy'\n",
    second.afterHeaderName,
    MASK,
    second.headerArrayDepth,
  )
  // Assert
  assert.equal(first.headerArrayDepth, 1)
  assert.equal(second.text, `${MASK},\n${MASK}\n`)
  assert.equal(second.headerArrayDepth, 1)
  assert.equal(closing.text, "]], 'Via', 'proxy'\n")
  assert.equal(closing.afterHeaderName, false)
  assert.equal(closing.headerArrayDepth, 0)
})

// protects=a quoted string longer than the scan limit is not passed through (Cycle 0073 pt1 /ship pass 1: a 17,000-character literal that holds a session pair printed it); fails_when=a literal the scan skips for its length stays raw; no_claim=a literal inside the limit, which is read by its shape
test('a quoted string longer than the scan limit is masked whole', () => {
  // Arrange
  const padding = 'x'.repeat(17_000)
  const sessionPair = `'sid=${OPAQUE_SESSION}; pad=${padding}'\n`
  const doubleQuoted = `{"note": "${OPAQUE_SESSION} ${padding}"}\n`
  // Act
  const maskedPair = maskShapedLiterals(sessionPair)
  const maskedNote = maskShapedLiterals(doubleQuoted)
  // Assert
  assert.equal(maskedPair.text, `${MASK}\n`)
  assert.equal(maskedNote.text, `{"note": ${MASK}}\n`)
})

// protects=the linear time of the scan when long literals are masked whole; fails_when=masking a long literal rescans the line for each quote; no_claim=the exact wall time of any machine
test('a line of many long quoted strings is masked in linear time', () => {
  // Arrange
  const line = `${`'${'z'.repeat(20_000)}', `.repeat(25)}\n`
  // Act and Assert
  assertFinishesWithin(500, 'maskShapedLiterals on long literals', () => {
    assert.equal(maskShapedLiterals(line).text, `${`${MASK}, `.repeat(25)}\n`)
  })
})

// protects=an element cut by the 4,096-character cap: it ends in the trim mark and has no closing quote (Cycle 0073 pt1 /ship pass 1: `Array(8) ['Cookie', 'sid=…… [truncated]` stayed unchanged when a saved history was served); fails_when=an unterminated element after a credential header name, or one that ends in a trim mark, is skipped because no closing quote follows it; no_claim=an unterminated quote in prose, which opens no element
test('an unterminated element after a credential header name or ending in a trim mark is masked to its end', () => {
  // Arrange
  const afterHeaderName = `Array(8) ['Cookie', 'sid=${OPAQUE_SESSION}… [truncated]`
  const afterHeaderNameWithoutMark = `['Authorization', 'Basic ${OPAQUE_SESSION}`
  const endsInMark = `{note: 'sid=${OPAQUE_SESSION}…`
  const inArray = `['Set-Cookie', ['a=1', 'b=${OPAQUE_SESSION}… [truncated]`
  const prose = "Array(2) [don't, 'it is fine"
  // Act
  const maskedAfterName = redactValuePreview(afterHeaderName)
  const maskedWithoutMark = redactValuePreview(afterHeaderNameWithoutMark)
  const maskedMark = redactValuePreview(endsInMark)
  const maskedInArray = redactValuePreview(inArray)
  const maskedProse = redactValuePreview(prose)
  const maskedOutput = maskShapedLiterals(`${afterHeaderName}\nready\n`).text
  // Assert
  assert.equal(maskedAfterName, `Array(8) ['Cookie', ${MASK}`)
  assert.equal(maskedWithoutMark, `['Authorization', ${MASK}`)
  assert.equal(maskedMark, `{note: ${MASK}`)
  assert.equal(maskedInArray, `['Set-Cookie', [${MASK}, ${MASK}`)
  assert.equal(maskedProse, prose)
  assert.equal(maskedOutput, `Array(8) ['Cookie', ${MASK}\nready\n`)
})

// protects=a long closed literal after a credential header name is masked whole (Cycle 0073 pt1 /ship pass 1: coverage of the value-position branch for an element above the scan limit); fails_when=the length of the value decides whether it is masked; no_claim=a literal of the same length that no header name precedes
test('a closed literal of 20,000 characters after a Cookie name is masked whole', () => {
  // Arrange
  const text = `['Cookie', '${'v'.repeat(20_000)}']`
  // Act
  const masked = maskShapedLiterals(text)
  // Assert
  assert.equal(masked.text, `['Cookie', ${MASK}]`)
  assert.equal(masked.afterHeaderName, false)
})
