import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyWikiUpdateEnd,
  type WikiUpdateEndFacts,
} from '../utils/classifyWikiUpdateEnd'

/** A VS Code run in which nothing happened yet: same site, nothing published, nothing failed. */
const NOTHING_HAPPENED: WikiUpdateEndFacts = {
  host: 'vscode',
  cancelled: false,
  timedOut: false,
  tokenAtStart: 'old@1',
  tokenAtEnd: 'old@1',
  published: undefined,
  blockingPaths: [],
  failure: undefined,
}

test('a new site that matches the source ends the run as succeeded with its identity', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'succeeded',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
  })
})

test('a new site published while the source changed ends as failed, says the site was replaced and counts the changed files', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      freshness: {
        status: 'changed',
        changedPaths: ['src/a.ts', 'src/b.ts'],
        addedPaths: ['src/c.ts'],
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    reason:
      'The editor agent published a new Wiki, but 3 source files changed while it worked (first: src/a.ts). Press Update LLM Wiki again.',
  })
})

test('one changed source file is counted in the singular', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    tokenAtEnd: 'new@2',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      freshness: {
        status: 'changed',
        changedPaths: [],
        addedPaths: ['src/new.ts'],
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    reason:
      'Cursor Agent published a new Wiki, but 1 source file changed while it worked (first: src/new.ts). Press Update LLM Wiki again.',
  })
})

test('a new site Codebook cannot check against the source says why and that updating again will not help', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      freshness: {
        status: 'unknown',
        changedPaths: [],
        addedPaths: [],
        reason:
          'Added source files could not be checked against the generated revision.',
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    reason:
      'The editor agent published a new Wiki, but Codebook cannot check it against the source: Added source files could not be checked against the generated revision. Updating again will not change this; ask the editor chat to republish with the full commit hash in generated.revision.',
  })
})

test('a new site whose manifest cannot be read ends as failed with the site replaced', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    tokenAtEnd: 'new@2',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    reason:
      'Cursor Agent published a new Wiki, but Codebook cannot read its manifest. Press Update LLM Wiki again.',
  })
})

test('an agent error after a publish keeps the agent’s reason and says the site was replaced', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    tokenAtEnd: 'new@2',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
    failure: 'Cursor Agent stopped with exit code 1 before finishing.',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    reason: 'Cursor Agent stopped with exit code 1 before finishing.',
  })
})

test('an agent error with the site untouched ends as failed with the site kept', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    failure: 'Cursor Agent CLI is not installed.',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'kept',
    reason: 'Cursor Agent CLI is not installed.',
  })
})

test('a Cursor run past its bound ends as timed out, the state VS Code reports for the same event', () => {
  // Arrange
  const cursor: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    timedOut: true,
    failure: 'Cursor Agent timed out updating the Wiki.',
  }
  const vscode: WikiUpdateEndFacts = { ...NOTHING_HAPPENED, timedOut: true }

  // Act
  const cursorEnd = classifyWikiUpdateEnd(cursor)
  const vscodeEnd = classifyWikiUpdateEnd(vscode)

  // Assert
  assert.deepEqual(cursorEnd, { state: 'timed-out', site: 'kept' })
  assert.deepEqual(vscodeEnd, { state: 'timed-out', site: 'kept' })
})

test('a cancel that came after a publish is still a cancel, and says the site was replaced', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    cancelled: true,
    tokenAtEnd: 'new@2',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, { state: 'cancelled', site: 'replaced' })
})

test('a cancel with the site untouched says the site was kept', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = { ...NOTHING_HAPPENED, cancelled: true }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, { state: 'cancelled', site: 'kept' })
})

test('learner files in the way end the run as a conflict even when the agent also reported an error', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    blockingPaths: ['pages/notes.html'],
    failure: 'Cursor Agent stopped with exit code 1 before finishing.',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'conflict',
    paths: ['pages/notes.html'],
    cause: 'learner-file',
    site: 'kept',
  })
})

test('an agent that ends its turn without publishing and without an error is a failure that kept the site', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = { ...NOTHING_HAPPENED, host: 'cursor' }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'kept',
    reason:
      'Cursor Agent finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
  })
})

test('a site that vanished during the run is not reported as kept', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: undefined,
    failure: 'The watch could not read the Wiki folder.',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    reason: 'The watch could not read the Wiki folder.',
  })
})
