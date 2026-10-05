import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Read as text and never imported: loading the script publishes a Wiki, starts its reader and opens a browser.
const scriptUrl = new URL('../wiki-reader-dom-qa.mjs', import.meta.url)

// Value: protects=the measured cases of the Wiki reader's right rail, chapter list and missing-page line (the unit suites read the shell's style sheet and run the page script on a hand-written page, never a layout); fails_when=a case is removed or renamed without notice, so a size or a focus ring the cycle's rows name is no longer measured; why_new=Cycle 0046 rows 28 and 61 (design review DR-8 to DR-11, ND-3); seam=none
test('the Wiki reader DOM check measures the open control, its states, the focus rings, the rail at 960 x 600, the single column and the missing-page line', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: the name of every case the check records, in the order it records them.
  const caseNames = [
    ...script.matchAll(/^ {4}record\(\n {6}'([^'\n]+)',$/gm),
  ].map(([, name]) => name)

  // Assert
  assert.deepEqual(caseNames, [
    'in the Wiki reader at 720 px the open control of the right rail keeps its label on one line, its target wraps under the label without widening the control, and the outline is no narrower than the control and at least 160 px wide',
    'in the Wiki reader at 1200 px the open control names the file and the line it opens and is no wider than the right rail, and neither the rail nor the chapter list scrolls sideways for an entry that cannot break',
    'the open control of the right rail answers the pointer with a fill and a link-coloured border, without a transition, and its keyboard focus ring lies inside it',
    'in the Wiki reader at 1200 px the keyboard focus ring of a chapter link, of an outline link and of the Change location link is whole: no side of it lies outside the column that scrolls',
    'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a refused update without a scrollbar, while a long outline scrolls inside 160 px',
    'in the Wiki reader at 960 x 600 an open update detail of twelve files scrolls inside 96 px under the whole sentence of the refused update, and the rail takes less than half of the window',
    'in the Wiki reader at 960 px the keyboard focus ring of an outline link lies inside the outline that scrolls',
    'in the Wiki reader at 640 px the single column keeps its rail as before: no cap on the rail, the outline or an open detail, and the open control has its margin',
    'the overview opened in place of a missing page has its status line in the page, empty and without a box, before the line gets its sentence 150 ms after the load, and names the missing page in the document title at once',
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
