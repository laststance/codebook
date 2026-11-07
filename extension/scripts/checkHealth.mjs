// Runs the measured health gate behind `pnpm health`: a fresh typed build, every compiled extension test once under the
// pinned c8, then the pinned Fallow health scored with that run's Istanbul coverage against the measured baseline of the
// pre-repair revision that fallow-health-reference.json names.
//
//   node scripts/checkHealth.mjs                 Fallow's human report on stdout
//   node scripts/checkHealth.mjs --format json   Fallow's JSON report on stdout
//   node scripts/checkHealth.mjs --keep-coverage <file>
//                                                also copies the run's coverage-final.json to <file>
//
// The same measurement can be split over CI jobs (Cycle 0094): shards measure, one merge scores.
//
//   node scripts/checkHealth.mjs --shard 2/3 --out <folder>
//                                                builds, runs shard 2 of 3 of the compiled test files (whole files, balanced
//                                                by test-timings.json) with NODE_V8_COVERAGE set and no report, and writes
//                                                <folder>/raw (renamed V8 dumps) and <folder>/manifest.json
//   node scripts/checkHealth.mjs --merge <folder> [--compare <coverage-final.json>] [--format json]
//                                                builds, validates the shard sub-folders of <folder> (manifest count, exit
//                                                codes, identity, every planned file once, every dump), reports all dumps
//                                                with one c8 call, then scores health as a single run does. --compare also
//                                                prints the SHA-256 of both coverage maps and refuses (exit 2) when they differ.
//
// Exit 0: no finding beyond the baseline (a shard: its dumps and manifest are written). Exit 1: Fallow's findings. Exit 2:
// refused, with no health verdict, because the evidence is missing, stale, mixed, failed or partial, a producer or setting
// differs from the reference, or the command line is invalid. The build, the suite and this script's own lines go to
// stderr. No baseline is ever written; `pnpm health:static` is the fast pre-check of the same complexity limits without
// coverage, per function, against fallow-health-baseline.json.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  SHARD_MANIFEST_FILE,
  SHARD_RAW_FOLDER,
  checkHealthShards,
  sha256Of,
} from './utils/checkHealthShards.mjs'
import { planHealthShards } from './utils/planHealthShards.mjs'
import { readBuildIdentity } from './utils/readBuildIdentity.mjs'
import { readTestTimings } from './utils/readTestTimings.mjs'

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
/** The shard count a command line may name; a larger number is a typing error. */
const MAX_SHARD_TOTAL = 1000
/** The recorded durations that balance the shard plan, relative to the extension. */
const TIMINGS_FILE = 'test-timings.json'
/** How many names a refusal lists before "and N more". */
const SHOWN_NAME_LIMIT = 5

/** Hashes a text file with CRLF read as LF, so a Windows checkout names the same bytes as the reference. @example await hashText('/repo/.node-version') // => 'd9f31874…' */
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
 * await readReference() // => { mode: 'measured-istanbul', sourceRevision: '1e9eda4c…', baseline: { file: 'fallow-health-measured-baseline.json', … }, … }
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

/** Reads the version of every producer of the measured run as installed here. @example await readProducers() // => { node: '24.22.1', c8: '12.0.0', v8ToIstanbul: '9.3.0', fallow: '3.34.1' } */
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
 * await runChild(process.execPath, ['--version'], { stdio: ['ignore', 'pipe', 2] }) // => { code: 0, signal: null, stdout: 'v24.22.1\n' }
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
 * await readInputs(reference) // => { revision: '1e9eda4c…', '.node-version': '73fb1b61…', 'producer c8': '12.0.0', 'extension/src/extension.ts': '9b1e…', … }
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

/** The `node` arguments that run the given compiled tests with the spec reporter on stdout and the TAP report in a file, which {@link readPassingSummary} reads; shared by {@link runSuite} and {@link runShardSuite}. @example testRunnerArguments('/tmp/x/suite.tap', ['dist/tests/a.test.js']) // => ['--test', '--test-reporter=spec', …, 'dist/tests/a.test.js'] */
function testRunnerArguments(report, tests) {
  return [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=tap',
    `--test-reporter-destination=${report}`,
    ...tests,
  ]
}

/**
 * Reads the TAP summary of a finished test run and refuses a run that failed, ran no test or reports a failed or cancelled test; called by {@link runSuite} and {@link runShardSuite}.
 * @param code - Exit code of the run.
 * @param signal - Signal that ended the run, if any.
 * @param report - Path of the run's TAP report.
 * @returns The summary counts.
 * @throws When the run failed or its summary is not a complete passing one.
 * @example
 * await readPassingSummary(0, null, '/tmp/x/suite.tap') // => { tests: 12, pass: 11, fail: 0, cancelled: 0, skipped: 1, todo: 0 }
 */
async function readPassingSummary(code, signal, report) {
  if (code !== 0)
    throw new Error(
      `The suite failed (${describeExit(code, signal)}); a failed run measures no health.`,
    )
  const summary = readSummary(await readFile(report, 'utf8'))
  if (summary.tests === 0 || summary.fail + summary.cancelled > 0)
    throw new Error(
      `The suite reported ${summary.tests} tests, ${summary.fail} failed and ${summary.cancelled} cancelled; only a complete passing run measures health.`,
    )
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
    ...testRunnerArguments(report, tests),
  ])
  return {
    ...(await readPassingSummary(code, signal, report)),
    coverage: join(coverage, 'coverage-final.json'),
  }
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
    // Fallow's incremental cache in the checkout can outlive the source it describes: a reused graph cache once scored functions the tests reach as unreached (Cycle 0056 pt3). Each measured run builds its graph from the current source.
    '--no-cache',
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
 * @returns The checked run's exit code: 0 with no finding beyond the baseline, 1 with findings.
 * @throws When the checked run ends with another code or a signal, its report is not scored with this run's coverage or limits, or the run that shows the report ends otherwise than the checked run.
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
  // A shown run killed by a signal (code null), crashed, or with another verdict showed no report of the checked run.
  if (shownReport.code !== checked.code)
    throw new Error(
      `Fallow's ${format} report ended with ${describeExit(shownReport.code, shownReport.signal)}; its checked JSON run ended with ${describeExit(checked.code, checked.signal)}.`,
    )
  return checked.code
}

/**
 * Refuses a measurement whose inputs or compiled output changed while the tests ran, which would mix two sources; called by {@link measureHealth}, {@link measureShard} and {@link measureMerge} after the tests.
 * @param reference - The reference of {@link readReference}.
 * @param before - {@link readInputs} as read before the build.
 * @param compiled - {@link hashCompiled} as read after the build.
 * @throws When an input or a compiled file differs now, naming the first few.
 * @example
 * await assertInputsUnchanged(reference, before, compiled) // => undefined
 */
async function assertInputsUnchanged(reference, before, compiled) {
  const changed = [
    ...changedNames(before, await readInputs(reference)),
    ...changedNames(compiled, await hashCompiled()),
  ]
  if (changed.length > 0)
    throw new Error(
      `The inputs changed while the suite ran, so its coverage would mix two sources: ${shown(changed)}.`,
    )
}

/**
 * Builds, runs the suite under coverage and scores health, refusing evidence that changed while it was made; called by {@link checkHealth} inside its own temporary directory.
 * @param reference - The reference of {@link readReference}.
 * @param output - This run's own temporary directory.
 * @param format - Fallow's output format.
 * @param keepCoverage - Absolute path to copy the run's `coverage-final.json` to, or `undefined`.
 * @returns Fallow's exit code.
 * @example
 * await measureHealth(reference, '/tmp/codebook-health-x1', 'human') // => 0
 */
async function measureHealth(reference, output, format, keepCoverage) {
  const before = await readInputs(reference)
  await runBuild()
  const tests = await listCompiledTests()
  const compiled = await hashCompiled()
  const suite = await runSuite(output, tests)
  await assertInputsUnchanged(reference, before, compiled)
  const files = await assertCoverageSet(suite.coverage)
  if (keepCoverage) {
    // The destination folder may not exist yet (CI passes a path under a fresh temporary folder).
    await mkdir(dirname(keepCoverage), { recursive: true })
    await copyFile(suite.coverage, keepCoverage)
  }
  console.error(
    `Measured suite: ${suite.tests} tests in ${tests.length} files; ${suite.pass} passed, ${suite.skipped} skipped, ${suite.todo} todo. Coverage of ${files} source files.`,
  )
  return reportHealth(reference, suite.coverage, files, format)
}

/** Hashes a compiled-output map ({@link hashCompiled}) into one value that names the whole `dist` tree. @example treeHash({ 'extension/dist/a.js': '9b1e…' }) // => '3f2a…' */
function treeHash(hashes) {
  const lines = Object.keys(hashes)
    .sort()
    .map((name) => `${name}:${hashes[name]}`)
  return sha256Of(lines.join('\n'))
}

/**
 * Reads what a shard's coverage was measured with and on, which the merge compares field by field with its own ({@link checkHealthShards}).
 * @param compiled - {@link hashCompiled} of the build this process made.
 * @returns `{ node, c8, v8ToIstanbul, c8rcSha256, distHash, srcHash, checkout }`.
 * @example
 * await readShardIdentity(await hashCompiled()) // => { node: '24.22.1', c8: '12.0.0', …, checkout: '/repo/extension' }
 */
async function readShardIdentity(compiled) {
  const producers = await readProducers()
  return {
    node: producers.node,
    c8: producers.c8,
    v8ToIstanbul: producers.v8ToIstanbul,
    c8rcSha256: await hashText(join(extension, '.c8rc.json')),
    distHash: treeHash(compiled),
    srcHash: (await readBuildIdentity(repository)).sourceHash,
    // c8 maps coverage by absolute path, so shards and merge must share one checkout path.
    checkout: await realpath(extension),
  }
}

/**
 * Runs the given compiled test files once with V8 coverage collected straight into `raw` (no c8 in a shard) and renames each dump with the shard prefix so the merge can pool them; called by {@link measureShard}.
 * @param output - The shard's output folder, which receives `raw/` and the TAP report.
 * @param shard - This shard's number, 1 or more.
 * @param files - The compiled test files of this shard's share.
 * @returns `{ exitCode, summary, dumps }`: the runner's exit code, the TAP counts and the renamed dumps `{ name, sha256 }` sorted by name.
 * @throws When the run fails, ran no test, or reports a failed or cancelled test.
 * @example
 * await runShardSuite('/tmp/s2', 2, ['dist/tests/a.test.js']) // => { exitCode: 0, summary: { tests: 3, … }, dumps: [{ name: 'shard-2-coverage-1-2-0.json', sha256: '…' }] }
 */
async function runShardSuite(output, shard, files) {
  const raw = join(output, SHARD_RAW_FOLDER),
    report = join(output, 'suite.tap')
  await mkdir(raw, { recursive: true })
  const { code, signal } = await runChild(
    process.execPath,
    testRunnerArguments(report, files),
    { env: { ...childEnvironment(), NODE_V8_COVERAGE: raw } },
  )
  const summary = await readPassingSummary(code, signal, report)
  const dumps = []
  for (const name of (await readdir(raw)).sort()) {
    const renamed = `shard-${shard}-${name}`
    // rename() would overwrite a dump of the same name silently; a collision means two dumps would count as one.
    if (await stat(join(raw, renamed)).catch(() => null))
      throw new Error(
        `Coverage dump ${renamed} already exists in ${raw}; a shard never overwrites a dump.`,
      )
    await rename(join(raw, name), join(raw, renamed))
    dumps.push({
      name: renamed,
      sha256: sha256Of(await readFile(join(raw, renamed))),
    })
  }
  return { exitCode: code, summary, dumps }
}

/**
 * Measures one shard: builds, runs this shard's share of the test files with V8 coverage collected directly, and writes the dumps and a manifest for the merge; called by {@link checkHealth} for `--shard i/N --out <folder>`.
 * @param reference - The reference of {@link readReference}.
 * @param mode - `{ shard, total, out }` from the command line.
 * @returns 0: a shard gives no health verdict.
 * @throws When the output folder is not empty, the shard has no file, a test fails, or the inputs changed during the run.
 * @example
 * await measureShard(reference, { shard: 2, total: 3, out: '/tmp/s2' }) // => 0
 */
async function measureShard(reference, { shard, total, out }) {
  await mkdir(out, { recursive: true })
  if ((await readdir(out)).length > 0)
    throw new Error(`${out} is not empty; a shard writes into a new folder.`)
  const before = await readInputs(reference)
  await runBuild()
  const tests = await listCompiledTests()
  const compiled = await hashCompiled()
  const timings = await readTestTimings(join(extension, TIMINGS_FILE))
  const files = planHealthShards(tests, timings, total)[shard - 1]
  if (files.length === 0)
    throw new Error(
      `Shard ${shard} of ${total} has no test file; ${tests.length} files cannot fill ${total} shards.`,
    )
  const suite = await runShardSuite(out, shard, files)
  await assertInputsUnchanged(reference, before, compiled)
  const manifest = {
    shard,
    total,
    files,
    exitCode: suite.exitCode,
    identity: await readShardIdentity(compiled),
    summary: suite.summary,
    dumps: suite.dumps,
  }
  await writeFile(
    join(out, SHARD_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  console.error(
    `Shard ${shard} of ${total}: ${suite.summary.tests} tests in ${files.length} files; ${suite.dumps.length} coverage dumps in ${out}.`,
  )
  return 0
}

/** Refuses a merged coverage map that is not byte for byte the single run's, after printing both SHA-256 values; the equivalence run of the sharded measurement. @example await assertSameCoverage('/tmp/x/coverage-final.json', '/tmp/single/coverage-final.json') // throws when the hashes differ */
async function assertSameCoverage(merged, single) {
  const mergedHash = sha256Of(await readFile(merged))
  const singleHash = sha256Of(await readFile(single))
  console.error(
    `Coverage map SHA-256: merged ${mergedHash}, single run ${singleHash}.`,
  )
  if (mergedHash !== singleHash)
    throw new Error(
      "The merged coverage map differs from the single run's coverage map.",
    )
}

/**
 * Merges the shards' V8 dumps into one coverage map and scores health on it as a single run does; called by {@link checkHealth} for `--merge <folder>`.
 * @param reference - The reference of {@link readReference}.
 * @param output - This run's own temporary directory.
 * @param mode - `{ folder, compare, format }` from the command line.
 * @returns Fallow's exit code.
 * @throws When the shards do not validate ({@link checkHealthShards}), c8 fails, the coverage map is not this source's, or `compare` names a different map.
 * @example
 * await measureMerge(reference, '/tmp/codebook-health-x1', { folder: '/tmp/shards', format: 'human' }) // => 0
 */
async function measureMerge(reference, output, { folder, compare, format }) {
  const before = await readInputs(reference)
  await runBuild()
  const tests = await listCompiledTests()
  const compiled = await hashCompiled()
  const shards = await checkHealthShards({
    folder,
    plannedFiles: tests,
    identity: await readShardIdentity(compiled),
  })
  // One folder for every dump; their names already carry the shard number.
  const raw = join(output, 'raw'),
    coverage = join(output, 'coverage')
  await mkdir(raw)
  for (const dump of shards.dumps)
    await copyFile(dump.path, join(raw, dump.name), constants.COPYFILE_EXCL)
  const { code, signal } = await runChild(process.execPath, [
    requireFromExtension.resolve('c8/bin/c8.js'),
    'report',
    '--all',
    '--reporter=json',
    `--reports-dir=${coverage}`,
    `--temp-directory=${raw}`,
  ])
  if (code !== 0)
    throw new Error(
      `c8 report failed (${describeExit(code, signal)}); the merged dumps give no coverage.`,
    )
  await assertInputsUnchanged(reference, before, compiled)
  const merged = join(coverage, 'coverage-final.json')
  const files = await assertCoverageSet(merged)
  console.error(
    `Merged ${shards.total} shards: ${shards.summary.tests} tests in ${tests.length} files; ${shards.summary.pass} passed, ${shards.summary.skipped} skipped, ${shards.summary.todo} todo. Coverage of ${files} source files.`,
  )
  // Fallow's report comes first, so a failing comparison still leaves the findings readable above its refusal.
  const verdict = await reportHealth(reference, merged, files, format)
  if (compare) await assertSameCoverage(merged, compare)
  return verdict
}

/**
 * Checks the reference, producers, settings and environment, then measures health (alone, as one shard, or merged from shards) in a temporary directory that only this run owns and removes; called once by this script.
 * @param mode - The command line as {@link readMode} reads it.
 * @returns Fallow's exit code, or 0 for a shard.
 * @example
 * await checkHealth({ kind: 'single', format: 'human' }) // => 1 while findings exceed the baseline
 */
async function checkHealth(mode) {
  const reference = await readReference()
  assertMatching('producers', reference.producers, await readProducers())
  assertMatching('settings', reference.settings, await hashSettings())
  assertUnfilteredSuite(process.env)
  if (mode.kind === 'shard') return measureShard(reference, mode)
  const output = await mkdtemp(join(tmpdir(), 'codebook-health-'))
  try {
    return mode.kind === 'merge'
      ? await measureMerge(reference, output, mode)
      : await measureHealth(reference, output, mode.format, mode.keepCoverage)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}

/** Reads a `--shard` value `i/N`. @example readShard('2/3') // => { shard: 2, total: 3 } */
function readShard(text) {
  const match = /^(\d+)\/(\d+)$/.exec(text)
  const shard = Number(match?.[1]),
    total = Number(match?.[2])
  if (!match || shard < 1 || shard > total || total > MAX_SHARD_TOTAL)
    throw new Error(
      `--shard takes i/N with 1 <= i <= N <= ${MAX_SHARD_TOTAL}, not ${JSON.stringify(text)}.`,
    )
  return { shard, total }
}

/** Options of the other modes that a shard run refuses. */
const NOT_FOR_SHARD = ['format', 'compare', 'keepCoverage']

/**
 * Turns the parsed command line into one of the three modes and refuses an invalid combination before anything is built; the first step of this script.
 * @param values - The `values` of `parseArgs` (with `keepCoverage` for `--keep-coverage`).
 * @returns `{ kind: 'single', format, keepCoverage }`, `{ kind: 'shard', shard, total, out }` or `{ kind: 'merge', folder, compare, format }`, paths absolute.
 * @throws When options of different modes are mixed, `--shard` is not `i/N`, `--out` is missing, or the `--merge` folder is no directory.
 * @example
 * await readMode({ shard: '2/3', out: 'shard-2' }) // => { kind: 'shard', shard: 2, total: 3, out: '/cwd/shard-2' }
 */
async function readMode(values) {
  const refuse = (reason) => {
    throw new Error(`${reason}.`)
  }
  if (values.shard !== undefined && values.merge !== undefined)
    refuse('--shard and --merge are different modes')
  if (values.shard !== undefined) {
    if (values.out === undefined) refuse('--shard needs --out <folder>')
    if (NOT_FOR_SHARD.some((name) => values[name] !== undefined))
      refuse('--shard takes only --out')
    return {
      kind: 'shard',
      ...readShard(values.shard),
      out: resolve(values.out),
    }
  }
  if (values.out !== undefined) refuse('--out belongs to --shard')
  if (values.merge !== undefined) {
    if (values.keepCoverage !== undefined)
      refuse('--keep-coverage belongs to the single run')
    const folder = resolve(values.merge)
    if (!(await stat(folder).catch(() => null))?.isDirectory())
      refuse(`--merge needs a folder of shard results; ${values.merge} is none`)
    return {
      kind: 'merge',
      folder,
      compare:
        values.compare === undefined ? undefined : resolve(values.compare),
      format: values.format ?? 'human',
    }
  }
  if (values.compare !== undefined) refuse('--compare belongs to --merge')
  return {
    kind: 'single',
    format: values.format ?? 'human',
    keepCoverage:
      values.keepCoverage === undefined
        ? undefined
        : resolve(values.keepCoverage),
  }
}

try {
  // The report's format and the sharded run's folders are the only choices: coverage, baseline, limits and the test files come from the run itself.
  const { values } = parseArgs({
    options: {
      format: { type: 'string' },
      'keep-coverage': { type: 'string' },
      shard: { type: 'string' },
      out: { type: 'string' },
      merge: { type: 'string' },
      compare: { type: 'string' },
    },
  })
  process.exitCode = await checkHealth(
    await readMode({ ...values, keepCoverage: values['keep-coverage'] }),
  )
} catch (error) {
  console.error(`Health refused: ${error.message}`)
  process.exitCode = REFUSED_EXIT_CODE
}
