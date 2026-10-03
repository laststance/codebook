import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiOutputLabel } from '../utils/wikiOutputLabel'

test('a Wiki folder inside the project is named relative to the project', () => {
  // Arrange
  const projectRoot = '/repo'

  // Act
  const label = wikiOutputLabel(projectRoot, '/repo/.codebook/wiki')

  // Assert
  assert.equal(label, '.codebook/wiki')
})

test('a configured Wiki folder outside the project is named by its full path', () => {
  // Arrange
  const projectRoot = '/repo'

  // Act
  const label = wikiOutputLabel(projectRoot, '/srv/wikis/repo')

  // Assert
  assert.equal(label, '/srv/wikis/repo')
})

test('a sibling folder whose name starts like the project is not taken for a folder inside it', () => {
  // Arrange
  const projectRoot = '/repo'

  // Act
  const label = wikiOutputLabel(projectRoot, '/repo-wiki/site')

  // Assert
  assert.equal(label, '/repo-wiki/site')
})

test('a folder inside the project whose name starts with two dots keeps its relative name', () => {
  // Arrange
  const projectRoot = '/repo'

  // Act
  const label = wikiOutputLabel(projectRoot, '/repo/..wiki')

  // Assert
  assert.equal(label, '..wiki')
})
