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
  publicationAtStart: 'old@7',
  publicationAtEnd: 'old@7',
  published: undefined,
  uncoveredAtStart: [],
  blockingPaths: [],
  failure: undefined,
}

test('a new site that matches the source ends the run as succeeded with its identity', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'succeeded',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
  })
})

test('a new site published while the source changed ends as failed, says the site was replaced and counts the changed files', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
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
    isCodebookSentence: true,
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
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
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
    isCodebookSentence: true,
    reason:
      'Cursor Agent published a new Wiki, but 1 source file changed while it worked (first: src/new.ts). Press Update LLM Wiki again.',
  })
})

test('a new site Codebook cannot check against the source says why and that updating again will not help', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
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
    isCodebookSentence: true,
    reason:
      'The editor agent published a new Wiki, but Codebook cannot check it against the source: Added source files could not be checked against the generated revision. Updating again will not change this; ask the editor chat to republish with the full commit hash in generated.revision.',
  })
})

test('a new site with an indexed source Codebook cannot check names that file and how the manifest must list it', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: {
        status: 'unknown',
        changedPaths: [],
        addedPaths: [],
        reason: 'An indexed source could not be checked: ../shared/schema.ts.',
        uncheckedPath: '../shared/schema.ts',
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    isCodebookSentence: true,
    reason:
      'The editor agent published a new Wiki, but Codebook cannot check it against the source: An indexed source could not be checked: ../shared/schema.ts. Updating again will not change this; ask the editor chat to republish with that file listed by a path inside the project and its full-file SHA-256, or without it.',
  })
})

test('a new site whose manifest cannot be read ends as failed with the site replaced', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    isCodebookSentence: true,
    reason:
      'Cursor Agent published a new Wiki, but Codebook cannot read its manifest. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  })
})

test('a Cursor publish that matches the source ends as Updated although the CLI also reported a failure', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
    failure: 'Cursor Agent stopped with exit code 1 before finishing.',
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'succeeded',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
  })
})

test('an agent error after a publish that does not match the source keeps the agent’s reason and says the site was replaced', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: {
        status: 'changed',
        changedPaths: ['src/a.ts'],
        addedPaths: [],
      },
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

// Value: protects=the next step of a failure Codebook worded itself (a chat that did not open) on the Wiki page, which cuts a reason at 160 characters unless it is marked as Codebook's sentence; fails_when=a failure the host hands over can never be marked, so its next step moves into the disclosure; why_new=Cycle 0045 local review wiki-1 #9; seam=none
test('a failure sentence Codebook wrote itself ends the run as failed with the reason marked as Codebook’s sentence', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    failure:
      'The editor chat did not open within 30 seconds. Check that GitHub Copilot Chat is installed and enabled, then press Update LLM Wiki again.',
    isFailureCodebookSentence: true,
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    reason:
      'The editor chat did not open within 30 seconds. Check that GitHub Copilot Chat is installed and enabled, then press Update LLM Wiki again.',
    isCodebookSentence: true,
    site: 'kept',
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
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
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
    isCodebookSentence: true,
    reason:
      'Cursor Agent finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
  })
})

// Value: protects=the learner whose VS Code chat finished its reply without publishing; fails_when=the sentence tells them to run the update request in the chat "to see its own message", which sends a second request, although the reply is already in the Chat view; why_new=Cycle 0046 row 149 (a completed reply now ends a VS Code run this way); seam=none
test('a VS Code chat that finishes its reply without publishing is a failure that kept the site and says where the reply is', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = { ...NOTHING_HAPPENED, host: 'vscode' }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'kept',
    isCodebookSentence: true,
    reason:
      'The editor chat finished its reply without publishing a new Wiki. Read its reply in the Chat view, then press Update LLM Wiki again.',
  })
})

test('a site missing at the run’s end is not called a newly published Wiki', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    // The watch was stopped while the publisher had moved the old folder away and not yet the new one in.
    cancelled: true,
    tokenAtEnd: undefined,
    publicationAtEnd: undefined,
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'missing',
    isCodebookSentence: true,
    reason:
      'The Wiki is missing after a publish that did not finish. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  })
})

test('a Git check that timed out asks for another press, not for a commit hash', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: {
        status: 'unknown',
        changedPaths: [],
        addedPaths: [],
        reason:
          'Git did not answer in time, so added source files could not be checked.',
        unknownCause: 'git-timeout',
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    isCodebookSentence: true,
    reason:
      'The editor agent published a new Wiki, but Codebook cannot check it against the source: Git did not answer in time, so added source files could not be checked. Press Update LLM Wiki again.',
  })
})

test('a publish in a project without a Git repository ends as Updated without a revision, since none was checked', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'no-revision+0f9e8d7c',
      index: '0f9e8d7c',
      freshness: {
        status: 'current',
        changedPaths: [],
        addedPaths: [],
        addedFilesUnchecked: true,
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'succeeded',
    identity: 'no-revision+0f9e8d7c',
    index: '0f9e8d7c',
  })
})

test('a file that was uncovered before the run is not reported as changed during it and does not ask for another press', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    uncoveredAtStart: ['src/new.ts', 'src/other.ts'],
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: {
        status: 'changed',
        changedPaths: [],
        addedPaths: ['src/new.ts', 'src/other.ts'],
      },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    isCodebookSentence: true,
    reason:
      'The editor agent published a new Wiki, but 2 source files are neither indexed nor excluded (first: src/new.ts). Ask the editor chat to index or exclude them.',
  })
})

test('a manifest rewritten without a publish is not called a new site, however well it matches the source', () => {
  // Arrange
  const facts: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    host: 'cursor',
    // The same bytes under a new inode: the old receipt still vouches for them, so the publication is the one the run started with.
    tokenAtEnd: 'old@2',
    publicationAtEnd: 'old@7',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
  }

  // Act
  const end = classifyWikiUpdateEnd(facts)

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    site: 'replaced',
    isCodebookSentence: true,
    reason:
      'The Wiki’s manifest changed during the update, but not through a publish of the Codebook publisher, so Codebook cannot call it a new site. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  })
})

// Value: protects=the mark of a failed end after which a chat can still publish, on its way from the start in the chat to the page and the notice; fails_when=the classifier drops the mark, so the notice says the site is kept for good, or keeps it on an end that is the chat's own publish; why_new=Cycle 0046 row 341; seam=none
test('a failure after which the chat can still publish ends the run as failed and marked as an end the site may be replaced after, and a publish that matches the source is still the run’s success, without the mark', () => {
  // Arrange
  const mayStillBeInTheChat: WikiUpdateEndFacts = {
    ...NOTHING_HAPPENED,
    failure:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
    isFailureCodebookSentence: true,
    mayBeReplacedLater: true,
  }
  const publishedMeanwhile: WikiUpdateEndFacts = {
    ...mayStillBeInTheChat,
    tokenAtEnd: 'new@2',
    publicationAtEnd: 'new@8',
    published: {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      freshness: { status: 'current', changedPaths: [], addedPaths: [] },
    },
  }

  // Act
  const failed = classifyWikiUpdateEnd(mayStillBeInTheChat)
  const succeeded = classifyWikiUpdateEnd(publishedMeanwhile)

  // Assert
  assert.deepEqual(failed, {
    state: 'failed',
    reason:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
    isCodebookSentence: true,
    mayBeReplacedLater: true,
    site: 'kept',
  })
  assert.deepEqual(succeeded, {
    state: 'succeeded',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
  })
})
