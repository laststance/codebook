import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { startDeepWikiReader } from '../deepWikiReader'

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
    /@media\(max-width:1000px\)\{[^\n]*\[data-codebook-update-group\]\{flex:0 1 18rem;min-width:0;align-self:flex-start\}/,
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
  ])
    assert.ok(shell.includes(rule), `the shell lacks the rule ${rule}`)
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

    // Assert: the control sits between the outline and the output box and carries the address of the page's first citation.
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
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation}">Open in VS Code</a></p><div class="output">`,
      ),
    )
    assert.ok(
      servedByCode.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation}">Open in VS Code</a></p><div class="output">`,
      ),
    )
    assert.ok(
      servedByCursor.includes(
        `</ul></nav><p class="open-in-editor"><a href="${firstCitation.replace('vscode://', 'cursor://')}">Open in Cursor</a></p><div class="output">`,
      ),
    )
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()])
    await wiki.cleanup()
  }
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
})

// Value: protects=the Wiki reader between 701 and 1000 px, where the right rail is a row of the update group, the outline, the open control and the output; fails_when=the open control has no rule in that layout, so it shrinks with the row and its label breaks inside a word, and it keeps the bottom margin of the column layout; why_new=Cycle 0045 local review other-1 #6 (the measured case is in the Reader DOM check); seam=none
test('where the right rail is a row the open control keeps its own width and no column margin, and below 700 px it has its margin back', async () => {
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
      '.right-rail{grid-column:1/-1;max-height:10rem;display:flex;gap:1rem}.right-rail nav{flex:1}.right-rail .open-in-editor{flex:none;margin:0;align-self:flex-start}',
    ),
    'the open control has no rule in the row layout',
  )
  assert.ok(
    columnRules?.includes(
      '.right-rail{display:block;margin-top:1rem}.right-rail .open-in-editor{margin:0 0 1rem}',
    ),
    'the open control keeps the row layout’s margin in the column layout',
  )
})
