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

// Value: protects=the Study pane saying beside an explanation it shows ahead of its saved time when that explanation was saved; fails_when=the pane's document no longer carries the three sentences, or no longer writes one under such an explanation; why_new=Cycle 0045 cause 10 (rule 3; the reader's DOM cases belong to the Reader DOM check); seam=none
test('the Study pane carries the three sentences that say when an explanation shown before its saved time was saved, and writes one under such an explanation', () => {
  // Act
  const readerHtml = studyHtml('context')

  // Assert
  assert.equal(
    readerHtml.includes(
      'This explanation was saved while this pause was held.',
    ),
    true,
  )
  assert.equal(
    readerHtml.includes('This explanation was saved after the run continued.'),
    true,
  )
  assert.equal(
    readerHtml.includes(
      'This explanation was saved after the recording ended.',
    ),
    true,
  )
  assert.equal(
    readerHtml.includes('note.textContent = savedNote(value.savedLater)'),
    true,
  )
})

// Value: protects=a recorded stop the agent never explained still saying so, and the later explanations keeping their own section; fails_when=the sentence for a stop without an explanation or the Later annotations section leaves the pane; why_new=Cycle 0045 cause 10 (rules 4 and 6, a guard: green before the change, its control is the mutation that removes either text); seam=none
test('the Study pane still says that no explanation was available at a recorded time and keeps the Later annotations section', () => {
  // Act
  const readerHtml = studyHtml('context')

  // Assert
  assert.equal(
    readerHtml.includes('No explanation was available by this recorded time.'),
    true,
  )
  assert.equal(
    readerHtml.includes(
      '<details id="later-annotations" hidden><summary>Later annotations — not available at this recorded time</summary><p class="muted">These explanations were added later. They do not change what was observed in the recording.</p><div id="later-interpretations"></div></details>',
    ),
    true,
  )
})
