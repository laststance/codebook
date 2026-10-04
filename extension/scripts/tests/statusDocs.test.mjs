import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

/**
 * Reads a document of the repository by its path from the repository root, so every test of this file names its documents the way a reader does.
 * @param {string} path - The path from the repository root, for example `README.md`.
 * @returns {Promise<string>} The document's text.
 * @example
 * const readme = await readDocument('README.md')
 */
const readDocument = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')

/**
 * Lists what a status document still takes from the retired decision log (`DECISIONS.md`, removed in `c549da6`): its numbers D001 to D047 and links to a copy of the file. The goal, its contracts and the closed cycle records keep those numbers and are not given to it.
 * @param {string} text - The document's text.
 * @returns {string[]} Every number and every file name found, in the order they stand; empty when the document cites none.
 * @example
 * retiredLogCitations('resumed on a Windows host (D047), see DECISIONS.md') // => ['D047', 'DECISIONS.md']
 */
const retiredLogCitations = (text) =>
  text.match(/\bD0[0-4]\d\b|DECISIONS\.md/g) ?? []

/**
 * Returns the first paragraph under README's "Implementation status" heading: the one a reader takes as the current state.
 * @param {string} readme - The root README's text.
 * @returns {string} The paragraph, or an empty string when the heading is gone.
 * @example
 * statusParagraph('## Implementation status\n\nA private preview.\n\nMore.') // => 'A private preview.'
 */
const statusParagraph = (readme) =>
  readme
    .split(/^## /m)
    .find((part) => part.startsWith('Implementation status\n'))
    ?.split('\n\n')[1] ?? ''

// Cycle 0045 (DOC-3, DX-21): red while README cited "(D047)" and "(D044)", the packaged README "D034", and README's status ended at Cycle 0043 and 0.2.27.
test("README and the packaged README cite no number of the retired decision log, and README's status names the delivered version", async () => {
  // Arrange
  const readme = await readDocument('README.md')
  const packagedReadme = await readDocument('extension/README.md')
  // The version file is the one `/ship` raises with a delivery, so the status must be rewritten in the same step.
  const deliveredVersion = (await readDocument('VERSION')).trim()

  // Act
  const citations = {
    'README.md': retiredLogCitations(readme),
    'extension/README.md': retiredLogCitations(packagedReadme),
  }
  const status = statusParagraph(readme)

  // Assert
  assert.deepEqual(citations, { 'README.md': [], 'extension/README.md': [] })
  assert.equal(
    status.includes(`The delivered version is **${deliveredVersion}**`),
    true,
    `the status does not say "The delivered version is **${deliveredVersion}**" (the version in VERSION)`,
  )
})

// Cycle 0045 (DOC-3, DX-21): red while PROJECT_STATE linked a pinned copy of the retired log and named its directions by number; each direction is stated there in words instead.
test('PROJECT_STATE cites no number of the retired decision log and links no copy of it', async () => {
  // Arrange
  const projectState = await readDocument('PROJECT_STATE.md')

  // Act
  const citations = retiredLogCitations(projectState)

  // Assert
  assert.deepEqual(citations, [])
})

// Cycle 0045 (CR-1): red while the status paragraph retold every cycle from 0028 to 0043 (sixteen linked records) instead of leaving that history to the records and the change history.
test("README's implementation status states the delivered and the open cycle and leaves the history of earlier cycles to their records and the change history", async () => {
  // Arrange
  const readme = await readDocument('README.md')

  // Act
  const status = statusParagraph(readme)
  const linkedCycleRecords = [
    ...status.matchAll(/\]\(docs\/cycles\/(\d{4})-[^)]*\)/g),
  ].map((match) => match[1])
  const pointsToHistory = [
    '[change history](CHANGELOG.md)',
    '[`docs/cycles`](docs/cycles)',
    '[PROJECT_STATE.md](PROJECT_STATE.md)',
  ].map((link) => status.includes(link))

  // Assert: at most the delivered cycle's record and the open cycle's, and nothing older.
  assert.equal(
    linkedCycleRecords.length <= 2,
    true,
    `the status links the records of ${linkedCycleRecords.length} cycles: ${linkedCycleRecords.join(', ')}`,
  )
  assert.deepEqual(pointsToHistory, [true, true, true])
})

// Cycle 0045 (test count): red while the guide said "the 193 package and script tests", a count every package of a cycle changes (201 on the merged tree).
test("the test execution guide names the package job's own work without a count of the package and script tests", async () => {
  // Arrange
  const guide = await readDocument('docs/qa/test-execution.md')

  // Act
  const namesWork = guide.includes(
    'It keeps its own work: the compaction-hook test, the compiler build, the emit comparison, the package and script tests (`pnpm --dir extension test:package`) and the VSIX.',
  )
  const countedTests = guide.match(/\d+ package and script tests/g) ?? []

  // Assert
  assert.equal(namesWork, true)
  assert.deepEqual(countedTests, [])
})
