import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PRIVATE_DIRECTORY_MODE } from '../../constants'
import { atomicPrivateBytes } from '../../utils/atomicPrivateBytes'

/** The Preferences entries the saved session needs; `restore_on_startup` 5 opens the start page, so a restored tab set never makes the run's page choice ambiguous. */
function requiredPreferences(): Record<string, unknown> {
  return {
    credentials_enable_service: false,
    profile: {
      password_manager_enabled: false,
      exit_type: 'Normal',
      exited_cleanly: true,
    },
    session: { restore_on_startup: 5 },
  }
}

/** Says whether a value is a plain JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Sets `Default/Preferences` of a saved-session folder before each launch: password saving off, a clean exit recorded, no session restore; every other key is kept.
 * Called by the store's launch preparation (setup and runs), under the held lock, with no Chrome using the folder. A missing or non-object file is treated as empty.
 * @param profile - The saved-session folder.
 * @example
 * await ensureSignInPreferences(folder) // Default/Preferences now holds credentials_enable_service: false …
 */
export async function ensureSignInPreferences(profile: string): Promise<void> {
  const directory = join(profile, 'Default')
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const path = join(directory, 'Preferences')
  const text = await readFile(path, 'utf8').catch(() => undefined)
  let current: Record<string, unknown> = {}
  try {
    const parsed: unknown = text === undefined ? undefined : JSON.parse(text)
    if (isObject(parsed)) current = parsed
  } catch {
    // Unparseable Preferences are replaced; Chrome rebuilds what it needs.
  }
  const required = requiredPreferences()
  const merged = { ...current, ...required }
  // Nested keys keep their siblings.
  for (const key of ['profile', 'session']) {
    const existing = current[key]
    if (isObject(existing))
      merged[key] = { ...existing, ...(required[key] as object) }
  }
  await atomicPrivateBytes(path, JSON.stringify(merged))
}
