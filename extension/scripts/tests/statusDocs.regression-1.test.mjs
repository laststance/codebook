import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { readCurrentState } from './utils/currentState.mjs'

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

// Regression: Cycle 0046 task481 — the current replay action still asks to fix closed465 and verify closed26.
// Found by /qa on 2026-10-11.
// Report: docs/cycles/0046-carried-defects-of-cycle-0045.md#cursor-retained-motion-reentry-after-context-restoration-2026-10-11
// Cycle 0047 row 202 (S2OCR3-1): since the state moved into the active cycle record, the state is read with that cycle's own table, not Cycle 0046's, so a "Fix N" is judged against the rows it names.
// Value: protects=actionable current replay gaps; fails_when=the next action asks to fix a defect the active cycle's table has closed; why_new=count checks do not inspect gap actions; seam=none; no_claim=native replay completion.
test("the current replay action never asks to repair a defect the active cycle's table has closed", async () => {
  // Arrange: the current state is a section of the active cycle record (no state file since 2026-10-19), and its "Fix N" names that cycle's rows.
  const { cycle, state } = await readCurrentState()
  const table = await readFile(
    new URL(
      `../../../docs/cycles/${cycle}-carried-defects.md`,
      import.meta.url,
    ),
    'utf8',
  ).catch(() => '')

  // Act: the final cell owns current closure, and the gap row's final cell owns its next action.
  const taskRows = table.split('\n').filter((line) => /^\| \d+ \|/.test(line))
  const closedTaskIds = taskRows
    .filter((row) =>
      /^(?:FIXED|EVIDENCE)/.test(
        row
          .split(/(?<!\\)\|/)
          .at(-2)
          .trim(),
      ),
    )
    .map((row) => row.split(/(?<!\\)\|/)[1].trim())
  const nextAction = state
    .split('\n')
    .find((line) => line.startsWith('| AC-REPLAY |'))
    ?.split(/(?<!\\)\|/)
    .at(-2)
  assert.ok(nextAction, 'the current replay gap must keep its next action')
  const requestedRepairs = [...nextAction.matchAll(/\bFix\s*(\d+)(?:'s|\b)/g)]
    .map((match) => match[1])
    .filter((taskId) => closedTaskIds.includes(taskId))

  // Assert
  assert.deepEqual(requestedRepairs, [])
})
