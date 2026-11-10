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

/**
 * Builds the address of an inline editor source link, as an agent writes it into an article.
 * Called by the inline link tests below.
 * @param scheme - `vscode://laststance.codebook` or another spelling of the scheme and authority.
 * @param parameters - The query parameters by name; an `undefined` value leaves the parameter out.
 * @param separator - What separates the parameters (`&amp;` as in HTML, or a plain `&`).
 * @returns The address.
 * @example inlineLinkOf('vscode://laststance.codebook', { path: 'b.ts', line: '1' }, '&amp;')
 */
function inlineLinkOf(scheme, parameters, separator) {
  const pairs = Object.entries(parameters)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
  return `${scheme}/source?${pairs.join(separator)}`
}

/** Wraps an address in the article of the overview page. */
const articleWith = (address) =>
  `<h2 id="flow">Flow</h2><p>See <a href="${address}">b</a>.</p>`

const B_HASH = createHash('sha256').update(B).digest('hex')
const UNEXPLAINED_B =
  'The Wiki leaves 1 included code file unexplained: lib/b.ts. Explain each in a page and cite it, or list it (or its folder ending with /) under coverageExceptions with the reason it needs no explanation.'

// Value: protects=the coverage gate against an inline link the editor cannot honor (no hash, wrong hash, line past the end, line 0, other root); fails_when=such an inline link counts as citing the file; why_new=C113 review round; seam=none (the real renderer); no_claim=that a valid link explains the file well
test('an inline source link without the indexed hash, with a wrong hash, a line past the end, line 0 or another root does not cover the file', async () => {
  await inProject(async (root) => {
    // Arrange
    const scheme = 'vscode://laststance.codebook'
    const valid = { root, path: 'lib/b.ts', line: '1', sha256: B_HASH }
    const variants = {
      noHash: { ...valid, sha256: undefined },
      wrongHash: { ...valid, sha256: 'a'.repeat(64) },
      pastEnd: { ...valid, line: '3' },
      lineZero: { ...valid, line: '0' },
      otherRoot: { ...valid, root: '/elsewhere' },
    }
    const outcomes = {}

    // Act
    for (const [name, parameters] of Object.entries(variants)) {
      const manifest = await manifestOf(
        root,
        { 'a.ts': A, 'lib/b.ts': B },
        { contentHtml: articleWith(inlineLinkOf(scheme, parameters, '&amp;')) },
      )
      outcomes[name] = await outcomeOf(manifest, root)
    }

    // Assert
    assert.deepEqual(outcomes, {
      noHash: UNEXPLAINED_B,
      wrongHash: UNEXPLAINED_B,
      pastEnd: UNEXPLAINED_B,
      lineZero: UNEXPLAINED_B,
      otherRoot: UNEXPLAINED_B,
    })
  })
})

// Value: protects=an agent that writes the editor scheme in another letter case or uses the cursor scheme; fails_when=VSCODE://Laststance.Codebook, or a cursor:// link with plain & separators and no root, does not count as a citation; why_new=C113 review round; seam=none (the real renderer); no_claim=that the link opens the right line
test('an inline source link with an upper-case scheme and authority, and a cursor link with plain ampersands and no root, cover the file', async () => {
  await inProject(async (root) => {
    // Arrange
    const parameters = { path: 'lib/b.ts', line: '1', sha256: B_HASH }
    const upperCase = await manifestOf(
      root,
      { 'a.ts': A, 'lib/b.ts': B },
      {
        contentHtml: articleWith(
          inlineLinkOf('VSCODE://Laststance.Codebook', parameters, '&amp;'),
        ),
      },
    )
    const cursor = await manifestOf(
      root,
      { 'a.ts': A, 'lib/b.ts': B },
      {
        contentHtml: articleWith(
          inlineLinkOf('cursor://laststance.codebook', parameters, '&'),
        ),
      },
    )

    // Act
    const upperCaseOutcome = await outcomeOf(upperCase, root)
    const cursorOutcome = await outcomeOf(cursor, root)

    // Assert
    assert.deepEqual(
      [upperCaseOutcome, cursorOutcome],
      ['rendered', 'rendered'],
    )
  })
})

// Value: protects=the refusal text for a large repository; fails_when=the refusal names more or fewer than the first 40 sorted paths or loses the "and 2 more" tail; why_new=C113 review round (mutation gap); seam=none (the real renderer); no_claim=none
test('the coverage refusal names the first 40 of 42 uncited files and counts the 2 more', async () => {
  await inProject(async (root) => {
    // Arrange
    const many = Object.fromEntries(
      Array.from({ length: 42 }, (_, index) => [
        `m/f${String(index).padStart(2, '0')}.ts`,
        B,
      ]),
    )
    const manifest = await manifestOf(root, { 'a.ts': A, ...many })

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    const names = Object.keys(many).slice(0, 40).join(', ')
    assert.equal(
      outcome,
      `The Wiki leaves 42 included code files unexplained: ${names}, and 2 more. Explain each in a page and cite it, or list it (or its folder ending with /) under coverageExceptions with the reason it needs no explanation.`,
    )
  })
})

// Value: protects=the exception list's reason limit; fails_when=a 300-character reason is refused or a 301-character one is accepted; why_new=C113 review round (boundary gap); seam=none (the real renderer); no_claim=none
test('a coverage exception reason of exactly 300 characters is accepted and one of 301 is refused', async () => {
  await inProject(async (root) => {
    // Arrange
    const withReason = (length) =>
      manifestOf(
        root,
        { 'a.ts': A, 'x.ts': B },
        {},
        { coverageExceptions: [{ path: 'x.ts', reason: 'r'.repeat(length) }] },
      )

    // Act
    const at300 = await outcomeOf(await withReason(300), root)
    const at301 = await outcomeOf(await withReason(301), root)

    // Assert
    assert.deepEqual(
      [at300, at301],
      [
        'rendered',
        'The coverage exception for x.ts needs a reason of 1–300 characters saying why that code needs no explanation.',
      ],
    )
  })
})

// Value: protects=the exception list's shape; fails_when=a parent-relative or absolute path or a plain string is accepted as an exception, or an exception for x.ts also covers x.tsx; why_new=C113 review round (mutation gaps); seam=none (the real renderer); no_claim=none
test('coverage exceptions with a parent-relative path, an absolute path or a string are refused, and an exception for x.ts leaves x.tsx unexplained', async () => {
  await inProject(async (root) => {
    // Arrange
    const withExceptions = (coverageExceptions) =>
      manifestOf(
        root,
        { 'a.ts': A, 'x.ts': B, 'x.tsx': B },
        {},
        { coverageExceptions },
      )

    // Act
    const parentPath = await outcomeOf(
      await withExceptions([{ path: '../x.ts', reason: 'Up.' }]),
      root,
    )
    const absolutePath = await outcomeOf(
      await withExceptions([{ path: '/abs.ts', reason: 'Abs.' }]),
      root,
    )
    const notArray = await outcomeOf(await withExceptions('gen/'), root)
    const exactMatch = await outcomeOf(
      await withExceptions([{ path: 'x.ts', reason: 'Just this file.' }]),
      root,
    )

    // Assert
    const pathSentence =
      'A coverage exception needs a relative path of an included code file, or of a folder ending with /.'
    assert.deepEqual(
      [parentPath, absolutePath, notArray, exactMatch],
      [
        pathSentence,
        pathSentence,
        'coverageExceptions must be an array of { path, reason } entries.',
        'The Wiki leaves 1 included code file unexplained: x.tsx. Explain each in a page and cite it, or list it (or its folder ending with /) under coverageExceptions with the reason it needs no explanation.',
      ],
    )
  })
})

// Value: protects=the coverage gate against an address that is no link: a commented-out one, one a code example shows as escaped text and one in an attribute other than href; fails_when=such a mention counts as citing lib/b.ts; why_new=C113 review round (CodeRabbit); seam=none (the real renderer); no_claim=none
test('a source address only in an HTML comment, in escaped code text or in a title attribute does not cover the file', async () => {
  await inProject(async (root) => {
    // Arrange
    const address = inlineLinkOf(
      'vscode://laststance.codebook',
      { root, path: 'lib/b.ts', line: '1', sha256: B_HASH },
      '&amp;',
    )
    const bodies = {
      comment: `<!-- <a href="${address}">b</a> -->`,
      escapedCode: `<code>&lt;a href="${address}"&gt;b&lt;/a&gt;</code>`,
      title: `<span title="${address}">b</span>`,
    }
    const outcomes = {}

    // Act
    for (const [name, body] of Object.entries(bodies)) {
      const manifest = await manifestOf(
        root,
        { 'a.ts': A, 'lib/b.ts': B },
        { contentHtml: `<h2 id="flow">Flow</h2><p>${body}</p>` },
      )
      outcomes[name] = await outcomeOf(manifest, root)
    }

    // Assert
    assert.deepEqual(outcomes, {
      comment: UNEXPLAINED_B,
      escapedCode: UNEXPLAINED_B,
      title: UNEXPLAINED_B,
    })
  })
})
