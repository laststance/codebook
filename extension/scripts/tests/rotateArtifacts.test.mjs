import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  buildFilesJson,
  checkMemberPaths,
  classifyInventory,
  createCommandRunner,
  HELP_TEXT,
  main,
  parseCycleNumber,
  PartSplitter,
} from '../rotate-artifacts.mjs'
import { CommandProgress, runCommandLine } from '../utils/commandContract.mjs'

const NOW = Date.parse('2026-11-11T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const HEAD = 'abcdef01'.repeat(5)
const TOKEN = 'ghp_faketoken1234'
const REPOSITORY = 'ryota-murakami/codebook-artifacts'

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** Deterministic bytes gzip cannot shrink, so a small archive still needs several parts. */
const incompressible = (length) =>
  Buffer.concat(
    Array.from({ length: Math.ceil(length / 32) }, (_, index) =>
      createHash('sha256').update(String(index)).digest(),
    ),
  ).subarray(0, length)

/** Creates a temporary repository root with an empty artifacts/ folder. */
async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'rotate-artifacts-'))
  await mkdir(join(root, 'artifacts'))
  return root
}

/** Writes one file under artifacts/ with a modification time `ageMs` before NOW. */
async function putFile(root, relative, content, ageMs = 2 * DAY) {
  const path = join(root, 'artifacts', relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  const when = new Date(NOW - ageMs)
  await utimes(path, when, when)
}

/** Lists every file under a folder as relative path to content hash, for before/after comparisons. */
async function snapshot(directory, prefix = '') {
  const result = {}
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : 1),
  )) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory())
      Object.assign(
        result,
        await snapshot(join(directory, entry.name), relative),
      )
    else if (entry.isFile())
      result[relative] = sha256(await readFile(join(directory, entry.name)))
    else result[relative] = 'special'
  }
  return result
}

/**
 * A stand-in `gh` that keeps the archive repository's releases, assets and index.json in memory.
 * It never reaches the network; its `calls` list shows what the tool asked and with which token.
 */
function createFakeGh(options = {}) {
  const state = {
    exists: options.exists ?? true,
    visibility: options.visibility ?? 'PRIVATE',
    releases: new Map(),
    index: null,
    indexVersion: 0,
    calls: [],
    uploadsLeft: Number.POSITIVE_INFINITY,
    uploaded: [],
    corruptPattern: options.corruptPattern ?? null,
    omitDigest: options.omitDigest ?? false,
    nextId: 1,
  }
  const result = (stdout) => ({ status: 0, stdout, stderr: '' })
  const failure = (stderr) => ({ status: 1, stdout: '', stderr })
  const addAsset = (tag, name, data) => {
    const release = state.releases.get(tag)
    release.assets.set(name, {
      id: state.nextId++,
      name,
      data,
      state: 'uploaded',
    })
  }
  async function handle(args, callOptions) {
    state.calls.push({ args, token: callOptions?.env?.GH_TOKEN })
    const [first, second] = args
    if (first === 'auth') return result(`${TOKEN}\n`)
    if (first === 'repo' && second === 'view')
      return state.exists
        ? result(JSON.stringify({ visibility: state.visibility }))
        : failure('Could not resolve to a Repository')
    if (first === 'repo' && second === 'create') {
      state.exists = true
      return result('')
    }
    if (first === 'release' && second === 'create') {
      state.releases.set(args[2], {
        id: state.nextId++,
        assets: new Map(),
        notes: args[args.indexOf('--notes') + 1],
      })
      return result('')
    }
    if (first === 'release' && second === 'upload') {
      if (state.uploadsLeft <= 0) return failure('connection reset')
      state.uploadsLeft -= 1
      const name = args[3].split('/').at(-1)
      if (state.releases.get(args[2]).assets.has(name))
        return failure('asset under the same name already exists')
      addAsset(args[2], name, await readFile(args[3]))
      state.uploaded.push(name)
      return result('')
    }
    if (first === 'release' && second === 'download') {
      const asset = state.releases
        .get(args[2])
        ?.assets.get(args[args.indexOf('--pattern') + 1])
      if (asset === undefined) return failure('no assets match')
      let data = asset.data
      if (
        state.corruptPattern !== null &&
        asset.name.includes(state.corruptPattern)
      ) {
        data = Buffer.from(data)
        data[data.length - 1] ^= 0xff
      }
      await writeFile(join(args[args.indexOf('--dir') + 1], asset.name), data)
      return result('')
    }
    if (first === 'api' && args.includes('-X') && args.includes('DELETE')) {
      const id = Number(args.at(-1).split('/').at(-1))
      for (const release of state.releases.values())
        for (const [name, asset] of release.assets)
          if (asset.id === id) release.assets.delete(name)
      return result('')
    }
    if (first === 'api' && args.includes('PUT')) {
      const fields = {}
      for (let at = 0; at < args.length; at += 1)
        if (args[at] === '-f') {
          const [key, ...rest] = args[at + 1].split('=')
          fields[key] = rest.join('=')
        }
      if (state.index !== null && fields.sha !== String(state.indexVersion))
        return failure('HTTP 409 sha mismatch')
      state.index = Buffer.from(fields.content, 'base64').toString('utf8')
      state.indexVersion += 1
      return result('{}')
    }
    if (first === 'api' && second.endsWith('/contents/index.json'))
      return state.index === null
        ? failure('gh: Not Found (HTTP 404)')
        : result(
            JSON.stringify({
              sha: String(state.indexVersion),
              content: Buffer.from(state.index).toString('base64'),
            }),
          )
    if (first === 'api' && second.includes('/releases/tags/')) {
      const release = state.releases.get(second.split('/').at(-1))
      if (release === undefined) return failure('gh: Not Found (HTTP 404)')
      return result(
        JSON.stringify({
          assets: [...release.assets.values()].map((asset) => ({
            id: asset.id,
            name: asset.name,
            size: asset.data.length,
            state: asset.state,
            digest: state.omitDigest ? null : `sha256:${sha256(asset.data)}`,
          })),
        }),
      )
    }
    return failure(`unexpected gh call ${args.join(' ')}`)
  }
  return {
    state,
    handle,
    /** Puts an asset into a release (creating it) as if an earlier run had uploaded it. */
    seed(tag, name, data) {
      if (!state.releases.has(tag))
        state.releases.set(tag, {
          id: state.nextId++,
          assets: new Map(),
          notes: '',
        })
      addAsset(tag, name, data)
    },
    seedIndex(index) {
      state.index = JSON.stringify(index)
      state.indexVersion += 1
    },
    assetNames: (tag) =>
      [...(state.releases.get(tag)?.assets.keys() ?? [])].sort(),
    // Only uploads that succeeded.
    uploadedNames: () => [...state.uploaded],
  }
}

/** Runs the tool in a temp root with the fake gh, the real tar and a fixed HEAD and clock. */
async function rotate(root, fake, argv, overrides = {}) {
  const realRun = createCommandRunner(root, process.env)
  const lines = []
  const code = await main(new CommandProgress(), argv, {
    repositoryRoot: root,
    now: () => NOW,
    freeBytes: async () => 10 ** 12,
    print: (line) => lines.push(line),
    run: async (command, args, options) => {
      if (command === 'gh') return fake.handle(args, options)
      if (command === 'git')
        return { status: 0, stdout: `${HEAD}\n`, stderr: '' }
      return realRun(command, args, options)
    },
    ...overrides,
  })
  return { code, lines }
}

const summaryOf = (lines) => lines.find((line) => line.startsWith('ROTATE:'))

/** Builds one ustar member by hand, so a test can make a name or link no honest tar would write. */
function tarMember(name, content, { type = '0', linkname = '' } = {}) {
  const header = Buffer.alloc(512)
  header.write(name, 0)
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136)
  header.write('        ', 148)
  header.write(type, 156)
  header.write(linkname, 157)
  header.write('ustar\0', 257)
  header.write('00', 263)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  content.copy(padded)
  return Buffer.concat([header, padded])
}

const tarGz = (...members) =>
  gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]))

/** Seeds the fake with a hand-made archive of folder `c1` and the index that names it. */
function seedArchive(fake, archive, filesJson) {
  const files = Buffer.from(JSON.stringify(filesJson))
  fake.seed('c1', 'c1.tar.gz', archive)
  fake.seed('c1', 'c1.files.json', files)
  fake.seedIndex({
    schemaVersion: 1,
    folders: {
      c1: {
        tag: 'c1',
        files: filesJson.count,
        bytes: filesJson.bytes,
        assets: [
          { name: 'c1.tar.gz', size: archive.length, sha256: sha256(archive) },
          { name: 'c1.files.json', size: files.length, sha256: sha256(files) },
        ],
      },
    },
  })
}

test('names a cycle folder by the first number after c or cycle-', () => {
  // protects=the retention rule reads the right cycle from every name style in artifacts/; fails_when=cycle-0052 reads as 0 or c62-n62 as 62n; no_claim=names outside these styles are classified elsewhere
  // Arrange
  const names = [
    'c59',
    'cycle-0052',
    'c62-n62',
    'c116',
    'gate-pt3-1.log',
    'coderabbit-pt3.log',
    'space-recorder-comparison-2026-10-21',
  ]
  // Act
  const cycles = names.map(parseCycleNumber)
  // Assert
  assert.deepEqual(cycles, [59, 52, 62, 116, null, null, null])
})

test('keeps the newest cycles, archives the older ones and leaves cycles above the current one unknown', () => {
  // protects=nothing above N - keep is ever selected for archiving; fails_when=the boundary cycle N - keep is kept or a future cycle is archived; no_claim=says nothing about files inside the folders
  // Arrange
  const info = (name) => ({
    name,
    bytes: 100,
    newestMs: NOW - DAY,
    special: [],
    fileCount: 1,
  })
  const inventory = {
    entries: ['c114', 'c115', 'c116', 'c117', 'c118', 'cycle-0052'].map(info),
    gate: [],
    qa: [],
  }
  // Act
  const plan = classifyInventory(inventory, {
    current: 117,
    keep: 3,
    headShort: 'abcdef01',
    now: NOW,
  })
  // Assert
  assert.deepEqual(
    plan.map((item) => `${item.action} ${item.name}`),
    [
      'archive c114',
      'keep c115',
      'keep c116',
      'keep c117',
      'unknown c118',
      'archive cycle-0052',
    ],
  )
})

test('deletes other gate folders, keeps the current HEAD gate folder and the newest ten QA builds', () => {
  // protects=merge-pr.mjs still finds the current HEAD's gate summary and recent QA builds stay installable; fails_when=the HEAD folder is deleted or the eleventh newest build is kept; no_claim=archive of QA builds is not exercised here
  // Arrange
  const info = (name, newestMs = NOW - DAY) => ({
    name,
    bytes: 10,
    newestMs,
    special: [],
    fileCount: 1,
  })
  const qa = []
  for (let build = 0; build < 12; build += 1) {
    const stem = `codebook-${String(build).padStart(7, '0')}`
    qa.push(
      info(`${stem}.vsix`, NOW - DAY - build * 1000),
      info(`${stem}.json`, NOW - DAY - build * 1000),
    )
  }
  const inventory = {
    entries: [info('packages')],
    gate: [info('abcdef01'), info('11111111')],
    qa,
  }
  // Act
  const plan = classifyInventory(inventory, {
    current: 117,
    keep: 3,
    headShort: 'abcdef01',
    now: NOW,
  })
  // Assert
  const lines = plan.map((item) => `${item.action} ${item.name}`)
  assert.deepEqual(lines.slice(0, 3), [
    'keep packages',
    'keep gate/abcdef01',
    'delete gate/11111111',
  ])
  assert.equal(lines.filter((line) => line.startsWith('keep qa/')).length, 10)
  assert.deepEqual(
    lines.filter((line) => line.startsWith('archive')),
    ['archive qa/codebook-0000010', 'archive qa/codebook-0000011'],
  )
})

test('skips a busy folder, a folder with a link and a young or oddly named loose entry', () => {
  // protects=a run still writing, a symbolic link and a recent loose log are never archived or deleted; fails_when=any of them gets action archive; no_claim=old well-named loose entries are archived (asserted last)
  // Arrange
  const entry = (name, extra) => ({
    name,
    bytes: 5,
    newestMs: NOW - DAY,
    special: [],
    fileCount: 1,
    ...extra,
  })
  const inventory = {
    entries: [
      entry('c10', { newestMs: NOW - 60 * 1000 }),
      entry('c11', { special: ['link'] }),
      entry('c12 odd'),
      entry('young.log', { newestMs: NOW - 5 * DAY }),
      entry('old.log', { newestMs: NOW - 40 * DAY }),
    ],
    gate: [],
    qa: [],
  }
  // Act
  const plan = classifyInventory(inventory, {
    current: 117,
    keep: 3,
    headShort: 'abcdef01',
    now: NOW,
  })
  // Assert
  assert.deepEqual(
    plan.map((item) => `${item.action} ${item.name}`),
    [
      'skip c10',
      'skip c11',
      'skip c12 odd',
      'keep young.log',
      'archive old.log',
    ],
  )
})

test('cuts an archive stream into numbered parts no larger than the limit and hashes each', async () => {
  // protects=release assets stay under GitHub's size limit and carry their own SHA-256; fails_when=a part exceeds the limit, an exact multiple leaves an empty part, or a single part gets a suffix; no_claim=the real 1900 MiB limit is not exercised
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'rotate-parts-'))
  const cut = async (baseName, bytes) => {
    const splitter = new PartSplitter(directory, baseName, 10)
    Readable.from([Buffer.alloc(bytes, 7)]).pipe(splitter)
    await finished(splitter)
    return splitter.parts
  }
  // Act
  const three = await cut('a.tar.gz', 25)
  const exact = await cut('b.tar.gz', 20)
  const single = await cut('c.tar.gz', 5)
  // Assert
  assert.deepEqual(
    three.map((part) => [part.name, part.size]),
    [
      ['a.tar.gz.part-000', 10],
      ['a.tar.gz.part-001', 10],
      ['a.tar.gz.part-002', 5],
    ],
  )
  assert.equal(three[2].sha256, sha256(Buffer.alloc(5, 7)))
  assert.deepEqual(
    exact.map((part) => part.name),
    ['b.tar.gz.part-000', 'b.tar.gz.part-001'],
  )
  assert.deepEqual(
    single.map((part) => [part.name, part.size]),
    [['c.tar.gz', 5]],
  )
  assert.deepEqual(await readdir(directory), [
    'a.tar.gz.part-000',
    'a.tar.gz.part-001',
    'a.tar.gz.part-002',
    'b.tar.gz.part-000',
    'b.tar.gz.part-001',
    'c.tar.gz',
  ])
})

test('lists files.json files sorted by path with their count and byte total', () => {
  // protects=an Issue's cited hash is found in a stable manifest; fails_when=files are unsorted or count and bytes disagree with the list; no_claim=hashes are not computed here
  // Arrange
  const files = [
    { path: 'artifacts/c1/b', size: 2, sha256: 'bb' },
    { path: 'artifacts/c1/a', size: 3, sha256: 'aa' },
  ]
  // Act
  const manifest = buildFilesJson('c1', files)
  // Assert
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    folder: 'c1',
    files: [files[1], files[0]],
    count: 2,
    bytes: 5,
  })
})

test('refuses archive member names that are absolute, climb out or leave the folder', () => {
  // protects=a restore never writes outside artifacts/<folder>; fails_when=an absolute or .. member passes; no_claim=link members are refused by a separate check
  // Arrange
  const folder = 'c1'
  // Act
  const results = [
    ['c1/a', 'c1/b/c'],
    ['/etc/passwd'],
    ['c1/../x'],
    ['other/a'],
    ['C:\\x'],
  ].map((names) => checkMemberPaths(names, folder))
  // Assert
  assert.deepEqual(results, [
    null,
    '/etc/passwd',
    'c1/../x',
    'other/a',
    'C:\\x',
  ])
})

test('prints the plan and changes nothing without --apply', async () => {
  // protects=the plan-only mode (acceptance 1) leaves artifacts untouched and never calls gh; fails_when=a file moves, a folder is deleted or gh is called; no_claim=does not prove --apply
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, 'c5/b.txt', 'two')
  await putFile(root, 'gate/11111111/summary.txt', 'old gate')
  const before = await snapshot(join(root, 'artifacts'))
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(root, fake, ['--current', '5'])
  // Assert
  assert.equal(code, 0)
  assert.deepEqual(lines, [
    'archive c1 3',
    'keep    c5 3',
    'delete  gate/11111111 8',
    'PLAN: archive=1 delete=1 keep=1 skip=0 unknown=0 bytes_to_free=11',
  ])
  assert.deepEqual(await snapshot(join(root, 'artifacts')), before)
  assert.deepEqual(fake.state.calls, [])
})

test('archives an old cycle only after a verified download, deletes it, and leaves newer cycles and the HEAD gate folder alone', async () => {
  // protects=acceptance 2: the local folder goes only after re-download, hash and files.json checks, and the record exists; fails_when=the folder stays, a kept cycle goes, or the index lacks the folder; no_claim=a failed verification is a separate test
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/native/run.txt', 'evidence one')
  await putFile(root, 'c3/x.txt', 'kept three')
  await putFile(root, 'c5/y.txt', 'kept five')
  await putFile(root, 'c9/z.txt', 'future nine')
  await putFile(root, 'gate/abcdef01/summary.txt', 'current gate')
  await putFile(root, 'gate/11111111/summary.txt', 'old gate')
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 0)
  assert.equal(
    summaryOf(lines),
    'ROTATE: archived=1 deleted=1 kept=4 skipped=0 failed=0 freed_bytes=20',
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts')), {
    'ARCHIVED.json': (await snapshot(join(root, 'artifacts')))['ARCHIVED.json'],
    'c3/x.txt': sha256('kept three'),
    'c5/y.txt': sha256('kept five'),
    'c9/z.txt': sha256('future nine'),
    'gate/abcdef01/summary.txt': sha256('current gate'),
  })
  assert.deepEqual(fake.assetNames('c1'), ['c1.files.json', 'c1.tar.gz'])
  const index = JSON.parse(fake.state.index)
  assert.equal(index.folders.c1.sourceCommit, HEAD)
  assert.equal(index.folders.c1.files, 1)
  assert.equal(
    JSON.parse(await readFile(join(root, 'artifacts', 'ARCHIVED.json'), 'utf8'))
      .folders.c1.tag,
    'c1',
  )
  const manifest = JSON.parse(
    fake.state.releases.get('c1').assets.get('c1.files.json').data,
  )
  assert.deepEqual(manifest.files, [
    {
      path: 'artifacts/c1/native/run.txt',
      size: 12,
      sha256: sha256('evidence one'),
    },
  ])
})

test('acts as the archive account on every gh call and never switches the account', async () => {
  // protects=evidence only goes out under the owner's account token; fails_when=a gh call after the token lookup lacks GH_TOKEN or gh auth switch runs; no_claim=does not check the token's rights on GitHub
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  await rotate(root, fake, ['--current', '5', '--apply'])
  // Assert
  const [lookup, ...others] = fake.state.calls
  assert.deepEqual(lookup.args, ['auth', 'token', '--user', 'ryota-murakami'])
  assert.ok(others.length > 5)
  assert.deepEqual([...new Set(others.map((call) => call.token))], [TOKEN])
  assert.equal(
    fake.state.calls.some((call) => call.args.includes('switch')),
    false,
  )
})

test('keeps the folder and exits nonzero when a downloaded asset differs, while other folders still rotate', async () => {
  // protects=acceptance 2: a forced hash mismatch never deletes the local folder; fails_when=the corrupted folder is deleted, the exit is 0, or the second folder is not archived; no_claim=does not show how the corrupt asset on GitHub is repaired
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, 'c2/b.txt', 'two')
  const fake = createFakeGh({ corruptPattern: 'c1.tar.gz' })
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
  assert.equal((await snapshot(join(root, 'artifacts')))['c2/b.txt'], undefined)
  assert.ok(lines.some((line) => line.startsWith('FAILED c1 E_HASH_MISMATCH')))
  assert.equal(
    summaryOf(lines),
    'ROTATE: archived=1 deleted=0 kept=0 skipped=0 failed=1 freed_bytes=3',
  )
  assert.equal(JSON.parse(fake.state.index).folders.c1, undefined)
})

test('keeps a folder that changed after packing', async () => {
  // protects=a file written after packing stops the deletion (step 4); fails_when=a changed folder is deleted; no_claim=a change during the final scan itself is not covered
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  const originalHandle = fake.handle
  fake.handle = async (args, options) => {
    const answer = await originalHandle(args, options)
    // A run writes into the folder right after its upload finished.
    if (args[1] === 'upload' && args[3].endsWith('c1.files.json'))
      await writeFile(join(root, 'artifacts', 'c1', 'a.txt'), 'changed')
    return answer
  }
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(lines.some((line) => line.startsWith('FAILED c1 E_FOLDER_CHANGED')))
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'changed',
  )
})

test('refuses a public archive repository before uploading anything', async () => {
  // protects=private evidence never reaches a public repository; fails_when=an upload or deletion happens against a public repository; no_claim=does not prove the repository stays private later
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh({ visibility: 'PUBLIC' })
  // Act
  const outcome = rotate(root, fake, ['--current', '5', '--apply'])
  // Assert
  await assert.rejects(outcome, { code: 'E_NOT_PRIVATE' })
  assert.equal(fake.uploadedNames().length, 0)
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
})

test('refuses a missing --current with a first-line code and a last-line fix', async () => {
  // protects=acceptance 3: the plan and --apply never guess the cycle; fails_when=the run proceeds or the refusal lacks its code line or Fix line; no_claim=other refusals use the same formatter
  // Arrange
  const root = await makeRoot()
  const printed = []
  // Act
  const code = await runCommandLine(
    (progress) =>
      main(progress, ['--apply'], {
        repositoryRoot: root,
        run: async () => {
          throw new Error('no call expected')
        },
      }),
    { printError: (line) => printed.push(line), environment: {} },
  )
  // Assert
  assert.equal(code, 1)
  assert.match(printed[0], /^E_CURRENT_REQUIRED: /)
  assert.match(printed.at(-1), /^Fix: /)
})

test('documents every refusal code in the help text', () => {
  // protects=a caller finds each E_ code in --help; fails_when=a code the tool throws is missing from HELP_TEXT; no_claim=the wording of each fix is not checked
  // Arrange
  const source = [
    'E_USAGE',
    'E_CURRENT_REQUIRED',
    'E_NO_ACCOUNT',
    'E_REPO_MISSING',
    'E_NOT_PRIVATE',
    'E_INIT_EXISTS',
    'E_GIT',
    'E_ABOVE_RETENTION',
    'E_ASSET_CONFLICT',
    'E_HASH_MISMATCH',
    'E_FOLDER_CHANGED',
    'E_RESTORE_UNKNOWN',
    'E_RESTORE_EXISTS',
    'E_RESTORE_UNSAFE',
    'E_RESTORE_UNSUPPORTED',
    'E_INTERNAL',
  ]
  // Act
  const missing = source.filter((code) => !HELP_TEXT.includes(code))
  // Assert
  assert.deepEqual(missing, [])
})

test('never touches a cycle above N - keep whatever its size or age', async () => {
  // protects=acceptance 3: the retention boundary holds in a real apply; fails_when=any file of cycles 3 to 6 changes or is uploaded; no_claim=the boundary rule itself is pinned by the classification test
  // Arrange
  const root = await makeRoot()
  for (const cycle of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
    await putFile(root, `${cycle}/f.txt`, cycle, 400 * DAY)
  const before = await snapshot(join(root, 'artifacts'))
  const fake = createFakeGh()
  // Act
  await rotate(root, fake, ['--current', '5', '--keep', '3', '--apply'])
  // Assert
  const after = await snapshot(join(root, 'artifacts'))
  for (const kept of ['c3', 'c4', 'c5', 'c6'])
    assert.equal(after[`${kept}/f.txt`], before[`${kept}/f.txt`])
  assert.deepEqual(
    fake.uploadedNames().filter((name) => /^c[3-6]\./.test(name)),
    [],
  )
  assert.deepEqual(fake.assetNames('c2'), ['c2.files.json', 'c2.tar.gz'])
})

test('resumes after a stopped upload, reusing the parts already uploaded', async () => {
  // protects=a rerun does not upload an asset twice and finishes the folder; fails_when=the first part is uploaded again, the rerun fails or the folder stays; no_claim=a partial upload of a single asset is not simulated
  // Arrange
  const root = await makeRoot()
  const content = incompressible(4000)
  await putFile(root, 'c1/big.bin', content)
  const fake = createFakeGh()
  fake.state.uploadsLeft = 1
  const options = { partBytes: 1500 }
  // Act
  const first = await rotate(root, fake, ['--current', '5', '--apply'], options)
  const uploadedBefore = fake.uploadedNames()
  fake.state.uploadsLeft = Number.POSITIVE_INFINITY
  const second = await rotate(
    root,
    fake,
    ['--current', '5', '--apply'],
    options,
  )
  // Assert
  assert.equal(first.code, 3)
  assert.deepEqual(uploadedBefore, ['c1.tar.gz.part-000'])
  assert.equal(second.code, 0)
  const allUploads = fake.uploadedNames()
  assert.equal(
    allUploads.filter((name) => name === 'c1.tar.gz.part-000').length,
    1,
  )
  assert.deepEqual(fake.assetNames('c1'), [
    'c1.files.json',
    'c1.tar.gz.part-000',
    'c1.tar.gz.part-001',
    'c1.tar.gz.part-002',
    'c1.tar.gz.part-003',
  ])
  assert.equal((await readdir(join(root, 'artifacts'))).includes('c1'), false)
})

test('reuses a same-hash asset even when GitHub reports no digest for it', async () => {
  // protects=resume works for old assets that carry no digest by downloading and hashing them; fails_when=such an asset is refused or uploaded twice; no_claim=does not show the digest field is present on real assets
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh({ omitDigest: true })
  fake.state.uploadsLeft = 1
  await rotate(root, fake, ['--current', '5', '--apply'])
  fake.state.uploadsLeft = Number.POSITIVE_INFINITY
  // Act
  const { code } = await rotate(root, fake, ['--current', '5', '--apply'])
  // Assert
  assert.equal(code, 0)
  assert.equal(
    fake.uploadedNames().filter((name) => name === 'c1.tar.gz').length,
    1,
  )
})

test('refuses to overwrite a release asset of the same name with another hash', async () => {
  // protects=an earlier archive is never overwritten by different bytes; fails_when=the asset changes, or the folder is deleted; no_claim=does not tell which side is right
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  fake.seed('c1', 'c1.tar.gz', Buffer.from('some other archive'))
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(lines.some((line) => line.startsWith('FAILED c1 E_ASSET_CONFLICT')))
  assert.equal(
    fake.state.releases.get('c1').assets.get('c1.tar.gz').data.toString(),
    'some other archive',
  )
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
})

test('skips and names a folder holding a symbolic link, leaving it whole', async () => {
  // protects=a link is never followed, archived or deleted; fails_when=the folder is archived or deleted; no_claim=special files other than links are not created here
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  await symlink('a.txt', join(root, 'artifacts', 'c1', 'link'))
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 0)
  assert.ok(
    lines.includes('skip    c1 3 (symbolic link or special file: link)'),
  )
  assert.equal(
    summaryOf(lines),
    'ROTATE: archived=0 deleted=0 kept=0 skipped=1 failed=0 freed_bytes=0',
  )
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
})

test('skips a folder when twice its size exceeds the free disk space', async () => {
  // protects=the temporary copies never fill the disk; fails_when=the folder is packed with too little space; no_claim=real free space is not measured here
  // Arrange
  const root = await makeRoot()
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  const { lines } = await rotate(root, fake, ['--current', '5', '--apply'], {
    freeBytes: async () => 5,
  })
  // Assert
  assert.ok(lines.some((line) => line.startsWith('skipped c1 E_DISK_SPACE')))
  assert.equal(fake.uploadedNames().length, 0)
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
})

test('archives QA builds older than the newest ten once, without uploading them again', async () => {
  // protects=old QA builds leave artifacts/qa as release assets and are never re-uploaded; fails_when=a recent build is archived or a second run uploads again; no_claim=QA builds are not restored by the tool
  // Arrange
  const root = await makeRoot()
  for (let build = 0; build < 12; build += 1) {
    const stem = `codebook-${String(build).padStart(7, '0')}`
    await putFile(
      root,
      `qa/${stem}.vsix`,
      `vsix ${build}`,
      2 * DAY + build * 1000,
    )
    await putFile(
      root,
      `qa/${stem}.json`,
      `json ${build}`,
      2 * DAY + build * 1000,
    )
  }
  const fake = createFakeGh()
  // Act
  const first = await rotate(root, fake, ['--current', '5', '--apply'])
  const uploadsAfterFirst = fake.uploadedNames().length
  const second = await rotate(root, fake, ['--current', '5', '--apply'])
  // Assert
  assert.equal(first.code, 0)
  assert.equal(second.code, 0)
  assert.deepEqual(fake.assetNames('qa-builds'), [
    'codebook-0000010.json',
    'codebook-0000010.vsix',
    'codebook-0000011.json',
    'codebook-0000011.vsix',
  ])
  assert.equal(uploadsAfterFirst, 4)
  assert.equal(fake.uploadedNames().length, 4)
  assert.equal((await readdir(join(root, 'artifacts', 'qa'))).length, 20)
})

test('restores an archived folder byte-identical to its files.json and refuses an existing destination', async () => {
  // protects=acceptance 4: a restore rebuilds every file with the archived SHA-256; fails_when=a byte differs, or an existing folder is overwritten; no_claim=timestamps and owners are not restored
  // Arrange
  const root = await makeRoot()
  const binary = incompressible(3000)
  await putFile(root, 'c1/native/run.tgz', binary)
  await putFile(root, 'c1/notes/empty.txt', '')
  await putFile(root, 'c1/frames/a b.png', 'name with a space')
  const before = await snapshot(join(root, 'artifacts', 'c1'))
  const fake = createFakeGh()
  await rotate(root, fake, ['--current', '5', '--apply'], { partBytes: 1000 })
  assert.equal((await readdir(join(root, 'artifacts'))).includes('c1'), false)
  // Act
  const restored = await rotate(root, fake, ['--restore', 'c1'])
  // Assert
  assert.equal(restored.code, 0)
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), before)
  assert.deepEqual(restored.lines, [
    'RESTORE: c1 restored with 3 files, 3017 bytes',
  ])
  await assert.rejects(rotate(root, fake, ['--restore', 'c1']), {
    code: 'E_RESTORE_EXISTS',
  })
})

test('refuses to restore a folder that is not in the archive index', async () => {
  // protects=a typo restores nothing; fails_when=a folder appears in artifacts/; no_claim=does not list the archived folders
  // Arrange
  const root = await makeRoot()
  const fake = createFakeGh()
  fake.seedIndex({ schemaVersion: 1, folders: {} })
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c9'])
  // Assert
  await assert.rejects(outcome, { code: 'E_RESTORE_UNKNOWN' })
  assert.deepEqual(await readdir(join(root, 'artifacts')), [])
})

test('refuses to restore an archive with a member path that climbs out of the folder', async () => {
  // protects=a restore never writes outside artifacts/<folder>; fails_when=the member c1/../../evil is extracted or the folder is created; no_claim=names made unsafe by Unicode tricks are not covered
  // Arrange
  const root = await makeRoot()
  const archive = tarGz(
    tarMember('c1/ok.txt', Buffer.from('ok')),
    tarMember('c1/../../evil.txt', Buffer.from('bad')),
  )
  const fake = createFakeGh()
  seedArchive(fake, archive, {
    schemaVersion: 1,
    folder: 'c1',
    files: [],
    count: 2,
    bytes: 5,
  })
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c1'])
  // Assert
  await assert.rejects(outcome, { code: 'E_RESTORE_UNSAFE' })
  assert.deepEqual(await readdir(join(root, 'artifacts')), [])
  assert.deepEqual(
    await readdir(dirname(root)).then((names) =>
      names.filter((name) => name === 'evil.txt'),
    ),
    [],
  )
})

test('refuses to restore an archive that holds a symbolic link', async () => {
  // protects=a link inside an archive cannot point out of the restored folder; fails_when=the link is created; no_claim=links are also never archived by this tool
  // Arrange
  const root = await makeRoot()
  const archive = tarGz(
    tarMember('c1/ok.txt', Buffer.from('ok')),
    tarMember('c1/link', Buffer.alloc(0), { type: '2', linkname: '/etc' }),
  )
  const fake = createFakeGh()
  seedArchive(fake, archive, {
    schemaVersion: 1,
    folder: 'c1',
    files: [],
    count: 1,
    bytes: 2,
  })
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c1'])
  // Assert
  await assert.rejects(outcome, { code: 'E_RESTORE_UNSAFE' })
  assert.deepEqual(await readdir(join(root, 'artifacts')), [])
})

test('creates the private archive repository once and refuses to create it twice', async () => {
  // protects=--init makes a private repository with an empty index and never touches an existing one; fails_when=the repository is created without --private, the index is missing, or a second init proceeds; no_claim=does not create anything on GitHub
  // Arrange
  const root = await makeRoot()
  const fake = createFakeGh({ exists: false })
  // Act
  const created = await rotate(root, fake, ['--init'])
  const again = rotate(root, fake, ['--init'])
  // Assert
  assert.deepEqual(created.lines, [`INIT: created ${REPOSITORY} (private)`])
  const create = fake.state.calls.find((call) => call.args[1] === 'create')
  assert.ok(create.args.includes('--private'))
  assert.deepEqual(JSON.parse(fake.state.index), {
    schemaVersion: 1,
    folders: {},
  })
  await assert.rejects(again, { code: 'E_INIT_EXISTS' })
})
