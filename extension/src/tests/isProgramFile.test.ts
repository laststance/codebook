import assert from 'node:assert/strict'
import {
  chmod,
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
import { isProgramFile } from '../utils/isProgramFile'

import { loadModule } from './utils/loadModule'

// Value: protects=the Git that Codebook starts on Windows, found on PATH by isProgramFile, which decides there by the file and not by an execute permission Windows does not keep: a regular file counts as a program, and a folder, a junction to a folder and a missing path do not, as Windows' own file system answers them (BF1, /ship adversarial review); fails_when=the Windows branch asks for an execute permission too, so a git.exe without one is not found and Git reads as missing, or a folder or a junction named git.exe is taken for Git; why_new=every test of the Git search and of the ps search gave its own program check, so the real one never ran on Windows; seam=the system the module reads (`process.platform` of its loaded context) over the real file system; no_claim=a link to a regular file, which counts, because the check follows a link as the system starts a program through one (Homebrew's git is a link), and the macOS and Linux branch, which the execute permission decides (the next test)
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

// Value: protects=the Git and the ps that Codebook starts on macOS and Linux, found by isProgramFile, which there takes only a file this user may run: a regular file with an execute permission counts, also through a link (Homebrew's git is one), and a file without one, a folder and a missing path do not (BF2, /ship adversarial review); fails_when=the execute permission is not asked, so a git or ps file that cannot run is taken and its start fails with EACCES instead of the search going on to the next folder, or a link is not followed, so Homebrew's git reads as missing; why_new=every test of the Git search and of the ps search gave its own program check, so the real one never ran; seam=none (the real file system and this system's platform)
test(
  'on macOS and Linux a regular file counts as a program only with an execute permission, also through a link, and a folder and a missing path do not',
  {
    skip:
      process.platform === 'win32' &&
      'Windows keeps no execute permission (X_OK acts like F_OK there)',
  },
  async (context) => {
    // Arrange: the modes are set by chmod, which the umask does not narrow.
    const folder = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-program-file-')),
    )
    context.after(() => rm(folder, { recursive: true, force: true }))
    const runnableFile = join(folder, 'git')
    await writeFile(runnableFile, '#!/bin/sh\n')
    await chmod(runnableFile, 0o755)
    const fileWithoutExecutePermission = join(folder, 'git-not-runnable')
    await writeFile(fileWithoutExecutePermission, '#!/bin/sh\n')
    await chmod(fileWithoutExecutePermission, 0o644)
    const subfolder = join(folder, 'git-folder')
    await mkdir(subfolder)
    const linkToRunnableFile = join(folder, 'git-link')
    await symlink(runnableFile, linkToRunnableFile)
    const missingPath = join(folder, 'missing-git')

    // Act
    const answers = {
      runnableFile: await isProgramFile(runnableFile),
      fileWithoutExecutePermission: await isProgramFile(
        fileWithoutExecutePermission,
      ),
      folder: await isProgramFile(subfolder),
      linkToRunnableFile: await isProgramFile(linkToRunnableFile),
      missingPath: await isProgramFile(missingPath),
    }

    // Assert
    assert.deepEqual(answers, {
      runnableFile: true,
      fileWithoutExecutePermission: false,
      folder: false,
      linkToRunnableFile: true,
      missingPath: false,
    })
  },
)
