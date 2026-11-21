import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/**
 * Writes the one source of a test project and answers a one-page Wiki manifest whose `generated` record is the given value, as an editor agent writes `codebook-wiki.json` into a candidate.
 * Called by the tests of the Indexed date the reader header shows.
 * @param root - The project folder.
 * @param generated - The manifest's `generated` record, or `undefined` for a manifest without one.
 * @returns The manifest.
 * @example await manifestWithGenerated('/tmp/project', { revision: 'abc', at: '2026-11-22' }) // => { …, generated: { revision: 'abc', at: '2026-11-22' }, pages: [{ path: 'index.html', … }] }
 */
async function manifestWithGenerated(root, generated) {
  const source = 'export const value = 1;\n'
  await writeFile(join(root, 'source.ts'), source)
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    ...(generated === undefined ? {} : { generated }),
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
        contentHtml:
          '<h2 id="flow">Flow</h2><p>The module exports one constant value that the rest of the project reads.</p>',
        sources: [{ path: 'source.ts', line: 1 }],
        outline: [{ id: 'flow', label: 'Flow' }],
      },
    ],
  }
}

/**
 * Runs one test body in a fresh project folder and removes the folder afterwards.
 * @param body - Receives the canonical project root.
 * @returns What the body returns.
 * @example await inProject(async (root) => renderWikiPages(await manifestWithGenerated(root, undefined), …))
 */
async function inProject(body) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-generated-time-')),
  )
  try {
    return await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// Value: protects=the Indexed date in every page's header of a Wiki whose agent named the generation time under another key; fails_when=the renderer publishes a manifest whose generated record holds generatedAt instead of at, so each page reads "Indexed Unknown" (Cycle 0140, Cursor on Ubuntu); why_new=Cycle 0140 later candidate 1 (Cycle 0141 task 5); seam=none (the real renderer); no_claim=that an editor agent follows SKILL.md and writes at (Cycle 0141 task 6 native check)
test('a manifest that names the generation time generatedAt is refused before any page, with a sentence that names generated.at and the keys it holds instead', async () => {
  await inProject(async (root) => {
    // Arrange: the generated record Grok 4.6 High wrote in Cursor's Wiki on Ubuntu.
    const manifest = await manifestWithGenerated(root, {
      revision: 'd1855c89c5e926c1fb7d9da900673f8159adc1e8',
      generatedAt: '2026-11-16T12:00:21.115Z',
      workingTree: 'clean',
    })

    // Act
    const rendering = renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert
    await assert.rejects(rendering, {
      message:
        "The Wiki manifest needs generated.at, the date and time of this generation in ISO 8601 (for example 2026-11-22T05:00:00Z), which every page's header shows as its Indexed date; its generated record holds revision, generatedAt, workingTree.",
    })
  })
})

// Value: protects=the Indexed date of a Wiki whose manifest has no generated record at all; fails_when=the renderer publishes it with "Indexed Unknown" on every page; why_new=Cycle 0141 task 5; seam=none; no_claim=none beyond protects
test('a manifest without a generated record is refused, and the sentence says it has none', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestWithGenerated(root, undefined)

    // Act
    const rendering = renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert
    await assert.rejects(rendering, {
      message:
        "The Wiki manifest needs generated.at, the date and time of this generation in ISO 8601 (for example 2026-11-22T05:00:00Z), which every page's header shows as its Indexed date; it has no generated record.",
    })
  })
})

// Value: protects=the header's date, which the reader cuts from the first ten characters of generated.at; fails_when=a time written in words or a non-date passes, so the header shows a fragment such as "yesterday" or an impossible date; why_new=Cycle 0141 task 5; seam=none; no_claim=none beyond protects
for (const at of ['yesterday', '2026-13-40T00:00:00Z', '22/11/2026']) {
  test(`a generated.at of ${JSON.stringify(at)} is refused, because the header could show no date from it`, async () => {
    await inProject(async (root) => {
      // Arrange
      const manifest = await manifestWithGenerated(root, {
        revision: 'abc1234',
        at,
      })

      // Act
      const rendering = renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })

      // Assert
      await assert.rejects(rendering, {
        message:
          "The Wiki manifest needs generated.at, the date and time of this generation in ISO 8601 (for example 2026-11-22T05:00:00Z), which every page's header shows as its Indexed date; its generated record holds revision, at.",
      })
    })
  })
}

// Value: protects=the header of a correctly written Wiki, with a time of day or a date alone; fails_when=the new check refuses an ISO date the renderer always accepted, or the header loses the date; why_new=Cycle 0141 task 5; seam=none; no_claim=none beyond protects
for (const [at, shown] of [
  ['2026-11-22T05:00:00Z', 'Indexed 2026-11-22'],
  ['2026-11-22T14:30:00.250+09:00', 'Indexed 2026-11-22'],
  ['2026-11-10', 'Indexed 2026-11-10'],
]) {
  test(`a generated.at of ${at} renders every page with "${shown}" in its header`, async () => {
    await inProject(async (root) => {
      // Arrange
      const manifest = await manifestWithGenerated(root, {
        revision: '1234567890',
        at,
      })

      // Act
      const pages = await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })

      // Assert
      assert.match(
        pages.get('index.html') ?? '',
        new RegExp(`<span class="indexed-date">${shown} · 12345678</span>`),
      )
    })
  })
}
