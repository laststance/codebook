import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runPackageCommand } from '../utils/runPackageCommand.mjs'

const extension = fileURLToPath(new URL('../../', import.meta.url))

/** A measured baseline with no allowance: the fixture sources start with no finding. */
const EMPTY_BASELINE =
  '{\n  "finding_counts": {},\n  "runtime_coverage_findings": [],\n  "target_keys": []\n}\n'

/** The fixture's compiler settings: the extension's layout (`src` compiled to `dist` with source maps). */
const FIXTURE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2023',
    module: 'Node16',
    moduleResolution: 'Node16',
    strict: true,
    sourceMap: true,
    skipLibCheck: true,
    types: ['node'],
    rootDir: 'src',
    outDir: 'dist',
  },
  include: ['src/**/*.ts'],
})

/** The fixture's Fallow settings: its own sources only, with tests outside health as in the extension. */
const FIXTURE_FALLOW_SETTINGS = JSON.stringify({
  entry: ['src/**/*.ts'],
  ignorePatterns: ['dist/**', 'scripts/**'],
  health: { ignore: ['src/tests/**'] },
})

/** A module and its test file: one passing test and one declared skip. */
const PASSING_SOURCES = {
  'src/amount.ts': `export function describeAmount(amount: number): string {
  return amount > 0 ? 'positive' : 'not positive'
}
`,
  'src/tests/amount.test.ts': `import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeAmount } from '../amount.js'

test('describes a positive amount', () => {
  assert.equal(describeAmount(3), 'positive')
})

test('reads a missing drive', { skip: 'no such drive on this host' }, () => {})
`,
}

/** Hashes text as the reference records its files. @example sha256('24.21.0\n') // => '73fb1b61…' */
function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/** Gives one function body 21 separate branches, one more than the cyclomatic limit of 20 allows. @example branchyBody() // => "  if (value === 1) return 'v1'\n…" */
function branchyBody() {
  return Array.from(
    { length: 21 },
    (_, index) => `  if (value === ${index + 1}) return 'v${index + 1}'`,
  ).join('\n')
}

/**
 * Writes a Git repository shaped like this one: `extension/` with package inputs, a copy of the checker and its helpers, the extension's installed tools, and a measured reference that matches the fixture's own settings and baseline.
 * @param context - The test context, which removes the fixture afterward.
 * @param files - Files relative to the repository that replace or extend the passing fixture, such as `extension/.c8rc.json`.
 * @returns `{ repository, root, temporary }`: the repository, its `extension` directory, and the empty directory the checker receives as its temporary directory.
 * @example
 * const fixture = await createFixture(context, { 'extension/src/extra.ts': 'export const extra = 1\n' })
 */
async function createFixture(context, files = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-health-fixture-'))
  // A Git fixture's removal can meet ENOTEMPTY for a moment on macOS (F561), so it is retried as Node allows.
  context.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  )
  const repository = join(directory, 'repository'),
    root = join(repository, 'extension'),
    temporary = join(directory, 'temporary')
  for (const part of ['src/tests', 'scripts', 'patches', 'skills'])
    await mkdir(join(root, part), { recursive: true })
  await mkdir(temporary)
  const sources = Object.entries(PASSING_SOURCES).map(([path, text]) => [
    `extension/${path}`,
    text,
  ])
  const written = {
    '.gitignore': '**/node_modules\n**/dist/\n**/.fallow/\n',
    '.node-version': await readFile(
      join(extension, '../.node-version'),
      'utf8',
    ),
    'extension/package.json': JSON.stringify({
      name: 'health-fixture',
      private: true,
      scripts: { build: 'tsc -p tsconfig.json' },
    }),
    'extension/pnpm-lock.yaml': 'fixture\n',
    'extension/pnpm-workspace.yaml': 'fixture\n',
    'extension/README.md': 'fixture\n',
    'extension/tsconfig.json': FIXTURE_TSCONFIG,
    'extension/.c8rc.json': await readFile(
      join(extension, '.c8rc.json'),
      'utf8',
    ),
    'extension/.fallowrc.json': FIXTURE_FALLOW_SETTINGS,
    'extension/fallow-health-measured-baseline.json': EMPTY_BASELINE,
    ...Object.fromEntries(sources),
    ...files,
  }
  for (const [path, text] of Object.entries(written)) {
    await mkdir(dirname(join(repository, path)), { recursive: true })
    await writeFile(join(repository, path), text)
  }
  await cp(
    join(extension, 'scripts/checkHealth.mjs'),
    join(root, 'scripts/checkHealth.mjs'),
  )
  await cp(join(extension, 'scripts/utils'), join(root, 'scripts/utils'), {
    recursive: true,
  })
  await symlink(
    join(extension, 'node_modules'),
    join(root, 'node_modules'),
    'junction',
  )
  await writeReference(repository, {})
  await runPackageCommand('git', ['init', '--quiet'], repository)
  await runPackageCommand('git', ['add', '.'], repository)
  await runPackageCommand(
    'git',
    [
      '-c',
      'user.name=Codebook Test',
      '-c',
      'user.email=codebook-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    repository,
  )
  return { repository, root, temporary }
}

/**
 * Writes the fixture's measured reference from its settings and baseline as they are now, with the producers of the extension's own reference and this Node.
 * @param repository - The fixture repository.
 * @param changes - Top-level fields that replace the matching reference, such as `{ mode: 'static' }`.
 * @example
 * await writeReference(fixture.repository, { producers: { …, fallow: '3.26.0' } })
 */
async function writeReference(repository, changes) {
  const recorded = JSON.parse(
    await readFile(join(extension, 'fallow-health-reference.json'), 'utf8'),
  )
  const textOf = (path) => readFile(join(repository, path), 'utf8')
  const reference = {
    mode: 'measured-istanbul',
    sourceRevision: 'fixture',
    baseline: {
      file: 'fallow-health-measured-baseline.json',
      sha256: sha256(
        await textOf('extension/fallow-health-measured-baseline.json'),
      ),
    },
    limits: { maxCyclomatic: 20, maxCognitive: 15, maxCrap: 30 },
    producers: { ...recorded.producers, node: process.versions.node },
    settings: {
      '.node-version': sha256(await textOf('.node-version')),
      'extension/.c8rc.json': sha256(await textOf('extension/.c8rc.json')),
      'extension/.fallowrc.json': sha256(
        await textOf('extension/.fallowrc.json'),
      ),
    },
    ...changes,
  }
  await writeFile(
    join(repository, 'extension/fallow-health-reference.json'),
    JSON.stringify(reference, null, 2),
  )
}

/**
 * Runs the fixture's copy of the checker as `pnpm health` would, with the fixture's empty directory as its temporary directory.
 * @param fixture - The fixture of {@link createFixture}.
 * @param arguments_ - The checker's command line.
 * @param environment - Variables that replace the inherited ones.
 * @returns `{ code, stdout, stderr }` once the checker has exited.
 * @example
 * await runChecker(fixture, ['--format', 'json']) // => { code: 1, stdout: '{"kind":"health",…}', stderr: '…' }
 */
function runChecker(fixture, arguments_ = [], environment = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== 'NODE_TEST_CONTEXT',
    ),
  )
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(fixture.root, 'scripts/checkHealth.mjs'), ...arguments_],
      {
        cwd: fixture.root,
        env: {
          ...inherited,
          TMPDIR: fixture.temporary,
          TMP: fixture.temporary,
          TEMP: fixture.temporary,
          ...environment,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** The line of the checker's stderr that starts with a prefix, or `undefined`. @example lineOf('a\nHealth refused: x\n', 'Health refused:') // => 'Health refused: x' */
function lineOf(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix))
}

/** The run directories the checker left in a temporary directory; the compiler's own `node-compile-cache` is not one. @example await runDirectoriesIn(fixture.temporary) // => [] */
async function runDirectoriesIn(temporary) {
  return (await readdir(temporary)).filter((name) =>
    name.startsWith('codebook-health-'),
  )
}

test('the measured gate keeps the pre-repair budget of revision 944c1342 at the 20/15/30 limits', async () => {
  // Arrange
  const reference = JSON.parse(
    await readFile(join(extension, 'fallow-health-reference.json'), 'utf8'),
  )
  const baseline = await readFile(
    join(extension, 'fallow-health-measured-baseline.json'),
    'utf8',
  )

  // Act
  const pinned = {
    mode: reference.mode,
    sourceRevision: reference.sourceRevision,
    baseline: reference.baseline,
    limits: reference.limits,
  }

  // Assert: a baseline taken again from later source, or looser limits, fail here.
  assert.deepEqual(pinned, {
    mode: 'measured-istanbul',
    sourceRevision: '944c134261e1b3904a97757e652aaf6fabfca2b5',
    baseline: {
      file: 'fallow-health-measured-baseline.json',
      sha256:
        'e74f7142ff36b0e72c2910c70b60ea46891e48d2644610b8b04b6ce86b4c9b00',
    },
    limits: { maxCyclomatic: 20, maxCognitive: 15, maxCrap: 30 },
  })
  assert.equal(
    sha256(baseline.replaceAll('\r\n', '\n')),
    'e74f7142ff36b0e72c2910c70b60ea46891e48d2644610b8b04b6ce86b4c9b00',
  )
})

test('a complete passing run reports health and discloses its skipped test', async (context) => {
  // Arrange
  const fixture = await createFixture(context)

  // Act
  const result = await runChecker(fixture)

  // Assert: no finding, the skip is named in the summary and the run's own directory is gone.
  assert.equal(result.code, 0, result.stderr)
  assert.equal(
    lineOf(result.stderr, 'Measured suite:'),
    'Measured suite: 2 tests in 1 files; 1 passed, 1 skipped, 0 todo. Coverage of 1 source files.',
  )
  assert.deepEqual(await runDirectoriesIn(fixture.temporary), [])
})

// Value: protects=a maintainer or CI job that reads the exit of `pnpm health` as the verdict of the current source; fails_when=the measured Fallow runs read or write Fallow's incremental cache in the checkout (`.fallow/`), so a graph cache left by earlier runs decides which functions tests reach and the CRAP estimates of unmatched functions (Cycle 0056 pt3's gate: 35 findings with a reused cache, 0 with a fresh graph, same source); why_new=Cycle 0056 pt3 gate; seam=the fixture checkout's `.fallow` folder after a passing run; no_claim=how Fallow's incremental cache goes stale
test("a measured run leaves no Fallow cache in the checkout, so an earlier run's cache never decides its verdict", async (context) => {
  // Arrange
  const fixture = await createFixture(context)

  // Act
  const result = await runChecker(fixture)

  // Assert: the run passed, and Fallow wrote no cache beside the sources (it read none either: `--no-cache` disables both).
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(
    (await readdir(fixture.root)).filter((name) => name === '.fallow'),
    [],
  )
})

test('a failing test refuses health instead of scoring the coverage of a failed run', async (context) => {
  // Arrange
  const fixture = await createFixture(context, {
    'extension/src/tests/amount.test.ts': `import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeAmount } from '../amount.js'

test('describes a positive amount', () => {
  assert.equal(describeAmount(3), 'negative')
})
`,
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: The suite failed (exit 1); a failed run measures no health.',
  )
  assert.equal(result.stdout, '')
  assert.deepEqual(await runDirectoriesIn(fixture.temporary), [])
})

test('a type error refuses health before any test runs', async (context) => {
  // Arrange
  const fixture = await createFixture(context, {
    'extension/src/amount.ts': `export function describeAmount(amount: number): string {
  return amount
}
`,
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: The typed build failed (exit 2); no coverage is measured for a source that does not build.',
  )
  assert.equal(lineOf(result.stderr, 'Measured suite:'), undefined)
})

test('a compiled test left by a removed source refuses the stale test inventory', async (context) => {
  // Arrange: the compiler never deletes the output of a test whose source is gone.
  const fixture = await createFixture(context)
  await mkdir(join(fixture.root, 'dist/tests'), { recursive: true })
  await writeFile(join(fixture.root, 'dist/tests/removed.test.js'), '')

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: The compiled tests are not the test sources: not compiled [], without a source [removed].',
  )
})

test('a test source the build leaves out refuses the partial test inventory', async (context) => {
  // Arrange
  const fixture = await createFixture(context, {
    'extension/tsconfig.json': JSON.stringify({
      ...JSON.parse(FIXTURE_TSCONFIG),
      exclude: ['src/tests/second.test.ts'],
    }),
    'extension/src/tests/second.test.ts': `import { test } from 'node:test'

test('is never compiled', () => {})
`,
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: The compiled tests are not the test sources: not compiled [second], without a source [].',
  )
})

test('a source edited while the suite runs refuses the mixed evidence', async (context) => {
  // Arrange: the test edits the source it was compiled from.
  const fixture = await createFixture(context, {
    'extension/src/tests/amount.test.ts': `import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { describeAmount } from '../amount.js'

test('describes a positive amount while its source changes', () => {
  appendFileSync(join(__dirname, '../../src/amount.ts'), '// edited\\n')
  assert.equal(describeAmount(3), 'positive')
})
`,
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: The inputs changed while the suite ran, so its coverage would mix two sources: extension/src/amount.ts.',
  )
})

test('a compiled file rewritten while the suite runs refuses the mixed evidence', async (context) => {
  // Arrange: the test rewrites the compiled module, as a rebuild in another terminal would.
  const fixture = await createFixture(context, {
    'extension/src/tests/amount.test.ts': `import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { describeAmount } from '../amount.js'

test('describes a positive amount while its output is rebuilt', () => {
  appendFileSync(join(__dirname, '../amount.js'), '// rebuilt\\n')
  assert.equal(describeAmount(3), 'positive')
})
`,
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: The inputs changed while the suite ran, so its coverage would mix two sources: extension/dist/amount.js.',
  )
})

test('a coverage configuration that drops a source file refuses the coverage map', async (context) => {
  // Arrange
  const fixture = await createFixture(context, {
    'extension/.c8rc.json': JSON.stringify({
      include: ['src/**'],
      exclude: ['src/tests/**', 'src/extra.ts'],
      excludeAfterRemap: true,
      reporter: ['lcov', 'text-summary'],
      reportsDirectory: 'coverage',
    }),
    'extension/src/extra.ts': 'export const extra = 1\n',
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    "Health refused: The coverage map is not this source's: outside the measured sources [], without a record [extension/src/extra.ts].",
  )
})

test('a coverage configuration that measures files outside src refuses the coverage map', async (context) => {
  // Arrange
  const fixture = await createFixture(context, {
    'extension/.c8rc.json': JSON.stringify({
      include: ['src/**', 'scripts/**'],
      exclude: ['src/tests/**'],
      excludeAfterRemap: true,
      reporter: ['lcov', 'text-summary'],
      reportsDirectory: 'coverage',
    }),
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.match(
    lineOf(result.stderr, 'Health refused:'),
    /^Health refused: The coverage map is not this source's: outside the measured sources \[extension\/scripts\/checkHealth\.mjs, .+\], without a record \[\]\.$/,
  )
})

test('a health setting that skips a measured file refuses a report scored partly by estimates', async (context) => {
  // Arrange: c8 measures src/extra.ts, but Fallow never analyzes it, so that coverage would go unused.
  const fixture = await createFixture(context, {
    'extension/.fallowrc.json': JSON.stringify({
      ...JSON.parse(FIXTURE_FALLOW_SETTINGS),
      ignorePatterns: ['dist/**', 'scripts/**', 'src/extra.ts'],
    }),
    'extension/src/extra.ts': 'export const extra = 1\n',
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    "Health refused: Fallow scored 1 of 2 measured files with this run's coverage (model istanbul); the others would fall back to estimates.",
  )
})

test('an executed anonymous callback keeps its estimate and an unexecuted function scores no coverage', async (context) => {
  // Arrange: three functions over the cyclomatic limit; the test runs every branch of the first two.
  const fixture = await createFixture(context, {
    'extension/src/letters.ts': `export function namedLetter(value: number): string {
${branchyBody()}
  return 'none'
}

export function lettersOf(values: number[]): string[] {
  return values.map((value) => {
${branchyBody()}
    return 'none'
  })
}

export function unusedLetter(value: number): string {
${branchyBody()}
  return 'none'
}
`,
    'extension/src/tests/letters.test.ts': `import assert from 'node:assert/strict'
import { test } from 'node:test'

import { lettersOf, namedLetter } from '../letters.js'

const values = Array.from({ length: 22 }, (_, index) => index)

test('names every letter', () => {
  assert.deepEqual(values.map(namedLetter), lettersOf(values))
})
`,
  })

  // Act
  const result = await runChecker(fixture, ['--format', 'json'])

  // Assert: the executed named function is measured (CRAP 22, under the limit, so only its complexity is reported);
  // the executed callback has no coverage record and keeps Fallow's conservative estimate; the unexecuted one scores 0%.
  assert.equal(result.code, 1, result.stderr)
  const findings = JSON.parse(result.stdout).findings.map((finding) => ({
    name: finding.name,
    line: finding.line,
    exceeded: finding.exceeded,
    crap: finding.crap,
    source: finding.coverage_source,
    percent: finding.coverage_pct,
  }))
  assert.deepEqual(findings, [
    {
      name: 'namedLetter',
      line: 1,
      exceeded: 'both',
      crap: undefined,
      source: undefined,
      percent: undefined,
    },
    {
      name: '<arrow>',
      line: 27,
      exceeded: 'all',
      crap: 506,
      source: 'estimated',
      percent: undefined,
    },
    {
      name: 'unusedLetter',
      line: 53,
      exceeded: 'all',
      crap: 506,
      source: 'istanbul',
      percent: 0,
    },
  ])
})

test('findings beyond the measured baseline fail health and leave the baseline unchanged', async (context) => {
  // Arrange
  const fixture = await createFixture(context, {
    'extension/src/letters.ts': `export function namedLetter(value: number): string {
${branchyBody()}
  return 'none'
}
`,
    'extension/src/tests/letters.test.ts': `import assert from 'node:assert/strict'
import { test } from 'node:test'

import { namedLetter } from '../letters.js'

test('names the first letter', () => {
  assert.equal(namedLetter(1), 'v1')
})
`,
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 1, result.stderr)
  assert.match(result.stdout, /namedLetter/)
  assert.equal(
    await readFile(
      join(fixture.root, 'fallow-health-measured-baseline.json'),
      'utf8',
    ),
    EMPTY_BASELINE,
  )
})

/**
 * Writes a module for `NODE_OPTIONS=--import=…` that ends the Fallow run showing the human report at once, before Fallow reads anything; every other process it loads into (the build, the suite, the checked JSON run) goes on.
 * @param fixture - The fixture of {@link createFixture}; the module goes beside its repository.
 * @param ending - The module's last statement, such as `process.exit(3)`.
 * @returns The `NODE_OPTIONS` value that loads the module.
 * @example
 * await endShownReportWith(fixture, "process.kill(process.pid, 'SIGKILL')") // => '--import=file:///tmp/codebook-health-fixture-x1/end-shown-report.mjs'
 */
async function endShownReportWith(fixture, ending) {
  const path = join(dirname(fixture.repository), 'end-shown-report.mjs')
  await writeFile(
    path,
    `const [, script, ...options] = process.argv
if (/[\\\\/]fallow[\\\\/]bin[\\\\/]fallow$/.test(script ?? '') && options[options.indexOf('--format') + 1] === 'human') ${ending}
`,
  )
  return `--import=${pathToFileURL(path).href}`
}

// Value: protects=a maintainer or CI job that reads the exit of `pnpm health` as its verdict; fails_when=the Fallow run that shows the human report is killed by a signal and the checker exits 0, a pass with no report and no checked verdict; why_new=OCR8-3; seam=a module in NODE_OPTIONS that kills that one Fallow run; no_claim=why a real Fallow run would be killed
test(
  'a human report that a signal ends refuses health instead of passing with no verdict',
  {
    skip:
      process.platform === 'win32' &&
      'Windows ends a killed process with an exit code, not a signal',
  },
  async (context) => {
    // Arrange
    const fixture = await createFixture(context)
    const killing = await endShownReportWith(
      fixture,
      "process.kill(process.pid, 'SIGKILL')",
    )

    // Act
    const result = await runChecker(fixture, [], { NODE_OPTIONS: killing })

    // Assert: the checked JSON run passed, but the shown run gave no report, so there is no verdict.
    assert.equal(result.code, 2, result.stderr)
    assert.equal(
      lineOf(result.stderr, 'Health refused:'),
      "Health refused: Fallow's human report ended with signal SIGKILL; its checked JSON run ended with exit 0.",
    )
    assert.equal(result.stdout, '')
    assert.deepEqual(await runDirectoriesIn(fixture.temporary), [])
  },
)

// Value: protects=a maintainer or CI job that reads the exit of `pnpm health` as its verdict; fails_when=the Fallow run that shows the human report crashes with an exit code other than 0 or 1 and the checker passes that code on as if Fallow had given a verdict; why_new=OCR8-3; seam=a module in NODE_OPTIONS that ends that one Fallow run with exit 3; no_claim=which exit codes a real Fallow crash uses
test('a human report that ends with an unexpected exit code refuses health instead of passing the code on', async (context) => {
  // Arrange
  const fixture = await createFixture(context)
  const crashing = await endShownReportWith(fixture, 'process.exit(3)')

  // Act
  const result = await runChecker(fixture, [], { NODE_OPTIONS: crashing })

  // Assert
  assert.equal(result.code, 2, result.stderr)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    "Health refused: Fallow's human report ended with exit 3; its checked JSON run ended with exit 0.",
  )
  assert.equal(result.stdout, '')
})

test('a setting changed after the baseline was taken refuses health', async (context) => {
  // Arrange
  const fixture = await createFixture(context)
  await writeFile(
    join(fixture.root, '.fallowrc.json'),
    JSON.stringify({ ...JSON.parse(FIXTURE_FALLOW_SETTINGS), entry: [] }),
  )

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.match(
    lineOf(result.stderr, 'Health refused:'),
    /^Health refused: The settings differ from the reference: extension\/\.fallowrc\.json is [0-9a-f]{64} here, [0-9a-f]{64} in the reference\.$/,
  )
})

test('a baseline whose bytes differ from its reference refuses health', async (context) => {
  // Arrange
  const fixture = await createFixture(context)
  await writeFile(
    join(fixture.root, 'fallow-health-measured-baseline.json'),
    EMPTY_BASELINE.replace(
      '{}',
      '{ "src/amount.ts": { "crap_high": { "count": 1 } } }',
    ),
  )

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.match(
    lineOf(result.stderr, 'Health refused:'),
    /^Health refused: fallow-health-measured-baseline\.json is not the baseline fallow-health-reference\.json names: its sha256 is [0-9a-f]{64}, the reference's [0-9a-f]{64}\.$/,
  )
})

test('a producer version the baseline was not measured with refuses health', async (context) => {
  // Arrange
  const fixture = await createFixture(context)
  const { producers } = JSON.parse(
    await readFile(join(fixture.root, 'fallow-health-reference.json'), 'utf8'),
  )
  await writeReference(fixture.repository, {
    producers: { ...producers, fallow: '3.26.0' },
  })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.match(
    lineOf(result.stderr, 'Health refused:'),
    /^Health refused: The producers differ from the reference: fallow is \d+\.\d+\.\d+ here, 3\.26\.0 in the reference\.$/,
  )
})

test('a reference of another measurement refuses health', async (context) => {
  // Arrange
  const fixture = await createFixture(context)
  await writeReference(fixture.repository, { mode: 'static' })

  // Act
  const result = await runChecker(fixture)

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: fallow-health-reference.json is no measured-istanbul reference (its mode is static).',
  )
})

test('an option that would replace the evidence of the run is refused before the build', async (context) => {
  // Arrange
  const fixture = await createFixture(context)

  // Act
  const saving = await runChecker(fixture, ['--save-baseline', 'new.json'])
  const reusing = await runChecker(fixture, ['--coverage', 'old.json'])

  // Assert: neither run built anything or wrote a baseline.
  assert.equal(saving.code, 2)
  assert.match(
    lineOf(saving.stderr, 'Health refused:'),
    /^Health refused: Unknown option '--save-baseline'/,
  )
  assert.equal(reusing.code, 2)
  assert.match(
    lineOf(reusing.stderr, 'Health refused:'),
    /^Health refused: Unknown option '--coverage'/,
  )
  await assert.rejects(stat(join(fixture.root, 'dist')), { code: 'ENOENT' })
  await assert.rejects(stat(join(fixture.root, 'new.json')), { code: 'ENOENT' })
})

test('a test runner filter in NODE_OPTIONS is refused before the build', async (context) => {
  // Arrange
  const fixture = await createFixture(context)

  // Act
  const result = await runChecker(fixture, [], {
    NODE_OPTIONS: '--test-name-pattern=positive',
  })

  // Assert
  assert.equal(result.code, 2)
  assert.equal(
    lineOf(result.stderr, 'Health refused:'),
    'Health refused: NODE_OPTIONS holds a test runner option (--test-name-pattern=positive); the measured suite runs every test, unfiltered.',
  )
  await assert.rejects(stat(join(fixture.root, 'dist')), { code: 'ENOENT' })
})
