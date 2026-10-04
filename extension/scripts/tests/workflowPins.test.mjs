import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Reads one file of the repository as text, for the pins below that compare workflow and manifest content.
 * @param path - The file's path from the repository root.
 * @returns The file's text.
 * @example
 * await repositoryText('.node-version') // => '24.21.0\n'
 */
function repositoryText(path) {
  return readFile(join(repositoryRoot, path), 'utf8')
}

/**
 * Reads every workflow and every composite action of the repository, so a pin also holds for a job added later.
 * @returns One entry per file: its path from the repository root and its text.
 * @example
 * await ciDefinitions() // => [{ path: '.github/actions/prepare/action.yml', text: 'name: Prepare…' }, …]
 */
async function ciDefinitions() {
  const workflows = (await readdir(join(repositoryRoot, '.github/workflows')))
    .filter((name) => name.endsWith('.yml'))
    .map((name) => `.github/workflows/${name}`)
  const actions = (await readdir(join(repositoryRoot, '.github/actions'))).map(
    (name) => `.github/actions/${name}/action.yml`,
  )
  return Promise.all(
    [...actions, ...workflows].map(async (path) => ({
      path,
      text: await repositoryText(path),
    })),
  )
}

/**
 * Lists the shell commands a workflow runs, one per line of every `run` key, so a pin reads commands and never comments.
 * @param definition - The text of a workflow or of a composite action.
 * @returns The trimmed command lines in file order; empty when the file runs no command.
 * @example
 * runCommandsOf('      - run: |\n          npm ci\n          node check.mjs\n') // => ['npm ci', 'node check.mjs']
 */
function runCommandsOf(definition) {
  const lines = definition.split('\n'),
    commands = []
  for (let index = 0; index < lines.length; index += 1) {
    const run = /^(\s*(?:- )?)run:\s*(.*)$/.exec(lines[index])
    if (!run) continue
    const [, lead, inline] = run
    // A command on the key's own line is the whole step.
    if (!/^[|>][+-]?$/.test(inline)) {
      commands.push(inline)
      continue
    }
    // A block: its lines are indented deeper than the `run` key and end at the next key or step.
    while (
      index + 1 < lines.length &&
      (lines[index + 1].trim() === '' ||
        lines[index + 1].search(/\S/) > lead.length)
    ) {
      index += 1
      if (lines[index].trim() !== '') commands.push(lines[index].trim())
    }
  }
  return commands
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

test('the reader DOM workflow installs no tool by version alone and writes the build metadata once', async () => {
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
      .filter((command) =>
        /\bnpm (?:install|i|exec)\b|\bnpx\b|\bpnpm (?:add|dlx)\b/.test(command),
      )
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

  // Assert: the key carries the release the tool manifest pins, and the restore comes before the download it saves.
  assert.equal(restoreName, '- name: Restore the video encoder')
  assert.match(
    restoreAction ?? '',
    /^uses: actions\/cache@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
  )
  assert.deepEqual(restoreInputs, [
    'with:',
    'path: ~/.cache/ms-playwright',
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
