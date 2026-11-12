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

// Value: protects=the size of a route request on a Wiki of long articles: a page's summary keeps at most 240 characters of its first paragraph, also when that paragraph never closes; fails_when=the summary keeps more than 240 characters, or the guide fails on a paragraph without a closing tag; why_new=Cycle 0119 (F1 fix: page summaries in the route request); seam=none (the real function); no_claim=that 240 characters are enough for every page
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

// Value: protects=every reader question on a Wiki whose manifest holds a page with markup a browser would not read: the guide reads a bounded part of the first paragraph in one forward pass, so 400,000 `<` without a `>` cost milliseconds and leave no `<` in the summary; fails_when=tags are stripped with a backtracking pattern over the whole unclosed paragraph (the review round measured 15 s for 200,000 such characters), so each question blocks the editor's extension host; why_new=Cycle 0119 review round (guide built from untrusted manifest text); seam=none (the real function, timed); no_claim=the exact time on a given machine, only that it stays far under a second
test('a first paragraph full of unfinished tags gives its page guide at once', () => {
  // Arrange
  const pages = [
    {
      title: 'Broken article',
      contentHtml: `<p>Starts here. ${'<'.repeat(400_000)} tail`,
      sources: [{ path: 'src/broken.ts', line: 1 }],
    },
  ]
  const started = performance.now()

  // Act
  const [entry] = wikiPageGuideOf(pages)
  const elapsedMs = performance.now() - started

  // Assert
  assert.equal(entry?.summary, 'Starts here.')
  // gstack-timing-ok: the bounded scan is the contract; the quadratic stripping took 60 s on this input and the linear one under a millisecond, so a 1 s bound cannot flake
  assert.ok(elapsedMs < 1_000, `the guide took ${elapsedMs} ms`)
})

// Value: protects=the route request's page summaries on a Wiki whose article has no paragraph or whose opening paragraph tag never ends: the page keeps its title and sources with an empty summary, and text before the broken tag does not become the summary; fails_when=the guide throws on an article without a `<p>`, or reads an unfinished `<p` tag as a paragraph and takes the article's leading text as the summary; why_new=Cycle 0119 (no other test holds an article without a paragraph or an unterminated opening tag); seam=none (the real function); no_claim=how a browser would render such an article
test('an article without a paragraph, or with an opening paragraph tag that never ends, gives an empty summary and keeps its sources', () => {
  // Arrange
  const pages = [
    {
      title: 'Headings only',
      contentHtml: '<h2>Flow</h2><ul><li>Fetch</li></ul>',
      sources: [{ path: 'src/headings.ts', line: 1 }],
    },
    {
      title: 'Unfinished tag',
      contentHtml: 'Intro text <p class="lead" and more text without an end',
      sources: [{ path: 'src/unfinished.ts', line: 1 }],
    },
  ]

  // Act
  const guide = wikiPageGuideOf(pages)

  // Assert
  assert.deepEqual(guide, [
    { title: 'Headings only', summary: '', sources: ['src/headings.ts'] },
    { title: 'Unfinished tag', summary: '', sources: ['src/unfinished.ts'] },
  ])
})

// Value: protects=the size of a route request whatever titles a generated Wiki holds: the guide keeps a page title's first 120 characters; fails_when=a long generated title reaches the route request whole and takes its budget from the other pages; why_new=Cycle 0119 review round (route list budget); seam=none (the real function); no_claim=that 120 characters keep every title readable
test('a page title longer than 120 characters is cut to its first 120 in the page guide', () => {
  // Arrange
  const pages = [
    {
      title: 'T'.repeat(500),
      contentHtml: '<p>Short.</p>',
      sources: [{ path: 'src/long-title.ts', line: 1 }],
    },
  ]

  // Act
  const [entry] = wikiPageGuideOf(pages)

  // Assert
  assert.equal(entry?.title, 'T'.repeat(120))
})

// Value: protects=the files a page cites only through inline editor source links in its article, which the renderer counts as citations of the page: they join the page's guide sources, and a page that cites only inline stays in the guide; fails_when=the guide reads only the page's source list and diagrams, so a routed question is never offered a file the page explains in its text, or a page citing only inline is dropped, or a link of another site or extension is read as a citation; why_new=Cycle 0119 /ship pass 1 (Codex outside voice finding 1; smoke captures 002 and 003 reproduced it through the reader); seam=none (the real function); no_claim=that the linked paths are verified (the reader keeps only published, unchanged sources later)
test('a page guide offers the files its article cites by inline source links, also for a page that cites only inline', () => {
  // Arrange
  const pages = [
    {
      title: 'Auth',
      contentHtml: `<p>Signs a user in.</p><p>See <a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fauth.ts&amp;line=3&amp;sha256=${'a'.repeat(64)}">auth.ts</a>, <a href="CURSOR://laststance.codebook/source?path=src/token.ts&amp;line=1">token.ts</a>, <a href="https://example.com/laststance.codebook/source?path=src/site.ts">a site</a> and <a href="vscode://other.extension/source?path=src/other.ts">another extension</a>.</p>`,
      sources: [{ path: 'src/index.ts', line: 1 }],
    },
    {
      title: 'Session',
      contentHtml:
        '<p>Keeps the session.</p><p><a href="vscode://laststance.codebook/source?path=src%2Fsession.ts&amp;line=2">session.ts</a></p>',
    },
  ]

  // Act
  const guide = wikiPageGuideOf(pages)

  // Assert
  assert.deepEqual(guide, [
    {
      title: 'Auth',
      summary: 'Signs a user in.',
      sources: ['src/index.ts', 'src/auth.ts', 'src/token.ts'],
    },
    {
      title: 'Session',
      summary: 'Keeps the session.',
      sources: ['src/session.ts'],
    },
  ])
})
