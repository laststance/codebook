import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dropDefaultPackageRoot,
  operationsRepositoryConfigSchema,
} from '../repositoryConfigSchemas'

/** A valid version 3 configuration; the caller adds or changes fields. */
function configuration(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'next-dev-webpack',
    book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    source: {
      path: 'examples/react/nextjs/src/pages/index.tsx',
      hash: 'a'.repeat(64),
      line: 19,
      column: 5,
    },
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#toggle' }],
    after: [{ kind: 'text', selector: '#label', equals: 'Dark' }],
    operations: [{ kind: 'click', title: 'Toggle', selector: '#toggle' }],
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
    ...extra,
  }
}

// protects=R17/R18: packageRoot is optional and absent keeps today's parsed shape; fails_when=the field is defaulted so parsed configurations gain a key; no_claim=saved study formats
test('a version 3 configuration without packageRoot parses without gaining the field', () => {
  // Arrange
  const input = configuration()
  // Act
  const parsed = operationsRepositoryConfigSchema.parse(input)
  // Assert
  assert.equal('packageRoot' in parsed, false)
})

// protects=R17: a repository-relative folder at any depth is accepted for next-dev-webpack; fails_when=depth is limited or the field is stripped; no_claim=the folder exists
test('a version 3 next-dev-webpack configuration accepts a nested packageRoot', () => {
  // Arrange
  const input = configuration({ packageRoot: 'examples/react/nextjs' })
  // Act
  const parsed = operationsRepositoryConfigSchema.parse(input)
  // Assert
  assert.equal(parsed.packageRoot, 'examples/react/nextjs')
})

// protects=E10: absent and "." are one configuration for the idempotency key; fails_when=a "." key survives the canonical drop; no_claim=real-path canonicalization of nested values
test('dropDefaultPackageRoot removes "." and keeps a nested value', () => {
  // Arrange
  const dot = operationsRepositoryConfigSchema.parse(
    configuration({ packageRoot: '.' }),
  )
  const nested = operationsRepositoryConfigSchema.parse(
    configuration({ packageRoot: 'apps/web' }),
  )
  // Act
  const canonicalDot = dropDefaultPackageRoot(dot)
  const canonicalNested = dropDefaultPackageRoot(nested)
  // Assert
  assert.equal('packageRoot' in canonicalDot, false)
  assert.equal(JSON.stringify(canonicalDot), JSON.stringify(configuration()))
  assert.equal(canonicalNested.packageRoot, 'apps/web')
})

// protects=DX-18/AC 7: vite-dev with a nested packageRoot is refused at the schema and tells the chat to remove it; fails_when=the refinement is missing or "." is refused too; no_claim=Vite apps below the root
test('vite-dev refuses a nested packageRoot and accepts "."', () => {
  // Arrange
  const nested = configuration({ adapter: 'vite-dev', packageRoot: 'apps/web' })
  const dot = configuration({ adapter: 'vite-dev', packageRoot: '.' })
  // Act
  const refused = operationsRepositoryConfigSchema.safeParse(nested)
  const accepted = operationsRepositoryConfigSchema.safeParse(dot)
  // Assert
  assert.equal(refused.success, false)
  assert.match(
    refused.error?.issues[0]?.message ?? '',
    /remove packageRoot.*next-dev-webpack/,
  )
  assert.deepEqual(refused.error?.issues[0]?.path, ['packageRoot'])
  assert.equal(accepted.success, true)
})
