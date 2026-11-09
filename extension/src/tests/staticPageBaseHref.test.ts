import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { findCdnPackageImports } from '../utils/findCdnPackageImports'
import { readStaticPageHtml } from '../utils/readStaticPageHtml'
import { readStaticPageReadiness } from '../utils/readStaticPageReadiness'
import { readStaticPageScriptTexts } from '../utils/readStaticPageScriptTexts'
import { resolveStaticPageScriptPath } from '../utils/resolveStaticPageScriptPath'

import { createStaticPageRepository } from './utils/staticPageFixture'

// Value: protects=the page's first base href with an href is read as written; fails_when=a later or href-less base wins, or a page without a base reports one; no_claim=resolution of the href
test('reads the first base element that has an href', () => {
  // Arrange
  const html =
    '<head><base target="_blank"><base href="sub/"><base href="other/"></head>'

  // Act
  const withBase = readStaticPageHtml(html).baseHref
  const withoutBase = readStaticPageHtml(
    '<script src="a.js"></script>',
  ).baseHref

  // Assert
  assert.equal(withBase, 'sub/')
  assert.equal(withoutBase, undefined)
})

// Value: protects=a script src resolves against the directory of the page's base href like a browser; fails_when=the entry folder is used despite a base, a file-name base keeps its file name, or a root-absolute src follows the base; no_claim=files existing
test('resolves a script src against the base href directory', () => {
  // Arrange
  const resolve = (source: string, base: string | undefined) =>
    resolveStaticPageScriptPath(source, 'demo', base)

  // Act
  const results = {
    rootBase: resolve('main.js', '/sub/'),
    relativeBase: resolve('main.js', 'sub/'),
    fileBase: resolve('main.js', 'sub/page.html'),
    rootFileBase: resolve('main.js', '/sub/page'),
    queryBase: resolve('main.js', 'sub/?v=1#top'),
    rootAbsoluteSource: resolve('/x.js', '/sub/'),
    noBase: resolve('main.js', undefined),
  }

  // Assert
  assert.deepEqual(results, {
    rootBase: 'sub/main.js',
    relativeBase: 'demo/sub/main.js',
    fileBase: 'demo/sub/main.js',
    rootFileBase: 'sub/main.js',
    queryBase: 'demo/sub/main.js',
    rootAbsoluteSource: 'x.js',
    noBase: 'demo/main.js',
  })
})

// Value: protects=a remote base makes relative and root-absolute sources remote, and a base that leaves the folder or is malformed names no file; fails_when=such a source resolves to a file of the folder; no_claim=readiness wording
test('treats sources under a remote or unusable base href as no file of the folder', () => {
  // Arrange
  const resolve = (source: string, base: string) =>
    resolveStaticPageScriptPath(source, 'demo', base)

  // Act
  const results = [
    resolve('main.js', 'https://cdn.example.test/lib/'),
    resolve('main.js', '//cdn.example.test/lib/'),
    resolve('/x.js', 'https://cdn.example.test/lib/'),
    resolve('main.js', '../../outside/'),
    resolve('main.js', '/%E0%A4%A/'),
  ]

  // Assert
  assert.deepEqual(results, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

// Value: protects=readiness looks for a script where the base href puts it; fails_when=a runnable page whose main.js sits below its base is refused needs-bundler, or a bare import in the based script is missed; no_claim=server wait
test('a page is judged by the script its base href names', async (context) => {
  // Arrange
  const based = await createStaticPageRepository(context, {
    'index.html':
      '<base href="sub/"><script src="main.js"></script><link rel="stylesheet" href="a.css">',
    'sub/main.js': 'window.ready = true\n',
    'sub/a.css': 'body{}\n',
  })
  await writeFile(join(based.pageFolder, 'main.js'), 'import "lib"\n')
  const bare = await createStaticPageRepository(context, {
    'index.html': '<base href="sub/"><script src="main.js"></script>',
    'sub/main.js': 'import { x } from "lib"\n',
  })
  const missing = await createStaticPageRepository(context, {
    'index.html': '<base href="/nowhere/"><script src="main.js"></script>',
  })

  // Act
  const basedReadiness = await readStaticPageReadiness(based.pageFolder)
  const bareReadiness = await readStaticPageReadiness(bare.pageFolder)
  const missingReadiness = await readStaticPageReadiness(missing.pageFolder)

  // Assert
  assert.deepEqual(basedReadiness, {
    ready: true,
    missing: [],
    entry: 'index.html',
  })
  assert.deepEqual(bareReadiness, {
    ready: false,
    missing: ['needs-bundler: lib'],
    entry: 'index.html',
  })
  assert.equal(missingReadiness.ready, false)
})

// Value: protects=the CDN search reads the script the base href names; fails_when=the library import in sub/main.js is missed because the root main.js is read; no_claim=packing
test('finds the CDN import of the script below the base href', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  await mkdir(join(repository.pageFolder, 'sub'), { recursive: true })
  await writeFile(
    join(repository.pageFolder, 'sub', 'main.js'),
    'import { double } from "https://unpkg.com/lib@latest/dist/lib.mjs"\n',
  )
  const html = '<base href="sub/"><script src="main.js"></script>'

  // Act
  const texts = await readStaticPageScriptTexts(
    repository.pageFolder,
    'index.html',
    html,
  )
  const imports = findCdnPackageImports(html, 'lib', texts)

  // Assert
  assert.deepEqual(imports, [
    {
      url: 'https://unpkg.com/lib@latest/dist/lib.mjs',
      path: 'dist/lib.mjs',
    },
  ])
})
