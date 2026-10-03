import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  configuredDomFailureSchema,
  type RepositoryCondition,
} from '../repositoryConfigSchemas'
import { configuredConditionHint } from '../utils/configuredConditionHint'

// Value: protects=an agent whose text condition timed out reading the comparison rule it cannot see from the page; fails_when=the rule sentence drifts or is dropped for a plain mismatch; why_new=a text mismatch had no hint; seam=none
// Cycle 0044 (0041-F6): red while the rule omitted "trimmed" and that child texts join without a space.
test('a timed-out text condition tells the agent that textContent is compared trimmed with whitespace collapsed and child texts joined without a space', () => {
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
    " A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied.",
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
    " A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied. Here the element holds the expected text beside other text; use a visible condition, or a selector whose element holds only that text.",
  )
  assert.equal(
    afterHint,
    " A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; the texts of child elements are joined without a space (<b>Total</b><i>5</i> reads Total5), and CSS white-space, zero-width spaces and soft hyphens are not applied. Here the element holds the expected text beside other text; keep the text check and choose a selector whose element holds only that text.",
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
  const failure = { reason: 'attribute-mismatch' } as const
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

// Cycle 0044 (0041-F8 / 0041-OCR1): red while the hint accepted any reason string, so a reason the page never sends compiled and silently got no hint.
test('a timed-out failure reason the page never reports does not compile into a hint request', () => {
  // Arrange
  const condition: RepositoryCondition = { kind: 'visible', selector: 'h1' }
  // Act
  const hint = configuredConditionHint('before', condition, {
    // @ts-expect-error A reason outside the page's failure schema is a type error, so a renamed reason cannot drift from its hint.
    reason: 'text-differs',
  })
  // Assert
  assert.equal(hint, '')
})

// Cycle 0044 (0041-F8 / 0041-OCR1): red while the schema accepted a text relation on any reason.
test('a page failure that carries a text relation on another reason than a text mismatch is refused', () => {
  // Arrange
  const relationOnAttribute = {
    conditionIndex: 0,
    reason: 'attribute-mismatch',
    textDifference: 'surrounding-text',
  }
  const relationOnText = {
    conditionIndex: 0,
    reason: 'text-mismatch',
    textDifference: 'surrounding-text',
  }
  // Act
  const attributeResult =
    configuredDomFailureSchema.safeParse(relationOnAttribute)
  const textResult = configuredDomFailureSchema.safeParse(relationOnText)
  // Assert
  assert.equal(attributeResult.success, false)
  assert.deepEqual(textResult.data, relationOnText)
})

// Cycle 0044 (0042-N11-2): red while a missing click target got no hint.
test('a click target that matched nothing tells the agent so, with the page’s control counts when the page reported them', () => {
  // Arrange
  const withCounts = {
    reason: 'click-target-missing',
    candidates: { button: 0, link: 1, field: 2 },
  } as const
  const withoutCounts = { reason: 'click-target-missing' } as const
  // Act
  const counted = configuredConditionHint('before', undefined, withCounts)
  const uncounted = configuredConditionHint('before', undefined, withoutCounts)
  // Assert
  assert.equal(
    counted,
    " The action selector matched no element on the page. The page holds 0 button, 1 link and 2 form field elements. Read the component's source for the control's tag, id, name or attributes and declare a browser-native CSS selector that matches exactly one element; check entryPath when the page holds no such control.",
  )
  assert.equal(
    uncounted,
    " The action selector matched no element on the page. Read the component's source for the control's tag, id, name or attributes and declare a browser-native CSS selector that matches exactly one element; check entryPath when the page holds no such control.",
  )
})
