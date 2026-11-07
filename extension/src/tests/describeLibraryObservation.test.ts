import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeLibraryObservation,
  type LibraryObservationInput,
} from '../utils/describeLibraryObservation'

const BUILT: LibraryObservationInput = {
  package: '@acme/widgets',
  version: '2.14.0',
  revision: '7114787aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
  packageManager: 'pnpm',
  observation: 'complete',
  loaded: true,
  publishedCopyLoaded: false,
}

// protects=the correspondence sentence is worded only for a loaded packed copy, no other copy and a complete observation; fails_when=any other state words the claim; no_claim=what the run actually loaded (the observation is an input)
test('words the correspondence only when the packed copy loaded alone and the observation is complete', () => {
  // Arrange / Act
  const sentence = describeLibraryObservation(BUILT)
  // Assert
  assert.equal(
    sentence,
    'Ran on the checked-out @acme/widgets 2.14.0 built from 7114787 (packed by pnpm)',
  )
})

// protects=an observation that is pending, incomplete or unreadable is never worded as "not loaded", for a script and for a page; fails_when=a non-complete state reads as a negative or as the claim; no_claim=none beyond protects
test('says what was loaded was not fully observed for every state but complete', () => {
  // Arrange
  const states = ['pending', 'incomplete', 'unreadable'] as const
  // Act
  const sentences = states.map((observation) => [
    describeLibraryObservation({ ...BUILT, observation }),
    describeLibraryObservation({ ...BUILT, observation }, 'page'),
  ])
  // Assert
  assert.deepEqual(sentences, [
    [
      'What the script loaded was not fully observed.',
      'What the page loaded was not fully observed.',
    ],
    [
      'What the script loaded was not fully observed.',
      'What the page loaded was not fully observed.',
    ],
    [
      'What the script loaded was not fully observed.',
      'What the page loaded was not fully observed.',
    ],
  ])
})

// protects=another loaded copy is named before any negative or claim, with its path and the uncommitted-changes note; fails_when=the sentence claims correspondence or hides the copy that ran; no_claim=none beyond protects
test('names the other copy that was loaded and never claims correspondence', () => {
  // Arrange
  const withBoth = {
    ...BUILT,
    dirty: true,
    publishedCopyLoaded: true,
    publishedCopyPath: '/repo/node_modules/@acme/widgets/index.js',
  }
  // Act
  const both = describeLibraryObservation(withBoth)
  const onlyOther = describeLibraryObservation(
    { ...withBoth, loaded: false },
    'page',
  )
  // Assert
  assert.equal(
    both,
    'Built @acme/widgets 2.14.0 from 7114787 (uncommitted changes), but the script also loaded another copy at /repo/node_modules/@acme/widgets/index.js.',
  )
  assert.equal(
    onlyOther,
    'Built @acme/widgets 2.14.0 from 7114787 (uncommitted changes), but the page did not load it; it loaded another copy at /repo/node_modules/@acme/widgets/index.js.',
  )
})

// protects=a complete observation that found no module of the package says built but not loaded, in the script's and the page's words; fails_when=the sentence claims correspondence or says nothing was built; no_claim=none beyond protects
test('says built but not loaded when a complete observation found nothing of the package', () => {
  // Arrange
  const notLoaded = { ...BUILT, loaded: false }
  // Act
  const script = describeLibraryObservation(notLoaded)
  const page = describeLibraryObservation(notLoaded, 'page')
  // Assert
  assert.equal(
    script,
    'Built @acme/widgets 2.14.0, but not loaded by this script.',
  )
  assert.equal(page, 'Built @acme/widgets 2.14.0, but not served to this page.')
})

// protects=reachedThrough appends the declared relation to the correspondence sentence only, and the count adds "and N more"; fails_when=the suffix is missing, appears on a non-claim sentence, or the extra count is not stated; no_claim=an observed importer
test('appends the declared dependencies to the correspondence sentence only', () => {
  // Arrange
  const through = {
    reachedThrough: ['@acme/a', '@acme/b'],
    reachedThroughCount: 2,
  }
  // Act
  const listed = describeLibraryObservation({ ...BUILT, ...through }, 'page')
  const withMore = describeLibraryObservation(
    { ...BUILT, reachedThrough: ['@acme/a'], reachedThroughCount: 4 },
    'page',
  )
  const notLoaded = describeLibraryObservation(
    { ...BUILT, ...through, loaded: false },
    'page',
  )
  // Assert
  assert.equal(
    listed,
    'Ran on the checked-out @acme/widgets 2.14.0 built from 7114787 (packed by pnpm), declared by @acme/a, @acme/b in this Example',
  )
  assert.equal(
    withMore,
    'Ran on the checked-out @acme/widgets 2.14.0 built from 7114787 (packed by pnpm), declared by @acme/a and 3 more in this Example',
  )
  assert.equal(
    notLoaded,
    'Built @acme/widgets 2.14.0, but not served to this page.',
  )
})
