import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { workspaceHarness } from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

// Value: protects=one thing counts the same in every admission under the Saved Study Limit: a saved study takes a place for a Node test as it does for a study, and what is left of a study without its archive takes none in either; fails_when=the reader hands the Node history store the length of the Saved studies list, which since Cycle 0046 row 86 also holds what is left of a study without its archive, so such a rest refuses a Node test although the library itself would admit a study (Cycle 0046 row 183); why_new=the list and the count were the same number until row 86; seam=the reader's own library and Node history store, and the library directory, into which the test writes the catalog file a removal by hand left
test('what is left of a saved study without its archive takes no place in the admission of a Node test, as it takes none in the admission of a study, and a saved study takes one in both', async () => {
  // Arrange: a limit of two. The library holds one saved study, and the catalog file of a study whose archive was removed by hand.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(2)
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!,
      histories = harness.service.nodeHistoryStore!
    const saved = {
      ...createConfiguredStudy(),
      workspaceKey: library.workspaceKey,
    }
    await library.saveStudy(saved)
    const restId = `${randomUUID()}_${randomUUID()}`
    await writeFile(join(directory, `${restId}.study.meta.v3.json`), '{}')
    const outcomeOf = (starting: Promise<unknown>): Promise<string> =>
      starting.then(
        () => 'admitted',
        (error: unknown) => String(error),
      )
    // Act: a study and a Node test ask for the second place; then a second Node test asks for a third.
    const listedFormats = (await library.list())
      .map(
        (entry) => `${entry.id === restId ? 'rest' : 'saved'}: ${entry.format}`,
      )
      .sort()
    const savedStudyCount = await library.savedStudyCount()
    const isAnotherStudyAdmitted = await library.admitsStudy(
      `${randomUUID()}_${randomUUID()}`,
    )
    const firstNodeTest = await outcomeOf(
      histories.start(nodeTestHistoryHeader(histories.workspaceKey)),
    )
    const secondNodeTest = await outcomeOf(
      histories.start(nodeTestHistoryHeader(histories.workspaceKey)),
    )
    // Assert
    assert.deepEqual(listedFormats, ['rest: archive-missing', 'saved: v3'])
    assert.equal(savedStudyCount, 1)
    assert.equal(isAnotherStudyAdmitted, true)
    assert.equal(firstNodeTest, 'admitted')
    assert.equal(
      secondNodeTest,
      'Error: Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
    )
  } finally {
    await harness.close()
  }
})
