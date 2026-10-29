import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { discoverStaticLoads } from '../utils/discoverStaticLoads'

import { createRepositoryFixture } from './utils/chromeExtensionFixture'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const OTHER_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba'

/** Discovers what a surface page loads in a fixture extension; returns relative reachable paths and the unfollowed forms. */
async function pageLoads(
  context: TestContext,
  files: Record<string, string>,
  htmlPath = 'page.html',
) {
  const root = await createRepositoryFixture(context, files)
  const result = await discoverStaticLoads({
    extensionRoot: root,
    extensionId: EXTENSION_ID,
    entry: { kind: 'page', htmlPath: join(root, htmlPath) },
  })
  return {
    reachable: [...result.reachable]
      .map((file) => file.slice(root.length + 1))
      .sort(),
    unfollowed: result.unfollowed,
  }
}

/** Same for a service worker entry. */
async function workerLoads(
  context: TestContext,
  files: Record<string, string>,
  isModule: boolean,
) {
  const root = await createRepositoryFixture(context, files)
  const result = await discoverStaticLoads({
    extensionRoot: root,
    extensionId: EXTENSION_ID,
    entry: { kind: 'worker', scriptPath: join(root, 'worker.js'), isModule },
  })
  return {
    reachable: [...result.reachable]
      .map((file) => file.slice(root.length + 1))
      .sort(),
    unfollowed: result.unfollowed,
  }
}

test('a page follows script src, static import and export-from to the files they name, dropping query and fragment', async (context) => {
  // protects=SR5 recursive discovery; fails_when=a form is missed or a query string breaks the lookup; no_claim=the code runs
  // Arrange
  const files = {
    'page.html':
      '<script src="a.js?v=1"></script><script type="module" src="b.js#x"></script>',
    'a.js': "import { x } from './c.js'\nimport def, * as ns from './d.js'\n",
    'b.js': "export { y } from './e.js'\nexport * from './f.js'\n",
    'c.js': '',
    'd.js': '',
    'e.js': '',
    'f.js': '',
    'unrelated.js': '',
  }
  // Act
  const { reachable } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js'])
})

test('a page resolves root-absolute and own-id chrome-extension urls but not another extension id', async (context) => {
  // protects=ER3 resolution forms; fails_when=a form resolves to the wrong file or another extension's url is followed; no_claim=nothing about http urls
  // Arrange
  const files = {
    'sub/page.html': `<script src="/root.js"></script><script src="chrome-extension://${EXTENSION_ID}/own.js"></script><script src="chrome-extension://${OTHER_ID}/foreign.js"></script><script src="https://example.com/remote.js"></script>`,
    'root.js': '',
    'own.js': '',
    'foreign.js': '',
  }
  // Act
  const { reachable } = await pageLoads(context, files, 'sub/page.html')
  // Assert
  assert.deepEqual(reachable, ['own.js', 'root.js'])
})

test('a base href inside the extension changes where relative scripts resolve', async (context) => {
  // protects=ER3 base href; fails_when=base is ignored; no_claim=base outside the extension
  // Arrange
  const files = {
    'ui/page.html': '<base href="../shared/"><script src="lib.js"></script>',
    'shared/lib.js': '',
    'ui/lib.js': '',
  }
  // Act
  const { reachable } = await pageLoads(context, files, 'ui/page.html')
  // Assert
  assert.deepEqual(reachable, ['shared/lib.js'])
})

test('a classic worker follows literal importScripts arguments and not static import', async (context) => {
  // protects=ER3 classic worker rule; fails_when=importScripts is missed or import is followed in a classic worker; no_claim=nothing
  // Arrange
  const files = {
    'worker.js': "importScripts('a.js', \"b.js\")\nimport './c.js'\n",
    'a.js': "importScripts('d.js')",
    'b.js': '',
    'c.js': '',
    'd.js': '',
  }
  // Act
  const { reachable } = await workerLoads(context, files, false)
  // Assert
  assert.deepEqual(reachable, ['a.js', 'b.js', 'd.js', 'worker.js'])
})

test('a module worker follows static import and export-from and not importScripts', async (context) => {
  // protects=ER3 module worker rule; fails_when=the mode is mixed up; no_claim=nothing
  // Arrange
  const files = {
    'worker.js':
      "import './a.js'\nexport * from './b.js'\nimportScripts('c.js')\n",
    'a.js': '',
    'b.js': '',
    'c.js': '',
  }
  // Act
  const { reachable } = await workerLoads(context, files, true)
  // Assert
  assert.deepEqual(reachable, ['a.js', 'b.js', 'worker.js'])
})

test('an importScripts call with a computed argument leaves the literal ones followed and records the computed path', async (context) => {
  // protects=SR40 computed paths named; fails_when=the form is silently dropped; no_claim=the computed file is found
  // Arrange
  const files = {
    'worker.js': "importScripts('a.js', base + 'b.js')\n",
    'a.js': '',
    'b.js': '',
  }
  // Act
  const { reachable, unfollowed } = await workerLoads(context, files, false)
  // Assert
  assert.deepEqual(reachable, ['a.js', 'worker.js'])
  assert.deepEqual(unfollowed, [{ form: 'computed path', path: 'worker.js' }])
})

test('a dynamic import is not followed and is named', async (context) => {
  // protects=SR40 dynamic import; fails_when=it is followed or unnamed; no_claim=nothing
  // Arrange
  const files = {
    'page.html': '<script src="a.js"></script>',
    'a.js': "const lazy = () => import('./b.js')\n",
    'b.js': '',
  }
  // Act
  const { reachable, unfollowed } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, ['a.js'])
  assert.deepEqual(unfollowed, [{ form: 'dynamic import', path: 'a.js' }])
})

test('import.meta.url paths, import maps and bare specifiers are not followed and are named', async (context) => {
  // protects=SR40 remaining forms; fails_when=any is followed or unnamed; no_claim=nothing
  // Arrange
  const files = {
    'page.html':
      '<script type="importmap">{"imports":{"x":"./x.js"}}</script><script type="module" src="a.js"></script>',
    'a.js': "import 'lodash'\nconst url = new URL('./b.js', import.meta.url)\n",
    'b.js': '',
    'x.js': '',
  }
  // Act
  const { reachable, unfollowed } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, ['a.js'])
  assert.deepEqual(unfollowed.map((entry) => entry.form).sort(), [
    'bare specifier',
    'import map',
    'import.meta.url',
  ])
})

test('an import written inside a comment is not followed', async (context) => {
  // protects=no false reachability; fails_when=comments are scanned; no_claim=string literals containing import are handled
  // Arrange
  const files = {
    'page.html': '<script src="a.js"></script>',
    'a.js': "// import './b.js'\n/* import './b.js' */\n",
    'b.js': '',
  }
  // Act
  const { reachable } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, ['a.js'])
})

test('a file loaded only by an inline script is not reachable through the inline script itself', async (context) => {
  // protects=SR5 inline script has no file; fails_when=the html is reported as a loaded script file; no_claim=nothing
  // Arrange
  const files = { 'page.html': '<script>console.log(1)</script>' }
  // Act
  const { reachable } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, [])
})

test('discovery follows a chain eight files deep and stops at nine', async (context) => {
  // protects=EXTENSION_STATIC_LOAD_DEPTH_LIMIT; fails_when=the depth moves or a cycle loops forever; no_claim=nothing
  // Arrange
  const files: Record<string, string> = {
    'page.html': '<script type="module" src="m1.js"></script>',
  }
  for (let index = 1; index <= 10; index += 1)
    files[`m${index}.js`] = `import './m${index + 1}.js'\n`
  files['m11.js'] = "import './m1.js'\n" // a cycle back, which must terminate
  // Act
  const { reachable } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, [
    'm1.js',
    'm2.js',
    'm3.js',
    'm4.js',
    'm5.js',
    'm6.js',
    'm7.js',
    'm8.js',
  ])
})

test('a reference to a file that is missing is not reachable and does not throw', async (context) => {
  // protects=robustness; fails_when=ENOENT escapes; no_claim=Chrome's own error is shown
  // Arrange
  const files = { 'page.html': '<script src="gone.js"></script>' }
  // Act
  const { reachable } = await pageLoads(context, files)
  // Assert
  assert.deepEqual(reachable, [])
})
