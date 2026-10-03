import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isCodebookPaneViewType } from '../utils/isCodebookPaneViewType'

// Value: protects=every pane Codebook creates is recognized in both forms the tab model reports; fails_when=a pane kind or the main-thread form is missing from the matcher; why_new=Cycle 0044 0037-N6b: the Repository Wiki pane was not a Codebook pane before; seam=none
test('the Application, Study and Repository Wiki panes are recognized in the registered and the main-thread form', () => {
  // Arrange
  const paneViewTypes = [
    'codebook.scopedBrowser',
    'mainThreadWebview-codebook.scopedBrowser',
    'codebook.studyContext',
    'mainThreadWebview-codebook.studyContext',
    'codebook.repositoryWiki',
    'mainThreadWebview-codebook.repositoryWiki',
  ]
  // Act
  const recognized = paneViewTypes.map((viewType) =>
    isCodebookPaneViewType(viewType),
  )
  // Assert
  assert.deepEqual(recognized, [true, true, true, true, true, true])
})

test('another extension’s webview is not taken for a Codebook pane', () => {
  // Arrange
  const otherViewTypes = [
    'mainThreadWebview-markdown.preview',
    'foreign-codebook.scopedBrowser',
    'codebook.scopedBrowser.other',
  ]
  // Act
  const recognized = otherViewTypes.map((viewType) =>
    isCodebookPaneViewType(viewType),
  )
  // Assert
  assert.deepEqual(recognized, [false, false, false])
})

// Value: protects=a site that asks for one pane kind is not answered by another kind; fails_when=the named kinds are ignored and every Codebook pane matches; why_new=Cycle 0044 0037-PR1: the matcher replaced the inline per-kind comparisons of the Study workspace; seam=none
test('a pane is matched against the named kinds only', () => {
  // Arrange
  const studyPane = 'mainThreadWebview-codebook.studyContext'
  // Act
  const recognized = [
    isCodebookPaneViewType(studyPane, 'codebook.studyContext'),
    isCodebookPaneViewType(studyPane, 'codebook.scopedBrowser'),
    isCodebookPaneViewType(
      studyPane,
      'codebook.scopedBrowser',
      'codebook.studyContext',
    ),
    isCodebookPaneViewType('codebook.repositoryWiki', 'codebook.studyContext'),
  ]
  // Assert
  assert.deepEqual(recognized, [true, false, true, false])
})
