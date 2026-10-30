import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { createNextPagesDiscoveryCache } from '../utils/createNextPagesDiscoveryCache'
import { readNextServerOnlyReason } from '../utils/readNextServerOnlyReason'
import { readPagesDevelopmentBundle } from '../utils/readPagesDevelopmentBundle'

import {
  PAGE_SOURCE,
  nextPagesBuild,
  pagesEvalModule,
  serverChunk,
} from './utils/nextPagesBuildHarness'

/** Creates an empty temporary workspace that the test removes afterwards. @example await emptyWorkspace(context) */
async function emptyWorkspace(context: TestContext): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-server-only-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  return workspace
}

/**
 * Seals the stand-in page (its browser module maps lines 1–4) and writes the page's server compile, whose `(pages-dir-node)` module maps the given number of lines.
 * @example const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
 */
async function sealedPageWithServerCompile(
  context: TestContext,
  serverMappedLines: number | undefined,
) {
  const build = await nextPagesBuild(context)
  const sealed = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  assert.equal(sealed.kind, 'sealed')
  if (serverMappedLines !== undefined)
    await build.write(
      '.next/dev/server/pages/index.js',
      serverChunk({
        './src/pages/index.tsx': pagesEvalModule(
          build.workspace,
          'src/pages/index.tsx',
          PAGE_SOURCE,
          'pages-dir-node',
          serverMappedLines,
        ),
      }),
    )
  return { build, clientBundle: sealed.bundle }
}

test('a stop in _document is server-only by Next’s file rule', async (context) => {
  // Arrange
  const workspace = await emptyWorkspace(context)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace,
    path: 'src/pages/_document.tsx',
    line: 4,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'server-only', reason: 'document' })
})

for (const path of ['pages/api/posts/[id].ts', 'pages/api.js'])
  test(`a stop in the API route ${path} is server-only by Next’s file rule`, async (context) => {
    // Arrange
    const workspace = await emptyWorkspace(context)
    // Act
    const reason = await readNextServerOnlyReason({
      workspace,
      path,
      line: 1,
      folder: 'pages',
      compiledPath: 'pages/index.js',
      cache: createNextPagesDiscoveryCache(),
    })
    // Assert
    assert.deepEqual(reason, { kind: 'server-only', reason: 'api-route' })
  })

test('a line the page’s server compile maps and its browser module does not is server-only by evidence', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'server-only', reason: 'server-compile' })
})

test('an unmapped line without a server compile stays unknown, never server-only', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(
    context,
    undefined,
  )
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a line neither the browser module nor the server compile maps stays unknown', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 4)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a line the browser module maps is not server-only, though the server compile maps it too', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 2,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a stop whose browser module was never sealed stays unknown, since a lazily loaded chunk may carry it', async (context) => {
  // Arrange
  const { build } = await sealedPageWithServerCompile(context, 5)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a server compile built from an older version of the source establishes nothing', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 4)
  await build.write(
    '.next/dev/server/pages/index.js',
    serverChunk({
      './src/pages/index.tsx': pagesEvalModule(
        build.workspace,
        'src/pages/index.tsx',
        `${PAGE_SOURCE}// older\n`,
        'pages-dir-node',
        5,
      ),
    }),
  )
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})
