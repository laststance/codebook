import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

// Value: protects=the Learning summary view having a container Cursor accepts; fails_when=the manifest contributes `codebookLearning` to the Secondary Side Bar again (Cursor rejects it with "View containers cannot be contributed to the Secondary Side Bar in Cursor" and drops the view into Explorer); why_new=Cycle 0050 F209 and D31; seam=the manifest file; no_claim=how either host draws the container (the native check in Cursor)
test('the Learning summary container is contributed to the Activity Bar and no view container to the Secondary Side Bar', async () => {
  // Arrange
  const manifest: {
    contributes: {
      viewsContainers: Record<string, Array<{ id: string }>>
      views: Record<string, Array<{ id: string }>>
    }
  } = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )

  // Act
  const containers = manifest.contributes.viewsContainers

  // Assert
  assert.deepEqual(
    containers.activitybar?.map((container) => container.id),
    ['codebook', 'codebookLearning'],
  )
  assert.equal(containers.secondarySidebar, undefined)
  assert.deepEqual(
    manifest.contributes.views.codebookLearning?.map((view) => view.id),
    ['codebook.learningSummary'],
  )
})
