import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findUnmappedDeclaredStop } from '../utils/findUnmappedDeclaredStop'

/** Builds a prepared stop of a module whose sealed map has positions on the given lines, counting every scan of that map. @example sealedModule('a'.repeat(64), [1, 4]).verifier */
function sealedModule(sourceMapHash: string, mappedLines: number[]) {
  const scans: { startLine: number; endLine: number }[] = []
  return {
    scans,
    verifier: {
      hashes: { sourceMap: sourceMapHash },
      mappedPositions(startLine: number, endLine: number) {
        scans.push({ startLine, endLine })
        return {
          positions: mappedLines
            .filter((line) => line >= startLine && line <= endLine)
            .map((line) => ({ line, column: 1 })),
          complete: true,
        }
      },
    },
  }
}

// Value: protects=preparation cost for several stops in one module; fails_when=the sealed map is scanned once per declared stop instead of once per module; why_new=Cycle 0036 C08e; seam=the map reader counts its scans
test('three declared stops in one sealed module scan its map once over the lines they declare', () => {
  // Arrange
  const themeModule = sealedModule('a'.repeat(64), [2, 5, 9])
  const stops = [9, 2, 5].map((line) => ({
    source: { path: 'src/theme.ts', line },
    verifier: themeModule.verifier,
  }))

  // Act
  const unmapped = findUnmappedDeclaredStop(stops, () => false)

  // Assert
  assert.equal(unmapped, undefined)
  assert.deepEqual(themeModule.scans, [{ startLine: 2, endLine: 9 }])
})

// Value: protects=the refusal of a stop whose line holds no code before any application effect; fails_when=the shared scan loses which stop is unmapped, or names a later stop first; why_new=Cycle 0036 C08e moved the per-stop check into one scan per module; seam=none
test('the first declared stop on a line without a mapped position is found, also when another module is fully mapped', () => {
  // Arrange
  const themeModule = sealedModule('a'.repeat(64), [1, 4]),
    modeModule = sealedModule('b'.repeat(64), [7])
  const mappedThemeStop = {
      source: { path: 'src/theme.ts', line: 4 },
      verifier: themeModule.verifier,
    },
    modeStop = {
      source: { path: 'src/mode.ts', line: 7 },
      verifier: modeModule.verifier,
    },
    blankThemeStop = {
      source: { path: 'src/theme.ts', line: 3 },
      verifier: themeModule.verifier,
    }

  // Act
  const unmapped = findUnmappedDeclaredStop(
    [mappedThemeStop, modeStop, blankThemeStop],
    () => false,
  )

  // Assert
  assert.equal(unmapped, blankThemeStop)
  assert.deepEqual(themeModule.scans, [{ startLine: 3, endLine: 4 }])
  assert.deepEqual(modeModule.scans, [{ startLine: 7, endLine: 7 }])
})

// Value: protects=a stop in a module whose map scan stopped at its size limit; fails_when=a partial scan is read as proof that the line is unmapped and the stop is refused without asking the caller's rule, or the rule is not told that the scan was partial; why_new=Cycle 0036 C08e keeps the partial-scan case in the shared scan; since the merge with 0041-N10-1b / R3 the run's rule decides it from the sealed source text; seam=none
test('a stop on a line that a map scan stopped at its size limit found no position for is left to the caller’s rule, which is told that the scan was partial', () => {
  // Arrange
  const partialStop = {
    source: { path: 'src/theme.ts', line: 3 },
    verifier: {
      hashes: { sourceMap: 'c'.repeat(64) },
      mappedPositions: () => ({ positions: [], complete: false }),
    },
  }
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

// Value: protects=the one preparation rule for a declared line without a position (a blank line above its statement binds on the next line); fails_when=the shared scan refuses such a stop without asking whether a later line of its citation can bind, or asks the rule for a mapped line; why_new=Cycle 0044 merge of 0036-C08e (one scan per module) with 0041-N10-1b / R3 (a line without a position is refused only when it can bind nowhere); seam=none
test('a stop on a line without a mapped position is not refused when the caller’s rule lets it bind elsewhere, and the rule is asked for that stop only', () => {
  // Arrange
  const themeModule = sealedModule('a'.repeat(64), [1, 4])
  const mappedStop = {
      source: { path: 'src/theme.ts', line: 4 },
      verifier: themeModule.verifier,
    },
    blankLineStop = {
      source: { path: 'src/theme.ts', line: 3 },
      verifier: themeModule.verifier,
    }
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
  assert.deepEqual(themeModule.scans, [{ startLine: 3, endLine: 4 }])
})
