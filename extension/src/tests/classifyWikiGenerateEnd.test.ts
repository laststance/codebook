import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyWikiUpdateEnd,
  type WikiUpdateEndFacts,
} from '../utils/classifyWikiUpdateEnd'

/** A generation in a folder that held no Wiki, which nothing stopped and after which nothing is on disk. */
const NOTHING_PUBLISHED: WikiUpdateEndFacts = {
  runKind: 'generate',
  outputLabel: '.codebook/wiki',
  host: 'cursor',
  cancelled: false,
  timedOut: false,
  tokenAtStart: undefined,
  tokenAtEnd: undefined,
  publicationAtStart: undefined,
  publicationAtEnd: undefined,
  published: undefined,
  uncoveredAtStart: [],
  blockingPaths: [],
  failure: undefined,
}

/** The facts of a generation whose publisher's receipt names a new manifest, with the given freshness. */
const publishedWith = (
  freshness: NonNullable<WikiUpdateEndFacts['published']>['freshness'],
): WikiUpdateEndFacts => ({
  ...NOTHING_PUBLISHED,
  tokenAtEnd: 'b@8',
  publicationAtEnd: 'receipt-of-b',
  published: {
    identity: '1936e4191372+0f9e8d7c',
    revision: '1936e4191372',
    index: '0f9e8d7c',
    freshness,
  },
})

// Value: protects=AC 4's success; fails_when=a new publication of this project is not a generation's success; no_claim=the owner and entry-page checks (generatedSiteProblem tests below); seam=none
test('a generation whose publisher published a current Wiki ends as succeeded with its identity', () => {
  // Act
  const end = classifyWikiUpdateEnd(
    publishedWith({ status: 'current', changedPaths: [], addedPaths: [] }),
  )

  // Assert
  assert.deepEqual(end, {
    state: 'succeeded',
    identity: '1936e4191372+0f9e8d7c',
    revision: '1936e4191372',
    index: '0f9e8d7c',
  })
})

// Value: protects=Eng decision 75, a source edited during a generation of up to 55 minutes; fails_when=a usable new Wiki that is behind the source ends as failed, as an update's does, or its count of changed files is lost; no_claim=the notice's words (wikiGenerateNotice tests); seam=none
test('a generation that published while sources changed ends as succeeded, with the count of changed and added sources', () => {
  // Act
  const end = classifyWikiUpdateEnd(
    publishedWith({
      status: 'changed',
      changedPaths: ['src/a.ts'],
      addedPaths: ['src/new.ts'],
    }),
  )

  // Assert
  assert.deepEqual(end, {
    state: 'succeeded',
    identity: '1936e4191372+0f9e8d7c',
    revision: '1936e4191372',
    index: '0f9e8d7c',
    changedSourceCount: 2,
  })
})

// Value: protects=DX decision 54, a publication of another checkout or without its entry page; fails_when=such a publication is called generated, or its manifest of another checkout is told as one that cannot be read; no_claim=how the extension finds the problem (findGeneratedWikiProblem tests); seam=none
test('a new publication that failed the owner or entry-page check ends as failed with that check’s sentence, also when its manifest cannot be read as this project’s', () => {
  // Act
  const end = classifyWikiUpdateEnd({
    ...publishedWith({ status: 'current', changedPaths: [], addedPaths: [] }),
    published: undefined,
    generatedSiteProblem:
      'The LLM Wiki published in .codebook/wiki does not identify this opened project.',
  })

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    reason:
      'The LLM Wiki published in .codebook/wiki does not identify this opened project.',
    isCodebookSentence: true,
    site: 'replaced',
  })
})

// Value: protects=AC 4, a publication whose manifest cannot be read; fails_when=it ends as generated or names no recovery; no_claim=the recovery itself; seam=none
test('a new publication whose manifest cannot be read ends as failed with the recovery request', () => {
  // Act
  const end = classifyWikiUpdateEnd({
    ...publishedWith({ status: 'current', changedPaths: [], addedPaths: [] }),
    published: undefined,
  })

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    reason:
      'An LLM Wiki was published in .codebook/wiki, but Codebook cannot read its manifest. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project".',
    isCodebookSentence: true,
    site: 'replaced',
  })
})

// Value: protects=AC 4, a manifest written without a publish; fails_when=a manifest without a new receipt is called generated; no_claim=the publisher's receipt itself; seam=none
test('a manifest that appeared without a new publication receipt ends as failed and is never called generated', () => {
  // Act
  const end = classifyWikiUpdateEnd({
    ...NOTHING_PUBLISHED,
    tokenAtEnd: 'b@8',
  })

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    reason:
      'A manifest appeared in .codebook/wiki during the generation, but not through a publish of the Codebook publisher, so Codebook cannot call it a generated Wiki. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project".',
    isCodebookSentence: true,
    site: 'replaced',
  })
})

// Value: protects=D5 and AC 4, a generation that published nothing; fails_when=its sentence calls it an update, names no folder or no next step; no_claim=the agent's own reply; seam=none
test('a generation that published nothing ends as failed with a sentence of each host that names the folder and the next step', () => {
  // Act
  const ends = {
    cursor: classifyWikiUpdateEnd(NOTHING_PUBLISHED),
    vscode: classifyWikiUpdateEnd({ ...NOTHING_PUBLISHED, host: 'vscode' }),
  }

  // Assert
  assert.deepEqual(ends, {
    cursor: {
      state: 'failed',
      reason:
        'Cursor Agent finished without publishing an LLM Wiki in .codebook/wiki. Press Generate LLM Wiki to try again, or ask the editor chat "/codebook Generate the LLM Wiki for this project" to see what it says.',
      isCodebookSentence: true,
      site: 'kept',
    },
    vscode: {
      state: 'failed',
      reason:
        'The editor chat finished its reply without publishing an LLM Wiki in .codebook/wiki. Read its reply in the Chat view, then press Generate LLM Wiki again.',
      isCodebookSentence: true,
      site: 'kept',
    },
  })
})

// Value: protects=AC 4, Cancel and the bound of a generation; fails_when=a stopped generation is judged by what was published instead of being told as stopped; no_claim=the notice's words; seam=none
test('a generation stopped by the learner or its bound ends as cancelled or timed out', () => {
  // Act
  const ends = {
    cancelled: classifyWikiUpdateEnd({ ...NOTHING_PUBLISHED, cancelled: true }),
    timedOut: classifyWikiUpdateEnd({ ...NOTHING_PUBLISHED, timedOut: true }),
  }

  // Assert
  assert.deepEqual(ends, {
    cancelled: { state: 'cancelled', site: 'kept' },
    timedOut: { state: 'timed-out', site: 'kept' },
  })
})

// Value: protects=an agent's failure sentence during a generation; fails_when=the failure the agent or its CLI reported is replaced by the generation's own sentence; no_claim=the record, which never holds it (wikiRunRecord tests); seam=none
test('a generation whose agent reported a failure ends as failed with that failure', () => {
  // Act
  const end = classifyWikiUpdateEnd({
    ...NOTHING_PUBLISHED,
    failure: 'Cursor Agent stopped with exit code 1 before finishing.',
  })

  // Assert
  assert.deepEqual(end, {
    state: 'failed',
    reason: 'Cursor Agent stopped with exit code 1 before finishing.',
    site: 'kept',
  })
})
