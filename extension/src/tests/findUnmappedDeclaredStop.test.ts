import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findUnmappedDeclaredStop } from '../utils/findUnmappedDeclaredStop'

/** Builds a prepared stop with the one scan of its sealed map, which starts at its declared line: the mapped lines it found and whether it covered the whole map. @example scannedStop(3, [4]).scan.positions // [{ line: 4, column: 1 }] */
function scannedStop(line: number, mappedLines: number[], complete = true) {
  return {
    source: { line },
    scan: {
      positions: mappedLines.map((mappedLine) => ({
        line: mappedLine,
        column: 1,
      })),
      complete,
    },
  }
}

// Cycle 0045 (SS-12, SP-7): red while the refusal scanned the sealed map again for what the scan that chose the stop's place already held.
test('a stop with no place to bind is refused from the scan that chose its place, without another read of the map', () => {
  // Arrange: the stop is declared on line 3; its scan of lines 3 to 4 found nothing. Its verifier counts every further read of the map.
  let furtherMapReads = 0
  const blankLineStop = {
    ...scannedStop(3, []),
    verifier: {
      hashes: { sourceMap: 'a'.repeat(64) },
      mappedPositions() {
        furtherMapReads++
        return { positions: [], complete: true }
      },
    },
  }

  // Act
  const unmapped = findUnmappedDeclaredStop([blankLineStop], () => false)

  // Assert
  assert.equal(unmapped, blankLineStop)
  assert.equal(furtherMapReads, 0)
})

// Value: protects=the refusal of a stop whose line holds no code before any application effect; fails_when=the refusal names a later unmapped stop first, or a stop whose line is mapped; why_new=Cycle 0036 C08e; Cycle 0045 (X7-E2.5): the input held one unmapped stop, the last, so "the first" was not checked; seam=none
test('the first declared stop on a line without a mapped position is found when a later stop is unmapped too', () => {
  // Arrange: stops 2 and 4 are declared on lines their scans found no position on.
  const mappedStop = scannedStop(4, [4]),
    firstBlankStop = scannedStop(3, []),
    otherMappedStop = scannedStop(7, [7, 8]),
    secondBlankStop = scannedStop(6, [])

  // Act
  const unmapped = findUnmappedDeclaredStop(
    [mappedStop, firstBlankStop, otherMappedStop, secondBlankStop],
    () => false,
  )

  // Assert
  assert.equal(unmapped, firstBlankStop)
})

// Value: protects=a stop in a module whose map scan stopped at its size limit; fails_when=a partial scan is read as proof that the line is unmapped and the stop is refused without asking the caller's rule, or the rule is not told that the scan was partial; why_new=Cycle 0036 C08e keeps the partial-scan case; since the merge with 0041-N10-1b / R3 the run's rule decides it from the sealed source text; seam=none
test('a stop on a line that a map scan stopped at its size limit found no position for is left to the caller’s rule, which is told that the scan was partial', () => {
  // Arrange
  const partialStop = scannedStop(3, [], false)
  const asked: boolean[] = []

  // Act
  const unmapped = findUnmappedDeclaredStop(
    [partialStop],
    (_, scanComplete) => {
      asked.push(scanComplete)
      return true
    },
  )

  // Assert
  assert.equal(unmapped, undefined)
  assert.deepEqual(asked, [false])
})

// Value: protects=the one preparation rule for a declared line without a position (a blank line above its statement binds on the next line); fails_when=such a stop is refused without asking whether a later line of its citation can bind, or the rule is asked for a mapped line; why_new=Cycle 0044 merge of 0036-C08e with 0041-N10-1b / R3 (a line without a position is refused only when it can bind nowhere); seam=none
test('a stop on a line without a mapped position is not refused when the caller’s rule lets it bind elsewhere, and the rule is asked for that stop only', () => {
  // Arrange: line 4 is mapped; the stop on the blank line 3 has its statement on line 4.
  const mappedStop = scannedStop(4, [4]),
    blankLineStop = scannedStop(3, [4])
  const asked: { line: number; scanComplete: boolean }[] = []

  // Act
  const unmapped = findUnmappedDeclaredStop(
    [mappedStop, blankLineStop],
    (stop, scanComplete) => {
      asked.push({ line: stop.source.line, scanComplete })
      return true
    },
  )

  // Assert
  assert.equal(unmapped, undefined)
  assert.deepEqual(asked, [{ line: 3, scanComplete: true }])
})
