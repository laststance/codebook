import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describePaneIdentity } from '../utils/describePaneIdentity'

// Value: protects=the effect note of a pane the editor already disposed never throws; fails_when=the helper lets the editor's `Webview is disposed` through; why_new=Cycle 0056 task 17 (native finding on 8b76a578); seam=none; no_claim=the host's close
test('words a disposed pane as disposed instead of throwing', () => {
  // Arrange
  const disposedPane = {
    get viewType(): string {
      throw new Error('Webview is disposed')
    },
    viewColumn: 1,
  }

  // Act
  const words = describePaneIdentity(disposedPane)

  // Assert
  assert.equal(words, 'disposed pane')
})

// Value: protects=a live pane's note names its type and column; fails_when=the note drops either; why_new=Cycle 0056 task 17; seam=none; no_claim=disposed panes
test('words a live pane by its type and column', () => {
  // Arrange
  const pane = { viewType: 'codebook.scopedBrowser', viewColumn: 1 }

  // Act
  const words = describePaneIdentity(pane)

  // Assert
  assert.equal(words, 'codebook.scopedBrowser column 1')
})
