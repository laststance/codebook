import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { startDeepWikiReader } from '../deepWikiReader'
import { rebindDeepWikiEditorLinks } from '../utils/rebindDeepWikiEditorLinks'

import { publishedWikiFixture } from './utils/publishedWikiFixture'

/** The shell every newly published page is rendered from; tests run from `dist/tests`. */
const readShell = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'reader-shell.html'),
    'utf8',
  )

test('the published page groups the freshness label, the update button and an offline note in that order', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.ok(
    shell.includes(
      '<aside class="right-rail" aria-label="Article outline and Wiki status"><div data-codebook-update-group><p data-codebook-freshness data-status="unknown">Open from Codebook to check freshness</p><a class="wiki-update" href="{{UPDATE}}">Update LLM Wiki</a><p data-codebook-update-status>Offline copy. Update progress shows in the editor, or here when this Wiki is opened from Codebook.</p></div><nav aria-label="On this page">',
    ),
  )
})

test('the offline note of the published page claims no live status role', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.doesNotMatch(shell, /<p data-codebook-update-status[^>]*role=/)
})

test('the published page draws the group as a panel with a filled update button and bounds it in the narrow layout', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  for (const rule of [
    '.wiki-update{display:inline-block;border:1px solid var(--link);padding:.4rem .6rem;border-radius:5px;text-decoration:none;background:var(--link);color:var(--bg);font-weight:600}',
    '[data-codebook-update-group]{background:var(--panel-2);border:1px solid var(--border);border-radius:6px;padding:.6rem}',
    '[data-codebook-update-status]{font-size:.75rem;line-height:1.45;margin:.5rem 0 0;color:var(--muted);overflow-wrap:anywhere}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
  assert.match(
    shell,
    /@media\(max-width:1000px\)\{[^\n]*\[data-codebook-update-group\]\{flex:0 1 28rem;min-width:0;align-self:flex-start\}/,
  )
})

test('the published page animates nothing in the update group', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.doesNotMatch(shell, /@keyframes/)
  assert.doesNotMatch(
    shell,
    /(?:wiki-update|data-codebook-update[\w-]*\]?)[^{}]*\{[^}]*(?:animation|transition)/,
  )
})

test('the published page changes the update button and the reload button under the pointer and while pressed, and not the held-back button', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  for (const rule of [
    '.wiki-update:not([aria-disabled=true]):hover,[data-codebook-reload]:hover{filter:brightness(.9)}',
    '.wiki-update:not([aria-disabled=true]):active,[data-codebook-reload]:active{filter:brightness(.8)}',
    // The entry that opens the page's source is unfilled, so the pointer gives the whole entry a fill and a link-coloured border, a press darkens it, and the focus ring of its link is drawn inside the whole entry.
    '.open-in-editor:hover{background:var(--panel-2);border-color:var(--link)}',
    '.open-in-editor:active{background:var(--panel-2);border-color:var(--link);filter:brightness(.9)}',
    '.open-in-editor a:focus-visible{outline:none}.open-in-editor a:focus-visible::after{outline:2px solid var(--link);outline-offset:-2px}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
  // The entry changes at once, so reduced motion needs no rule of its own.
  assert.doesNotMatch(
    shell,
    /\.open-(?:in-editor|target)[^{}]*\{[^}]*(?:animation|transition)/,
  )
  assert.deepEqual(
    shell.match(
      /\.wiki-update(?!:not\(\[aria-disabled=true\]\))[^{},]*:(?:hover|active)/g,
    ),
    null,
  )
})

test('the published page draws Reload filled and the update button outlined while a reload is offered', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  const filledUpdate =
    '.wiki-update{display:inline-block;border:1px solid var(--link);padding:.4rem .6rem;border-radius:5px;text-decoration:none;background:var(--link);color:var(--bg);font-weight:600}'
  const outlinedUpdate =
    '[data-codebook-reload-offered] .wiki-update:not([aria-disabled=true]){background:var(--panel);color:var(--link)}'
  assert.ok(
    shell.includes(
      '[data-codebook-reload]{border-color:var(--link);background:var(--link);color:var(--bg);font-weight:600}',
    ),
  )
  assert.ok(shell.includes(outlinedUpdate))
  assert.ok(shell.indexOf(outlinedUpdate) > shell.indexOf(filledUpdate))
})

/** Reads the colour tokens of one theme block of the shell's stylesheet, by name without the leading dashes. */
function readThemeTokens(
  shell: string,
  blockStart: string,
): Map<string, string> {
  const block = shell.slice(shell.indexOf(blockStart))
  const declarations = block.slice(0, block.indexOf('}'))
  return new Map(
    [...declarations.matchAll(/--([\w-]+):(#[0-9a-f]{3,6})/g)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  )
}

/** The WCAG 2 contrast ratio of two sRGB colours given as #rgb or #rrggbb. */
function contrastRatio(foreground: string, background: string): number {
  const luminance = (colour: string): number => {
    const hex =
      colour.length === 4
        ? [...colour.slice(1)].map((digit) => digit + digit).join('')
        : colour.slice(1)
    const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const [lighter = 0, darker = 0] = [
    luminance(foreground),
    luminance(background),
  ].sort((first, second) => second - first)
  return (lighter + 0.05) / (darker + 0.05)
}

test('every text colour of the update panel keeps 4.5:1 on the panel background in the light and the dark theme', async () => {
  // Arrange
  const shell = await readShell()
  const themes = {
    light: readThemeTokens(shell, ':root{'),
    dark: readThemeTokens(shell, 'html[data-theme=dark]{'),
  }

  // Act: the status text, the muted lines, the three state colours and the outlined button's text on the panel; the filled button's text on its fill.
  const lowestRatios = Object.fromEntries(
    Object.entries(themes).map(([theme, tokens]) => {
      const colourOf = (name: string): string => tokens.get(name) ?? ''
      const ratios = [
        ...['text', 'muted', 'current', 'changed', 'unknown', 'link'].map(
          (name) => contrastRatio(colourOf(name), colourOf('panel-2')),
        ),
        contrastRatio(colourOf('link'), colourOf('panel')),
        contrastRatio(colourOf('bg'), colourOf('link')),
      ]
      return [theme, Math.round(Math.min(...ratios) * 100) / 100]
    }),
  )

  // Assert
  assert.deepEqual(lowestRatios, { light: 5.48, dark: 7.42 })
})

// Value: protects=the text of the rail entry that opens a page's source, at rest and under the pointer; fails_when=a token changes so that the entry's label or its target falls below 4.5:1 on the page background or on the fill the pointer gives it, in either theme; why_new=Cycle 0046 row 28 (design review DR-9); seam=none
test('the label and the target of the entry that opens the page’s source keep 4.5:1 at rest and under the pointer in the light and the dark theme', async () => {
  // Arrange
  const shell = await readShell()
  const themes = {
    light: readThemeTokens(shell, ':root{'),
    dark: readThemeTokens(shell, 'html[data-theme=dark]{'),
  }

  // Act: the label is the link colour and the target the muted colour; at rest they stand on the page background, under the pointer on the second panel colour.
  const ratios = Object.fromEntries(
    Object.entries(themes).map(([theme, tokens]) => {
      const ratioOf = (text: string, background: string): number =>
        Math.round(
          contrastRatio(tokens.get(text) ?? '', tokens.get(background) ?? '') *
            100,
        ) / 100
      return [
        theme,
        {
          labelAtRest: ratioOf('link', 'bg'),
          labelUnderPointer: ratioOf('link', 'panel-2'),
          targetAtRest: ratioOf('muted', 'bg'),
          targetUnderPointer: ratioOf('muted', 'panel-2'),
        },
      ]
    }),
  )

  // Assert
  assert.deepEqual(ratios, {
    light: {
      labelAtRest: 6.64,
      labelUnderPointer: 6.13,
      targetAtRest: 5.95,
      targetUnderPointer: 5.49,
    },
    dark: {
      labelAtRest: 10.2,
      labelUnderPointer: 8.02,
      targetAtRest: 9.44,
      targetUnderPointer: 7.42,
    },
  })
})

test('the reader’s rail offers to open the page’s source in the editor that serves it', async () => {
  // Arrange: a Wiki published by the shipped publisher, whose overview cites source.ts line 1.
  const wiki = await publishedWikiFixture()
  const answer = async (): Promise<never> => {
    throw new Error('No model request expected.')
  }
  const cursorReader = await startDeepWikiReader(
    wiki.outputDirectory,
    wiki.projectRoot,
    answer,
    'cursor',
  )
  const codeReader = await startDeepWikiReader(
    wiki.outputDirectory,
    wiki.projectRoot,
    answer,
    'vscode',
  )
  try {
    // Act
    const publishedPage = await readFile(
      join(wiki.outputDirectory, 'index.html'),
      'utf8',
    )
    const servedByCursor = await (await fetch(cursorReader.url)).text()
    const servedByCode = await (await fetch(codeReader.url)).text()

    // Assert: the control sits between the outline and the output box. Its link carries the address of the page's first citation and holds the editor's name alone; the file and line it opens are shown beside the link, and a hidden copy of them as written describes it.
    const firstCitation =
      /<details class="source-files">.*?<a href="([^"]+)">/.exec(
        publishedPage,
      )?.[1] ?? ''
    assert.match(
      firstCitation,
      /^vscode:\/\/laststance\.codebook\/source\?root=[^"]+&amp;path=source\.ts&amp;line=1&amp;sha256=[a-f0-9]{64}$/,
    )
    assert.ok(
      publishedPage.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation}" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p><div class="output">`,
      ),
    )
    assert.ok(
      servedByCode.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation}" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p><div class="output">`,
      ),
    )
    assert.ok(
      servedByCursor.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation.replace('vscode://', 'cursor://')}" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p><div class="output">`,
      ),
    )
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()])
    await wiki.cleanup()
  }
})

// Value: protects=the rail entry of a Wiki published by 0.2.29.0, whose pages carry the entry as one link, "Open in VS Code", with nothing beside it; fails_when=the reader serves such a page without the file and line the entry opens, so the learner must publish the Wiki again to see where the entry leads, or names the wrong editor in it, or leaves the link without its description; why_new=Cycle 0046 row 28 (design review DR-8, finding F16), row 69; seam=none
test('a page published by 0.2.29.0 is served by both editors with the entry named after that editor and the file and line read from its address', async () => {
  // Arrange: a published Wiki whose overview is put back into the shape 0.2.29.0 printed: the entry is its link alone, with no description and nothing beside it.
  const wiki = await publishedWikiFixture()
  const indexPath = join(wiki.outputDirectory, 'index.html')
  const publishedToday = await readFile(indexPath, 'utf8')
  const publishedBy02290 = publishedToday.replace(
    ' aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p>',
    '>Open in VS Code</a></p>',
  )
  await writeFile(indexPath, publishedBy02290)
  const answer = async (): Promise<never> => {
    throw new Error('No model request expected.')
  }
  const cursorReader = await startDeepWikiReader(
    wiki.outputDirectory,
    wiki.projectRoot,
    answer,
    'cursor',
  )
  const codeReader = await startDeepWikiReader(
    wiki.outputDirectory,
    wiki.projectRoot,
    answer,
    'vscode',
  )
  try {
    // Act
    const servedByCursor = await (await fetch(cursorReader.url)).text()
    const servedByCode = await (await fetch(codeReader.url)).text()

    // Assert
    const address =
      /<p class="open-in-editor"><a href="([^"]+)">Open in VS Code<\/a><\/p>/.exec(
        publishedBy02290,
      )?.[1] ?? ''
    assert.match(
      address,
      /^vscode:\/\/laststance\.codebook\/source\?root=[^"]+&amp;path=source\.ts&amp;line=1&amp;sha256=[a-f0-9]{64}$/,
    )
    assert.ok(
      servedByCode.includes(
        `<p class="open-in-editor"><a href="${address}" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p>`,
      ),
    )
    assert.ok(
      servedByCursor.includes(
        `<p class="open-in-editor"><a href="${address.replace('vscode://', 'cursor://')}" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p>`,
      ),
    )
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()])
    await wiki.cleanup()
  }
})

/**
 * Does to a page what the reader of 0.2.29.0 did to every page it served, so a test can read a page of this build as that reader shows it.
 *
 * The two replacements are quoted from `extension/src/utils/rebindDeepWikiEditorLinks.ts` at the tag v0.2.29.0 (`ae9c1f2`): the scheme of Codebook's links, and the label of the rail's entry by a pattern that expects the label to be the whole content of the entry's link. The suite cannot load that build, so the test applies its pattern. Called by the test of a page of this build under that reader.
 *
 * @param html - A published page.
 * @param editorScheme - The scheme of the editor that reader runs in.
 * @returns The page as the reader of 0.2.29.0 serves it.
 * @example
 * rebindAsTheReaderOf02290('<p class="open-in-editor"><a href="vscode://laststance.codebook/source?x=1">Open in VS Code</a></p>', 'cursor')
 * // => '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?x=1">Open in Cursor</a></p>'
 */
function rebindAsTheReaderOf02290(
  html: string,
  editorScheme: 'vscode' | 'cursor',
): string {
  return html
    .replace(
      /(\s)href=(["'])(?:vscode|cursor):\/\/laststance\.codebook\/(source|update|settings)\?/g,
      (_match, whitespace: string, quote: string, route: string) =>
        `${whitespace}href=${quote}${editorScheme}://laststance.codebook/${route}?`,
    )
    .replace(
      /(<p class="open-in-editor"><a [^>]*>)Open in (?:VS Code|Cursor)(<\/a>)/g,
      (_match, opening: string, closing: string) =>
        `${opening}Open in ${editorScheme === 'cursor' ? 'Cursor' : 'VS Code'}${closing}`,
    )
}

// Value: protects=a Wiki published by this build that is opened in a Cursor which still runs Codebook 0.2.29.0; fails_when=the publisher prints the entry's label as anything but the whole content of its link, so that reader opens Cursor from an entry that still reads "Open in VS Code"; why_new=Cycle 0046 row 69 (the entry of design review DR-8 put the label into a span, which the pattern of 0.2.29.0 does not match); seam=none
test('a page published by this build is served by the reader of 0.2.29.0 in Cursor with the entry named Open in Cursor, a cursor address and the file and line beside it', async () => {
  // Arrange: a Wiki published by the shipped publisher, whose overview cites source.ts line 1.
  const wiki = await publishedWikiFixture()
  try {
    const publishedPage = await readFile(
      join(wiki.outputDirectory, 'index.html'),
      'utf8',
    )

    // Act: the two replacements of the reader of 0.2.29.0, as Cursor. This is the pattern of that build applied to the page, not that build running.
    const servedByCursor = rebindAsTheReaderOf02290(publishedPage, 'cursor')

    // Assert: the whole entry, with the project's folder and the source's hash left out of its address.
    const entry =
      /<p class="open-in-editor">.*?<\/p>/.exec(servedByCursor)?.[0] ?? ''
    assert.equal(
      entry
        .replace(/root=[^&]+&amp;/, 'root=…&amp;')
        .replace(/sha256=[a-f0-9]{64}/, 'sha256=…'),
      '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=…&amp;path=source.ts&amp;line=1&amp;sha256=…" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">source.ts<wbr>:1</span><span class="sr-only" id="codebook-open-target">source.ts:1</span></p>',
    )
    assert.equal(
      servedByCursor.includes('Open in VS Code'),
      false,
      'the page Cursor serves still names VS Code',
    )
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the target the reader adds beside the link of a rail entry published by 0.2.29.0; fails_when=a path with folders is printed without its break points or with a character of the address unescaped, or the line number can break away from its colon or inside itself (no break point before the colon), or an address that names no line gets an invented target; why_new=Cycle 0046 row 28 (design review DR-8), rows 68 and 69; seam=none
test('the target added to an entry of 0.2.29.0 breaks after each slash and before the colon and is escaped, and an address without a line keeps its link alone', () => {
  // Arrange: an entry in the shape of 0.2.29.0 for src/utils/a&b.ts line 12, and one whose address names no line.
  const withTarget =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa%26b.ts&amp;line=12&amp;sha256=0f">Open in VS Code</a></p>'
  const withoutLine =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa.ts">Open in VS Code</a></p>'

  // Act
  const served = [
    rebindDeepWikiEditorLinks(withTarget, 'cursor'),
    rebindDeepWikiEditorLinks(withoutLine, 'cursor'),
  ]

  // Assert
  assert.deepEqual(served, [
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa%26b.ts&amp;line=12&amp;sha256=0f" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a&amp;b.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a&amp;b.ts:12</span></p>',
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa.ts">Open in Cursor</a></p>',
  ])
})

// Value: protects=the rail entry of a Wiki published by 0.2.29.0 on a page whose own content carries the id the reader gives the entry's target; fails_when=the reader adds the target under an id an element of the page already carries, so the id stands twice and the entry's link is described by a heading of the article instead of by the file and line it opens; why_new=Cycle 0046 row 84; seam=none
test('the target added to an entry of 0.2.29.0 takes an id of its own on a page whose article already carries the target’s id', () => {
  // Arrange: a page of 0.2.29.0 whose article has a heading with the id codebook-open-target and one with the first free id after it, in single quotes and without quotes.
  const page =
    "<h2 id='codebook-open-target'>Targets</h2><h2 ID=codebook-open-target-2>More</h2>" +
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=0f">Open in VS Code</a></p>'

  // Act
  const served = rebindDeepWikiEditorLinks(page, 'vscode')

  // Assert: the link names the added target, and no id of the page stands twice.
  assert.equal(
    served,
    "<h2 id='codebook-open-target'>Targets</h2><h2 ID=codebook-open-target-2>More</h2>" +
      '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=0f" aria-describedby="codebook-open-target-3">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target-3">src/a.ts:12</span></p>',
  )
})

// Value: protects=what assistive technology is told the rail entry opens on a page published by 0.2.29.0; fails_when=the reader adds the shown target with its wrap points as the link's description again, so Chrome describes the link as "src/ utils/ a.ts :12" and "package.json :31", a path that is not the file's, or the shown target stays in the accessibility tree beside its description; why_new=Cycle 0046 finding 600 (observed natively in Chrome for Testing on C55: the description "package.json :31"); seam=none, the served page is compared as text and the description is read in Chrome by the Wiki reader DOM check
test('the entry of a page of 0.2.29.0 is served with the file and line shown with wrap points but hidden from assistive technology, and described by the file and line as written', () => {
  // Arrange: two entries in the shape of 0.2.29.0, for src/utils/a.ts line 12 and for package.json line 31.
  const withFolders =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa.ts&amp;line=12&amp;sha256=0f">Open in VS Code</a></p>'
  const withoutFolders =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=package.json&amp;line=31&amp;sha256=0f">Open in VS Code</a></p>'

  // Act
  const served = [
    rebindDeepWikiEditorLinks(withFolders, 'vscode'),
    rebindDeepWikiEditorLinks(withoutFolders, 'cursor'),
  ]

  // Assert
  assert.deepEqual(served, [
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa.ts&amp;line=12&amp;sha256=0f" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a.ts:12</span></p>',
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=package.json&amp;line=31&amp;sha256=0f" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">package.json<wbr>:31</span><span class="sr-only" id="codebook-open-target">package.json:31</span></p>',
  ])
})

// Value: protects=a Wiki published by a build of Cycle 0046 before finding 600 (the candidates up to C55), whose entry's link is described by the shown target with its wrap points; fails_when=the reader serves such a page as published, so Chrome describes its link as "package.json :31" or "src/ utils/ a.ts :12" until the learner publishes the Wiki again, or gives the rebuilt description another id than the publisher's; why_new=Cycle 0046 finding 600 (observed natively in Chrome for Testing on C55, on a page that build published); seam=none, the served page is compared as text and the description is read in Chrome by the Wiki reader DOM check
test('an entry published with its shown target as the link’s description is served with that target hidden from assistive technology and the link described by the file and line as written, under the publisher’s id', () => {
  // Arrange: two entries as the builds of Cycle 0046 before finding 600 printed them, for package.json line 31 and for src/utils/a&b.ts line 12.
  const forTheManifest =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=package.json&amp;line=31&amp;sha256=0f" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" id="codebook-open-target">package.json<wbr>:31</span></p>'
  const withFolders =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa%26b.ts&amp;line=12&amp;sha256=0f" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" id="codebook-open-target">src/<wbr>utils/<wbr>a&amp;b.ts<wbr>:12</span></p>'

  // Act
  const served = [
    rebindDeepWikiEditorLinks(forTheManifest, 'cursor'),
    rebindDeepWikiEditorLinks(withFolders, 'vscode'),
  ]

  // Assert: the same entry the publisher prints today, named after the serving editor.
  assert.deepEqual(served, [
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=package.json&amp;line=31&amp;sha256=0f" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">package.json<wbr>:31</span><span class="sr-only" id="codebook-open-target">package.json:31</span></p>',
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa%26b.ts&amp;line=12&amp;sha256=0f" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a&amp;b.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a&amp;b.ts:12</span></p>',
  ])
})

// Value: protects=the entry of a page this build publishes when this reader serves it; fails_when=the reader takes the entry the publisher prints today for one of an earlier build and rebuilds or doubles its target, so the description or the shown target stands twice; why_new=Cycle 0046 finding 600 (the reader now rebuilds the entries of two earlier shapes); seam=none
test('an entry as this build publishes it is served with its shown target and its description once, named after the serving editor', () => {
  // Arrange: the entry for package.json line 31 as the publisher prints it today.
  const publishedToday =
    '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=package.json&amp;line=31&amp;sha256=0f" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">package.json<wbr>:31</span><span class="sr-only" id="codebook-open-target">package.json:31</span></p>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(publishedToday, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=package.json&amp;line=31&amp;sha256=0f" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">package.json<wbr>:31</span><span class="sr-only" id="codebook-open-target">package.json:31</span></p>',
  )
})

// Value: protects=the text of a page that shows a Codebook address, for example an escaped code example about source links, when Cursor serves the page; fails_when=the reader rewrites the editor scheme in the page's text or in a comment again, so the example shows another address than its author wrote, or stops rewriting it in the address of a link, so a link of a page served by Cursor opens VS Code; why_new=Cycle 0046 row 135 (the scheme was rewritten in the whole page, as in 0.2.29.0); seam=none
test('a page served by Cursor gets Cursor’s scheme in the address of every link, and a Codebook address shown in its text or in a comment stays as written', () => {
  // Arrange: an update link, a citation in single quotes and a settings link; then the same kind of address in an escaped code example, in plain text and inside a comment.
  const page =
    '<a class="wiki-update" href="vscode://laststance.codebook/update?root=%2Frepo">Update LLM Wiki</a>' +
    "<a href='vscode://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1'>a.ts:1</a>" +
    '<a title="a > b" href="vscode://laststance.codebook/settings?root=%2Frepo">Change location</a>' +
    '<pre><code>&lt;a href="vscode://laststance.codebook/source?root=%2Frepo"&gt;</code></pre>' +
    '<p>Write href="vscode://laststance.codebook/update?root=%2Frepo" into the link.</p>' +
    '<!-- <a href="vscode://laststance.codebook/settings?root=%2Frepo">old</a> -->'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<a class="wiki-update" href="cursor://laststance.codebook/update?root=%2Frepo">Update LLM Wiki</a>' +
      "<a href='cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1'>a.ts:1</a>" +
      '<a title="a > b" href="cursor://laststance.codebook/settings?root=%2Frepo">Change location</a>' +
      '<pre><code>&lt;a href="vscode://laststance.codebook/source?root=%2Frepo"&gt;</code></pre>' +
      '<p>Write href="vscode://laststance.codebook/update?root=%2Frepo" into the link.</p>' +
      '<!-- <a href="vscode://laststance.codebook/settings?root=%2Frepo">old</a> -->',
  )
})

// Value: protects=the links of a page that stand after an attribute whose bare value holds "<!--", which a browser reads as a character of the tag; fails_when=the reader takes that place for the start of a comment again and serves every link after it with the scheme the page was published with, so a link of a page served by Cursor opens VS Code; why_new=Cycle 0046 row 193 (the same reading of a start tag as the publisher's); seam=none
test('a link after a bare attribute value that holds <!-- gets the scheme of the editor that serves the page', () => {
  // Arrange: no comment end follows, so a reader that took the value for a comment would pass over the rest of the page.
  const page =
    '<p title=<!-- >A note</p><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<p title=<!-- >A note</p><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a>',
  )
})

// Value: protects=the reader and a browser reading the same thing as a link's address; fails_when=the reader takes a character for a separator inside a tag that a browser does not (a no-break space is white space for JavaScript and a letter of the tag's name for a browser), and rewrites an address in what a browser reads as no link; why_new=Cycle 0046 row 276: the publisher separates at the five characters a browser separates at since row 234, and the reader's two patterns for an href still used JavaScript's white space; seam=none, the served page is compared as text
test('an address after a no-break space inside a tag is not taken for a link’s: a browser reads no href there, and the page is served as published', () => {
  // Arrange: "a" + U+00A0 + "href" is one tag name for a browser; the second link is an ordinary one.
  const page =
    '<a\u00a0href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a>' +
    '<a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=b.ts&amp;line=2">b.ts:2</a>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<a\u00a0href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a>' +
      '<a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=b.ts&amp;line=2">b.ts:2</a>',
  )
})

// Value: protects=the links of a page that stand after a comment a browser ends in one of its less usual ways; fails_when=the reader knows "-->" alone as the end of a comment, so after a comment that ends with "--!>" or is "<!-->" or "<!--->" it passes over the links that follow and serves them with the scheme the page was published with; why_new=Cycle 0046 row 194 (the forms were run in a browser); seam=none
test('a link after a comment that ends with --!>, and after the comments <!--> and <!--->, gets the scheme of the editor that serves the page', () => {
  // Arrange: three comments, each followed by a source link; no "-->" stands anywhere in the page.
  const link = (line: number, scheme: string): string =>
    `<a href="${scheme}://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=${line}">a.ts:${line}</a>`
  const page = `<!-- one --!>${link(1, 'vscode')}<!-->${link(2, 'vscode')}<!--->${link(3, 'vscode')}`

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<!-- one --!><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a>' +
      '<!--><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=2">a.ts:2</a>' +
      '<!---><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=3">a.ts:3</a>',
  )
})

// Value: protects=the rail entry of a page whose link has an address without a query; fails_when=the reader reads the whole address as a query again, so an entry whose address is "path=a.ts&line=3" gets the invented target a.ts:3; why_new=Cycle 0046 row 135; seam=none
test('an entry whose address has no query gets no target', () => {
  // Arrange: an entry in the shape of 0.2.29.0 whose address is no Codebook address and has no question mark.
  const page =
    '<p class="open-in-editor"><a href="path=a.ts&amp;line=3">Open in VS Code</a></p>'

  // Act
  const served = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert: the editor is named, and nothing is added beside the link.
  assert.equal(
    served,
    '<p class="open-in-editor"><a href="path=a.ts&amp;line=3">Open in Cursor</a></p>',
  )
})

// Value: protects=the learner whose Wiki page, published before the publisher refused such addresses or written straight into the Wiki folder, links to a file or another extension in the editor; fails_when=the reader serves a `vscode://file/…` or `cursor://another.extension/…` address as a link again, so a click opens a file or runs another extension, often without a question once the learner allowed the editor's scheme for Codebook's links, or it takes the link from Codebook's own citation too; why_new=Cycle 0046 /ship repeat code review OC5: the reader rebound Codebook's addresses and served every other editor address as published; seam=none, the served page is compared as text
test('a served page keeps the text of a link to a file or another extension in the editor but not its link, and Codebook’s citation still opens in the serving editor', () => {
  // Arrange: a link to a file through VS Code, a link to another extension through Cursor, and a Codebook citation.
  const page =
    '<p><a href="vscode://file/etc/hosts">hosts</a> ' +
    '<a href="cursor://other.extension/run?task=1">run</a> ' +
    '<a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a></p>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert: the two foreign links keep their text and their address as a value no browser follows; the citation gets Cursor's scheme.
  assert.equal(
    servedByCursor,
    '<p><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a> ' +
      '<a data-codebook-unlinked="cursor://other.extension/run?task=1">run</a> ' +
      '<a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a.ts:1</a></p>',
  )
})

// Value: protects=the same learner against a page that writes such an address the way a browser still reads it, or in another attribute a browser follows; fails_when=the reader compares the attribute's name or the scheme with case, reads no character reference, tab or leading space as a browser does, or looks at href alone, so `HREF=VSCode://file/…`, `vs&#99;ode:`, `vscode&colon;` or an image's `src` and `srcset` still reach the editor; why_new=Cycle 0046 /ship repeat code review OC5 (the attributes of SC4); seam=none, the served page is compared as text
test('every attribute a browser follows and every way it reads an editor address loses the link, while web, mail and relative links stay', () => {
  // Arrange: the attributes of the publisher's address rule, then the forms a browser reads as vscode:, then links that stay.
  const page =
    '<img src="vscode://file/a.png" alt="a">' +
    '<img srcset="b.png 1x, cursor://other.extension/c.png 2x" alt="c">' +
    '<form action="vscode://file/f"><button formaction="cursor://other.extension/g">Go</button></form>' +
    '<svg><a xlink:href="vscode://file/h"><text>h</text></a></svg>' +
    '<a HREF=VSCode://file/i>i</a>' +
    '<a href=" vs&#99;ode://file/j">j</a>' +
    '<a href="vs\tcode://file/k">k</a>' +
    '<a href="&#x76;scode://file/l">l</a>' +
    '<a href="vscode&colon;//file/m">m</a>' +
    '<a href="https://example.com/n">n</a>' +
    '<a href="mailto:o@example.com">o</a>' +
    '<a href="pages/p&amp;q.html#r">p</a>'

  // Act
  const servedByVsCode = rebindDeepWikiEditorLinks(page, 'vscode')

  // Assert
  assert.equal(
    servedByVsCode,
    '<img data-codebook-unlinked="vscode://file/a.png" alt="a">' +
      '<img data-codebook-unlinked="b.png 1x, cursor://other.extension/c.png 2x" alt="c">' +
      '<form data-codebook-unlinked="vscode://file/f"><button data-codebook-unlinked="cursor://other.extension/g">Go</button></form>' +
      '<svg><a data-codebook-unlinked="vscode://file/h"><text>h</text></a></svg>' +
      '<a data-codebook-unlinked=VSCode://file/i>i</a>' +
      '<a data-codebook-unlinked=" vs&#99;ode://file/j">j</a>' +
      '<a data-codebook-unlinked="vs\tcode://file/k">k</a>' +
      '<a data-codebook-unlinked="&#x76;scode://file/l">l</a>' +
      '<a data-codebook-unlinked="vscode&colon;//file/m">m</a>' +
      '<a href="https://example.com/n">n</a>' +
      '<a href="mailto:o@example.com">o</a>' +
      '<a href="pages/p&amp;q.html#r">p</a>',
  )
})

// Value: protects=the learner in Cursor whose Wiki page writes a Codebook address in a form the publisher accepts and a browser reads as that address: a scheme with references, a leading space or control character, a tab in the scheme, or `href` right after a closing quote; fails_when=the reader rebinds only the address as written, so Cursor's reader serves a vscode:// link that opens VS Code; why_new=Cycle 0046 /ship third review W5 (Codex R3A7, CodeRabbit CR4, security); seam=none, the served page is compared as text
test('a Codebook address a browser reads through references, a leading space or control character or a tab in its scheme gets the serving editor’s scheme, written anew, and one right after a closing quote gets it in place', () => {
  // Arrange
  const page =
    '<a href="vs&#99;ode://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a</a>' +
    '<a href="&#118;scode://laststance.codebook/update?root=%2Frepo">b</a>' +
    '<a href=" vscode://laststance.codebook/settings?root=%2Frepo">c</a>' +
    '<a href="\u0001vscode://laststance.codebook/settings?root=%2Frepo">d</a>' +
    '<a href="vs\tcode://laststance.codebook/source?path=e.ts">e</a>' +
    '<a title="t"href="vscode://laststance.codebook/source?path=f.ts">f</a>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=a.ts&amp;line=1">a</a>' +
      '<a href="cursor://laststance.codebook/update?root=%2Frepo">b</a>' +
      '<a href="cursor://laststance.codebook/settings?root=%2Frepo">c</a>' +
      '<a href="cursor://laststance.codebook/settings?root=%2Frepo">d</a>' +
      '<a href="cursor://laststance.codebook/source?path=e.ts">e</a>' +
      '<a title="t"href="cursor://laststance.codebook/source?path=f.ts">f</a>',
  )
})

// Value: protects=the rail entry of a page of 0.2.29.0 whose link writes its address in a form a browser reads (an `HREF` in capitals, a bare value, a scheme with references); fails_when=the reader reads the entry's file and line by a pattern of a quoted lower-case `href`, so the entry gets no target, or reads them from another value than the one it rebinds; why_new=Cycle 0046 /ship third review W5 (`publishedQueryOf`); seam=none, the served page is compared as text
test('the entry of a page of 0.2.29.0 whose link writes HREF in capitals with a bare value gets its file and line beside it, read from the address a browser opens', () => {
  // Arrange
  const page =
    '<p class="open-in-editor"><a HREF=vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12>Open in VS Code</a></p>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<p class="open-in-editor"><a HREF=cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12 aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">src/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/a.ts:12</span></p>',
  )
})

// Value: protects=the learner in Cursor whose Wiki page links to Codebook with an address the publisher accepts in another case or form than it prints itself; fails_when=the reader rebinds only the lower-case, quoted form of the three routes, so `VSCode://LastStance.Codebook/…`, a bare value, an `HREF` or spaces around its `=` keep the scheme of VS Code, and a click in Cursor opens VS Code; why_new=Cycle 0046 /ship finding AF5 (the publisher compares Codebook's scheme and authority without case since TC7); seam=none, the served page is compared as text
test('a Codebook address written in another case, with a bare value, an HREF in capitals or spaces around its =, gets the scheme of the editor that serves the page, its authority and route as written', () => {
  // Arrange
  const page =
    '<a href="VSCode://LastStance.Codebook/source?path=a.ts">a</a>' +
    "<a href='CURSOR://laststance.codebook/update?root=%2Frepo'>b</a>" +
    '<a href=Vscode://laststance.codebook/settings?root=%2Frepo>c</a>' +
    '<a HREF = "vscode://LASTSTANCE.CODEBOOK/source?path=d.ts">d</a>' +
    '<a href="vscode://laststance.codebook/Source?path=e.ts">e</a>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<a href="cursor://LastStance.Codebook/source?path=a.ts">a</a>' +
      "<a href='cursor://laststance.codebook/update?root=%2Frepo'>b</a>" +
      '<a href=cursor://laststance.codebook/settings?root=%2Frepo>c</a>' +
      '<a HREF = "cursor://LASTSTANCE.CODEBOOK/source?path=d.ts">d</a>' +
      '<a href="cursor://laststance.codebook/Source?path=e.ts">e</a>',
  )
})

// Value: protects=the learner whose Wiki page, published before the publisher's address rule or written straight into the Wiki folder, links to an address of another scheme; fails_when=the reader takes the link only from vscode: and cursor: addresses that are not Codebook's, so `vscode-insiders:`, another editor's scheme, `javascript:`, `data:`, `file:`, a network path or a scheme hidden by a reference still opens something from the reader's page; why_new=Cycle 0046 /ship finding AF6 (the reader keeps only what the publisher accepts today); seam=none, the served page is compared as text
test('a served page keeps the text of every address the publisher refuses today but not its link, and keeps web, mail, relative and Codebook addresses as links', () => {
  // Arrange: one link of each refused kind, then the kinds the publisher accepts.
  const page =
    '<a href="vscode-insiders://file/etc/hosts">a</a>' +
    '<a href="windsurf://codeium.windsurf/run">b</a>' +
    '<a href="javascript:run()">c</a>' +
    '<img src="data:image/png;base64,AAAA" alt="d">' +
    '<a href="file:///etc/hosts">e</a>' +
    '<img src="//attacker.example/f.png" alt="f">' +
    '<img src="\\\\attacker.example\\share\\g.png" alt="g">' +
    '<a href="tel:+100">h</a>' +
    '<a href="java\tscript:run()">i</a>' +
    '<a href="javascript&colon;run()">j</a>' +
    '<a href="javascript&#58run()">k</a>' +
    '<a href="https://example.com/l">l</a>' +
    '<a href="mailto:m@example.com">m</a>' +
    '<a href="../n.html#o">n</a>' +
    '<a href="#p">p</a>' +
    '<a href="VSCode://LastStance.Codebook/source?path=q.ts">q</a>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<a data-codebook-unlinked="vscode-insiders://file/etc/hosts">a</a>' +
      '<a data-codebook-unlinked="windsurf://codeium.windsurf/run">b</a>' +
      '<a data-codebook-unlinked="javascript:run()">c</a>' +
      '<img data-codebook-unlinked="data:image/png;base64,AAAA" alt="d">' +
      '<a data-codebook-unlinked="file:///etc/hosts">e</a>' +
      '<img data-codebook-unlinked="//attacker.example/f.png" alt="f">' +
      '<img data-codebook-unlinked="\\\\attacker.example\\share\\g.png" alt="g">' +
      '<a data-codebook-unlinked="tel:+100">h</a>' +
      '<a data-codebook-unlinked="java\tscript:run()">i</a>' +
      '<a data-codebook-unlinked="javascript&colon;run()">j</a>' +
      '<a data-codebook-unlinked="javascript&#58run()">k</a>' +
      '<a href="https://example.com/l">l</a>' +
      '<a href="mailto:m@example.com">m</a>' +
      '<a href="../n.html#o">n</a>' +
      '<a href="#p">p</a>' +
      '<a href="cursor://LastStance.Codebook/source?path=q.ts">q</a>',
  )
})

// Value: protects=the learner whose Wiki page carries a refresh, written straight into the Wiki folder, that moves the reader's page to another address without a click, an editor address among them, which the page's policy does not stop; fails_when=the reader serves `<meta http-equiv="refresh">` as the file holds it, or takes the effect from another `http-equiv` (the page's own Content-Security-Policy); why_new=Cycle 0046 /ship finding AF6; seam=none, the served page is compared as text
test('a refresh in a served page loses its effect in any case of its name and value, and the page’s own Content-Security-Policy stays', () => {
  // Arrange
  const page =
    '<head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head>' +
    '<body><meta http-equiv="refresh" content="0;url=vscode://file/etc/hosts">' +
    '<META HTTP-EQUIV=Refresh CONTENT="5;url=pages/a.html"></body>'

  // Act
  const served = rebindDeepWikiEditorLinks(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head>' +
      '<body><meta data-codebook-unlinked="refresh" content="0;url=vscode://file/etc/hosts">' +
      '<META data-codebook-unlinked=Refresh CONTENT="5;url=pages/a.html"></body>',
  )
})

// Value: protects=a page that reads alike published today and served by the reader; fails_when=the reader's rule of an accepted address and the publisher's (`isAcceptedAddress` of render-wiki-diagrams.mjs) part, so the reader takes the link from an address the publisher prints or leaves one the publisher refuses; why_new=Cycle 0046 /ship finding AF6 (the reader keeps an address only if the publisher would accept it today); seam=none (the shipped publisher's check and the compiled reader)
test('the reader keeps exactly the addresses the shipped publisher accepts in a page’s content', async () => {
  // Arrange: the publisher's check of a page's content, and addresses on both sides of its rule.
  const { scriptingClauseOf } = (await import(
    pathToFileURL(
      join(
        __dirname,
        '..',
        '..',
        'skills',
        'codebook',
        'render-wiki-diagrams.mjs',
      ),
    ).href
  )) as { scriptingClauseOf: (html: string) => string | undefined }
  const addresses = [
    'pages/a.html',
    '#start',
    '../up.html?x=1',
    'a&amp;b.html',
    'https://example.com/',
    'HTTP://example.com/',
    'mailto:m@example.com',
    ' https://example.com/',
    'vscode://laststance.codebook/source?path=a.ts',
    'CURSOR://LASTSTANCE.CODEBOOK/update',
    'vscode://laststance.codebook.evil/x',
    'vscode://file/etc/hosts',
    'vscode-insiders://file/etc/hosts',
    'javascript:run()',
    'java&#x09;script:run()',
    'javascript&colon;run()',
    'javascript&#58run()',
    'data:text/html,x',
    'file:///etc/hosts',
    '//host/x',
    '\\\\host\\x',
    '/\\host/x',
    'tel:+1',
  ]

  // Act: for each address, whether the publisher accepts it in an href and whether the reader keeps it as one.
  const verdicts = addresses.map((address) => ({
    address,
    publisherAccepts:
      scriptingClauseOf(`<p><a href="${address}">x</a></p>`) === undefined,
    readerKeeps: rebindDeepWikiEditorLinks(
      `<a href="${address}">x</a>`,
      'vscode',
    ).startsWith('<a href='),
  }))

  // Assert: the two agree on every address, and the table holds both kinds.
  assert.deepEqual(
    verdicts.filter(
      ({ publisherAccepts, readerKeeps }) => publisherAccepts !== readerKeeps,
    ),
    [],
  )
  assert.deepEqual(
    verdicts.map(({ publisherAccepts }) => publisherAccepts),
    [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  )
})

// Value: protects=an escaped code example or a sentence of a page that shows an editor address; fails_when=the reader changes an address it reads in the page's text, where a browser follows nothing, so the example shows another text than its author wrote; why_new=Cycle 0046 /ship repeat code review OC5 (the rule of row 135 that the page's text is served as published); seam=none, the served page is compared as text
test('an editor address shown in the text of a page is served as written', () => {
  // Arrange
  const page =
    '<pre><code>&lt;a href="vscode://file/etc/hosts"&gt;</code></pre>' +
    '<p>Write href="cursor://other.extension/run" into the link.</p>'

  // Act
  const servedByCursor = rebindDeepWikiEditorLinks(page, 'cursor')

  // Assert
  assert.equal(
    servedByCursor,
    '<pre><code>&lt;a href="vscode://file/etc/hosts"&gt;</code></pre>' +
      '<p>Write href="cursor://other.extension/run" into the link.</p>',
  )
})

test('the open control is printed only where the publisher puts a page’s first citation, never as a fixed link of the shell', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  assert.ok(
    shell.includes(
      '<ul class="outline">{{OUTLINE}}</ul></nav>{{OPEN_SOURCE}}<div class="output">',
    ),
  )
  assert.doesNotMatch(shell, /<p class="open-in-editor">/)
  // The label is the link itself: a rule for a label element would style nothing.
  assert.doesNotMatch(shell, /\.open-label/)
  // The entry is the bordered block; its link keeps the label on one line and covers the whole block, so a press on the file and line under the label opens the file too; the file and line are muted and smaller, and wrap.
  for (const rule of [
    '.open-in-editor{position:relative;margin:0 0 1rem;border:1px solid var(--border);border-radius:6px;padding:.5rem .7rem;font-size:.8rem;overflow-wrap:anywhere}',
    '.open-in-editor a{display:block;white-space:nowrap;text-decoration:none}.open-in-editor a::after{content:"";position:absolute;inset:-1px;border-radius:6px}',
    '.open-target{display:block;margin-top:.15rem;font-size:.75rem;line-height:1.45;color:var(--muted);overflow-wrap:anywhere}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
})

// Value: protects=the Wiki reader between 701 and 1000 px, where the right rail is a row of the update group, the outline, the open control and the output; fails_when=the open control has no rule in that layout, so it shrinks with the row and its label breaks inside a word, or its target widens it and takes the room of the update panel, or it keeps the bottom margin of the column layout; why_new=Cycle 0045 local review other-1 #6, Cycle 0046 row 28 (design review DR-8; the measured cases are in the Wiki reader DOM check); seam=none
test('where the right rail is a row the open control keeps the width of its label and no column margin, and below 700 px it has its margin and the whole width back', async () => {
  // Arrange / Act
  const shell = await readShell()
  const railRowRules =
    /@media\(max-width:1000px\)\{(.*)\}\n@media\(max-width:700px\)/.exec(
      shell,
    )?.[1]
  const columnRules = /@media\(max-width:700px\)\{(.*)\}\n/.exec(shell)?.[1]

  // Assert
  assert.ok(
    railRowRules?.includes(
      '.right-rail .open-in-editor{flex:none;margin:0;align-self:flex-start}.right-rail .open-target{width:0;min-width:100%;',
    ),
    'the open control has no rule in the row layout, or its target adds to its width',
  )
  assert.ok(
    columnRules?.includes(
      '.right-rail .open-in-editor{margin:0 0 1rem}.right-rail .open-target{width:auto;min-width:0;',
    ),
    'the open control keeps the row layout’s margin or its target the row layout’s width in the column layout',
  )
})

// Value: protects=the Wiki reader's right rail in a window between 701 and 1000 px wide, where the rail is a row below the article; fails_when=the rail is capped again, so the sentence of a failed or refused update is cut off behind a scrollbar with its advice unread, or the outline and an open update detail lose their caps and take the article's room, or the caps reach the single column; why_new=Cycle 0045 native check W-3 on the owned clone, Cycle 0046 row 28 (design review DR-10; the measured cases are in the Wiki reader DOM check); seam=none
test('where the right rail is a row below the article the outline and an open update detail are capped and scroll inside themselves, the rail and the update panel are not, and the single column has no cap at all', async () => {
  // Arrange / Act
  const shell = await readShell()
  const rowRules =
    /@media\(max-width:1000px\)\{(.*)\}\n@media\(max-width:700px\)/.exec(
      shell,
    )?.[1]
  const columnRules = /@media\(max-width:700px\)\{(.*)\}\n/.exec(shell)?.[1]

  // Assert
  for (const rule of [
    '.right-rail{grid-column:1/-1;max-height:none;overflow:visible;display:flex;gap:1rem}',
    '.right-rail nav{flex:1 1 10rem;min-width:10rem;max-height:10rem;overflow:auto;overflow-wrap:anywhere}',
    // 96 px, and 14vh in a window lower than 686 px, so the rail with an open detail stays within 45vh at 960 x 600.
    '[data-codebook-update-detail][open]{max-height:min(6rem,14vh);overflow:auto}',
    '[data-codebook-update-group]{flex:0 1 28rem;min-width:0;align-self:flex-start}',
  ])
    assert.ok(rowRules?.includes(rule), `the row layout lacks the rule ${rule}`)
  assert.deepEqual(
    rowRules?.match(/\.right-rail\{[^}]*max-height:(?!none)[^;}]*/g) ?? null,
    null,
    'the rail itself is capped again',
  )
  for (const rule of [
    '.right-rail{display:block;margin-top:1rem;max-height:none;overflow:auto}',
    '.right-rail nav{min-width:0;max-height:none;overflow:visible}',
    '[data-codebook-update-detail][open]{max-height:none;overflow:visible}',
  ])
    assert.ok(
      columnRules?.includes(rule),
      `the single column lacks the rule ${rule}`,
    )
})

// Value: protects=keyboard focus in the chapter list and the right rail of the Wiki reader, which scroll and cut whatever lies outside them; fails_when=the focus ring of a full-width chapter or outline link lies outside its link again, so its sides are cut, or the rail loses the room at its left for the ring of the Change location link, or the room above and below a control the Tab key scrolls back to the rail's edge; why_new=Cycle 0046 row 61 (design review ND-3; the measured cases and the stills are in the Wiki reader DOM check); seam=none
test('the published page draws the focus ring of a chapter link and of an outline link inside the link, and keeps room in the rail for the ring of its last link', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert: the ring of every other control stays 3 px outside it.
  for (const rule of [
    'a:focus-visible,button:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid var(--link);outline-offset:3px}',
    '.chapters a:focus-visible,.right-rail nav a:focus-visible{outline-offset:-2px}',
    '.chapters,.right-rail{min-height:0;overflow:auto;font-size:.875rem}.right-rail{padding-left:5px;margin-left:-5px;scroll-padding-block:6px}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
})

// Value: protects=the learner who moves through the "On this page" outline with the keyboard; fails_when=an outline link has no room at its sides again, so its focus ring, drawn inside the link in the link colour, covers the first letter of its title and the last letter of a long one, or the room moves the titles, or the outline where it scrolls by itself (701 to 1000 px) has no room for the ring at its left or narrows its titles; why_new=Cycle 0046 /ship finding F5 (design review at 1440 x 900 and 960 x 800; the measured case is in the Wiki reader DOM check); seam=none
test('the published page gives an outline link 5 px of room at each side for its focus ring and takes the room at the left back, and the outline that scrolls where the rail is a row keeps 5 px of room at its left and its width', async () => {
  // Arrange / Act
  const shell = await readShell()
  const rowRules =
    /@media\(max-width:1000px\)\{(.*)\}\n@media\(max-width:700px\)/.exec(
      shell,
    )?.[1]

  // Assert
  assert.ok(
    shell.includes(
      '.outline a{display:block;padding:.3rem 0;text-decoration:none;overflow-wrap:anywhere}.outline a{padding-inline:5px;margin-left:-5px}',
    ),
    'the outline link lacks its room for the focus ring',
  )
  assert.ok(
    rowRules?.includes(
      '.right-rail nav{flex-basis:calc(10rem + 5px);min-width:calc(10rem + 5px);padding-left:5px;margin-left:-5px}',
    ),
    'the outline that scrolls lacks its room for the focus ring',
  )
})

// Value: protects=the chapter list and the outline of the Wiki reader where they are columns that scroll; fails_when=a chapter title or an outline entry that cannot break (an identifier) is wider than its column again, so the column gets a sideways scrollbar; why_new=Cycle 0046 package SPB, found while measuring row 28 at 1200 px (the measured case is in the Wiki reader DOM check); seam=none
test('a chapter title and an outline entry that cannot break wrap inside their column', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert
  for (const rule of [
    '.chapters a{display:block;text-decoration:none;padding:.35rem .5rem;border-radius:4px;color:var(--muted);overflow-wrap:anywhere}',
    '.outline a{display:block;padding:.3rem 0;text-decoration:none;overflow-wrap:anywhere}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
})

// Value: protects=keyboard focus in the article and the composer of the Wiki reader, which scroll and cut whatever lies outside them; fails_when=the article or the composer loses its 5 px of room at the sides where a control reaches its edge (the question field, Ask Codebook, the summaries, a link at the start of a line), so the ring's side is cut again, or the room is no longer taken back by the margins, the height limit and the shortened top border, so the reading column moves; why_new=Cycle 0046 row 67 (the measured cases and the stills are in the Wiki reader DOM check); seam=none
test('the published page keeps room for the focus ring at the sides of the article and around the composer, where they scroll, and takes the room back so that nothing moves', async () => {
  // Arrange / Act
  const shell = await readShell()
  const columnRules = /@media\(max-width:700px\)\{(.*)\}\n/.exec(shell)?.[1]

  // Assert: 5 px of padding against 5 px of negative margin; the composer's height limit grows by its room below, its top border is drawn without the 5 px at each end, and a control the Tab key scrolls back to an edge keeps 6 px there.
  for (const rule of [
    '.wiki-article{flex:1;min-height:0;overflow:auto;padding:0 1rem 2rem 5px;margin-left:-5px;scroll-padding:1rem 0 6px}',
    '.composer{flex:none;max-height:calc(34% + 5px);min-height:0;border-top:1px solid var(--border);border-image:linear-gradient(to right,transparent 5px,var(--border) 5px calc(100% - 5px),transparent calc(100% - 5px)) 1 0 0;padding:.6rem 5px 5px;margin:0 -5px -5px;overflow:auto;scroll-padding-block:6px}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
  // In the single column the composer has its own bottom padding, which is room enough, and no height limit.
  assert.ok(
    columnRules?.includes(
      '.composer{max-height:none;position:static;background:var(--bg);padding-bottom:.6rem;margin-bottom:0}',
    ),
    'the single column lacks the rule of the composer',
  )
})

// Value: protects=keyboard focus on the answer of a question in the Wiki reader's composer, which is a focusable region and none of the elements the shell's ring rule names; fails_when=the answer loses its own ring rule, so the browser draws its default ring around it, in another colour and width than every other ring of the page; why_new=Cycle 0046 row 83 (the measured case and the still are in the Wiki reader DOM check); seam=none
test('the published page gives the answer of a question the reader’s own focus ring, 2 px in the link colour and 3 px outside it', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert: the same ring as the rule of links, buttons, summaries and the question field draws.
  for (const rule of [
    'a:focus-visible,button:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid var(--link);outline-offset:3px}',
    '.qa-answer:focus-visible{outline:2px solid var(--link);outline-offset:3px}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
  assert.ok(
    shell.includes(
      '<div class="qa-answer" role="status" aria-live="polite" tabindex="0"></div>',
    ),
    'the answer is no longer a region the keyboard reaches',
  )
})

// Value: protects=the Output block of the Wiki reader's rail where the rail is a row (701 to 1000 px); fails_when=the block shrinks with the row again, so "Project folder" and "Change location" break into two lines each in a block of 58 px at 720 px, or the update panel can no longer give way to it, or the block keeps its minimum width in the single column; why_new=Cycle 0046 row 28 (design review DR-10, second measurement; the measured cases at 720 and 701 px are in the Wiki reader DOM check); seam=none
test('where the right rail is a row the output block keeps its longest line whole and the update panel gives way, and below 700 px the block may shrink again', async () => {
  // Arrange / Act
  const shell = await readShell()
  const rowRules =
    /@media\(max-width:1000px\)\{(.*)\}\n@media\(max-width:700px\)/.exec(
      shell,
    )?.[1]
  const columnRules = /@media\(max-width:700px\)\{(.*)\}\n/.exec(shell)?.[1]

  // Assert
  for (const rule of [
    '.right-rail .output{max-width:14rem;min-width:max-content}',
    '[data-codebook-update-group]{flex:0 1 28rem;min-width:0;align-self:flex-start}',
  ])
    assert.ok(rowRules?.includes(rule), `the row layout lacks the rule ${rule}`)
  assert.ok(
    columnRules?.includes('.right-rail .output{min-width:0}'),
    'the single column lacks the rule .right-rail .output{min-width:0}',
  )
})

// Value: protects=keyboard focus on the summary of an open update detail ("Show all 12 files") where the rail is a row and the detail scrolls inside its own bound; fails_when=the summary's ring lies outside the summary there again, so the detail cuts its left, upper and right side, or the inside ring reaches the single column, where nothing cuts a ring outside; why_new=Cycle 0046 package SPB, found while measuring row 67 (the detail scrolls since design review DR-10; the measured case and the still are in the Wiki reader DOM check); seam=none
test('where the right rail is a row the summary of an open update detail has its focus ring inside the detail that scrolls, and below 700 px outside again', async () => {
  // Arrange / Act
  const shell = await readShell()
  const rowRules =
    /@media\(max-width:1000px\)\{(.*)\}\n@media\(max-width:700px\)/.exec(
      shell,
    )?.[1]
  const columnRules = /@media\(max-width:700px\)\{(.*)\}\n/.exec(shell)?.[1]

  // Assert
  assert.ok(
    rowRules?.includes(
      '[data-codebook-update-detail][open]{max-height:min(6rem,14vh);overflow:auto}[data-codebook-update-detail][open]>summary:focus-visible{outline-offset:-2px}',
    ),
    'the row layout lacks the rule [data-codebook-update-detail][open]>summary:focus-visible{outline-offset:-2px}',
  )
  assert.ok(
    columnRules?.includes(
      '[data-codebook-update-detail][open]{max-height:none;overflow:visible}[data-codebook-update-detail][open]>summary:focus-visible{outline-offset:3px}',
    ),
    'the single column lacks the rule [data-codebook-update-detail][open]>summary:focus-visible{outline-offset:3px}',
  )
})

// Value: protects=the height of the rail's entry where the rail is a row (701 to 1000 px) and a page's first source has a long path; fails_when=the target loses its bound of eight lines there, so a path of about 200 characters makes the entry 300 px high and the rail with it, or the whole path no longer shows under the pointer and with the keyboard focus, or the bound reaches the single column, where the entry has the page's width; why_new=Cycle 0046 row 137 (the measured case is in the Wiki reader DOM check); seam=none
test('where the right rail is a row the entry’s target shows eight lines at most and the whole path under the pointer or with the keyboard focus, and below 700 px it is unbounded again', async () => {
  // Arrange / Act
  const shell = await readShell()
  const rowRules =
    /@media\(max-width:1000px\)\{(.*)\}\n@media\(max-width:700px\)/.exec(
      shell,
    )?.[1]
  const columnRules = /@media\(max-width:700px\)\{(.*)\}\n/.exec(shell)?.[1]

  // Assert
  assert.ok(
    rowRules?.includes(
      '.right-rail .open-target{width:0;min-width:100%;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:8;overflow:hidden}.right-rail .open-in-editor:hover .open-target,.right-rail .open-in-editor:focus-within .open-target{-webkit-line-clamp:none}',
    ),
    'the row layout lacks the bound of the entry’s target or the rule that shows the whole path',
  )
  assert.ok(
    columnRules?.includes(
      '.right-rail .open-target{width:auto;min-width:0;display:block;-webkit-line-clamp:none;overflow:visible}',
    ),
    'the single column lacks the rule that takes the bound of the entry’s target back',
  )
})
