import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

/** The shell every newly published page is rendered from; tests run from `dist/tests`. */
const readShell = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'reader-shell.html'),
    'utf8',
  )

test('the published page groups the freshness label, the update button and an offline note in that order', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.ok(
    shell.includes(
      '<aside class="right-rail" aria-label="Article outline and Wiki status"><div data-codebook-update-group><p data-codebook-freshness data-status="unknown">Open from Codebook to check freshness</p><a class="wiki-update" href="{{UPDATE}}">Update LLM Wiki</a><p data-codebook-update-status>Offline copy. Update progress shows in the editor, or here when this Wiki is opened from Codebook.</p></div><nav aria-label="On this page">',
    ),
  )
})

test('the offline note of the published page claims no live status role', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.doesNotMatch(shell, /<p data-codebook-update-status[^>]*role=/)
})

test('the published page draws the group as a panel with a filled update button and bounds it in the narrow layout', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  for (const rule of [
    '.wiki-update{display:inline-block;border:1px solid var(--link);padding:.4rem .6rem;border-radius:5px;text-decoration:none;background:var(--link);color:var(--bg);font-weight:600}',
    '[data-codebook-update-group]{background:var(--panel-2);border:1px solid var(--border);border-radius:6px;padding:.6rem}',
    '[data-codebook-update-status]{font-size:.75rem;line-height:1.45;margin:.5rem 0 0;color:var(--muted);overflow-wrap:anywhere}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
  assert.match(
    shell,
    /@media\(max-width:1000px\)\{[^\n]*\[data-codebook-update-group\]\{flex:0 1 18rem;min-width:0;align-self:flex-start\}/,
  )
})

test('the published page animates nothing in the update group', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.doesNotMatch(shell, /@keyframes/)
  assert.doesNotMatch(
    shell,
    /(?:wiki-update|data-codebook-update[\w-]*\]?)[^{}]*\{[^}]*(?:animation|transition)/,
  )
})
