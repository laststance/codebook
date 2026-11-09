import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  firstBareImport,
  judgeStaticPage,
  readStaticPageReadiness,
  staticPageEntryFile,
} from '../utils/readStaticPageReadiness'
import { resolveStaticPageScriptPath } from '../utils/resolveStaticPageScriptPath'

import { createStaticPageRepository } from './utils/staticPageFixture'

/**
 * Builds `count` same-origin script tags `s1.js` … and their files, the last one carrying `lastText`.
 * @param count - How many scripts the page names.
 * @param lastText - The text of the last script.
 * @returns The fixture files for {@link createStaticPageRepository}.
 * @example manyScripts(2, 'x') // => { 'index.html': '…', 's1.js': 'export {}', 's2.js': 'x' }
 */
function manyScripts(count: number, lastText: string): Record<string, string> {
  const files: Record<string, string> = {}
  const tags: string[] = []
  for (let index = 1; index <= count; index += 1) {
    tags.push(`<script type="module" src="s${index}.js"></script>`)
    files[`s${index}.js`] = index === count ? lastText : 'export {}'
  }
  files['index.html'] =
    `<!doctype html><html><body>${tags.join('')}</body></html>`
  return files
}

// Value: protects=a page naming more than 16 same-origin scripts is never called ready while later scripts go unread; fails_when=the 17th script's bare import leaves the page ready, or 16 clean scripts are refused; no_claim=that scripts past the cap are read
test('a page with 17 same-origin scripts is not ready while 16 clean scripts are', async (context) => {
  // Arrange
  const seventeen = await createStaticPageRepository(
    context,
    manyScripts(17, "import 'lib'"),
  )
  const sixteen = await createStaticPageRepository(
    context,
    manyScripts(16, 'export {}'),
  )
  // Act
  const seventeenReadiness = await readStaticPageReadiness(seventeen.pageFolder)
  const sixteenReadiness = await readStaticPageReadiness(sixteen.pageFolder)
  const problem = await judgeStaticPage(seventeen.pageFolder, '/')
  // Assert
  assert.equal(seventeenReadiness.ready, false)
  assert.deepEqual(problem, {
    gap: 'needs-bundler',
    reference: 's17.js (more than 16 same-origin scripts were not all judged)',
    kind: 'scripts-not-all-judged',
  })
  assert.equal(sixteenReadiness.ready, true)
})

// Value: protects=an import written inside a comment or string leaves a valid page ready, while a real dynamic import of a bare specifier still needs a bundler; fails_when=a commented or quoted import('lib') refuses the page, or a real one passes; no_claim=regex literals are skipped
test('import calls in comments and strings leave a page ready, a real one needs a bundler', () => {
  // Arrange
  const ignored = [
    "// import('lib')",
    "/* import('lib') */",
    `const text = 'import("lib")'`,
    'const text = `import("lib")`',
  ]
  // Act
  const results = ignored.map((text) => firstBareImport(text))
  const real = firstBareImport("await import('lib')")
  const afterComment = firstBareImport("/* x */ import('lib')")
  // Assert
  assert.deepEqual(results, [undefined, undefined, undefined, undefined])
  assert.equal(real, 'lib')
  assert.equal(afterComment, 'lib')
})

// Value: protects=a script file named with leading dots (..app.js) is judged present, while a path that really leaves the folder is still refused; fails_when=a file named ..app.js is called missing, or ../x.js stops leaving; no_claim=windows separators
test('a file named ..app.js is present and ../x.js leaves the folder', async (context) => {
  // Arrange
  const dotted = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><html><body><script src="..app.js"></script></body></html>',
    '..app.js': 'export {}',
  })
  const leaving = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><html><body><script src="../x.js"></script></body></html>',
  })
  // Act
  const dottedReadiness = await readStaticPageReadiness(dotted.pageFolder)
  const leavingProblem = await judgeStaticPage(leaving.pageFolder, '/')
  const entry = staticPageEntryFile('/..page.html')
  const escaping = staticPageEntryFile('/../page.html')
  const scriptPath = resolveStaticPageScriptPath('..app.js', '.')
  const scriptLeaving = resolveStaticPageScriptPath('../x.js', '.')
  // Assert
  assert.equal(dottedReadiness.ready, true)
  assert.deepEqual(leavingProblem, {
    gap: 'needs-bundler',
    reference: '../x.js',
    kind: 'missing-file',
  })
  assert.equal(entry, '..page.html')
  assert.equal(escaping, undefined)
  assert.equal(scriptPath, '..app.js')
  assert.equal(scriptLeaving, undefined)
})
