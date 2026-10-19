import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiPageRefusalHtml } from '../utils/wikiPageRefusalHtml'

// Value: protects=a learner whose page the reader stopped preparing at its deadline: the page says why and how to get the page back, and reading goes on from the Wiki's overview; fails_when=the refusal page loses its sentence about the deadline or its link to the overview of this reader, so the learner meets a dead end with no way back into the Wiki, or it advises generating the Wiki again, which the update refuses for a page changed by hand, instead of restoring the page and pressing Update LLM Wiki; why_new=P2D2; Cycle 0047 row 16 (P3D2) the next step; seam=none; no_claim=the status and the policy the reader serves the page with (deepWikiReader.test.ts)
test('a page the reader stopped preparing at its deadline says so, advises restoring the page before pressing Update LLM Wiki, and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml(
    'deadline',
    10_000,
    readerPrefix,
    'guide.html',
  )

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook stopped preparing this page after 10 seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=a learner whose page the reader's worker failed to prepare, also for a cause outside the page (the worker's file did not load, the worker exited); fails_when=the sentence blames the page and only advises a new Wiki, which changes nothing when the cause lies outside the page, or its next step after the reload is another than Update LLM Wiki, or the refusal page loses its link to the overview; why_new=P2D2; Cycle 0047 row 16 (P3D2) the next step names Update LLM Wiki; seam=none; no_claim=which cause made the worker fail (the page names none, so it shows nothing of the project)
test('a page the reader’s worker failed to prepare advises a reload before pressing Update LLM Wiki, names no cause, and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml('failed', 10_000, readerPrefix, 'guide.html')

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook could not prepare this page for reading. Reload the page; if it is still not shown, press Update LLM Wiki.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=a learner whose page file is larger than the reader prepares, either a page that the publisher of 0.2.30.0 or earlier wrote (it wrote a page of any size, which the reader of 0.2.30.0 read up to 8 MB and earlier readers read whole) or a file changed by hand: the page says so and gives each cause its next step; fails_when=the sentence advises generating the Wiki again, which the update refuses for a page changed by hand, instead of restoring the page and pressing Update LLM Wiki, or it claims a hand edit alone and leaves the learner whose earlier Codebook published the page without the step that helps, asking the editor chat to split it, or the refusal page loses its link to the overview; why_new=Cycle 0047 row 16 (P3D2): the sentence was pinned only through the reader; Cycle 0047 row 132 (RT2-2) both causes and the split; seam=none; no_claim=the size the reader refuses (deepWikiReader.test.ts)
test('a page whose file is too large to prepare says an earlier Codebook may have published it or it was changed by hand, advises restoring a hand-changed page or else asking the editor chat to split it, and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml(
    'too-large',
    10_000,
    readerPrefix,
    'guide.html',
  )

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>This page is too large for Codebook to prepare for reading. An earlier Codebook may have published a page this large, or its file may have been changed by hand. If you changed it, restore the page or move your change aside, then press Update LLM Wiki; otherwise ask the editor chat to split it into smaller pages and update the Wiki.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=a learner whose page, within the page file limit and so maybe one the publisher wrote, needs more memory than Codebook gives one page: the page must say so and name the step that helps; fails_when=the sentence blames a hand edit or advises restoring the page or Update LLM Wiki alone, which renders the same page again, instead of asking the editor chat to split the page, or the refusal page loses its link to the overview; why_new=Cycle 0047 row 104 (the rest of RT-2); seam=none; no_claim=when a worker reaches its heap limit (wikiPageWorker.test.ts, deepWikiReader.test.ts)
test('a page that needs more memory than Codebook gives one page says so, asks the editor chat to split it into smaller pages, and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml(
    'memory-limit',
    10_000,
    readerPrefix,
    'guide.html',
  )

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>This page needs more memory than Codebook gives one page to prepare it for reading. Ask the editor chat to split it into smaller pages and update the Wiki; Update LLM Wiki alone renders the same page again.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=the refusal page's markup; fails_when=the reader's prefix is printed into the overview link unescaped, so a quote in it ends the link's address early; why_new=P2D2 (the page prints the prefix); seam=none; no_claim=the reader today serves a prefix of `/w/` and hex digits, which holds no such character
test('the overview link of a refusal page carries the reader’s prefix as written, with a quote and an ampersand in it', () => {
  // Arrange
  const readerPrefix = '/w/t"x&/'

  // Act
  const page = wikiPageRefusalHtml('failed', 10_000, readerPrefix, 'guide.html')

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook could not prepare this page for reading. Reload the page; if it is still not shown, press Update LLM Wiki.</p><p><a href="/w/t&quot;x&amp;/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=a learner whose Wiki overview itself could not be prepared; fails_when=the overview's refusal page links to the overview, so the link only opens the same refusal again, a loop with no way on; why_new=Cycle 0047 row 15 (P3D1); seam=none; no_claim=the overview's address under another prefix (the reader serves its overview as index.html)
test('the refusal page of the Wiki’s overview itself has no link to the overview, which would open the same refusal again', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml(
    'deadline',
    10_000,
    readerPrefix,
    'index.html',
  )

  // Assert: the sentence alone, with its next step.
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook stopped preparing this page after 10 seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.</p></body></html>',
  )
})

// Value: protects=a learner whose page the reader did not prepare because it held as many pages as its page workers prepare and let wait: the page must say to reload in a moment, not that preparing failed; fails_when=the sentence is chosen by a chain that gives every reason it does not name the failure's sentence, so a page refused only for a moment advises Update LLM Wiki, or this refusal page loses its link to the overview; why_new=Cycle 0047 row 3 (S11-X1) the reason busy, and row 19 (P3OCR2-1) a sentence of its own for each reason; seam=none; no_claim=when the reader refuses a page as busy (deepWikiReader.test.ts, wikiPageWorker.test.ts)
test('a page refused because the reader holds as many pages as it can says to reload it in a moment, not that preparing failed, and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml('busy', 10_000, readerPrefix, 'guide.html')

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})
