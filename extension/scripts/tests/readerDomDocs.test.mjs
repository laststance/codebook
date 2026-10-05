import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { runCommandsOf } from './utils/runCommandsOf.mjs'

// Review of Cycle 0045 (tests-1 #12): the earlier form looked for each fact in the workflow's raw text, so a command or a folder kept only in a comment or in a cache key passed as one the job runs.
test("the test execution guide gives the Reader DOM check's command and the playwright-cli release the CI job installs", async () => {
  // Arrange: the guide, and the two files the CI job takes the same facts from.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const job = await readFile(
    new URL('../../../.github/workflows/reader-dom.yml', import.meta.url),
    'utf8',
  )
  const pinnedTools = JSON.parse(
    await readFile(
      new URL('../../../.github/reader-dom/package.json', import.meta.url),
      'utf8',
    ),
  ).dependencies

  // Act: the section a developer reads before a local run, and what the job really runs and where (never its comments).
  const section =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n')) ?? ''
  const jobCommands = runCommandsOf(job)
  const jobFolders = job
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('working-directory: '))
    .map((line) => line.slice('working-directory: '.length))
  const commandsOfGuideAndJob = [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'npm ci --ignore-scripts',
    'playwright-cli install-browser ffmpeg',
  ].filter(
    (command) => section.includes(command) && jobCommands.includes(command),
  )
  const foldersOfGuideAndJob = ['.github/reader-dom'].filter(
    (folder) => section.includes(folder) && jobFolders.includes(folder),
  )

  // Assert: the guide's release is the one the job installs, and its commands and its tool folder are the job's.
  assert.deepEqual(pinnedTools, { '@playwright/cli': '0.1.22' })
  assert.ok(
    section.includes('`playwright-cli` 0.1.22'),
    'the guide does not name playwright-cli 0.1.22',
  )
  assert.deepEqual(commandsOfGuideAndJob, [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'npm ci --ignore-scripts',
    'playwright-cli install-browser ffmpeg',
  ])
  assert.deepEqual(foldersOfGuideAndJob, ['.github/reader-dom'])
  assert.ok(
    section.includes('no native acceptance credit'),
    'the guide no longer says that a green run is not native acceptance',
  )
})

// Value: protects=a developer who runs the Wiki reader's DOM check locally from the guide; fails_when=the guide's command, folder or session name for that check differs from what the CI job runs and the script names, or the guide stops saying that a green run is no native acceptance; why_new=Cycle 0046 row 70; seam=none
test("the test execution guide gives the Wiki reader DOM check's command as the CI job runs it, and the name of its browser session", async () => {
  // Arrange: the guide, the CI job and the check itself.
  const guide = await readFile(
    new URL('../../../docs/qa/test-execution.md', import.meta.url),
    'utf8',
  )
  const job = await readFile(
    new URL('../../../.github/workflows/reader-dom.yml', import.meta.url),
    'utf8',
  )
  const check = await readFile(
    new URL('../wiki-reader-dom-qa.mjs', import.meta.url),
    'utf8',
  )

  // Act: the paragraph of the section "Reader DOM check" that describes this check.
  const paragraph =
    guide
      .split(/^## /m)
      .find((part) => part.startsWith('Reader DOM check\n'))
      ?.split('\n\n')
      .find((part) => part.startsWith('**The Wiki reader’s page.**')) ?? ''
  const command =
    'node extension/scripts/wiki-reader-dom-qa.mjs verify artifacts/wiki-reader-dom'

  // Assert
  assert.ok(
    paragraph.includes(`\`${command}\``),
    'the guide does not give the command of the Wiki reader DOM check',
  )
  assert.ok(
    runCommandsOf(job).includes(command),
    'the CI job does not run the command the guide gives',
  )
  assert.ok(
    paragraph.includes('`cb-wiki-reader-<mode>`') &&
      check.includes('const session = `cb-wiki-reader-${mode}`'),
    'the guide and the check do not name the same browser session',
  )
  assert.ok(
    paragraph.includes('no native acceptance credit'),
    'the guide no longer says that a green run of this check is not native acceptance',
  )
})
