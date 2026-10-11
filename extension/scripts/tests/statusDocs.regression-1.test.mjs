import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Regression: Cycle 0046 task475 — the table introduction and final resume counts retained472/443 after rows473/474 closed.
// Found by /qa on 2026-10-11.
// Report: docs/cycles/0046-carried-defects-of-cycle-0045.md#retained-native28-motion-entry-2026-10-11
// Value: protects=accurate resume counts; fails_when=current totals omit added or closed tasks; why_new=statusDocs checks state/README but not these two summaries; seam=none; no_claim=native task completion.
test('Cycle 0046 resumes from totals that include every task and its current closure', async () => {
  // Arrange
  const table = await readFile(
    new URL('../../../docs/cycles/0046-carried-defects.md', import.meta.url),
    'utf8',
  )
  const cycle = await readFile(
    new URL(
      '../../../docs/cycles/0046-carried-defects-of-cycle-0045.md',
      import.meta.url,
    ),
    'utf8',
  )

  // Act: escaped pipes in prose never separate the six task cells.
  const rows = table.split('\n').filter((line) => /^\| \d+ \|/.test(line))
  const closed = rows.filter((row) =>
    /^(?:FIXED|EVIDENCE)/.test(
      row
        .split(/(?<!\\)\|/)
        .at(-2)
        .trim(),
    ),
  ).length
  const introduction =
    /^Totals: (\d+) rows \(46 at filing[^\n]*, (\d+) found[^\n]*CLOSED (\d+);/m.exec(
      table,
    )
  const resume = /Counts(\d+)\/(\d+) closed/.exec(
    cycle.split('## Result and next action').at(-1),
  )
  const mismatches = []
  const renderedRows = table
    .split('| --- | --- | --- | --- | --- | --- |')[1]
    ?.trimStart()
    .split('\n\n')[0]
    .split('\n')
    .filter((line) => /^\| \d+ \|/.test(line))
  // A blank before appended findings hides those tasks from the rendered table.
  if (renderedRows?.length !== rows.length)
    mismatches.push('rendered table omits tasks')
  // Missing summaries fail too, so deleting stale counts cannot make the check green.
  if (!introduction) mismatches.push('missing table introduction')
  else {
    if (Number(introduction[1]) !== rows.length)
      mismatches.push('table introduction omits tasks')
    if (Number(introduction[2]) !== rows.length - 46)
      mismatches.push('table introduction omits findings')
    if (Number(introduction[3]) !== closed)
      mismatches.push('table introduction omits closures')
  }
  if (!resume) mismatches.push('missing final resume totals')
  else {
    if (Number(resume[1]) !== rows.length)
      mismatches.push('final resume omits tasks')
    if (Number(resume[2]) !== closed)
      mismatches.push('final resume omits closures')
  }

  // Assert
  assert.deepEqual(mismatches, [])
})
