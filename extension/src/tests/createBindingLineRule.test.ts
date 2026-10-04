import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createBindingLineRule } from '../utils/createBindingLineRule'

/** A stop's one scan of its sealed map, from its declared line to the end of its citation: the mapped lines it found, and whether it covered the whole map or stopped at its size limit. @example scanOf([22, 25]) // { complete: true, positions: [{ line: 22, column: 1 }, { line: 25, column: 1 }] } */
const scanOf = (mappedLines: number[], complete = true) => ({
  complete,
  positions: mappedLines.map((line) => ({ line, column: 1 })),
})

/** The citation of every case: lines 17 to 30 of the article's file. */
const citation = { endLine: 30 }

// Value: protects=a stop the debugger verified on its declared line staying accepted, as before this rule existed; fails_when=the rule refuses the declared line when the map scan was partial; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on the declared line is accepted, also when the map could not be scanned completely', () => {
  // Arrange
  const rule = createBindingLineRule(22, citation, scanOf([], false), 22)
  // Act
  const accepted = rule.accepts(22)
  // Assert
  assert.equal(accepted, true)
})

// Value: protects=a live run going on when the debugger moves a stop from a line it cannot pause on to the next line (`return (` onto the `<form>` line); fails_when=the next line is refused, or is refused only because the map scan was partial although no line lies between; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on the next line is accepted, also when the map could not be scanned completely', () => {
  // Arrange
  const completeRule = createBindingLineRule(
      22,
      citation,
      scanOf([22, 23]),
      22,
    ),
    partialRule = createBindingLineRule(22, citation, scanOf([], false), 22)
  // Act
  const answers = [completeRule.accepts(23), partialRule.accepts(23)]
  // Assert
  assert.deepEqual(answers, [true, true])
})

// Value: protects=a stop above a comment or a blank line being accepted where the debugger put it; fails_when=only the very next line is accepted; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on a later line is accepted when the lines between hold no mapped position', () => {
  // Arrange: lines 34 and 35 hold a comment and nothing the map knows of.
  const rule = createBindingLineRule(33, { endLine: 41 }, scanOf([33, 36]), 33)
  // Act
  const accepted = rule.accepts(36)
  // Assert
  assert.equal(accepted, true)
})

// Value: protects=a run never reporting a pause before the declared line as that stop, and the agent learning which condition refused it; fails_when=an earlier line is accepted, or its refusal does not say it is earlier; why_new=Cycle 0044 R7/O4 (the refusal named no condition); seam=none
test('a binding on an earlier line is refused as before the declared line', () => {
  // Arrange
  const rule = createBindingLineRule(22, citation, scanOf([22]), 22)
  // Act
  const answers = [rule.accepts(21), rule.refusal(21)]
  // Assert
  assert.deepEqual(answers, [false, 'line 21 is before the declared line 22'])
})

// Value: protects=a run never reporting a stop past code that could run between the declared line and the pause; fails_when=a later line is accepted across a mapped line, or the refusal does not name that line; why_new=Cycle 0044 R7/O4; seam=none
test('a binding on a later line is refused naming the mapped line between', () => {
  // Arrange: line 23 holds code.
  const rule = createBindingLineRule(22, citation, scanOf([22, 23, 24]), 22)
  // Act
  const answers = [rule.accepts(24), rule.refusal(24)]
  // Assert
  assert.deepEqual(answers, [
    false,
    'line 23 between the declared line 22 and line 24 has a mapped position',
  ])
})

// Value: protects=an explanation never being about a line its article does not show; fails_when=a later line after the citation's last line is accepted, or its refusal does not name the citation's end; why_new=Cycle 0044 R7/O4; seam=none
test('a binding on a line after the stop’s citation is refused naming the citation’s last line, and its last line is still inside', () => {
  // Arrange
  const lastLineRule = createBindingLineRule(29, citation, scanOf([30]), 29),
    afterRule = createBindingLineRule(30, citation, scanOf([30]), 30)
  // Act
  const answers = [
    lastLineRule.accepts(30),
    afterRule.accepts(31),
    afterRule.refusal(31),
  ]
  // Assert
  assert.deepEqual(answers, [
    true,
    false,
    'line 31 is after the last line 30 of the citation',
  ])
})

// Value: protects=a map too large to scan never being read as "no code between"; fails_when=an incomplete scan that found nothing between accepts the later line, or its refusal hides that the scan was incomplete; why_new=Cycle 0044 R7/O4; seam=none
test('a binding on a later line is refused when the scan of the lines between stopped at its size limit', () => {
  // Arrange: the scan found nothing between and did not reach the end of the map.
  const rule = createBindingLineRule(22, citation, scanOf([], false), 22)
  // Act
  const answers = [rule.accepts(24), rule.refusal(24)]
  // Assert
  assert.deepEqual(answers, [
    false,
    'the sealed map was too large to scan completely, so lines 23 to 23 between the declared line 22 and line 24 may hold code; declare the stop on line 24, where the debugger bound it',
  ])
})

// Cycle 0045 (SM-21): red while the refusal counted its lines from the requested line and called that line "the declared line" ("lines 75 to 75 between the declared line and line 76").
test('a stop requested after its declared line whose later binding a partial scan cannot prove is refused naming the requested line its lines are counted from', () => {
  // Arrange: the stop is declared on line 73 and requested on line 74; the scan found line 74 and stopped at its size limit.
  const rule = createBindingLineRule(
    73,
    { endLine: 95 },
    scanOf([74], false),
    74,
  )
  // Act
  const refusal = rule.refusal(76)
  // Assert
  assert.equal(
    refusal,
    'the sealed map was too large to scan completely, so lines 75 to 75 between line 74, where the stop declared on line 73 was requested, and line 76 may hold code; declare the stop on line 76, where the debugger bound it',
  )
})

// Value: protects=a line that is not a whole number (an unvalidated stack frame of a refresh) never being taken as the stop's place; fails_when=22.5, NaN or Infinity pass because the scan between them is empty; why_new=Cycle 0044 R2; seam=none
test('a line that is not a whole number is never the stop’s binding', () => {
  // Arrange
  const rule = createBindingLineRule(22, { endLine: 95 }, scanOf([22, 40]), 22)
  // Act
  const answers = [22.5, Number.NaN, Number.POSITIVE_INFINITY].map((line) =>
    rule.accepts(line),
  )
  // Assert
  assert.deepEqual(answers, [false, false, false])
})

// Cycle 0045 (SS-15): red while the fourth parameter defaulted to the declared line, so a call that forgot it measured the rule from the declared line again (the directive below was then unused and the build failed; the function declared three parameters).
test('a binding rule cannot be built without the line its breakpoint is requested on', () => {
  // Arrange
  const scan = scanOf([22, 23])
  // Act: the compiler refuses a call without the requested line.
  // @ts-expect-error the requested line is required
  createBindingLineRule(22, citation, scan)
  // Assert
  assert.equal(createBindingLineRule.length, 4)
})

// Cycle 0044 (0041-N10-1b): red while the rule of a stop on a line without a mapped position was measured from its declared line, so the debugger's move from the requested line to the next one was refused (natively: "bound at 75:13, refused: line 74 between the declared line 73 and line 75 has a mapped position").
test('a stop requested on the first mapped line after its unmapped declared line accepts a binding on the line after the requested one', () => {
  // Arrange: line 23 is declared and unmapped, line 24 is the first mapped line (where the breakpoint is requested), line 25 is mapped too.
  const rule = createBindingLineRule(23, citation, scanOf([24, 25, 26]), 24)
  // Act
  const acceptedLines = [23, 24, 25].map((line) => rule.accepts(line))
  const refusal = rule.refusal(26)
  // Assert
  assert.deepEqual(acceptedLines, [true, true, true])
  assert.equal(
    refusal,
    'line 25 between line 24, where the stop declared on line 23 was requested, and line 26 has a mapped position',
  )
})
