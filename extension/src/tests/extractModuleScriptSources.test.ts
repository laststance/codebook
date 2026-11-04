import assert from 'node:assert/strict'
import { test } from 'node:test'

import { VITE_ENTRY_MODULE_SCRIPT_LIMIT_COUNT } from '../constants'
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

// protects=Cycle 0078 entries: a page with a huge number of scripts cannot make the walk request unbounded; fails_when=more than the entry limit are returned; no_claim=none beyond protects
test('stops listing at the entry module limit', () => {
  // Arrange
  const html = Array.from(
    { length: VITE_ENTRY_MODULE_SCRIPT_LIMIT_COUNT + 20 },
    (_, index) => `<script type="module" src="/m${index}.js"></script>`,
  ).join('')
  // Act
  const sources = extractModuleScriptSources(html, ENTRY)
  // Assert
  assert.equal(sources.length, VITE_ENTRY_MODULE_SCRIPT_LIMIT_COUNT)
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
