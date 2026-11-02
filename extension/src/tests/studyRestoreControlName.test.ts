import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PLACEMENT_REFUSED_RECOVERY } from '../constants'
import { studyHtml } from '../ui/studyHtml'

// Value: protects=the recovery an agent tells the learner after a refused Study placement names a control that exists; fails_when=the sentence names "Restore Study arrangement" (N71: the learner found no such control; the Study pane's button reads "Restore Study workspace layout") or the pane's button text drifts from the sentence; no_claim=that the control recovers every layout (a window with many leftover groups was not reproduced)
test('the placement refusal names the Study pane button by the text the pane shows', () => {
  // Arrange: the sentence an agent relays and the Study pane's markup.
  const recovery = PLACEMENT_REFUSED_RECOVERY
  const paneMarkup = studyHtml('context')

  // Act: nothing beyond reading both texts.

  // Assert
  assert.match(
    recovery,
    /choose Restore Study workspace layout in the Study pane/,
  )
  assert.doesNotMatch(recovery, /Restore Study arrangement/)
  assert.match(
    paneMarkup,
    /<button data-action="arrange">Restore Study workspace layout<\/button>/,
  )
})
