import { execFileSync } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { relative } from 'node:path'

import { packageGitOptions } from './packageGitOptions.mjs'

/**
 * Lists what Git reports as changed in a checkout, so that {@link readBuildIdentity} can call the checkout dirty and {@link assertStableCheckout} can name the paths that changed while a package was built.
 * Every tracked file that differs and every untracked file that is not ignored counts, anywhere in the repository. Only the untracked scratch folder of the publication that asks is left out. The call neither refreshes the index nor leaves an optional lock behind when it is interrupted.
 * @param repository - The repository's root.
 * @param ownedScratchDirectory - The asking publication's own scratch folder inside the repository; `undefined` when it has none.
 * @returns The entries of `git status --porcelain=v1 -z --untracked-files=all` in Git's order, each as Git prints it (two status letters, a space and the path from the root; the earlier path of a rename follows its entry as a path alone); empty for a clean checkout.
 * @example
 * await listCheckoutChanges('/work/codebook') // => [' M README.md', '?? notes.txt']
 */
export async function listCheckoutChanges(repository, ownedScratchDirectory) {
  // Ignore only this publication's untracked scratch; tracked changes and other untracked files still count.
  const scratchPrefix =
    ownedScratchDirectory === undefined
      ? undefined
      : `?? ${relative(
          await realpath(repository),
          await realpath(ownedScratchDirectory),
        )
          .split('\\')
          .join('/')}/`
  // Reading provenance must not refresh the index or leave an optional write lock after interruption.
  return execFileSync(
    'git',
    [
      '--no-optional-locks',
      '--no-replace-objects',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ],
    packageGitOptions(repository),
  )
    .split('\0')
    .filter(
      (entry) => entry && !(scratchPrefix && entry.startsWith(scratchPrefix)),
    )
}
