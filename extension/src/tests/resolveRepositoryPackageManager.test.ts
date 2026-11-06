import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { describeRepositoryPackageManager } from '../utils/describeRepositoryPackageManager'
import { resolveRepositoryPackageManager } from '../utils/resolveRepositoryPackageManager'

const folders: string[] = []
after(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

/** A repository folder holding a package.json (with the given field text, if any) and empty lockfiles. */
function repository(
  packageManager: string | undefined,
  lockfiles: string[],
): string {
  const root = mkdtempSync(join(tmpdir(), 'codebook-package-manager-'))
  folders.push(root)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(packageManager === undefined ? {} : { packageManager }),
  )
  for (const lockfile of lockfiles) writeFileSync(join(root, lockfile), '')
  return root
}

const INPUTS = {
  pathText: '/node/bin:relative:/usr/bin',
  platform: 'linux' as const,
  isProgramFile: (path: string) =>
    Promise.resolve(path === '/usr/bin/pnpm' || path === '/usr/bin/npm'),
}

// protects=the packageManager field wins over a lockfile and its +hash suffix is cut from the version; fails_when=the lockfile decides or the hash stays in the version; no_claim=that the version on PATH matches
test('takes pnpm and its version from the packageManager field even beside an npm lockfile', async () => {
  // Arrange
  const root = repository('pnpm@11.23.0+sha512.abc', ['package-lock.json'])
  // Act
  const result = await resolveRepositoryPackageManager(root, INPUTS)
  // Assert
  assert.deepEqual(result, {
    ok: true,
    name: 'pnpm',
    version: '11.23.0',
    executable: '/usr/bin/pnpm',
  })
})

// protects=without the field the single lockfile decides and the version is null; fails_when=a version is invented; no_claim=none beyond protects
test('takes npm from package-lock.json when no field is declared', async () => {
  // Arrange
  const root = repository(undefined, ['package-lock.json'])
  // Act
  const result = await resolveRepositoryPackageManager(root, INPUTS)
  // Assert
  assert.deepEqual(result, {
    ok: true,
    name: 'npm',
    version: null,
    executable: '/usr/bin/npm',
  })
})

// protects=a malformed field is unsupported and a Bun lockfile is unsupported; fails_when=either is guessed as pnpm or npm; no_claim=none beyond protects
test('refuses a malformed packageManager field and a Bun lockfile as unsupported', async () => {
  // Arrange
  const malformed = repository('pnpm', ['pnpm-lock.yaml'])
  const bun = repository(undefined, ['bun.lock'])
  // Act
  const malformedResult = await resolveRepositoryPackageManager(
    malformed,
    INPUTS,
  )
  const bunResult = await resolveRepositoryPackageManager(bun, INPUTS)
  // Assert
  assert.deepEqual(malformedResult, {
    ok: false,
    reason: 'package-manager-unsupported',
    packageManager: 'pnpm',
  })
  assert.deepEqual(bunResult, {
    ok: false,
    reason: 'package-manager-unsupported',
    packageManager: 'bun',
  })
})

// protects=no lockfile and no field is unknown and a relative PATH entry is never searched; fails_when=a program in the project folder is taken; no_claim=Windows names
test('refuses no lockfile as unknown and never searches a relative PATH entry', async () => {
  // Arrange
  const none = repository(undefined, [])
  const pnpm = repository('pnpm@11.0.0', [])
  mkdirSync(join(pnpm, 'relative'))
  // A runnable pnpm sits at the relative entry, which the current folder (the project) would resolve.
  writeFileSync(join(pnpm, 'relative', 'pnpm'), '')
  // Act
  const noneResult = await resolveRepositoryPackageManager(none, INPUTS)
  const missing = await resolveRepositoryPackageManager(pnpm, {
    pathText: 'relative',
    platform: 'linux',
    isProgramFile: (path) => Promise.resolve(existsSync(join(pnpm, path))),
  })
  // Assert
  assert.deepEqual(noneResult, {
    ok: false,
    reason: 'package-manager-unknown',
    packageManager: '',
  })
  assert.deepEqual(missing, {
    ok: false,
    reason: 'package-manager-missing',
    packageManager: 'pnpm',
  })
})

// protects=a packageManager field that is not text (an object whose toString is null) is unsupported and named by its type, never converted to text; fails_when=the resolver throws on it or quotes it; no_claim=other non-text values beyond protects
test('refuses a packageManager field that is an object as unsupported without throwing', async () => {
  // Arrange
  const root = mkdtempSync(join(tmpdir(), 'codebook-package-manager-'))
  folders.push(root)
  writeFileSync(
    join(root, 'package.json'),
    '{"packageManager":{"toString":null}}',
  )
  // Act
  const result = await resolveRepositoryPackageManager(root, INPUTS)
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'package-manager-unsupported',
    packageManager: 'object',
  })
})

// protects=a hostile packageManager field is cut to 200 characters with control characters removed before it reaches codebook_status and error details; fails_when=the raw field text is quoted whole, or an escape or newline reaches a message; no_claim=that the field is otherwise valid
test('caps the quoted packageManager field at 200 characters and strips control characters', async () => {
  // Arrange
  const hostile = repository(`evil\u001b[31m\n${'x'.repeat(400)}`, [])
  // Act
  const resolved = await resolveRepositoryPackageManager(hostile, INPUTS)
  const described = await describeRepositoryPackageManager(hostile, undefined)
  // Assert
  const expected = `evil[31m${'x'.repeat(192)}`
  assert.deepEqual(resolved, {
    ok: false,
    reason: 'package-manager-unsupported',
    packageManager: expected,
  })
  assert.deepEqual(described, {
    found: false,
    reason: 'unsupported',
    packageManager: expected,
  })
})
