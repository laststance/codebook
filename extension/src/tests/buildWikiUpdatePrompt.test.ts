import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildWikiUpdatePrompt } from '../utils/buildWikiUpdatePrompt'

test('the VS Code update request tells the agent what Codebook accepts as "Updated" and asks for the report the learner reads in the chat', () => {
  // Act
  const prompt = buildWikiUpdatePrompt({
    manifestPath: '/repo/.codebook/wiki/codebook-wiki.json',
    timeoutMs: 900_000,
    isReplyRead: true,
    hasGitRepository: true,
    uncoveredPaths: [],
  })

  // Assert
  assert.equal(
    prompt,
    '/codebook Update LLM Wiki for this opened repository. Read "/repo/.codebook/wiki/codebook-wiki.json" and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths. If you cannot publish, say why in your reply and stop. Then report changed pages and citations. Do not start a debugger or application.',
  )
})

test('the Cursor update request asks for no report, because nobody reads the CLI’s reply', () => {
  // Act
  const prompt = buildWikiUpdatePrompt({
    manifestPath: '/repo/docs/my wiki/codebook-wiki.json',
    timeoutMs: 600_000,
    isReplyRead: false,
    hasGitRepository: true,
    uncoveredPaths: [],
  })

  // Assert
  assert.equal(
    prompt,
    '/codebook Update LLM Wiki for this opened repository. Read "/repo/docs/my wiki/codebook-wiki.json" and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 10 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.',
  )
})

test('the update request names the added files the Wiki must index or exclude', () => {
  // Act
  const prompt = buildWikiUpdatePrompt({
    manifestPath: '/repo/.codebook/wiki/codebook-wiki.json',
    timeoutMs: 900_000,
    isReplyRead: false,
    hasGitRepository: true,
    uncoveredPaths: [
      'src/new-a.ts',
      'src/new-b.ts',
      'src/new-c.ts',
      'src/new-d.ts',
      'src/new-e.ts',
    ],
  })

  // Assert
  assert.equal(
    prompt,
    '/codebook Update LLM Wiki for this opened repository. Read "/repo/.codebook/wiki/codebook-wiki.json" and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths. Right now these added files are neither indexed nor excluded: src/new-a.ts, src/new-b.ts, src/new-c.ts and 2 more. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.',
  )
})

test('the update request for a folder without a Git repository asks for no revision and tells the agent not to create a repository', () => {
  // Act
  const prompt = buildWikiUpdatePrompt({
    manifestPath: '/notes/.codebook/wiki/codebook-wiki.json',
    timeoutMs: 900_000,
    isReplyRead: false,
    hasGitRepository: false,
    uncoveredPaths: [],
  })

  // Assert
  assert.equal(
    prompt,
    '/codebook Update LLM Wiki for this opened repository. Read "/notes/.codebook/wiki/codebook-wiki.json" and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.',
  )
})
