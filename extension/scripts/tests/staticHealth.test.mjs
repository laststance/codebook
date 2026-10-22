import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const extension = fileURLToPath(new URL('../..', import.meta.url))
const fallow = join(extension, 'node_modules/.bin/fallow')
const manifest = JSON.parse(
  await readFile(join(extension, 'package.json'), 'utf8'),
)

/**
 * Returns Fallow's arguments from the package's `health:static` script, so each test runs the command `pnpm health:static` runs.
 *
 * Why: the tests pin the script's behavior, not a copy of its flags.
 *
 * @returns The arguments after `fallow`.
 * @example
 * staticHealthArguments() // => ['health', '--complexity', '--max-crap', 'inf', …]
 */
function staticHealthArguments() {
  const [command, ...arguments_] = manifest.scripts['health:static'].split(' ')
  assert.equal(command, 'fallow')
  return arguments_
}

/**
 * Writes a one-file TypeScript project that Fallow analyzes, with the given source as `src/index.ts`.
 *
 * Why: a fixture keeps the tests independent of the repository's own findings and baseline.
 *
 * @param root - An empty temporary directory.
 * @param source - The module's text.
 * @example
 * await writeProject(root, 'export const one = 1\n')
 */
async function writeProject(root, source) {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'static-health-fixture',
      private: true,
      type: 'module',
    }),
  )
  await writeFile(
    join(root, '.fallowrc.json'),
    JSON.stringify({ entry: ['src/index.ts'] }),
  )
  await writeFile(join(root, 'src/index.ts'), source)
}

/**
 * Saves the fixture's baseline the way AGENTS.md says to re-save `fallow-health-baseline.json`.
 *
 * Fallow writes the baseline and still exits 1 while the saved findings exist, so the file, not the exit code, proves the save.
 *
 * @param root - The fixture project.
 * @example
 * await saveBaseline(root)
 */
async function saveBaseline(root) {
  const saved = spawnSync(
    fallow,
    [
      'health',
      '--complexity',
      '--max-crap',
      'inf',
      '--baseline-mode',
      'identity',
      '--save-baseline',
      'fallow-health-baseline.json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  // 0 without findings, 1 with the findings it saved; anything else is a failed save.
  assert.ok([0, 1].includes(saved.status), saved.stderr)
  const baseline = JSON.parse(
    await readFile(join(root, 'fallow-health-baseline.json'), 'utf8'),
  )
  assert.equal(baseline.kind, 'health')
}

/**
 * Returns a function whose 22 branches put its cyclomatic complexity above the limit of 20.
 *
 * @param name - The function's name.
 * @returns TypeScript source.
 * @example
 * branchedFunction('classify') // => 'export function classify(value: number): string {…'
 */
function branchedFunction(name) {
  const branches = Array.from(
    { length: 22 },
    (_, index) => `  if (value === ${index}) return 'case ${index}'\n`,
  ).join('')
  return `export function ${name}(value: number): string {\n${branches}  return 'other'\n}\n`
}

const BASE_SOURCE =
  'export function identity(value: number): number {\n  return value\n}\n'

// Value: protects=the fast pre-check of Issue #92: a function above the measured gate's complexity limits fails within seconds, before the test step; fails_when=health:static stops reading complexity, or its baseline matches per file count so a new over-limit function hides behind an old one; why_new=Issue #92; seam=a one-file fixture project; no_claim=the measured gate's CRAP, which needs coverage
test('the static health check refuses a new function above the complexity limits, also where it replaces an old one', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-static-health-'))
  try {
    await writeProject(root, BASE_SOURCE + branchedFunction('legacy'))
    await saveBaseline(root)
    await writeProject(root, BASE_SOURCE + branchedFunction('classify'))

    // Act
    const checked = spawnSync(fallow, staticHealthArguments(), {
      cwd: root,
      encoding: 'utf8',
    })

    // Assert
    assert.equal(checked.status, 1)
    assert.match(checked.stdout + checked.stderr, /classify/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the pre-check's agreement with the measured gate on what it leaves out; fails_when=health:static scores CRAP from estimated coverage, so a tested, moderately branched function fails the pre-check that the measured gate passes; why_new=Issue #92 (the old static check failed a clean main with 667 findings, 560 of them estimated CRAP); seam=a one-file fixture project; no_claim=whether the function's real coverage keeps it under CRAP 30
test('the static health check passes a moderately branched function that only an estimated CRAP would flag', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-static-health-'))
  try {
    await writeProject(root, BASE_SOURCE)
    await saveBaseline(root)
    const moderate =
      'export function grade(score: number): string {\n' +
      "  if (score > 90) return 'A'\n" +
      "  if (score > 80) return 'B'\n" +
      "  if (score > 70) return 'C'\n" +
      "  if (score > 60) return 'D'\n" +
      "  if (score > 50) return 'E'\n" +
      "  if (score > 40) return 'F'\n" +
      "  return 'G'\n" +
      '}\n'
    await writeProject(root, BASE_SOURCE + moderate)

    // Act
    const checked = spawnSync(fallow, staticHealthArguments(), {
      cwd: root,
      encoding: 'utf8',
    })

    // Assert
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the order of the full gate, so a complexity failure stops it before five minutes of tests; fails_when=health:static leaves check or moves after the test step; why_new=Issue #92 (6 of 12 failed gates stopped at the last step); seam=the package manifest; no_claim=the steps' own results
test('the full gate runs the static health check after lint and before the tests', () => {
  // Arrange
  const steps = manifest.scripts.check.split(' && ')

  // Act
  const firstSteps = steps.slice(0, 5)

  // Assert
  assert.deepEqual(firstSteps, [
    'pnpm format:check',
    'pnpm typecheck',
    'pnpm lint',
    'pnpm health:static',
    'pnpm test',
  ])
  assert.equal(steps.at(-1), 'pnpm health')
})

// Value: protects=the commit-time lint of Issue #92 and its order after formatting; fails_when=staged TypeScript is no longer linted, or Prettier and ESLint run as two concurrent glob tasks on the same file; why_new=Issue #92; seam=the package manifest; no_claim=ESLint's rules, which pnpm lint pins
test('a commit formats staged TypeScript and then lints it with ESLint, in one sequence', () => {
  // Arrange
  const tasks = manifest['lint-staged']

  // Act
  const typeScriptTasks = tasks['*.ts']

  // Assert
  assert.deepEqual(typeScriptTasks, [
    'prettier --ignore-unknown --write --ignore-path ../.gitignore --ignore-path ../.prettierignore',
    'eslint --cache --no-warn-ignored --max-warnings=0',
  ])
  assert.equal(
    tasks['!(*.ts)'],
    'prettier --ignore-unknown --write --ignore-path ../.gitignore --ignore-path ../.prettierignore',
  )
  assert.equal(tasks['*'], undefined)
})
