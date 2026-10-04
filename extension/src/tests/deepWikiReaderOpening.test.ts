import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { openWikiOpeningWindow } from './utils/wikiOpeningWindow'

test('a source changed outside the editor reaches the open Wiki, which watches the project’s files until it is closed', async () => {
  // Arrange
  const window = await openWikiOpeningWindow()
  try {
    await window.open()
    const changedOutside = join(window.projectRoot, 'src/a.ts')
    const created = join(window.projectRoot, 'src/new.ts')
    const deleted = join(window.projectRoot, 'src/old.ts')

    // Act: Git or an agent's CLI writes the files; the editor's watcher reports them, no save happens.
    window.files.report('change', changedOutside)
    window.files.report('create', created)
    window.files.report('delete', deleted)

    // Assert
    assert.deepEqual(
      window.files.watched.map((pattern) => [pattern.base, pattern.pattern]),
      [[window.projectRoot, '**']],
    )
    assert.deepEqual(window.readers[0]?.notedSourceChanges, [
      changedOutside,
      created,
      deleted,
    ])
  } finally {
    await window.close()
  }
  assert.equal(window.files.liveWatcherCount(), 0)
})
