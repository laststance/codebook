import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiFreshness } from '../utils/describeWikiFreshness'

import { openFakeWikiPage } from './utils/fakeWikiPage'
import { readServedWikiScript } from './utils/readServedWikiScript'

// Value: protects=AC 2 (row 1's description) and the shared freshness wording of the page and the LLM Wiki view; fails_when=a status gets another label than the reader page shows for it, or a current Wiki without a Git revision loses its note; no_claim=the page's own timing of the check; seam=the pure function
test('describeWikiFreshness words a current, a changed and an undecided Wiki as the reader page does', () => {
  // Arrange
  const reasonLimit = 160

  // Act
  const labels = {
    current: describeWikiFreshness('current', '', false, reasonLimit),
    currentWithoutGit: describeWikiFreshness('current', '', true, reasonLimit),
    changed: describeWikiFreshness('changed', '', false, reasonLimit),
    unknownWithoutReason: describeWikiFreshness(
      'unknown',
      '',
      false,
      reasonLimit,
    ),
    unknownWithReason: describeWikiFreshness(
      'unknown',
      'The manifest is unreadable.',
      false,
      reasonLimit,
    ),
    unanswered: describeWikiFreshness(undefined, '', false, reasonLimit),
  }

  // Assert
  assert.deepEqual(labels, {
    current: 'Wiki source current',
    currentWithoutGit:
      'Wiki source current (no Git revision recorded, so added files are not checked)',
    changed: 'Source changed · Update available',
    unknownWithoutReason: 'Wiki freshness unknown',
    unknownWithReason: 'Wiki freshness unknown: The manifest is unreadable.',
    unanswered: 'Wiki freshness unknown',
  })
})

// Value: protects=the rail's narrow width; fails_when=a long reason is not cut at a space before the limit; no_claim=the tooltip that keeps the whole reason; seam=the pure function
test('describeWikiFreshness cuts a reason longer than the limit at the last space before it', () => {
  // Arrange
  const reason =
    'An indexed source could not be checked: packages/dashboard/a.ts'

  // Act
  const label = describeWikiFreshness('unknown', reason, false, 45)

  // Assert
  assert.equal(
    label,
    'Wiki freshness unknown: An indexed source could not be checked:…',
  )
})

// Value: protects=Eng decision 86, the page installer is serialized with toString() and cannot import the shared function; fails_when=the emitted page script does not carry the shared wording, so the page's label for current, changed or unknown differs from the function's; no_claim=the freshness check itself; seam=the served page script run in the fake page
test('the emitted page script labels a current, a changed and an unknown Wiki with the shared wording', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const labels = []
  for (const [freshness, freshnessDetail] of [
    ['current', {}],
    ['changed', {}],
    ['unknown', { reason: 'The manifest is unreadable.' }],
  ] as const) {
    const page = await openFakeWikiPage(script, 'current-shell', {
      freshness,
      freshnessDetail,
    })
    labels.push(page.find('[data-codebook-freshness]')?.textContent)
  }

  // Assert
  assert.deepEqual(labels, [
    'Wiki source current',
    'Source changed · Update available',
    'Wiki freshness unknown: The manifest is unreadable.',
  ])
})
