import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as programFileModule from '../utils/isProgramFile'

import { loadModule } from './utils/loadModule'

// Value: protects=the Git that Codebook starts on Windows, found on PATH by isProgramFile, which decides there by the file and not by an execute permission Windows does not keep: a regular file counts as a program, and a folder, a junction to a folder and a missing path do not, as Windows' own file system answers them (BF1, /ship adversarial review); fails_when=the Windows branch asks for an execute permission too, so a git.exe without one is not found and Git reads as missing, or a folder or a junction named git.exe is taken for Git; why_new=every test of the Git search and of the ps search gave its own program check, so the real one never ran on Windows; seam=the system the module reads (`process.platform` of its loaded context) over the real file system; no_claim=a link to a regular file, which counts, because the check follows a link as the system starts a program through one (Homebrew's git is a link), and the macOS and Linux branch, which the execute permission decides
test('on Windows a regular file counts as a program without an execute permission, and a folder, a junction to a folder and a missing path do not', async (context) => {
  // Arrange: a file without an execute permission, which the Windows branch must not ask for, a folder, a junction to it and a path never made.
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-program-file-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  const regularFile = join(folder, 'git.exe')
  await writeFile(regularFile, 'a program', { mode: 0o644 })
  const subfolder = join(folder, 'git-folder.exe')
  await mkdir(subfolder)
  const junction = join(folder, 'git-junction.exe')
  // A junction on Windows, which needs no right there; elsewhere the type is not read.
  await symlink(subfolder, junction, 'junction')
  const missingPath = join(folder, 'missing-git.exe')
  const onWindows = new Proxy(process, {
    get: (target, key) =>
      key === 'platform' ? 'win32' : Reflect.get(target, key, target),
  })
  const { isProgramFile } = await loadModule<typeof programFileModule>(
    resolve(__dirname, '../utils/isProgramFile.js'),
    {},
    { process: onWindows },
  )

  // Act
  const answers = {
    regularFile: await isProgramFile(regularFile),
    folder: await isProgramFile(subfolder),
    junctionToAFolder: await isProgramFile(junction),
    missingPath: await isProgramFile(missingPath),
  }

  // Assert
  assert.deepEqual(answers, {
    regularFile: true,
    folder: false,
    junctionToAFolder: false,
    missingPath: false,
  })
})
