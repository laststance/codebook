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
 * @param generated - The manifest's `generated` record, of any type (a record, `null`, a list), or `undefined` for a manifest without one.
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
test('a manifest that names the generation time generatedAt is refused before any page, with a sentence that names generated.at and the alias the time stands under', async () => {
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
        "The Wiki manifest needs generated.at, the date and time of this generation in ISO 8601 (for example 2026-11-22T05:00:00Z), which every page's header shows as its Indexed date; its generated record names the time generatedAt instead of at.",
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

// Value: protects=the header's date, which the reader cuts from the first ten characters of generated.at, and the agent's way to correct a wrong record; fails_when=a record that is no object, an empty record, a time in words, a non-date, an impossible calendar day that V8's Date.parse rolls over (2026-02-30, 2026-02-29), an hour 24, a time without Z or an offset, or a number passes, so the header shows a fragment or a day that never existed; or the refusal does not say what the record holds instead; why_new=Cycle 0141 task 5 (review round: calendar overflow, record shapes; /ship pass 1: kind and length instead of the value); seam=none; no_claim=none beyond protects
for (const [label, generated, clause] of [
  ['a null record', null, 'it has no generated record'],
  ['a list for a record', [], 'it has no generated record'],
  ['an empty record', {}, 'its generated record holds 0 keys and no at'],
  [
    'a record whose time stands under a key the publisher does not know',
    { revision: 'abc1234', stamp: '2026-11-22T05:00:00Z' },
    'its generated record holds 2 keys and no at',
  ],
  [
    'a time in words',
    { revision: 'abc1234', at: 'yesterday' },
    'its generated.at is a text of 9 characters that is no such date',
  ],
  [
    'month 13',
    { revision: 'abc1234', at: '2026-13-40T00:00:00Z' },
    'its generated.at is a text of 20 characters that is no such date',
  ],
  [
    'a day-first date',
    { revision: 'abc1234', at: '22/11/2026' },
    'its generated.at is a text of 10 characters that is no such date',
  ],
  [
    'February 30',
    { revision: 'abc1234', at: '2026-02-30' },
    'its generated.at is a text of 10 characters that is no such date',
  ],
  [
    'February 29 of a year that is no leap year',
    { revision: 'abc1234', at: '2026-02-29T05:00:00Z' },
    'its generated.at is a text of 20 characters that is no such date',
  ],
  [
    'hour 24',
    { revision: 'abc1234', at: '2026-11-22T24:00:00Z' },
    'its generated.at is a text of 20 characters that is no such date',
  ],
  [
    'a time without Z or an offset',
    { revision: 'abc1234', at: '2026-11-22T05:00:00' },
    'its generated.at is a text of 19 characters that is no such date',
  ],
  [
    'a number',
    { revision: 'abc1234', at: 20261122 },
    'its generated.at is a number',
  ],
  [
    'a text of 100 characters, named only by its length',
    { revision: 'abc1234', at: 'x'.repeat(100) },
    'its generated.at is a text of 100 characters that is no such date',
  ],
]) {
  test(`a manifest whose generated record is ${label} is refused, and the sentence shows what the record holds`, async () => {
    await inProject(async (root) => {
      // Arrange
      const manifest = await manifestWithGenerated(root, generated)

      // Act
      const rendering = renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })

      // Assert
      await assert.rejects(rendering, {
        message: `The Wiki manifest needs generated.at, the date and time of this generation in ISO 8601 (for example 2026-11-22T05:00:00Z), which every page's header shows as its Indexed date; ${clause}.`,
      })
    })
  })
}

// Value: protects=whatever an agent wrote by mistake into generated.at or a key beside it, which the refusal must not repeat into the agent's tool output; fails_when=the refusal quotes the wrong value or the record's other text; why_new=Cycle 0141 /ship pass 1 (outside voice: a credential in generated.at would reach stderr); seam=none; no_claim=that nothing else in the manifest reaches an error
test('a refused generated.at is described by its kind and length, and its text never appears in the refusal', async () => {
  await inProject(async (root) => {
    // Arrange: a wrong value that stands for private text written by mistake.
    const manifest = await manifestWithGenerated(root, {
      revision: 'abc1234',
      at: 'private value 12345',
    })

    // Act
    let refusal = ''
    try {
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    } catch (error) {
      refusal = error.message
    }

    // Assert
    assert.equal(
      refusal,
      "The Wiki manifest needs generated.at, the date and time of this generation in ISO 8601 (for example 2026-11-22T05:00:00Z), which every page's header shows as its Indexed date; its generated.at is a text of 19 characters that is no such date.",
    )
    assert.equal(refusal.includes('private value'), false)
  })
})

// Value: protects=the header of a correctly written Wiki: a time with Z, with an offset (with or without seconds), a comma before fractional seconds as GNU date --iso-8601=ns writes it, a date alone, February 29 of a leap year and a year below 100; the header shows the date as written, not converted to UTC; fails_when=the check refuses an ISO date an agent may write, or the header shows another day (2026-11-22T01:00:00+09:00 is 2026-11-21 in UTC); why_new=Cycle 0141 task 5 (review round: boundary forms); seam=none; no_claim=none beyond protects
for (const [at, shown] of [
  ['2026-11-22T05:00:00Z', 'Indexed 2026-11-22'],
  ['2026-11-22T14:30:00.250+09:00', 'Indexed 2026-11-22'],
  ['2026-11-22T01:00:00+09:00', 'Indexed 2026-11-22'],
  ['2026-11-22T05:00-05:00', 'Indexed 2026-11-22'],
  ['2028-02-29', 'Indexed 2028-02-29'],
  ['2026-11-22T05:00:00,125000000+00:00', 'Indexed 2026-11-22'],
  ['0099-01-01', 'Indexed 0099-01-01'],
  ['2026-11-10', 'Indexed 2026-11-10'],
]) {
  test(`a generated.at of ${at} renders every page with "${shown}" in its header`, async () => {
    await inProject(async (root) => {
      // Arrange
      const manifest = await manifestWithGenerated(root, {
        revision: 'abcdef1234',
        at,
      })

      // Act
      const pages = await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })

      // Assert
      assert.ok(
        (pages.get('index.html') ?? '').includes(
          `<span class="indexed-date">${shown} · abcdef12</span>`,
        ),
      )
    })
  })
}
