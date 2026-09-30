import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isBuiltin } from 'node:module'

import { parseStringPromise } from 'xml2js'

import { PACKAGE_MANIFEST_PATH } from './packageConstants.mjs'

export const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'readme.md',
  'dist/extension.js',
  'dist/cursorMcpBridge.js',
  'dist/build.json',
  'src/assets/book.svg',
  'skills/codebook/SKILL.md',
  'skills/codebook/publish-wiki.mjs',
  'skills/codebook/render-wiki.mjs',
  'skills/codebook/render-wiki-diagrams.mjs',
  'skills/codebook/reader-shell.html',
  'THIRD_PARTY_NOTICES.md',
]

/** Checks a closed file inventory, metadata, notices and manifest references without loading extension code. @example await verifyPackageContent(entries, expectedStageFiles) */
export async function verifyPackageContent(entries, expectedFiles) {
  const bytes = (path) => {
    const content = entries.get(`extension/${path}`)
    assert.ok(content, `Missing package file: ${path}`)
    return content
  }
  const manifest = JSON.parse(bytes(PACKAGE_MANIFEST_PATH).toString('utf8'))
  assert.equal(
    manifest.schemaVersion,
    1,
    'Unsupported package manifest version.',
  )
  assert.ok(
    manifest.files &&
      typeof manifest.files === 'object' &&
      !Array.isArray(manifest.files),
    'Missing file inventory.',
  )
  assert.ok(
    Array.isArray(manifest.dependencies) && manifest.dependencies.length > 0,
    'Missing dependency inventory.',
  )
  assert.ok(
    Array.isArray(manifest.externals) &&
      manifest.externals.every(
        (name) =>
          typeof name === 'string' && (name === 'vscode' || isBuiltin(name)),
      ),
    'Unresolved runtime import.',
  )
  assert.ok(
    Array.isArray(manifest.inputs) && manifest.inputs.length > 0,
    'Missing bundle input inventory.',
  )
  for (const input of manifest.inputs)
    assert.ok(
      typeof input.path === 'string' &&
        /^[a-f0-9]{64}$/.test(input.sha256) &&
        Number.isSafeInteger(input.bytes) &&
        input.bytes > 0,
      'Invalid bundle input.',
    )
  assert.ok(
    manifest.inputs.every(
      (input) =>
        !/(?:^|\/)(?:tests|fixtures|fixture|demo|experiments)(?:\/|$)/.test(
          input.path,
        ),
    ),
    'Validation application or test input entered the bundle.',
  )
  const requiredFiles = [...REQUIRED_PACKAGE_FILES],
    noticeFiles = new Set()
  for (const dependency of manifest.dependencies) {
    assert.ok(
      typeof dependency.name === 'string' &&
        typeof dependency.version === 'string' &&
        typeof dependency.license === 'string' &&
        dependency.license,
      'Missing dependency license/version.',
    )
    assert.ok(
      Array.isArray(dependency.notices) && dependency.notices.length > 0,
      `Missing dependency notice: ${dependency.name}`,
    )
    for (const notice of dependency.notices) {
      assert.ok(
        typeof notice.file === 'string' &&
          /^notices\/[a-zA-Z0-9_.+~-]+\/[a-zA-Z0-9_.-]+$/.test(notice.file),
        'Unsafe dependency notice path.',
      )
      // A duplicate is already invalid; reject before hashing the same notice bytes again.
      assert.ok(
        !noticeFiles.has(notice.file),
        `Duplicate dependency notice: ${notice.file}`,
      )
      noticeFiles.add(notice.file)
      assert.equal(
        createHash('sha256').update(bytes(notice.file)).digest('hex'),
        notice.sha256,
        `Dependency notice mismatch: ${dependency.name}`,
      )
      requiredFiles.push(notice.file)
    }
  }
  for (const name of ['@modelcontextprotocol/sdk', 'zod', 'ws'])
    assert.ok(
      manifest.dependencies.some((dependency) => dependency.name === name),
      `Missing bundled dependency: ${name}`,
    )
  assert.equal(
    new Set(requiredFiles).size,
    requiredFiles.length,
    'Duplicate required package file.',
  )
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    requiredFiles.sort(),
    'Package inventory differs from the allowed files.',
  )
  assert.deepEqual(
    [...entries.keys()].sort(),
    [
      '[Content_Types].xml',
      'extension.vsixmanifest',
      `extension/${PACKAGE_MANIFEST_PATH}`,
      ...requiredFiles.map((file) => `extension/${file}`),
    ].sort(),
    'Archive contains missing or extra entries.',
  )
  for (const [file, expected] of Object.entries(manifest.files)) {
    const content = bytes(file)
    assert.equal(
      content.length,
      expected.bytes,
      `Package size mismatch: ${file}`,
    )
    assert.equal(
      createHash('sha256').update(content).digest('hex'),
      expected.sha256,
      `Package hash mismatch: ${file}`,
    )
  }
  // The generated archive must also preserve the exact bytes staged by this build.
  if (expectedFiles) {
    assert.deepEqual(
      [...expectedFiles.keys()].sort(),
      [...requiredFiles, PACKAGE_MANIFEST_PATH].sort(),
      'Stage contains missing or extra files.',
    )
    for (const [file, content] of expectedFiles)
      assert.deepEqual(
        bytes(file),
        content,
        `Archive changed staged bytes: ${file}`,
      )
  }
  const extension = JSON.parse(bytes('package.json').toString('utf8')),
    build = JSON.parse(bytes('dist/build.json').toString('utf8'))
  assert.equal(extension.name, 'codebook')
  assert.equal(extension.publisher, 'laststance')
  assert.match(extension.version, /^\d+\.\d+\.\d+$/)
  assert.deepEqual(
    manifest.extension,
    {
      name: extension.name,
      publisher: extension.publisher,
      version: extension.version,
      apiVersion: build.apiVersion,
    },
    'Extension metadata mismatch.',
  )
  assert.equal(
    build.extensionVersion,
    extension.version,
    'Build version mismatch.',
  )
  assert.match(build.apiVersion, /^\d+\.\d+$/, 'Missing API version.')
  assert.deepEqual(manifest.build, build, 'Build identity mismatch.')
  assert.match(
    build.revision,
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
    'Invalid Git revision.',
  )
  assert.equal(typeof build.dirty, 'boolean')
  assert.ok(
    Array.isArray(build.sourceHashes) && build.sourceHashes.length > 0,
    'Missing source provenance.',
  )
  assert.equal(
    createHash('sha256').update(build.sourceHashes.join('\n')).digest('hex'),
    build.sourceHash,
    'Source provenance mismatch.',
  )
  assert.ok(
    build.sourceHashes.some((value) =>
      value.startsWith('extension/patches/@modelcontextprotocol__sdk@'),
    ),
    'Missing SDK patch provenance.',
  )
  for (const key of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'scripts',
  ])
    assert.equal(
      extension[key],
      undefined,
      `Installed manifest retains ${key}.`,
    )
  const referenced = [
    extension.main,
    ...Object.values(extension.contributes?.viewsContainers ?? {})
      .flat()
      .map((container) => container.icon),
    ...Object.values(extension.contributes?.chatSkills ?? {})
      .flat()
      .map((skill) => skill.path),
  ]
  for (const reference of referenced) {
    assert.equal(typeof reference, 'string', 'Missing manifest file reference.')
    const path = reference.replace(/^\.\//, '')
    assert.ok(
      path &&
        !/[\\\x00-\x1f:]/.test(path) &&
        path.split('/').every((part) => part && part !== '.' && part !== '..'),
      'Unsafe manifest file reference.',
    )
    bytes(path)
  }
  assert.equal(
    extension.main,
    './dist/extension.js',
    'Unexpected extension entry.',
  )
  assert.deepEqual(
    extension.contributes?.chatSkills,
    [{ path: './skills/codebook/SKILL.md' }],
    'Bundled chat skill registration differs from its source.',
  )
  assert.deepEqual(
    extension.contributes?.mcpServerDefinitionProviders,
    [
      {
        id: 'laststance.codebook.currentWorkspace',
        label: 'Codebook current workspace',
      },
    ],
    'Codebook MCP provider contribution is missing.',
  )
  assert.ok(
    extension.contributes?.commands?.some(
      (command) => command.command === 'codebook.setupAiChat',
    ),
    'Ordinary editor chat setup command is missing.',
  )
  const skill = bytes('skills/codebook/SKILL.md').toString('utf8')
  assert.match(
    skill,
    /^---\nname: codebook\ndescription: [^\n]+\nmetadata:\n  version: "\d+\.\d+\.\d+"\n---\n/,
    'Missing canonical versioned codebook skill.',
  )
  assert.doesNotMatch(
    skill,
    /\b(?:Authorization\s*:|Bearer\s+\S+|https?:\/\/(?:127\.0\.0\.1|localhost)\b|[a-f0-9]{64}\b)/i,
    'Bundled skill contains connection-like or temporary identity material.',
  )
  const rawXml = entries.get('extension.vsixmanifest').toString('utf8')
  assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(rawXml), 'Unsupported XML declaration.')
  const xml = await parseStringPromise(rawXml),
    identity = xml.PackageManifest?.Metadata?.[0]?.Identity?.[0]?.$
  assert.equal(
    identity?.Id,
    extension.name,
    'VSIX extension identity mismatch.',
  )
  assert.equal(
    identity?.Publisher,
    extension.publisher,
    'VSIX publisher mismatch.',
  )
  assert.equal(identity?.Version, extension.version, 'VSIX version mismatch.')
  const rawTypes = entries.get('[Content_Types].xml').toString('utf8')
  assert.ok(
    !/<!DOCTYPE|<!ENTITY/i.test(rawTypes),
    'Unsupported XML declaration.',
  )
  assert.ok(
    (await parseStringPromise(rawTypes)).Types,
    'Invalid VSIX content types.',
  )
  return {
    extension: manifest.extension,
    build,
    entries: entries.size,
    unpackedBytes: [...entries.values()].reduce(
      (sum, content) => sum + content.length,
      0,
    ),
  }
}
