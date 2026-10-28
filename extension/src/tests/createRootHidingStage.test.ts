import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRootHidingStage } from '../utils/createRootHidingStage'

const ROOTS = {
  storage: [],
  workspace: ['/Users/ada/app'],
  home: ['/Users/ada'],
}

// protects=a root cut between two writes is hidden whole and nothing of it is released early; fails_when=the first half is released unhidden, or the halves are hidden separately and survive; no_claim=roots of a shape hidePrivateRoots does not know
test('a workspace root split between two writes is hidden as one root', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const first = stage.write('cwd /Users/ada/')
  const second = stage.write('app/src/a.ts\n')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'cwd ')
  assert.equal(second, '<workspace>/src/a.ts\n')
  assert.equal(rest, '')
})

// protects=ordinary text is released at once, so output keeps its arrival order and time; fails_when=a stage holds every chunk back until the next one; no_claim=timing
test('text that cannot start a root is released immediately', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const released = stage.write('listening on 127.0.0.1:4100\n')

  // Assert
  assert.equal(released, 'listening on 127.0.0.1:4100\n')
})

// protects=text held for a possible root is released, hidden or as is, when the stream ends; fails_when=the held tail is dropped at the end of output; no_claim=none
test('a held candidate that never becomes a root is released at the end of the stream', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const first = stage.write('see /Users/ad')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'see ')
  assert.equal(rest, '/Users/ad')
})

// protects=a cut is never placed inside a root that is already complete, even when its tail repeats the root's beginning; fails_when=the stage holds from the inner repeat and releases half of a matched root; no_claim=none
test('a complete root whose tail repeats its own beginning is hidden whole', () => {
  // Arrange
  const stage = createRootHidingStage({ storage: [], home: ['/a/a/a'] })

  // Act
  const released = stage.write('x /a/a/a')
  const rest = stage.end()

  // Assert
  assert.equal(released + rest, 'x ~')
})

// protects=a Windows root split between writes is hidden whatever its case and separators; fails_when=the prefix check is case or separator sensitive; no_claim=real Windows paths
test('a Windows workspace root split between two writes is hidden with either separator and any case', () => {
  // Arrange
  const stage = createRootHidingStage({
    storage: [],
    workspace: ['C:\\Users\\Ada\\repo'],
  })

  // Act
  const first = stage.write('at c:/users/')
  const second = stage.write('ada/REPO\\src\\a.ts')
  const rest = stage.end()

  // Assert
  assert.equal(first + second + rest, 'at <workspace>\\src\\a.ts')
})
