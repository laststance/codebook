import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

/** Isolates the actual package CLI for argument tests; the recording builder avoids compilation and publication. @example const fixture = await commandFixture(context) */
async function commandFixture(context) {
  const repository = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-package-cli-')),
  )
  context.after(() => rm(repository, { recursive: true, force: true }))
  const scripts = join(repository, 'extension/scripts'),
    caller = join(repository, 'caller directory')
  await mkdir(join(scripts, 'utils'), { recursive: true })
  await mkdir(caller)
  await writeFile(
    join(repository, 'extension/package.json'),
    '{"version":"0.2.1"}',
  )
  await writeFile(
    join(scripts, 'package.mjs'),
    await readFile(new URL('../package.mjs', import.meta.url)),
  )
  await writeFile(
    join(scripts, 'utils/buildPackage.mjs'),
    `import { writeFile } from 'node:fs/promises';
export async function buildPackage(repository, destination) { await writeFile(repository + '/builder-called.json', JSON.stringify({destination})); return {destination}; }
`,
  )
  return {
    repository,
    caller,
    command: join(scripts, 'package.mjs'),
    marker: join(repository, 'builder-called.json'),
  }
}

for (const [name, arguments_] of [
  ['empty output', ['--out', '']],
  ['missing output value', ['--out']],
  ['unknown option', ['--output', 'file.vsix']],
]) {
  test(`package CLI rejects ${name} before invoking the builder`, async (context) => {
    // Arrange
    const fixture = await commandFixture(context)
    // Act
    const result = spawnSync(
      process.execPath,
      [fixture.command, ...arguments_],
      { cwd: fixture.caller, encoding: 'utf8' },
    )
    // Assert
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Usage: pnpm package/)
    await assert.rejects(readFile(fixture.marker), { code: 'ENOENT' })
  })
}

for (const pathKind of [
  'omitted',
  'relative with leading spaces',
  'absolute with spaces',
]) {
  test(`package CLI preserves the ${pathKind} output destination`, async (context) => {
    // Arrange
    const fixture = await commandFixture(context),
      relative = ' directory with spaces / codebook preview .vsix',
      absolute = join(
        fixture.repository,
        'custom output',
        'Codebook build.vsix',
      )
    const arguments_ =
      pathKind === 'omitted'
        ? []
        : [
            '--out',
            pathKind === 'relative with leading spaces' ? relative : absolute,
          ]
    const expected =
      pathKind === 'omitted'
        ? join(fixture.repository, 'artifacts/packages/codebook-0.2.1.vsix')
        : pathKind === 'relative with leading spaces'
          ? resolve(fixture.caller, relative)
          : absolute
    // Act
    const result = spawnSync(
      process.execPath,
      [fixture.command, ...arguments_],
      { cwd: fixture.caller, encoding: 'utf8' },
    )
    // Assert
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).destination, expected)
    assert.deepEqual(JSON.parse(await readFile(fixture.marker, 'utf8')), {
      destination: expected,
    })
  })
}
