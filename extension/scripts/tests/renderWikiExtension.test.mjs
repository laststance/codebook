import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

/** The manifest of the Chrome extension the tests model: a service worker, a toolbar popup and a page of its own beside two undeclared pages. */
const MV3_MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'Bookmarks',
  background: { service_worker: 'background/service-worker.js' },
  action: { default_popup: 'popup/popup.html' },
})

/** The files of that extension: every page loads its own script, and `lib/shared.js` is loaded by none. */
const MV3_FILES = {
  'manifest.json': MV3_MANIFEST,
  'background/service-worker.js': 'export const worker = 1;\n',
  'popup/popup.html': '<script src="popup.js"></script>\n',
  'popup/popup.js': 'export const popup = 1;\n',
  'fullpage/fullpage.html': '<script src="./fullpage.js?v=2"></script>\n',
  'fullpage/fullpage.js': 'export const fullpage = 1;\n',
  'settings/settings.html': '<script src="settings.js"></script>\n',
  'settings/settings.js': 'export const settings = 1;\n',
  'lib/shared.js': 'export const shared = 1;\n',
}

/** The pages of the Wiki of {@link MV3_FILES} with a page of its own for every context: the overview cites the manifest and the shared library only. */
const OWN_PAGES = [
  ['index.html', ['manifest.json', 'lib/shared.js']],
  ['worker.html', ['background/service-worker.js']],
  ['popup.html', ['popup/popup.html', 'popup/popup.js']],
  ['fullpage.html', ['fullpage/fullpage.html', 'fullpage/fullpage.js']],
  ['settings.html', ['settings/settings.html', 'settings/settings.js']],
]

/**
 * Writes the files into a project folder and answers a Wiki manifest whose pages cite the given paths.
 * Called by every test below; each fixture is below the depth thresholds (12 explained files, 1,200 lines) so only the extension rule can refuse it.
 * @param root - The project folder.
 * @param files - The included files by path.
 * @param pages - `[path, sourcePaths]` for each page; the first is the index page.
 * @example await wikiOf(root, MV3_FILES, OWN_PAGES)
 */
async function wikiOf(root, files, pages) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    generated: { revision: '1234567890', at: '2026-11-13' },
    includedSources: Object.entries(files).map(([path, text]) => ({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
    })),
    pages: pages.map(([path, sources]) => ({
      path,
      title: path,
      section: 'Guide',
      contentHtml: `<p id="flow">This page explains ${path} in its own words.</p>`,
      sources: sources.map((source) => ({ path: source, line: 1 })),
      outline: [{ id: 'flow', label: 'Flow' }],
    })),
  }
}

/** Renders a manifest and answers `rendered` or the refusal's message. Called by every test below. */
async function outcomeOf(manifest, root) {
  return renderWikiPages(manifest, {
    projectRoot: root,
    outputDirectory: join(root, '.codebook/wiki'),
  }).then(
    () => 'rendered',
    (error) => error.message,
  )
}

/** Runs a test body in a fresh real project folder and removes it afterwards. */
async function inProject(body) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-render-extension-')),
  )
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// Value: protects=the learner who opens the Wiki of a Chrome extension and finds the service worker only inside a settings page; fails_when=a Wiki whose one page names the service worker with the settings page's files is rendered, or the refusal misses the service worker or the undeclared settings page, or does not name the other contexts' files; why_new=Cycle 0123 (Issue 316, F2): P06's Wiki had one page, 'Service worker and settings'; seam=none (the real renderer); no_claim=that an editor AI writes a good page for each context
test('a Wiki that documents the service worker only beside the settings page is refused with a sentence for the worker and one for the settings page', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, MV3_FILES, [
      ['index.html', ['manifest.json', 'lib/shared.js']],
      [
        'worker-and-settings.html',
        [
          'manifest.json',
          'background/service-worker.js',
          'settings/settings.js',
          'settings/settings.html',
        ],
      ],
      ['popup.html', ['popup/popup.html', 'popup/popup.js']],
      ['fullpage.html', ['fullpage/fullpage.html', 'fullpage/fullpage.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki documents a browser extension (manifest.json) but gives the service worker (background/service-worker.js) no page of its own: write a page whose sources name background/service-worker.js and no file of another runtime context (popup/popup.html, fullpage/fullpage.html, settings/settings.html). The Wiki documents a browser extension (manifest.json) but gives the extension page settings/settings.html (settings/settings.html) no page of its own: write a page whose sources name settings/settings.html and no file of another runtime context (background/service-worker.js, popup/popup.html, fullpage/fullpage.html).',
    )
  })
})

// Value: protects=the Wiki of a Chrome extension that does give every runtime context a page of its own; fails_when=the renderer refuses a Wiki with one page per context, or counts a script the HTML loads with a query string as another context's file; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=that the pages explain anything well
test('a Wiki with one page of its own for the worker, the popup and each undeclared extension page is rendered', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, MV3_FILES, OWN_PAGES)

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the Wiki of a web app, whose public/manifest.json is a PWA manifest and no browser extension; fails_when=a manifest without manifest_version, or one with unparsable JSON, makes the renderer demand a page for each HTML file; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=none
test('a web-app manifest without manifest_version and an unparsable manifest.json owe no page per HTML file', async () => {
  await inProject(async (root) => {
    // Arrange
    const webApp = await wikiOf(
      root,
      {
        'public/manifest.json': JSON.stringify({ name: 'App', start_url: '/' }),
        'public/index.html': '<script src="main.js"></script>\n',
        'public/main.js': 'export const main = 1;\n',
        'public/other.html': '<p>other</p>\n',
      },
      [['index.html', ['public/main.js']]],
    )
    const broken = await wikiOf(
      root,
      {
        'broken/manifest.json': '{ "manifest_version": 3, ',
        'broken/page.html': '<p>page</p>\n',
        'broken/page.js': 'export const page = 1;\n',
      },
      [['index.html', ['broken/page.js']]],
    )

    // Act
    const outcomes = [
      await outcomeOf(webApp, root),
      await outcomeOf(broken, root),
    ]

    // Assert
    assert.deepEqual(outcomes, ['rendered', 'rendered'])
  })
})

// Value: protects=the Wiki of a Manifest V2 extension whose background scripts and content scripts must not share a page; fails_when=the renderer accepts one page for both, or does not name the background scripts and the content scripts of their match pattern; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=none
test('a Manifest V2 Wiki whose one page covers the background scripts and a content script group is refused naming both', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': JSON.stringify({
        manifest_version: 2,
        name: 'Old',
        background: { scripts: ['bg/a.js', 'bg/b.js'] },
        content_scripts: [
          { matches: ['https://example.com/*'], js: ['content/page.js'] },
        ],
      }),
      'bg/a.js': 'export const a = 1;\n',
      'bg/b.js': 'export const b = 1;\n',
      'content/page.js': 'export const page = 1;\n',
    }
    const manifest = await wikiOf(root, files, [
      [
        'index.html',
        ['manifest.json', 'bg/a.js', 'bg/b.js', 'content/page.js'],
      ],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki documents a browser extension (manifest.json) but gives the background scripts (bg/a.js) no page of its own: write a page whose sources name bg/a.js and no file of another runtime context (content/page.js). The Wiki documents a browser extension (manifest.json) but gives the content scripts for https://example.com/* (content/page.js) no page of its own: write a page whose sources name content/page.js and no file of another runtime context (bg/a.js).',
    )
  })
})

// Value: protects=the Wiki of an extension whose manifest names a file the Wiki does not include; fails_when=the renderer demands a page for a declared context whose file is not an included source; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=none
test('a declared popup whose HTML file is not an included source owes no page', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': MV3_MANIFEST,
      'background/service-worker.js': 'export const worker = 1;\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json', 'background/service-worker.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a repository whose test fixtures include HTML pages; fails_when=an HTML file under a tests, fixtures or similar folder makes the renderer demand a page of its own while a same-named page outside those folders still must have one; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=none
test('an HTML file under tests/ owes no page while the same file outside it does', async () => {
  await inProject(async (root) => {
    // Arrange
    const base = {
      'manifest.json': MV3_MANIFEST,
      'background/service-worker.js': 'export const worker = 1;\n',
      'popup/popup.html': '<script src="popup.js"></script>\n',
      'popup/popup.js': 'export const popup = 1;\n',
    }
    const pages = [
      ['index.html', ['manifest.json']],
      ['worker.html', ['background/service-worker.js']],
      ['popup.html', ['popup/popup.html', 'popup/popup.js']],
    ]
    const testsFolder = await wikiOf(
      root,
      { ...base, 'tests/page.html': '<p>fixture</p>\n' },
      pages,
    )
    const otherFolder = await wikiOf(
      root,
      { ...base, 'extras/page.html': '<p>page</p>\n' },
      pages,
    )

    // Act
    const outcomes = [
      await outcomeOf(testsFolder, root),
      await outcomeOf(otherFolder, root),
    ]

    // Assert
    assert.deepEqual(outcomes, [
      'rendered',
      'The Wiki documents a browser extension (manifest.json) but gives the extension page extras/page.html (extras/page.html) no page of its own: write a page whose sources name extras/page.html and no file of another runtime context (background/service-worker.js, popup/popup.html).',
    ])
  })
})

// Value: protects=a page about one context that also cites the manifest and a shared library; fails_when=citing manifest.json or a file no context loads makes a page lose its own-page status; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=none
test('a service worker page that also cites the manifest and a shared library still counts as its own page', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, MV3_FILES, [
      ['index.html', ['manifest.json']],
      [
        'worker.html',
        ['manifest.json', 'background/service-worker.js', 'lib/shared.js'],
      ],
      ['popup.html', ['popup/popup.html', 'popup/popup.js']],
      ['fullpage.html', ['fullpage/fullpage.html', 'fullpage/fullpage.js']],
      ['settings.html', ['settings/settings.html', 'settings/settings.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})
