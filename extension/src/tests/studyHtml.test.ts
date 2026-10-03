import assert from 'node:assert/strict'
import { test } from 'node:test'

import { studyHtml } from '../ui/studyHtml'

// Value: protects=the Run and Debug hint working in Cursor, where expanding a collapsed Variables lists scopes without loading values; fails_when=the reader's hint stops naming the first scope; why_new=Cycle 0033 C1 / AC5 (the hint text had only the DOM harness case); seam=none
test('the Run and Debug hint tells the learner to expand the first Variables scope when it stays closed', () => {
  // Arrange
  const expectedHint =
    'Recorded values for this moment load in Run and Debug: open it, expand Variables, then expand its first scope if it stays closed. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.'

  // Act
  const readerHtml = studyHtml('context')

  // Assert
  assert.equal(readerHtml.includes(expectedHint), true)
})

// Value: protects=the Study and Learning replay titles staying readable while their pane is squeezed during arrangement; fails_when=the title has no minimum inline size, so `overflow-wrap: anywhere` on the body wraps it one character per line in a very narrow pane; why_new=Cycle 0037 N6d (seen during a live run's arrangement); seam=none
for (const kind of ['context', 'moments'] as const)
  test(`the ${kind} pane keeps its title at least twelve characters wide instead of wrapping it one character per line`, () => {
    // Act
    const html = studyHtml(kind)

    // Assert
    assert.equal(
      html.includes(
        'h1{font-size:20px;line-height:1.25;margin:16px 0 8px;min-width:12ch}',
      ),
      true,
    )
    assert.equal(
      html.includes('body{margin:0;padding:16px;overflow-wrap:anywhere'),
      true,
    )
  })
