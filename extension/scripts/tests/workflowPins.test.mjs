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
 * Lists the files a TypeScript source loads by a relative path, in every form the extension's sources and tests use, so the closure of a test file leaves none of them out.
 *
 * The forms: `from '…'` (also of `import type` and of `export`), a side-effect `import '…'`, `import('…')`, `require('…')`, and a compiled module named from `__dirname` (`loadModule(resolve(__dirname, '../x.js'), …)`, `join(__dirname, 'utils', 'x.js')`). A `__dirname` path that is no `.js` module (a document, a manifest, a folder) is data the test reads and is not listed. A package or a Node module is not part of a path filter.
 *
 * A comment is not read ({@link withoutComments}): an import that a docstring's example quotes loads nothing, and would widen a path filter unseen. A string is read like code, because a test can hand a process its script as text; a quoted import there widens the filter, or fails the pin by name when it names no file.
 *
 * @param source - The source's text.
 * @returns The paths as written, relative to the source's folder: the specifiers first, then the compiled modules.
 * @example
 * loadedPathsOf("import './setup'\nconst lock = require('../utils/lock') // not require('../utils/old')\n") // => ['./setup', '../utils/lock']
 */
function loadedPathsOf(source) {
  const code = withoutComments(source)
  const relativePath = `['"](\\.{1,2}/[^'"]+)['"]`
  const specifiers = [
    new RegExp(`\\bfrom\\s*${relativePath}`, 'g'),
    new RegExp(`\\bimport\\s*${relativePath}`, 'g'),
    new RegExp(`\\b(?:import|require)\\(\\s*${relativePath}`, 'g'),
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
 * @throws When a loaded path names no file ({@link sourceNamedBy}).
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
    // Only a TypeScript source loads further files; a manifest or a script it reads ends the walk.
    if (!path.endsWith('.ts')) continue
    for (const loadedPath of loadedPathsOf(await repositoryText(path, root)))
      waiting.push(await sourceNamedBy(path, loadedPath, root))
  }
  return [...loaded].toSorted()
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
  const sessionOf = (script) => /\bsession = `([^`]+)`/.exec(script)?.[1]

  // Assert
  assert.deepEqual(checks, [
    'node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom',
    'node extension/scripts/wiki-reader-dom-qa.mjs verify artifacts/wiki-reader-dom',
  ])
  assert.deepEqual(stepLines(workflow, 'Run the Wiki reader DOM cases'), [
    '- name: Run the Wiki reader DOM cases',
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
    'if-no-files-found: ignore',
  ])
  assert.deepEqual(
    { wiki: sessionOf(wikiCheck), study: sessionOf(studyCheck) },
    { wiki: 'cb-wiki-reader-${mode}', study: 'cb-bootstrap-${mode}' },
  )
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

test('the Windows storage lock job runs the lock test files on windows-latest and starts for every lock source those tests load', async () => {
  // Arrange
  const workflow = await repositoryText(
    '.github/workflows/storage-locks-windows.yml',
  )

  // Act
  const [pushFilter, pullRequestFilter, ...otherFilters] =
    pathFiltersOf(workflow)
  const loadedSources = await sourcesLoadedBy([
    'extension/src/tests/withStorageLock.test.ts',
    'extension/src/tests/isProcessGone.test.ts',
    'extension/src/tests/currentStorageOwner.test.ts',
    'extension/src/tests/isFromEarlierBoot.test.ts',
    'extension/src/tests/isSameStorageMachine.test.ts',
    'extension/src/tests/readBootIdentity.test.ts',
    'extension/src/tests/readProcessStart.test.ts',
    'extension/src/tests/isRecordedOwnerGone.test.ts',
    'extension/src/tests/readRecordedOwner.test.ts',
    'extension/src/tests/removeStaleStorageClaims.test.ts',
    'extension/src/tests/removeStaleStorageLock.test.ts',
    'extension/src/tests/canJudgeOwnerHere.test.ts',
    'extension/src/tests/claimWikiUpdateMarker.test.ts',
    'extension/src/tests/readLiveWikiUpdateMarker.test.ts',
    'extension/src/tests/processStartFormHere.test.ts',
    'extension/src/tests/namesMachineInClear.test.ts',
    'extension/src/tests/readWikiRegularFile.test.ts',
  ])
  const actionReferences = workflow
    .split('\n')
    .map((line) => line.trim().replace(/^- /, ''))
    .filter((line) => line.startsWith('uses: '))
  const settings = workflow.split('\n').map((line) => line.trim())
  const filterKeys = workflow
    .split('\n')
    .filter((line) => line.trim().startsWith('paths:'))

  // Assert: both triggers have one filter, the workflow itself, the Node release and every source the seventeen test files
  // load; only the two constants files, which most pull requests change, are left out.
  assert.deepEqual(pushFilter, [
    '.github/workflows/storage-locks-windows.yml',
    '.node-version',
    'extension/src/runtimeSupport/utils/sha256.ts',
    'extension/src/tests/canJudgeOwnerHere.test.ts',
    'extension/src/tests/claimWikiUpdateMarker.test.ts',
    'extension/src/tests/currentStorageOwner.test.ts',
    'extension/src/tests/isFromEarlierBoot.test.ts',
    'extension/src/tests/isProcessGone.test.ts',
    'extension/src/tests/isRecordedOwnerGone.test.ts',
    'extension/src/tests/isSameStorageMachine.test.ts',
    'extension/src/tests/namesMachineInClear.test.ts',
    'extension/src/tests/processStartFormHere.test.ts',
    'extension/src/tests/readBootIdentity.test.ts',
    'extension/src/tests/readLiveWikiUpdateMarker.test.ts',
    'extension/src/tests/readProcessStart.test.ts',
    'extension/src/tests/readRecordedOwner.test.ts',
    'extension/src/tests/readWikiRegularFile.test.ts',
    'extension/src/tests/removeStaleStorageClaims.test.ts',
    'extension/src/tests/removeStaleStorageLock.test.ts',
    'extension/src/tests/utils/answerKernelBootId.ts',
    'extension/src/tests/utils/idOfNoProcess.ts',
    'extension/src/tests/utils/idleChild.ts',
    'extension/src/tests/utils/loadModule.ts',
    'extension/src/tests/utils/startOfKilledWindow.ts',
    'extension/src/tests/withStorageLock.test.ts',
    'extension/src/utils/canJudgeOwnerHere.ts',
    'extension/src/utils/claimStorageLockTakeover.ts',
    'extension/src/utils/claimWikiUpdateMarker.ts',
    'extension/src/utils/currentStorageOwner.ts',
    'extension/src/utils/deriveMachineKeys.ts',
    'extension/src/utils/isFromEarlierBoot.ts',
    'extension/src/utils/isLeftEmpty.ts',
    'extension/src/utils/isProcessGone.ts',
    'extension/src/utils/isRecordedOwnerGone.ts',
    'extension/src/utils/isSameStorageMachine.ts',
    'extension/src/utils/isStaleStorageLock.ts',
    'extension/src/utils/listPlacedClaims.ts',
    'extension/src/utils/namesMachineInClear.ts',
    'extension/src/utils/placeStorageLock.ts',
    'extension/src/utils/processStartFormHere.ts',
    'extension/src/utils/readBootIdentity.ts',
    'extension/src/utils/readLiveWikiUpdateMarker.ts',
    'extension/src/utils/readProcessStart.ts',
    'extension/src/utils/readRecordedOwner.ts',
    'extension/src/utils/readWikiRegularFile.ts',
    'extension/src/utils/removeStaleStorageClaims.ts',
    'extension/src/utils/removeStaleStorageLock.ts',
    'extension/src/utils/systemErrorCode.ts',
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
  assert.equal(settings.includes('name: Storage lock tests on Windows'), true)
  assert.deepEqual(runCommandsOf(workflow), [
    'git config --global core.autocrlf false',
    'node scripts/build-fast.mjs',
    'node --test dist/tests/withStorageLock.test.js dist/tests/isProcessGone.test.js dist/tests/currentStorageOwner.test.js dist/tests/isFromEarlierBoot.test.js dist/tests/isSameStorageMachine.test.js dist/tests/readBootIdentity.test.js dist/tests/readProcessStart.test.js dist/tests/isRecordedOwnerGone.test.js dist/tests/readRecordedOwner.test.js dist/tests/removeStaleStorageLock.test.js dist/tests/removeStaleStorageClaims.test.js dist/tests/canJudgeOwnerHere.test.js dist/tests/claimWikiUpdateMarker.test.js dist/tests/readLiveWikiUpdateMarker.test.js dist/tests/processStartFormHere.test.js dist/tests/namesMachineInClear.test.js dist/tests/readWikiRegularFile.test.js',
  ])
  assert.deepEqual(actionReferences, [
    'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    'uses: ./.github/actions/prepare',
  ])
})

// Review of Cycle 0045 (tests-1 #11): the pin knew npm, npx and pnpm only, so a job that added a tool with yarn, pip, corepack or a piped download stayed green.
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

// Value: protects=the Windows run of the storage lock tests after a change the path filter leaves out (extension/src/constants.ts holds the lock's grace time, its boot time tolerance, its path and its file modes; most pull requests change that file); fails_when=the job starts for the filtered paths only, so a pull request that changes when a lock is taken over never runs on Windows; why_new=Cycle 0045 local review other-1 #1; seam=none
test('the Windows storage lock job also runs once a week and for a new Node release, so a change the path filter leaves out is seen on Windows', async () => {
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
