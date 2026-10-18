import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  readdir,
  mkdtemp,
  open,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { gitExecutablePath } from '../utils/gitExecutablePath'
import type * as freshnessModule from '../utils/inspectDeepWikiFreshness'
import { inspectDeepWikiFreshness } from '../utils/inspectDeepWikiFreshness'

import { childProcessThatNotesPrograms } from './utils/childProcessThatNotesPrograms'
import { loadModule } from './utils/loadModule'

const runGit = promisify(execFile)

test('Wiki freshness detects edited, deleted and added source against a clean generated revision', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-freshness-'))
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'source.ts'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const revision = revisionOutput.trim()
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  try {
    // Act / Assert
    assert.equal(
      (await inspectDeepWikiFreshness(root, included, revision, [])).status,
      'current',
    )
    await writeFile(join(root, 'source.ts'), 'export const answer = 2;\n')
    assert.deepEqual(
      (await inspectDeepWikiFreshness(root, included, revision, []))
        .changedPaths,
      ['source.ts'],
    )
    await writeFile(join(root, 'source.ts'), original)
    await writeFile(join(root, 'added.ts'), 'export const added = true;\n')
    assert.deepEqual(
      (await inspectDeepWikiFreshness(root, included, revision, [])).addedPaths,
      ['added.ts'],
    )
    await rm(join(root, 'added.ts'))
    await mkdir(join(root, '.codebook', 'wiki'), { recursive: true })
    await writeFile(
      join(root, '.codebook', 'wiki', 'generated.ts'),
      'export const generated = true;\n',
    )
    assert.equal(
      (await inspectDeepWikiFreshness(root, included, revision, [])).status,
      'current',
    )
    await rm(join(root, 'source.ts'))
    assert.deepEqual(
      (await inspectDeepWikiFreshness(root, included, revision, []))
        .changedPaths,
      ['source.ts'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a Wiki that indexes a lockfile larger than the question composer reads is current while that file is unchanged and changed once it is edited', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-freshness-'))
  const root = await realpath(directory)
  const lockfile = `lockfileVersion: '9.0'\n${'# resolved package entry\n'.repeat(12_000)}`
  await writeFile(join(root, 'pnpm-lock.yaml'), lockfile)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'pnpm-lock.yaml'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const revision = revisionOutput.trim()
  const included = [
    {
      path: 'pnpm-lock.yaml',
      sha256: createHash('sha256').update(lockfile).digest('hex'),
    },
  ]
  try {
    // Act
    const unchanged = await inspectDeepWikiFreshness(
      root,
      included,
      revision,
      [],
    )
    await writeFile(join(root, 'pnpm-lock.yaml'), `${lockfile}# one more\n`)
    const edited = await inspectDeepWikiFreshness(root, included, revision, [])

    // Assert
    assert.equal(Buffer.byteLength(lockfile), 300_023)
    assert.deepEqual(unchanged, {
      status: 'current',
      changedPaths: [],
      addedPaths: [],
    })
    assert.deepEqual(edited, {
      status: 'changed',
      changedPaths: ['pnpm-lock.yaml'],
      addedPaths: [],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('an indexed source outside the project keeps freshness unknown and is named as the one that could not be checked', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-freshness-'))
  const root = join(await realpath(directory), 'project')
  await mkdir(root)
  await writeFile(join(root, 'source.ts'), 'export const answer = 1;\n')
  await writeFile(join(root, '..', 'outside.ts'), 'export const outside = 1;\n')
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256')
        .update('export const answer = 1;\n')
        .digest('hex'),
    },
    {
      path: '../outside.ts',
      sha256: createHash('sha256')
        .update('export const outside = 1;\n')
        .digest('hex'),
    },
  ]
  try {
    // Act
    const freshness = await inspectDeepWikiFreshness(
      root,
      included,
      undefined,
      [],
    )

    // Assert
    assert.deepEqual(freshness, {
      status: 'unknown',
      changedPaths: [],
      addedPaths: [],
      reason: 'An indexed source could not be checked: ../outside.ts.',
      uncheckedPath: '../outside.ts',
      unknownCause: 'unchecked-source',
      // The folder of this test is in no Git repository.
      addedFilesUnchecked: true,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a Wiki generated from dirty source reports current until another source file is added', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-dirty-'),
  )
  const root = await realpath(directory)
  await writeFile(join(root, 'README.md'), 'Database client uses Drizzle.\n')
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'README.md'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  await writeFile(
    join(root, 'README.md'),
    'Database client uses postgres-js and Drizzle.\n',
  )
  const includedSources = [
    {
      path: 'README.md',
      sha256: createHash('sha256')
        .update('Database client uses postgres-js and Drizzle.\n')
        .digest('hex'),
    },
  ]
  try {
    // Act / Assert
    assert.equal(
      (
        await inspectDeepWikiFreshness(
          root,
          includedSources,
          revisionOutput.trim(),
          [],
        )
      ).status,
      'current',
    )
    await writeFile(
      join(root, 'new-source.ts'),
      'export const database = true;\n',
    )
    assert.deepEqual(
      (
        await inspectDeepWikiFreshness(
          root,
          includedSources,
          revisionOutput.trim(),
          [],
        )
      ).addedPaths,
      ['new-source.ts'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a Wiki of a project without a Git repository is current when every indexed source matches, and says that added files were not checked', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-no-git-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  try {
    // Act
    const result = await inspectDeepWikiFreshness(
      root,
      [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(original).digest('hex'),
        },
      ],
      undefined,
      [],
    )

    // Assert
    assert.deepEqual(result, {
      status: 'current',
      changedPaths: [],
      addedPaths: [],
      addedFilesUnchecked: true,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the update request of a folder without Git (the extension words it by this note, and a start only happens when the answer is not `current`); fails_when=the note is set on the `current` answer alone, so a changed Wiki in a folder without Git is asked for a commit hash; why_new=Cycle 0045 local review wiki-1 #1; seam=none
test('a Wiki of a project without a Git repository whose indexed source was edited is changed and still says that added files were not checked', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-no-git-'),
  )
  const root = await realpath(directory)
  await writeFile(join(root, 'source.ts'), 'export const answer = 2;\n')
  try {
    // Act
    const result = await inspectDeepWikiFreshness(
      root,
      [
        {
          path: 'source.ts',
          sha256: createHash('sha256')
            .update('export const answer = 1;\n')
            .digest('hex'),
        },
      ],
      undefined,
      [],
    )

    // Assert
    assert.deepEqual(result, {
      status: 'changed',
      changedPaths: ['source.ts'],
      addedPaths: [],
      addedFilesUnchecked: true,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Wiki freshness stays unknown in a Git repository when the manifest records no revision to prove additions against', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-unknown-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  try {
    // Act
    const result = await inspectDeepWikiFreshness(
      root,
      [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(original).digest('hex'),
        },
      ],
      undefined,
      [],
    )

    // Assert
    assert.deepEqual(result, {
      status: 'unknown',
      changedPaths: [],
      addedPaths: [],
      reason:
        'Added source files could not be checked against the generated revision.',
      unknownCause: 'no-revision',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a file added under an excluded directory keeps the Wiki current', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-excluded-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'source.ts'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  await mkdir(join(root, 'examples', 'basic'), { recursive: true })
  await writeFile(
    join(root, 'examples', 'basic', 'demo.ts'),
    'export const demo = true;\n',
  )
  await mkdir(join(root, 'examples-extra'), { recursive: true })
  await writeFile(
    join(root, 'examples-extra', 'other.ts'),
    'export const other = true;\n',
  )
  try {
    // Act
    const withoutSlash = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['examples'],
    )
    const withSlash = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['examples/', 'examples-extra/**'],
    )
    // Assert
    assert.deepEqual(
      withoutSlash.addedPaths,
      ['examples-extra/other.ts'],
      'a directory entry excludes its files but not a sibling with the same prefix',
    )
    assert.equal(withSlash.status, 'current')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the freshness label and the Update button for a source file the learner moves into the indexed tree; fails_when=Git's rename detection reports the move as a rename, which the added-files filter drops, so the Wiki reads current and Update answers "Already current"; why_new=Cycle 0045 local review wiki-1 #5; seam=none
test('a source file moved in from an excluded folder counts as added', async () => {
  // Arrange: a repository whose Wiki indexes src/a.ts and excludes examples.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-freshness-'))
  const root = await realpath(directory)
  const indexed = 'export const answer = 1;\n'
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'examples'))
  await writeFile(join(root, 'src/a.ts'), indexed)
  await writeFile(
    join(root, 'examples/x.ts'),
    'export const example = "moved into the source tree later";\n',
  )
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', '.'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const included = [
    {
      path: 'src/a.ts',
      sha256: createHash('sha256').update(indexed).digest('hex'),
    },
  ]
  try {
    // Act
    await runGit('git', ['mv', 'examples/x.ts', 'src/x.ts'], { cwd: root })
    const freshness = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['examples'],
    )

    // Assert
    assert.deepEqual(freshness, {
      status: 'changed',
      changedPaths: [],
      addedPaths: ['src/x.ts'],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a file added under a directory glob exclusion keeps the Wiki current', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-directory-glob-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'source.ts'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  await mkdir(join(root, 'src', 'fixtures'), { recursive: true })
  await writeFile(
    join(root, 'src', 'fixtures', 'invoice.ts'),
    'export const invoice = {};\n',
  )
  await mkdir(join(root, 'packages', 'web', 'dist'), { recursive: true })
  await writeFile(
    join(root, 'packages', 'web', 'dist', 'bundle.js'),
    'export {};\n',
  )
  await writeFile(
    join(root, 'src', 'fixtures-note.ts'),
    'export const note = true;\n',
  )
  try {
    // Act
    const result = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['**/fixtures', 'packages/*/dist/'],
    )
    // Assert
    assert.deepEqual(
      result.addedPaths,
      ['src/fixtures-note.ts'],
      'a directory glob excludes the files inside matching folders but not a similarly named file',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Creates a Git repository with one commit of everything in it and returns that commit's hash. */
async function commitAll(root: string): Promise<string> {
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', '.'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout } = await runGit('git', ['rev-parse', 'HEAD'], { cwd: root })
  return stdout.trim()
}

test('a Wiki of a monorepo subfolder is checked against that subfolder’s added files', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-monorepo-'),
  )
  const repository = await realpath(directory)
  const opened = join(repository, 'packages', 'app')
  const original = 'export const answer = 1;\n'
  await mkdir(join(repository, 'packages', 'other'), { recursive: true })
  await mkdir(opened, { recursive: true })
  await writeFile(join(opened, 'source.ts'), original)
  const revision = await commitAll(repository)
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  try {
    // Act
    const untouched = await inspectDeepWikiFreshness(
      opened,
      included,
      revision,
      [],
    )
    // A file added beside the opened folder is not this Wiki's; one added inside it is.
    await writeFile(
      join(repository, 'packages', 'other', 'elsewhere.ts'),
      'export {}\n',
    )
    await writeFile(join(opened, 'added.ts'), 'export {}\n')
    const afterAdditions = await inspectDeepWikiFreshness(
      opened,
      included,
      revision,
      [],
    )

    // Assert
    assert.deepEqual(untouched, {
      status: 'current',
      changedPaths: [],
      addedPaths: [],
    })
    assert.deepEqual(afterAdditions, {
      status: 'changed',
      changedPaths: [],
      addedPaths: ['added.ts'],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the backup the publisher keeps beside a visible Wiki folder is not counted as added source', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-backup-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  const revision = await commitAll(root)
  const outputDirectory = join(root, 'docs', 'wiki')
  const backup = join(
    root,
    'docs',
    'wiki.previous-3f6c2b1e-7a4d-4c0f-9b51-2d6e8f0a1c37',
  )
  await mkdir(outputDirectory, { recursive: true })
  await mkdir(backup)
  await writeFile(join(outputDirectory, 'index.html'), '<h1>Wiki</h1>')
  await writeFile(join(backup, 'index.html'), '<h1>Wiki before</h1>')
  await writeFile(join(backup, 'codebook-wiki.json'), '{}')
  try {
    // Act
    const freshness = await inspectDeepWikiFreshness(
      root,
      [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(original).digest('hex'),
        },
      ],
      revision,
      [],
      { outputDirectory },
    )

    // Assert
    assert.deepEqual(freshness, {
      status: 'current',
      changedPaths: [],
      addedPaths: [],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a freshness check reads several indexed sources at once and still names changed files in the manifest’s order', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-parallel-'),
  )
  const root = await realpath(directory)
  const names = Array.from(
    { length: 40 },
    (_, index) => `source-${String(index).padStart(2, '0')}.ts`,
  )
  for (const name of names) await writeFile(join(root, name), name)
  let inFlight = 0
  let mostInFlight = 0
  try {
    // Act
    const freshness = await inspectDeepWikiFreshness(
      root,
      // Every recorded hash is wrong, so every file reads as changed.
      names.map((name) => ({ path: name, sha256: 'a'.repeat(64) })),
      undefined,
      [],
      {
        hashFile: async (filePath) => {
          inFlight += 1
          mostInFlight = Math.max(mostInFlight, inFlight)
          // Later files answer sooner, so results arrive out of order.
          await new Promise((resolveWait) =>
            setTimeout(resolveWait, filePath.endsWith('00.ts') ? 30 : 1),
          )
          inFlight -= 1
          return 'b'.repeat(64)
        },
      },
    )

    // Assert
    assert.equal(mostInFlight, 16)
    assert.deepEqual(freshness.changedPaths, names)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test(
  'an indexed source replaced by a named pipe is named as the file that could not be checked, at once instead of holding the freshness check',
  { timeout: 2_000 },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(
      join(tmpdir(), 'codebook-wiki-freshness-pipe-'),
    )
    const root = await realpath(directory)
    const pipePath = join(root, 'source.ts')
    await runGit('mkfifo', [pipePath])
    // A read that waits on the pipe would keep this process alive, and the test's body with it: the hook runs also when the body is stopped at its time bound.
    context.after(async () => {
      await open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await rm(directory, { recursive: true, force: true })
    })

    // Act
    const freshness = await inspectDeepWikiFreshness(
      root,
      [{ path: 'source.ts', sha256: 'a'.repeat(64) }],
      undefined,
      [],
    )

    // Assert
    assert.deepEqual(freshness, {
      status: 'unknown',
      changedPaths: [],
      addedPaths: [],
      reason: 'An indexed source could not be checked: source.ts.',
      uncheckedPath: 'source.ts',
      unknownCause: 'unchecked-source',
      // The folder of this test is in no Git repository.
      addedFilesUnchecked: true,
    })
  },
)

// Value: protects=the rule that a link out of the project is never hashed, on Windows where the linked file can be on another drive; fails_when=the relative path to another drive, which is absolute and does not start with "..", is taken for a path inside the project; why_new=Cycle 0045 local review wiki-1 #10; seam=the path module (Windows rules on this host), the link's resolution and Git, since no Linux folder has a second drive
test('an indexed source that is a link to a file on another drive is not hashed and is named as the one that could not be checked', async () => {
  // Arrange: the check runs with Windows path rules; the indexed source resolves to a file on drive D of a project on drive C.
  const hashedFiles: string[] = []
  const { inspectDeepWikiFreshness: inspectOnWindows } = await loadModule<
    typeof freshnessModule
  >(resolve(__dirname, '../utils/inspectDeepWikiFreshness.js'), {
    'node:path': win32,
    'node:fs/promises': {
      realpath: async () => String.raw`D:\secrets\linked.ts`,
    },
    // The project is in no Git repository.
    'node:child_process': {
      execFile: (
        _command: string,
        _arguments: string[],
        _options: object,
        callback: (error: Error) => void,
      ) => {
        callback(
          Object.assign(new Error('git failed'), {
            stderr: 'fatal: not a git repository',
          }),
        )
      },
    },
  })

  // Act
  const freshness = await inspectOnWindows(
    String.raw`C:\repo`,
    [{ path: 'linked.ts', sha256: 'a'.repeat(64) }],
    undefined,
    [],
    {
      hashFile: async (filePath) => {
        hashedFiles.push(filePath)
        return 'a'.repeat(64)
      },
    },
  )

  // Assert
  assert.deepEqual(hashedFiles, [])
  // The answer was built in the loaded module's own context, so its plain data is compared.
  assert.deepEqual(JSON.parse(JSON.stringify(freshness)), {
    status: 'unknown',
    changedPaths: [],
    addedPaths: [],
    reason: 'An indexed source could not be checked: linked.ts.',
    uncheckedPath: 'linked.ts',
    unknownCause: 'unchecked-source',
    addedFilesUnchecked: true,
  })
})

// Value: protects=the learner's rights when the opened project carries a program named git: the Wiki's freshness check starts every Git command by the absolute path the lookup found on PATH alone, never by the bare name that Windows looks up in the project folder first (SX2, Cycle 0046 repeat security review); fails_when=a Git command is started by its bare name with the project as its folder; why_new=the freshness check started `git` by its bare name; seam=a stand-in for `node:child_process` of the loaded check, which notes every program it starts and runs it
test('the Wiki freshness check starts every Git command by the absolute path found on PATH, never by the bare name', async () => {
  // Arrange: a committed repository, and the check loaded with a child process module that notes its programs.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-git-'),
  )
  const root = await realpath(directory)
  const source = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), source)
  const revision = await commitAll(root)
  const noted = childProcessThatNotesPrograms()
  const { inspectDeepWikiFreshness: inspectNotingPrograms } = await loadModule<
    typeof freshnessModule
  >(resolve(__dirname, '../utils/inspectDeepWikiFreshness.js'), {
    'node:child_process': noted.childProcess,
  })
  try {
    // Act
    await inspectNotingPrograms(
      root,
      [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
      revision,
      [],
    )

    // Assert: rev-parse, then diff-index, ls-files --deleted and ls-files --others.
    const git = await gitExecutablePath()
    assert.deepEqual(
      { started: noted.started, gitIsAbsolute: isAbsolute(git) },
      { started: [git, git, git, git], gitIsAbsolute: true },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner's machine when the opened folder is a repository that a clone did not make (an archive, a copy, a share) and whose own config names an fsmonitor hook: the freshness check's Git commands in that folder (`rev-parse`, `diff`, `ls-files --others`) run with the fsmonitor switched off, so the hook never runs (R7, /ship third review, Claude adversarial #7; probed with git 2.53.0); fails_when=a Git command of the check runs without `-c core.fsmonitor=false`, and Git starts the repository's hook with the learner's rights; why_new=only source discovery passed that configuration; seam=none (real Git, a real hook script that notes each start)
test('the Wiki freshness check runs no fsmonitor hook that the repository’s own config names', async (context) => {
  // Arrange: a committed repository with an added file, whose config names a hook that writes a file when Git starts it.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-fsmonitor-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(await realpath(directory), 'project')
  await mkdir(root)
  const source = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), source)
  const revision = await commitAll(root)
  await writeFile(join(root, 'added.ts'), 'export const added = 1;\n')
  const hookRan = join(directory, 'fsmonitor-ran')
  const hook = join(directory, 'fsmonitor-hook.sh')
  await writeFile(hook, `#!/bin/sh\necho ran >> '${hookRan}'\n`)
  await chmod(hook, 0o755)
  await runGit('git', ['config', 'core.fsmonitor', hook], { cwd: root })
  // Act
  const freshness = await inspectDeepWikiFreshness(
    root,
    [
      {
        path: 'source.ts',
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    ],
    revision,
    [],
  )
  // Assert: the check still finds the added file.
  assert.deepEqual(
    {
      status: freshness.status,
      hookRan: await access(hookRan).then(
        () => true,
        () => false,
      ),
    },
    { status: 'changed', hookRan: false },
  )
})

// Value: protects=the learner's Wiki page on a machine without Git: the lookup's "spawn git ENOENT" becomes the freshness check's own answer, unknown with the cause `git-missing` and the sentence that Git is not installed, instead of an error the page cannot show (SX2; TT15, the third testing review); fails_when=the lookup's error escapes the check, for example when the lookup moves out of the guarded step; why_new=the lookup's test checked only its own error, and no caller test ran without Git; seam=the Git lookup the loaded check is given, which fails as a Git that cannot be started fails
test('the Wiki freshness check on a machine whose PATH holds no Git answers unknown because Git is missing', async (context) => {
  // Arrange: a project whose one indexed source is unchanged; the Git lookup finds none.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-no-git-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const root = await realpath(directory)
  const source = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), source)
  const { inspectDeepWikiFreshness: inspectWithoutGit } = await loadModule<
    typeof freshnessModule
  >(resolve(__dirname, '../utils/inspectDeepWikiFreshness.js'), {
    './gitExecutablePath': {
      gitExecutablePath: async () => {
        throw Object.assign(new Error('spawn git ENOENT'), {
          code: 'ENOENT',
          errno: -2,
          syscall: 'spawn git',
          path: 'git',
        })
      },
    },
  })
  // Act
  const freshness = await inspectWithoutGit(
    root,
    [
      {
        path: 'source.ts',
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    ],
    '0123456789abcdef0123456789abcdef01234567',
    [],
  )
  // Assert
  assert.deepEqual(
    {
      status: freshness.status,
      unknownCause: freshness.unknownCause,
      reason: freshness.reason,
    },
    {
      status: 'unknown',
      unknownCause: 'git-missing',
      reason:
        'Git is not installed, so added source files could not be checked.',
    },
  )
})

/**
 * Writes a program for a test's repository config that notes each start in a folder of its own and passes its input through, as a clean filter, a textconv driver or an external diff would run.
 * @param folder - The folder of the program and its notes.
 * @param name - The program's name, also the name of its note.
 * @returns The program's path.
 * @example
 * await notingProgram(folder, 'clean') // => '/tmp/x/clean.sh'; a start writes /tmp/x/clean-ran
 */
async function notingProgram(folder: string, name: string): Promise<string> {
  const program = join(folder, `${name}.sh`)
  await writeFile(
    program,
    `#!/bin/sh\necho ran >> '${join(folder, `${name}-ran`)}'\ncat\n`,
  )
  await chmod(program, 0o755)
  return program
}

// Value: protects=the learner's machine when the opened folder is a repository that a clone did not make and whose own config and attributes name a clean filter, a textconv driver and an external diff, in .gitattributes and in .git/info/attributes (which no attribute source of Git replaces): the freshness check compares the index with the revision and reads no file of the working tree, so none of them runs, and the added files are still found, a file staged and then deleted from the working tree not among them (BB2, the fixes of the third review; probed with git 2.53.0); fails_when=the check compares the working tree with the revision, so Git hashes a changed file through the repository's clean filter, or a staged file the working tree no longer holds counts as added; why_new=R7 switched off the fsmonitor hook alone; seam=none (real Git, real programs that note each start)
test('the Wiki freshness check runs no clean filter, textconv driver or external diff of the repository, and still finds the files added since the generation', async (context) => {
  // Arrange: a committed repository with an indexed source and another tracked file; the repository's config and both of its attribute files name three programs; then the tracked file changes, one file is staged, one staged and deleted again, one left untracked.
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-drivers-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const notes = join(await realpath(directory), 'notes')
  await mkdir(notes)
  const root = join(await realpath(directory), 'project')
  await mkdir(root)
  const source = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), source)
  await writeFile(join(root, 'other.ts'), 'export const other = 1;\n')
  const revision = await commitAll(root)
  await runGit(
    'git',
    ['config', 'filter.probe.clean', await notingProgram(notes, 'clean')],
    { cwd: root },
  )
  await runGit(
    'git',
    ['config', 'diff.probe.textconv', await notingProgram(notes, 'textconv')],
    { cwd: root },
  )
  await runGit(
    'git',
    ['config', 'diff.external', await notingProgram(notes, 'external-diff')],
    { cwd: root },
  )
  await writeFile(
    join(root, '.gitattributes'),
    '*.ts filter=probe diff=probe\n',
  )
  await writeFile(
    join(root, '.git', 'info', 'attributes'),
    '*.ts filter=probe diff=probe\n',
  )
  await writeFile(join(root, 'other.ts'), 'export const other = 2;\n')
  await writeFile(join(root, 'staged.ts'), 'export const staged = 1;\n')
  await writeFile(
    join(root, 'staged-then-deleted.ts'),
    'export const gone = 1;\n',
  )
  await runGit(
    'git',
    [
      '-c',
      'filter.probe.clean=cat',
      'add',
      'staged.ts',
      'staged-then-deleted.ts',
    ],
    { cwd: root },
  )
  await rm(join(root, 'staged-then-deleted.ts'))
  await writeFile(join(root, 'untracked.ts'), 'export const untracked = 1;\n')
  // Act
  const freshness = await inspectDeepWikiFreshness(
    root,
    [
      {
        path: 'source.ts',
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    ],
    revision,
    [],
  )
  // Assert
  assert.deepEqual(
    {
      status: freshness.status,
      addedPaths: freshness.addedPaths,
      ran: (await readdir(notes)).filter((name) => name.endsWith('-ran')),
    },
    {
      status: 'changed',
      addedPaths: ['staged.ts', 'untracked.ts'],
      ran: [],
    },
  )
})
