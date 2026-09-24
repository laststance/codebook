import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPOSITORY_CHUNK_LIMIT_BYTES, REPOSITORY_JAVASCRIPT_LIMIT_BYTES } from '../constants';
import { createBundleVerifier } from '../utils/createBundleVerifier';
import { extractDevelopmentModule } from '../utils/extractDevelopmentModule';
import { sameScriptUrl } from '../utils/sameScriptUrl';
import { sourceMapMappedPositions } from '../utils/sourceMapMappedPositions';
import type { BundleSource } from '../repositoryBundle';

const source = 'setTheme(otherTheme);\n';
const javascript = 'setTheme(otherTheme);';
const sourcePath = '/repo/src/theme.tsx';
const payload = { version: 3, sources: ['/repo/src/other.tsx', sourcePath], sourcesContent: ['other();', source], names: [], mappings: 'ACAA' };
const bundle: BundleSource = { sourcePath, source, javascript, sourceMap: JSON.stringify(payload), mapSource: sourcePath, scriptUrl: 'webpack-internal:///theme.tsx', chunkPath: '/repo/layout.js', chunkHash: '0'.repeat(64) };
const location = { scriptId: 'selected-script', lineNumber: 0, columnNumber: 0 };

test('Chrome dot-segment normalization retains the exact emitted module identity without accepting another path', () => {
  // Arrange
  const emitted = 'webpack-internal:///(app-pages-browser)/./src/components/Header/ThemeToggle.tsx';
  // Act / Assert
  assert.equal(sameScriptUrl(emitted, 'webpack-internal:///(app-pages-browser)/src/components/Header/ThemeToggle.tsx'), true);
  assert.equal(sameScriptUrl(emitted, 'webpack-internal:///(app-pages-browser)/src/other/ThemeToggle.tsx'), false);
  assert.equal(sameScriptUrl(emitted, 'https://foreign.example/src/components/Header/ThemeToggle.tsx'), false);
  assert.equal(sameScriptUrl(emitted, '[module]'), false);
});

test('a multi-source bundle pause identifies the exact original and native source position', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle);
  // Act
  const result = verifier.verify(javascript, source, location, 'selected-script', 1, 1);
  // Assert
  assert.equal(result.scriptId, 'selected-script');
  assert.deepEqual(result.mapping, { generatedLine: 0, generatedColumn: 0, originalSource: '/repo/src/theme.tsx', originalLine: 0, originalColumn: 0, name: undefined });
});

test('a failed source stop can show mapped coordinates only for the selected cited source', () => {
  // Arrange: the first map source is foreign; the selected source has two mapped lines and multiple columns on one line.
  const citedSource = 'first();\nsecond();\nthird();\n';
  const verifier = createBundleVerifier({ ...bundle, source: citedSource,
    sourceMap: JSON.stringify({ ...payload, sourcesContent: ['other();', citedSource], mappings: 'ACAE,EAAE;AACA;AACA' }) });
  // Act
  const result = verifier.mappedPositions(2, 3);
  // Assert: positions are one-based and constrained to the citation; the map does not certify debugger binding.
  assert.deepEqual(result, { positions: [{ line: 2, column: 5 }, { line: 3, column: 5 }], complete: true });
});

test('delimiter-only source maps report partial hints after bounded empty lines or segments', () => {
  // Arrange
  const emptyLines = `AAAA;${';'.repeat(100_000)}`;
  const emptySegments = `AAAA,${','.repeat(200_000)}`;
  // Act / Assert
  assert.deepEqual(sourceMapMappedPositions(emptyLines, 0, 1, 1), { positions: [{ line: 1, column: 1 }], complete: false });
  assert.deepEqual(sourceMapMappedPositions(emptySegments, 0, 1, 1), { positions: [{ line: 1, column: 1 }], complete: false });
});

test('an oversized undelimited source map tail reports partial hints before decoding it', () => {
  // Arrange
  const mappings = `AAAA;${'A'.repeat(4_194_305)}`;
  // Act / Assert
  assert.deepEqual(sourceMapMappedPositions(mappings, 0, 1, 1), { positions: [{ line: 1, column: 1 }], complete: false });
});

test('source aliases and duplicate originals cannot impersonate a unique bundle source', () => {
  // Arrange
  const ambiguous = { ...payload, sources: [sourcePath, '/repo/src/./theme.tsx'], sourcesContent: [source, source] };
  // Act / Assert
  assert.throws(() => createBundleVerifier({ ...bundle, sourceMap: JSON.stringify(ambiguous) }), /ambiguous map source/);
  assert.throws(() => createBundleVerifier({ ...bundle, mapSource: '/other/theme.tsx' }), /Missing or ambiguous/);
});

test('an unrelated mapped source cannot pass by sharing the target line and column', () => {
  // Arrange
  const verifier = createBundleVerifier({ ...bundle, sourceMap: JSON.stringify({ ...payload, mappings: 'AAAA' }) });
  // Act / Assert
  assert.throws(() => verifier.verify(javascript, source, location, 'selected-script', 1, 1), /exact DAP source position/);
});

test('a changed executable or original, foreign script and wrong source column reject the pause', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle);
  // Act / Assert
  assert.throws(() => verifier.verify(`${javascript}\n`, source, location, 'selected-script', 1, 1), /Executed JavaScript differs/);
  assert.throws(() => verifier.verify(javascript, `${source}\n`, location, 'selected-script', 1, 1), /Current original differs/);
  assert.throws(() => verifier.verify(javascript, source, location, 'foreign-script', 1, 1), /Paused script differs/);
  assert.throws(() => verifier.verify(javascript, source, location, 'selected-script', 1, 2), /exact DAP source position/);
  assert.throws(() => verifier.verify(javascript, source, location, 'selected-script', 2, 1), /exact DAP source position/);
});

test('a debugger coordinate outside the executed module cannot inherit its last source mapping', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle);
  // Act / Assert
  assert.throws(() => verifier.verify(javascript, source, { ...location, lineNumber: 999 }, 'selected-script', 1, 1), /outside executed source/);
  assert.throws(() => verifier.verify(javascript, source, { ...location, columnNumber: 999 }, 'selected-script', 1, 1), /outside executed source/);
  assert.equal(verifier.verify(javascript, source, { ...location, columnNumber: 21 }, 'selected-script', 1, 1).scriptLocation.columnNumber, 21);
  const invalidOriginal = createBundleVerifier({ ...bundle, sourceMap: JSON.stringify({ ...payload, mappings: 'ACu+BA' }) });
  assert.throws(() => invalidOriginal.verify(javascript, source, location, 'selected-script', 1000, 1), /outside original source/);
});

test('missing originals, altered content and unsupported map forms fail before runtime input', () => {
  // Arrange / Act / Assert
  assert.throws(() => createBundleVerifier({ ...bundle, sourceMap: '{' }), SyntaxError);
  assert.throws(() => createBundleVerifier({ ...bundle, sourceMap: JSON.stringify({ ...payload, sourcesContent: ['other();'] }) }), /Missing or ambiguous/);
  assert.throws(() => createBundleVerifier({ ...bundle, sourceMap: JSON.stringify({ ...payload, sourcesContent: ['other();', 'different'] }) }), /Map original differs/);
  assert.throws(() => createBundleVerifier({ ...bundle, sourceMap: JSON.stringify({ ...payload, sections: [] }) }), /Invalid input/);
  assert.throws(() => createBundleVerifier({ ...bundle, sourceMap: JSON.stringify({ ...payload, sourceRoot: '/repo' }) }), /Invalid input/);
});

test('a webpack trusted-types eval literal is decoded without executing its application code', () => {
  // Arrange
  const map = JSON.stringify(payload);
  const script = `throw new Error('must never execute');\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`;
  const chunk = `eval(__webpack_require__.ts(${JSON.stringify(script)}));`;
  // Act
  const result = extractDevelopmentModule(chunk, sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx');
  assert.ok(result);
  // Assert
  assert.equal(result.javascript, script); assert.equal(result.sourceMap, map); assert.equal(result.source, 'setTheme(otherTheme);\n');
});

test('missing, duplicate and oversized evaluated modules cannot become a sealed target', () => {
  // Arrange
  const script = `work();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`;
  const chunk = `eval(${JSON.stringify(script)});`;
  // Act / Assert
  assert.equal(extractDevelopmentModule('', sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), undefined);
  assert.throws(() => extractDevelopmentModule(chunk + chunk, sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /Ambiguous evaluated module/);
  assert.throws(() => extractDevelopmentModule('a'.repeat(REPOSITORY_CHUNK_LIMIT_BYTES + 1), sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /Application chunk exceeds byte limit/);
  const oversizedModule = `work();${'x'.repeat(REPOSITORY_JAVASCRIPT_LIMIT_BYTES)}\n//# sourceURL=webpack-internal:///theme.tsx\n`;
  assert.throws(() => extractDevelopmentModule(`eval(${JSON.stringify(oversizedModule)});`, sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /Selected JavaScript module exceeds byte limit/);
});

test('Next webpack placeholder metadata keeps the final selected module available without executing it', () => {
  // Arrange: native Next emits the placeholder before its map and effective webpack URL.
  const map = JSON.stringify(payload);
  const script = `throw new Error('must never execute');\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`;
  const chunk = `eval(${JSON.stringify(script)});`;
  // Act
  const result = extractDevelopmentModule(chunk, sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx');
  // Assert
  assert.ok(result);
  assert.equal(result.javascript, script); assert.equal(result.sourceMap, map);
  assert.equal(result.sourcePath, '/repo/src/theme.tsx'); assert.equal(result.scriptUrl, 'webpack-internal:///theme.tsx');
});

test('competing or trailing script identities cannot impersonate the selected webpack module', () => {
  // Arrange
  const selected = '//# sourceURL=webpack-internal:///theme.tsx\n';
  const module = `work();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}\n`;
  const conflictingDirectives = [
    `//# sourceURL=webpack-internal:///foreign.tsx\n${selected}`,
    `${selected}//# sourceURL=webpack-internal:///foreign.tsx\n`,
    `${selected}//# sourceURL=[module]\n`,
    `${selected}${selected}`,
  ];
  // Act / Assert
  for (const directives of conflictingDirectives) {
    assert.throws(() => extractDevelopmentModule(`eval(${JSON.stringify(module + directives)});`, sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /ambiguous script identity/);
  }
});
