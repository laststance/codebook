import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dropDefaultPackageRoot,
  liveRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
} from '../repositoryConfigSchemas'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

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

// protects=AC 1 (Cycle 0077): a version 3 vite-dev configuration may declare a nested packageRoot and keeps "." as the root run; fails_when=the schema still refuses packageRoot under vite-dev or strips it; no_claim=that the folder exists or is a Vite app (the resolver's refusals)
test('a version 3 vite-dev configuration accepts a nested packageRoot and "."', () => {
  // Arrange
  const nested = configuration({
    adapter: 'vite-dev',
    packageRoot: 'examples/react/basic',
  })
  const dot = configuration({ adapter: 'vite-dev', packageRoot: '.' })
  // Act
  const accepted = operationsRepositoryConfigSchema.safeParse(nested)
  const root = operationsRepositoryConfigSchema.safeParse(dot)
  // Assert
  assert.equal(accepted.success, true)
  assert.equal(accepted.data?.packageRoot, 'examples/react/basic')
  assert.equal(root.success, true)
})

// protects=AC 3 (Cycle 0077): a version 1 or 2 vite-dev configuration with packageRoot is still refused (the field exists only in version 3); fails_when=version 1 or 2 starts accepting packageRoot after the version 3 gate was lifted; no_claim=the refusal wording a client reads (an unknown key of the strict shape)
test('a version 1 or 2 vite-dev configuration with packageRoot is refused', () => {
  // Arrange
  const reference = createConfiguredStudy().configuration
  const versionOne = {
    ...reference,
    adapter: 'vite-dev',
    packageRoot: 'apps/web',
  }
  const versionTwo = {
    ...reference,
    version: 2,
    adapter: 'vite-dev',
    participant: 'browser',
    packageRoot: 'apps/web',
  }
  // Act
  const results = [versionOne, versionTwo].map((input) =>
    liveRepositoryConfigSchema.safeParse(input),
  )
  const withoutField = liveRepositoryConfigSchema.safeParse({
    ...reference,
    adapter: 'vite-dev',
  })
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false],
  )
  assert.equal(withoutField.success, true)
})
