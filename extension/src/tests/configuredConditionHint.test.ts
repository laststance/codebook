import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RepositoryCondition } from '../repositoryConfigSchemas'
import { configuredConditionHint } from '../utils/configuredConditionHint'

// Value: protects=an agent whose text condition timed out reading the comparison rule it cannot see from the page; fails_when=the rule sentence drifts or is dropped for a plain mismatch; why_new=a text mismatch had no hint; seam=none
test('a timed-out text condition tells the agent that the whole text is compared with whitespace collapsed', () => {
  // Arrange
  const condition: RepositoryCondition = {
    kind: 'text',
    selector: 'button',
    equals: 'Log in',
  }
  // Act
  const hint = configuredConditionHint('before', condition, {
    reason: 'text-mismatch',
  })
  // Assert
  assert.equal(
    hint,
    " A text condition compares the element's whole text, child elements included, with whitespace collapsed.",
  )
})

// Value: protects=a before condition being steered to visibility and an after condition keeping its text check, so the result proof is not weakened; fails_when=both phases get the same advice, or the after hint suggests a visible condition; why_new=the phase-aware hints are new; seam=none
test('a text condition whose element holds more text gets a fix that fits a before condition and another that fits an after condition', () => {
  // Arrange
  const condition: RepositoryCondition = {
    kind: 'text',
    selector: 'button',
    equals: 'Log in',
  }
  // Act
  const beforeHint = configuredConditionHint('before', condition, {
    reason: 'text-mismatch',
    textDifference: 'surrounding-text',
  })
  const afterHint = configuredConditionHint('after', condition, {
    reason: 'text-mismatch',
    textDifference: 'surrounding-text',
  })
  // Assert
  assert.equal(
    beforeHint,
    " A text condition compares the element's whole text, child elements included, with whitespace collapsed. Here the element holds the expected text beside other text; use a visible condition, or a selector whose element holds only that text.",
  )
  assert.equal(
    afterHint,
    " A text condition compares the element's whole text, child elements included, with whitespace collapsed. Here the element holds the expected text beside other text; keep the text check and choose a selector whose element holds only that text.",
  )
})

// Value: protects=the two attribute hints agents already read staying byte for byte after they moved out of the run; fails_when=either sentence changes or the before-input sentence is given for another attribute or phase; why_new=the sentences had no test; seam=none
test('an attribute mismatch keeps its before-input sentence for a before value and its entire-value sentence otherwise', () => {
  // Arrange
  const valueCondition: RepositoryCondition = {
    kind: 'attribute',
    selector: 'input',
    attribute: 'value',
    equals: 'user@example.com',
  }
  const classCondition: RepositoryCondition = {
    kind: 'attribute',
    selector: 'button',
    attribute: 'class',
    equals: 'primary',
  }
  const failure = { reason: 'attribute-mismatch' }
  // Act
  const valueBeforeInput = configuredConditionHint(
    'before',
    valueCondition,
    failure,
  )
  const valueAfterInput = configuredConditionHint(
    'after',
    valueCondition,
    failure,
  )
  const classBeforeInput = configuredConditionHint(
    'before',
    classCondition,
    failure,
  )
  // Assert
  assert.equal(
    valueBeforeInput,
    ' Before conditions are checked before initialInputs are inserted; choose a condition observable on the fresh page.',
  )
  assert.equal(
    valueAfterInput,
    ' An attribute condition compares the entire value; use a CSS class selector to test class membership.',
  )
  assert.equal(
    classBeforeInput,
    ' An attribute condition compares the entire value; use a CSS class selector to test class membership.',
  )
})

// Value: protects=failures whose reason already names the cause staying without an invented hint; fails_when=a hint is appended to a visibility or click-target failure, or to an attribute mismatch reported for the click target; why_new=the hint utility is new; seam=none
test('a failure whose reason already names the cause gets no hint', () => {
  // Arrange
  const visibleCondition: RepositoryCondition = {
    kind: 'visible',
    selector: 'h1',
  }
  // Act
  const notVisible = configuredConditionHint('before', visibleCondition, {
    reason: 'not-visible',
  })
  const clickTargetObscured = configuredConditionHint('before', undefined, {
    reason: 'click-target-obscured',
  })
  const attributeWithoutCondition = configuredConditionHint(
    'before',
    undefined,
    { reason: 'attribute-mismatch' },
  )
  // Assert
  assert.equal(notVisible, '')
  assert.equal(clickTargetObscured, '')
  assert.equal(attributeWithoutCondition, '')
})
