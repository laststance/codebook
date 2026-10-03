import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isCollapsedEditorLayout } from '../utils/isCollapsedEditorLayout'
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

for (const [arrangement, layout] of [
  [
    'the Study arrangement',
    {
      orientation: 0,
      groups: [
        { size: 605, groups: [{ size: 70 }, { size: 70 }] },
        { size: 495 },
      ],
    },
  ],
  [
    'the application above the source',
    { orientation: 1, groups: [{ size: 70 }, { size: 70 }] },
  ],
] as const)
  test(`an editor area hidden behind a maximized panel is recognized in ${arrangement} by its stacked groups at the minimum height`, () => {
    // Arrange / Act
    const collapsed = isCollapsedEditorLayout(layout)
    // Assert
    assert.equal(collapsed, true)
  })

for (const [description, layout] of [
  [
    'a visible Study arrangement',
    {
      orientation: 0,
      groups: [
        { size: 605, groups: [{ size: 385 }, { size: 455 }] },
        { size: 495 },
      ],
    },
  ],
  [
    'a visible arrangement whose Application group the learner dragged to its minimum',
    {
      orientation: 0,
      groups: [
        { size: 605, groups: [{ size: 70 }, { size: 770 }] },
        { size: 495 },
      ],
    },
  ],
  [
    'groups side by side, which carry no height',
    { orientation: 0, groups: [{ size: 70 }, { size: 70 }] },
  ],
  [
    'a proportional layout a host echoes back',
    { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
  ],
  ['a layout the editor did not report', undefined],
] as const)
  test(`${description} is not taken for a hidden editor area`, () => {
    // Arrange / Act
    const collapsed = isCollapsedEditorLayout(layout)
    // Assert
    assert.equal(collapsed, false)
  })
