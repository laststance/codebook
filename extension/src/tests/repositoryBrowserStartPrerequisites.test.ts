import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  repositoryBrowserStartPrerequisites,
  rootStaticPageEntryStartPrerequisites,
} from '../utils/repositoryBrowserStartPrerequisites'

/** A ready window report for a static-page start: shared prerequisites pass. */
const READY_REPORT = {
  ready: true,
  missing: [],
  profiles: { 'repository-browser': { ready: true, missing: [] } },
} as unknown as Parameters<typeof repositoryBrowserStartPrerequisites>[0]

/** Makes a temp root holding the given files. */
async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codebook-root-entry-'))
  for (const [name, text] of Object.entries(files))
    await writeFile(join(root, name), text)
  return root
}

// Value: protects=a root page whose only file is the declared demo.html starts; fails_when=the root's precomputed index.html readiness judges a declared entry; no_claim=serving the page
test('a root with only demo.html and entryPath /demo.html is ready to start', async () => {
  // Arrange
  const root = await rootWith({ 'demo.html': '<h1>demo</h1>' })
  // Act
  const result = await rootStaticPageEntryStartPrerequisites(
    READY_REPORT,
    'repository-browser',
    { adapter: 'static-page', entryPath: '/demo.html' },
    root,
  )
  // Assert
  assert.deepEqual(result, { ready: true, missing: [] })
})

// Value: protects=the default entry keeps the root readiness, which reports no-entry-page without index.html; fails_when=a / or absent entry is judged by another file; no_claim=the refusal wording
test('a root with entryPath / or none keeps the root readiness', async () => {
  // Arrange
  const root = await rootWith({ 'demo.html': '<h1>demo</h1>' })
  // Act
  const slash = await rootStaticPageEntryStartPrerequisites(
    READY_REPORT,
    'repository-browser',
    { adapter: 'static-page', entryPath: '/' },
    root,
  )
  const absent = await rootStaticPageEntryStartPrerequisites(
    READY_REPORT,
    'repository-browser',
    { adapter: 'static-page' },
    root,
  )
  // Assert
  assert.equal(slash, undefined)
  assert.equal(absent, undefined)
})

// Value: protects=a declared entry that needs a bundler is refused; fails_when=the declared entry is not judged; no_claim=other gap kinds
test('a root whose demo.html imports a bare specifier is refused needs-bundler', async () => {
  // Arrange
  const root = await rootWith({
    'demo.html': '<script type="module">import "lib"</script>',
  })
  // Act
  const result = await rootStaticPageEntryStartPrerequisites(
    READY_REPORT,
    'repository-browser',
    { adapter: 'static-page', entryPath: '/demo.html' },
    root,
  )
  // Assert
  assert.deepEqual(result, { ready: false, missing: ['needs-bundler: lib'] })
})

// Value: protects=a root with no declared entry file is refused no-entry-page; fails_when=the declared entry is not checked for existence; no_claim=wording
test('a root without the declared entry file is refused no-entry-page', async () => {
  // Arrange
  const root = await rootWith({ 'index.html': '<h1>index</h1>' })
  // Act
  const result = await rootStaticPageEntryStartPrerequisites(
    READY_REPORT,
    'repository-browser',
    { adapter: 'static-page', entryPath: '/demo.html' },
    root,
  )
  // Assert
  assert.deepEqual(result, { ready: false, missing: ['no-entry-page'] })
})

// Value: protects=a nested packageRoot keeps its own judgement; fails_when=the root judges a nested start; no_claim=the nested rules
test('a nested packageRoot is left to the nested package judgement', async () => {
  // Arrange
  const root = await rootWith({})
  // Act
  const result = await rootStaticPageEntryStartPrerequisites(
    READY_REPORT,
    'repository-browser',
    {
      adapter: 'static-page',
      entryPath: '/demo.html',
      packageRoot: 'examples/page',
    },
    root,
  )
  // Assert
  assert.equal(result, undefined)
})

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

// Value: protects=a react-scripts-dev run on a window without a react-scripts readiness entry is told about the react-scripts adapter, not the Vite one; fails_when=the fallback sentence names Vite; no_claim=the readiness of the adapter itself
test('a react-scripts-dev run without a react-scripts readiness entry gets a react-scripts sentence', () => {
  // Arrange
  const configuration = { adapter: 'react-scripts-dev' }
  // Act
  const result = repositoryBrowserStartPrerequisites(
    NEXT_ONLY_REPORT,
    'repository-browser',
    configuration,
  )
  // Assert
  assert.equal(result?.ready, false)
  assert.match(result?.missing[0] ?? '', /react-scripts adapter's readiness/)
  assert.equal((result?.missing[0] ?? '').includes('Vite'), false)
})
