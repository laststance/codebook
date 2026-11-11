import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import {
  buildFilesJson,
  checkMemberPaths,
  classifyInventory,
  compareWithManifest,
  createCommandRunner,
  HELP_TEXT,
  isSafeEntryName,
  main,
  parseCycleNumber,
  PartSplitter,
  sortParts,
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

/** Creates a temporary repository root with an empty artifacts/ folder, removed when the test ends. */
async function makeRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'rotate-artifacts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
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
    // An existing archive repository holds the empty index --init wrote, unless a test says otherwise.
    index:
      (options.exists ?? true) && !(options.noIndex ?? false)
        ? JSON.stringify({ schemaVersion: 1, folders: {} })
        : null,
    indexVersion: 1,
    failIndexWrite: options.failIndexWrite ?? false,
    putBodies: [],
    calls: [],
    uploadsLeft: Number.POSITIVE_INFINITY,
    uploaded: [],
    corruptPattern: options.corruptPattern ?? null,
    omitDigest: options.omitDigest ?? false,
    // `gh auth token` fails, as when the archive account is not logged in.
    authFails: options.authFails ?? false,
    // A `gh release download` whose asset pattern contains this text fails, as a dropped connection would.
    failDownloadFor: options.failDownloadFor ?? null,
    // A `gh release upload` of a file whose name ends with this text fails with an error that is no name conflict.
    failUploadFor: options.failUploadFor ?? null,
    nextId: 1,
  }
  const result = (stdout) => ({ status: 0, stdout, stderr: '' })
  const failure = (stderr) => ({ status: 1, stdout: '', stderr })
  const addAsset = (tag, name, data, assetState = 'uploaded') => {
    const release = state.releases.get(tag)
    release.assets.set(name, {
      id: state.nextId++,
      name,
      data,
      state: assetState,
    })
  }
  /** Like `gh release download --pattern`: the pattern is a glob over the whole asset name. */
  const matchesPattern = (pattern, name) =>
    new RegExp(
      `^${pattern
        .replace(/[.+^${}()|\\[\]]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')}$`,
    ).test(name)
  async function handle(args, callOptions) {
    state.calls.push({ args, token: callOptions?.env?.GH_TOKEN })
    const [first, second] = args
    if (first === 'auth')
      return state.authFails ? failure('no token found') : result(`${TOKEN}\n`)
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
      if (state.failUploadFor !== null && args[3].endsWith(state.failUploadFor))
        return failure('HTTP 502 bad gateway')
      state.uploadsLeft -= 1
      const name = args[3].split('/').at(-1)
      if (state.releases.get(args[2]).assets.has(name))
        return failure('asset under the same name already exists')
      addAsset(args[2], name, await readFile(args[3]))
      state.uploaded.push(name)
      return result('')
    }
    if (first === 'release' && second === 'download') {
      const pattern = args[args.indexOf('--pattern') + 1]
      if (
        state.failDownloadFor !== null &&
        pattern.includes(state.failDownloadFor)
      )
        return failure('connection reset')
      const matching = [
        ...(state.releases.get(args[2])?.assets.values() ?? []),
      ].filter((asset) => matchesPattern(pattern, asset.name))
      if (matching.length === 0) return failure('no assets match')
      for (const asset of matching) {
        let data = asset.data
        if (
          state.corruptPattern !== null &&
          asset.name.includes(state.corruptPattern)
        ) {
          data = Buffer.from(data)
          data[data.length - 1] ^= 0xff
        }
        await writeFile(join(args[args.indexOf('--dir') + 1], asset.name), data)
      }
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
      if (state.failIndexWrite) return failure('HTTP 500 index write failed')
      // The body travels in a file (--input), never in an argument: -f content=... would break Linux's 128 KiB argument limit.
      if (!args.includes('--input') || args.includes('-f'))
        return failure('index.json must be written with --input <file>')
      const fields = JSON.parse(
        await readFile(args[args.indexOf('--input') + 1], 'utf8'),
      )
      state.putBodies.push(fields)
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
    seed(tag, name, data, assetState = 'uploaded') {
      if (!state.releases.has(tag))
        state.releases.set(tag, {
          id: state.nextId++,
          assets: new Map(),
          notes: '',
        })
      addAsset(tag, name, data, assetState)
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
  const { rewriteTarArgs, ...mainOverrides } = overrides
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
      // A test may change what tar packs (for example to leave a file out); extraction is left alone.
      if (
        command === 'tar' &&
        args[0] === '-cf' &&
        rewriteTarArgs !== undefined
      )
        return realRun(command, rewriteTarArgs(args), options)
      return realRun(command, args, options)
    },
    ...mainOverrides,
  })
  return { code, lines }
}

/** Wraps the fake's `gh` so `hook(args)` runs right after each call that matches, as a run writing into artifacts/ would. */
function afterGhCall(fake, matches, hook) {
  const originalHandle = fake.handle
  fake.handle = async (args, options) => {
    const answer = await originalHandle(args, options)
    if (matches(args)) await hook()
    return answer
  }
}

const isUploadOf = (name) => (args) =>
  args[1] === 'upload' && args[3].endsWith(name)

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

test('archives review notes with their QA build, archives notes whose build already left, and lists a file of no build', () => {
  // protects=notes named codebook-<sha>-… leave with their build and nothing in qa/ is left out of the plan silently; fails_when=notes stay behind forever, a notes-only group takes one of the ten kept places, or a file of no build is missing from the plan; no_claim=the upload of the notes is not exercised here
  // Arrange
  const info = (name, newestMs) => ({
    name,
    bytes: 10,
    newestMs,
    special: [],
    fileCount: 1,
  })
  const qa = []
  for (let build = 0; build < 11; build += 1) {
    const stem = `codebook-${String(build).padStart(7, '0')}`
    qa.push(
      info(`${stem}.vsix`, NOW - DAY - build * 1000),
      info(`${stem}.json`, NOW - DAY - build * 1000),
    )
  }
  qa.push(
    info(
      'codebook-0000010-20261102T185302Z-f92aa6-codex-review.txt',
      NOW - DAY - 20000,
    ),
    info(
      'codebook-00ffaa1-20261102T183139Z-e0d1e4-review-state.txt',
      NOW - 3600 * 1000,
    ),
    info('c68-datapoint-0ac1b411-codex-review.txt', NOW - DAY),
  )
  const inventory = { entries: [], gate: [], qa }
  // Act
  const plan = classifyInventory(inventory, {
    current: 117,
    keep: 3,
    headShort: 'abcdef01',
    now: NOW,
  })
  // Assert
  const lines = plan.map((item) => `${item.action} ${item.name}`)
  assert.equal(
    lines.filter((line) => line.startsWith('keep qa/codebook-')).length,
    10,
  )
  assert.deepEqual(
    lines.filter((line) => line.startsWith('archive')),
    ['archive qa/codebook-00ffaa1', 'archive qa/codebook-0000010'],
  )
  assert.deepEqual(
    plan.find((item) => item.name === 'qa/codebook-0000010').files,
    [
      'codebook-0000010-20261102T185302Z-f92aa6-codex-review.txt',
      'codebook-0000010.json',
      'codebook-0000010.vsix',
    ],
  )
  assert.deepEqual(
    plan.find(
      (item) => item.name === 'qa/c68-datapoint-0ac1b411-codex-review.txt',
    ),
    {
      action: 'keep',
      name: 'qa/c68-datapoint-0ac1b411-codex-review.txt',
      bytes: 10,
      kind: 'qa-other',
      reason: 'not a QA build',
    },
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

test('cuts an archive stream into numbered parts no larger than the limit and hashes each', async (t) => {
  // protects=release assets stay under GitHub's size limit and carry their own SHA-256; fails_when=a part exceeds the limit, an exact multiple leaves an empty part, or a single part gets a suffix; no_claim=the real 1900 MiB limit is not exercised
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'rotate-parts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
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

test('prints the plan and changes nothing without --apply', async (t) => {
  // protects=the plan-only mode (acceptance 1) leaves artifacts untouched and never calls gh; fails_when=a file moves, a folder is deleted or gh is called; no_claim=does not prove --apply
  // Arrange
  const root = await makeRoot(t)
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

test('archives an old cycle only after a verified download, deletes it, and leaves newer cycles and the HEAD gate folder alone', async (t) => {
  // protects=acceptance 2: the local folder goes only after re-download, hash and files.json checks, and the record exists; fails_when=the folder stays, a kept cycle goes, or the index lacks the folder; no_claim=a failed verification is a separate test
  // Arrange
  const root = await makeRoot(t)
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
  const after = await snapshot(join(root, 'artifacts'))
  // ARCHIVED.json is checked for presence and content apart, not compared with itself.
  assert.notEqual(after['ARCHIVED.json'], undefined)
  delete after['ARCHIVED.json']
  assert.deepEqual(after, {
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

test('acts as the archive account on every gh call and never switches the account', async (t) => {
  // protects=evidence only goes out under the owner's account token; fails_when=a gh call after the token lookup lacks GH_TOKEN or gh auth switch runs; no_claim=does not check the token's rights on GitHub
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  await rotate(root, fake, ['--current', '4', '--apply'])
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

test('keeps the folder and exits nonzero when a downloaded asset differs, while other folders still rotate', async (t) => {
  // protects=acceptance 2: a forced hash mismatch never deletes the local folder; fails_when=the corrupted folder is deleted, the exit is 0, or the second folder is not archived; no_claim=does not show how the corrupt asset on GitHub is repaired
  // Arrange
  const root = await makeRoot(t)
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

test('keeps a folder that changed after packing', async (t) => {
  // protects=a file written after packing stops the deletion (step 4); fails_when=a changed folder is deleted; no_claim=a change during the final scan itself is not covered
  // Arrange
  const root = await makeRoot(t)
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
    '4',
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

test('refuses a public archive repository before uploading anything', async (t) => {
  // protects=private evidence never reaches a public repository; fails_when=an upload or deletion happens against a public repository; no_claim=does not prove the repository stays private later
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh({ visibility: 'PUBLIC' })
  // Act
  const outcome = rotate(root, fake, ['--current', '4', '--apply'])
  // Assert
  await assert.rejects(outcome, { code: 'E_NOT_PRIVATE' })
  assert.equal(fake.uploadedNames().length, 0)
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
})

test('refuses a missing --current with a first-line code and a last-line fix', async (t) => {
  // protects=acceptance 3: the plan and --apply never guess the cycle; fails_when=the run proceeds or the refusal lacks its code line or Fix line; no_claim=other refusals use the same formatter
  // Arrange
  const root = await makeRoot(t)
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

test('documents every error code the source uses in the help text', async () => {
  // protects=a caller finds each E_ code the tool can print in --help; fails_when=a code in the source (refusal, skipped or FAILED line) is missing from HELP_TEXT's error list; no_claim=the wording of each code's explanation is not checked
  // Arrange
  const source = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'rotate-artifacts.mjs'),
    'utf8',
  )
  const used = [...new Set(source.match(/\bE_[A-Z][A-Z_]*\b/g))]
  const errorList = HELP_TEXT.slice(HELP_TEXT.indexOf('Error codes:'))
  // Act
  const missing = used.filter((code) => !errorList.includes(code))
  // Assert
  assert.ok(used.length > 20)
  assert.deepEqual(missing, [])
})

test('never touches a cycle above N - keep whatever its size or age', async (t) => {
  // protects=acceptance 3: the retention boundary holds in a real apply; fails_when=any file of cycles 3 to 6 changes or is uploaded; no_claim=the boundary rule itself is pinned by the classification test
  // Arrange
  const root = await makeRoot(t)
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

test('resumes after a stopped upload, reusing the parts already uploaded', async (t) => {
  // protects=a rerun does not upload an asset twice and finishes the folder; fails_when=the first part is uploaded again, the rerun fails or the folder stays; no_claim=a partial upload of a single asset is not simulated
  // Arrange
  const root = await makeRoot(t)
  const content = incompressible(4000)
  await putFile(root, 'c1/big.bin', content)
  const fake = createFakeGh()
  fake.state.uploadsLeft = 1
  const options = { partBytes: 1500 }
  // Act
  const first = await rotate(root, fake, ['--current', '4', '--apply'], options)
  const uploadedBefore = fake.uploadedNames()
  fake.state.uploadsLeft = Number.POSITIVE_INFINITY
  const second = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
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
  // The part count depends on how gzip packs; the manifest and at least two numbered parts are what the test fixes.
  const names = fake.assetNames('c1')
  assert.ok(names.includes('c1.files.json'))
  assert.ok(names.filter((name) => name.includes('.tar.gz.part-')).length >= 2)
  assert.equal((await readdir(join(root, 'artifacts'))).includes('c1'), false)
})

test('reuses a same-hash asset even when GitHub reports no digest for it', async (t) => {
  // protects=resume works for old assets that carry no digest by downloading and hashing them; fails_when=such an asset is refused or uploaded twice; no_claim=does not show the digest field is present on real assets
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh({ omitDigest: true })
  fake.state.uploadsLeft = 1
  await rotate(root, fake, ['--current', '4', '--apply'])
  fake.state.uploadsLeft = Number.POSITIVE_INFINITY
  // Act
  const { code } = await rotate(root, fake, ['--current', '4', '--apply'])
  // Assert
  assert.equal(code, 0)
  assert.equal(
    fake.uploadedNames().filter((name) => name === 'c1.tar.gz').length,
    1,
  )
})

test('refuses to overwrite a release asset of the same name with another hash', async (t) => {
  // protects=an earlier archive is never overwritten by different bytes; fails_when=the asset changes, or the folder is deleted; no_claim=does not tell which side is right
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  fake.seed('c1', 'c1.tar.gz', Buffer.from('some other archive'))
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
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

test('skips and names a folder holding a symbolic link, leaving it whole', async (t) => {
  // protects=a link is never followed, archived or deleted; fails_when=the folder is archived or deleted; no_claim=special files other than links are not created here
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await symlink('a.txt', join(root, 'artifacts', 'c1', 'link'))
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
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

test('skips a folder when twice its size exceeds the free disk space', async (t) => {
  // protects=the temporary copies never fill the disk; fails_when=the folder is packed with too little space; no_claim=real free space is not measured here
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  const { lines } = await rotate(root, fake, ['--current', '4', '--apply'], {
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

test('archives QA builds older than the newest ten once, without uploading them again', async (t) => {
  // protects=old QA builds leave artifacts/qa as release assets and are never re-uploaded; fails_when=a recent build is archived or a second run uploads again; no_claim=QA builds are not restored by the tool
  // Arrange
  const root = await makeRoot(t)
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

test('restores an archived folder byte-identical to its files.json and refuses an existing destination', async (t) => {
  // protects=acceptance 4: a restore rebuilds every file with the archived SHA-256; fails_when=a byte differs, or an existing folder is overwritten; no_claim=timestamps and owners are not restored
  // Arrange
  const root = await makeRoot(t)
  const binary = incompressible(3000)
  await putFile(root, 'c1/native/run.tgz', binary)
  await putFile(root, 'c1/notes/empty.txt', '')
  await putFile(root, 'c1/frames/a b.png', 'name with a space')
  const before = await snapshot(join(root, 'artifacts', 'c1'))
  const fake = createFakeGh()
  await rotate(root, fake, ['--current', '4', '--apply'], { partBytes: 1000 })
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

test('refuses to restore a folder that is not in the archive index', async (t) => {
  // protects=a typo restores nothing; fails_when=a folder appears in artifacts/; no_claim=does not list the archived folders
  // Arrange
  const root = await makeRoot(t)
  const fake = createFakeGh()
  fake.seedIndex({ schemaVersion: 1, folders: {} })
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c9'])
  // Assert
  await assert.rejects(outcome, { code: 'E_RESTORE_UNKNOWN' })
  assert.deepEqual(await readdir(join(root, 'artifacts')), [])
})

test('refuses to restore an archive with a member path that climbs out of the folder', async (t) => {
  // protects=a restore never writes outside artifacts/<folder>; fails_when=the member c1/../../evil is extracted or the folder is created; no_claim=names made unsafe by Unicode tricks are not covered
  // Arrange
  const root = await makeRoot(t)
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

test('refuses to restore an archive that holds a symbolic link', async (t) => {
  // protects=a link inside an archive cannot point out of the restored folder; fails_when=the link is created; no_claim=links are also never archived by this tool
  // Arrange
  const root = await makeRoot(t)
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

test('creates the private archive repository once and refuses to create it twice', async (t) => {
  // protects=--init makes a private repository with an empty index and never touches an existing one; fails_when=the repository is created without --private, the index is missing, or a second init proceeds; no_claim=does not create anything on GitHub
  // Arrange
  const root = await makeRoot(t)
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

/** Writes the 12 QA builds codebook-0000000 to -0000011 (higher numbers are older), so the two oldest are archived. */
async function putQaBuilds(root) {
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
}

const artifactsNames = async (root) => readdir(join(root, 'artifacts'))

test('keeps the folder and writes no record when a file is added after packing', async (t) => {
  // protects=step 4: a file a run adds after packing stops the deletion before the record is written; fails_when=the extra file is deleted with the folder, or index.json already names the folder; no_claim=a file added after step 4 is covered by the last-check test
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  afterGhCall(fake, isUploadOf('c1.files.json'), () =>
    writeFile(join(root, 'artifacts', 'c1', 'late.txt'), 'late'),
  )
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.includes(
      'FAILED c1 E_FOLDER_CHANGED: c1 changed after packing: extra artifacts/c1/late.txt (kept)',
    ),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
    'late.txt': sha256('late'),
  })
  assert.equal(JSON.parse(fake.state.index).folders.c1, undefined)
})

test('keeps the folder when a file is rewritten with the same size after packing', async (t) => {
  // protects=step 4 compares content, not only sizes; fails_when=a same-length rewrite passes and the folder is deleted; no_claim=a rewrite after step 4 is covered by the last-check test
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  afterGhCall(fake, isUploadOf('c1.files.json'), () =>
    writeFile(join(root, 'artifacts', 'c1', 'a.txt'), 'two'),
  )
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.includes(
      'FAILED c1 E_FOLDER_CHANGED: c1 changed after packing: differs artifacts/c1/a.txt (kept)',
    ),
  )
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'two',
  )
  assert.equal(JSON.parse(fake.state.index).folders.c1, undefined)
})

test('keeps the folder when index.json cannot be written, because the record comes before the deletion', async (t) => {
  // protects=an archive without its index record never costs the local copy; fails_when=the folder is deleted before or despite a failed index write; no_claim=does not show how a half-recorded run is repaired
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh({ failIndexWrite: true })
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(lines.some((line) => line.startsWith('FAILED c1 E_GITHUB')))
  assert.deepEqual(await snapshot(join(root, 'artifacts')), {
    'c1/a.txt': sha256('one'),
  })
})

test('refuses to restore an archive whose tar content differs from its files.json and publishes nothing', async (t) => {
  // protects=a restore proves every file against files.json before moving anything into artifacts/; fails_when=the folder appears although a file's SHA-256 differs from the manifest; no_claim=does not show which of the two (tar or manifest) is the wrong one
  // Arrange
  const root = await makeRoot(t)
  const fake = createFakeGh()
  seedArchive(fake, tarGz(tarMember('c1/ok.txt', Buffer.from('ok'))), {
    schemaVersion: 1,
    folder: 'c1',
    files: [{ path: 'artifacts/c1/ok.txt', size: 2, sha256: sha256('not ok') }],
    count: 1,
    bytes: 2,
  })
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c1'])
  // Assert
  await assert.rejects(outcome, { code: 'E_HASH_MISMATCH' })
  assert.deepEqual(await artifactsNames(root), [])
})

test('keeps a QA build whose archived asset downloads corrupted, while the other old build rotates', async (t) => {
  // protects=a QA build is deleted only after its re-downloaded asset matches; fails_when=the build with the corrupted asset is deleted; no_claim=says nothing about builds inside the newest ten
  // Arrange
  const root = await makeRoot(t)
  await putQaBuilds(root)
  const fake = createFakeGh({ corruptPattern: 'codebook-0000010.vsix' })
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) =>
      line.startsWith('FAILED qa/codebook-0000010 E_HASH_MISMATCH'),
    ),
  )
  const qa = await readdir(join(root, 'artifacts', 'qa'))
  assert.ok(qa.includes('codebook-0000010.vsix'))
  assert.ok(qa.includes('codebook-0000010.json'))
  assert.equal(qa.includes('codebook-0000011.vsix'), false)
})

test('keeps a QA build that changed while it was uploaded and records only the other build', async (t) => {
  // protects=a QA build rewritten during its upload is kept and not recorded as archived; fails_when=the changed build is deleted or named in index.json; no_claim=does not cover a change after the record was written
  // Arrange
  const root = await makeRoot(t)
  await putQaBuilds(root)
  const fake = createFakeGh()
  afterGhCall(fake, isUploadOf('codebook-0000010.vsix'), () =>
    writeFile(
      join(root, 'artifacts', 'qa', 'codebook-0000010.vsix'),
      'tampered',
    ),
  )
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) =>
      line.startsWith('FAILED qa/codebook-0000010 E_FOLDER_CHANGED'),
    ),
  )
  assert.equal(
    await readFile(
      join(root, 'artifacts', 'qa', 'codebook-0000010.vsix'),
      'utf8',
    ),
    'tampered',
  )
  const recorded = JSON.parse(fake.state.index).folders['qa-builds'].assets.map(
    (asset) => asset.name,
  )
  assert.deepEqual(recorded, ['codebook-0000011.json', 'codebook-0000011.vsix'])
})

test('keeps a folder whose archive lacks a file of files.json even though every asset hash matches what was uploaded', async (t) => {
  // protects=step 3: the extracted archive is compared file by file with files.json, not only asset by asset; fails_when=a tar without b.txt passes and the folder is deleted; no_claim=says nothing about a tar with the wrong bytes (hash check)
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, 'c1/b.txt', 'two')
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
    {
      // The tar written leaves b.txt out; files.json (hashed before packing) still lists it.
      rewriteTarArgs: (args) => [
        '-cf',
        '-',
        '--exclude=c1/b.txt',
        ...args.slice(2),
      ],
    },
  )
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.includes(
      'FAILED c1 E_HASH_MISMATCH: the extracted c1 differs from files.json: missing artifacts/c1/b.txt (kept)',
    ),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
    'b.txt': sha256('two'),
  })
  assert.equal(JSON.parse(fake.state.index).folders.c1, undefined)
})

test('deletes a partial release asset and uploads it again instead of trusting it', async (t) => {
  // protects=a stopped upload that left an asset not in state uploaded never counts as a copy; fails_when=the partial asset is reused or the run fails on it; no_claim=does not simulate every GitHub asset state
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  fake.seed('c1', 'c1.tar.gz', Buffer.from('half'), 'starter')
  // Act
  const { code } = await rotate(root, fake, ['--current', '4', '--apply'])
  // Assert
  assert.equal(code, 0)
  assert.deepEqual(fake.uploadedNames(), ['c1.tar.gz', 'c1.files.json'])
  assert.equal(
    fake.state.releases.get('c1').assets.get('c1.tar.gz').state,
    'uploaded',
  )
  assert.deepEqual(await artifactsNames(root), ['ARCHIVED.json'])
})

test('skips and names a folder holding a hard-linked file, leaving it whole', async (t) => {
  // protects=F1: a hard link (link count above 1) is never archived, because a restore refuses it; fails_when=the folder is archived or deleted; no_claim=hard links outside artifacts/ are not looked at
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await link(
    join(root, 'artifacts', 'c1', 'a.txt'),
    join(root, 'artifacts', 'c1', 'b.txt'),
  )
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 0)
  assert.ok(
    lines.includes('skip    c1 0 (symbolic link or special file: a.txt)'),
  )
  assert.equal(
    summaryOf(lines),
    'ROTATE: archived=0 deleted=0 kept=0 skipped=1 failed=0 freed_bytes=0',
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
    'b.txt': sha256('one'),
  })
  assert.deepEqual(fake.uploadedNames(), [])
})

test('fails the entry before packing when a symbolic link appeared after the plan', async (t) => {
  // protects=F2: a link created between the plan and the packing is never followed or archived; fails_when=the folder is packed or uploaded; no_claim=a link created after packing is the next test
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
    {
      // freeBytes runs between the plan and the packing of each entry.
      freeBytes: async () => {
        await symlink('a.txt', join(root, 'artifacts', 'c1', 'sneaky'))
        return 10 ** 12
      },
    },
  )
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) =>
      line.startsWith('FAILED c1 E_FOLDER_CHANGED: c1 holds a symbolic link'),
    ),
  )
  assert.deepEqual(fake.uploadedNames(), [])
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'one',
  )
})

test('keeps the folder and writes no record when a symbolic link appears after packing', async (t) => {
  // protects=F2: the step 4 rescan reports a link as a change; fails_when=a link created after packing leaves the folder deletable; no_claim=does not follow the link target
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  afterGhCall(fake, isUploadOf('c1.files.json'), () =>
    symlink('a.txt', join(root, 'artifacts', 'c1', 'sneaky')),
  )
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.includes(
      'FAILED c1 E_FOLDER_CHANGED: c1 changed after packing: link c1/sneaky (kept)',
    ),
  )
  assert.equal(JSON.parse(fake.state.index).folders.c1, undefined)
})

test('reports links, missing and extra files when comparing a folder with a manifest', async (t) => {
  // protects=F2: the comparison used by every rescan names a link, a missing file and an extra file; fails_when=a link or an extra file is not reported; no_claim=hashes of matching files are not re-checked here
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, 'c1/extra.txt', 'more')
  await symlink('a.txt', join(root, 'artifacts', 'c1', 'ln'))
  const manifest = [
    { path: 'artifacts/c1/a.txt', size: 3, sha256: sha256('one') },
    { path: 'artifacts/c1/gone.txt', size: 1, sha256: sha256('x') },
  ]
  // Act
  const problems = await compareWithManifest(
    join(root, 'artifacts'),
    'c1',
    manifest,
  )
  // Assert
  assert.deepEqual(problems, [
    'link c1/ln',
    'missing artifacts/c1/gone.txt',
    'extra artifacts/c1/extra.txt',
  ])
})

test('puts a folder back and keeps everything when a file is written after the record', async (t) => {
  // protects=F3: the last check before deletion sees a write made after step 5; fails_when=the folder with the late file is deleted; no_claim=a write after the final rescan and before rm is not covered
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
    {
      afterRecord: () =>
        writeFile(join(root, 'artifacts', 'c1', 'late.txt'), 'late'),
    },
  )
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.includes(
      'FAILED c1 E_FOLDER_CHANGED: c1 changed just before deletion: extra artifacts/c1/late.txt; it was put back (kept)',
    ),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
    'late.txt': sha256('late'),
  })
  assert.equal((await artifactsNames(root)).includes('.rotate-tmp'), false)
})

test('keeps the renamed copy and names it when the folder path was recreated during the last check', async (t) => {
  // protects=F3: a put-back never overwrites a folder created meanwhile; the renamed copy stays and the error names it; fails_when=the recreated folder is replaced, the copy is deleted, or the path is not named; no_claim=says nothing about merging the two folders
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
    {
      runId: 'run-1',
      afterRecord: () =>
        writeFile(join(root, 'artifacts', 'c1', 'late.txt'), 'late'),
      afterAside: async () => {
        await mkdir(join(root, 'artifacts', 'c1'))
        await writeFile(join(root, 'artifacts', 'c1', 'new.txt'), 'new')
      },
    },
  )
  // Assert
  const aside = join(
    root,
    'artifacts',
    '.rotate-tmp',
    'run-1',
    'aside',
    'c1',
    'c1',
  )
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) => line.includes(`the renamed copy stays at ${aside}`)),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'new.txt': sha256('new'),
  })
  assert.deepEqual(await snapshot(aside), {
    'a.txt': sha256('one'),
    'late.txt': sha256('late'),
  })
  assert.equal(
    (await readdir(join(root, 'artifacts', '.rotate-tmp'))).includes('.lock'),
    false,
  )
})

test('skips an entry that became busy between the plan and its turn', async (t) => {
  // protects=F3: the 10-minute busy check runs again when an entry's turn comes; fails_when=a folder written to since the plan is packed and deleted; no_claim=a write during the packing itself is covered by the later rescans
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  let calls = 0
  // The plan reads the clock first; later reads are one minute after the file's modification.
  const now = () => (calls++ === 0 ? NOW : NOW - 2 * DAY + 60_000)
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
    {
      now,
    },
  )
  // Assert
  assert.equal(code, 0)
  assert.ok(
    lines.includes(
      'skipped c1 E_FOLDER_BUSY: a file changed within 10 minutes',
    ),
  )
  assert.deepEqual(fake.uploadedNames(), [])
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
  })
})

test('puts QA build files back when one changed during the last check', async (t) => {
  // protects=F3: QA build files are renamed aside and rehashed before they go; fails_when=a build rewritten after the record is deleted; no_claim=does not cover the build's json twin being rewritten
  // Arrange
  const root = await makeRoot(t)
  await putQaBuilds(root)
  const fake = createFakeGh()
  const asideFile = join(
    root,
    'artifacts',
    '.rotate-tmp',
    'run-q',
    'aside',
    'qa-codebook-0000010',
    'codebook-0000010.vsix',
  )
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '5', '--apply'],
    {
      runId: 'run-q',
      afterAside: async (stem) => {
        if (stem === 'codebook-0000010') await writeFile(asideFile, 'tampered')
      },
    },
  )
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) =>
      line.startsWith(
        'FAILED qa/codebook-0000010 E_FOLDER_CHANGED: codebook-0000010 changed just before deletion',
      ),
    ),
  )
  const qa = await readdir(join(root, 'artifacts', 'qa'))
  assert.equal(
    await readFile(
      join(root, 'artifacts', 'qa', 'codebook-0000010.vsix'),
      'utf8',
    ),
    'tampered',
  )
  assert.ok(qa.includes('codebook-0000010.json'))
  assert.equal(qa.includes('codebook-0000011.vsix'), false)
})

test('refuses the run when artifacts/gate is a symbolic link or artifacts/qa is not a folder', async (t) => {
  // protects=F4: a linked gate or qa container never sends the listing or a deletion elsewhere; fails_when=the plan lists, or --apply deletes, what lies behind the link; no_claim=top-level entries that are links are skipped by the plan, not by this check
  // Arrange
  const root = await makeRoot(t)
  await mkdir(join(root, 'elsewhere', '11111111'), { recursive: true })
  await writeFile(
    join(root, 'elsewhere', '11111111', 'summary.txt'),
    'precious',
  )
  await symlink(join(root, 'elsewhere'), join(root, 'artifacts', 'gate'))
  const otherRoot = await makeRoot(t)
  await writeFile(join(otherRoot, 'artifacts', 'qa'), 'a file, not a folder')
  const fake = createFakeGh()
  // Act
  const linkedGate = await rotate(root, fake, [
    '--current',
    '5',
    '--apply',
  ]).catch((error) => error)
  const fileQa = await rotate(otherRoot, fake, ['--current', '5']).catch(
    (error) => error,
  )
  // Assert
  assert.equal(linkedGate.code, 'E_UNSAFE_CONTAINER')
  assert.equal(fileQa.code, 'E_UNSAFE_CONTAINER')
  assert.equal(
    await readFile(join(root, 'elsewhere', '11111111', 'summary.txt'), 'utf8'),
    'precious',
  )
  assert.deepEqual(fake.state.calls, [])
})

test(
  'fails only the entry whose part write fails, closes its handles, and still rotates the next entry',
  { timeout: 60_000 },
  async (t) => {
    // protects=F5: a stream error such as ENOSPC ends tar, closes every part handle, fails that entry with E_PACK and lets the run go on; fails_when=the run hangs, an unhandled error crashes it, a handle stays open, or the next entry is not archived; no_claim=a real full disk is not produced
    // Arrange
    const root = await makeRoot(t)
    const big = incompressible(3_000_000)
    await putFile(root, 'c1/big.bin', big)
    await putFile(root, 'c2/small.txt', 'two')
    const fake = createFakeGh()
    const handles = []
    // Act
    const { code, lines } = await rotate(
      root,
      fake,
      ['--current', '5', '--apply'],
      {
        partBytes: 1_000_000,
        partWrite: async ({ baseName }, handle, buffer, offset, length) => {
          handles.push(handle)
          if (baseName === 'c1.tar.gz')
            throw Object.assign(new Error('ENOSPC: no space left on device'), {
              code: 'ENOSPC',
            })
          return handle.write(buffer, offset, length)
        },
      },
    )
    // Assert
    assert.equal(code, 3)
    assert.ok(
      lines.includes(
        'FAILED c1 E_PACK: packing c1 failed: ENOSPC: no space left on device (kept)',
      ),
    )
    assert.ok(handles.length >= 2)
    // A closed FileHandle reports fd -1.
    assert.deepEqual(
      handles.map((handle) => handle.fd),
      handles.map(() => -1),
    )
    assert.equal(fake.state.releases.has('c1'), false)
    assert.deepEqual(fake.assetNames('c2'), ['c2.files.json', 'c2.tar.gz'])
    assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
      'big.bin': sha256(big),
    })
  },
)

test('refuses --apply while a live run holds the lock and touches nothing of that run', async (t) => {
  // protects=F6: two runs never work at once; fails_when=a second --apply starts, replaces the lock or removes the other run's folder; no_claim=a lock held by a process that died is the stale-lock test
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, '.rotate-tmp/other/work/x.bin', 'in use')
  const lock = JSON.stringify({
    pid: process.pid,
    startedAt: '2026-11-11T11:00:00.000Z',
    runId: 'other',
  })
  await writeFile(join(root, 'artifacts', '.rotate-tmp', '.lock'), lock)
  const fake = createFakeGh()
  // Act
  const outcome = rotate(root, fake, ['--current', '4', '--apply'])
  // Assert
  await assert.rejects(outcome, { code: 'E_RUN_ACTIVE' })
  assert.equal(
    await readFile(join(root, 'artifacts', '.rotate-tmp', '.lock'), 'utf8'),
    lock,
  )
  assert.equal(
    await readFile(
      join(root, 'artifacts', '.rotate-tmp', 'other', 'work', 'x.bin'),
      'utf8',
    ),
    'in use',
  )
  assert.deepEqual(fake.uploadedNames(), [])
})

test('refuses --restore while a live run holds the lock', async (t) => {
  // protects=F6: a restore and an apply never overlap; fails_when=a restore starts under a live lock; no_claim=does not show a restore waiting for the lock
  // Arrange
  const root = await makeRoot(t)
  const lock = JSON.stringify({
    pid: process.pid,
    startedAt: '2026-11-11T11:00:00.000Z',
    runId: 'other',
  })
  await mkdir(join(root, 'artifacts', '.rotate-tmp'))
  await writeFile(join(root, 'artifacts', '.rotate-tmp', '.lock'), lock)
  const fake = createFakeGh()
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c1'])
  // Assert
  await assert.rejects(outcome, { code: 'E_RUN_ACTIVE' })
  assert.deepEqual(fake.state.calls, [])
})

test("replaces a lock whose process is dead, prints it, removes that run's work folder but keeps its renamed copies", async (t) => {
  // protects=F6: a crashed run never blocks the next one, and its set-aside evidence is never deleted; fails_when=the stale lock blocks the run, is replaced silently, or the other run's aside folder is removed; no_claim=does not cover two runs replacing one stale lock at the same moment
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, '.rotate-tmp/dead-run/work/leftover.bin', 'junk')
  await putFile(root, '.rotate-tmp/dead-run/aside/c9/keep.txt', 'evidence')
  await writeFile(
    join(root, 'artifacts', '.rotate-tmp', '.lock'),
    JSON.stringify({
      pid: 4242,
      startedAt: '2026-11-10T00:00:00.000Z',
      runId: 'dead-run',
    }),
  )
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '4', '--apply'],
    {
      isProcessAlive: () => false,
    },
  )
  // Assert
  assert.equal(code, 0)
  assert.ok(
    lines.includes(
      'LOCK: replaced the stale lock of pid 4242 (started 2026-11-10T00:00:00.000Z)',
    ),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', '.rotate-tmp')), {
    'dead-run/aside/c9/keep.txt': sha256('evidence'),
  })
  assert.deepEqual(fake.assetNames('c1'), ['c1.files.json', 'c1.tar.gz'])
})

test('plan mode never creates or empties the temporary area, even beside a live lock', async (t) => {
  // protects=F6: printing the plan leaves artifacts/.rotate-tmp as it was; fails_when=the plan creates the folder or removes another run's work; no_claim=does not cover --apply
  // Arrange
  const fresh = await makeRoot(t)
  await putFile(fresh, 'c1/a.txt', 'one')
  const occupied = await makeRoot(t)
  await putFile(occupied, 'c1/a.txt', 'one')
  await putFile(occupied, '.rotate-tmp/other/work/x.bin', 'in use')
  await writeFile(
    join(occupied, 'artifacts', '.rotate-tmp', '.lock'),
    JSON.stringify({
      pid: process.pid,
      startedAt: '2026-11-11T11:00:00.000Z',
      runId: 'other',
    }),
  )
  const before = await snapshot(join(occupied, 'artifacts'))
  const fake = createFakeGh()
  // Act
  const first = await rotate(fresh, fake, ['--current', '4'])
  const second = await rotate(occupied, fake, ['--current', '4'])
  // Assert
  assert.equal(first.code, 0)
  assert.equal(second.code, 0)
  assert.equal((await artifactsNames(fresh)).includes('.rotate-tmp'), false)
  assert.deepEqual(await snapshot(join(occupied, 'artifacts')), before)
})

test('finishes --init on an existing private repository whose index.json is missing', async (t) => {
  // protects=F7: a first --init that stopped after creating the repository can be completed; fails_when=--init refuses with E_INIT_EXISTS or creates a second repository; no_claim=does not repair a repository holding a broken index
  // Arrange
  const root = await makeRoot(t)
  const fake = createFakeGh({ exists: true, noIndex: true })
  // Act
  const { code, lines } = await rotate(root, fake, ['--init'])
  // Assert
  assert.equal(code, 0)
  assert.deepEqual(lines, [
    `INIT: wrote index.json in the existing ${REPOSITORY} (private)`,
  ])
  assert.deepEqual(JSON.parse(fake.state.index), {
    schemaVersion: 1,
    folders: {},
  })
  assert.equal(
    fake.state.calls.some((call) => call.args[1] === 'create'),
    false,
  )
})

test('refuses --apply and --restore with E_INIT_INCOMPLETE and the --init fix when index.json is missing', async (t) => {
  // protects=F7: nothing is uploaded to a repository without its index; fails_when=an upload or restore starts, or the fix line does not name --init; no_claim=does not write the index itself
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh({ noIndex: true })
  const expectInit = (error) => {
    assert.equal(error.code, 'E_INIT_INCOMPLETE')
    assert.equal(
      error.fix,
      'node extension/scripts/rotate-artifacts.mjs --init',
    )
    return true
  }
  // Act
  const apply = await rotate(root, fake, ['--current', '4', '--apply']).catch(
    (error) => error,
  )
  const restore = await rotate(root, fake, ['--restore', 'c9']).catch(
    (error) => error,
  )
  // Assert
  expectInit(apply)
  expectInit(restore)
  assert.deepEqual(fake.uploadedNames(), [])
})

test('refuses --init on an existing public repository', async (t) => {
  // protects=F7: --init never writes into a repository that is not private; fails_when=index.json is written to a public repository; no_claim=does not change its visibility
  // Arrange
  const root = await makeRoot(t)
  const fake = createFakeGh({
    exists: true,
    noIndex: true,
    visibility: 'PUBLIC',
  })
  // Act
  const outcome = rotate(root, fake, ['--init'])
  // Assert
  await assert.rejects(outcome, { code: 'E_NOT_PRIVATE' })
  assert.equal(fake.state.index, null)
})

test('writes index.json from a body file even when the index is larger than one command-line argument may be', async (t) => {
  // protects=F8: the index body never travels on the command line (Linux limits one argument to 128 KiB); fails_when=content goes through -f or an argument grows past 1000 characters; no_claim=GitHub's own size limit for contents is not tested
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const folders = {}
  for (let at = 0; at < 4000; at += 1)
    folders[`x${at}`] = {
      tag: `x${at}`,
      files: 1,
      bytes: 1,
      assets: [{ name: `x${at}.tar.gz`, size: 1, sha256: sha256(String(at)) }],
    }
  const fake = createFakeGh()
  fake.seedIndex({ schemaVersion: 1, folders })
  // Act
  const { code } = await rotate(root, fake, ['--current', '4', '--apply'])
  // Assert
  assert.equal(code, 0)
  const body = fake.state.putBodies.at(-1)
  const written = JSON.parse(
    Buffer.from(body.content, 'base64').toString('utf8'),
  )
  assert.ok(Object.keys(written.folders).includes('c1'))
  assert.ok(Object.keys(written.folders).includes('x3999'))
  assert.ok(body.content.length > 200_000)
  const longest = Math.max(
    ...fake.state.calls.flatMap((call) => call.args.map((arg) => arg.length)),
  )
  assert.ok(longest < 1000)
})

test('skips top-level entries whose names cannot be a git tag or a safe argument', () => {
  // protects=F9: a leading dot or dash, "..", a .lock or dot ending and stray characters never reach `gh` or `tar` as a tag or an argument; fails_when=any such old entry gets action archive; no_claim=the names git itself would still accept beyond these rules are not listed
  // Arrange
  const entry = (name) => ({
    name,
    bytes: 5,
    newestMs: NOW - 40 * DAY,
    special: [],
    fileCount: 1,
  })
  const names = [
    '.DS_Store',
    '-rf',
    'a..b',
    'x.lock',
    'x.',
    'weird name',
    'ok-1.log',
    'c12.lock',
  ]
  // Act
  const plan = classifyInventory(
    { entries: names.map(entry), gate: [], qa: [] },
    { current: 117, keep: 3, headShort: 'abcdef01', now: NOW },
  )
  // Assert
  assert.deepEqual(
    plan.map((item) => `${item.action} ${item.name}`),
    [
      'skip .DS_Store',
      'skip -rf',
      'skip a..b',
      'skip x.lock',
      'skip x.',
      'skip weird name',
      'archive ok-1.log',
      'skip c12.lock',
    ],
  )
  assert.equal(isSafeEntryName('c59'), true)
  assert.equal(isSafeEntryName('cycle-0052'), true)
})

test('refuses to publish a restore over a folder that appeared after the first check and keeps the restored copy', async (t) => {
  // protects=F10: the final move into artifacts/<folder> never replaces what another process created; fails_when=the empty folder created meanwhile is replaced, or the restored copy is deleted; no_claim=a destination filled between mkdir and rename is the same code path and not simulated
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const fake = createFakeGh()
  await rotate(root, fake, ['--current', '4', '--apply'])
  // Act
  const outcome = rotate(root, fake, ['--restore', 'c1'], {
    runId: 'run-r',
    beforeRestorePublish: (destination) => mkdir(destination),
  })
  // Assert
  await assert.rejects(outcome, (error) => {
    assert.equal(error.code, 'E_RESTORE_EXISTS')
    assert.match(error.fix, /the restored copy stays at .*run-r.*extract.*c1/)
    return true
  })
  assert.deepEqual(await readdir(join(root, 'artifacts', 'c1')), [])
  assert.equal(
    await readFile(
      join(
        root,
        'artifacts',
        '.rotate-tmp',
        'run-r',
        'work',
        'restore-c1',
        'extract',
        'c1',
        'a.txt',
      ),
      'utf8',
    ),
    'one',
  )
})

test('refuses to publish a restored file over one that appeared after the first check', async (t) => {
  // protects=F10: a restored loose file never replaces a file created meanwhile; fails_when=the other file's content changes; no_claim=folders are covered by the test above
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'old.log', 'archived text', 40 * DAY)
  const fake = createFakeGh()
  await rotate(root, fake, ['--current', '4', '--apply'])
  // Act
  const outcome = rotate(root, fake, ['--restore', 'old.log'], {
    beforeRestorePublish: (destination) => writeFile(destination, 'theirs'),
  })
  // Assert
  await assert.rejects(outcome, { code: 'E_RESTORE_EXISTS' })
  assert.equal(
    await readFile(join(root, 'artifacts', 'old.log'), 'utf8'),
    'theirs',
  )
})

test('fails a command whose output reaches the capture limit instead of cutting it', async () => {
  // protects=F11: a captured stdout is whole or the call fails; fails_when=a long answer is cut silently, or an answer under the limit is refused; no_claim=stderr is capped without an error
  // Arrange
  const run = createCommandRunner(process.cwd(), process.env, { limit: 100 })
  const print = (count) => ['-e', `process.stdout.write('x'.repeat(${count}))`]
  // Act
  const tooLong = await run(process.execPath, print(1000)).catch(
    (error) => error,
  )
  const fits = await run(process.execPath, print(99))
  // Assert
  assert.equal(tooLong.code, 'E_OUTPUT_LIMIT')
  assert.equal(fits.stdout, 'x'.repeat(99))
})

test('decodes captured output once so a multi-byte character split between chunks survives', async () => {
  // protects=F11: output with characters of three bytes arrives intact; fails_when=a chunk boundary inside a character turns it into U+FFFD; no_claim=other encodings are not handled
  // Arrange
  const run = createCommandRunner(process.cwd(), process.env)
  // Act
  const result = await run(process.execPath, [
    '-e',
    "process.stdout.write('語'.repeat(100000))",
  ])
  // Assert
  assert.equal(result.stdout, '語'.repeat(100000))
})

test('restores split parts in part-number order whatever order the index lists them in', async (t) => {
  // protects=F12: the parts are joined by their .part-NNN number; fails_when=a restore with a reversed asset list fails or builds a wrong folder; no_claim=a missing part is detected by the hash check, not here
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/big.bin', incompressible(4000))
  const before = await snapshot(join(root, 'artifacts', 'c1'))
  const fake = createFakeGh()
  await rotate(root, fake, ['--current', '4', '--apply'], { partBytes: 1500 })
  const index = JSON.parse(fake.state.index)
  index.folders.c1.assets.reverse()
  fake.seedIndex(index)
  // Act
  const restored = await rotate(root, fake, ['--restore', 'c1'])
  // Assert
  assert.equal(restored.code, 0)
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), before)
  assert.deepEqual(
    sortParts(['a.tar.gz.part-010', 'a.tar.gz.part-002', 'a.tar.gz.part-000']),
    ['a.tar.gz.part-000', 'a.tar.gz.part-002', 'a.tar.gz.part-010'],
  )
})

test('refuses a --keep that is not a whole number of at least 1', async (t) => {
  // protects=F14: --keep 0, 1.5, -1, text or nothing never reaches the plan; fails_when=any of them is accepted; no_claim=very large keep values are only checked for being safe integers
  // Arrange
  const root = await makeRoot(t)
  const fake = createFakeGh()
  const values = ['0', '1.5', '-1', 'x', '']
  // Act
  const codes = []
  for (const value of values)
    codes.push(
      await rotate(root, fake, ['--current', '5', '--keep', value]).catch(
        (error) => error.code,
      ),
    )
  // Assert
  assert.deepEqual(codes, [
    'E_USAGE',
    'E_USAGE',
    'E_USAGE',
    'E_USAGE',
    'E_USAGE',
  ])
})

test('accepts --keep 1 and archives every cycle below the current one', async (t) => {
  // protects=F14: the smallest keep keeps exactly the current cycle; fails_when=keep 1 is refused or archives the current cycle; no_claim=does not run --apply
  // Arrange
  const root = await makeRoot(t)
  for (const cycle of ['c2', 'c3', 'c4'])
    await putFile(root, `${cycle}/f.txt`, cycle)
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--keep',
    '1',
  ])
  // Assert
  assert.equal(code, 0)
  assert.deepEqual(lines.slice(0, 3), [
    'archive c2 2',
    'archive c3 2',
    'keep    c4 2',
  ])
})

test('refuses a --current more than three above the highest cycle folder and names that cycle', async (t) => {
  // protects=F14: a typo such as 1170 for 117 never turns every cycle into an archive candidate; fails_when=--current 9 passes with c5 as the highest cycle, or the fix line misses the highest cycle; no_claim=does not check the number against GitHub
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c5/f.txt', 'five')
  const fake = createFakeGh()
  // Act
  const tooHigh = await rotate(root, fake, ['--current', '9']).catch(
    (error) => error,
  )
  const edge = await rotate(root, fake, ['--current', '8'])
  // Assert
  assert.equal(tooHigh.code, 'E_CURRENT_UNLIKELY')
  assert.match(tooHigh.fix, /the highest cycle found in artifacts\/ is 5/)
  assert.equal(edge.code, 0)
})

test('accepts any --current when no cycle folder exists, and refuses a number beyond the safe integers', async (t) => {
  // protects=F14: the plausibility check needs a cycle folder to compare with, and a huge digit string is no cycle number; fails_when=--current 900 is refused without cycle folders, or 99999999999999999999 is accepted; no_claim=says nothing about plausible numbers with cycle folders
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'notes.log', 'loose', 40 * DAY)
  const fake = createFakeGh()
  // Act
  const plain = await rotate(root, fake, ['--current', '900'])
  const huge = await rotate(root, fake, [
    '--current',
    '99999999999999999999',
  ]).catch((error) => error)
  // Assert
  assert.equal(plain.code, 0)
  assert.equal(huge.code, 'E_CURRENT_REQUIRED')
})

/** Archives c1, restores it, and returns what the archive held, so a test can rotate the restored folder again. */
async function archiveAndRestoreC1(t, files) {
  const root = await makeRoot(t)
  for (const [path, content] of Object.entries(files))
    await putFile(root, `c1/${path}`, content)
  const fake = createFakeGh()
  await rotate(root, fake, ['--current', '4', '--apply'])
  const restored = await rotate(root, fake, ['--restore', 'c1'])
  assert.equal(restored.code, 0)
  return {
    root,
    fake,
    indexBefore: fake.state.index,
    assetsBefore: fake.assetNames('c1'),
    uploadsBefore: fake.uploadedNames().length,
    putsBefore: fake.state.putBodies.length,
  }
}

test('removes a restored, unchanged folder again without packing or uploading it a second time', async (t) => {
  // protects=a restored folder is rotated out again instead of failing every later --apply with E_ASSET_CONFLICT; fails_when=the folder stays, anything is uploaded, index.json changes, ARCHIVED.json loses the tag, or the exit is not 0; no_claim=does not show that a changed folder is refused (next tests)
  // Arrange
  const { root, fake, indexBefore, assetsBefore, uploadsBefore, putsBefore } =
    await archiveAndRestoreC1(t, {
      'native/run.bin': incompressible(3000),
      'notes/a.txt': 'note a',
    })
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 0)
  assert.equal((await readdir(join(root, 'artifacts'))).includes('c1'), false)
  assert.equal(fake.uploadedNames().length, uploadsBefore)
  assert.deepEqual(fake.assetNames('c1'), assetsBefore)
  assert.equal(fake.state.index, indexBefore)
  assert.equal(fake.state.putBodies.length, putsBefore)
  assert.ok(
    lines.includes(
      'archived c1 (already in the archive; local copy verified and removed)',
    ),
  )
  assert.equal(
    summaryOf(lines),
    'ROTATE: archived=1 deleted=0 kept=0 skipped=0 failed=0 freed_bytes=3006',
  )
  assert.equal(
    JSON.parse(await readFile(join(root, 'artifacts', 'ARCHIVED.json'), 'utf8'))
      .folders.c1.tag,
    'c1',
  )
})

test('keeps a restored folder whose file was edited and fails the entry with E_ARCHIVED_DIFFERS without uploading', async (t) => {
  // protects=a restored folder that no longer equals its archive is never deleted on the strength of the old archive; fails_when=the edited folder is deleted, something is uploaded, the record changes, the code differs or the exit is not 3; no_claim=does not repair the difference
  // Arrange
  const { root, fake, indexBefore, assetsBefore, uploadsBefore } =
    await archiveAndRestoreC1(t, { 'a.txt': 'original', 'b.txt': 'stable' })
  await putFile(root, 'c1/a.txt', 'edited!!')
  const before = await snapshot(join(root, 'artifacts', 'c1'))
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) => line.startsWith('FAILED c1 E_ARCHIVED_DIFFERS')),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), before)
  assert.equal(fake.uploadedNames().length, uploadsBefore)
  assert.deepEqual(fake.assetNames('c1'), assetsBefore)
  assert.equal(fake.state.index, indexBefore)
})

test('keeps a restored folder that gained a file and fails the entry with E_ARCHIVED_DIFFERS without uploading', async (t) => {
  // protects=an extra file in a restored folder is never deleted unarchived; fails_when=the folder with the extra file is deleted, something is uploaded, the record changes, the code differs or the exit is not 3; no_claim=does not archive the extra file
  // Arrange
  const { root, fake, indexBefore, assetsBefore, uploadsBefore } =
    await archiveAndRestoreC1(t, { 'a.txt': 'original' })
  await putFile(root, 'c1/extra.txt', 'new evidence')
  const before = await snapshot(join(root, 'artifacts', 'c1'))
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(
    lines.some((line) => line.startsWith('FAILED c1 E_ARCHIVED_DIFFERS')),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), before)
  assert.equal(fake.uploadedNames().length, uploadsBefore)
  assert.deepEqual(fake.assetNames('c1'), assetsBefore)
  assert.equal(fake.state.index, indexBefore)
})

test('keeps a restored folder and exits nonzero when its release asset is corrupt', async (t) => {
  // protects=an unchanged restored folder is deleted only while its archive still downloads with the recorded SHA-256; fails_when=the folder is deleted or the exit is 0 although the archive is corrupt; no_claim=does not show how the archive is repaired
  // Arrange
  const { root, fake } = await archiveAndRestoreC1(t, { 'a.txt': 'original' })
  fake.state.corruptPattern = 'c1.tar.gz'
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '4',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(lines.some((line) => line.startsWith('FAILED c1 E_HASH_MISMATCH')))
  assert.equal(
    await readFile(join(root, 'artifacts', 'c1', 'a.txt'), 'utf8'),
    'original',
  )
})

test('keeps a folder whose archive cannot be downloaded or uploaded, reports E_DOWNLOAD and E_UPLOAD, and still rotates the folder between them', async (t) => {
  // protects=a folder is deleted only after its archive reached the release and came back intact; fails_when=a failed download or an upload error other than a name conflict lets c1 or c3 be deleted, stops the run before c2, or exits 0; why_new=no test made the download or the upload itself fail, only a changed folder or a differing file; seam=none; no_claim=says nothing about a partial download that leaves a corrupt file
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, 'c2/b.txt', 'two')
  await putFile(root, 'c3/c.txt', 'three')
  const fake = createFakeGh({
    failDownloadFor: 'c1.',
    failUploadFor: 'c3.tar.gz',
  })
  // Act
  const { code, lines } = await rotate(root, fake, [
    '--current',
    '6',
    '--apply',
  ])
  // Assert
  assert.equal(code, 3)
  assert.ok(lines.some((line) => line.startsWith('FAILED c1 E_DOWNLOAD')))
  assert.ok(lines.some((line) => line.startsWith('FAILED c3 E_UPLOAD')))
  assert.ok(
    lines.includes(
      'ROTATE: archived=1 deleted=0 kept=0 skipped=0 failed=2 freed_bytes=3',
    ),
  )
  assert.deepEqual(
    (await readdir(join(root, 'artifacts'))).filter((name) =>
      name.startsWith('c'),
    ),
    ['c1', 'c3'],
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
  })
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c3')), {
    'c.txt': sha256('three'),
  })
  assert.deepEqual(Object.keys(JSON.parse(fake.state.index).folders), ['c2'])
})

test('keeps the folder of an entry that fails with an unexpected error, reports E_INTERNAL and still rotates the next entry', async (t) => {
  // protects=an unexpected exception in one entry never deletes its folder and never stops the run; fails_when=the error is not reported as E_INTERNAL, c1 is deleted, c2 is not rotated or the exit code is not 3; why_new=only refusals the tool raises itself were tested; seam=none (existing afterRecord override throws); no_claim=says nothing about which exceptions can occur
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  await putFile(root, 'c2/b.txt', 'two')
  const fake = createFakeGh()
  // Act
  const { code, lines } = await rotate(
    root,
    fake,
    ['--current', '5', '--apply'],
    {
      afterRecord: async (name) => {
        if (name === 'c1') throw new Error('disk hiccup')
      },
    },
  )
  // Assert
  assert.equal(code, 3)
  assert.ok(lines.includes('FAILED c1 E_INTERNAL: disk hiccup (kept)'))
  assert.deepEqual(await snapshot(join(root, 'artifacts', 'c1')), {
    'a.txt': sha256('one'),
  })
  assert.equal((await readdir(join(root, 'artifacts'))).includes('c2'), false)
})

test('refuses two modes together, --restore with --init and an unknown option as usage errors that point at --help and change nothing', async (t) => {
  // protects=a mistyped command never runs a half-understood mode; fails_when=--apply --init, --restore x --init or an unknown option is accepted, exits with another code or names no --help; why_new=only a bad --keep was tested as usage error; seam=none; no_claim=does not cover the --current checks
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const before = await snapshot(join(root, 'artifacts'))
  const fake = createFakeGh()
  const argvs = [
    ['--apply', '--init'],
    ['--restore', 'x', '--init'],
    ['--current', '4', '--bogus'],
  ]
  // Act
  const refusals = []
  for (const argv of argvs)
    refusals.push(await rotate(root, fake, argv).catch((error) => error))
  // Assert
  assert.deepEqual(
    refusals.map((error) => [error.code, error.exitCode, error.fix]),
    argvs.map(() => [
      'E_USAGE',
      64,
      'node extension/scripts/rotate-artifacts.mjs --help',
    ]),
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts')), before)
  assert.deepEqual(fake.state.calls, [])
})

test('refuses --apply without creating a release or deleting anything when the archive account has no token or the repository cannot be read', async (t) => {
  // protects=no deletion without a working archive account and repository; fails_when=a missing token or repository lets --apply go on, creates a release or removes c1; why_new=only a public repository and a missing index.json were refused; seam=none; no_claim=does not cover a token that stops working mid-run
  // Arrange
  const root = await makeRoot(t)
  await putFile(root, 'c1/a.txt', 'one')
  const before = await snapshot(join(root, 'artifacts'))
  const noAccount = createFakeGh({ authFails: true })
  const noRepository = createFakeGh({ exists: false })
  // Act
  const accountRefusal = await rotate(root, noAccount, [
    '--current',
    '4',
    '--apply',
  ]).catch((error) => error)
  const repositoryRefusal = await rotate(root, noRepository, [
    '--current',
    '4',
    '--apply',
  ]).catch((error) => error)
  // Assert
  assert.equal(accountRefusal.code, 'E_NO_ACCOUNT')
  assert.equal(repositoryRefusal.code, 'E_REPO_MISSING')
  assert.deepEqual(await snapshot(join(root, 'artifacts')), before)
  for (const fake of [noAccount, noRepository]) {
    assert.equal(fake.state.releases.size, 0)
    assert.equal(
      fake.state.calls.some(
        ({ args }) => args[0] === 'release' || args.includes('DELETE'),
      ),
      false,
    )
  }
})

test('refuses to restore qa-builds or an unsafe name and writes nothing under artifacts', async (t) => {
  // protects=--restore never rebuilds QA builds automatically nor accepts a name that could leave artifacts/; fails_when=qa-builds is restored, ../x is accepted or a file appears under artifacts/; why_new=only unknown, existing and unsafe archive members were refused; seam=none; no_claim=does not cover other unsafe spellings
  // Arrange
  const root = await makeRoot(t)
  const fake = createFakeGh()
  // Act
  const qaRefusal = await rotate(root, fake, ['--restore', 'qa-builds']).catch(
    (error) => error,
  )
  const unsafeRefusal = await rotate(root, fake, ['--restore', '../x']).catch(
    (error) => error,
  )
  // Assert
  assert.equal(qaRefusal.code, 'E_RESTORE_UNSUPPORTED')
  assert.equal(unsafeRefusal.code, 'E_USAGE')
  assert.equal(unsafeRefusal.exitCode, 64)
  assert.equal(
    unsafeRefusal.fix,
    'node extension/scripts/rotate-artifacts.mjs --help',
  )
  assert.deepEqual(await snapshot(join(root, 'artifacts')), {})
  assert.deepEqual(fake.state.calls, [])
})
