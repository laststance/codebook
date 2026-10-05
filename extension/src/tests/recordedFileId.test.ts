import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isRecordedFileId } from '../utils/isRecordedFileId'
import { isSameFileId } from '../utils/isSameFileId'
import { recordedFileId } from '../utils/recordedFileId'

// Value: protects=a window of 0.2.29.0 that shares an ownership record with this version, and a file on an NTFS volume whose id is above 2^53; fails_when=every id is recorded as text (0.2.29.0 rejects the record as invalid) or every id as a number (an id above 2^53 is rounded and names no file); why_new=Cycle 0046 row 79; seam=none
test('a file id is recorded as the number itself while a number holds it exactly, and as its decimal digits above that', () => {
  // Arrange: an ordinary inode number, the largest number that is exact, the first id above it, and the id observed on the development host.
  const fileIds = [
    1_837_462n,
    9_007_199_254_740_991n,
    9_007_199_254_740_992n,
    210_824_757_556_437_109n,
  ]

  // Act
  const recorded = fileIds.map(recordedFileId)

  // Assert
  assert.deepEqual(recorded, [
    1_837_462,
    9_007_199_254_740_991,
    '9007199254740992',
    '210824757556437109',
  ])
})

// Value: protects=the check that decides whether a record names a file before Codebook changes or removes that file; fails_when=a record of 0.2.29.0 (numbers) or of this version for a large id (decimal text) is rejected, or a number that was rounded when it was written, a negative number or text that is no plain decimal number is accepted as naming a file; why_new=Cycle 0046 row 79; seam=none
test('a record’s file id is accepted as an exact whole number or as plain decimal digits, and a number above 2^53, which was rounded when it was written, is not', () => {
  // Arrange
  const values: unknown[] = [
    1_837_462,
    0,
    '210824757556437109',
    '18446744073709551615',
    210_824_757_556_437_120,
    -1,
    1.5,
    '0x26075',
    '0123',
    '-5',
    '',
    '184467440737095516150',
    undefined,
    null,
  ]

  // Act
  const accepted = values.map(isRecordedFileId)

  // Assert
  assert.deepEqual(accepted, [
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ])
})

// Value: protects=the question whether a file is still the one a record names, on an NTFS volume; fails_when=the two are compared as JavaScript numbers, so two files whose ids differ only below the rounding count as one, or a record with a number no longer matches the file it names; why_new=Cycle 0046 row 79; seam=none
test('a file is the one a record names only when the digits of its id are the same, also where a number would round two ids to one value', () => {
  // Arrange: 210824757556437109 and 210824757556437110 are both 210824757556437120 as numbers.
  const comparisons: [number | string, bigint][] = [
    [1_837_462, 1_837_462n],
    ['1837462', 1_837_462n],
    ['210824757556437109', 210_824_757_556_437_109n],
    ['210824757556437109', 210_824_757_556_437_110n],
    [1_837_462, 1_837_463n],
  ]

  // Act
  const same = comparisons.map(([recorded, fileId]) =>
    isSameFileId(recorded, fileId),
  )

  // Assert
  assert.deepEqual(same, [true, true, true, false, false])
})
