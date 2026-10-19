import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findLinkOnWikiPath } from '../utils/findLinkOnWikiPath'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'

// Value: protects=the rule the publisher and the reader share that inside the project only a folder of the project's own leads to the Wiki folder; fails_when=the look without following (lstat) is dropped from the walk, so a .codebook link to another folder of the same project passes, because its real path stays in the project; why_new=second /ship testing specialist TEST4; seam=none; no_claim=links that leave the project, which the real-path check refuses and the reader's and the update start's tests cover
test("a .codebook link to another folder of the same project is named as the link on the Wiki folder's path", async (context) => {
  // Arrange: a project whose .codebook is a link to its own docs folder, which holds a wiki folder.
  const project = await mkdtemp(join(tmpdir(), 'codebook-wiki-path-'))
  try {
    await mkdir(join(project, 'docs', 'wiki'), { recursive: true })
    if (
      !(await createLinkIfAllowed(
        join(project, 'docs'),
        join(project, '.codebook'),
      ))
    )
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const found = await findLinkOnWikiPath(
      join(project, '.codebook', 'wiki'),
      project,
    )

    // Assert
    assert.equal(found, join(project, '.codebook'))
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

// Value: protects=the same rule for a .codebook that is a file, which a cloned repository can carry; fails_when=the walk judges the entry by its real path alone, which a file inside the project passes, so the Wiki folder's path is reported clear and the publisher's refusal is not met beforehand; why_new=second /ship testing specialist TEST4; seam=none; no_claim=folders missing on the path, which the publisher creates
test("a .codebook file is named as what stands on the Wiki folder's path where a folder of the project must be", async () => {
  // Arrange: a project that carries .codebook as a plain file.
  const project = await mkdtemp(join(tmpdir(), 'codebook-wiki-path-'))
  try {
    await writeFile(join(project, '.codebook'), 'not a folder')

    // Act
    const found = await findLinkOnWikiPath(
      join(project, '.codebook', 'wiki'),
      project,
    )

    // Assert
    assert.equal(found, join(project, '.codebook'))
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
