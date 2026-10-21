import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(
  new URL('./restore-product-context.mjs', import.meta.url),
)
const compactEvent = JSON.stringify({
  hook_event_name: 'SessionStart',
  source: 'compact',
})

/** Reads one `## ` section of an AGENTS.md text the way a reader sees it: heading to the next `## ` heading. */
function agentsSection(text, heading) {
  const lines = text.split('\n')
  const start = lines.indexOf(heading)
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  )
  return lines.slice(start, next).join('\n').trimEnd()
}

/** Runs a copy of the hook beside a temporary AGENTS.md, as the repository layout places them. */
function runHookBeside(agentsText) {
  const directory = mkdtempSync(join(tmpdir(), 'codebook-restore-'))
  try {
    mkdirSync(join(directory, '.codex'))
    copyFileSync(
      script,
      join(directory, '.codex', 'restore-product-context.mjs'),
    )
    writeFileSync(join(directory, 'AGENTS.md'), agentsText)
    return spawnSync(
      process.execPath,
      [join(directory, '.codex', 'restore-product-context.mjs')],
      { input: compactEvent, encoding: 'utf8' },
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// Value: protects=the owner's 2026-10-21 rule reaching the agent whole after every compaction (PRODUCT_GOAL.md in full and the PNG, then the Issue and AGENTS.md); fails_when=the hook prints all of AGENTS.md (Claude Code then injects only a 2,000-character preview), the rule leaves the first 2,000 characters, or a restored section differs from AGENTS.md; no_claim=that the agent actually performs the reads
test('compaction restores the re-entry rule and the Mandatory entry and Owner directions sections within the inline limit', () => {
  // Arrange
  const config = JSON.parse(
    readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'),
  )
  const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
  // Act
  const result = spawnSync(
    '/bin/sh',
    ['-c', config.hooks.SessionStart[0].hooks[0].command],
    {
      cwd: new URL('../extension', import.meta.url),
      input: compactEvent,
      encoding: 'utf8',
    },
  )
  const output = JSON.parse(result.stdout)
  const context = output.hookSpecificOutput.additionalContext
  // Assert
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(context.includes(root))
  assert.ok(
    context.length <= 10_000,
    `context has ${context.length} characters`,
  )
  assert.ok(
    context.indexOf(
      'read PRODUCT_GOAL.md in full, every line, and open the approved PNG',
    ) < 2_000,
  )
  assert.ok(context.includes(agentsSection(agents, '## Mandatory entry')))
  assert.ok(
    context.includes(agentsSection(agents, '## Owner directions in force')),
  )
  assert.match(
    context,
    /Preserve pending owner instructions and any explicit pause/,
  )
  assert.equal(output.continue, undefined)
  assert.equal(output.decision, undefined)
})

// Value: protects=the rule surviving a grown AGENTS.md; fails_when=sections longer than the inline limit are printed anyway (the preview would cut the context) or the hook fails instead of restoring the rule; no_claim=the wording of the restored sections
test('an AGENTS.md whose restored sections outgrow the limit still restores the rule and points to the file', () => {
  // Arrange
  const oversized = [
    '# codebook agent instructions',
    '',
    '## Mandatory entry',
    '',
    'Read the goal.\n'.repeat(400),
    '## Owner directions in force',
    '',
    'Keep the owner scope.\n'.repeat(400),
    '## Native QA',
    '',
    'Record windows.',
    '',
  ].join('\n')
  // Act
  const result = runHookBeside(oversized)
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
  // Assert
  assert.equal(result.status, 0)
  assert.ok(
    context.length <= 10_000,
    `context has ${context.length} characters`,
  )
  assert.match(
    context,
    /read PRODUCT_GOAL\.md in full, every line, and open the approved PNG/,
  )
  assert.match(
    context,
    /Mandatory entry and Owner directions in force sections exceed this reminder's 10000-character limit; read them in AGENTS\.md on disk now\./,
  )
  assert.ok(!context.includes('Read the goal.\nRead the goal.'))
})

// Value: protects=a renamed or removed section being noticed; fails_when=the hook restores a context without the Owner directions section; no_claim=which sections AGENTS.md should have
test('an AGENTS.md without the Owner directions section reports failure without inventing restored context', () => {
  // Arrange
  const withoutDirections =
    '# codebook agent instructions\n\n## Mandatory entry\n\nRead the goal.\n'
  // Act
  const result = runHookBeside(withoutDirections)
  // Assert
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(
    result.stderr,
    /AGENTS\.md is missing its Owner directions in force section\./,
  )
})

test('startup, resume and other events do not add compaction instructions', () => {
  // Arrange
  const events = [
    { hook_event_name: 'SessionStart', source: 'startup' },
    { hook_event_name: 'SessionStart', source: 'resume' },
    { hook_event_name: 'PostCompact', source: 'compact' },
  ]
  for (const event of events) {
    // Act
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify(event),
      encoding: 'utf8',
    })
    // Assert
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('malformed hook input reports failure without inventing restored context', () => {
  // Arrange / Act
  const result = spawnSync(process.execPath, [script], {
    input: '{',
    encoding: 'utf8',
  })
  // Assert
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Codebook context restoration failed/)
})

test('the repository registers only compaction restoration through a root-resolved command', () => {
  // Arrange / Act
  const config = JSON.parse(
    readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'),
  )
  // Assert
  assert.deepEqual(Object.keys(config.hooks), ['SessionStart'])
  assert.equal(config.hooks.SessionStart.length, 1)
  assert.equal(config.hooks.SessionStart[0].matcher, '^compact$')
  assert.equal(
    config.hooks.SessionStart[0].hooks[0].command,
    'node "$(git rev-parse --show-toplevel)/.codex/restore-product-context.mjs"',
  )
  assert.equal(config.hooks.SessionStart[0].hooks[0].timeout, 5)
})
