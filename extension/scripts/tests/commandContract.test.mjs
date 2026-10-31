import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CommandRefusal,
  EXIT,
  formatRefusal,
  redactSecrets,
  runCommandLine,
} from '../utils/commandContract.mjs'

// protects=a refusal prints its code first and its fix last; fails_when=the order or prefixes change; no_claim=the wording of any command's own refusals
test('a refusal prints its code on the first line, its details between, and its fix on the last line', () => {
  // Arrange
  const refusal = new CommandRefusal(
    'E_DIRTY',
    'the checkout has changes: extension/src/a.ts',
    {
      fix: 'commit or move the changes',
      details: ['also changed: extension/src/b.ts'],
    },
  )

  // Act
  const lines = formatRefusal(refusal, {})

  // Assert
  assert.deepEqual(lines, [
    'E_DIRTY: the checkout has changes: extension/src/a.ts',
    'also changed: extension/src/b.ts',
    'Fix: commit or move the changes',
  ])
})

// protects=a token value never reaches printed output; fails_when=values of TOKEN/KEY/SECRET/PASSWORD variables pass through; no_claim=secrets that are not in the environment
test('relayed text hides the values of token, key, secret and password variables', () => {
  // Arrange
  const environment = {
    GH_TOKEN: 'ghp_exampletoken123',
    OPENAI_API_KEY: 'sk-example-key-456',
    DB_PASSWORD: 'hunter22-example',
    MY_SECRET: 'shh-example-789',
    HOME: '/Users/example',
  }
  const text =
    'gh: auth ghp_exampletoken123 failed; key sk-example-key-456; pw hunter22-example; s shh-example-789; home /Users/example'

  // Act
  const redacted = redactSecrets(text, environment)

  // Assert
  assert.equal(
    redacted,
    'gh: auth [redacted] failed; key [redacted]; pw [redacted]; s [redacted]; home /Users/example',
  )
})

// protects=short flag values do not garble output; fails_when=values under six characters are replaced; no_claim=none beyond protects
test('a secret-named variable with a value under six characters is left in the text', () => {
  // Arrange
  const environment = { NO_TOKEN_CACHE: 'true', API_KEY: '1' }

  // Act
  const redacted = redactSecrets('cache true, retries 1', environment)

  // Assert
  assert.equal(redacted, 'cache true, retries 1')
})

// protects=a command's own exit code passes through; fails_when=runCommandLine rewrites a returned code; no_claim=none beyond protects
test('a command that finishes returns its own exit code and prints nothing', async () => {
  // Arrange
  const printed = []

  // Act
  const exitCode = await runCommandLine(async () => EXIT.FOLLOW_UP, {
    printError: (line) => printed.push(line),
    environment: {},
  })

  // Assert
  assert.equal(exitCode, 3)
  assert.deepEqual(printed, [])
})

// protects=a refusal's exit code and lines reach the caller; fails_when=a refusal exits with another code or loses its fix line; no_claim=none beyond protects
test('a refused command prints the refusal and exits with the refusal code', async () => {
  // Arrange
  const printed = []

  // Act
  const exitCode = await runCommandLine(
    async () => {
      throw new CommandRefusal('E_USAGE', '--issue takes digits (got 12a)', {
        fix: 'node extension/scripts/post-trial-evidence.mjs <run-log.md> --issue 172',
        exitCode: EXIT.USAGE,
      })
    },
    { printError: (line) => printed.push(line), environment: {} },
  )

  // Assert
  assert.equal(exitCode, 64)
  assert.deepEqual(printed, [
    'E_USAGE: --issue takes digits (got 12a)',
    'Fix: node extension/scripts/post-trial-evidence.mjs <run-log.md> --issue 172',
  ])
})

// protects=an unexpected error before any side effect says retry is safe (exit 2); fails_when=it exits 4 or omits the stage; no_claim=the stack's exact frames
test('an unexpected error before any side effect exits 2 with E_INTERNAL and the stage it reached', async () => {
  // Arrange
  const printed = []

  // Act
  const exitCode = await runCommandLine(
    async (progress) => {
      progress.enter('read the gate summary')
      throw new Error('summary parser broke')
    },
    { printError: (line) => printed.push(line), environment: {} },
  )

  // Assert
  assert.equal(exitCode, 2)
  assert.equal(printed[0], 'E_INTERNAL: summary parser broke')
  assert.equal(printed[1], 'Stage: read the gate summary')
  assert.equal(
    printed.at(-1),
    'Fix: nothing changed; fix the cause above, then rerun',
  )
})

// protects=an unexpected error after a side effect says the outcome is unknown (exit 4); fails_when=a later read-only stage resets it to 2; no_claim=the stack's exact frames
test('an unexpected error after a side-effect stage exits 4, even from a later read-only stage', async () => {
  // Arrange
  const printed = []

  // Act
  const exitCode = await runCommandLine(
    async (progress) => {
      progress.enter('merge the PR', { sideEffect: true })
      progress.enter('read the merge commit')
      throw new Error('mergeCommit missing')
    },
    { printError: (line) => printed.push(line), environment: {} },
  )

  // Assert
  assert.equal(exitCode, 4)
  assert.equal(printed[0], 'E_INTERNAL: mergeCommit missing')
  assert.equal(printed[1], 'Stage: read the merge commit')
  assert.equal(
    printed.at(-1),
    'Fix: check what changed before retrying; the stage above may have run partly',
  )
})

// protects=a token inside an exception message is hidden; fails_when=E_INTERNAL lines skip redaction; no_claim=none beyond protects
test('an unexpected error message holding a token value is printed redacted', async () => {
  // Arrange
  const printed = []

  // Act
  await runCommandLine(
    async () => {
      throw new Error('gh failed with token ghp_exampletoken123')
    },
    {
      printError: (line) => printed.push(line),
      environment: { GH_TOKEN: 'ghp_exampletoken123' },
    },
  )

  // Assert
  assert.equal(printed[0], 'E_INTERNAL: gh failed with token [redacted]')
  assert.ok(printed.every((line) => !line.includes('ghp_exampletoken123')))
})

// protects=a main that forgets to return a code is not reported as success; fails_when=undefined is passed through as an exit code; no_claim=none beyond protects
test('a command that returns no exit code is reported as an internal error', async () => {
  // Arrange
  const printed = []

  // Act
  const exitCode = await runCommandLine(async () => undefined, {
    printError: (line) => printed.push(line),
    environment: {},
  })

  // Assert
  assert.equal(exitCode, 2)
  assert.equal(
    printed[0],
    'E_INTERNAL: the command returned undefined instead of an exit code',
  )
})
