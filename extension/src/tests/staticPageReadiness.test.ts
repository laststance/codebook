import assert from 'node:assert/strict'
import { test } from 'node:test'

import { discoverStaticPages } from '../utils/discoverStaticPages'
import {
  firstBareImport,
  judgeStaticPage,
  readStaticPageReadiness,
  staticPageEntryFile,
} from '../utils/readStaticPageReadiness'

import { createStaticPageRepository } from './utils/staticPageFixture'

// Value: protects=AC 1 a plain page whose scripts exist as written (and whose imports are URLs) is listed ready with its entry file; fails_when=a servable page is listed not ready or loses its entry; no_claim=that a browser runs the page (no browser here)
test('a page whose files exist and whose imports are URLs is listed ready with its entry file', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  // Act
  const readiness = await readStaticPageReadiness(repository.pageFolder)
  // Assert
  assert.deepEqual(readiness, { ready: true, missing: [], entry: 'index.html' })
})

// Value: protects=AC 1 a page that names a script file the folder lacks is listed not ready with needs-bundler and the first offending reference; fails_when=the page is listed ready, or the gap does not name the reference; no_claim=that the named file would build with any bundler
test('a page whose script src is not a file of the folder is listed needs-bundler naming that reference', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><html><body><script type="module" src="/src/main.tsx"></script><script src="other.js"></script></body></html>',
  })
  // Act
  const readiness = await readStaticPageReadiness(repository.pageFolder)
  const problem = await judgeStaticPage(repository.pageFolder, '/')
  // Assert
  assert.deepEqual(readiness, {
    ready: false,
    missing: ['needs-bundler: /src/main.tsx'],
    entry: 'index.html',
  })
  assert.deepEqual(problem, {
    gap: 'needs-bundler',
    reference: '/src/main.tsx',
    kind: 'missing-file',
  })
})

// Value: protects=AC 1 an inline module script that imports a bare specifier (only a bundler resolves it) is listed needs-bundler naming the specifier; fails_when=a bare import is listed ready, or a relative or URL import is refused; no_claim=imports deeper than one level
test('an inline module script importing a bare specifier is listed needs-bundler, a relative or URL import is not', async (context) => {
  // Arrange
  const bare = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="module">\nimport { createStore } from "redux"\ncreateStore()\n</script>',
  })
  const sideEffect = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="module">\nimport \'left-pad\'\n</script>',
  })
  const fine = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="module">\nimport { a } from "./main.js"\nimport("https://unpkg.com/x@1/a.js")\n</script>',
  })
  // Act
  const results = await Promise.all(
    [bare, sideEffect, fine].map((repository) =>
      readStaticPageReadiness(repository.pageFolder),
    ),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.missing),
    [['needs-bundler: redux'], ['needs-bundler: left-pad'], []],
  )
})

// Value: protects=AC 1 a same-origin module script that imports a bare specifier is found one level deep; fails_when=only the entry page is read; no_claim=imports of that script's own imports
test('a same-origin module script that imports a bare specifier makes the page needs-bundler', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    'main.js': 'import dayjs from "dayjs"\nwindow.day = dayjs()\n',
  })
  // Act
  const problem = await judgeStaticPage(repository.pageFolder, '/')
  // Assert
  assert.deepEqual(problem, {
    gap: 'needs-bundler',
    reference: 'dayjs',
    kind: 'bare-import',
  })
})

// Value: protects=AC 1 a folder without the entry page is listed no-entry-page, and an app of another adapter is listed not-a-static-page; fails_when=either is listed ready; no_claim=that the other adapter can run the app
test('a folder without index.html is no-entry-page and a Vite app is not-a-static-page', async (context) => {
  // Arrange
  const empty = await createStaticPageRepository(context, {
    'other.html': '<html></html>',
  })
  const viteApp = await createStaticPageRepository(context, {
    'package.json': JSON.stringify({ devDependencies: { vite: '^8.0.0' } }),
  })
  // Act
  const notThere = await judgeStaticPage(empty.pageFolder, '/missing.html')
  const named = await judgeStaticPage(empty.pageFolder, '/other.html')
  const vite = await judgeStaticPage(viteApp.pageFolder, '/')
  // Assert
  assert.deepEqual(notThere, { gap: 'no-entry-page', entry: 'missing.html' })
  assert.equal(named, undefined)
  assert.deepEqual(vite, { gap: 'not-a-static-page', adapter: 'vite-dev' })
})

// Value: protects=AC 1 the entry path names an .html file inside the folder and nothing else; fails_when=a path with a dot segment or another extension is accepted as the entry; no_claim=the browser's navigation to it
test('the entry path maps to an .html file inside the folder only', () => {
  // Arrange
  const paths = ['/', '/demo/page.html?x=1', '/../x.html', '/script.js']
  // Act
  const files = paths.map(staticPageEntryFile)
  // Assert
  assert.deepEqual(files, [
    'index.html',
    'demo/page.html',
    undefined,
    undefined,
  ])
})

// Value: protects=AC 1 the bare-import finder reads static, side-effect, export-from and dynamic imports and ignores relative, absolute and URL specifiers; fails_when=a form of import is missed or a relative import is flagged; no_claim=code in comments or strings
test('the bare-import finder reads every import form and ignores paths and URLs', () => {
  // Arrange
  const forms = [
    "import { a } from 'pkg'",
    "import 'pkg'",
    "export * from 'pkg'",
    "const lazy = import('pkg')",
  ]
  const ignored = [
    "import a from './a.js'",
    "import a from '../a.js'",
    "import a from '/a.js'",
    "import a from 'https://unpkg.com/x@1/a.js'",
  ]
  // Act
  const found = forms.map((form) => firstBareImport(form))
  const skipped = ignored.map((form) => firstBareImport(form))
  // Assert
  assert.deepEqual(found, ['pkg', 'pkg', 'pkg', 'pkg'])
  assert.deepEqual(skipped, [undefined, undefined, undefined, undefined])
})

// Value: protects=AC 1 status lists the pages under examples and apps (and the root when it is a page) with their own readiness, skipping other adapters' apps and linked folders; fails_when=a page is missing, an app of another adapter is listed, or the readiness is not per page; no_claim=Git placement (the listing needs none)
test('the discovery lists examples and apps pages with their readiness and skips other adapters apps', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    '../needs/index.html': '<script src="/src/main.tsx"></script>',
    '../vite-app/index.html': '<html></html>',
    '../vite-app/package.json': JSON.stringify({ dependencies: { vite: '1' } }),
  })
  // Act
  const discovery = await discoverStaticPages(repository.root)
  // Assert
  assert.equal(discovery.rootIsApp, false)
  assert.deepEqual(discovery.packages, [
    {
      packageRoot: 'examples/needs',
      ready: false,
      missing: ['needs-bundler: /src/main.tsx'],
      entry: 'index.html',
    },
    {
      packageRoot: 'examples/page',
      ready: true,
      missing: [],
      entry: 'index.html',
    },
  ])
  assert.equal(discovery.packagesTruncated, false)
})
