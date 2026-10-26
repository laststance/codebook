import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiGeneration } from '../utils/describeWikiGeneration'

const revision = '1936e41913729663cc99081e3224db89bb2d8e56'
const formatDate = (): string => 'Oct 26, 2026'

// Value: protects=AC 10 (accepted X1), the four tooltip forms; fails_when=a form names the wrong parts, a branch name counts as a revision, or a Wiki with neither shows a line; no_claim=the date's locale; seam=the pure function
test('describeWikiGeneration words the four forms of a Wiki’s generation', () => {
  // Arrange
  const date = 1_790_000_000_000

  // Act
  const forms = [
    describeWikiGeneration({ revision, publishedAtMs: date }, formatDate),
    describeWikiGeneration({ publishedAtMs: date }, formatDate),
    describeWikiGeneration(
      { revision: 'main', publishedAtMs: date },
      formatDate,
    ),
    describeWikiGeneration({ revision }, formatDate),
    describeWikiGeneration({}, formatDate),
  ]

  // Assert
  assert.deepEqual(forms, [
    'Generated from 1936e41 on Oct 26, 2026',
    'Generated on Oct 26, 2026 (no Git revision)',
    'Generated on Oct 26, 2026 (no Git revision)',
    'Generated from 1936e41',
    undefined,
  ])
})
