import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/**
 * Writes the given files into a project folder and answers a Wiki manifest whose pages cite the given files at line 1.
 * Called by every test of the renderer's workspace-import check.
 * @param root - The project folder.
 * @param files - File text by relative path; every one is an included source.
 * @param pages - Each page's path, article text (one paragraph) and cited files.
 * @returns The manifest, as an agent writes it into a candidate.
 * @example await manifestOf(root, { 'a.ts': 'export const a = 1\n' }, [{ path: 'index.html', text: 'A.', cites: ['a.ts'] }])
 */
async function manifestOf(root, files, pages) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    generated: { revision: 'abcdef1', at: '2026-11-12' },
    includedSources: Object.entries(files).map(([path, text]) => ({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
    })),
    pages: pages.map(({ path, text, cites }) => ({
      path,
      title: path,
      section: 'Guide',
      contentHtml: `<h2 id="flow">Flow</h2><p>${text}</p>`,
      sources: cites.map((cited) => ({ path: cited, line: 1 })),
      outline: [{ id: 'flow', label: 'Flow' }],
    })),
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
    await mkdtemp(join(tmpdir(), 'codebook-render-workspace-')),
  )
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** A workspace of a shared package, an app and an API, both of which import `localDay` from the shared package. */
const WORKSPACE = {
  'packages/shared/package.json': '{ "name": "@acme/shared" }\n',
  'packages/shared/src/day.ts':
    'export function localDay(at: string): string {\n  return at.slice(0, 10)\n}\nexport const DAY_MAX = 7\nexport type Day = string\n',
  'apps/app/package.json': '{ "name": "@acme/app" }\n',
  'apps/app/src/today.ts':
    "import { localDay } from '@acme/shared'\nexport const today = (now: string): string => localDay(now)\n",
  'apps/api/package.json': '{ "name": "@acme/api" }\n',
  'apps/api/src/router.ts':
    "import { localDay as dayOf } from '@acme/shared/day'\nexport const route = (at: string): string => dayOf(at)\n",
}

/** The overview page, about the shared package: it owes no sentence, as the shared package imports no other workspace package. */
const SHARED_PAGE = {
  path: 'index.html',
  text: 'The shared package turns a timestamp into its calendar day.',
  cites: ['packages/shared/src/day.ts'],
}

// Value: protects=a learner reading a workspace Wiki's app pages: Cycle 0118 found P08 Wikis in both hosts whose Expo app and Hono API pages never said that their code imports the shared package or what they take from it; fails_when=the renderer publishes app and API pages that never name the shared package and an imported function, or the refusal does not name the package, the imported names and the pages to extend; why_new=Cycle 0118 (H1 E1 and E2, step 2); seam=none (the real renderer); no_claim=that the sentence the agent then writes explains the use well
test('a workspace Wiki whose app and API pages never say what they import from the shared package is refused, naming each package', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      SHARED_PAGE,
      {
        path: 'app.html',
        text: 'The app shows the day the clock is in.',
        cites: ['apps/app/src/today.ts'],
      },
      {
        path: 'api.html',
        text: 'The API answers with the day a tap was made.',
        cites: ['apps/api/src/router.ts'],
      },
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay), but none of its pages (app.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it. apps/api imports @acme/shared (localDay), but none of its pages (api.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/api uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=the Wiki that does explain the connection: an app page naming the shared package and the function it imports, and an API page naming the package's folder and the function it imports under another local name; fails_when=the renderer refuses such a Wiki, or reads a subpath import (`@acme/shared/day`) or an `as` rename as no import; why_new=Cycle 0118 (H1 E1 and E2, step 2); seam=none (the real renderer); no_claim=that the agent's sentence is true
test('a workspace Wiki whose app and API pages name the shared package and a function they import from it is published', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      SHARED_PAGE,
      {
        path: 'app.html',
        text: 'The app imports localDay from @acme/shared to show the day the clock is in.',
        cites: ['apps/app/src/today.ts'],
      },
      {
        path: 'api.html',
        text: 'The API takes localDay from packages/shared to answer with the day a tap was made.',
        cites: ['apps/api/src/router.ts'],
      },
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the rule's reading of "a function or schema": a type-only import (`import type`, an inline `type` entry) and a constant written in capitals are no use a sentence can explain, so an app importing only those owes no sentence; fails_when=an app that imports only a type and a constant is refused; why_new=Cycle 0118 (H1 E2 step 2 named only DAY_ROWS_MAX-style constants); seam=none (the real renderer); no_claim=that every constant the rule ignores is unimportant
test('an app that imports only types and a constant in capitals from the shared package owes no sentence about it', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "import type { Day } from '@acme/shared'\nimport { DAY_MAX, type Day as Shown } from '@acme/shared'\nexport const limit = (day: Day): Shown => (DAY_MAX > 0 ? day : day)\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app limits the days it shows.',
          cites: ['apps/app/src/today.ts'],
        },
        {
          path: 'api.html',
          text: 'The API uses localDay from @acme/shared for the day of a tap.',
          cites: ['apps/api/src/router.ts'],
        },
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the same reading from the other side: naming a constant in capitals is not naming a function or schema the app uses; fails_when=an app page that names only DAY_MAX passes for an app that also imports the function localDay; why_new=Cycle 0118 (H1 E2 step 2 named only DAY_ROWS_MAX-style constants); seam=none (the real renderer); no_claim=that a page naming the function explains it well
test('an app page that names only a constant in capitals from the shared package does not satisfy the rule', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "import { localDay, DAY_MAX } from '@acme/shared'\nexport const today = (now: string): string => (DAY_MAX > 0 ? localDay(now) : now)\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app reads DAY_MAX from @acme/shared.',
          cites: ['apps/app/src/today.ts'],
        },
        {
          path: 'api.html',
          text: 'The API uses localDay from @acme/shared for the day of a tap.',
          cites: ['apps/api/src/router.ts'],
        },
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay), but none of its pages (app.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=the tie between the sentence and its evidence: the imported function must come from a file the page itself cites, so a page cannot name a function that only another page's files import; fails_when=a page that cites no importing file passes by naming the package and the function; why_new=Cycle 0118 (H1 step 2 asks for a name "that the part's cited source imports"); seam=none (the real renderer); no_claim=that the citation points at the import line
test('an app page that names the shared function without citing a file that imports it does not satisfy the rule', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/clock.ts':
          'export const tick = (now: number): number => now + 1000\n',
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app ticks its clock, and its day comes from localDay of @acme/shared.',
          cites: ['apps/app/src/clock.ts'],
        },
        {
          path: 'app-today.html',
          text: 'The today view shows the day the clock is in.',
          cites: ['apps/app/src/today.ts'],
        },
        {
          path: 'api.html',
          text: 'The API uses localDay from @acme/shared for the day of a tap.',
          cites: ['apps/api/src/router.ts'],
        },
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay), but none of its pages (app.html, app-today.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=Wikis whose pages are organized by flow rather than by package: a package without a page mostly about it owes no sentence, so the rule never asks for a package page the chapter plan does not have; fails_when=a Wiki with one mixed page over the app, the API and the shared package is refused for the app's and API's imports; why_new=Cycle 0118 (the rule applies to a package's own pages only); seam=none (the real renderer); no_claim=that a mixed page explains each package well
test('a workspace package without a page of its own owes no sentence about the packages it imports', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      {
        path: 'index.html',
        text: 'A tap travels from the app to the API, and both turn timestamps into days.',
        cites: [
          'apps/app/src/today.ts',
          'apps/api/src/router.ts',
          'packages/shared/src/day.ts',
        ],
      },
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the package name as a whole word: a page about another package whose name starts the same way (`@acme/shared-ui`, `packages/shared-legacy`) does not name the shared package; fails_when=such a page satisfies the rule for @acme/shared; why_new=Cycle 0118 (word boundaries of the new check); seam=none (the real renderer); no_claim=that the rule tells two packages apart by meaning
test('a page that names only a longer package name starting like the shared one does not name the shared package', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      SHARED_PAGE,
      {
        path: 'app.html',
        text: 'The app calls localDay, unlike @acme/shared-ui and packages/shared-legacy.',
        cites: ['apps/app/src/today.ts'],
      },
      {
        path: 'api.html',
        text: 'The API uses localDay from @acme/shared for the day of a tap.',
        cites: ['apps/api/src/router.ts'],
      },
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay), but none of its pages (app.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})
