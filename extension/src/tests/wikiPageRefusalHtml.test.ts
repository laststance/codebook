import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiPageRefusalHtml } from '../utils/wikiPageRefusalHtml'

// Value: protects=a learner whose page the reader stopped preparing at its deadline: the page says why and how to get the page back, and reading goes on from the Wiki's overview; fails_when=the refusal page loses its sentence about the deadline or its link to the overview of this reader, so the learner meets a dead end with no way back into the Wiki; why_new=P2D2; seam=none; no_claim=the status and the policy the reader serves the page with (deepWikiReader.test.ts)
test('a page the reader stopped preparing at its deadline says so, advises generating the Wiki again and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml('deadline', 10_000, readerPrefix)

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook stopped preparing this page after 10 seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Generate the Wiki again to replace the page.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=a learner whose page the reader's worker failed to prepare, also for a cause outside the page (the worker's file did not load, the worker exited); fails_when=the sentence blames the page and only advises generating the Wiki again, which changes nothing when the cause lies outside the page, or the refusal page loses its link to the overview; why_new=P2D2; seam=none; no_claim=which cause made the worker fail (the page names none, so it shows nothing of the project)
test('a page the reader’s worker failed to prepare advises a reload before generating the Wiki again, names no cause, and links to the Wiki’s overview', () => {
  // Arrange
  const readerPrefix = '/w/0f/'

  // Act
  const page = wikiPageRefusalHtml('failed', 10_000, readerPrefix)

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook could not prepare this page for reading. Reload the page; if it is still not shown, generate the Wiki again.</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})

// Value: protects=the refusal page's markup; fails_when=the reader's prefix is printed into the overview link unescaped, so a quote in it ends the link's address early; why_new=P2D2 (the page prints the prefix); seam=none; no_claim=the reader today serves a prefix of `/w/` and hex digits, which holds no such character
test('the overview link of a refusal page carries the reader’s prefix as written, with a quote and an ampersand in it', () => {
  // Arrange
  const readerPrefix = '/w/t"x&/'

  // Act
  const page = wikiPageRefusalHtml('failed', 10_000, readerPrefix)

  // Assert
  assert.equal(
    page,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook could not prepare this page for reading. Reload the page; if it is still not shown, generate the Wiki again.</p><p><a href="/w/t&quot;x&amp;/index.html">Open the Wiki’s overview</a></p></body></html>',
  )
})
