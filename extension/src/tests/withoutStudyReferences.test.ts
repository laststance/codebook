import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LearnerProgress } from '../learnerSchemas'
import { withoutStudyReferences } from '../utils/withoutStudyReferences'

const WORKSPACE_KEY = 'a'.repeat(64)
const REMOVED_STUDY = 'window_removed-run'
const OTHER_STUDY = 'window_other-run'

/** A ledger whose selection and repository return both name the given study. */
function ledgerNaming(studyId: string): LearnerProgress {
  return {
    version: 4,
    workspaceKey: WORKSPACE_KEY,
    decisions: [],
    repositorySelection: {
      bookId: 'workspace',
      revision: 3,
      nodeId: 'overview',
      anchorIndex: 0,
    },
    selection: {
      studyId,
      profile: 'repository-browser',
      itemId: 'repository/interface/theme',
      follow: false,
      tab: 'live',
    },
    repositoryReturn: {
      studyId,
      selection: {
        bookId: 'workspace',
        revision: 3,
        nodeId: 'overview',
        anchorIndex: 0,
      },
    },
  }
}

test('removing a saved study drops the ledger’s selected study and its Wiki return, and keeps what the learner was reading', () => {
  // Arrange
  const ledger = ledgerNaming(REMOVED_STUDY)
  // Act: the rewritten ledger as the library writes it.
  const rewritten: unknown = JSON.parse(
    JSON.stringify(withoutStudyReferences(ledger, REMOVED_STUDY)),
  )
  // Assert
  assert.deepEqual(rewritten, {
    version: 4,
    workspaceKey: WORKSPACE_KEY,
    decisions: [],
    repositorySelection: {
      bookId: 'workspace',
      revision: 3,
      nodeId: 'overview',
      anchorIndex: 0,
    },
    selection: {
      profile: 'repository-browser',
      itemId: 'repository/interface/theme',
      follow: false,
      tab: 'live',
    },
  })
})

test('a ledger that names another study is left untouched when a saved study is removed', () => {
  // Arrange
  const ledger = ledgerNaming(OTHER_STUDY)
  // Act
  const rewritten = withoutStudyReferences(ledger, REMOVED_STUDY)
  // Assert
  assert.equal(rewritten, undefined)
})

test('only the reference that names the removed study leaves the ledger', () => {
  // Arrange: the selection shows another study; the Wiki return names the removed one.
  const ledger = {
    ...ledgerNaming(REMOVED_STUDY),
    selection: ledgerNaming(OTHER_STUDY).selection,
  }
  // Act: the rewritten ledger as the library writes it.
  const rewritten: unknown = JSON.parse(
    JSON.stringify(withoutStudyReferences(ledger, REMOVED_STUDY)),
  )
  // Assert
  assert.deepEqual(rewritten, {
    version: 4,
    workspaceKey: WORKSPACE_KEY,
    decisions: [],
    repositorySelection: {
      bookId: 'workspace',
      revision: 3,
      nodeId: 'overview',
      anchorIndex: 0,
    },
    selection: {
      studyId: OTHER_STUDY,
      profile: 'repository-browser',
      itemId: 'repository/interface/theme',
      follow: false,
      tab: 'live',
    },
  })
})
