import assert from 'node:assert/strict'
import { test } from 'node:test'

import { VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT } from '../constants'
import { extractModuleScriptSources } from '../utils/extractModuleScriptSources'

const ENTRY = 'http://127.0.0.1:4321/'

// protects=Cycle 0078 entries: the walk starts from every module script of Vite's served index.html, whatever the attribute order or quoting, Vite's injected client included; fails_when=a script written with src before type, single quotes or no quotes is missed, or the injected /@vite/client is dropped; no_claim=a real Vite page (the HTML is a hand-written stand-in)
test('lists the src of every module script in document order whatever the attribute order and quoting', () => {
  // Arrange
  const html = `<!doctype html><html><head>
    <script type="module" src="/@vite/client"></script>
    <script src='/src/other.tsx' type='module'></script>
    <SCRIPT TYPE=module SRC=/src/main.tsx async></SCRIPT>
  </head></html>`
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.deepEqual(sources, [
    '/@vite/client',
    '/src/other.tsx',
    '/src/main.tsx',
  ])
})

// protects=Cycle 0078 entries: only same-origin module scripts with a src seed the walk; fails_when=an inline module script, a classic script, a commented-out script or a script on another origin becomes an entry; no_claim=none beyond protects
test('skips an inline module script, a classic script, a commented-out script and a script of another origin', () => {
  // Arrange
  const html = `
    <script type="module">import '/src/inline.ts'</script>
    <script src="/src/classic.js"></script>
    <!-- <script type="module" src="/src/commented.tsx"></script> -->
    <script type="module" src="https://cdn.example.com/lib.js"></script>
    <script type="module" src="/src/kept.tsx?v=2"></script>`
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.deepEqual(sources, ['/src/kept.tsx?v=2'])
})

// protects=Cycle 0078 entries: a relative src resolves against the entry page's address and a repeat is listed once; fails_when=a relative path stays unresolved or the same module is listed twice; no_claim=none beyond protects
test('resolves a relative src against the entry address and lists a repeated module once', () => {
  // Arrange
  const html = `<script type="module" src="main.tsx"></script><script type="module" src="/app/main.tsx"></script>`
  // Act
  const sources = extractModuleScriptSources(html, `${ENTRY}app/`)
  // Assert
  assert.deepEqual(sources, ['/app/main.tsx'])
})

// protects=Cycle 0078 entries: a page with a huge number of scripts cannot make the walk request unbounded, and a page one over the walk limit stays distinguishable from one at it; fails_when=more than the walk limit plus one are returned; no_claim=none beyond protects
test('stops listing one module script past the walk entry limit', () => {
  // Arrange
  const html = Array.from(
    { length: VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT + 20 },
    (_, index) => `<script type="module" src="/m${index}.js"></script>`,
  ).join('')
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.equal(sources.length, 65)
  assert.equal(sources[0], '/m0.js')
})

// protects=Vite 8.3.5 dev HTML: the html-proxy src Vite writes for a page's inline module script stays an entry with its query; fails_when=the query is cut or the entry dropped; no_claim=a real Vite page (hand-written stand-in of what addInlineModule produces)
test('keeps the html-proxy src Vite writes for an inline module script, with its query', () => {
  // Arrange
  const html = `<script type="module" src="/index.html?html-proxy&index=0.js"></script>`
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.deepEqual(sources, ['/index.html?html-proxy&index=0.js'])
})

// protects=tag scan: a '>' inside a quoted attribute value does not end the tag early; fails_when=the module script after such an attribute is missed; no_claim=full HTML parsing
test('reads a module script whose quoted attribute holds a greater-than sign', () => {
  // Arrange
  const html = `<script data-note="a>b" type="module" src="/src/main.tsx"></script>`
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.deepEqual(sources, ['/src/main.tsx'])
})

// protects=entry page scan: malformed pages full of unterminated script openers or comment openers are read in linear time and yield no entry; fails_when=the scan rescans the rest of the page per opener (quadratic: 256 KiB took about 7 s) or invents an entry; no_claim=the exact milliseconds (the bound is generous); a browser's own error recovery
test('reads unterminated script and comment openers in 256 KiB and 1 MiB pages without stalling', () => {
  // Arrange
  const pages = [
    '<script '.repeat(32_768),
    '<!-- <script '.repeat(20_000),
    '<script a="'.repeat(26_000),
    '<script '.repeat(131_072),
  ]
  for (const page of pages) {
    // Act
    const started = performance.now()
    const sources = extractModuleScriptSources(page, ENTRY)
    const elapsedMs = performance.now() - started
    // Assert
    assert.deepEqual(sources, [])
    assert.ok(elapsedMs < 500, `took ${elapsedMs} ms for ${page.length} bytes`)
  }
})

// protects=entry page scan: a large page with many complete tags and comments returns its module scripts in order; fails_when=the linear scan drops, reorders or double-counts tags between comments; no_claim=pages beyond the entry page byte cap
test('lists the module scripts of a large page full of complete tags and comments in order', () => {
  // Arrange
  const html = Array.from(
    { length: 40 },
    (_, index) =>
      `<!-- <script type="module" src="/hidden${index}.js"></script> --><p>filler</p><script type="module" src="/m${index}.js"></script>`,
  ).join('\n')
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.equal(sources.length, 40)
  assert.equal(sources[0], '/m0.js')
  assert.equal(sources[39], '/m39.js')
})
