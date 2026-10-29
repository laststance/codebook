import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'

import { PROCESS_OUTPUT_EVENT_LIMIT_CHARS } from '../../constants'
import { cutTextToLength } from '../../utils/cutTextToLength'
import { redactSecretText } from '../../utils/redactSecretText'
import { hidePrivateRoots } from '../../utils/sanitizeCause'

/**
 * Gives a path and, when it differs, its real path, so a text that names either spelling is masked.
 * @param path - A path as the launch knows it.
 * @returns The path, plus its real path when the file system resolves one that differs.
 * @example
 * await spellingsOf('/tmp/ext') // => ['/tmp/ext', '/private/tmp/ext'] on macOS
 */
async function spellingsOf(path: string): Promise<string[]> {
  const real = await realpath(path).catch(() => path)
  return real === path ? [path] : [path, real]
}

/**
 * Masks the detail of a launch failure before it is kept as a failure's cause: secrets are masked, the extension root, the profile folders and the home folder (each in its real-path spelling too) are hidden, and the text is cut to the event limit.
 * Called by the owned launch for the profile-preparation failure, Chrome's load refusal and every other launch failure, whose messages stay fixed sentences ({@link launchOwnedExtensionBrowser}).
 * @param text - The raw detail (a system error or Chrome's own message).
 * @param roots - The extension root and the profile folders (the profile root and the made folder) to hide.
 * @returns The masked, bounded detail.
 * @example
 * await maskLaunchDetail('ENOENT: C:\\Users\\ada\\ext\\manifest.json', { runRoot: 'C:\\Users\\ada\\ext', storage: [] }) // => 'ENOENT: <workspace>\\manifest.json'
 */
export async function maskLaunchDetail(
  text: string,
  roots: { runRoot: string; storage: readonly string[] },
): Promise<string> {
  const home = homedir()
  const storage = (await Promise.all(roots.storage.map(spellingsOf))).flat()
  const masked = hidePrivateRoots(redactSecretText(text), {
    storage,
    workspace: await spellingsOf(roots.runRoot),
    home: await spellingsOf(home),
  })
  return cutTextToLength(masked, PROCESS_OUTPUT_EVENT_LIMIT_CHARS)
}
