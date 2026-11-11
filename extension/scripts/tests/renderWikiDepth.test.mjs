import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/** The path of page `index` in a manifest of {@link wikiOf}: the first is the index page. */
const pathOfPage = (index) =>
  index === 0 ? 'index.html' : `page-${index}.html`

/**
 * The letters-only tag of page `index` (`a` to `z`, then `ba`, `bb` …).
 * Called by {@link wikiOf} to start each page's filler, because the renderer counts a sentence repeated on three or more pages once and reads digits as one placeholder: letters keep every page's filler a sentence of its own.
 * @example tagOfPage(26) // => 'ba'
 */
const tagOfPage = (index) => {
  let tag = ''
  let rest = index
  // Base 26 in the letters a to z, most significant letter first.
  do {
    tag = String.fromCharCode(97 + (rest % 26)) + tag
    rest = Math.floor(rest / 26)
  } while (rest > 0)
  return tag
}

/** The text of included file `index`; every file holds one distinct line so a diagram can quote it. */
const fileText = (index) => `export const f${index} = ${index};\n`

/**
 * Writes `fileCount` code files into a project folder and answers a Wiki manifest shaped by the options.
 * Called by every test of the renderer's depth check.
 * @param root - The project folder.
 * @param options - `fileCount` included code files `f<i>.ts`; `pageTexts` the counted explanation of each page in weighted characters (the first is `index.html`), written as one sentence of its own: the page's tag ({@link tagOfPage}), a space and filler; `childCount` pages after the first that have the first as parent, or `parents` the parent page index of each page (`null` for none) in its place; `diagramCounts` the number of diagrams on each page; `character` the filler character and `characterWeight` its weight (2 for a CJK one, the default for any character but `x`); `coverageExceptions` entries.
 * @returns The manifest, as an agent writes it into a candidate; the index page cites every file.
 * @example await wikiOf(root, { fileCount: 12, pageTexts: [1500, 1500, 1500, 1500], childCount: 3, diagramCounts: [2, 2, 1, 1] })
 */
async function wikiOf(
  root,
  {
    fileCount,
    pageTexts,
    childCount,
    diagramCounts,
    character = 'x',
    characterWeight = character === 'x' ? 1 : 2,
    coverageExceptions,
    extraFiles = {},
    parents,
  },
) {
  const files = { ...extraFiles }
  for (let index = 0; index < fileCount; index += 1)
    files[`f${index}.ts`] = fileText(index)
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const pages = pageTexts.map((length, pageIndex) => {
    // The tag and its space count 1 each; the filler character makes up the rest.
    const tag = tagOfPage(pageIndex)
    const filler = `${tag} ${character.repeat(
      Math.ceil(Math.max(length - tag.length - 1, 0) / characterWeight),
    )}`
    const diagrams = Array.from(
      { length: diagramCounts[pageIndex] ?? 0 },
      (_, diagramIndex) => ({
        id: `diagram-${pageIndex}-${diagramIndex}`,
        title: 'Flow',
        caption: 'One call.',
        kind: 'flow',
        nodes: [
          {
            id: 'one',
            label: 'one',
            row: 0,
            column: 0,
            sources: [
              { path: 'f0.ts', line: 1, endLine: 1, quote: fileText(0).trim() },
            ],
          },
        ],
        edges: [],
      }),
    )
    const slots = diagrams
      .map(
        (diagram) => `<figure data-codebook-diagram="${diagram.id}"></figure>`,
      )
      .join('')
    return {
      path: pathOfPage(pageIndex),
      title: `Page ${pageIndex}`,
      section: 'Guide',
      // A named page tree takes the place of the first page's children.
      ...(parents
        ? parents[pageIndex] === null
          ? {}
          : { parent: pathOfPage(parents[pageIndex]) }
        : pageIndex >= 1 && pageIndex <= childCount
          ? { parent: 'index.html' }
          : {}),
      // No heading: a heading repeated on every page would count once, so each page holds only its own sentence.
      contentHtml: `<p id="flow">${filler}</p>${slots}`,
      sources:
        pageIndex === 0
          ? Object.keys(files).map((path) => ({ path, line: 1 }))
          : [{ path: 'f0.ts', line: 1 }],
      outline: [{ id: 'flow', label: 'Flow' }],
      ...(diagrams.length ? { diagrams } : {}),
    }
  })
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    generated: { revision: '1234567890', at: '2026-11-10' },
    includedSources: Object.entries(files).map(([path, text]) => ({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
    })),
    pages,
    ...(coverageExceptions ? { coverageExceptions } : {}),
  }
}

/**
 * Renders a manifest and tells whether the renderer accepted it.
 * Called by the tests below to compare the accepted and the refused case.
 * @param manifest - The manifest to render.
 * @param root - The project folder.
 * @returns `rendered`, or the refusal's message.
 * @example await outcomeOf(manifest, root) // => 'rendered'
 */
async function outcomeOf(manifest, root) {
  return renderWikiPages(manifest, {
    projectRoot: root,
    outputDirectory: join(root, '.codebook/wiki'),
  }).then(
    () => 'rendered',
    (error) => error.message,
  )
}

/**
 * Runs a test body in a fresh real project folder and removes it afterwards.
 * Called by every test below.
 * @param body - The test body, given the folder.
 * @example await inProject(async (root) => {})
 */
async function inProject(body) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-depth-')),
  )
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// Value: protects=the learner who opens an LLM Wiki of a 12-file repository and finds a deep chapter tree, a diagram on every page and real explanation; fails_when=the renderer rejects a Wiki that meets every depth rule; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the content is good
test('a 12-file Wiki with child pages, diagrams, enough text and no stub page is rendered', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the learner who gets a flat Wiki with no chapter tree (7 flat pages in the native trial); fails_when=a 12-file Wiki whose pages have no parent is rendered, or its refusal does not say how many pages have a parent and what to add; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the tree is well chosen
test('a 12-file Wiki without any child page is refused with the chapter tree sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 0,
      diagramCounts: [2, 2, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 0 pages with a parent but needs at least 2: add child pages under subsystem chapters for their modules and flows.',
    )
  })
})

// Value: protects=the learner who gets a Wiki with one diagram in all of it (the native trial); fails_when=a 12-file Wiki of 4 pages with 4 diagrams is rendered, or the refusal omits the measured and the required count; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that a diagram is meaningful
test('a 12-file Wiki of four pages with four diagrams is refused with the diagram sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 3,
      diagramCounts: [1, 1, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 4 diagrams but needs at least 6 for 4 pages (one per page and about three per two pages in total): add architecture, flow or sequence diagrams with source-backed nodes and edges.',
    )
  })
})

// Value: protects=the learner who gets one-sentence mentions of every code file (about 6,300 characters for 51 files in the native trial); fails_when=a 12-file Wiki whose counted explanation is under 400 characters per file is rendered, or the refusal does not name the thinnest pages; why_new=Cycle 0113 (C113-W3), floor 400 per file from Cycle 0115 (C114-W4); seam=none (the real renderer); no_claim=that longer text explains better
test('a 12-file Wiki with 3,600 characters of explanation is refused with the explanation sentence naming the thinnest pages', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1200, 1200, 1200],
      childCount: 2,
      diagramCounts: [2, 2, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 3600 characters of explanation (CJK characters counted twice) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (1200 characters), page-1.html (1200 characters), page-2.html (1200 characters).',
    )
  })
})

// Value: protects=the learner who lands on a stub page of one sentence among otherwise long pages; fails_when=a 12-file Wiki with one 1,100-character page is rendered because the total text is enough, or the refusal does not name that page; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the other pages are good
test('a 12-file Wiki with one 1,100-character page is refused with the stub page sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [2000, 2000, 2000, 1100],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (1100 characters).',
    )
  })
})

// Value: protects=the owner of a Wiki that fails several rules at once; fails_when=the refusal stops at the first failed rule so the agent learns the rest one publish at a time; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=the order of the sentences beyond the rules' order
test('a 12-file Wiki failing every depth rule is refused with one sentence for each rule', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [100, 100],
      childCount: 0,
      diagramCounts: [],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 0 pages with a parent but needs at least 2: add child pages under subsystem chapters for their modules and flows. 2 pages have no diagram but every page needs at least one: add an architecture, flow or sequence diagram to index.html, page-1.html. The Wiki has 0 diagrams but needs at least 3 for 2 pages (one per page and about three per two pages in total): add architecture, flow or sequence diagrams with source-backed nodes and edges. The Wiki has 200 characters of explanation (CJK characters counted twice) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (100 characters), page-1.html (100 characters). 2 pages have fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen index.html (100 characters), page-1.html (100 characters).',
    )
  })
})

// Value: protects=the small repository whose honest Wiki is short; fails_when=a repository with 11 explained code files is held to the depth rules; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that a short Wiki is enough for 11 files
test('an 11-file Wiki with one short flat page is rendered because a small repository is exempt', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 11,
      pageTexts: [100],
      childCount: 0,
      diagramCounts: [],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the rule that excepted code needs no explanation and so does not raise the depth bar; fails_when=12 included code files of which one is excepted are held to the depth rules; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the exception's reason is true
test('twelve included code files with one excepted leave eleven explained files and the Wiki is exempt', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 11,
      pageTexts: [100],
      childCount: 0,
      diagramCounts: [],
      extraFiles: { 'gen/api.ts': 'export const api = 1;\n' },
      coverageExceptions: [{ path: 'gen/', reason: 'Generated client.' }],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the owner of a very large repository from a text requirement that grows without limit; fails_when=the required explanation exceeds 60,000 characters for 500 explained files, so a Wiki of exactly 60,000 counted characters is refused; why_new=Cycle 0113 (C113-W3), cap 60,000 from Cycle 0115 (C114-W4); seam=none (the real renderer); no_claim=that 60,000 characters explain 500 files
test('a 500-file Wiki with exactly 60,000 characters of explanation is rendered because the requirement is capped', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 500,
      pageTexts: Array.from({ length: 40 }, () => 1500),
      childCount: 39,
      diagramCounts: Array.from({ length: 40 }, () => 2),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the cap's edge: one character below it is still refused; fails_when=a 500-file Wiki of 59,999 counted characters is rendered, or the refusal names the uncapped 200,000; why_new=Cycle 0113 (C113-W3), cap 60,000 from Cycle 0115 (C114-W4); seam=none (the real renderer); no_claim=that the sentence lists every thin page
test('a 500-file Wiki with 59,999 characters of explanation is refused and the refusal requires 60,000', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 500,
      pageTexts: [1499, ...Array.from({ length: 39 }, () => 1500)],
      childCount: 39,
      diagramCounts: Array.from({ length: 40 }, () => 2),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 59999 characters of explanation (CJK characters counted twice) but needs at least 60000 for 500 explained code files: write longer explanations, starting with the thinnest pages: index.html (1499 characters), page-1.html (1500 characters), page-10.html (1500 characters), page-11.html (1500 characters), page-12.html (1500 characters), page-13.html (1500 characters), page-14.html (1500 characters), page-15.html (1500 characters), page-16.html (1500 characters), page-17.html (1500 characters).',
    )
  })
})

// Value: protects=the learner who opens a chapter with no picture while other chapters have several; fails_when=a Wiki whose total diagram count suffices is rendered although one page has no diagram, or the refusal does not name that page; why_new=Cycle 0113 (C113-W3, DeepWiki shows 3 to 12 diagrams on every page); seam=none (the real renderer); no_claim=that the diagrams are good
test('a 12-file Wiki with nine diagrams but none on one page is refused naming that page', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 3,
      diagramCounts: [3, 3, 3, 0],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      '1 page has no diagram but every page needs at least one: add an architecture, flow or sequence diagram to page-3.html.',
    )
  })
})

// Value: protects=the Japanese learner whose Wiki carries about twice the content per character; fails_when=a Japanese Wiki of 4 pages with 750 characters each is refused as thin, or the same 750 ASCII characters per page are rendered; why_new=Cycle 0113 (C113-W3, English-equivalent characters); seam=none (the real renderer); no_claim=that the Japanese text is good
test('a Japanese 12-file Wiki of 750 characters per page is rendered while 750 ASCII characters per page are refused', async () => {
  await inProject(async (root) => {
    // Arrange
    const options = {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    }
    const japanese = await wikiOf(root, { ...options, character: 'あ' })
    const ascii = await wikiOf(root, {
      ...options,
      pageTexts: [750, 750, 750, 750],
    })

    // Act
    const japaneseOutcome = await outcomeOf(japanese, root)
    const asciiOutcome = await outcomeOf(ascii, root)

    // Assert
    assert.equal(japaneseOutcome, 'rendered')
    assert.equal(
      asciiOutcome,
      'The Wiki has 3000 characters of explanation (CJK characters counted twice) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (750 characters), page-1.html (750 characters), page-2.html (750 characters), page-3.html (750 characters). 4 pages have fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen index.html (750 characters), page-1.html (750 characters), page-2.html (750 characters), page-3.html (750 characters).',
    )
  })
})

// Value: protects=the learner of a 25-file repository who gets three giant chapters instead of about one page per eight files; fails_when=a 25-file Wiki of 3 pages is rendered, or the refusal omits the measured and the required page count; why_new=Cycle 0113 (C113-W3, page count floor); seam=none (the real renderer); no_claim=that the split is well chosen
test('a 25-file Wiki of three pages is refused with the page count sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 25,
      pageTexts: [4200, 4200, 4200],
      childCount: 2,
      diagramCounts: [2, 2, 2],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 3 pages but needs at least 4 for 25 explained code files (about one page per 8 files, up to 30): split the large chapters by module and flow.',
    )
  })
})

// Value: protects=the Korean, Chinese, Japanese and fullwidth learner whose characters carry about twice the content; fails_when=a page of 750 Han, Katakana, Hangul, fullwidth Latin, long-vowel, middle-dot or comma characters weighs less than 2 each, so a Wiki of them is refused as thin; why_new=C113 review round (。 moved to its own test in Cycle 0115, because a run of 。 is a run of identical sentences); seam=none (the real renderer); no_claim=that the text is good
test('a 12-file Wiki of 750 Han, Katakana, Hangul, fullwidth or Japanese mark characters per page is rendered', async () => {
  await inProject(async (root) => {
    // Arrange
    const options = {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    }
    const outcomes = {}

    // Act
    for (const character of ['漢', 'カ', '한', 'Ａ', 'ー', '・', '、']) {
      const manifest = await wikiOf(root, { ...options, character })
      outcomes[character] = await outcomeOf(manifest, root)
    }

    // Assert
    assert.deepEqual(outcomes, {
      漢: 'rendered',
      カ: 'rendered',
      한: 'rendered',
      Ａ: 'rendered',
      ー: 'rendered',
      '・': 'rendered',
      '、': 'rendered',
    })
  })
})

// Value: protects=the Japanese learner whose sentences end in 。, which carries the content of a CJK character; fails_when=。 weighs 1, so a page of 400 short Japanese sentences (1,574 weighted characters, 1,174 if 。 weighed 1) is refused as a stub; why_new=C113 review round, moved here in Cycle 0115 because 。 now also ends a sentence; seam=none (the real renderer); no_claim=that the text is good
test('a page of 400 short sentences ending in 。 counts each 。 twice and is rendered', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })
    // 26 sentences of a one-letter tag and 374 of a two-letter tag, each ending in 。: 26 × 3 + 374 × 4 = 1,574.
    const sentences = Array.from(
      { length: 400 },
      (_, index) => `${tagOfPage(index)}。`,
    ).join('')
    manifest.pages[3].contentHtml = `<p id="flow">${sentences}</p>${manifest.pages[3].contentHtml.slice(manifest.pages[3].contentHtml.indexOf('<figure'))}`

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the depth floor against half-width katakana padding, which carries the content of a Latin letter; fails_when=750 half-width katakana characters per page weigh 2 each and a thin Wiki of them is rendered; why_new=C113 review round; seam=none (the real renderer); no_claim=none
test('a 12-file Wiki of 750 half-width katakana characters per page is refused as thin', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [750, 750, 750, 750],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
      character: 'ｶ',
      characterWeight: 1,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome.startsWith(
        'The Wiki has 3000 characters of explanation (CJK characters counted twice) but needs at least 4800',
      ),
      true,
    )
  })
})

// Value: protects=the depth floor against entity padding: an escaped &nbsp; shown as text and numeric references each count as the one character a reader sees; fails_when=entities are measured by their source length, so 130 escaped &nbsp; (780 characters shown) or 160 numeric references of あ (320 weighted characters shown) pass the 1,200 floor; why_new=C113 review round; seam=none (the real renderer); no_claim=none
test('a page padded with escaped &nbsp; text or numeric character references is measured by the characters a reader sees', async () => {
  await inProject(async (root) => {
    // Arrange
    const options = {
      fileCount: 12,
      pageTexts: [2000, 2000, 2000, 2000],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    }
    const padded = async (padding) => {
      const manifest = await wikiOf(root, options)
      manifest.pages[3].contentHtml = `<p id="flow">${padding}</p>${manifest.pages[3].contentHtml.slice(manifest.pages[3].contentHtml.indexOf('<figure'))}`
      return manifest
    }
    const escapedNbsp = await padded('&amp;nbsp;'.repeat(130))
    const numeric = await padded('&#12354;'.repeat(80) + '&#x3042;'.repeat(80))

    // Act
    const escapedOutcome = await outcomeOf(escapedNbsp, root)
    const numericOutcome = await outcomeOf(numeric, root)

    // Assert
    assert.deepEqual(
      [escapedOutcome, numericOutcome],
      [
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (780 characters).',
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (320 characters).',
      ],
    )
  })
})

// Value: protects=the depth floor against text a reader never sees: an HTML comment (even one holding >) and zero-width format characters do not count; fails_when=a comment's tail after its first > or 1,000 zero-width spaces count as article text, so a stub page passes the 1,200 floor; why_new=C113 /ship review (Codex P2, adversarial review); seam=none (the real renderer); no_claim=other hidden content
test('a page padded with an HTML comment holding > or with zero-width spaces is measured by the text a reader sees', async () => {
  await inProject(async (root) => {
    // Arrange
    const options = {
      fileCount: 12,
      pageTexts: [2000, 2000, 2000, 2000],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    }
    const padded = async (padding) => {
      const manifest = await wikiOf(root, options)
      manifest.pages[3].contentHtml = `<p id="flow">Stub.${padding}</p>${manifest.pages[3].contentHtml.slice(manifest.pages[3].contentHtml.indexOf('<figure'))}`
      return manifest
    }
    const comment = await padded(`<!-- Design A -> B: ${'x'.repeat(1300)} -->`)
    const zeroWidth = await padded('&#8203;'.repeat(1300))

    // Act
    const commentOutcome = await outcomeOf(comment, root)
    const zeroWidthOutcome = await outcomeOf(zeroWidth, root)

    // Assert
    assert.deepEqual(
      [commentOutcome, zeroWidthOutcome],
      [
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (5 characters).',
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (5 characters).',
      ],
    )
  })
})

// Value: protects=the depth floor against text held in an attribute value: a > inside a double- or single-quoted value does not end the tag, so the value never counts as article text; fails_when=a tag is cut at the first > even inside its quoted value, so title="A -> B: …" padding passes the 1,200 floor with a stub page; why_new=C113 hosted CodeRabbit review on PR 291; seam=none (the real renderer); no_claim=unquoted attribute values, which the renderer's markup check refuses when they hold >
test('a page padded inside a quoted attribute value holding > is measured by the text a reader sees', async () => {
  await inProject(async (root) => {
    // Arrange
    const options = {
      fileCount: 12,
      pageTexts: [2000, 2000, 2000, 2000],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    }
    const padded = async (padding) => {
      const manifest = await wikiOf(root, options)
      manifest.pages[3].contentHtml = `<p id="flow">Stub.${padding}</p>${manifest.pages[3].contentHtml.slice(manifest.pages[3].contentHtml.indexOf('<figure'))}`
      return manifest
    }
    const doubleQuoted = await padded(
      `<span title="A -> B: ${'x'.repeat(1300)}"></span>`,
    )
    const singleQuoted = await padded(
      `<span title='A -> "B": ${'x'.repeat(1300)}'></span>`,
    )

    // Act
    const doubleQuotedOutcome = await outcomeOf(doubleQuoted, root)
    const singleQuotedOutcome = await outcomeOf(singleQuoted, root)

    // Assert
    assert.deepEqual(
      [doubleQuotedOutcome, singleQuotedOutcome],
      [
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (5 characters).',
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (5 characters).',
      ],
    )
  })
})

// Value: protects=the diagram floor of a three-page Wiki, which rounds 4.5 up to 5; fails_when=the floor is rounded down, so three pages with four diagrams are rendered; why_new=C113 review round (Math.ceil mutant); seam=none (the real renderer); no_claim=none
test('a 12-file Wiki of three pages with four diagrams is refused because it needs five', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [2000, 2000, 2000],
      childCount: 2,
      diagramCounts: [2, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 4 diagrams but needs at least 5 for 3 pages (one per page and about three per two pages in total): add architecture, flow or sequence diagrams with source-backed nodes and edges.',
    )
  })
})

// Value: protects=the chapter tree floor at its edge; fails_when=two pages with a parent are refused or one page with a parent is accepted; why_new=C113 review round (boundary gap); seam=none (the real renderer); no_claim=none
test('a 12-file Wiki with two child pages is rendered and one with a single child page is refused', async () => {
  await inProject(async (root) => {
    // Arrange
    const options = {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1500],
      diagramCounts: [2, 2, 1, 1],
    }
    const twoChildren = await wikiOf(root, { ...options, childCount: 2 })
    const oneChild = await wikiOf(root, { ...options, childCount: 1 })

    // Act
    const twoOutcome = await outcomeOf(twoChildren, root)
    const oneOutcome = await outcomeOf(oneChild, root)

    // Assert
    assert.deepEqual(
      [twoOutcome, oneOutcome],
      [
        'rendered',
        'The Wiki has 1 pages with a parent but needs at least 2: add child pages under subsystem chapters for their modules and flows.',
      ],
    )
  })
})

// Value: protects=the page count floor at its edge (25 files need 4 pages); fails_when=a 25-file Wiki of exactly four pages is refused; why_new=C113 review round (boundary gap); seam=none (the real renderer); no_claim=none
test('a 25-file Wiki of exactly four pages is rendered', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 25,
      pageTexts: [3200, 3200, 3200, 3200],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the length of the refusal for a Wiki of many bare pages; fails_when=the sentence names more or fewer than 10 of 12 pages without a diagram; why_new=C113 review round (cap gap); seam=none (the real renderer); no_claim=none
test('the refusal names only the first ten of twelve pages that have no diagram', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: Array.from({ length: 12 }, () => 1500),
      childCount: 11,
      diagramCounts: [],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome.includes(
        '12 pages have no diagram but every page needs at least one: add an architecture, flow or sequence diagram to index.html, page-1.html, page-2.html, page-3.html, page-4.html, page-5.html, page-6.html, page-7.html, page-8.html, page-9.html. The Wiki has 0 diagrams',
      ),
      true,
    )
  })
})

// Value: protects=the owner of a repository with more than 2,048 explained code files, whose page-count floor would exceed the 256 pages a Wiki may hold; fails_when=a 2,049-file Wiki of 256 pages is refused with the page count sentence; why_new=C113 review round (CodeRabbit); seam=none (the real renderer); no_claim=none
test('a 2,049-file Wiki of 256 pages is not refused for its page count', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 2049,
      pageTexts: Array.from({ length: 256 }, () => 4000),
      childCount: 255,
      diagramCounts: Array.from({ length: 256 }, () => 2),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

/**
 * Reads the numbers-only shape of DeepWiki's own Wiki of TanStack/query: the parent page index, diagrams and weighted prose of each of its 47 pages.
 * Called by the tests below that hold the page floor to the reference product at the scale of the largest required project (Cycle 0114).
 * @returns The fixture: `explainedCodeFiles` and `pages`.
 * @example const shape = await readDeepWikiP02Shape() // shape.pages.length === 47
 */
const readDeepWikiP02Shape = async () =>
  JSON.parse(
    await readFile(
      new URL('./fixtures/deepwiki-p02-shape.json', import.meta.url),
      'utf8',
    ),
  )

// Value: protects=the learner of TanStack/query, the largest required project, whose editor AI writes a Wiki as large as DeepWiki's own (47 pages, 142 diagrams, 288,168 characters) citing all 2,498 code files; fails_when=the page floor keeps growing one page per 8 cited files and refuses that Wiki for needing 256 pages (Cycle 0114 H1 dry run on the real clone); why_new=Cycle 0114 H1; seam=none (the real renderer; the numbers are DeepWiki's measured page tree); no_claim=that a model writes such a Wiki in time
test("a Wiki shaped like DeepWiki's own TanStack/query Wiki, 47 pages for 2,498 explained code files, is rendered", async () => {
  await inProject(async (root) => {
    // Arrange
    const shape = await readDeepWikiP02Shape()
    const manifest = await wikiOf(root, {
      fileCount: shape.explainedCodeFiles,
      pageTexts: shape.pages.map((page) => page.prose),
      parents: shape.pages.map((page) => page.parent),
      diagramCounts: shape.pages.map((page) => page.diagrams),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the learner of a small repository, held to the same floors as before the 30-page cap; fails_when=the cap or a later floor change refuses a Wiki shaped like DeepWiki's 13-page vercel/next-learn Wiki (C113 measurement); why_new=Cycle 0114 regression guard; seam=none (the real renderer); no_claim=that the floor still catches thin Wikis, which the refusal tests cover
test("a Wiki shaped like DeepWiki's 13-page next-learn Wiki, for 104 explained code files, is rendered", async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 104,
      pageTexts: [
        2514, 2900, 3300, 3700, 4100, 4500, 4900, 5300, 5700, 6100, 6500, 6800,
        6989,
      ],
      childCount: 12,
      diagramCounts: [6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a large repository's Wiki held to a 30-page tree once it has 240 explained files (the text total stops earlier, at 150); fails_when=the floor asks 256 pages for 2,498 files, or the cap is dropped so 29 pages pass; why_new=Cycle 0114 H1; seam=none (the real renderer); no_claim=none
test('a Wiki of 2,498 explained code files is rendered with 30 pages and refused with 29, naming 30', async () => {
  await inProject(async (root) => {
    // Arrange
    const thirtyPages = await wikiOf(root, {
      fileCount: 2498,
      pageTexts: Array.from({ length: 30 }, () => 4000),
      childCount: 29,
      diagramCounts: Array.from({ length: 30 }, () => 2),
    })
    const twentyNinePages = await wikiOf(root, {
      fileCount: 2498,
      pageTexts: Array.from({ length: 29 }, () => 4200),
      childCount: 28,
      diagramCounts: Array.from({ length: 29 }, () => 2),
    })

    // Act
    const thirtyOutcome = await outcomeOf(thirtyPages, root)
    const twentyNineOutcome = await outcomeOf(twentyNinePages, root)

    // Assert
    assert.deepEqual(
      [thirtyOutcome, twentyNineOutcome],
      [
        'rendered',
        'The Wiki has 29 pages but needs at least 30 for 2498 explained code files (about one page per 8 files, up to 30): split the large chapters by module and flow.',
      ],
    )
  })
})

// Value: protects=the page floor below the cap, unchanged by it: one page per 8 explained files; fails_when=the cap lowers the floor for a 100-file repository, so 12 pages pass where 13 are needed; why_new=Cycle 0114 H1; seam=none (the real renderer); no_claim=none
test('a 100-file Wiki of 12 pages is refused for needing 13', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 100,
      pageTexts: Array.from({ length: 12 }, () => 4200),
      childCount: 11,
      diagramCounts: Array.from({ length: 12 }, () => 2),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 12 pages but needs at least 13 for 100 explained code files (about one page per 8 files, up to 30): split the large chapters by module and flow.',
    )
  })
})

// Value: protects=the learner of a 51-file repository whose honest Wiki keeps rendering under the counted-explanation measure (C113 nextjs-dashboard, VS Code: 22,262 counted characters on 8 pages, thinnest 2,042); fails_when=the measure or a floor of Cycle 0115 refuses a Wiki shaped like it; why_new=Cycle 0115 (C114-W4) regression guard; seam=none (the real renderer; per-page numbers sum to C113's measured total); no_claim=that real prose is never discounted, which the boundary tests below cover
test("a Wiki shaped like Cycle 0113's nextjs-dashboard Wiki, 8 pages of distinct prose for 51 explained code files, is rendered", async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 51,
      pageTexts: [2042, 2600, 2800, 2900, 3000, 3100, 2600, 3220],
      childCount: 7,
      diagramCounts: [2, 2, 2, 2, 2, 1, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the learner who opens a large repository's Wiki and reads one sentence template per file instead of explanation (C114 Cursor runs: 58.5 to 70.9% of the text in repeated sentences); fails_when=a Wiki whose pages hold five template sentences for each of their files passes the floors, or the refusal does not say how much was repeated on each page; why_new=Cycle 0115 (C114-W4), renders on feb74a00's renderer; seam=none (the real renderer); no_claim=that every template is caught, since one with different words per use counts
test('a Wiki padded with one sentence template per file is refused, naming the repeated characters of each page', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [300, 300, 300, 300],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })
    // Page i explains files 3i to 3i + 2 with the same five sentences each (418 characters, 425 for f10 and f11).
    for (const [pageIndex, page] of manifest.pages.entries()) {
      const template = [0, 1, 2]
        .map((offset) => pageIndex * 3 + offset)
        .map(
          (file) =>
            `<p>The file f${file}.ts declares the constant f${file} and exports it for the modules that import it.</p>` +
            `<p>Reading f${file}.ts starts at its first line, where the constant f${file} receives its value.</p>` +
            `<p>Callers of f${file} read the exported value and never change it after the module loads.</p>` +
            `<p>This page cites f${file}.ts so that the learner can open the constant in the editor.</p>` +
            `<p>Tests and examples reach f${file} through the same export, so its value stays the same everywhere.</p>`,
        )
        .join('')
      page.contentHtml = page.contentHtml.replace('</p>', `</p>${template}`)
    }

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 1618 characters of explanation (CJK characters counted twice; not counted: 4612 in repeated sentences) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: page-1.html (300 characters; not counted: 1254 in repeated sentences), page-2.html (300 characters; not counted: 1254 in repeated sentences), page-3.html (300 characters; not counted: 1268 in repeated sentences), index.html (718 characters; not counted: 836 in repeated sentences). 4 pages have fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-1.html (300 characters; not counted: 1254 in repeated sentences), page-2.html (300 characters; not counted: 1254 in repeated sentences), page-3.html (300 characters; not counted: 1268 in repeated sentences), index.html (718 characters; not counted: 836 in repeated sentences).',
    )
  })
})

// Value: protects=the learner who reads lists of export names instead of explanation (C114 VS Code run 2: 24.3% of the text in "モジュール索引" lists); fails_when=a Wiki whose pages are mostly lists of names passes the floors, or the refusal does not say how much was listed; why_new=Cycle 0115 (C114-W4), renders on feb74a00's renderer; seam=none (the real renderer); no_claim=that a list written as a sentence of prose words is caught
test('a Wiki padded with lists of names is refused, naming the listed characters of each page', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [300, 300, 300, 300],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })
    // Twelve list items of 123 characters each on every page.
    const lists = `<ul>${'<li>QueryClient, QueryCache, MutationCache, QueryObserver, InfiniteQueryObserver, MutationObserver, focusManager, onlineManager</li>'.repeat(12)}</ul>`
    for (const page of manifest.pages)
      page.contentHtml = page.contentHtml.replace('</p>', `</p>${lists}`)

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 1200 characters of explanation (CJK characters counted twice; not counted: 5904 in lists of names) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (300 characters; not counted: 1476 in lists of names), page-1.html (300 characters; not counted: 1476 in lists of names), page-2.html (300 characters; not counted: 1476 in lists of names), page-3.html (300 characters; not counted: 1476 in lists of names). 4 pages have fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen index.html (300 characters; not counted: 1476 in lists of names), page-1.html (300 characters; not counted: 1476 in lists of names), page-2.html (300 characters; not counted: 1476 in lists of names), page-3.html (300 characters; not counted: 1476 in lists of names).',
    )
  })
})

// Value: protects=the learner who reads the source's own docstrings copied into the Wiki instead of an explanation of them (C114 Cursor run 1: wrapped docstrings); fails_when=a Wiki whose pages copy their cited files' doc comments word for word passes the floors, or the refusal does not say how much was copied; why_new=Cycle 0115 (C114-W4), renders on feb74a00's renderer; seam=none (the real renderer); no_claim=that paraphrased docstrings are caught
test('a Wiki padded with docstrings copied from its cited sources is refused, naming the copied characters of each page', async () => {
  await inProject(async (root) => {
    // Arrange
    // Fifteen doc-comment sentences of 91 characters per guide file, each with its own letters so no sentence repeats.
    const docSentences = (guide) =>
      Array.from(
        { length: 15 },
        (_, step) =>
          `In guide ${guide}, step ${tagOfPage(step)} reads the cached entry before the client asks the server for fresh data.`,
      )
    const guides = ['a', 'b', 'c', 'd']
    const extraFiles = Object.fromEntries(
      guides.map((guide) => [
        `docs/guide-${guide}.ts`,
        `/**\n${docSentences(guide)
          .map((sentence) => ` * ${sentence}`)
          .join('\n')}\n */\nexport const guide = 1;\n`,
      ]),
    )
    const manifest = await wikiOf(root, {
      fileCount: 8,
      pageTexts: [300, 300, 300, 300],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
      extraFiles,
    })
    for (const [pageIndex, page] of manifest.pages.entries()) {
      const guide = guides[pageIndex]
      page.sources.push({ path: `docs/guide-${guide}.ts`, line: 1 })
      page.contentHtml = page.contentHtml.replace(
        '</p>',
        `</p><p>${docSentences(guide).join(' ')}</p>`,
      )
    }

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 1200 characters of explanation (CJK characters counted twice; not counted: 5460 copied from cited sources) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (300 characters; not counted: 1365 copied from cited sources), page-1.html (300 characters; not counted: 1365 copied from cited sources), page-2.html (300 characters; not counted: 1365 copied from cited sources), page-3.html (300 characters; not counted: 1365 copied from cited sources). 4 pages have fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen index.html (300 characters; not counted: 1365 copied from cited sources), page-1.html (300 characters; not counted: 1365 copied from cited sources), page-2.html (300 characters; not counted: 1365 copied from cited sources), page-3.html (300 characters; not counted: 1365 copied from cited sources).',
    )
  })
})

// Value: protects=the honest label a Wiki repeats on two pages (the skill asks for source-derived labels), which still counts on both; fails_when=a sentence used twice is discounted, or one used three times counts on every page; why_new=Cycle 0115 (C114-W4, repeat threshold 3); seam=none (the real renderer); no_claim=that a label used three times is padding
test('a sentence used on two pages counts on both, and on three pages counts only where it is first used', async () => {
  await inProject(async (root) => {
    // Arrange
    // The label is 66 characters; pages that carry it hold 1,134 characters of filler, so they reach 1,200 only when it counts.
    const label =
      '<p>Relevant source files are listed in the panel beside this article.</p>'
    const options = {
      fileCount: 12,
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    }
    const twice = await wikiOf(root, {
      ...options,
      pageTexts: [1134, 1134, 1200, 1200],
    })
    const thrice = await wikiOf(root, {
      ...options,
      pageTexts: [1134, 1134, 1134, 1200],
    })
    for (const page of twice.pages.slice(0, 2))
      page.contentHtml = page.contentHtml.replace('</p>', `</p>${label}`)
    for (const page of thrice.pages.slice(0, 3))
      page.contentHtml = page.contentHtml.replace('</p>', `</p>${label}`)

    // Act
    const twiceOutcome = await outcomeOf(twice, root)
    const thriceOutcome = await outcomeOf(thrice, root)

    // Assert
    assert.deepEqual(
      [twiceOutcome, thriceOutcome],
      [
        'rendered',
        'The Wiki has 4668 characters of explanation (CJK characters counted twice; not counted: 132 in repeated sentences) but needs at least 4800 for 12 explained code files: write longer explanations, starting with the thinnest pages: page-1.html (1134 characters; not counted: 66 in repeated sentences), page-2.html (1134 characters; not counted: 66 in repeated sentences), index.html (1200 characters), page-3.html (1200 characters). 2 pages have fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-1.html (1134 characters; not counted: 66 in repeated sentences), page-2.html (1134 characters; not counted: 66 in repeated sentences).',
      ],
    )
  })
})

// Value: protects=the edges of a list of names: a sentence of four or more words of which at least 60% are names does not count, while three names alone, prose with half its words names, or nine words with five names (56%) count; fails_when=the word limit moves from 4 or the share limit from 60%, so ordinary prose about two functions stops counting or a short list counts; why_new=Cycle 0115 (C114-W4, list limits 4 words and 60%), review round (two limit mutations survived); seam=none (the real renderer); no_claim=other ways to write a list
test('a sentence of four or more words with at least 60% names does not count, while three names alone or prose with fewer names counts', async () => {
  await inProject(async (root) => {
    // Arrange
    // Page 3 holds 1,200 characters only when its last sentence counts.
    const withSentence = async (sentence) => {
      const manifest = await wikiOf(root, {
        fileCount: 12,
        pageTexts: [1500, 1500, 1500, 1200 - sentence.length],
        childCount: 3,
        diagramCounts: [2, 2, 1, 1],
      })
      manifest.pages[3].contentHtml = manifest.pages[3].contentHtml.replace(
        '</p>',
        `</p><p>${sentence}</p>`,
      )
      return manifest
    }
    const sixtyPercent = await withSentence(
      'useQuery and QueryClient call fetchQuery',
    )
    const fourWords = await withSentence('useQuery, QueryClient and fetchQuery')
    const threeNames = await withSentence('useQuery, QueryClient, fetchQuery')
    const halfNames = await withSentence('useQuery reads the QueryClient')
    const fiftySixPercent = await withSentence(
      'useQuery and QueryClient call fetchQuery with QueryCache in onlineManager',
    )

    // Act
    const outcomes = [
      await outcomeOf(sixtyPercent, root),
      await outcomeOf(fourWords, root),
      await outcomeOf(threeNames, root),
      await outcomeOf(halfNames, root),
      await outcomeOf(fiftySixPercent, root),
    ]

    // Assert
    assert.deepEqual(outcomes, [
      '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (1160 characters; not counted: 40 in lists of names).',
      '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (1164 characters; not counted: 36 in lists of names).',
      'rendered',
      'rendered',
      'rendered',
    ])
  })
})

// Value: protects=the edge of copied text: a copied sentence of 40 characters does not count, a 39-character one (a short phrase any explanation may share with the source) counts, and text matching a file the page does not cite counts; fails_when=the 40-character limit moves either way, or a page is matched against files other pages cite; why_new=Cycle 0115 (C114-W4, copied text from 40 characters), review round (cited-by-this-page gap); seam=none (the real renderer); no_claim=that copied text below 40 characters is explanation
test('a sentence of 40 characters copied from a cited source does not count, while one of 39 characters or one matching an uncited file counts', async () => {
  await inProject(async (root) => {
    // Arrange
    // Page 3 cites docs/cache.ts and holds 1,200 characters only when its copied sentence counts.
    const withCopied = async (sentence, { cited = true } = {}) => {
      const manifest = await wikiOf(root, {
        fileCount: 11,
        pageTexts: [1500, 1500, 1500, 1200 - sentence.length],
        childCount: 3,
        diagramCounts: [2, 2, 1, 1],
        extraFiles: {
          'docs/cache.ts': `// ${sentence}\nexport const cache = new Map();\n`,
        },
      })
      // Every file is cited by the index page; page 3 cites docs/cache.ts only when asked.
      if (cited)
        manifest.pages[3].sources.push({ path: 'docs/cache.ts', line: 1 })
      manifest.pages[3].contentHtml = manifest.pages[3].contentHtml.replace(
        '</p>',
        `</p><p>${sentence}</p>`,
      )
      return manifest
    }
    const forty = await withCopied('The cache keeps every query result here.')

    // Act
    // Each Wiki is rendered before the next one rewrites docs/cache.ts, whose hash it records.
    const fortyOutcome = await outcomeOf(forty, root)
    const thirtyNine = await withCopied(
      'The cache keeps each query result here.',
    )
    const thirtyNineOutcome = await outcomeOf(thirtyNine, root)
    const uncited = await withCopied(
      'The cache keeps every query result here.',
      { cited: false },
    )
    const uncitedOutcome = await outcomeOf(uncited, root)

    // Assert
    assert.deepEqual(
      [fortyOutcome, thirtyNineOutcome, uncitedOutcome],
      [
        '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (1160 characters; not counted: 40 copied from cited sources).',
        'rendered',
        'rendered',
      ],
    )
  })
})

// Value: protects=the sentence a reader sees: 。, ! and ? before a space, a line break, a list item, a table cell, a heading and a division each end one, so a sentence repeated three times inside one block is still a repeat; fails_when=a splitter is dropped, so three uses read as one unique sentence and template text counts in full; why_new=Cycle 0115 review round (no test covered the splitters; div and tr added); seam=none (the real renderer); no_claim=every way HTML can separate text
test('three uses of a sentence count once whether 。, !, ?, a line break, list items, table cells, headings or divisions separate them', async () => {
  await inProject(async (root) => {
    // Arrange
    // Page 3 holds 1,100 characters of filler and three uses of one short sentence, so it is a stub either way and its refusal shows what counted.
    const separated = {
      '。': '<p>データを読む。データを読む。データを読む。</p>',
      '!': '<p>Data moves on! Data moves on! Data moves on!</p>',
      '?': '<p>Who reads it? Who reads it? Who reads it?</p>',
      '<br>': '<p>Data moves on<br>Data moves on<br>Data moves on</p>',
      '</li>':
        '<ul><li>Data moves on</li><li>Data moves on</li><li>Data moves on</li></ul>',
      '</td>':
        '<table><tr><td>Data moves on</td><td>Data moves on</td><td>Data moves on</td></tr></table>',
      '</h3>':
        '<h3>Data moves on</h3><h3>Data moves on</h3><h3>Data moves on</h3>',
      '</div>':
        '<div>Data moves on</div><div>Data moves on</div><div>Data moves on</div>',
    }
    const outcomes = {}

    // Act
    for (const [separator, content] of Object.entries(separated)) {
      const manifest = await wikiOf(root, {
        fileCount: 12,
        pageTexts: [1500, 1500, 1500, 1100],
        childCount: 3,
        diagramCounts: [2, 2, 1, 1],
      })
      manifest.pages[3].contentHtml = manifest.pages[3].contentHtml.replace(
        '</p>',
        `</p>${content}`,
      )
      outcomes[separator] = await outcomeOf(manifest, root)
    }

    // Assert
    const stub =
      '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen '
    assert.deepEqual(outcomes, {
      '。': `${stub}page-3.html (1114 characters; not counted: 28 in repeated sentences).`,
      '!': `${stub}page-3.html (1114 characters; not counted: 28 in repeated sentences).`,
      '?': `${stub}page-3.html (1113 characters; not counted: 26 in repeated sentences).`,
      '<br>': `${stub}page-3.html (1113 characters; not counted: 26 in repeated sentences).`,
      '</li>': `${stub}page-3.html (1113 characters; not counted: 26 in repeated sentences).`,
      '</td>': `${stub}page-3.html (1113 characters; not counted: 26 in repeated sentences).`,
      '</h3>': `${stub}page-3.html (1113 characters; not counted: 26 in repeated sentences).`,
      '</div>': `${stub}page-3.html (1113 characters; not counted: 26 in repeated sentences).`,
    })
  })
})

// Value: protects=the template a Wiki writes for every module, path or file, which differs only in that name; fails_when=the code-name, path or file-name placeholder of the sentence form is dropped, so a template that varies only names counts in full; why_new=Cycle 0115 review round (only the number placeholder was tested); seam=none (the real renderer); no_claim=templates that vary their wording
test('a template used three times that differs only in a code name, a path or a file name counts once', async () => {
  await inProject(async (root) => {
    // Arrange
    // Page 3 holds 1,100 characters of filler and three template sentences.
    const templates = {
      codeNames:
        '<p>The QueryClient keeps its state for the observers.</p><p>The QueryCache keeps its state for the observers.</p><p>The MutationCache keeps its state for the observers.</p>',
      paths:
        '<p>Read packages/alpha before the rest.</p><p>Read packages/beta before the rest.</p><p>Read packages/gamma before the rest.</p>',
      fileNames:
        '<p>The file hydration.ts holds this step.</p><p>The file retryer.ts holds this step.</p><p>The file notify.ts holds this step.</p>',
    }
    const outcomes = {}

    // Act
    for (const [kind, content] of Object.entries(templates)) {
      const manifest = await wikiOf(root, {
        fileCount: 12,
        pageTexts: [1500, 1500, 1500, 1100],
        childCount: 3,
        diagramCounts: [2, 2, 1, 1],
      })
      manifest.pages[3].contentHtml = manifest.pages[3].contentHtml.replace(
        '</p>',
        `</p>${content}`,
      )
      outcomes[kind] = await outcomeOf(manifest, root)
    }

    // Assert
    const stub =
      '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen '
    assert.deepEqual(outcomes, {
      codeNames: `${stub}page-3.html (1150 characters; not counted: 101 in repeated sentences).`,
      paths: `${stub}page-3.html (1136 characters; not counted: 71 in repeated sentences).`,
      fileNames: `${stub}page-3.html (1138 characters; not counted: 71 in repeated sentences).`,
    })
  })
})

// Value: protects=the docstring copied into a page with its names set in <code>, which a reader sees as the source's own words; fails_when=an inline tag reads as a space, so "QueryCache ." no longer matches the source's "QueryCache." and the copy counts; why_new=Cycle 0115 review round (inline tags defeated the copied-text rule); seam=none (the real renderer); no_claim=copies that change words
test('a docstring copied with its names in <code> is copied text and does not count', async () => {
  await inProject(async (root) => {
    // Arrange
    // The 52-character sentence is copied from docs/observer.ts, which page 3 cites.
    const manifest = await wikiOf(root, {
      fileCount: 11,
      pageTexts: [1500, 1500, 1500, 1148],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
      extraFiles: {
        'docs/observer.ts':
          '/**\n * A `QueryObserver` watches one query in the `QueryCache`.\n */\nexport const observer = 1;\n',
      },
    })
    manifest.pages[3].sources.push({ path: 'docs/observer.ts', line: 1 })
    manifest.pages[3].contentHtml = manifest.pages[3].contentHtml.replace(
      '</p>',
      '</p><p>A <code>QueryObserver</code> watches one query in the <code>QueryCache</code>.</p>',
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      '1 page has fewer than 1200 characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen page-3.html (1148 characters; not counted: 52 copied from cited sources).',
    )
  })
})

// Value: protects=the Japanese learner whose Wiki names a file inside a sentence with no spaces; fails_when=a path swallows the rest of the sentence, so three different Japanese sentences that each name a path read as one repeated form and two of them stop counting; why_new=Cycle 0115 review round (Japanese path collapse); seam=none (the real renderer); no_claim=that Japanese template text is caught as well as English
test('three different Japanese sentences that each name a path all count', async () => {
  await inProject(async (root) => {
    // Arrange
    // The paths are written into the Japanese text with no space around them; the three sentences weigh 32, 34 and 41, and page 3 holds 1,200 characters only when all three count.
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1500, 1500, 1500, 1093],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })
    manifest.pages[3].contentHtml = manifest.pages[3].contentHtml.replace(
      '</p>',
      '</p><p>src/a.tsはキャッシュを管理する。lib/c/d.tsを読み込んで状態を返す。packages/x/y.tsが購読者に変更を知らせる。</p>',
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})
