import assert from 'node:assert/strict'
import { test } from 'node:test'

import { repositoryHtml } from '../ui/repositoryHtml'

// Value: protects=the first error of the Repository Wiki pane (a storage failure, a refused article) being announced: its status region is in the page, rendered and empty, before that error, and the shared rules give the empty region no room; fails_when=the pane's own stylesheet hides #errors while it is empty again (`#errors:empty{display:none}` beats the shared `[role=status]:empty` rule), so the region enters the page together with its first error and a screen reader says nothing; why_new=D1 (Cycle 0046 row 63's pattern, in the Repository pane); seam=none; no_claim=what a browser renders (the Repository pane's DOM check reads that in CI)
test('the Repository Wiki pane keeps its empty error status region rendered by no rule of its own, so the first error changes a region that is already there', () => {
  // Act
  const html = repositoryHtml()
  const rulesOfTheErrorRegion = html.match(/#errors[^{<]*\{[^}]*\}/g)

  // Assert
  assert.equal(
    html.includes(
      '<p id="errors" class="error" role="status" aria-live="polite"></p>',
    ),
    true,
  )
  assert.equal(
    html.includes(
      '.error:empty:not([role=status]){display:none}[role=status]:empty{margin:0;padding:0;border:0}',
    ),
    true,
  )
  assert.deepEqual(rulesOfTheErrorRegion, null)
})
