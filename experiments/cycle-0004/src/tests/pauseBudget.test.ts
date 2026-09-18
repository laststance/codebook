import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PauseBudget } from '../pauseBudget';

test('a forty-second server pause does not exhaust the active application deadline', () => {
  // Arrange
  const budget = new PauseBudget(0);
  // Act
  budget.stop('server', 100); const held = budget.activeMs(40_100); budget.resume('server', 40_100);
  // Assert
  assert.equal(held, 100); assert.equal(budget.activeMs(40_300), 300);
});

test('overlapping participant stops exclude their union rather than double-counting pause time', () => {
  // Arrange
  const budget = new PauseBudget(0);
  // Act
  budget.stop('server', 100); budget.stop('browser', 200); budget.resume('server', 300); const overlap = budget.activeMs(350); budget.resume('browser', 400); budget.resume('browser', 450);
  // Assert
  assert.equal(overlap, 100); assert.equal(budget.activeMs(500), 200);
});
