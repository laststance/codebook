import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presentationPoseSchema } from '../presentationSchemas'

const captured = {
  type: 'presentation-pose',
  captureId: '11111111-1111-4111-8111-111111111111',
  presentationId: '22222222-2222-4222-8222-222222222222',
  expectedRevision: 1,
  revision: 2,
  itemId: 'repository/interface/theme',
  sourceHash: 'a'.repeat(64),
  contentTab: 'live',
  pose: {
    anchorId: 'source-version',
    fraction: 0.5,
    leadingOffsetPx: 24,
    scrollY: 432,
    valuesScrollLeft: 12,
    expanded: ['presentation-options'],
    visited: ['source'],
    focus: { kind: 'action', action: 'source', index: 1 },
  },
}

test('a reader handoff carries only a bounded location and semantic control identity', () => {
  // Arrange / Act
  const parsed = presentationPoseSchema.parse(captured)
  // Assert
  assert.equal(parsed.pose.scrollY, 432)
  assert.deepEqual(parsed.pose.focus, {
    kind: 'action',
    action: 'source',
    index: 1,
  })
  assert.deepEqual(parsed.pose.expanded, ['presentation-options'])
})

test('an observed-moment focus retains its session and pause identity rather than requiring a UUID', () => {
  // Arrange / Act
  const parsed = presentationPoseSchema.parse({
    ...captured,
    pose: {
      ...captured.pose,
      focus: {
        kind: 'item',
        region: 'moments',
        itemId: 'repository/interface/theme',
        observationId: 'browser-session:1',
      },
    },
  })
  // Assert
  assert.deepEqual(parsed.pose.focus, {
    kind: 'item',
    region: 'moments',
    itemId: 'repository/interface/theme',
    observationId: 'browser-session:1',
  })
})

for (const [name, pose] of [
  ['unbounded scrolling', { ...captured.pose, scrollY: 10_000_001 }],
  [
    'non-finite scrolling',
    { ...captured.pose, scrollY: Number.POSITIVE_INFINITY },
  ],
  ['a location outside its anchor', { ...captured.pose, fraction: 1.1 }],
  ['arbitrary HTML', { ...captured.pose, html: '<script>run()</script>' }],
  [
    'an executable selector',
    { ...captured.pose, focus: { kind: 'selector', value: 'body' } },
  ],
  [
    'a foreign control name',
    { ...captured.pose, focus: { kind: 'id', id: 'foreign-input' } },
  ],
  [
    'an unbounded repeated control',
    {
      ...captured.pose,
      focus: { kind: 'action', action: 'source', index: 33 },
    },
  ],
  [
    'unbounded visited keys',
    { ...captured.pose, visited: ['source', 'current-file', 'source'] },
  ],
  [
    'foreign disclosure state',
    { ...captured.pose, expanded: ['authentication'] },
  ],
] as const)
  test(`reader handoff rejects ${name} before publishing it to a replacement`, () => {
    // Arrange / Act
    const parsed = presentationPoseSchema.safeParse({ ...captured, pose })
    // Assert
    assert.equal(parsed.success, false)
  })
