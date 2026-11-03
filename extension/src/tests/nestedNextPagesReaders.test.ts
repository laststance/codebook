import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { findNextPagesSource } from '../utils/findNextPagesSource'
import { findNextRouteFolder } from '../utils/findNextRouteFolder'
import { nextAppPageSourceKindOf } from '../utils/nextAppPageSourceKindOf'
import { readNextRouteManifests } from '../utils/readNextRouteManifests'
import { readNextRouterKind } from '../utils/readNextRouterKind'
import {
  resolveNextPackage,
  rootNextPackage,
} from '../utils/resolveNextPackage'
import { resolveNextPagesEntry } from '../utils/resolveNextPagesEntry'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

/** The nested Next app of every case, below the repository root. */
const PACKAGE = 'examples/app'

/** A readable routes manifest with no basePath or i18n, so the poll ends at once. */
const ROUTES_TEXT = '{"version":3,"basePath":"","redirects":[],"rewrites":{}}'

/**
 * Writes a stand-in file, creating its folders.
 * @example await put('/repo', 'pages/index.tsx', 'export default () => null\n')
 */
async function put(root: string, path: string, text = ''): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

/**
 * Builds a repository whose root is a decoy Next app (its own pages, app folder, manifests) and whose `examples/app` is the real one, with a different route table.
 * @returns The repository root and the nested package root (real paths).
 */
async function repositoryWithDecoyRoot(context: TestContext) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-nested-pages-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  // The decoy: the root app lists "/" as pages/decoy.js and has an App folder and a Pages folder of its own.
  await put(root, 'pages/decoy.tsx')
  await put(root, 'pages/index.tsx')
  await put(root, 'app/page.tsx')
  await put(
    root,
    '.next/dev/server/pages-manifest.json',
    '{"/":"pages/decoy.js"}',
  )
  await put(root, '.next/dev/routes-manifest.json', ROUTES_TEXT)
  // The real app: only src/pages, listing "/" as pages/index.js.
  const packageRoot = join(root, PACKAGE)
  await put(packageRoot, 'src/pages/index.tsx')
  await put(packageRoot, 'src/pages/api/hello.ts')
  await put(
    packageRoot,
    '.next/dev/server/pages-manifest.json',
    '{"/":"pages/index.js"}',
  )
  await put(packageRoot, '.next/dev/routes-manifest.json', ROUTES_TEXT)
  return { root, packageRoot }
}

// protects=the router kind of a nested app is read from the package's folders; fails_when=the repository root's app/ and pages/ decoys make it both; no_claim=the readiness label that calls it
test('the router kind of a nested package ignores the repository root decoy folders', async (context) => {
  // Arrange
  const { packageRoot } = await repositoryWithDecoyRoot(context)
  // Act
  const kind = await readNextRouterKind(packageRoot)
  // Assert
  assert.equal(kind, 'pages')
})

// protects=the Pages folder of a nested app is src/pages although the root has pages/; fails_when=the root folder wins; no_claim=the App folder rule
test('the Pages folder of a nested package is src/pages although the repository root has pages', async (context) => {
  // Arrange
  const { packageRoot } = await repositoryWithDecoyRoot(context)
  // Act
  const folder = await findNextRouteFolder(packageRoot, 'pages')
  // Assert
  assert.equal(folder, 'src/pages')
})

// protects=the route manifest and the page source of a nested app come from the package; fails_when=the root decoy manifest (pages/decoy.js) or the root pages/index.tsx is read; no_claim=the poll timing
test('a nested package resolves the entry route and its page source from its own manifest and folder', async (context) => {
  // Arrange
  const { packageRoot } = await repositoryWithDecoyRoot(context)
  // Act
  const manifests = await readNextRouteManifests({
    workspace: packageRoot,
    entryPath: '/',
  })
  const source = await findNextPagesSource(packageRoot, 'pages/index.js')
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/',
    compiledPath: 'pages/index.js',
  })
  assert.deepEqual(source, {
    kind: 'found',
    path: 'src/pages/index.tsx',
    folder: 'src/pages',
  })
})

// protects=a nested app without an App folder has no App page source although the root has app/page.tsx; fails_when=the root app folder is searched; no_claim=other extensions
test('the App page source lookup of a nested package ignores the repository root app folder', async (context) => {
  // Arrange
  const { packageRoot } = await repositoryWithDecoyRoot(context)
  // Act
  const kind = await nextAppPageSourceKindOf(packageRoot, '/page')
  // Assert
  assert.equal(kind, 'gone')
})

// protects=a refusal that names a nested page folder or API route names the repository-relative path; fails_when=the package-relative src/pages/api/hello.ts is printed as if it were the repository's; no_claim=the other refusal texts
test('the API-route refusal of a nested package names the repository-relative path', async (context) => {
  // Arrange
  const { root, packageRoot } = await repositoryWithDecoyRoot(context)
  const nextPackage = await resolveNextPackageOf(root, packageRoot)
  await put(
    packageRoot,
    '.next/dev/server/pages-manifest.json',
    '{"/":"pages/api/hello.js"}',
  )
  const manifests = await readNextRouteManifests({
    workspace: packageRoot,
    entryPath: '/',
  })
  assert.equal(manifests.kind, 'pages')
  // Act
  const failure = await resolveNextPagesEntry({
    workspace: packageRoot,
    nextPackage,
    entryPath: '/',
    entry: { status: 200 },
    manifests,
    outputTail: () => '',
    compileFailureSentences: async () => [],
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ROUTE_NOT_FOUND')
  assert.match(
    failure.message,
    /^The entry path \/ is the API route examples\/app\/src\/pages\/api\/hello\.ts, not a page/,
  )
})

// protects=AC 6: a root run names the same path as before; fails_when=the mapping changes a root path; no_claim=a nested package
test('the API-route refusal of a root package keeps the path as read', async (context) => {
  // Arrange
  const { root } = await repositoryWithDecoyRoot(context)
  await put(
    root,
    '.next/dev/server/pages-manifest.json',
    '{"/":"pages/api/hello.js"}',
  )
  await put(root, 'pages/api/hello.ts')
  // A root app with an App folder would make the poll wait for the App manifest.
  await rm(join(root, 'app'), { recursive: true })
  const manifests = await readNextRouteManifests({
    workspace: root,
    entryPath: '/',
  })
  assert.equal(manifests.kind, 'pages')
  // Act
  const failure = await resolveNextPagesEntry({
    workspace: root,
    nextPackage: rootNextPackage(root),
    entryPath: '/',
    entry: { status: 200 },
    manifests,
    outputTail: () => '',
    compileFailureSentences: async () => [],
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.match(failure.message, /is the API route pages\/api\/hello\.ts, not/)
})

/**
 * Resolves the nested package of the decoy repository, installing the Next stand-in the resolver checks first.
 * @example const nextPackage = await resolveNextPackageOf(root, packageRoot)
 */
async function resolveNextPackageOf(root: string, packageRoot: string) {
  await putNextApp(packageRoot)
  return resolveNextPackage(root, PACKAGE)
}

/**
 * Makes a folder a Next app the resolver accepts: a manifest naming next and an installed next executable.
 * @example await putNextApp('/repo/examples/app')
 */
async function putNextApp(packageRoot: string): Promise<void> {
  await put(
    packageRoot,
    'package.json',
    '{"name":"app","dependencies":{"next":"16.4.3"}}',
  )
  await put(
    packageRoot,
    'node_modules/next/package.json',
    '{"name":"next","version":"16.4.3"}',
  )
  await put(packageRoot, 'node_modules/next/dist/bin/next')
}

// protects=a nested Pages run resolves its entry from the package (route "/" is src/pages/index.tsx of examples/app) and names the source repository-relative in the run resource; fails_when=the run reads the repository root's decoy manifest and folders, or names the package-relative path; no_claim=the seal and the replay of the stop (later lanes)
test('a nested Pages run resolves the entry page from the package and names its source repository-relative', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    packageRoot: PACKAGE,
    sourcePath: `${PACKAGE}/src/pages/index.tsx`,
    operations: {
      operations: [{ kind: 'click', title: 'Toggle', selector: '#toggle' }],
      stopOperations: [1],
    },
    nextPages: { chunks: false },
  })
  await putNextApp(join(harness.directory, PACKAGE))
  // The decoy root: another route table and its own pages folder.
  await put(
    harness.directory,
    '.next/dev/server/pages-manifest.json',
    '{"/":"pages/decoy.js"}',
  )
  await put(harness.directory, 'pages/decoy.tsx')
  // Act
  await harness.run.prepare().catch(() => undefined)
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(harness.run.view().nextRoute)), {
    router: 'pages',
    route: '/',
    source: `${PACKAGE}/src/pages/index.tsx`,
  })
})

// protects=a nested server stop in the Pages api folder is refused before the server starts, by the package's Pages folder and the stop's package-relative path; fails_when=the repository root's pages/ decoy decides the folder (no refusal) or the stop path is compared unmapped; no_claim=the browser stop rule (a later lane)
test('a nested server stop in the Pages api folder is refused before the server starts', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    packageRoot: PACKAGE,
    sourcePath: `${PACKAGE}/src/pages/api/hello.ts`,
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
    },
    nextPages: { chunks: false },
  })
  await putNextApp(join(harness.directory, PACKAGE))
  await put(harness.directory, 'pages/decoy.tsx')
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_SERVER_ONLY_STOP', failure.message)
  assert.equal(harness.launchConfigurations.length, 0)
})
