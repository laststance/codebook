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
