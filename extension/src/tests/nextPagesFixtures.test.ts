import assert from 'node:assert/strict'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { z } from 'zod'

import { findNextPagesSource } from '../utils/findNextPagesSource'
import { readNextRouteManifests } from '../utils/readNextRouteManifests'
import { resolveNextPagesRoute } from '../utils/resolveNextPagesRoute'

// The measured fixtures: what a Next 16.4.3 dev server (`next dev --webpack`) wrote for two TanStack/query c9c00015 Pages examples after one GET of / (Cycle 0066 task 32); each folder's pages-files.json says how it was measured.
const FIXTURES = join(__dirname, '../../src/tests/fixtures/next-pages')
const ROUTES = '.next/dev/routes-manifest.json'
const PAGES = '.next/dev/server/pages-manifest.json'

/** Creates a temporary workspace with the given folders (empty), which the test removes afterwards. @example await workspaceWithFolders(context, ['src/pages']) */
async function workspaceWithFolders(
  context: TestContext,
  folders: readonly string[],
): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-measured-pages-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  for (const folder of folders)
    await mkdir(join(workspace, folder), { recursive: true })
  return workspace
}

/** Reads a measured fixture's Pages manifest (route → compiled page). @example await measuredPagesManifest('load-more-infinite-scroll') */
async function measuredPagesManifest(
  example: string,
): Promise<Record<string, string>> {
  return z
    .record(z.string(), z.string())
    .parse(
      JSON.parse(
        await readFile(join(FIXTURES, example, 'pages-manifest.json'), 'utf8'),
      ),
    )
}

/** Writes a tiny stand-in (never application code) for each page source file a measured example lists in its pages-files.json. @example await writeMeasuredPagesFiles(workspace, 'load-more-infinite-scroll') */
async function writeMeasuredPagesFiles(
  workspace: string,
  example: string,
): Promise<void> {
  const { pagesFiles } = z
    .object({ measured: z.string(), pagesFiles: z.array(z.string()) })
    .parse(
      JSON.parse(
        await readFile(join(FIXTURES, example, 'pages-files.json'), 'utf8'),
      ),
    )
  for (const path of pagesFiles) {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(
      join(workspace, path),
      'export default function Page() {}\n',
    )
  }
}

// --- infinite-query-with-max-pages ---

// Value: protects=the real workspace reader resolving the root page from the manifests Next 16 wrote for a second P02 Pages example; fails_when=a manifest shape of that example (no App paths manifest, its routes manifest) stops resolving /; why_new=Cycle 0066 task 32 (the Pages fixtures came from one P02 example); seam=measured manifests copied into a temporary workspace; no_claim=a live dev server
test('the measured manifests of the infinite-query-with-max-pages example resolve its root page through the real workspace reader', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [
    'src/pages',
    '.next/dev/server',
  ])
  await copyFile(
    join(FIXTURES, 'infinite-query-with-max-pages', 'routes-manifest.json'),
    join(workspace, ROUTES),
  )
  await copyFile(
    join(FIXTURES, 'infinite-query-with-max-pages', 'pages-manifest.json'),
    join(workspace, PAGES),
  )
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

// Value: protects=Next's Pages precedence resolving / in the Pages manifest Next 16 wrote for a second P02 Pages example; fails_when=its manifest's entries (_app, _error, _document beside /) change the match; why_new=Cycle 0066 task 32; seam=the measured manifest; no_claim=dynamic routes (synthetic fixtures)
test('the measured Pages manifest of the infinite-query-with-max-pages example resolves / to its compiled index page', async () => {
  // Arrange
  const manifest = await measuredPagesManifest('infinite-query-with-max-pages')
  // Act
  const resolution = resolveNextPagesRoute(manifest, '/')
  // Assert
  assert.deepEqual(resolution, {
    kind: 'matched',
    route: '/',
    compiledPath: 'pages/index.js',
  })
})

// Value: protects=finding the root page's source among the page files of a second P02 Pages example, whose src/pages also holds an API route; fails_when=the lookup picks another file or misses src/pages/index.tsx; why_new=Cycle 0066 task 32; seam=stand-in files at the measured paths; no_claim=the example's real source text
test('the measured infinite-query-with-max-pages example’s root page is found in src/pages/index.tsx', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [])
  await writeMeasuredPagesFiles(workspace, 'infinite-query-with-max-pages')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'src/pages/index.tsx',
    folder: 'src/pages',
  })
})

// --- load-more-infinite-scroll ---

// Value: protects=the real workspace reader resolving the root page from the manifests Next 16 wrote for a third P02 Pages example; fails_when=a manifest shape of that example stops resolving /; why_new=Cycle 0066 task 32; seam=measured manifests copied into a temporary workspace; no_claim=a live dev server
test('the measured manifests of the load-more-infinite-scroll example resolve its root page through the real workspace reader', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [
    'src/pages',
    '.next/dev/server',
  ])
  await copyFile(
    join(FIXTURES, 'load-more-infinite-scroll', 'routes-manifest.json'),
    join(workspace, ROUTES),
  )
  await copyFile(
    join(FIXTURES, 'load-more-infinite-scroll', 'pages-manifest.json'),
    join(workspace, PAGES),
  )
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

// Value: protects=Next's Pages precedence resolving / in the Pages manifest Next 16 wrote for a third P02 Pages example; fails_when=its manifest's entries change the match; why_new=Cycle 0066 task 32; seam=the measured manifest; no_claim=its /about page, which the single GET of / did not compile
test('the measured Pages manifest of the load-more-infinite-scroll example resolves / to its compiled index page', async () => {
  // Arrange
  const manifest = await measuredPagesManifest('load-more-infinite-scroll')
  // Act
  const resolution = resolveNextPagesRoute(manifest, '/')
  // Assert
  assert.deepEqual(resolution, {
    kind: 'matched',
    route: '/',
    compiledPath: 'pages/index.js',
  })
})

// Value: protects=finding the root page's source among the page files of a third P02 Pages example, whose src/pages also holds about.tsx and an API route; fails_when=the lookup picks another file or misses src/pages/index.tsx; why_new=Cycle 0066 task 32; seam=stand-in files at the measured paths; no_claim=the example's real source text
test('the measured load-more-infinite-scroll example’s root page is found in src/pages/index.tsx', async (context) => {
  // Arrange
  const workspace = await workspaceWithFolders(context, [])
  await writeMeasuredPagesFiles(workspace, 'load-more-infinite-scroll')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'src/pages/index.tsx',
    folder: 'src/pages',
  })
})
