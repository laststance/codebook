import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rebindDeepWikiEditorLinks } from '../utils/rebindDeepWikiEditorLinks'

/** The characters of the crafted source path: a quote, which prints as the six characters `&quot;` in each of the two copies of the path the reader adds beside a rail entry's link. */
const CRAFTED_PATH = '"'.repeat(2_000)
/** A rail entry as 0.2.29.0 published it, with a single-quoted address that holds the crafted path as it is, so the entry has 2,000 bytes of path that print as about 26,000 bytes of target. */
const CRAFTED_ENTRY = `<p class="open-in-editor"><a href='vscode://laststance.codebook/source?root=%2Frepo&amp;path=${CRAFTED_PATH}&amp;line=1'>Open in VS Code</a></p>`

// Value: protects=the editor's memory against a page that a cloned repository crafted from rail entries with long escaped paths, whose served HTML grew to about 12 times its file (24.7 MB for a file of 2 MB) where the reader's limits count about twice the file; fails_when=the reader adds the file and line beside every rail entry however much they add, so the served page is larger than its file plus the page file limit (2,097,152 bytes) of added text; why_new=Cycle 0048 task 17 (S11-N13); seam=none, the served page is compared as text; no_claim=the memory of a worker or of the host (only the size of the text is held)
test('a page of rail entries with long escaped paths is served at most the page file limit larger than its file, and the entries past that keep their link alone', () => {
  // Arrange
  const entryCount = Math.floor(2_000_000 / CRAFTED_ENTRY.length)
  const page = `<body>${CRAFTED_ENTRY.repeat(entryCount)}</body>`

  // Act
  const served = rebindDeepWikiEditorLinks(page, 'vscode')

  // Assert
  assert.equal(entryCount, 939)
  assert.ok(
    served.length <= page.length + 2_097_152,
    `served ${served.length} bytes for a file of ${page.length}`,
  )
  const entries = served.split('<p class="open-in-editor">').slice(1)
  assert.equal(entries.length, 939)
  assert.match(entries[0] ?? '', /aria-describedby="codebook-open-target"/)
  assert.doesNotMatch(entries.at(-1) ?? '', /aria-describedby/)
})

/** The characters of the crafted CJK path: one `漢` is one UTF-16 code unit and three UTF-8 bytes, so the path is 2,000 units and 6,000 bytes, and prints in each of the two copies of the target without any escape. */
const CRAFTED_CJK_PATH = '漢'.repeat(2_000)
/** A rail entry as 0.2.29.0 published it, with a single-quoted address that holds the CJK path as it is. */
const CRAFTED_CJK_ENTRY = `<p class="open-in-editor"><a href='vscode://laststance.codebook/source?root=%2Frepo&amp;path=${CRAFTED_CJK_PATH}&amp;line=1'>Open in VS Code</a></p>`

// Value: protects=the editor's memory against a page of rail entries with CJK paths, whose served bytes grew to about three times the bound because the bound counted UTF-16 code units, not bytes (a page of 1,998,095 bytes was served 3,963,374 bytes past its file); fails_when=the added text is counted in code units, so the served page is more than the page file limit (2,097,152 bytes) larger than its file counted in UTF-8 bytes; why_new=Cycle 0048 task 41 (OCR A, Red Team, QA); seam=none, the served page is compared as text by Buffer.byteLength; no_claim=the memory of a worker or of the host (only the size of the text is held)
test('a page of rail entries with CJK paths is served at most the page file limit of bytes larger than its file, and the entries past that keep their link alone', () => {
  // Arrange
  const entryBytes = Buffer.byteLength(CRAFTED_CJK_ENTRY)
  const entryCount = Math.floor(1_999_000 / entryBytes)
  const page = `<body>${CRAFTED_CJK_ENTRY.repeat(entryCount)}</body>`

  // Act
  const served = rebindDeepWikiEditorLinks(page, 'vscode')

  // Assert
  assert.equal(entryBytes, 6_129)
  assert.equal(entryCount, 326)
  const servedBytes = Buffer.byteLength(served)
  const pageBytes = Buffer.byteLength(page)
  assert.ok(
    servedBytes <= pageBytes + 2_097_152,
    `served ${servedBytes} bytes for a file of ${pageBytes}`,
  )
  const entries = served.split('<p class="open-in-editor">').slice(1)
  assert.equal(entries.length, 326)
  assert.match(entries[0] ?? '', /aria-describedby="codebook-open-target"/)
  assert.doesNotMatch(entries.at(-1) ?? '', /aria-describedby/)
})

// Value: protects=the learner's ordinary Wiki page, whose rail entry gets the file and line beside its link; fails_when=the bound on the added text takes the target from a page whose entries add far less than the limit; why_new=Cycle 0048 task 17 (S11-N13); seam=none, the served page is compared as text; no_claim=how many entries a page may carry
test('a page of 0.2.29.0 with an ordinary rail entry still gets the file and line beside its link', () => {
  // Arrange
  const page =
    '<body><p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12">Open in VS Code</a></p></body>'

  // Act
  const served = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    served,
    '<body><p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">src/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/a.ts:12</span></p></body>',
  )
})
