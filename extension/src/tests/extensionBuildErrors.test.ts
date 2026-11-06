import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromeExtensionHelp } from '../chromeExtensionHelp'
import { ERROR_RECOVERY } from '../errors'

/** Each refusal reason with the words its recovery must carry, from the Cycle 0092 plan's "Recovery text per reason". */
const RECOVERY_BY_REASON: readonly {
  code: 'EXTENSION_BUILD_UNSUPPORTED' | 'EXTENSION_BUILD_FAILED'
  reason: string
  words: readonly string[]
}[] = [
  {
    code: 'EXTENSION_BUILD_UNSUPPORTED',
    reason: 'no-wxt-config',
    words: ['no-wxt-config:', 'wxtProjects'],
  },
  {
    code: 'EXTENSION_BUILD_UNSUPPORTED',
    reason: 'wxt-not-installed',
    words: ['wxt-not-installed:', 'Codebook never installs packages'],
  },
  {
    code: 'EXTENSION_BUILD_UNSUPPORTED',
    reason: 'wxt-version',
    words: ['wxt-version:', 'WXT 0.21 only', 'details.version'],
  },
  {
    code: 'EXTENSION_BUILD_UNSUPPORTED',
    reason: 'wxt-dir-tracked',
    words: ['wxt-dir-tracked:', 'tracked by Git'],
  },
  {
    code: 'EXTENSION_BUILD_UNSUPPORTED',
    reason: 'node-version',
    words: ['node-version:', 'Node 24 or later', 'details.nodeVersion'],
  },
  {
    code: 'EXTENSION_BUILD_UNSUPPORTED',
    reason: 'stop-outside-project',
    words: ['stop-outside-project:', 'outside node_modules'],
  },
  {
    code: 'EXTENSION_BUILD_FAILED',
    reason: 'build-error',
    words: ['build-error:', 'masked lines', 'exit code or signal'],
  },
  {
    code: 'EXTENSION_BUILD_FAILED',
    reason: 'timeout',
    words: ['timeout:', '120 seconds', 'retry once'],
  },
  {
    code: 'EXTENSION_BUILD_FAILED',
    reason: 'tracked-file-changed',
    words: ['tracked-file-changed:', 'details.path', 'do not retry'],
  },
  {
    code: 'EXTENSION_BUILD_FAILED',
    reason: 'no-output',
    words: ['no-output:', 'Chrome build in the output folder'],
  },
  {
    code: 'EXTENSION_BUILD_FAILED',
    reason: 'tracked-files-unverified',
    words: ['tracked-files-unverified:', 'git status'],
  },
]

// protects=every EXTENSION_BUILD_UNSUPPORTED and EXTENSION_BUILD_FAILED reason has its agent-ready recovery words and the help anchor; fails_when=a reason loses its recovery sentence, its key words drift or the anchor is wrong; no_claim=the run raises these codes (a later lane) or that the sentences read well
test('the build refusal recoveries carry the words and the help anchor of every reason', () => {
  for (const { code, reason, words } of RECOVERY_BY_REASON) {
    // Arrange
    const recovery = ERROR_RECOVERY[code]
    // Act, Assert
    for (const word of words)
      assert.equal(
        recovery.includes(word),
        true,
        `${code} (${reason}) lacks "${word}"`,
      )
    assert.equal(
      recovery.endsWith(`See codebook://help/chrome-extension#${code}.`),
      true,
    )
  }
})

// protects=the help's code table lists both build codes with a when-sentence of their own and the registered recovery; fails_when=a code is missing from the table or falls back to see-the-recovery; no_claim=the wxt-build help section (a later lane)
test('the chrome-extension help lists both build codes with their own facts', () => {
  // Arrange
  const { codes } = chromeExtensionHelp()
  // Act
  const entries = ['EXTENSION_BUILD_UNSUPPORTED', 'EXTENSION_BUILD_FAILED'].map(
    (code) => codes.find((candidate) => candidate.code === code),
  )
  // Assert
  for (const entry of entries) {
    assert.notEqual(entry, undefined)
    assert.notEqual(entry?.when, 'see the recovery')
    assert.notEqual(entry?.sentence, '')
  }
  assert.equal(entries[0]?.recovery, ERROR_RECOVERY.EXTENSION_BUILD_UNSUPPORTED)
  assert.equal(entries[1]?.recovery, ERROR_RECOVERY.EXTENSION_BUILD_FAILED)
})
