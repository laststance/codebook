import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JAVASCRIPT_LIMIT_BYTES } from '../constants';
import { createBundleVerifier } from '../utils/createBundleVerifier';
import { extractDevelopmentModule } from '../utils/extractDevelopmentModule';
import type { BundleSource } from '../bundleSource';

const source = 'setTheme(otherTheme);\n';
const javascript = 'setTheme(otherTheme);';
const sourcePath = '/repo/src/theme.tsx';
const payload = { version: 3, sources: ['/repo/src/other.tsx', sourcePath], sourcesContent: ['other();', source], names: [], mappings: 'ACAA' };
const bundle: BundleSource = { sourcePath, source, javascript, sourceMap: JSON.stringify(payload), mapSource: sourcePath, scriptUrl: 'webpack-internal:///theme.tsx', chunkPath: '/repo/layout.js', chunkHash: '0'.repeat(64) };
const location = { scriptId: 'selected-script', lineNumber: 0, columnNumber: 0 };

test('a multi-source bundle pause identifies the exact original and native source position', () => {
  // Arrange
  const verifier = createBundleVerifier(bundle);
  // Act
  const result = verifier.verify(javascript, source, location, 'selected-script', 1, 1);
  // Assert
  assert.equal(result.scriptId, 'selected-script');
  assert.deepEqual(result.mapping, { generatedLine: 0, generatedColumn: 0, originalSource: '/repo/src/theme.tsx', originalLine: 0, originalColumn: 0, name: undefined });
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
  // Assert
  assert.equal(result.javascript, script); assert.equal(result.sourceMap, map); assert.equal(result.source, 'setTheme(otherTheme);\n');
});

test('missing, duplicate and oversized evaluated modules cannot become a sealed target', () => {
  // Arrange
  const script = `work();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}\n//# sourceURL=webpack-internal:///theme.tsx\n`;
  const chunk = `eval(${JSON.stringify(script)});`;
  // Act / Assert
  assert.throws(() => extractDevelopmentModule('', sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /Missing or ambiguous evaluated module/);
  assert.throws(() => extractDevelopmentModule(chunk + chunk, sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /Missing or ambiguous evaluated module/);
  assert.throws(() => extractDevelopmentModule('a'.repeat(JAVASCRIPT_LIMIT_BYTES + 1), sourcePath, source, '/repo/layout.js', 'webpack-internal:///theme.tsx'), /exceeds byte limit/);
});
