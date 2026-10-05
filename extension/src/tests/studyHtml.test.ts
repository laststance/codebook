import assert from 'node:assert/strict'
import { test } from 'node:test'

import { studyHtml } from '../ui/studyHtml'

// Value: protects=the learner reading the one-click control before the manual step, and the first scope still being named for Cursor, where expanding a collapsed Variables lists scopes without loading values; fails_when=the hint describes the manual steps first again, or stops naming Show Variables, the first scope or the recorded session; why_new=Cycle 0045 CX-D5 (it replaces the 0033 C1 test of the earlier sentence, which described only the manual steps); seam=none
test('the Run and Debug hint names Show Variables before the manual steps', () => {
  // Arrange
  const expectedHint =
    'Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.'

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

// Value: protects=the Study pane saying beside an explanation it shows ahead of its saved time when that explanation was saved; fails_when=the pane's document no longer carries one of the three sentences; why_new=Cycle 0045 cause 10 (rule 3; that a sentence is written under such an explanation is the Reader DOM check's case "an explanation shown before its saved time is followed by the note that says when it was saved, and Later annotations holds only the other explanations"); seam=none
test('the Study pane carries the three sentences that say when an explanation shown before its saved time was saved', () => {
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
    readerHtml.includes('This explanation was saved after this pause ended.'),
    true,
  )
  assert.equal(
    readerHtml.includes(
      'This explanation was saved after the recording ended.',
    ),
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
