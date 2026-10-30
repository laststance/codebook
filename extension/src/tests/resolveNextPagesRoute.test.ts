import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { z } from 'zod'

import { resolveNextPagesRoute } from '../utils/resolveNextPagesRoute'

// Synthetic manifests (the file's `synthetic` field says so): no Next example of the required projects has dynamic Pages routes.
const SYNTHETIC_MANIFESTS = z
  .object({
    synthetic: z.string(),
    manifests: z.record(z.string(), z.record(z.string(), z.string())),
  })
  .parse(
    JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../src/tests/fixtures/next-pages/synthetic-routes/pages-manifests.json',
        ),
        'utf8',
      ),
    ),
  ).manifests
// The manifest a Next 16.4.3 dev server wrote for TanStack/query examples/react/nextjs after GET / (Cycle 0065 Task 0).
const MEASURED_PAGES_MANIFEST = z
  .record(z.string(), z.string())
  .parse(
    JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../src/tests/fixtures/next-pages/nextjs/pages-manifest.json',
        ),
        'utf8',
      ),
    ),
  )

const PRECEDENCE_CASES = [
  {
    behavior:
      'a static segment wins at the first differing segment, though the other route has a static segment later',
    entryPath: '/a/b',
    expected: {
      kind: 'matched',
      route: '/a/[y]',
      compiledPath: 'pages/a/[y].js',
    },
  },
  {
    behavior: 'a static route wins over a dynamic route at the same position',
    entryPath: '/posts/new',
    expected: {
      kind: 'matched',
      route: '/posts/new',
      compiledPath: 'pages/posts/new.js',
    },
  },
  {
    behavior: 'a dynamic segment wins over a catch-all at the same position',
    entryPath: '/posts/42',
    expected: {
      kind: 'matched',
      route: '/posts/[id]',
      compiledPath: 'pages/posts/[id].js',
    },
  },
  {
    behavior: 'a catch-all takes several segments',
    entryPath: '/posts/2024/10',
    expected: {
      kind: 'matched',
      route: '/posts/[...rest]',
      compiledPath: 'pages/posts/[...rest].js',
    },
  },
  {
    behavior: 'a catch-all needs at least one segment',
    entryPath: '/posts',
    expected: { kind: 'unmatched' },
  },
  {
    behavior: 'an optional catch-all also matches its parent path',
    entryPath: '/docs',
    expected: {
      kind: 'matched',
      route: '/docs/[[...slug]]',
      compiledPath: 'pages/docs/[[...slug]].js',
    },
  },
  {
    behavior: 'an optional catch-all takes several segments',
    entryPath: '/docs/getting/started',
    expected: {
      kind: 'matched',
      route: '/docs/[[...slug]]',
      compiledPath: 'pages/docs/[[...slug]].js',
    },
  },
  {
    behavior: 'the root path selects the index page',
    entryPath: '/',
    expected: { kind: 'matched', route: '/', compiledPath: 'pages/index.js' },
  },
  {
    behavior: 'a trailing slash is dropped',
    entryPath: '/a/b/',
    expected: {
      kind: 'matched',
      route: '/a/[y]',
      compiledPath: 'pages/a/[y].js',
    },
  },
  {
    behavior: 'the query is dropped, so a static segment still matches',
    entryPath: '/posts/new?from=home&page=2',
    expected: {
      kind: 'matched',
      route: '/posts/new',
      compiledPath: 'pages/posts/new.js',
    },
  },
  {
    behavior: 'an encoded segment is decoded before it is compared',
    entryPath: '/caf%C3%A9',
    expected: {
      kind: 'matched',
      route: '/café',
      compiledPath: 'pages/café.js',
    },
  },
  {
    behavior: 'a manifest value with a .. segment is ignored',
    entryPath: '/unsafe',
    expected: { kind: 'unmatched' },
  },
  {
    behavior: 'a manifest value with a backslash is ignored',
    entryPath: '/backslash',
    expected: { kind: 'unmatched' },
  },
  {
    behavior: 'a manifest value outside pages/ is ignored',
    entryPath: '/elsewhere',
    expected: { kind: 'unmatched' },
  },
] as const

for (const { behavior, entryPath, expected } of PRECEDENCE_CASES)
  test(`Pages route resolution: ${behavior} (${entryPath})`, () => {
    // Arrange
    const manifest = SYNTHETIC_MANIFESTS.precedence!
    // Act
    const resolution = resolveNextPagesRoute(manifest, entryPath)
    // Assert
    assert.deepEqual(resolution, expected)
  })

for (const entryPath of ['/_app', '/_document', '/_error', '/404', '/500'])
  test(`Pages route resolution never enters Next's own ${entryPath} page`, () => {
    // Arrange
    const manifest = SYNTHETIC_MANIFESTS.precedence!
    // Act
    const resolution = resolveNextPagesRoute(manifest, entryPath)
    // Assert
    assert.deepEqual(resolution, { kind: 'unmatched' })
  })

test('Pages route resolution prefers a dynamic segment over an optional catch-all and leaves the rest to the catch-all', () => {
  // Arrange
  const manifest = SYNTHETIC_MANIFESTS.dynamicBeforeOptionalCatchAll!
  // Act
  const oneSegment = resolveNextPagesRoute(manifest, '/shop/1')
  const twoSegments = resolveNextPagesRoute(manifest, '/shop/1/2')
  const parent = resolveNextPagesRoute(manifest, '/shop')
  // Assert
  assert.deepEqual(oneSegment, {
    kind: 'matched',
    route: '/shop/[id]',
    compiledPath: 'pages/shop/[id].js',
  })
  assert.deepEqual(twoSegments, {
    kind: 'matched',
    route: '/shop/[[...all]]',
    compiledPath: 'pages/shop/[[...all]].js',
  })
  assert.deepEqual(parent, {
    kind: 'matched',
    route: '/shop/[[...all]]',
    compiledPath: 'pages/shop/[[...all]].js',
  })
})

test('a root optional catch-all page serves the root path', () => {
  // Arrange
  const manifest = SYNTHETIC_MANIFESTS.rootOptionalCatchAll!
  // Act
  const resolution = resolveNextPagesRoute(manifest, '/')
  // Assert
  assert.deepEqual(resolution, {
    kind: 'matched',
    route: '/[[...slug]]',
    compiledPath: 'pages/[[...slug]].js',
  })
})

test('two Pages routes of equal precedence leave the entry path unmatched instead of picking one', () => {
  // Arrange
  const manifest = SYNTHETIC_MANIFESTS.equalPrecedence!
  // Act
  const resolution = resolveNextPagesRoute(manifest, '/anything')
  // Assert
  assert.deepEqual(resolution, { kind: 'unmatched' })
})

test('the measured Next 16 Pages manifest of the P02 example resolves the root entry path to its index page', () => {
  // Arrange
  const manifest = MEASURED_PAGES_MANIFEST
  // Act
  const resolution = resolveNextPagesRoute(manifest, '/')
  // Assert
  assert.deepEqual(resolution, {
    kind: 'matched',
    route: '/',
    compiledPath: 'pages/index.js',
  })
})
