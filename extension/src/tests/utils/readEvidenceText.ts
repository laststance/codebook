import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isMissingEntryError } from '../../utils/isMissingEntryError'

/**
 * Reads every non-image file under a run's evidence folder, subfolders included, as one text, so a test can search all of it for a secret.
 * @param folder - The run's artifact folder.
 * @returns The files' contents joined; a file removed between the listing and the read counts as empty.
 * @example assert.equal((await readEvidenceText(run.view().artifactDirectory)).includes(PASSWORD), false)
 */
export async function readEvidenceText(folder: string): Promise<string> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  })
  const texts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith('.png'))
      .map((entry) =>
        readFile(join(entry.parentPath, entry.name), 'utf8').catch(
          (error: unknown) => {
            // A live run renames its atomic-write scratch file (`runtime.json.tmp`) after the listing; its text lives on in the renamed file.
            if (isMissingEntryError(error)) return ''
            throw error
          },
        ),
      ),
  )
  return texts.join('\n')
}
