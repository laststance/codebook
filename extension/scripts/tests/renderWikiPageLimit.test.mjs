import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  prepareWikiStage,
  publishWiki,
} from '../../skills/codebook/publish-wiki.mjs'
import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/**
 * Reads the reader's page file limit from the extension's constants source, not from `dist`: the package lane rebuilds `dist` while its tests run, so a script test that imports it fails at random (Cycle 0046 row 1160, Cycle 0047 row 105).
 * Called once by the tests of the renderer's page size limit, which hold the renderer's own number equal to it.
 * @returns `WIKI_PAGE_FILE_LIMIT_BYTES` as `extension/src/constants.ts` writes it, or `NaN` when the file no longer writes it as one number.
 * @example await readerPageFileLimit() // => 2097152
 */
async function readerPageFileLimit() {
  const constants = await readFile(
    new URL('../../src/constants.ts', import.meta.url),
    'utf8',
  )
  const written = /^export const WIKI_PAGE_FILE_LIMIT_BYTES = ([\d_]+)$/m.exec(
    constants,
  )?.[1]
  return Number(written?.replaceAll('_', '') ?? Number.NaN)
}

const WIKI_PAGE_FILE_LIMIT_BYTES = await readerPageFileLimit()

/**
 * Writes the one source of a test project and answers the Wiki manifest of one overview page whose article is a heading and a paragraph of the given number of letters `a`; each letter is one byte of the rendered page.
 * Called by the tests of the renderer's page size limit.
 * @param root - The project folder.
 * @param letterCount - How many letters the paragraph holds.
 * @returns The manifest, as an agent writes it into a candidate.
 * @example await overviewOfLetters('/tmp/project', 3) // => { …, pages: [{ path: 'index.html', contentHtml: '<h2 id="flow">Flow</h2><p>aaa</p>', … }] }
 */
async function overviewOfLetters(root, letterCount) {
  const source = 'export const value = 1;\n'
  await writeFile(join(root, 'source.ts'), source)
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    generated: { revision: '1234567890', at: '2026-10-19' },
    includedSources: [
      {
        path: 'source.ts',
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    ],
    pages: [
      {
        path: 'index.html',
        title: 'Overview',
        section: 'Guide',
        contentHtml: `<h2 id="flow">Flow</h2><p>${'a'.repeat(letterCount)}</p>`,
        sources: [{ path: 'source.ts', line: 1 }],
        outline: [{ id: 'flow', label: 'Flow' }],
      },
    ],
  }
}

/**
 * Writes a page as a checkout with CRLF line ends holds it: Git's `core.autocrlf` on Windows writes each LF that no CR precedes as CRLF.
 * Called by the tests of the renderer's page size limit, which measure a page as it can stand on disk, where the reader looks at its size.
 * @param page - The page as the renderer wrote it.
 * @returns The page with CRLF line ends.
 * @example withCrlfLineEnds('<p>\n</p>') // => '<p>\r\n</p>'
 */
function withCrlfLineEnds(page) {
  return page.replace(/(?<!\r)\n/g, '\r\n')
}

/**
 * Tells how many letters the overview's paragraph must hold for its rendered page to have the given number of bytes, with LF line ends as the renderer writes it or with the CRLF line ends of a Windows checkout: the bytes of the page around the paragraph are measured once, from a page of one letter.
 * @param root - The project folder.
 * @param pageBytes - The size the page is to have.
 * @param lineEnds - `crlf` to measure the page as a Windows checkout holds it, `lf` as the renderer writes it.
 * @returns The number of letters.
 * @example await lettersForPageOf(root, 2_097_152, 'crlf') // => 2,097,152 less the bytes of the page around the paragraph (its shell, navigation and source links) with CRLF line ends
 */
async function lettersForPageOf(root, pageBytes, lineEnds) {
  const output = join(root, '.codebook/wiki')
  const pages = await renderWikiPages(await overviewOfLetters(root, 1), {
    projectRoot: root,
    outputDirectory: output,
  })
  const page = pages.get('index.html') ?? ''
  const bytesAroundTheLetters =
    Buffer.byteLength(lineEnds === 'crlf' ? withCrlfLineEnds(page) : page) - 1
  return pageBytes - bytesAroundTheLetters
}

// Value: protects=every learner whose Wiki the agent publishes with a long page: the reader refuses a page file larger than WIKI_PAGE_FILE_LIMIT_BYTES for good, with a sentence that blames a hand edit, and Update renders the page the same again, so the page could never be read; fails_when=the renderer accepts a page larger than the reader opens, or its limit differs from the reader's (WIKI_PAGE_FILE_LIMIT_BYTES of the extension's constants, which a skill script cannot import), so a page the reader would show is refused or one it refuses is published; why_new=Cycle 0047 row 78 (ADV-6 = RT-2); Cycle 0047 row 233 (P2CLA-11): the page is measured as a Windows checkout with CRLF line ends holds it; seam=none (the constants source and the real renderer); no_claim=the reader's own refusal of a larger file (deepWikiReader.test.ts)
test('a page that takes exactly the reader’s page file limit with the CRLF line ends of a Windows checkout is rendered, and one byte more is refused with a sentence that tells the agent to split the page', async () => {
  // Arrange: an overview sized to take the reader's limit with CRLF line ends, and the same overview one letter longer.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-page-limit-')),
  )
  try {
    const output = join(root, '.codebook/wiki')
    const lettersAtTheLimit = await lettersForPageOf(
      root,
      WIKI_PAGE_FILE_LIMIT_BYTES,
      'crlf',
    )

    // Act
    const atTheLimit = await renderWikiPages(
      await overviewOfLetters(root, lettersAtTheLimit),
      { projectRoot: root, outputDirectory: output },
    )
    const overTheLimit = await renderWikiPages(
      await overviewOfLetters(root, lettersAtTheLimit + 1),
      { projectRoot: root, outputDirectory: output },
    ).then(
      () => 'rendered',
      (error) => error.message,
    )

    // Assert
    assert.deepEqual(
      {
        bytesWithCrlfAtTheLimit: Buffer.byteLength(
          withCrlfLineEnds(atTheLimit.get('index.html') ?? ''),
          'utf8',
        ),
        overTheLimit,
      },
      {
        bytesWithCrlfAtTheLimit: 2_097_152,
        overTheLimit:
          'Wiki page index.html renders to 2097153 bytes with CRLF line ends, as a Windows checkout may hold it, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a learner on Windows who clones a repository that carries a committed Wiki: Git's core.autocrlf writes each line end of a page as CRLF, so a page the renderer accepted by its bytes with LF line ends grew past the reader's limit on disk and was refused for good, with a sentence that blames a hand edit; fails_when=the renderer counts a page's bytes with LF line ends only, so a page within the limit with LF and over it with CRLF is published; why_new=Cycle 0047 row 233 (P2CLA-11); seam=none (the constants source and the real renderer); no_claim=Git's own conversion (the test writes each LF as CRLF as core.autocrlf does), and the reader's refusal of the grown file (deepWikiReader.test.ts)
test('a page that renders to exactly the reader’s page file limit with LF line ends, and so takes more with the CRLF line ends of a Windows checkout, is refused with the sentence that tells the agent to split the page', async () => {
  // Arrange: an overview sized to render to the reader's limit with LF line ends.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-page-limit-crlf-')),
  )
  try {
    const output = join(root, '.codebook/wiki')
    const lettersAtTheLimitWithLf = await lettersForPageOf(
      root,
      WIKI_PAGE_FILE_LIMIT_BYTES,
      'lf',
    )

    // Act
    const answer = await renderWikiPages(
      await overviewOfLetters(root, lettersAtTheLimitWithLf),
      { projectRoot: root, outputDirectory: output },
    ).then(
      () => 'rendered',
      (error) => error.message,
    )

    // Assert: the sentence names the page's size with CRLF line ends, which depends on the shell's lines, written here as SIZE.
    assert.equal(
      answer.replace(/^(Wiki page index\.html renders to )\d+ /, '$1SIZE '),
      'Wiki page index.html renders to SIZE bytes with CRLF line ends, as a Windows checkout may hold it, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the learner's published Wiki and the agent's candidate against a page larger than the reader opens: the preview (--render-only) and the publish must refuse it before any page is written; fails_when=the publisher writes the rendered pages into the candidate, or publishes them, before it checks their size; why_new=Cycle 0047 row 78 (ADV-6 = RT-2); seam=none (the real preparation and publisher); no_claim=the command line's own printing of the refusal (it prints the error's message)
test('the preview and the publish of a candidate whose page renders larger than the reader opens are refused before any page is written, and no Wiki is published', async () => {
  // Arrange: a prepared candidate whose overview renders one byte over the reader's limit.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-publish-page-limit-')),
  )
  try {
    const output = join(root, '.codebook/wiki')
    const { stage } = await prepareWikiStage({
      projectRoot: root,
      outputDirectory: output,
    })
    const lettersOverTheLimit =
      (await lettersForPageOf(root, WIKI_PAGE_FILE_LIMIT_BYTES, 'crlf')) + 1
    await writeFile(
      join(stage, 'codebook-wiki.json'),
      JSON.stringify(await overviewOfLetters(root, lettersOverTheLimit)),
    )

    // Act
    const preview = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
      renderOnly: true,
    }).then(
      () => 'rendered',
      (error) => error.message,
    )
    const publish = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
    }).then(
      () => 'published',
      (error) => error.message,
    )
    const candidateFiles = await readdir(stage).then(
      (names) => names.sort(),
      (error) => error.code,
    )
    const publishedWiki = await readFile(join(output, 'index.html')).then(
      () => 'published',
      (error) => error.code,
    )

    // Assert: the candidate holds the record of its preparation and the agent's manifest, and no page.
    assert.deepEqual(
      {
        preview,
        publish,
        candidateFiles,
        publishedWiki,
      },
      {
        preview:
          'Wiki page index.html renders to 2097153 bytes with CRLF line ends, as a Windows checkout may hold it, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
        publish:
          'Wiki page index.html renders to 2097153 bytes with CRLF line ends, as a Windows checkout may hold it, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
        candidateFiles: ['codebook-publication.json', 'codebook-wiki.json'],
        publishedWiki: 'ENOENT',
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the editor agent that writes a Wiki with the bundled skill, which reads there how to write pages before it writes: without the reader's page limits it learns the 2 MiB limit only from a refused publish, and that a dense page needs more memory than the reader gives one page only from the learner's refusal page; fails_when=the skill no longer names the publisher's refusal of a page that renders to more than 2 MiB, or how it counts that size (with CRLF line ends), or the reader's refusal of a page too dense to prepare, or no longer says to split such a page; why_new=Cycle 0047 row 104 (the rest of RT-2), and row 248 for the count with CRLF line ends (row 233); seam=none; no_claim=the publisher's and the reader's refusals themselves (the tests above, deepWikiReader.test.ts)
test('the bundled skill tells the agent that the publisher refuses a page over 2 MiB and the reader a page too dense to prepare, and to split such a page', async () => {
  // Arrange / Act
  const skill = await readFile(
    new URL('../../skills/codebook/SKILL.md', import.meta.url),
    'utf8',
  )

  // Assert
  assert.equal(
    skill.includes(
      'Keep every page small enough for the reader: the publisher refuses a page that renders to more than 2 MiB, counted with CRLF line ends as a Windows checkout may hold it (one byte more for each line), and the reader refuses a page whose markup is so dense that preparing it needs more memory than Codebook gives one page. Split a long or dense article into several pages of its section instead.',
    ),
    true,
  )
})
