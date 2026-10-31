import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { runBump, writeFileAtomically } from '../bump-version.mjs'
import { runCommandLine } from '../utils/commandContract.mjs'

/** The clock every test uses: 1 November 2026, local time. */
const FIXED_NOW = () => new Date(2026, 10, 1, 12, 0, 0)

const MANIFEST_68 = `{
  "name": "codebook",
  "version": "0.2.68",
  "dependencies": {
    "version": "1.0.0"
  }
}
`
const CONSTANTS_68 = `export const EXTENSION_VERSION = '0.2.68'
export const NODE_SERVER_MINIMUM_EXTENSION_VERSION = '0.2.51'
`
const PACKAGE_TEST_68 = `assert.equal(checked.extension.version, '0.2.68')
`
/** The repository's own heading form. */
const CHANGELOG_68 = `# Changelog

## [0.2.68.0] - 2026-10-31 (development candidate)

Cycle 0067 body.

## [0.2.67.0] - 2026-10-30 (development candidate)

Older body.
`

/**
 * Builds a temporary repository folder holding the five places, defaulting to the 0.2.68.0 tree.
 * @param {Partial<{ version: string, manifest: string, constants: string, packageTest: string, changelog: string }>} overrides - Contents to replace.
 * @returns {Promise<string>} The folder; the caller removes it.
 */
async function makeRoot(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bump-version-'))
  const files = {
    VERSION: overrides.version ?? '0.2.68.0\n',
    'extension/package.json': overrides.manifest ?? MANIFEST_68,
    'extension/src/constants.ts': overrides.constants ?? CONSTANTS_68,
    'extension/scripts/tests/package.test.mjs':
      overrides.packageTest ?? PACKAGE_TEST_68,
    'CHANGELOG.md': overrides.changelog ?? CHANGELOG_68,
  }
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

/** Reads the five places of a temporary root. */
async function readFive(root) {
  const read = (path) => readFile(join(root, path), 'utf8')
  return {
    version: await read('VERSION'),
    manifest: await read('extension/package.json'),
    constants: await read('extension/src/constants.ts'),
    packageTest: await read('extension/scripts/tests/package.test.mjs'),
    changelog: await read('CHANGELOG.md'),
  }
}

/** Runs the command like the entry point does and collects its output and exit code. */
async function runCli(argv, { root, writeFileAtomic } = {}) {
  const out = []
  const err = []
  const exitCode = await runCommandLine(
    (progress) =>
      runBump(progress, {
        argv,
        root,
        now: FIXED_NOW,
        print: (line) => out.push(line),
        ...(writeFileAtomic ? { writeFileAtomic } : {}),
      }),
    { printError: (line) => err.push(line), environment: {} },
  )
  return { exitCode, out, err }
}

/** Runs `body` with a fresh temporary root and removes it afterwards. */
async function withRoot(overrides, body) {
  const root = await makeRoot(overrides)
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// protects=a bump moves every place to the new version in one run; fails_when=a place is skipped, a nested "version" key is rewritten or the CHANGELOG heading is missing; no_claim=the real repository files (temporary copies stand in); the default atomic writer is used
test('bumping 0.2.68.0 to 0.2.69.0 writes all five places and --check then agrees', async () => {
  await withRoot({}, async (root) => {
    // Arrange
    const argv = ['0.2.69.0']

    // Act
    const bump = await runCli(argv, { root })
    const check = await runCli(['--check'], { root })

    // Assert
    assert.equal(bump.exitCode, 0)
    assert.deepEqual(bump.out, [
      'extension/package.json: 0.2.68 -> 0.2.69',
      'extension/src/constants.ts: 0.2.68 -> 0.2.69',
      'extension/scripts/tests/package.test.mjs: 0.2.68 -> 0.2.69',
      'CHANGELOG.md: 0.2.68.0 -> 0.2.69.0',
      'VERSION: 0.2.68.0 -> 0.2.69.0',
    ])
    const five = await readFive(root)
    assert.equal(five.version, '0.2.69.0\n')
    assert.equal(five.manifest, MANIFEST_68.replace('"0.2.68"', '"0.2.69"'))
    assert.equal(five.constants, CONSTANTS_68.replace("'0.2.68'", "'0.2.69'"))
    assert.equal(
      five.packageTest,
      "assert.equal(checked.extension.version, '0.2.69')\n",
    )
    assert.equal(
      five.changelog,
      CHANGELOG_68.replace(
        '## [0.2.68.0]',
        '## [0.2.69.0] - 2026-11-01 (development candidate)\n\n## [0.2.68.0]',
      ),
    )
    assert.equal(check.exitCode, 0)
    assert.deepEqual(check.out, ['all five places agree at 0.2.69.0'])
  })
})

// protects=a version lower than VERSION writes nothing; fails_when=a downgrade is accepted or partly written; no_claim=the wording of the refusal
test('a version lower than VERSION is refused with exit 1 and nothing written', async () => {
  await withRoot({}, async (root) => {
    // Arrange
    const before = await readFive(root)

    // Act
    const result = await runCli(['0.2.67.0'], { root })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.err, [
      'E_VERSION_LOWER: 0.2.67.0 is lower than the current VERSION 0.2.68.0',
      'Fix: use a version of at least 0.2.68.0',
    ])
    assert.deepEqual(await readFive(root), before)
  })
})

// protects=only MAJOR.MINOR.PATCH.MICRO is accepted; fails_when=a three-part version or a leading zero is accepted; no_claim=every malformed string (two representative forms)
test('a three-part version and a leading-zero version are refused with exit 1', async () => {
  await withRoot({}, async (root) => {
    // Arrange
    const before = await readFive(root)

    // Act
    const threePart = await runCli(['0.2.69'], { root })
    const leadingZero = await runCli(['0.2.069.0'], { root })

    // Assert
    assert.equal(threePart.exitCode, 1)
    assert.equal(
      threePart.err[0],
      'E_VERSION_FORMAT: "0.2.69" is not MAJOR.MINOR.PATCH.MICRO without leading zeros',
    )
    assert.equal(leadingZero.exitCode, 1)
    assert.equal(leadingZero.err[0].startsWith('E_VERSION_FORMAT:'), true)
    assert.deepEqual(await readFive(root), before)
  })
})

// protects=versions compare as integers, not text; fails_when=0.2.100.0 is judged lower than 0.2.99.0; no_claim=a bump across other part boundaries
test('0.2.100.0 counts as higher than 0.2.99.0', async () => {
  await withRoot(
    {
      version: '0.2.99.0\n',
      manifest: MANIFEST_68.replace('0.2.68', '0.2.99'),
      constants: CONSTANTS_68.replace('0.2.68', '0.2.99'),
      packageTest: PACKAGE_TEST_68.replace('0.2.68', '0.2.99'),
      changelog: CHANGELOG_68.replace('[0.2.68.0]', '[0.2.99.0]'),
    },
    async (root) => {
      // Arrange
      const argv = ['0.2.100.0']

      // Act
      const result = await runCli(argv, { root })

      // Assert
      assert.equal(result.exitCode, 0)
      const five = await readFive(root)
      assert.equal(five.version, '0.2.100.0\n')
      assert.equal(five.manifest.includes('"version": "0.2.100"'), true)
    },
  )
})

// protects=a fourth-part bump keeps the three-part places; fails_when=the manifest, constant or test line is rewritten for 0.2.68.1; no_claim=a release to a new PATCH
test('bumping the fourth part writes only VERSION and the CHANGELOG heading', async () => {
  await withRoot({}, async (root) => {
    // Arrange
    const argv = ['0.2.68.1']

    // Act
    const result = await runCli(argv, { root })

    // Assert
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.out, [
      'CHANGELOG.md: 0.2.68.0 -> 0.2.68.1',
      'VERSION: 0.2.68.0 -> 0.2.68.1',
    ])
    const five = await readFive(root)
    assert.equal(five.manifest, MANIFEST_68)
    assert.equal(five.constants, CONSTANTS_68)
  })
})

// protects=the /ship Step 12 order: gstack-version-bump wrote VERSION and the heading, this writes the rest and a rerun is a no-op; fails_when=a second heading is added, VERSION is rewritten, or the rerun writes; no_claim=gstack-version-bump itself (its heading form is copied from a measurement on a scratch repository)
test('after /ship Step 12 an equal version writes only the three lagging places, and a rerun says already at', async () => {
  // gstack-version-bump write renames "## [Unreleased]" to this form: UTC date, no suffix.
  const shipChangelog = CHANGELOG_68.replace(
    '## [0.2.68.0] - 2026-10-31 (development candidate)',
    '## [0.2.69.0] - 2026-10-31\n\n## [0.2.68.0] - 2026-10-31 (development candidate)',
  )
  await withRoot(
    { version: '0.2.69.0\n', changelog: shipChangelog },
    async (root) => {
      // Arrange
      const argv = ['0.2.69.0']

      // Act
      const first = await runCli(argv, { root })
      const second = await runCli(argv, { root })

      // Assert
      assert.equal(first.exitCode, 0)
      assert.deepEqual(first.out, [
        'extension/package.json: 0.2.68 -> 0.2.69',
        'extension/src/constants.ts: 0.2.68 -> 0.2.69',
        'extension/scripts/tests/package.test.mjs: 0.2.68 -> 0.2.69',
      ])
      assert.equal((await readFive(root)).changelog, shipChangelog)
      assert.equal(second.exitCode, 0)
      assert.deepEqual(second.out, ['already at 0.2.69.0'])
    },
  )
})

// protects=a top Unreleased heading is renamed by the bump and skipped by --check; fails_when=Unreleased stays, a second heading is added, or --check fails on a feature branch; no_claim=the date comes from the injected clock
test('a top Unreleased heading is renamed to the version, and --check skips it before the bump', async () => {
  const unreleased = CHANGELOG_68.replace(
    '## [0.2.68.0]',
    '## [Unreleased]\n\nWork in progress.\n\n## [0.2.68.0]',
  )
  await withRoot({ changelog: unreleased }, async (root) => {
    // Arrange
    const checkBefore = await runCli(['--check'], { root })

    // Act
    const bump = await runCli(['0.2.69.0'], { root })

    // Assert
    assert.equal(checkBefore.exitCode, 0)
    assert.equal(bump.exitCode, 0)
    assert.equal(bump.out[3], 'CHANGELOG.md: Unreleased -> 0.2.69.0')
    assert.equal(
      (await readFive(root)).changelog,
      unreleased.replace(
        '## [Unreleased]',
        '## [0.2.69.0] - 2026-11-01 (development candidate)',
      ),
    )
  })
})

// protects=a place beyond the target is never overwritten; fails_when=the manifest at 0.2.70 is downgraded to 0.2.69; no_claim=other places (the refusal happens before any write)
test('a place beyond the target is refused and nothing is written', async () => {
  await withRoot(
    {
      version: '0.2.69.0\n',
      manifest: MANIFEST_68.replace('0.2.68', '0.2.70'),
    },
    async (root) => {
      // Arrange
      const before = await readFive(root)

      // Act
      const result = await runCli(['0.2.69.0'], { root })

      // Assert
      assert.equal(result.exitCode, 1)
      assert.equal(result.err[0].startsWith('E_PLACE_MISMATCH:'), true)
      assert.equal(
        result.err[1],
        'extension/package.json: 0.2.70 (expected 0.2.69 or 0.2.69)',
      )
      assert.deepEqual(await readFive(root), before)
    },
  )
})

// protects=a greater target refuses a place that is neither at VERSION nor at the target; fails_when=a stray constant is silently overwritten; no_claim=which place the owner meant
test('a place at neither VERSION nor the target is refused by name for a greater target', async () => {
  await withRoot(
    { constants: CONSTANTS_68.replace("'0.2.68'", "'0.2.50'") },
    async (root) => {
      // Arrange
      const before = await readFive(root)

      // Act
      const result = await runCli(['0.2.69.0'], { root })

      // Assert
      assert.equal(result.exitCode, 1)
      assert.equal(
        result.err[1],
        'extension/src/constants.ts: 0.2.50 (expected 0.2.68 or 0.2.69)',
      )
      assert.deepEqual(await readFive(root), before)
    },
  )
})

// protects=a place whose pattern is missing or doubled stops the bump before any write; fails_when=a half-bumped tree results; no_claim=every place (the constant and the test line stand for all three)
test('a missing constant and a doubled test assertion are refused naming the file, with nothing written', async () => {
  const missing = await makeRoot({ constants: 'export const OTHER = 1\n' })
  const doubled = await makeRoot({
    packageTest: PACKAGE_TEST_68 + PACKAGE_TEST_68,
  })
  try {
    // Arrange
    const missingBefore = await readFive(missing)
    const doubledBefore = await readFive(doubled)

    // Act
    const missingResult = await runCli(['0.2.69.0'], { root: missing })
    const doubledResult = await runCli(['0.2.69.0'], { root: doubled })

    // Assert
    assert.equal(missingResult.exitCode, 1)
    assert.equal(
      missingResult.err[0],
      'E_PATTERN: extension/src/constants.ts: expected exactly one EXTENSION_VERSION constant, found 0',
    )
    assert.equal(doubledResult.exitCode, 1)
    assert.equal(
      doubledResult.err[0],
      'E_PATTERN: extension/scripts/tests/package.test.mjs: expected exactly one checked.extension.version assertion, found 2',
    )
    assert.deepEqual(await readFive(missing), missingBefore)
    assert.deepEqual(await readFive(doubled), doubledBefore)
  } finally {
    await rm(missing, { recursive: true, force: true })
    await rm(doubled, { recursive: true, force: true })
  }
})

// protects=a CHANGELOG with no version heading is named as a pattern failure; fails_when=the refusal is E_PLACE_MISMATCH or a file is written; no_claim=headings that exist but are wrong (covered by the mismatch tests)
test('a CHANGELOG with no version heading is refused with E_PATTERN naming CHANGELOG.md and nothing written', async () => {
  await withRoot(
    { changelog: '# Changelog\n\nNo releases yet.\n' },
    async (root) => {
      // Arrange
      const before = await readFive(root)

      // Act
      const result = await runCli(['0.2.69.0'], { root })

      // Assert
      assert.equal(result.exitCode, 1)
      assert.equal(
        result.err[0],
        'E_PATTERN: CHANGELOG.md: expected at least one "## [" heading, found 0',
      )
      assert.deepEqual(await readFive(root), before)
    },
  )
})

// protects=a version heading buried below another version is refused; fails_when=the bump leaves a tree --check rejects; no_claim=a heading above Unreleased (covered by the next test)
test('a target heading buried below an older version heading is refused', async () => {
  const buried = CHANGELOG_68 + '\n## [0.2.69.0] - 2026-10-29\n\nMisplaced.\n'
  await withRoot({ changelog: buried }, async (root) => {
    // Arrange
    const before = await readFive(root)

    // Act
    const result = await runCli(['0.2.69.0'], { root })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.err[0],
      'E_CHANGELOG: CHANGELOG.md: the heading "## [0.2.69.0]" sits below "## [0.2.68.0]"',
    )
    assert.deepEqual(await readFive(root), before)
  })
})

// protects=an Unreleased heading above an existing target heading is refused instead of doubling the entry; fails_when=a second 0.2.69.0 heading appears; no_claim=merging the two sections
test('an Unreleased heading above an existing target heading is refused', async () => {
  const both = CHANGELOG_68.replace(
    '## [0.2.68.0]',
    '## [Unreleased]\n\nx\n\n## [0.2.69.0] - 2026-10-31\n\ny\n\n## [0.2.68.0]',
  )
  await withRoot({ version: '0.2.69.0\n', changelog: both }, async (root) => {
    // Arrange
    const argv = ['0.2.69.0']

    // Act
    const result = await runCli(argv, { root })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.err[0],
      'E_CHANGELOG: CHANGELOG.md: "## [Unreleased]" sits above the existing "## [0.2.69.0]" heading',
    )
  })
})

// protects=VERSION is written last so a failure leaves the old VERSION and a rerun finishes the bump; fails_when=VERSION is written before the others, or the rerun doubles the heading; no_claim=a real rename failure (an injected writer fails)
test('a write that fails after three files exits 3, keeps VERSION old, and the same command finishes it', async () => {
  await withRoot({}, async (root) => {
    // Arrange
    const failOnChangelog = async (absolutePath, content) => {
      if (absolutePath.endsWith('CHANGELOG.md')) {
        throw new Error('EBUSY: file is open')
      }
      await writeFileAtomically(absolutePath, content)
    }

    // Act
    const failed = await runCli(['0.2.69.0'], {
      root,
      writeFileAtomic: failOnChangelog,
    })
    const afterFailure = await readFive(root)
    const rerun = await runCli(['0.2.69.0'], { root })

    // Assert
    assert.equal(failed.exitCode, 3)
    assert.deepEqual(failed.err, [
      'E_WRITE: could not write CHANGELOG.md (EBUSY: file is open); 3 files changed',
      'changed: extension/package.json',
      'changed: extension/src/constants.ts',
      'changed: extension/scripts/tests/package.test.mjs',
      'Fix: rerun the same command: node extension/scripts/bump-version.mjs 0.2.69.0',
    ])
    assert.equal(afterFailure.version, '0.2.68.0\n')
    assert.equal(afterFailure.constants.includes("'0.2.69'"), true)
    assert.equal(rerun.exitCode, 0)
    assert.deepEqual(rerun.out, [
      'CHANGELOG.md: 0.2.68.0 -> 0.2.69.0',
      'VERSION: 0.2.68.0 -> 0.2.69.0',
    ])
    assert.equal((await runCli(['--check'], { root })).exitCode, 0)
  })
})

// protects=a write failure before any file changed exits 2; fails_when=it exits 3 or 0; no_claim=which file failed beyond the first
test('a write that fails on the first file exits 2 and names no changed file', async () => {
  await withRoot({}, async (root) => {
    // Arrange
    const failAlways = async () => {
      throw new Error('EACCES: denied')
    }

    // Act
    const result = await runCli(['0.2.69.0'], {
      root,
      writeFileAtomic: failAlways,
    })

    // Assert
    assert.equal(result.exitCode, 2)
    assert.deepEqual(result.err, [
      'E_WRITE: could not write extension/package.json (EACCES: denied); 0 files changed',
      'Fix: rerun the same command: node extension/scripts/bump-version.mjs 0.2.69.0',
    ])
  })
})

// protects=--check names exactly the places that lag VERSION; fails_when=a lagging place is missed or an agreeing one named; no_claim=the real checkout (temporary copies)
test('--check names the four other places when only VERSION moved, and only the CHANGELOG when VERSION gets a fourth part', async () => {
  const onlyVersion = await makeRoot({ version: '0.2.69.0\n' })
  const fourthPart = await makeRoot({ version: '0.2.68.1\n' })
  try {
    // Arrange
    const argv = ['--check']

    // Act
    const movedVersion = await runCli(argv, { root: onlyVersion })
    const movedFourth = await runCli(argv, { root: fourthPart })

    // Assert
    assert.equal(movedVersion.exitCode, 1)
    assert.deepEqual(movedVersion.err, [
      'E_VERSION_MISMATCH: 4 places disagree with VERSION 0.2.69.0',
      'extension/package.json: 0.2.68 (expected 0.2.69)',
      'extension/src/constants.ts: 0.2.68 (expected 0.2.69)',
      'extension/scripts/tests/package.test.mjs: 0.2.68 (expected 0.2.69)',
      'CHANGELOG.md: first version heading is 0.2.68.0 (expected 0.2.69.0)',
      'Fix: node extension/scripts/bump-version.mjs 0.2.69.0',
    ])
    assert.equal(movedFourth.exitCode, 1)
    assert.deepEqual(movedFourth.err, [
      'E_VERSION_MISMATCH: 1 place disagrees with VERSION 0.2.68.1',
      'CHANGELOG.md: first version heading is 0.2.68.0 (expected 0.2.68.1)',
      'Fix: node extension/scripts/bump-version.mjs 0.2.68.1',
    ])
  } finally {
    await rm(onlyVersion, { recursive: true, force: true })
    await rm(fourthPart, { recursive: true, force: true })
  }
})

// protects=the real checkout's five places agree, so a partial bump fails test:package in CI; fails_when=any real place lags VERSION; no_claim=the bump itself (temporary copies cover it)
test('the real checkout has all five version places in agreement', async () => {
  // Arrange
  const argv = ['--check']

  // Act
  const result = await runCli(argv)

  // Assert
  assert.deepEqual(result.err, [])
  assert.equal(result.exitCode, 0)
  assert.match(result.out[0], /^all five places agree at \d+\.\d+\.\d+\.\d+$/)
})

// protects=--help lists usage, prerequisites, exit codes and error codes; fails_when=a code is undocumented; no_claim=the full wording
test('--help prints usage, prerequisites, exit codes and error codes and exits 0', async () => {
  // Arrange
  const argv = ['--help']

  // Act
  const result = await runCli(argv)

  // Assert
  assert.equal(result.exitCode, 0)
  assert.equal(result.out.length, 1)
  for (const expected of [
    'Usage:',
    'Prerequisites:',
    'Example:',
    'Exit codes:',
    'E_WRITE',
    'E_VERSION_MISMATCH',
    '  64  usage error',
  ]) {
    assert.equal(result.out[0].includes(expected), true, expected)
  }
})

// protects=wrong arguments exit 64 with a Fix line; fails_when=a missing version or a version with --check is accepted, or an unknown option crashes; no_claim=every option spelling
test('missing, extra and unknown arguments exit 64', async () => {
  // Arrange
  const cases = [
    [],
    ['--check', '0.2.69.0'],
    ['--bogus'],
    ['0.2.69.0', '0.2.70.0'],
  ]

  for (const argv of cases) {
    // Act
    const result = await runCli(argv)

    // Assert
    assert.equal(result.exitCode, 64, argv.join(' '))
    assert.equal(result.err[0].startsWith('E_USAGE:'), true)
    assert.equal(
      result.err.at(-1),
      'Fix: node extension/scripts/bump-version.mjs --help',
    )
  }
})

// protects=the default writer replaces a file whole and leaves no temporary file; fails_when=a .tmp file stays behind or the content differs; no_claim=Windows rename behavior
test('the atomic writer leaves the new content and no temporary file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bump-version-atomic-'))
  try {
    // Arrange
    const path = join(root, 'VERSION')
    await writeFile(path, '0.2.68.0\n')

    // Act
    await writeFileAtomically(path, '0.2.69.0\n')

    // Assert
    assert.equal(await readFile(path, 'utf8'), '0.2.69.0\n')
    assert.deepEqual(await readdir(root), ['VERSION'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// protects=a failed rename leaves no temporary file beside the target, before or after a successful rerun; fails_when=a .tmp file stays behind after the failure; no_claim=a real Windows EBUSY (a directory at the target makes the rename fail)
test('a failed atomic rename removes its temporary file and a rerun leaves none', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bump-version-atomic-fail-'))
  try {
    // Arrange
    const path = join(root, 'VERSION')
    await mkdir(path)

    // Act
    const failure = await writeFileAtomically(path, '0.2.69.0\n').then(
      () => null,
      (error) => error,
    )
    const afterFailure = await readdir(root)
    await rm(path, { recursive: true })
    await writeFile(path, '0.2.68.0\n')
    await writeFileAtomically(path, '0.2.69.0\n')

    // Assert
    assert.notEqual(failure, null)
    assert.deepEqual(afterFailure, ['VERSION'])
    assert.equal(await readFile(path, 'utf8'), '0.2.69.0\n')
    assert.deepEqual(await readdir(root), ['VERSION'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// protects=value: a malformed VERSION stops the bump before any place is rewritten, so the five places never disagree on a half-read source; fails_when=a three-part or empty VERSION is treated as the current version, or any file changes; why_new=no other test reads a VERSION that is itself malformed (the format tests refuse the target argument); seam=none; no_claim=the real VERSION file (a temporary copy stands in)
test('a VERSION that holds a three-part version is refused with E_PATTERN and nothing written', async () => {
  await withRoot({ version: '0.2.68\n' }, async (root) => {
    // Arrange
    const before = await readFive(root)

    // Act
    const result = await runCli(['0.2.69.0'], { root })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.err[0],
      'E_PATTERN: VERSION: expected one MAJOR.MINOR.PATCH.MICRO version, found "0.2.68"',
    )
    assert.deepEqual(await readFive(root), before)
  })
})

// protects=value: a doubled target heading is refused instead of leaving a CHANGELOG that --check rejects; fails_when=the bump proceeds with two "## [0.2.69.0]" headings or writes a file; why_new=the buried and Unreleased tests cover single-heading cases only; seam=none; no_claim=which of the two headings the owner should keep
test('a CHANGELOG with the target heading twice is refused with E_CHANGELOG and nothing written', async () => {
  const doubled = CHANGELOG_68.replace(
    '## [0.2.68.0]',
    '## [0.2.69.0] - 2026-10-31\n\nx\n\n## [0.2.69.0] - 2026-10-31\n\ny\n\n## [0.2.68.0]',
  )
  await withRoot({ changelog: doubled }, async (root) => {
    // Arrange
    const before = await readFive(root)

    // Act
    const result = await runCli(['0.2.69.0'], { root })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.err[0],
      'E_CHANGELOG: CHANGELOG.md: the heading "## [0.2.69.0]" appears 2 times',
    )
    assert.deepEqual(await readFive(root), before)
  })
})
