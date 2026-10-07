import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
  REMOVE_LINK_OR_RENAME_IT,
  stepPastNoRealFolder,
} from '../utils/stepPastNoRealFolder'

// Value: protects=the end of every refusal of the Cursor setup for a folder that is no real folder; fails_when=a link is told as "not a folder" (a link looked at without following is never a folder), a real folder is refused, the learner is told to delete what is theirs, or the sentence names another command than the one that was run; why_new=Cycle 0046 row 277; seam=none, the real entries
test('what stands where a folder of the Cursor setup should be is told apart as nothing, a link or something that is no folder, each with its step and the command that was run, and a real folder is no refusal', async (context) => {
  // Arrange: a folder, a link to it, a file, and a path that holds nothing.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-real-folder-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'folder'))
  await symlink(join(directory, 'folder'), join(directory, 'link'))
  await writeFile(join(directory, 'file'), 'A note of the learner.\n')

  // Act
  const steps = {
    nothing: stepPastNoRealFolder(
      undefined,
      PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
      'Codebook: Remove Managed Cursor Skill',
    ),
    linkAboveTheSkillFolder: stepPastNoRealFolder(
      await lstat(join(directory, 'link')),
      PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
      'Codebook: Set Up AI Chat',
    ),
    linkAtTheSkillFolder: stepPastNoRealFolder(
      await lstat(join(directory, 'link')),
      REMOVE_LINK_OR_RENAME_IT,
      'Codebook: Remove Managed Cursor Skill',
    ),
    file: stepPastNoRealFolder(
      await lstat(join(directory, 'file')),
      REMOVE_LINK_OR_RENAME_IT,
      'Codebook: Set Up AI Chat',
    ),
    folder: stepPastNoRealFolder(
      await lstat(join(directory, 'folder')),
      PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
      'Codebook: Set Up AI Chat',
    ),
  }

  // Assert
  assert.deepEqual(steps, {
    nothing:
      'Nothing stands at that path. Run Codebook: Remove Managed Cursor Skill again.',
    linkAboveTheSkillFolder:
      "That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
    linkAtTheSkillFolder:
      'That path is a link, and Codebook leaves what it points to as it is. Remove the link or give it another name, then run Codebook: Remove Managed Cursor Skill again.',
    file: 'What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.',
    folder: undefined,
  })
})
