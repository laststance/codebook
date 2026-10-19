import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cutChatCause } from '../utils/cutChatCause'

// Value: protects=the failure sentence of a Wiki update that quotes a long chat or system message with an emoji at the cut: the emoji is kept whole before the ellipsis; fails_when=the cut counts UTF-16 units and splits the emoji, so the sentence shows a lone surrogate (U+FFFD) before "…"; why_new=OCR2-2; seam=none; no_claim=a character made of several code points (a flag, a family emoji) is still cut between its code points
test('a chat cause cut at an emoji keeps the whole emoji before the ellipsis', () => {
  // Arrange: 119 letters, then an emoji of two UTF-16 units as the 120th character, then more letters.
  const cause = `${'x'.repeat(119)}😀${'y'.repeat(10)}`

  // Act
  const cut = cutChatCause(cause)

  // Assert
  assert.equal(cut, `${'x'.repeat(119)}😀…`)
})

// Value: protects=a chat cause of exactly 120 characters, one of them an emoji, which fits the bound and is quoted whole; fails_when=the bound counts UTF-16 units, so the cause counts 121, is cut and loses half its emoji to "…"; why_new=OCR2-2; seam=none; no_claim=none
test('a chat cause of 120 characters with an emoji is quoted whole and unmarked', () => {
  // Arrange: 119 letters and an emoji: 120 characters, 121 UTF-16 units.
  const cause = `${'x'.repeat(119)}😀`

  // Act
  const cut = cutChatCause(cause)

  // Assert
  assert.equal(cut, `${'x'.repeat(119)}😀`)
})
