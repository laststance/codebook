import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import { assertStableCheckout } from '../utils/assertStableCheckout.mjs'
import { buildPackage } from '../utils/buildPackage.mjs'
import { cleanPackageOutputs } from '../utils/cleanPackageOutputs.mjs'
import { inspectBundle } from '../utils/inspectBundle.mjs'
import {
  BUILD_PACKAGES,
  COMPILED_DIRECTORIES,
} from '../utils/packageConstants.mjs'
import { readBuildIdentity } from '../utils/readBuildIdentity.mjs'
import { resolvePackageDestination } from '../utils/resolvePackageDestination.mjs'
import { runPackageCommand } from '../utils/runPackageCommand.mjs'
import { withPackageOutput } from '../utils/withPackageOutput.mjs'

/** Gives publication failures an owned directory and previous artifact whose bytes must survive. @example const fixture = await outputFixture(context) */
async function outputFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-output-'))
  // A Git fixture's removal can meet ENOTEMPTY for a moment on macOS (F561), so it is retried as Node allows.
  context.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  )
  const output = join(directory, 'existing.vsix')
  await writeFile(output, 'previous good artifact')
  return { directory, output }
}

/** Supplies real Git/source identity for build-boundary failures without touching the working checkout. @example const repository = await sourceFixture(context) */
async function sourceFixture(context, objectFormat = 'sha1') {
  const { directory, output } = await outputFixture(context),
    repository = join(directory, 'repository')
  for (const name of BUILD_PACKAGES) {
    const root = join(repository, name)
    for (const part of ['src', 'fixture', 'scripts', 'patches', 'skills'])
      await mkdir(join(root, part), { recursive: true })
    for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'README.md'])
      await writeFile(join(root, file), 'fixture\n')
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: name.replaceAll('/', '-'), version: '0.2.1' }),
    )
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          strict: true,
          noEmit: true,
          types: [],
        },
        include: ['src'],
      }),
    )
    await writeFile(join(root, 'src/main.ts'), 'export const source = 1;')
  }
  await writeFile(join(repository, '.gitignore'), '**/dist/\n**/build/\n')
  await runPackageCommand(
    'git',
    ['init', '--quiet', `--object-format=${objectFormat}`],
    repository,
  )
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
  return { directory, output, repository }
}

test('failed VSIX preparation preserves the previous artifact and removes only owned scratch files', async (context) => {
  // Arrange
  const fixture = await outputFixture(context)
  // Act / Assert
  await assert.rejects(
    withPackageOutput(fixture.output, async ({ candidate }) => {
      await writeFile(candidate, 'partial output')
      throw new Error('Invalid archive')
    }),
    /Invalid archive/,
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
  assert.deepEqual(await readdir(fixture.directory), ['existing.vsix'])
})

test('a rejected final rename leaves the previous VSIX byte-for-byte intact', async (context) => {
  // Arrange
  const fixture = await outputFixture(context)
  let renames = 0
  // Act / Assert
  await assert.rejects(
    withPackageOutput(
      fixture.output,
      async ({ candidate }) => {
        await writeFile(candidate, 'validated candidate')
        return { checked: true }
      },
      async () => {
        renames++
        throw new Error('Rename denied')
      },
    ),
    /Rename denied/,
  )
  assert.equal(renames, 1)
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
  assert.deepEqual(await readdir(fixture.directory), ['existing.vsix'])
})

test('successful publication replaces only the requested VSIX and returns its validation receipt', async (context) => {
  // Arrange
  const fixture = await outputFixture(context)
  await writeFile(join(fixture.directory, 'unrelated.txt'), 'keep')
  // Act
  const receipt = await withPackageOutput(
    fixture.output,
    async ({ candidate }) => {
      await writeFile(candidate, 'validated candidate')
      return { checked: true }
    },
  )
  // Assert
  assert.deepEqual(receipt, { checked: true })
  assert.equal(await readFile(fixture.output, 'utf8'), 'validated candidate')
  assert.equal(
    await readFile(join(fixture.directory, 'unrelated.txt'), 'utf8'),
    'keep',
  )
  assert.deepEqual((await readdir(fixture.directory)).sort(), [
    'existing.vsix',
    'unrelated.txt',
  ])
})

test('an output symlink cannot redirect package publication or overwrite its target', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    alias = join(fixture.directory, 'alias.vsix')
  await symlink(fixture.output, alias)
  // Act / Assert
  await assert.rejects(
    resolvePackageDestination(fixture.repository, alias),
    /regular file/,
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
})

test('build output destinations are rejected through both literal paths and directory aliases before cleaning', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    compiled = join(fixture.repository, 'extension/dist')
  await mkdir(compiled)
  await writeFile(join(compiled, 'keep.vsix'), 'previous')
  const alias = join(fixture.directory, 'output-alias')
  await symlink(compiled, alias)
  // Act / Assert
  await assert.rejects(
    resolvePackageDestination(fixture.repository, join(compiled, 'keep.vsix')),
    /overlaps/,
  )
  await assert.rejects(
    resolvePackageDestination(fixture.repository, join(alias, 'next.vsix')),
    /overlaps/,
  )
  assert.equal(await readFile(join(compiled, 'keep.vsix'), 'utf8'), 'previous')
})

test('case-variant compiler destinations are rejected before missing output directories can be created', async (context) => {
  // Arrange: reserve the same compiler names on case-sensitive and case-insensitive filesystems.
  const fixture = await sourceFixture(context)
  // Act / Assert
  for (const path of ['extension/DIST', 'extension/DIST/runtimeSupport']) {
    await assert.rejects(
      resolvePackageDestination(
        fixture.repository,
        join(fixture.repository, path, 'candidate.vsix'),
      ),
      /overlaps/,
    )
  }
  const literal = join(await realpath(fixture.directory), 'Package Output.vsix')
  assert.equal(
    await resolvePackageDestination(fixture.repository, literal),
    literal,
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
})

test('a compilation failure stops packaging without replacing the previous VSIX', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    commands = []
  // Act / Assert
  await assert.rejects(
    buildPackage(
      fixture.repository,
      fixture.output,
      async (executable, arguments_, cwd) => {
        commands.push([executable, ...arguments_, cwd])
        if (arguments_[0] === '--version')
          return { stdout: '12.4.2\n', stderr: '' }
        throw new Error('Compilation failed')
      },
    ),
    /Compilation failed/,
  )
  assert.deepEqual(commands, [
    ['pnpm', '--version', join(fixture.repository, 'extension')],
    ['pnpm', 'build', join(fixture.repository, 'extension')],
  ])
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
  assert.deepEqual((await readdir(fixture.directory)).sort(), [
    'existing.vsix',
    'repository',
  ])
})

test('a missing pnpm executable preserves compiler outputs and the previous archive before cleanup', async (context) => {
  // Arrange: the isolated child can execute Git, but its PATH contains no pnpm executable.
  const fixture = await sourceFixture(context),
    executableDirectory = join(fixture.directory, 'executables')
  await mkdir(executableDirectory)
  await symlink(
    execFileSync('/bin/sh', ['-c', 'command -v git'], {
      encoding: 'utf8',
    }).trim(),
    join(executableDirectory, 'git'),
  )
  for (const path of COMPILED_DIRECTORIES) {
    await mkdir(join(fixture.repository, path))
    await writeFile(
      join(fixture.repository, path, 'keep.js'),
      'previous compiled output',
    )
  }
  const script = `import { buildPackage } from ${JSON.stringify(new URL('../utils/buildPackage.mjs', import.meta.url).href)};
try { await buildPackage(process.argv[1], process.argv[2]); throw new Error('Unexpected successful package'); }
catch (error) { if (error.code !== 'ENOENT' || error.path !== 'pnpm') throw error; process.stdout.write(JSON.stringify({ code: error.code, path: error.path })); }`
  // Act
  const result = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script, fixture.repository, fixture.output],
    { encoding: 'utf8', env: { ...process.env, PATH: executableDirectory } },
  )
  // Assert
  assert.deepEqual(JSON.parse(result), { code: 'ENOENT', path: 'pnpm' })
  for (const path of COMPILED_DIRECTORIES)
    assert.equal(
      await readFile(join(fixture.repository, path, 'keep.js'), 'utf8'),
      'previous compiled output',
    )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
  assert.deepEqual((await readdir(fixture.directory)).sort(), [
    'executables',
    'existing.vsix',
    'repository',
  ])
})

test('Windows package rejection preserves compiler outputs and the previous archive before any tool starts', async (context) => {
  // Arrange: this simulates only platform admission, not a native Windows build.
  const fixture = await sourceFixture(context)
  for (const path of COMPILED_DIRECTORIES) {
    await mkdir(join(fixture.repository, path))
    await writeFile(
      join(fixture.repository, path, 'keep.js'),
      'previous compiled output',
    )
  }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  let commands = 0,
    failure
  // Act
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  try {
    await buildPackage(fixture.repository, fixture.output, async () => {
      commands++
      throw new Error('Unexpected tool invocation')
    })
  } catch (error) {
    failure = error
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
  // Assert
  for (const path of COMPILED_DIRECTORIES)
    assert.equal(
      await readFile(join(fixture.repository, path, 'keep.js'), 'utf8'),
      'previous compiled output',
    )
  assert.equal(commands, 0)
  assert.match(
    failure.message,
    /Package builds require POSIX process-group cleanup/,
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
  assert.deepEqual((await readdir(fixture.directory)).sort(), [
    'existing.vsix',
    'repository',
  ])
})

/** The commit options of a fixture repository, which has no configured author. */
const FIXTURE_AUTHOR = [
  '-c',
  'user.name=Codebook Test',
  '-c',
  'user.email=codebook-test@example.invalid',
]

/**
 * Runs the package build on a fixture with a stand-in for its commands, during whose `pnpm build` the checkout is changed as the test says, and gives the failure the build ended with.
 * @param fixture - The fixture of `sourceFixture`.
 * @param changeDuringBuild - What another process does to the checkout while the stand-in build runs.
 * @returns The error the build rejected with; `undefined` when it did not reject.
 * @example
 * const failure = await failureOfBuildDuringWhich(fixture, () => writeFile(join(fixture.repository, 'docs/state.md'), 'changed\n'))
 */
async function failureOfBuildDuringWhich(fixture, changeDuringBuild) {
  return buildPackage(
    fixture.repository,
    fixture.output,
    async (_executable, arguments_) => {
      if (arguments_[0] === '--version')
        return { stdout: '12.4.2\n', stderr: '' }
      await changeDuringBuild()
      return { stdout: '', stderr: '' }
    },
  ).then(
    () => undefined,
    (error) => error,
  )
}

test('source changes during compilation invalidate the artifact instead of labeling it with an earlier snapshot', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context)
  // Act: a source of the package gets other bytes while the stand-in build runs.
  const failure = await failureOfBuildDuringWhich(fixture, () =>
    writeFile(
      join(fixture.repository, 'extension/src/main.ts'),
      'export const source = 2;',
    ),
  )
  // Assert: one sentence that names the file for Git's report and for the sources; the earlier artifact stays.
  assert.equal(
    failure?.message,
    'The checkout changed during compilation: Git reported no change before and reports changes now ("extension/src/main.ts"); the package\'s sources changed ("extension/src/main.ts"). Retry from a stable checkout.',
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
  assert.deepEqual((await readdir(fixture.directory)).sort(), [
    'existing.vsix',
    'repository',
  ])
})

// Value: protects=a maintainer or an agent who sees every test of package.test.mjs fail together finding the cause in one short sentence; fails_when=the guard says "Source inputs changed" for a document outside the extension again, or its failure carries the build's two identities (one hash per source), which filled about 750,000 bytes across the 32 tests of one shared build; why_new=Cycle 0046 row 179, found at row 124: a regenerated document flipped only the dirty state; seam=the package commands, replaced by a stand-in during which the document changes
test('a tracked document outside the extension that changes during compilation refuses the package with one sentence that names the document, and the failure carries no build identity', async (context) => {
  // Arrange: a committed document beside the extension folder.
  const fixture = await sourceFixture(context)
  await mkdir(join(fixture.repository, 'docs'))
  await writeFile(join(fixture.repository, 'docs/state.md'), 'The state.\n')
  await runPackageCommand('git', ['add', 'docs/state.md'], fixture.repository)
  await runPackageCommand(
    'git',
    [...FIXTURE_AUTHOR, 'commit', '--quiet', '-m', 'state'],
    fixture.repository,
  )
  const before = await readBuildIdentity(fixture.repository)
  // Act: the document is written again while the stand-in build runs.
  const failure = await failureOfBuildDuringWhich(fixture, () =>
    writeFile(join(fixture.repository, 'docs/state.md'), 'Another state.\n'),
  )
  const printed = inspect(failure, { depth: null })
  // Assert
  assert.equal(before.dirty, false)
  assert.equal(
    failure?.message,
    'The checkout changed during compilation: Git reported no change before and reports changes now ("docs/state.md"). Retry from a stable checkout.',
  )
  assert.deepEqual(Object.keys(failure), [])
  assert.equal(printed.includes(before.sourceHash), false)
  assert.equal(printed.includes(before.revision), false)
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
})

// Cycle 0046 row 239: the earlier path of a rename stands alone after its entry in Git's answer, and it was cut like an entry with status letters when its third character was a space, so "my file.md" was named as "file.md".
test('a tracked document renamed during compilation is named in the refusal by its new path and by its whole earlier path, also when the earlier name has a space as its third character', async (context) => {
  // Arrange: a committed document whose name has a space after its second character.
  const fixture = await sourceFixture(context)
  await writeFile(join(fixture.repository, 'my file.md'), 'A document.\n')
  await runPackageCommand('git', ['add', 'my file.md'], fixture.repository)
  await runPackageCommand(
    'git',
    [...FIXTURE_AUTHOR, 'commit', '--quiet', '-m', 'document'],
    fixture.repository,
  )
  // Act: another process renames it with Git while the stand-in build runs.
  const failure = await failureOfBuildDuringWhich(fixture, () =>
    runPackageCommand('git', ['mv', 'my file.md', 'x.md'], fixture.repository),
  )
  // Assert: the new path, then the earlier one as Git gives it.
  assert.equal(
    failure?.message,
    'The checkout changed during compilation: Git reported no change before and reports changes now ("x.md", "my file.md"). Retry from a stable checkout.',
  )
})

test('a commit made during compilation refuses the package with one sentence that names the revision before and the revision now', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context)
  const revisionOf = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fixture.repository,
      encoding: 'utf8',
    }).trim()
  const revisionBefore = revisionOf()
  // Act: another process commits, without a change of any file, while the stand-in build runs.
  const failure = await failureOfBuildDuringWhich(fixture, () =>
    runPackageCommand(
      'git',
      [...FIXTURE_AUTHOR, 'commit', '--quiet', '--allow-empty', '-m', 'later'],
      fixture.repository,
    ),
  )
  const revisionNow = revisionOf()
  // Assert: the two revisions are the fixture's own, so the sentence is built from them.
  assert.notEqual(revisionNow, revisionBefore)
  assert.equal(
    failure?.message,
    `The checkout changed during compilation: the revision went from ${revisionBefore} to ${revisionNow}. Retry from a stable checkout.`,
  )
})

test('changed bytes of a package source in a checkout that was already changed refuse the package with one sentence that names the source alone', async (context) => {
  // Arrange: an untracked note makes the checkout count as changed before the build begins.
  const fixture = await sourceFixture(context)
  await writeFile(join(fixture.repository, 'note.txt'), 'A note.\n')
  // Act
  const failure = await failureOfBuildDuringWhich(fixture, () =>
    writeFile(
      join(fixture.repository, 'extension/src/main.ts'),
      'export const source = 2;',
    ),
  )
  // Assert: Git reported changes before and after, so only the sources are named.
  assert.equal(
    failure?.message,
    'The checkout changed during compilation: the package\'s sources changed ("extension/src/main.ts"). Retry from a stable checkout.',
  )
})

test('the sentence of a checkout that changed during packaging names five of seven new files, cuts a path of 150 characters after 120 and counts the rest, and an unchanged checkout with the build’s own scratch folder passes', async (context) => {
  // Arrange: the identity before, and the build's own scratch folder with a file in it.
  const fixture = await sourceFixture(context),
    before = await readBuildIdentity(fixture.repository),
    scratch = join(fixture.repository, '.codebook-package-own')
  await mkdir(scratch)
  await writeFile(join(scratch, 'candidate.vsix'), 'candidate')
  // Act: first nothing else changes; then seven untracked files appear, the first of them with a long name.
  const unchanged = await assertStableCheckout(
    fixture.repository,
    before,
    scratch,
    'packaging',
  ).then(
    () => 'passed',
    (error) => error.message,
  )
  for (const name of [
    'a'.repeat(146) + '.txt',
    'b.txt',
    'c.txt',
    'd.txt',
    'e.txt',
    'f.txt',
    'g.txt',
  ])
    await writeFile(join(fixture.repository, name), 'new\n')
  const changed = await assertStableCheckout(
    fixture.repository,
    before,
    scratch,
    'packaging',
  ).then(
    () => 'passed',
    (error) => error.message,
  )
  // Assert
  assert.equal(unchanged, 'passed')
  assert.equal(
    changed,
    `The checkout changed during packaging: Git reported no change before and reports changes now ("${'a'.repeat(119)}…", "b.txt", "c.txt", "d.txt", "e.txt" and 2 more). Retry from a stable checkout.`,
  )
})

test('clean packaging prevents a stale declaration from making absent source compile successfully', async (context) => {
  // Arrange: first prove the incremental compiler accepts the obsolete declaration.
  const fixture = await sourceFixture(context),
    extension = join(fixture.repository, 'extension')
  await mkdir(join(extension, 'dist'))
  await writeFile(
    join(extension, 'dist/obsolete.d.ts'),
    'export declare const obsolete: string;',
  )
  await writeFile(
    join(extension, 'src/main.ts'),
    "import { obsolete } from '../dist/obsolete.js'; console.log(obsolete);",
  )
  const compiler = fileURLToPath(
    new URL('../../node_modules/typescript/lib/tsc.js', import.meta.url),
  )
  await runPackageCommand(
    process.execPath,
    [compiler, '--project', join(extension, 'tsconfig.json')],
    fixture.repository,
  )
  // Act
  await cleanPackageOutputs(fixture.repository)
  // Assert: the real compiler now detects the missing module, with the previous artifact untouched.
  await assert.rejects(
    runPackageCommand(
      process.execPath,
      [compiler, '--project', join(extension, 'tsconfig.json')],
      fixture.repository,
    ),
    (error) => error.stdout.includes('Cannot find module'),
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
})

test('cleanup refuses a redirected compiler directory and preserves the foreign contents', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    foreign = join(fixture.directory, 'foreign')
  await mkdir(foreign)
  await writeFile(join(foreign, 'keep.txt'), 'unrelated')
  await symlink(foreign, join(fixture.repository, 'extension/dist'))
  // Act / Assert
  await assert.rejects(
    cleanPackageOutputs(fixture.repository),
    /not an owned directory/,
  )
  assert.equal(await readFile(join(foreign, 'keep.txt'), 'utf8'), 'unrelated')
})

test('dependency inspection rejects a non-native emitted import before staging a package', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    metafile = {
      inputs: {},
      outputs: {
        bundle: { imports: [{ path: 'bufferutil', external: true }] },
      },
    }
  // Act / Assert
  await assert.rejects(
    inspectBundle(metafile, fixture.repository, new Map()),
    /unresolved non-native import/,
  )
})

test('package inspection rejects a VS Code import in the standalone Cursor MCP bridge', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context)
  const metafile = {
    inputs: {},
    outputs: {
      'dist/extension.js': { imports: [{ path: 'vscode', external: true }] },
      'dist/cursorMcpBridge.js': {
        imports: [{ path: 'vscode', external: true }],
      },
    },
  }
  // Act / Assert
  await assert.rejects(
    inspectBundle(metafile, fixture.repository, new Map()),
    /Cursor MCP bridge contains an editor-only import/,
  )
})

// Value: protects=the Wiki reader, which prepares every page on a worker thread that loads dist/wikiPageWorker.js, where the extension host's vscode module does not exist; fails_when=the worker's bundle may import the editor's module, so every page is refused once it loads; why_new=Cycle 0046 second /ship PERF1 residual (pages are prepared off the host's thread); seam=a metafile written by the test
test('package inspection rejects a VS Code import in the Wiki page worker', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context)
  const metafile = {
    inputs: {},
    outputs: {
      'dist/extension.js': { imports: [{ path: 'vscode', external: true }] },
      'dist/wikiPageWorker.js': {
        imports: [{ path: 'vscode', external: true }],
      },
    },
  }
  // Act / Assert
  await assert.rejects(
    inspectBundle(metafile, fixture.repository, new Map()),
    /Wiki page worker contains an editor-only import/,
  )
})

test('package inspection rejects a VS Code import in the Vite launcher', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context)
  const metafile = {
    inputs: {},
    outputs: {
      'dist/extension.js': { imports: [{ path: 'vscode', external: true }] },
      'dist/viteLauncher.js': {
        imports: [{ path: 'vscode', external: true }],
      },
    },
  }
  // Act / Assert
  await assert.rejects(
    inspectBundle(metafile, fixture.repository, new Map()),
    /Vite launcher contains an editor-only import/,
  )
})

test('a bundled dependency without its license text prevents package staging', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    dependency = join(fixture.repository, 'extension/node_modules/example')
  await mkdir(dependency, { recursive: true })
  await writeFile(
    join(dependency, 'package.json'),
    JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
  )
  const input = join(dependency, 'index.js'),
    content = Buffer.from('module.exports = 1;')
  await writeFile(input, content)
  const metafile = {
    inputs: {
      'extension/node_modules/example/index.js': { bytes: content.length },
    },
    outputs: { bundle: { imports: [] } },
  }
  // Act / Assert
  await assert.rejects(
    inspectBundle(
      metafile,
      fixture.repository,
      new Map([[await realpath(input), content]]),
    ),
    /Dependency notice missing/,
  )
})

test('input modification after the bundler read is rejected instead of recording a mismatched hash', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    input = join(fixture.repository, 'extension/dist/main.js')
  await mkdir(join(fixture.repository, 'extension/dist'))
  await writeFile(input, 'new bytes')
  const previous = Buffer.from('old bytes')
  const metafile = {
    inputs: { 'extension/dist/main.js': { bytes: previous.length } },
    outputs: { bundle: { imports: [] } },
  }
  // Act / Assert
  await assert.rejects(
    inspectBundle(
      metafile,
      fixture.repository,
      new Map([[await realpath(input), previous]]),
    ),
    /Bundle input changed/,
  )
})

test('every known compilation directory is removed while sources and output artifacts survive', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context)
  for (const path of COMPILED_DIRECTORIES) {
    await mkdir(join(fixture.repository, path))
    await writeFile(join(fixture.repository, path, 'obsolete.js'), 'stale')
  }
  // Act
  await cleanPackageOutputs(fixture.repository)
  // Assert
  for (const path of COMPILED_DIRECTORIES)
    await assert.rejects(readdir(join(fixture.repository, path)), {
      code: 'ENOENT',
    })
  assert.equal(
    await readFile(join(fixture.repository, 'extension/src/main.ts'), 'utf8'),
    'export const source = 1;',
  )
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact')
})

test('a clean repository can stage its own custom VSIX without falsely reporting changed source', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    before = await readBuildIdentity(fixture.repository)
  const output = join(fixture.repository, 'custom $() `literal`.vsix')
  assert.equal(before.dirty, false)
  // Act
  await withPackageOutput(output, async ({ candidate, directory, stage }) => {
    await writeFile(join(stage, 'package.json'), '{}')
    await writeFile(candidate, 'validated candidate')
    assert.deepEqual(
      await readBuildIdentity(fixture.repository, directory),
      before,
    )
  })
  // Assert
  assert.equal(await readFile(output, 'utf8'), 'validated candidate')
  assert.deepEqual(
    (await readdir(fixture.repository)).filter((name) =>
      name.startsWith('.codebook-package-'),
    ),
    [],
  )
})

test('excluding owned package scratch still detects unrelated files and changed source', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    before = await readBuildIdentity(fixture.repository)
  const output = join(fixture.repository, 'custom.vsix')
  // Act / Assert
  await withPackageOutput(output, async ({ candidate, directory, stage }) => {
    await writeFile(join(stage, 'package.json'), '{}')
    await writeFile(candidate, 'validated candidate')
    const unrelated = join(fixture.repository, '.codebook-package-unrelated')
    await mkdir(unrelated)
    await writeFile(join(unrelated, 'keep.txt'), 'unrelated')
    assert.equal(
      (await readBuildIdentity(fixture.repository, directory)).dirty,
      true,
    )
    await writeFile(
      join(fixture.repository, 'extension/src/main.ts'),
      'export const source = 2;',
    )
    const changed = await readBuildIdentity(fixture.repository, directory)
    assert.equal(changed.dirty, true)
    assert.notEqual(changed.sourceHash, before.sourceHash)
  })
  assert.equal(
    await readFile(
      join(fixture.repository, '.codebook-package-unrelated/keep.txt'),
      'utf8',
    ),
    'unrelated',
  )
})

test('ambient Git overrides cannot label dirty package sources with another repository identity', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    decoy = await sourceFixture(context)
  await runPackageCommand(
    'git',
    [
      '-c',
      'user.name=Codebook Test',
      '-c',
      'user.email=codebook-test@example.invalid',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'decoy',
    ],
    decoy.repository,
  )
  await writeFile(
    join(fixture.repository, 'extension/src/main.ts'),
    'export const source = 2;',
  )
  const expected = await readBuildIdentity(fixture.repository)
  const helper = new URL('../utils/readBuildIdentity.mjs', import.meta.url).href
  const script = `import { readBuildIdentity } from ${JSON.stringify(helper)}; console.log(JSON.stringify(await readBuildIdentity(process.argv[1])));`
  // Act: only the child inherits the decoy overrides; concurrent tests retain their environment.
  const actual = JSON.parse(
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, fixture.repository],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_DIR: join(decoy.repository, '.git'),
          GIT_WORK_TREE: decoy.repository,
          GIT_INDEX_FILE: join(decoy.repository, '.git/index'),
        },
      },
    ),
  )
  // Assert
  assert.equal(actual.dirty, true)
  assert.equal(actual.revision, expected.revision)
  assert.deepEqual(actual.sourceHashes, expected.sourceHashes)
  assert.equal(actual.sourceHash, expected.sourceHash)
  assert.equal((await readBuildIdentity(decoy.repository)).dirty, false)
})

test('reading package provenance preserves the Git index when only source timestamps change', async (context) => {
  // Arrange: timestamp drift normally makes git status write a refreshed index under an optional lock.
  const fixture = await sourceFixture(context),
    indexPath = join(fixture.repository, '.git/index')
  const before = await readFile(indexPath)
  const timestamp = new Date('2001-01-01T00:00:00.000Z')
  await utimes(
    join(fixture.repository, 'extension/src/main.ts'),
    timestamp,
    timestamp,
  )
  // Act
  const identity = await readBuildIdentity(fixture.repository)
  // Assert
  assert.equal(identity.dirty, false)
  assert.deepEqual(await readFile(indexPath), before)
  await assert.rejects(readFile(join(fixture.repository, '.git/index.lock')), {
    code: 'ENOENT',
  })
})

test('package provenance remains readable when unrelated untracked paths exceed the default Git output buffer', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    before = await readBuildIdentity(fixture.repository),
    files = join(fixture.repository, 'untracked')
  await mkdir(files)
  for (let index = 0; index < 6000; index++)
    await writeFile(
      join(files, `${String(index).padStart(4, '0')}-${'x'.repeat(180)}.txt`),
      'unrelated',
    )
  // Act
  const actual = await readBuildIdentity(fixture.repository)
  // Assert
  assert.equal(actual.dirty, true)
  assert.equal(actual.revision, before.revision)
  assert.equal(actual.sourceHash, before.sourceHash)
})

// Git hiding mechanisms must not remove actual compiler inputs from the clean-revision contract.
for (const exclusion of [
  'tracked-ignore',
  'repository-exclude',
  'configured-excludes-file',
]) {
  test(`selected source hidden by ${exclusion} still makes package provenance dirty`, async (context) => {
    // Arrange
    const fixture = await sourceFixture(context),
      path = 'extension/src/ignored/extra.ts'
    if (exclusion === 'tracked-ignore') {
      await writeFile(
        join(fixture.repository, '.gitignore'),
        '**/dist/\n**/build/\nextension/src/ignored/\n',
      )
      await runPackageCommand('git', ['add', '.gitignore'], fixture.repository)
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
          'ignore fixture input',
        ],
        fixture.repository,
      )
    } else if (exclusion === 'repository-exclude') {
      await writeFile(
        join(fixture.repository, '.git/info/exclude'),
        'extension/src/ignored/\n',
      )
    } else {
      const excludes = join(fixture.directory, 'user-excludes')
      await writeFile(excludes, 'extension/src/ignored/\n')
      await runPackageCommand(
        'git',
        ['config', '--local', 'core.excludesFile', excludes],
        fixture.repository,
      )
    }
    const before = await readBuildIdentity(fixture.repository)
    assert.equal(before.dirty, false)
    await mkdir(join(fixture.repository, 'extension/src/ignored'))
    await writeFile(
      join(fixture.repository, path),
      'export const hidden = 2;\n',
    )
    assert.equal(
      execFileSync('git', ['status', '--porcelain=v1'], {
        cwd: fixture.repository,
        encoding: 'utf8',
      }),
      '',
    )
    // Act
    const actual = await readBuildIdentity(fixture.repository)
    // Assert
    assert.equal(actual.dirty, true)
    assert.equal(actual.revision, before.revision)
    assert.notEqual(actual.sourceHash, before.sourceHash)
    assert.ok(
      actual.sourceHashes.includes(
        'extension/src/ignored/extra.ts:58f6035b29c59570255ef3f7b197448d52aa48d834c4ca7f097c5127ffe814ca',
      ),
    )
  })
}

// Index hints can hide both edited bytes and a deleted recursive input from ordinary status.
for (const flag of ['assume-unchanged', 'skip-worktree']) {
  for (const change of ['edited', 'deleted']) {
    test(`${change} selected source hidden by ${flag} cannot receive clean package provenance`, async (context) => {
      // Arrange
      const fixture = await sourceFixture(context),
        path = 'extension/src/main.ts',
        before = await readBuildIdentity(fixture.repository)
      assert.equal(before.dirty, false)
      await runPackageCommand(
        'git',
        ['update-index', `--${flag}`, path],
        fixture.repository,
      )
      if (change === 'edited')
        await writeFile(
          join(fixture.repository, path),
          'export const source = 2;',
        )
      else await rm(join(fixture.repository, path))
      assert.equal(
        execFileSync('git', ['status', '--porcelain=v1'], {
          cwd: fixture.repository,
          encoding: 'utf8',
        }),
        '',
      )
      // Act
      const actual = await readBuildIdentity(fixture.repository)
      // Assert
      assert.equal(actual.dirty, true)
      assert.equal(actual.revision, before.revision)
      assert.notEqual(actual.sourceHash, before.sourceHash)
      assert.equal(
        actual.sourceHashes.some((input) =>
          input.startsWith('extension/src/main.ts:'),
        ),
        change === 'edited',
      )
    })
  }
}

test('Git replacement objects cannot label different selected source bytes as the original clean revision', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    original = await readBuildIdentity(fixture.repository)
  assert.equal(original.dirty, false)
  await writeFile(
    join(fixture.repository, 'extension/src/main.ts'),
    'export const source = 2;',
  )
  await runPackageCommand('git', ['add', '.'], fixture.repository)
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
      'replacement source',
    ],
    fixture.repository,
  )
  const replacement = await readBuildIdentity(fixture.repository)
  await runPackageCommand(
    'git',
    ['replace', original.revision, replacement.revision],
    fixture.repository,
  )
  await runPackageCommand(
    'git',
    ['update-ref', 'HEAD', original.revision],
    fixture.repository,
  )
  assert.equal(
    execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: fixture.repository,
      encoding: 'utf8',
    }),
    '',
  )
  assert.equal(
    execFileSync(
      'git',
      [
        '--no-replace-objects',
        'show',
        `${original.revision}:extension/src/main.ts`,
      ],
      { cwd: fixture.repository, encoding: 'utf8' },
    ),
    'export const source = 1;',
  )
  // Act
  const actual = await readBuildIdentity(fixture.repository)
  // Assert
  assert.equal(actual.revision, original.revision)
  assert.equal(actual.dirty, true)
  assert.notEqual(actual.sourceHash, original.sourceHash)
  assert.deepEqual(actual.sourceHashes, replacement.sourceHashes)
  assert.equal(actual.sourceHash, replacement.sourceHash)
})

test('SHA-256 repositories preserve clean input identity for literal tabs and Unicode in source paths', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context, 'sha256'),
    path = 'extension/src/雪\tinput.ts'
  await writeFile(join(fixture.repository, path), 'export const source = 1;')
  await runPackageCommand('git', ['add', '--', path], fixture.repository)
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
      'literal source path',
    ],
    fixture.repository,
  )
  // Act
  const actual = await readBuildIdentity(fixture.repository)
  // Assert
  assert.equal(actual.dirty, false)
  assert.equal(actual.revision.length, 64)
  assert.ok(
    actual.sourceHashes.some((input) =>
      input.startsWith('extension/src/雪\tinput.ts:'),
    ),
  )
})

// Each accidental development entry must be rejected before the dependency inventory can accept it.
for (const path of [
  'extension/dist/tests/leaked.test.js',
  'extension/dist/client.js',
  'extension/dist/nativeRepositoryBootstrap.js',
  'extension/dist/nativeNodeTestBootstrap.js',
]) {
  test(`an accidental import of ${path} cannot enter the installed runtime bundle`, async (context) => {
    // Arrange
    const fixture = await sourceFixture(context),
      input = join(fixture.repository, path),
      content = Buffer.from('module.exports = 1;')
    await mkdir(join(input, '..'), { recursive: true })
    await writeFile(input, content)
    const metafile = {
      inputs: { [path]: { bytes: content.length } },
      outputs: { bundle: { imports: [] } },
    }
    // Act / Assert
    await assert.rejects(
      inspectBundle(
        metafile,
        fixture.repository,
        new Map([[await realpath(input), content]]),
      ),
      /Development-only bundle source/,
    )
  })
}

test('bundling a sibling application is rejected even when it has a package manifest', async (context) => {
  // Arrange
  const fixture = await sourceFixture(context),
    application = join(fixture.directory, 'external-application')
  await mkdir(application)
  await writeFile(
    join(application, 'package.json'),
    JSON.stringify({
      name: 'external-application',
      version: '1.0.0',
      license: 'MIT',
    }),
  )
  const input = join(application, 'app.js'),
    bytes = Buffer.from('module.exports = 1;')
  await writeFile(input, bytes)
  const metafile = {
    inputs: { [input]: { bytes: bytes.length } },
    outputs: { bundle: { imports: [] } },
  }
  // Act / Assert
  await assert.rejects(
    inspectBundle(
      metafile,
      fixture.repository,
      new Map([[await realpath(input), bytes]]),
    ),
    /escapes the extension repository/,
  )
})
