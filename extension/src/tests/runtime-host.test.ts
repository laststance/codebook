import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectHost } from '../runtimeSupport/utils/selectHost'
import { selectPageTarget } from '../runtimeSupport/utils/selectPageTarget'

test('Cursor integrated webviews are discoverable without adopting the editor renderer', () => {
  // Arrange
  const targets = [
    { id: 'editor', type: 'page', url: 'vscode-file://workbench' },
    { id: 'fixture', type: 'webview', url: 'http://localhost/runs/owned' },
  ]
  // Act
  const target = selectPageTarget(targets, 'http://localhost/runs/owned')
  // Assert
  assert.deepEqual(target, {
    id: 'fixture',
    type: 'webview',
    url: 'http://localhost/runs/owned',
  })
})

test('two browser targets with the same run URL cannot silently select the first', () => {
  // Arrange
  const targets = [
    { id: 'one', type: 'page', url: 'http://localhost/owned' },
    { id: 'two', type: 'webview', url: 'http://localhost/owned' },
  ]
  // Act / Assert
  assert.throws(
    () => selectPageTarget(targets, 'http://localhost/owned'),
    /Ambiguous/,
  )
})

test('background workers and similar URLs cannot become the controlled page', () => {
  // Arrange
  const targets = [
    { id: 'worker', type: 'worker', url: 'http://localhost/owned' },
    { id: 'decoy', type: 'page', url: 'http://localhost/owned/other' },
  ]
  // Act
  const target = selectPageTarget(targets, 'http://localhost/owned')
  // Assert
  assert.equal(target, undefined)
})

test('unknown host selection fails before launching an editor', () => {
  // Arrange / Act / Assert
  assert.throws(() => selectHost('unknown-editor'), /Unsupported editor host/)
  assert.equal(selectHost(undefined), 'vscode')
  assert.equal(selectHost('cursor'), 'cursor')
})
