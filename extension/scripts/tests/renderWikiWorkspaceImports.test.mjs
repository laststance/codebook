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

/** The API page of {@link WORKSPACE} written as the rule asks, for tests about the app's side only. */
const API_PAGE = {
  path: 'api.html',
  text: 'The API uses localDay from @acme/shared for the day of a tap.',
  cites: ['apps/api/src/router.ts'],
}

// Value: protects=Wikis of real monorepos: imports made only by a package's tests, mocks or fixtures (test helpers such as createKey or sleep, codemod input files) say how the package is tested, not what its code uses; fails_when=the renderer asks for a sentence about an import that only a test file or a fixture makes; why_new=Cycle 0118 review round (the P02 TanStack/query Wiki of Cycle 0115 drew 57 shortfalls, 24 of them from tests and fixtures); seam=none (the real renderer); no_claim=that every test folder name of every repository is recognized
test('an app whose only imports from the shared package are in its tests and fixtures owes no sentence about it', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          'export const today = (now: string): string => now.slice(0, 10)\n',
        'apps/app/src/today.test.ts':
          "import { localDay } from '@acme/shared'\nexport const sameDay = (now: string): boolean => localDay(now) === now.slice(0, 10)\n",
        'apps/app/__fixtures__/day.ts':
          "import { localDay } from '@acme/shared'\nexport const fixedDay = localDay('2026-11-12T00:00:00Z')\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app cuts a timestamp to its day, and its tests compare that day with another.',
          cites: [
            'apps/app/src/today.ts',
            'apps/app/src/today.test.ts',
            'apps/app/__fixtures__/day.ts',
          ],
        },
        API_PAGE,
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a file the Wiki explicitly leaves unexplained (a coverage exception with its reason): it owes no depth and no sentence about its imports either; fails_when=the renderer asks a page to explain what an excepted file imports, which no page needs to cite; why_new=Cycle 0118 review round (the import rule read every included code file); seam=none (the real renderer); no_claim=that the exception's reason is a good one
test('a code file covered by a coverage exception owes no sentence about what it imports', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          'export const today = (now: string): string => now.slice(0, 10)\n',
        'apps/app/src/generated.ts':
          "import { localDay } from '@acme/shared'\nexport const generatedDay = localDay('2026-11-12T00:00:00Z')\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app cuts a timestamp to its day.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
      ],
    )
    manifest.coverageExceptions = [
      { path: 'apps/app/src/generated.ts', reason: 'Generated at build time.' },
    ]

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=publishing at all: the import reader must not stall on a long run of spaces or line breaks after `import` (aligned or generated code); fails_when=reading such a file takes seconds (the first version took about 11 s for 4,000 spaces and over 2 min for 40,000); why_new=Cycle 0118 review round (catastrophic backtracking in the import pattern); seam=none (the real renderer); no_claim=a bound for every pathological text
test('a code file with a long run of spaces after import is read in well under a second', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/padded.ts': `import${' '.repeat(6000)}x\nexport const padded = 1\n`,
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app imports localDay from @acme/shared to show the day the clock is in.',
          cites: ['apps/app/src/today.ts', 'apps/app/src/padded.ts'],
        },
        API_PAGE,
      ],
    )
    const started = performance.now()

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
    // gstack-timing-ok: the bound separates a linear read (under 10 ms here) from catastrophic backtracking (11 s for 4,000 spaces before the fix); 2,000 ms leaves a 200-fold margin for a loaded runner.
    assert.ok(performance.now() - started < 2000)
  })
})

// Value: protects=the forms real code imports in: a statement across lines with comments inside the braces, a default import beside named ones, an `export … from` re-export, and no commented-out import; fails_when=a formatted multi-line import or a re-export goes unread, or a commented-out import is counted, so the refusal names the wrong functions; why_new=Cycle 0118 review round (comments inside braces hid a statement, a commented-out import counted); seam=none (the real renderer); no_claim=that every JavaScript syntax is parsed
test('an import across lines with comments, a default import and a re-export are read, and a commented-out import is not', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts': [
          'import Day, {',
          '  // the day of a timestamp',
          '  localDay,',
          '  /* the window of a day */ dayBounds as bounds,',
          "} from '@acme/shared'",
          "export { weekOf } from '@acme/shared/week'",
          "// import { removedHelper } from '@acme/shared'",
          'export const today = (now: string): Day => localDay(now)',
          'export const window = bounds',
          '',
        ].join('\n'),
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app shows the day the clock is in.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay, dayBounds, weekOf), but none of its pages (app.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=pages about a package imported whole (`import * as shared` or a default import): its local name is the importer's own choice, so naming the package on a page that cites the importing file is enough; fails_when=such a page is refused for not writing the local alias; why_new=Cycle 0118 review round (a default import was matched by its alias); seam=none (the real renderer); no_claim=that the page says what the namespace is used for
test('an app page that names a package the app imports whole, citing the importing file, satisfies the rule', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "import * as shared from '@acme/shared'\nexport const today = (now: string): string => shared.localDay(now)\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app turns the clock into a day through @acme/shared.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=pages that write a call through its module, as in shared.localDay(): the function is named even after a dot; fails_when=such a page is refused for not naming localDay; why_new=Cycle 0118 review round (the mention check treated a leading dot as part of a longer name); seam=none (the real renderer); no_claim=that the dotted name is the imported one
test('an app page that writes the imported function after a module name and a dot names it', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      SHARED_PAGE,
      {
        path: 'app.html',
        text: 'The app calls shared.localDay() of @acme/shared to show the day the clock is in.',
        cites: ['apps/app/src/today.ts'],
      },
      API_PAGE,
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=type-only imports written after an `export { … }` that has no `from`: they import nothing that runs and owe no sentence; fails_when=the earlier statement makes the type-only import read as a value import and the app is refused; why_new=Cycle 0118 review round (the type-only flag was read from the wrong statement); seam=none (the real renderer); no_claim=that every placement of `type` is recognized
test('a type-only import after an export list without from owes no sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "const local = (now: string): Day => now.slice(0, 10)\nexport { local }\nimport type { Day } from '@acme/shared'\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app cuts a timestamp to its day.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=code that holds import text inside a string (a generator's template, a code sample in a docs string): such text imports nothing; fails_when=an import written inside a string literal makes the app owe a sentence about the shared package; why_new=Cycle 0118 review round (CodeRabbit: strings were read as imports); seam=none (the real renderer); no_claim=that every string form (a template literal with nested backticks) is recognized
test('import text inside a string literal owes no sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          'export const sample = "import { localDay } from \'@acme/shared\'"\nexport const today = (now: string): string => now.slice(0, 10)\n',
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app cuts a timestamp to its day and keeps a sample line of code.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=packages that reach another workspace package by a CommonJS require or by a relative path into its folder: both are imports the pages must explain; fails_when=the renderer publishes app pages that never say what the app takes from the shared package because the app requires it or imports it by a relative path; why_new=Cycle 0118 review round (CodeRabbit: require and relative cross-package imports went unread); seam=none (the real renderer); no_claim=that a dynamic require or an alias from a bundler configuration is read
test('a require and a relative import into the shared package each owe a sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "const { localDay: dayOf } = require('@acme/shared')\nexport const today = (now: string): string => dayOf(now)\n",
        'apps/api/src/router.ts':
          "import { dayBounds } from '../../../packages/shared/src/day'\nexport const route = (at: string): string => dayBounds(at)\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app shows the day the clock is in.',
          cites: ['apps/app/src/today.ts'],
        },
        {
          path: 'api.html',
          text: 'The API answers with the window of a day.',
          cites: ['apps/api/src/router.ts'],
        },
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay), but none of its pages (app.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it. apps/api imports @acme/shared (dayBounds), but none of its pages (api.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/api uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=the statement the rule asks for: the package and the function it gives must stand in one paragraph, list item or table cell, not in unrelated sentences or in a pasted code block; fails_when=a page that names the package in one paragraph and the function in another, or only inside a <pre> import line, satisfies the rule; why_new=Cycle 0118 review round (CodeRabbit: unrelated mentions were accepted; a code sample satisfied the rule); seam=none (the real renderer); no_claim=that the paragraph explains the use well
test('an app page that names the package and the function only in separate paragraphs or in a code block does not satisfy the rule', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      SHARED_PAGE,
      {
        path: 'app.html',
        text: 'The app depends on @acme/shared.</p><p>Elsewhere it calls localDay.</p><pre>import { localDay } from &#39;@acme/shared&#39;</pre><p>The clock ticks every second.',
        cites: ['apps/app/src/today.ts'],
      },
      API_PAGE,
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

// Value: protects=publishing a repository whose package.json files are broken or nameless: an unreadable package.json or one without a name is no workspace package, and a single named package is no workspace, so no import sentence is owed; fails_when=the renderer throws on the malformed JSON instead of refusing or publishing by the rules, or treats one named package plus unnamed folders as a workspace and refuses the app and API pages; why_new=no existing test has a package.json that is invalid, nameless or alone; seam=none (the real renderer); no_claim=that the Wiki explains the folders' relation
test('a repository whose other package.json files are invalid or nameless has no workspace and publishes without an import sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/package.json': '{ "name": ',
        'apps/api/package.json': '{ "private": true }\n',
      },
      [
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
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a refusal a learner and the editor AI can act on: it names at most three imported functions and at most three pages, and for a package imported whole it names no function and no parentheses; fails_when=the cap is dropped (a long list of every import floods the refusal), the page list is not capped, or a whole-module import prints an empty "()" or "undefined"; why_new=existing refusals name one or two names and pages, and none a whole-module import; seam=none (the real renderer); no_claim=that the first three names are the most important ones
test('a refusal names at most three imported functions and three pages, and no function for a package imported whole', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "import { localDay, dayBounds, weekOf, monthOf } from '@acme/shared'\nexport const today = [localDay, dayBounds, weekOf, monthOf]\n",
        'apps/api/src/router.ts':
          "import * as shared from '@acme/shared'\nexport const route = shared\n",
      },
      [
        SHARED_PAGE,
        ...['a', 'b', 'c', 'd'].map((letter) => ({
          path: `app-${letter}.html`,
          text: `The app shows part ${letter} of the day.`,
          cites: ['apps/app/src/today.ts'],
        })),
        {
          path: 'api.html',
          text: 'The API answers with the day a tap was made.',
          cites: ['apps/api/src/router.ts'],
        },
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared (localDay, dayBounds, weekOf), but none of its pages (app-a.html, app-b.html, app-c.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it. apps/api imports @acme/shared, but none of its pages (api.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/api uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=one refusal for everything the Wiki lacks: a Wiki that is both too shallow and silent about the app's import is refused once, with the depth sentences first and the workspace sentence after them; fails_when=the workspace rule is skipped when the depth rules already fail, or the two refusals come in separate passes or in the other order; why_new=every other test here meets only the workspace rule (the repositories have fewer than 12 code files); seam=none (the real renderer); no_claim=the wording of the depth sentences
test('a Wiki too shallow and silent about an import is refused once, with the depth sentences before the workspace sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const filler = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `packages/shared/src/extra${index}.ts`,
        `export const extra${index} = ${index}\n`,
      ]),
    )
    const manifest = await manifestOf(root, { ...WORKSPACE, ...filler }, [
      { ...SHARED_PAGE, cites: [...SHARED_PAGE.cites, ...Object.keys(filler)] },
      {
        path: 'app.html',
        text: 'The app shows the day the clock is in.',
        cites: ['apps/app/src/today.ts'],
      },
      API_PAGE,
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    const workspaceAt = outcome.indexOf(
      'apps/app imports @acme/shared (localDay), but none of',
    )
    const depthAt = outcome.indexOf('fewer than 1200 characters')
    assert.ok(depthAt >= 0, outcome)
    assert.ok(workspaceAt > depthAt, outcome)
    assert.equal(outcome.includes('apps/api imports'), false)
  })
})

// Value: protects=publishing a repository whose code holds a line of many unclosable quotes (an escaped-quote pattern, generated data): reading it stays linear; fails_when=the string scanner retries from every quote of the line and the render stalls (0.5 s for 20,000 escaped pairs, quadratic, before the fix); why_new=Cycle 0118 /ship Codex structured review (P1); seam=none (the real renderer); no_claim=a bound for every pathological text
test('a code file with a line of 60,000 escaped quotes is read in well under a second', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/quotes.ts': `export const quotes = /${'\\"'.repeat(60000)}/\n`,
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app imports localDay from @acme/shared to show the day the clock is in.',
          cites: ['apps/app/src/today.ts', 'apps/app/src/quotes.ts'],
        },
        API_PAGE,
      ],
    )
    const started = performance.now()

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
    // gstack-timing-ok: the bound separates a linear scan (milliseconds) from the quadratic one (several seconds for 60,000 pairs before the fix); 2,000 ms leaves a wide margin for a loaded runner.
    assert.ok(performance.now() - started < 2000)
  })
})

// Value: protects=imports written after a regular-expression literal that holds `/*` (such as /[/*]/): the pattern opens no comment, so the import still owes its sentence; fails_when=the pattern blanks the rest of the file and a Wiki that never explains the import is published; why_new=Cycle 0118 /ship review (Codex P2, batched specialist); seam=none (the real renderer); no_claim=that every regular-expression literal position is recognised
test('an import after a regular-expression literal holding /* still owes a sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "const punctuation = /[/*]/\nimport { localDay } from '@acme/shared'\nexport const today = (now: string): string => localDay(now.replace(punctuation, ''))\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app shows the day the clock is in.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
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

// Value: protects=packages that require another workspace package by its folder (require('../../../packages/shared')) or take its default export as { default as x }: both are imports of that package; fails_when=the folder path or the default entry is read as no import and the Wiki publishes without naming the package; why_new=Cycle 0118 /ship Codex structured review (P2); seam=none (the real renderer); no_claim=that bundler aliases or tsconfig paths are resolved
test('a require of a package folder and a default entry in braces each owe a sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/src/today.ts':
          "const shared = require('../../../packages/shared')\nexport const today = (now: string): string => shared.localDay(now)\n",
        'apps/api/src/router.ts':
          "import { default as dayOf } from '@acme/shared'\nexport const route = (at: string): string => dayOf(at)\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app shows the day the clock is in.',
          cites: ['apps/app/src/today.ts'],
        },
        {
          path: 'api.html',
          text: 'The API answers with the day of a tap.',
          cites: ['apps/api/src/router.ts'],
        },
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'apps/app imports @acme/shared, but none of its pages (app.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/app uses from @acme/shared and for what, naming that function or schema and citing a file that imports it. apps/api imports @acme/shared, but none of its pages (api.html) names @acme/shared or packages/shared together with a function or schema that a file the page cites imports from it: on one of those pages, say what apps/api uses from @acme/shared and for what, naming that function or schema and citing a file that imports it.',
    )
  })
})

// Value: protects=an explanation written across a line break inside one paragraph: <br> keeps the paragraph whole, so the package and the function still stand together; fails_when=a <br> splits the paragraph and a correct Wiki is refused; why_new=Cycle 0118 /ship Codex structured review (P2); seam=none (the real renderer); no_claim=that other inline breaks are kept
test('an app page whose one paragraph names the function and the package across a line break satisfies the rule', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(root, WORKSPACE, [
      SHARED_PAGE,
      {
        path: 'app.html',
        text: 'The app uses <code>localDay</code><br>from <code>@acme/shared</code> to show the day the clock is in.',
        cites: ['apps/app/src/today.ts'],
      },
      API_PAGE,
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=packages whose package.json starts with a byte-order mark: the package still counts, so its imports still owe a sentence; fails_when=the mark makes the name unreadable, the package drops out and the rule silently turns off for it; why_new=Cycle 0118 /ship adversarial review; seam=none (the real renderer); no_claim=other encodings
test('a shared package whose package.json starts with a byte-order mark still counts as a workspace package', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'packages/shared/package.json': '\uFEFF{ "name": "@acme/shared" }\n',
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app shows the day the clock is in.',
          cites: ['apps/app/src/today.ts'],
        },
        API_PAGE,
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

// Value: protects=packages that keep a package.json inside a test or fixture folder: such a manifest is fixture data, so it never becomes a workspace package that owns files or turns an npm import into a workspace import; fails_when=a fixture manifest named like a dependency makes the app owe a sentence about it; why_new=Cycle 0118 /ship adversarial review; seam=none (the real renderer); no_claim=that example packages are told apart from real ones
test('a package.json inside a fixture folder is no workspace package', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await manifestOf(
      root,
      {
        ...WORKSPACE,
        'apps/app/__fixtures__/react/package.json': '{ "name": "react" }\n',
        'apps/app/src/view.ts':
          "import { useState } from 'react'\nexport const view = (): unknown => useState(0)\n",
      },
      [
        SHARED_PAGE,
        {
          path: 'app.html',
          text: 'The app imports localDay from @acme/shared to show the day the clock is in, and keeps a counter in state.',
          cites: ['apps/app/src/today.ts', 'apps/app/src/view.ts'],
        },
        API_PAGE,
      ],
    )

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})
