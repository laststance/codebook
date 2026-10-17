import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRecordedStudyGroups } from '../utils/parseRecordedStudyGroups'

test('a version-1 record a 0.2.30 candidate wrote is read as the Application group alone, at its recorded column', () => {
  // Arrange
  const stored = {
    version: 1,
    writer: '3f0c5a52-8f4e-4f43-9a5e-1d2b7c9e6a10',
    column: 1,
    groupCount: 3,
    layout: {
      orientation: 1,
      groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
    },
  }

  // Act
  const record = parseRecordedStudyGroups(stored)

  // Assert
  assert.deepEqual(record, {
    writer: '3f0c5a52-8f4e-4f43-9a5e-1d2b7c9e6a10',
    columns: [1],
    groupCount: 3,
    layout: {
      orientation: 1,
      groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
    },
  })
})

test('a version-2 record is read with every group it names', () => {
  // Arrange
  const stored = {
    version: 2,
    writer: 'the window before the reload',
    columns: [1, 3],
    groupCount: 3,
    layout: {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    },
  }

  // Act
  const record = parseRecordedStudyGroups(stored)

  // Assert
  assert.deepEqual(record, {
    writer: 'the window before the reload',
    columns: [1, 3],
    groupCount: 3,
    layout: {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    },
  })
})

test('a version-2 record that names a single group proves no group, since only version 1 names one group', () => {
  // Arrange
  const stored = {
    version: 2,
    writer: 'the window before the reload',
    columns: [1],
    groupCount: 2,
    layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
  }

  // Act
  const record = parseRecordedStudyGroups(stored)

  // Assert
  assert.equal(record, undefined)
})

test('a record of an unknown version proves no group', () => {
  // Arrange
  const stored = {
    version: 3,
    writer: 'a later Codebook',
    columns: [1, 3],
    groupCount: 3,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] },
  }

  // Act
  const record = parseRecordedStudyGroups(stored)

  // Assert
  assert.equal(record, undefined)
})

test('a workspace with no record proves no group', () => {
  // Arrange
  const stored = undefined

  // Act
  const record = parseRecordedStudyGroups(stored)

  // Assert
  assert.equal(record, undefined)
})
