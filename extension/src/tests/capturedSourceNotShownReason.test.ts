import assert from 'node:assert/strict'
import { test } from 'node:test'

import { capturedSourceNotShownReason } from '../utils/capturedSourceNotShownReason'

// Value: protects=the one case in which the reason of a Study whose captured source is not in front still asks the learner to wait: the reader's own placement of the source is under way, and the sentence stays the one agents and the learner already read for it; fails_when=the reader's own display is described as a closed or covered tab, or the waiting sentence changes for it; why_new=Cycle 0046 row 695 (its bound: "Wait for it" only for the reader's own pending placement); seam=none
test('while the reader itself places the captured source, the reason asks the learner to wait for it wherever it is read', () => {
  // Act
  const reasons = [
    capturedSourceNotShownReason('placing', 'study'),
    capturedSourceNotShownReason('placing', 'recording'),
  ]

  // Assert
  assert.deepEqual(reasons, [
    'The current captured source is not ready in its native pane. Wait for it, or use Return to current with the latest reader revision before restoring the layout.',
    'The current captured source is not ready in its native pane. Wait for it, or use Return to current with the latest reader revision before restoring the layout.',
  ])
})

// Value: protects=what holds and the control that shows the captured source again where the learner reads the reason: a covered tab, a closed tab or a source that is not the selection's current display, in the Learning summary of a recording (Reload saved recording, in Playback details), on the strip of a Live run (Return to current pause) and in the Study pane (Focus source), each of which confirmed the layout again in the workspace harness; fails_when=a reason names a control that the place where it is read does not show, or claims a closed tab for one that is only covered; why_new=Cycle 0046 row 695; seam=none
test('a covered, closed or not current captured source is named as it is, with the control that shows it again where the reason is read', () => {
  // Act
  const reasons = {
    coveredInStudy: capturedSourceNotShownReason('covered', 'study'),
    closedInRecording: capturedSourceNotShownReason('closed', 'recording'),
    closedInLive: capturedSourceNotShownReason('closed', 'live'),
    notShownInStudy: capturedSourceNotShownReason('not-shown', 'study'),
  }

  // Assert
  assert.deepEqual(reasons, {
    coveredInStudy:
      'The tab of the captured source is behind another tab. Use Focus source to show it again.',
    closedInRecording:
      'The tab of the captured source was closed. Use Reload saved recording in Playback details to show it again.',
    closedInLive:
      'The tab of the captured source was closed. Use Return to current pause to show it again.',
    notShownInStudy:
      'The current captured source is not ready in its native pane. Use Focus source to show it again.',
  })
})
