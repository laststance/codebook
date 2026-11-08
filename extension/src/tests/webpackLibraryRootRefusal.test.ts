import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { assertWebpackLibraryNeedsPackageRoot } from '../utils/assertWebpackLibraryNeedsPackageRoot'

/** Runs the check and returns what it threw, or `undefined`. */
function refusalOf(configuration: unknown): unknown {
  try {
    assertWebpackLibraryNeedsPackageRoot(configuration)
  } catch (error) {
    return error
  }
  return undefined
}

// Value: protects=a Next or react-scripts app at the repository root that declares library is refused with the documented LIBRARY_BUILD_UNSUPPORTED library-needs-package-root before the generic schema sentence; fails_when=the start reaches the schema, which answers "Only a study of format 16, 17 or 18 keeps a library" without the reason; no_claim=the service call order, which sits beside the Vite check before the parse
test('a root Next or react-scripts app with library is refused library-needs-package-root', () => {
  // Arrange
  const candidates = [
    { version: 3, adapter: 'next-dev-webpack', library: { packageRoot: '.' } },
    {
      version: 3,
      adapter: 'next-dev-webpack',
      packageRoot: '.',
      library: { packageRoot: '.' },
    },
    { version: 3, adapter: 'react-scripts-dev', library: { packageRoot: '.' } },
    {
      version: 3,
      adapter: 'react-scripts-dev',
      packageRoot: '.',
      library: { packageRoot: 'packages/lib' },
    },
  ]
  // Act
  const refusals = candidates.map(refusalOf)
  // Assert
  for (const refusal of refusals) {
    assert.ok(refusal instanceof StudyError, String(refusal))
    assert.equal(refusal.code, 'LIBRARY_BUILD_UNSUPPORTED')
    assert.equal(refusal.details?.reason, 'library-needs-package-root')
    assert.equal(refusal.details?.sideEffects, 'none')
  }
})

// Value: protects=a nested Example, a run without library and other adapters pass the check unchanged; fails_when=the check refuses a valid library run or claims vite-dev, whose own check answers INVALID_CONFIGURATION; no_claim=the schema's own refusals
test('a nested Example, a run without library and vite-dev pass the check', () => {
  // Arrange
  const candidates = [
    {
      version: 3,
      adapter: 'next-dev-webpack',
      packageRoot: 'examples/publish-ci/rr-rsc-context',
      library: { packageRoot: '.' },
    },
    { version: 3, adapter: 'next-dev-webpack', packageRoot: '.' },
    { version: 3, adapter: 'vite-dev', library: { packageRoot: '.' } },
    { version: 2, adapter: 'react-scripts-dev', library: { packageRoot: '.' } },
    'not an object',
  ]
  // Act
  const refusals = candidates.map(refusalOf)
  // Assert
  assert.deepEqual(refusals, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})
