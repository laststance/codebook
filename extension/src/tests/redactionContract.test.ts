import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type { Protocol } from 'devtools-protocol'
import type * as vscode from 'vscode'

import { OUTPUT_REDACTION_HOLD_LIMIT_CHARS } from '../constants'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { createOutputRedactor } from '../utils/createOutputRedactor'
import { formatCodebookDiagnostic } from '../utils/formatCodebookDiagnostic'
import { inspectConfiguredValues } from '../utils/inspectConfiguredValues'
import { inspectNodeTestVariables } from '../utils/inspectNodeTestVariables'
import { isSecretName } from '../utils/isSecretName'
import { launchNodeTest } from '../utils/launchNodeTest'
import { redactInspectedValue } from '../utils/redactInspectedValue'
import { redactSecretText } from '../utils/redactSecretText'
import { redactValuePreview } from '../utils/redactValuePreview'
import { sanitizeCause } from '../utils/sanitizeCause'
import { sourceImportBindings } from '../utils/sourceImportBindings'

import { ROOT_MODE_EXECUTION } from './utils/rootModeExecutionPlan'

// Credential-shaped fixtures are joined at run time, so this file holds no literal a secret scanner takes for a real credential.
const JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
].join('.')
const GITHUB_TOKEN = ['ghp', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_')
const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
const PEM_BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\nabc='
const PEM = `${PEM_HEADER}\n${PEM_BODY}\n${['-----END', 'PRIVATE KEY-----'].join(' ')}`
/** The scheme of the database URLs below, kept apart from their user and password for the same reason. */
const POSTGRES = 'postgres://'

// protects=the name rule on words; fails_when=accessToken or db_passwd stays visible, or tokenCount/sortKey is masked; no_claim=values in plainly named variables
test('a secret-named variable is masked by its final word while count and sort names stay visible', () => {
  // Arrange
  const masked = [
    'accessToken',
    'refresh-token',
    'db_passwd',
    'clientSecret',
    'Authorization',
    'set-cookie',
    'apiKey',
    'api_key',
    'privateKey',
    'session',
    'password',
    'credentials',
    'APIKey',
  ]
  const visible = ['tokenCount', 'sortKey', 'passwordPolicy', 'key', 'amount']
  // Act
  const maskedResults = masked.map(isSecretName)
  const visibleResults = visible.map(isSecretName)
  // Assert
  assert.deepEqual(
    maskedResults,
    masked.map(() => true),
  )
  assert.deepEqual(
    visibleResults,
    visible.map(() => false),
  )
})

// protects=credential names the pt1 security review found visible (secret/access/signing keys, passphrases, short password names, JWTs, session ids); fails_when=AWS_SECRET_ACCESS_KEY, secretKey, passphrase, pwd, jwt or sessionId reads its value, or publicKey/primaryKey/cacheKey/idempotencyKey is masked; no_claim=names outside these words
test('a key named for secret, access, signing or session use, a passphrase, a JWT and a session id are masked while public and index keys stay visible', () => {
  // Arrange
  const masked = [
    'secretAccessKey',
    'AWS_SECRET_ACCESS_KEY',
    'secretKey',
    'accessKey',
    'signingKey',
    'encryption_key',
    'masterKey',
    'clientKey',
    'authKey',
    'sessionKey',
    'passphrase',
    'pwd',
    'dbPass',
    'jwt',
    'sessionId',
    'session_id',
    'sid',
  ]
  const visible = [
    'publicKey',
    'primaryKey',
    'cacheKey',
    'idempotencyKey',
    'foreignKey',
    'userId',
  ]
  // Act
  const maskedResults = masked.map(isSecretName)
  const visibleResults = visible.map(isSecretName)
  // Assert
  assert.deepEqual(
    maskedResults,
    masked.map(() => true),
  )
  assert.deepEqual(
    visibleResults,
    visible.map(() => false),
  )
})

// protects=provider keys the pt1 security review named (Stripe live/test secret and restricted keys, Slack tokens, Google API keys, npm tokens, AWS session keys); fails_when=any of them survives in captured text; no_claim=unprefixed secrets
test('Stripe, Slack, Google, npm and AWS session keys in captured text read [masked]', () => {
  // Arrange
  const keys = [
    ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2'].join('_'),
    ['rk', 'test', 'Z9y8X7w6V5u4T3s2R1q0P9o8'].join('_'),
    ['xoxb', '123456789012', '123456789012', 'AbCdEfGhIjKlMnOpQrStUvWx'].join(
      '-',
    ),
    ['AIza', 'SyA1234567890abcdefghijklmnopqrstuv'].join(''),
    ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
    ['ASIA', 'ABCDEFGHIJKLMNOP'].join(''),
  ]
  // Act
  const redacted = keys.map((key) => redactSecretText(`key ${key} end`))
  // Assert
  assert.deepEqual(
    redacted,
    keys.map(() => 'key [masked] end'),
  )
})

// protects=fail-closed masking only for secret shapes, not for ordinary long runs (pt1 red-team finding); fails_when=a 9 KiB run that only mentions a task- word and an https URL is masked or dropped, or a private-key header without an end drops the rest of the channel; no_claim=secrets of unknown shape
test('a long run that only mentions a URL and a task- word stays visible, and an unterminated private key no longer silences the channel', () => {
  // Arrange
  const benign = `task-runner:https://example.com/chunk/${'a'.repeat(9_000)}`
  const benignRedactor = createOutputRedactor()
  const keyRedactor = createOutputRedactor()
  // Act
  const benignOutput =
    benignRedactor.write(benign) +
    benignRedactor.write('\n') +
    benignRedactor.end()
  const keyOutput =
    keyRedactor.write(`${PEM_HEADER}\n${'QUJD'.repeat(6_000)}`) +
    keyRedactor.write(`${' x'.repeat(10_000)}\nserver ready on 4000\n`) +
    keyRedactor.end()
  // Assert
  assert.equal(benignOutput, `${benign}\n`)
  assert.equal(keyOutput.startsWith('[masked]'), true)
  assert.equal(keyOutput.includes('QUJD'), false)
  assert.equal(keyOutput.endsWith('server ready on 4000\n'), true)
})

// protects=an oversized private-key block never takes the output after it (pt1 pass 2 QA finding: a real process wrote the block and its next line in one chunk); fails_when=the line that follows the block in the same chunk is dropped with it; no_claim=lines inside the dropped block
test('a line that follows an oversized private key in the same chunk is still released', () => {
  // Arrange
  const redactor = createOutputRedactor()
  // Act
  const output =
    redactor.write(`${PEM_HEADER}\n${'QUJD'.repeat(7_500)}\nserver ready\n`) +
    redactor.end()
  // Assert
  assert.equal(output, '[masked]server ready\n')
})

// protects=the drop limit counts only dropped key text (pt1 pass 2 security finding: the kept 80-character tail was counted again on every chunk); fails_when=a private key delivered in small chunks reaches the limit early and its body is released; no_claim=keys of unknown shape
test('a private key delivered in small chunks never releases its body', () => {
  // Arrange
  const body = Array.from({ length: 200 }, () => 'QUJD'.repeat(16)).join('\n')
  const stream = `${PEM_HEADER}\n${body}\n${['-----END', 'PRIVATE KEY-----'].join(' ')}\ndone\n`
  const redactor = createOutputRedactor()
  // Act
  let output = ''
  for (let index = 0; index < stream.length; index += 7)
    output += redactor.write(stream.slice(index, index + 7))
  output += redactor.end()
  // Assert
  assert.equal(output.includes('QUJD'), false)
  assert.equal(output.startsWith('[masked]'), true)
  assert.equal(output.endsWith('\ndone\n'), true)
})

// protects=a token whose drop is still pending when the stream ends releases nothing more (pt1 pass 2 state-machine cell token x end); fails_when=end() returns part of the dropped token; no_claim=none
test('a stream that ends while an oversized token is being dropped releases nothing more at its end', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const token = ['ghp', 'a'.repeat(9_000)].join('_')
  // Act
  const written = redactor.write(`using ${token}`)
  const ended = redactor.end()
  // Assert
  assert.equal(written, 'using [masked]')
  assert.equal(ended, '')
})

// protects=the streaming redactor's fail-closed trigger knows every provider prefix redactSecretText masks (pt1 pass 2 maintainability finding: the two lists are kept apart); fails_when=a provider key longer than the hold is released unmasked because the trigger lacks its prefix; no_claim=prefixes added to neither list
test('every provider key longer than the hold fails closed in streamed output', () => {
  // Arrange
  const keys = [
    ['sk', 'a'.repeat(9_000)].join('-'),
    ['sk', 'live', 'a'.repeat(9_000)].join('_'),
    ['ghp', 'a'.repeat(9_000)].join('_'),
    ['github', 'pat', 'a'.repeat(9_000)].join('_'),
    ['xoxb', 'a'.repeat(9_000)].join('-'),
    ['AIza', 'a'.repeat(9_000)].join(''),
    ['npm', 'a'.repeat(9_000)].join('_'),
    ['AKIA', 'A'.repeat(9_000)].join(''),
    ['ASIA', 'A'.repeat(9_000)].join(''),
    ['eyJ', 'a'.repeat(9_000)].join(''),
  ]
  // Act
  const outputs = keys.map((key) => {
    const redactor = createOutputRedactor()
    return redactor.write(`key ${key}`) + redactor.end()
  })
  // Assert
  assert.deepEqual(
    outputs,
    keys.map(() => 'key [masked]'),
  )
})

// protects=each value pattern; fails_when=a URL password, JWT, Bearer token, sk-, ghp_, github_pat_, AKIA key or PEM block survives, or the URL user name / the word Bearer is lost; no_claim=other providers' keys
test('text shaped like a credential reads [masked] and keeps its harmless words', () => {
  // Arrange / Act / Assert
  assert.equal(
    redactSecretText(`${POSTGRES}app:pw@db:5432/x`),
    `${POSTGRES}app:[masked]@db:5432/x`,
  )
  assert.equal(redactSecretText(`jwt ${JWT}.`), 'jwt [masked].')
  assert.equal(
    redactSecretText('Authorization: Bearer abcdefgh12345'),
    'Authorization: Bearer [masked]',
  )
  assert.equal(
    redactSecretText('key sk-abcdefghijklmnopqrstuvwx end'),
    'key [masked] end',
  )
  assert.equal(redactSecretText(`t ${GITHUB_TOKEN}`), 't [masked]')
  assert.equal(
    redactSecretText('github_pat_11ABCDEFG0abcdefghijklmnop_xyz'),
    '[masked]',
  )
  assert.equal(redactSecretText('id AKIAIOSFODNN7EXAMPLE ok'), 'id [masked] ok')
  assert.equal(
    redactSecretText(`before\n${PEM}\nafter`),
    'before\n[masked]\nafter',
  )
  assert.equal(
    redactSecretText('http://localhost:3000/a user@example.com'),
    'http://localhost:3000/a user@example.com',
  )
})

// protects=a JWT and a PEM block split over write calls; fails_when=any fragment of the token or the key body is released; no_claim=output without a secret shape
test('a JWT and a private key split over several output chunks never reach the released text', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const chunks = [
    'start eyJhbGciOiJIUzI1',
    'NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4C',
    'VPmB92K27uhbUJU1p1r_wW1gFWFOEjXk done\n-----BEGIN RSA PRIV',
    'ATE KEY-----\nMIIEvQIBADANBgkq\nhkiG9w0BAQEF',
    '\n-----END RSA PRIVATE KEY-----\nlast line\n',
  ]
  // Act
  const released =
    chunks.map((chunk) => redactor.write(chunk)).join('') + redactor.end()
  // Assert
  assert.equal(released, 'start [masked] done\n[masked]\nlast line\n')
})

// protects=Bearer split from its token; fails_when=the token is released after the word Bearer was released alone
test('a Bearer token that arrives in a later chunk than the word Bearer is masked', () => {
  // Arrange
  const redactor = createOutputRedactor()
  // Act
  const released =
    redactor.write('Authorization: Bearer ') +
    redactor.write('abcdefgh12345\nnext\n') +
    redactor.end()
  // Assert
  assert.equal(released, 'Authorization: Bearer [masked]\nnext\n')
})

// protects=the 8 KiB hold limit failing closed; fails_when=an unterminated private-key body longer than the limit, or a token run that long, is released or the rest of the block leaks after the overflow
test('a private key whose end never arrives within 8 KiB is masked and its remaining body stays dropped', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const body = 'A'.repeat(OUTPUT_REDACTION_HOLD_LIMIT_CHARS)
  // Act
  const first = redactor.write(`${PEM_HEADER}\n${body}`)
  const second = redactor.write('SECRETTAIL\n-----END PRIVATE')
  const third = redactor.write(' KEY-----\nafter\n')
  const rest = redactor.end()
  // Assert
  assert.equal(first, '[masked]')
  assert.equal(second, '')
  assert.equal(third, '\nafter\n')
  assert.equal(rest, '')
})

// protects=an oversize unbroken run that may be a secret; fails_when=a run longer than 8 KiB that starts a token shape is held without bound or released unmasked
test('a possible token run longer than 8 KiB is released as [masked] and its continuation is dropped', () => {
  // Arrange
  const redactor = createOutputRedactor()
  // Act
  const first = redactor.write(
    `ghp_${'x'.repeat(OUTPUT_REDACTION_HOLD_LIMIT_CHARS)}`,
  )
  const second = redactor.write('yyyy zzz\n')
  // Assert
  assert.equal(first, '[masked]')
  assert.equal(second, ' zzz\n')
})

// protects=a huge plain log line keeps its size (the flooding-output capture limit depends on it); fails_when=an unbroken run with no secret shape is masked or dropped, or loses characters
test('an unbroken run of 20000 plain characters is released whole after the end', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const run = 'x'.repeat(20_000)
  // Act
  const released = redactor.write(run) + redactor.write('END') + redactor.end()
  // Assert
  assert.equal(released, `${run}END`)
})

// protects=live output is not stalled: complete lines are released at once
test('complete output lines are released at once while a trailing partial word is held', () => {
  // Arrange
  const redactor = createOutputRedactor()
  // Act
  const released = redactor.write('ready on port 3000\nlistening ht')
  const rest = redactor.write('tp\n')
  // Assert
  assert.equal(released, 'ready on port 3000\nlistening ')
  assert.equal(rest, 'http\n')
})

// protects=causes and the Output channel; fails_when=a token in an error cause or a diagnostic entry is logged
test('a failure cause and an Output diagnostic entry mask credentials in their text', () => {
  // Arrange
  const error = new Error(
    `connect failed ${POSTGRES}app:hunter2@db/x with ${GITHUB_TOKEN}`,
  )
  // Act
  const cause = sanitizeCause(error, { storage: [] })
  const entry = formatCodebookDiagnostic(
    { surface: 'X', cause: `raw ${GITHUB_TOKEN}`, stack: `at f (${JWT})` },
    {
      extensionVersion: '1',
      apiVersion: '1.8',
      hostName: 'h',
      hostVersion: '2',
    },
  )
  // Assert
  assert.equal(
    cause,
    `connect failed ${POSTGRES}app:[masked]@db/x with [masked]`,
  )
  assert.equal(entry.includes('ghp_'), false)
  assert.equal(entry.includes('eyJ'), false)
})

// protects=node-test publication: run facts and the retained debugger variable; fails_when=accessToken's real value is in a fact, in the variable list or reachable through a secret-named parent
test('a node test inspection of accessToken reads [masked] in the run facts', async () => {
  // Arrange
  const references = new Map<number, DebugProtocol.Variable[]>([
    [
      1,
      [
        {
          name: 'accessToken',
          value: "'plain-looking-secret'",
          variablesReference: 0,
        },
        { name: 'tokenCount', value: '3', variablesReference: 0 },
        { name: 'session', value: 'Object', variablesReference: 2 },
        { name: 'note', value: `'${GITHUB_TOKEN}'`, variablesReference: 0 },
      ],
    ],
    [2, [{ name: 'userId', value: '7', variablesReference: 0 }]],
  ])
  const debugSession = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => ({ variables: references.get(arguments_.variablesReference) ?? [] }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  // Act
  const result = await inspectNodeTestVariables(
    debugSession,
    [{ name: 'Local', variablesReference: 1, expensive: false }],
    [
      { path: 'accessToken', mode: 'value', required: true },
      { path: 'tokenCount', mode: 'value', required: true },
      { path: 'session.userId', mode: 'value', required: true },
      { path: 'note', mode: 'value', required: true },
    ],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )
  // Assert
  assert.deepEqual(
    result.facts.map((fact) => fact.display),
    ['[masked]', '3', '[masked]', "'[masked]'"],
  )
  assert.equal(JSON.stringify(result).includes('plain-looking-secret'), false)
  assert.equal(JSON.stringify(result).includes('ghp_'), false)
})

// protects=repository-browser inspection facts; fails_when=a secret-named browser value, or a credential-shaped string, reaches the facts; no_claim=object markers stay { type }
test('a browser inspection of password reads [masked] while an object marker stays', async () => {
  // Arrange
  const answers: Record<string, unknown> = {
    'form.password': 'hunter2',
    'form.name': `ada ${GITHUB_TOKEN}`,
    'form.count': 4,
    'form.session': { type: 'object' },
  }
  const evaluate = async (
    parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> => {
    const path = Object.keys(answers).find((candidate) =>
      parameters.expression.endsWith(`(${candidate})`),
    )
    return { result: { type: 'string', value: answers[path ?? ''] } }
  }
  // Act
  const facts = await inspectConfiguredValues(
    evaluate,
    'frame',
    [
      { path: 'form.password', mode: 'value', required: true },
      { path: 'form.name', mode: 'value', required: true },
      { path: 'form.count', mode: 'value', required: true },
      { path: 'form.session', mode: 'value', required: true },
    ],
    () => undefined,
  )
  // Assert
  assert.deepEqual(facts.values, {
    'value:form.password': '[masked]',
    'value:form.name': 'ada [masked]',
    'value:form.count': 4,
    'value:form.session': { type: 'object' },
  })
})

// protects=debugger snapshots shared by both profiles; fails_when=a secret-named variable's value or any child is saved, or the subtree is still requested
test('a replay debugger snapshot masks a secret-named object and never reads its children', async () => {
  // Arrange
  const requested: number[] = []
  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 77, name: 'f', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 },
    assertCurrent() {},
    request(command, arguments_) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [{ name: 'Locals', variablesReference: 1 }],
        })
      requested.push(arguments_.variablesReference ?? 0)
      return Promise.resolve({
        variables:
          arguments_.variablesReference === 1
            ? [
                { name: 'authSession', value: 'Object', variablesReference: 2 },
                { name: 'sortKey', value: "'name'", variablesReference: 0 },
                {
                  name: 'url',
                  value: `'${POSTGRES}u:pw@h/d'`,
                  variablesReference: 0,
                },
              ]
            : [{ name: 'userId', value: '7', variablesReference: 0 }],
      })
    },
  })
  // Assert
  assert.deepEqual(
    snapshot.variables.map((variable) => [variable.name, variable.value]),
    [
      ['authSession', '[masked]'],
      ['sortKey', "'name'"],
      ['url', `'${POSTGRES}u:[masked]@h/d'`],
    ],
  )
  assert.deepEqual(requested, [1])
})

// protects=secret-named members shown inside an expandable value's preview (CodeRabbit pt1 finding); fails_when=a member value of a secret-named key survives in the preview text; no_claim=secrets under plainly named keys
test('a value preview masks the members of secret-named keys and keeps the others', () => {
  // Arrange
  const previews = [
    "{apiKey: 'plain-secret', host: 'x'}",
    "Map(2) {'authorization' => 'Bearer x', 'accept' => '*/*'}",
    "{auth: {password: 'p', user: 'u'}, n: 1}",
    '{session: {id: 1, role: "admin"}, n: 2}',
    "['a', 'b']",
  ]
  // Act
  const redacted = previews.map((preview) => redactValuePreview(preview))
  // Assert
  assert.deepEqual(redacted, [
    "{apiKey: [masked], host: 'x'}",
    "Map(2) {'authorization' => [masked], 'accept' => '*/*'}",
    "{auth: {password: [masked], user: 'u'}, n: 1}",
    '{session: [masked], n: 2}',
    "['a', 'b']",
  ])
})

// protects=debugger snapshots of an expandable value whose preview names a secret member (CodeRabbit pt1 finding); fails_when=the parent's saved preview carries the secret member's value
test('a replay debugger snapshot never saves a secret member through its parent preview', async () => {
  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 77, name: 'f', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 },
    assertCurrent() {},
    request(command, arguments_) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [{ name: 'Locals', variablesReference: 1 }],
        })
      return Promise.resolve({
        variables:
          arguments_.variablesReference === 1
            ? [
                {
                  name: 'config',
                  value: "{apiKey: 'plain-secret', host: 'x'}",
                  variablesReference: 2,
                },
              ]
            : [
                {
                  name: 'apiKey',
                  value: "'plain-secret'",
                  variablesReference: 0,
                },
                { name: 'host', value: "'x'", variablesReference: 0 },
              ],
      })
    },
  })
  // Assert
  assert.deepEqual(
    snapshot.variables.map((variable) => [variable.name, variable.value]),
    [
      ['config', "{apiKey: [masked], host: 'x'}"],
      ['apiKey', '[masked]'],
      ['host', "'x'"],
    ],
  )
  assert.equal(JSON.stringify(snapshot).includes('plain-secret'), false)
})

// protects=node-test facts of an object path whose preview names a secret member (CodeRabbit pt1 finding); fails_when=the fact or the kept variable carries the member's value
test('a node test inspection of an object keeps its secret member masked in the fact', async () => {
  // Arrange
  const debugSession = {
    customRequest: async () => ({
      variables: [
        {
          name: 'config',
          value: "{apiKey: 'plain-secret', host: 'x'}",
          variablesReference: 0,
        },
      ],
    }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  // Act
  const result = await inspectNodeTestVariables(
    debugSession,
    [{ name: 'Local', variablesReference: 1, expensive: false }],
    [{ path: 'config', mode: 'value', required: true }],
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )
  // Assert
  assert.deepEqual(
    result.facts.map((fact) => fact.display),
    ["{apiKey: [masked], host: 'x'}"],
  )
  assert.equal(JSON.stringify(result).includes('plain-secret'), false)
})

// protects=masking before the 4,096-character event split and the 32 KiB tail cut, split across real child-process writes; fails_when=a fragment of the token is in any event or in the kept tail
test('node test output masks a token the event split and the tail cut would have broken', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-redaction-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    [
      `const token = ${JSON.stringify(GITHUB_TOKEN)}`,
      "process.stdout.write('x'.repeat(4090) + ' ' + token.slice(0, 12))",
      'setTimeout(() => {',
      "  process.stdout.write(token.slice(12) + ' ' + 'b'.repeat(32_760) + '\\n')",
      "  process.stdout.write(token + '\\n')",
      '}, 200)',
    ].join('\n'),
  )
  const events: string[] = []
  const owned = await launchNodeTest(
    {
      vitestRoot: workspace,
      execution: ROOT_MODE_EXECUTION,
      program,
      args: ['--inspect-brk'],
    },
    process.execPath,
    () => undefined,
    (event) => {
      events.push(event.text)
    },
  )
  try {
    // Act
    const result = await owned.result(AbortSignal.timeout(10_000))
    // Assert
    const everything = events.join('')
    assert.equal(
      events.every((text) => text.length <= 4_096),
      true,
    )
    assert.equal(everything.includes('ghp_'), false)
    assert.equal(everything.includes('0123456789abcdef'), false)
    assert.equal(everything.includes('[masked]'), true)
    assert.equal(result.output.includes('0123456789abcdef'), false)
    assert.equal(result.output.includes('[masked]'), true)
  } finally {
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

// Value: protects=an inspected path is secret when any step names a secret, in dotted, bracketed, quoted and optional-chaining forms; fails_when=headers["authorization"], user?.password or items[0].token reads its value, or a tokenCount or publicKey path is masked; why_new=existing rows inspect only dotted paths; seam=none; no_claim=other providers' paths (unit only)
test('an inspected path through a bracket, quote or optional chain to a secret name reads [masked]', () => {
  // Arrange
  const secretPaths = [
    'headers["authorization"]',
    "headers['set-cookie']",
    'user?.password',
    'items[0].token',
    'config.apiKey',
  ]
  const plainPaths = ['tokenCount', 'user.name', 'items[0].publicKey']
  // Act
  const secretReadings = secretPaths.map((path) =>
    redactInspectedValue({ mode: 'value', path }, 'hunter2'),
  )
  const plainReadings = plainPaths.map((path) =>
    redactInspectedValue({ mode: 'value', path }, 'hunter2'),
  )
  const typeReading = redactInspectedValue(
    { mode: 'type', path: 'user.password' },
    'string',
  )
  const credentialInNote = redactInspectedValue(
    { mode: 'value', path: 'note' },
    `see ${GITHUB_TOKEN}`,
  )
  // Assert
  assert.deepEqual(
    secretReadings,
    secretPaths.map(() => '[masked]'),
  )
  assert.deepEqual(
    plainReadings,
    plainPaths.map(() => 'hunter2'),
  )
  assert.equal(typeReading, 'string')
  assert.equal(credentialInNote, 'see [masked]')
})
