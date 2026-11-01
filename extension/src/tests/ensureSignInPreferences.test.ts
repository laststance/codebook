import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ensureSignInPreferences } from '../runtimeSupport/utils/ensureSignInPreferences'

// Value: protects=the probe requirement (no password saved in the session) and cross-check 4 (no restored tab set); fails_when=a key is missing, a Chrome setting of the learner is lost, or an unreadable file stops the launch; no_claim=that Chrome honours the keys (native N70b check)
test('password saving is off and sessions do not restore, while the profile keeps its other settings', async (context) => {
  // Arrange
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-prefs-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(join(folder, 'Default'))
  await writeFile(
    join(folder, 'Default', 'Preferences'),
    JSON.stringify({
      browser: { x: 1 },
      profile: { name: 'Saved', exit_type: 'Crashed' },
    }),
  )

  // Act
  await ensureSignInPreferences(folder)

  // Assert
  assert.deepEqual(
    JSON.parse(await readFile(join(folder, 'Default', 'Preferences'), 'utf8')),
    {
      browser: { x: 1 },
      credentials_enable_service: false,
      profile: {
        name: 'Saved',
        password_manager_enabled: false,
        exit_type: 'Normal',
        exited_cleanly: true,
      },
      session: { restore_on_startup: 5 },
    },
  )
})

// Value: protects=a launch after a damaged Preferences file; fails_when=a file that is no JSON object makes the preparation throw; no_claim=Chrome rebuilding its settings
test('Preferences that are not a JSON object are replaced by the required keys', async (context) => {
  // Arrange
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-prefs-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(join(folder, 'Default'))
  await writeFile(join(folder, 'Default', 'Preferences'), '[1,2')

  // Act
  await ensureSignInPreferences(folder)

  // Assert
  assert.deepEqual(
    JSON.parse(await readFile(join(folder, 'Default', 'Preferences'), 'utf8')),
    {
      credentials_enable_service: false,
      profile: {
        password_manager_enabled: false,
        exit_type: 'Normal',
        exited_cleanly: true,
      },
      session: { restore_on_startup: 5 },
    },
  )
})
