import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectHistoricalTimeline } from '../utils/projectHistoricalTimeline';

test('a saved replay marks the video spans without native history and retains both recorded stops', () => {
  // Arrange
  const context = { pausedIntervals: [{ snapshotId: 'first', startMs: 100, endMs: 120 }, { snapshotId: 'second', startMs: 200, endMs: 220 }],
    study: { observations: [{ id: 'first', elapsedMs: 100, debugger: {} }, { id: 'second', elapsedMs: 200, debugger: {} }] } };
  // Act
  const timeline = projectHistoricalTimeline(context, { startMs: 0, endMs: 250 });
  // Assert
  assert.deepEqual(timeline, { status: 'mapped', gaps: [{ startMs: 0, endMs: 100 }, { startMs: 120, endMs: 200 }, { startMs: 220, endMs: 250 }], recordedPoints: [100, 200] });
});

test('an archive without sealed pause intervals reports unknown coverage', () => {
  // Arrange
  const context = { study: { observations: [{ id: 'first', elapsedMs: 100, debugger: {} }] } };
  // Act
  const timeline = projectHistoricalTimeline(context, { startMs: 0, endMs: 250 });
  // Assert
  assert.deepEqual(timeline, { status: 'unknown' });
});

test('a later observation without debugger state ends an older native-history span', () => {
  // Arrange
  const context = { pausedIntervals: [{ snapshotId: 'first', startMs: 100, endMs: 220 }],
    study: { observations: [{ id: 'first', elapsedMs: 100, debugger: {} }, { id: 'later', elapsedMs: 150 }] } };
  // Act
  const timeline = projectHistoricalTimeline(context, { startMs: 0, endMs: 250 });
  // Assert
  assert.deepEqual(timeline, { status: 'mapped', gaps: [{ startMs: 0, endMs: 100 }, { startMs: 150, endMs: 250 }], recordedPoints: [100] });
});
