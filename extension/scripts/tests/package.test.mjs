import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ZipFile } from 'yazl'

import { buildPackage } from '../utils/buildPackage.mjs'
import { COMPILED_DIRECTORIES } from '../utils/packageConstants.mjs'
import { readVsixEntries } from '../utils/readVsixEntries.mjs'
import { runPackageCommand } from '../utils/runPackageCommand.mjs'
import { verifyPackageContent } from '../utils/verifyPackageContent.mjs'
import { writeProgressWhileRunning } from '../utils/writeProgressWhileRunning.mjs'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
let directory, artifact, original, receipt
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codebook VSIX $() `literal` '))
  artifact = join(directory, 'installed codebook.vsix')
  // These absent-source compiler leftovers must be deleted, including declarations that could hide build errors.
  for (const path of COMPILED_DIRECTORIES) {
    await mkdir(join(repository, path), { recursive: true })
    await writeFile(
      join(repository, path, 'obsolete-package-probe.js'),
      'throw new Error("stale compiler output");',
    )
    await writeFile(
      join(repository, path, 'obsolete-package-probe.d.ts'),
      'export declare const obsolete: string;',
    )
  }
  // The build runs several commands in turn and prints nothing; the lines keep the pre-gate's silence watch from ending the run.
  receipt = await writeProgressWhileRunning(() =>
    buildPackage(repository, artifact),
  )
  original = await readVsixEntries(artifact)
})
after(async () => {
  // Failed builds still retire the exact stale-output probes owned by this suite; later builds recreate compiled outputs normally.
  await Promise.all(
    COMPILED_DIRECTORIES.flatMap((path) =>
      ['js', 'd.ts'].map((extension) =>
        rm(join(repository, path, `obsolete-package-probe.${extension}`), {
          force: true,
        }),
      ),
    ),
  )
  if (directory) await rm(directory, { recursive: true, force: true })
})

/** Creates real ZIP mutations so archive rejection tests exercise parsing and content verification together. @example await writeArchive(entries, 'missing-icon') */
async function writeArchive(entries, name, options = {}) {
  const output = join(directory, `${name}.vsix`),
    archive = new ZipFile()
  for (const [path, content] of entries)
    archive.addBuffer(content, path, options[path])
  archive.end()
  await pipeline(archive.outputStream, createWriteStream(output))
  return output
}

/** Keeps declared hashes consistent when a test targets a semantic contract rather than accidental corruption. @example replaceFile(entries, 'package.json', Buffer.from('{}')) */
function replaceFile(entries, path, content) {
  entries.set(`extension/${path}`, content)
  if (path === 'package-manifest.json') return
  const manifest = JSON.parse(entries.get('extension/package-manifest.json'))
  manifest.files[path] = {
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
  entries.set(
    'extension/package-manifest.json',
    Buffer.from(JSON.stringify(manifest)),
  )
}

// Value: protects=the packaged VSIX loading outside the checkout with no bundled application, its patch identity and dependency notices; fails_when=the package carries an application fixture, loses its patch identity or its notices, or needs the checkout to load; why_new=the package contract grew with each release; seam=a real package build; no_claim=an installed editor's behavior
test('a real VSIX loads outside the checkout and excludes bundled applications and preserves patch identity and dependency notices', async () => {
  // Arrange / Act
  const checked = await verifyPackageContent(original)
  // Assert
  assert.equal(receipt.isolatedModuleLoad, true)
  assert.equal(receipt.isolatedWikiPageWorker, true)
  assert.equal(checked.extension.version, '0.2.40')
  assert.equal(checked.extension.apiVersion, '1.8')
  assert.equal(checked.entries, 32)
  assert.equal(receipt.dependencies.length, 16)
  assert.deepEqual(
    original.get('extension/skills/codebook/SKILL.md'),
    await readFile(join(repository, 'extension/skills/codebook/SKILL.md')),
  )
  assert.deepEqual(
    original.get('extension/skills/codebook/publish-wiki.mjs'),
    await readFile(
      join(repository, 'extension/skills/codebook/publish-wiki.mjs'),
    ),
  )
  assert.deepEqual(
    original.get('extension/skills/codebook/render-wiki.mjs'),
    await readFile(
      join(repository, 'extension/skills/codebook/render-wiki.mjs'),
    ),
  )
  assert.deepEqual(
    original.get('extension/skills/codebook/render-wiki-diagrams.mjs'),
    await readFile(
      join(repository, 'extension/skills/codebook/render-wiki-diagrams.mjs'),
    ),
  )
  assert.deepEqual(
    original.get('extension/skills/codebook/reader-shell.html'),
    await readFile(
      join(repository, 'extension/skills/codebook/reader-shell.html'),
    ),
  )
  assert.ok(
    [...original.keys()].every(
      (path) => !/(?:^|\/)(?:demo|fixture|experiments)(?:\/|$)/.test(path),
    ),
  )
  for (const path of COMPILED_DIRECTORIES) {
    await assert.rejects(
      lstat(join(repository, path, 'obsolete-package-probe.js')),
      { code: 'ENOENT' },
    )
    await assert.rejects(
      lstat(join(repository, path, 'obsolete-package-probe.d.ts')),
      { code: 'ENOENT' },
    )
  }
  const inventory = JSON.parse(original.get('extension/package-manifest.json'))
  assert.ok(
    inventory.inputs.every(
      (input) => !input.path.includes('obsolete-package-probe'),
    ),
  )
  assert.deepEqual(
    inventory.inputs
      .filter(
        (input) =>
          input.path.startsWith('extension/dist/tests/') ||
          [
            'extension/dist/client.js',
            'extension/dist/nativeRunner.js',
          ].includes(input.path),
      )
      .map((input) => input.path),
    [],
  )
  assert.ok(
    inventory.inputs.some((input) =>
      input.path.startsWith('dependency:@modelcontextprotocol/sdk@1.30.0/'),
    ),
  )
  assert.ok(
    checked.build.sourceHashes.some((input) =>
      input.startsWith(
        'extension/patches/@modelcontextprotocol__sdk@1.30.0.patch:',
      ),
    ),
  )
  assert.deepEqual(
    original.get('extension/src/assets/book.svg'),
    await readFile(join(repository, 'extension/src/assets/book.svg')),
  )
})

test('a coherent SHA-256 Git revision survives real archive checking', async () => {
  // Arrange
  const entries = new Map(original),
    build = JSON.parse(entries.get('extension/dist/build.json'))
  build.revision =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  replaceFile(entries, 'dist/build.json', Buffer.from(JSON.stringify(build)))
  const manifest = JSON.parse(entries.get('extension/package-manifest.json'))
  manifest.build = build
  replaceFile(
    entries,
    'package-manifest.json',
    Buffer.from(JSON.stringify(manifest)),
  )
  const path = await writeArchive(entries, 'sha256-revision')
  // Act
  const checked = await verifyPackageContent(await readVsixEntries(path))
  // Assert
  assert.equal(
    checked.build.revision,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  )
})

test('the packaged tool inventory records actual pnpm and resolved compiler versions', () => {
  // Arrange / Act
  const inventory = JSON.parse(original.get('extension/package-manifest.json'))
  // Assert
  assert.deepEqual(inventory.tools, {
    node: process.versions.node,
    pnpm: '12.4.2',
    esbuild: '0.28.2',
    vsce: '4.0.0',
    typescript: '5.9.3',
  })
})

for (const [label, revision] of [
  ['short-sha1', 'a'.repeat(39)],
  ['long-sha1', 'a'.repeat(41)],
  ['short-sha256', 'a'.repeat(63)],
  ['long-sha256', 'a'.repeat(65)],
  ['uppercase', 'A'.repeat(64)],
  ['non-hex', 'g'.repeat(40)],
]) {
  test(`a coherent archive with a ${label} Git revision is rejected before installation`, async () => {
    // Arrange
    const entries = new Map(original),
      build = JSON.parse(entries.get('extension/dist/build.json'))
    build.revision = revision
    replaceFile(entries, 'dist/build.json', Buffer.from(JSON.stringify(build)))
    const manifest = JSON.parse(entries.get('extension/package-manifest.json'))
    manifest.build = build
    replaceFile(
      entries,
      'package-manifest.json',
      Buffer.from(JSON.stringify(manifest)),
    )
    const path = await writeArchive(entries, `invalid-revision-${label}`)
    // Act / Assert
    await assert.rejects(
      verifyPackageContent(await readVsixEntries(path)),
      /Invalid Git revision/,
    )
  })
}

test('a duplicate dependency notice is rejected before checking its repeated content', async () => {
  // Arrange: the duplicate also has a wrong hash, so rejection must precede another content check.
  const entries = new Map(original),
    manifest = JSON.parse(entries.get('extension/package-manifest.json'))
  manifest.dependencies[0].notices.push({
    ...manifest.dependencies[0].notices[0],
    sha256: '0'.repeat(64),
  })
  replaceFile(
    entries,
    'package-manifest.json',
    Buffer.from(JSON.stringify(manifest)),
  )
  const path = await writeArchive(entries, 'duplicate-dependency-notice')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /Duplicate dependency notice/,
  )
})

test('the standalone checker reports the actual VSIX checksum without executing its extension code', async () => {
  // Arrange: a coherent archive contains a throwing entry, which the checker must never run.
  const entries = new Map(original)
  replaceFile(
    entries,
    'dist/extension.js',
    Buffer.from('throw new Error("must not execute checker input");'),
  )
  const path = await writeArchive(entries, 'non-executing-check')
  // Act
  const result = await runPackageCommand(
    process.execPath,
    [join(repository, 'extension/scripts/check-package.mjs'), path],
    directory,
  )
  // Assert
  const checked = JSON.parse(result.stdout)
  assert.equal(checked.extension.name, 'codebook')
  assert.equal(
    checked.sha256,
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  )
  assert.equal(result.stderr, '')
})

test('replacing the input pathname during archive validation cannot change the reported verified checksum', async () => {
  // Arrange: an atomic replacement after ZIP acquisition leaves the original opened bytes available.
  const path = await writeArchive(original, 'concurrent-check'),
    expected = await readFile(path)
  const preload = join(directory, 'replace-after-open.mjs')
  await writeFile(
    preload,
    `import yauzl from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('yauzl')).href)};
import { rename, writeFile } from 'node:fs/promises';
const path = process.argv.at(-1);
for (const method of ['openPromise', 'fromBufferPromise']) {
  const original = yauzl[method];
  yauzl[method] = async function(...args) {
    const archive = await original.apply(this, args);
    await writeFile(path + '.replacement', 'This replacement is not a ZIP.\\n');
    await rename(path + '.replacement', path);
    return archive;
  };
}
`,
  )
  // Act
  const result = await runPackageCommand(
    process.execPath,
    [
      '--import',
      preload,
      join(repository, 'extension/scripts/check-package.mjs'),
      path,
    ],
    directory,
  )
  // Assert: the receipt describes the validated snapshot, even though that pathname now contains invalid bytes.
  const checked = JSON.parse(result.stdout)
  assert.equal(
    checked.sha256,
    createHash('sha256').update(expected).digest('hex'),
  )
  assert.equal(checked.bytes, expected.length)
  assert.equal(await readFile(path, 'utf8'), 'This replacement is not a ZIP.\n')
  assert.equal(result.stderr, '')
})

for (const file of [
  'dist/extension.js',
  'src/assets/book.svg',
  'skills/codebook/SKILL.md',
]) {
  test(`a VSIX missing ${file} is rejected before installation`, async () => {
    // Arrange
    const entries = new Map(original)
    entries.delete(`extension/${file}`)
    const path = await writeArchive(
      entries,
      `missing-${file.replaceAll('/', '-')}`,
    )
    // Act / Assert
    await assert.rejects(
      verifyPackageContent(await readVsixEntries(path)),
      /missing or extra|Missing package file/,
    )
  })
}

test('an archive with a non-codebook skill body is rejected even when its self-declared hash matches', async () => {
  // Arrange
  const entries = new Map(original)
  replaceFile(
    entries,
    'skills/codebook/SKILL.md',
    Buffer.from('---\nname: other\ndescription: Wrong skill.\n---\n'),
  )
  const path = await writeArchive(entries, 'wrong-skill-body')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /canonical versioned codebook skill/,
  )
})

test('a VSIX cannot ship a credential in its bundled skill even when its self-declared hash matches', async () => {
  // Arrange
  const entries = new Map(original)
  const skill = entries
    .get('extension/skills/codebook/SKILL.md')
    .toString('utf8')
  replaceFile(
    entries,
    'skills/codebook/SKILL.md',
    Buffer.from(`${skill}\nAuthorization: Bearer private-token\n`),
  )
  const path = await writeArchive(entries, 'skill-credential')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /connection-like or temporary identity material/,
  )
})

test('an archive whose chat contribution points outside its bundled skill is rejected', async () => {
  // Arrange
  const entries = new Map(original),
    extension = JSON.parse(entries.get('extension/package.json'))
  extension.contributes.chatSkills = [{ path: './skills/other/SKILL.md' }]
  replaceFile(entries, 'package.json', Buffer.from(JSON.stringify(extension)))
  const path = await writeArchive(entries, 'wrong-skill-reference')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /Missing package file|registration differs/,
  )
})

test('removing the icon from both archive and self-declared inventory still violates the package contract', async () => {
  // Arrange
  const entries = new Map(original),
    manifest = JSON.parse(entries.get('extension/package-manifest.json'))
  entries.delete('extension/src/assets/book.svg')
  delete manifest.files['src/assets/book.svg']
  replaceFile(
    entries,
    'package-manifest.json',
    Buffer.from(JSON.stringify(manifest)),
  )
  const path = await writeArchive(entries, 'self-consistent-missing-icon')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /allowed files/,
  )
})

for (const file of ['dist/extension.js']) {
  test(`modified ${file} fails the recorded byte contract`, async () => {
    // Arrange
    const entries = new Map(original)
    entries.set(`extension/${file}`, Buffer.from('modified bytes'))
    const path = await writeArchive(
      entries,
      `changed-${file.replaceAll('/', '-')}`,
    )
    // Act / Assert
    await assert.rejects(
      verifyPackageContent(await readVsixEntries(path)),
      /Package (size|hash) mismatch/,
    )
  })
}

test('an unexpected connection descriptor is rejected even when the other package files are valid', async () => {
  // Arrange
  const entries = new Map(original)
  entries.set('extension/connection.json', Buffer.from('private dummy data'))
  const path = await writeArchive(entries, 'extra-descriptor')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /missing or extra entries/,
  )
})

test('a missing dependency license is rejected instead of silently dropping its notice', async () => {
  // Arrange
  const entries = new Map(original)
  entries.delete('extension/notices/ws8.21.3/LICENSE')
  const path = await writeArchive(entries, 'missing-notice')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /Missing package file: notices\/ws8.21.3\/LICENSE/,
  )
})

test('metadata cannot claim a different build version even with a matching file hash', async () => {
  // Arrange
  const entries = new Map(original),
    build = JSON.parse(entries.get('extension/dist/build.json'))
  build.extensionVersion = '99.0.0'
  replaceFile(entries, 'dist/build.json', Buffer.from(JSON.stringify(build)))
  const path = await writeArchive(entries, 'wrong-build-version')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /Build version mismatch/,
  )
})

test('a VSIX wrapper with a different publisher is rejected', async () => {
  // Arrange
  const entries = new Map(original)
  entries.set(
    'extension.vsixmanifest',
    Buffer.from(
      entries
        .get('extension.vsixmanifest')
        .toString('utf8')
        .replace('Publisher="laststance"', 'Publisher="someone-else"'),
    ),
  )
  const path = await writeArchive(entries, 'wrong-wrapper')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /VSIX publisher mismatch/,
  )
})

test('an unresolved runtime package cannot be added to the allowed native externals', async () => {
  // Arrange
  const entries = new Map(original),
    manifest = JSON.parse(entries.get('extension/package-manifest.json'))
  manifest.externals.push('missing-runtime-package')
  replaceFile(
    entries,
    'package-manifest.json',
    Buffer.from(JSON.stringify(manifest)),
  )
  const path = await writeArchive(entries, 'bad-external')
  // Act / Assert
  await assert.rejects(
    verifyPackageContent(await readVsixEntries(path)),
    /Unresolved runtime import/,
  )
})

for (const reference of ['entry', 'icon']) {
  test(`a manifest ${reference} must resolve to a shipped file independently of inventory hashes`, async () => {
    // Arrange
    const entries = new Map(original),
      manifest = JSON.parse(entries.get('extension/package.json'))
    if (reference === 'entry') manifest.main = './dist/missing.js'
    else
      manifest.contributes.viewsContainers.activitybar[0].icon =
        'src/assets/missing.svg'
    replaceFile(entries, 'package.json', Buffer.from(JSON.stringify(manifest)))
    const path = await writeArchive(entries, `missing-${reference}-reference`)
    // Act / Assert
    await assert.rejects(
      verifyPackageContent(await readVsixEntries(path)),
      /Missing package file/,
    )
  })
}

test('ZIP symlinks are rejected before their contents can be extracted', async () => {
  // Arrange
  const path = await writeArchive(original, 'symlink-entry', {
    'extension/src/assets/book.svg': { mode: 0o120777 },
  })
  // Act / Assert
  await assert.rejects(readVsixEntries(path), /Unsafe archive entry/)
})

test('case-colliding ZIP names cannot overwrite a file on a case-insensitive installation', async () => {
  // Arrange
  const entries = new Map(original)
  entries.set('extension/Readme.md', Buffer.from('collision'))
  const path = await writeArchive(entries, 'case-collision')
  // Act / Assert
  await assert.rejects(readVsixEntries(path), /Duplicate archive entry/)
})

for (const unsafe of ['../escape', 'zz\\escape']) {
  test(`unsafe archive path ${JSON.stringify(unsafe)} is rejected by the real ZIP reader`, async () => {
    // Arrange: corrupt equal-length fixture name bytes; this is not a ZIP parser or production writer.
    const path = await writeArchive(
      new Map([['zz/escape', Buffer.from('fixture')]]),
      `unsafe-${unsafe.startsWith('..') ? 'parent' : 'slash'}`,
    )
    const content = await readFile(path),
      needle = Buffer.from('zz/escape')
    let offset = content.indexOf(needle)
    while (offset !== -1) {
      Buffer.from(unsafe).copy(content, offset)
      offset = content.indexOf(needle, offset + needle.length)
    }
    await writeFile(path, content)
    // Act / Assert
    await assert.rejects(
      readVsixEntries(path),
      /invalid relative path|invalid characters|Unsafe archive entry/,
    )
  })
}

test('a truncated VSIX fails clearly instead of passing a partial inventory', async () => {
  // Arrange
  const path = join(directory, 'truncated.vsix')
  await writeFile(path, (await readFile(artifact)).subarray(0, 100))
  // Act / Assert
  await assert.rejects(
    readVsixEntries(path),
    /end of central directory|End of central directory/,
  )
})
