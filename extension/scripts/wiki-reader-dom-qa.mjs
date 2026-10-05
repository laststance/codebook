import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { startDeepWikiReader } from '../dist/deepWikiReader.js'
import {
  prepareWikiStage,
  publishWiki,
} from '../skills/codebook/publish-wiki.mjs'

import { readerDomCommandOptions } from './utils/readerDomCommandOptions.mjs'
import { readerDomFlowText } from './utils/readerDomFlowText.mjs'

/** What the check expects of its cases: `verify` that all pass, `red` that at least one fails (a new case shown failing before its fix). */
const mode = process.argv[2] ?? 'verify'
assert.match(mode, /^(?:red|verify)$/)
/** The folder that receives the report, the stills and the logs of the browser calls. */
const output = resolve(process.argv[3] ?? 'artifacts/wiki-reader-dom')
await mkdir(output, { recursive: true })
/** The browser CLI's session of this check; another check running beside it has another name. */
const session = `cb-wiki-reader-${mode}`

/** The first source the sample overview cites: a path long enough to wrap in the rail's entry, and the line the entry names. */
const OPEN_TARGET = {
  path: 'extension/src/runtimeSupport/utils/removeAbandonedProfiles.ts',
  line: 95,
}
/** How many entries the sample overview's outline has: more than the outline shows at once where the rail is a row. */
const OUTLINE_ENTRY_COUNT = 40
/** The sentence of a refused update as the owned clone's native check W-3 showed it (336 characters): its lead words and the rest. */
const REFUSAL = {
  lead: 'Update failed',
  rest: ' at 11:05 AM: An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-c34c9bc0-55bd-4a45-9bc0-eecfaa647e2b, written 11:04 AM GMT+9). Codebook waits for it until 11:19 AM GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification. The last usable site is kept.',
}
/** The files an open update detail lists in the check. */
const DETAIL_PATHS = Array.from(
  { length: 12 },
  (_unused, index) => `pages/reference/changed-by-hand-${index + 1}.html`,
)

const runBrowserCli = promisify(execFile)

/**
 * Runs one call of the browser CLI and keeps what it printed beside the report, also when the call failed, so its log names the cause.
 * @param arguments_ - The CLI's command and its arguments, without the session.
 * @param label - The call's name; it is the name of its log file, and {@link readerDomCommandOptions} gives the call labelled `flow` the flow's own limit.
 * @returns What the call printed on its standard output.
 * @throws When the CLI could not be run, ended with an error or printed an error section.
 * @example
 * await command(['open', 'about:blank'], 'open')
 */
async function command(arguments_, label) {
  const printed = await runBrowserCli(
    'playwright-cli',
    [`-s=${session}`, ...arguments_],
    readerDomCommandOptions(label),
  ).catch((error) => ({
    // A CLI that could not be started printed nothing.
    stdout: error.stdout ?? '',
    stderr: `${error.stderr ?? ''}\n${String(error)}\n`,
    error,
  }))
  await writeFile(`${output}/${label}.log`, printed.stdout + printed.stderr)
  assert.equal(printed.error, undefined, String(printed.error))
  assert.equal(printed.stdout.includes('### Error'), false, printed.stdout)
  return printed.stdout
}

/**
 * Runs every release step of the check, also after one of them failed, so a browser that does not close cannot keep the reader or the temporary project alive.
 * @param steps - The steps, in the order they run; each releases one owned resource.
 * @returns Nothing.
 * @throws The first failure, after every step ran.
 * @example
 * await releaseEach([() => reader.close(), () => wiki.remove()])
 */
async function releaseEach(steps) {
  const failures = []
  for (const step of steps) await step().catch((error) => failures.push(error))
  assert.equal(failures.length, 0, String(failures[0]))
}

/**
 * Reads the flow's answer out of what the browser CLI printed for it: the JSON under the heading "### Result".
 * @param printed - The standard output of the call that ran the flow.
 * @returns The collected cases and page errors, as {@link runFlowKeepingCases} answered them.
 * @throws When the output holds no result section or the section is no JSON.
 * @example
 * flowReportOf('### Result\n{"cases":[],"errors":[]}\n### Ran code') // => { cases: [], errors: [] }
 */
function flowReportOf(printed) {
  const [, afterTheHeading = ''] = printed.split('### Result\n')
  const [resultSection] = afterTheHeading.split('\n###')
  return JSON.parse(resultSection)
}

/**
 * Fails the check unless its cases ended as its mode expects, naming the cases that failed.
 * @param checked - The report with the flow's cases and page errors.
 * @returns Nothing.
 * @throws When the page raised an error; in the mode `verify` when a case failed; in the mode `red` when every case passed.
 * @example
 * assertExpectedOutcome({ cases: [{ name: 'the rail fits', passed: true }], errors: [] }) // passes in the mode `verify`
 */
function assertExpectedOutcome(checked) {
  const failedCaseNames = checked.cases
    .filter((entry) => !entry.passed)
    .map((entry) => entry.name)
  assert.deepEqual(checked.errors, [], 'the page raised an error')
  // A red run shows a new case failing before its fix, so a run without a failure proves nothing.
  if (mode === 'red')
    assert.notDeepEqual(failedCaseNames, [], 'every case passed in a red run')
  else assert.deepEqual(failedCaseNames, [], 'cases failed')
}

/** Prints the report as the file `result.json` holds it. @example reportText({ mode: 'verify', cases: [] }) // => '{\n  "mode": "verify",\n  "cases": []\n}\n' */
const reportText = (checked) => `${JSON.stringify(checked, undefined, 2)}\n`

/**
 * Writes the manifest of the sample Wiki: an overview with a long outline whose first cited source is {@link OPEN_TARGET}, and enough further pages for a chapter list.
 * @param projectRoot - The sample project's real path.
 * @param sources - The indexed sources, each with its path and SHA-256.
 * @returns The manifest as the editor agent would write it into a prepared stage.
 * @example
 * sampleManifest('/tmp/x/sample', [{ path: 'src/a.ts', sha256: 'ab…' }]).pages[0].sources[0] // => { path: 'extension/src/…/removeAbandonedProfiles.ts', line: 95 }
 */
function sampleManifest(projectRoot, sources) {
  const outline = Array.from(
    { length: OUTLINE_ENTRY_COUNT },
    (_unused, index) => ({
      id: `part-${index + 1}`,
      // One entry cannot break, as an identifier in a heading cannot.
      label:
        index === 1
          ? 'createConfiguredBrowserRunPreparationForReplay'
          : `Part ${index + 1} of the rendering`,
    }),
  )
  const chapterTitles = [
    'Repository structure',
    'Architecture',
    'Authentication',
    'Creating an invoice',
    'Data layer',
    // A title that cannot break, as a page about one function has.
    'createConfiguredBrowserRunPreparationForReplay',
  ]
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: projectRoot,
    generated: {
      revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      at: '2026-10-05T12:00:00.000Z',
    },
    pages: [
      {
        path: 'index.html',
        title: 'Overview',
        section: 'Guide',
        contentHtml: outline
          .map(
            (entry) =>
              `<h2 id="${entry.id}">${entry.label}</h2><p>How this part of a page is rendered.</p>`,
          )
          .join(''),
        sources: [OPEN_TARGET, { path: 'src/a.ts', line: 1 }],
        outline,
      },
      ...chapterTitles.map((title, index) => ({
        path: `pages/chapter-${index + 1}.html`,
        title,
        section: 'Guide',
        contentHtml: '<p>Explained from source.</p>',
        sources: [{ path: 'src/a.ts', line: 1 }],
        outline: [],
      })),
    ],
    assets: [],
    excludedPaths: [],
    includedSources: sources,
  }
}

/**
 * Publishes the sample Wiki with the shipped publisher into a new temporary project and changes one cited source afterwards, so the served page settles on the freshness label of a changed source.
 * @returns The project's root, the Wiki's folder and a `remove` that deletes the temporary folder.
 * @throws When a file cannot be written or the publisher refuses the candidate; the temporary folder is removed first.
 * @example
 * const wiki = await publishSampleWiki() // wiki.outputDirectory => '/tmp/codebook-wiki-reader-dom-x/sample/.codebook/wiki'
 */
async function publishSampleWiki() {
  const temporaryFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-dom-')),
  )
  const remove = () => rm(temporaryFolder, { recursive: true, force: true })
  // The page's title names the project folder, so the folder has a fixed name.
  const projectRoot = join(temporaryFolder, 'sample')
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  const sourceTexts = {
    [OPEN_TARGET.path]: Array.from(
      { length: 100 },
      (_unused, index) => `export const line${index + 1} = ${index + 1}`,
    ).join('\n'),
    'src/a.ts': 'export const value = 1\n',
  }
  try {
    const sources = []
    for (const [path, text] of Object.entries(sourceTexts)) {
      await mkdir(dirname(join(projectRoot, path)), { recursive: true })
      await writeFile(join(projectRoot, path), text)
      sources.push({
        path,
        sha256: createHash('sha256').update(text).digest('hex'),
      })
    }
    const { stage } = await prepareWikiStage({ projectRoot, outputDirectory })
    await writeFile(
      join(stage, 'codebook-wiki.json'),
      JSON.stringify(sampleManifest(projectRoot, sources)),
    )
    await publishWiki({ projectRoot, outputDirectory, stageDirectory: stage })
    await appendFile(
      join(projectRoot, 'src/a.ts'),
      '// changed after the publish\n',
    )
  } catch (error) {
    await remove()
    throw error
  }
  return { projectRoot, outputDirectory, remove }
}

/** Lays out pages of a served Wiki in real Chrome and measures the right rail, the chapter list and the missing-page line. It adds its cases and the page's errors to the lists of `collected`, which {@link runFlowKeepingCases} answers also when a step throws. It runs in the browser CLI as text, so it uses only its arguments and what it defines itself. @example await check(page, options, { cases: [], errors: [] }) */
async function check(page, options, collected) {
  const { cases } = collected
  const { errors } = collected
  page.on('pageerror', (error) => errors.push(String(error)))
  page.setDefaultTimeout(5_000)
  /** Adds one case; it passed when every named check of it holds. @example record('the rail fits', { height: 216 }, { isShort: true }) */
  const record = (name, actual, checks) =>
    cases.push({
      name,
      actual: { ...actual, checks },
      passed: Object.values(checks).every(Boolean),
    })
  /** Opens a page of the served Wiki at one viewport and waits until its script has written the freshness of the changed source. @example await openWiki(960, 600) */
  const openWiki = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${options.url}index.html`)
    await page.waitForFunction(
      () =>
        document.querySelector('[data-codebook-freshness]').textContent ===
        'Source changed · Update available',
    )
  }
  /** Gives one element the keyboard focus the way the Tab key does, so `:focus-visible` holds for it: the script focuses it, Shift+Tab leaves it and Tab comes back. @example await focusWithKeyboard('.open-in-editor a') */
  const focusWithKeyboard = async (selector) => {
    await page.evaluate(
      (focused) => document.querySelector(focused).focus(),
      selector,
    )
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
  }
  /** Reads where the focus ring of an element lies against the box its nearest scrolling ancestor clips at. The ring reaches the outline's offset plus its width outside the element; a reach of zero is a ring inside it. @example await focusRing('.outline a') // => { isFocusedByKeyboard: true, reachPx: 0, leftInsideClipPx: 0, rightInsideClipPx: 12, … } */
  const focusRing = (selector) =>
    page.evaluate((focused) => {
      const scrollerOf = (start) => {
        let scroller = start.parentElement
        while (
          scroller !== document.documentElement &&
          getComputedStyle(scroller).overflowX === 'visible'
        )
          scroller = scroller.parentElement
        return scroller
      }
      const tenths = (pixels) => Math.round(pixels * 10) / 10
      const element = document.querySelector(focused)
      const style = getComputedStyle(element)
      const reachPx =
        Number.parseFloat(style.outlineOffset) +
        Number.parseFloat(style.outlineWidth)
      const scroller = scrollerOf(element)
      const box = element.getBoundingClientRect()
      const clipLeft =
        scroller.getBoundingClientRect().left + scroller.clientLeft
      return {
        isFocusedByKeyboard:
          document.activeElement === element &&
          element.matches(':focus-visible'),
        outlineOffset: style.outlineOffset,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        scroller: scroller.className || scroller.tagName,
        reachPx,
        leftInsideClipPx: tenths(box.left - reachPx - clipLeft),
        rightInsideClipPx: tenths(
          clipLeft + scroller.clientWidth - (box.right + reachPx),
        ),
      }
    }, selector)
  /** Reads the open control of the right rail: its text, the lines and widths of its label and target, and the widths around it. @example (await measureEntry()).labelLines // => 1 */
  const measureEntry = () =>
    page.evaluate(() => {
      // A range answers one box or more per line of its text, and the boxes of one line share their top.
      const lineCount = (element) => {
        const text = document.createRange()
        text.selectNodeContents(element)
        return new Set(
          [...text.getClientRects()].map((box) => Math.round(box.top)),
        ).size
      }
      const widthOf = (element) =>
        Math.round(element.getBoundingClientRect().width * 10) / 10
      const link = document.querySelector('.open-in-editor a')
      const label = link.querySelector('.open-label')
      const labelText = document.createRange()
      labelText.selectNodeContents(label)
      const rail = document.querySelector('.right-rail')
      const chapters = document.querySelector('.chapters')
      return {
        railDisplay: getComputedStyle(rail).display,
        linkText: link.textContent,
        labelLines: lineCount(label),
        labelLineWidth: widthOf(labelText),
        targetLines: lineCount(link.querySelector('.open-target')),
        targetWidth: widthOf(link.querySelector('.open-target')),
        controlWidth: widthOf(link),
        outlineWidth: widthOf(rail.querySelector('nav')),
        railClientWidth: rail.clientWidth,
        railScrollWidth: rail.scrollWidth,
        chaptersClientWidth: chapters.clientWidth,
        chaptersScrollWidth: chapters.scrollWidth,
      }
    })
  /** Reads the rail's parts against the rail's own box; the detail's sizes are null while the panel has none. @example (await measureRail()).railHeight // => 177.9 */
  const measureRail = () =>
    page.evaluate(() => {
      const heightOf = (element) =>
        Math.round(element.getBoundingClientRect().height * 10) / 10
      const sizesOf = (element) => ({
        height: heightOf(element),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })
      const rail = document.querySelector('.right-rail')
      const panel = document.querySelector('[data-codebook-update-group]')
      const detail = document.querySelector('[data-codebook-update-detail]')
      return {
        railDisplay: getComputedStyle(rail).display,
        rail: sizesOf(rail),
        panel: sizesOf(panel),
        panelWidth: Math.round(panel.getBoundingClientRect().width * 10) / 10,
        panelBottomBelowRailBottom:
          Math.round(
            (panel.getBoundingClientRect().bottom -
              rail.getBoundingClientRect().bottom) *
              10,
          ) / 10,
        status: sizesOf(
          document.querySelector('[data-codebook-update-status]'),
        ),
        outline: sizesOf(rail.querySelector('nav')),
        detail: detail
          ? sizesOf(detail)
          : { height: null, clientHeight: null, scrollHeight: null },
        readingColumnHeight: heightOf(
          document.querySelector('.reading-column'),
        ),
        viewportHeight: window.innerHeight,
      }
    })
  /** The checks both states of the update panel share at 960 x 600: the rail cuts nothing, the outline scrolls inside 160 px, the article keeps its room. @example railChecks(await measureRail()).isSentenceWhole // => true */
  const railChecks = (measured) => ({
    isRow: measured.railDisplay === 'flex',
    hasRailNoScroll: measured.rail.scrollHeight <= measured.rail.clientHeight,
    isPanelInsideRail: measured.panelBottomBelowRailBottom <= 0,
    hasPanelNoScroll:
      measured.panel.scrollHeight <= measured.panel.clientHeight,
    isSentenceWhole:
      measured.status.scrollHeight <= measured.status.clientHeight,
    isOutlineAtMost160: measured.outline.height <= 160,
    doesOutlineScrollInside:
      measured.outline.scrollHeight > measured.outline.clientHeight,
    doesReadingColumnKeepRoom: measured.readingColumnHeight >= 200,
  })

  const measureEntryInRow = async () => {
    // Arrange: the overview at 720 px, where the right rail is a row (701 to 1000 px) and the entry's target is a long path.
    await openWiki(720, 720)
    // Act
    const entry = await measureEntry()
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-rail-row-720.png` })
    // Assert
    record(
      'in the Wiki reader at 720 px the open control of the right rail keeps its label on one line, its target wraps under the label without widening the control, and the outline is no narrower than the control and at least 160 px wide',
      entry,
      {
        isRow: entry.railDisplay === 'flex',
        isLabelOnOneLine: entry.labelLines === 1,
        doesTargetWrap: entry.targetLines >= 2,
        // Half a pixel of rounding between the label's text and the block around it.
        isTargetNoWiderThanLabel:
          entry.targetWidth <= entry.labelLineWidth + 0.5,
        isOutlineNoNarrowerThanControl:
          entry.outlineWidth >= entry.controlWidth,
        isOutlineWideEnough: entry.outlineWidth >= 160,
      },
    )
  }
  const measureEntryInColumn = async () => {
    // Arrange: the same page at 1200 px, the column of the approved image; an outline entry and a chapter title cannot break.
    await openWiki(1200, 720)
    // Act
    const entry = await measureEntry()
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-rail-column-1200.png` })
    // Assert
    record(
      'in the Wiki reader at 1200 px the open control names the file and the line it opens and is no wider than the right rail, and neither the rail nor the chapter list scrolls sideways for an entry that cannot break',
      entry,
      {
        isColumn: entry.railDisplay === 'block',
        doesTextNameTheTarget: entry.linkText === options.expectedEntryText,
        isControlInsideRail: entry.controlWidth <= entry.railClientWidth,
        hasRailNoSidewaysScroll: entry.railScrollWidth <= entry.railClientWidth,
        hasChapterListNoSidewaysScroll:
          entry.chaptersScrollWidth <= entry.chaptersClientWidth,
      },
    )
  }
  const measureEntryStates = async () => {
    // Arrange: still 1200 px. Act: the pointer rests on the entry, then the keyboard focuses it, in the light and the dark theme.
    await page.hover('.open-in-editor a')
    const hovered = await page.evaluate(() => {
      const style = getComputedStyle(
        document.querySelector('.open-in-editor a'),
      )
      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        transition: style.transitionDuration,
      }
    })
    await page.mouse.move(0, 0)
    await focusWithKeyboard('.open-in-editor a')
    const ring = await focusRing('.open-in-editor a')
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-entry-focus-light.png` })
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-entry-focus-dark.png` })
    await page.evaluate(() => {
      delete document.documentElement.dataset.theme
    })
    // Assert: the light theme's second panel colour and link colour under the pointer, and a ring that lies inside the block.
    record(
      'the open control of the right rail answers the pointer with a fill and a link-coloured border, without a transition, and its keyboard focus ring lies inside it',
      { hovered, ring },
      {
        isFilledUnderPointer: hovered.background === 'rgb(239, 238, 236)',
        isBorderedUnderPointer: hovered.border === 'rgb(24, 91, 147)',
        hasNoTransition: hovered.transition === '0s',
        isFocusedByKeyboard: ring.isFocusedByKeyboard,
        isRingOffsetInside: ring.outlineOffset === '-2px',
        isRingTwoPixels: ring.outlineWidth === '2px',
      },
    )
  }
  const measureRingsInColumns = async () => {
    // Arrange: still 1200 px, where the chapter list and the right rail scroll. Act: the keyboard focuses a chapter link, an outline link and the last link of the rail.
    const rings = {}
    for (const [name, selector] of [
      ['chapter', '.chapters a:not([aria-current])'],
      ['outline', '.outline a'],
      ['changeLocation', '.output a'],
    ]) {
      await focusWithKeyboard(selector)
      rings[name] = await focusRing(selector)
      await page.screenshot({
        path: `${options.output}/wiki-focus-${name}-1200.png`,
      })
    }
    // Assert
    record(
      'in the Wiki reader at 1200 px the keyboard focus ring of a chapter link, of an outline link and of the Change location link is whole: no side of it lies outside the column that scrolls',
      rings,
      Object.fromEntries(
        Object.entries(rings).flatMap(([name, ring]) => [
          [`${name}IsFocusedByKeyboard`, ring.isFocusedByKeyboard],
          [`${name}RingLeftIsInside`, ring.leftInsideClipPx >= 0],
          [`${name}RingRightIsInside`, ring.rightInsideClipPx >= 0],
        ]),
      ),
    )
  }
  const measureRailWithRefusal = async () => {
    // Arrange: the overview at 960 x 600. Act: the sentence of a refused update is written into the panel as the page script writes one.
    await openWiki(960, 600)
    await page.evaluate((refusal) => {
      const status = document.querySelector('[data-codebook-update-status]')
      const lead = document.createElement('strong')
      lead.textContent = refusal.lead
      status.replaceChildren(lead, refusal.rest)
      status.setAttribute('data-state', 'failed')
    }, options.refusal)
    const measured = await measureRail()
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-rail-refusal-960x600.png` })
    // Assert
    record(
      'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a refused update without a scrollbar, while a long outline scrolls inside 160 px',
      measured,
      {
        ...railChecks(measured),
        isRailAtMost45vh:
          measured.rail.height <= measured.viewportHeight * 0.45,
      },
    )
  }
  const measureRailWithOpenDetail = async () => {
    // Arrange: the same page with the sentence in its panel. Act: an open detail of twelve files is put under the sentence, as the page script builds one.
    await page.evaluate((paths) => {
      const detail = document.createElement('details')
      detail.setAttribute('data-codebook-update-detail', '')
      detail.setAttribute('open', '')
      const summary = document.createElement('summary')
      summary.textContent = `Show all ${paths.length} files`
      const list = document.createElement('ul')
      list.append(
        ...paths.map((path) => {
          const item = document.createElement('li')
          item.textContent = path
          return item
        }),
      )
      detail.append(summary, list)
      document.querySelector('[data-codebook-update-status]').after(detail)
    }, options.detailPaths)
    const measured = await measureRail()
    await page.screenshot({
      path: `${options.output}/wiki-page-refusal-detail-960x600.png`,
    })
    // Assert
    record(
      'in the Wiki reader at 960 x 600 an open update detail of twelve files scrolls inside 96 px under the whole sentence of the refused update, and the rail takes less than half of the window',
      measured,
      {
        ...railChecks(measured),
        isRailLessThanHalfTheWindow:
          measured.rail.height < measured.viewportHeight * 0.5,
        isDetailAtMost96: measured.detail.height <= 96,
        doesDetailScrollInside:
          measured.detail.scrollHeight > measured.detail.clientHeight,
      },
    )
  }
  const measureOutlineRingInRow = async () => {
    // Arrange: still 960 px, where the outline is the scroller. Act: the keyboard focuses an outline link.
    await focusWithKeyboard('.outline a')
    const ring = await focusRing('.outline a')
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-focus-outline-960.png` })
    // Assert
    record(
      'in the Wiki reader at 960 px the keyboard focus ring of an outline link lies inside the outline that scrolls',
      ring,
      {
        isFocusedByKeyboard: ring.isFocusedByKeyboard,
        isOutlineTheScroller: ring.scroller === 'NAV',
        isRingLeftInside: ring.leftInsideClipPx >= 0,
        isRingRightInside: ring.rightInsideClipPx >= 0,
      },
    )
  }
  const measureSingleColumn = async () => {
    // Arrange: the overview at 640 px, the single column, with an open detail in its panel. Act: the rail's rules are read.
    await openWiki(640, 720)
    await page.evaluate(() => {
      const detail = document.createElement('details')
      detail.setAttribute('data-codebook-update-detail', '')
      detail.setAttribute('open', '')
      document.querySelector('[data-codebook-update-status]').after(detail)
    })
    const column = await page.evaluate(() => {
      const styleOf = (selector) =>
        getComputedStyle(document.querySelector(selector))
      const rail = styleOf('.right-rail')
      const outline = styleOf('.right-rail nav')
      return {
        railDisplay: rail.display,
        railMaxHeight: rail.maxHeight,
        railOverflow: rail.overflowY,
        outlineMaxHeight: outline.maxHeight,
        outlineOverflow: outline.overflowY,
        outlineMinWidth: outline.minWidth,
        detailMaxHeight: styleOf('[data-codebook-update-detail]').maxHeight,
        entryMarginBottom: styleOf('.open-in-editor').marginBottom,
      }
    })
    // Assert
    record(
      'in the Wiki reader at 640 px the single column keeps its rail as before: no cap on the rail, the outline or an open detail, and the open control has its margin',
      column,
      {
        isBlock: column.railDisplay === 'block',
        hasRailNoCap: column.railMaxHeight === 'none',
        doesRailKeepItsOverflow: column.railOverflow === 'auto',
        hasOutlineNoCap: column.outlineMaxHeight === 'none',
        doesOutlineNotScroll: column.outlineOverflow === 'visible',
        hasOutlineNoMinimumWidth: column.outlineMinWidth === '0px',
        hasDetailNoCap: column.detailMaxHeight === 'none',
        hasEntryItsMargin: column.entryMarginBottom === '16px',
      },
    )
  }
  const measureMissingPage = async () => {
    // Arrange: every change of the missing-page line is logged from the first moment of the next document.
    await page.addInitScript(() => {
      window.missingPageLog = []
      const factsOf = (line) => ({
        text: line.textContent,
        role: line.getAttribute('role'),
        height: line.getBoundingClientRect().height,
        isFirstOfReadingColumn:
          line.parentElement.matches('.reading-column') &&
          line.previousElementSibling === null,
      })
      const note = (event) => {
        const line = document.querySelector('[data-codebook-missing-page]')
        window.missingPageLog.push({
          event,
          atMs: Math.round(performance.now()),
          title: document.title,
          ...(line ? factsOf(line) : { text: null }),
        })
      }
      new MutationObserver(() => {
        const line = document.querySelector('[data-codebook-missing-page]')
        if (!line) return
        // The first record of the line is its insertion; a later one with another text is its sentence.
        if (window.missingPageLog.length === 0) note('inserted')
        else if (line.textContent !== window.missingPageLog.at(-1).text)
          note('text')
      }).observe(document, { childList: true, subtree: true })
      window.addEventListener('load', () => note('load'))
    })
    // Act: the address of a page the Wiki does not have; the reader answers with the overview.
    await page.setViewportSize({ width: 1200, height: 720 })
    await page.goto(`${options.url}pages/removed.html`)
    await page.waitForFunction(() =>
      window.missingPageLog.some((entry) => entry.event === 'load'),
    )
    // Three times the delay after the load: a sentence that has not arrived by then is reported by the case, not by a wait that ran out.
    await page.waitForTimeout(450)
    const missingPage = await page.evaluate(() => {
      const logged = (event) =>
        window.missingPageLog.find((entry) => entry.event === event) ?? {}
      return {
        log: window.missingPageLog,
        inserted: logged('inserted'),
        loaded: logged('load'),
        worded: logged('text'),
        address: location.pathname.split('/').at(-1) + location.search,
        focused: document.activeElement.tagName,
      }
    })
    await page.screenshot({ path: `${options.output}/wiki-missing-page.png` })
    // Assert
    const { inserted, loaded, worded } = missingPage
    record(
      'the overview opened in place of a missing page has its status line in the page, empty and without a box, before the line gets its sentence 150 ms after the load, and names the missing page in the document title at once',
      missingPage,
      {
        isInsertedEmpty: inserted.text === '',
        isInsertedAsStatus: inserted.role === 'status',
        hasEmptyLineNoBox: inserted.height === 0,
        isFirstOfReadingColumn: inserted.isFirstOfReadingColumn === true,
        doesTitleCarryTheNotice:
          inserted.title ===
          'Page not in this Wiki · Overview · sample DeepWiki',
        isEmptyAtLoad: loaded.text === '',
        isWordedAfterTheDelay: worded.atMs - loaded.atMs >= 150,
        isSentenceWhole:
          worded.text ===
          'The page pages/removed.html is not in this Wiki. The last update may have removed it. This is the overview.',
        doesAddressForgetThePage: missingPage.address === 'index.html',
        isFocusNotMoved: missingPage.focused === 'BODY',
      },
    )
  }
  // Each step leaves the page as the next one needs it: the 1200 px steps share one load, and so do the 960 px steps.
  for (const step of [
    measureEntryInRow,
    measureEntryInColumn,
    measureEntryStates,
    measureRingsInColumns,
    measureRailWithRefusal,
    measureRailWithOpenDetail,
    measureOutlineRingInRow,
    measureSingleColumn,
    measureMissingPage,
  ])
    await step()
}

const report = {
  mode,
  qualification:
    'Real Chromium and a Wiki published by the shipped publisher, served by the compiled reader; no editor takes part, so this is not native acceptance.',
  cases: [],
}
const wiki = await publishSampleWiki()
let reader
let isBrowserOpen = false
try {
  reader = await startDeepWikiReader(
    wiki.outputDirectory,
    wiki.projectRoot,
    async () => ({ handoff: 'unused' }),
    'vscode',
  )
  // The flow reaches `run-code` as one function in a file it loads itself, written by {@link readerDomFlowText}: a step that throws then ends as one failed case after the cases that passed.
  const flowPath = `${output}/flow.js`
  await writeFile(
    flowPath,
    readerDomFlowText(check, {
      // The reader's address names its overview; the flow opens pages beside it.
      url: new URL('.', reader.url).href,
      output,
      expectedEntryText: `Open in VS Code ${OPEN_TARGET.path}:${OPEN_TARGET.line}`,
      refusal: REFUSAL,
      detailPaths: DETAIL_PATHS,
    }),
  )
  await command(['open', 'about:blank'], 'open')
  isBrowserOpen = true
  Object.assign(
    report,
    flowReportOf(await command(['run-code', `--filename=${flowPath}`], 'flow')),
  )
  assertExpectedOutcome(report)
} finally {
  // The report is kept and each owned resource released on its own, also after a failed assertion or browser call.
  await releaseEach([
    () => writeFile(`${output}/result.json`, reportText(report)),
    async () => {
      if (isBrowserOpen) await command(['close'], 'close')
    },
    async () => {
      if (reader) await reader.close()
    },
    wiki.remove,
  ])
}
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ name: entry.name, passed: entry.passed })),
  ),
)
