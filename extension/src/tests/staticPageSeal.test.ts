import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { DEFAULT_SOURCE_MAP_LIMITS } from '../sourceMapLimits'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { isStaticPageScriptOfModule } from '../utils/isStaticPageScriptOfModule'
import {
  sealStaticPageScript,
  type StaticPageSealRequest,
} from '../utils/sealStaticPageScript'
import { startStaticPageServer } from '../utils/startStaticPageServer'

import {
  createStaticPageRepository,
  STATIC_PAGE_HTML,
  STATIC_PAGE_SCRIPT,
  stopOf,
  type StaticPageRepository,
} from './utils/staticPageFixture'

/** Starts the static server on the fixture page and builds the seal request of one stop. */
async function sealRequestOf(
  context: Parameters<typeof createStaticPageRepository>[0],
  repository: StaticPageRepository,
  source: StaticPageSealRequest['source'],
): Promise<StaticPageSealRequest> {
  const server = await startStaticPageServer(repository.pageFolder)
  context.after(() => server.close())
  return {
    page: await repository.resolvePage(),
    source,
    citationEndLine: source.line,
    ownedOrigin: server.origin,
    entryPath: '/',
    signal: new AbortController().signal,
  }
}

/** Reads the refusal a seal raised, as its code and reason. */
async function refusalOf(
  sealing: Promise<unknown>,
): Promise<{ code: string; reason: unknown } | 'sealed'> {
  try {
    await sealing
    return 'sealed'
  } catch (error) {
    if (!(error instanceof StudyError)) throw error
    return { code: error.code, reason: error.details?.reason }
  }
}

// Value: protects=AC 3 a stop on a line of the entry page's inline module script is sealed with the script's text, its place in the page and an identity map, so a pause reported in page coordinates maps to the stop's own line and exact column; fails_when=the sealed text, the start of the script or the mapped line or column is wrong; no_claim=that js-debug binds the breakpoint (native check)
test('a stop on a line of the inline module script is sealed at that line with page coordinates', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const request = await sealRequestOf(
    context,
    repository,
    stopOf(repository.htmlPath, STATIC_PAGE_HTML, 8),
  )
  // Act
  const { bundle } = await sealStaticPageScript(request)
  const verifier = createBundleVerifier(bundle)
  // Assert
  assert.equal(bundle.javascript.startsWith('\n  import { double }'), true)
  assert.deepEqual(bundle.scriptStart, { line: 5, column: 22 })
  assert.equal(bundle.scriptUrl, `${request.ownedOrigin}/`)
  assert.deepEqual(verifier.mappedPositions(8, 8).positions, [
    { line: 8, column: 3 },
  ])
  // Line 8 is zero-based line 7 in the page; `const` starts at zero-based column 2.
  assert.equal(verifier.originalLine({ lineNumber: 7, columnNumber: 2 }), 8)
  assert.equal(verifier.originalColumn({ lineNumber: 7, columnNumber: 8 }), 9)
  assert.doesNotThrow(() =>
    verifier.verify(
      bundle.javascript,
      STATIC_PAGE_HTML,
      { scriptId: '7', lineNumber: 7, columnNumber: 2 },
      '7',
      8,
      3,
    ),
  )
})

// Value: protects=a stop whose identity map exceeds the scan's segment limit is refused map-limit naming the limit the scan enforced, not a number the refusal assumed; fails_when=the refusal reports 4000000 (or any value other than the injected limit); no_claim=the default limit's value
test('a stop whose map exceeds the segment limit is refused with the enforced limit in its details', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const request = await sealRequestOf(
    context,
    repository,
    stopOf(repository.htmlPath, STATIC_PAGE_HTML, 8),
  )
  const limited = {
    ...request,
    limits: { ...DEFAULT_SOURCE_MAP_LIMITS, mappedSegments: 3 },
  }
  // Act
  const outcome = await sealStaticPageScript(limited).then(
    () => 'sealed',
    (error: unknown) => (error instanceof StudyError ? error.details : 'other'),
  )
  // Assert
  assert.deepEqual(outcome, {
    reason: 'map-limit',
    limit: 'mapped-position-segments',
    limitValue: 3,
    sideEffects: 'partial',
  })
})

// Value: protects=AC 3 a stop on a line that lies in no inline script (markup) is refused not-in-page-script naming the line; fails_when=a markup line is sealed or the refusal loses its reason; no_claim=stops in scripts the page loads
test('a stop on a markup line of the page is refused as not in a page script', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const request = await sealRequestOf(
    context,
    repository,
    stopOf(repository.htmlPath, STATIC_PAGE_HTML, 5),
  )
  // Act
  const outcome = await sealStaticPageScript(request).then(
    () => 'sealed',
    (error: unknown) =>
      error instanceof StudyError
        ? { code: error.code, details: error.details }
        : 'other',
  )
  // Assert
  assert.deepEqual(outcome, {
    code: 'STATIC_PAGE_SEAL_FAILED',
    details: {
      reason: 'not-in-page-script',
      file: repository.htmlPath,
      line: 5,
      sideEffects: 'partial',
    },
  })
})

// Value: protects=AC 3 a stop whose file differs from the accepted text is refused SOURCE_CHANGED, so a page edited after the stop was declared never runs under the old claim; fails_when=the edited page is sealed; no_claim=an edit between the seal and the pause (the run's executed-bytes check)
test('a stop whose page changed since it was declared is refused as SOURCE_CHANGED', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const request = await sealRequestOf(
    context,
    repository,
    stopOf(repository.htmlPath, STATIC_PAGE_HTML, 8),
  )
  await writeFile(
    join(repository.pageFolder, 'index.html'),
    STATIC_PAGE_HTML.replace('double(2)', 'double(3)'),
  )
  // Act
  const outcome = await refusalOf(sealStaticPageScript(request))
  // Assert
  assert.deepEqual(outcome, { code: 'SOURCE_CHANGED', reason: undefined })
})

// Value: protects=AC 3 a stop in a same-origin .js file is sealed against the served bytes (the whole file is the script at the page's origin) and maps to its own line; fails_when=the sealed text is not the file, the URL is not the served address, or the mapped line is wrong; no_claim=that the page loads the file (the entry page names it)
test('a stop in a same-origin script file is sealed with the file as its script', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const request = await sealRequestOf(
    context,
    repository,
    stopOf(repository.scriptPath, STATIC_PAGE_SCRIPT, 2),
  )
  // Act
  const { bundle } = await sealStaticPageScript(request)
  const verifier = createBundleVerifier(bundle)
  // Assert
  assert.equal(bundle.javascript, STATIC_PAGE_SCRIPT)
  assert.equal(bundle.scriptStart, undefined)
  assert.equal(bundle.scriptUrl, `${request.ownedOrigin}/main.js`)
  assert.equal(verifier.originalLine({ lineNumber: 1, columnNumber: 0 }), 2)
})

// Value: protects=AC 3 a stop in a folder other than the page's is refused by name and never read; fails_when=a file outside the page is sealed; no_claim=the refusal before the server starts (the run checks the stops first)
test('a stop outside the page folder is refused as outside the package', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const request = await sealRequestOf(
    context,
    repository,
    stopOf('examples/other/a.js', 'x', 1),
  )
  // Act
  const outcome = await refusalOf(sealStaticPageScript(request))
  // Assert
  assert.deepEqual(outcome, {
    code: 'STATIC_PAGE_SEAL_FAILED',
    reason: 'outside-package',
  })
})

// Value: protects=AC 3 the announced script of the entry page matches its sealed address whether the browser opened / or /index.html and whether it reached the server as 127.0.0.1 or localhost, and a CDN address matches itself only; fails_when=a loopback spelling or the default index is not accepted, or another path or host is; no_claim=what js-debug announces (native check)
test('a script announced at localhost or /index.html is the sealed page script, another path or host is not', () => {
  // Arrange
  const sealed = 'http://127.0.0.1:4310/'
  const cdn = 'https://unpkg.com/lib@latest/dist/lib.mjs'
  // Act
  const results = [
    isStaticPageScriptOfModule(sealed, 'http://localhost:4310/'),
    isStaticPageScriptOfModule(sealed, 'http://localhost:4310/index.html'),
    isStaticPageScriptOfModule(sealed, 'http://localhost:4310/other.html'),
    isStaticPageScriptOfModule(sealed, 'http://example.test:4310/'),
    isStaticPageScriptOfModule(sealed, 'http://localhost:4311/'),
    isStaticPageScriptOfModule(cdn, cdn),
    isStaticPageScriptOfModule(cdn, 'https://unpkg.com/lib@1/dist/lib.mjs'),
  ]
  // Assert
  assert.deepEqual(results, [true, true, false, false, false, true, false])
})

// Value: protects=a stop file that starts with a UTF-8 byte order mark is sealed (the served bytes are compared with the file's bytes); fails_when=the BOM-stripped served text is compared with the file text and the run fails as SOURCE_CHANGED; no_claim=a BOM inside an inline script
test('a stop in a script file that starts with a byte order mark is sealed', async (context) => {
  // Arrange
  const bomScript = `\uFEFF${STATIC_PAGE_SCRIPT}`
  const repository = await createStaticPageRepository(context, {
    'main.js': bomScript,
  })
  const request = await sealRequestOf(
    context,
    repository,
    stopOf(repository.scriptPath, bomScript, 2),
  )
  // Act
  const outcome = await refusalOf(sealStaticPageScript(request))
  // Assert
  assert.equal(outcome, 'sealed')
})

// Value: protects=a stop in an .htm page other than the entry page is refused as not in a page script; fails_when=the .htm file is sealed as JavaScript; no_claim=an .htm entry page (the entry must be .html)
test('a stop in an .htm page is refused as not in a page script', async (context) => {
  // Arrange
  const htm = '<!doctype html>\n<script>\n  window.x = 1\n</script>\n'
  const repository = await createStaticPageRepository(context, {
    'other.htm': htm,
  })
  const request = await sealRequestOf(
    context,
    repository,
    stopOf('examples/page/other.htm', htm, 3),
  )
  // Act
  const outcome = await refusalOf(sealStaticPageScript(request))
  // Assert
  assert.deepEqual(outcome, {
    code: 'STATIC_PAGE_SEAL_FAILED',
    reason: 'not-in-page-script',
  })
})
