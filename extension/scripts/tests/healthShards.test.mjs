import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  SHARD_MANIFEST_FILE,
  SHARD_RAW_FOLDER,
  checkHealthShards,
  sha256Of,
} from '../utils/checkHealthShards.mjs'
import { planHealthShards } from '../utils/planHealthShards.mjs'

/** What every fixture shard and the fixture merge were measured with. */
const IDENTITY = {
  node: '24.22.1',
  c8: '12.0.0',
  v8ToIstanbul: '9.3.0',
  c8rcSha256: 'c8rc-hash',
  distHash: 'dist-hash',
  srcHash: 'src-hash',
  checkout: '/work/codebook/extension',
}

/** A V8 coverage dump that measured one compiled product script. */
const PRODUCT_DUMP = JSON.stringify({
  result: [{ url: 'file:///work/codebook/extension/dist/service.js' }],
})

/**
 * Writes three passing shard results (one test file and one dump each) into a temporary folder, as the CI artifacts of `--shard` runs would arrive.
 * @param context - The test context, which removes the folder afterward.
 * @returns `{ folder, plannedFiles, identity }` for {@link checkHealthShards}.
 * @example
 * const fixture = await createShards(context)
 */
async function createShards(context) {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-health-shards-'))
  context.after(() =>
    rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  )
  for (const shard of [1, 2, 3]) {
    const name = `shard-${shard}-coverage-1.json`
    await mkdir(join(folder, `health-shard-${shard}`, SHARD_RAW_FOLDER), {
      recursive: true,
    })
    await writeFile(
      join(folder, `health-shard-${shard}`, SHARD_RAW_FOLDER, name),
      PRODUCT_DUMP,
    )
    await writeManifest(folder, shard, {
      shard,
      total: 3,
      files: [`dist/tests/file${shard}.test.js`],
      exitCode: 0,
      identity: IDENTITY,
      summary: { tests: 4, pass: 4 },
      dumps: [{ name, sha256: sha256Of(Buffer.from(PRODUCT_DUMP)) }],
    })
  }
  return {
    folder,
    plannedFiles: [1, 2, 3].map((shard) => `dist/tests/file${shard}.test.js`),
    identity: IDENTITY,
  }
}

/** Writes the manifest of one fixture shard. @example await writeManifest(folder, 1, { shard: 1, … }) */
function writeManifest(folder, shard, manifest) {
  return writeFile(
    join(folder, `health-shard-${shard}`, SHARD_MANIFEST_FILE),
    JSON.stringify(manifest),
  )
}

/** Reads the manifest of one fixture shard. @example (await readManifest(folder, 2)).files // => ['dist/tests/file2.test.js'] */
async function readManifest(folder, shard) {
  return JSON.parse(
    await readFile(
      join(folder, `health-shard-${shard}`, SHARD_MANIFEST_FILE),
      'utf8',
    ),
  )
}

/** Replaces the dump of fixture shard 1 with other bytes and lists them in its manifest with a hash, which is right unless `sha256` says otherwise. @example await replaceDump(folder, 'not json') */
async function replaceDump(folder, text, sha256 = sha256Of(Buffer.from(text))) {
  const manifest = await readManifest(folder, 1)
  await writeFile(
    join(folder, 'health-shard-1', SHARD_RAW_FOLDER, manifest.dumps[0].name),
    text,
  )
  manifest.dumps[0].sha256 = sha256
  await writeManifest(folder, 1, manifest)
}

// Value: protects=the speed of the sharded measured health run: each job gets about the same seconds of test files and no job gets a file another one runs; fails_when=a file is run by two shards or none, a file is cut into parts, the balance ignores the recorded seconds, or equal weights are put in an order that depends on the runner; why_new=Cycle 0094 task 11 (Discussion 185 step 2, eng review R3); seam=none; no_claim=how long a shard takes on the hosted runner
test('every test file lands on exactly one shard, heaviest first onto the lightest, and the plan is the same for any input order', () => {
  // Arrange
  const files = [
    'dist/tests/d.test.js',
    'dist/tests/a.test.js',
    'dist/tests/c.test.js',
    'dist/tests/b.test.js',
  ]
  const timings = {
    files: {
      'a.test.js': { totalMs: 9000 },
      'b.test.js': { totalMs: 4000 },
      'c.test.js': { totalMs: 4000 },
      'd.test.js': { totalMs: 1000 },
    },
  }

  // Act
  const plan = planHealthShards(files, timings, 2)
  const reversed = planHealthShards(files.toReversed(), timings, 2)

  // Assert: a (9 s) alone; b and c (4 s each, tie by path) then d (1 s) fill the other shard to 9 s.
  assert.deepEqual(plan, [
    ['dist/tests/a.test.js'],
    ['dist/tests/b.test.js', 'dist/tests/c.test.js', 'dist/tests/d.test.js'],
  ])
  assert.deepEqual(reversed, plan)
})

// Value: protects=a new test file that the timings file does not know yet: it still runs, on a shard, instead of being dropped from the plan; fails_when=a file without a recorded duration counts as 0 seconds or is left out; why_new=Cycle 0094 task 11 (eng review R3); seam=none; no_claim=none
test('a test file without a recorded duration counts one second and equal weights go to the earlier shard', () => {
  // Arrange
  const files = ['dist/tests/known.test.js', 'dist/tests/new.test.js']
  const timings = { files: { 'known.test.js': { totalMs: 1000 } } }

  // Act
  const plan = planHealthShards(files, timings, 2)

  // Assert: both weigh one second, so the path order puts known on shard 1 and new on shard 2.
  assert.deepEqual(plan, [
    ['dist/tests/known.test.js'],
    ['dist/tests/new.test.js'],
  ])
})

// Value: protects=the plan against a file recorded with 0 seconds: it is still assigned, once; fails_when=a zero-second file is dropped from every shard or given to two; why_new=Cycle 0094 part 2 review round; seam=none; no_claim=none
test('a test file recorded as 0 seconds is still assigned to exactly one shard', () => {
  // Arrange
  const files = ['dist/tests/a.test.js', 'dist/tests/free.test.js']
  const timings = {
    files: { 'a.test.js': { totalMs: 3000 }, 'free.test.js': { totalMs: 0 } },
  }

  // Act
  const plan = planHealthShards(files, timings, 2)

  // Assert
  assert.deepEqual(plan, [
    ['dist/tests/a.test.js'],
    ['dist/tests/free.test.js'],
  ])
})

// Value: protects=the pooled dump folder of the merge: two shards must never carry a dump of the same name, or the copy would overwrite one dump and lose its coverage; fails_when=a dump name that two shards list is accepted; why_new=Cycle 0094 part 2 review round (dump overwrite finding); seam=the folder of shard results; no_claim=none
test('two shards that carry a dump of the same name refuse the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  const shard1 = await readManifest(fixture.folder, 1)
  const dump = shard1.dumps[0]
  await writeFile(
    join(fixture.folder, 'health-shard-2', SHARD_RAW_FOLDER, dump.name),
    PRODUCT_DUMP,
  )
  const shard2 = await readManifest(fixture.folder, 2)
  await writeManifest(fixture.folder, 2, {
    ...shard2,
    dumps: [...shard2.dumps, dump],
  })

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Dump name shard-1-coverage-1.json appears twice (again in shard 2); pooled dumps would overwrite each other.',
  })
})

// Value: protects=the equivalence of the sharded and the single measured run: the shards together cover every compiled test exactly as the single run does; fails_when=a shard result with a wrong count, exit, file list or dump still reaches c8, so a measured gap passes as complete evidence; why_new=Cycle 0094 task 11 (eng review R4, R11); seam=the folder of shard results; no_claim=that c8 merges the dumps into the single run's map (the equivalence run in CI shows that)
test('three complete shard results with every planned file and valid dumps are accepted and summed', async (context) => {
  // Arrange
  const fixture = await createShards(context)

  // Act
  const checked = await checkHealthShards(fixture)

  // Assert
  assert.equal(checked.total, 3)
  assert.deepEqual(
    checked.dumps.map((dump) => dump.name),
    [
      'shard-1-coverage-1.json',
      'shard-2-coverage-1.json',
      'shard-3-coverage-1.json',
    ],
  )
  assert.deepEqual(checked.summary, { tests: 12, pass: 12 })
})

// Value: protects=a CI job that lost a shard (cancelled, artifact missing): the merge must not score a coverage map of two thirds of the suite; fails_when=fewer manifests than the shard total still merge; why_new=Cycle 0094 task 11 (eng review R3); seam=the folder of shard results; no_claim=none
test('a missing shard result refuses the merge and names the shard', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await rm(join(fixture.folder, 'health-shard-2'), { recursive: true })

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message: 'Expected 3 shard manifests, found 2; missing shard 2.',
  })
})

// Value: protects=a measurement of a failed run: a shard whose tests failed measured less than the whole suite; fails_when=a shard with a non-zero exit code is merged; why_new=Cycle 0094 task 11 (eng review R4); seam=the folder of shard results; no_claim=that a shard writes a manifest after a failed run (it does not; this guards the merge alone)
test('a shard that ended with a failing exit code refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await writeManifest(fixture.folder, 3, {
    ...(await readManifest(fixture.folder, 3)),
    exitCode: 1,
  })

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message: 'Shard 3 ended with exit 1; a failed shard measures no health.',
  })
})

// Value: protects=the single count of each test file in the merged coverage; fails_when=two shards both ran a file and the merge accepts the doubled run; why_new=Cycle 0094 task 11 (eng review R4); seam=the folder of shard results; no_claim=none
test('a test file that two shards both ran refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await writeManifest(fixture.folder, 2, {
    ...(await readManifest(fixture.folder, 2)),
    files: ['dist/tests/file1.test.js', 'dist/tests/file2.test.js'],
  })

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message: 'Test file dist/tests/file1.test.js ran twice (again in shard 2).',
  })
})

// Value: protects=the completeness of the measured suite: every compiled test file the merge's own build lists ran in some shard; fails_when=a planned file no shard ran (or a file the build does not list) still merges; why_new=Cycle 0094 task 11 (eng review R4); seam=the folder of shard results; no_claim=none
test('a planned test file that no shard ran refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  const plannedFiles = [...fixture.plannedFiles, 'dist/tests/file4.test.js']

  // Act
  const merging = checkHealthShards({ ...fixture, plannedFiles })

  // Assert
  await assert.rejects(merging, {
    message:
      'The shards did not run the planned test files: not run [dist/tests/file4.test.js], not planned [].',
  })
})

// Value: protects=the measurement against a dump that a killed shard left half written (c8 skips it silently and the file count still adds up); fails_when=a dump that is no V8 coverage object is counted as a dump; why_new=Cycle 0094 task 11 (eng review R11); seam=the folder of shard results; no_claim=none
test('a dump that is no V8 coverage object refuses the merge and names the dump', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await replaceDump(
    fixture.folder,
    '{"result":[{"url":"file:///work/codebook/ext',
  )

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Dump shard-1-coverage-1.json of shard 1 is no JSON, so it is no V8 coverage.',
  })
})

// Value: protects=the measurement against a dump that is JSON but no coverage (a stray file in the artifact); fails_when=a JSON file without a result array counts as a dump; why_new=Cycle 0094 task 11 (eng review R11); seam=the folder of shard results; no_claim=none
test('a JSON file without a coverage result array refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await replaceDump(fixture.folder, '{"note":"not coverage"}')

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Dump shard-1-coverage-1.json of shard 1 is no V8 coverage object (it has no "result" array).',
  })
})

// Value: protects=the dumps against change between the shard job and the merge job (a damaged or swapped artifact); fails_when=a dump whose bytes differ from the SHA-256 its manifest lists is merged; why_new=Cycle 0094 task 11 (eng review R11); seam=the folder of shard results; no_claim=none
test('a dump whose bytes differ from the hash in its manifest refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await replaceDump(fixture.folder, PRODUCT_DUMP, 'a'.repeat(64))

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Dump shard-1-coverage-1.json of shard 1 does not match the SHA-256 its manifest lists.',
  })
})

// Value: protects=the one-process-per-file shape of a shard: each test file writes a dump, so fewer dumps than files means a measurement went missing; fails_when=a shard with fewer dumps than files is merged; why_new=Cycle 0094 task 11 (eng review R11); seam=the folder of shard results; no_claim=none
test('a shard with fewer dumps than test files refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await writeManifest(fixture.folder, 1, {
    ...(await readManifest(fixture.folder, 1)),
    files: ['dist/tests/file1.test.js', 'dist/tests/file9.test.js'],
  })
  const plannedFiles = [...fixture.plannedFiles, 'dist/tests/file9.test.js']

  // Act
  const merging = checkHealthShards({ ...fixture, plannedFiles })

  // Assert
  await assert.rejects(merging, {
    message:
      'Shard 1 wrote 1 dumps for 2 test files; every file runs in a process of its own.',
  })
})

// Value: protects=the proof that a shard measured the product: tests that ran but covered no compiled extension script would merge into a map of empty coverage; fails_when=a shard without coverage of any script under extension/dist/ is merged; why_new=Cycle 0094 task 11 (eng review R11); seam=the folder of shard results; no_claim=none
test('a shard whose dumps cover no script under extension/dist refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await replaceDump(
    fixture.folder,
    JSON.stringify({ result: [{ url: 'node:internal/test_runner/runner' }] }),
  )

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Shard 1 holds no coverage of a script under extension/dist/, so it measured no product code.',
  })
})

// Value: protects=the coverage from a build that is not the merge's own: another compiled tree has other line numbers; fails_when=a shard measured against another dist tree is merged; why_new=Cycle 0094 task 11 (eng review R4); seam=the folder of shard results; no_claim=none
test('a shard measured on another compiled output refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await writeManifest(fixture.folder, 2, {
    ...(await readManifest(fixture.folder, 2)),
    identity: { ...IDENTITY, distHash: 'other-dist-hash' },
  })

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Shard 2 was measured with another identity than the merge: distHash is other-dist-hash there, dist-hash here.',
  })
})

// Value: protects=the coverage paths: c8 records absolute paths, so dumps from another checkout path would not match the merge's sources; fails_when=a shard from another absolute checkout path is merged; why_new=Cycle 0094 task 11 (eng review R4); seam=the folder of shard results; no_claim=none
test('a shard measured in another checkout path refuses the merge', async (context) => {
  // Arrange
  const fixture = await createShards(context)
  await writeManifest(fixture.folder, 3, {
    ...(await readManifest(fixture.folder, 3)),
    identity: { ...IDENTITY, checkout: '/runner/other/extension' },
  })

  // Act
  const merging = checkHealthShards(fixture)

  // Assert
  await assert.rejects(merging, {
    message:
      'Shard 3 was measured with another identity than the merge: checkout is /runner/other/extension there, /work/codebook/extension here.',
  })
})
