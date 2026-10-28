import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Reads every file of a history folder as one text, so a test can assert that a planted secret reached none of them.
 * @param folder - The history's folder.
 * @returns The files' contents joined.
 * @example assert.doesNotMatch(await readHistoryFolderText(folder), /canary/)
 */
export async function readHistoryFolderText(folder: string): Promise<string> {
  const names = await readdir(folder)
  const texts = await Promise.all(
    // A file removed between the listing and the read (the writer's own record, removed after the seal) holds nothing to leak.
    names.map((name) => readFile(join(folder, name), 'utf8').catch(() => '')),
  )
  return texts.join('\n')
}
