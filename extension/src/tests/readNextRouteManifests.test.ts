import assert from 'node:assert/strict'
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as ReadNextRouteManifestsModule from '../utils/readNextRouteManifests'
import { readNextRouteManifests } from '../utils/readNextRouteManifests'

import { loadModule } from './utils/loadModule'

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

/**
 * Loads the compiled manifest reader with the router contest's source lookups replaced by recorders that find every source, so a test sees whether the contest looked a source up.
 * @returns The loaded reader and the manifest key or compiled path of each lookup it made.
 * @example const { read, lookups } = await readerWithRecordedLookups()
 */
async function readerWithRecordedLookups() {
  const lookups: string[] = []
  const loaded = await loadModule<typeof ReadNextRouteManifestsModule>(
    resolve(__dirname, '../utils/readNextRouteManifests.js'),
    {
      './hasNextAppPageSource': {
        hasNextAppPageSource: async (_workspace: string, appKey: string) => {
          lookups.push(appKey)
          return true
        },
      },
      './findNextPagesSource': {
        findNextPagesSource: async (
          _workspace: string,
          compiledPath: string,
        ) => {
          lookups.push(compiledPath)
          return { kind: 'found', path: 'pages/about.tsx', folder: 'pages' }
        },
      },
    },
    // The real Error, so the loaded reader keeps a thrown manifest error as it is.
    { Error },
  )
  return { read: loaded.readNextRouteManifests, lookups }
}

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

// Value: protects=an App Router run in a project that also has a Pages catch-all keeps working on the static App route Next serves; fails_when=any path both manifests match is refused as NEXT_ROUTE_CONFLICT; why_new=Codex review in /ship pass 1 (Cycle 0065), an App behavior regression; seam=none; no_claim=a real mixed project's dev server
test('a static App route wins over a Pages catch-all that also matches its path, as Next serves it, instead of a conflict', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app/about', 'pages'])
  await writeFile(join(workspace, 'app/about/page.tsx'), 'export default 1\n')
  await writeFile(join(workspace, 'pages/[...slug].tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/about/page":"app/about/page.js"}',
      [PAGES]: '{"/[...slug]":"pages/[...slug].js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/about',
    ...fake,
  })
  // Assert
  assert.equal(manifests.kind, 'app')
  assert.deepEqual(
    manifests.kind === 'app' && manifests.route.key,
    '/about/page',
  )
})

// Value: protects=an App route inside a route group is compared by its URL path, so it still wins over a Pages catch-all; fails_when=the route-group segment is kept and the static App route is refused as a conflict; why_new=pass 2 testing review (Cycle 0065): the earlier equal-pair test stayed green without the group filter; seam=none; no_claim=a real mixed project's dev server
test('a static App route inside a route group wins over a Pages catch-all that also matches its path', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [
    'app/(site)/about',
    'pages',
  ])
  await writeFile(
    join(workspace, 'app/(site)/about/page.tsx'),
    'export default 1\n',
  )
  await writeFile(join(workspace, 'pages/[...slug].tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/(site)/about/page":"app/(site)/about/page.js"}',
      [PAGES]: '{"/[...slug]":"pages/[...slug].js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/about',
    ...fake,
  })
  // Assert
  assert.equal(manifests.kind, 'app')
  assert.deepEqual(
    manifests.kind === 'app' && manifests.route.key,
    '/(site)/about/page',
  )
})

// Value: protects=a static Pages route wins over a dynamic App route that also matches its path, so the Pages run is taken; fails_when=the pair is refused as a conflict or the App route is taken; why_new=Codex review in /ship pass 1 (Cycle 0065); seam=none; no_claim=a real mixed project's dev server
test('a static Pages route wins over a dynamic App route that also matches its path instead of a conflict', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app/[slug]', 'pages'])
  await writeFile(join(workspace, 'app/[slug]/page.tsx'), 'export default 1\n')
  await writeFile(join(workspace, 'pages/about.tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/[slug]/page":"app/[slug]/page.js"}',
      [PAGES]: '{"/about":"pages/about.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/about',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'pages',
    route: '/about',
    compiledPath: 'pages/about.js',
  })
})

// Value: protects=a more specific route whose source is gone (a stale listing left in .next/dev) stays a conflict, so its refusal names the listing as stale; fails_when=the stale route wins and the run takes a page that no longer exists; why_new=pass 2 maintainability and api-contract reviews (Cycle 0065); seam=none; no_claim=a real leftover .next/dev
test('a more specific App route whose source is gone stays a conflict with the live Pages catch-all', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app', 'pages'])
  await writeFile(join(workspace, 'pages/[...slug].tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/about/page":"app/about/page.js"}',
      [PAGES]: '{"/[...slug]":"pages/[...slug].js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/about',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'conflict',
    appKey: '/about/page',
    pagesRoute: '/[...slug]',
    pagesCompiledPath: 'pages/[...slug].js',
  })
})

// Value: protects=a more specific Pages route whose source is gone (a stale listing left in .next/dev) stays a conflict, so its refusal names the listing as stale; fails_when=the stale Pages route wins and the run takes a page that no longer exists; why_new=Cycle 0066 task 23 (the contest's Pages-side stale guard had no test); seam=none; no_claim=a real leftover .next/dev
test('a more specific Pages route whose source is gone stays a conflict with the live dynamic App route', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app/[slug]', 'pages'])
  await writeFile(join(workspace, 'app/[slug]/page.tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/[slug]/page":"app/[slug]/page.js"}',
      [PAGES]: '{"/about":"pages/about.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/about',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'conflict',
    appKey: '/[slug]/page',
    pagesRoute: '/about',
    pagesCompiledPath: 'pages/about.js',
  })
})

// Value: protects=two equally specific routes, one per router, stay the conflict Next refuses; fails_when=the comparison picks one router for an equal pair; why_new=Codex review in /ship pass 1 (Cycle 0065); seam=none; no_claim=none beyond protects
test('an App route and a Pages route of the same static path stay a conflict', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app/about', 'pages'])
  await writeFile(join(workspace, 'app/about/page.tsx'), 'export default 1\n')
  await writeFile(join(workspace, 'pages/about.tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/about/page":"app/about/page.js"}',
      [PAGES]: '{"/about":"pages/about.js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/about',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'conflict',
    appKey: '/about/page',
    pagesRoute: '/about',
    pagesCompiledPath: 'pages/about.js',
  })
})

// Value: protects=the router contest compares the Pages route with the App route Next serves, so an equal pair stays the conflict Next refuses; fails_when=the contest takes the App route the additive score picked (/[x]/b) and lets the Pages catch-all win; why_new=Cycle 0066 task 19 (Codex adversarial review, Cycle 0065 pass 2); seam=none; no_claim=a real mixed project's dev server
test('the router contest compares the Pages route with the App route Next serves, so an equal catch-all pair stays a conflict', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [
    'app/a/[...r]',
    'app/[x]/b',
    'pages/a',
  ])
  await writeFile(
    join(workspace, 'app/a/[...r]/page.tsx'),
    'export default 1\n',
  )
  await writeFile(join(workspace, 'app/[x]/b/page.tsx'), 'export default 1\n')
  await writeFile(join(workspace, 'pages/a/[...r].tsx'), 'export default 1\n')
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]:
        '{"/a/[...r]/page":"app/a/[...r]/page.js","/[x]/b/page":"app/[x]/b/page.js"}',
      [PAGES]: '{"/a/[...r]":"pages/a/[...r].js"}',
    },
  ])
  // Act
  const manifests = await readNextRouteManifests({
    workspace,
    entryPath: '/a/b',
    ...fake,
  })
  // Assert
  assert.deepEqual(manifests, {
    settings: {},
    kind: 'conflict',
    appKey: '/a/[...r]/page',
    pagesRoute: '/a/[...r]',
    pagesCompiledPath: 'pages/a/[...r].js',
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

// Value: protects=a manifest read that still fails when the poll ends is thrown before the router contest looks up any source file; fails_when=the contest's file lookups run first (and can fail or wait first) although the read failure decides the answer; why_new=Cycle 0066 task 22 (native adversarial review, Cycle 0065 fix-check 1); seam=loadModule replaces the two source lookups with recorders; no_claim=the lookups' own behavior (findNextPagesSource tests)
test('a failed manifest read ends the poll with its error before the router contest looks up a source', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app', 'pages'])
  const { read, lookups } = await readerWithRecordedLookups()
  const fake = scriptedManifests([
    {
      [ROUTES]: '{"basePath":',
      [APP]: '{"/about/page":"app/about/page.js"}',
      [PAGES]: '{"/[...slug]":"pages/[...slug].js"}',
    },
  ])
  // Act
  const failure = await read({ workspace, entryPath: '/about', ...fake }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof Error, String(failure))
  assert.equal(
    failure.message,
    'Next route manifest .next/dev/routes-manifest.json could not be read: it is not valid JSON',
  )
  assert.deepEqual(lookups, [])
})

// Value: protects=a run cancelled while the last round is read ends at the router contest's source lookup with its abort reason; fails_when=the contest looks its sources up without the run's signal and answers as if the run went on; why_new=Cycle 0066 task 22 (the contest ran without the abort signal); seam=the scripted reader aborts during the last read; no_claim=cancelling a real dev server
test('a run cancelled during the last manifest round ends at the router contest with its abort reason', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, ['app/about', 'pages'])
  await writeFile(join(workspace, 'app/about/page.tsx'), 'export default 1\n')
  await writeFile(join(workspace, 'pages/[...slug].tsx'), 'export default 1\n')
  const controller = new AbortController()
  const fake = scriptedManifests([
    {
      [ROUTES]: ROUTES_TEXT,
      [APP]: '{"/about/page":"app/about/page.js"}',
      [PAGES]: '{"/[...slug]":"pages/[...slug].js"}',
    },
  ])
  const readText = async (path: string): Promise<string | undefined> => {
    // The Pages manifest is the round's last read: the run is cancelled while it is read.
    if (path === PAGES) controller.abort(new Error('Run cancelled'))
    return fake.readText(path)
  }
  // Act / Assert
  await assert.rejects(
    readNextRouteManifests({
      workspace,
      entryPath: '/about',
      signal: controller.signal,
      now: fake.now,
      sleep: fake.sleep,
      readText,
    }),
    { message: 'Run cancelled' },
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

test('an App Router entry path resolves on the App matcher', async (context) => {
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
