import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

/**
 * Reads the bundled `SKILL.md`, the skill the extension ships and Cursor's setup copies, so a test can pin a sentence of its Wiki route.
 *
 * Tests run from `dist/tests`, so the path climbs two folders to the extension root. Called by the skill tests of this file.
 *
 * @returns The skill's text.
 *
 * @example
 * ```ts
 * const skill = await readBundledSkill()
 * assert.ok(skill.includes('metadata:\n  version: "1.0.88"\n'))
 * ```
 */
const readBundledSkill = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )

/**
 * Reads the packaged `README.md`, the learner's documentation, so a test can pin the sentence that describes a Wiki rule.
 *
 * Tests run from `dist/tests`, so the path climbs two folders to the extension root. Called by the README tests of this file.
 *
 * @returns The README's text.
 *
 * @example
 * ```ts
 * const readme = await readPackagedReadme()
 * assert.ok(readme.includes('An answer names the repository files it relies on by path'))
 * ```
 */
const readPackagedReadme = (): Promise<string> =>
  readFile(join(__dirname, '..', '..', 'README.md'), 'utf8')

// Value: protects=the Wiki route tells the chat AI that every included code file needs a citation or a coverageExceptions entry with its reason, before the renderer refuses it; fails_when=skill 1.0.88 loses the coverage sentence and the chat learns of the rule only from a refusal it may answer by excepting application modules (C113-W1); why_new=skill 1.0.87 never asked for coverage, and a 6-page Wiki citing 32 of 71 sources published; seam=none; no_claim=how thoroughly a chat model explains each file
test('the bundled skill 1.0.88 asks the Wiki generator to cite every included code file or name it as an exception with a reason', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.88"\n'))
  assert.ok(
    skill.includes(
      'Every included code file must be cited by a page `sources` list, a diagram node or edge, or an inline editor source link, or be listed under optional `coverageExceptions`',
    ),
  )
  assert.ok(
    skill.includes('never for an application module a learner would read.'),
  )
})

// Value: protects=the learner's README names the coverage rule the generator enforces; fails_when=the README says nothing about a refused Wiki that leaves code unexplained (C113-W1); why_new=the renderer gained the refusal in Cycle 0113; seam=none; no_claim=the refusal's exact wording
test('the README says the generator refuses a Wiki that leaves an included code file unexplained', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      'The generator refuses to publish a Wiki that leaves an included code file unexplained, unless that file is listed as needing no explanation, with the reason.',
    ),
  )
})

// Value: protects=the Wiki route tells the chat AI the depth floors the renderer enforces (child pages, pages per file, a diagram on every page, text per page and per file with CJK counted twice) and the learner's README says the generator refuses a thin Wiki; fails_when=the skill or the README loses the depth sentence and a flat 7-page Wiki with one diagram is published (C113-W3); why_new=the renderer gained the depth refusal in Cycle 0113; seam=none; no_claim=how deep a chat model's articles really are
test('the skill and the README say a Wiki too thin for its code is refused: no child pages, too few diagrams or too little explanation', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    skill.includes(
      "at least 2 pages with a `parent`, at least one page per 8 explained code files (up to the 256-page limit), a diagram on every page and about three diagrams per two pages in total (architecture, flow or sequence, each with source-backed nodes and edges), and at least 1,200 characters of article text on every page and 500 per explained code file in total (the total required stops at 120,000), CJK characters counted twice; a page's characters are counted from its article text. These are floors, not targets: DeepWiki itself typically gives each page several diagrams and 2,500–7,000 characters, so aim above them.",
    ),
  )
  assert.ok(
    readme.includes(
      'Once 12 or more included code files need explanation, it also refuses a Wiki whose chapters are too thin for the code it covers: no child pages, a page without a diagram, too few diagrams for its pages, or too little explanation (including a page that is only a stub).',
    ),
  )
})

// Value: protects=the learner's README telling what an answer on the Wiki page shows: files by path, never an internal excerpt id, several lines per file up to the 40-citation limit, one link per distinct file and line; fails_when=the README loses that sentence or its limit and a learner cannot tell what the links under an answer open; why_new=C113 review round (Q&A citations); seam=none; no_claim=that a real answer cites well
test('the README says an answer names files by path, cites at most 40 lines, and its links open each cited line once', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      'An answer names the repository files it relies on by path, never by an internal excerpt id such as S1, and may cite several lines of each file, up to 40 citations in all (repeats counted); an answer with more is refused as one without usable source citations. The links under the answer open each cited line in your editor, once per distinct file and line.',
    ),
  )
})

/**
 * Reads the bundled `render-wiki.mjs`, the renderer that enforces the depth floors the skill states, so a test can compare its constants with the skill's sentence.
 *
 * Tests run from `dist/tests`, so the path climbs two folders to the extension root. Called by the depth-floor test of this file.
 *
 * @returns The renderer's source text.
 *
 * @example
 * ```ts
 * const renderer = await readRenderer()
 * assert.match(renderer, /const DEPTH_MIN_PAGE_TEXT = 1200;/)
 * ```
 */
const readRenderer = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'render-wiki.mjs'),
    'utf8',
  )

// Value: protects=the skill's depth sentence and the renderer's floors stay the same numbers; fails_when=a depth constant in render-wiki.mjs changes (for example the 1,200-character page floor) while the skill still states the old value, so the chat aims at a floor the renderer no longer enforces; why_new=C113 /ship review (core docs-drift note); seam=none (reads the shipped files); no_claim=the renderer's behavior, which renderWikiDepth.test.mjs covers
test('the renderer enforces the same depth floors the bundled skill states', async () => {
  // Arrange
  const renderer = await readRenderer()
  const skill = await readBundledSkill()

  // Act
  const constants = Object.fromEntries(
    [
      ...renderer.matchAll(/^const (DEPTH_[A-Z_]+|MAX_PAGES) = ([\d_.]+);$/gm),
    ].map((match) => [match[1], match[2]]),
  )

  // Assert
  assert.deepEqual(
    {
      DEPTH_MIN_EXPLAINED_FILES: constants.DEPTH_MIN_EXPLAINED_FILES,
      DEPTH_MIN_CHILD_PAGES: constants.DEPTH_MIN_CHILD_PAGES,
      DEPTH_FILES_PER_PAGE: constants.DEPTH_FILES_PER_PAGE,
      MAX_PAGES: constants.MAX_PAGES,
      DEPTH_DIAGRAMS_PER_PAGE: constants.DEPTH_DIAGRAMS_PER_PAGE,
      DEPTH_MIN_PAGE_TEXT: constants.DEPTH_MIN_PAGE_TEXT,
      DEPTH_TEXT_PER_FILE: constants.DEPTH_TEXT_PER_FILE,
      DEPTH_MAX_REQUIRED_TEXT: constants.DEPTH_MAX_REQUIRED_TEXT,
    },
    {
      DEPTH_MIN_EXPLAINED_FILES: '12',
      DEPTH_MIN_CHILD_PAGES: '2',
      DEPTH_FILES_PER_PAGE: '8',
      MAX_PAGES: '256',
      DEPTH_DIAGRAMS_PER_PAGE: '1.5',
      DEPTH_MIN_PAGE_TEXT: '1200',
      DEPTH_TEXT_PER_FILE: '500',
      DEPTH_MAX_REQUIRED_TEXT: '120_000',
    },
  )
  assert.ok(
    skill.includes(
      'from 12 explained code files (included code files no exception covers), at least 2 pages with a `parent`, at least one page per 8 explained code files (up to the 256-page limit)',
    ),
  )
})
