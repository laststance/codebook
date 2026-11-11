import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chapterTreeOf } from '../../skills/codebook/publish-wiki.mjs'

/**
 * A Wiki page as an editor agent writes it into a manifest, with only the fields the chapter tree reads.
 * Called by the tests below to build the shapes Cycle 0117's native runs produced.
 * @param path - The page's path.
 * @param title - The page's title.
 * @param section - The page's section.
 * @param sourcePaths - The repository paths the page cites.
 * @param parent - The path of the page it details, if any.
 * @returns The page.
 * @example pageOf('app.html', 'App', 'Web', ['src/main.ts'])
 */
function pageOf(path, title, section, sourcePaths, parent) {
  return {
    path,
    title,
    section,
    sources: sourcePaths.map((sourcePath) => ({ path: sourcePath, line: 1 })),
    ...(parent ? { parent } : {}),
  }
}

// Value: protects=the editor AI can see from the --render-only answer that a child page draws most of its sources from a folder its parent does not cite (Cycle 0117 run 1: Cursor's agent hung "Hooks and shared helpers", 9 of 16 sources in the root lib/ that all three runtimes import, under "Frontend application"); fails_when=the tree loses a page, its indentation under its parent, its section, or a folder's count of distinct cited files, most first; why_new=Cycle 0117 (C117-E2-1, hypothesis B); seam=none (the real chapterTreeOf on a manifest object); no_claim=that the agent reads the tree or moves the page
test('the chapter tree nests each page under its parent and counts the files it cites in each top-level folder, most first', () => {
  // Arrange
  const manifest = {
    pages: [
      pageOf('frontend.html', 'Frontend application', 'Frontend', [
        'src/App.tsx',
        'src/main.tsx',
      ]),
      pageOf(
        'frontend-routing.html',
        'Routing and auth gate',
        'Frontend',
        ['src/Routes.tsx'],
        'frontend.html',
      ),
      pageOf(
        'frontend-hooks-lib.html',
        'Hooks and shared helpers',
        'Frontend',
        [
          'lib/assertCast.ts',
          'lib/sleep.tsx',
          'lib/truncateString.ts',
          'src/hooks/useUpdateEffect.ts',
        ],
        'frontend.html',
      ),
      pageOf('backend.html', 'Express backend', 'Backend', ['server/index.ts']),
    ],
  }

  // Act
  const tree = chapterTreeOf(manifest)

  // Assert
  assert.deepEqual(tree, [
    'Section: Frontend',
    '  Frontend application (frontend.html): src 2',
    '    Routing and auth gate (frontend-routing.html): src 1',
    '    Hooks and shared helpers (frontend-hooks-lib.html): lib 3, src 1',
    'Section: Backend',
    '  Express backend (backend.html): server 1',
  ])
})

// Value: protects=the folder counts stay true to what a page cites: a file cited on several lines counts once, a root file shows as (root), and a page that cites nothing says so; fails_when=a repeated citation is counted twice, a root file is dropped, or an uncited page shows an empty count; why_new=Cycle 0117 (hypothesis B); seam=none; no_claim=how the agent weighs the counts
test('the chapter tree counts a file cited twice once, names root files (root), and marks a page that cites nothing', () => {
  // Arrange
  const manifest = {
    pages: [
      pageOf('index.html', 'Overview', 'Guide', [
        'README.md',
        'src/a.ts',
        'src/a.ts',
      ]),
      pageOf('empty.html', 'Glossary', 'Guide', [], 'index.html'),
    ],
  }

  // Act
  const tree = chapterTreeOf(manifest)

  // Assert
  assert.deepEqual(tree, [
    'Section: Guide',
    '  Overview (index.html): (root) 1, src 1',
    '    Glossary (empty.html): no cited sources',
  ])
})
