import assert from 'node:assert/strict'
import { test } from 'node:test'

import { listRelativePackedImports } from '../utils/listRelativePackedImports'
import { listStaticImportSpecifiers } from '../utils/listStaticImportSpecifiers'
import { readStaticPageHtml } from '../utils/readStaticPageHtml'
import { resolveStaticPageScriptPath } from '../utils/resolveStaticPageScriptPath'
import { studyHoldsLibraryFacts } from '../utils/studyHoldsLibraryFacts'

/** The configuration argument of {@link studyHoldsLibraryFacts}, reduced to the two fields the function reads. */
function configurationOf(
  fields: Record<string, unknown>,
): Parameters<typeof studyHoldsLibraryFacts>[1] {
  // Only `version` and `library` are read, so a full configuration would add nothing to these cases.
  return fields as unknown as Parameters<typeof studyHoldsLibraryFacts>[1]
}

// Value: protects=readiness finds the bare package a page script imports, and only real import statements count; fails_when=a mid-line or string occurrence is read as an import, or a side-effect or re-export is missed; why_new=no test names listStaticImportSpecifiers; seam=none; no_claim=readiness verdict (scanner only; fixtures are literal script texts)
test('lists the specifiers of import and export-from statements and skips look-alikes inside code', () => {
  // Arrange
  const script = [
    "import { a, b as c } from 'lib'",
    "import './side-effect.js'",
    "export * from './reexport.js'",
    'const note = \'import nothing from "fake"\'',
    "foo(); import x from 'after-semicolon'",
    "import broken from 'unterminated",
    'export const value = 1',
  ].join('\n')

  // Act
  const specifiers = listStaticImportSpecifiers(script)

  // Assert
  assert.deepEqual(specifiers, [
    'lib',
    './side-effect.js',
    './reexport.js',
    'after-semicolon',
  ])
})

// Value: protects=a script with a huge white space run is scanned in linear time and past the scan limit nothing is read; fails_when=the clause walk backtracks or the scan limit is dropped, freezing codebook_status; why_new=no test names listStaticImportSpecifiers; seam=none; no_claim=exact limit value (only that it is bounded)
test('scans a script made of a million spaces after import without stalling and ignores imports past the scan limit', () => {
  // Arrange
  const hostile = `import${' '.repeat(1_000_000)}x`
  const pastLimit = `${' '.repeat(1_048_576)}\nimport y from 'late'`

  // Act
  const startedAt = Date.now()
  const hostileSpecifiers = listStaticImportSpecifiers(hostile)
  const pastLimitSpecifiers = listStaticImportSpecifiers(pastLimit)
  const elapsedMs = Date.now() - startedAt

  // Assert
  assert.deepEqual(hostileSpecifiers, [])
  assert.deepEqual(pastLimitSpecifiers, [])
  // gstack-timing-ok: the bound is the contract (no host freeze); a backtracking walk never finishes on a million spaces, a linear one takes milliseconds, so 2 s leaves room for coverage and a loaded runner
  assert.ok(elapsedMs < 2000, `scan took ${elapsedMs} ms`)
})

// Value: protects=a page script src resolves to a folder-relative file, and remote, malformed or escaping references name no file; fails_when=a CDN script or a path leaving the folder is read as a repository file; why_new=no test names resolveStaticPageScriptPath; seam=none; no_claim=file existence (path arithmetic only)
test('resolves script sources inside the entry folder and refuses remote, malformed and escaping references', () => {
  // Arrange
  const cases: Array<[string, string, string | undefined]> = [
    ['app.js?v=1', 'examples/page', 'examples/page/app.js'],
    ['/shared/app.js#top', 'examples/page', 'shared/app.js'],
    ['./sub/../app.js', '.', 'app.js'],
    ['https://app.example.test/x.js', '.', undefined],
    ['//app.example.test/x.js', '.', undefined],
    ['%E0%A4%A.js', '.', undefined],
    ['../outside.js', '.', undefined],
  ]

  // Act
  const resolved = cases.map(([source, folder]) =>
    resolveStaticPageScriptPath(source, folder),
  )

  // Assert
  assert.deepEqual(
    resolved,
    cases.map(([, , expected]) => expected),
  )
})

// Value: protects=only relative imports that stay in the library's CDN folder are followed, each once; fails_when=a specifier leaving the package folder or a duplicate is returned; why_new=no test names listRelativePackedImports; seam=none; no_claim=fetching of the files (specifier parsing only)
test('lists relative packed imports once each and drops those leaving the package folder', () => {
  // Arrange
  const importer = 'https://unpkg.com/lib@1.0.0/dist/lib.mjs'
  const text = [
    "import './chunk.mjs'",
    "export { a } from './chunk.mjs'",
    "const more = import('../extra/util.mjs')",
    "import '../../other-package@2/x.mjs'",
    "import 'bare-package'",
  ].join('\n')

  // Act
  const imports = listRelativePackedImports(text, importer, 'lib')

  // Assert
  assert.deepEqual(imports, [
    {
      url: 'https://unpkg.com/lib@1.0.0/dist/chunk.mjs',
      path: 'dist/chunk.mjs',
    },
    {
      url: 'https://unpkg.com/lib@1.0.0/extra/util.mjs',
      path: 'extra/util.mjs',
    },
  ])
})

// Value: protects=format 23 keeps library facts only when its configuration declares library, formats 16 to 18 always do; fails_when=a static-page run without library saves library facts or one with library drops them; why_new=no test names studyHoldsLibraryFacts; seam=none; no_claim=capture of the facts (decision only; configurations are reduced stand-ins)
test('keeps library facts for formats 16 to 18 and for format 23 only when the run declares a library', () => {
  // Arrange
  const withLibrary = configurationOf({
    version: 3,
    adapter: 'static-page',
    library: { packageRoot: 'packages/lib' },
  })
  const withoutLibrary = configurationOf({
    version: 3,
    adapter: 'static-page',
  })

  // Act
  const results = {
    vite: studyHoldsLibraryFacts(16, withoutLibrary),
    reactScripts: studyHoldsLibraryFacts(17, withoutLibrary),
    next: studyHoldsLibraryFacts(18, withoutLibrary),
    staticWithLibrary: studyHoldsLibraryFacts(23, withLibrary),
    staticWithoutLibrary: studyHoldsLibraryFacts(23, withoutLibrary),
    otherFormat: studyHoldsLibraryFacts(22, withLibrary),
  }

  // Assert
  assert.deepEqual(results, {
    vite: true,
    reactScripts: true,
    next: true,
    staticWithLibrary: true,
    staticWithoutLibrary: false,
    otherFormat: false,
  })
})

// Value: protects=the page reader returns scripts, judged links and import-map keys with the inline script's zero-based position; fails_when=an icon link, a JSON block or a malformed import map is judged, or a position is off by one; why_new=staticPageInlineScripts covers binding, not the reader's output; seam=none; no_claim=readiness verdict (parser output only)
test('reads inline script positions, external sources, judged links and import map keys of a page', () => {
  // Arrange
  const html = [
    '<!doctype html>',
    '<link rel="stylesheet" href="style.css">',
    '<link rel="icon" href="favicon.ico">',
    '<link rel="preload" as="script" href="pre.js">',
    '<script type="importmap">{"imports":{"lib":"./lib.js"},"scopes":{"/a/":{"lib/":"./b/"}}}</script>',
    '<script type="importmap">{not json</script>',
    '<script type="application/json">{"a":1}</script>',
    '<script src="app.js"></script>',
    '<script type="module">',
    'let a = 1',
    '</script>',
  ].join('\n')

  // Act
  const page = readStaticPageHtml(html)

  // Assert
  assert.deepEqual(page.scriptSources, ['app.js'])
  assert.deepEqual(page.linkHrefs, ['style.css', 'pre.js'])
  assert.deepEqual(page.importMapKeys, ['lib', 'lib/'])
  assert.equal(page.inlineScripts.length, 1)
  assert.equal(page.inlineScripts[0]?.isModule, true)
  assert.equal(page.inlineScripts[0]?.startLine, 8)
  assert.equal(page.inlineScripts[0]?.text, '\nlet a = 1\n')
})
