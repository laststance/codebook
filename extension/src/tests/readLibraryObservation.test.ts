import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readLibraryObservation } from '../utils/readLibraryObservation'

/** Writes the lines to a fresh observation file and reads it. */
async function readLines(lines: string[]) {
  const file = join(mkdtempSync(join(tmpdir(), 'observation-')), 'o.jsonl')
  writeFileSync(file, lines.map((line) => `${line}\n`).join(''))
  return readLibraryObservation(file)
}

// protects=loads of every process add up and the run is complete when each process closed; fails_when=only one process counts or a closing is required of none; no_claim=file limits
test('adds the loads of two processes that both closed and reads the run as complete', async () => {
  // Arrange
  const lines = [
    '{"event":"start","pid":1}',
    '{"event":"load","path":"/p/a.mjs","pid":1}',
    '{"event":"start","pid":2}',
    '{"event":"load","path":"/p/b.mjs","pid":2}',
    '{"event":"closing","code":0,"pid":2}',
    '{"event":"closing","code":0,"pid":1}',
  ]
  // Act
  const observed = await readLines(lines)
  // Assert
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.loadCount, 2)
})

// protects=a process that started and never closed makes the run incomplete; fails_when=any closing line completes the run; no_claim=why the process did not close
test('reads the run as incomplete when one process wrote no closing line', async () => {
  // Arrange
  const lines = [
    '{"event":"start","pid":1}',
    '{"event":"start","pid":2}',
    '{"event":"closing","code":0,"pid":1}',
  ]
  // Act
  const observed = await readLines(lines)
  // Assert
  assert.equal(observed.observation, 'incomplete')
})

// protects=a closing line without its start is incomplete; fails_when=it reads complete; no_claim=none
test('reads a closing line without its start as incomplete', async () => {
  // Arrange
  const lines = [
    '{"event":"start","pid":1}',
    '{"event":"closing","code":0,"pid":1}',
    '{"event":"closing","code":0,"pid":2}',
  ]
  // Act
  const observed = await readLines(lines)
  // Assert
  assert.equal(observed.observation, 'incomplete')
})

// protects=an empty file has no start so it is incomplete, never complete; fails_when=zero processes read complete; no_claim=none
test('reads a file without any start line as incomplete', async () => {
  // Arrange / Act
  const observed = await readLines([])
  // Assert
  assert.equal(observed.observation, 'incomplete')
  assert.equal(observed.loaded, false)
})

// protects=an other-copy line without a string path is ignored; fails_when=a forged line reports another copy loaded; no_claim=none
test('ignores an other-copy line whose path is not a string', async () => {
  // Arrange
  const lines = [
    '{"event":"start","pid":1}',
    '{"event":"other-copy","path":7,"pid":1}',
    '{"event":"closing","code":0,"pid":1}',
  ]
  // Act
  const observed = await readLines(lines)
  // Assert
  assert.equal(observed.otherCopyLoaded, false)
  assert.equal(observed.observation, 'complete')
})

// protects=a multi-megabyte other-copy path is cut to 512 characters; fails_when=the run resource carries the whole path; no_claim=none
test('cuts a very long other-copy path to 512 characters', async () => {
  // Arrange
  const lines = [
    '{"event":"start","pid":1}',
    `{"event":"other-copy","path":"/${'x'.repeat(5000)}","pid":1}`,
    '{"event":"closing","code":0,"pid":1}',
  ]
  // Act
  const observed = await readLines(lines)
  // Assert
  assert.equal(observed.otherCopyPath?.length, 512)
})
