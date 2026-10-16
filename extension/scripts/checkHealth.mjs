// Runs the measured health gate behind `pnpm health`: a fresh typed build, every compiled extension test once under the
// pinned c8, then the pinned Fallow health scored with that run's Istanbul coverage against the measured baseline of the
// pre-repair revision that fallow-health-reference.json names.
//
//   node scripts/checkHealth.mjs                 Fallow's human report on stdout
//   node scripts/checkHealth.mjs --format json   Fallow's JSON report on stdout
//
// Exit 0: no finding beyond the baseline. Exit 1: Fallow's findings. Exit 2: refused, with no health verdict, because the
// evidence is missing, stale, mixed, failed or partial, or a producer or setting differs from the reference. The build,
// the suite and this script's own lines go to stderr. No baseline is ever written; `pnpm health:static` keeps the old
// static comparison against fallow-health-baseline.json.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { readBuildIdentity } from './utils/readBuildIdentity.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const repository = join(extension, '..')
const requireFromExtension = createRequire(join(extension, 'package.json'))

/** The record that names the measured baseline and the revision, producers, settings and limits it was taken with. */
const REFERENCE_FILE = 'fallow-health-reference.json'
/** The one measurement this checker makes and compares: complete c8 coverage, read by Fallow as Istanbul data. */
const MEASUREMENT_MODE = 'measured-istanbul'
/** Fields of the reference the checker reads, as dotted paths; the entries of `producers` and `settings` are compared one by one. */
const REFERENCE_FIELDS = [
  'mode',
  'sourceRevision',
  'baseline.file',
  'baseline.sha256',
  'limits.maxCyclomatic',
  'limits.maxCognitive',
  'limits.maxCrap',
  'producers',
  'settings',
]
/** Files whose bytes decide what the measured baseline means, relative to the repository. */
const SETTING_FILES = [
  '.node-version',
  'extension/.c8rc.json',
  'extension/.fallowrc.json',
]
/** Exit code of a refused run, which gives no health verdict. */
const REFUSED_EXIT_CODE = 2
/** Names of the source files c8 measures (its default extensions; a `.d.ts` file counts). */
const MEASURED_SOURCE_NAME = /\.(?:[cm]?[jt]s|[jt]sx)$/
/** One count of the summary that Node's TAP reporter ends a run with. */
const TAP_SUMMARY_LINE = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm
/** How many names a refusal lists before "and N more". */
const SHOWN_NAME_LIMIT = 5

/** Hashes a text file with CRLF read as LF, so a Windows checkout names the same bytes as the reference. @example await hashText('/repo/.node-version') // => '73fb1b61…' */
async function hashText(path) {
  const text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
  return createHash('sha256').update(text).digest('hex')
}

/** Reads a JSON file and names the file when its text is no JSON. @example await readJson('/repo/extension/fallow-health-reference.json') // => { mode: 'measured-istanbul', … } */
async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `${relative(repository, path)} is no JSON: ${error.message}`,
    )
  }
}

/** Lists at most {@link SHOWN_NAME_LIMIT} names for a refusal. @example shown(['a', 'b']) // => 'a, b' */
function shown(names) {
  const hidden = names.length - SHOWN_NAME_LIMIT
  const more = hidden > 0 ? ` and ${hidden} more` : ''
  return `${names.slice(0, SHOWN_NAME_LIMIT).join(', ')}${more}`
}

/** Reads one dotted field of a record. @example fieldOf({ limits: { maxCrap: 30 } }, 'limits.maxCrap') // => 30 */
function fieldOf(record, field) {
  return field.split('.').reduce((value, key) => value?.[key], record)
}

/** Refuses a reference that lacks a field of {@link REFERENCE_FIELDS} or records another measurement; called by {@link readReference}. @example assertMeasuredReference({ mode: 'static' }) // throws 'fallow-health-reference.json lacks sourceRevision, …' */
function assertMeasuredReference(reference) {
  const missing = REFERENCE_FIELDS.filter(
    (field) => fieldOf(reference, field) === undefined,
  )
  if (missing.length > 0)
    throw new Error(`${REFERENCE_FILE} lacks ${missing.join(', ')}.`)
  if (reference.mode !== MEASUREMENT_MODE)
    throw new Error(
      `${REFERENCE_FILE} is no ${MEASUREMENT_MODE} reference (its mode is ${reference.mode}).`,
    )
}

/**
 * Reads the measured reference and checks that it describes this checker's measurement and the baseline beside it; the first step of {@link checkHealth}.
 * @returns The reference: `{ sourceRevision, baseline: { file, sha256 }, limits, producers, settings }` with its provenance.
 * @throws When the file is missing or no JSON, lacks a field, records another mode, or names other baseline bytes.
 * @example
 * await readReference() // => { mode: 'measured-istanbul', sourceRevision: '944c1342…', baseline: { file: 'fallow-health-measured-baseline.json', … }, … }
 */
async function readReference() {
  const reference = await readJson(join(extension, REFERENCE_FILE))
  assertMeasuredReference(reference)
  const baseline = await hashText(join(extension, reference.baseline.file))
  if (baseline !== reference.baseline.sha256)
    throw new Error(
      `${reference.baseline.file} is not the baseline ${REFERENCE_FILE} names: its sha256 is ${baseline}, the reference's ${reference.baseline.sha256}.`,
    )
  return reference
}

/** Reads the version of every producer of the measured run as installed here. @example await readProducers() // => { node: '24.21.0', c8: '12.0.0', v8ToIstanbul: '9.3.0', fallow: '3.27.0' } */
async function readProducers() {
  const c8Manifest = requireFromExtension.resolve('c8/package.json')
  const converterManifest = createRequire(c8Manifest).resolve(
    'v8-to-istanbul/package.json',
  )
  return {
    node: process.versions.node,
    c8: (await readJson(c8Manifest)).version,
    v8ToIstanbul: (await readJson(converterManifest)).version,
    fallow: (
      await readJson(requireFromExtension.resolve('fallow/package.json'))
    ).version,
  }
}

/** Hashes the files of {@link SETTING_FILES} as they are now. @example await hashSettings() // => { '.node-version': '73fb1b61…', 'extension/.c8rc.json': '3b45447f…', 'extension/.fallowrc.json': 'a818555f…' } */
async function hashSettings() {
  const settings = {}
  for (const file of SETTING_FILES)
    settings[file] = await hashText(join(repository, file))
  return settings
}

/**
 * Refuses a run whose producers or settings differ from those the measured baseline was taken with; called by {@link checkHealth} for each of the two.
 * @param kind - What the entries are, for the refusal: `producers` or `settings`.
 * @param recorded - The reference's entries by name.
 * @param current - The same entries as read here; every one of them must be recorded with the same value.
 * @throws When an entry differs, naming it with both values.
 * @example
 * assertMatching('producers', { c8: '12.0.0' }, { c8: '12.0.0' }) // => undefined
 * assertMatching('producers', { c8: '12.0.0' }, { c8: '12.0.1' }) // throws 'The producers differ from the reference: c8 is 12.0.1 here, 12.0.0 in the reference.'
 */
function assertMatching(kind, recorded, current) {
  const differing = Object.keys(current).filter(
    (name) => recorded[name] !== current[name],
  )
  if (differing.length > 0)
    throw new Error(
      `The ${kind} differ from the reference: ${differing.map((name) => `${name} is ${current[name]} here, ${recorded[name]} in the reference`).join('; ')}.`,
    )
}

/** Refuses a test runner option in `NODE_OPTIONS`, which could filter, shard or force-exit the suite that measures coverage. @example assertUnfilteredSuite({ NODE_OPTIONS: '--test-name-pattern=focus' }) // throws */
function assertUnfilteredSuite(environment) {
  const options = environment.NODE_OPTIONS ?? ''
  if (/(?:^|\s)--test\b/.test(options))
    throw new Error(
      `NODE_OPTIONS holds a test runner option (${options}); the measured suite runs every test, unfiltered.`,
    )
}

/** Gives a child this process's environment without a parent test runner's context, with the extension's own tool binaries first on the search path, as a package script runs. @example childEnvironment().PATH // => '/repo/extension/node_modules/.bin:/usr/bin:…' */
function childEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== 'NODE_TEST_CONTEXT',
    ),
  )
  // Windows spells the variable `Path`; keep the spelling the environment has.
  const pathName =
    Object.keys(environment).find((name) => name.toUpperCase() === 'PATH') ??
    'PATH'
  environment[pathName] = [
    join(extension, 'node_modules', '.bin'),
    environment[pathName],
  ]
    .filter(Boolean)
    .join(delimiter)
  return environment
}

/**
 * Runs one child in the extension directory with its output on this process's stderr, so stdout carries only Fallow's report; called by {@link runBuild}, {@link runSuite} and {@link reportHealth}.
 * @param command - The executable, or a whole command line when `options.shell` is set.
 * @param arguments_ - Its arguments.
 * @param options - More `spawn` options; a `stdio` here replaces the default.
 * @returns `{ code, signal, stdout }` once the child has exited; `stdout` holds its output only when `options.stdio` pipes it.
 * @example
 * await runChild(process.execPath, ['--version'], { stdio: ['ignore', 'pipe', 2] }) // => { code: 0, signal: null, stdout: 'v24.21.0\n' }
 */
function runChild(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: extension,
      env: childEnvironment(),
      stdio: ['ignore', 2, 2],
      ...options,
    })
    const chunks = []
    child.stdout?.on('data', (chunk) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(chunks).toString('utf8'),
      }),
    )
  })
}

/** Says how a child ended. @example describeExit(1, null) // => 'exit 1' */
function describeExit(code, signal) {
  return signal ? `signal ${signal}` : `exit ${code}`
}

/** Runs the package's own build script, the typed build of `pnpm build`, so the suite reads the output of the current source; called by {@link measureHealth}. @example await runBuild() // throws when the build fails */
async function runBuild() {
  const { scripts } = await readJson(join(extension, 'package.json'))
  if (typeof scripts?.build !== 'string')
    throw new Error('package.json names no build script.')
  const { code, signal } = await runChild(scripts.build, [], { shell: true })
  if (code !== 0)
    throw new Error(
      `The typed build failed (${describeExit(code, signal)}); no coverage is measured for a source that does not build.`,
    )
}

/** Names the files of one directory that end with a suffix, without it. @example await testNames('/repo/extension/src/tests', '.test.ts') // => ['amount', 'service'] */
async function testNames(directory, suffix) {
  return (await readdir(directory))
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.slice(0, -suffix.length))
    .sort()
}

/**
 * Lists the compiled test files of the suite and refuses an inventory that is not exactly one compiled file for each test source; called by {@link measureHealth} after the build.
 * @returns The compiled test files relative to the extension, such as `dist/tests/service.test.js`.
 * @throws When there is no test source, a source has no compiled file, or a compiled file has no source (a stale output of a removed test).
 * @example
 * await listCompiledTests() // => ['dist/tests/aiChatReadyMessage.test.js', …]
 */
async function listCompiledTests() {
  const sources = await testNames(join(extension, 'src', 'tests'), '.test.ts')
  const compiled = await testNames(join(extension, 'dist', 'tests'), '.test.js')
  if (sources.length === 0) throw new Error('src/tests holds no test file.')
  const uncompiled = sources.filter((name) => !compiled.includes(name))
  const stale = compiled.filter((name) => !sources.includes(name))
  if (uncompiled.length + stale.length > 0)
    throw new Error(
      `The compiled tests are not the test sources: not compiled [${shown(uncompiled)}], without a source [${shown(stale)}].`,
    )
  return compiled.map((name) => `dist/tests/${name}.test.js`)
}

/** Hashes every file the build wrote to `dist`, so a rebuild while the suite runs is seen. @example await hashCompiled() // => { 'extension/dist/extension.js': '9b1e…', … } */
async function hashCompiled() {
  const compiled = join(extension, 'dist'),
    hashes = {}
  const files = (
    await readdir(compiled, { recursive: true, withFileTypes: true })
  ).filter((entry) => entry.isFile())
  // One file at a time: thousands of files opened together exceed a small descriptor limit.
  for (const file of files) {
    const path = join(file.parentPath, file.name)
    hashes[relative(repository, path).split(sep).join('/')] = createHash(
      'sha256',
    )
      .update(await readFile(path))
      .digest('hex')
  }
  return hashes
}

/**
 * Reads everything the measured run depends on besides its compiled output: the revision and the package's sources and tests ({@link readBuildIdentity}), the settings, the reference and its baseline, and the producers' versions; called by {@link measureHealth} before the build and after the suite.
 * @param reference - The reference of {@link readReference}, which names the baseline.
 * @returns One map from an input's name to its identity.
 * @example
 * await readInputs(reference) // => { revision: '944c1342…', '.node-version': '73fb1b61…', 'producer c8': '12.0.0', 'extension/src/extension.ts': '9b1e…', … }
 */
async function readInputs(reference) {
  const { revision, sourceHashes } = await readBuildIdentity(repository)
  const producers = Object.entries(await readProducers()).map(
    ([name, version]) => [`producer ${name}`, version],
  )
  const inputs = {
    revision,
    ...(await hashSettings()),
    ...Object.fromEntries(producers),
  }
  // Each entry is `path:sha256`; a path may itself hold a colon.
  for (const entry of sourceHashes) {
    const separator = entry.lastIndexOf(':')
    inputs[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  for (const file of [REFERENCE_FILE, reference.baseline.file])
    inputs[`extension/${file}`] = await hashText(join(extension, file))
  return inputs
}

/** Names the entries that differ between two readings of the same map. @example changedNames({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }) // => ['b', 'c'] */
function changedNames(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...names].filter((name) => before[name] !== after[name]).sort()
}

/** Reads the counts of the summary a TAP report ends with; a count the report lacks stays 0. @example readSummary('# tests 2\n# pass 1\n# skipped 1\n') // => { tests: 2, pass: 1, fail: 0, cancelled: 0, skipped: 1, todo: 0 } */
function readSummary(report) {
  const summary = {
    tests: 0,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  }
  for (const [, name, count] of report.matchAll(TAP_SUMMARY_LINE))
    summary[name] = Number(count)
  return summary
}

/**
 * Runs every compiled test file once under the pinned c8, without filters, and reads the summary of that one run; called by {@link measureHealth} with the inventory of {@link listCompiledTests}.
 * @param output - This run's own temporary directory, which receives the coverage, the raw V8 data and the TAP report.
 * @param tests - The compiled test files relative to the extension.
 * @returns The summary counts with `coverage`, the path of the run's `coverage-final.json`.
 * @throws When the run fails, ran no test, or reports a failed or cancelled test.
 * @example
 * await runSuite('/tmp/codebook-health-x1', ['dist/tests/service.test.js'])
 * // => { tests: 12, pass: 11, fail: 0, cancelled: 0, skipped: 1, todo: 0, coverage: '/tmp/codebook-health-x1/coverage/coverage-final.json' }
 */
async function runSuite(output, tests) {
  const coverage = join(output, 'coverage'),
    report = join(output, 'suite.tap')
  const { code, signal } = await runChild(process.execPath, [
    requireFromExtension.resolve('c8/bin/c8.js'),
    '--all',
    '--reporter=json',
    `--reports-dir=${coverage}`,
    `--temp-directory=${join(output, 'raw')}`,
    process.execPath,
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=tap',
    `--test-reporter-destination=${report}`,
    ...tests,
  ])
  if (code !== 0)
    throw new Error(
      `The suite failed (${describeExit(code, signal)}); a failed run measures no health.`,
    )
  const summary = readSummary(await readFile(report, 'utf8'))
  if (summary.tests === 0 || summary.fail + summary.cancelled > 0)
    throw new Error(
      `The suite reported ${summary.tests} tests, ${summary.fail} failed and ${summary.cancelled} cancelled; only a complete passing run measures health.`,
    )
  return { ...summary, coverage: join(coverage, 'coverage-final.json') }
}

/**
 * Checks that the coverage map holds exactly the source files c8 measures in this checkout, so a map of another checkout or of a narrowed or widened configuration is refused; called by {@link measureHealth} after the suite.
 * @param coverage - The run's `coverage-final.json`.
 * @returns How many source files the map measures.
 * @throws When the map is missing, names a file outside `src` or under `src/tests`, or lacks a measured source file.
 * @example
 * await assertCoverageSet('/tmp/codebook-health-x1/coverage/coverage-final.json') // => 403
 */
async function assertCoverageSet(coverage) {
  const measured = new Set(Object.keys(await readJson(coverage)))
  // c8 records real paths, so the source root is compared as one too.
  const source = join(await realpath(extension), 'src')
  const tests = join(source, 'tests') + sep
  const expected = new Set(
    (await readdir(source, { recursive: true, withFileTypes: true }))
      .filter(
        (entry) => entry.isFile() && MEASURED_SOURCE_NAME.test(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !path.startsWith(tests)),
  )
  const named = (paths) =>
    shown(paths.map((path) => relative(repository, path)).sort())
  const foreign = [...measured].filter((path) => !expected.has(path))
  const unmeasured = [...expected].filter((path) => !measured.has(path))
  if (foreign.length + unmeasured.length > 0)
    throw new Error(
      `The coverage map is not this source's: outside the measured sources [${named(foreign)}], without a record [${named(unmeasured)}].`,
    )
  return measured.size
}

/** The arguments of one Fallow health run on this run's coverage against the reference's baseline and limits. @example fallowArguments(reference, '/tmp/x/coverage/coverage-final.json', 'json') // => ['/repo/extension/node_modules/fallow/bin/fallow', 'health', '--fail-on-issues', …] */
function fallowArguments(reference, coverage, format) {
  return [
    requireFromExtension.resolve('fallow/bin/fallow'),
    'health',
    '--fail-on-issues',
    '--quiet',
    '--baseline',
    reference.baseline.file,
    '--coverage',
    coverage,
    '--max-cyclomatic',
    String(reference.limits.maxCyclomatic),
    '--max-cognitive',
    String(reference.limits.maxCognitive),
    '--max-crap',
    String(reference.limits.maxCrap),
    '--format',
    format,
  ]
}

/**
 * Refuses a Fallow report that did not score every measured file with this run's coverage, where its scores would silently fall back to estimates; called by {@link reportHealth}.
 * @param summary - The `summary` of Fallow's JSON report.
 * @param files - How many source files the coverage map measures ({@link assertCoverageSet}).
 * @example
 * assertScoredWithCoverage({ coverage_model: 'istanbul', istanbul_files_total: 403, istanbul_files_matched: 403 }, 403) // => undefined
 * assertScoredWithCoverage({ coverage_model: 'istanbul', istanbul_files_total: 403, istanbul_files_matched: 0 }, 403)   // throws
 */
function assertScoredWithCoverage(summary, files) {
  const scored =
    summary.coverage_model === 'istanbul' &&
    summary.istanbul_files_total === files &&
    summary.istanbul_files_matched === files
  if (!scored)
    throw new Error(
      `Fallow scored ${summary.istanbul_files_matched} of ${files} measured files with this run's coverage (model ${summary.coverage_model}); the others would fall back to estimates.`,
    )
}

/**
 * Refuses a Fallow report that used other limits than the reference; called by {@link reportHealth}.
 * @param summary - The `summary` of Fallow's JSON report.
 * @param limits - The reference's `limits`.
 * @example
 * assertLimits({ max_cyclomatic_threshold: 20, max_cognitive_threshold: 15, max_crap_threshold: 30 }, { maxCyclomatic: 20, maxCognitive: 15, maxCrap: 30 }) // => undefined
 */
function assertLimits(summary, limits) {
  const used = [
    summary.max_cyclomatic_threshold,
    summary.max_cognitive_threshold,
    summary.max_crap_threshold,
  ].join('/')
  const recorded = [
    limits.maxCyclomatic,
    limits.maxCognitive,
    limits.maxCrap,
  ].join('/')
  if (used !== recorded)
    throw new Error(
      `Fallow used the limits ${used}; the reference's are ${recorded}.`,
    )
}

/**
 * Runs Fallow health on the run's coverage, checks its JSON report ({@link assertScoredWithCoverage}, {@link assertLimits}), then shows the report in the requested format; the last step of {@link measureHealth}.
 * @param reference - The reference of {@link readReference}.
 * @param coverage - The run's `coverage-final.json`.
 * @param files - How many source files the coverage map measures.
 * @param format - Fallow's output format; `json` prints the checked report itself.
 * @returns Fallow's exit code: 0 with no finding beyond the baseline, 1 with findings.
 * @example
 * await reportHealth(reference, '/tmp/x/coverage/coverage-final.json', 403, 'human') // => 1
 */
async function reportHealth(reference, coverage, files, format) {
  const checked = await runChild(
    process.execPath,
    fallowArguments(reference, coverage, 'json'),
    { stdio: ['ignore', 'pipe', 2] },
  )
  if (checked.code !== 0 && checked.code !== 1)
    throw new Error(
      `Fallow health ended with ${describeExit(checked.code, checked.signal)}.`,
    )
  const { summary } = JSON.parse(checked.stdout)
  assertScoredWithCoverage(summary, files)
  assertLimits(summary, reference.limits)
  if (format === 'json') {
    process.stdout.write(checked.stdout)
    return checked.code
  }
  const shownReport = await runChild(
    process.execPath,
    fallowArguments(reference, coverage, format),
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  return shownReport.code
}

/**
 * Builds, runs the suite under coverage and scores health, refusing evidence that changed while it was made; called by {@link checkHealth} inside its own temporary directory.
 * @param reference - The reference of {@link readReference}.
 * @param output - This run's own temporary directory.
 * @param format - Fallow's output format.
 * @returns Fallow's exit code.
 * @example
 * await measureHealth(reference, '/tmp/codebook-health-x1', 'human') // => 0
 */
async function measureHealth(reference, output, format) {
  const before = await readInputs(reference)
  await runBuild()
  const tests = await listCompiledTests()
  const compiled = await hashCompiled()
  const suite = await runSuite(output, tests)
  const changed = [
    ...changedNames(before, await readInputs(reference)),
    ...changedNames(compiled, await hashCompiled()),
  ]
  if (changed.length > 0)
    throw new Error(
      `The inputs changed while the suite ran, so its coverage would mix two sources: ${shown(changed)}.`,
    )
  const files = await assertCoverageSet(suite.coverage)
  console.error(
    `Measured suite: ${suite.tests} tests in ${tests.length} files; ${suite.pass} passed, ${suite.skipped} skipped, ${suite.todo} todo. Coverage of ${files} source files.`,
  )
  return reportHealth(reference, suite.coverage, files, format)
}

/**
 * Checks the reference, producers, settings and environment, then measures health in a temporary directory that only this run owns and removes; called once by this script.
 * @param format - Fallow's output format from the command line.
 * @returns Fallow's exit code.
 * @example
 * await checkHealth('human') // => 1 while findings exceed the baseline
 */
async function checkHealth(format) {
  const reference = await readReference()
  assertMatching('producers', reference.producers, await readProducers())
  assertMatching('settings', reference.settings, await hashSettings())
  assertUnfilteredSuite(process.env)
  const output = await mkdtemp(join(tmpdir(), 'codebook-health-'))
  try {
    return await measureHealth(reference, output, format)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}

try {
  // Only the report's format is a choice: coverage, baseline, limits and the test files come from the run itself.
  const { values } = parseArgs({
    options: { format: { type: 'string', default: 'human' } },
  })
  process.exitCode = await checkHealth(values.format)
} catch (error) {
  console.error(`Health refused: ${error.message}`)
  process.exitCode = REFUSED_EXIT_CODE
}
