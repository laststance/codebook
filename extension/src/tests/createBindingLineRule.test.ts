import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createBindingLineRule } from '../utils/createBindingLineRule'

/** A sealed map whose mapped lines are given, with a scan that covered the whole map or stopped at its size limit. @example mapWith([22, 25])(23, 24) // { complete: true, positions: [] } */
const mapWith =
  (mappedLines: number[], complete = true) =>
  (startLine: number, endLine: number) => ({
    complete,
    positions: mappedLines
      .filter((line) => line >= startLine && line <= endLine)
      .map((line) => ({ line, column: 1 })),
  })

/** The citation of every case: lines 17 to 30 of the article's file. */
const citation = { endLine: 30 }

// Value: protects=a stop the debugger verified on its declared line staying accepted, as before this rule existed; fails_when=the rule refuses the declared line when the map scan was partial; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on the declared line is accepted, also when the map could not be scanned completely', () => {
  // Arrange
  const rule = createBindingLineRule(22, citation, mapWith([], false))
  // Act
  const accepted = rule.accepts(22)
  // Assert
  assert.equal(accepted, true)
})

// Value: protects=a live run going on when the debugger moves a stop from a line it cannot pause on to the next line (`return (` onto the `<form>` line); fails_when=the next line is refused, or is refused only because the map scan was partial although no line lies between; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on the next line is accepted, also when the map could not be scanned completely', () => {
  // Arrange
  const completeRule = createBindingLineRule(22, citation, mapWith([22, 23])),
    partialRule = createBindingLineRule(22, citation, mapWith([], false))
  // Act
  const answers = [completeRule.accepts(23), partialRule.accepts(23)]
  // Assert
  assert.deepEqual(answers, [true, true])
})

// Value: protects=a stop above a comment or a blank line being accepted where the debugger put it; fails_when=only the very next line is accepted; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on a later line is accepted when the lines between hold no mapped position', () => {
  // Arrange: lines 34 and 35 hold a comment and nothing the map knows of.
  const rule = createBindingLineRule(33, { endLine: 41 }, mapWith([33, 36]))
  // Act
  const accepted = rule.accepts(36)
  // Assert
  assert.equal(accepted, true)
})

// Value: protects=a run never reporting a pause before the declared line as that stop, and the agent learning which condition refused it; fails_when=an earlier line is accepted, or its refusal does not say it is earlier; why_new=Cycle 0044 R7/O4 (the refusal named no condition); seam=none
test('a binding on an earlier line is refused as before the declared line', () => {
  // Arrange
  const rule = createBindingLineRule(22, citation, mapWith([21, 22]))
  // Act
  const answers = [rule.accepts(21), rule.refusal(21)]
  // Assert
  assert.deepEqual(answers, [false, 'line 21 is before the declared line 22'])
})

// Value: protects=a run never reporting a stop past code that could run between the declared line and the pause; fails_when=a later line is accepted across a mapped line, or the refusal does not name that line; why_new=Cycle 0044 R7/O4; seam=none
test('a binding on a later line is refused naming the mapped line between', () => {
  // Arrange: line 23 holds code.
  const rule = createBindingLineRule(22, citation, mapWith([22, 23, 24]))
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
  const lastLineRule = createBindingLineRule(29, citation, mapWith([30, 31])),
    afterRule = createBindingLineRule(30, citation, mapWith([30, 31]))
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
  const rule = createBindingLineRule(22, citation, mapWith([], false))
  // Act
  const answers = [rule.accepts(24), rule.refusal(24)]
  // Assert
  assert.deepEqual(answers, [
    false,
    'the sealed map was too large to scan completely, so lines 23 to 23 between the declared line and line 24 may hold code',
  ])
})

// Value: protects=a line that is not a whole number (an unvalidated stack frame of a refresh) never being taken as the stop's place; fails_when=22.5, NaN or Infinity pass because the scan between them is empty; why_new=Cycle 0044 R2; seam=none
test('a line that is not a whole number is never the stop’s binding', () => {
  // Arrange
  const rule = createBindingLineRule(22, { endLine: 95 }, mapWith([22, 40]))
  // Act
  const answers = [22.5, Number.NaN, Number.POSITIVE_INFINITY].map((line) =>
    rule.accepts(line),
  )
  // Assert
  assert.deepEqual(answers, [false, false, false])
})

// Value: protects=the pause handler and every binding check staying cheap on a large sealed map (up to 4 MB decoded per question before); fails_when=the rule decodes the map again for a question; why_new=Cycle 0044 R10/O8; seam=the map reader, counted
test('the sealed map is scanned once per stop however many lines the rule is asked about', () => {
  // Arrange
  let scans = 0
  const countingMap = (startLine: number, endLine: number) => {
    scans += 1
    return mapWith([22, 26])(startLine, endLine)
  }
  const rule = createBindingLineRule(22, citation, countingMap)
  // Act
  const answers = [23, 24, 26, 27, 25].map((line) => rule.accepts(line))
  // Assert
  assert.deepEqual(answers, [true, true, true, false, true])
  assert.equal(scans, 1)
})
