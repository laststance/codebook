import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import type * as linkWalkModule from '../utils/findLinkOnWikiPath'
import type * as startBlockModule from '../utils/findWikiUpdateStartBlock'
import { findWikiUpdateStartBlock } from '../utils/findWikiUpdateStartBlock'
import type * as lookModule from '../utils/isFolderOfItsOwn'
import type * as listingModule from '../utils/listFolderTreeWithoutFollowing'

import { answeredAtOnce } from './utils/answeredAtOnce'
import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { fileSystemWhoseRealPathFails } from './utils/fileSystemWhoseRealPathFails'
import { loadModule } from './utils/loadModule'
import { publishedWikiFixture } from './utils/publishedWikiFixture'

test('a generated page the learner edited by hand blocks the start and is named, as the real publisher refuses it too', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(
    join(wiki.outputDirectory, 'index.html'),
    '<h1>My own wording</h1>',
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, { cause: 'edited-page', paths: ['index.html'] })
    await assert.rejects(
      wiki.prepare(),
      /A published Wiki file changed after generation: index\.html/,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('a deleted generated page is reported as missing, not as edited by hand', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await rm(join(wiki.outputDirectory, 'index.html'))
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, { cause: 'missing-page', paths: ['index.html'] })
  } finally {
    await wiki.cleanup()
  }
})

test('a manifest changed after its publish blocks the start and is named, as the real publisher refuses it too', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const manifestPath = join(wiki.outputDirectory, 'codebook-wiki.json')
  await writeFile(manifestPath, `${await readFile(manifestPath, 'utf8')}\n`)
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, {
      cause: 'edited-manifest',
      paths: ['codebook-wiki.json'],
    })
    await assert.rejects(
      wiki.prepare(),
      /The published Wiki manifest changed after generation/,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('an earlier publish that left its journal behind blocks the start and names the journal', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(
    `${wiki.outputDirectory}.publish-journal.json`,
    JSON.stringify({ operation: 'publish', pid: 99_999_999 }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, {
      cause: 'unfinished-publish',
      paths: ['wiki.publish-journal.json'],
    })
    await assert.rejects(
      wiki.prepare(),
      /An earlier Wiki publication needs inspection/,
    )
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner who presses Update after a publish or a preview (`--render-only`) was stopped and left its publish lock beside the Wiki folder (since row 172); fails_when=the start check looks for the journal alone, so the update starts, the agent prepares (row 209: `--prepare` takes no lock) and writes a whole candidate, and only its preview or its publish is refused for the lock, after all that work; why_new=Cycle 0047 row 237 (P2CLA-3): the check named the journal only; seam=none (the shipped publisher prepares and refuses beside the lock); no_claim=the lock's owner, which the start check does not judge, as it does not judge the journal's
test('a publish lock a stopped publish or preview left blocks the start and names the lock, as the real publisher refuses the publish beside it', async () => {
  // Arrange: a lock written a minute before the check looks.
  const wiki = await publishedWikiFixture()
  await writeFile(
    `${wiki.outputDirectory}.publish-lock.json`,
    JSON.stringify({ pid: 99_999_999 }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      { now: () => Date.now() + 60_000 },
    )

    // Assert
    assert.deepEqual(block, {
      cause: 'held-publish-lock',
      paths: ['wiki.publish-lock.json'],
    })
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    await assert.rejects(
      wiki.publish(stage),
      /Another publish of this Wiki holds its publish lock/,
    )
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner who presses Update while a publish swaps the Wiki folders, when its journal stands beside its publish lock, or after a publish was stopped with both standing; fails_when=the start check names the journal first and says that an earlier publish did not finish, and sends the learner to the recovery, which refuses while that publish runs, although a running publish holds its lock as long as its journal stands; why_new=Cycle 0047 row 253 (P3SM-09: the cell "journal and lock both stand" had no test; P3OCR2a1-2 = P3CLA-8); seam=none; no_claim=the owner of either record, which the start check does not judge
test('a journal and a publish lock that stand together block the start with the lock, which a running publish holds as long as its journal stands', async () => {
  // Arrange: a journal and a lock, both written a minute before the check looks.
  const wiki = await publishedWikiFixture()
  await writeFile(
    `${wiki.outputDirectory}.publish-journal.json`,
    JSON.stringify({ operation: 'publish', pid: process.pid }),
  )
  await writeFile(
    `${wiki.outputDirectory}.publish-lock.json`,
    JSON.stringify({ pid: process.pid }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      { now: () => Date.now() + 60_000 },
    )

    // Assert
    assert.deepEqual(block, {
      cause: 'held-publish-lock',
      paths: ['wiki.publish-lock.json'],
    })
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner who presses Update while a publish or a preview is ending: its publish lock, written a moment ago, gets the journal's second look; fails_when=a fresh lock is reported at once as an unfinished publish although the run that holds it ends within the look, or a lock that stays at the second look is let through; why_new=Cycle 0047 row 237 (P2CLA-3); seam=the check's wait, during which the test removes the lock or leaves it; no_claim=the time a real publish holds its lock
test('a publish lock written a moment ago is looked at once more: one gone by then does not block the start, one still there does', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const lockPath = `${wiki.outputDirectory}.publish-lock.json`
  const waits: number[] = []
  try {
    await writeFile(lockPath, '{}')
    const lockThatGoes = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      {
        wait: async (delayMs) => {
          waits.push(delayMs)
          // The run that holds the lock ends while the check waits for its second look.
          await rm(lockPath)
        },
      },
    )
    await writeFile(lockPath, '{}')

    // Act
    const lockThatStays = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      {
        wait: async (delayMs) => {
          waits.push(delayMs)
        },
      },
    )

    // Assert
    assert.deepEqual(
      { lockThatGoes, lockThatStays, waits },
      {
        lockThatGoes: undefined,
        lockThatStays: {
          cause: 'held-publish-lock',
          paths: ['wiki.publish-lock.json'],
        },
        waits: [2_000, 2_000],
      },
    )
  } finally {
    await wiki.cleanup()
  }
})

test('a published Wiki nobody touched does not block the start, and the learner’s own file is not mistaken for an edit', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(wiki.learnerFile, 'my notes, changed again\n')
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.equal(block, undefined)
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the start check reads and names only files inside the Wiki folder; fails_when=an owned-file entry with `..` or an absolute path is hashed, so a file outside the Wiki is read and named to the learner as an edited page; why_new=the other start-block tests use manifests the real publisher wrote, which never list an outside path; seam=none
test('a manifest that lists files outside the Wiki folder among its owned files does not make the start check read or name them', async () => {
  // Arrange: a hand-written manifest whose owned files point beside the Wiki, once through `..` and once by an absolute path.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-')),
  )
  const output = join(directory, 'wiki')
  const outsideFile = join(directory, 'private-notes.txt')
  await mkdir(output)
  await writeFile(outsideFile, 'not a Wiki page')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      pages: [],
      assets: [],
      ownedFiles: {
        '../private-notes.txt': '0'.repeat(64),
        [outsideFile]: '0'.repeat(64),
      },
    }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(output, directory)

    // Assert
    assert.equal(block, undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a Wiki published before file hashes were recorded does not block the start', async () => {
  // Arrange
  const output = join(
    await realpath(await mkdtemp(join(tmpdir(), 'codebook-wiki-legacy-'))),
    'wiki',
  )
  await mkdir(output)
  await writeFile(join(output, 'index.html'), 'index')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({ schemaVersion: 1, pages: [], assets: [] }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(output, dirname(output))

    // Assert
    assert.equal(block, undefined)
  } finally {
    await rm(join(output, '..'), { recursive: true, force: true })
  }
})

test('a symbolic link under the Wiki folder refuses the update at its start and is named, as the real publisher refuses it', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await symlink(wiki.learnerFile, join(wiki.outputDirectory, 'shared-notes.md'))
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, {
      cause: 'special-file',
      paths: ['shared-notes.md'],
    })
    await assert.rejects(wiki.prepare(), /Wiki publication refuses a linked/)
  } finally {
    await wiki.cleanup()
  }
})

test('a generated page replaced by a link is named and is not read through the link', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const indexPath = join(wiki.outputDirectory, 'index.html')
  // The link leads to a file with exactly the published bytes: reading through it would find nothing wrong.
  const sameBytesElsewhere = join(wiki.projectRoot, 'index-copy.html')
  await writeFile(sameBytesElsewhere, await readFile(indexPath))
  await rm(indexPath)
  await symlink(sameBytesElsewhere, indexPath)
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, { cause: 'special-file', paths: ['index.html'] })
  } finally {
    await wiki.cleanup()
  }
})

test(
  'a published page replaced by a link to a named pipe is reported at once instead of holding the start',
  { timeout: 30_000 },
  async (context) => {
    // Arrange
    const wiki = await publishedWikiFixture()
    const indexPath = join(wiki.outputDirectory, 'index.html')
    const pipePath = join(wiki.projectRoot, 'never-written.pipe')
    await promisify(execFile)('mkfifo', [pipePath])
    await rm(indexPath)
    await symlink(pipePath, indexPath)
    // A read that waits on the pipe would keep this process alive, and the test's body with it: the hook runs also when the body is stopped at its time bound.
    context.after(async () => {
      await open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await wiki.cleanup()
    })

    // Act
    const block = await answeredAtOnce(
      findWikiUpdateStartBlock(wiki.outputDirectory, wiki.projectRoot),
      'the start check',
    )

    // Assert
    assert.deepEqual(block, { cause: 'special-file', paths: ['index.html'] })
  },
)

test('a manifest that is no JSON blocks the start as a manifest Codebook cannot read, before anything else reads it', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(
    join(wiki.outputDirectory, 'codebook-wiki.json'),
    '{ "schemaVersion": 1, "pages": [',
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, {
      cause: 'unreadable-manifest',
      paths: ['codebook-wiki.json'],
    })
  } finally {
    await wiki.cleanup()
  }
})

test('a publish that finishes while the start check looks does not block the start as an unfinished earlier publish', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const journalPath = `${wiki.outputDirectory}.publish-journal.json`
  // The publisher wrote its journal a moment ago and is still swapping the folders.
  await writeFile(journalPath, '{}')
  const waits: number[] = []
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      {
        wait: async (delayMs) => {
          waits.push(delayMs)
          // The publish ends while the check waits for its second look.
          await rm(journalPath)
        },
      },
    )

    // Assert
    assert.equal(block, undefined)
    assert.deepEqual(waits, [2_000])
  } finally {
    await wiki.cleanup()
  }
})

test('a journal that is still there at the second look, and one written long ago, are reported as an unfinished publish', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const journalPath = `${wiki.outputDirectory}.publish-journal.json`
  await writeFile(journalPath, '{}')
  const waits: number[] = []
  const wait = async (delayMs: number): Promise<void> => {
    waits.push(delayMs)
  }
  try {
    // Act
    const writtenJustNow = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      { wait },
    )
    const writtenAMinuteAgo = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      { wait, now: () => Date.now() + 60_000 },
    )

    // Assert
    assert.deepEqual(writtenJustNow, {
      cause: 'unfinished-publish',
      paths: ['wiki.publish-journal.json'],
    })
    assert.deepEqual(writtenAMinuteAgo, {
      cause: 'unfinished-publish',
      paths: ['wiki.publish-journal.json'],
    })
    // Only the fresh journal got a second look.
    assert.deepEqual(waits, [2_000])
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner who presses Update in a checkout whose repository carries the Wiki folder itself as a link (`.codebook/wiki` to another folder); fails_when=the start check lists through the link, so it walks the folder the link leads to before any timeout or cancel exists and tells the learner to move that folder's files out of the Wiki folder, or passes and asks an agent whose publisher refuses at its first step (row 185); why_new=Cycle 0046 row 185: the listings refused a link inside the Wiki folder and followed one at the folder's own path; seam=none (a junction on Windows, which needs no right)
test('a link at the Wiki folder’s own path refuses the update at its start with a cause of its own that names the folder, the folder it leads to is not listed, and the real publisher refuses it too', async () => {
  // Arrange: the published Wiki is moved aside and a link to it stands at the Wiki folder's path; the folder it leads to holds a link of its own, which a listing through the first link would report.
  const wiki = await publishedWikiFixture()
  const movedAside = join(wiki.projectRoot, 'wiki-moved-aside')
  try {
    await rename(wiki.outputDirectory, movedAside)
    await symlink(
      wiki.projectRoot,
      join(movedAside, 'a-link-inside'),
      'junction',
    )
    await symlink(movedAside, wiki.outputDirectory, 'junction')

    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, { cause: 'not-a-folder', paths: ['wiki'] })
    await assert.rejects(
      wiki.prepare(),
      /^Error: The Wiki folder .* is a link, a file or a folder that leads out of the project\. Nothing was written\./,
    )
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the folder outside the project that a cloned repository's `.codebook` link leads to, and the learner who presses Update there; fails_when=the start check looks at the Wiki folder alone again, finds a complete Wiki behind the link and asks an agent, whose publisher stages beyond the link (or, fixed, refuses at its first step); why_new=Cycle 0046 /ship finding F1: the start check looked at the output folder only; seam=none (a junction on Windows, which needs no right)
test('a link at a folder on the Wiki folder’s path in the project refuses the update at its start, names that folder as the learner reads it, and the real publisher refuses it too', async () => {
  // Arrange: the published Wiki's `.codebook` folder is moved out of the project and a link to it stands in its place.
  const wiki = await publishedWikiFixture()
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-')),
  )
  try {
    await rename(
      join(wiki.projectRoot, '.codebook'),
      join(outside, 'codebook-moved-out'),
    )
    await symlink(
      join(outside, 'codebook-moved-out'),
      join(wiki.projectRoot, '.codebook'),
      'junction',
    )

    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, { cause: 'linked-parent', paths: ['.codebook'] })
    await assert.rejects(
      wiki.prepare(),
      /its path passes through a link or an entry that is no folder of the project’s own/,
    )
  } finally {
    await wiki.cleanup()
    await rm(outside, { recursive: true, force: true })
  }
})

// Value: protects=the learner on Windows whose repository carries `.codebook` as a junction to a volume, which the file system layer of Node.js calls a directory; fails_when=the start check's walk trusts lstat and no longer compares the folder's real path with the project, so it asks an agent whose publisher would write beyond the junction; why_new=Cycle 0046 /ship repeat testing review TR4 (the real-path branch of F1's walk had no test); seam=a file system whose lstat calls a link a directory
test('a folder on the Wiki folder’s path in the project that lstat calls a directory although its real path leaves the project refuses the update at its start and is named', async () => {
  // Arrange: the published Wiki's `.codebook` folder is moved out of the project and a link to it stands in its place, on a file system whose look is wrong about links.
  const wiki = await publishedWikiFixture()
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-')),
  )
  const wrongLook = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
  })
  const walk = await loadModule<typeof linkWalkModule>(
    resolve(__dirname, '../utils/findLinkOnWikiPath.js'),
    { 'node:fs/promises': wrongLook.fileSystem },
  )
  const { findWikiUpdateStartBlock: findBlockWhereTheLookIsWrong } =
    await loadModule<typeof startBlockModule>(
      resolve(__dirname, '../utils/findWikiUpdateStartBlock.js'),
      { './findLinkOnWikiPath': walk },
    )
  try {
    await rename(
      join(wiki.projectRoot, '.codebook'),
      join(outside, 'codebook-moved-out'),
    )
    await symlink(
      join(outside, 'codebook-moved-out'),
      join(wiki.projectRoot, '.codebook'),
      'junction',
    )

    // Act
    const block = await findBlockWhereTheLookIsWrong(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert: the block comes from a module loaded apart, so it is compared by its text.
    assert.equal(
      JSON.stringify(block),
      '{"cause":"linked-parent","paths":[".codebook"]}',
    )
  } finally {
    await wiki.cleanup()
    await rm(outside, { recursive: true, force: true })
  }
})

// Value: protects=the learner whose project holds `.codebook` with a real path the system cannot name (a folder of another user, or a junction on Windows that `realpath` refuses); fails_when=the start check swallows the walk's error of `realpath` and lets the update start, so an agent is asked, the publisher then refuses the path, and the run uses up its whole timeout; why_new=Cycle 0046 /ship adversarial review AD17; seam=a file system whose realpath fails for one folder (src/tests/utils/fileSystemWhoseRealPathFails.ts)
for (const code of ['EACCES', 'EINVAL'] as const)
  test(`a .codebook folder whose real path the system cannot name (${code}) refuses the update at its start and is named, as a folder that leads out of the project`, async () => {
    // Arrange: the published Wiki, looked at by a start check whose walk's realpath fails for `.codebook`.
    const wiki = await publishedWikiFixture()
    const walk = await loadModule<typeof linkWalkModule>(
      resolve(__dirname, '../utils/findLinkOnWikiPath.js'),
      {
        'node:fs/promises': fileSystemWhoseRealPathFails(
          join(wiki.projectRoot, '.codebook'),
          code,
        ),
      },
    )
    const { findWikiUpdateStartBlock: findBlockWhereTheRealPathFails } =
      await loadModule<typeof startBlockModule>(
        resolve(__dirname, '../utils/findWikiUpdateStartBlock.js'),
        { './findLinkOnWikiPath': walk },
      )
    try {
      // Act
      const block = await findBlockWhereTheRealPathFails(
        wiki.outputDirectory,
        wiki.projectRoot,
      )

      // Assert: the block comes from a module loaded apart, so it is compared by its text.
      assert.equal(
        JSON.stringify(block),
        '{"cause":"linked-parent","paths":[".codebook"]}',
      )
    } finally {
      await wiki.cleanup()
    }
  })

// Value: protects=the learner who set the Wiki output to a folder outside the project and reaches it through a link of their own; fails_when=the start check refuses every link on the Wiki folder's path, also outside the project, so a configured outside output can no longer be updated; why_new=Cycle 0046 /ship finding F1: only the part of the path inside the project is held to folders of its own; seam=none (a junction on Windows)
test('an output outside the project reached through a link outside it does not block the start', async () => {
  // Arrange
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-link-')),
  )
  try {
    await mkdir(join(directory, 'project'))
    await mkdir(join(directory, 'outside/wiki'), { recursive: true })
    await symlink(
      join(directory, 'outside'),
      join(directory, 'outside-link'),
      'junction',
    )

    // Act
    const block = await findWikiUpdateStartBlock(
      join(directory, 'outside-link/wiki'),
      join(directory, 'project'),
    )

    // Assert
    assert.equal(block, undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner whose Wiki folder's path holds a file (a leftover of a tool, a checkout on a system without links, where Git writes a link as a small file); fails_when=the start check takes the path for a project without a Wiki and says "no LLM Wiki found", although the publisher refuses the entry and generating again would fail the same way (row 185); why_new=Cycle 0046 row 185: "a link, or anything else that is no folder"; seam=none
test('a file at the Wiki folder’s own path refuses the update at its start with the same cause', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    await rm(wiki.outputDirectory, { recursive: true })
    await writeFile(wiki.outputDirectory, '../elsewhere/wiki')

    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert
    assert.deepEqual(block, { cause: 'not-a-folder', paths: ['wiki'] })
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner who presses Update while a publish is finishing and the Wiki folder's path comes to hold a link in that moment (the start check waits up to two seconds for the publish before it lists the folder); fails_when=the check looks at the folder once, before its wait, and lists with a listing of its own after it, so a link that took the folder's place meanwhile is listed through and the files behind it are reported as the Wiki's (row 230); why_new=Cycle 0046 row 230: the start check lists through the utility, whose look and listing are adjacent; seam=the check's wait for a publish that is finishing, during which the folder is replaced
test('a link that takes the Wiki folder’s place after the start check first looked at it is not listed through: the check answers that the Wiki folder is no folder of its own', async () => {
  // Arrange: a publish wrote its journal a moment ago, so the check waits; during the wait the publish ends and a link to the Wiki, moved aside, stands at the Wiki folder's path. The folder behind the link holds a link of its own, which a listing through the first link would report.
  const wiki = await publishedWikiFixture()
  const journalPath = `${wiki.outputDirectory}.publish-journal.json`
  const movedAside = join(wiki.projectRoot, 'wiki-moved-aside')
  await writeFile(journalPath, '{}')
  try {
    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      {
        wait: async () => {
          await rm(journalPath)
          await rename(wiki.outputDirectory, movedAside)
          await symlink(
            wiki.projectRoot,
            join(movedAside, 'a-link-inside'),
            'junction',
          )
          await symlink(movedAside, wiki.outputDirectory, 'junction')
        },
      },
    )

    // Assert
    assert.deepEqual(block, { cause: 'not-a-folder', paths: ['wiki'] })
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner whose Wiki folder's path holds an entry that the look without following calls a directory although it leads elsewhere (on Windows a junction whose target is a volume); fails_when=the start check trusts that look, lists the folder behind the entry and reports its files as the Wiki's, or passes and asks an agent whose publisher refuses (rows 227 and 230); why_new=Cycle 0046 row 227: the start check looks and lists through the same rule as every listing; seam=a file system whose lstat calls a link a directory
test('an entry at the Wiki folder’s path that the look calls a directory although it leads elsewhere refuses the update as no folder of its own, and nothing behind it is listed', async () => {
  // Arrange: the published Wiki moved aside, with a link of its own inside, and a link to it at the Wiki folder's path, on a file system whose look is wrong about links.
  const wiki = await publishedWikiFixture()
  const movedAside = join(wiki.projectRoot, 'wiki-moved-aside')
  const wrongLook = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
  })
  const look = await loadModule<typeof lookModule>(
    resolve(__dirname, '../utils/isFolderOfItsOwn.js'),
    { 'node:fs/promises': wrongLook.fileSystem },
  )
  const listing = await loadModule<typeof listingModule>(
    resolve(__dirname, '../utils/listFolderTreeWithoutFollowing.js'),
    { 'node:fs/promises': wrongLook.fileSystem, './isFolderOfItsOwn': look },
  )
  const { findWikiUpdateStartBlock: findBlockWhereTheLookIsWrong } =
    await loadModule<typeof startBlockModule>(
      resolve(__dirname, '../utils/findWikiUpdateStartBlock.js'),
      {
        'node:fs/promises': wrongLook.fileSystem,
        './isFolderOfItsOwn': look,
        './listFolderTreeWithoutFollowing': listing,
      },
    )
  try {
    await rename(wiki.outputDirectory, movedAside)
    await symlink(
      wiki.projectRoot,
      join(movedAside, 'a-link-inside'),
      'junction',
    )
    await symlink(movedAside, wiki.outputDirectory, 'junction')

    // Act
    const block = await findBlockWhereTheLookIsWrong(
      wiki.outputDirectory,
      wiki.projectRoot,
    )

    // Assert: the block comes from a module loaded apart, so it is compared by its text.
    assert.deepEqual(
      { block: JSON.stringify(block), listings: wrongLook.listed },
      { block: '{"cause":"not-a-folder","paths":["wiki"]}', listings: [] },
    )
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner whose Wiki folder is a link while a journal of an earlier publish lies beside it; fails_when=the start check names the journal first and tells the learner to ask the chat for the publisher's recovery, which refuses the linked folder before it reads any journal (rows 185 and 230); why_new=Cycle 0046 row 230: the check's first look is the only thing that puts the folder before the journal, and no test held that order; seam=none (a junction on Windows)
test('a Wiki folder that is a link is named before the journal of an unfinished publish beside it, as the real publisher refuses the folder before it reads the journal', async () => {
  // Arrange: a journal written long ago, and a link to the Wiki, moved aside, at the Wiki folder's path.
  const wiki = await publishedWikiFixture()
  const movedAside = join(wiki.projectRoot, 'wiki-moved-aside')
  try {
    await rename(wiki.outputDirectory, movedAside)
    await symlink(movedAside, wiki.outputDirectory, 'junction')
    await writeFile(`${wiki.outputDirectory}.publish-journal.json`, '{}')

    // Act
    const block = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      wiki.projectRoot,
      {
        now: () => Date.now() + 60_000,
      },
    )

    // Assert
    assert.deepEqual(block, { cause: 'not-a-folder', paths: ['wiki'] })
    await assert.rejects(
      wiki.prepare(),
      /^Error: The Wiki folder .* is a link, a file or a folder that leads out of the project\. Nothing was written\./,
    )
  } finally {
    await wiki.cleanup()
  }
})
