import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Read as text and never imported: loading the script publishes a Wiki, starts its reader and opens a browser.
const scriptUrl = new URL('../wiki-reader-dom-qa.mjs', import.meta.url)

// Value: protects=the measured cases of the Wiki reader's right rail, chapter list, reading column, missing-page line and of its own elements on a page that carries their ids (the unit suites read the shell's style sheet and run the page script on a hand-written page, never a layout); fails_when=a case is removed or renamed without notice, so a size or a focus ring the cycle's rows name is no longer measured; why_new=Cycle 0046 rows 28, 61, 67, 68, 69, 83 and 84 (design review DR-8 to DR-11, ND-3); seam=none
test('the Wiki reader DOM check measures the open control and its states, the row at 720 and 701 px, the focus rings of the rail, the article and the composer with the room they keep, the answer’s ring, the rail at 960 x 600, the single column, the missing-page line and two pages whose headings carry the reader’s ids', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: the name of every case the check records, in the order it records them.
  const caseNames = [
    ...script.matchAll(/^ {4}record\(\n {6}'([^'\n]+)',$/gm),
  ].map(([, name]) => name)

  // Assert
  assert.deepEqual(caseNames, [
    'in the Wiki reader at 720 px the open control of the right rail keeps its label on one line, its target wraps under the label without widening the control and keeps its line number whole, the outline is no narrower than the control and at least 160 px wide, and the output block keeps Change location on one line',
    'in the Wiki reader at 701 px, the narrowest window whose right rail is a row, the output block keeps Change location on one line, the outline is at least 160 px wide, the open control keeps its label on one line, and the row ends inside the rail and the page',
    'in the Wiki reader at 720 px the room the article and the composer keep for focus rings moves nothing: every part of the reading column stands where it stands without the room, at rest it is drawn the same, and an open answer leaves it so',
    'in the Wiki reader at 720 px the keyboard focus ring of every control of the article and the composer is whole, also of one the keyboard scrolled back from the edge: Relevant source files, a link of the article, the question field, Ask Codebook, the answer with its summary and its citation, and the connection line',
    'in the Wiki reader at 1200 px the open control names the file and the line it opens under a link that holds the label alone and is described by them, keeps the colon and the line number on one line, and is no wider than the right rail, and neither the rail nor the chapter list scrolls sideways for an entry that cannot break',
    'the open control of the right rail answers the pointer on its label and on its target with a fill and a link-coloured border, without a transition, darkens while pressed, follows its link from a press on the target, and its keyboard focus ring lies inside the whole block',
    'in the Wiki reader at 1200 px the keyboard focus ring of a chapter link, of an outline link and of the Change location link is whole: no side of it lies outside the column that scrolls',
    'in the Wiki reader at 1200 px a control of the right rail that the keyboard scrolls back from the upper or the lower edge keeps its whole focus ring: Update LLM Wiki and Change location',
    'in the Wiki reader at 1200 px the room the article and the composer keep for focus rings moves nothing: every part of the reading column stands where it stands without the room, at rest it is drawn the same, and an open answer leaves it so',
    'in the Wiki reader at 1200 px the keyboard focus ring of every control of the article and the composer is whole, also of one the keyboard scrolled back from the edge: Relevant source files, a link of the article, the question field, Ask Codebook, the answer with its summary and its citation, and the connection line',
    'in the Wiki reader at 1200 px the answer of a question has the reader’s own keyboard focus ring, 2 px in the link colour and 3 px outside it, whole inside the composer that scrolls',
    'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a refused update without a scrollbar, while a long outline scrolls inside 160 px',
    'in the Wiki reader at 960 x 600 an open update detail of twelve files scrolls inside 84 px (14vh) under the whole sentence of the refused update, and the rail is at most 45vh high',
    'in the Wiki reader at 960 px the keyboard focus ring of the summary of an open update detail lies inside the detail that scrolls',
    'in the Wiki reader at 960 px the keyboard focus ring of an outline link lies inside the outline that scrolls',
    'in the Wiki reader at 640 px the single column keeps its rail and its composer as before: no cap on the rail, the outline or an open detail, the open control has its margin, the output block may shrink, and the composer has no height limit and its own bottom padding',
    'the overview opened in place of a missing page has its status line in the page, empty and without a box, before the line gets its sentence 150 ms after the load, and names the missing page in the document title at once',
    'on a page whose headings were authored with the reader’s own ids every such id stands once in the served page, the headings, their outline entries and the links to them carry page- before the id, and the outline, the theme button, the question form with its label and its answer, the rail entry and the keyboard help work',
    'a page published with the reader’s ids also on its headings is served without an error and the reader still finds its own elements: the outline entry reaches its heading, the theme button works, a question is answered on the page and its answer shows, the question field is labelled, and the status region and the rail entry’s target get ids of their own',
  ])
})

test('the Wiki reader DOM check loads its flow from a file without eval, and reads the compiled reader and the publisher beside the script', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: the two ways a script turns text into code on its own, the call that runs the flow, and what the script imports from the product.
  const textRunAsCode = script
    .split('\n')
    .flatMap((line, index) =>
      /\beval\b|\bnew Function\b/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    )
  const flowCommands = script.match(/command\(\['run-code', .*\], 'flow'\)/g)
  const productImports = [
    ...script.matchAll(/from '(\.\.\/(?:dist|skills)\/[^']+)'/g),
  ].map(([, specifier]) => specifier)

  // Assert
  assert.deepEqual(textRunAsCode, [])
  assert.deepEqual(flowCommands, [
    "command(['run-code', `--filename=${flowPath}`], 'flow')",
  ])
  assert.deepEqual(productImports, [
    '../dist/deepWikiReader.js',
    '../skills/codebook/publish-wiki.mjs',
  ])
})
