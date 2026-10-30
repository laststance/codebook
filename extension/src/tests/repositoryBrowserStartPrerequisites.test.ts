import assert from 'node:assert/strict'
import { test } from 'node:test'

import { repositoryBrowserStartPrerequisites } from '../utils/repositoryBrowserStartPrerequisites'

/** A window report whose repository-browser profile is ready for Next but not for Vite. */
const NEXT_ONLY_REPORT = {
  ready: true,
  missing: [],
  profiles: {
    'repository-browser': {
      ready: true,
      missing: [],
      adapters: {
        'next-dev-webpack': { ready: true, missing: [] },
        'vite-dev': { ready: false, missing: ['vite is not installed.'] },
      },
    },
  },
} as unknown as Parameters<typeof repositoryBrowserStartPrerequisites>[0]

// Value: protects=a Next run on a window whose Vite is not installed keeps the profile's own readiness, so the Vite adapter's gaps never block a Next start; fails_when=the adapter check is dropped or inverted so every repository-browser run reads the vite-dev entry; why_new=the configuredService cases cover only vite-dev starts; seam=none; no_claim=the Next readiness itself
test('a next-dev-webpack run is never judged by the Vite adapter readiness', () => {
  // Arrange
  const configuration = { adapter: 'next-dev-webpack' }
  // Act
  const result = repositoryBrowserStartPrerequisites(
    NEXT_ONLY_REPORT,
    'repository-browser',
    configuration,
  )
  // Assert
  assert.equal(result, undefined)
})

// Value: protects=a configuration without an adapter (the Next default) and a non-object configuration keep the profile's own readiness; fails_when=a missing adapter field is read as vite-dev or the read throws on a non-object; why_new=no test called the function with an absent adapter or a non-object configuration; seam=none; no_claim=schema validation of the configuration
test('a run without an adapter field keeps the profile readiness', () => {
  // Arrange
  const configurations = [{}, undefined, null, 'vite-dev']
  // Act
  const results = configurations.map((configuration) =>
    repositoryBrowserStartPrerequisites(
      NEXT_ONLY_REPORT,
      'repository-browser',
      configuration,
    ),
  )
  // Assert
  assert.deepEqual(results, [undefined, undefined, undefined, undefined])
})

// Value: protects=another profile that happens to carry adapter vite-dev in its configuration is not rerouted to Vite readiness; fails_when=the profile check is dropped; why_new=the configuredService cases start only repository-browser runs; seam=none; no_claim=which profiles exist
test('a profile other than repository-browser keeps its own readiness whatever its configuration says', () => {
  // Arrange
  const configuration = { adapter: 'vite-dev' }
  // Act
  const result = repositoryBrowserStartPrerequisites(
    NEXT_ONLY_REPORT,
    'node-server',
    configuration,
  )
  // Assert
  assert.equal(result, undefined)
})

// Value: protects=a vite-dev start reads the Vite adapter entry, gaps included, and a window with no profile readiness at all falls back to the window's prerequisites; fails_when=the vite-dev entry is replaced by the profile's Next readiness, or a report without profiles throws; why_new=the service tests reach a window without profiles only through the version-identity harness, not by name; seam=none; no_claim=the sentence for a missing Vite entry (configuredService)
test('a vite-dev run reads the Vite adapter entry and a report without profiles is left to the caller', () => {
  // Arrange
  const configuration = { adapter: 'vite-dev' }
  const withoutProfiles = {
    ready: true,
    missing: [],
  } as unknown as Parameters<typeof repositoryBrowserStartPrerequisites>[0]
  // Act
  const vite = repositoryBrowserStartPrerequisites(
    NEXT_ONLY_REPORT,
    'repository-browser',
    configuration,
  )
  const none = repositoryBrowserStartPrerequisites(
    withoutProfiles,
    'repository-browser',
    configuration,
  )
  // Assert
  assert.deepEqual(vite, { ready: false, missing: ['vite is not installed.'] })
  assert.equal(none, undefined)
})
