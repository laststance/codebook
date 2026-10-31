import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { describeNextLaunchFailure } from '../utils/describeNextLaunchFailure'

/**
 * Creates a temporary project whose `package.json` has this `dev` script.
 * @returns The workspace root.
 */
async function projectWithDevScript(
  context: TestContext,
  scripts: Record<string, string>,
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-next-launch-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'stand-in', scripts }),
  )
  return workspace
}

// Value: protects=a Pages launch or compile failure tells the learner the preparation Codebook skipped and that Codebook ran Next with webpack (version and command) when the dev script runs Turbopack; fails_when=either sentence is missing, or the command differs from the launcher's; why_new=Cycle 0065 Turbopack hint and skipped preparation at failure; seam=temporary package.json; no_claim=the readiness notes (repositoryAdapterReadiness tests)
test('a Pages launch failure of a Turbopack dev script with a preparation step names the skipped step and the webpack command', async (context) => {
  // Arrange
  const workspace = await projectWithDevScript(context, {
    dev: 'prisma generate && next dev',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    workspace,
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.deepEqual(notes, [
    'Codebook starts Next with --webpack and skips 1 statement(s) before `next dev` in package.json scripts.dev. Whether that preparation is done has not been checked.',
    'Codebook runs your Next app with webpack (`next dev --webpack`) even when your dev script uses Turbopack. The page is built from the same source; a Turbopack-only loader or setting has no effect during the run.',
    'Codebook ran Next 16.4.3 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.',
  ])
})

// Value: protects=a dev script that already asks for webpack and prepares nothing adds no note; fails_when=the compatibility sentence or a preparation sentence appears; why_new=Cycle 0065 Turbopack hint only without --webpack; seam=temporary package.json; no_claim=none
test('a Pages launch failure of a plain webpack dev script adds no note', async (context) => {
  // Arrange
  const workspace = await projectWithDevScript(context, {
    dev: 'next dev --webpack -p 3000',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    workspace,
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.deepEqual(notes, [])
})
