import assert from 'node:assert/strict'
import fsPromises, {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { searchRepositoryVitest } from '../utils/searchRepositoryVitest'

/**
 * Makes an empty repository folder by its real path, removed when the test ends.
 * @param context - Removes the folder when the test ends.
 * @returns The repository's real root.
 * @example const root = await repository(context)
 */
async function repository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vitest-search-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Installs a stand-in Vitest in `<folder>/node_modules/vitest`: its package file with the version, and its program unless told otherwise.
 * @param folder - The folder whose `node_modules` holds it.
 * @param version - The version its package file names.
 * @param withProgram - Whether `vitest.mjs` exists.
 * @example await installVitest(join(root, 'packages/a'), '5.0.2')
 */
async function installVitest(
  folder: string,
  version: string,
  withProgram = true,
): Promise<void> {
  await mkdir(join(folder, 'node_modules', 'vitest'), { recursive: true })
  await writeFile(
    join(folder, 'node_modules', 'vitest', 'package.json'),
    JSON.stringify({ name: 'vitest', version }),
  )
  if (withProgram)
    await writeFile(join(folder, 'node_modules', 'vitest', 'vitest.mjs'), '')
}

const FIRST_FOUND = (path: string, state: string) =>
  `node-test needs Vitest 4 or later at the repository root or in a package one or two levels below it; the first one found, ${path}/node_modules/vitest, ${state}. Ask the learner to install or upgrade it, then call codebook_status again. A test in a deeper package can still start: the start checks that test's own package.`

// Value: protects=codebook_status reporting node-test ready for a repository whose only Vitest 4+ is in a package two levels below the root; fails_when=such a repository reads not ready, as at 83a07385; why_new=task 4 (R1, AC 5); seam=real folders; no_claim=the start's own check (planNodeTestExecution tests)
test('a repository whose only usable Vitest lies in a package two levels down is ready', async (context) => {
  // Arrange
  const root = await repository(context)
  await installVitest(join(root, 'packages', 'query-core'), '5.0.5')

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, { vitestSearch: 'usable' })
})

// Value: protects=the sentence for a repository without any Vitest, which asks for an install and says a deeper package can still start; fails_when=the sentence changes or vitestSearch is not none; why_new=task 4 (R2, R8); seam=real folders; no_claim=other sentences
test('a repository without any Vitest names none found and what to ask the learner', async (context) => {
  // Arrange
  const root = await repository(context)
  await mkdir(join(root, 'packages', 'a'), { recursive: true })

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, {
    vitestSearch: 'none',
    missing:
      "node-test needs Vitest 4 or later at the repository root or in a package one or two levels below it; none was found. Ask the learner to install Vitest, then call codebook_status again. A test in a deeper package can still start: the start checks that test's own package.",
  })
})

// Value: protects=each of the four forms of the first unusable Vitest found: too old, unreadable, outside the repository, without its program; fails_when=a form changes, names another candidate, or vitestSearch is not unusable; why_new=task 4 (R3-R5, R8); seam=real folders and a link; no_claim=Windows junctions
test('the first unusable Vitest found is named in its own form', async (context) => {
  // Arrange
  const tooOld = await repository(context)
  const unreadable = await repository(context)
  const linked = await repository(context)
  const withoutProgram = await repository(context)
  const outside = await repository(context)
  await installVitest(tooOld, '3.2.4')
  await installVitest(join(unreadable, 'packages', 'a'), 'latest')
  await installVitest(outside, '5.0.2')
  await mkdir(join(linked, 'apps', 'api', 'node_modules'), { recursive: true })
  await symlink(
    join(outside, 'node_modules', 'vitest'),
    join(linked, 'apps', 'api', 'node_modules', 'vitest'),
    'dir',
  )
  await installVitest(join(withoutProgram, 'tools'), '5.0.2', false)

  // Act
  const searches = await Promise.all(
    [tooOld, unreadable, linked, withoutProgram].map(searchRepositoryVitest),
  )

  // Assert
  assert.deepEqual(searches, [
    { vitestSearch: 'unusable', missing: FIRST_FOUND('.', 'is 3.2.4') },
    {
      vitestSearch: 'unusable',
      missing: FIRST_FOUND('packages/a', 'is an unreadable version'),
    },
    {
      vitestSearch: 'unusable',
      missing: FIRST_FOUND('apps/api', 'links outside the repository'),
    },
    {
      vitestSearch: 'unusable',
      missing: FIRST_FOUND('tools', 'is missing its program vitest.mjs'),
    },
  ])
})

// Value: protects=readiness taking any usable candidate after unusable ones; fails_when=the first candidate found decides, so a repository with an old root Vitest and a usable package one reads not ready; why_new=task 4 (R5: ready as soon as one candidate is usable); seam=real folders; no_claim=which Vitest a start uses (the cited test's own)
test('a usable Vitest after an unusable one makes the repository ready', async (context) => {
  // Arrange
  const root = await repository(context)
  await installVitest(root, '5.0.2', false)
  await installVitest(join(root, 'packages', 'toolkit'), '5.0.0')

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, { vitestSearch: 'usable' })
})

// Value: protects=the search's breadth-first order with each level in code-unit order, which decides the candidate the sentence names; fails_when=a deeper candidate is named before a shallower one, or a locale order puts "a" before "B"; why_new=task 4 (search order); seam=real folders; no_claim=the order on a case-insensitive file system's own listing
test('the first Vitest named is the shallowest, and within a level the first in code-unit order', async (context) => {
  // Arrange
  const root = await repository(context)
  await installVitest(join(root, 'alpha', 'beta'), '2.0.0')
  await installVitest(join(root, 'a'), '3.0.0')
  await installVitest(join(root, 'B'), '1.0.0')

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, {
    vitestSearch: 'unusable',
    missing: FIRST_FOUND('B', 'is 1.0.0'),
  })
})

// Value: protects=the search never entering node_modules, dot-folders or links to folders; fails_when=a Vitest inside a dependency, a hidden folder or a linked folder makes the repository ready, or a link loop hangs the search; why_new=task 4 (R6, AC 5); seam=real folders and a link; no_claim=Windows junctions
test('Vitest inside node_modules, a dot-folder or a linked folder is not looked for', async (context) => {
  // Arrange
  const root = await repository(context)
  const elsewhere = await repository(context)
  await installVitest(join(root, 'node_modules', 'some-package'), '5.0.2')
  await installVitest(join(root, '.cache'), '5.0.2')
  await installVitest(elsewhere, '5.0.2')
  await symlink(elsewhere, join(root, 'linked'), 'dir')
  await symlink(root, join(root, 'loop'), 'dir')

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.equal(search.vitestSearch, 'none')
})

// Value: protects=the 256-folder bound of the search and its sentence, which asks for no install; fails_when=the search looks at more than 256 folders, or reports none and asks for an install although it stopped early; why_new=task 4 (R7, R8); seam=300 real folders; no_claim=the time the search takes
test('a search that reaches its folder limit before a usable Vitest says it did not look further', async (context) => {
  // Arrange
  const root = await repository(context)
  const names = Array.from(
    { length: 300 },
    (_, index) => `package-${String(index).padStart(3, '0')}`,
  )
  await Promise.all(names.map((name) => mkdir(join(root, name))))
  await installVitest(join(root, 'package-299'), '5.0.2')

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, {
    vitestSearch: 'incomplete',
    missing:
      "node-test found no usable Vitest in the first 256 folders it looked at (the repository root and up to two levels below it) and did not look further. A start still checks the cited test's own package.",
  })
})

/**
 * Counts the folder entries the search reads by wrapping `opendir`, so a test sees how much of a level the search lists.
 * @param context - The test, which restores `opendir` when it ends.
 * @returns A reader of the count so far.
 * @example const entriesRead = countEntriesRead(context); await searchRepositoryVitest(root); entriesRead() // => 256
 */
function countEntriesRead(context: TestContext): () => number {
  let entriesRead = 0
  const opendir = fsPromises.opendir.bind(fsPromises)
  context.mock.method(fsPromises, 'opendir', async (path: string) => {
    const directory = await opendir(path)
    return {
      async *[Symbol.asyncIterator]() {
        for await (const entry of directory) {
          entriesRead++
          yield entry
        }
      },
    }
  })
  return () => entriesRead
}

// Value: protects=a search whose folder limit is spent at the end of a level reading only as much of the next level as tells it a folder remains, then saying it did not look further; fails_when=the search lists every folder of the next level after its limit is spent (2,550,255 entries in the Codex probe), so codebook_status can exhaust memory and I/O on a wide tree; why_new=Cycle 0053 /ship Step 11 (Codex adversarial review, finding 3); seam=real folders, opendir wrapped to count entries; no_claim=the order of a level (the code-unit order test)
test('a search whose folder limit is spent at the end of a level reads one entry of the next level and says it did not look further', async (context) => {
  // Arrange
  const root = await repository(context)
  const names = Array.from(
    { length: 255 },
    (_, index) => `package-${String(index).padStart(3, '0')}`,
  )
  await Promise.all(
    names.map(async (name) => {
      for (const child of ['a', 'b', 'c', 'd'])
        await mkdir(join(root, name, child), { recursive: true })
    }),
  )
  const entriesRead = countEntriesRead(context)

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, {
    vitestSearch: 'incomplete',
    missing:
      "node-test found no usable Vitest in the first 256 folders it looked at (the repository root and up to two levels below it) and did not look further. A start still checks the cited test's own package.",
  })
  assert.equal(entriesRead(), 256)
})

// Value: protects=a search that meets a folder holding more entries than it may read stopping there and saying how many folders it looked at, instead of reading them all; fails_when=a status call reads every entry of a huge folder (a data or fixture folder) or reports none found although it did not look everywhere; why_new=Cycle 0053 /ship Step 11 (Codex adversarial review, finding 3: bounded reading); seam=real folders and 20,001 files; no_claim=the folder limit (the test above)
test('a search that reaches its entry limit while listing a level stops reading and says how many folders it looked at', async (context) => {
  // Arrange
  const root = await repository(context)
  await mkdir(join(root, 'data'))
  const files = Array.from(
    { length: 20_001 },
    (_, index) => `row-${index}.json`,
  )
  for (let start = 0; start < files.length; start += 500)
    await Promise.all(
      files
        .slice(start, start + 500)
        .map((file) => writeFile(join(root, 'data', file), '')),
    )
  await installVitest(join(root, 'packages', 'query-core'), '5.0.5')
  const entriesRead = countEntriesRead(context)

  // Act
  const search = await searchRepositoryVitest(root)

  // Assert
  assert.deepEqual(search, {
    vitestSearch: 'incomplete',
    missing:
      "node-test found no usable Vitest in the first 3 folders it looked at (the repository root and up to two levels below it) and did not look further. A start still checks the cited test's own package.",
  })
  // The limit's 20,000 entries, and the one more that shows the folder holds more.
  assert.equal(entriesRead(), 20_001)
})

// Value: protects=a Vitest entry the search cannot look at (its node_modules denies the search) being named as found with an unreadable version, so the learner is not told to install a Vitest that is there; fails_when=the failed look reads as no Vitest and missing asks the learner to install Vitest; why_new=Cycle 0053 /ship Step 11 (Claude adversarial review, finding 4); seam=a node_modules folder without permissions; no_claim=readable installations (the forms test)
test('a Vitest entry the search cannot look at is named as found with an unreadable version', async (context) => {
  // Arrange
  if (process.getuid?.() === 0)
    return context.skip('chmod 0o000 does not deny the root user')
  const root = await repository(context)
  await installVitest(join(root, 'packages', 'a'), '5.0.5')
  const denied = join(root, 'packages', 'a', 'node_modules')
  await chmod(denied, 0o000)
  try {
    // Act
    const search = await searchRepositoryVitest(root)

    // Assert
    assert.deepEqual(search, {
      vitestSearch: 'unusable',
      missing: FIRST_FOUND('packages/a', 'is an unreadable version'),
    })
  } finally {
    // The repository's removal needs the folder readable again.
    await chmod(denied, 0o755)
  }
})
