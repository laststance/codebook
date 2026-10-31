import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { z } from 'zod'

import { findNextPagesSource } from '../utils/findNextPagesSource'

/** Creates an empty temporary workspace that the test removes afterwards. @example const workspace = await temporaryWorkspace(context) */
async function temporaryWorkspace(context: TestContext): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-pages-source-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  return workspace
}

/** Writes a tiny stand-in source file (never application code) at a workspace-relative path. @example await writeStandIn(workspace, 'src/pages/index.tsx') */
async function writeStandIn(workspace: string, path: string): Promise<void> {
  await mkdir(dirname(join(workspace, path)), { recursive: true })
  await writeFile(join(workspace, path), 'export default function Page() {}\n')
}

test('the root pages folder wins over src/pages, so a page only under src/pages is missing there', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await mkdir(join(workspace, 'pages'))
  await writeStandIn(workspace, 'src/pages/index.tsx')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'missing',
    folder: 'pages',
    tried: [
      'pages/index.tsx',
      'pages/index.ts',
      'pages/index.jsx',
      'pages/index.js',
    ],
  })
})

test('a page under the root pages folder is found there when src/pages also has one', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'pages/index.tsx')
  await writeStandIn(workspace, 'src/pages/index.tsx')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'pages/index.tsx',
    folder: 'pages',
  })
})

test('a project without a root pages folder reads its page from src/pages', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'src/pages/posts/[id].tsx')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/posts/[id].js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'src/pages/posts/[id].tsx',
    folder: 'src/pages',
  })
})

test('the page source is chosen in Next’s extension order: .ts before .jsx and .js', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'src/pages/index.js')
  await writeStandIn(workspace, 'src/pages/index.jsx')
  await writeStandIn(workspace, 'src/pages/index.ts')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'src/pages/index.ts',
    folder: 'src/pages',
  })
})

test('a page compiled from a folder index file is found as that index file', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'src/pages/posts/index.tsx')
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/posts.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'src/pages/posts/index.tsx',
    folder: 'src/pages',
  })
})

test('a missing page source lists every candidate Next tries, in its order', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await mkdir(join(workspace, 'src/pages'), { recursive: true })
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/posts/[id].js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'missing',
    folder: 'src/pages',
    tried: [
      'src/pages/posts/[id].tsx',
      'src/pages/posts/[id]/index.tsx',
      'src/pages/posts/[id].ts',
      'src/pages/posts/[id]/index.ts',
      'src/pages/posts/[id].jsx',
      'src/pages/posts/[id]/index.jsx',
      'src/pages/posts/[id].js',
      'src/pages/posts/[id]/index.js',
    ],
  })
})

for (const compiledPath of [
  'pages/../../outside.js',
  'pages/./index.js',
  'server/pages/index.js',
  'pages/index.ts',
  'pages/a\\b.js',
])
  test(`a compiled path that could leave the pages folder is refused: ${compiledPath}`, async (context) => {
    // Arrange
    const workspace = await temporaryWorkspace(context)
    // Act / Assert
    await assert.rejects(findNextPagesSource(workspace, compiledPath), {
      message: 'Compiled Pages path escapes the pages folder',
    })
  })

// Value: protects=a cancelled run ends the Pages source lookup with its abort reason instead of finishing it; fails_when=the signal is ignored and the lookup answers found; why_new=Cycle 0066 task 22 (the router contest's lookups ran without the abort signal); seam=an already aborted signal; no_claim=cancel timing between two candidates
test('a cancelled run ends the Pages source lookup with its abort reason', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'pages/index.tsx')
  const controller = new AbortController()
  controller.abort(new Error('Run cancelled'))
  // Act / Assert
  await assert.rejects(
    findNextPagesSource(workspace, 'pages/index.js', controller.signal),
    { message: 'Run cancelled' },
  )
})

test('a page source that is a link out of the workspace is not followed and not found', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  const outside = await temporaryWorkspace(context)
  await writeStandIn(outside, 'index.tsx')
  await mkdir(join(workspace, 'src/pages'), { recursive: true })
  await symlink(
    join(outside, 'index.tsx'),
    join(workspace, 'src/pages/index.tsx'),
  )
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'missing',
    folder: 'src/pages',
    tried: [
      'src/pages/index.tsx',
      'src/pages/index.ts',
      'src/pages/index.jsx',
      'src/pages/index.js',
    ],
  })
})

test('the measured P02 example’s root page is found in src/pages/index.tsx', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  const { pagesFiles } = z
    .object({ measured: z.string(), pagesFiles: z.array(z.string()) })
    .parse(
      JSON.parse(
        await readFile(
          join(
            __dirname,
            '../../src/tests/fixtures/next-pages/nextjs/pages-files.json',
          ),
          'utf8',
        ),
      ),
    )
  for (const path of pagesFiles) await writeStandIn(workspace, path)
  // Act
  const lookup = await findNextPagesSource(workspace, 'pages/index.js')
  // Assert
  assert.deepEqual(lookup, {
    kind: 'found',
    path: 'src/pages/index.tsx',
    folder: 'src/pages',
  })
})
