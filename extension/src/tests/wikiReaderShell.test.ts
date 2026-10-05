import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

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
    // The entry that opens the page's source is unfilled, so the pointer gives it a fill and a link-coloured border, a press darkens it, and its focus ring lies inside it.
    '.open-in-editor a:hover{background:var(--panel-2);border-color:var(--link)}',
    '.open-in-editor a:active{background:var(--panel-2);border-color:var(--link);filter:brightness(.9)}',
    '.open-in-editor a:focus-visible{outline:2px solid var(--link);outline-offset:-2px}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
  // The entry changes at once, so reduced motion needs no rule of its own.
  assert.doesNotMatch(
    shell,
    /\.open-(?:in-editor|label|target)[^{}]*\{[^}]*(?:animation|transition)/,
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

    // Assert: the control sits between the outline and the output box, carries the address of the page's first citation and names the editor and, under it, the file and line it opens.
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
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation}"><span class="open-label">Open in VS Code</span> <span class="open-target">source.ts:1</span></a></p><div class="output">`,
      ),
    )
    assert.ok(
      servedByCode.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation}"><span class="open-label">Open in VS Code</span> <span class="open-target">source.ts:1</span></a></p><div class="output">`,
      ),
    )
    assert.ok(
      servedByCursor.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation.replace('vscode://', 'cursor://')}"><span class="open-label">Open in Cursor</span> <span class="open-target">source.ts:1</span></a></p><div class="output">`,
      ),
    )
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()])
    await wiki.cleanup()
  }
})

// Value: protects=the rail entry of a Wiki published by 0.2.29.0, whose pages carry the one-line entry "Open in VS Code"; fails_when=the reader serves such a page without the file and line the entry opens, so the learner must publish the Wiki again to see where the entry leads, or names the wrong editor in it; why_new=Cycle 0046 row 28 (design review DR-8, finding F16); seam=none
test('a page published by 0.2.29.0 is served by both editors with the entry named after that editor and the file and line read from its address', async () => {
  // Arrange: a published Wiki whose overview is put back into the shape 0.2.29.0 printed: one link whose whole text is "Open in VS Code".
  const wiki = await publishedWikiFixture()
  const indexPath = join(wiki.outputDirectory, 'index.html')
  const publishedToday = await readFile(indexPath, 'utf8')
  const publishedBy02290 = publishedToday.replace(
    '<span class="open-label">Open in VS Code</span> <span class="open-target">source.ts:1</span>',
    'Open in VS Code',
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
        `<p class="open-in-editor"><a href="${address}"><span class="open-label">Open in VS Code</span> <span class="open-target">source.ts:1</span></a></p>`,
      ),
    )
    assert.ok(
      servedByCursor.includes(
        `<p class="open-in-editor"><a href="${address.replace('vscode://', 'cursor://')}"><span class="open-label">Open in Cursor</span> <span class="open-target">source.ts:1</span></a></p>`,
      ),
    )
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()])
    await wiki.cleanup()
  }
})

// Value: protects=the target line the reader adds to a one-line rail entry; fails_when=a path with folders is printed without its break points or with a character of the address unescaped, or an address that names no line gets an invented target; why_new=Cycle 0046 row 28 (design review DR-8); seam=none
test('the target added to a one-line entry breaks after each slash and is escaped, and an address without a line keeps the one line', () => {
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
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa%26b.ts&amp;line=12&amp;sha256=0f"><span class="open-label">Open in Cursor</span> <span class="open-target">src/<wbr>utils/<wbr>a&amp;b.ts:12</span></a></p>',
    '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Futils%2Fa.ts">Open in Cursor</a></p>',
  ])
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
  assert.ok(
    shell.includes(
      '.open-in-editor{margin:0 0 1rem}.open-in-editor a{display:block;border:1px solid var(--border);border-radius:6px;padding:.5rem .7rem;text-decoration:none;font-size:.8rem;overflow-wrap:anywhere}',
    ),
  )
  // The label keeps one line; the file and line it opens stand under it, muted and smaller, and wrap.
  for (const rule of [
    '.open-label{display:block;white-space:nowrap}',
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
      '.right-rail .open-in-editor{flex:none;margin:0;align-self:flex-start}.right-rail .open-target{width:0;min-width:100%}',
    ),
    'the open control has no rule in the row layout, or its target adds to its width',
  )
  assert.ok(
    columnRules?.includes(
      '.right-rail .open-in-editor{margin:0 0 1rem}.right-rail .open-target{width:auto;min-width:0}',
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
    '[data-codebook-update-detail][open]{max-height:6rem;overflow:auto}',
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

// Value: protects=keyboard focus in the chapter list and the right rail of the Wiki reader, which scroll and cut whatever lies outside them; fails_when=the focus ring of a full-width chapter or outline link lies outside its link again, so its sides are cut, or the rail loses the room at its left for the ring of the Change location link; why_new=Cycle 0046 row 61 (design review ND-3; the measured case and the stills are in the Wiki reader DOM check); seam=none
test('the published page draws the focus ring of a chapter link and of an outline link inside the link, and keeps room in the rail for the ring of its last link', async () => {
  // Arrange / Act
  const shell = await readShell()

  // Assert: the ring of every other control stays 3 px outside it.
  for (const rule of [
    'a:focus-visible,button:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid var(--link);outline-offset:3px}',
    '.chapters a:focus-visible,.right-rail nav a:focus-visible{outline-offset:-2px}',
    '.chapters,.right-rail{min-height:0;overflow:auto;font-size:.875rem}.right-rail{padding-left:5px;margin-left:-5px}',
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
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
