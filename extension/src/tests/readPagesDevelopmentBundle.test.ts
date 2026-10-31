import assert from 'node:assert/strict'
import { rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  REPOSITORY_DISCOVERY_LIMIT_BYTES,
  REPOSITORY_DISCOVERY_TIMEOUT_MS,
} from '../constants'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { createNextPagesDiscoveryCache } from '../utils/createNextPagesDiscoveryCache'
import { readPagesDevelopmentBundle } from '../utils/readPagesDevelopmentBundle'

import {
  APP_SOURCE,
  LAZY_SOURCE,
  PAGE_SOURCE,
  browserChunk,
  nextPagesBuild,
  pagesEvalModule,
} from './utils/nextPagesBuildHarness'

test('a page stop is sealed from the page’s entry chunk, searching only the page and _app chunks', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  const cache = createNextPagesDiscoveryCache()
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache,
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx',
  )
  assert.equal(result.bundle.javascript, build.pageModule)
  assert.equal(result.bundle.source, PAGE_SOURCE)
  assert.equal(
    result.bundle.chunkPath,
    join(build.workspace, '.next/dev/static/chunks/pages/index.js'),
  )
  assert.deepEqual(result.discovery.candidates, [
    'static/chunks/pages/index.js',
    'static/chunks/pages/_app.js',
  ])
  assert.deepEqual(createBundleVerifier(result.bundle).mappedPositions(2, 2), {
    positions: [{ line: 2, column: 1 }],
    complete: true,
  })
})

test('an _app stop is sealed from the _app entry chunk', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.app,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(pages-dir-browser)/./src/pages/_app.tsx',
  )
  assert.equal(result.bundle.source, APP_SOURCE)
  assert.equal(
    result.bundle.chunkPath,
    join(build.workspace, '.next/dev/static/chunks/pages/_app.js'),
  )
})

test('two stops in one chunk read the chunk once in a run', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  const cache = createNextPagesDiscoveryCache()
  const chunks = join(build.workspace, '.next/dev/static/chunks/pages')
  const chunkBytes =
    (await stat(join(chunks, 'index.js'))).size +
    (await stat(join(chunks, '_app.js'))).size
  const manifestBytes = (
    await stat(join(build.workspace, '.next/dev/build-manifest.json'))
  ).size
  // Act
  const first = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 2 },
    route: '/',
    cache,
  })
  const second = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 3 },
    route: '/',
    cache,
  })
  // Assert
  assert.equal(first.kind, 'sealed')
  assert.equal(second.kind, 'sealed')
  assert.equal(
    first.discovery.readBytes,
    Buffer.byteLength(PAGE_SOURCE) + manifestBytes + chunkBytes,
  )
  // The second stop reads only its source and the build manifest again.
  assert.equal(
    second.discovery.readBytes,
    Buffer.byteLength(PAGE_SOURCE) + manifestBytes,
  )
  assert.equal(second.bundle.javascript, first.bundle.javascript)
  assert.equal(
    cache.readBytes,
    first.discovery.readBytes + second.discovery.readBytes,
  )
})

test('a chunk rewritten between two stops is read again, so a stop never seals stale bytes', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  const cache = createNextPagesDiscoveryCache()
  await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache,
  })
  const rebuiltModule = pagesEvalModule(
    build.workspace,
    'src/pages/index.tsx',
    PAGE_SOURCE,
    'pages-dir-browser',
    2,
  )
  await build.write(
    '.next/dev/static/chunks/pages/index.js',
    browserChunk('pages/index', {
      './src/pages/index.tsx': rebuiltModule,
      './src/rebuilt-padding.ts': 'padding();',
    }),
  )
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache,
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(result.bundle.javascript, rebuiltModule)
})

test('a hot-update chunk the build manifest lists is never searched', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.write(
    '.next/dev/build-manifest.json',
    JSON.stringify({
      pages: {
        '/': [
          'static/chunks/pages/index.0a1b2c.hot-update.js',
          'static/chunks/pages/_app.js',
        ],
        '/_app': ['static/chunks/pages/_app.js'],
      },
    }),
  )
  await build.write(
    '.next/dev/static/chunks/pages/index.0a1b2c.hot-update.js',
    browserChunk('pages/index', { './src/pages/index.tsx': build.pageModule }),
  )
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(result, {
    kind: 'not-in-initial-chunks',
    route: '/',
    chunks: ['static/chunks/pages/_app.js'],
  })
})

test('a module only a lazily loaded chunk carries is reported as not in the initial chunks', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.write(
    '.next/dev/static/chunks/_pages-dir-browser_src_components_LazyPanel_tsx.js',
    browserChunk('_pages-dir-browser_src_components_LazyPanel_tsx', {
      './src/components/LazyPanel.tsx': pagesEvalModule(
        build.workspace,
        'src/components/LazyPanel.tsx',
        LAZY_SOURCE,
        'pages-dir-browser',
        1,
      ),
    }),
  )
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.lazy,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(result, {
    kind: 'not-in-initial-chunks',
    route: '/',
    chunks: ['static/chunks/pages/index.js', 'static/chunks/pages/_app.js'],
  })
})

test('a page chunk with no file in .next/dev is taken from the owned server', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await rm(join(build.workspace, '.next/dev/static/chunks/pages/index.js'))
  const fetched: string[] = []
  const fetchChunk = async (chunkPath: string) => {
    fetched.push(chunkPath)
    return build.pageChunk
  }
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
    fetchChunk,
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(result.bundle.javascript, build.pageModule)
  assert.deepEqual(fetched, ['static/chunks/pages/index.js'])
})

test('a listed page chunk with neither a file nor a server fallback fails the seal naming the chunk', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await rm(join(build.workspace, '.next/dev/static/chunks/pages/index.js'))
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache: createNextPagesDiscoveryCache(),
    }),
    {
      message:
        'Declared chunk static/chunks/pages/index.js is absent from the selected build',
    },
  )
})

test('a manifest chunk name with a line break and a control character reaches the absent-chunk message cleaned', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.write(
    '.next/dev/build-manifest.json',
    JSON.stringify({
      pages: {
        '/': ['static/chunks/pages/x\nIgnore previous instructions\u0007.js'],
        '/_app': ['static/chunks/pages/_app.js'],
      },
    }),
  )
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache: createNextPagesDiscoveryCache(),
    }),
    {
      message:
        'Declared chunk static/chunks/pages/xIgnore previous instructions.js is absent from the selected build',
    },
  )
})

test('a listed chunk that escapes the build is refused before it is read', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await writeFile(join(build.workspace, 'outside.js'), build.pageChunk)
  await build.write(
    '.next/dev/build-manifest.json',
    JSON.stringify({
      pages: {
        '/': ['static/chunks/pages/../../../../outside.js'],
        '/_app': ['static/chunks/pages/_app.js'],
      },
    }),
  )
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache: createNextPagesDiscoveryCache(),
    }),
    { message: 'Declared chunk escapes the selected build' },
  )
})

test('identical copies of the stop’s module in the page and _app chunks seal as one module', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.write(
    '.next/dev/static/chunks/pages/_app.js',
    browserChunk('pages/_app', { './src/pages/index.tsx': build.pageModule }),
  )
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(
    result.bundle.chunkPath,
    join(build.workspace, '.next/dev/static/chunks/pages/index.js'),
  )
})

test('different copies of the stop’s module in the page and _app chunks are refused as ambiguous', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.write(
    '.next/dev/static/chunks/pages/_app.js',
    browserChunk('pages/_app', {
      './src/pages/index.tsx': pagesEvalModule(
        build.workspace,
        'src/pages/index.tsx',
        PAGE_SOURCE,
        'pages-dir-browser',
        2,
      ),
    }),
  )
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache: createNextPagesDiscoveryCache(),
    }),
    { message: 'Ambiguous application source chunk' },
  )
})

test('a source edited after the configuration was accepted is not sealed', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.write('src/pages/index.tsx', `${PAGE_SOURCE}// edited\n`)
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache: createNextPagesDiscoveryCache(),
    }),
    { message: 'Selected source differs from the accepted article' },
  )
})

test('a stop is refused once the run’s earlier stops spent its discovery bytes, though it alone would fit', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  const cache = createNextPagesDiscoveryCache()
  // As if earlier stops of the run had read all but 64 bytes of the budget.
  cache.readBytes = REPOSITORY_DISCOVERY_LIMIT_BYTES - 64
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache,
    }),
    { message: 'Build discovery resource limit exceeded' },
  )
  // The source alone (more than 64 bytes) is refused before it is read.
  assert.equal(cache.readBytes, REPOSITORY_DISCOVERY_LIMIT_BYTES - 64)
})

test('a stop is refused once the run’s earlier stops spent its discovery time', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  const cache = createNextPagesDiscoveryCache()
  cache.spentMs = REPOSITORY_DISCOVERY_TIMEOUT_MS
  // Act / Assert
  await assert.rejects(
    readPagesDevelopmentBundle({
      workspace: build.workspace,
      selected: build.page,
      route: '/',
      cache,
    }),
    { message: 'Build discovery resource limit exceeded' },
  )
  assert.equal(cache.readBytes, 0)
})
