import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bookIdOfFileName } from '../utils/bookIdOfFileName'

// Value: protects=the list of repository books and the book count of a save in a learning directory that holds other files; fails_when=a file with a book suffix whose prefix is no book id is taken for a book or throws, or a book file of either storage format is not recognised; why_new=Cycle 0046 package PRF, found while working F3 (row 48); seam=none
test('a file of the learning directory is a book only when its name is a book id followed by a book suffix', () => {
  // Arrange
  const fileNames = [
    'architecture.book.v2.json',
    'module-map-2.book.v1.json',
    'X.book.v1.json',
    'my_notes.book.v2.json',
    '.book.v2.json',
    'architecture.book.v3.json',
    'writer.lock',
  ]

  // Act
  const bookIds = fileNames.map((fileName) => [
    fileName,
    bookIdOfFileName(fileName),
  ])

  // Assert
  assert.deepEqual(bookIds, [
    ['architecture.book.v2.json', 'architecture'],
    ['module-map-2.book.v1.json', 'module-map-2'],
    ['X.book.v1.json', undefined],
    ['my_notes.book.v2.json', undefined],
    ['.book.v2.json', undefined],
    ['architecture.book.v3.json', undefined],
    ['writer.lock', undefined],
  ])
})
