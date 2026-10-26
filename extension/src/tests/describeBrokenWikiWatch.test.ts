import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeBrokenWikiWatch } from '../utils/describeBrokenWikiWatch'

// Value: protects=a learner whose update is still worked on by the VS Code chat when Codebook's own watch breaks off with an error; fails_when=the end shows only the thrown text, which reads like the end of the update and names no step, or no longer says that the chat was not stopped and can still publish, or quotes a long thrown text whole; why_new=Cycle 0046 row 341 (the watch's catch recorded the thrown text alone, followed by "The last usable site is kept."); seam=none
test('a watch that broke off says that Codebook stopped watching and why, that the chat was not stopped and can still publish, and what the learner can do, and cuts a long cause at 120 characters', () => {
  // Act
  const sentence = describeBrokenWikiWatch('EIO: i/o error, close')
  const withLongCause = describeBrokenWikiWatch('x'.repeat(150))

  // Assert
  assert.equal(
    sentence,
    'Codebook stopped watching the update because of an error (EIO: i/o error, close). The VS Code chat was not stopped and can still publish: let it finish (the Wiki page says when it has), or stop it in the chat.',
  )
  assert.equal(
    withLongCause,
    `Codebook stopped watching the update because of an error (${'x'.repeat(120)}…). The VS Code chat was not stopped and can still publish: let it finish (the Wiki page says when it has), or stop it in the chat.`,
  )
})

// Value: protects=D5, a generation whose watch broke off; fails_when=its sentence calls the run an update or points to a Wiki page the project does not have yet; no_claim=the update's sentence (tests above); seam=none
test('a generation’s broken watch names the generation and Open LLM Wiki in Browser, not a Wiki page', () => {
  // Act
  const sentence = describeBrokenWikiWatch('EIO: i/o error', 'generate')

  // Assert
  assert.equal(
    sentence,
    'Codebook stopped watching the generation because of an error (EIO: i/o error). The VS Code chat was not stopped and can still publish: let it finish (Codebook: Open LLM Wiki in Browser opens the Wiki once it has), or stop it in the chat.',
  )
})
