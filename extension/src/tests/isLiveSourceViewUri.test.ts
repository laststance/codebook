import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isLiveSourceViewUri } from '../utils/isLiveSourceViewUri'

for (const scenario of [
  {
    name: 'recognizes an opaque native live source view',
    scheme: 'codebook-source',
    path: '/source-view/id/Captured-live-source.mts',
    expected: true,
  },
  {
    name: 'keeps a captured repository folder named source-view in the immutable namespace',
    scheme: 'codebook-source',
    path: '/study/item/hash/src/source-view/Captured-theme.ts',
    expected: false,
  },
  {
    name: 'leaves a real file in a source-view directory outside the live namespace',
    scheme: 'file',
    path: '/source-view/id/Captured-live-source.mts',
    expected: false,
  },
  {
    name: 'keeps native Node history in the immutable namespace',
    scheme: 'codebook-source',
    path: '/node-history/study/1/hash/Captured-test.ts',
    expected: false,
  },
]) {
  test(scenario.name, () => {
    // Arrange: each document has a independently defined native scheme and path.
    const uri = { scheme: scenario.scheme, path: scenario.path }
    // Act: classify the native input before cache protection or mutable updates.
    const actual = isLiveSourceViewUri(uri)
    // Assert: only the dedicated native namespace is mutable.
    assert.equal(actual, scenario.expected)
  })
}
