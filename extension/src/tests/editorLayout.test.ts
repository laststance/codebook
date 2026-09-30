import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isProportionalEditorLayout } from '../utils/isProportionalEditorLayout'

test('host pixel expansion preserves the requested app/source and context split proportions', () => {
  // Arrange
  const requested = {
    orientation: 0,
    groups: [
      { size: 326, groups: [{ size: 288 }, { size: 288 }] },
      { size: 326 },
    ],
  }
  const received = {
    orientation: 0,
    groups: [
      { size: 330, groups: [{ size: 300 }, { size: 300.33333333333326 }] },
      { size: 330 },
    ],
  }
  // Act
  const restored = isProportionalEditorLayout(requested, received)
  // Assert
  assert.equal(restored, true)
})

for (const [description, received] of [
  [
    'a changed horizontal split',
    {
      orientation: 0,
      groups: [
        { size: 400, groups: [{ size: 288 }, { size: 288 }] },
        { size: 260 },
      ],
    },
  ],
  [
    'a changed nested split',
    {
      orientation: 0,
      groups: [
        { size: 330, groups: [{ size: 200 }, { size: 400 }] },
        { size: 330 },
      ],
    },
  ],
  [
    'a different orientation',
    {
      orientation: 1,
      groups: [
        { size: 330, groups: [{ size: 288 }, { size: 288 }] },
        { size: 330 },
      ],
    },
  ],
  [
    'a relocated nested group',
    {
      orientation: 0,
      groups: [
        { size: 330 },
        { size: 330, groups: [{ size: 288 }, { size: 288 }] },
      ],
    },
  ],
  [
    'an omitted native group',
    { orientation: 0, groups: [{ size: 330 }, { size: 330 }] },
  ],
  [
    'an unavailable native size',
    {
      orientation: 0,
      groups: [{ groups: [{ size: 288 }, { size: 288 }] }, { size: 330 }],
    },
  ],
] as const)
  test(`layout restoration rejects ${description}`, () => {
    // Arrange
    const requested = {
      orientation: 0,
      groups: [
        { size: 326, groups: [{ size: 288 }, { size: 288 }] },
        { size: 326 },
      ],
    }
    // Act
    const restored = isProportionalEditorLayout(requested, received)
    // Assert
    assert.equal(restored, false)
  })
