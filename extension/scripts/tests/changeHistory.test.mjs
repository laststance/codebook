import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

import ts from 'typescript'

const repositoryRoot = new URL('../../../', import.meta.url)

/** The folders whose files are the product's own text: what a learner or an agent can be shown comes from one of them. Test files are left out ({@link productText}). */
const PRODUCT_FOLDERS = [
  'extension/src',
  'extension/skills',
  'extension/scripts',
]

/** The file names that hold text a document can quote; images and other binary files are not read. */
const TEXT_FILE = /\.(?:ts|mjs|html|md|json|txt)$/

/** The file names of program code, of which only the texts it holds as strings count: a comment or a docstring may still show a sentence the code no longer builds. */
const CODE_FILE = /\.(?:ts|mjs)$/

/**
 * A quotation of the newest entry that the product builds from several strings, with those strings as the code holds them ({@link stringTextsOf}: `${}` marks a value a template takes in); for {@link partsOf}, which otherwise takes a quotation's parts from the quotation itself.
 * A quotation that is not listed here is one string of the code, apart from the values its `<…>` marks stand for.
 */
const COMPOSED_QUOTATIONS = new Map([
  [
    'No Wiki was found at <folder>: its manifest (codebook-wiki.json) does not exist',
    [
      'No Wiki was found at ${}: its ${} (${}) does not exist',
      'manifest',
      'codebook-wiki.json',
    ],
  ],
  [
    'Copilot Chat receives the update request for this project in a new chat; the chat you have open keeps its place in the chat list.',
    [
      'Copilot Chat receives the update request for this project ${}; the chat you have open ${}. ${} A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.',
      'in a new chat',
      'keeps its place in the chat list',
    ],
  ],
  [
    'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    [
      'Codebook saw no sign of the update in the editor chat within ${}${}',
      ' and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    ],
  ],
  [
    'If you refuse a step of the chat, press Cancel in the editor’s status bar; otherwise Codebook keeps watching for the whole 15 minutes.',
    [
      'If you refuse a step of the chat, press Cancel',
      ' in the editor’s status bar; otherwise Codebook keeps watching for the whole ',
    ],
  ],
  [
    "Wiki page <path> opens <name> and never closes it; close every element inside the page's content, the last opened first.",
    [
      'Wiki page ${} ${}',
      'opens <${}> and never closes it; ${}',
      "close every element inside the page's content, the last opened first.",
    ],
  ],
  [
    "The run's explanation budget (32 keys) is spent; Codebook accepts no new explanation key for this run, and a key it already accepted answers its receipt again.",
    [
      "The run's explanation budget (${} keys) is spent; Codebook accepts no new explanation key for this run, and a key it already accepted answers its receipt again.",
    ],
  ],
  [
    'When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.',
    [
      ' When the cause above is resolved, run ${} again: it goes on with the config.',
      'Codebook: Remove Managed Cursor Skill',
    ],
  ],
  [
    'The checkout changed during compilation: Git reported no change before and reports changes now ("PROJECT_STATE.md"). Retry from a stable checkout.',
    [
      'The checkout changed during ${}: ${}. Retry from a stable checkout.',
      'Git reported no change before and reports changes now (${})',
    ],
  ],
  [
    'The managed Cursor skill was edited after setup: <path>. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.',
    [
      'The managed Cursor skill was edited after setup: ${}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run ${} again.',
      'Codebook: Set Up AI Chat',
    ],
  ],
  [
    'Codebook will not read through a link: <path>. To finish the removal, remove the link, then run Codebook: Remove Managed Cursor Skill again.',
    [
      'Codebook will not read through a link: ${}. To finish the removal, remove the link, then run ${} again.',
      'Codebook: Remove Managed Cursor Skill',
    ],
  ],
])

/**
 * Reads a document of the repository by its path from the repository root.
 * @param {string} path - The path from the repository root, for example `CHANGELOG.md`.
 * @returns {Promise<string>} The document's text.
 * @example
 * const history = await readDocument('CHANGELOG.md')
 */
const readDocument = (path) => readFile(new URL(path, repositoryRoot), 'utf8')

/**
 * Lists the texts a file of program code holds as strings, so that a sentence counts only where the code can show it; for {@link productText}.
 * A string in quotes gives its text. A template gives its text with a mark for each value it takes in, and the strings inside those values are listed too.
 * @param {string} name - The file's name, which tells the parser its language.
 * @param {string} code - The file's text.
 * @returns {string[]} The texts, in the order of the file.
 * @example
 * stringTextsOf('a.ts', "// 'gone'\nthrow new Error(`No Wiki at ${folder}: ${'none'}`)") // => ['No Wiki at ${}: ${}', 'none']
 */
function stringTextsOf(name, code) {
  const texts = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      texts.push(node.text)
    // A template with values: its own text, each value as a mark.
    if (ts.isTemplateExpression(node))
      texts.push(
        node.head.text +
          node.templateSpans.map((span) => '${}' + span.literal.text).join(''),
      )
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true))
  return texts
}

/**
 * Joins what every product file that is no test can show: the strings of its program code, and the whole text of every other file (the skill's documents and pages); a sentence that only a test, a comment or a docstring states is not the product's.
 * @returns {Promise<string>} The texts, one per line.
 * @example
 * (await productText()).includes('Another editor window is starting an update of this Wiki.') // => true
 */
async function productText() {
  const texts = []
  for (const folder of PRODUCT_FOLDERS) {
    const entries = await readdir(new URL(folder, repositoryRoot), {
      recursive: true,
      withFileTypes: true,
    })
    for (const entry of entries) {
      const path = `${entry.parentPath}/${entry.name}`
      if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue
      // A test may state a sentence the product no longer has.
      if (/[\\/]tests[\\/]/.test(path)) continue
      const text = await readFile(path, 'utf8')
      texts.push(
        ...(CODE_FILE.test(entry.name)
          ? stringTextsOf(entry.name, text)
          : [text]),
      )
    }
  }
  return texts.join('\n')
}

/**
 * Cuts the newest entry out of the change history: from its heading to the heading of the entry before it.
 * @param {string} history - The text of `CHANGELOG.md`.
 * @returns {{ heading: string, text: string }} The entry's heading line and its whole text; both empty when the history has no entry.
 * @example
 * newestEntryOf('# Changelog\n\n## [1.1] - 2026-01-02\n\nNew.\n\n## [1.0] - 2026-01-01\n\nOld.\n') // => { heading: '## [1.1] - 2026-01-02', text: '## [1.1] - 2026-01-02\n\nNew.\n\n' }
 */
function newestEntryOf(history) {
  const start = history.indexOf('\n## [') + 1
  if (start === 0) return { heading: '', text: '' }
  const next = history.indexOf('\n## [', start)
  const text = history.slice(start, next === -1 ? undefined : next + 1)
  return { heading: text.slice(0, text.indexOf('\n')), text }
}

/**
 * Lists the product sentences an entry quotes: its code spans of four words or more. A shorter span names a file, a setting, a tool or a member and is no sentence.
 * @param {string} entry - The entry's text.
 * @returns {string[]} Each quoted sentence once, in the order of the entry.
 * @example
 * quotedSentencesOf('`writer.lock` says `No data changed; retry after resolving the lock.`') // => ['No data changed; retry after resolving the lock.']
 */
function quotedSentencesOf(entry) {
  const spans = [...entry.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
  return [
    ...new Set(spans.filter((span) => span.trim().split(/\s+/).length >= 4)),
  ]
}

/**
 * Gives the pieces of source text a quotation must be made of: for a quotation the product builds from parts, the parts {@link COMPOSED_QUOTATIONS} names; for any other, the quotation without the values its `<…>` marks and its `…` stand for.
 * @param {string} quotation - A quoted sentence.
 * @returns {string[]} The pieces, each of eight characters or more: a shorter rest between two values proves nothing.
 * @example
 * partsOf('No Wiki was found at <folder>: its manifest (codebook-wiki.json) does not exist') // => ['No Wiki was found at', ': its manifest (codebook-wiki.json) does not exist']
 */
function partsOf(quotation) {
  return (
    COMPOSED_QUOTATIONS.get(quotation) ??
    quotation
      .split(/<[^<>]*>|…/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 8)
  )
}

/**
 * Names the cycle the project state gives as active, so a test can tell the entry of a cycle that is still being delivered from one that is history.
 * @param {string} projectState - The text of `PROJECT_STATE.md`.
 * @returns {string | undefined} The cycle's four digits; `undefined` when the state table links no active cycle.
 * @example
 * activeCycleOf('| Active cycle | [Cycle 0046](docs/cycles/0046-x.md) |') // => '0046'
 */
const activeCycleOf = (projectState) =>
  /^\| Active cycle \| \[Cycle (\d{4})\]/m.exec(projectState)?.[1]

// Value: protects=a reader who opens the change history to see what the delivered version changed; fails_when=the version in VERSION is raised without an entry of that version at the top of the change history, or the entry's heading loses its date or its mark as a development candidate; why_new=Cycle 0046 row 120: the version and its entry are written in two files and nothing compared them; seam=none
test('the newest entry of the change history is the entry of the version in VERSION, with its date and its mark as a development candidate', async () => {
  // Arrange
  const version = (await readDocument('VERSION')).trim()
  const history = await readDocument('CHANGELOG.md')

  // Act
  const { heading } = newestEntryOf(history)

  // Assert
  assert.match(
    heading,
    /^## \[\d+\.\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2} \(development candidate\)$/,
  )
  assert.equal(heading.startsWith(`## [${version}] - `), true, heading)
})

// Value: protects=a learner or an agent who meets a sentence of the product and looks it up in the change history, and a reader who takes a quoted sentence for what the product says; fails_when=the entry of the cycle that is being delivered quotes a sentence the product does not have: one a later row of the cycle reworded, one copied from a closure note, or one a test alone states; why_new=Cycle 0046 row 120: the entry quotes more than thirty sentences of a cycle whose later rows reworded earlier ones; seam=none
test('while its cycle is the active one, every sentence the newest entry of the change history quotes stands in the product’s source word for word, apart from the values its marks stand for', async (context) => {
  // Arrange
  const { text } = newestEntryOf(await readDocument('CHANGELOG.md'))
  const cycleOfEntry = /^Cycle (\d{4}) /m.exec(text)?.[1]
  const activeCycle = activeCycleOf(await readDocument('PROJECT_STATE.md'))
  // The entry of a closed cycle is history: a later cycle may reword a sentence it quotes, and the entry stays as it was delivered.
  if (cycleOfEntry !== activeCycle) {
    context.skip(
      `The newest entry is the entry of Cycle ${cycleOfEntry}, and the active cycle is ${activeCycle}: its quotations are history, and the entry of the active cycle is checked once it is written.`,
    )
    return
  }
  const product = await productText()

  // Act: every quoted sentence with the pieces of it the source does not hold.
  const quotations = quotedSentencesOf(text)
  const notInTheProduct = quotations
    .map((quotation) => ({
      quotation,
      missing: partsOf(quotation).filter((part) => !product.includes(part)),
    }))
    .filter(({ missing }) => missing.length > 0)
  const composedButNotQuoted = [...COMPOSED_QUOTATIONS.keys()].filter(
    (quotation) => !quotations.includes(quotation),
  )

  // Assert: each quoted sentence is the product's, and the list of composed quotations names only sentences the entry quotes (so the entry's code spans were found).
  assert.deepEqual(notInTheProduct, [])
  assert.deepEqual(composedButNotQuoted, [])
})

// Value: protects=a client author who reads the API version and the skill version in the change history, and a reader who takes its count of the cycle's rows, or the README's, as the table's; fails_when=the entry of the cycle that is being delivered names another MCP API version or skill version than the product has, or the entry or the README counts other rows than the cycle's carried-defects table holds (a row was added after they were written); why_new=Cycle 0046 row 120: the newest entry said "The MCP API is 1.6" while the product reported 1.7, and the table grew from 46 rows to 313 while the cycle ran; seam=none
test('while its cycle is the active one, the newest entry of the change history names the MCP API version and the skill version the product has, and it and the README count the rows of the cycle’s carried-defects table as the table has them', async (context) => {
  // Arrange
  const { text } = newestEntryOf(await readDocument('CHANGELOG.md'))
  const cycleOfEntry = /^Cycle (\d{4}) /m.exec(text)?.[1]
  const activeCycle = activeCycleOf(await readDocument('PROJECT_STATE.md'))
  if (cycleOfEntry !== activeCycle) {
    context.skip(
      `The newest entry is the entry of Cycle ${cycleOfEntry}, and the active cycle is ${activeCycle}: its numbers are history.`,
    )
    return
  }
  const constants = await readDocument('extension/src/constants.ts')
  const skill = await readDocument('extension/skills/codebook/SKILL.md')
  const readme = await readDocument('README.md')
  // Only a bug-fix cycle has a table of carried defects; a feature cycle's entry and the README then count no rows.
  const table = await readDocument(
    `docs/cycles/${cycleOfEntry}-carried-defects.md`,
  ).catch(() => undefined)

  // Act: what the entry and the README state, and what the product and the table have (a row is a table line that begins with its number).
  const rowsOfTable = table
    ?.split('\n')
    .filter((line) => /^\| \d+ \|/.test(line)).length
  const rowsAtFiling = Number(/\((\d+) at filing/.exec(table ?? '')?.[1])
  const stated = {
    api: /\*\*Compatibility\.\*\* The MCP API is ([\d.]+)/.exec(text)?.[1],
    skill: /The bundled skill is ([\d.]+)/.exec(text)?.[1],
    rowsOfEntry:
      /the (\d+) defects Cycle \d{4} left and the (\d+) that were found while it ran, (\d+) rows in all/
        .exec(text)
        ?.slice(1)
        .map(Number),
    rowsOfStatus:
      /the (\d+) defects Cycle \d{4} left and the (\d+) found while it ran/
        .exec(readme)
        ?.slice(1)
        .map(Number),
    rowsOfTracking: [...readme.matchAll(/\((\d+) rows, \[the list\]/g)].map(
      (match) => Number(match[1]),
    ),
  }
  const had = {
    api: /^export const API_VERSION = '([\d.]+)'$/m.exec(constants)?.[1],
    skill: /^ {2}version: "([\d.]+)"$/m.exec(skill)?.[1],
    rowsOfEntry: table && [
      rowsAtFiling,
      rowsOfTable - rowsAtFiling,
      rowsOfTable,
    ],
    rowsOfStatus: table && [rowsAtFiling, rowsOfTable - rowsAtFiling],
    rowsOfTracking: table ? [rowsOfTable] : [],
  }

  // Assert: the product states both versions, and every statement equals what the product and the table have.
  assert.notEqual(had.api, undefined)
  assert.notEqual(had.skill, undefined)
  assert.deepEqual(stated, had)
})
