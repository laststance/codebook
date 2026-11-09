import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { STATIC_PAGE_ADAPTER } from '../staticPageDevAdapter'
import { readRepositoryAdapterReadiness } from '../utils/readRepositoryAdapterReadiness'
import {
  firstBareImport,
  judgeStaticPage,
  readStaticPageReadiness,
  staticPageEntryFile,
} from '../utils/readStaticPageReadiness'
import { readStatusAdapterReadiness } from '../utils/readStatusAdapterReadiness'
import { repositoryBrowserStartPrerequisites } from '../utils/repositoryBrowserStartPrerequisites'

import { removeTestFolder } from './utils/removeTestFolder'
import { createStaticPageRepository } from './utils/staticPageFixture'

// Value: protects=a root static-page start in a repository without Next waits on the static-page readiness status lists, not on Next's; fails_when=static-page falls through to the profile's Next readiness and the start is refused about Next; no_claim=the readiness content itself
test('a static-page start in a repository without Next reads the static-page readiness entry', () => {
  // Arrange
  const report = {
    ready: true,
    missing: [],
    profiles: {
      'repository-browser': {
        ready: false,
        missing: ['next is not installed.'],
        adapters: { 'static-page': { ready: true, missing: [] } },
      },
    },
  } as unknown as Parameters<typeof repositoryBrowserStartPrerequisites>[0]
  const withoutEntry = {
    ready: true,
    missing: [],
    profiles: {
      'repository-browser': {
        ready: false,
        missing: ['next is not installed.'],
        adapters: {},
      },
    },
  } as unknown as Parameters<typeof repositoryBrowserStartPrerequisites>[0]
  const configuration = { adapter: 'static-page' }
  // Act
  const ready = repositoryBrowserStartPrerequisites(
    report,
    'repository-browser',
    configuration,
  )
  const unavailable = repositoryBrowserStartPrerequisites(
    withoutEntry,
    'repository-browser',
    configuration,
  )
  // Assert
  assert.deepEqual(ready, { ready: true, missing: [] })
  assert.deepEqual(unavailable, {
    ready: false,
    missing: [
      "Codebook could not read the static-page adapter's readiness for this window. Call codebook_status again, or reload the window, and retry.",
    ],
  })
})

// Value: protects=a script with thousands of spaces after import cannot freeze the extension host, and a real bare import later in the text is still found; fails_when=the import scan backtracks on white space (seconds for 2000 spaces) or stops finding imports; no_claim=imports beyond the scan cap
test('a script with 8000 spaces after import is scanned in well under a second and still reports a later bare import', () => {
  // Arrange
  const hostile = `import${' '.repeat(8000)}x\nimport { a } from 'lib'\n`
  const startedAt = performance.now()
  // Act
  const found = firstBareImport(hostile)
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.equal(found, 'lib')
  assert.ok(elapsedMs < 100, `scan took ${elapsedMs} ms`)
})

// Value: protects=repeated import keywords with no clause end do not make the scan quadratic; fails_when=every keyword re-walks the text after it; no_claim=imports in the repeated text
test('a script of 40000 repeated import keywords is scanned in under 100 ms', () => {
  // Arrange
  const hostile = 'import '.repeat(40_000)
  const startedAt = performance.now()
  // Act
  const found = firstBareImport(hostile)
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.equal(found, undefined)
  assert.ok(elapsedMs < 100, `scan took ${elapsedMs} ms`)
})

// Value: protects=icons, canonical links, hints and remote scripts are not judged as files of the folder, while a missing stylesheet still is; fails_when=a favicon, canonical link, //cdn or http: script makes a servable page needs-bundler, or a missing stylesheet passes; no_claim=that the remote files load
test('a page with an absent icon, a canonical link and remote scripts is ready, a missing stylesheet is still needs-bundler', async (context) => {
  // Arrange
  const servable = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><link rel="icon" href="favicon.ico"><link rel="canonical" href="/"><link rel="preconnect" href="https://cdn.example.test"><script src="//cdn.example.test/a.js"></script><script src="http://app.example.test/b.js"></script><script src="blob:abc"></script>',
  })
  const stylesheet = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><link rel="stylesheet" href="style.css"><script src="main.js"></script>',
  })
  const preload = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><link rel="preload" as="script" href="gone.js">',
  })
  // Act
  const readyReadiness = await readStaticPageReadiness(servable.pageFolder)
  const stylesheetReadiness = await readStaticPageReadiness(
    stylesheet.pageFolder,
  )
  const preloadReadiness = await readStaticPageReadiness(preload.pageFolder)
  // Assert
  assert.deepEqual(readyReadiness, {
    ready: true,
    missing: [],
    entry: 'index.html',
  })
  assert.deepEqual(stylesheetReadiness.missing, ['needs-bundler: style.css'])
  assert.deepEqual(preloadReadiness.missing, ['needs-bundler: gone.js'])
})

// Value: protects=a bare specifier the entry page's import map maps (by key or by a key ending in a slash) is ready, an unmapped one and a malformed map stay needs-bundler; fails_when=a mapped import is refused or an unmapped or malformed-map import is accepted; no_claim=that the mapped URL loads
test('an import map exempts the specifiers it maps and a malformed map exempts none', async (context) => {
  // Arrange
  const mapped = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="importmap">{"imports":{"lib":"https://cdn.example.test/lib.js","util/":"https://cdn.example.test/util/"}}</script><script type="module">import "lib"\nimport "util/a.js"</script>',
  })
  const unmapped = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="importmap">{"imports":{"lib":"https://cdn.example.test/lib.js"}}</script><script type="module">import "other"</script>',
  })
  const malformed = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="importmap">{"imports":</script><script type="module">import "lib"</script>',
  })
  const scoped = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script type="importmap">{"scopes":{"/a/":{"lib":"https://cdn.example.test/lib.js"}}}</script><script type="module">import "lib"</script>',
  })
  // Act
  const results = await Promise.all(
    [mapped, unmapped, malformed, scoped].map((repository) =>
      readStaticPageReadiness(repository.pageFolder),
    ),
  )
  // Assert
  assert.deepEqual(
    results.map((readiness) => readiness.missing),
    [[], ['needs-bundler: other'], ['needs-bundler: lib'], []],
  )
})

// Value: protects=a malformed percent-encoding in a reference is a missing file and in the entry path an unreadable entry, on the status read and on the start path, never a raw URIError; fails_when=decodeURI throws out of readiness or the adapter's workspace check; no_claim=other bad encodings
test('a malformed percent-encoding is needs-bundler for a reference and a coded entry-unreadable refusal for the entry path', async (context) => {
  // Arrange
  const badReference = await createStaticPageRepository(context, {
    'index.html': '<!doctype html><script src="a%zz.js"></script>',
  })
  const page = await createStaticPageRepository(context)
  // Act
  const readiness = await readStaticPageReadiness(badReference.pageFolder)
  const problem = await judgeStaticPage(page.pageFolder, '/a%zz.html')
  const refusal = await STATIC_PAGE_ADAPTER.assertWorkspace(
    page.pageFolder,
    process.execPath,
    new AbortController().signal,
    undefined,
    undefined,
    undefined,
    undefined,
    await page.resolvePage(),
    '/a%zz.html',
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.deepEqual(readiness.missing, ['needs-bundler: a%zz.js'])
  assert.equal(problem?.gap, 'entry-unreadable')
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'STATIC_PAGE_UNSUPPORTED')
  assert.equal(refusal.details?.reason, 'entry-unreadable')
})

// Value: protects=an entry path ending in a slash names the folder's index.html as the server serves it; fails_when=a trailing-slash entry is reported as no entry file; no_claim=the server's own routing
test('an entry path ending in a slash resolves to the index page of that folder', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    'dir/index.html': '<!doctype html><title>dir</title>',
  })
  // Act
  const entry = staticPageEntryFile('/dir/')
  const readiness = await readStaticPageReadiness(
    repository.pageFolder,
    '/dir/',
  )
  // Assert
  assert.equal(entry, 'dir/index.html')
  assert.equal(staticPageEntryFile('/'), 'index.html')
  assert.deepEqual(readiness, {
    ready: true,
    missing: [],
    entry: 'dir/index.html',
  })
})

// Value: protects=a root that cannot be read reports a documented gap code, not free text; fails_when=the missing entry is a sentence; no_claim=which read failed
test('a workspace whose real path cannot be resolved reports the entry-unreadable gap code', async () => {
  // Arrange
  const absent = join(tmpdir(), 'codebook-absent-page-root-f2')
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    absent,
    process.execPath,
    new AbortController().signal,
  )
  // Assert
  assert.deepEqual(readiness['static-page'].missing, ['entry-unreadable'])
})

// Value: protects=status lists the pages of a folder outside any Git repository, because the static scan needs no Git; fails_when=the listing is empty with git-failed for a folder outside any repository; no_claim=the nested-in-Git recovery report
test('status lists the static pages of a folder that Git cannot place', async (context) => {
  // Arrange
  const gitRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-page-nested-')),
  )
  context.after(() => removeTestFolder(gitRoot))
  const opened = join(gitRoot, 'sub')
  await mkdir(join(opened, 'examples', 'page'), { recursive: true })
  await writeFile(
    join(opened, 'examples', 'page', 'index.html'),
    '<!doctype html><title>page</title>',
  )
  // Act
  const report = await readStatusAdapterReadiness(
    opened,
    process.execPath,
    new AbortController().signal,
  )
  // Assert
  assert.deepEqual(report['static-page'].packages, [
    {
      packageRoot: 'examples/page',
      ready: true,
      missing: [],
      entry: 'index.html',
    },
  ])
  assert.equal(report['static-page'].packagesTruncated, false)
})
