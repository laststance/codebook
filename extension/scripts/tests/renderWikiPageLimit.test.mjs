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

import { WIKI_PAGE_FILE_LIMIT_BYTES } from '../../dist/constants.js'
import {
  prepareWikiStage,
  publishWiki,
} from '../../skills/codebook/publish-wiki.mjs'
import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

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
 * Tells how many letters the overview's paragraph must hold for its rendered page to have the given number of bytes: the bytes of the page around the paragraph are measured once, from a page of one letter.
 * @param root - The project folder.
 * @param pageBytes - The size the rendered page is to have.
 * @returns The number of letters.
 * @example await lettersForPageOf(root, 2_097_152) // => 2,097,152 less the bytes of the page around the paragraph (its shell, navigation and source links)
 */
async function lettersForPageOf(root, pageBytes) {
  const output = join(root, '.codebook/wiki')
  const pages = await renderWikiPages(await overviewOfLetters(root, 1), {
    projectRoot: root,
    outputDirectory: output,
  })
  const bytesAroundTheLetters =
    Buffer.byteLength(pages.get('index.html') ?? '', 'utf8') - 1
  return pageBytes - bytesAroundTheLetters
}

// Value: protects=every learner whose Wiki the agent publishes with a long page: the reader refuses a page file larger than WIKI_PAGE_FILE_LIMIT_BYTES for good, with a sentence that blames a hand edit, and Update renders the page the same again, so the page could never be read; fails_when=the renderer accepts a page larger than the reader opens, or its limit differs from the reader's (WIKI_PAGE_FILE_LIMIT_BYTES of the built extension, which a skill script cannot import), so a page the reader would show is refused or one it refuses is published; why_new=Cycle 0047 row 78 (ADV-6 = RT-2); seam=none (the built constants and the real renderer); no_claim=the reader's own refusal of a larger file (deepWikiReader.test.ts)
test('a page that renders to exactly the reader’s page file limit is rendered, and one byte more is refused with a sentence that tells the agent to split the page', async () => {
  // Arrange: an overview sized to render to the reader's limit, and the same overview one letter longer.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-page-limit-')),
  )
  try {
    const output = join(root, '.codebook/wiki')
    const lettersAtTheLimit = await lettersForPageOf(
      root,
      WIKI_PAGE_FILE_LIMIT_BYTES,
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
        renderedBytesAtTheLimit: Buffer.byteLength(
          atTheLimit.get('index.html') ?? '',
          'utf8',
        ),
        overTheLimit,
      },
      {
        renderedBytesAtTheLimit: 2_097_152,
        overTheLimit:
          'Wiki page index.html renders to 2097153 bytes, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
      },
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
      (await lettersForPageOf(root, WIKI_PAGE_FILE_LIMIT_BYTES)) + 1
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
          'Wiki page index.html renders to 2097153 bytes, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
        publish:
          'Wiki page index.html renders to 2097153 bytes, more than the 2097152 bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.',
        candidateFiles: ['codebook-publication.json', 'codebook-wiki.json'],
        publishedWiki: 'ENOENT',
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
