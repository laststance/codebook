import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildWikiUpdatePrompt } from '../utils/buildWikiUpdatePrompt'

test('the VS Code update request tells the agent what Codebook accepts as "Updated" and asks for the report the learner reads in the chat', () => {
  // Act
  const prompt = buildWikiUpdatePrompt({
    manifestPath: '/repo/.codebook/wiki/codebook-wiki.json',
    timeoutMs: 900_000,
    isReplyRead: true,
  })

  // Assert
  assert.equal(
    prompt,
    '/codebook Update LLM Wiki for this opened repository. Read "/repo/.codebook/wiki/codebook-wiki.json" and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, and generated.revision is the full commit hash of HEAD. If you cannot publish, say why in your reply and stop. Then report changed pages and citations. Do not start a debugger or application.',
  )
})

test('the Cursor update request asks for no report, because nobody reads the CLI’s reply', () => {
  // Act
  const prompt = buildWikiUpdatePrompt({
    manifestPath: '/repo/docs/my wiki/codebook-wiki.json',
    timeoutMs: 600_000,
    isReplyRead: false,
  })

  // Assert
  assert.equal(
    prompt,
    '/codebook Update LLM Wiki for this opened repository. Read "/repo/docs/my wiki/codebook-wiki.json" and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 10 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, and generated.revision is the full commit hash of HEAD. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.',
  )
})
