import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import type * as DiscoverModule from '../utils/discoverNextPackages'
import { discoverPackages } from '../utils/discoverNextPackages'
import { readStatusAdapterReadiness } from '../utils/readStatusAdapterReadiness'
import { scanPackages, scanVitePackages } from '../utils/scanNextPackages'
import {
  VITE_NO_DEV_SCRIPT_MESSAGE,
  VITE_PREDEV_MESSAGE,
} from '../utils/viteWorkspaceMessages'

import { loadModule } from './utils/loadModule'

const executeFile = promisify(execFile)
const SIGNAL = new AbortController().signal
const NEXT_MANIFEST = JSON.stringify({
  name: 'next-app',
  dependencies: { next: '16.4.3' },
})

/** Makes a temporary Git repository (real path) that is removed when the test ends. */
async function makeRepository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vite-discovery-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await executeFile('git', ['init', '--quiet', root])
  return root
}

/** Writes a file below the root, creating its folders. */
async function put(root: string, path: string, text = ''): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

/** Tracks files in the repository's index. */
async function track(root: string, ...paths: string[]): Promise<void> {
  await executeFile('git', ['add', '--', ...paths], { cwd: root })
}

/** Writes and tracks a manifest that declares Vite, with the given scripts. */
async function trackedViteApp(
  root: string,
  folder: string,
  scripts: Record<string, string> = { dev: 'vite' },
): Promise<void> {
  await put(
    root,
    `${folder}/package.json`,
    JSON.stringify({
      name: 'app',
      devDependencies: { vite: '^8.3.5' },
      scripts,
    }),
  )
  await track(root, `${folder}/package.json`)
}

/** Installs Vite at `folder`'s own node_modules. */
async function installVite(root: string, folder: string): Promise<void> {
  await put(
    root,
    `${folder}/node_modules/vite/package.json`,
    JSON.stringify({
      name: 'vite',
      version: '8.3.5',
      type: 'module',
      exports: {
        '.': { import: './index.mjs' },
        './package.json': './package.json',
      },
    }),
  )
  await put(root, `${folder}/node_modules/vite/index.mjs`, 'export {}\n')
}

// protects=AC 4 (Cycle 0077): status lists exactly the two nested Vite apps under vite-dev packages with installed, ready, version and missing, not the root Next app, the Vitest-only package or the non-Vite package; fails_when=a library package with a vite.config is listed, an app is missed, or the list holds Next apps; no_claim=truncation (own tests)
test('status lists the nested Vite apps and not a Vitest-only package, a non-Vite package or the root Next app', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await put(root, 'package.json', NEXT_MANIFEST)
  await put(root, 'app/page.tsx')
  await track(root, 'package.json')
  await trackedViteApp(root, 'examples/react/basic')
  await installVite(root, 'examples/react/basic')
  await trackedViteApp(root, 'examples/react/simple')
  await trackedViteApp(root, 'packages/query-core', { 'test:lib': 'vitest' })
  await put(root, 'packages/query-core/vite.config.ts', 'export default {}')
  await put(root, 'tools/cli/package.json', '{"name":"cli"}')
  await track(root, 'tools/cli/package.json')
  // Act
  const report = await readStatusAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  const vite = report['vite-dev']
  // Assert
  assert.equal(vite.rootIsApp, false)
  assert.equal(vite.packagesTruncated, false)
  assert.deepEqual(
    vite.packages?.map((entry) => [
      entry.packageRoot,
      entry.installed,
      entry.ready,
      entry.version,
    ]),
    [
      ['examples/react/basic', true, true, '8.3.5'],
      ['examples/react/simple', false, false, undefined],
    ],
  )
  assert.equal(vite.packages?.[0]?.missing.length, 0)
  assert.match(vite.packages?.[1]?.missing[0] ?? '', /vite/i)
  assert.equal(report['next-dev-webpack'].rootIsApp, true)
})

// protects=AC 4 and decision D5: an app with an index.html and no dev script, and an app with a predev script, are listed ready:false with the same gap sentence a start refuses with; fails_when=status lists such an app ready or drops its gap; no_claim=Vite's installation (installed in this fixture)
test('an index.html app without a dev script and an app with a predev are listed not ready with the gap', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedViteApp(root, 'apps/page-only', {})
  await put(root, 'apps/page-only/index.html', '<html></html>')
  await installVite(root, 'apps/page-only')
  await trackedViteApp(root, 'apps/with-predev', {
    dev: 'vite',
    predev: 'echo hi',
  })
  await installVite(root, 'apps/with-predev')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(
    discovery.vite.packages.map((entry) => [
      entry.packageRoot,
      entry.ready,
      entry.missing,
    ]),
    [
      ['apps/page-only', false, [VITE_NO_DEV_SCRIPT_MESSAGE]],
      ['apps/with-predev', false, [VITE_PREDEV_MESSAGE]],
    ],
  )
})

// protects=AC 4 (limits): the 51st Vite app is not listed and the list says why, while the Next list of the same pass stays complete; fails_when=more than 50 are listed, the limit leaks into the Next list, or the Vite truncation is missing; no_claim=readiness of the entries
test('the Vite list stops at 50 apps with the limit reason and the Next list of the same pass is not truncated', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  for (let index = 0; index < 51; index += 1)
    await trackedViteApp(root, `apps/v${String(index).padStart(2, '0')}`)
  await put(root, 'web/package.json', NEXT_MANIFEST)
  await track(root, 'web/package.json')
  // Act
  const scan = await scanPackages(root, {
    next: async (app) => app.packageRoot,
    vite: async (app) => app.packageRoot,
  })
  // Assert
  assert.equal(scan.vite.items.length, 50)
  assert.equal(scan.vite.items[49], 'apps/v49')
  assert.equal(scan.vite.truncation, 'limit')
  assert.deepEqual(scan.next, { items: ['web'] })
})

// protects=AC 4 (limits): at most 500 manifests are read for the Vite list too, shallow-first, with the manifest-cap reason on both lists of the pass; fails_when=the 501st manifest is read or the reason is missing; no_claim=timing
test('the Vite list reads at most 500 manifests and reports the manifest cap', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  for (let index = 0; index < 501; index += 1)
    await put(
      root,
      `pkgs/p${String(index).padStart(3, '0')}/package.json`,
      '{"name":"p"}',
    )
  await trackedViteApp(root, 'pkgs/zzz')
  await track(root, 'pkgs')
  // Act
  const scan = await scanVitePackages(root, async (app) => app.packageRoot)
  // Assert
  assert.deepEqual(scan, { items: [], truncation: 'manifest-cap' })
})

// protects=AC 4 (limits): with Git failing the Vite list is empty and truncated as git-failed, as the Next list is; fails_when=a failed Git reads as a complete empty list; no_claim=a Git that times out
test('outside a Git repository the Vite list is empty and truncated as git-failed', async (context) => {
  // Arrange
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vite-nogit-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  // Act
  const scan = await scanVitePackages(folder, async (app) => app.packageRoot)
  // Assert
  assert.deepEqual(scan, { items: [], truncation: 'git-failed' })
})

// protects=AC 4 (root keeps today's readiness): a root Vite app is rootIsApp true and keeps its readiness fields, a root that only hoists Vite or is Vitest-only is not; fails_when=a hoisted root Vite or a Vitest-only root becomes the choice, or the root readiness changes; no_claim=nested apps
test('rootIsApp for Vite needs a vite dependency and an index.html or an accepted dev script at the root', async (context) => {
  // Arrange
  const app = await makeRepository(context)
  await put(
    app,
    'package.json',
    JSON.stringify({
      devDependencies: { vite: '^8.3.5' },
      scripts: { dev: 'vite' },
    }),
  )
  await installVite(app, '.')
  const vitestOnly = await makeRepository(context)
  await put(
    vitestOnly,
    'package.json',
    JSON.stringify({
      devDependencies: { vite: '^8.3.5' },
      scripts: { test: 'vitest' },
    }),
  )
  const hoisted = await makeRepository(context)
  await put(hoisted, 'package.json', '{"name":"monorepo"}')
  await installVite(hoisted, '.')
  // Act
  const reports = await Promise.all(
    [app, vitestOnly, hoisted].map((root) =>
      readStatusAdapterReadiness(root, process.execPath, SIGNAL),
    ),
  )
  // Assert
  assert.deepEqual(
    reports.map((report) => report['vite-dev'].rootIsApp),
    [true, false, false],
  )
  assert.equal(reports[0]?.['vite-dev'].ready, true)
  assert.equal(reports[0]?.['vite-dev'].installed, true)
})

/** Loads {@link DiscoverModule} with the Vite workspace reading replaced, so a test decides what it throws or reports. */
async function discoveryWithReading(
  reading: (workspace: string) => Promise<unknown>,
): Promise<typeof DiscoverModule> {
  return loadModule<typeof DiscoverModule>(
    resolve(__dirname, '../utils/discoverNextPackages.js'),
    { './readViteWorkspaceGaps': { readViteWorkspaceGaps: reading } },
  )
}

// protects=Vite status listing: an app whose workspace reading throws stays in the list as not ready with a path-free sentence, and the other apps are still read; fails_when=the throwing app disappears from packages[] or the sentence names the repository path; no_claim=which real failure throws
test('a Vite app whose readiness read throws is listed not ready with a path-free sentence', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedViteApp(root, 'apps/broken')
  await trackedViteApp(root, 'apps/fine')
  const discovery = await discoveryWithReading(async (workspace) => {
    if (workspace.endsWith('apps/broken'))
      throw Object.assign(new Error(`EACCES: lstat '${workspace}'`), {
        code: 'EACCES',
      })
    return { ready: true, gaps: [] }
  })
  // Act
  const result = await discovery.discoverPackages(root, {})
  // Assert
  assert.deepEqual(
    result.vite.packages.map((entry) => ({
      packageRoot: entry.packageRoot,
      ready: entry.ready,
      missing: [...entry.missing],
    })),
    [
      {
        packageRoot: 'apps/broken',
        ready: false,
        missing: ['The package could not be checked (EACCES).'],
      },
      { packageRoot: 'apps/fine', ready: true, missing: [] },
    ],
  )
})

// protects=Vite status listing: a gap sentence that names the repository path reaches the chat with the path hidden, as Next messages do; fails_when=packages[].missing shows the absolute repository path; no_claim=the wording of real gap sentences
test('a Vite gap sentence that names the repository path is listed with the path hidden', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedViteApp(root, 'apps/web')
  const discovery = await discoveryWithReading(async (workspace) => ({
    ready: false,
    gaps: [
      { code: 'PREREQUISITE_MISSING', message: `broken at ${workspace}/x` },
    ],
  }))
  // Act
  const result = await discovery.discoverPackages(root, {})
  // Assert
  assert.deepEqual(
    result.vite.packages.map((entry) => [...entry.missing]),
    [['broken at <workspace>/apps/web/x']],
  )
})

// protects=scan cost: once the Vite list is full, later chunks never read a Vite app that would be discarded, while the Next list keeps being read; fails_when=the Vite visitor is called for apps/d after the limit was reached; no_claim=the truncation reason (shared by design)
test('a kind at its limit is not visited again in later chunks', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedViteApp(root, 'apps/a')
  await trackedViteApp(root, 'apps/b')
  await put(root, 'apps/c/package.json', NEXT_MANIFEST)
  await trackedViteApp(root, 'apps/d')
  await put(root, 'apps/e/package.json', NEXT_MANIFEST)
  await track(root, 'apps/c/package.json', 'apps/e/package.json')
  const visitedVite: string[] = []
  // Act
  const scan = await scanPackages(
    root,
    {
      next: async (app) => app.packageRoot,
      vite: async (app) => {
        visitedVite.push(app.packageRoot)
        return app.packageRoot
      },
    },
    { limits: { apps: 1, concurrency: 1 } },
  )
  // Assert
  assert.deepEqual(visitedVite, ['apps/a', 'apps/b'])
  assert.deepEqual(scan.vite.items, ['apps/a'])
  assert.deepEqual(scan.next.items, ['apps/c'])
})
