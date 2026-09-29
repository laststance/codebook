import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeepWikiDirectory } from '../utils/resolveDeepWikiDirectory';

test('relative Wiki output stays in the opened project', () => {
  // Arrange
  const projectRoot = '/workspace/target';
  // Act
  const output = resolveDeepWikiDirectory(projectRoot, '.codebook/wiki');
  // Assert
  assert.equal(output, '/workspace/target/.codebook/wiki');
});

test('relative Wiki output cannot escape to a different checkout', () => {
  // Arrange
  const projectRoot = '/workspace/target';
  // Act / Assert
  assert.throws(() => resolveDeepWikiDirectory(projectRoot, '../other/.codebook/wiki'), /inside the opened project/);
  assert.throws(() => resolveDeepWikiDirectory(projectRoot, '.'), /inside the opened project/);
});

test('an explicitly configured external Wiki output is resolved', () => {
  // Arrange
  const projectRoot = '/workspace/target';
  // Act
  const output = resolveDeepWikiDirectory(projectRoot, '/shared/wiki/target');
  // Assert
  assert.equal(output, '/shared/wiki/target');
});
