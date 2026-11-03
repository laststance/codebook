import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { createNextPagesDiscoveryCache } from '../utils/createNextPagesDiscoveryCache'
import { describeNextLaunchFailure } from '../utils/describeNextLaunchFailure'
import { devScriptRequestsWebpack } from '../utils/devScriptRequestsWebpack'
import { nextServerOnlyFileReasonOfStop } from '../utils/nextServerOnlyFileReason'
import {
  projectMarkerFolders,
  readDeclaredDevelopmentPort,
} from '../utils/readDeclaredDevelopmentPort'
import { readNextServerOnlyReason } from '../utils/readNextServerOnlyReason'
import { readPagesDevelopmentBundle } from '../utils/readPagesDevelopmentBundle'
import {
  resolveNextPackage,
  rootNextPackage,
} from '../utils/resolveNextPackage'

import {
  PAGE_SOURCE,
  nextPagesBuild,
  pagesEvalModule,
  serverChunk,
} from './utils/nextPagesBuildHarness'

/** Writes a file below `directory`, creating its folders. */
async function put(
  directory: string,
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true })
  await writeFile(join(directory, path), text)
}

/**
 * Builds a Pages project below `examples/app` of a repository whose root is a decoy: the root has its own `package.json` (another port, another dev script), a `.git` marker and a `pages/api` file, while the app declares its own.
 * @example const { repository, app } = await decoyRepository(context, { appDev: 'next dev -p 3101' })
 */
async function decoyRepository(
  context: TestContext,
  scripts: { appDev: string; rootDev: string },
) {
  const build = await nextPagesBuild(context, 'examples/app')
  const { repository, workspace: app } = build
  await put(repository, '.git/HEAD', 'ref: refs/heads/main\n')
  await put(
    repository,
    'package.json',
    JSON.stringify({ scripts: { dev: scripts.rootDev } }),
  )
  await put(repository, 'pages/api/decoy.ts', 'export {}\n')
  await put(
    app,
    'package.json',
    JSON.stringify({
      dependencies: { next: '16.4.3' },
      scripts: { dev: scripts.appDev },
    }),
  )
  await put(
    app,
    'node_modules/next/package.json',
    '{"name":"next","version":"16.4.3"}',
  )
  await put(app, 'node_modules/next/dist/bin/next', '')
  const nextPackage = await resolveNextPackage(repository, 'examples/app')
  return { build, repository, app, nextPackage }
}

// protects=the launch-failure notes read the nested package's dev script; fails_when=the repository root's `next dev --webpack` script hides the webpack sentence or the root's missing preparation hides the app's `prisma generate`; no_claim=the wording of the sentences (describeNextLaunchFailure tests)
test('a launch failure of a nested Next app is described from the app dev script, not the repository root script', async (context) => {
  // Arrange
  const { nextPackage } = await decoyRepository(context, {
    appDev: 'prisma generate && next dev',
    rootDev: 'next dev --webpack',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    nextPackage,
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.equal(notes.length, 3)
  assert.match(notes[0]!, /prisma generate|preparation/i)
  assert.match(notes[1]!, /webpack/)
  assert.equal(
    notes[2],
    'Codebook ran Next 16.4.3 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.',
  )
})

// protects=AC 6 root run unchanged; fails_when=a root Next app reads anything but its own package.json; no_claim=nested apps
test('a launch failure of a root Next app still reads the root dev script', async (context) => {
  // Arrange
  const { repository } = await decoyRepository(context, {
    appDev: 'next dev',
    rootDev: 'next dev --webpack',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    nextPackage: rootNextPackage(repository),
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.deepEqual(notes, [])
})

// protects=the webpack check reads the nested package's dev script; fails_when=the root script is read; no_claim=Turbopack detection beyond the flag
test('the webpack check of a nested Next app reads the app dev script, not the repository root one', async (context) => {
  // Arrange
  const { nextPackage } = await decoyRepository(context, {
    appDev: 'next dev',
    rootDev: 'next dev --webpack',
  })
  // Act
  const asksForWebpack = await devScriptRequestsWebpack(nextPackage.packageRoot)
  // Assert
  assert.equal(asksForWebpack, false)
})

// protects=the declared port is the nested package's own; fails_when=the root package.json's port 4000 is declared; no_claim=port availability (assertDevelopmentPortFree tests)
test('the declared port of a nested Next app is read from the app package.json, not the repository root one', async (context) => {
  // Arrange
  const { nextPackage } = await decoyRepository(context, {
    appDev: 'next dev -p 3101',
    rootDev: 'next dev -p 4000',
  })
  // Act
  const declared = await readDeclaredDevelopmentPort(nextPackage.packageRoot)
  // Assert
  assert.equal(declared.port, 3101)
})

// protects=Bun/Yarn detection walks from the package root up to the Git root; fails_when=the walk starts at the repository root or stops at the package; no_claim=the lockfile contents
test('the project marker walk of a nested Next app climbs from the app folder up to the Git root', async (context) => {
  // Arrange
  const { nextPackage, repository, app } = await decoyRepository(context, {
    appDev: 'next dev',
    rootDev: 'next dev',
  })
  // Act
  const folders = await projectMarkerFolders(nextPackage.packageRoot)
  // Assert
  assert.deepEqual(folders, [app, join(repository, 'examples'), repository])
})

// protects=a nested stop in an API route is server-only by its package-relative path; fails_when=the repository-relative path is compared with the folder (no match) or the root decoy path counts; no_claim=the browser-side reading
test('a nested stop in a Pages API route is server-only and a root decoy path is outside the app', async (context) => {
  // Arrange
  const { nextPackage } = await decoyRepository(context, {
    appDev: 'next dev',
    rootDev: 'next dev',
  })
  // Act
  const nested = nextServerOnlyFileReasonOfStop(
    nextPackage,
    'examples/app/src/pages/api/posts.ts',
    'src/pages',
  )
  const nestedDocument = nextServerOnlyFileReasonOfStop(
    nextPackage,
    'examples/app/src/pages/_document.tsx',
    'src/pages',
  )
  const decoy = nextServerOnlyFileReasonOfStop(
    nextPackage,
    'src/pages/api/posts.ts',
    'src/pages',
  )
  const ordinaryPage = nextServerOnlyFileReasonOfStop(
    nextPackage,
    'examples/app/src/pages/index.tsx',
    'src/pages',
  )
  // Assert
  assert.equal(nested, 'api-route')
  assert.equal(nestedDocument, 'document')
  assert.equal(decoy, undefined)
  assert.equal(ordinaryPage, undefined)
})

// protects=AC 6 root run unchanged; fails_when=a root stop is mapped differently; no_claim=nested apps
test('a root stop in a Pages API route is still server-only by its repository path', () => {
  // Arrange
  const nextPackage = rootNextPackage('/repo')
  // Act
  const reason = nextServerOnlyFileReasonOfStop(
    nextPackage,
    'pages/api/hello.ts',
    'pages',
  )
  // Assert
  assert.equal(reason, 'api-route')
})

// protects=the server compile of a nested Pages app is read from the package's .next with the package-relative module id; fails_when=the repository root's decoy .next (no server mapping) is read, or the repository-relative stop path names the module; no_claim=budget and abort handling (readNextServerOnlyReason tests)
test('a nested getStaticProps line is server-only through the app server compile, not the repository root decoy', async (context) => {
  // Arrange
  const { build, repository, app, nextPackage } = await decoyRepository(
    context,
    {
      appDev: 'next dev',
      rootDev: 'next dev',
    },
  )
  const sealed = await readPagesDevelopmentBundle({
    workspace: app,
    selected: build.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  assert.equal(sealed.kind, 'sealed')
  // The app's server compile maps the data-function line 5; the repository root holds a decoy compile that maps only the browser lines.
  await build.write(
    '.next/dev/server/pages/index.js',
    serverChunk({
      './src/pages/index.tsx': pagesEvalModule(
        app,
        'src/pages/index.tsx',
        PAGE_SOURCE,
        'pages-dir-node',
        5,
      ),
    }),
  )
  await put(
    repository,
    '.next/dev/server/pages/index.js',
    serverChunk({
      './src/pages/index.tsx': pagesEvalModule(
        repository,
        'src/pages/index.tsx',
        PAGE_SOURCE,
        'pages-dir-node',
        4,
      ),
    }),
  )
  // Act
  const reason = await readNextServerOnlyReason({
    nextPackage,
    path: 'examples/app/src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle: sealed.bundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'server-only', reason: 'server-compile' })
})
