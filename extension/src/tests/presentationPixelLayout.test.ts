import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPixelEditorLayout } from '../utils/toPixelEditorLayout';

test('a minimum-size native group receives full pixels when Study replaces Guided at 200 percent', () => {
  // Arrange
  const requested = { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] };
  const measured = { orientation: 1, groups: [{ size: 216, groups: [{ size: 348 }, { size: 348 }] }, { size: 176 }] };
  // Act
  const layout = toPixelEditorLayout(requested, measured);
  // Assert
  assert.deepEqual(layout, { orientation: 0, groups: [{ size: 383, groups: [{ size: 196 }, { size: 196 }] }, { size: 313 }] });
});

test('explicit restore recovers full native dimensions from the observed subpixel collapse', () => {
  // Arrange
  const requested = { orientation: 1, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] };
  const measured = { orientation: 1, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 1391.5 }] }, { size: 842.45 }] };
  // Act
  const layout = toPixelEditorLayout(requested, measured);
  // Assert
  assert.deepEqual(layout, { orientation: 1, groups: [{ size: 464, groups: [{ size: 696 }, { size: 696 }] }, { size: 379 }] });
});

test('Living placement keeps its reading emphasis while scaling the independent nested height', () => {
  // Arrange
  const requested = { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] }] };
  const measured = { orientation: 0, groups: [{ size: 601, groups: [{ size: 272 }, { size: 271 }] }, { size: 491 }] };
  // Act
  const layout = toPixelEditorLayout(requested, measured);
  // Assert
  assert.deepEqual(layout, { orientation: 0, groups: [{ size: 655 }, { size: 437, groups: [{ size: 272 }, { size: 272 }] }] });
});

test('an unmeasured orthogonal axis cannot fabricate native pixel geometry', () => {
  // Arrange
  const requested = { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] };
  // Act
  const flat = toPixelEditorLayout(requested, { orientation: 0, groups: [{ size: 400 }, { size: 500 }, { size: 492 }] });
  const relative = toPixelEditorLayout(requested, requested);
  const invalid = toPixelEditorLayout(requested, { orientation: 0, groups: [{ size: Number.NaN }] });
  // Assert
  assert.equal(flat, undefined);
  assert.equal(relative, undefined);
  assert.equal(invalid, undefined);
});

test('a collapsed replay application row receives equal native pixels on layout restore', () => {
  // Arrange
  const requested = { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] };
  const measured = { orientation: 1, groups: [{ size: 70 }, { size: 1200 }] };
  // Act
  const layout = toPixelEditorLayout(requested, measured);
  // Assert
  assert.deepEqual(layout, { orientation: 1, groups: [{ size: 635 }, { size: 635 }] });
});

test('a flat replay layout does not guess row height from measured column width', () => {
  // Arrange
  const requested = { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] };
  const measured = { orientation: 0, groups: [{ size: 635 }, { size: 635 }] };
  // Act
  const layout = toPixelEditorLayout(requested, measured);
  // Assert
  assert.equal(layout, undefined);
});
