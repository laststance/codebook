import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFile,
  readFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
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
import { readerDomSessionName } from './utils/readerDomSessionName.mjs'

/** What the check expects of its cases: `verify` that all pass, `red` that at least one fails (a new case shown failing before its fix). */
const mode = process.argv[2] ?? 'verify'
assert.match(mode, /^(?:red|verify)$/)
/** The folder that receives the report, the stills and the logs of the browser calls. */
const output = resolve(process.argv[3] ?? 'artifacts/wiki-reader-dom')
await mkdir(output, { recursive: true })
/** The browser CLI's session of this run: another check, and another run of this check into another folder, has another name ({@link readerDomSessionName}). */
const session = readerDomSessionName('wiki-reader', mode, output)

/** The first source the sample overview cites: a path long enough to wrap in the rail's entry, and the line the entry names. */
const OPEN_TARGET = {
  path: 'extension/src/runtimeSupport/utils/removeAbandonedProfiles.ts',
  line: 95,
}
/** How many entries the sample overview's outline has: more than the outline shows at once where the rail is a row. */
const OUTLINE_ENTRY_COUNT = 40
/** Why a start was refused in the owned clone's native check W-3: another window appeared to be updating. The page words it into its longest sentence of a refused update (about 336 characters with its lead words and its end). */
const REFUSAL_REASON =
  'An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-c34c9bc0-55bd-4a45-9bc0-eecfaa647e2b, written 11:04 AM GMT+9). Codebook waits for it until 11:19 AM GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification.'
/** The pages a conflict names in the check: more than the sentence names, so the page offers the whole list. */
const CONFLICT_PATHS = Array.from(
  { length: 12 },
  (_unused, index) => `pages/reference/changed-by-hand-${index + 1}.html`,
)
/** A source whose path is about 200 characters long, and the line a page cites: the first source of the sample page {@link LONG_SOURCE_PAGE}, whose rail entry names it. */
const LONG_SOURCE = {
  path: 'packages/learning-replay-workspace/src/runtimeSupport/browserRunPreparation/configuredBrowserRunPreparationForReplay/internal/profiles/removeAbandonedBrowserProfilesAfterAnInterruptedRecordingSession.ts',
  line: 128,
}
const LONG_SOURCE_PAGE = 'pages/long-source.html'
/** The sample page that is printed into the shell of 0.2.29.0 after the publish: the overview's content under the stylesheet a site of that build carries, with the rail's entry as that build printed it. */
const PAGE_IN_THE_SHELL_OF_02290 = 'pages/shell-of-0.2.29.0.html'

/** The question the check asks in the composer, and what the reader answers it: twelve lines, so the composer reaches its height limit and scrolls, and one cited line. */
const QUESTION = 'How is a page rendered?'
const ANSWER = {
  answer: Array.from(
    { length: 12 },
    (_unused, index) => `Step ${index + 1}: one part of the page is rendered.`,
  ).join('\n'),
  citations: [
    {
      path: 'src/a.ts',
      line: 1,
      uri: 'vscode://laststance.codebook/source?root=%2Fsample&path=src%2Fa.ts&line=1&sha256=0f',
    },
  ],
  sourceChanged: false,
}

/** The ids the reader gives its own elements in a served page: those of the shell's template, the target of the rail's entry, the region of the update status, and the heading and the tooltip of the keyboard help. Two sample pages carry each of them on a heading of their article. */
const READER_IDS = [
  'theme-toggle',
  'article-title',
  'qa-form',
  'qa-input',
  'qa-response',
  'codebook-open-target',
  'codebook-update-status',
  'shortcut-title',
  'shortcut-tooltip',
]
/** The two sample pages whose headings carry the reader's ids: one as this publisher prints it, and one put back after the publish into the shape a publisher before this build printed, with the ids twice and the rail's entry as its link alone. */
const READER_IDS_PAGE = 'pages/reader-ids.html'
const READER_IDS_PAGE_PUBLISHED_BEFORE =
  'pages/reader-ids-published-before.html'

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
  const overviewContent = outline
    .map(
      (entry) =>
        // Each paragraph starts with a link, so a link stands at the article's left edge wherever the article is scrolled to.
        `<h2 id="${entry.id}">${entry.label}</h2><p><a href="#part-1">The first part</a> comes before how this part of a page is rendered.</p>`,
    )
    .join('')
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
        contentHtml: overviewContent,
        sources: [OPEN_TARGET, { path: 'src/a.ts', line: 1 }],
        outline,
      },
      // The overview once more: this page is printed into the shell of 0.2.29.0 after the publish.
      {
        path: PAGE_IN_THE_SHELL_OF_02290,
        title: 'Overview',
        section: 'Guide',
        contentHtml: overviewContent,
        sources: [OPEN_TARGET, { path: 'src/a.ts', line: 1 }],
        outline,
      },
      // A page whose rail entry names a path of about 200 characters.
      {
        path: LONG_SOURCE_PAGE,
        title: 'A long source path',
        section: 'Guide',
        contentHtml:
          '<h2 id="where">Where it lives</h2><p>Explained from source.</p>',
        sources: [LONG_SOURCE],
        outline: [{ id: 'where', label: 'Where it lives' }],
      },
      ...chapterTitles.map((title, index) => ({
        path: `pages/chapter-${index + 1}.html`,
        title,
        section: 'Guide',
        contentHtml: '<p>Explained from source.</p>',
        sources: [{ path: 'src/a.ts', line: 1 }],
        outline: [],
      })),
      // Each heading of these two pages carries an id of the reader, is named by the outline and is the target of a link of its page.
      ...[
        [READER_IDS_PAGE, 'Reader ids'],
        [READER_IDS_PAGE_PUBLISHED_BEFORE, 'Reader ids, published before'],
      ].map(([path, title]) => ({
        path,
        title,
        section: 'Guide',
        contentHtml: READER_IDS.map(
          (id) =>
            `<h2 id="${id}">Section ${id}</h2><p><a href="#${id}">The start of this section</a></p>`,
        ).join(''),
        sources: [{ path: 'src/a.ts', line: 1 }],
        outline: READER_IDS.map((id) => ({ id, label: `Section ${id}` })),
      })),
    ],
    assets: [],
    excludedPaths: [],
    includedSources: sources,
  }
}

/**
 * Reads what the publisher printed into each field of the shell when it rendered a page, by matching the page against the shell it was rendered from; called by {@link pageInTheShellOf02290}.
 * @param page - A published page.
 * @param shell - The text of the shell that page was rendered from, with its `{{FIELD}}` marks.
 * @returns The value of every field of the shell, by its name.
 * @throws When the page is no page of that shell.
 * @example
 * fieldValuesOf('<title>Overview</title>', '<title>{{TITLE}}</title>') // => { TITLE: 'Overview' }
 */
function fieldValuesOf(page, shell) {
  const seenFields = new Set()
  const pattern = shell
    .split(/\{\{([A-Z_]+)\}\}/)
    .map((part, index) => {
      // Even parts are the shell's own text, odd parts the names of its fields.
      if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // A field the shell prints twice has the same value both times.
      if (seenFields.has(part)) return `\\k<${part}>`
      seenFields.add(part)
      return `(?<${part}>[\\s\\S]*?)`
    })
    .join('')
  const match = new RegExp(`^${pattern}$`).exec(page)
  assert.ok(match, 'the published page is not a page of the shipped shell')
  return match.groups
}

/**
 * Prints a page this publisher published into the shell of 0.2.29.0, as a site of that build carries it: the same content under that build's stylesheet and script, and the rail's entry as its link alone.
 *
 * The shell is the file `skills/codebook/reader-shell.html` of the tag v0.2.29.0 (`ae9c1f2`), kept beside this script because a CI checkout holds no tag; both shells have the same fields.
 *
 * @param page - The page as published today.
 * @param shell - The shell the page was rendered from.
 * @param shellOf02290 - The shell of 0.2.29.0.
 * @returns The page in the shell of 0.2.29.0.
 * @throws When the page is no page of `shell`, or the shell of 0.2.29.0 names a field today's shell has not.
 * @example
 * pageInTheShellOf02290(published, shell, shellOf02290).includes('<a href="vscode://…">Open in VS Code</a></p>') // => true
 */
function pageInTheShellOf02290(page, shell, shellOf02290) {
  const values = fieldValuesOf(page, shell)
  // 0.2.29.0 printed the entry as its link alone: no description and nothing beside the link.
  values.OPEN_SOURCE = values.OPEN_SOURCE.replace(
    / aria-describedby="codebook-open-target">Open in VS Code<\/a> <span class="open-target" id="codebook-open-target">.*?<\/span><\/p>/,
    '>Open in VS Code</a></p>',
  )
  return shellOf02290.replace(/\{\{([A-Z_]+)\}\}/g, (field, name) => {
    assert.ok(Object.hasOwn(values, name), `no value for the field ${field}`)
    return values[name]
  })
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
    [LONG_SOURCE.path]: Array.from(
      { length: 130 },
      (_unused, index) => `export const row${index + 1} = ${index + 1}`,
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
    // One page goes back into the shape of a page published before this build: its headings carry the reader's ids themselves, and its rail entry is its link alone, as 0.2.29.0 printed it.
    const publishedBefore = join(
      outputDirectory,
      READER_IDS_PAGE_PUBLISHED_BEFORE,
    )
    await writeFile(
      publishedBefore,
      (await readFile(publishedBefore, 'utf8'))
        .replaceAll('"page-', '"')
        .replaceAll('#page-', '#')
        .replace(
          / aria-describedby="codebook-open-target">Open in VS Code<\/a> <span class="open-target" id="codebook-open-target">.*?<\/span><\/p>/,
          '>Open in VS Code</a></p>',
        ),
    )
    // One page is printed into the shell of 0.2.29.0, so the rules the reader injects are laid out against the stylesheet a site of that build carries.
    const inTheShellOf02290 = join(outputDirectory, PAGE_IN_THE_SHELL_OF_02290)
    await writeFile(
      inTheShellOf02290,
      pageInTheShellOf02290(
        await readFile(inTheShellOf02290, 'utf8'),
        await readFile(
          new URL('../skills/codebook/reader-shell.html', import.meta.url),
          'utf8',
        ),
        await readFile(
          new URL('./fixtures/reader-shell-0.2.29.0.txt', import.meta.url),
          'utf8',
        ),
      ),
    )
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

/** Lays out pages of a served Wiki in real Chrome and measures the right rail, the chapter list, the reading column with its composer and the missing-page line. It adds its cases and the page's errors to the lists of `collected`, which {@link runFlowKeepingCases} answers also when a step throws. It runs in the browser CLI as text, so it uses only its arguments and what it defines itself. @example await check(page, options, { cases: [], errors: [] }) */
async function check(page, options, collected) {
  const { cases } = collected
  const { errors } = collected
  page.on('pageerror', (error) => errors.push(String(error)))
  page.setDefaultTimeout(5_000)
  /** The page of the sample Wiki the steps of a page open, and what the name of a case says of it: the overview as this publisher printed it, then the same content in the shell of 0.2.29.0. The stills of the second page go into a folder of their own. */
  let wikiPage = 'index.html'
  let caseSuffix = ''
  const outputOfTheOverview = options.output
  /** Adds one case; it passed when every named check of it holds. @example record('the rail fits', { height: 216 }, { isShort: true }) */
  const record = (name, actual, checks) =>
    cases.push({
      name: `${name}${caseSuffix}`,
      actual: { ...actual, checks },
      passed: Object.values(checks).every(Boolean),
    })
  /** Makes the check's reader answer one update state from now on: `idle`, `refused` (a start refused because another window appears to be updating) or `conflict` (twelve pages changed by hand); the next page that is opened shows it as a learner's page does. @example await answerUpdateStatus('refused') */
  const answerUpdateStatus = (name) =>
    page.request.get(`${options.updateStatusControl}${name}`)
  /** Opens a page of the served Wiki at one viewport and waits until its script has written the freshness of the changed source; the page of the running pass unless one is named. @example await openWiki(960, 600) */
  const openWiki = async (width, height, pagePath = wikiPage) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${options.url}${pagePath}`)
    await page.waitForFunction(
      () =>
        document.querySelector('[data-codebook-freshness]').textContent ===
        'Source changed · Update available',
    )
  }
  /** Scrolls the part that scrolls around a control until half of the control is out of sight at one of its edges, as after the learner scrolled past it. Half and not all of it: the browser brings a control that is partly in sight back to the nearest edge, and one that is out of sight to the middle. @returns How many pixels of the control's height are out of sight then; fewer than half where the scroller's range ends first. @example await scrollHalfOutOfSight('.output a', 'bottom') // => 7.2 */
  const scrollHalfOutOfSight = (selector, edge) =>
    page.evaluate(
      ([shown, side]) => {
        const element = document.querySelector(shown)
        let scroller = element.parentElement
        while (getComputedStyle(scroller).overflowX === 'visible')
          scroller = scroller.parentElement
        const clipTop =
          scroller.getBoundingClientRect().top + scroller.clientTop
        const clipBottom = clipTop + scroller.clientHeight
        const before = element.getBoundingClientRect()
        const middle = (before.top + before.bottom) / 2
        scroller.scrollTop +=
          middle - (side === 'bottom' ? clipBottom : clipTop)
        const box = element.getBoundingClientRect()
        return (
          Math.round(
            Math.max(box.bottom - clipBottom, clipTop - box.top, 0) * 10,
          ) / 10
        )
      },
      [selector, edge],
    )
  /** Gives one element the keyboard focus the way the Tab key does, so `:focus-visible` holds for it: the script focuses it, Shift+Tab leaves it and Tab comes back. With an edge the element is scrolled half out of sight at that edge before the Tab key comes back to it, so the browser scrolls it back as it does for a learner. @returns How many pixels of the element were out of sight before the Tab key reached it; null without an edge. @example await focusWithKeyboard('.open-in-editor a') // => null */
  const focusWithKeyboard = async (selector, edge) => {
    await page.evaluate(
      (focused) => document.querySelector(focused).focus(),
      selector,
    )
    await page.keyboard.press('Shift+Tab')
    const outOfSightPx = edge
      ? await scrollHalfOutOfSight(selector, edge)
      : null
    await page.keyboard.press('Tab')
    return outOfSightPx
  }
  /** Reads where the focus ring of an element lies against the box its nearest scrolling ancestor clips at, on all four sides. The ring reaches the outline's offset plus its width outside the element; a reach of zero is a ring inside it. @example await focusRing('.outline a') // => { isFocusedByKeyboard: true, reachPx: 0, leftInsideClipPx: 0, rightInsideClipPx: 12, topInsideClipPx: 40, bottomInsideClipPx: 300, … } */
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
      const scrollerBox = scroller.getBoundingClientRect()
      const scrollerStyle = getComputedStyle(scroller)
      const borderOf = (side) =>
        Number.parseFloat(scrollerStyle[`border${side}Width`])
      // The scroller clips at its padding box, less a scrollbar that takes room. The rounded layout sizes differ by whole pixels, so their difference is the bar exactly, and the edges keep their fractions.
      const barAtTheRight =
        scroller.offsetWidth -
        scroller.clientWidth -
        borderOf('Left') -
        borderOf('Right')
      const barAtTheBottom =
        scroller.offsetHeight -
        scroller.clientHeight -
        borderOf('Top') -
        borderOf('Bottom')
      return {
        isFocusedByKeyboard:
          document.activeElement === element &&
          element.matches(':focus-visible'),
        outlineOffset: style.outlineOffset,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        scroller: scroller.className || scroller.tagName,
        reachPx,
        leftInsideClipPx: tenths(
          box.left - reachPx - (scrollerBox.left + borderOf('Left')),
        ),
        rightInsideClipPx: tenths(
          scrollerBox.right -
            borderOf('Right') -
            barAtTheRight -
            (box.right + reachPx),
        ),
        topInsideClipPx: tenths(
          box.top - reachPx - (scrollerBox.top + borderOf('Top')),
        ),
        bottomInsideClipPx: tenths(
          scrollerBox.bottom -
            borderOf('Bottom') -
            barAtTheBottom -
            (box.bottom + reachPx),
        ),
      }
    }, selector)
  /** Reads the open control of the right rail and the row around it: the entry's text, its link and what describes the link, the lines and widths of its label, its target and the line number that ends the target, and the widths of the update panel, the outline and the output block. @example (await measureEntry()).labelLines // => 1 */
  const measureEntry = () =>
    page.evaluate(() => {
      const textOf = (node) => {
        const text = document.createRange()
        text.selectNodeContents(node)
        return text
      }
      // A range answers one box or more per line of its text, and the boxes of one line share their top.
      const lineCount = (text) =>
        new Set([...text.getClientRects()].map((box) => Math.round(box.top)))
          .size
      const tenths = (pixels) => Math.round(pixels * 10) / 10
      const widthOf = (boxed) => tenths(boxed.getBoundingClientRect().width)
      const entry = document.querySelector('.open-in-editor')
      const link = entry.querySelector('a')
      const target = entry.querySelector('.open-target')
      // The colon and the line number end the target's last piece of text.
      const lastPiece = target.lastChild
      const lineNumber = document.createRange()
      lineNumber.setStart(lastPiece, lastPiece.data.lastIndexOf(':'))
      lineNumber.setEnd(lastPiece, lastPiece.data.length)
      const rail = document.querySelector('.right-rail')
      const output = rail.querySelector('.output')
      const chapters = document.querySelector('.chapters')
      return {
        railDisplay: getComputedStyle(rail).display,
        entryText: entry.textContent,
        linkText: link.textContent,
        linkDescription:
          document.getElementById(link.getAttribute('aria-describedby'))
            ?.textContent ?? null,
        labelLines: lineCount(textOf(link)),
        labelLineWidth: widthOf(textOf(link)),
        targetLines: lineCount(textOf(target)),
        targetWidth: widthOf(target),
        lineNumberText: lineNumber.toString(),
        lineNumberLines: lineCount(lineNumber),
        controlWidth: widthOf(entry),
        outlineWidth: widthOf(rail.querySelector('nav')),
        panelWidth: widthOf(
          document.querySelector('[data-codebook-update-group]'),
        ),
        outputWidth: widthOf(output),
        outputLabelLines: lineCount(textOf(output.querySelector('p'))),
        changeLocationLines: lineCount(textOf(output.querySelector('a'))),
        outputRightBeyondRailPx: tenths(
          output.getBoundingClientRect().right -
            rail.getBoundingClientRect().right,
        ),
        railClientWidth: rail.clientWidth,
        railScrollWidth: rail.scrollWidth,
        chaptersClientWidth: chapters.clientWidth,
        chaptersScrollWidth: chapters.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      }
    })
  /** Reads the rail's parts against the rail's own box, and what the update panel says: its state, its sentence, its output line and the summary of its detail; the detail's sizes are null while the panel has none. @example (await measureRail()).rail.height // => 200.1 */
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
      const textOf = (element) => (element ? element.textContent : null)
      const status = document.querySelector('[data-codebook-update-status]')
      return {
        railDisplay: getComputedStyle(rail).display,
        statusState: status.getAttribute('data-state'),
        statusText: status.textContent,
        outputLine: textOf(
          document.querySelector('[data-codebook-update-output]'),
        ),
        detailSummary: textOf(detail && detail.querySelector('summary')),
        isDetailOpen: detail !== null && detail.open,
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

  /** Reads where the parts of the reading column stand, with the article, the composer and an answer scrolled to their starts and no control focused, so two readings compare. The composer's content box is its box inside its border and its padding. @example (await readingColumnBoxes()).questionField // => [271.2, 601.39, 566.05, 40] */
  const readingColumnBoxes = () =>
    page.evaluate(() => {
      document.activeElement.blur()
      for (const scrolled of ['.wiki-article', '.composer', '.qa-answer'])
        document.querySelector(scrolled).scrollTop = 0
      const hundredths = (pixels) => Math.round(pixels * 100) / 100
      const boxOf = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect()
        return [box.left, box.top, box.width, box.height].map(hundredths)
      }
      const article = document.querySelector('.wiki-article')
      const composer = document.querySelector('.composer')
      const composerBox = composer.getBoundingClientRect()
      const style = getComputedStyle(composer)
      const padding = ['Left', 'Top', 'Right', 'Bottom'].map((side) =>
        Number.parseFloat(style[`padding${side}`]),
      )
      return {
        articlePaddingLeft: getComputedStyle(article).paddingLeft,
        composerPaddingLeft: style.paddingLeft,
        isComposerScrolling: composer.scrollHeight > composer.clientHeight,
        boxes: {
          title: boxOf('.wiki-article h1'),
          sourceFiles: boxOf('.source-files'),
          firstParagraph: boxOf('.wiki-article p'),
          questionField: boxOf('#qa-input'),
          askCodebook: boxOf('#qa-form button[type=submit]'),
          answer: boxOf('.qa-answer'),
          connection: boxOf('.connection'),
          composerContent: [
            composerBox.left + composer.clientLeft + padding[0],
            composerBox.top + composer.clientTop + padding[1],
            composer.clientWidth - padding[0] - padding[2],
            composer.clientHeight - padding[1] - padding[3],
          ].map(hundredths),
        },
      }
    })
  /** Counts the pixels in which two stills of the same size differ by more than the rounding of an anti-aliased corner (8 of 255 levels in one colour channel; the faintest line of the page, its border colour on its background, differs by 32). The page decodes the stills, so the check needs no image library. @example await pictureDifference(first, second) // => { width: 692, height: 86, otherWidth: 692, otherHeight: 86, differentPixels: 0, largestDifference: 2, isDrawnTheSame: true } */
  const pictureDifference = (first, second) =>
    page.evaluate(
      async (pictures) => {
        const pixelsOf = async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (character) =>
            character.charCodeAt(0),
          )
          const bitmap = await createImageBitmap(
            new Blob([bytes], { type: 'image/png' }),
          )
          const context = new OffscreenCanvas(
            bitmap.width,
            bitmap.height,
          ).getContext('2d')
          context.drawImage(bitmap, 0, 0)
          return context.getImageData(0, 0, bitmap.width, bitmap.height)
        }
        const [one, other] = [
          await pixelsOf(pictures[0]),
          await pixelsOf(pictures[1]),
        ]
        let differentPixels = 0
        let largestDifference = 0
        for (let index = 0; index < one.data.length; index += 4) {
          const difference = Math.max(
            Math.abs(one.data[index] - other.data[index]),
            Math.abs(one.data[index + 1] - other.data[index + 1]),
            Math.abs(one.data[index + 2] - other.data[index + 2]),
          )
          largestDifference = Math.max(largestDifference, difference)
          if (difference > 8) differentPixels += 1
        }
        return {
          width: one.width,
          height: one.height,
          otherWidth: other.width,
          otherHeight: other.height,
          differentPixels,
          largestDifference,
          // Stills of two sizes share no pixel grid, so only stills of one size can be drawn the same.
          isDrawnTheSame:
            one.data.length === other.data.length && differentPixels === 0,
        }
      },
      [first.toString('base64'), second.toString('base64')],
    )
  /** Reads the reading column twice, as served and with a style that takes the room for the focus rings back (the paddings, margins, top border and height limit the article and the composer had before they kept that room), and takes two stills each time: the composer with its top border and 12 px around it, and the article from its content edge. The strip of room at the article's left is not in its still: ink the article cut at its edge before (the fringe of a glyph) may show there now. @example (await withAndWithoutRoom('wiki-reading-1200')).composerPicture.differentPixels // => 0 */
  const withAndWithoutRoom = async (still) => {
    const asServed = await readingColumnBoxes()
    const clips = await page.evaluate(() => {
      const boxOf = (selector) =>
        document.querySelector(selector).getBoundingClientRect()
      const column = boxOf('.reading-column')
      const contentLeft = Math.ceil(boxOf('.wiki-article h1').left)
      const composerTop = Math.floor(boxOf('.composer').top) - 2
      return {
        article: {
          x: contentLeft,
          y: Math.floor(column.top),
          width: Math.ceil(column.right) + 12 - contentLeft,
          height: composerTop - Math.floor(column.top),
        },
        composer: {
          x: Math.floor(column.left) - 12,
          y: composerTop,
          width: Math.ceil(column.width) + 24,
          height: Math.ceil(column.bottom) + 12 - composerTop,
        },
      }
    })
    const picturesOf = async (suffix) => ({
      article: await page.screenshot({
        clip: clips.article,
        path: `${options.output}/${still}-article${suffix}.png`,
      }),
      composer: await page.screenshot({
        clip: clips.composer,
        path: `${options.output}/${still}-composer${suffix}.png`,
      }),
    })
    const picturesAsServed = await picturesOf('')
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.setAttribute('data-check-room-taken-back', '')
      style.textContent =
        '.wiki-article{padding-left:0;margin-left:0}.composer{border-image:none;padding:.6rem 0 0;margin:0;max-height:34%}'
      document.head.append(style)
    })
    const withoutRoom = await readingColumnBoxes()
    const picturesWithoutRoom = await picturesOf('-without-room')
    await page.evaluate(() =>
      document.querySelector('[data-check-room-taken-back]').remove(),
    )
    return {
      asServed,
      withoutRoom,
      articlePicture: await pictureDifference(
        picturesAsServed.article,
        picturesWithoutRoom.article,
      ),
      composerPicture: await pictureDifference(
        picturesAsServed.composer,
        picturesWithoutRoom.composer,
      ),
    }
  }
  /** Focuses each named control with the keyboard and reads its ring against the part that scrolls around it. A control named with an edge is first scrolled half out of sight at that edge. @example (await ringsOf([['questionField', '#qa-input']], 'wiki-reading-focus-1200')).questionField.leftInsideClipPx // => 0 */
  const ringsOf = async (controls, still) => {
    const rings = {}
    for (const [name, selector, edge] of controls) {
      const outOfSightPx = await focusWithKeyboard(selector, edge)
      rings[name] = { ...(await focusRing(selector)), outOfSightPx }
      await page.screenshot({
        path: `${options.output}/${still}-${name}.png`,
      })
    }
    return rings
  }
  /** Measures the reading column of the page that is open: the room for the focus rings against a reading without it, at rest and with an answer, and the ring of every control a learner reaches there with the Tab key. The question is typed and asked as a learner asks it, and the reader answers it. @example (await measureReadingColumn('1200')).rings.questionField.leftInsideClipPx // => 0 */
  const measureReadingColumn = async (width) => {
    const atRest = await withAndWithoutRoom(`wiki-reading-${width}`)
    const ringsAtRest = await ringsOf(
      [
        ['sourceFiles', '.source-files > summary'],
        ['articleLink', '.wiki-article p a'],
        ['articleLinkScrolledToTheBottom', '#part-9 + p a', 'bottom'],
        ['questionField', '#qa-input'],
        ['askCodebook', '#qa-form button[type=submit]'],
        ['connection', '.connection > summary'],
      ],
      `wiki-reading-focus-${width}`,
    )
    await page.fill('#qa-input', options.question)
    await page.click('#qa-form button[type=submit]')
    await page.waitForSelector('.qa-answer a')
    await page.mouse.move(0, 0)
    const ringsWithAnAnswer = await ringsOf(
      [
        ['answerSummary', '#qa-response > summary'],
        ['answer', '.qa-answer'],
        ['answerCitation', '.qa-answer a'],
        ['connectionScrolledToTheBottom', '.connection > summary', 'bottom'],
        ['askCodebookScrolledToTheTop', '#qa-form button[type=submit]', 'top'],
      ],
      `wiki-reading-focus-${width}`,
    )
    const withAnAnswer = await withAndWithoutRoom(
      `wiki-reading-answer-${width}`,
    )
    return {
      room: { atRest, withAnAnswer },
      rings: { ...ringsAtRest, ...ringsWithAnAnswer },
    }
  }
  /** The checks of the room for the focus rings: it is there, and every part stands, and at rest is drawn, as without it. A scrollbar of the composer stands 5 px further right with the room, so with an answer the boxes are compared and not the stills. @example roomChecks(measured.room).isComposerDrawnTheSameAtRest // => true */
  const roomChecks = ({ atRest, withAnAnswer }) => ({
    doesArticleKeepRoom: atRest.asServed.articlePaddingLeft === '5px',
    doesComposerKeepRoom: atRest.asServed.composerPaddingLeft === '5px',
    isArticleRoomTakenBackForTheComparison:
      atRest.withoutRoom.articlePaddingLeft === '0px',
    isComposerRoomTakenBackForTheComparison:
      atRest.withoutRoom.composerPaddingLeft === '0px',
    doesEveryPartStandTheSameAtRest:
      JSON.stringify(atRest.asServed.boxes) ===
      JSON.stringify(atRest.withoutRoom.boxes),
    isArticleDrawnTheSameAtRest: atRest.articlePicture.isDrawnTheSame,
    isComposerDrawnTheSameAtRest: atRest.composerPicture.isDrawnTheSame,
    doesTheAnswerMakeTheComposerScroll:
      withAnAnswer.asServed.isComposerScrolling,
    doesTheAnswerMakeTheComposerScrollWithoutRoom:
      withAnAnswer.withoutRoom.isComposerScrolling,
    doesEveryPartStandTheSameWithAnAnswer:
      JSON.stringify(withAnAnswer.asServed.boxes) ===
      JSON.stringify(withAnAnswer.withoutRoom.boxes),
  })
  /** The checks of a set of focus rings: each control has the keyboard focus and no side of its ring lies outside the part that scrolls around it. @example ringChecks({ questionField: ring }).questionFieldRingLeftIsInside // => true */
  const ringChecks = (rings) =>
    Object.fromEntries(
      Object.entries(rings).flatMap(([name, ring]) => [
        [`${name}IsFocusedByKeyboard`, ring.isFocusedByKeyboard],
        [`${name}RingLeftIsInside`, ring.leftInsideClipPx >= 0],
        [`${name}RingRightIsInside`, ring.rightInsideClipPx >= 0],
        [`${name}RingTopIsInside`, ring.topInsideClipPx >= 0],
        [`${name}RingBottomIsInside`, ring.bottomInsideClipPx >= 0],
        // A control that was to be scrolled half out of sight was partly out of sight before the keyboard reached it.
        ...(ring.outOfSightPx === null
          ? []
          : [[`${name}WasPartlyOutOfSight`, ring.outOfSightPx > 0]]),
      ]),
    )

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
      'in the Wiki reader at 720 px the open control of the right rail keeps its label on one line, its target wraps under the label without widening the control and keeps its line number whole, the outline is no narrower than the control and at least 160 px wide, and the output block keeps Change location on one line',
      entry,
      {
        isRow: entry.railDisplay === 'flex',
        isLabelOnOneLine: entry.labelLines === 1,
        doesTargetWrap: entry.targetLines >= 2,
        // Half a pixel of rounding between the label's text and the block around it.
        isTargetNoWiderThanLabel:
          entry.targetWidth <= entry.labelLineWidth + 0.5,
        isLineNumberWhole:
          entry.lineNumberText === ':95' && entry.lineNumberLines === 1,
        isOutlineNoNarrowerThanControl:
          entry.outlineWidth >= entry.controlWidth,
        isOutlineWideEnough: entry.outlineWidth >= 160,
        isOutputLabelOnOneLine: entry.outputLabelLines === 1,
        isChangeLocationOnOneLine: entry.changeLocationLines === 1,
        isRowInsideTheRail: entry.outputRightBeyondRailPx <= 0.5,
      },
    )
  }
  const measureNarrowestRow = async () => {
    // Arrange: the overview at 701 px, the narrowest window whose right rail is a row.
    await openWiki(701, 720)
    // Act
    const entry = await measureEntry()
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-rail-row-701.png` })
    // Assert
    record(
      'in the Wiki reader at 701 px, the narrowest window whose right rail is a row, the output block keeps Change location on one line, the outline is at least 160 px wide, the open control keeps its label on one line, and the row ends inside the rail and the page',
      entry,
      {
        isRow: entry.railDisplay === 'flex',
        isOutputLabelOnOneLine: entry.outputLabelLines === 1,
        isChangeLocationOnOneLine: entry.changeLocationLines === 1,
        isOutlineWideEnough: entry.outlineWidth >= 160,
        isLabelOnOneLine: entry.labelLines === 1,
        isRowInsideTheRail: entry.outputRightBeyondRailPx <= 0.5,
        hasPageNoSidewaysScroll: entry.pageScrollWidth <= entry.pageClientWidth,
      },
    )
  }
  const measureReadingColumnInRow = async () => {
    // Arrange: the overview at 720 px again, where the article and the composer scroll beside the chapter list. Act: the reading column is read with and without its room for focus rings, each control is focused with the keyboard, and a question is asked in between.
    await openWiki(720, 720)
    const measured = await measureReadingColumn('720')
    // Assert
    record(
      'in the Wiki reader at 720 px the room the article and the composer keep for focus rings moves nothing: every part of the reading column stands where it stands without the room, at rest it is drawn the same, and an open answer leaves it so',
      measured.room,
      roomChecks(measured.room),
    )
    record(
      'in the Wiki reader at 720 px the keyboard focus ring of every control of the article and the composer is whole, also of one the keyboard scrolled back from the edge: Relevant source files, a link of the article, the question field, Ask Codebook, the answer with its summary and its citation, and the connection line',
      measured.rings,
      ringChecks(measured.rings),
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
      'in the Wiki reader at 1200 px the open control names the file and the line it opens under a link that holds the label alone and is described by them, keeps the colon and the line number on one line, and is no wider than the right rail, and neither the rail nor the chapter list scrolls sideways for an entry that cannot break',
      entry,
      {
        isColumn: entry.railDisplay === 'block',
        doesTextNameTheTarget: entry.entryText === options.expectedEntryText,
        doesLinkHoldTheLabelAlone: entry.linkText === 'Open in VS Code',
        isLinkDescribedByTheTarget:
          entry.linkDescription === options.expectedTargetText,
        isLabelOnOneLine: entry.labelLines === 1,
        isLineNumberWhole:
          entry.lineNumberText === ':95' && entry.lineNumberLines === 1,
        isControlInsideRail: entry.controlWidth <= entry.railClientWidth,
        hasRailNoSidewaysScroll: entry.railScrollWidth <= entry.railClientWidth,
        hasChapterListNoSidewaysScroll:
          entry.chaptersScrollWidth <= entry.chaptersClientWidth,
      },
    )
  }
  const measureEntryStates = async () => {
    // Arrange: still 1200 px, the pointer away from the entry.
    const readEntry = () =>
      page.evaluate(() => {
        const style = getComputedStyle(
          document.querySelector('.open-in-editor'),
        )
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          filter: style.filter,
          transition: style.transitionDuration,
        }
      })
    await page.mouse.move(0, 0)
    const atRest = await readEntry()
    // Act: the pointer rests on the label, then on the target under it, where a press follows; the click is caught before it opens the editor's address.
    await page.hover('.open-in-editor a')
    const underPointerOnLabel = await readEntry()
    const targetCentre = await page.evaluate(() => {
      const box = document.querySelector('.open-target').getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    await page.mouse.move(targetCentre.x, targetCentre.y)
    const underPointerOnTarget = await readEntry()
    const isLinkUnderPointerOnTarget = await page.evaluate(
      (point) =>
        document.elementFromPoint(point.x, point.y) ===
        document.querySelector('.open-in-editor a'),
      targetCentre,
    )
    await page.evaluate(() => {
      window.entryClick = { isOnLink: false, address: '' }
      document.addEventListener(
        'click',
        (event) => {
          event.preventDefault()
          window.entryClick = {
            isOnLink:
              event.target === document.querySelector('.open-in-editor a'),
            // An element that is no link has no address.
            address: event.target.getAttribute('href') ?? '',
          }
        },
        { capture: true, once: true },
      )
    })
    await page.mouse.down()
    const pressedOnTarget = await readEntry()
    await page.mouse.up()
    const click = await page.evaluate(() => window.entryClick)
    // Act: the keyboard focuses the entry's link, in the light and the dark theme.
    await page.mouse.move(0, 0)
    await focusWithKeyboard('.open-in-editor a')
    const ring = await page.evaluate(() => {
      const entry = document.querySelector('.open-in-editor')
      const link = entry.querySelector('a')
      const drawn = getComputedStyle(link, '::after')
      const entryBox = entry.getBoundingClientRect()
      return {
        isFocusedByKeyboard:
          document.activeElement === link && link.matches(':focus-visible'),
        linkOutlineStyle: getComputedStyle(link).outlineStyle,
        outlineOffset: drawn.outlineOffset,
        outlineWidth: drawn.outlineWidth,
        outlineStyle: drawn.outlineStyle,
        entryWidth: entryBox.width,
        entryHeight: entryBox.height,
        // The ring's box covers the block with its border.
        ringBoxWiderPx: Number.parseFloat(drawn.width) - entryBox.width,
        ringBoxHigherPx: Number.parseFloat(drawn.height) - entryBox.height,
      }
    })
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
    // Assert: the light theme's border at rest, its second panel colour and link colour under the pointer, a darker block while pressed, and a ring that lies inside the whole block.
    record(
      'the open control of the right rail answers the pointer on its label and on its target with a fill and a link-coloured border, without a transition, darkens while pressed, follows its link from a press on the target, and its keyboard focus ring lies inside the whole block',
      {
        atRest,
        underPointerOnLabel,
        underPointerOnTarget,
        isLinkUnderPointerOnTarget,
        pressedOnTarget,
        click,
        ring,
      },
      {
        hasNoFillAtRest: atRest.background === 'rgba(0, 0, 0, 0)',
        hasBorderAtRest: atRest.border === 'rgb(216, 213, 207)',
        isFilledUnderPointer:
          underPointerOnLabel.background === 'rgb(239, 238, 236)',
        isBorderedUnderPointer:
          underPointerOnLabel.border === 'rgb(24, 91, 147)',
        hasNoTransition: underPointerOnLabel.transition === '0s',
        isFilledUnderPointerOnTarget:
          underPointerOnTarget.background === 'rgb(239, 238, 236)',
        isBorderedUnderPointerOnTarget:
          underPointerOnTarget.border === 'rgb(24, 91, 147)',
        isLinkUnderPointerOnTarget,
        isDarkenedWhilePressed: pressedOnTarget.filter === 'brightness(0.9)',
        isFilledWhilePressed:
          pressedOnTarget.background === 'rgb(239, 238, 236)',
        isPressOnTargetAClickOnTheLink: click.isOnLink,
        doesClickedLinkOpenASource: click.address.startsWith(
          'vscode://laststance.codebook/source?',
        ),
        doesClickedLinkNameTheTarget: click.address.includes(
          '&path=extension%2Fsrc%2FruntimeSupport%2Futils%2FremoveAbandonedProfiles.ts&line=95&',
        ),
        isFocusedByKeyboard: ring.isFocusedByKeyboard,
        hasLinkNoRingOfItsOwn: ring.linkOutlineStyle === 'none',
        isRingOffsetInside: ring.outlineOffset === '-2px',
        isRingTwoPixels: ring.outlineWidth === '2px',
        isRingSolid: ring.outlineStyle === 'solid',
        // Half a pixel of rounding between the block and the ring's box.
        isRingAsWideAsTheBlock: Math.abs(ring.ringBoxWiderPx) <= 0.5,
        isRingAsHighAsTheBlock: Math.abs(ring.ringBoxHigherPx) <= 0.5,
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
  const measureRingsAtRailEdges = async () => {
    // Arrange: still 1200 px, where the outline of forty entries makes the rail scroll. Act: the link at the rail's end and the button at its start are each scrolled half out of sight, and the keyboard focuses them.
    const rings = await ringsOf(
      [
        ['changeLocationScrolledToTheBottom', '.output a', 'bottom'],
        ['updateButtonScrolledToTheTop', '.wiki-update', 'top'],
      ],
      'wiki-focus-1200',
    )
    // Assert
    record(
      'in the Wiki reader at 1200 px a control of the right rail that the keyboard scrolls back from the upper or the lower edge keeps its whole focus ring: Update LLM Wiki and Change location',
      rings,
      ringChecks(rings),
    )
  }
  const measureReadingColumnInColumns = async () => {
    // Arrange: the overview at 1200 px again, where the article and the composer scroll between the chapter list and the rail. Act: the reading column is read with and without its room for focus rings, each control is focused with the keyboard, and a question is asked in between.
    await openWiki(1200, 720)
    const measured = await measureReadingColumn('1200')
    // Assert
    record(
      'in the Wiki reader at 1200 px the room the article and the composer keep for focus rings moves nothing: every part of the reading column stands where it stands without the room, at rest it is drawn the same, and an open answer leaves it so',
      measured.room,
      roomChecks(measured.room),
    )
    record(
      'in the Wiki reader at 1200 px the keyboard focus ring of every control of the article and the composer is whole, also of one the keyboard scrolled back from the edge: Relevant source files, a link of the article, the question field, Ask Codebook, the answer with its summary and its citation, and the connection line',
      measured.rings,
      ringChecks(measured.rings),
    )
  }
  const measureAnswerRing = async () => {
    // Arrange: still 1200 px with the answer of the question open. Act: the keyboard focuses the answer, which is a region of its own in the tab order.
    await focusWithKeyboard('.qa-answer')
    const ring = await focusRing('.qa-answer')
    await page.screenshot({
      path: `${options.output}/wiki-focus-answer-1200.png`,
    })
    // Assert: the ring of every other control of the page, in the light theme's link colour, and no side of it outside the composer.
    record(
      'in the Wiki reader at 1200 px the answer of a question has the reader’s own keyboard focus ring, 2 px in the link colour and 3 px outside it, whole inside the composer that scrolls',
      ring,
      {
        isFocusedByKeyboard: ring.isFocusedByKeyboard,
        isRingSolid: ring.outlineStyle === 'solid',
        isRingTwoPixels: ring.outlineWidth === '2px',
        isRingThreePixelsOutside: ring.outlineOffset === '3px',
        isRingInTheLinkColour: ring.outlineColor === 'rgb(24, 91, 147)',
        isComposerTheScroller: ring.scroller === 'composer',
        isRingLeftInside: ring.leftInsideClipPx >= 0,
        isRingRightInside: ring.rightInsideClipPx >= 0,
        isRingTopInside: ring.topInsideClipPx >= 0,
        isRingBottomInside: ring.bottomInsideClipPx >= 0,
      },
    )
  }
  const measureRailWithRefusal = async () => {
    // Arrange: the check's reader answers a refused start, the state the owned clone's native check W-3 met. Act: the page is loaded at 960 x 600 and words that state itself, with its output line.
    await answerUpdateStatus('refused')
    await openWiki(960, 600)
    await page.waitForSelector(
      '[data-codebook-update-status][data-state=failed]',
    )
    const measured = await measureRail()
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-rail-refusal-960x600.png` })
    // Assert
    record(
      'in the Wiki reader at 960 x 600 the right rail is at most 45vh high and shows the whole sentence of a refused update and its output line without a scrollbar, while a long outline scrolls inside 160 px',
      measured,
      {
        ...railChecks(measured),
        isSentenceOfTheRefusal:
          measured.statusText.startsWith('Update failed at '),
        doesSentenceSayWhatIsKept: measured.statusText.endsWith(
          'choose Update anyway in the editor’s notification. The last usable site is kept.',
        ),
        doesPanelNameTheOutput:
          measured.outputLine === 'Output: .codebook/wiki',
        isRailAtMost45vh:
          measured.rail.height <= measured.viewportHeight * 0.45,
      },
    )
  }
  const measureRailWithOpenDetail = async () => {
    // Arrange: the check's reader answers a conflict of twelve pages changed by hand, and the page is loaded at 960 x 600. Act: a press opens the list of the files.
    await answerUpdateStatus('conflict')
    await openWiki(960, 600)
    await page.waitForSelector(
      '[data-codebook-update-status][data-state=conflict]',
    )
    const beforeThePress = await measureRail()
    await page.click('[data-codebook-update-detail] > summary')
    const measured = await measureRail()
    await page.screenshot({
      path: `${options.output}/wiki-page-conflict-detail-960x600.png`,
    })
    // Assert: the page as it shows the conflict keeps the bound of 45vh and the article's room. With the list open the rail is higher than 45vh: its height is recorded here and reported with the row (132), not asserted; what is asserted of the open list is what bounds it: 84 px, scrolling inside, and no more than that added to the rail.
    record(
      'in the Wiki reader at 960 x 600 the page of a conflict of twelve files shows its whole sentence and its output line in a rail of at most 45vh, and the list of the files, opened by a press, scrolls inside 84 px (14vh) and adds no more than that to the rail',
      { beforeThePress, measured },
      {
        ...railChecks(beforeThePress),
        isSentenceOfTheConflict: beforeThePress.statusText.startsWith(
          'Update not started (',
        ),
        doesSentenceNameThreeFilesAndCountTheRest:
          beforeThePress.statusText.includes(
            'pages/reference/changed-by-hand-3.html and 9 more',
          ),
        doesPanelNameTheOutput:
          beforeThePress.outputLine === 'Output: .codebook/wiki',
        doesDetailOfferEveryFile:
          beforeThePress.detailSummary === 'Show all 12 files',
        isDetailClosedBeforeThePress: !beforeThePress.isDetailOpen,
        isRailAtMost45vhBeforeThePress:
          beforeThePress.rail.height <= beforeThePress.viewportHeight * 0.45,
        isDetailOpenedByThePress: measured.isDetailOpen,
        isDetailAtMost84: measured.detail.height <= 84,
        doesDetailScrollInside:
          measured.detail.scrollHeight > measured.detail.clientHeight,
        doesTheOpenListAddAtMost84:
          measured.rail.height - beforeThePress.rail.height <= 84,
        hasRailNoScrollWithTheList:
          measured.rail.scrollHeight <= measured.rail.clientHeight,
        isPanelInsideRailWithTheList: measured.panelBottomBelowRailBottom <= 0,
        isSentenceWholeWithTheList:
          measured.status.scrollHeight <= measured.status.clientHeight,
      },
    )
  }
  const measureDetailSummaryRingInRow = async () => {
    // Arrange: still 960 px with the open detail, which scrolls there. Act: the keyboard focuses the detail's summary.
    await focusWithKeyboard('[data-codebook-update-detail] > summary')
    const ring = await focusRing('[data-codebook-update-detail] > summary')
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-focus-detail-960.png` })
    // Assert
    record(
      'in the Wiki reader at 960 px the keyboard focus ring of the summary of an open update detail lies inside the detail that scrolls',
      ring,
      {
        isFocusedByKeyboard: ring.isFocusedByKeyboard,
        isDetailTheScroller: ring.scroller === 'DETAILS',
        isRingLeftInside: ring.leftInsideClipPx >= 0,
        isRingRightInside: ring.rightInsideClipPx >= 0,
        isRingTopInside: ring.topInsideClipPx >= 0,
        isRingBottomInside: ring.bottomInsideClipPx >= 0,
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
  const measureLongTargetInRow = async () => {
    // Arrange: a page whose rail entry names a path of about 200 characters, at 960 x 600, with no update result in the panel.
    await openWiki(960, 600, options.longSourcePage)
    /** Reads the entry and the rail as they stand: how high the rail and the entry are, how much of the target shows, and whether the pointer rests on the entry. */
    const readEntry = () =>
      page.evaluate(() => {
        const tenths = (pixels) => Math.round(pixels * 10) / 10
        const entry = document.querySelector('.open-in-editor')
        const target = entry.querySelector('.open-target')
        return {
          railHeight: tenths(
            document.querySelector('.right-rail').getBoundingClientRect()
              .height,
          ),
          entryHeight: tenths(entry.getBoundingClientRect().height),
          targetHeight: tenths(target.getBoundingClientRect().height),
          targetContentHeight: target.scrollHeight,
          isTargetShownWhole: target.scrollHeight <= target.clientHeight,
          isPointerOnTheEntry: entry.matches(':hover'),
          viewportHeight: window.innerHeight,
        }
      })
    // Act: the page at rest, then the pointer on the entry, then the keyboard focus on its link.
    await page.mouse.move(0, 0)
    const atRest = await readEntry()
    const description = await page.evaluate(() => {
      const link = document.querySelector('.open-in-editor a')
      const described = document.getElementById(
        link.getAttribute('aria-describedby'),
      )
      return described ? described.textContent : null
    })
    await page
      .locator('.right-rail')
      .screenshot({ path: `${options.output}/wiki-rail-long-target-960.png` })
    await page.hover('.open-in-editor a')
    const underPointer = await readEntry()
    await page.mouse.move(0, 0)
    await focusWithKeyboard('.open-in-editor a')
    const withKeyboardFocus = await readEntry()
    await page.locator('.right-rail').screenshot({
      path: `${options.output}/wiki-rail-long-target-focus-960.png`,
    })
    // Assert: eight lines of the target's 17.4 px are 139.2 px.
    record(
      'in the Wiki reader at 960 x 600 the rail entry of a source whose path is about 200 characters long shows eight lines of the path at rest, so the rail stays at most 45vh high, describes its link by the whole path, and shows the whole path while the pointer rests on it or its link has the keyboard focus',
      { atRest, description, underPointer, withKeyboardFocus },
      {
        isRailAtMost45vhAtRest:
          atRest.railHeight <= atRest.viewportHeight * 0.45,
        isTargetAtMostEightLinesAtRest: atRest.targetHeight <= 139.2,
        isTargetCutAtRest: !atRest.isTargetShownWhole,
        isLinkDescribedByTheWholePath:
          description === options.expectedLongTargetText,
        isTargetWholeUnderPointer: underPointer.isTargetShownWhole,
        doesPointerStayOnTheEntry: underPointer.isPointerOnTheEntry,
        isTargetWholeWithKeyboardFocus: withKeyboardFocus.isTargetShownWhole,
      },
    )
  }
  const measureSingleColumn = async () => {
    // Arrange: the check's reader answers no update result again; the overview at 640 px, the single column, with an open detail in its panel. Act: the rail's rules are read.
    await answerUpdateStatus('idle')
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
        outputMinWidth: styleOf('.right-rail .output').minWidth,
        composerMaxHeight: styleOf('.composer').maxHeight,
        composerPaddingBottom: styleOf('.composer').paddingBottom,
        composerMarginBottom: styleOf('.composer').marginBottom,
      }
    })
    // Assert
    record(
      'in the Wiki reader at 640 px the single column keeps its rail and its composer as before: no cap on the rail, the outline or an open detail, the open control has its margin, the output block may shrink, and the composer has no height limit and its own bottom padding',
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
        hasOutputNoMinimumWidth: column.outputMinWidth === '0px',
        hasComposerNoHeightLimit: column.composerMaxHeight === 'none',
        hasComposerItsBottomPadding: column.composerPaddingBottom === '9.6px',
        hasComposerNoBottomMargin: column.composerMarginBottom === '0px',
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
  /** Uses one of the two pages whose headings carry the reader's ids as a learner does (an outline entry, the theme button, a question) and reads what the reader's own elements are then: how often each id stands in the page, where the outline entry led, whether the answer shows, what labels the question field, what describes the rail entry's link, and the ids the reader gave its status region and its entry's target. @example (await useReaderOn('pages/reader-ids.html')).idCounts['qa-form'] // => 1 */
  const useReaderOn = async (pagePath) => {
    await page.setViewportSize({ width: 1200, height: 720 })
    await page.goto(`${options.url}${pagePath}`)
    await page.waitForFunction(
      () =>
        document.querySelector('[data-codebook-freshness]').textContent ===
        'Source changed · Update available',
    )
    await page.click('.outline a:text-is("Section qa-form")')
    const afterTheOutlineEntry = await page.evaluate(() => {
      const target = document.querySelector(':target')
      return {
        fragment: location.hash,
        targetTag: target ? target.tagName : null,
        targetText: target ? target.textContent : null,
      }
    })
    await page.click('button#theme-toggle')
    const themeAfterTheButton = await page.evaluate(
      () => document.documentElement.dataset.theme ?? null,
    )
    await page.click('button#theme-toggle')
    await page.fill('.composer textarea', options.question)
    await page.click('.composer button[type=submit]')
    // The answer's citation is in the page once the reader answered; a page that lost its form to a heading is read as it stands after two seconds.
    await page
      .waitForSelector('.qa-answer a', { state: 'attached', timeout: 2_000 })
      .catch(() => null)
    const read = await page.evaluate((readerIds) => {
      const countOf = (id) => document.querySelectorAll(`[id="${id}"]`).length
      const textOf = (element) => (element ? element.textContent : null)
      const idOf = (element) => (element ? element.id : null)
      const answer = document.querySelector('.qa-answer')
      const field = document.querySelector('.composer textarea')
      const entry = document.querySelector('.open-in-editor')
      const target = entry.querySelector('.open-target')
      const described = document.getElementById(
        entry.querySelector('a').getAttribute('aria-describedby'),
      )
      const status = document.querySelector('[data-codebook-update-status]')
      const helpTitle = document.getElementById(
        document
          .querySelector('dialog.shortcut-dialog')
          .getAttribute('aria-labelledby'),
      )
      return {
        idCounts: Object.fromEntries(readerIds.map((id) => [id, countOf(id)])),
        headingIds: [...document.querySelectorAll('.wiki-article h2')].map(
          (heading) => heading.id,
        ),
        outlineAddresses: [...document.querySelectorAll('.outline a')].map(
          (link) => link.getAttribute('href'),
        ),
        isAnswerShown: answer.getClientRects().length > 0,
        answerStart: answer.textContent.slice(0, 16),
        // The label that names the field, or the words the reader gave the field itself.
        fieldLabel: field.labels.length
          ? field.labels[0].textContent
          : field.getAttribute('aria-label'),
        entryTargetId: idOf(target),
        entryDescription: textOf(described),
        isEntryDescribedByItsTarget: target !== null && described === target,
        statusRegionId: status.id,
        statusRegionIdCount: countOf(status.id),
        helpTitle: textOf(helpTitle),
        address: location.pathname.split('/').at(-1) + location.search,
      }
    }, options.readerIds)
    await page.screenshot({
      path: `${options.output}/wiki-${pagePath.split('/').at(-1).replace('.html', '')}.png`,
    })
    return { afterTheOutlineEntry, themeAfterTheButton, ...read }
  }
  /** The checks both pages with the reader's ids share: the outline entry leads to its heading, the theme button, the question form and the rail entry are the reader's own and work. @example readerChecks(used).isAnswerShown // => true */
  const readerChecks = (used) => ({
    doesOutlineEntryLeadToAHeading:
      used.afterTheOutlineEntry.targetTag === 'H2',
    doesOutlineEntryLeadToItsHeading:
      used.afterTheOutlineEntry.targetText === 'Section qa-form',
    doesThemeButtonSwitchTheTheme: used.themeAfterTheButton === 'dark',
    isAnswerShown: used.isAnswerShown,
    isAnswerTheReaders: used.answerStart === 'Step 1: one part',
    isQuestionFieldLabelled: used.fieldLabel === 'Ask about this repository',
    isEntryDescribedByItsTarget: used.isEntryDescribedByItsTarget,
    doesEntryDescriptionNameTheSource: used.entryDescription === 'src/a.ts:1',
    isStatusRegionIdOnce: used.statusRegionIdCount === 1,
  })
  const usePageWithReaderIds = async () => {
    // Arrange: a page of the sample Wiki whose nine headings were authored with the reader's own ids, as this publisher printed it. Act: an outline entry, the theme button and a question are used as a learner uses them.
    const used = await useReaderOn(options.readerIdsPage)
    // Assert
    record(
      'on a page whose headings were authored with the reader’s own ids every such id stands once in the served page, the headings, their outline entries and the links to them carry page- before the id, and the outline, the theme button, the question form with its label and its answer, the rail entry and the keyboard help work',
      used,
      {
        ...readerChecks(used),
        doesEveryReaderIdStandOnce: Object.values(used.idCounts).every(
          (count) => count === 1,
        ),
        areHeadingsRenamed:
          JSON.stringify(used.headingIds) ===
          JSON.stringify(options.readerIds.map((id) => `page-${id}`)),
        doOutlineEntriesNameTheRenamedIds:
          JSON.stringify(used.outlineAddresses) ===
          JSON.stringify(options.readerIds.map((id) => `#page-${id}`)),
        doesOutlineEntryNameTheRenamedId:
          used.afterTheOutlineEntry.fragment === '#page-qa-form',
        doesStatusRegionKeepItsId:
          used.statusRegionId === 'codebook-update-status',
        doesEntryTargetKeepItsId: used.entryTargetId === 'codebook-open-target',
        isKeyboardHelpNamedByItsOwnTitle:
          used.helpTitle === 'Keyboard shortcuts',
        doesQuestionStayOnThePage: used.address === 'reader-ids.html',
      },
    )
  }
  const usePagePublishedWithReaderIdsTwice = async () => {
    // Arrange: the same page as a publisher before this build printed it: each of the reader's ids also on a heading, and the rail's entry as its link alone. Act: the same use.
    const used = await useReaderOn(options.readerIdsPagePublishedBefore)
    // Assert: the reader finds its own elements all the same. The keyboard help's heading takes a free id too, so its dialog is named by its own title and not by the heading of the article that carries `shortcut-title`.
    record(
      'a page published with the reader’s ids also on its headings is served without an error and the reader still finds its own elements: the outline entry reaches its heading, the theme button works, a question is answered on the page and its answer shows, the question field is labelled, the status region and the rail entry’s target get ids of their own, and the keyboard help is named by its own title',
      used,
      {
        ...readerChecks(used),
        doesPageCarryTheFormsIdTwice: used.idCounts['qa-form'] === 2,
        doesStatusRegionTakeAFreeId:
          used.statusRegionId === 'codebook-update-status-2',
        doesEntryTargetTakeAFreeId:
          used.entryTargetId === 'codebook-open-target-2',
        isKeyboardHelpNamedByItsOwnTitle:
          used.helpTitle === 'Keyboard shortcuts',
        doesQuestionStayOnThePage:
          used.address === 'reader-ids-published-before.html',
      },
    )
  }
  // Each step leaves the page as the next one needs it: the three 1200 px steps of the rail share one load, and so do the two steps after the conflict at 960 px; a step of the reading column loads the page itself, because it asks a question.
  const stepsOfAPage = [
    measureEntryInRow,
    measureNarrowestRow,
    measureReadingColumnInRow,
    measureEntryInColumn,
    measureEntryStates,
    measureRingsInColumns,
    measureRingsAtRailEdges,
    measureReadingColumnInColumns,
    measureAnswerRing,
    measureRailWithRefusal,
    measureRailWithOpenDetail,
    measureDetailSummaryRingInRow,
    measureOutlineRingInRow,
    measureSingleColumn,
  ]
  for (const step of stepsOfAPage) await step()
  // The same steps once more on the same content in the shell of 0.2.29.0: there the article, the composer, the rail and the entry get their rules from the sheet the reader injects, laid over the stylesheet of that build.
  wikiPage = options.pageInTheShellOf02290
  caseSuffix = ' (on a page in the shell of 0.2.29.0)'
  options.output = `${outputOfTheOverview}/shell-of-0.2.29.0`
  for (const step of stepsOfAPage) await step()
  wikiPage = 'index.html'
  caseSuffix = ''
  options.output = outputOfTheOverview
  for (const step of [
    measureLongTargetInRow,
    measureMissingPage,
    usePageWithReaderIds,
    usePagePublishedWithReaderIdsTwice,
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
/** The update states the check's reader can answer, each as the extension's window would hold it when the page asks; an ended run ends at the moment it is chosen, after the sample Wiki was published. */
const updateStatuses = {
  idle: () => ({ state: 'idle' }),
  refused: () => ({
    state: 'failed',
    host: 'vscode',
    finishedAt: new Date().toISOString(),
    reason: REFUSAL_REASON,
    isCodebookSentence: true,
    site: 'kept',
    outputDirectory: wiki.outputDirectory,
    outputLabel: '.codebook/wiki',
  }),
  conflict: () => ({
    state: 'conflict',
    host: 'vscode',
    finishedAt: new Date().toISOString(),
    paths: CONFLICT_PATHS,
    cause: 'edited-page',
    site: 'kept',
    outputDirectory: wiki.outputDirectory,
    outputLabel: '.codebook/wiki',
  }),
}
let answeredUpdateStatus = updateStatuses.idle()
// The flow runs in the browser CLI and cannot reach this process's variables, so it names the state the reader answers next through this address: `<address><name>`.
const updateStatusControl = createServer((request, response) => {
  const chosen = updateStatuses[String(request.url).slice(1)]
  if (chosen) answeredUpdateStatus = chosen()
  response.statusCode = chosen ? 204 : 404
  response.end()
})
await new Promise((resolveListening) =>
  updateStatusControl.listen(0, '127.0.0.1', resolveListening),
)
let reader
let isBrowserOpen = false
try {
  reader = await startDeepWikiReader(
    wiki.outputDirectory,
    wiki.projectRoot,
    // The reader answers the one question the check asks in the composer.
    async () => ANSWER,
    'vscode',
    () => answeredUpdateStatus,
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
      expectedTargetText: `${OPEN_TARGET.path}:${OPEN_TARGET.line}`,
      question: QUESTION,
      updateStatusControl: `http://127.0.0.1:${updateStatusControl.address().port}/`,
      longSourcePage: LONG_SOURCE_PAGE,
      expectedLongTargetText: `${LONG_SOURCE.path}:${LONG_SOURCE.line}`,
      pageInTheShellOf02290: PAGE_IN_THE_SHELL_OF_02290,
      readerIds: READER_IDS,
      readerIdsPage: READER_IDS_PAGE,
      readerIdsPagePublishedBefore: READER_IDS_PAGE_PUBLISHED_BEFORE,
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
    () =>
      new Promise((resolveClosed) => updateStatusControl.close(resolveClosed)),
    wiki.remove,
  ])
}
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ name: entry.name, passed: entry.passed })),
  ),
)
