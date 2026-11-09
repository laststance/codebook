import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { staticPageHelp } from '../staticPageHelp'

// Value: protects=README and help tell a chat that a page with more than 16 same-origin scripts is not ready and that an import inside a comment or string is not an import; fails_when=either sentence is dropped from one of the two; no_claim=that the code enforces them
test('README and help state the 16-script readiness cap and that commented imports are ignored', async () => {
  // Arrange
  const readme = await readFile(
    join(__dirname, '..', '..', 'README.md'),
    'utf8',
  )
  const help = JSON.stringify(staticPageHelp())
  // Act
  const missingFromReadme = [
    'A page that names more than 16 same-origin scripts is listed not ready with `needs-bundler`',
    'inside a comment or a string is not an import',
    'a page whose same-origin script cannot be read within the 1 MiB size limit',
  ].filter((phrase) => !readme.includes(phrase))
  const missingFromHelp = [
    'A page that names more than 16 same-origin scripts is listed not ready with needs-bundler',
    'scripts-not-all-judged',
    'inside a comment or a string is not an import',
    'a page whose same-origin script cannot be read within the 1 MiB size limit is listed not ready',
  ].filter((phrase) => !help.includes(phrase))
  // Assert
  assert.deepEqual(missingFromReadme, [])
  assert.deepEqual(missingFromHelp, [])
})
