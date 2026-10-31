import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import filesystem, {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import { domainError, StudyError } from '../errors'
import { bookDocumentSchema } from '../repositorySchemas'
import type * as sourceModule from '../repositorySource'
import { RepositorySourceService } from '../repositorySource'
import { gitExecutablePath } from '../utils/gitExecutablePath'

import { childProcessThatNotesPrograms } from './utils/childProcessThatNotesPrograms'
import { loadModule } from './utils/loadModule'
import { repositoryHarness as sourceHarness } from './utils/repositoryHarness'

const executeFile = promisify(execFile)

test('repository discovery exposes tracked source names and exclusion counts without leaking excluded filenames', async (context) => {
  // Arrange
  const { sources, track } = await sourceHarness(context)
  for (const path of [
    'src/module.ts',
    'README.md',
    '.env',
    'config/secrets/index.ts',
    'dist/module.js',
    'pnpm-lock.yaml',
    'package-lock.json',
    'photo.png',
  ])
    await track(path)
  // Act
  const page = await sources.list()
  // Assert
  assert.deepEqual(page.files, ['README.md', 'src/module.ts'])
  assert.equal(page.eligibleCount, 2)
  assert.equal(page.trackedCount, 8)
  assert.deepEqual(page.excluded, {
    'hidden-path': 1,
    'sensitive-name': 1,
    'generated-or-dependency': 1,
    lockfile: 2,
    'unsupported-extension': 1,
  })
  assert.equal(JSON.stringify(page).includes('config/secrets'), false)
  assert.equal(page.nextCursor, undefined)
})

test('repository reading binds exact TypeScript bytes and line count to the advertised content hash', async (context) => {
  // Arrange
  const { sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  // Act
  const source = await sources.read('src/module.ts')
  // Assert
  assert.deepEqual(source, {
    path: 'src/module.ts',
    text: 'export const price = 24;\n',
    hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
    lineCount: 2,
  })
})

test('repository reading preserves BOM, Japanese text and CRLF without changing the cited byte hash', async (context) => {
  // Arrange
  const { sources, track } = await sourceHarness(context)
  await track('src/label.ts', '\ufeffexport const label = "バッグ";\r\n')
  // Act
  const source = await sources.read('src/label.ts')
  // Assert
  assert.equal(source.text, '\ufeffexport const label = "バッグ";\r\n')
  assert.equal(
    source.hash,
    'c9b34ec7aa2552b357f9f88202607323618fcdfc5720c68f1219d32abddba952',
  )
  assert.equal(source.lineCount, 2)
})

test('changed source rejects an old citation hash and offers a fresh source read', async (context) => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  await writeFile(
    join(directory, 'src/module.ts'),
    'export const price = 30;\n',
  )
  // Act / Assert
  await assert.rejects(
    sources.read(
      'src/module.ts',
      '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
    ),
    (error) => {
      assert.ok(error instanceof Error && 'code' in error)
      assert.equal(error.code, 'SOURCE_CHANGED')
      assert.match(error.message, /expected 5e7076.*current/)
      return true
    },
  )
  assert.equal(
    (await sources.read('src/module.ts')).text,
    'export const price = 30;\n',
  )
})

test('CR-only source lines remain addressable by the same one-based line numbers shown in a native editor', async (context) => {
  // Arrange
  const { sources, track } = await sourceHarness(context)
  await track(
    'src/two-lines.ts',
    'export const one = 1;\rexport const two = 2;\r',
  )
  // Act
  const source = await sources.read('src/two-lines.ts')
  // Assert
  assert.equal(source.lineCount, 3)
  assert.equal(source.text, 'export const one = 1;\rexport const two = 2;\r')
})

test('source reading rejects untracked, untracked-again, absolute and traversal paths', async (context) => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  await writeFile(join(directory, 'untracked.ts'), 'not tracked')
  await executeFile(
    'git',
    ['rm', '--cached', '--quiet', '--', 'src/module.ts'],
    { cwd: directory },
  )
  // Act / Assert
  for (const path of [
    'src/module.ts',
    'untracked.ts',
    '../outside.ts',
    '/tmp/outside.ts',
    'src/../module.ts',
    'src\\module.ts',
  ]) {
    await assert.rejects(
      sources.read(path),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'SOURCE_UNAVAILABLE',
    )
  }
})

test('source reading rejects terminal and ancestor symlinks even after names were tracked as regular files', async (context) => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  await track('linked.ts')
  await writeFile(
    join(directory, 'private.txt'),
    'private bytes must not appear',
  )
  await rm(join(directory, 'linked.ts'))
  await symlink(join(directory, 'private.txt'), join(directory, 'linked.ts'))
  await rename(join(directory, 'src'), join(directory, 'actual-source'))
  await symlink(join(directory, 'actual-source'), join(directory, 'src'))
  // Act / Assert
  for (const path of ['linked.ts', 'src/module.ts'])
    await assert.rejects(sources.read(path), (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Symbolic source paths are excluded/)
      assert.equal(error.message.includes('private bytes'), false)
      return true
    })
})

test('source reading rejects missing, replaced-directory, invalid UTF-8, binary and oversized tracked files', async (context) => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context)
  await track('missing.ts')
  await rm(join(directory, 'missing.ts'))
  await track('directory.ts')
  await rm(join(directory, 'directory.ts'))
  await mkdir(join(directory, 'directory.ts'))
  await track('encoding.ts', Buffer.from([0xff, 0xfe]))
  await track('binary.ts', 'a\0b')
  await track(
    'oversized.ts',
    Buffer.alloc(REPOSITORY_SOURCE_LIMIT_BYTES + 1, 'x'),
  )
  // Act / Assert
  for (const path of [
    'missing.ts',
    'directory.ts',
    'encoding.ts',
    'binary.ts',
    'oversized.ts',
  ])
    await assert.rejects(
      sources.read(path),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'SOURCE_UNAVAILABLE',
    )
})

test('mutation after descriptor read is rejected before changed bytes can become a citation', async (context) => {
  // Arrange: real disk/descriptor I/O; inject the mutation at its exact asynchronous boundary.
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  const originalOpen = filesystem.open
  context.mock.method(
    filesystem,
    'open',
    async (...arguments_: Parameters<typeof originalOpen>) => {
      const handle = await originalOpen(...arguments_)
      const originalRead = handle.read.bind(handle)
      context.mock.method(
        handle,
        'read',
        async (...readArguments: Parameters<typeof originalRead>) => {
          const result = await originalRead(...readArguments)
          await writeFile(
            join(directory, 'src/module.ts'),
            'export const price = 30;\n',
          )
          return result
        },
      )
      return handle
    },
  )
  // Act / Assert
  await assert.rejects(
    sources.read('src/module.ts'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SOURCE_CHANGED',
  )
})

test('source pages continue the same path snapshot and reject a cursor after tracked names change', async (context) => {
  // Arrange
  const { directory, sources } = await sourceHarness(context)
  for (let index = 0; index < 101; index++)
    await writeFile(
      join(directory, `file-${String(index).padStart(3, '0')}.ts`),
      'source',
    )
  await executeFile('git', ['add', '--all'], { cwd: directory })
  // Act
  const first = await sources.list()
  assert.ok(first.nextCursor)
  const last = await sources.list(first.nextCursor)
  await writeFile(join(directory, 'new.ts'), 'source')
  await executeFile('git', ['add', '--', 'new.ts'], { cwd: directory })
  // Assert
  assert.equal(first.files.length, 100)
  assert.deepEqual(last.files, ['file-100.ts'])
  assert.equal(last.nextCursor, undefined)
  await assert.rejects(
    sources.list(first.nextCursor),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'STALE_SOURCE_CATALOG',
  )
  await assert.rejects(
    sources.list('not-a-cursor'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'STALE_SOURCE_CATALOG',
  )
})

test('repository authoring rejects a nested workspace instead of reading outside its declared root', async (context) => {
  // Arrange
  const { directory, track } = await sourceHarness(context)
  await track('src/module.ts')
  // Act / Assert
  await assert.rejects(
    new RepositorySourceService(join(directory, 'src')).list(),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'PREREQUISITE_MISSING',
  )
})

test('book document rejects duplicate nodes and relationship endpoints outside its authored nodes', () => {
  // Arrange
  const node = {
    id: 'module',
    title: 'Module',
    sections: [{ title: 'State', text: 'The module changes.' }],
    anchors: [
      {
        path: 'src/module.ts',
        hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
        startLine: 1,
        endLine: 1,
      },
    ],
    observations: [],
  }
  // Act
  const duplicate = bookDocumentSchema.safeParse({
    title: 'Book',
    summary: 'Overview',
    nodes: [node, node],
    edges: [],
  })
  const dangling = bookDocumentSchema.safeParse({
    title: 'Book',
    summary: 'Overview',
    nodes: [node],
    edges: [
      {
        from: 'module',
        to: 'missing',
        relationship: 'calls',
        explanation: 'Agent interpretation',
      },
    ],
  })
  // Assert
  assert.equal(duplicate.success, false)
  assert.equal(dangling.success, false)
})

test('empty and exactly bounded sources remain readable without accepting a byte over the limit', async (context) => {
  // Arrange
  const { sources, track } = await sourceHarness(context)
  await track('empty.ts', '')
  await track('full.ts', 'x'.repeat(262_144))
  await track('overflow.ts', 'x'.repeat(262_145))
  // Act
  const empty = await sources.read('empty.ts'),
    full = await sources.read('full.ts')
  // Assert
  assert.deepEqual(empty, {
    path: 'empty.ts',
    hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    text: '',
    lineCount: 1,
  })
  assert.equal(Buffer.byteLength(full.text), 262_144)
  await assert.rejects(sources.read('overflow.ts'), /exceeds 262144 bytes/)
})

test('legal short descriptor reads preserve the complete cited text and hash', async (context) => {
  // Arrange: preserve real file I/O, shortening each OS request at the descriptor boundary.
  const { sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  const originalOpen = filesystem.open
  context.mock.method(
    filesystem,
    'open',
    async (...arguments_: Parameters<typeof originalOpen>) => {
      const handle = await originalOpen(...arguments_),
        read = handle.read.bind(handle)
      context.mock.method(
        handle,
        'read',
        (buffer: Buffer, offset: number, length: number, position: number) =>
          read(buffer, offset, Math.min(length, 3), position),
      )
      return handle
    },
  )
  // Act
  const source = await sources.read('src/module.ts')
  // Assert
  assert.equal(source.text, 'export const price = 24;\n')
  assert.equal(
    source.hash,
    '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
  )
})

test('publication source preparation deduplicates citations and keeps at most four descriptor reads active', async (context) => {
  // Arrange
  const { sources, track } = await sourceHarness(context)
  const paths = [
    'src/a.ts',
    'src/b.ts',
    'src/c.ts',
    'src/d.ts',
    'src/e.ts',
    'src/f.ts',
  ]
  for (const path of paths) await track(path)
  const originalOpen = filesystem.open
  let active = 0,
    maximum = 0,
    reads = 0
  context.mock.method(
    filesystem,
    'open',
    async (...arguments_: Parameters<typeof originalOpen>) => {
      const handle = await originalOpen(...arguments_),
        close = handle.close.bind(handle)
      active++
      reads++
      maximum = Math.max(maximum, active)
      context.mock.method(handle, 'close', async () => {
        try {
          await close()
        } finally {
          active--
        }
      })
      return handle
    },
  )
  const citations = paths.map((path) => ({
    path,
    hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
  }))
  // Act
  const prepared = await sources.prepare([...citations, citations[0]!])
  const checked = await prepared.revalidate()
  // Assert
  assert.deepEqual(
    prepared.sources.map((source) => source.path),
    paths,
  )
  assert.equal(reads, 12)
  assert.equal(active, 0)
  assert.ok(maximum <= 4)
  assert.equal(checked.length, 6)
})

test('changing tracking during an acquired source read rejects bytes from the obsolete catalog', async (context) => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  const originalOpen = filesystem.open
  context.mock.method(
    filesystem,
    'open',
    async (...arguments_: Parameters<typeof originalOpen>) => {
      const handle = await originalOpen(...arguments_)
      await executeFile(
        'git',
        ['rm', '--cached', '--quiet', '--', 'src/module.ts'],
        { cwd: directory },
      )
      return handle
    },
  )
  // Act / Assert
  await assert.rejects(sources.read('src/module.ts'), /tracked set changed/)
})

test('prepared citations reject changed bytes, identical-byte replacements and tracked-set changes before publication', async (context) => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  const anchors = [
    {
      path: 'src/module.ts',
      hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
    },
  ]
  const first = await sources.prepare(anchors)
  // Act / Assert
  await writeFile(join(directory, 'src/module.ts'), 'changed')
  await assert.rejects(first.revalidate(), /Source hash changed/)
  await track('src/module.ts')
  const second = await sources.prepare(anchors)
  await rename(join(directory, 'src/module.ts'), join(directory, 'src/old.ts'))
  await writeFile(
    join(directory, 'src/module.ts'),
    'export const price = 24;\n',
  )
  await assert.rejects(second.revalidate(), /identity changed/)
  const third = await sources.prepare(anchors)
  await track('src/added.ts')
  await assert.rejects(third.revalidate(), /tracked set changed/)
})

test('expired and cancelled source preparation cannot later validate a publication', async (context) => {
  // Arrange
  const { directory, track } = await sourceHarness(context)
  await track('src/module.ts')
  let now = 1_000
  const sources = new RepositorySourceService(directory, () => now),
    controller = new AbortController()
  const anchors = [
    {
      path: 'src/module.ts',
      hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
    },
  ]
  const prepared = await sources.prepare(anchors, { signal: controller.signal })
  // Act / Assert
  controller.abort()
  await assert.rejects(prepared.revalidate(), /expired or was cancelled/)
  await assert.rejects(
    sources.prepare(anchors, { deadlineAt: 999 }),
    /expired or was cancelled/,
  )
  const timed = await sources.prepare(anchors)
  now = 21_000
  await assert.rejects(timed.revalidate(), /expired or was cancelled/)
})

test('conflicting and excessive distinct citations fail preparation before any source is acquired', async (context) => {
  // Arrange
  const { sources } = await sourceHarness(context)
  const first = {
    path: 'src/module.ts',
    hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
  }
  // Act / Assert
  await assert.rejects(
    sources.prepare([first, { ...first, hash: '0'.repeat(64) }]),
    /Conflicting citation hashes/,
  )
  await assert.rejects(
    sources.prepare(
      Array.from({ length: 33 }, (_, index) => ({
        ...first,
        path: `src/file-${index}.ts`,
      })),
    ),
    /at most 32 distinct sources/,
  )
})

// Value: protects=an agent whose project has no regular file where Git keeps its index (a folder at that path, or a link that leads to one); fails_when=the refusal carries the code SOURCE_UNAVAILABLE, whose recovery sends the agent to codebook_sources and codebook_source, which answer the same refusal until a regular index stands there, so the step it is told cannot work; why_new=Cycle 0046 row 319: the refusal carries the code whose recovery is true for it, as the check of .git beside it does; seam=none, real projects (the link is a junction on Windows, which every user may create)
test('a project whose Git index is a folder, or a link to a folder, is refused by source discovery and by a source read as a missing prerequisite, which tells the agent to fix what the message names and to call codebook_status, and after a regular index stands at its path again the sources are listed and read', async (context) => {
  // Arrange: two projects with one tracked source; in each the index is kept elsewhere, and a folder, or a link to a folder, stands at its path.
  const withFolder = await sourceHarness(context),
    withLink = await sourceHarness(context)
  for (const project of [withFolder, withLink]) {
    await project.track('src/module.ts')
    await rename(
      join(project.directory, '.git', 'index'),
      join(project.directory, '.git', 'index-kept-elsewhere'),
    )
  }
  await mkdir(join(withFolder.directory, '.git', 'index'))
  await mkdir(join(withLink.directory, '.git', 'a-folder'))
  await symlink(
    join(withLink.directory, '.git', 'a-folder'),
    join(withLink.directory, '.git', 'index'),
    'junction',
  )
  const toldToTheAgent = (
    calling: Promise<unknown>,
  ): Promise<{ code: string; message: string; recovery: string } | string> =>
    calling.then(
      () => 'answered',
      (error: unknown) => {
        const { code, message, recovery } = domainError(error).describe()
        return { code, message, recovery }
      },
    )

  // Act
  const refusals = {
    folder: {
      discovery: await toldToTheAgent(withFolder.sources.list()),
      read: await toldToTheAgent(withFolder.sources.read('src/module.ts')),
    },
    linkToAFolder: {
      discovery: await toldToTheAgent(withLink.sources.list()),
      read: await toldToTheAgent(withLink.sources.read('src/module.ts')),
    },
  }
  // The recovery is followed to the letter: the prerequisite the message names is fixed, a regular index stands at its path.
  for (const project of [withFolder, withLink]) {
    await rm(join(project.directory, '.git', 'index'), { recursive: true })
    await rename(
      join(project.directory, '.git', 'index-kept-elsewhere'),
      join(project.directory, '.git', 'index'),
    )
  }
  const afterwards = {
    folder: {
      discovery: (await withFolder.sources.list()).files,
      read: await toldToTheAgent(withFolder.sources.read('src/module.ts')),
    },
    linkToAFolder: {
      discovery: (await withLink.sources.list()).files,
      read: await toldToTheAgent(withLink.sources.read('src/module.ts')),
    },
  }

  // Assert
  assert.deepEqual(
    { refusals, afterwards },
    {
      refusals: {
        folder: {
          discovery: {
            code: 'PREREQUISITE_MISSING',
            message: 'Git index must be a regular file.',
            recovery:
              'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
          },
          read: {
            code: 'PREREQUISITE_MISSING',
            message: 'Git index must be a regular file.',
            recovery:
              'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
          },
        },
        linkToAFolder: {
          discovery: {
            code: 'PREREQUISITE_MISSING',
            message: 'Git index must be a regular file.',
            recovery:
              'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
          },
          read: {
            code: 'PREREQUISITE_MISSING',
            message: 'Git index must be a regular file.',
            recovery:
              'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
          },
        },
      },
      afterwards: {
        folder: { discovery: ['src/module.ts'], read: 'answered' },
        linkToAFolder: { discovery: ['src/module.ts'], read: 'answered' },
      },
    },
  )
})

// Value: protects=the learner's rights when the opened project carries a program named git: source discovery starts every Git command by the absolute path the lookup found on PATH alone, never by the bare name that Windows looks up in the project folder first (SX2, Cycle 0046 repeat security review); fails_when=a Git command is started by its bare name with the project as its folder; why_new=source discovery started `git` by its bare name; seam=a stand-in for `node:child_process` of the loaded service, which notes every program it starts and runs it
test('source discovery starts every Git command by the absolute path found on PATH, never by the bare name', async (context) => {
  // Arrange: a repository with one tracked source, and the service loaded with a child process module that notes its programs.
  const { directory, track } = await sourceHarness(context)
  await track('src/module.ts')
  const noted = childProcessThatNotesPrograms()
  const { RepositorySourceService: ServiceNotingPrograms } = await loadModule<
    typeof sourceModule
  >(resolve(__dirname, '../repositorySource.js'), {
    'node:child_process': noted.childProcess,
  })
  // Act
  const page = await new ServiceNotingPrograms(directory).list()
  // Assert
  const git = await gitExecutablePath()
  assert.deepEqual(
    {
      files: [...page.files],
      started: noted.started,
      gitIsAbsolute: isAbsolute(git),
    },
    {
      files: ['src/module.ts'],
      started: [git, git, git],
      gitIsAbsolute: true,
    },
  )
})

// Value: protects=the learner's machine when the opened folder is a repository that a clone did not make and whose own config names an fsmonitor hook: source discovery's Git commands run with the configuration every Git command in the opened folder shares, so the hook never runs (R7, /ship third review, Claude adversarial #7); fails_when=discovery's Git commands lose `-c core.fsmonitor=false`, for example when the shared list is not used here; why_new=the freshness check lacked it, and discovery had no test of it; seam=none (real Git, a real hook script that notes each start)
test('source discovery runs no fsmonitor hook that the repository’s own config names', async (context) => {
  // Arrange: a repository with one tracked source, whose config names a hook that writes a file when Git starts it.
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  const hookFolder = await mkdtemp(join(tmpdir(), 'codebook-source-hook-'))
  context.after(() => rm(hookFolder, { recursive: true, force: true }))
  const hookRan = join(hookFolder, 'fsmonitor-ran')
  const hook = join(hookFolder, 'fsmonitor-hook.sh')
  await writeFile(hook, `#!/bin/sh\necho ran >> '${hookRan}'\n`)
  await chmod(hook, 0o755)
  await executeFile('git', ['config', 'core.fsmonitor', hook], {
    cwd: directory,
  })
  // Act
  const page = await sources.list()
  // Assert
  assert.deepEqual(
    {
      files: [...page.files],
      hookRan: await access(hookRan).then(
        () => true,
        () => false,
      ),
    },
    { files: ['src/module.ts'], hookRan: false },
  )
})

// Value: protects=the agent's next step on a machine without Git: the lookup's "spawn git ENOENT" becomes source discovery's PREREQUISITE_MISSING, whose recovery tells the agent to fix the named prerequisite, with the lookup's words as its cause (SX2; TT15, the third testing review); fails_when=the lookup's error escapes discovery as a raw system error, for example when the lookup moves out of the guarded step; why_new=the lookup's test checked only its own error, and no caller test ran without Git; seam=the Git lookup the loaded service is given, which fails as a Git that cannot be started fails
test('source discovery on a machine whose PATH holds no Git fails with a missing prerequisite that names Git', async (context) => {
  // Arrange: a repository with one tracked source; the Git lookup finds none. The loaded service reads errors by this context's Error, as the product's lookup and service share one.
  const { directory, track } = await sourceHarness(context)
  await track('src/module.ts')
  const { RepositorySourceService: ServiceWithoutGit } = await loadModule<
    typeof sourceModule
  >(
    resolve(__dirname, '../repositorySource.js'),
    {
      './utils/gitExecutablePath': {
        gitExecutablePath: async () => {
          throw Object.assign(new Error('spawn git ENOENT'), {
            code: 'ENOENT',
            errno: -2,
            syscall: 'spawn git',
            path: 'git',
          })
        },
      },
    },
    { Error },
  )
  // Act
  const failure: unknown = await new ServiceWithoutGit(directory).list().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.deepEqual(
    {
      code: failure.code,
      message: failure.message,
      cause: failure.causeDetail,
    },
    {
      code: 'PREREQUISITE_MISSING',
      message:
        'Repository source discovery requires Git, a working-tree root and a bounded readable index.',
      cause: 'spawn git ENOENT',
    },
  )
})

// Value: protects=the learner's machine when source discovery runs in a repository whose own config and attributes name a clean filter, a textconv driver and an external diff: discovery's Git commands (rev-parse, ls-files --cached) read no file of the working tree, so none of them runs (BB2, the fixes of the third review); fails_when=discovery gains a Git command that hashes or diffs the working tree without switching those programs off; why_new=no discovery test named such programs; seam=none (real Git, real programs that note each start)
test('source discovery runs no clean filter, textconv driver or external diff that the repository names', async (context) => {
  // Arrange: a repository with one tracked source whose config and attributes name three programs, and a change to that source.
  const { directory, sources, track } = await sourceHarness(context)
  await track('src/module.ts')
  const notes = await mkdtemp(join(tmpdir(), 'codebook-source-drivers-'))
  context.after(() => rm(notes, { recursive: true, force: true }))
  const programs: [configKey: string, name: string][] = [
    ['filter.probe.clean', 'clean'],
    ['diff.probe.textconv', 'textconv'],
    ['diff.external', 'external-diff'],
  ]
  for (const [key, name] of programs) {
    const program = join(notes, `${name}.sh`)
    await writeFile(
      program,
      `#!/bin/sh\necho ran >> '${join(notes, `${name}-ran`)}'\ncat\n`,
    )
    await chmod(program, 0o755)
    await executeFile('git', ['config', key, program], { cwd: directory })
  }
  await writeFile(
    join(directory, '.gitattributes'),
    '*.ts filter=probe diff=probe\n',
  )
  await writeFile(
    join(directory, '.git', 'info', 'attributes'),
    '*.ts filter=probe diff=probe\n',
  )
  await writeFile(
    join(directory, 'src', 'module.ts'),
    'export const price = 25;\n',
  )
  // Act
  const page = await sources.list()
  // Assert
  assert.deepEqual(
    {
      files: [...page.files],
      ran: (await readdir(notes)).filter((name) => name.endsWith('-ran')),
    },
    { files: ['src/module.ts'], ran: [] },
  )
})

// Value: protects=the learner whose project tracks more than 5,000 names (TanStack Query tracks 5,173): source discovery lists it and pages its first 100 names instead of refusing the whole catalog; fails_when=the tracked-name cap sits below a real project's size, so discovery refuses with LIMIT_EXCEEDED and no Codebook feature can start there; why_new=Cycle 0067 F1 (observed natively on TanStack Query c9c00015); seam=none (real Git, 5,001 real tracked files made by one add of all files); no_claim=the speed of discovery on a repository near the new cap
test('source discovery lists a repository of 5,001 tracked source files and pages its first 100 names', async (context) => {
  // Arrange: 5,001 tracked eligible files, written with the filesystem and tracked by one add.
  const { directory, sources } = await sourceHarness(context)
  await mkdir(join(directory, 'src'), { recursive: true })
  for (let index = 0; index <= 5_000; index += 1)
    await writeFile(
      join(directory, 'src', `f${String(index).padStart(4, '0')}.ts`),
      'export const price = 24;\n',
    )
  await executeFile('git', ['add', '-A'], { cwd: directory })
  // Act
  const page = await sources.list()
  // Assert
  assert.equal(page.trackedCount, 5_001)
  assert.equal(page.eligibleCount, 5_001)
  assert.equal(page.files.length, 100)
  assert.equal(page.files[0], 'src/f0000.ts')
  assert.equal(page.files[99], 'src/f0099.ts')
})
