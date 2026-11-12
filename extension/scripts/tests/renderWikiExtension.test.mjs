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
    generated: { revision: 'abcdef1234', at: '2026-11-13' },
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

// Value: protects=the learner who opens the Wiki of a Chrome extension and finds the service worker only inside a settings page; fails_when=a Wiki whose only page citing the service worker cites one worker file and two settings files (so it is the settings page's own page, not the worker's) is rendered, or the refusal also names the settings page, or misses the service worker, or does not name the other contexts' files; why_new=Cycle 0123 (Issue 316, F2): P06's Wiki had one page, 'Service worker and settings'; seam=none (the real renderer); no_claim=that an editor AI writes a good page for each context
test('a Wiki whose only page citing the service worker is the settings page, which cites two settings files, is refused with one sentence for the service worker', async () => {
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
      'The Wiki documents a browser extension (manifest.json) but gives the service worker (background/service-worker.js) no page of its own: write a page whose sources name more files of the service worker (starting with background/service-worker.js) than of any other runtime context (popup/popup.html, fullpage/fullpage.html, settings/settings.html).',
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

// Value: protects=the Wiki of a Manifest V2 extension whose background scripts and content scripts must not share a page; fails_when=the renderer accepts one page that cites one file of each (a tie gives neither context the page), or does not name the background scripts and the content scripts of their match pattern; why_new=Cycle 0123 (Issue 316, F2); seam=none (the real renderer); no_claim=none
test('a Manifest V2 Wiki whose one page cites one background script and one content script is refused naming both because the tie gives neither the page', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': JSON.stringify({
        manifest_version: 2,
        name: 'Old',
        background: { scripts: ['bg/a.js'] },
        content_scripts: [
          { matches: ['https://example.com/*'], js: ['content/page.js'] },
        ],
      }),
      'bg/a.js': 'export const a = 1;\n',
      'content/page.js': 'export const page = 1;\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json', 'bg/a.js', 'content/page.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki documents a browser extension (manifest.json) but gives the background scripts (bg/a.js) no page of its own: write a page whose sources name more files of the background scripts (starting with bg/a.js) than of any other runtime context (content/page.js). The Wiki documents a browser extension (manifest.json) but gives the content scripts for https://example.com/* (content/page.js) no page of its own: write a page whose sources name more files of the content scripts for https://example.com/* (starting with content/page.js) than of any other runtime context (bg/a.js).',
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
      'The Wiki documents a browser extension (manifest.json) but gives the extension page extras/page.html (extras/page.html) no page of its own: write a page whose sources name more files of the extension page extras/page.html (starting with extras/page.html) than of any other runtime context (background/service-worker.js, popup/popup.html).',
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

// Value: protects=a popup page that also cites the service worker's message handler, which is good cross-context explanation; fails_when=a page citing two popup files and one worker file is refused or stops counting as the popup's own page; why_new=Cycle 0123 (Issue 316, F2): the strict version refused run 1's popup and full-page pages for citing the worker and the settings script; seam=none (the real renderer); no_claim=none
test('a popup page that also cites the service worker script still counts as the popup page because popup files outnumber worker files', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, MV3_FILES, [
      ['index.html', ['manifest.json', 'lib/shared.js']],
      ['worker.html', ['background/service-worker.js']],
      [
        'popup.html',
        ['popup/popup.html', 'popup/popup.js', 'background/service-worker.js'],
      ],
      ['fullpage.html', ['fullpage/fullpage.html', 'fullpage/fullpage.js']],
      ['settings.html', ['settings/settings.html', 'settings/settings.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=the rule that a page about two contexts equally is no context's own page; fails_when=a page citing one service worker file and one settings file is accepted as the own page of either; why_new=Cycle 0123 (Issue 316, F2): a tie must not give both contexts a page; seam=none (the real renderer); no_claim=none
test('a page citing one service worker file and one settings file is refused as the own page of both', async () => {
  await inProject(async (root) => {
    // Arrange
    const manifest = await wikiOf(root, MV3_FILES, [
      ['index.html', ['manifest.json', 'lib/shared.js']],
      [
        'worker-and-settings.html',
        ['background/service-worker.js', 'settings/settings.js'],
      ],
      ['popup.html', ['popup/popup.html', 'popup/popup.js']],
      ['fullpage.html', ['fullpage/fullpage.html', 'fullpage/fullpage.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki documents a browser extension (manifest.json) but gives the service worker (background/service-worker.js) no page of its own: write a page whose sources name more files of the service worker (starting with background/service-worker.js) than of any other runtime context (popup/popup.html, fullpage/fullpage.html, settings/settings.html). The Wiki documents a browser extension (manifest.json) but gives the extension page settings/settings.html (settings/settings.html) no page of its own: write a page whose sources name more files of the extension page settings/settings.html (starting with settings/settings.html) than of any other runtime context (background/service-worker.js, popup/popup.html, fullpage/fullpage.html).',
    )
  })
})

// Value: protects=each extension page a manifest key declares owes its own Wiki page; fails_when=a key (options, side panel, devtools, overrides, browser or page action) drops out of the renderer's page-key table; why_new=other tests only declare a worker and an action popup; seam=none; no_claim=real browser manifest acceptance (synthetic manifests)
test('every manifest key that declares an extension page owes that page a Wiki page of its own', async () => {
  const cases = [
    [{ options_page: 'p.html' }, 'the options page'],
    [{ options_ui: { page: 'p.html' } }, 'the options page'],
    [{ side_panel: { default_path: 'p.html' } }, 'the side panel'],
    [{ devtools_page: 'p.html' }, 'the devtools page'],
    [
      { chrome_url_overrides: { newtab: 'p.html' } },
      'the newtab override page',
    ],
    [
      { chrome_url_overrides: { bookmarks: 'p.html' } },
      'the bookmarks override page',
    ],
    [
      { chrome_url_overrides: { history: 'p.html' } },
      'the history override page',
    ],
    [{ browser_action: { default_popup: 'p.html' } }, 'the popup'],
    [{ page_action: { default_popup: 'p.html' } }, 'the popup'],
  ]
  for (const [keys, label] of cases) {
    await inProject(async (root) => {
      // Arrange
      const files = {
        'manifest.json': JSON.stringify({
          manifest_version: 2,
          name: 'X',
          ...keys,
        }),
        'p.html': '<p>page</p>\n',
      }
      const manifest = await wikiOf(root, files, [
        ['index.html', ['manifest.json']],
      ])

      // Act
      const outcome = await outcomeOf(manifest, root)

      // Assert
      assert.equal(
        outcome,
        `The Wiki documents a browser extension (manifest.json) but gives ${label} (p.html) no page of its own: write a page whose sources name more files of ${label} (starting with p.html) than of any other runtime context.`,
        JSON.stringify(keys),
      )
    })
  }
})

// Value: protects=URL, absolute and escaping manifest values owe no page while a query and hash are stripped from a relative one; fails_when=the path normalizer stops filtering them or stops stripping; why_new=only plain relative paths are exercised; seam=none; no_claim=none beyond protects
test('a popup declared as a URL, an absolute path or a path above the manifest owes no page, and one with a query and hash still owes its file', async () => {
  const pages = [['index.html', ['ext/manifest.json']]]
  const manifestOf = (popup) =>
    JSON.stringify({
      manifest_version: 3,
      name: 'X',
      action: { default_popup: popup },
    })
  await inProject(async (root) => {
    // Arrange
    const popups = [
      'https://example.com/ext/popup.html',
      '/ext/popup.html',
      '../popup.html',
    ]

    // Act
    const outsideOutcomes = []
    for (const popup of popups) {
      const manifest = await wikiOf(
        root,
        { 'ext/manifest.json': manifestOf(popup), 'popup.html': '<p>p</p>\n' },
        pages,
      )
      outsideOutcomes.push(await outcomeOf(manifest, root))
    }
    const withQuery = await wikiOf(
      root,
      {
        'ext/manifest.json': manifestOf('popup.html?x#y'),
        'ext/popup.html': '<p>p</p>\n',
      },
      pages,
    )
    const queryOutcome = await outcomeOf(withQuery, root)

    // Assert
    assert.deepEqual(outsideOutcomes, ['rendered', 'rendered', 'rendered'])
    assert.equal(
      queryOutcome,
      'The Wiki documents a browser extension (ext/manifest.json) but gives the popup (ext/popup.html) no page of its own: write a page whose sources name more files of the popup (starting with ext/popup.html) than of any other runtime context.',
    )
  })
})

// Value: protects=a page declared twice, as options_page and options_ui.page, is one context; fails_when=the seen-pages dedup is removed so two sentences name one page; why_new=no case declares a page twice; seam=none; no_claim=none beyond protects
test('an options page declared as options_page and options_ui.page is refused with one sentence', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'X',
        options_page: 'options.html',
        options_ui: { page: 'options.html' },
      }),
      'options.html': '<p>options</p>\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(
      outcome,
      'The Wiki documents a browser extension (manifest.json) but gives the options page (options.html) no page of its own: write a page whose sources name more files of the options page (starting with options.html) than of any other runtime context.',
    )
  })
})

// Value: protects=a single-quoted script src in a popup HTML puts that script in the popup context; fails_when=the script-src pattern loses its single-quote branch so a page citing that script owns nothing; why_new=only double quotes are exercised; seam=none; no_claim=none beyond protects
test('a popup page citing only the script its HTML loads with a single-quoted src is its own page', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'X',
        action: { default_popup: 'popup/popup.html' },
      }),
      'popup/popup.html': "<script src='popup.js'></script>\n",
      'popup/popup.js': 'export const popup = 1;\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json']],
      ['popup.html', ['popup/popup.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

/** The files of a popup under `popup/` that loads its script from `scripts/`, beside a service worker, under the given manifest path folder. */
function scriptsFolderFiles(prefix, popupScriptSrc) {
  return {
    [`${prefix}manifest.json`]: MV3_MANIFEST,
    [`${prefix}background/service-worker.js`]: 'export const worker = 1;\n',
    [`${prefix}popup/popup.html`]: `<script src="${popupScriptSrc}"></script>\n`,
    [`${prefix}scripts/popup.js`]: 'export const popup = 1;\n',
  }
}

// Value: protects=a popup whose HTML loads its script from a sibling folder (../scripts/popup.js) or from the extension root (/scripts/popup.js); fails_when=the page's script resolver rejects ../ or treats a leading / as no file, so a page citing scripts/popup.js is refused as not the popup's page; why_new=Cycle 0123 /ship review P1: extensionPathOf rejected every ../; seam=none (the real renderer); no_claim=none beyond protects
test('a popup page citing the script its HTML loads through ../scripts/ or /scripts/ is the popup page', async () => {
  const pages = [
    ['index.html', ['manifest.json']],
    ['worker.html', ['background/service-worker.js']],
    ['popup.html', ['scripts/popup.js']],
  ]
  const outcomes = []
  for (const src of ['../scripts/popup.js', '/scripts/popup.js']) {
    await inProject(async (root) => {
      // Arrange
      const manifest = await wikiOf(root, scriptsFolderFiles('', src), pages)

      // Act
      outcomes.push(await outcomeOf(manifest, root))
    })
  }

  // Assert
  assert.deepEqual(outcomes, ['rendered', 'rendered'])
})

// Value: protects=a script reference that is no file of the extension (a protocol-relative URL, or ../ climbing above the manifest's folder) must not join the popup; fails_when=either reference gives the popup a file, so the page citing it is accepted; why_new=Cycle 0123 /ship review P1: the new resolver must keep the extension root as its ceiling; seam=none (the real renderer); no_claim=none beyond protects
test('a popup page citing a file its HTML reaches only through a protocol-relative URL or a ../ above the manifest folder is refused', async () => {
  const refusal =
    'The Wiki documents a browser extension (ext/manifest.json) but gives the popup (ext/popup/popup.html) no page of its own: write a page whose sources name more files of the popup (starting with ext/popup/popup.html) than of any other runtime context (ext/background/service-worker.js).'
  const outcomes = []
  for (const [src, cited] of [
    ['//cdn.example.com/x.js', 'x.js'],
    ['../../outside.js', 'outside.js'],
  ]) {
    await inProject(async (root) => {
      // Arrange
      const files = {
        ...scriptsFolderFiles('ext/', src),
        [cited]: 'export const reached = 1;\n',
      }
      const manifest = await wikiOf(root, files, [
        // The index page explains the script the popup's HTML does not reach, so only the popup's own page is missing.
        ['index.html', ['ext/manifest.json', 'ext/scripts/popup.js']],
        ['worker.html', ['ext/background/service-worker.js']],
        ['popup.html', [cited]],
      ])

      // Act
      outcomes.push(await outcomeOf(manifest, root))
    })
  }

  // Assert
  assert.deepEqual(outcomes, [refusal, refusal])
})

// Value: protects=two content_scripts entries that load the same js file (one per match pattern); fails_when=the shared file makes both contexts own nothing so no page can satisfy them, or the duplicate is not one context; why_new=Cycle 0123 /ship review P1; seam=none (the real renderer); no_claim=none beyond protects
test('two content script entries loading the same file are one context that a page citing that file satisfies', async () => {
  const files = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'X',
      content_scripts: [
        { matches: ['https://a.example/*'], js: ['content.js'] },
        { matches: ['https://b.example/*'], js: ['content.js'] },
      ],
    }),
    'content.js': 'export const content = 1;\n',
  }
  await inProject(async (root) => {
    // Arrange
    const withPage = await wikiOf(root, files, [
      ['index.html', ['manifest.json']],
      ['content.html', ['content.js']],
    ])
    const withoutPage = {
      ...(await wikiOf(root, files, [['index.html', ['manifest.json']]])),
      coverageExceptions: [
        { path: 'content.js', reason: 'Left out on purpose.' },
      ],
    }

    // Act
    const outcomes = [
      await outcomeOf(withPage, root),
      await outcomeOf(withoutPage, root),
    ]

    // Assert
    assert.deepEqual(outcomes, [
      'rendered',
      'The Wiki documents a browser extension (manifest.json) but gives the content scripts for https://a.example/* (content.js) no page of its own: write a page whose sources name more files of the content scripts for https://a.example/* (starting with content.js) than of any other runtime context.',
    ])
  })
})

// Value: protects=a content script entry whose files another entry also loads owns nothing a page could be about; fails_when=the subset entry [a.js] beside [a.js, b.js] is refused though no page can be about it alone; why_new=Cycle 0123 /ship review P1: every refusal must be satisfiable by writing pages; seam=none (the real renderer); no_claim=none beyond protects
test('a content script entry whose files another entry also loads owes no page of its own', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'X',
        content_scripts: [
          { matches: ['https://a.example/*'], js: ['a.js'] },
          { matches: ['https://b.example/*'], js: ['a.js', 'b.js'] },
        ],
      }),
      'a.js': 'export const a = 1;\n',
      'b.js': 'export const b = 1;\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json', 'a.js']],
      ['content.html', ['b.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a popup whose HTML holds a commented-out script tag for the service worker's file; fails_when=the commented tag gives the popup the worker's file so the worker's page is refused or the file belongs to no context; why_new=Cycle 0123 /ship review P2; seam=none (the real renderer); no_claim=none beyond protects
test('a script tag inside an HTML comment in the popup does not move the service worker file into the popup', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'X',
        background: { service_worker: 'worker.js' },
        action: { default_popup: 'popup.html' },
      }),
      'worker.js': 'export const worker = 1;\n',
      'popup.html':
        '<!-- <script src="worker.js"></script> -->\n<script src="popup.js"></script>\n',
      'popup.js': 'export const popup = 1;\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json']],
      ['worker.html', ['worker.js']],
      ['popup.html', ['popup.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})

// Value: protects=a bundler's output folder holding HTML copies of the extension's pages; fails_when=an undeclared dist/index.html makes the renderer demand a page of its own; why_new=Cycle 0123 /ship review Low; seam=none (the real renderer); no_claim=none beyond protects
test('an undeclared HTML file under dist/ owes no page', async () => {
  await inProject(async (root) => {
    // Arrange
    const files = {
      'manifest.json': MV3_MANIFEST,
      'background/service-worker.js': 'export const worker = 1;\n',
      'dist/index.html': '<p>build output</p>\n',
    }
    const manifest = await wikiOf(root, files, [
      ['index.html', ['manifest.json']],
      ['worker.html', ['background/service-worker.js']],
    ])

    // Act
    const outcome = await outcomeOf(manifest, root)

    // Assert
    assert.equal(outcome, 'rendered')
  })
})
