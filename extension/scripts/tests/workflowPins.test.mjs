import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { runCommandsOf } from './utils/runCommandsOf.mjs'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * The command-line forms that install a package or a download named on the line itself, which pins a version at most and never the bytes: `npm install`, `npm i`, `npm exec`, `npx`, `pnpm add`, `pnpm dlx`, `yarn add`, `yarn dlx`, `yarn global`, `pip install`, `pipx install`, `pipx run`, `corepack prepare`, `corepack use`, and a download piped into a shell (`curl … | sh`).
 * An install from a lockfile (`npm ci`, `pnpm install --frozen-lockfile`) names no package and is not one of them. What an action installs from its inputs (Node from `.node-version`) is outside this list: an action is pinned by its commit instead.
 */
const INSTALL_NAMED_ON_THE_COMMAND_LINE =
  /\bnpm (?:install|i|exec)\b|\bnpx\b|\bpnpm (?:add|dlx)\b|\byarn (?:add|dlx|global)\b|\bpip3? install\b|\bpipx (?:install|run)\b|\bcorepack (?:prepare|use)\b|\b(?:curl|wget)\b.*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/

/**
 * Reads one file of the repository as text, for the pins below that compare workflow and manifest content.
 * @param path - The file's path from the repository root.
 * @param root - The folder the path starts at; the repository unless a test of these helpers hands a folder of its own.
 * @returns The file's text.
 * @example
 * await repositoryText('.node-version') // => '24.21.0\n'
 */
function repositoryText(path, root = repositoryRoot) {
  return readFile(join(root, path), 'utf8')
}

/**
 * Reads every workflow and every composite action of the repository, written as `.yml` or as `.yaml`, so a pin also holds for a job added later under either extension.
 * @param root - The folder that holds `.github`; the repository unless a test of these helpers hands a folder of its own.
 * @returns One entry per file: its path from the root and its text, the actions first, each group sorted by name.
 * @example
 * await ciDefinitions() // => [{ path: '.github/actions/prepare/action.yml', text: 'name: Prepare…' }, …]
 */
async function ciDefinitions(root = repositoryRoot) {
  const workflows = (await readdir(join(root, '.github/workflows')))
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted()
    .map((name) => `.github/workflows/${name}`)
  const actions = []
  // An action is the definition file of its folder, under either extension.
  for (const folder of (
    await readdir(join(root, '.github/actions'))
  ).toSorted())
    for (const name of await readdir(join(root, '.github/actions', folder)))
      if (/^action\.ya?ml$/.test(name))
        actions.push(`.github/actions/${folder}/${name}`)
  return Promise.all(
    [...actions, ...workflows].map(async (path) => ({
      path,
      text: await repositoryText(path, root),
    })),
  )
}

/**
 * Cuts one named step out of a workflow, so a pin can state the whole step as the lines a reader sees.
 * @param workflow - The workflow's text.
 * @param name - The step's `name`.
 * @returns The step's lines without indentation, from its name to the line before the next step; empty when no step has that name.
 * @example
 * stepLines(workflow, 'Install the video encoder') // => ['- name: Install the video encoder', 'run: playwright-cli install-browser ffmpeg']
 */
function stepLines(workflow, name) {
  const lines = workflow.split('\n').map((line) => line.trim())
  const first = lines.indexOf(`- name: ${name}`)
  if (first === -1) return []
  const next = lines.findIndex(
    (line, index) => index > first && (line === '' || line.startsWith('- ')),
  )
  return lines.slice(first, next === -1 ? undefined : next)
}

/**
 * The browser checks that were retired: the script's file name, and for each of its cases the place that checks it now.
 * A browser check (`*-qa.mjs`) stays in `extension/scripts` only while a workflow runs it: outside every workflow nothing notices when it stops passing, or stops starting. One that leaves its workflow is named here, case by case, in the change that takes it out.
 * None is retired at present: Cycle 0046 row 333 found three checks outside every workflow, two of which could not start any more, and brought all three back into the Reader DOM job.
 */
const RETIRED_BROWSER_CHECKS = new Map()

/**
 * Lists the browser checks of `extension/scripts` that no workflow runs and no list of retired checks names, for the pin that keeps every such check in a job.
 * A check counts as run when a command of a workflow or of a composite action names its file as one of its words; a comment or a step's name does not run it.
 * @param retiredChecks - The retired checks by file name ({@link RETIRED_BROWSER_CHECKS}).
 * @param root - The folder that holds `.github` and `extension`; the repository unless a test of this helper hands a folder of its own.
 * @returns The file names of the checks left out, sorted; empty when every check is run or retired.
 * @example
 * await browserChecksLeftOut(new Map()) // => [] while every `*-qa.mjs` has its step in a workflow
 */
async function browserChecksLeftOut(retiredChecks, root = repositoryRoot) {
  const checks = (await readdir(join(root, 'extension/scripts')))
    .filter((name) => name.endsWith('-qa.mjs'))
    .toSorted()
  const commandWords = (await ciDefinitions(root)).flatMap(({ text }) =>
    runCommandsOf(text).flatMap((command) => command.split(/\s+/)),
  )
  return checks.filter(
    (name) =>
      !retiredChecks.has(name) &&
      !commandWords.some(
        (word) =>
          word === `extension/scripts/${name}` || word === `scripts/${name}`,
      ),
  )
}

/**
 * Lists the path filters of a workflow's triggers, one list per `paths` key, so a pin can compare what starts a job with what the job runs.
 * A list written once under a YAML anchor (`paths: &name`) and reused by its alias (`paths: *name`) is returned for both keys.
 * @param workflow - The workflow's text.
 * @returns The entries of every `paths` list in file order; empty when no trigger is filtered. An alias of an anchor the text does not define gives an empty list.
 * @example
 * pathFiltersOf('on:\n  push:\n    paths:\n      - a.ts\n      - b.ts\n') // => [['a.ts', 'b.ts']]
 * pathFiltersOf('on:\n  push:\n    paths: &both\n      - a.ts\n  pull_request:\n    paths: *both\n') // => [['a.ts'], ['a.ts']]
 */
function pathFiltersOf(workflow) {
  const lines = workflow.split('\n'),
    filters = [],
    anchored = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const key = /^paths:(?: ([&*])(\S+))?$/.exec(lines[index].trim())
    if (!key) continue
    const [, mark, name] = key
    // An alias repeats the list its anchor named earlier in the file.
    if (mark === '*') {
      filters.push([...(anchored.get(name) ?? [])])
      continue
    }
    const entries = []
    // The list ends at the first line that is not one of its entries.
    while (lines[index + 1]?.trim().startsWith('- ')) {
      index += 1
      entries.push(lines[index].trim().slice('- '.length))
    }
    if (mark === '&') anchored.set(name, entries)
    filters.push(entries)
  }
  return filters
}

/**
 * Takes the comments out of a TypeScript source and leaves every other character where it was, so {@link loadedPathsOf} does not read an import that a comment or a docstring only quotes as a load.
 *
 * The TypeScript parser says where the comments are: they stand in the space before a token (a docstring before the first token of its declaration), so two slashes inside a string, a template or a regular expression start no comment. A comment's characters become spaces and its line breaks stay.
 *
 * @param source - The source's text.
 * @returns The text with the same length and the same lines, without its line comments, block comments and docstrings.
 * @example
 * withoutComments("import './setup' // import './old'\n") // => "import './setup'                  \n"
 */
function withoutComments(source) {
  const file = ts.createSourceFile(
    'source.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  const characters = source.split('')
  const blankBefore = (node) => {
    const parts = node.getChildren(file)
    if (parts.length > 0) return parts.forEach(blankBefore)
    // Before a token, from the end of the one before it, stand only white space and comments.
    const tokenStart = node.getStart(file)
    for (let index = node.pos; index < tokenStart; index += 1)
      if (characters[index] !== '\n') characters[index] = ' '
  }
  blankBefore(file)
  return characters.join('')
}

/**
 * Names the way a call loads a file by a path, for {@link unreadableLoadsOf}: a dynamic `import(…)`, `require(…)`, `require.resolve(…)`, or a path built from `__dirname` with `resolve` or `join`, called bare or as a method (`path.join`).
 * @param call - A call expression of the source.
 * @returns `import`, `require`, `require.resolve` or `__dirname`; `undefined` for every other call.
 * @example
 * loadFormOf(callOf("require.resolve('../utils/lock')")) // => 'require.resolve'
 * loadFormOf(callOf("readFile('notes.md')"))             // => undefined
 */
function loadFormOf(call) {
  const callee = call.expression
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return 'import'
  if (ts.isIdentifier(callee) && callee.text === 'require') return 'require'
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'require' &&
    callee.name.text === 'resolve'
  )
    return 'require.resolve'
  // `join(__dirname, …)` and `path.join(__dirname, …)` alike, as the pattern of compiled modules in loadedPathsOf matches both.
  let name
  if (ts.isPropertyAccessExpression(callee)) name = callee.name.text
  else if (ts.isIdentifier(callee)) name = callee.text
  const [base] = call.arguments
  return name !== undefined &&
    ['resolve', 'join'].includes(name) &&
    base !== undefined &&
    ts.isIdentifier(base) &&
    base.text === '__dirname'
    ? '__dirname'
    : undefined
}

/**
 * Says whether {@link loadedPathsOf} can read the path of a call that loads a file, for {@link unreadableLoadsOf}.
 * @param form - What {@link loadFormOf} named.
 * @param call - The call expression.
 * @returns
 * - `import`, `require`, `require.resolve`: `true` when the path is one string in single or double quotes
 * - `__dirname`: `true` when every part after `__dirname` is such a string, and when the last part is such a string that names no `.js` module: a document or a folder below a folder named by a variable is data the test reads
 * - `false` for a template literal, a variable and any other expression in the path
 * @example
 * isReadableLoad('import', callOf('import(`../utils/${name}`)'))                // => false
 * isReadableLoad('__dirname', callOf("join(__dirname, folder, 'README.md')"))   // => true
 * isReadableLoad('__dirname', callOf("join(__dirname, folder, 'lock.js')"))     // => false
 */
function isReadableLoad(form, call) {
  const [first, ...parts] = call.arguments
  if (form !== '__dirname')
    return first !== undefined && ts.isStringLiteral(first)
  if (parts.every((part) => ts.isStringLiteral(part))) return true
  const last = parts.at(-1)
  return ts.isStringLiteral(last) && !last.text.endsWith('.js')
}

/**
 * Lists the loads of a TypeScript source whose path {@link loadedPathsOf} cannot read, so that the closure of a test file fails by name instead of leaving the loaded file out of a path filter unseen.
 * The source is read by the TypeScript parser, so a comment holds no load. A load written inside a string (a script a test hands a process as text) is not looked at here.
 * @param source - The source's text.
 * @returns One entry per such load in file order: its one-based line and its text on one line; empty when every load is written with a path {@link loadedPathsOf} reads.
 * @example
 * unreadableLoadsOf("const lock = await import(`../utils/${name}`)\n") // => [{ line: 1, text: 'import(`../utils/${name}`)' }]
 * unreadableLoadsOf("const lock = await import('../utils/lock')\n")    // => []
 */
function unreadableLoadsOf(source) {
  const file = ts.createSourceFile(
    'source.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const unreadable = []
  const visit = (node) => {
    const form = ts.isCallExpression(node) ? loadFormOf(node) : undefined
    if (form !== undefined && !isReadableLoad(form, node))
      unreadable.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        text: node.getText(file).replace(/\s+/g, ' '),
      })
    ts.forEachChild(node, visit)
  }
  visit(file)
  return unreadable
}

/**
 * Lists the files a TypeScript source loads by a relative path, so the closure of a test file leaves none of them out; called by {@link sourcesLoadedBy} for every TypeScript file of a closure.
 *
 * The forms it reads: `from '…'` (also of `import type` and of `export`), a side-effect `import '…'`, `import('…')`, `require('…')`, `require.resolve('…')`, and a compiled module named from `__dirname` (`loadModule(resolve(__dirname, '../x.js'), …)`, `join(__dirname, 'utils', 'x.js')`), each with its path as one string in single or double quotes. A `__dirname` path that is no `.js` module (a document, a manifest, a folder) is data the test reads and is not listed. A package or a Node module is not part of a path filter.
 * A load whose path it cannot read (a template literal, a variable or another expression in `import()`, `require()`, `require.resolve()` or after `__dirname`) fails by name ({@link unreadableLoadsOf}): the file it names would stay outside the path filter unseen.
 *
 * A comment is not read ({@link withoutComments}): an import that a docstring's example quotes loads nothing, and would widen a path filter unseen. A string is read like code, because a test can hand a process its script as text; a quoted import there widens the filter, or fails the pin by name when it names no file.
 *
 * @param source - The source's text.
 * @param path - The source's path, for the failure's sentence.
 * @returns The paths as written, relative to the source's folder: the specifiers first, then the compiled modules.
 * @throws When the source loads a file by a path this function cannot read, with the source's path, the line and the load's text.
 * @example
 * loadedPathsOf("import './setup'\nconst lock = require('../utils/lock') // not require('../utils/old')\n", 'src/tests/lock.test.ts') // => ['./setup', '../utils/lock']
 * loadedPathsOf('const lock = await import(`../utils/${name}`)\n', 'src/tests/lock.test.ts')
 * // throws "src/tests/lock.test.ts:1 loads a file by a path this pin cannot read: import(`../utils/${name}`). …"
 */
function loadedPathsOf(source, path) {
  const [unreadable] = unreadableLoadsOf(source)
  if (unreadable)
    throw new Error(
      `${path}:${unreadable.line} loads a file by a path this pin cannot read: ${unreadable.text}. Write the path as one string in quotes, so that the path filter can name the file.`,
    )
  const code = withoutComments(source)
  const relativePath = `['"](\\.{1,2}/[^'"]+)['"]`
  const specifiers = [
    new RegExp(`\\bfrom\\s*${relativePath}`, 'g'),
    new RegExp(`\\bimport\\s*${relativePath}`, 'g'),
    new RegExp(
      `\\b(?:import|require(?:\\.resolve)?)\\(\\s*${relativePath}`,
      'g',
    ),
  ].flatMap((form) => [...code.matchAll(form)].map((match) => match[1]))
  const compiledModules = [
    ...code.matchAll(
      /\b(?:resolve|join)\(\s*__dirname((?:\s*,\s*['"][^'"]+['"])+)\s*,?\s*\)/g,
    ),
  ]
    // The path may be written in parts: join(__dirname, 'utils', 'x.js').
    .map(([, parts]) =>
      posix.join(
        ...[...parts.matchAll(/['"]([^'"]+)['"]/g)].map((part) => part[1]),
      ),
    )
    .filter((path) => path.endsWith('.js'))
  return [...specifiers, ...compiledModules]
}

/**
 * Names the repository file a loaded path stands for, for {@link sourcesLoadedBy}: a compiled `.js` module is its `.ts` source, a path with an extension is that file, and a bare specifier is `<path>.ts` or the `index.ts` of that folder.
 * @param path - The source that loads, as a path from the root.
 * @param loadedPath - What it loads, as {@link loadedPathsOf} lists it.
 * @param root - The folder both paths start at.
 * @returns The loaded file's path from the root, with forward slashes.
 * @throws When no such file exists, so a source the closure cannot follow fails the pin instead of staying outside the filter unseen.
 * @example
 * await sourceNamedBy('extension/src/tests/a.test.ts', '../utils/lock.js', repositoryRoot) // => 'extension/src/utils/lock.ts'
 */
async function sourceNamedBy(path, loadedPath, root) {
  const target = posix.join(dirname(path), loadedPath)
  let candidates = [`${target}.ts`, `${target}/index.ts`]
  if (target.endsWith('.js'))
    candidates = [`${target.slice(0, -'.js'.length)}.ts`]
  else if (/\.(?:json|mjs|ts)$/.test(target)) candidates = [target]
  for (const candidate of candidates) {
    const isFile = await stat(join(root, candidate)).then(
      (entry) => entry.isFile(),
      () => false,
    )
    if (isFile) return candidate
  }
  throw new Error(
    `${path} loads '${loadedPath}', which names no source file (looked for ${candidates.join(', ')}).`,
  )
}

/**
 * Lists the sources a set of test files loads, directly and through the files those load, so a path filter can be compared with the files whose change can alter the tests' result.
 * @param entries - The test files, as paths from the root.
 * @param root - The folder the paths start at; the repository unless a test of these helpers hands a folder of its own.
 * @returns The entries and every file they load by a relative path ({@link loadedPathsOf}), as sorted paths from the root with forward slashes.
 * @throws When a loaded path names no file ({@link sourceNamedBy}), and when a file of the closure loads by a path that cannot be read ({@link loadedPathsOf}).
 * @example
 * await sourcesLoadedBy(['extension/src/tests/isProcessGone.test.ts'])
 * // => ['extension/src/tests/isProcessGone.test.ts', 'extension/src/utils/isProcessGone.ts', 'extension/src/utils/systemErrorCode.ts']
 */
async function sourcesLoadedBy(entries, root = repositoryRoot) {
  const loaded = new Set(),
    waiting = [...entries]
  while (waiting.length > 0) {
    const path = waiting.pop()
    if (loaded.has(path)) continue
    loaded.add(path)
    // A TypeScript source and a script's ES module load further files; a manifest or a document ends the walk.
    if (!/\.(?:ts|mjs)$/.test(path)) continue
    for (const loadedPath of loadedPathsOf(
      await repositoryText(path, root),
      path,
    ))
      waiting.push(await sourceNamedBy(path, loadedPath, root))
  }
  return [...loaded].toSorted()
}

/**
 * Lists the test sources a job runs, taken from its `node --test` commands, so that the Windows pin follows the files the job runs and not a list of its own, which the command can outgrow unseen.
 * The job runs from the folder `extension`: compiled files (`dist/tests/<name>.test.js`), each of which stands for its source, `extension/src/tests/<name>.test.ts`, and script tests (`scripts/tests/<name>.test.mjs`), which are their own source.
 * @param workflow - The workflow's text.
 * @returns The sources in the order the commands name them; empty when the workflow runs no `node --test` command.
 * @throws When an argument of such a command is neither an option that begins with `--`, nor one compiled test file of `dist/tests`, nor one script test of `scripts/tests` (a glob, a folder, a file of another folder): the closure cannot start from it.
 * @example
 * testSourcesRunBy('      - run: node --test dist/tests/isProcessGone.test.js\n') // => ['extension/src/tests/isProcessGone.test.ts']
 * testSourcesRunBy('      - run: node --test scripts/tests/openWithoutFollowing.test.mjs\n') // => ['extension/scripts/tests/openWithoutFollowing.test.mjs']
 */
function testSourcesRunBy(workflow) {
  return (
    runCommandsOf(workflow)
      .filter((command) => /^node --test(?:\s|$)/.test(command))
      .flatMap((command) => command.split(/\s+/).slice(2))
      // An option of the runner (--test-concurrency=1) names no file.
      .filter((argument) => !argument.startsWith('--'))
      .map((argument) => {
        // A script test is its own source.
        if (/^scripts\/tests\/[\w.-]+\.test\.mjs$/.test(argument))
          return `extension/${argument}`
        const name = /^dist\/tests\/([\w.-]+)\.test\.js$/.exec(argument)?.[1]
        if (name === undefined)
          throw new Error(
            `The job runs 'node --test' with '${argument}', which names neither a single compiled test file of dist/tests nor a single script test of scripts/tests, so the pin cannot tell which sources that run loads.`,
          )
        return `extension/src/tests/${name}.test.ts`
      })
  )
}

test('the fast build writes the build metadata once: neither the build:fast script nor the Reader DOM job runs build-metadata.mjs after it', async () => {
  // Arrange
  const manifest = JSON.parse(await repositoryText('extension/package.json'))
  const fastBuild = await repositoryText('extension/scripts/build-fast.mjs')
  const definitions = await ciDefinitions()

  // Act: the fast build loads build-metadata.mjs itself, so no job has a reason to name that script.
  const metadataLoadsOfTheFastBuild = fastBuild.match(
    /await import\('\.\/build-metadata\.mjs'\)/g,
  )
  const metadataRunsOfJobs = definitions.flatMap(({ path, text }) =>
    runCommandsOf(text)
      .filter((command) => command.includes('build-metadata.mjs'))
      .map((command) => `${path}: ${command}`),
  )

  // Assert
  assert.deepEqual(metadataLoadsOfTheFastBuild, [
    "await import('./build-metadata.mjs')",
  ])
  assert.deepEqual(metadataRunsOfJobs, [])
  assert.equal(manifest.scripts['build:fast'], 'node scripts/build-fast.mjs')
})

test('the reader DOM workflow installs playwright-cli from its lockfile, no job installs a package or a download named on its command line, and the build metadata is written once', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/reader-dom.yml')
  const toolManifest = JSON.parse(
    await repositoryText('.github/reader-dom/package.json'),
  )
  const toolLockfile = JSON.parse(
    await repositoryText('.github/reader-dom/package-lock.json'),
  )
  const definitions = await ciDefinitions()

  // Act: a package named on a command line is pinned by its version at most; a lockfile pins the bytes.
  const installsByName = definitions.flatMap(({ path, text }) =>
    runCommandsOf(text)
      .filter((command) => INSTALL_NAMED_ON_THE_COMMAND_LINE.test(command))
      .map((command) => `${path}: ${command}`),
  )
  const packagesWithoutIntegrity = Object.entries(toolLockfile.packages)
    .filter(
      ([path, entry]) => path !== '' && !/^sha512-/.test(entry.integrity ?? ''),
    )
    .map(([path]) => path)
  const builds = runCommandsOf(workflow).filter((command) =>
    command.includes('scripts/build-'),
  )

  // Assert
  assert.deepEqual(installsByName, [])
  assert.deepEqual(
    stepLines(workflow, 'Install playwright-cli from its lockfile'),
    [
      '- name: Install playwright-cli from its lockfile',
      'working-directory: .github/reader-dom',
      'run: |',
      'npm ci --ignore-scripts',
      'echo "$PWD/node_modules/.bin" >> "$GITHUB_PATH"',
    ],
  )
  assert.deepEqual(toolManifest.dependencies, { '@playwright/cli': '0.1.22' })
  assert.deepEqual(Object.keys(toolLockfile.packages), [
    '',
    'node_modules/@playwright/cli',
    'node_modules/playwright',
    'node_modules/playwright-core',
  ])
  assert.equal(
    toolLockfile.packages['node_modules/@playwright/cli'].version,
    '0.1.22',
  )
  assert.deepEqual(packagesWithoutIntegrity, [])
  assert.deepEqual(builds, ['node scripts/build-fast.mjs'])
})

// Value: protects=the measured cases of the Wiki reader's page in CI (the unit suites read the shell's style sheet and never lay a page out); fails_when=the Reader DOM job stops running the Wiki reader's check, or runs it before or into the folder of the Study reader's check, or no longer keeps its report after a failure, or the two checks name the same browser session, so two runs on one machine close each other's browser; why_new=Cycle 0046 row 70; seam=none
test('the Reader DOM job runs the Wiki reader DOM cases after the Study reader’s, into a folder of their own that is kept after a failure, under a browser session of their own', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/reader-dom.yml')
  const wikiCheck = await repositoryText(
    'extension/scripts/wiki-reader-dom-qa.mjs',
  )
  const studyCheck = await repositoryText(
    'extension/scripts/study-bootstrap-qa.mjs',
  )

  // Act: the checks the job runs, in their order; the step that keeps their folders; the session each script names for the browser CLI.
  const checks = runCommandsOf(workflow).filter((command) =>
    command.includes('-qa.mjs'),
  )
  const [keepName, keepCondition, keepAction, ...keepInputs] = stepLines(
    workflow,
    'Keep the DOM reports, screenshots and video after a failure',
  )
  const namedCheckOf = (script) =>
    /\bsession = readerDomSessionName\('([a-z-]+)', mode, output\)/.exec(
      script,
    )?.[1]

  // Assert: the two readers' checks come first; the checks after them have a pin of their own below.
  assert.deepEqual(checks.slice(0, 2), [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'node extension/scripts/wiki-reader-dom-qa.mjs verify artifacts/wiki-reader-dom',
  ])
  assert.deepEqual(stepLines(workflow, 'Run the Wiki reader DOM cases'), [
    '- name: Run the Wiki reader DOM cases',
    "if: ${{ !cancelled() && (steps.study.outcome == 'success' || steps.study.outcome == 'failure') }}",
    'run: node extension/scripts/wiki-reader-dom-qa.mjs verify artifacts/wiki-reader-dom',
  ])
  assert.equal(
    keepName,
    '- name: Keep the DOM reports, screenshots and video after a failure',
  )
  assert.equal(keepCondition, 'if: failure()')
  assert.match(
    keepAction ?? '',
    /^uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
  )
  assert.deepEqual(keepInputs, [
    'with:',
    'name: reader-dom',
    'path: |',
    'artifacts/reader-dom',
    'artifacts/wiki-reader-dom',
    'artifacts/reading-pose-dom',
    'artifacts/understanding-dom',
    'artifacts/repository-pane-dom',
    'if-no-files-found: ignore',
  ])
  // Each check names its session after itself, its mode and its output folder (readerDomSessionName), and the two name themselves differently.
  assert.deepEqual(
    { wiki: namedCheckOf(wikiCheck), study: namedCheckOf(studyCheck) },
    { wiki: 'wiki-reader', study: 'bootstrap' },
  )
})

// Value: protects=a pull request that breaks both readers seeing both failures in one run, and the artifact of a failed job holding the folder of the Wiki reader's check; fails_when=the Wiki reader's step runs only after a passed Study step again, or also runs after a failed build or in a cancelled job, where it has no build to read; why_new=Cycle 0046 row 127; seam=none
test('the Wiki reader DOM cases also run after the Study reader’s cases failed, and neither after a step before them failed nor in a cancelled job', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/reader-dom.yml')

  // Act: the Study reader's step, whose outcome the condition reads, and the condition of the Wiki reader's step.
  const studyStep = stepLines(workflow, 'Run the reader DOM cases')
  const [, wikiCondition] = stepLines(workflow, 'Run the Wiki reader DOM cases')

  // Assert: `!cancelled()` replaces the default `success()`, so a failed step before does not skip this one; a Study step
  // that was skipped, because the build or the browser tools failed, has neither of the two outcomes.
  assert.deepEqual(studyStep, [
    '- name: Run the reader DOM cases',
    'id: study',
    'run: node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
  ])
  assert.equal(
    wikiCondition,
    "if: ${{ !cancelled() && (steps.study.outcome == 'success' || steps.study.outcome == 'failure') }}",
  )
})

// Value: protects=the cases of the Study reader's reading pose, of the understanding checkbox in both panes and of the Repository Wiki pane in CI, where a regression of them is seen (until Cycle 0046 the three checks ran by hand only); fails_when=the Reader DOM job stops running one of the three, runs it into another check's folder or only after a passed Study step, no longer keeps its folder after a failure, or two of the five checks name the same browser session, so two of them on one machine close each other's browser; why_new=Cycle 0046 rows 331 to 333; seam=none
test('the Reader DOM job runs the reading pose, the understanding checkbox and the Repository Wiki pane cases after the two readers’ checks, each under the Wiki reader’s condition, into a folder of its own that is kept after a failure, under a browser session of its own', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/reader-dom.yml')
  const sessionNameOf = async (script) =>
    /\bsession = readerDomSessionName\('([a-z-]+)', mode, output\)/.exec(
      await repositoryText(`extension/scripts/${script}`),
    )?.[1]

  // Act: the checks the job runs, in their order; the three later steps; the folders the job keeps; the session each of the five scripts names.
  const checks = runCommandsOf(workflow).filter((command) =>
    command.includes('-qa.mjs'),
  )
  const laterSteps = [
    'Run the reading pose cases of the Study reader',
    'Run the understanding checkbox cases of both panes',
    'Run the Repository Wiki pane cases',
  ].map((name) => stepLines(workflow, name))
  const keptFolders = stepLines(
    workflow,
    'Keep the DOM reports, screenshots and video after a failure',
  ).filter((line) => line.startsWith('artifacts/'))
  const sessionNames = {
    'study-bootstrap-qa.mjs': await sessionNameOf('study-bootstrap-qa.mjs'),
    'wiki-reader-dom-qa.mjs': await sessionNameOf('wiki-reader-dom-qa.mjs'),
    'study-reading-pose-qa.mjs': await sessionNameOf(
      'study-reading-pose-qa.mjs',
    ),
    'understanding-focus-qa.mjs': await sessionNameOf(
      'understanding-focus-qa.mjs',
    ),
    'repository-return-qa.mjs': await sessionNameOf('repository-return-qa.mjs'),
  }

  // Assert
  assert.deepEqual(checks, [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'node extension/scripts/wiki-reader-dom-qa.mjs verify artifacts/wiki-reader-dom',
    'node extension/scripts/study-reading-pose-qa.mjs verify artifacts/reading-pose-dom',
    'node extension/scripts/understanding-focus-qa.mjs verify artifacts/understanding-dom',
    'node extension/scripts/repository-return-qa.mjs verify artifacts/repository-pane-dom',
  ])
  assert.deepEqual(laterSteps, [
    [
      '- name: Run the reading pose cases of the Study reader',
      "if: ${{ !cancelled() && (steps.study.outcome == 'success' || steps.study.outcome == 'failure') }}",
      'run: node extension/scripts/study-reading-pose-qa.mjs verify artifacts/reading-pose-dom',
    ],
    [
      '- name: Run the understanding checkbox cases of both panes',
      "if: ${{ !cancelled() && (steps.study.outcome == 'success' || steps.study.outcome == 'failure') }}",
      'run: node extension/scripts/understanding-focus-qa.mjs verify artifacts/understanding-dom',
    ],
    [
      '- name: Run the Repository Wiki pane cases',
      "if: ${{ !cancelled() && (steps.study.outcome == 'success' || steps.study.outcome == 'failure') }}",
      'run: node extension/scripts/repository-return-qa.mjs verify artifacts/repository-pane-dom',
    ],
  ])
  assert.deepEqual(keptFolders, [
    'artifacts/reader-dom',
    'artifacts/wiki-reader-dom',
    'artifacts/reading-pose-dom',
    'artifacts/understanding-dom',
    'artifacts/repository-pane-dom',
  ])
  assert.deepEqual(sessionNames, {
    'study-bootstrap-qa.mjs': 'bootstrap',
    'wiki-reader-dom-qa.mjs': 'wiki-reader',
    'study-reading-pose-qa.mjs': 'reading-pose',
    'understanding-focus-qa.mjs': 'understanding',
    'repository-return-qa.mjs': 'repository-pane',
  })
})

// Value: protects=every browser check being able to start whatever the size of the page it loads (Cycle 0046 row 333: two checks handed their flow and the Study pane's page to the browser CLI as one command argument, which the system refuses above 131,072 bytes, `spawn E2BIG`); fails_when=a `*-qa.mjs` script hands its flow over as an argument again, or runs it outside the case keeper, so a step that throws leaves a report without a case; why_new=Cycle 0046 row 333; seam=none
test('every browser check of extension/scripts hands its flow to the browser as a file written by readerDomFlowText, and none as a command argument', async () => {
  // Arrange: the browser checks, read as text (loading one starts its browser).
  const names = (await readdir(join(repositoryRoot, 'extension/scripts')))
    .filter((name) => name.endsWith('-qa.mjs'))
    .toSorted()

  // Act: how each script hands its flow over.
  const handOver = {}
  for (const name of names) {
    const script = await repositoryText(`extension/scripts/${name}`)
    handOver[name] = {
      writesTheFlowFile: /readerDomFlowText\(\s*check,/.test(script),
      runsTheFlowFile: script.match(
        /command\(\['run-code', `--filename=\$\{flowPath\}`\], 'flow'\)/g,
      )?.length,
      flowsAsArgument: script.match(/\.toString\(\)\}\)\(page\b/g),
    }
  }

  // Assert
  const asFile = {
    writesTheFlowFile: true,
    runsTheFlowFile: 1,
    flowsAsArgument: null,
  }
  assert.deepEqual(handOver, {
    'repository-return-qa.mjs': asFile,
    'study-bootstrap-qa.mjs': asFile,
    'study-reading-pose-qa.mjs': asFile,
    'understanding-focus-qa.mjs': asFile,
    'wiki-reader-dom-qa.mjs': asFile,
  })
})

// Value: protects=every browser check of the panes and readers being run where a regression is seen (Cycle 0046 row 333: three checks lay in `extension/scripts` outside every workflow, and two of them could not start any more without anyone noticing); fails_when=a `*-qa.mjs` script of `extension/scripts` is run by no workflow and named in no list of retired checks; why_new=Cycle 0046 row 333; seam=none
test('every browser check of extension/scripts is run by a workflow or named among the retired checks', async () => {
  // Arrange / Act
  const leftOut = await browserChecksLeftOut(RETIRED_BROWSER_CHECKS)

  // Assert: a check that is listed here either gets its step in `.github/workflows/reader-dom.yml`, or is deleted and named in RETIRED_BROWSER_CHECKS with the place that checks each of its cases now.
  assert.deepEqual(leftOut, [])
})

// Value: protects=the pin above being able to fail; fails_when=a check that no workflow runs passes the pin because its name appears in a comment or in a step's name, or a retired check is reported, or a check run from the `extension` folder is reported; why_new=Cycle 0046 row 333; seam=none
test('a browser check that no workflow runs and no list of retired checks names fails the pin by its file name, while one a workflow runs and one that is named as retired pass', async () => {
  // Arrange: four checks; a workflow runs the first from the repository root and the second from the extension folder, and only names the third in a comment and in a step's name.
  const root = await mkdtemp(join(tmpdir(), 'codebook-browser-checks-'))
  try {
    await mkdir(join(root, '.github/workflows'), { recursive: true })
    await mkdir(join(root, '.github/actions'), { recursive: true })
    await mkdir(join(root, 'extension/scripts'), { recursive: true })
    for (const name of [
      'pane-qa.mjs',
      'reader-qa.mjs',
      'forgotten-qa.mjs',
      'older-qa.mjs',
      'build-fast.mjs',
    ])
      await writeFile(join(root, 'extension/scripts', name), '')
    await writeFile(
      join(root, '.github/workflows/reader-dom.yml'),
      [
        'jobs:',
        '  reader-dom:',
        '    steps:',
        '      # forgotten-qa.mjs is not run.',
        '      - name: Run pane-qa.mjs and not forgotten-qa.mjs',
        '        run: node extension/scripts/pane-qa.mjs verify artifacts/pane',
        '      - name: Run the reader cases',
        '        working-directory: extension',
        '        run: node scripts/reader-qa.mjs verify artifacts/reader',
        '',
      ].join('\n'),
    )

    // Act
    const leftOut = await browserChecksLeftOut(
      new Map([['older-qa.mjs', 'every case is a case of pane-qa.mjs now']]),
      root,
    )

    // Assert
    assert.deepEqual(leftOut, ['forgotten-qa.mjs'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the Reader DOM job keeps the video encoder between runs under a key that names the pinned playwright-cli release', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/reader-dom.yml')
  const toolManifest = JSON.parse(
    await repositoryText('.github/reader-dom/package.json'),
  )

  // Act
  const [restoreName, restoreAction, ...restoreInputs] = stepLines(
    workflow,
    'Restore the video encoder',
  )
  const download = stepLines(workflow, 'Install the video encoder')

  // Assert: the key carries the release the tool manifest pins, the kept path is the encoder's folder alone (the CLI
  // writes session logs and its update check beside it), and the restore comes before the download it saves.
  assert.equal(restoreName, '- name: Restore the video encoder')
  assert.match(
    restoreAction ?? '',
    /^uses: actions\/cache@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
  )
  assert.deepEqual(restoreInputs, [
    'with:',
    'path: ~/.cache/ms-playwright/ffmpeg-*',
    "key: playwright-cli-0.1.22-ffmpeg-${{ runner.os }}-${{ hashFiles('.github/reader-dom/package-lock.json') }}",
  ])
  assert.deepEqual(toolManifest.dependencies, { '@playwright/cli': '0.1.22' })
  assert.deepEqual(download, [
    '- name: Install the video encoder',
    'run: playwright-cli install-browser ffmpeg',
  ])
  assert.ok(
    workflow.indexOf('- name: Restore the video encoder') <
      workflow.indexOf('- name: Install the video encoder'),
    'the encoder is downloaded before its cache is restored',
  )
})

test('the Windows job runs its test files on windows-latest, one at a time, and starts for every source those tests load', async () => {
  // Arrange
  const workflow = await repositoryText(
    '.github/workflows/storage-locks-windows.yml',
  )

  // Act
  const [pushFilter, pullRequestFilter, ...otherFilters] =
    pathFiltersOf(workflow)
  // The files the job runs are read from its run command: a list of the pin's own could fall behind the command unseen.
  const loadedSources = await sourcesLoadedBy(testSourcesRunBy(workflow))
  const actionReferences = workflow
    .split('\n')
    .map((line) => line.trim().replace(/^- /, ''))
    .filter((line) => line.startsWith('uses: '))
  const settings = workflow.split('\n').map((line) => line.trim())
  const filterKeys = workflow
    .split('\n')
    .filter((line) => line.trim().startsWith('paths:'))

  // Assert: both triggers have one filter, the workflow itself, the Node release and every source the test files of the run command
  // load; only the two constants files, which most pull requests change, are left out.
  assert.deepEqual(pushFilter, [
    '.github/workflows/storage-locks-windows.yml',
    '.node-version',
    'extension/scripts/tests/openWithoutFollowing.test.mjs',
    'extension/scripts/utils/openWithoutFollowing.mjs',
    'extension/scripts/utils/packageConstants.mjs',
    'extension/scripts/utils/readVsixBytes.mjs',
    'extension/src/runtimeSupport/utils/linuxCommandLineArguments.ts',
    'extension/src/runtimeSupport/utils/listProcesses.ts',
    'extension/src/runtimeSupport/utils/profileProcesses.ts',
    'extension/src/runtimeSupport/utils/removeAbandonedProfiles.ts',
    'extension/src/runtimeSupport/utils/sha256.ts',
    'extension/src/runtimeSupport/utils/windowsCommandLineArguments.ts',
    'extension/src/tests/canJudgeOwnerHere.test.ts',
    'extension/src/tests/claimWikiUpdateMarker.test.ts',
    'extension/src/tests/currentStorageOwner.test.ts',
    'extension/src/tests/dropSecondNameOfMovedFile.test.ts',
    'extension/src/tests/hashFileSha256.test.ts',
    'extension/src/tests/isFolderOfItsOwn.test.ts',
    'extension/src/tests/isFromEarlierBoot.test.ts',
    'extension/src/tests/isProcessGone.test.ts',
    'extension/src/tests/isProgramFile.test.ts',
    'extension/src/tests/isRecordedOwnerGone.test.ts',
    'extension/src/tests/isSameStorageMachine.test.ts',
    'extension/src/tests/listFolderTreeWithoutFollowing.test.ts',
    'extension/src/tests/listProcesses.test.ts',
    'extension/src/tests/namesMachineInClear.test.ts',
    'extension/src/tests/openWithoutFollowing.test.ts',
    'extension/src/tests/processStartFormHere.test.ts',
    'extension/src/tests/readBootIdentity.test.ts',
    'extension/src/tests/readLiveWikiUpdateMarker.test.ts',
    'extension/src/tests/readProcessStart.test.ts',
    'extension/src/tests/readRecordedOwner.test.ts',
    'extension/src/tests/readWikiRegularFile.test.ts',
    'extension/src/tests/refreshCursorMcpCatalogFileIdentity.test.ts',
    'extension/src/tests/removeAbandonedProfiles.test.ts',
    'extension/src/tests/removeStaleStorageClaims.test.ts',
    'extension/src/tests/removeStaleStorageLock.test.ts',
    'extension/src/tests/removeWithoutFollowing.test.ts',
    'extension/src/tests/runBoundedQuery.test.ts',
    'extension/src/tests/runtime-profileProcesses.test.ts',
    'extension/src/tests/utils/answerKernelBootId.ts',
    'extension/src/tests/utils/createLinkIfAllowed.ts',
    'extension/src/tests/utils/fileSystemWhoseLinksResistRemoval.ts',
    'extension/src/tests/utils/fileSystemWithLargeFileIds.ts',
    'extension/src/tests/utils/idOfNoProcess.ts',
    'extension/src/tests/utils/idleChild.ts',
    'extension/src/tests/utils/isFileIdExactAsANumber.ts',
    'extension/src/tests/utils/loadDropSecondNameWhoseLinkIsRefused.ts',
    'extension/src/tests/utils/loadModule.ts',
    'extension/src/tests/utils/loadOpenWithoutFollowing.ts',
    'extension/src/tests/utils/realProcessStart.ts',
    'extension/src/tests/utils/removeAsNodeOnWindows.ts',
    'extension/src/tests/utils/requireOwnPidNamespace.ts',
    'extension/src/tests/utils/standInForPs.ts',
    'extension/src/tests/utils/startOfKilledWindow.ts',
    'extension/src/tests/withStorageLock.test.ts',
    'extension/src/utils/atomicPrivateBytes.ts',
    'extension/src/utils/atomicPrivateWrite.ts',
    'extension/src/utils/canJudgeOwnerHere.ts',
    'extension/src/utils/claimStorageLockTakeover.ts',
    'extension/src/utils/claimWikiUpdateMarker.ts',
    'extension/src/utils/currentStorageOwner.ts',
    'extension/src/utils/currentUserName.ts',
    'extension/src/utils/deriveMachineKeys.ts',
    'extension/src/utils/describeNoStorageFolder.ts',
    'extension/src/utils/describeRefusedLinkBack.ts',
    'extension/src/utils/describeUnopenedFile.ts',
    'extension/src/utils/describeUnopenedMovedFile.ts',
    'extension/src/utils/dropSecondNameOfMovedFile.ts',
    'extension/src/utils/dropSecondNameOfOneFile.ts',
    'extension/src/utils/environmentVariable.ts',
    'extension/src/utils/hashFileSha256.ts',
    'extension/src/utils/isFolderOfItsOwn.ts',
    'extension/src/utils/isFromEarlierBoot.ts',
    'extension/src/utils/isLeftEmpty.ts',
    'extension/src/utils/isProcessGone.ts',
    'extension/src/utils/isProgramFile.ts',
    'extension/src/utils/isRecordedFileId.ts',
    'extension/src/utils/isRecordedOwnerGone.ts',
    'extension/src/utils/isSameFileId.ts',
    'extension/src/utils/isSameStorageMachine.ts',
    'extension/src/utils/isStaleStorageLock.ts',
    'extension/src/utils/listFolderTreeWithoutFollowing.ts',
    'extension/src/utils/listPlacedClaims.ts',
    'extension/src/utils/modifiedAtMsOf.ts',
    'extension/src/utils/namesMachineInClear.ts',
    'extension/src/utils/openWithoutFollowing.ts',
    'extension/src/utils/passIfMissing.ts',
    'extension/src/utils/placeStorageLock.ts',
    'extension/src/utils/preparedLockSuffix.ts',
    'extension/src/utils/processStartFormHere.ts',
    'extension/src/utils/psProgramPath.ts',
    'extension/src/utils/readBootIdentity.ts',
    'extension/src/utils/readLiveWikiUpdateMarker.ts',
    'extension/src/utils/readProcessStart.ts',
    'extension/src/utils/readRecordedOwner.ts',
    'extension/src/utils/readUpToLimit.ts',
    'extension/src/utils/readWikiRegularFile.ts',
    'extension/src/utils/recordedFileId.ts',
    'extension/src/utils/refreshCursorMcpCatalog.ts',
    'extension/src/utils/removeStaleStorageClaims.ts',
    'extension/src/utils/removeStaleStorageLock.ts',
    'extension/src/utils/removeWithoutFollowing.ts',
    'extension/src/utils/runBoundedQuery.ts',
    'extension/src/utils/startOverBy.ts',
    'extension/src/utils/stepPastNoRealFolder.ts',
    'extension/src/utils/storageLockHeldError.ts',
    'extension/src/utils/systemErrorCode.ts',
    'extension/src/utils/trimMatchingEnds.ts',
    'extension/src/utils/unopenedFileCode.ts',
    'extension/src/utils/windowsPowerShellPath.ts',
    'extension/src/utils/withStorageLock.ts',
    'extension/src/utils/withoutBootTime.ts',
  ])
  assert.deepEqual(pullRequestFilter, pushFilter)
  // The list is written once: the pull request's filter is a YAML alias of the push filter, so one cannot change without the other.
  assert.deepEqual(filterKeys, [
    '    paths: &lock-test-paths',
    '    paths: *lock-test-paths',
  ])
  assert.deepEqual(otherFilters, [])
  assert.deepEqual(
    [
      '.github/workflows/storage-locks-windows.yml',
      '.node-version',
      ...loadedSources.filter(
        (path) =>
          path !== 'extension/src/constants.ts' &&
          path !== 'extension/src/runtimeSupport/constants.ts',
      ),
    ],
    pushFilter,
  )
  assert.equal(settings.includes('runs-on: windows-latest'), true)
  assert.deepEqual(runCommandsOf(workflow), [
    'git config --global core.autocrlf false',
    'node scripts/build-fast.mjs',
    'node --test --test-concurrency=1 dist/tests/withStorageLock.test.js dist/tests/isProcessGone.test.js dist/tests/currentStorageOwner.test.js dist/tests/isFromEarlierBoot.test.js dist/tests/isSameStorageMachine.test.js dist/tests/readBootIdentity.test.js dist/tests/readProcessStart.test.js dist/tests/isRecordedOwnerGone.test.js dist/tests/readRecordedOwner.test.js dist/tests/removeStaleStorageLock.test.js dist/tests/removeStaleStorageClaims.test.js dist/tests/canJudgeOwnerHere.test.js dist/tests/claimWikiUpdateMarker.test.js dist/tests/readLiveWikiUpdateMarker.test.js dist/tests/processStartFormHere.test.js dist/tests/namesMachineInClear.test.js dist/tests/readWikiRegularFile.test.js dist/tests/openWithoutFollowing.test.js dist/tests/hashFileSha256.test.js dist/tests/refreshCursorMcpCatalogFileIdentity.test.js dist/tests/listProcesses.test.js dist/tests/dropSecondNameOfMovedFile.test.js dist/tests/removeWithoutFollowing.test.js dist/tests/listFolderTreeWithoutFollowing.test.js dist/tests/isFolderOfItsOwn.test.js dist/tests/runBoundedQuery.test.js dist/tests/runtime-profileProcesses.test.js dist/tests/removeAbandonedProfiles.test.js dist/tests/isProgramFile.test.js',
    'node --test --test-concurrency=1 scripts/tests/openWithoutFollowing.test.mjs',
  ])
  assert.deepEqual(actionReferences, [
    'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    'uses: ./.github/actions/prepare',
  ])
})

// Review of Cycle 0045 (tests-1 #11): the pin knew npm, npx and pnpm only, so a job that added a tool with yarn, pip, corepack or a piped download stayed green.
// Value: protects=a reader of a pull request's checks, who must see from a failed check's name what failed on Windows; fails_when=the workflow, its job or its test step is named after the storage lock again, the first of the twelve kinds of test the job runs, or the guide gives another name for the check than the workflow has; why_new=Cycle 0046 row 264: a failed test of the Cursor MCP catalog or of the process listing showed as "Storage lock tests on Windows"; seam=none
test('the Windows workflow, its job and its test step are named after the file system and process tests they run, none after the storage lock alone, and the guide gives the check under the name a pull request shows', async () => {
  // Arrange
  const guide = await repositoryText('docs/qa/test-execution.md')
  const workflow = await repositoryText(
    '.github/workflows/storage-locks-windows.yml',
  )

  // Act: every name the workflow gives (itself, its job, its steps) in file order, the step that starts the tests, and the guide's section.
  const names = workflow
    .split('\n')
    .map((line) => line.trim().replace(/^- /, ''))
    .filter((line) => line.startsWith('name: '))
    .map((line) => line.slice('name: '.length))
  const testStep = stepLines(workflow, 'Run the file system and process tests')
  const section =
    guide.split(/^## /m).find((part) => part.startsWith('The Windows job\n')) ??
    ''

  // Assert
  assert.deepEqual(names, [
    'Windows file system and process tests',
    'File system and process tests on Windows',
    'Keep line endings as committed',
    'Prepare environment',
    'Emit the compiled tests without type checking',
    'Run the file system and process tests',
    "Run the tests of the scripts' opener",
  ])
  assert.deepEqual(
    names.filter((name) => /storage lock/i.test(name)),
    [],
    'a name of the Windows workflow speaks of the storage lock alone, one of the twelve kinds of test the job runs',
  )
  // The step of that name is the one that starts the tests.
  assert.equal(
    testStep.some((line) =>
      line.startsWith('run: node --test --test-concurrency=1 dist/tests/'),
    ),
    true,
  )
  assert.equal(
    section.includes(
      "Among a pull request's checks the job shows as `Windows file system and process tests / File system and process tests on Windows`; the workflow's file keeps the name it got in Cycle 0045, when the job ran the storage lock's tests alone.",
    ),
    true,
    'the guide does not give the check under the name the workflow and its job have',
  )
})

test('the install pin knows a package or a download named on a command line for npm, pnpm, yarn, pip and corepack, and passes an install from a lockfile', () => {
  // Arrange
  const commands = [
    'npm ci --ignore-scripts',
    'pnpm --dir extension install --frozen-lockfile',
    'npm install @playwright/cli@0.1.22',
    'npx playwright install',
    'pnpm dlx fallow',
    'yarn add left-pad',
    'yarn global add vsce',
    'pip install yamllint==1.35.1',
    'pipx run yamllint .',
    'corepack prepare pnpm@10.0.0 --activate',
    'curl -fsSL https://example.test/install.sh | sh',
    'wget -qO- https://example.test/install.sh | sudo bash',
    'node scripts/build-fast.mjs',
  ]

  // Act
  const installsByName = commands.filter((command) =>
    INSTALL_NAMED_ON_THE_COMMAND_LINE.test(command),
  )

  // Assert: the two lockfile installs and the build pass; every command that names what it installs is listed.
  assert.deepEqual(installsByName, [
    'npm install @playwright/cli@0.1.22',
    'npx playwright install',
    'pnpm dlx fallow',
    'yarn add left-pad',
    'yarn global add vsce',
    'pip install yamllint==1.35.1',
    'pipx run yamllint .',
    'corepack prepare pnpm@10.0.0 --activate',
    'curl -fsSL https://example.test/install.sh | sh',
    'wget -qO- https://example.test/install.sh | sudo bash',
  ])
})

// Review of Cycle 0045 (tests-1 #11): the definitions were read by the `.yml` ending only, so a workflow added as `.yaml` was outside every pin.
test('a workflow or a composite action written as .yaml is read by the pins like one written as .yml', async () => {
  // Arrange: a repository with one workflow and one action of each extension, and a note that is no definition.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, '.github/workflows'), { recursive: true })
    await mkdir(join(root, '.github/actions/prepare'), { recursive: true })
    await mkdir(join(root, '.github/actions/publish'), { recursive: true })
    await writeFile(join(root, '.github/workflows/test.yml'), 'name: Test\n')
    await writeFile(join(root, '.github/workflows/lint.yaml'), 'name: Lint\n')
    await writeFile(join(root, '.github/workflows/notes.md'), 'Notes\n')
    await writeFile(
      join(root, '.github/actions/prepare/action.yml'),
      'name: Prepare\n',
    )
    await writeFile(
      join(root, '.github/actions/publish/action.yaml'),
      'name: Publish\n',
    )

    // Act
    const definitions = await ciDefinitions(root)

    // Assert
    assert.deepEqual(definitions, [
      { path: '.github/actions/prepare/action.yml', text: 'name: Prepare\n' },
      { path: '.github/actions/publish/action.yaml', text: 'name: Publish\n' },
      { path: '.github/workflows/lint.yaml', text: 'name: Lint\n' },
      { path: '.github/workflows/test.yml', text: 'name: Test\n' },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Review of Cycle 0045 (tests-1 #11): the closure followed `from './…'` only, so a source loaded by a side-effect import, a require, a dynamic import or loadModule could be missing from a path filter unseen.
test('the sources a test file loads include a side-effect import, a required module, a dynamic import, a manifest and a compiled module named from __dirname', async () => {
  // Arrange: one test file that loads a source in each form, and one source that loads a further one.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, 'src/tests/utils'), { recursive: true })
    await mkdir(join(root, 'src/utils/locks'), { recursive: true })
    await writeFile(
      join(root, 'src/tests/lock.test.ts'),
      [
        "import assert from 'node:assert/strict'",
        "import './utils/prepareClock'",
        "import { owner } from '../utils/owner'",
        "import limits from '../utils/limits.json'",
        "const probe = require('../utils/probe')",
        "const locks = await import('../utils/locks')",
        "const lock = await loadModule(resolve(__dirname, '../utils/withLock.js'), {})",
        "const fixture = await loadModule(join(__dirname, 'utils', 'lockFixture.js'), {})",
        "const guide = await readFile(resolve(__dirname, '../../README.md'), 'utf8')",
      ].join('\n'),
    )
    await writeFile(join(root, 'src/tests/utils/prepareClock.ts'), '')
    await writeFile(join(root, 'src/tests/utils/lockFixture.ts'), '')
    await writeFile(
      join(root, 'src/utils/owner.ts'),
      "export { machine } from './machine'\n",
    )
    await writeFile(join(root, 'src/utils/machine.ts'), '')
    await writeFile(join(root, 'src/utils/limits.json'), '{}')
    await writeFile(join(root, 'src/utils/probe.ts'), '')
    await writeFile(join(root, 'src/utils/locks/index.ts'), '')
    await writeFile(join(root, 'src/utils/withLock.ts'), '')

    // Act
    const loadedSources = await sourcesLoadedBy(
      ['src/tests/lock.test.ts'],
      root,
    )

    // Assert: every loaded file once; the README the test only reads is no source.
    assert.deepEqual(loadedSources, [
      'src/tests/lock.test.ts',
      'src/tests/utils/lockFixture.ts',
      'src/tests/utils/prepareClock.ts',
      'src/utils/limits.json',
      'src/utils/locks/index.ts',
      'src/utils/machine.ts',
      'src/utils/owner.ts',
      'src/utils/probe.ts',
      'src/utils/withLock.ts',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Review of Cycle 0045 (tests-1 #11): a loaded path the closure could not follow must fail the pin by name instead of leaving the source outside the filter.
test('a loaded path that names no source file fails the pin with the file that loads it and the path it names', async () => {
  // Arrange: the test file requires a module that has no source.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, 'src/tests'), { recursive: true })
    await writeFile(
      join(root, 'src/tests/lock.test.ts'),
      "const probe = require('../utils/probe')\n",
    )

    // Act
    const loading = sourcesLoadedBy(['src/tests/lock.test.ts'], root)

    // Assert
    await assert.rejects(loading, {
      message:
        "src/tests/lock.test.ts loads '../utils/probe', which names no source file (looked for src/utils/probe.ts, src/utils/probe/index.ts).",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Cycle 0046 row 125: the Windows pin named its test files in a list of its own, so a file added to the job's run command, but not to that list or the path filter, left the pin green.
test('the test files the Windows pin follows are the ones the job’s node --test command names, also one no list of the pin names, and an argument that is neither a single compiled test file nor a single script test fails by name', async () => {
  // Arrange: a job that runs two test files, one of them with a runner option before it, and a job that runs a glob.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, 'extension/src/tests'), { recursive: true })
    await mkdir(join(root, 'extension/src/utils'), { recursive: true })
    await writeFile(
      join(root, 'extension/src/tests/lock.test.ts'),
      "import { lock } from '../utils/lock'\n",
    )
    await writeFile(
      join(root, 'extension/src/tests/addedToTheCommandOnly.test.ts'),
      "import { probe } from '../utils/probe'\n",
    )
    await writeFile(join(root, 'extension/src/utils/lock.ts'), '')
    await writeFile(join(root, 'extension/src/utils/probe.ts'), '')
    const workflow = [
      'jobs:',
      '  windows:',
      '    steps:',
      '      - name: Emit the compiled tests',
      '        run: node scripts/build-fast.mjs',
      '      - name: Run the tests',
      '        working-directory: extension',
      '        run: node --test --test-concurrency=1 dist/tests/lock.test.js dist/tests/addedToTheCommandOnly.test.js',
      '',
    ].join('\n')
    const workflowWithAGlob = '      - run: node --test dist/tests/*.test.js\n'

    // Act
    const testSources = testSourcesRunBy(workflow)
    const loadedSources = await sourcesLoadedBy(testSources, root)
    const readingAGlob = () => testSourcesRunBy(workflowWithAGlob)

    // Assert: both files of the command with what they load; the build is no test run.
    assert.deepEqual(testSources, [
      'extension/src/tests/lock.test.ts',
      'extension/src/tests/addedToTheCommandOnly.test.ts',
    ])
    assert.deepEqual(loadedSources, [
      'extension/src/tests/addedToTheCommandOnly.test.ts',
      'extension/src/tests/lock.test.ts',
      'extension/src/utils/lock.ts',
      'extension/src/utils/probe.ts',
    ])
    assert.throws(readingAGlob, {
      message:
        "The job runs 'node --test' with 'dist/tests/*.test.js', which names neither a single compiled test file of dist/tests nor a single script test of scripts/tests, so the pin cannot tell which sources that run loads.",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the Windows run of a script test (the packaging scripts' opener) whenever a script module it loads changes; fails_when=the pin cannot read a script test from the job's command, or stops the walk at a script's ES module, so a module that test loads is left out of the path filter unseen and a change to it never runs on Windows; why_new=Cycle 0046 /ship review T14: the job runs a script test since then, and the walk followed TypeScript sources only; seam=a workflow and a repository of the test's own
test('a script test the Windows job runs is followed with the script modules it loads, also those its modules load', async () => {
  // Arrange: a job that runs one script test, which loads a script module that loads another.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, 'extension/scripts/tests'), { recursive: true })
    await mkdir(join(root, 'extension/scripts/utils'), { recursive: true })
    await writeFile(
      join(root, 'extension/scripts/tests/opener.test.mjs'),
      "import { openWithoutFollowing } from '../utils/opener.mjs'\n",
    )
    await writeFile(
      join(root, 'extension/scripts/utils/opener.mjs'),
      "import { MAX_ARCHIVE_BYTES } from './limits.mjs'\n",
    )
    await writeFile(join(root, 'extension/scripts/utils/limits.mjs'), '')
    const workflow = [
      'jobs:',
      '  windows:',
      '    steps:',
      '      - name: Run the tests of the scripts',
      '        working-directory: extension',
      '        run: node --test --test-concurrency=1 scripts/tests/opener.test.mjs',
      '',
    ].join('\n')

    // Act
    const testSources = testSourcesRunBy(workflow)
    const loadedSources = await sourcesLoadedBy(testSources, root)

    // Assert
    assert.deepEqual(
      { testSources, loadedSources },
      {
        testSources: ['extension/scripts/tests/opener.test.mjs'],
        loadedSources: [
          'extension/scripts/tests/opener.test.mjs',
          'extension/scripts/utils/limits.mjs',
          'extension/scripts/utils/opener.mjs',
        ],
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Cycle 0046 row 125: a load whose path the closure could not read (a template literal, a variable, require.resolve) was left out silently, so the file it names could be missing from a path filter unseen. Second /ship CodeRabbit CR8-1: path.join(__dirname, …) with a variable was left out the same way.
test('a load whose path is a template literal, a variable or an expression fails the pin with the file, the line and the load, while a document read below a folder named by a variable does not', async () => {
  // Arrange: five test files that each load by a path the closure cannot read (the last through path.join), and one that only reads a document that way and resolves a module by a quoted path.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, 'src/tests'), { recursive: true })
    await mkdir(join(root, 'src/utils'), { recursive: true })
    await writeFile(
      join(root, 'src/tests/template.test.ts'),
      [
        "import assert from 'node:assert/strict'",
        "const name = 'lock'",
        'const lock = await import(`../utils/${name}`)',
      ].join('\n'),
    )
    await writeFile(
      join(root, 'src/tests/variable.test.ts'),
      "const modulePath = '../utils/lock'\nconst lock = require(modulePath)\n",
    )
    await writeFile(
      join(root, 'src/tests/resolved.test.ts'),
      "const name = 'lock'\n\nconst lockPath = require.resolve('../utils/' + name)\n",
    )
    await writeFile(
      join(root, 'src/tests/fromDirname.test.ts'),
      [
        "const target = { relativePath: '../utils/lock.js' }",
        'const lock = await loadModule(',
        '  resolve(__dirname, target.relativePath),',
        '  {},',
        ')',
      ].join('\n'),
    )
    await writeFile(
      join(root, 'src/tests/fromPathJoin.test.ts'),
      [
        "import path from 'node:path'",
        "const folder = '../utils'",
        "const lockPath = path.join(__dirname, folder, 'lock.js')",
      ].join('\n'),
    )
    await writeFile(
      join(root, 'src/tests/readable.test.ts'),
      [
        "const folder = '../..'",
        "const guide = await readFile(join(__dirname, folder, 'README.md'), 'utf8')",
        "const lockPath = require.resolve('../utils/lock')",
      ].join('\n'),
    )
    await writeFile(join(root, 'src/utils/lock.ts'), '')

    // Act
    const failureOf = (testFile) =>
      sourcesLoadedBy([testFile], root).then(
        () => 'no failure',
        (error) => error.message,
      )
    const failures = {
      template: await failureOf('src/tests/template.test.ts'),
      variable: await failureOf('src/tests/variable.test.ts'),
      resolved: await failureOf('src/tests/resolved.test.ts'),
      fromDirname: await failureOf('src/tests/fromDirname.test.ts'),
      fromPathJoin: await failureOf('src/tests/fromPathJoin.test.ts'),
    }
    const readableSources = await sourcesLoadedBy(
      ['src/tests/readable.test.ts'],
      root,
    )

    // Assert
    assert.deepEqual(failures, {
      template:
        'src/tests/template.test.ts:3 loads a file by a path this pin cannot read: import(`../utils/${name}`). Write the path as one string in quotes, so that the path filter can name the file.',
      variable:
        'src/tests/variable.test.ts:2 loads a file by a path this pin cannot read: require(modulePath). Write the path as one string in quotes, so that the path filter can name the file.',
      resolved:
        "src/tests/resolved.test.ts:3 loads a file by a path this pin cannot read: require.resolve('../utils/' + name). Write the path as one string in quotes, so that the path filter can name the file.",
      fromDirname:
        'src/tests/fromDirname.test.ts:3 loads a file by a path this pin cannot read: resolve(__dirname, target.relativePath). Write the path as one string in quotes, so that the path filter can name the file.',
      fromPathJoin:
        "src/tests/fromPathJoin.test.ts:3 loads a file by a path this pin cannot read: path.join(__dirname, folder, 'lock.js'). Write the path as one string in quotes, so that the path filter can name the file.",
    })
    assert.deepEqual(readableSources, [
      'src/tests/readable.test.ts',
      'src/utils/lock.ts',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Cycle 0046 row 72: the closure matched its patterns on the whole text, so the example in the docstring of a test helper, which quotes `import('../../environment')`, made the Windows job's path filter the whole runtime (156 files).
test('a module that a comment or a docstring of a test file only quotes is not among the sources the test file loads, while a load on the same line as a comment or after two slashes in a string still is', async () => {
  // Arrange: a test file that loads two modules and quotes six further ones, which do not exist, in a line comment, a block comment, a docstring and a comment a build keeps.
  const root = await mkdtemp(join(tmpdir(), 'codebook-workflow-pins-'))
  try {
    await mkdir(join(root, 'src/tests'), { recursive: true })
    await mkdir(join(root, 'src/utils'), { recursive: true })
    await writeFile(
      join(root, 'src/tests/lock.test.ts'),
      [
        "/*! Before a build this file read: import './quotedInAKeptComment' */",
        "// import './quotedInALineComment'",
        "import { owner } from '../utils/owner' // was: from '../utils/quotedAfterCode'",
        "/* const lock = require('../utils/quotedInABlockComment') */",
        '/**',
        ' * Loads a module with stand-ins.',
        " * @example await loadModule<typeof import('../utils/quotedInADocstring')>(resolve(__dirname, '../utils/quotedFromDirname.js'), {})",
        ' */',
        'function loadModule() {}',
        "const address = 'http://localhost//wiki'; const probe = require('../utils/probe')",
      ].join('\n'),
    )
    await writeFile(join(root, 'src/utils/owner.ts'), '')
    await writeFile(join(root, 'src/utils/probe.ts'), '')

    // Act
    const loadedSources = await sourcesLoadedBy(
      ['src/tests/lock.test.ts'],
      root,
    )

    // Assert: the two modules the code loads; a quoted module would fail the walk, because it names no file.
    assert.deepEqual(loadedSources, [
      'src/tests/lock.test.ts',
      'src/utils/owner.ts',
      'src/utils/probe.ts',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * The kinds of test the Windows job runs, as the test execution guide and the workflow's header name them, each with its test files; for the pin below.
 * The two documents name kinds and no files, so a test file added to a kind they already name changes neither of them: it is added here, under its kind. A file of a kind they do not name fails the pin, which then asks for the kind's name in both.
 * A test of `extension/src/tests` is named by its name alone (`withStorageLock`); a script test of `extension/scripts/tests` by `scripts/` and its name (`scripts/openWithoutFollowing`), so it is told from an extension test of the same name ({@link testNameInTheJob}).
 */
const WINDOWS_JOB_TEST_KINDS = [
  {
    kind: "the storage lock and its owner's identity",
    tests: [
      'withStorageLock',
      'isProcessGone',
      'currentStorageOwner',
      'isFromEarlierBoot',
      'isSameStorageMachine',
      'readBootIdentity',
      'readProcessStart',
      'isRecordedOwnerGone',
      'readRecordedOwner',
      'removeStaleStorageLock',
      'removeStaleStorageClaims',
      'canJudgeOwnerHere',
      'processStartFormHere',
      'namesMachineInClear',
    ],
  },
  {
    kind: 'the Wiki update marker and its claim',
    tests: ['claimWikiUpdateMarker', 'readLiveWikiUpdateMarker'],
  },
  {
    kind: 'the reader of Wiki metadata files',
    tests: ['readWikiRegularFile'],
  },
  {
    kind: 'the opener that refuses a link',
    tests: ['openWithoutFollowing', 'scripts/openWithoutFollowing'],
  },
  { kind: 'the file hash', tests: ['hashFileSha256'] },
  {
    kind: "the Cursor MCP catalog's opens and file ids",
    tests: ['refreshCursorMcpCatalogFileIdentity'],
  },
  {
    kind: 'the recovery that puts a moved file back',
    tests: ['dropSecondNameOfMovedFile'],
  },
  {
    kind: 'the process listing',
    tests: ['listProcesses', 'runBoundedQuery', 'runtime-profileProcesses'],
  },
  { kind: 'the removal walk', tests: ['removeWithoutFollowing'] },
  {
    kind: 'the folder listing',
    tests: ['listFolderTreeWithoutFollowing', 'isFolderOfItsOwn'],
  },
  {
    kind: 'the sweep of abandoned browser profiles',
    tests: ['removeAbandonedProfiles'],
  },
  {
    kind: 'the program check of the search for Git',
    tests: ['isProgramFile'],
  },
]

/**
 * Names a test source of the Windows job as {@link WINDOWS_JOB_TEST_KINDS} lists it; for the pin below.
 * @param {string} path - A source {@link testSourcesRunBy} answered.
 * @returns {string} `<name>` for `extension/src/tests/<name>.test.ts`; `scripts/<name>` for `extension/scripts/tests/<name>.test.mjs`.
 * @example
 * testNameInTheJob('extension/src/tests/withStorageLock.test.ts')               // => 'withStorageLock'
 * testNameInTheJob('extension/scripts/tests/openWithoutFollowing.test.mjs') // => 'scripts/openWithoutFollowing'
 */
function testNameInTheJob(path) {
  // A script test keeps the folder in its name: an extension test can have the same name.
  if (path.startsWith('extension/scripts/tests/'))
    return `scripts/${path.slice('extension/scripts/tests/'.length, -'.test.mjs'.length)}`
  return path.slice('extension/src/tests/'.length, -'.test.ts'.length)
}

// Value: protects=a maintainer who reads in the guide, or at the head of the workflow, what the Windows job tests, how it runs and which files its filter leaves out; fails_when=the job gains a test file of a kind neither document names, a kind they name has no test file in the job any more, the two documents name different kinds, or the guide states another way of running or other left-out files than the workflow has; why_new=Cycle 0046 row 237: the guide named three kinds and one left-out file while the job ran twenty-four files of ten kinds and left out two; seam=none
test('the test execution guide and the header of the Windows workflow name every kind of test the job runs, every test file of its run command belongs to a kind they name, and the guide states how the job runs and which two files its filter leaves out', async () => {
  // Arrange
  const guide = await repositoryText('docs/qa/test-execution.md')
  const workflow = await repositoryText(
    '.github/workflows/storage-locks-windows.yml',
  )

  // Act: the guide's section, the workflow's header comment as one text, the test files of the run command, and what the filter leaves out of what they load.
  const section =
    guide.split(/^## /m).find((part) => part.startsWith('The Windows job\n')) ??
    ''
  const header = workflow
    .slice(0, workflow.indexOf('\non:\n'))
    .split('\n')
    .filter((line) => line.startsWith('# '))
    .map((line) => line.slice('# '.length))
    .join(' ')
  const kindsSentence =
    /It runs the tests of (.+?)\.(?: |$)/m.exec(section)?.[1] ?? ''
  const kindsOfGuide = kindsSentence.split(/, of | and of /)
  const testsOfCommand = testSourcesRunBy(workflow).map(testNameInTheJob)
  const testsOfKinds = WINDOWS_JOB_TEST_KINDS.flatMap(({ tests }) => tests)
  const [pushFilter] = pathFiltersOf(workflow)
  const leftOutOfFilter = (
    await sourcesLoadedBy(testSourcesRunBy(workflow))
  ).filter((path) => !pushFilter.includes(path))

  // Assert: the kinds in both documents, in the same words; no file without a kind and no kind without a file.
  assert.equal(
    kindsSentence,
    "the storage lock and its owner's identity, of the Wiki update marker and its claim, of the reader of Wiki metadata files, of the opener that refuses a link, of the file hash, of the Cursor MCP catalog's opens and file ids, of the recovery that puts a moved file back, of the process listing, of the removal walk, of the folder listing, of the sweep of abandoned browser profiles and of the program check of the search for Git",
  )
  assert.deepEqual(
    kindsOfGuide,
    WINDOWS_JOB_TEST_KINDS.map(({ kind }) => kind),
  )
  assert.equal(
    header.includes(`This job runs the tests of ${kindsSentence}`),
    true,
    "the header of the workflow does not name the kinds of test in the guide's words",
  )
  assert.deepEqual(
    testsOfCommand.filter((name) => !testsOfKinds.includes(name)),
    [],
    'a test file of the run command belongs to no kind: add it to its kind in WINDOWS_JOB_TEST_KINDS, or name a new kind there, in the guide and in the header of the workflow',
  )
  assert.deepEqual(
    testsOfKinds.filter((name) => !testsOfCommand.includes(name)),
    [],
    'a test file listed under a kind is not in the run command',
  )
  // How the job runs, and what its filter leaves out, as the workflow has them.
  assert.equal(
    section.includes(
      'It runs one test file at a time (`--test-concurrency=1`): these tests start PowerShell and read real process starts, which the product bounds at 3 seconds, and with several files side by side such a read went past that bound on the runner.',
    ),
    true,
  )
  assert.equal(
    runCommandsOf(workflow)
      .filter((command) => command.startsWith('node --test '))
      .every((command) =>
        command.startsWith('node --test --test-concurrency=1 '),
      ),
    true,
  )
  assert.equal(
    section.includes(
      "The filter leaves out two files those tests load, `extension/src/constants.ts` and `extension/src/runtimeSupport/constants.ts`, because they change with most pull requests, although the first holds the lock's times, its path and its file modes.",
    ),
    true,
  )
  assert.deepEqual(leftOutOfFilter, [
    'extension/src/constants.ts',
    'extension/src/runtimeSupport/constants.ts',
  ])
})

// Value: protects=the Windows run of the storage lock tests after a change the path filter leaves out (extension/src/constants.ts holds the lock's grace time, its boot time tolerance, its path and its file modes; most pull requests change that file); fails_when=the job starts for the filtered paths only, so a pull request that changes when a lock is taken over never runs on Windows; why_new=Cycle 0045 local review other-1 #1; seam=none
test('the Windows job also runs once a week and for a new Node release, so a change the path filter leaves out is seen on Windows', async () => {
  // Arrange
  const workflow = await repositoryText(
    '.github/workflows/storage-locks-windows.yml',
  )

  // Act
  const lines = workflow.split('\n')
  const scheduleAt = lines.indexOf('  schedule:')
  const triggers = lines.filter((line) => /^ {2}\w+:$/.test(line))
  const [pushFilter, pullRequestFilter] = pathFiltersOf(workflow)

  // Assert
  assert.deepEqual(lines.slice(scheduleAt, scheduleAt + 2), [
    '  schedule:',
    "    - cron: '17 5 * * 1'",
  ])
  assert.deepEqual(triggers.slice(0, 4), [
    '  push:',
    '  pull_request:',
    '  schedule:',
    '  workflow_dispatch:',
  ])
  assert.equal(pushFilter.includes('.node-version'), true)
  assert.equal(pullRequestFilter.includes('.node-version'), true)
})

// Value: protects=the coverage report of a pull request, which Codecov posts only once every shard has uploaded; fails_when=a shard is added to the Test workflow and one of Codecov's two counts stays behind (the report then comes after the first shards and changes with every later upload), or a count is raised without its shard (the report never comes); why_new=the shard count went from twelve to fourteen in Cycle 0045 and nothing compared the three places; seam=none
test('the Test workflow has as many shards as Codecov waits for before it reports, in both of its settings', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/test.yml')
  const codecov = await repositoryText('codecov.yml')

  // Act
  const shards = /^ {8}shard: \[([\d, ]+)\]$/m.exec(workflow)?.[1].split(', ')
  const awaitedUploads = [
    ...codecov.matchAll(/^ *after_n_builds: (\d+)$/gm),
  ].map(([, count]) => count)

  // Assert
  assert.deepEqual(shards, [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '11',
    '12',
    '13',
    '14',
  ])
  assert.deepEqual(awaitedUploads, ['14', '14'])
})

// Value: protects=the result of every Test job, which must follow the tests and not a third-party upload; fails_when=the coverage upload step can fail the job (an outage of Codecov's download host then turns fourteen green test runs red and no pull request can merge); why_new=on 2026-10-05 cli.codecov.io refused every TLS handshake and all fourteen jobs failed in the upload with their tests green; seam=none
test('a coverage upload that fails does not fail a Test job whose tests passed', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/test.yml')

  // Act
  const uploadStep = /- name: Upload coverage to Codecov\n((?: {8}.*\n)+)/.exec(
    workflow,
  )?.[1]

  // Assert
  assert.equal(uploadStep?.includes('        continue-on-error: true\n'), true)
})

// Value: protects=the notice of a lasting coverage upload failure, which `continue-on-error` hides from the job's result; fails_when=the upload step has no id or the warning step does not read its outcome (a broken token then shows nothing anywhere); why_new=the upload was made non-fatal on 2026-10-05 and the delegated review asked for the failure to stay visible; seam=none
test('a coverage upload that fails leaves a warning in the Test job', async () => {
  // Arrange
  const workflow = await repositoryText('.github/workflows/test.yml')

  // Act
  const uploadStep = /- name: Upload coverage to Codecov\n((?: {8}.*\n)+)/.exec(
    workflow,
  )?.[1]
  const warningStep =
    /- name: Report a failed coverage upload\n((?: {8}.*\n)+)/.exec(
      workflow,
    )?.[1]

  // Assert
  assert.equal(uploadStep?.includes('        id: upload\n'), true)
  assert.equal(
    warningStep?.includes("        if: steps.upload.outcome == 'failure'\n"),
    true,
  )
  assert.equal(
    warningStep?.includes('::warning title=Coverage upload failed::'),
    true,
  )
})

// Value: protects=pnpm's one-day wait before it installs a newly published version, for every package of the extension's workspace (pnpm 11 and later wait 1440 minutes unless told otherwise); fails_when=pnpm-workspace.yaml exempts a package or a version from the wait (the fallow 3.34.1 upgrade left ten such entries) or shortens the wait below a day, also by a value that is no plain number; why_new=Cycle 0047 row 1 (row 1066 of Cycle 0046), row 243 (P2CR-2); seam=none; no_claim=that the lockfile installs (CI's frozen install shows it)
test('the extension workspace exempts no package from pnpm’s one-day wait for newly published versions and does not shorten that wait', async () => {
  // Arrange
  const workspace = await repositoryText('extension/pnpm-workspace.yaml')

  // Act
  const hasExemptions = /^minimumReleaseAgeExclude:/m.test(workspace)
  const waitText = /^minimumReleaseAge:(.*)$/m.exec(workspace)?.[1]
  // A present key holds a plain number of minutes, a comment allowed after it; quotes or other text do not count (Cycle 0047 row 243).
  const waitMinutes =
    waitText === undefined
      ? undefined
      : /^\s*(\d+)\s*(?:#.*)?$/.exec(waitText)?.[1]

  // Assert
  assert.equal(hasExemptions, false)
  assert.equal(
    waitText === undefined ||
      (waitMinutes !== undefined && Number(waitMinutes) >= 1440),
    true,
  )
})
