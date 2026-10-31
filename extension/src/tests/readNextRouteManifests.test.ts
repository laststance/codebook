import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { readNextRouteManifests } from '../utils/readNextRouteManifests'

const ROUTES = '.next/dev/routes-manifest.json'
const APP = '.next/dev/server/app-paths-manifest.json'
const PAGES = '.next/dev/server/pages-manifest.json'
const MEASURED = join(__dirname, '../../src/tests/fixtures/next-pages/nextjs')

/** Creates a temporary workspace with the given route folders (empty), which the test removes afterwards. @example await workspaceWithFolders(context, ['src/pages']) */
async function workspaceWithFolders(
  context: TestContext,
  folders: readonly string[],
): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-route-manifests-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  for (const folder of folders)
    await mkdir(join(workspace, folder), { recursive: true })
  return workspace
}

/**
 * A fake clock, sleep and manifest reader: `rounds[n]` is what the manifests hold after `n` sleeps of the poll (the last stays), so a test writes a manifest late without a real wait.
 * @example const fake = scriptedManifests([{ [PAGES]: '{}' }, { [PAGES]: '{"/":"pages/index.js"}' }])
 */
function scriptedManifests(
  rounds: readonly Readonly<Record<string, string | undefined>>[],
) {
  const slept: number[] = []
  let time = 0
  return {
    slept,
    now: () => time,
    sleep: async (milliseconds: number): Promise<void> => {
      slept.push(milliseconds)
      time += milliseconds
    },
    readText: async (path: string) =>
      rounds[Math.min(slept.length, rounds.length - 1)]![path],
  }
}

const ROUTES_TEXT = '{"version":3,"basePath":"","redirects":[],"rewrites":{}}'

test('a Pages-only project without an App paths manifest resolves its entry path as a Pages route at once', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['src/pages'])
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [PAGES]: '{"/_app":"pages/_app.js","/":"pages/index.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/',
    compiledPath: 'pages/index.js',
  })
  assert.deepEqual(fake.slept, [])
})

test('the poll accepts a Pages route a cold compile writes after the readiness GET', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['src/pages'])
  const before = { [ROUTES]: ROUTES_TEXT, [PAGES]: '{"/_app":"pages/_app.js"}' }
  const fake = scriptedManifests([
    before,
    before,
    before,
    {
      [ROUTES]: ROUTES_TEXT,
      [PAGES]: '{"/_app":"pages/_app.js","/posts/[id]":"pages/posts/[id].js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/posts/42',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/posts/[id]',
    compiledPath: 'pages/posts/[id].js',
  })
  assert.deepEqual(fake.slept, [250, 250, 250])
})

test('with both routers the poll waits for the App paths manifest after the Pages route appeared', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app', 'pages'])
  const pagesOnly = {
    [ROUTES]: ROUTES_TEXT,
    [PAGES]: '{"/":"pages/index.js"}',
  }
  const fake = scriptedManifests([
    pagesOnly,
    pagesOnly,
    { ...pagesOnly, [APP]: '{"/dashboard/page":"app/dashboard/page.js"}' },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/',
    compiledPath: 'pages/index.js',
  })
  assert.deepEqual(fake.slept, [250, 250])
})

test('a route both manifests list is a conflict, judged at the end of the poll though the Pages route appeared first', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app', 'pages'])
  const pagesOnly = {
    [ROUTES]: ROUTES_TEXT,
    [PAGES]: '{"/":"pages/index.js"}',
  }
  const fake = scriptedManifests([
    pagesOnly,
    { ...pagesOnly, [APP]: '{"/page":"app/page.js"}' },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'conflict',
    appKey: '/page',
    pagesRoute: '/',
    pagesCompiledPath: 'pages/index.js',
  })
})

test('an entry path neither manifest lists stays unresolved after the whole ten-second poll', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['src/pages'])
  const fake = scriptedManifests([
    { [ROUTES]: ROUTES_TEXT, [PAGES]: '{"/":"pages/index.js"}' },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/missing',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'unresolved',
    manifests: { pages: true, app: false },
  })
  assert.equal(fake.slept.length, 40)
  assert.equal(fake.now(), 10_000)
})

test('a project whose dev server wrote no manifests stays unresolved with none readable', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const fake = scriptedManifests([{}])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'unresolved',
    manifests: { pages: false, app: false },
  })
})

test('the routes manifest reports a basePath and an i18n setting, never its redirects', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const fake = scriptedManifests([
    {
      [ROUTES]:
        '{"basePath":"/docs","i18n":{"locales":["en","ja"],"defaultLocale":"en"},"redirects":[{"source":"/old","destination":"/new"}]}',
      [PAGES]: '{"/":"pages/index.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: { basePath: '/docs', i18n: true },
    kind: 'pages',
    route: '/',
    compiledPath: 'pages/index.js',
  })
})

test('an empty basePath and a null i18n are no settings', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const fake = scriptedManifests([
    {
      [ROUTES]: '{"basePath":"","i18n":null}',
      [PAGES]: '{"/":"pages/index.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests.settings, {})
})

test('an unparsable Pages manifest fails the read naming the manifest file once the poll ends', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const fake = scriptedManifests([
    { [ROUTES]: ROUTES_TEXT, [PAGES]: '{"/":"pages/index.js"' },
  ])
  // Act / Assert
  await assert.rejects(
    readNextRouteManifests({ workspace, entryPath: '/', ...fake }),
    {
      message:
        'Next route manifest .next/dev/server/pages-manifest.json could not be read: it is not valid JSON',
    },
  )
  assert.equal(fake.slept.length, 40)
})

test('an unparsable routes manifest never quotes its redirect sources in the failure', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const fake = scriptedManifests([
    {
      [ROUTES]: '{"redirects":[{"source":"/SECRET-old-path","destination"',
      [PAGES]: '{"/":"pages/index.js"}',
    },
  ])
  // Act / Assert
  await assert.rejects(
    readNextRouteManifests({ workspace, entryPath: '/', ...fake }),
    {
      message:
        'Next route manifest .next/dev/routes-manifest.json could not be read: it is not valid JSON',
    },
  )
})

test('a Pages manifest caught half-written in one round is read whole in the next', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const fake = scriptedManifests([
    { [ROUTES]: ROUTES_TEXT, [PAGES]: '{"/":"pages/ind' },
    { [ROUTES]: ROUTES_TEXT, [PAGES]: '{"/":"pages/index.js"}' },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/',
    compiledPath: 'pages/index.js',
  })
  assert.deepEqual(fake.slept, [250])
})

test('an App Router entry path resolves on the unchanged App matcher', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['src/app'])
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/page":"app/page.js","/login/page":"app/login/page.js"}',
      [PAGES]: '{"/_app":"pages/_app.js","/_error":"pages/_error.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/login?next=%2F',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'app',
    route: {
      key: '/login/page',
      path: '.next/dev/server/app/login/page_client-reference-manifest.js',
    },
  })
})

test('a cancelled run ends the manifest poll with its abort reason', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['pages'])
  const controller = new AbortController()
  const fake = scriptedManifests([{ [ROUTES]: ROUTES_TEXT }])
  const sleep = async (milliseconds: number): Promise<void> => {
    await fake.sleep(milliseconds)
    controller.abort(new Error('Run cancelled'))
  }
  // Act / Assert
  await assert.rejects(
    readNextRouteManifests({
      workspace,
      entryPath: '/',
      signal: controller.signal,
      now: fake.now,
      readText: fake.readText,
      sleep,
    }),
    { message: 'Run cancelled' },
  )
  assert.deepEqual(fake.slept, [250])
})

test('the measured Next 16 manifests of the P02 example resolve its root page through the real workspace reader', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [
    'src/pages',
    '.next/dev/server',
  ])
  await copyFile(
    join(MEASURED, 'routes-manifest.json'),
    join(workspace, ROUTES),
  )
  await copyFile(join(MEASURED, 'pages-manifest.json'), join(workspace, PAGES))
  // Act
  const manifests = await readNextRouteManifests({ workspace, entryPath: '/' })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/',
    compiledPath: 'pages/index.js',
  })
})
