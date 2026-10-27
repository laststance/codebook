import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

/** The sections of the packaged README that a product message sends the learner to: the refusal of a damaged installation (`INSTALL_AGAIN_THEN_SET_UP_AGAIN` in `cursorSkillDeployment.ts`) and the repository help's tutorial (`resources.ts`). */
const README_SECTIONS_PRODUCT_MESSAGES_NAME = [
  'Install the private VSIX',
  'Learn this repository',
]

// Value: protects=a learner whom a refusal sends to "README, Install the private VSIX", or the repository help to "README, section Learn this repository", and who finds that section in the packaged README; fails_when=either heading is renamed or removed in extension/README.md; no_claim=the sections' content, other links, and a product message that names a README section later
test('every README section that a product message names is a heading of the packaged README', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')

  // Act
  const headings = readme
    .split('\n')
    .filter((line) => /^#{2,3} /.test(line))
    .map((line) => line.replace(/^#{2,3} /, ''))

  // Assert
  assert.deepEqual(
    README_SECTIONS_PRODUCT_MESSAGES_NAME.filter(
      (name) => !headings.includes(name),
    ),
    [],
  )
})

// Value: protects=an agent or learner who reads the packaged README's error table for EVIDENCE_UNAVAILABLE and learns that a refused test-run continuation leaves the run paused, as the published recovery (codebook://help/errors) says; fails_when=the README's row is reworded or dropped while errors.ts keeps the paused-run advice, so the two copies of the contract disagree; why_new=pt3 /ship review pass 2 (API contract): the README is the one copy of this advice no test held; seam=none (the packaged README is read from disk); no_claim=the wording of the other rows
test('the packaged README tells that a continuation refused for an unreadable required fact leaves the test run paused', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')

  // Act
  const tellsPausedRun = readme.includes(
    'A `codebook_continue` refused because the debugger could not read a required fact leaves the test run paused at that stop: read `nodeTest.stops` and the current `participants.server.continueArguments`, then continue with those arguments without the fact, or stop the run.',
  )

  // Assert
  assert.equal(tellsPausedRun, true)
})

// Value: protects=the packaged README stating the one request time limit that can fire and the run deadline that ends a waiting request (Cycle 0057 item 10); fails_when=the README names a 15-minute request limit again or drops the 30 s running-time limit or the RUNTIME_FAILED end at the 10-minute deadline; no_claim=the rest of the section
test('the README states the 30 s running-time request limit and the 10-minute run deadline without a 15-minute request limit', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')

  // Act
  const reports = readme
    .split('\n')
    .find((line) => line.startsWith('- **What the run reports.**'))

  // Assert
  assert.ok(reports)
  assert.ok(
    reports.includes(
      'within 30 s of running time (paused time excluded), ends the request with `REQUEST_FAILED` or `REQUEST_TIMEOUT`',
    ),
  )
  assert.ok(
    reports.includes(
      "a run whose request still waits at the run's 10-minute deadline ends with `RUNTIME_FAILED`",
    ),
  )
  assert.ok(!reports.includes('15 minutes'))
})
