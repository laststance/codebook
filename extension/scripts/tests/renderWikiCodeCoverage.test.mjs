import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/**
 * Writes the given files into a project folder and answers the Wiki manifest of one overview page.
 * Called by every test of the renderer's code coverage check.
 * @param root - The project folder.
 * @param files - File text by relative path; every one is an included source.
 * @param pageOverrides - Fields of the overview page that replace the defaults (`sources`, `contentHtml`, `diagrams`).
 * @param manifestOverrides - Fields of the manifest that replace the defaults (`coverageExceptions`).
 * @returns The manifest, as an agent writes it into a candidate.
 * @example await manifestOf(root, { 'a.ts': 'export const a = 1;\n' })
 */
async function manifestOf(
  root,
  files,
  pageOverrides = {},
  manifestOverrides = {},
) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
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
    pages: [
      {
        path: 'index.html',
        title: 'Overview',
        section: 'Guide',
        contentHtml: '<h2 id="flow">Flow</h2><p>Text.</p>',
        sources: [{ path: 'a.ts', line: 1 }],
        outline: [{ id: 'flow', label: 'Flow' }],
        ...pageOverrides,
      },
    ],
    ...manifestOverrides,
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
    await mkdtemp(join(tmpdir(), 'codebook-render-coverage-')),
  )
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const A = 'export const a = 1;\n'
const B = 'export const b = 2;\n'

// Value: protects=the learner who opens a published LLM Wiki and expects every application module of the repository to be explained: the agent once published a thin Wiki that left the login page and the invoice pages cited by no page; fails_when=the renderer accepts a Wiki that leaves an included code file uncited and unlisted, or its refusal does not name the file; why_new=Cycle 0113 (C113-W1); seam=none (the real renderer); no_claim=that a cited file is explained well
test('a Wiki that leaves an included code file cited by no page is refused, and the refusal names that file', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, {
      'a.ts': A,
      'app/login/page.tsx': B,
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki leaves 1 included code file unexplained: app/login/page.tsx. Explain each in a page and cite it, or list it (or its folder ending with /) under coverageExceptions with the reason it needs no explanation.',
    )
  })
})

// Value: protects=an agent that explains a module in prose and cites it with an inline editor link; fails_when=a code file cited only by an inline vscode:// source link (with &amp; between its parameters) is counted as unexplained; why_new=Cycle 0113 (C113-W1); seam=none (the real renderer); no_claim=that the link opens the right line
test('a code file cited only by an inline source link of the article counts as explained', async () => {
  await inProject(async (root) => {
    // Arrange
    const link = `vscode://laststance.codebook/source?root=${encodeURIComponent(root)}&amp;path=lib%2Fb.ts&amp;line=1&amp;sha256=${createHash('sha256').update(B).digest('hex')}`
    const manifest = await manifestOf(
      root,
      { 'a.ts': A, 'lib/b.ts': B },
      {
        contentHtml: `<h2 id="flow">Flow</h2><p>See <a href="${link}">b</a>.</p>`,
      },
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=an agent that explains a module only through a diagram's cited nodes and edges; fails_when=a code file cited only by a diagram node or edge source is counted as unexplained; why_new=Cycle 0113 (C113-W1); seam=none (the real renderer and its diagram records); no_claim=that the diagram is meaningful
test('a code file cited only by a diagram node or an edge source counts as explained', async () => {
  await inProject(async (root) => {
    // Arrange
    const reference = (path, quote) => [
      { path, line: 1, endLine: 1, quote: quote.trim() },
    ]
    const diagram = {
      id: 'flow-diagram',
      title: 'Flow',
      caption: 'One call.',
      kind: 'flow',
      nodes: [
        {
          id: 'one',
          label: 'one',
          row: 0,
          column: 0,
          sources: reference('a.ts', A),
        },
        {
          id: 'two',
          label: 'two',
          row: 0,
          column: 1,
          sources: reference('b.ts', B),
        },
      ],
      edges: [
        {
          id: 'call',
          from: 'one',
          to: 'two',
          label: 'calls',
          kind: 'call',
          sources: reference('c.ts', B),
        },
      ],
    }
    const manifest = await manifestOf(
      root,
      { 'a.ts': A, 'b.ts': B, 'c.ts': B },
      {
        contentHtml:
          '<h2 id="flow">Flow</h2><figure data-codebook-diagram="flow-diagram"></figure>',
        diagrams: [diagram],
      },
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the owner of generated or vendored code that needs no chapter; fails_when=an exception by file or by folder prefix does not let publishing proceed, or a file outside the listed ones is let through; why_new=Cycle 0113 (C113-W1); seam=none (the real renderer); no_claim=that the reason is true
test('a code file listed under coverageExceptions by its path, and one inside a listed folder ending with a slash, need no citation', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'a.ts': A,
      'gen/api.ts': B,
      'gen/deep/types.ts': B,
      'x.ts': B,
    }
    const folderException = { path: 'gen/', reason: 'Generated API client.' }
    const fileException = { path: 'x.ts', reason: 'A trivial re-export.' }
    const listedBoth = await manifestOf(
      root,
      files,
      {},
      { coverageExceptions: [folderException, fileException] },
    )
    const listedFolderOnly = await manifestOf(
      root,
      files,
      {},
      { coverageExceptions: [folderException] },
    )

    // Act
    const outcome = await outcomeOf(listedBoth, root)
    const outcomeWithoutFileException = await outcomeOf(listedFolderOnly, root)

    // Assert
    assert.deepEqual(
      [outcome, outcomeWithoutFileException],
      [
        'rendered',
        'The Wiki leaves 1 included code file unexplained: x.ts. Explain each in a page and cite it, or list it (or its folder ending with /) under coverageExceptions with the reason it needs no explanation.',
      ],
    )
  })
})

// Value: protects=a learner's Wiki of a repository full of configuration and style files; fails_when=a .json, .css or .md included source is demanded a citation, so no Wiki of such a repository could be published; why_new=Cycle 0113 (C113-W1); seam=none (the real renderer); no_claim=none
test('included configuration, style and documentation files need no citation', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, {
      'a.ts': A,
      'package.json': '{}\n',
      'styles/app.css': 'a { color: red; }\n',
      'README.md': '# Title\n',
    })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the integrity of the exception list: an agent that keeps an exception after the code moved or never gives a reason; fails_when=a stale exception, an exception without a reason or a repeated one is accepted; why_new=Cycle 0113 (C113-W1); seam=none (the real renderer); no_claim=none
test('a coverage exception that matches no included code file, one without a reason and a repeated one are refused', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = { 'a.ts': A, 'b.ts': B }
    const withExceptions = (coverageExceptions) =>
      manifestOf(
        root,
        files,
        {
          sources: [
            { path: 'a.ts', line: 1 },
            { path: 'b.ts', line: 1 },
          ],
        },
        { coverageExceptions },
      )

    // Act
    const stale = await outcomeOf(
      await withExceptions([{ path: 'gone.ts', reason: 'Was generated.' }]),
      root,
    )
    const noReason = await outcomeOf(
      await withExceptions([{ path: 'b.ts', reason: '  ' }]),
      root,
    )
    const repeated = await outcomeOf(
      await withExceptions([
        { path: 'b.ts', reason: 'One.' },
        { path: 'b.ts', reason: 'Two.' },
      ]),
      root,
    )

    // Assert
    assert.deepEqual(
      [stale, noReason, repeated],
      [
        'The coverage exception for gone.ts matches no included code file; remove it.',
        'The coverage exception for b.ts needs a reason of 1–300 characters saying why that code needs no explanation.',
        'The coverage exception for b.ts is listed twice.',
      ],
    )
  })
})
