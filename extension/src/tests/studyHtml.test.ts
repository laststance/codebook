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

// Value: protects=a screen reader hearing what brings a covered recorded moment back once, after the status that names the cover; fails_when=the pane's options lose the remedy clause, or the clause repeats the label the transport's status already says; why_new=Cycle 0046 row 26, DR-3 (the remedy stood only in a line that is no live region); seam=none
test('the Study pane carries the remedy for a covered recorded application as a clause of its own, which is the summary’s sentence without the label', () => {
  // Act
  const readerHtml = studyHtml('context')

  // Assert
  assert.equal(
    readerHtml.includes(
      '"applicationCovered":{"label":"Recorded application is covered by another tab","remedy":"Recorded application is covered by another tab. Bring the Recorded application tab to the front to show this moment again.","announcement":"Bring the Recorded application tab to the front to show this moment again."}',
    ),
    true,
  )
})

// Value: protects=the remedy being announced from a status region of the transport in both panes, hidden from sight in the summary (which shows the whole sentence above the moment) and visible in the bottom panel (which has no such line); fails_when=the region leaves the transport, loses its role, or the bottom panel hides it again; why_new=Cycle 0046 rows 26 and 60 (DR-3, ND-2); seam=none
test('the transport of the Learning summary holds the covered remedy as a visually hidden status region, and the bottom panel’s transport holds it as a visible one', () => {
  // Act
  const summaryHtml = studyHtml('context'),
    bottomPanelHtml = studyHtml('moments')

  // Assert
  assert.equal(
    summaryHtml.includes(
      '<span id="recording-status" role="status" aria-live="polite"></span><span id="application-covered-remedy" class="visually-hidden" role="status" aria-live="polite"></span>',
    ),
    true,
  )
  assert.equal(
    bottomPanelHtml.includes(
      '<span id="recording-status" role="status" aria-live="polite"></span><span id="application-covered-remedy" class="muted" role="status" aria-live="polite"></span>',
    ),
    true,
  )
})

// Value: protects=the learner in a window without a Trash reading sentences that name what can be done there; fails_when=the pane's options lose a Trash-less note or reason, or one of them speaks of deleting a study again; why_new=Cycle 0046 rows 27 and 59 (DR-4, ND-1: the notes and reasons were worded for a window with a Trash only); seam=none
test('the Study pane carries, for a window without a Trash, notes and reasons that speak of removing a study’s files by hand', () => {
  // Act
  const readerHtml = studyHtml('context')

  // Assert: the options the pane's script reads, as the page states them.
  assert.equal(
    readerHtml.includes(
      '"studyRemovalRefusalsWithoutTrash":{"nothingChosen":"This window has no Trash, so Codebook cannot delete a saved study here. Choose a saved study, then open Remove by hand to list its files.","nodeHistory":"Codebook cannot list the files of a Node test history for removal by hand yet.","runNotStopped":"Stop the run before removing its study\'s files by hand.","recordingOpen":"Choose Overview or Live to leave Recording before removing this study\'s files by hand.","studyOpening":"Wait for the chosen saved study to open.","unavailable":"Study archive is unavailable.","newerFormat":"This study was saved by a newer Codebook and is kept as it is. Update the extension to list its files for removal by hand."}',
    ),
    true,
  )
  assert.equal(
    readerHtml.includes(
      '"studyNotes":{"unopenable":{"withTrash":"This saved study cannot be opened. It can still be deleted.","withoutTrash":"This saved study cannot be opened. This window has no Trash, so it can only be removed by hand."},"repairable":{"withTrash":"This saved study\'s catalog checkpoint is missing or out of date. Repair it, or delete the study.","withoutTrash":"This saved study\'s catalog checkpoint is missing or out of date. Repair it, or remove its files by hand."}}',
    ),
    true,
  )
})

// Value: protects=the manual removal of a window without a Trash staying behind a disclosure the learner opens, with a status line for the list and one for the copy; fails_when=the files are shown without being asked for again, Copy paths loses its plural or its confirmation line, or Repair stops being the filled button; why_new=Cycle 0046 row 27 (DR-5, DR-6, DR-7); seam=none
test('Saved studies offers Repair saved study as the filled button and folds the manual removal into Remove by hand with Copy paths and two status lines', () => {
  // Act
  const readerHtml = studyHtml('context')

  // Assert
  assert.equal(
    readerHtml.includes(
      '<button id="repair-study" class="primary" type="button" data-action="retry" aria-describedby="study-repairable" hidden>Repair saved study</button><button id="delete-study" type="button" aria-describedby="delete-study-reason delete-study-status">Delete saved study…</button>',
    ),
    true,
  )
  assert.equal(
    readerHtml.includes(
      '<details id="study-files" hidden><summary>Remove by hand</summary><p id="study-files-note" role="status" aria-live="polite"></p><ul id="study-files-list" class="muted" aria-label="Files of the chosen saved study"></ul><div class="row"><button id="copy-study-files" type="button">Copy paths</button><button type="button" data-action="retry">Retry storage / refresh</button></div><p id="copy-study-files-status" role="status" aria-live="polite"></p></details>',
    ),
    true,
  )
})

// Value: protects=a status region of the Study pane existing before its first text, so a screen reader hears a run's first state, a recording's status and a layout notice as a change; fails_when=the live strip or the replay transport is hidden as a whole again, the strip's status starts with a text, or the presentation status goes back into the "Study view and pane controls" disclosure, which the Recording tab closes; why_new=Cycle 0046 row 74 (the regions entered the page together with their first text); seam=none
for (const kind of ['context', 'moments'] as const)
  test(`the ${kind} pane holds the live strip and the replay transport without hiding them, their status regions empty, and the presentation status after the pane controls’ disclosure, not inside it`, () => {
    // Act
    const html = studyHtml(kind)

    // Assert
    assert.equal(
      html.includes(
        '<div class="live-strip"><div id="runtime" role="status" aria-live="polite"></div><div class="row">',
      ),
      true,
    )
    assert.equal(html.includes('<section id="recording-transport">'), true)
    assert.equal(
      html.includes(
        '</div></details></header></details><p id="presentation-status" class="presentation-status" role="status" aria-live="polite"></p>',
      ),
      true,
    )
  })

// Value: protects=one place for the rules of the pane controls' header, so a change to them cannot be made in one copy and missed in the other; fails_when=the stylesheet carries the header's rule line twice again, as it did with two nearly equal lines; why_new=Cycle 0046 row 74 (the doubled stylesheet line); seam=none
test('the Study pane’s stylesheet states the rules of the pane controls’ header once', () => {
  // Arrange
  const headerRule =
    '.presentation-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px 12px;padding-bottom:12px;border-bottom:1px solid var(--vscode-panel-border,#444)}'

  // Act
  const occurrences = studyHtml('context').split(headerRule).length - 1

  // Assert
  assert.equal(occurrences, 1)
})
