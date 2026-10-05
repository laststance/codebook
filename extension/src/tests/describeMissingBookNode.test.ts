import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeMissingBookNode } from '../utils/describeMissingBookNode'

// Value: protects=an agent that started on a node id its selected revision does not have learning which nodes that revision has, also for a long document; fails_when=the sentence lists no node ids, lists every one of a long document, or names no next step; why_new=Cycle 0045 N14d-16 (DX-1 c); seam=none
test('a missing node is refused naming the one node, the few nodes or the first five of many nodes of the selected revision', () => {
  // Arrange
  const book = { bookId: 'interface', revision: 2, nodeId: 'mode' }
  // Act
  const sentences = {
    oneNode: describeMissingBookNode(book, ['theme']),
    threeNodes: describeMissingBookNode(book, ['theme', 'layout', 'storage']),
    sevenNodes: describeMissingBookNode(book, [
      'a1',
      'a2',
      'a3',
      'a4',
      'a5',
      'a6',
      'a7',
    ]),
  }
  // Assert
  assert.deepEqual(sentences, {
    oneNode:
      'configuration.book.nodeId mode does not exist in revision 2 of book interface, which has the node: theme. Use it, or publish your own document under its own book id and start on that revision.',
    threeNodes:
      'configuration.book.nodeId mode does not exist in revision 2 of book interface, which has the nodes: theme, layout, storage. Use one of them, or publish your own document under its own book id and start on that revision.',
    sevenNodes:
      'configuration.book.nodeId mode does not exist in revision 2 of book interface, which has 7 nodes, among them: a1, a2, a3, a4, a5. Use one of them, or publish your own document under its own book id and start on that revision.',
  })
})
