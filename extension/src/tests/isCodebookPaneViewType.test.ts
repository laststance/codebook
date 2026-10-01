import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isCodebookPaneViewType } from '../utils/isCodebookPaneViewType'

test('the Application and Study panes are recognized in the registered and the main-thread form', () => {
  // Arrange
  const paneViewTypes = [
    'codebook.scopedBrowser',
    'mainThreadWebview-codebook.scopedBrowser',
    'codebook.studyContext',
    'mainThreadWebview-codebook.studyContext',
  ]
  // Act
  const recognized = paneViewTypes.map((viewType) =>
    isCodebookPaneViewType(viewType),
  )
  // Assert
  assert.deepEqual(recognized, [true, true, true, true])
})

test('the Repository Wiki pane and another extension’s webview are not taken for a Codebook pane', () => {
  // Arrange
  const otherViewTypes = [
    'codebook.repositoryWiki',
    'mainThreadWebview-codebook.repositoryWiki',
    'mainThreadWebview-markdown.preview',
    'foreign-codebook.scopedBrowser',
  ]
  // Act
  const recognized = otherViewTypes.map((viewType) =>
    isCodebookPaneViewType(viewType),
  )
  // Assert
  assert.deepEqual(recognized, [false, false, false, false])
})
