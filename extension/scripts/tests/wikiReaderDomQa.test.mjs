import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Read as text and never imported: loading the script publishes a Wiki, starts its reader and opens a browser.
const scriptUrl = new URL('../wiki-reader-dom-qa.mjs', import.meta.url)

// Value: protects=the measured cases of the Wiki reader's right rail, chapter list, reading column, missing-page line and of its own elements on a page that carries their ids (the unit suites read the shell's style sheet and run the page script on a hand-written page, never a layout), and the cases that read the rail entry's link in Chrome's accessibility tree (the unit suites compare the entry as text, never what Chrome computes from it); fails_when=a case is removed or renamed without notice, so a size, a focus ring or a description the cycle's rows and findings name is no longer measured; why_new=Cycle 0046 rows 28, 61, 67, 68, 69, 83, 84, 132 and 137 (design review DR-8 to DR-11, ND-3), rows 330 and 343 (the sentences of a watch past its bound and of a learner's file in the way grew; their case holds the rail's bound), finding 600 (Chrome for Testing on C55 described the entry's link as "package.json :31"), and /ship finding F2 and follow-up N5 (script in a page's content must not run under the reader nor from disk); seam=none
test('the Wiki reader DOM check measures the open control and its states, the row at 720 and 701 px, the focus rings of the rail, the article and the composer with the room they keep, the answer’s ring, the rail at 960 x 600 with a refused start, the watch-bound and learner-file end sentences and a conflict, a long source path, the open control’s name and description in Chrome’s accessibility tree, the single column, the missing-page line, two pages whose headings carry the reader’s ids and a page whose content carries script, served and opened from disk', async () => {
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
    'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a refused update and its output line without a scrollbar, while a long outline scrolls inside 160 px',
    'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a VS Code watch that passed its 15 minutes, with the steps for a chat that waits, still works or stopped, and its output line without a scrollbar',
    'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a VS Code update that stopped on twelve files of the learner’s, with the chat that was not stopped, and its output line without a scrollbar',
    'in the Wiki reader at 960 x 600 the page of a conflict of twelve files shows its whole sentence and its output line in a rail of at most 45vh, and the list of the files, opened by a press, scrolls inside 84 px (14vh) and adds no more than that to the rail',
    'in the Wiki reader at 960 px the keyboard focus ring of the summary of an open update detail lies inside the detail that scrolls',
    'in the Wiki reader at 960 px the keyboard focus ring of an outline link lies inside the outline that scrolls',
    'in the Wiki reader at 1440 x 900 and 960 x 800 the keyboard focus ring of an outline link and of a chapter link, also of one whose title cannot break, leaves at least 2 px between the ring and the text on both sides, the text starts where it starts without the ring, and the ring lies inside the part that scrolls',
    'in the Wiki reader at 960 x 600 the rail entry of a source whose path is about 200 characters long shows eight lines of the path at rest, so the rail stays at most 45vh high, describes its link by the whole path, and shows the whole path while the pointer rests on it or its link has the keyboard focus',
    'Chrome’s accessibility tree gives the open control of the right rail as a link named Open in VS Code and described by the file and line it opens as written, extension/src/runtimeSupport/utils/removeAbandonedProfiles.ts:95, with no space where the shown path may wrap, and the entry gives assistive technology no other text than the label and that file and line',
    'Chrome’s accessibility tree gives the open control of a page whose first source is package.json line 31, as this publisher prints it, as a link named Open in VS Code and described by package.json:31 with no space before the colon, and the entry gives assistive technology no other text than the label and that file and line',
    'Chrome’s accessibility tree gives the open control the reader completes on a page in the shell of 0.2.29.0 whose first source is package.json line 31 as a link named Open in VS Code and described by package.json:31 with no space before the colon, and the entry gives assistive technology no other text than the label and that file and line',
    'Chrome’s accessibility tree gives the open control of a page published by a build of Cycle 0046 before finding 600, whose link was described by the target shown beside it with its wrap point, as a link named Open in VS Code and described by package.json:31 with no space before the colon once the reader serves it, and the entry gives assistive technology no other text than the label and that file and line',
    'in the Wiki reader at 640 px the single column keeps its rail and its composer as before: no cap on the rail, the outline or an open detail, the open control has its margin, the output block may shrink, and the composer has no height limit and its own bottom padding',
    'the overview opened in place of a missing page has its status line in the page, empty and without a box, before the line gets its sentence 150 ms after the load, and names the missing page in the document title at once',
    'on a page whose headings were authored with the reader’s own ids every such id stands once in the served page, the headings, their outline entries and the links to them carry page- before the id, and the outline, the theme button, the question form with its label and its answer, the rail entry and the keyboard help work',
    'a page published with the reader’s ids also on its headings is served without an error and the reader still finds its own elements: the outline entry reaches its heading, the theme button works, a question is answered on the page and its answer shows, the question field is labelled, the status region and the rail entry’s target get ids of their own, and the keyboard help is named by its own title',
    'a page whose content carries an event attribute and a javascript: link, as a Wiki published before the publisher refused them, runs neither under the reader, while the shell’s theme button and the reader’s own script work',
    'a page opened from disk whose content carries an event attribute and a javascript: link runs neither, while the shell’s theme button works and the page says it is an offline copy',
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

// Value: protects=the measured cases of a site published by 0.2.29.0, whose pages carry that build's stylesheet under the rules the reader injects; fails_when=the check no longer runs the steps of a page on the page in the shell of 0.2.29.0, or runs fewer of them there, or the shell kept beside the check is no longer the file the tag v0.2.29.0 shipped, so the injected rules are laid out against another stylesheet than a learner's old site has; why_new=Cycle 0046 row 138 (the pages named "published by 0.2.29.0" were pages of today's shell); seam=none
test('the Wiki reader DOM check runs the steps of a page a second time on the same content in the shell of 0.2.29.0, and that shell is the file the tag v0.2.29.0 shipped', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')
  const shellOf02290 = await readFile(
    new URL('../fixtures/reader-shell-0.2.29.0.txt', import.meta.url),
  )

  // Act: the steps of a page, how often the check runs them, what it adds to the name of a case of the second run, and the shell's digest.
  const stepsOfAPage = /const stepsOfAPage = \[([^\]]+)\]/
    .exec(script)?.[1]
    .split(',')
    .map((step) => step.trim())
    .filter(Boolean)
  const runs = script.match(
    /for \(const step of stepsOfAPage\) await step\(\)/g,
  )
  const namedInTheSecondRun = /caseSuffix = '([^']+)'/.exec(script)?.[1]
  const digest = createHash('sha256').update(shellOf02290).digest('hex')

  // Assert: the digest is that of `git show ae9c1f2:extension/skills/codebook/reader-shell.html`.
  assert.deepEqual(stepsOfAPage, [
    'measureEntryInRow',
    'measureNarrowestRow',
    'measureReadingColumnInRow',
    'measureEntryInColumn',
    'measureEntryStates',
    'measureRingsInColumns',
    'measureRingsAtRailEdges',
    'measureReadingColumnInColumns',
    'measureAnswerRing',
    'measureRailWithRefusal',
    'measureRailWithStoppedWatchEnds',
    'measureRailWithOpenDetail',
    'measureDetailSummaryRingInRow',
    'measureOutlineRingInRow',
    'measureSingleColumn',
    'readEntryFromAccessibilityTree',
    'measureRingsAgainstTheirText',
  ])
  assert.equal(runs?.length, 2)
  assert.equal(namedInTheSecondRun, ' (on a page in the shell of 0.2.29.0)')
  assert.equal(
    digest,
    'eb35cdfedadf3542fa601391c34c21bc56d0736c7798d21f2ab7b6b3f4b67442',
  )
})
