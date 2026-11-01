import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { OPERATIONS_ERROR_CODES, operationsHelp } from '../operationsHelp'
import { savedSessionHelp } from '../savedSessionHelp'

const readPackaged = (...parts: string[]): Promise<string> =>
  readFile(resolve(__dirname, '../..', ...parts), 'utf8')

// protects=DES-7, DX-10, DX-11, task 2 (help describes what, where, how to remove); fails_when=a sentence or an error row is missing; no_claim=readability
test('the saved-session help says what is kept, where it lives, how to remove it and how long the chat waits, and its four codes are in the error table', () => {
  // Arrange / Act
  const { savedSession } = savedSessionHelp()
  // Assert
  assert.equal(
    savedSession.anchor,
    'codebook://help/repository-browser#set-up-a-saved-session',
  )
  assert.match(savedSession.where, /mode 0700/)
  assert.match(savedSession.remove, /not to the Trash/)
  assert.match(savedSession.waiting, /at most every 10 s for at most 5 minutes/)
  assert.match(savedSession.summary, /Never type, ask for or accept a password/)
  for (const code of [
    'SIGN_IN_REQUIRED',
    'SIGN_IN_IN_PROGRESS',
    'SIGN_IN_PROFILE_IN_USE',
    'SIGN_IN_PROFILE_UNUSABLE',
  ] as const)
    assert.ok(OPERATIONS_ERROR_CODES.includes(code), code)
})

// protects=cross-check 12 (one anchored saved-session section): setup and the run rules live under one key and one anchor, link the confirmation section, and no second saved-session key or repeated sentence remains; fails_when=a separate run section returns, a run rule goes missing, or a sentence is repeated; no_claim=wording
test('the saved-session help is one section holding setup and run rules, linking the confirmation, with no repeated sentence', () => {
  // Arrange
  const help = { ...operationsHelp(), ...savedSessionHelp() }
  const section = help.savedSession
  // Act
  const sentences = Object.values(section)
    .filter((value): value is string => typeof value === 'string')
    .flatMap((text) => text.split(/(?<=\.)\s+/))
  // Assert
  assert.deepEqual(
    Object.keys(help).filter((key) => /savedsession/i.test(key)),
    ['savedSession'],
  )
  for (const key of [
    'setup',
    'signInPaths',
    'reasons',
    'entryLoad',
    'oneRun',
    'origin',
    'fresh',
    'lastOperation',
    'recording',
    'confirmation',
  ] as const)
    assert.equal(typeof section[key], 'string', key)
  assert.match(section.signInPaths, /1 to \d+ absolute paths/)
  assert.match(section.entryLoad, /Pages-router route behind sign-in/)
  assert.match(section.confirmation, /#saved-session-confirmation/)
  assert.match(section.oneRun, /details\.heldBy reads run .* or removal/)
  assert.equal(
    help.operationsDeclare.savedSessionConfirmation.anchor,
    'codebook://help/repository-browser#saved-session-confirmation',
  )
  assert.equal(new Set(sentences).size, sentences.length)
})

// protects=DX-9 and DES-1 vocabulary, G1/G2; fails_when=the README or skill lacks the commands, the password rule or the status-field rule, or a packaged text says "signed in for runs"; no_claim=translations
test('the README and the bundled skill name both commands, forbid typing a password, tie the skill to codebook_status.savedSession, and never say signed in for runs', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const manifest = await readPackaged('package.json')
  // Act / Assert
  for (const text of [
    'Set Up Saved Session',
    'Remove Saved Session',
    '0700',
    'not to the Trash',
    'Stop run and remove',
    'Saved session needed',
  ])
    assert.ok(readme.includes(text), text)
  assert.ok(skill.includes('metadata:\n  version: "1.0.64"\n'))
  assert.ok(skill.includes('never type, ask for or accept a password'))
  assert.ok(
    skill.includes('only when `codebook_status` reports `savedSession`'),
  )
  for (const packaged of [readme, skill, manifest])
    assert.equal(/signed in for runs/i.test(packaged), false)
})

// protects=AC7, DX-11, G3 (the packaged help and the bundled skill give a chat everything it needs about a saved session); fails_when=either text loses the vocabulary, the waiting bound or the password rule; no_claim=how well a chat follows it
test('the packaged help and the bundled skill name the saved session, its command, its codes, Review again, the waiting bound and the password rule', async () => {
  // Arrange
  const help = JSON.stringify({ ...operationsHelp(), ...savedSessionHelp() })
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act / Assert
  for (const [name, text] of [
    ['help', help],
    ['skill', skill],
  ] as const) {
    for (const phrase of [
      'saved session',
      'Set Up Saved Session',
      'SIGN_IN_REQUIRED',
      'OPERATIONS_NOT_CONFIRMED',
      'Review again',
      'at most every 10 s for at most 5 minutes',
    ])
      assert.ok(text.includes(phrase), `${name} lacks ${phrase}`)
    assert.match(
      text,
      /never type, ask for or accept a password/i,
      `${name} lacks the password rule`,
    )
  }
})
