import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { chromeExtensionHelp } from '../chromeExtensionHelp'
import { chromeExtensionLearningMaterialSchema } from '../chromeExtensionLearningSchemas'
import { chromeExtensionSaveHelp } from '../chromeExtensionSaveHelp'
import { EXTENSION_HISTORY_REASON_CODES } from '../constants'

/** Reads a file of the extension package; tests run from `dist/tests`. */
const readPackageFile = (...path: string[]): string =>
  readFileSync(join(__dirname, '..', '..', ...path), 'utf8')

// protects=DX-2: the help's save section carries a worked example an agent can copy; fails_when=the example's content stops parsing with the chrome-extension material schema; no_claim=that the cited sequences exist in a real history
test('the extension save help example parses as saved learning material', () => {
  // Arrange
  const { example } = chromeExtensionSaveHelp()

  // Act
  const parsed = chromeExtensionLearningMaterialSchema.safeParse({
    version: 1,
    studyId:
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    revision: 1,
    updatedAt: '2026-11-01T00:00:00.000Z',
    content: example.arguments.content,
  })

  // Assert
  assert.equal(example.tool, 'codebook_explain_node_history')
  assert.equal(parsed.success, true)
})

// protects=DX-2: every code of a chrome-extension history is worded in the help, generated from the constants; fails_when=a code is added to the constants without a row, or a row is dropped; no_claim=the wording of a row
test('the extension save help lists one row per history code with its action and retry answer', () => {
  // Arrange
  const expectedCodes = [
    'EXTENSION_HISTORY_FILMSTRIP_MISSING',
    'EXTENSION_HISTORY_PINNED_FRAME_MISSING',
    'EXTENSION_HISTORY_SNAPSHOT_MISSING',
    'EXTENSION_HISTORY_SOURCE_UNAVAILABLE',
    'EXTENSION_HISTORY_SIZE_LIMIT',
    'EXTENSION_HISTORY_SURFACE_ENDED',
    'EXTENSION_HISTORY_STOP_NOT_REACHED',
    'EXTENSION_HISTORY_RESULT_MISSING',
    'EXTENSION_HISTORY_APPEND_FAILED',
    'EXTENSION_HISTORY_FORMAT_NEWER',
    'EXTENSION_HISTORY_FRAME_DAMAGED',
  ]

  // Act
  const { codes } = chromeExtensionSaveHelp()

  // Assert
  assert.deepEqual(
    codes.map((row) => row.code),
    expectedCodes,
  )
  assert.deepEqual(
    codes.map((row) => row.code),
    Object.values(EXTENSION_HISTORY_REASON_CODES),
  )
  assert.equal(
    codes.every(
      (row) => row.meaning && row.evidenceKept && row.action.length > 0,
    ),
    true,
  )
  assert.equal(
    codes.find((row) => row.code === 'EXTENSION_HISTORY_FILMSTRIP_MISSING')
      ?.retryHelps,
    false,
  )
})

// protects=DX-2: the save section states the API gate, the claim rule and the refusals of a recording or full library; fails_when=any of them leaves the help; no_claim=how an agent compares versions
test('the extension save help states the API 1.13 gate, the claim rule and the refusal rows', () => {
  // Arrange / Act
  const help = chromeExtensionSaveHelp()

  // Assert
  assert.equal(
    help.requires,
    'codebook_status reports API 1.13 or later (compare the number after the dot as a whole number: 1.13 is later than 1.9). On an older API, tell the learner to update Codebook and do not try to save an extension explanation.',
  )
  assert.equal(
    help.verdicts.claimRule,
    'Say a saved replay exists only when learningCoverage is complete and captureMissing is empty; otherwise name each missing part and what would add it.',
  )
  assert.deepEqual(
    help.refusals.map((row) => row.code),
    ['HISTORY_STILL_RECORDING', 'EVIDENCE_UNAVAILABLE', 'PREREQUISITE_MISSING'],
  )
  assert.equal(
    help.historyByteLimit.startsWith('8388608 bytes of events'),
    true,
  )
})

// protects=the codebook://help/chrome-extension resource carries the save section; fails_when=chromeExtensionHelp drops it; no_claim=the section's content (other tests)
test('the chrome-extension help publishes the save section', () => {
  // Arrange / Act
  const help = chromeExtensionHelp()

  // Assert
  assert.equal(help.save.route.length, 5)
})

// protects=AC3: the packaged help, skill and MCP instruction text carry none of the old refusal phrases and do carry the new save route; fails_when=an old phrase returns or the route text leaves the help or the skill; no_claim=README, CHANGELOG and the live label (checked elsewhere)
test('the help, skill and MCP instructions carry no refusal phrase and name the save route', () => {
  // Arrange
  const refusalPhrases = [
    'Saving an extension run is not available in this version',
    'A chrome-extension run is live only',
    'an extension run is live only and is not saved',
    'not saved or replayed in this version',
    'a chrome-extension run is not saved in this version',
    'the run is live only, with no learning replay',
  ]
  const help = JSON.stringify(chromeExtensionHelp())
  const skill = readPackageFile('skills', 'codebook', 'SKILL.md')
  const protocol = readPackageFile('src', 'protocol.ts')

  // Act
  const offenders = refusalPhrases.filter(
    (phrase) =>
      help.includes(phrase) ||
      skill.includes(phrase) ||
      protocol.includes(phrase),
  )

  // Assert
  assert.deepEqual(offenders, [])
  assert.equal(help.includes('chromeExtension.historyUri'), true)
  assert.equal(help.includes('codebook_explain_node_history'), true)
  assert.equal(skill.includes('**Saving an extension run.**'), true)
  assert.equal(skill.includes('`chromeExtension.historyUri`'), true)
})
