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
 * @param options - `fileCount` included code files `f<i>.ts`; `pageTexts` the article text length of each page (the first is `index.html`); `childCount` pages after the first that have the first as parent; `diagramCount` diagrams, one on each of the first pages; `coverageExceptions` entries.
 * @returns The manifest, as an agent writes it into a candidate; the index page cites every file.
 * @example await wikiOf(root, { fileCount: 12, pageTexts: [800, 800, 800, 800], childCount: 3, diagramCount: 2 })
 */
async function wikiOf(
  root,
  {
    fileCount,
    pageTexts,
    childCount,
    diagramCount,
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
  const diagrams = []
  const pages = pageTexts.map((length, pageIndex) => {
    const hasDiagram = pageIndex < diagramCount
    // The heading "Flow" adds 4 characters and a separating space to the article text.
    const filler = 'x'.repeat(Math.max(length - 5, 0))
    const slot = hasDiagram
      ? `<figure data-codebook-diagram="diagram-${pageIndex}"></figure>`
      : ''
    if (hasDiagram)
      diagrams.push({
        id: `diagram-${pageIndex}`,
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
      })
    return {
      path: pageIndex === 0 ? 'index.html' : `page-${pageIndex}.html`,
      title: `Page ${pageIndex}`,
      section: 'Guide',
      ...(pageIndex >= 1 && pageIndex <= childCount
        ? { parent: 'index.html' }
        : {}),
      contentHtml: `<h2 id="flow">Flow</h2><p>${filler}</p>${slot}`,
      sources:
        pageIndex === 0
          ? Object.keys(files).map((path) => ({ path, line: 1 }))
          : [{ path: 'f0.ts', line: 1 }],
      outline: [{ id: 'flow', label: 'Flow' }],
      ...(hasDiagram ? { diagrams: [diagrams.at(-1)] } : {}),
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

// Value: protects=the learner who opens an LLM Wiki of a 12-file repository and finds a deep chapter tree, a diagram per three pages and real explanation; fails_when=the renderer rejects a Wiki that meets all four depth rules; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the content is good
test('a 12-file Wiki with child pages, diagrams, enough text and no stub page is rendered', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [800, 800, 800, 800],
      childCount: 3,
      diagramCount: 2,
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
      pageTexts: [800, 800, 800, 800],
      childCount: 0,
      diagramCount: 2,
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

// Value: protects=the learner who gets a Wiki with one diagram in all of it (the native trial); fails_when=a 12-file Wiki of 4 pages with 1 diagram is rendered, or the refusal omits the measured and the required count; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that a diagram is meaningful
test('a 12-file Wiki of four pages with one diagram is refused with the diagram sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [800, 800, 800, 800],
      childCount: 3,
      diagramCount: 1,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 1 diagrams but needs at least 2 for 4 pages: add architecture, flow or sequence diagrams with source-backed nodes and edges.',
    )
  })
})

// Value: protects=the learner who gets one-sentence mentions of every code file (about 6,300 characters for 51 files in the native trial); fails_when=a 12-file Wiki whose article text is under 250 characters per file is rendered, or the refusal does not name the thinnest pages; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that longer text explains better
test('a 12-file Wiki with 1,204 characters of article text is refused with the explanation sentence naming the thinnest pages', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [301, 301, 301, 301],
      childCount: 3,
      diagramCount: 2,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 1204 characters of article text but needs at least 3000 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (301 characters), page-1.html (301 characters), page-2.html (301 characters), page-3.html (301 characters).',
    )
  })
})

// Value: protects=the learner who lands on a stub page of one sentence among otherwise long pages; fails_when=a 12-file Wiki with one 100-character page is rendered because the total text is enough, or the refusal does not name that page; why_new=Cycle 0113 (C113-W3); seam=none (the real renderer); no_claim=that the other pages are good
test('a 12-file Wiki with one 100-character page is refused with the stub page sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, {
      fileCount: 12,
      pageTexts: [1200, 1200, 1200, 100],
      childCount: 3,
      diagramCount: 2,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      '1 page has fewer than 300 characters of article text: deepen page-3.html (100 characters).',
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
      diagramCount: 0,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 0 pages with a parent but needs at least 2: add child pages under subsystem chapters for their modules and flows. The Wiki has 0 diagrams but needs at least 1 for 2 pages: add architecture, flow or sequence diagrams with source-backed nodes and edges. The Wiki has 200 characters of article text but needs at least 3000 for 12 explained code files: write longer explanations, starting with the thinnest pages: index.html (100 characters), page-1.html (100 characters). 2 pages have fewer than 300 characters of article text: deepen index.html (100 characters), page-1.html (100 characters).',
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
      diagramCount: 0,
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
      diagramCount: 0,
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
      pageTexts: Array.from({ length: 40 }, () => 3000),
      childCount: 39,
      diagramCount: 14,
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
      pageTexts: [2999, ...Array.from({ length: 39 }, () => 3000)],
      childCount: 39,
      diagramCount: 14,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki has 119999 characters of article text but needs at least 120000 for 500 explained code files: write longer explanations, starting with the thinnest pages: index.html (2999 characters), page-1.html (3000 characters), page-10.html (3000 characters), page-11.html (3000 characters), page-12.html (3000 characters), page-13.html (3000 characters), page-14.html (3000 characters), page-15.html (3000 characters), page-16.html (3000 characters), page-17.html (3000 characters).',
    )
  })
})
