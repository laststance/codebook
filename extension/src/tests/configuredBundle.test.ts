import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  REPOSITORY_CHUNK_LIMIT_BYTES,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'
import type { BundleSource } from '../repositoryBundle'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { extractDevelopmentModule } from '../utils/extractDevelopmentModule'
import { sameScriptUrl } from '../utils/sameScriptUrl'
import { sourceMapMappedPositions } from '../utils/sourceMapMappedPositions'

const source = 'setTheme(otherTheme);\n'
const javascript = 'setTheme(otherTheme);'
const sourcePath = '/repo/src/theme.tsx'
const payload = {
  version: 3,
  sources: ['/repo/src/other.tsx', sourcePath],
  sourcesContent: ['other();', source],
  names: [],
  mappings: 'ACAA',
}
const bundle: BundleSource = {
  sourcePath,
  source,
  javascript,
  sourceMap: JSON.stringify(payload),
  mapSource: sourcePath,
  scriptUrl: 'webpack-internal:///theme.tsx',
  chunkPath: '/repo/layout.js',
  chunkHash: '0'.repeat(64),
}
const location = { scriptId: 'selected-script', lineNumber: 0, columnNumber: 0 }

test('Chrome dot-segment normalization retains the exact emitted module identity without accepting another path', () => {
  // Arrange
  const emitted =
    'webpack-internal:///(app-pages-browser)/./src/components/Header/ThemeToggle.tsx'
  // Act / Assert
  assert.equal(
    sameScriptUrl(
      emitted,
      'webpack-internal:///(app-pages-browser)/src/components/Header/ThemeToggle.tsx',
    ),
    true,
  )
  assert.equal(
    sameScriptUrl(
      emitted,
      'webpack-internal:///(app-pages-browser)/src/other/ThemeToggle.tsx',
    ),
    false,
  )
  assert.equal(
    sameScriptUrl(
      emitted,
      'https://foreign.example/src/components/Header/ThemeToggle.tsx',
    ),
    false,
  )
  assert.equal(sameScriptUrl(emitted, '[module]'), false)
})

test('a multi-source bundle pause identifies the exact original and native source position', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle)
  // Act
  const result = verifier.verify(
    javascript,
    source,
    location,
    'selected-script',
    1,
    1,
  )
  // Assert
  assert.equal(result.scriptId, 'selected-script')
  assert.deepEqual(result.mapping, {
    generatedLine: 0,
    generatedColumn: 0,
    originalSource: '/repo/src/theme.tsx',
    originalLine: 0,
    originalColumn: 0,
    name: undefined,
  })
})

test('a failed source stop can show mapped coordinates only for the selected cited source', () => {
  // Arrange: the first map source is foreign; the selected source has two mapped lines and multiple columns on one line.
  const citedSource = 'first();\nsecond();\nthird();\n'
  const verifier = createBundleVerifier({
    ...bundle,
    source: citedSource,
    sourceMap: JSON.stringify({
      ...payload,
      sourcesContent: ['other();', citedSource],
      mappings: 'ACAE,EAAE;AACA;AACA',
    }),
  })
  // Act
  const result = verifier.mappedPositions(2, 3)
  // Assert: positions are one-based and constrained to the citation; the map does not certify debugger binding.
  assert.deepEqual(result, {
    positions: [
      { line: 2, column: 5 },
      { line: 3, column: 5 },
    ],
    complete: true,
  })
})

test('delimiter-only source maps report partial hints after bounded empty lines or segments', () => {
  // Arrange
  const emptyLines = `AAAA;${';'.repeat(100_000)}`
  const emptySegments = `AAAA,${','.repeat(200_000)}`
  // Act / Assert
  assert.deepEqual(sourceMapMappedPositions(emptyLines, 0, 1, 1), {
    positions: [{ line: 1, column: 1 }],
    complete: false,
  })
  assert.deepEqual(sourceMapMappedPositions(emptySegments, 0, 1, 1), {
    positions: [{ line: 1, column: 1 }],
    complete: false,
  })
})

test('an oversized undelimited source map tail reports partial hints before decoding it', () => {
  // Arrange
  const mappings = `AAAA;${'A'.repeat(4_194_305)}`
  // Act / Assert
  assert.deepEqual(sourceMapMappedPositions(mappings, 0, 1, 1), {
    positions: [{ line: 1, column: 1 }],
    complete: false,
  })
})

test('source aliases and duplicate originals cannot impersonate a unique bundle source', () => {
  // Arrange
  const ambiguous = {
    ...payload,
    sources: [sourcePath, '/repo/src/./theme.tsx'],
    sourcesContent: [source, source],
  }
  // Act / Assert
  assert.throws(
    () =>
      createBundleVerifier({ ...bundle, sourceMap: JSON.stringify(ambiguous) }),
    /ambiguous map source/,
  )
  assert.throws(
    () => createBundleVerifier({ ...bundle, mapSource: '/other/theme.tsx' }),
    /Missing or ambiguous/,
  )
})

test('an unrelated mapped source cannot pass by sharing the target line and column', () => {
  // Arrange
  const verifier = createBundleVerifier({
    ...bundle,
    sourceMap: JSON.stringify({ ...payload, mappings: 'AAAA' }),
  })
  // Act / Assert
  assert.throws(
    () =>
      verifier.verify(javascript, source, location, 'selected-script', 1, 1),
    /exact DAP source position/,
  )
})

test('a changed executable or original, foreign script and wrong source column reject the pause', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle)
  // Act / Assert
  assert.throws(
    () =>
      verifier.verify(
        `${javascript}\n`,
        source,
        location,
        'selected-script',
        1,
        1,
      ),
    /Executed JavaScript differs/,
  )
  assert.throws(
    () =>
      verifier.verify(
        javascript,
        `${source}\n`,
        location,
        'selected-script',
        1,
        1,
      ),
    /Current original differs/,
  )
  assert.throws(
    () => verifier.verify(javascript, source, location, 'foreign-script', 1, 1),
    /Paused script differs/,
  )
  assert.throws(
    () =>
      verifier.verify(javascript, source, location, 'selected-script', 1, 2),
    /exact DAP source position/,
  )
  assert.throws(
    () =>
      verifier.verify(javascript, source, location, 'selected-script', 2, 1),
    /exact DAP source position/,
  )
})

test('a debugger coordinate outside the executed module cannot inherit its last source mapping', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle)
  // Act / Assert
  assert.throws(
    () =>
      verifier.verify(
        javascript,
        source,
        { ...location, lineNumber: 999 },
        'selected-script',
        1,
        1,
      ),
    /outside executed source/,
  )
  assert.throws(
    () =>
      verifier.verify(
        javascript,
        source,
        { ...location, columnNumber: 999 },
        'selected-script',
        1,
        1,
      ),
    /outside executed source/,
  )
  assert.equal(
    verifier.verify(
      javascript,
      source,
      { ...location, columnNumber: 21 },
      'selected-script',
      1,
      1,
    ).scriptLocation.columnNumber,
    21,
  )
  const invalidOriginal = createBundleVerifier({
    ...bundle,
    sourceMap: JSON.stringify({ ...payload, mappings: 'ACu+BA' }),
  })
  assert.throws(
    () =>
      invalidOriginal.verify(
        javascript,
        source,
        location,
        'selected-script',
        1000,
        1,
      ),
    /outside original source/,
  )
})

test('missing originals, altered content and unsupported map forms fail before runtime input', () => {
  // Arrange / Act / Assert
  assert.throws(
    () => createBundleVerifier({ ...bundle, sourceMap: '{' }),
    SyntaxError,
  )
  assert.throws(
    () =>
      createBundleVerifier({
        ...bundle,
        sourceMap: JSON.stringify({ ...payload, sourcesContent: ['other();'] }),
      }),
    /Missing or ambiguous/,
  )
  assert.throws(
    () =>
      createBundleVerifier({
        ...bundle,
        sourceMap: JSON.stringify({
          ...payload,
          sourcesContent: ['other();', 'different'],
        }),
      }),
    /Map original differs/,
  )
  assert.throws(
    () =>
      createBundleVerifier({
        ...bundle,
        sourceMap: JSON.stringify({ ...payload, sections: [] }),
      }),
    /Invalid input/,
  )
  assert.throws(
    () =>
      createBundleVerifier({
        ...bundle,
        sourceMap: JSON.stringify({ ...payload, sourceRoot: '/repo' }),
      }),
    /Invalid input/,
  )
})

test('a webpack trusted-types eval literal is decoded without executing its application code', () => {
  // Arrange
  const map = JSON.stringify(payload)
  const script = `throw new Error('must never execute');\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`
  const chunk = `eval(__webpack_require__.ts(${JSON.stringify(script)}));`
  // Act
  const result = extractDevelopmentModule(
    chunk,
    sourcePath,
    source,
    '/repo/layout.js',
    'webpack-internal:///theme.tsx',
  )
  assert.ok(result)
  // Assert
  assert.equal(result.javascript, script)
  assert.equal(result.sourceMap, map)
  assert.equal(result.source, 'setTheme(otherTheme);\n')
})

test('missing, duplicate and oversized evaluated modules cannot become a sealed target', () => {
  // Arrange
  const script = `work();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`
  const chunk = `eval(${JSON.stringify(script)});`
  // Act / Assert
  assert.equal(
    extractDevelopmentModule(
      '',
      sourcePath,
      source,
      '/repo/layout.js',
      'webpack-internal:///theme.tsx',
    ),
    undefined,
  )
  assert.throws(
    () =>
      extractDevelopmentModule(
        chunk + chunk,
        sourcePath,
        source,
        '/repo/layout.js',
        'webpack-internal:///theme.tsx',
      ),
    /Ambiguous evaluated module/,
  )
  assert.throws(
    () =>
      extractDevelopmentModule(
        'a'.repeat(REPOSITORY_CHUNK_LIMIT_BYTES + 1),
        sourcePath,
        source,
        '/repo/layout.js',
        'webpack-internal:///theme.tsx',
      ),
    /Application chunk exceeds byte limit/,
  )
  const oversizedModule = `work();${'x'.repeat(REPOSITORY_JAVASCRIPT_LIMIT_BYTES)}\n//# sourceURL=webpack-internal:///theme.tsx\n`
  assert.throws(
    () =>
      extractDevelopmentModule(
        `eval(${JSON.stringify(oversizedModule)});`,
        sourcePath,
        source,
        '/repo/layout.js',
        'webpack-internal:///theme.tsx',
      ),
    /Selected JavaScript module exceeds byte limit/,
  )
})

test('Next webpack placeholder metadata keeps the final selected module available without executing it', () => {
  // Arrange: native Next emits the placeholder before its map and effective webpack URL.
  const map = JSON.stringify(payload)
  const script = `throw new Error('must never execute');\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`
  const chunk = `eval(${JSON.stringify(script)});`
  // Act
  const result = extractDevelopmentModule(
    chunk,
    sourcePath,
    source,
    '/repo/layout.js',
    'webpack-internal:///theme.tsx',
  )
  // Assert
  assert.ok(result)
  assert.equal(result.javascript, script)
  assert.equal(result.sourceMap, map)
  assert.equal(result.sourcePath, '/repo/src/theme.tsx')
  assert.equal(result.scriptUrl, 'webpack-internal:///theme.tsx')
})

test('competing or trailing script identities cannot impersonate the selected webpack module', () => {
  // Arrange
  const selected = '//# sourceURL=webpack-internal:///theme.tsx\n'
  const module = `work();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}\n`
  const conflictingDirectives = [
    `//# sourceURL=webpack-internal:///foreign.tsx\n${selected}`,
    `${selected}//# sourceURL=webpack-internal:///foreign.tsx\n`,
    `${selected}//# sourceURL=[module]\n`,
    `${selected}${selected}`,
  ]
  // Act / Assert
  for (const directives of conflictingDirectives) {
    assert.throws(
      () =>
        extractDevelopmentModule(
          `eval(${JSON.stringify(module + directives)});`,
          sourcePath,
          source,
          '/repo/layout.js',
          'webpack-internal:///theme.tsx',
        ),
      /ambiguous script identity/,
    )
  }
})

test('a declared line counts as mapped at whichever column the sealed map reaches it and an unmapped line reports no position', () => {
  // Arrange
  const verifier = createBundleVerifier({
    ...bundle,
    sourceMap: JSON.stringify({ ...payload, mappings: 'ACAE,EAAE' }),
  })
  // Act
  const declaredLine = verifier.mappedPositions(1, 1),
    unmappedLine = verifier.mappedPositions(2, 2)
  // Assert
  assert.deepEqual(declaredLine, {
    positions: [{ line: 1, column: 3 }],
    complete: true,
  })
  assert.deepEqual(unmappedLine, { positions: [], complete: true })
})

// Value: protects=the sealed map saying on which line of the cited source a generated location lies, which is how a live run tells its declared stop's pause from one the debug adapter makes for itself; fails_when=a location between two mappings loses its line, a missing column is not read as column 0, or a location before the first mapping or in another original of the bundle is given a line of the cited source; why_new=the verifier had no reader for the line of a generated location (Cycle 0042 ER1); seam=none
test('the sealed map gives the cited source’s line for a generated location at or after a mapping, and none before the first mapping or in another original', () => {
  // Arrange: generated 0:4 is line 1 of the cited source, generated line 1 is its line 2, generated line 2 belongs to the bundle's other original.
  const verifier = createBundleVerifier({
    ...bundle,
    javascript: 'setTheme(otherTheme);\nnext();\nother();',
    sourceMap: JSON.stringify({ ...payload, mappings: 'ICAA;AACA;ADDA' }),
  })
  // Act
  const lines = [
    verifier.originalLine({ lineNumber: 0, columnNumber: 4 }),
    verifier.originalLine({ lineNumber: 0, columnNumber: 9 }),
    verifier.originalLine({ lineNumber: 1, columnNumber: 3 }),
    verifier.originalLine({ lineNumber: 1 }),
    verifier.originalLine({ lineNumber: 0, columnNumber: 2 }),
    verifier.originalLine({ lineNumber: 2, columnNumber: 0 }),
  ]
  // Assert
  assert.deepEqual(lines, [1, 1, 2, 2, undefined, undefined])
})

// Cycle 0044 (0042-SR26 / 0042-OCR1): red while the reader answered the nearest earlier mapping for unmapped generated code, so such a pause counted as the declared stop's with a wrong place.
test('the sealed map gives no source line for generated code after a segment without an original, on a line without a mapping, or past the end of the module', () => {
  // Arrange: generated 0:0 is line 1 of the cited source, 0:6 starts a segment without an original, generated line 1 has no mapping, generated line 2 is line 2.
  const verifier = createBundleVerifier({
    ...bundle,
    javascript: 'call();generated();\nunmapped();\nlast();',
    sourceMap: JSON.stringify({ ...payload, mappings: 'ACAA,M;;AACA' }),
  })
  // Act
  const lines = {
    mapped: verifier.originalLine({ lineNumber: 0, columnNumber: 3 }),
    generatedOnlySegment: verifier.originalLine({
      lineNumber: 0,
      columnNumber: 8,
    }),
    lineWithoutMapping: verifier.originalLine({
      lineNumber: 1,
      columnNumber: 3,
    }),
    lastMappedLine: verifier.originalLine({ lineNumber: 2, columnNumber: 0 }),
    pastEndOfLine: verifier.originalLine({ lineNumber: 2, columnNumber: 500 }),
    pastEndOfModule: verifier.originalLine({ lineNumber: 50, columnNumber: 0 }),
  }
  // Assert
  assert.deepEqual(lines, {
    mapped: 1,
    generatedOnlySegment: undefined,
    lineWithoutMapping: undefined,
    lastMappedLine: 2,
    pastEndOfLine: undefined,
    pastEndOfModule: undefined,
  })
})

// Value: protects=the binding rule and the declared-line check telling a comment the development build kept from code; fails_when=a mapping onto a `//` comment of the generated module is reported as a mapped position; why_new=Cycle 0043 N-2 (Next's webpack build maps `// Auth.js error messages…`); seam=none
test('a line whose only mapping points at a comment the generated module kept is not a mapped position, while code beside a comment is', () => {
  // Arrange: generated lines 0 to 3 map to source lines 1 to 4; lines 2 and 3 are kept comments, line 4 holds code before a comment.
  const citedSource =
    'first();\n// Auth.js error messages\n/* kept */\nsecond(); // why\n'
  const verifier = createBundleVerifier({
    ...bundle,
    source: citedSource,
    javascript: citedSource,
    sourceMap: JSON.stringify({
      ...payload,
      sourcesContent: ['other();', citedSource],
      mappings: 'ACAA;AACA;AACA;AACA',
    }),
  })
  // Act
  const result = verifier.mappedPositions(1, 4)
  // Assert
  assert.deepEqual(result, {
    positions: [
      { line: 1, column: 1 },
      { line: 4, column: 1 },
    ],
    complete: true,
  })
})
