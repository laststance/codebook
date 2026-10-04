import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

/**
 * Refuses a replaced constant that the compiled module a harness loads with {@link loadModule} never reads itself, before the harness loads it.
 *
 * Why: a replaced constants module reaches only the module {@link loadModule} evaluates. Every module that one requires loads the real constants, so a replacement the loaded module does not read changes no code, and a test built on it proves nothing.
 * A name the loaded module reads passes, also when a required module reads it too: that module keeps the real value.
 *
 * @param modulePath - The compiled module the harness is about to load (CommonJS as `tsc` emits it, where an imported constant is read as `constants_1.NAME`).
 * @param names - The names of the replaced constants.
 * @throws When the module reads one of the names nowhere; the error lists every such name.
 * @example
 * await assertConstantsReadBy(resolve(__dirname, '../../extension.js'), ['WIKI_UPDATE_WATCH_POLL_MS']) // passes
 * await assertConstantsReadBy(resolve(__dirname, '../../extension.js'), ['STORAGE_LOCK_UNWRITTEN_GRACE_MS']) // throws
 */
export async function assertConstantsReadBy(
  modulePath: string,
  names: string[],
): Promise<void> {
  const compiledModule = await readFile(modulePath, 'utf8')
  const unreadNames = names.filter(
    (name) =>
      !new RegExp(`\\bconstants_\\d+\\.${name}\\b`).test(compiledModule),
  )
  if (unreadNames.length === 0) return
  const moduleName = basename(modulePath)
  throw new Error(
    `${moduleName} does not read ${unreadNames.join(', ')} itself, and the modules it requires keep the real constants, so the replacement changes nothing. Replace a constant ${moduleName} reads, or load the module that reads it.`,
  )
}
