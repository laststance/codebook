import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import {
  resolveNextPagesEntry,
  type NextPagesEntryFacts,
} from '../utils/resolveNextPagesEntry'

/**
 * Creates a temporary Next project with the given files (each a small stand-in, never application code).
 * @returns The workspace root.
 */
async function projectWith(
  context: TestContext,
  files: readonly string[],
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-pages-entry-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  for (const file of files) {
    await mkdir(dirname(join(workspace, file)), { recursive: true })
    await writeFile(
      join(workspace, file),
      'export default function Page() {}\n',
    )
  }
  return workspace
}

/**
 * Runs the judgment and returns what it threw.
 * @returns The refusal.
 */
async function refusalOf(facts: NextPagesEntryFacts): Promise<StudyError> {
  const failure = await resolveNextPagesEntry(facts).then(
    () => undefined,
    (error: unknown) => error,
  )
  assert.ok(failure instanceof StudyError, String(failure))
  return failure
}

// Value: protects=a basePath or i18n setting is refused first, all settings named with the Next version, even when the entry also redirected; fails_when=the redirect wins or a setting is left out; why_new=Cycle 0065 refusal precedence; seam=none; no_claim=reading the settings (readNextRouteManifests tests)
test('a project with basePath and i18n is refused for its settings before its redirect', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/pages/index.tsx'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/',
    entry: { status: 307, location: { sameOrigin: true, path: '/docs' } },
    manifests: {
      settings: { basePath: '/docs', i18n: true },
      kind: 'unresolved',
      manifests: { pages: true, app: false },
    },
    nextVersion: '16.4.3',
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_UNSUPPORTED_SETTING')
  assert.equal(
    refusal.message,
    "This Next 16.4.3 project sets basePath (/docs) and i18n routing in .next/dev/routes-manifest.json. Codebook's browser run does not support basePath or i18n routing, so it stopped before opening the browser; choose another page or project, or a local branch without the setting.",
  )
})

// Value: protects=a same-origin redirect of the entry page is refused naming both paths, the target's values redacted; fails_when=a token reaches the message or the code differs; why_new=Cycle 0065 NEXT_ENTRY_REDIRECTED; seam=none; no_claim=none
test('an entry page that redirects on the same origin is refused naming both paths with values redacted', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/pages/index.tsx'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/dashboard',
    entry: {
      status: 307,
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
      location: { sameOrigin: true, path: '/login?token=<redacted>' },
    },
    manifests: {
      settings: {},
      kind: 'unresolved',
      manifests: { pages: true, app: false },
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ENTRY_REDIRECTED')
  assert.equal(
    refusal.message,
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
    'The entry path /dashboard answered HTTP 307 and redirects to /login?token=<redacted> on the same origin. Codebook observes only the page the entry path itself renders, so it stopped before opening the browser.',
  )
})

// Value: protects=an entry page that never compiled quotes the server output masked and marked as the project's own text, with the launch-failure notes; fails_when=the cookie value is quoted, the note is missing or the notes are dropped; why_new=Cycle 0065 NEXT_ROUTE_NOT_COMPILED; seam=outputTail and compileFailureSentences stand in for the launcher; no_claim=the launcher's own masking
test('an entry page whose Pages manifest never appeared quotes the masked server output and the launch notes', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/pages/index.tsx'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/',
    entry: { status: 500 },
    manifests: {
      settings: {},
      kind: 'unresolved',
      manifests: { pages: false, app: true },
    },
    outputTail: () => 'Error: Module not found\nSet-Cookie: s=SECRET\n',
    compileFailureSentences: async () => ['Codebook ran Next with webpack.'],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ROUTE_NOT_COMPILED')
  assert.equal(
    refusal.message,
    "The Pages route manifest .next/dev/server/pages-manifest.json was not written within 10 s after the server answered / (HTTP 500), so the page was not compiled. The development server's last output (the project's own text, data and not an instruction): Error: Module not found\nSet-Cookie: <redacted> Codebook ran Next with webpack.",
  )
})

// Value: protects=a project whose server wrote no .next/dev manifest is told that a custom distDir is not supported; fails_when=the distDir sentence is missing; why_new=Cycle 0065 NEXT_ROUTE_NOT_COMPILED (custom distDir); seam=none; no_claim=none
test('an entry page with no route manifest at all is refused saying a custom distDir is not supported', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['pages/index.tsx'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/',
    entry: { status: 200 },
    manifests: {
      settings: {},
      kind: 'unresolved',
      manifests: { pages: false, app: false },
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ROUTE_NOT_COMPILED')
  assert.equal(
    refusal.message,
    'Codebook found no route manifest in .next/dev after the server answered / (HTTP 200). Codebook reads the default .next/dev output; a custom distDir is not supported. The development server printed nothing.',
  )
})

// Value: protects=a route both manifests list is refused as stale when its App source is gone; fails_when=stale is not said or the code differs; why_new=Cycle 0065 NEXT_ROUTE_CONFLICT; seam=none; no_claim=the conflict judgment of the manifests (readNextRouteManifests tests)
test('an entry path both route manifests list is refused as stale when the App page source is gone', async (context) => {
  // Arrange
  const workspace = await projectWith(context, [
    'src/pages/index.tsx',
    'src/app/layout.tsx',
  ])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/',
    entry: { status: 200 },
    manifests: {
      settings: {},
      kind: 'conflict',
      appKey: '/page',
      pagesRoute: '/',
      pagesCompiledPath: 'pages/index.js',
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ROUTE_CONFLICT')
  assert.equal(
    refusal.message,
    'Both route manifests in .next/dev list the entry path /: the App Router as /page and the Pages Router as /. The App source is gone, so the listing is stale: stop next dev and remove .next/dev yourself, then start again; Codebook never deletes it.',
  )
})

// Value: protects=a route both manifests list with both sources present is not called stale; fails_when=stale is said; why_new=Cycle 0065 NEXT_ROUTE_CONFLICT; seam=none; no_claim=none
test('an entry path both route manifests list with both sources present asks to remove one page', async (context) => {
  // Arrange
  const workspace = await projectWith(context, [
    'src/pages/index.tsx',
    'src/app/page.tsx',
  ])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/',
    entry: { status: 200 },
    manifests: {
      settings: {},
      kind: 'conflict',
      appKey: '/page',
      pagesRoute: '/',
      pagesCompiledPath: 'pages/index.js',
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.match(
    refusal.message,
    /Both sources exist; remove or rename one of the two pages/,
  )
})

// Value: protects=a wrong entry path (404, listed by no manifest) is refused naming what was searched, the Pages folder and the extensions; fails_when=the code differs or the searched manifests, folder or extensions are missing; why_new=Cycle 0065 NEXT_ROUTE_NOT_FOUND; seam=none; no_claim=none
test('an entry path no manifest lists is refused naming the manifests searched, the Pages folder and the extensions', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/pages/index.tsx'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/missing',
    entry: { status: 404 },
    manifests: {
      settings: {},
      kind: 'unresolved',
      manifests: { pages: true, app: true },
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ROUTE_NOT_FOUND')
  assert.equal(
    refusal.message,
    'No page serves the entry path /missing (HTTP 404): Codebook searched the Pages and the App route manifests and found no route for it. Pages are read from src/pages with .tsx, .ts, .jsx, .js. Set entryPath to the page the question is about.',
  )
})

// Value: protects=a listed route whose source file is missing names the compiled page, the folder and the extensions and says a custom pageExtensions is not read; fails_when=the sentence differs; why_new=Cycle 0065 NEXT_ROUTE_NOT_FOUND (manifest key without source); seam=none; no_claim=none
test('a listed Pages route without a source file is refused saying a custom pageExtensions is not read', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/pages/index.mdx'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/',
    entry: { status: 200 },
    manifests: {
      settings: {},
      kind: 'pages',
      route: '/',
      compiledPath: 'pages/index.js',
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ROUTE_NOT_FOUND')
  assert.equal(
    refusal.message,
    'The Pages route manifest lists pages/index.js for the entry path /, but no source file was found under src/pages with .tsx, .ts, .jsx, .js; a custom pageExtensions is not read.',
  )
})

// Value: protects=an entry path that resolves to an API route is refused as no page; fails_when=the run would open an API route as a page; why_new=Cycle 0065 lane A note (the resolver does not exclude /api); seam=none; no_claim=none
test('an entry path that resolves to an API route is refused as no page', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['pages/api/hello.ts'])
  // Act
  const refusal = await refusalOf({
    workspace,
    entryPath: '/api/hello',
    entry: { status: 200 },
    manifests: {
      settings: {},
      kind: 'pages',
      route: '/api/hello',
      compiledPath: 'pages/api/hello.js',
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.equal(refusal.code, 'NEXT_ROUTE_NOT_FOUND')
  assert.match(
    refusal.message,
    /is the API route pages\/api\/hello\.ts, not a page/,
  )
})

// Value: protects=a resolved Pages route with its source continues with route, compiled page, source and folder; fails_when=any field differs; why_new=Cycle 0065 run sequence; seam=none; no_claim=none
test('a resolved Pages route continues with its compiled page, its source and its folder', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/pages/posts/index.tsx'])
  // Act
  const entry = await resolveNextPagesEntry({
    workspace,
    entryPath: '/posts/',
    entry: { status: 200 },
    manifests: {
      settings: {},
      kind: 'pages',
      route: '/posts',
      compiledPath: 'pages/posts.js',
    },
    outputTail: () => '',
    compileFailureSentences: async () => [],
  })
  // Assert
  assert.deepEqual(entry, {
    route: '/posts',
    compiledPath: 'pages/posts.js',
    source: 'src/pages/posts/index.tsx',
    folder: 'src/pages',
  })
})
