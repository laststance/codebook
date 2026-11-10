import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/** The text of included file `index`; every file holds one distinct line so a diagram can quote it. */
const fileText = (index) => `export const f${index} = ${index};\n`

/**
 * Writes `fileCount` code files into a project folder and answers a Wiki manifest shaped by the options.
 * Called by every test of the renderer's depth check.
 * @param root - The project folder.
 * @param options - `fileCount` included code files `f<i>.ts`; `pageTexts` the weighted article text length of each page (the first is `index.html`); `childCount` pages after the first that have the first as parent; `diagramCounts` the number of diagrams on each page; `character` the filler character and `characterWeight` its weight (2 for a CJK one, the default for any character but `x`); `coverageExceptions` entries.
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
    // The heading "Flow" adds 4 characters and a separating space to the article text.
    const filler = character.repeat(
      Math.ceil(Math.max(length - 5, 0) / characterWeight),
    )
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
      path: pageIndex === 0 ? 'index.html' : `page-${pageIndex}.html`,
      title: `Page ${pageIndex}`,
      section: 'Guide',
      ...(pageIndex >= 1 && pageIndex <= childCount
        ? { parent: 'index.html' }
        : {}),
      contentHtml: `<h2 id="flow">Flow</h2><p>${filler}</p>${slots}`,
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

// Value: protects=the learner who gets one-sentence mentions of every code file (about 6,300 characters for 51 files in the native trial); fails_when=a 12-file Wiki whose article text is under 500 characters per file is rendered, or the refusal does not name the thinnest pages; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that longer text explains better
test('a 12-file Wiki with 4,800 characters of article text is refused with the explanation sentence naming the thinnest pages', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1200, 1200, 1200, 1200],
      childCount: 3,
      diagramCounts: [2, 2, 1, 1],
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 4800 characters of article text (CJK characters counted twice) but needs at least 6000 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (1200 characters), page-1.html (1200 characters), page-2.html (1200 characters), page-3.html (1200 characters).',
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
      '1 page has fewer than 1200 characters of article text (CJK characters counted twice): deepen page-3.html (1100 characters).',
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
      'The Wiki has 0 pages with a parent but needs at least 2: add child pages under subsystem chapters for their modules and flows. 2 pages have no diagram but every page needs at least one: add an architecture, flow or sequence diagram to index.html, page-1.html. The Wiki has 0 diagrams but needs at least 3 for 2 pages (one per page and about three per two pages in total): add architecture, flow or sequence diagrams with source-backed nodes and edges. The Wiki has 200 characters of article text (CJK characters counted twice) but needs at least 6000 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (100 characters), page-1.html (100 characters). 2 pages have fewer than 1200 characters of article text (CJK characters counted twice): deepen index.html (100 characters), page-1.html (100 characters).',
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

// Value: protects=the owner of a very large repository from a text requirement that grows without limit; fails_when=the required article text exceeds 120,000 characters for 500 explained files, so a Wiki of exactly 120,000 characters is refused; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that 120,000 characters explain 500 files
test('a 500-file Wiki with exactly 120,000 characters of article text is rendered because the requirement is capped', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 500,
      pageTexts: Array.from({ length: 64 }, () => 1875),
      childCount: 63,
      diagramCounts: Array.from({ length: 64 }, () => 2),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the cap's edge: one character below it is still refused; fails_when=a 500-file Wiki of 119,999 characters is rendered, or the refusal names the uncapped 125,000; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the sentence lists every thin page
test('a 500-file Wiki with 119,999 characters of article text is refused and the refusal requires 120,000', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 500,
      pageTexts: [1874, ...Array.from({ length: 63 }, () => 1875)],
      childCount: 63,
      diagramCounts: Array.from({ length: 64 }, () => 2),
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 119999 characters of article text (CJK characters counted twice) but needs at least 120000 for 500 explained code files: write longer explanations, starting with the thinnest pages: index.html (1874 characters), page-1.html (1875 characters), page-10.html (1875 characters), page-11.html (1875 characters), page-12.html (1875 characters), page-13.html (1875 characters), page-14.html (1875 characters), page-15.html (1875 characters), page-16.html (1875 characters), page-17.html (1875 characters).',
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
      'The Wiki has 3000 characters of article text (CJK characters counted twice) but needs at least 6000 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (750 characters), page-1.html (750 characters), page-2.html (750 characters), page-3.html (750 characters). 4 pages have fewer than 1200 characters of article text (CJK characters counted twice): deepen index.html (750 characters), page-1.html (750 characters), page-2.html (750 characters), page-3.html (750 characters).',
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
      'The Wiki has 3 pages but needs at least 4 for 25 explained code files (about one page per 8 files): split the large chapters by module and flow.',
    )
  })
})

// Value: protects=the Korean, Chinese, Japanese and fullwidth learner whose characters carry about twice the content; fails_when=a page of 750 Han, Katakana, Hangul, fullwidth Latin, long-vowel, middle-dot or CJK punctuation characters weighs less than 2 each, so a Wiki of them is refused as thin; why_new=C113 review round; seam=none (the real renderer); no_claim=that the text is good
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
    for (const character of ['漢', 'カ', '한', 'Ａ', 'ー', '・', '、', '。']) {
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
      '。': 'rendered',
    })
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
        'The Wiki has 3000 characters of article text (CJK characters counted twice) but needs at least 6000',
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
      manifest.pages[3].contentHtml = `<h2 id="flow">Flow</h2><p>${padding}</p>${manifest.pages[3].contentHtml.slice(manifest.pages[3].contentHtml.indexOf('<figure'))}`
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
        '1 page has fewer than 1200 characters of article text (CJK characters counted twice): deepen page-3.html (785 characters).',
        '1 page has fewer than 1200 characters of article text (CJK characters counted twice): deepen page-3.html (325 characters).',
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
