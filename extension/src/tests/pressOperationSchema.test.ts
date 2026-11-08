import assert from 'node:assert/strict'
import { test } from 'node:test'

import { z } from 'zod'

import {
  canonicalizePressKeys,
  liveRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'

/**
 * A valid version 3 `next-dev-webpack` configuration with the given operations.
 * @example configuration([{ kind: 'press', title: 'Open', key: 'Escape' }]).version // => 3
 */
function configuration(
  operations: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'next-dev-webpack',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'sign-in',
      anchorIndex: 0,
    },
    source: {
      path: 'src/App.tsx',
      hash: 'a'.repeat(64),
      line: 56,
      column: 5,
    },
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#first' }],
    after: [{ kind: 'text', selector: '#status', equals: 'done' }],
    operations,
    inspections: [{ path: 'state', mode: 'value', required: true }],
  }
}

/** The issues the version 3 schema gives an input as `path: message` lines, or `accepted`. */
function issuesOf(input: unknown): string {
  const result = operationsRepositoryConfigSchema.safeParse(input)
  return result.success
    ? 'accepted'
    : result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')
}

const AFTER = [{ kind: 'visible', selector: '#panel' }]
const FIRST_CLICK = { kind: 'click', title: 'First', selector: '#first' }

// Value: protects=every key form of the grammar reaching a run as a valid press; fails_when=a canonical spelling (character, chord, named key, function key) is refused by the schema; no_claim=how the engine sends the key
test('a press accepts a character, a chord, a named key and a function key', () => {
  // Arrange
  const keys = [
    'x',
    'Control+k',
    'Shift+Meta+p',
    'Escape',
    'F5',
    'Control+Plus',
  ]
  // Act
  const results = keys.map((key) =>
    issuesOf(configuration([{ kind: 'press', title: `Press ${key}`, key }])),
  )
  // Assert
  assert.deepEqual(
    results,
    keys.map(() => 'accepted'),
  )
})

// Value: protects=selector and after staying optional on a press; fails_when=the schema requires a selector or an after on the last press, or drops a declared selector; no_claim=what the run focuses
test('a press accepts a selector and an after, and needs neither on the last operation', () => {
  // Arrange
  const withBoth = configuration([
    {
      kind: 'press',
      title: 'Open',
      key: 'Control+k',
      selector: '#search',
      after: AFTER,
    },
  ])
  const withNeither = configuration([
    { kind: 'press', title: 'Open', key: 'Control+k' },
  ])
  // Act
  const results = [issuesOf(withBoth), issuesOf(withNeither)]
  // Assert
  assert.deepEqual(results, ['accepted', 'accepted'])
})

// Value: protects=the field the chat is told to fix for a malformed key; fails_when=the issue is not at operations[i].key, repeats the path in its text, or lacks the allowed form; no_claim=the INVALID_CONFIGURATION wrapper message
test('a malformed key is refused at operations[i].key with a message that stands alone', () => {
  // Arrange
  const input = configuration([
    FIRST_CLICK,
    { kind: 'press', title: 'Open', key: 'Control+', after: AFTER },
  ])
  // Act
  const result = operationsRepositoryConfigSchema.safeParse(input)
  // Assert
  assert.equal(result.success, false)
  const issue = result.error?.issues[0]
  assert.deepEqual(issue?.path, ['operations', 1, 'key'])
  assert.equal(
    issue?.message,
    '"Control+" ends with "+" and names no key after the modifiers.',
  )
})

// Value: protects=the alias table naming the canonical spelling in the schema message; fails_when=an alias is accepted or its message does not say which spelling to write; no_claim=the alias list beyond these spellings (pressKey.test.ts)
test('an alias spelling is refused and the message names the canonical spelling', () => {
  // Arrange
  const input = configuration([{ kind: 'press', title: 'Open', key: 'Ctrl+k' }])
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'operations.0.key: "Ctrl+k" is not a key; write "Control+k".',
  )
})

// Value: protects=the refusal of an uppercase letter beside Control; fails_when=Control+K is accepted or the message hides the two spellings to choose from; no_claim=other shifted symbols
test('an uppercase letter beside Control is refused with the two spellings to write', () => {
  // Arrange
  const input = configuration([
    { kind: 'press', title: 'Open', key: 'Control+K' },
  ])
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'operations.0.key: "Control+K" is not a key; write "Control+k" or "Control+Shift+k".',
  )
})

// Value: protects=D13: a press that is not the last operation must carry its own after; fails_when=a non-last press without after is accepted or refused at another path; no_claim=whether the after condition holds at run time
test('a press that is not the last operation needs an after, refused at operations[i].after', () => {
  // Arrange
  const input = configuration([
    { kind: 'press', title: 'Open', key: 'Escape' },
    FIRST_CLICK,
  ])
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    "operations.0.after: A press must say how the run knows the key worked: add an after condition that only the opened UI satisfies, derived from the app's own source.",
  )
})

// Value: protects=the last press relying on the run-level after; fails_when=the last press without after is refused; no_claim=that the run-level after proves the key worked
test('the last press may omit its after', () => {
  // Arrange
  const input = configuration([
    FIRST_CLICK,
    { kind: 'press', title: 'Open', key: 'Escape' },
  ])
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(issues, 'accepted')
})

// Value: protects=the press shape staying strict; fails_when=a text or value field on a press is accepted; no_claim=the message wording of an unknown key
test('a press refuses fields that belong to other operations', () => {
  // Arrange
  const input = configuration([
    { kind: 'press', title: 'Open', key: 'Escape', text: 'abc' },
  ])
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(issues, /^operations\.0: Unrecognized key: "text"$/)
})

// Value: protects=one configuration per key chord for the idempotency key, the run and the saved study; fails_when=canonicalizePressKeys leaves a non-canonical key, copies an unchanged configuration, or touches another operation; no_claim=where the service calls it
test('canonicalizePressKeys rewrites each press key to its canonical spelling and leaves other operations alone', () => {
  // Arrange
  const parsed = operationsRepositoryConfigSchema.parse(
    configuration([
      FIRST_CLICK,
      { kind: 'press', title: 'Open', key: 'Meta+Shift+p', after: AFTER },
      { kind: 'press', title: 'Close', key: 'Control++' },
    ]),
  )
  const alreadyCanonical = operationsRepositoryConfigSchema.parse(
    configuration([{ kind: 'press', title: 'Open', key: 'Shift+Meta+p' }]),
  )
  // Act
  const canonical = canonicalizePressKeys(parsed)
  const unchanged = canonicalizePressKeys(alreadyCanonical)
  // Assert
  assert.deepEqual(
    canonical.operations?.map((operation) =>
      operation.kind === 'press' ? operation.key : operation.kind,
    ),
    ['click', 'Shift+Meta+p', 'Control+Plus'],
  )
  assert.equal(canonical.operations?.[0], parsed.operations?.[0])
  assert.equal(unchanged, alreadyCanonical)
})

// Value: protects=the MCP tool input schema and the help resource still building with a press member; fails_when=the press member adds a transform that makes z.toJSONSchema throw in input mode or drops press from the list; no_claim=the help text
test('the input JSON schema of the live configuration builds and lists press', () => {
  // Arrange
  const options = { io: 'input' } as const
  // Act
  const schema = JSON.stringify(
    z.toJSONSchema(liveRepositoryConfigSchema, options),
  )
  // Assert
  assert.match(schema, /"const":"press"/)
  assert.match(schema, /"key":\{"type":"string","minLength":1,"maxLength":40\}/)
})

// Value: protects=D34: a press is kept only by the format 21 member of the study schema; fails_when=an older retained schema accepts a press, or the study union refuses a canonical press or accepts a non-canonical key; no_claim=the format number stored with the study
test('only the format 21 study schema keeps a press', () => {
  // Arrange
  const withPress = configuration([
    { kind: 'press', title: 'Open', key: 'Shift+Meta+p' },
  ])
  const nonCanonical = configuration([
    { kind: 'press', title: 'Open', key: 'Meta+Shift+p' },
  ])
  const withoutPress = configuration([FIRST_CLICK])
  // Act
  const retained = retainedRepositoryConfigSchema.safeParse(withPress)
  const studyWithPress = studyConfigurationSchema.safeParse(withPress)
  const studyNonCanonical = studyConfigurationSchema.safeParse(nonCanonical)
  const studyWithoutPress = studyConfigurationSchema.safeParse(withoutPress)
  // Assert
  assert.equal(retained.success, false)
  assert.equal(studyWithPress.success, true)
  assert.equal(studyNonCanonical.success, false)
  assert.equal(studyWithoutPress.success, true)
})
