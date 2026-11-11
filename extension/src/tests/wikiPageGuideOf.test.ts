import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiPageGuideOf } from '../utils/wikiPageGuideOf'

// Value: protects=the guide a large Wiki's reader questions route through: each page's title, what its first paragraph says, and every source its list and diagrams cite, once each; fails_when=the guide drops a diagram source, repeats a path, keeps markup or character references in the summary, or keeps a page that cites nothing or has no title; why_new=Cycle 0119 (H1 E2 step 6, F1: questions routed through raw paths never reached TanStack/query's core); seam=none (the real function); no_claim=that a page's first paragraph summarizes it well
test('the page guide keeps each page title, the start of its first paragraph and every source it cites once', () => {
  // Arrange
  const pages = [
    {
      path: 'query.html',
      title: 'Query cache',
      contentHtml:
        '<h2 id="cache">Cache</h2><p class="lead">Fetches &amp; <code>reuses</code>\n  a request.</p><p>Second paragraph.</p>',
      sources: [
        { path: 'src/query.ts', line: 1 },
        { path: 'src/cache.ts', line: 3 },
      ],
      diagrams: [
        {
          nodes: [
            { id: 'query', sources: [{ path: 'src/query.ts', line: 9 }] },
          ],
          edges: [
            { id: 'notify', sources: [{ path: 'src/observer.ts', line: 2 }] },
          ],
        },
      ],
    },
    {
      path: 'empty.html',
      title: 'No sources',
      contentHtml: '<p>Nothing cited.</p>',
      sources: [],
    },
    {
      path: 'untitled.html',
      contentHtml: '<p>No title.</p>',
      sources: [{ path: 'src/untitled.ts', line: 1 }],
    },
  ]

  // Act
  const guide = wikiPageGuideOf(pages)

  // Assert
  assert.deepEqual(guide, [
    {
      title: 'Query cache',
      summary: 'Fetches & reuses a request.',
      sources: ['src/query.ts', 'src/cache.ts', 'src/observer.ts'],
    },
  ])
})

// Value: protects=the size of a route request on a Wiki of long articles: a page's summary keeps 240 characters of its first paragraph, and an article whose paragraph never closes still gives its text instead of the whole page; fails_when=the summary keeps more than 240 characters or runs on past a missing closing tag into the rest of the article's markup; why_new=Cycle 0119 (F1 fix: page summaries in the route request); seam=none (the real function); no_claim=that 240 characters are enough for every page
test('a page summary keeps 240 characters of a first paragraph that never closes', () => {
  // Arrange
  const pages = [
    {
      title: 'Long article',
      contentHtml: `<p>${'word '.repeat(200)}`,
      sources: [{ path: 'src/long.ts', line: 1 }],
    },
  ]

  // Act
  const [entry] = wikiPageGuideOf(pages)

  // Assert
  assert.equal(entry?.summary.length, 240)
  assert.equal(entry?.summary.startsWith('word word '), true)
})
