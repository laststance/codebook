import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySource } from '../verifySource';
import type { SealedSource } from '../inspect';

const source = 'const value: number = 1;';
const javascript = 'const value = 1;';
const seal: SealedSource = { sourcePath: '/run/fixture/cart.ts', source, javascript, breakpointLine: 1, sourceMap: JSON.stringify({ version: 3, file: 'cart.js', sources: ['../fixture/cart.ts'], sourcesContent: [source], names: [], mappings: 'AAAA' }) };

test('the shared source verifier accepts an exact executed build mapped to its original TypeScript stop', () => {
  // Arrange / Act
  const result = verifySource(seal, javascript, source, { scriptId: 'actual-script', lineNumber: 0, columnNumber: 0 }, 1, '../fixture/cart.ts');
  // Assert
  assert.equal(result.scriptId, 'actual-script'); assert.equal('originalLine' in result.mapping && result.mapping.originalLine, 0);
});

test('changed executable, local source, map identity and wrong stop cannot pass the shared source verifier', () => {
  // Arrange
  const location = { scriptId: 'actual-script', lineNumber: 0, columnNumber: 0 };
  // Act / Assert
  assert.throws(() => verifySource(seal, `${javascript}\n// stale`, source, location, 1, '../fixture/cart.ts'), /Executed JavaScript does not match/);
  assert.throws(() => verifySource(seal, javascript, `${source}\n`, location, 1, '../fixture/cart.ts'), /Local TypeScript changed/);
  assert.throws(() => verifySource(seal, javascript, source, location, 1, '../fixture/other.ts'), /Source map does not contain/);
  assert.throws(() => verifySource(seal, javascript, source, location, 2, '../fixture/cart.ts'), /does not map/);
});
