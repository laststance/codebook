import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appResolvedPathsOf } from '../utils/appResolvedPathsOf'
import { libraryMapOverrides } from '../utils/libraryMapOverrides'

const MODERN = {
  builtPath: 'packages/lib/build/modern/core.js',
  builtSha256: 'a'.repeat(64),
  mapSha256: 'b'.repeat(64),
  mapSource: '../../src/core.ts',
}

// protects=AC 1 the path Next writes for a library stop file is the build map's relative entry resolved against the app's package root, once per package root spelling; fails_when=the entry is resolved against the map's folder, or a real path that equals the lexical one is listed twice; no_claim=a real Next compile (E1 measured the rule)
test('the app-resolved path of a build flavour is its map entry resolved against the package root, in each distinct spelling', () => {
  // Arrange
  const roots = ['/var/repo/examples/app', '/private/var/repo/examples/app']
  // Act
  const differing = appResolvedPathsOf(roots, [MODERN])
  const same = appResolvedPathsOf(
    ['/repo/examples/app', '/repo/examples/app'],
    [MODERN],
  )
  // Assert
  assert.deepEqual(differing, {
    'packages/lib/build/modern/core.js': [
      '/var/repo/src/core.ts',
      '/private/var/repo/src/core.ts',
    ],
  })
  assert.deepEqual(same, {
    'packages/lib/build/modern/core.js': ['/repo/src/core.ts'],
  })
})

// protects=AC 1 (D20) the override entries are exact keys, one per app-resolved path, and a path with a wildcard character is left out; fails_when=a wildcard key is built from a library path or a path is missing; no_claim=js-debug's own use of the entries (native check) and the adapter's launch fields (the pause test in libraryAppRouterBrowserStop.test.ts reads them)
test('the override entries are one exact key per app-resolved path and never a wildcard', () => {
  // Arrange
  const entries = [
    {
      appResolvedPaths: ['/repo/src/core.ts', '/private/repo/src/core.ts'],
      checkedOutFile: '/repo/packages/lib/src/core.ts',
    },
    {
      appResolvedPaths: ['/repo/src/*.ts'],
      checkedOutFile: '/repo/packages/lib/src/other.ts',
    },
  ]
  // Act
  const overrides = libraryMapOverrides(entries)
  // Assert
  assert.deepEqual(overrides, {
    '/repo/src/core.ts': '/repo/packages/lib/src/core.ts',
    '/private/repo/src/core.ts': '/repo/packages/lib/src/core.ts',
  })
})
