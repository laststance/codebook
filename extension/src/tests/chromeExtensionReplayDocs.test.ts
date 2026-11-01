import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { chromeExtensionSaveHelp } from '../chromeExtensionSaveHelp'
import { EXTENSION_HISTORY_REASON_CODES } from '../constants'

/**
 * Reads the packaged README (tests run from `dist/tests`).
 * @returns The README text.
 * @example readPackagedReadme().includes('## Explain a Chrome extension') // => true
 */
function readPackagedReadme(): string {
  return readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')
}

/**
 * Cuts the README's "When an Extension replay is partial" section.
 * @param readme - The README text.
 * @returns The section up to the next level-2 heading; empty when it is missing.
 * @example readPartialSection(readme).startsWith('### When an Extension replay is partial') // => true
 */
function readPartialSection(readme: string): string {
  const start = readme.indexOf('### When an Extension replay is partial')
  if (start === -1) return ''
  const end = readme.indexOf('\n## ', start)
  return end === -1 ? readme.slice(start) : readme.slice(start, end)
}

// protects=a learner reading the packaged README's partial-replay table finds every capture code the save help lists (and HISTORY_STILL_RECORDING), so the table and the help cannot drift; fails_when=a code is added to EXTENSION_HISTORY_REASON_CODES or to the help's refusals and the README table has no row for it; no_claim=the wording of a row's meaning or action
test('the README table of a partial Extension replay has a row for every history code the save help lists', () => {
  // Arrange
  const section = readPartialSection(readPackagedReadme())
  const help = chromeExtensionSaveHelp()
  const helpCodes = [
    ...help.codes.map((entry) => entry.code),
    'HISTORY_STILL_RECORDING',
  ]

  // Act
  const missing = helpCodes.filter(
    (code) => !section.includes(`| \`${code}\` |`),
  )

  // Assert
  assert.equal(section.length > 0, true)
  assert.deepEqual(missing, [])
  assert.equal(
    helpCodes.length,
    Object.keys(EXTENSION_HISTORY_REASON_CODES).length + 1,
  )
  assert.equal(
    help.refusals.some((entry) => entry.code === 'HISTORY_STILL_RECORDING'),
    true,
  )
})
