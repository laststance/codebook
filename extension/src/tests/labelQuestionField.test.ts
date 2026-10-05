import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  labelQuestionField,
  type QuestionField,
} from '../utils/labelQuestionField'

/** A question field as the script of the question form finds it: so many label elements name it, and it carries the attributes given. */
function questionField(
  labelCount: number,
  attributes: Record<string, string>,
): QuestionField & { attributes: Record<string, string> } {
  return {
    labels: { length: labelCount },
    attributes: { ...attributes },
    getAttribute(name) {
      return this.attributes[name] ?? null
    },
    setAttribute(name, value): void {
      this.attributes[name] = value
    },
  }
}

// Value: protects=the accessible name of the question field of a served Wiki page whose own page gives the field a name; fails_when=the reader writes its label over an `aria-label` the page gave the field, or beside an `aria-labelledby` or a label element, so a screen reader announces the reader's words instead of the page's; why_new=Cycle 0046 row 136 (the label was set whenever no label element named the field); seam=none
test('a question field that has a name of its own keeps it: its own aria-label, an aria-labelledby or a label element', () => {
  // Arrange: three fields, each named in one way.
  const withItsOwnLabel = questionField(0, { 'aria-label': 'Ask this Wiki' })
  const namedByAnotherElement = questionField(0, {
    'aria-labelledby': 'composer-heading',
  })
  const namedByALabelElement = questionField(1, {})

  // Act
  for (const field of [
    withItsOwnLabel,
    namedByAnotherElement,
    namedByALabelElement,
  ])
    labelQuestionField(field)

  // Assert
  assert.deepEqual(
    [
      withItsOwnLabel.attributes,
      namedByAnotherElement.attributes,
      namedByALabelElement.attributes,
    ],
    [
      { 'aria-label': 'Ask this Wiki' },
      { 'aria-labelledby': 'composer-heading' },
      {},
    ],
  )
})

// Value: protects=the accessible name of the question field on a page whose label names a heading of the article instead (a page published with the field's id also in its content); fails_when=a field that nothing names, or that carries an empty `aria-label`, is left without the shell's words; why_new=Cycle 0046 rows 84 and 136; seam=none
test('a question field that nothing names gets the words of the shell’s label, also when its aria-label is empty', () => {
  // Arrange
  const unnamed = questionField(0, {})
  const withAnEmptyLabel = questionField(0, { 'aria-label': ' ' })

  // Act
  labelQuestionField(unnamed)
  labelQuestionField(withAnEmptyLabel)

  // Assert
  assert.deepEqual(
    [unnamed.attributes, withAnEmptyLabel.attributes],
    [
      { 'aria-label': 'Ask about this repository' },
      { 'aria-label': 'Ask about this repository' },
    ],
  )
})
