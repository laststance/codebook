import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

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
