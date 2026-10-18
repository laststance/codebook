import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  prepareWikiStage,
  publishWiki,
  recoverWikiPublication,
} from '../../skills/codebook/publish-wiki.mjs'
import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

import { giveLargeFileIds } from './utils/largeFileIdsFileSystem.mjs'
import {
  swapBeforeMaking,
  swapBeforeWriting,
} from './utils/swappedFolderFileSystem.mjs'
import { failRealPathOf } from './utils/unnamedRealPathFileSystem.mjs'

/** The bytes of a PNG asset as a test writes it: the PNG signature and the start of an image header; the publisher reads no more than the signature. */
const PNG_ASSET_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
])

for (const legacy of [false, true]) {
  test(
    'stopped publication before its swap preserves the ' +
      (legacy ? 'adopted legacy' : 'sealed') +
      ' generation',
    async () => {
      // Arrange
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'codebook-wiki-before-swap-')),
      )
      const output = join(root, '.codebook/wiki'),
        first = join(root, '.codebook/first'),
        stage = join(root, '.codebook/next')
      try {
        if (legacy) await writeStage(output, root, '<h1>Original</h1>')
        else {
          await writeStage(first, root, '<h1>Original</h1>', undefined, output)
          await publishWiki({
            projectRoot: root,
            outputDirectory: output,
            stageDirectory: first,
          })
        }
        await prepareWikiStage({
          projectRoot: root,
          outputDirectory: output,
          stageDirectory: stage,
          adoptExisting: legacy,
        })
        const before = await readFile(join(output, 'codebook-wiki.json'))
        await writeFile(
          output + '.publish-journal.json',
          JSON.stringify({
            projectRoot: root,
            output,
            stage,
            backup: output + '.previous-not-moved',
            pid: 99999999,
            operation: 'publish',
            manifestSha256: '1'.repeat(64),
            priorManifestSha256: createHash('sha256')
              .update(before)
              .digest('hex'),
            priorLegacy: legacy,
          }),
        )
        // Act
        const recovered = await recoverWikiPublication({
          projectRoot: root,
          outputDirectory: output,
        })
        // Assert
        assert.equal(recovered.status, 'published-or-restored')
        assert.deepEqual(
          await readFile(join(output, 'codebook-wiki.json')),
          before,
        )
        await assert.rejects(access(output + '.publish-journal.json'))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}

test('an interrupted new publication without generation identity cannot move a backup into place', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-journal-identity-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/next'),
    backup = output + '.previous-original'
  try {
    await writeStage(backup, root, '<h1>Preserve this backup</h1>')
    const record = JSON.stringify({
      projectRoot: root,
      output,
      stage,
      backup,
      pid: 99999999,
      operation: 'publish',
      priorLegacy: true,
    })
    await writeFile(output + '.publish-journal.json', record)
    // Act / Assert
    await assert.rejects(
      recoverWikiPublication({ projectRoot: root, outputDirectory: output }),
      /missing generation identity/,
    )
    assert.equal(
      await readFile(join(backup, 'index.html'), 'utf8'),
      '<h1>Preserve this backup</h1>',
    )
    assert.equal(
      await readFile(output + '.publish-journal.json', 'utf8'),
      record,
    )
    await assert.rejects(access(output))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the shared CLI prepares, previews, publishes and recovers using its reported paths', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-cli-')),
  )
  const output = join(root, '.codebook/wiki'),
    command = fileURLToPath(
      new URL('../../skills/codebook/publish-wiki.mjs', import.meta.url),
    )
  const scope = ['--project', root, '--output', output]
  try {
    const prepared = JSON.parse(
      execFileSync(process.execPath, [command, '--prepare', ...scope], {
        encoding: 'utf8',
      }),
    )
    await writeStage(prepared.stage, root, '<h1>CLI article</h1>')
    // Act
    const preview = JSON.parse(
      execFileSync(
        process.execPath,
        [command, ...scope, '--stage', prepared.stage, '--render-only'],
        { encoding: 'utf8' },
      ),
    )
    await assert.rejects(access(output))
    const published = JSON.parse(
      execFileSync(
        process.execPath,
        [command, ...scope, '--stage', prepared.stage],
        { encoding: 'utf8' },
      ),
    )
    const before = await readFile(join(output, 'codebook-wiki.json'))
    const next = JSON.parse(
      execFileSync(process.execPath, [command, '--prepare', ...scope], {
        encoding: 'utf8',
      }),
    )
    await writeFile(join(output, 'codebook-wiki.json'), '{accidental CLI edit')
    const recovered = JSON.parse(
      execFileSync(
        process.execPath,
        [command, '--recover', ...scope, '--stage', next.stage],
        { encoding: 'utf8' },
      ),
    )
    // Assert
    assert.equal(preview.renderedPages, 1)
    assert.equal(published.output, output)
    assert.equal(published.publishedFiles, 1)
    assert.equal(recovered.status, 'manifest-restored')
    assert.deepEqual(await readFile(join(output, 'codebook-wiki.json')), before)
    assert.equal(
      await readFile(recovered.modifiedManifestBackup, 'utf8'),
      '{accidental CLI edit',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prepared updates retain exact published metadata and copy only owned assets', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-prepare-')),
  )
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next')
  try {
    await writeStage(first, root, '<h1>Original</h1>', undefined, output)
    const manifest = JSON.parse(
      await readFile(join(first, 'codebook-wiki.json'), 'utf8'),
    )
    manifest.assets = ['assets/note.png']
    await mkdir(join(first, 'assets'))
    await writeFile(join(first, 'assets/note.png'), PNG_ASSET_BYTES)
    await writeFile(join(first, 'codebook-wiki.json'), JSON.stringify(manifest))
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    await writeFile(join(output, 'manual.txt'), 'Manual note')
    const before = await readFile(join(output, 'codebook-wiki.json')),
      receiptBefore = await readFile(join(output, 'codebook-publication.json'))
    // Act
    const result = await prepareWikiStage({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: next,
    })
    // Assert
    assert.equal(result.stage, next)
    assert.equal(result.legacyAdopted, false)
    assert.deepEqual(await readFile(join(next, 'codebook-wiki.json')), before)
    assert.deepEqual(
      await readFile(join(next, 'assets/note.png')),
      PNG_ASSET_BYTES,
    )
    await assert.rejects(access(join(next, 'index.html')))
    await assert.rejects(access(join(next, 'manual.txt')))
    assert.deepEqual(await readFile(join(output, 'codebook-wiki.json')), before)
    assert.deepEqual(
      await readFile(join(output, 'codebook-publication.json')),
      receiptBefore,
    )
    const receipt = JSON.parse(receiptBefore)
    assert.equal(receipt.kind, 'published')
    assert.equal(receipt.manifestText, before.toString())
    assert.equal(
      receipt.manifestSha256,
      createHash('sha256').update(before).digest('hex'),
    )
    await assert.rejects(
      prepareWikiStage({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: next,
      }),
      /EEXIST/,
    )
    assert.deepEqual(await readFile(join(next, 'codebook-wiki.json')), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an older prepared candidate cannot replace a newer published Wiki', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-stale-stage-')),
  )
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    a = join(root, '.codebook/a'),
    b = join(root, '.codebook/b')
  try {
    await writeStage(first, root, '<h1>Original</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    await writeStage(a, root, '<h1>Published first</h1>', undefined, output)
    await writeStage(b, root, '<h1>Stale replacement</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: a,
    })
    const current = await readFile(join(output, 'codebook-wiki.json'))
    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: b,
      }),
      /changed since this candidate/,
    )
    assert.deepEqual(
      await readFile(join(output, 'codebook-wiki.json')),
      current,
    )
    assert.match(
      await readFile(join(output, 'index.html'), 'utf8'),
      /Published first/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a changed repository source can be documented without invalidating prior output ownership', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-source-update-')),
  )
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next')
  try {
    await writeStage(first, root, '<h1>Original</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    const prior = await readFile(join(output, 'codebook-wiki.json'))
    await prepareWikiStage({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: next,
    })
    const source = 'export const value = 2;\n',
      manifest = JSON.parse(prior)
    await writeFile(join(root, 'source.ts'), source)
    manifest.includedSources[0].sha256 = createHash('sha256')
      .update(source)
      .digest('hex')
    manifest.pages[0].contentHtml = '<h2 id="intro">Updated source</h2>'
    await writeFile(join(next, 'codebook-wiki.json'), JSON.stringify(manifest))
    // Act
    const result = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: next,
    })
    // Assert
    assert.match(
      await readFile(join(output, 'index.html'), 'utf8'),
      /Updated source/,
    )
    assert.deepEqual(
      await readFile(join(result.previousOutput, 'codebook-wiki.json')),
      prior,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a manual file added after preparation cannot become generated content', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-manual-collision-')),
  )
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next')
  try {
    await writeStage(first, root, '<h1>Original</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    await writeStage(next, root, '<h1>Candidate</h1>', 'note.html', output)
    await mkdir(join(output, 'pages'))
    await writeFile(join(output, 'pages/note.html'), 'Manual content')
    const before = await readFile(join(output, 'codebook-wiki.json'))
    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: next,
      }),
      /manual Wiki file conflicts/,
    )
    assert.equal(
      await readFile(join(output, 'pages/note.html'), 'utf8'),
      'Manual content',
    )
    assert.deepEqual(await readFile(join(output, 'codebook-wiki.json')), before)
    await assert.rejects(access(output + '.publish-journal.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const corruption of [
  'missing manifest',
  'malformed manifest',
  'missing receipt',
  'malformed receipt',
  'wrong receipt hash',
  'linked receipt',
]) {
  test(
    'Wiki preview preserves output when its ' +
      corruption +
      ' prevents integrity verification',
    async () => {
      // Arrange
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'codebook-wiki-integrity-')),
      )
      const output = join(root, '.codebook/wiki'),
        first = join(root, '.codebook/first'),
        next = join(root, '.codebook/next')
      try {
        await writeStage(first, root, '<h1>Original</h1>', undefined, output)
        await publishWiki({
          projectRoot: root,
          outputDirectory: output,
          stageDirectory: first,
        })
        await writeStage(next, root, '<h1>Candidate</h1>', undefined, output)
        const originalHtml = await readFile(join(output, 'index.html'))
        const manifestPath = join(output, 'codebook-wiki.json'),
          receiptPath = join(output, 'codebook-publication.json')
        if (corruption === 'missing manifest') await rm(manifestPath)
        if (corruption === 'malformed manifest')
          await writeFile(manifestPath, '{not json')
        if (corruption === 'missing receipt') await rm(receiptPath)
        if (corruption === 'malformed receipt')
          await writeFile(receiptPath, '{not json')
        if (corruption === 'wrong receipt hash') {
          const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
          receipt.manifestSha256 = '0'.repeat(64)
          await writeFile(receiptPath, JSON.stringify(receipt))
        }
        if (corruption === 'linked receipt') {
          await rename(receiptPath, join(root, 'retained-receipt.json'))
          await symlink(join(root, 'retained-receipt.json'), receiptPath)
        }
        // Act / Assert
        await assert.rejects(
          publishWiki({
            projectRoot: root,
            outputDirectory: output,
            stageDirectory: next,
            renderOnly: true,
          }),
          /manifest changed|publication record|retained Wiki manifest|linked file/,
        )
        assert.deepEqual(
          await readFile(join(output, 'index.html')),
          originalHtml,
        )
        await assert.rejects(access(output + '.publish-journal.json'))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}

test('explicit legacy adoption cannot bypass a present record whose manifest changed', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-adoption-bypass-')),
  )
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next')
  try {
    await writeStage(first, root, '<h1>Original</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    const manifest = JSON.parse(
      await readFile(join(output, 'codebook-wiki.json'), 'utf8'),
    )
    manifest.pages[0].title = 'Changed in place'
    await writeFile(
      join(output, 'codebook-wiki.json'),
      JSON.stringify(manifest),
    )
    // Act / Assert
    await assert.rejects(
      prepareWikiStage({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: next,
        adoptExisting: true,
      }),
      /published Wiki manifest changed/,
    )
    await assert.rejects(access(next))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unprepared Wiki inputs and authored ownership-record paths cannot publish', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-unprepared-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/stage')
  try {
    await writeStage(stage, root, '<h1>Candidate</h1>')
    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: stage,
      }),
      /Use --prepare/,
    )
    const manifest = JSON.parse(
      await readFile(join(stage, 'codebook-wiki.json'), 'utf8'),
    )
    manifest.assets = ['codebook-publication.json']
    await writeFile(join(stage, 'codebook-wiki.json'), JSON.stringify(manifest))
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: stage,
      }),
      /reserved owned path/,
    )
    await assert.rejects(access(output))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const alteration of ['valid JSON', 'invalid JSON', 'missing']) {
  test(
    'metadata recovery restores exact prior bytes and retains a ' +
      alteration +
      ' manifest change',
    async () => {
      // Arrange
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'codebook-wiki-metadata-recovery-')),
      )
      const output = join(root, '.codebook/wiki'),
        first = join(root, '.codebook/first')
      try {
        await writeStage(first, root, '<h1>Original</h1>', undefined, output)
        await publishWiki({
          projectRoot: root,
          outputDirectory: output,
          stageDirectory: first,
        })
        const before = await readFile(join(output, 'codebook-wiki.json'))
        await writeFile(join(output, 'manual.txt'), 'Keep my note.')
        const changed =
          alteration === 'valid JSON'
            ? '{"schemaVersion":1,"pages":[]}'
            : '{invalid'
        if (alteration === 'missing')
          await rm(join(output, 'codebook-wiki.json'))
        else await writeFile(join(output, 'codebook-wiki.json'), changed)
        // Act
        const result = await recoverWikiPublication({
          projectRoot: root,
          outputDirectory: output,
        })
        // Assert
        assert.equal(result.status, 'manifest-restored')
        assert.deepEqual(
          await readFile(join(output, 'codebook-wiki.json')),
          before,
        )
        if (alteration === 'missing')
          assert.equal(result.modifiedManifestBackup, undefined)
        else
          assert.equal(
            await readFile(result.modifiedManifestBackup, 'utf8'),
            changed,
          )
        assert.equal(
          await readFile(join(output, 'manual.txt'), 'utf8'),
          'Keep my note.',
        )
        assert.equal(
          (
            await recoverWikiPublication({
              projectRoot: root,
              outputDirectory: output,
            })
          ).status,
          'published-current',
        )
        await assert.rejects(access(output + '.publish-journal.json'))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}

test('metadata recovery refuses changed generated pages instead of manufacturing a valid prior generation', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-recovery-page-edit-')),
  )
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first')
  try {
    await writeStage(first, root, '<h1>Original</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    await writeFile(join(output, 'codebook-wiki.json'), '{changed')
    await writeFile(join(output, 'index.html'), 'Manual page')
    // Act / Assert
    await assert.rejects(
      recoverWikiPublication({ projectRoot: root, outputDirectory: output }),
      /file changed after generation/,
    )
    assert.equal(
      await readFile(join(output, 'codebook-wiki.json'), 'utf8'),
      '{changed',
    )
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      'Manual page',
    )
    await assert.rejects(access(output + '.publish-journal.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const claimState of ['none', 'stopped', 'active']) {
  test(
    'interrupted metadata restoration handles a ' +
      claimState +
      ' recovery owner without losing edited bytes',
    async () => {
      // Arrange
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'codebook-wiki-recovery-owner-')),
      )
      const output = join(root, '.codebook/wiki'),
        first = join(root, '.codebook/first')
      try {
        await writeStage(first, root, '<h1>Original</h1>', undefined, output)
        await publishWiki({
          projectRoot: root,
          outputDirectory: output,
          stageDirectory: first,
        })
        const before = await readFile(join(output, 'codebook-wiki.json')),
          changed = '{unfinished edit'
        await writeFile(join(output, 'codebook-wiki.json'), changed)
        const id = '12345678-1234-1234-1234-123456789abc',
          journal = output + '.publish-journal.json'
        const record = {
          projectRoot: root,
          output,
          operation: 'restore-manifest',
          pid: 99999999,
          id,
          manifestSha256: createHash('sha256').update(before).digest('hex'),
          modifiedManifestSha256: createHash('sha256')
            .update(changed)
            .digest('hex'),
          modifiedManifestBackup: output + '.modified-manifest-' + id + '.json',
          temporaryManifest: join(output, '.codebook-restore-' + id + '.json'),
        }
        const bytes = JSON.stringify(record)
        await writeFile(journal, bytes)
        await writeFile(record.modifiedManifestBackup, changed)
        await writeFile(record.temporaryManifest, before)
        const claim =
          journal +
          '.recovery-' +
          createHash('sha256').update(bytes).digest('hex')
        if (claimState !== 'none')
          await writeFile(
            claim,
            JSON.stringify({
              pid: claimState === 'active' ? process.pid : 99999999,
              id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            }),
          )
        // Act / Assert
        if (claimState === 'active') {
          await assert.rejects(
            recoverWikiPublication({
              projectRoot: root,
              outputDirectory: output,
            }),
            /may still be running/,
          )
          assert.equal(
            await readFile(join(output, 'codebook-wiki.json'), 'utf8'),
            changed,
          )
          assert.equal(await readFile(journal, 'utf8'), bytes)
        } else {
          assert.equal(
            (
              await recoverWikiPublication({
                projectRoot: root,
                outputDirectory: output,
              })
            ).status,
            'manifest-restored',
          )
          assert.deepEqual(
            await readFile(join(output, 'codebook-wiki.json')),
            before,
          )
          await assert.rejects(access(journal))
          await assert.rejects(access(claim))
        }
        assert.equal(
          await readFile(record.modifiedManifestBackup, 'utf8'),
          changed,
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}

test('a prepared legacy update can recover the original metadata after an accidental in-place edit', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-legacy-restore-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/stage')
  try {
    await writeStage(output, root, '<h1>Legacy original</h1>')
    const before = await readFile(join(output, 'codebook-wiki.json'))
    await prepareWikiStage({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
      adoptExisting: true,
    })
    await writeFile(join(output, 'codebook-wiki.json'), '{accidental edit')
    // Act
    const result = await recoverWikiPublication({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
    })
    // Assert
    assert.equal(result.status, 'manifest-restored')
    assert.deepEqual(await readFile(join(output, 'codebook-wiki.json')), before)
    assert.equal(
      await readFile(result.modifiedManifestBackup, 'utf8'),
      '{accidental edit',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** Writes isolated publication inputs; tests opt into the actual preparation workflow with an output path. @example await writeStage(stage, root, '<h1>Guide</h1>', undefined, output) */
async function writeStage(
  directory,
  root,
  pageText,
  extraPage,
  outputDirectory,
) {
  if (outputDirectory)
    await prepareWikiStage({
      projectRoot: root,
      outputDirectory,
      stageDirectory: directory,
    })
  await mkdir(directory, { recursive: true })
  const sourceText = 'export const value = 1;\n'
  await writeFile(join(root, 'source.ts'), sourceText)
  await writeFile(join(directory, 'index.html'), pageText)
  const pages = [
    {
      path: 'index.html',
      title: 'Overview',
      section: 'Guide',
      contentHtml: pageText
        .replace('<h1>', '<h2 id="intro">')
        .replace('</h1>', '</h2>'),
      sources: [{ path: 'source.ts', line: 1 }],
      outline: [{ id: 'intro', label: 'Introduction' }],
    },
  ]
  if (extraPage) {
    await mkdir(join(directory, 'pages'), { recursive: true })
    await writeFile(join(directory, 'pages', extraPage), extraPage)
    pages.push({
      path: `pages/${extraPage}`,
      title: extraPage,
      section: 'Guide',
      contentHtml: '<p>Additional source explanation.</p>',
      sources: [{ path: 'source.ts', line: 1 }],
      outline: [],
    })
  }
  await writeFile(
    join(directory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      readerVersion: 2,
      repositoryRoot: root,
      pages,
      assets: [],
      includedSources: [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(sourceText).digest('hex'),
        },
      ],
    }),
  )
}

test('Wiki publication keeps the prior version and manual files while removing obsolete owned pages', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-publish-')),
  )
  const output = join(root, '.codebook', 'wiki')
  const firstStage = join(dirname(output), 'wiki.stage-one')
  const secondStage = join(dirname(output), 'wiki.stage-two')
  try {
    await writeStage(
      firstStage,
      root,
      '<h1>First</h1>',
      'obsolete.html',
      output,
    )
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: firstStage,
    })
    await writeFile(join(output, 'manual.txt'), 'keep this note')
    await writeStage(
      secondStage,
      root,
      '<h1>Updated</h1>',
      'current.html',
      output,
    )
    // Act
    const result = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: secondStage,
    })
    // Assert
    assert.match(
      await readFile(join(output, 'index.html'), 'utf8'),
      /<h2 id="intro">Updated<\/h2>/,
    )
    assert.equal(
      await readFile(join(output, 'manual.txt'), 'utf8'),
      'keep this note',
    )
    await assert.rejects(readFile(join(output, 'pages', 'obsolete.html')))
    assert.match(
      await readFile(join(result.previousOutput, 'index.html'), 'utf8'),
      /<h2 id="intro">First<\/h2>/,
    )
    assert.equal(result.preservedManualFiles, 1)
    const publishedManifest = JSON.parse(
      await readFile(join(output, 'codebook-wiki.json'), 'utf8'),
    )
    assert.match(publishedManifest.ownedFiles['index.html'], /^[a-f0-9]{64}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Wiki publication refuses modified generated files and leaves the readable output intact', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-publish-edit-')),
  )
  const output = join(root, '.codebook', 'wiki')
  const firstStage = join(dirname(output), 'wiki.stage-one')
  const secondStage = join(dirname(output), 'wiki.stage-two')
  try {
    await writeStage(firstStage, root, '<h1>First</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: firstStage,
    })
    await writeStage(
      secondStage,
      root,
      '<h1>Agent replacement</h1>',
      undefined,
      output,
    )
    await writeFile(join(output, 'index.html'), '<h1>Manual edit</h1>')
    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: secondStage,
      }),
      /changed after generation/,
    )
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      '<h1>Manual edit</h1>',
    )
    assert.equal(
      await readFile(join(secondStage, 'index.html'), 'utf8'),
      '<h1>Agent replacement</h1>',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Wiki publication requires explicit inspection before adopting an older manifest without owned hashes', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-publish-adopt-')),
  )
  const output = join(root, '.codebook', 'wiki')
  const stage = join(dirname(output), 'wiki.stage-update')
  try {
    await writeStage(output, root, '<h1>Legacy</h1>')
    // Act / Assert
    await assert.rejects(
      prepareWikiStage({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: stage,
      }),
      /--adopt-existing/,
    )
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      '<h1>Legacy</h1>',
    )
    await prepareWikiStage({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
      adoptExisting: true,
    })
    await writeStage(stage, root, '<h1>Updated</h1>')
    const published = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
    })
    assert.match(
      await readFile(join(output, 'index.html'), 'utf8'),
      /<h2 id="intro">Updated<\/h2>/,
    )
    assert.equal(
      await readFile(join(published.previousOutput, 'index.html'), 'utf8'),
      '<h1>Legacy</h1>',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const renderOnly of [true, false]) {
  test(`Wiki ${renderOnly ? 'preview' : 'publication'} refuses changed semantic metadata even when every generated page is unchanged`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-manifest-drift-')),
    )
    const output = join(root, '.codebook/wiki'),
      firstStage = join(root, '.codebook/wiki.first'),
      nextStage = join(root, '.codebook/wiki.next')
    try {
      await writeStage(firstStage, root, '<h1>Original</h1>', undefined, output)
      await publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: firstStage,
      })
      const originalHtml = await readFile(join(output, 'index.html'), 'utf8')
      await writeStage(
        nextStage,
        root,
        '<h1>Replacement</h1>',
        undefined,
        output,
      )
      const manifest = JSON.parse(
        await readFile(join(output, 'codebook-wiki.json'), 'utf8'),
      )
      manifest.pages[0].contentHtml = '<p>Changed outside publication.</p>'
      const changedBytes = JSON.stringify(manifest)
      await writeFile(join(output, 'codebook-wiki.json'), changedBytes)
      // Act / Assert
      await assert.rejects(
        publishWiki({
          projectRoot: root,
          outputDirectory: output,
          stageDirectory: nextStage,
          renderOnly,
        }),
        /published Wiki manifest changed/,
      )
      assert.equal(
        await readFile(join(output, 'index.html'), 'utf8'),
        originalHtml,
      )
      assert.equal(
        await readFile(join(output, 'codebook-wiki.json'), 'utf8'),
        changedBytes,
      )
      await assert.rejects(access(`${output}.publish-journal.json`))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('Wiki publication recovery restores the prior readable version after an interrupted directory swap', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-publish-recover-')),
  )
  const output = join(root, '.codebook', 'wiki')
  const stage = join(dirname(output), 'wiki.stage-update')
  const backup = `${output}.previous-test`
  const journal = `${output}.publish-journal.json`
  try {
    await writeStage(output, root, '<h1>Prior</h1>')
    await writeStage(stage, root, '<h1>Candidate</h1>')
    await rename(output, backup)
    await writeFile(
      journal,
      JSON.stringify({
        projectRoot: root,
        output,
        stage,
        backup,
        pid: process.pid,
      }),
    )
    await assert.rejects(
      recoverWikiPublication({ projectRoot: root, outputDirectory: output }),
      /may still be running/,
    )
    await writeFile(
      journal,
      JSON.stringify({
        projectRoot: root,
        output,
        stage,
        backup,
        pid: 99999999,
      }),
    )
    // Act
    const recovered = await recoverWikiPublication({
      projectRoot: root,
      outputDirectory: output,
    })
    // Assert
    assert.equal(recovered.status, 'previous-restored')
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      '<h1>Prior</h1>',
    )
    assert.equal(
      await readFile(join(stage, 'index.html'), 'utf8'),
      '<h1>Candidate</h1>',
    )
    await assert.rejects(access(journal))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** Supplies one source-bound semantic page to the real renderer; no application is launched. @example await readerInput(root) */
async function readerInput(root) {
  const source = 'export const first = 1;\nexport const second = 2;'
  await writeFile(join(root, 'source.ts'), source)
  return {
    schemaVersion: 1,
    readerVersion: 2,
    repositoryRoot: root,
    assets: [],
    generated: { revision: '1234567890', at: '2026-09-29' },
    includedSources: [
      {
        path: 'source.ts',
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    ],
    pages: [
      {
        path: 'index.html',
        title: 'Overview <safe>',
        section: 'Guide & concepts',
        contentHtml:
          '<h2 id="flow">Source flow</h2><p>Explained from source.</p>',
        sources: [{ path: 'source.ts', line: 2, label: 'Second <value>' }],
        outline: [{ id: 'flow', label: 'Flow & source' }],
      },
    ],
  }
}

test('publishing an obsolete freeform reader keeps the current Wiki unchanged', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-legacy-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/wiki.stage')
  try {
    await writeStage(output, root, '<h1>Readable prior Wiki</h1>')
    await writeStage(stage, root, '<h1>Old reader copied without changes</h1>')
    const manifestPath = join(stage, 'codebook-wiki.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.readerVersion
    await writeFile(manifestPath, JSON.stringify(manifest))
    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: stage,
        adoptExisting: true,
      }),
      /readerVersion: 2/,
    )
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      '<h1>Readable prior Wiki</h1>',
    )
    await assert.rejects(access(`${output}.publish-journal.json`))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reader pages preserve authored content and build escaped chapter, outline and indexed source links', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-render-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages.push({
      ...manifest.pages[0],
      path: 'pages/detail.html',
      title: 'Detail',
      parent: 'index.html',
    })
    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })
    // Assert
    const overview = pages.get('index.html'),
      detail = pages.get('pages/detail.html')
    assert.match(overview, /Overview &lt;safe&gt;/)
    assert.match(overview, /Guide &amp; concepts/)
    assert.match(
      overview,
      /<h2 id="flow">Source flow<\/h2><p>Explained from source\.<\/p>/,
    )
    assert.match(detail, /href="\.\.\/index.html"/)
    assert.match(overview, /href="#flow">Flow &amp; source/)
    assert.match(overview, /path=source.ts&amp;line=2&amp;sha256=/)
    assert.match(overview, /Second &lt;value&gt;/)
    const settingsHref = overview.match(
      /href="(vscode:\/\/laststance\.codebook\/settings\?[^\"]+)">Change location<\/a>/,
    )?.[1]
    assert.ok(settingsHref)
    assert.equal(
      new URL(settingsHref.replaceAll('&amp;', '&')).searchParams.get('root'),
      root,
    )
    assert.match(
      overview,
      /<form id="qa-form">[\s\S]*class="qa-answer"[\s\S]*<\/form>/,
    )
    assert.doesNotMatch(overview, /\{\{[A-Z_]+\}\}|<h4/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the rail entry of a published page that opens the page's first cited source; fails_when=the entry names no file and line, so nothing says where it leads, or prints the path unescaped or without the break points a long path wraps at, or without the break point before the colon, so a line number breaks in two, or puts anything but the label into the link, so the reader of 0.2.29.0 can no longer name its editor there, or no longer ties the file and line to the link as its description; why_new=Cycle 0046 row 28 (design review DR-8), rows 68 and 69; seam=none
test('the rail entry of a published page is a link that holds the label alone and is described by the file and line of the page’s first source beside it, escaped, with a break point after each slash and before the colon', async () => {
  // Arrange: a page whose first source is src/utils/a&b.ts at line 12.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-open-target-')),
  )
  try {
    const manifest = await readerInput(root)
    const source = Array.from(
      { length: 12 },
      (_unused, index) => `export const value${index + 1} = ${index + 1};`,
    ).join('\n')
    await mkdir(join(root, 'src/utils'), { recursive: true })
    await writeFile(join(root, 'src/utils/a&b.ts'), source)
    manifest.includedSources.push({
      path: 'src/utils/a&b.ts',
      sha256: createHash('sha256').update(source).digest('hex'),
    })
    manifest.pages[0].sources.unshift({ path: 'src/utils/a&b.ts', line: 12 })

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert: the link's content is its accessible name, "Open in VS Code", exactly as 0.2.29.0 published it; the target shown beside it has the break points, and the hidden copy after it, "src/utils/a&b.ts:12", is the link's description.
    const entry = pages
      .get('index.html')
      .match(/<p class="open-in-editor">.*?<\/p>/)?.[0]
    assert.ok(entry)
    assert.equal(
      entry.replace(/href="[^"]+"/, 'href="…"'),
      '<p class="open-in-editor"><a href="…" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a&amp;b.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a&amp;b.ts:12</span></p>',
    )
    const address = new URL(
      entry.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&'),
    )
    assert.deepEqual(
      [address.searchParams.get('path'), address.searchParams.get('line')],
      ['src/utils/a&b.ts', '12'],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=what assistive technology is told the rail entry of a published page opens; fails_when=the publisher describes the link by the shown target with its wrap points again, so Chrome describes it as "package.json :31", a path that is not the file's, or leaves the shown target in the accessibility tree beside the description, or the description loses the publisher's id; why_new=Cycle 0046 finding 600 (observed natively in Chrome for Testing on C55: the description "package.json :31"); seam=none, the description is read in Chrome by the Wiki reader DOM check
test('the rail entry of a published page for package.json line 31 shows the file and line with a break point before the colon, hidden from assistive technology, and is described by package.json:31 as written', async () => {
  // Arrange: a page whose first source is package.json at line 31.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-open-description-')),
  )
  try {
    const manifest = await readerInput(root)
    const source = Array.from(
      { length: 31 },
      (_unused, index) => `  "line${index + 1}": ${index + 1},`,
    ).join('\n')
    await writeFile(join(root, 'package.json'), source)
    manifest.includedSources.push({
      path: 'package.json',
      sha256: createHash('sha256').update(source).digest('hex'),
    })
    manifest.pages[0].sources.unshift({ path: 'package.json', line: 31 })

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert
    const entry = pages
      .get('index.html')
      .match(/<p class="open-in-editor">.*?<\/p>/)?.[0]
    assert.equal(
      entry?.replace(/href="[^"]+"/, 'href="…"'),
      '<p class="open-in-editor"><a href="…" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">package.json<wbr>:31</span><span class="sr-only" id="codebook-open-target">package.json:31</span></p>',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a published page whose own content carries an id the reader uses itself (the agent authors a section's id, and "qa-form" or "article-title" are plain names for a section); fails_when=the page is published with that id on two elements, so the reader's script binds the heading instead of its form, the question field loses its label, the answer stays hidden or the rail entry is described by the heading, or the heading is renamed without its outline entry or a link to it, which then leads to the reader's element; why_new=Cycle 0046 row 84; seam=none
for (const [id, elementsInThePublishedPage] of [
  ['theme-toggle', 1],
  ['article-title', 1],
  ['qa-form', 1],
  ['qa-input', 1],
  ['qa-response', 1],
  ['codebook-open-target', 1],
  // The reader gives these three ids to elements it adds to a served page, so a published page holds none of them.
  ['codebook-update-status', 0],
  ['shortcut-title', 0],
  ['shortcut-tooltip', 0],
])
  test(`a heading that carries the reader’s id ${id} is published under the id page-${id}, with its outline entry and the links to it from its own page and from another page, so the page holds the reader’s id on the reader’s element alone`, async () => {
    // Arrange: the overview's heading carries the id, its outline names it, and a link of the overview and a link of a second page lead to it.
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-ids-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = `<h2 id="${id}">Source flow</h2><p><a href="#${id}">To the start of this section</a></p>`
      manifest.pages[0].outline = [{ id, label: 'Source flow' }]
      manifest.pages.push({
        path: 'pages/details.html',
        title: 'Details',
        section: 'Guide & concepts',
        contentHtml: `<h2 id="more">More</h2><p><a href="../index.html#${id}">The source flow</a></p>`,
        sources: [{ path: 'source.ts', line: 1 }],
        outline: [{ id: 'more', label: 'More' }],
      })

      // Act
      const pages = await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })

      // Assert
      const overview = pages.get('index.html')
      assert.deepEqual(
        {
          elementsWithTheReadersId: overview.split(` id="${id}"`).length - 1,
          isHeadingRenamed: overview.includes(
            `<h2 id="page-${id}">Source flow</h2>`,
          ),
          doesOutlineReachTheHeading: overview.includes(
            `<ul class="outline"><li><a href="#page-${id}">Source flow</a></li></ul>`,
          ),
          doesLinkOfThePageReachTheHeading: overview.includes(
            `<a href="#page-${id}">To the start of this section</a>`,
          ),
          doesLinkOfAnotherPageReachTheHeading: pages
            .get('pages/details.html')
            .includes(`<a href="../index.html#page-${id}">The source flow</a>`),
        },
        {
          elementsWithTheReadersId: elementsInThePublishedPage,
          isHeadingRenamed: true,
          doesOutlineReachTheHeading: true,
          doesLinkOfThePageReachTheHeading: true,
          doesLinkOfAnotherPageReachTheHeading: true,
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the content of a page around a renamed id; fails_when=the new id is one the page carries already, or an id list of the page (aria-labelledby) keeps the old id, or a link to a page with a space in its path is missed, or the text of a code example that only mentions the id, a link out of the Wiki or an id the reader does not use is changed; why_new=Cycle 0046 row 84; seam=none
test('a renamed content id takes a name the page does not carry, its id lists and the links to it follow, and a code example, a link out of the Wiki and every other id stay as authored', async () => {
  // Arrange: the overview carries qa-form on a heading and page-qa-form on a paragraph; a page with a space in its path carries theme-toggle without quotes.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-ids-around-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id="qa-form">The form</h2><p id=\'page-qa-form\'>Its fields.</p>' +
      '<section aria-labelledby="qa-form  flow"><h3 id="flow">Flow</h3>' +
      '<a href="#qa-form">Up</a> <a href="pages/my%20page.html#theme-toggle">The theme</a> ' +
      '<a href="https://example.com/index.html#qa-form">Elsewhere</a>' +
      '<pre><code>&lt;form id="qa-form"&gt;</code></pre></section>'
    manifest.pages[0].outline = [
      { id: 'qa-form', label: 'The form' },
      { id: 'flow', label: 'Flow' },
    ]
    manifest.pages.push({
      path: 'pages/my page.html',
      title: 'Theme',
      section: 'Guide & concepts',
      contentHtml:
        '<h2 ID=theme-toggle>The theme</h2><p><a href="../index.html#qa-form">The form</a></p>',
      sources: [{ path: 'source.ts', line: 1 }],
      outline: [],
    })

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert: the article of each page after its relevant-source disclosure, and the overview's outline.
    const contentOf = (path) =>
      /<\/details>(.*)<\/article>/.exec(pages.get(path))?.[1]
    assert.equal(
      contentOf('index.html'),
      '<h2 id="page-qa-form-2">The form</h2><p id=\'page-qa-form\'>Its fields.</p>' +
        '<section aria-labelledby="page-qa-form-2  flow"><h3 id="flow">Flow</h3>' +
        '<a href="#page-qa-form-2">Up</a> <a href="pages/my%20page.html#page-theme-toggle">The theme</a> ' +
        '<a href="https://example.com/index.html#qa-form">Elsewhere</a>' +
        '<pre><code>&lt;form id="qa-form"&gt;</code></pre></section>',
    )
    assert.equal(
      contentOf('pages/my page.html'),
      '<h2 ID="page-theme-toggle">The theme</h2><p><a href="../index.html#page-qa-form-2">The form</a></p>',
    )
    assert.ok(
      pages
        .get('index.html')
        .includes(
          '<ul class="outline"><li><a href="#page-qa-form-2">The form</a></li><li><a href="#flow">Flow</a></li></ul>',
        ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=an attribute the publisher changed whose value the author wrote without quotes; fails_when=the changed value is printed bare again, so a value that holds a space after its character references are read (`qa-form&#32;flow`, `my&#32;page.html#qa-form`) ends at that space in a browser: the id list loses its second id to a stray attribute, and the link leads to another address; why_new=Cycle 0046 row 235; seam=none
test('a changed attribute value that the author wrote without quotes is printed in double quotes, so a space in it does not end it', async () => {
  // Arrange: an id list and a link, both bare and both with a space written as a character reference; the heading they name carries an id of the reader.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-bare-value-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id=qa-form>The form</h2><h3 id="flow">Flow</h3>' +
      '<p aria-labelledby=qa-form&#32;flow><a href=my&#32;page.html#qa-form>There</a> <a href=#qa-form>Up</a></p>'
    manifest.pages[0].outline = [{ id: 'qa-form', label: 'The form' }]
    manifest.pages.push({
      path: 'my page.html',
      title: 'Another page',
      section: 'Guide & concepts',
      contentHtml: '<h2 id="qa-form">A form</h2><p>Explained from source.</p>',
      sources: [{ path: 'source.ts', line: 1 }],
      outline: [{ id: 'qa-form', label: 'A form' }],
    })

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.ok(
      html.includes(
        '<h2 id="page-qa-form">The form</h2><h3 id="flow">Flow</h3>' +
          '<p aria-labelledby="page-qa-form flow"><a href="my page.html#page-qa-form">There</a> <a href="#page-qa-form">Up</a></p>',
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=links and references to a renamed section as an author may write them; fails_when=the renderer compares an address or an id as raw text again, so a link written with an entity, with a percent-encoded fragment or with a query keeps the old id and no longer reaches its heading, or misses an attribute that follows a closing quote directly, an id written with an entity or one of the newer attributes that refer to an id, or renames an element inside a comment, or resolves an address that starts at the site's root against the page's folder; why_new=Cycle 0046 row 134 (delegated review of the renaming of row 84, verified by running); seam=none
test('a renamed content id is followed the way a browser reads the page: through entities, a percent-encoded fragment, a query, an attribute directly after a closing quote and every attribute that refers to an id, and not into a comment or an address from the site’s root', async () => {
  // Arrange: the overview carries qa-form (its id follows a closing quote directly) and qa-input (written with an entity); three other pages carry qa-form too, two of them with a character in their path that an address escapes.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-ids-browser-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 class="title"id="qa-form">The form</h2>' +
      '<h3 id="qa&#45;input">The field</h3>' +
      '<!-- <h2 id="theme-toggle">An old section</h2> -->' +
      '<p><a href="a&amp;b.html#qa-form">One</a> <a href="it&#39;s.html#qa-form">Two</a> ' +
      '<a href="pages/details.html#qa%2Dform">Three</a> <a href="pages/details.html?from=overview#qa-form">Four</a> ' +
      '<a href="/index.html#qa-form">Five</a> <a href="#theme-toggle">Six</a></p>' +
      '<button popovertarget="qa-form" commandfor="qa-form" form="qa-form" itemref="qa-form flow" anchor="qa-form">Open</button>' +
      '<h3 id="flow">Flow</h3>'
    manifest.pages[0].outline = [
      { id: 'qa-form', label: 'The form' },
      { id: 'qa-input', label: 'The field' },
    ]
    for (const path of ['a&b.html', "it's.html", 'pages/details.html'])
      manifest.pages.push({
        path,
        title: `Page ${path}`,
        section: 'Guide & concepts',
        contentHtml:
          '<h2 id="qa-form">A form</h2><p><a href="index.html#qa&#45;input">The field</a></p>',
        sources: [{ path: 'source.ts', line: 1 }],
        outline: [{ id: 'qa-form', label: 'A form' }],
      })

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert: the article of the overview after its relevant-source disclosure, its outline, and a page that links back.
    const contentOf = (path) =>
      /<\/details>(.*)<\/article>/.exec(pages.get(path))?.[1]
    assert.equal(
      contentOf('index.html'),
      '<h2 class="title"id="page-qa-form">The form</h2>' +
        '<h3 id="page-qa-input">The field</h3>' +
        '<!-- <h2 id="theme-toggle">An old section</h2> -->' +
        '<p><a href="a&amp;b.html#page-qa-form">One</a> <a href="it&#39;s.html#page-qa-form">Two</a> ' +
        '<a href="pages/details.html#page-qa-form">Three</a> <a href="pages/details.html?from=overview#page-qa-form">Four</a> ' +
        '<a href="/index.html#qa-form">Five</a> <a href="#theme-toggle">Six</a></p>' +
        '<button popovertarget="page-qa-form" commandfor="page-qa-form" form="page-qa-form" itemref="page-qa-form flow" anchor="page-qa-form">Open</button>' +
        '<h3 id="flow">Flow</h3>',
    )
    assert.ok(
      pages
        .get('index.html')
        .includes(
          '<ul class="outline"><li><a href="#page-qa-form">The form</a></li><li><a href="#page-qa-input">The field</a></li></ul>',
        ),
    )
    assert.equal(
      contentOf('a&b.html'),
      '<h2 id="page-qa-form">A form</h2><p><a href="index.html#page-qa-input">The field</a></p>',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the outline of a published page, each entry of which must lead to a section; fails_when=the publisher accepts an outline entry whose id no element of the page carries because the id stands in an escaped code example or inside a comment, so the published entry leads nowhere; why_new=Cycle 0046 row 102 (the check looked for the text id="…" anywhere in the page's content); seam=none
test('an outline entry whose id stands only in an escaped code example or inside a comment is refused: no element of the page carries it', async () => {
  // Arrange: two stages; in each the outline names "flow", which the page shows once in an escaped example and once in a comment, and no element carries.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-outline-text-')),
  )
  try {
    const shownInAnExample = await readerInput(root)
    shownInAnExample.pages[0].contentHtml =
      '<h2 id="source">Source flow</h2><pre><code>&lt;h2 id="flow"&gt;Flow&lt;/h2&gt;</code></pre>'
    const insideAComment = await readerInput(root)
    insideAComment.pages[0].contentHtml =
      '<h2 id="source">Source flow</h2><!-- <h2 id="flow">Flow</h2> -->'

    // Act / Assert
    for (const manifest of [shownInAnExample, insideAComment])
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        {
          message:
            'Wiki page index.html has an invalid or missing outline anchor.',
        },
      )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a page whose anchor is written the way HTML allows without quotes, or with a character reference; fails_when=the publisher refuses such a page although a browser gives the element that id, so the agent must rewrite valid HTML; why_new=Cycle 0046 row 102 (the check accepted quoted ids only); seam=none
test('an outline entry whose anchor is written without quotes or with a character reference is accepted and leads to it', async () => {
  // Arrange: the anchor "flow" without quotes, and the anchor "data-flow" with its hyphen as a character reference.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-outline-forms-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id=flow>Source flow</h2><h2 id="data&#45;flow">Data flow</h2>'
    manifest.pages[0].outline = [
      { id: 'flow', label: 'Source flow' },
      { id: 'data-flow', label: 'Data flow' },
    ]

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert: the content is printed as authored, and the outline names both anchors.
    const overview = pages.get('index.html')
    assert.ok(
      overview.includes(
        '<h2 id=flow>Source flow</h2><h2 id="data&#45;flow">Data flow</h2>',
      ),
    )
    assert.ok(
      overview.includes(
        '<ul class="outline"><li><a href="#flow">Source flow</a></li><li><a href="#data-flow">Data flow</a></li></ul>',
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * Lists every value a source assigns to the id of an element, in the order the source writes them, so the test below sees each form and not one script's one pattern.
 *
 * Read are the code lines alone (comments are taken out first): `<element>.id = <value>`, `setAttribute('id', <value>)` and an `id="<value>"` inside a string of markup.
 *
 * @param source - The text of a TypeScript source of the reader.
 * @returns The assigned values as written: a quoted literal (`'shortcut-title'`), or an expression (`freeStatusRegionId()`, `${targetId}`).
 * @example
 * assignedIdsOf("heading.id = 'shortcut-title'\nbox.setAttribute('id', name)") // => ["'shortcut-title'", 'name']
 */
function assignedIdsOf(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  return [
    ...code.matchAll(
      /\.id\s*=(?!=)\s*([^\n;]+)|setAttribute\(\s*['"`]id['"`]\s*,\s*([^)\n]+)\)|\bid=\\?["']([^"'\\]+)/g,
    ),
  ].map(([, assigned, set, written]) => (assigned ?? set ?? written).trim())
}

// Value: protects=the list of ids the publisher keeps a page's content apart from; fails_when=the shell's template or one of the reader's sources gives an element an id the publisher does not know, in any form (a property, `setAttribute` or markup in a string), or assigns an id from something other than a literal or one of the three helpers that take a free id, so a page whose content carries that id is published with it twice; why_new=Cycle 0046 rows 84 and 133 (the first form of the test read one pattern per script); seam=none
test('the publisher keeps a page’s content apart from every id the shell’s template and the reader’s page scripts give an element', async () => {
  // Arrange: the shell, the publisher, and the sources of the reader that run in a served page or add to it.
  const textOf = (path) =>
    readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
  const shell = await textOf('skills/codebook/reader-shell.html')
  const renderer = await textOf('skills/codebook/render-wiki.mjs')
  const constants = await textOf('src/constants.ts')
  const statusScript = await textOf('src/utils/installWikiUpdateStatus.ts')
  const entryScript = await textOf('src/utils/rebindDeepWikiEditorLinks.ts')

  // Act: the ids of the template (the publisher reads them from it), every id the reader's sources assign, what the three helpers that take a free id start from, and the ids the publisher names.
  const idsOfTheTemplate = [...shell.matchAll(/\sid="([^"]+)"/g)].map(
    ([, id]) => id,
  )
  const helpScript = await textOf('src/utils/installShortcutHelp.ts')
  const idsTheSourcesAssign = {
    statusScript: assignedIdsOf(statusScript),
    keyboardHelp: assignedIdsOf(helpScript),
    questionForm: assignedIdsOf(await textOf('src/deepWikiReader.ts')),
    entryScript: assignedIdsOf(entryScript),
  }
  const idsTheHelpersStartFrom = {
    freeStatusRegionId:
      /const freeStatusRegionId = [\s\S]*?let id = '([^']+)'/.exec(
        statusScript,
      )?.[1],
    // The keyboard help's helper numbers the id its element was given, which is one of the two literals below.
    keepIdFree: /const keepIdFree = [\s\S]*?const wanted = ([\w.]+)/.exec(
      helpScript,
    )?.[1],
    freeOpenTargetIdIn: [
      /const targetId = (\w+)\(/.exec(entryScript)?.[1],
      /function freeOpenTargetIdIn\([\s\S]*?let id = (\w+)/.exec(
        entryScript,
      )?.[1],
      /WIKI_OPEN_TARGET_ELEMENT_ID = '([^']+)'/.exec(constants)?.[1],
    ],
  }
  const idsThePublisherNames = /const READER_ELEMENT_IDS = \[([^\]]+)\]/
    .exec(renderer)?.[1]
    .split(', ')
    .map((quoted) => quoted.slice(1, -1))

  // Assert
  assert.deepEqual(idsOfTheTemplate, [
    'theme-toggle',
    'article-title',
    'qa-form',
    'qa-input',
    'qa-response',
  ])
  assert.deepEqual(idsTheSourcesAssign, {
    statusScript: ['freeStatusRegionId()'],
    keyboardHelp: [
      "wanted + '-' + count",
      "'shortcut-title'",
      "'shortcut-tooltip'",
    ],
    questionForm: [],
    entryScript: ['${targetId}'],
  })
  assert.deepEqual(idsTheHelpersStartFrom, {
    freeStatusRegionId: 'codebook-update-status',
    keepIdFree: 'element.id',
    freeOpenTargetIdIn: [
      'freeOpenTargetIdIn',
      'WIKI_OPEN_TARGET_ELEMENT_ID',
      'codebook-open-target',
    ],
  })
  assert.deepEqual(idsThePublisherNames, [
    'codebook-open-target',
    'codebook-update-status',
    'shortcut-title',
    'shortcut-tooltip',
  ])
})

test('a page opened from disk shows the freshness label, the update button and an offline note as one group', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-offline-')),
  )
  try {
    const manifest = await readerInput(root)

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert
    const group = pages
      .get('index.html')
      .match(/<div data-codebook-update-group>.*?<\/div>/)?.[0]
    assert.ok(group)
    assert.equal(
      group.replace(/href="[^"]+"/, 'href="…"'),
      '<div data-codebook-update-group><p data-codebook-freshness data-status="unknown">Open from Codebook to check freshness</p><a class="wiki-update" href="…">Update LLM Wiki</a><p data-codebook-update-status>Offline copy. Update progress shows in the editor, or here when this Wiki is opened from Codebook.</p></div>',
    )
    assert.equal(
      new URL(
        group.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&'),
      ).searchParams.get('root'),
      root,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const invalidReaderCases = [
  [
    'an obsolete semantic reader version',
    (manifest) => {
      manifest.readerVersion = 1
    },
    /readerVersion: 2/,
  ],
  [
    'unsafe page location',
    (manifest) => {
      manifest.pages[0].path = '../index.html'
    },
    /relative HTML paths/,
  ],
  [
    'a copied full document',
    (manifest) => {
      manifest.pages[0].contentHtml = '<html><body>Old shell</body></html>'
    },
    /article sections/,
  ],
  [
    'a missing outline target',
    (manifest) => {
      manifest.pages[0].outline[0].id = 'absent'
    },
    /outline anchor/,
  ],
  [
    'an unknown source',
    (manifest) => {
      manifest.pages[0].sources[0].path = 'missing.ts'
    },
    /unindexed source/,
  ],
  [
    'a line beyond the source',
    (manifest) => {
      manifest.pages[0].sources[0].line = 3
    },
    /out of range/,
  ],
  [
    'a parent cycle',
    (manifest) => {
      manifest.pages[0].parent = 'index.html'
    },
    /cyclic/,
  ],
  [
    'a duplicate page',
    (manifest) => {
      manifest.pages.push({ ...manifest.pages[0] })
    },
    /distinct relative/,
  ],
  [
    'a missing title',
    (manifest) => {
      manifest.pages[0].title = ''
    },
    /needs title/,
  ],
]
for (const [label, invalidate, expectedError] of invalidReaderCases) {
  test(`reader generation rejects ${label} before rendering an incomplete page`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-invalid-')),
    )
    try {
      const manifest = await readerInput(root)
      invalidate(manifest)
      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        expectedError,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('reader generation refuses a source edit rather than publishing an old citation hash', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-drift-')),
  )
  try {
    const manifest = await readerInput(root)
    await writeFile(join(root, 'source.ts'), 'changed source')
    // Act / Assert
    await assert.rejects(
      renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }),
      /Wiki source changed: source.ts/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preview rendering produces the shared reader without changing published or manual files', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-preview-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/wiki.stage')
  try {
    await writeStage(output, root, '<h1>Prior site</h1>')
    await writeFile(join(output, 'manual.txt'), 'Keep my note.')
    await prepareWikiStage({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
      adoptExisting: true,
    })
    await writeStage(stage, root, '<h1>Candidate article</h1>')
    // Act
    const result = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
      renderOnly: true,
    })
    // Assert
    assert.equal(result.renderedPages, 1)
    assert.match(
      await readFile(join(stage, 'index.html'), 'utf8'),
      /<h2 id="intro">Candidate article<\/h2>/,
    )
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      '<h1>Prior site</h1>',
    )
    assert.equal(
      await readFile(join(output, 'manual.txt'), 'utf8'),
      'Keep my note.',
    )
    await assert.rejects(access(`${output}.publish-journal.json`))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('publication rejects an output containing the project even when its folder begins with two dots', async () => {
  // Arrange
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-parent-')),
  )
  const output = join(directory, 'output'),
    root = join(output, '..checkout'),
    stage = join(directory, 'stage')
  try {
    await mkdir(root, { recursive: true })
    await writeStage(stage, root, '<h1>Candidate</h1>')
    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: output,
        stageDirectory: stage,
      }),
      {
        message:
          'The Wiki output cannot be the project root or a folder that contains it. A folder inside the project, such as .codebook/wiki, is accepted.',
      },
    )
    assert.equal(
      await readFile(join(root, 'source.ts'), 'utf8'),
      'export const value = 1;\n',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder outside the project that a link in a cloned repository leads to (the repository carries `.codebook`, or another folder on the way to the Wiki output, as a link); fails_when=the preparation looks at the output folder alone again, follows the link at its parent and makes its stage and receipt in the folder outside the project; why_new=Cycle 0046 /ship finding F1 (critical, replayed twice): `--prepare` exited 0 and prepared its stage beyond the link; seam=none (the shipped CLI as the agent runs it)
for (const [linkName, outputSetting] of [
  ['wiki-link', 'wiki-link/wiki'],
  ['.codebook', '.codebook/wiki'],
])
  test(`the CLI preparation of an output whose parent ${linkName} in the project is a link to a folder outside it is refused, names the link and writes nothing there`, async () => {
    // Arrange
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-linked-parent-cli-')),
    )
    const root = join(directory, 'project'),
      outside = join(directory, 'outside'),
      command = fileURLToPath(
        new URL('../../skills/codebook/publish-wiki.mjs', import.meta.url),
      )
    try {
      await mkdir(root)
      await mkdir(outside)
      await symlink(outside, join(root, linkName), 'junction')

      // Act
      const prepared = spawnSync(
        process.execPath,
        [
          command,
          '--prepare',
          '--project',
          root,
          '--output',
          join(root, outputSetting),
        ],
        { encoding: 'utf8' },
      )

      // Assert
      assert.deepEqual(
        { status: prepared.status, stderr: prepared.stderr },
        {
          status: 1,
          stderr: `Error: The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, linkName)}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.\n`,
        },
      )
      assert.deepEqual(await readdir(outside), [])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

// Value: protects=the folder outside the project behind a link at a parent of the Wiki output, when a stage is already there (prepared by a build before this fix, or through the folder's own path); fails_when=the publish resolves the link and moves the stage into an output beyond it; why_new=Cycle 0046 /ship finding F1: the parents of the output were never looked at by any entry point; seam=none
test('a publish whose output lies behind a link at its parent in the project is refused and moves nothing beyond the link', async () => {
  // Arrange: a candidate prepared for the folder outside the project, then published through the link in the project.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-linked-parent-publish-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside')
  try {
    await mkdir(root)
    await mkdir(outside)
    await symlink(outside, join(root, 'wiki-link'), 'junction')
    const { stage } = await prepareWikiStage({
      projectRoot: root,
      outputDirectory: join(outside, 'wiki'),
    })
    await writeStage(stage, root, '<h1>Candidate</h1>')

    // Act / Assert
    await assert.rejects(
      publishWiki({
        projectRoot: root,
        outputDirectory: join(root, 'wiki-link/wiki'),
        stageDirectory: join(root, 'wiki-link', basename(stage)),
      }),
      {
        message: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, 'wiki-link')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
      },
    )
    assert.deepEqual(await readdir(outside), [basename(stage)])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=a Wiki in a folder outside the project behind a link at a parent of the output in the project; fails_when=recovery resolves the link and writes its journal, a temporary manifest and a restored manifest beyond it; why_new=Cycle 0046 /ship finding F1: `--recover` shares the unchecked path resolution with `--prepare` and the publish; seam=none
test('a recovery whose output lies behind a link at its parent in the project is refused and leaves the Wiki beyond the link as it is', async () => {
  // Arrange: a Wiki published into the folder outside the project, whose manifest was then edited.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-linked-parent-recover-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside'),
    stage = join(outside, 'first')
  try {
    await mkdir(root)
    await mkdir(outside)
    await symlink(outside, join(root, 'wiki-link'), 'junction')
    await writeStage(
      stage,
      root,
      '<h1>Published</h1>',
      undefined,
      join(outside, 'wiki'),
    )
    await publishWiki({
      projectRoot: root,
      outputDirectory: join(outside, 'wiki'),
      stageDirectory: stage,
    })
    await writeFile(
      join(outside, 'wiki/codebook-wiki.json'),
      '{accidental edit',
    )

    // Act / Assert
    await assert.rejects(
      recoverWikiPublication({
        projectRoot: root,
        outputDirectory: join(root, 'wiki-link/wiki'),
      }),
      {
        message: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, 'wiki-link')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
      },
    )
    assert.equal(
      await readFile(join(outside, 'wiki/codebook-wiki.json'), 'utf8'),
      '{accidental edit',
    )
    assert.deepEqual(await readdir(outside), ['wiki'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

/** The loads of the marked copies of the shipped skill modules, by module and mark, once each has begun. */
const markedCopies = new Map()
/**
 * Loads a copy of a shipped skill module whose `node:fs/promises` is the stand-in of its mark: the one loader hook (`scripts/tests/utils/markedCopyHooks.mjs`), registered once, maps each mark to its stand-in.
 * - `?wrong-look`: `lstat` calls a link a directory, as the file system layer of Node.js does on Windows for a junction whose target is a volume (`wrongLookFileSystem.mjs`).
 * - `?swapped-folder`: a test's swap runs just before the `mkdir` of a folder ({@link swapBeforeMaking}) or the `writeFile` of a file ({@link swapBeforeWriting}) that the test names (`swappedFolderFileSystem.mjs`).
 * - `?unnamed-real-path`: `realpath` fails for the folder a test names with {@link failRealPathOf} (`unnamedRealPathFileSystem.mjs`).
 * - `?crlf-shell`: the reader shell is read with CRLF line endings (`crlfShellFileSystem.mjs`).
 * - `?large-file-ids`: the folder a test names with {@link giveLargeFileIds} has file ids above 2^53 that change in their low bits (`largeFileIdsFileSystem.mjs`).
 * @param {string} module - The skill module's file, as `publish-wiki.mjs`.
 * @param {'?wrong-look' | '?swapped-folder' | '?unnamed-real-path' | '?crlf-shell' | '?large-file-ids'} mark - The mark of its stand-in.
 * @returns {Promise<Record<string, Function>>} The copy's exports.
 * @example
 * const { prepareWikiStage } = await loadMarkedCopy('publish-wiki.mjs', '?wrong-look')
 */
function loadMarkedCopy(module, mark) {
  if (markedCopies.size === 0)
    register(new URL('./utils/markedCopyHooks.mjs', import.meta.url))
  const key = `${module}${mark}`
  if (!markedCopies.has(key))
    markedCopies.set(
      key,
      import(
        new URL(`../../skills/codebook/${module}${mark}`, import.meta.url).href
      ),
    )
  return markedCopies.get(key)
}

/**
 * Publishes a Wiki into a new project's `.codebook/wiki` with the real publisher, optionally prepares a candidate beside it, then moves the Wiki folder out of the project and leaves a link to it in its place: on Windows a junction to another volume, which the publisher copy of {@link loadPublisherWhereTheLookIsWrong} looks at as a directory.
 * @param {{ prepareNext?: boolean }} options - Whether a candidate `.codebook/next` is prepared before the move.
 * @returns {Promise<{ directory: string, root: string, output: string, movedOut: string, next: string }>} The temporary folder, the project, the Wiki folder's path in the project, where the Wiki lies now, and the candidate's path.
 * @example
 * const wiki = await publishedWikiMovedOutBehindALink({ prepareNext: true })
 */
async function publishedWikiMovedOutBehindALink({ prepareNext = false } = {}) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-junction-output-')),
  )
  const root = join(directory, 'project')
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next'),
    movedOut = join(directory, 'wiki-moved-out')
  await mkdir(root)
  await writeStage(first, root, '<h1>Published</h1>', undefined, output)
  await publishWiki({
    projectRoot: root,
    outputDirectory: output,
    stageDirectory: first,
  })
  if (prepareNext)
    await writeStage(next, root, '<h1>Next</h1>', undefined, output)
  await rename(output, movedOut)
  await symlink(movedOut, output, 'junction')
  return { directory, root, output, movedOut, next }
}

/** The refusal of the Wiki folder itself when it is no folder of its own, for the path it names. */
const refusalOfWikiFolder = (path) =>
  `The Wiki folder ${path} is a link, a file or a folder that leads out of the project. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`
/** The refusal of a stage beside the Wiki folder when it is no folder of its own, for the path it names. */
const refusalOfStage = (path) =>
  `The Wiki stage ${path} is a link, a file or a folder that leads out of the project. Nothing was written. Remove it, then prepare the Wiki again.`
// Value: protects=the folder outside the project that a `.codebook` junction to a volume leads to on Windows, where the file system layer of Node.js calls such a junction a directory; fails_when=the publisher's walk trusts lstat and no longer compares a folder's real path with the project, so it prepares its stage beyond the junction; why_new=Cycle 0046 /ship repeat testing review TR4 (the real-path branch of requireOwnFolder had no test); seam=a copy of the shipped publisher whose `node:fs/promises` calls a link a directory, by a loader hook (scripts/tests/utils/markedCopyHooks.mjs, `?wrong-look`)
test('the publisher refuses a folder on the output’s path in the project that lstat calls a directory although its real path leaves the project, names it and writes nothing there', async () => {
  // Arrange: a copy of the publisher whose lstat answers for a link what stat answers, and a project whose `.codebook` is a link to a folder outside it.
  const { prepareWikiStage: prepareWhereTheLookIsWrong } = await loadMarkedCopy(
    'publish-wiki.mjs',
    '?wrong-look',
  )
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-wrong-look-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside')
  try {
    await mkdir(root)
    await mkdir(outside)
    await symlink(outside, join(root, '.codebook'), 'junction')

    // Act / Assert
    await assert.rejects(
      prepareWhereTheLookIsWrong({
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }),
      {
        message: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
      },
    )
    assert.deepEqual(await readdir(outside), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder outside the project that a `.codebook\\wiki` junction to another volume leads to on Windows, where the file system layer of Node.js calls such a junction a directory; fails_when=the publisher looks at the Wiki folder itself with lstat alone again, so it prepares a candidate from the Wiki behind the junction, publishes through it, or recovers by writing a manifest into it; why_new=Cycle 0046 /ship finding AF3 (the parents, the update start and the reader compare real paths; the publisher's look at the Wiki folder itself did not); seam=a copy of the shipped publisher whose `node:fs/promises` calls a link a directory (scripts/tests/utils/markedCopyHooks.mjs, `?wrong-look`)
for (const step of ['--prepare', 'publish', '--recover'])
  test(`${step} of a Wiki folder in the project that lstat calls a directory although its real path leaves the project is refused with the folder named, and nothing is written there or beside it`, async () => {
    // Arrange: a published Wiki moved out of the project behind a link at its folder's path, with a candidate prepared before the move for the publish, and an edited manifest behind the link for the recovery.
    const {
      prepareWikiStage,
      publishWiki: publishWhereTheLookIsWrong,
      recoverWikiPublication,
    } = await loadMarkedCopy('publish-wiki.mjs', '?wrong-look')
    const wiki = await publishedWikiMovedOutBehindALink({
      prepareNext: step === 'publish',
    })
    try {
      if (step === '--recover')
        await writeFile(
          join(wiki.movedOut, 'codebook-wiki.json'),
          '{accidental edit',
        )
      const beside = (await readdir(join(wiki.root, '.codebook'))).sort()
      const behind = (await readdir(wiki.movedOut)).sort()
      const scope = { projectRoot: wiki.root, outputDirectory: wiki.output }

      // Act
      const refusal = await (
        step === '--prepare'
          ? prepareWikiStage(scope)
          : step === 'publish'
            ? publishWhereTheLookIsWrong({
                ...scope,
                stageDirectory: wiki.next,
              })
            : recoverWikiPublication(scope)
      ).then(
        () => 'done',
        (error) => error.message,
      )

      // Assert
      assert.deepEqual(
        {
          refusal,
          beside: (await readdir(join(wiki.root, '.codebook'))).sort(),
          behind: (await readdir(wiki.movedOut)).sort(),
        },
        { refusal: refusalOfWikiFolder(wiki.output), beside, behind },
      )
    } finally {
      await rm(wiki.directory, { recursive: true, force: true })
    }
  })

// Value: protects=the folder outside the project that a candidate folder beside the Wiki leads to when it is a junction to another volume on Windows; fails_when=the publisher looks at the candidate with lstat alone, so it renders the pages into the folder behind the junction and moves it into the Wiki's place; why_new=Cycle 0046 /ship finding AF3 (the stage beside the output is looked at the same way); seam=a copy of the shipped publisher whose `node:fs/promises` calls a link a directory (scripts/tests/utils/markedCopyHooks.mjs, `?wrong-look`)
test('a publish whose candidate beside the Wiki in the project is a folder that lstat calls a directory although its real path leaves the project is refused with the candidate named, and the candidate and the Wiki are left as they are', async () => {
  // Arrange: a published Wiki with a candidate prepared beside it; the candidate is moved out of the project and a link to it stands in its place.
  const { publishWiki: publishWhereTheLookIsWrong } = await loadMarkedCopy(
    'publish-wiki.mjs',
    '?wrong-look',
  )
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-junction-stage-')),
  )
  const root = join(directory, 'project')
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next'),
    nextMovedOut = join(directory, 'next-moved-out')
  try {
    await mkdir(root)
    await writeStage(first, root, '<h1>Published</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })
    await writeStage(next, root, '<h1>Next</h1>', undefined, output)
    await rename(next, nextMovedOut)
    await symlink(nextMovedOut, next, 'junction')
    const candidateBefore = await readFile(
      join(nextMovedOut, 'index.html'),
      'utf8',
    )
    const wikiBefore = await readFile(join(output, 'index.html'), 'utf8')

    // Act
    const refusal = await publishWhereTheLookIsWrong({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: next,
    }).then(
      () => 'published',
      (error) => error.message,
    )

    // Assert
    assert.deepEqual(
      {
        refusal,
        candidate: await readFile(join(nextMovedOut, 'index.html'), 'utf8'),
        wiki: await readFile(join(output, 'index.html'), 'utf8'),
        beside: (await readdir(join(root, '.codebook'))).sort(),
      },
      {
        refusal: refusalOfStage(next),
        candidate: candidateBefore,
        wiki: wikiBefore,
        beside: ['next', 'wiki'],
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder outside the project that the prior Wiki's backup beside the Wiki folder leads to when it is a junction to another volume on Windows, where the file system layer of Node.js calls such a junction a directory; fails_when=the recovery looks at the backup with lstat alone, so it reads the Wiki behind the junction and moves the junction into the Wiki folder's place; why_new=Cycle 0046 /ship Codex review CX18 (the output and the stage are held to the project's own folders, the backup the recovery moves was not); seam=a copy of the shipped publisher whose `node:fs/promises` calls a link a directory (scripts/tests/utils/markedCopyHooks.mjs, `?wrong-look`)
test('a recovery whose kept prior Wiki beside the Wiki folder is a folder that lstat calls a directory although its real path leaves the project is refused with that folder named, and nothing is moved', async () => {
  // Arrange: a publish stopped after it moved the prior Wiki aside; the prior Wiki is then moved out of the project and a link to it stands at the backup's path.
  const { recoverWikiPublication: recoverWhereTheLookIsWrong } =
    await loadMarkedCopy('publish-wiki.mjs', '?wrong-look')
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-junction-backup-')),
  )
  const root = join(directory, 'project')
  const output = join(root, '.codebook', 'wiki'),
    stage = join(root, '.codebook', 'wiki.stage-update'),
    backup = `${output}.previous-test`,
    priorMovedOut = join(directory, 'prior-moved-out')
  try {
    await mkdir(root)
    await writeStage(output, root, '<h1>Prior</h1>')
    await writeStage(stage, root, '<h1>Candidate</h1>')
    await rename(output, priorMovedOut)
    await symlink(priorMovedOut, backup, 'junction')
    await writeFile(
      `${output}.publish-journal.json`,
      JSON.stringify({
        projectRoot: root,
        output,
        stage,
        backup,
        pid: 99999999,
      }),
    )

    // Act
    const refusal = await recoverWhereTheLookIsWrong({
      projectRoot: root,
      outputDirectory: output,
    }).then(
      () => 'recovered',
      (error) => error.message,
    )

    // Assert: the Wiki folder is still missing, and the backup's link, the journal and the stage stand as before.
    assert.deepEqual(
      {
        refusal,
        beside: (await readdir(join(root, '.codebook'))).sort(),
        prior: await readFile(join(priorMovedOut, 'index.html'), 'utf8'),
      },
      {
        refusal: `The prior Wiki kept at ${backup} is a link, a file or a folder that leads out of the project. Nothing was moved. Inspect it, then run --recover again.`,
        beside: [
          'wiki.previous-test',
          'wiki.publish-journal.json',
          'wiki.stage-update',
        ],
        prior: '<h1>Prior</h1>',
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the learner whose project holds `.codebook` with a real path the system cannot name (a folder of another user, or a junction on Windows that `realpath` refuses); fails_when=the publisher lets the system's error of `realpath` through instead of its refusal of a folder that leads out of the project, so the agent and the learner read a system error and no step; why_new=Cycle 0046 /ship adversarial review AD17 (the start check, the reader and the publisher refuse such a folder with the same sentences); seam=a copy of the shipped publisher whose `realpath` fails for one folder (scripts/tests/utils/markedCopyHooks.mjs, `?unnamed-real-path`)
for (const code of ['EACCES', 'EINVAL'])
  test(`a preparation whose .codebook has a real path the system cannot name (${code}) is refused with the folder named, as one that leads out of the project, and nothing is written there`, async () => {
    // Arrange: a project with a real `.codebook`, met by a publisher whose realpath fails for it.
    const { prepareWikiStage: prepareWhereTheRealPathFails } =
      await loadMarkedCopy('publish-wiki.mjs', '?unnamed-real-path')
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-unnamed-real-path-')),
    )
    try {
      await mkdir(join(root, '.codebook'))
      failRealPathOf(join(root, '.codebook'), code)

      // Act
      const refusal = await prepareWhereTheRealPathFails({
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }).then(
        () => 'prepared',
        (error) => error.message,
      )

      // Assert
      assert.deepEqual(
        { refusal, inCodebook: await readdir(join(root, '.codebook')) },
        {
          refusal: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
          inCodebook: [],
        },
      )
    } finally {
      failRealPathOf(undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the folder outside the project that `.codebook` leads to when another process swaps it for a link after the publisher looked at the path and before it made its stage; fails_when=the preparation trusts its first look at the path and makes the stage, its receipt and the prior Wiki's copy behind the link; why_new=Cycle 0046 /ship Codex review CX17 (the look at the path and the folders made after it were never compared); seam=a copy of the shipped publisher whose `node:fs/promises` swaps `.codebook` for a link just before the stage is made (scripts/tests/utils/markedCopyHooks.mjs, `?swapped-folder`)
test('a preparation whose .codebook is swapped for a link to a folder outside the project just before its stage is made is refused with the folder named, and nothing is left behind the link', async () => {
  // Arrange: a project whose `.codebook` is a real folder when the publisher looks at the path, and a link to a folder outside it when the stage is made.
  const { prepareWikiStage: prepareWhoseFolderIsSwapped } =
    await loadMarkedCopy('publish-wiki.mjs', '?swapped-folder')
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-swapped-before-stage-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside')
  try {
    await mkdir(join(root, '.codebook'), { recursive: true })
    await mkdir(outside)
    swapBeforeMaking(
      (path) => basename(path).startsWith('wiki.stage-'),
      async () => {
        await rm(join(root, '.codebook'), { recursive: true })
        await symlink(outside, join(root, '.codebook'), 'junction')
      },
    )

    // Act
    const refusal = await prepareWhoseFolderIsSwapped({
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    }).then(
      () => 'prepared',
      (error) => error.message,
    )

    // Assert
    assert.deepEqual(
      { refusal, behindTheLink: await readdir(outside) },
      {
        refusal: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
        behindTheLink: [],
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder outside the project that a missing `.codebook` leads to when another process makes it a link after the publisher looked at the path and before the publisher made it; fails_when=the preparation takes the missing folder as the end of its look, makes the parent through the link and then holds the Wiki behind it for an output outside the project, so it prepares there; why_new=Cycle 0046 /ship Codex review CX17 (the path was never looked at again once its missing folders were made); seam=a copy of the shipped publisher whose `node:fs/promises` makes `.codebook` a link just before the publisher makes it (scripts/tests/utils/markedCopyHooks.mjs, `?swapped-folder`)
test('a preparation whose missing .codebook becomes a link to a folder outside the project just before the publisher makes it is refused with the folder named, and nothing is written behind the link', async () => {
  // Arrange: a project without `.codebook` when the publisher looks at the path, and with a link of that name when the publisher makes the folder.
  const { prepareWikiStage: prepareWhoseFolderIsSwapped } =
    await loadMarkedCopy('publish-wiki.mjs', '?swapped-folder')
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-swapped-before-parent-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside')
  try {
    await mkdir(root)
    await mkdir(outside)
    swapBeforeMaking(
      (path) => path === join(root, '.codebook'),
      () => symlink(outside, join(root, '.codebook'), 'junction'),
    )

    // Act
    const refusal = await prepareWhoseFolderIsSwapped({
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    }).then(
      () => 'prepared',
      (error) => error.message,
    )

    // Assert
    assert.deepEqual(
      { refusal, behindTheLink: await readdir(outside) },
      {
        refusal: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
        behindTheLink: [],
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

/**
 * Publishes a Wiki into a new project's `.codebook/wiki` with the real publisher and prepares a candidate `.codebook/next` beside it, for a test that swaps `.codebook` while a copy of the publisher works on it.
 * @returns {Promise<{ directory: string, root: string, output: string, next: string, wikiPage: string, candidatePage: string }>} The temporary folder, the project, the Wiki folder, the candidate, and the text of the Wiki's and the candidate's `index.html`.
 * @example
 * const wiki = await publishedWikiWithACandidate()
 */
async function publishedWikiWithACandidate() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-swapped-during-publish-')),
  )
  const root = join(directory, 'project')
  const output = join(root, '.codebook/wiki'),
    first = join(root, '.codebook/first'),
    next = join(root, '.codebook/next')
  await mkdir(root)
  await writeStage(first, root, '<h1>Published</h1>', undefined, output)
  await publishWiki({
    projectRoot: root,
    outputDirectory: output,
    stageDirectory: first,
  })
  await writeStage(next, root, '<h1>Next</h1>', undefined, output)
  return {
    directory,
    root,
    output,
    next,
    wikiPage: await readFile(join(output, 'index.html'), 'utf8'),
    candidatePage: await readFile(join(next, 'index.html'), 'utf8'),
  }
}

// Value: protects=the folder outside the project that `.codebook` leads to when another process swaps it for a link after the publisher looked at the path and before it writes the rendered pages into the candidate; fails_when=the publish trusts its first look at the path, so it renders into the candidate behind the link, writes its journal and its backup there and moves the new Wiki into place there; why_new=Cycle 0046 /ship finding AF7 (CX17 held only the preparation to the look after creation); seam=a copy of the shipped publisher whose `node:fs/promises` swaps `.codebook` just before the candidate's folder is made (scripts/tests/utils/markedCopyHooks.mjs, `?swapped-folder`)
test('a publish whose .codebook is swapped for a link to a folder outside the project just before it writes into the candidate is refused with the folder named, and nothing is written behind the link', async () => {
  // Arrange: a published Wiki with a candidate; just before the publish makes the candidate's folder, `.codebook` is moved out of the project and a link to it stands in its place.
  const { publishWiki: publishWhoseFolderIsSwapped } = await loadMarkedCopy(
    'publish-wiki.mjs',
    '?swapped-folder',
  )
  const wiki = await publishedWikiWithACandidate()
  const movedOut = join(wiki.directory, 'codebook-moved-out')
  try {
    swapBeforeMaking(
      (path) => path === wiki.next,
      async () => {
        await rename(join(wiki.root, '.codebook'), movedOut)
        await symlink(movedOut, join(wiki.root, '.codebook'), 'junction')
      },
    )

    // Act
    const refusal = await publishWhoseFolderIsSwapped({
      projectRoot: wiki.root,
      outputDirectory: wiki.output,
      stageDirectory: wiki.next,
    }).then(
      () => 'published',
      (error) => error.message,
    )

    // Assert: behind the link the Wiki and the candidate are as they were, and no journal or backup stands beside them.
    assert.deepEqual(
      {
        refusal,
        behindTheLink: (await readdir(movedOut)).sort(),
        wikiPage: await readFile(join(movedOut, 'wiki/index.html'), 'utf8'),
        // A publish through the link would have moved the candidate into the Wiki's place.
        candidatePage: await readFile(
          join(movedOut, 'next/index.html'),
          'utf8',
        ).catch(() => 'no candidate'),
      },
      {
        refusal: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(wiki.root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
        behindTheLink: ['next', 'wiki'],
        wikiPage: wiki.wikiPage,
        candidatePage: wiki.candidatePage,
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the Wiki folder's parent the publish resolved, when another process replaces `.codebook` by another folder of the project before the publish writes; fails_when=the publish compares only real paths, so it writes into a folder that is not the one it looked at; why_new=Cycle 0046 /ship finding AF7 (the look after creation holds the parent's device and inode too); seam=a copy of the shipped publisher whose `node:fs/promises` replaces `.codebook` just before the candidate's folder is made (scripts/tests/utils/markedCopyHooks.mjs, `?swapped-folder`)
test('a publish whose .codebook is replaced by another folder of the project just before it writes into the candidate is refused with the folder named, and the Wiki is not replaced', async () => {
  // Arrange: just before the publish makes the candidate's folder, `.codebook` is replaced by a new folder that holds the same Wiki and candidate.
  const { publishWiki: publishWhoseFolderIsSwapped } = await loadMarkedCopy(
    'publish-wiki.mjs',
    '?swapped-folder',
  )
  const wiki = await publishedWikiWithACandidate()
  const replaced = join(wiki.root, '.codebook-replaced')
  try {
    swapBeforeMaking(
      (path) => path === wiki.next,
      async () => {
        await rename(join(wiki.root, '.codebook'), replaced)
        await mkdir(join(wiki.root, '.codebook'))
        await rename(join(replaced, 'wiki'), wiki.output)
        await rename(join(replaced, 'next'), wiki.next)
      },
    )

    // Act
    const refusal = await publishWhoseFolderIsSwapped({
      projectRoot: wiki.root,
      outputDirectory: wiki.output,
      stageDirectory: wiki.next,
    }).then(
      () => 'published',
      (error) => error.message,
    )

    // Assert
    assert.deepEqual(
      {
        refusal,
        inCodebook: (await readdir(join(wiki.root, '.codebook'))).sort(),
        wikiPage: await readFile(join(wiki.output, 'index.html'), 'utf8'),
      },
      {
        refusal: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(wiki.root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
        inCodebook: ['next', 'wiki'],
        wikiPage: wiki.wikiPage,
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder outside the project that `.codebook` leads to when another process swaps it for a link after the recovery looked at the path and before it restores an edited manifest; fails_when=the recovery trusts its first look at the path, so it writes its journal, the kept edited manifest and the restored manifest behind the link; why_new=Cycle 0046 /ship finding AF7 (recovery writes beside the Wiki folder and into it too); seam=a copy of the shipped publisher whose `node:fs/promises` swaps `.codebook` just before the recovery writes its journal (scripts/tests/utils/markedCopyHooks.mjs, `?swapped-folder`)
test('a recovery of an edited manifest whose .codebook is swapped for a link to a folder outside the project just before it writes its journal is refused with the folder named, and nothing is left or restored behind the link', async () => {
  // Arrange: a published Wiki whose manifest was edited by hand; just before the recovery writes its journal, `.codebook` is moved out of the project and a link to it stands in its place.
  const { recoverWikiPublication: recoverWhoseFolderIsSwapped } =
    await loadMarkedCopy('publish-wiki.mjs', '?swapped-folder')
  const wiki = await publishedWikiWithACandidate()
  const movedOut = join(wiki.directory, 'codebook-moved-out')
  try {
    await writeFile(join(wiki.output, 'codebook-wiki.json'), '{edited by hand')
    swapBeforeWriting(
      (path) => path === `${wiki.output}.publish-journal.json`,
      async () => {
        await rename(join(wiki.root, '.codebook'), movedOut)
        await symlink(movedOut, join(wiki.root, '.codebook'), 'junction')
      },
    )

    // Act
    const refusal = await recoverWhoseFolderIsSwapped({
      projectRoot: wiki.root,
      outputDirectory: wiki.output,
    }).then(
      () => 'recovered',
      (error) => error.message,
    )

    // Assert: behind the link no journal and no kept manifest stand beside the Wiki, and its edited manifest is as it was.
    assert.deepEqual(
      {
        refusal,
        behindTheLink: (await readdir(movedOut)).sort(),
        manifest: await readFile(
          join(movedOut, 'wiki/codebook-wiki.json'),
          'utf8',
        ),
      },
      {
        refusal: `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(wiki.root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
        behindTheLink: ['next', 'wiki'],
        manifest: '{edited by hand',
      },
    )
  } finally {
    await rm(wiki.directory, { recursive: true, force: true })
  }
})

// Value: protects=the folder the publisher resolved the Wiki's path in, on NTFS, whose file ids may lie above 2^53; fails_when=the publisher compares device and file ids as JavaScript numbers, which round above 2^53, so a folder that took the place of `.codebook` with an id that differs only in its low bits counts as the same and the preparation or the publish writes into it; why_new=Cycle 0046 /ship third review W8 (row 79's rule); seam=a copy of the shipped publisher whose `stat` gives `.codebook` ids above 2^53 that change in their low bits just before the candidate is made (scripts/tests/utils/markedCopyHooks.mjs, `?large-file-ids`)
for (const step of ['--prepare', 'publish'])
  test(`${step} whose .codebook gets another file id above 2^53, which differs from the first only in its low bits, just before it writes into the candidate is refused with the folder named`, async () => {
    // Arrange: a published Wiki with a candidate for the publish, or a project with `.codebook` alone for the preparation; `.codebook`'s file id changes just before the candidate's folder is made.
    const {
      prepareWikiStage: prepareWithLargeIds,
      publishWiki: publishWithLargeIds,
    } = await loadMarkedCopy('publish-wiki.mjs', '?large-file-ids')
    const wiki =
      step === 'publish' ? await publishedWikiWithACandidate() : undefined
    const root =
      wiki?.root ??
      (await realpath(
        await mkdtemp(join(tmpdir(), 'codebook-wiki-large-ids-')),
      ))
    const next = join(root, '.codebook/next')
    try {
      await mkdir(join(root, '.codebook'), { recursive: true })
      giveLargeFileIds(join(root, '.codebook'), next)

      // Act
      const refusal = await (
        step === 'publish'
          ? publishWithLargeIds({
              projectRoot: root,
              outputDirectory: join(root, '.codebook/wiki'),
              stageDirectory: next,
            })
          : prepareWithLargeIds({
              projectRoot: root,
              outputDirectory: join(root, '.codebook/wiki'),
              stageDirectory: next,
            })
      ).then(
        () => 'written',
        (error) => error.message,
      )

      // Assert
      assert.equal(
        refusal,
        `The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ${join(root, '.codebook')}. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.`,
      )
    } finally {
      giveLargeFileIds(undefined)
      await rm(wiki?.directory ?? root, { recursive: true, force: true })
    }
  })

// Value: protects=the learner who chose an output folder outside the project and reaches it through a link of their own; fails_when=the check of the folders on the way to the output refuses a link outside the project too, so a configured output outside it can no longer be prepared; why_new=Cycle 0046 /ship finding F1: the fix refuses links only once the path is inside the project; seam=none
test('an output outside the project reached through a link outside it is still prepared, in the folder the link leads to', async () => {
  // Arrange
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-link-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside')
  try {
    await mkdir(root)
    await mkdir(outside)
    await symlink(outside, join(directory, 'outside-link'), 'junction')

    // Act
    const prepared = await prepareWikiStage({
      projectRoot: root,
      outputDirectory: join(directory, 'outside-link/wiki'),
    })

    // Assert
    assert.deepEqual(
      { output: prepared.output, stageFolder: dirname(prepared.stage) },
      { output: join(outside, 'wiki'), stageFolder: outside },
    )
    assert.deepEqual(await readdir(prepared.stage), [
      'codebook-publication.json',
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

/**
 * Prepares a candidate for a new project's `.codebook/wiki` with the real publisher and gives it one asset with the bytes a test asks for, named by its manifest.
 * @param {string} assetPath - The asset's path in the Wiki, for example `assets/notes.html`.
 * @param {Buffer | string} assetBytes - What the asset holds.
 * @returns {Promise<{ root: string, output: string, stage: string, authoredPage: string }>} The project, the Wiki folder, the candidate, and the candidate's `index.html` as authored.
 * @example
 * const wiki = await candidateWithAnAsset('assets/flow.png', PNG_ASSET_BYTES)
 */
async function candidateWithAnAsset(assetPath, assetBytes) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-asset-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/next')
  await writeStage(stage, root, '<h1>With an asset</h1>', undefined, output)
  const manifest = JSON.parse(
    await readFile(join(stage, 'codebook-wiki.json'), 'utf8'),
  )
  manifest.assets = [assetPath]
  await mkdir(dirname(join(stage, assetPath)), { recursive: true })
  await writeFile(join(stage, assetPath), assetBytes)
  await writeFile(join(stage, 'codebook-wiki.json'), JSON.stringify(manifest))
  return {
    root,
    output,
    stage,
    authoredPage: await readFile(join(stage, 'index.html'), 'utf8'),
  }
}

// Value: protects=the learner who opens a published Wiki from disk, where no reader sends a policy, against an asset the agent wrote that runs script, acts on an event attribute or fetches a network path (`//host`, `\\host`) or another address, when its page links to it or it is opened itself; fails_when=the publisher checks only each page's content and publishes any file the manifest lists under `assets`, or trusts an asset's name and not its bytes; why_new=Cycle 0046 /ship finding AF9; seam=none (the shipped publisher)
for (const [kind, assetPath, assetBytes] of [
  [
    'an HTML asset',
    'assets/notes.html',
    '<!doctype html><img src="\\\\host\\share\\x.png" onerror="run()">',
  ],
  [
    'an SVG asset',
    'assets/flow.svg',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>run()</script></svg>',
  ],
  ['a script asset', 'assets/run.js', 'run()'],
  [
    'an asset named as a PNG image that holds HTML',
    'assets/fake.png',
    '<!doctype html><script>run()</script>',
  ],
])
  test(`a publish whose manifest lists ${kind} is refused with the sentence that names the asset and the images it may be, before anything is written`, async () => {
    // Arrange
    const wiki = await candidateWithAnAsset(assetPath, assetBytes)
    try {
      // Act
      const refusal = await publishWiki({
        projectRoot: wiki.root,
        outputDirectory: wiki.output,
        stageDirectory: wiki.stage,
      }).then(
        () => 'published',
        (error) => error.message,
      )

      // Assert: no Wiki folder stands, and the candidate's page is as authored, not rendered.
      assert.deepEqual(
        {
          refusal,
          beside: (await readdir(join(wiki.root, '.codebook'))).sort(),
          // A publish would have moved the candidate into the Wiki's place.
          candidatePage: await readFile(
            join(wiki.stage, 'index.html'),
            'utf8',
          ).catch(() => 'no candidate'),
        },
        {
          refusal: `Wiki asset ${assetPath} must be a PNG, JPEG, GIF, WebP or AVIF image, named .png, .jpg, .jpeg, .gif, .webp or .avif and holding the bytes of that format.`,
          beside: ['next'],
          candidatePage: wiki.authoredPage,
        },
      )
    } finally {
      await rm(wiki.root, { recursive: true, force: true })
    }
  })

// Value: protects=the article images an agent lists under `assets`, which the refusal of other assets must not take; fails_when=the publisher refuses a raster image of one of the six formats, by a name in capitals or by bytes the format starts with; why_new=Cycle 0046 /ship finding AF9 (assets are raster images only); seam=none (the shipped publisher)
for (const [format, assetPath, assetBytes] of [
  ['PNG', 'assets/flow.png', PNG_ASSET_BYTES],
  ['JPEG', 'assets/photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
  ['JPEG', 'assets/photo.JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00])],
  ['GIF', 'assets/anim.gif', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
  [
    'WebP',
    'assets/shot.webp',
    Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'),
  ],
  [
    'AVIF',
    'assets/shot.avif',
    Buffer.from(
      '\x00\x00\x00\x1cftypmif1\x00\x00\x00\x00mif1avifmiaf',
      'latin1',
    ),
  ],
])
  test(`a publish whose manifest lists a ${format} image ${assetPath} publishes it with its bytes`, async () => {
    // Arrange
    const wiki = await candidateWithAnAsset(assetPath, assetBytes)
    try {
      // Act
      const published = await publishWiki({
        projectRoot: wiki.root,
        outputDirectory: wiki.output,
        stageDirectory: wiki.stage,
      }).then(
        (result) => result.output,
        (error) => error.message,
      )

      // Assert
      assert.deepEqual(
        {
          published,
          asset: await readFile(join(wiki.output, assetPath)),
        },
        { published: wiki.output, asset: assetBytes },
      )
    } finally {
      await rm(wiki.root, { recursive: true, force: true })
    }
  })

// Value: protects=the learner who chose an output folder outside the project and updates the Wiki there again; fails_when=the publisher holds the Wiki folder itself to the rule of an output inside the project whatever its place, so an existing Wiki outside the project, whose real path of course leaves the project, is refused at the next preparation, publish or recovery; why_new=Cycle 0046 /ship repeat testing review TC5 (the real-path rule of the Wiki folder, AF3, had no test of an output outside the project that already exists); seam=none
test('a Wiki published into an output folder outside the project is prepared, published and recovered there again, each without a refusal of its path', async () => {
  // Arrange: a first Wiki published into a folder outside the project.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-again-')),
  )
  const root = join(directory, 'project'),
    outside = join(directory, 'outside')
  const output = join(outside, 'wiki'),
    first = join(outside, 'first'),
    next = join(outside, 'next')
  try {
    await mkdir(root)
    await mkdir(outside)
    await writeStage(first, root, '<h1>First</h1>', undefined, output)
    await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: first,
    })

    // Act: the next update, as the editor runs it, then a recovery; each step answers its outcome or its refusal.
    const prepared = await writeStage(
      next,
      root,
      '<h1>Next</h1>',
      undefined,
      output,
    ).then(
      () => 'prepared',
      (error) => error.message,
    )
    const published = await publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: next,
    }).then(
      (result) => result.output,
      (error) => error.message,
    )
    const recovered = await recoverWikiPublication({
      projectRoot: root,
      outputDirectory: output,
    }).then(
      (result) => result.status,
      (error) => error.message,
    )

    // Assert
    assert.deepEqual(
      {
        prepared,
        published,
        recovered,
        isNextWikiInPlace: (
          await readFile(join(output, 'index.html'), 'utf8')
        ).includes('>Next</h2>'),
      },
      {
        prepared: 'prepared',
        published: output,
        recovered: 'published-current',
        isNextWikiInPlace: true,
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the editor agent that writes a Wiki with the bundled skill, which reads the publisher's rules there before it writes; fails_when=the skill no longer tells the agent that a page's content carries no event attribute and links only to the schemes the publisher accepts, or that the publisher refuses a link on the output's path inside the project, so the agent learns each rule only from a refused publish; why_new=Cycle 0046 /ship follow-up N4 (findings F1 and F2 added the refusals); seam=none
test('the bundled skill tells the agent the publisher’s refusals of event attributes, of addresses of other schemes and of a link on the output’s path inside the project', async () => {
  // Arrange / Act
  const skill = await readFile(
    new URL('../../skills/codebook/SKILL.md', import.meta.url),
    'utf8',
  )

  // Assert
  assert.deepEqual(
    [
      skill.includes(
        'Do not put an event attribute (`onclick`, `onerror` or any other attribute whose name starts with `on`) on an element of `contentHtml`, and let every `href`, `src`, `srcset`, `action`, `formaction` and `xlink:href` name a relative path, a `#fragment`, an `http`, `https` or `mailto` address, or Codebook’s own `vscode://laststance.codebook/…` or `cursor://laststance.codebook/…` address; the publisher refuses anything else.',
      ),
      skill.includes(
        'The output folder and every folder on its path inside the project must be real folders. The publisher refuses a link there (a cloned repository may carry `.codebook` as one) and writes nothing; report the path it names and let the learner replace the link with a folder or choose an output outside the project. Do not work around the refusal.',
      ),
    ],
    [true, true],
  )
})

// Value: protects=the editor agent that lists a Wiki's assets with the bundled skill; fails_when=the skill still lets any local file be an asset, so the agent learns that only raster images are accepted from a refused publish; why_new=Cycle 0046 /ship finding AF9 (the publisher accepts only raster images as assets); seam=none
test('the bundled skill tells the agent that an asset is a PNG, JPEG, GIF, WebP or AVIF image and that the publisher refuses any other', async () => {
  // Arrange / Act
  const skill = await readFile(
    new URL('../../skills/codebook/SKILL.md', import.meta.url),
    'utf8',
  )

  // Assert
  assert.deepEqual(
    [
      skill.includes(
        '`assets` lists only the raster images the articles show: PNG, JPEG, GIF, WebP or AVIF files named `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` or `.avif` and holding the bytes of that format. The publisher refuses any other asset (HTML, SVG, scripts, styles or anything else), so do not retain old reader CSS/JS in the stage.',
      ),
      skill.includes('local non-diagram article assets'),
    ],
    [true, false],
  )
})

test('reader source links cannot follow a repository symlink to an outside file', async () => {
  // Arrange
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-symlink-')),
  )
  const root = join(directory, 'repository')
  try {
    await mkdir(root)
    const manifest = await readerInput(root)
    await writeFile(
      join(directory, 'outside.ts'),
      'export const first = 1;\nexport const second = 2;',
    )
    await symlink(join(directory, 'outside.ts'), join(root, 'linked.ts'))
    manifest.includedSources[0].path = 'linked.ts'
    manifest.pages[0].sources[0].path = 'linked.ts'
    // Act / Assert
    await assert.rejects(
      renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }),
      /outside its repository/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Provides isolated graph records for renderer behavior tests, never a packaged application. @example await diagramInput(root) */
async function diagramInput(root, kind = 'flow') {
  const manifest = await readerInput(root)
  const reference = () => ({
    path: 'source.ts',
    line: 1,
    endLine: 1,
    quote: 'export const first = 1;',
  })
  const diagram = {
    id: 'flow',
    title: 'Read data',
    caption: 'The request reads stored data.',
    kind,
    nodes: [
      {
        id: 'request',
        label: 'Request',
        sources: [reference()],
        ...(kind === 'flow' ? { row: 0, column: 0 } : {}),
      },
      {
        id: 'store',
        label: 'Store',
        sources: [reference()],
        ...(kind === 'flow' ? { row: 0, column: 1 } : {}),
      },
    ],
    edges: [
      {
        id: 'read',
        from: 'request',
        to: 'store',
        label: 'Read data',
        kind: 'call',
        sources: [reference()],
      },
    ],
  }
  manifest.pages[0].contentHtml +=
    '<figure data-codebook-diagram="flow"></figure>'
  manifest.pages[0].diagrams = [diagram]
  return manifest
}

/** Reads a single SVG edge group to assert visible operation and endpoint ownership. @example edgeGroup(html, 'read') */
function edgeGroup(html, id) {
  return html.match(
    new RegExp(`<g data-edge-id="${id}"[^>]*>[\\s\\S]*?<\\/g>`),
  )?.[0]
}

test('reordering flow nodes does not move an operation onto another arrow', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-identity-')),
  )
  try {
    const manifest = await diagramInput(root)
    manifest.pages[0].diagrams[0].nodes.reverse()
    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })
    const edge = edgeGroup(pages.get('index.html'), 'read')
    // Assert: Request remains the left origin, regardless of the array order.
    assert.match(edge, /data-from="request" data-to="store"/)
    assert.match(edge, /d="M216 87.5 C364 87.5 364 87.5 512 87.5"/)
    assert.match(edge, />Read data<\/tspan>/)
    assert.match(
      pages.get('index.html'),
      /source.ts:1<\/a><pre><code>export const first = 1;/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pending and success branches retain their own conditions and operations', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-branches-')),
  )
  try {
    const manifest = await diagramInput(root),
      diagram = manifest.pages[0].diagrams[0]
    diagram.edges[0] = {
      ...diagram.edges[0],
      kind: 'branch',
      condition: 'ready',
      label: 'Show result',
    }
    diagram.nodes.push({
      id: 'placeholder',
      label: 'Placeholder',
      row: 1,
      column: 1,
      sources: diagram.nodes[0].sources,
    })
    diagram.edges.push({
      ...diagram.edges[0],
      id: 'waiting',
      to: 'placeholder',
      kind: 'pending',
      condition: 'still loading',
      label: 'Show pending UI',
    })
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    // Assert
    assert.match(
      edgeGroup(html, 'read'),
      /data-to="store"[\s\S]*>Show result<\/tspan>[\s\S]*>When ready<\/tspan>/,
    )
    assert.doesNotMatch(
      edgeGroup(html, 'read'),
      /Show pending UI|still loading/,
    )
    assert.match(
      edgeGroup(html, 'waiting'),
      /data-from="request" data-to="placeholder"[\s\S]*stroke-dasharray="5 4"[\s\S]*>Show pending UI<\/tspan>[\s\S]*>When still loading<\/tspan>/,
    )
    assert.doesNotMatch(edgeGroup(html, 'waiting'), /Show result|When ready/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('wrapped diagram operations preserve word boundaries and an accessible condition label', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-word-boundary-')),
  )
  try {
    const manifest = await diagramInput(root),
      edge = manifest.pages[0].diagrams[0].edges[0]
    edge.label = 'returns false for anonymous dashboard user'
    edge.condition = 'access denied'
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    const group = edgeGroup(html, 'read')
    const renderedText = [...group.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)]
      .map((match) => match[1])
      .join('')
    // Assert: stripping all whitespace would conceal the regression seen in actual generated articles.
    assert.ok(
      renderedText.includes('returns false for anonymous dashboard user'),
    )
    assert.match(
      group,
      /aria-label="returns false for anonymous dashboard user; when access denied"/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a long flow condition stays above its connector and outside neighboring nodes', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-readable-flow-')),
  )
  try {
    const manifest = await diagramInput(root),
      diagram = manifest.pages[0].diagrams[0]
    diagram.nodes[0].label = 'Matched dashboard request'
    diagram.nodes[1].label = 'NextAuth proxy wrapper'
    diagram.edges[0] = {
      ...diagram.edges[0],
      kind: 'branch',
      label: 'matcher applies the auth wrapper',
      condition: 'auth.user exists and the pathname starts with /dashboard',
    }
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    const edge = edgeGroup(html, 'read')
    const textLines = [...edge.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(
      (match) => match[1],
    )
    // Assert: the complete words occupy the reserved space above the arrow and both node boxes.
    assert.ok(textLines.includes('auth wrapper'))
    assert.ok(textLines.includes('starts with /dashboard'))
    assert.match(edge, /data-from="request" data-to="store"/)
    assert.match(edge, /<path [^>]*><rect [^>]*fill="var\(--bg\)"\/><text /)
    assert.match(edge, /<text x="364" y="61"/)
    assert.match(
      html,
      /<g data-node-id="request">[\s\S]*?>Matched dashboard <\/tspan>[\s\S]*?>request<\/tspan>/,
    )
    assert.match(html, /<g data-node-id="store"><rect x="512"/)
    assert.match(html, /source.ts:1<\/a><pre><code>export const first = 1;/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unbroken diagram identifier keeps every character across bounded SVG lines', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-long-token-')),
  )
  try {
    const manifest = await diagramInput(root),
      diagram = manifest.pages[0].diagrams[0]
    diagram.nodes[0].label = 'RenderPendingResponse'
    diagram.edges[0].label = 'updateInvoiceWithAReallyLongSuffix'
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    const node = html.match(/<g data-node-id="request">[\s\S]*?<\/g>/)[0]
    const edge = edgeGroup(html, 'read')
    const visibleText = (group) =>
      [...group.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(
        (match) => match[1],
      )
    // Assert
    assert.deepEqual(visibleText(node), ['RenderPending', 'Response'])
    assert.equal(
      visibleText(edge).join(''),
      'updateInvoiceWithAReallyLongSuffix',
    )
    assert.ok(visibleText(node).every((line) => [...line].length <= 20))
    assert.ok(visibleText(edge).every((line) => [...line].length <= 22))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('opposite flow arrows have separately readable operation labels', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-return-labels-')),
  )
  try {
    const manifest = await diagramInput(root),
      diagram = manifest.pages[0].diagrams[0]
    diagram.edges.push({
      ...diagram.edges[0],
      id: 'result',
      from: 'store',
      to: 'request',
      kind: 'return',
      label: 'Return result',
    })
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    // Assert: labels use distinct rows while paths keep their opposite endpoints.
    assert.match(
      edgeGroup(html, 'read'),
      /data-from="request" data-to="store"[\s\S]*<text x="364" y="61"[\s\S]*>Read data<\/tspan>/,
    )
    assert.match(
      edgeGroup(html, 'result'),
      /data-from="store" data-to="request"[\s\S]*<text x="364" y="86"[\s\S]*>Return result<\/tspan>/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adjacent flow alternatives keep their label panels separate', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-adjacent-labels-')),
  )
  try {
    const manifest = await diagramInput(root),
      diagram = manifest.pages[0].diagrams[0]
    diagram.nodes.push({ ...diagram.nodes[1], id: 'third', column: 2 })
    diagram.nodes.push({ ...diagram.nodes[1], id: 'fourth', column: 3 })
    diagram.edges = ['store', 'third', 'fourth'].map((to, index) => ({
      ...diagram.edges[0],
      id: `choice-${index}`,
      to,
      label: 'renders route children',
    }))
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    const panels = diagram.edges.map((edge) => {
      const rect = edgeGroup(html, edge.id).match(
        /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/,
      )
      return { left: Number(rect[1]), right: Number(rect[1]) + Number(rect[3]) }
    })
    // Assert: each operation can be read without the next branch's background covering it.
    assert.ok(panels[0].right < panels[1].left)
    assert.ok(panels[1].right < panels[2].left)
    assert.match(
      edgeGroup(html, 'choice-2'),
      /data-from="request" data-to="fourth"/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sequence calls, returns and repeated self calls keep their explicit participants', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-sequence-')),
  )
  try {
    const manifest = await diagramInput(root, 'sequence'),
      diagram = manifest.pages[0].diagrams[0]
    diagram.edges.push({
      ...diagram.edges[0],
      id: 'result',
      from: 'store',
      to: 'request',
      kind: 'return',
      label: 'Result',
    })
    diagram.edges.push({
      ...diagram.edges[0],
      id: 'self',
      to: 'request',
      label: 'Format',
    })
    diagram.edges.push({
      ...diagram.edges[2],
      id: 'self-again',
      label: 'Validate',
    })
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    // Assert
    assert.match(
      edgeGroup(html, 'read'),
      /d="M132 172 H596"[\s\S]*>Read data<\/tspan>/,
    )
    assert.match(
      edgeGroup(html, 'result'),
      /data-from="store" data-to="request"[\s\S]*d="M596 251 H132"[\s\S]*>Result<\/tspan>/,
    )
    assert.match(
      edgeGroup(html, 'self'),
      /data-from="request" data-to="request"[\s\S]*d="M132 330 h100 v34 h-100"/,
    )
    assert.match(
      edgeGroup(html, 'self-again'),
      /d="M132 443 h100 v34 h-100"[\s\S]*>Validate<\/tspan>/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('diagram metadata is escaped and separate graphs cannot share marker or title IDs', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-escape-')),
  )
  try {
    const manifest = await diagramInput(root),
      page = manifest.pages[0]
    page.diagrams[0].id = 'a'
    page.diagrams[0].title = '<script>title</script>'
    page.diagrams[0].caption = 'One & two'
    page.diagrams.push({
      ...page.diagrams[0],
      id: 'a-title',
      title: 'Other graph',
      edges: [],
    })
    page.contentHtml =
      '<h2 id="flow">Source flow</h2><figure data-codebook-diagram="a"></figure><figure data-codebook-diagram="a-title"></figure>'
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    // Assert
    assert.match(
      html,
      /<title id="codebook-diagram-1-a-title">&lt;script&gt;title&lt;\/script&gt;<\/title>/,
    )
    assert.match(html, /<figcaption>One &amp; two<\/figcaption>/)
    assert.equal(new Set(ids).size, ids.length)
    assert.doesNotMatch(html, /data-codebook-diagram=/)
    assert.equal((html.match(/data-edge-id="read"/g) ?? []).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('repeated self relations in a flow have separate labeled paths', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-loops-')),
  )
  try {
    const manifest = await diagramInput(root),
      diagram = manifest.pages[0].diagrams[0]
    diagram.edges[0].to = 'request'
    diagram.edges.push({
      ...diagram.edges[0],
      id: 'retry',
      label: 'Retry read',
    })
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    // Assert
    assert.match(edgeGroup(html, 'read'), /C316 76.25 316 98.75 216 98.75/)
    assert.match(
      edgeGroup(html, 'retry'),
      /C584 76.25 584 98.75 216 98.75[\s\S]*>Retry read<\/tspan>/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const invalidDiagramCases = [
  [
    'an unknown node',
    (diagram) => {
      diagram.edges[0].to = 'missing'
    },
    /unknown node/,
  ],
  [
    'duplicate node IDs',
    (diagram) => {
      diagram.nodes[1].id = 'request'
    },
    /node IDs/,
  ],
  [
    'duplicate edge IDs',
    (diagram) => {
      diagram.edges.push(diagram.edges[0])
    },
    /edge IDs/,
  ],
  [
    'a missing pending condition',
    (diagram) => {
      diagram.edges[0].kind = 'pending'
    },
    /edge condition/,
  ],
  [
    'a misspelled operation field',
    (diagram) => {
      diagram.edges[0].operation = 'ignored'
    },
    /edge fields/,
  ],
  [
    'an unsupported relationship',
    (diagram) => {
      diagram.edges[0].kind = 'invented'
    },
    /relationship kind/,
  ],
  [
    'overlapping flow nodes',
    (diagram) => {
      diagram.nodes[1].column = 0
    },
    /same grid cell/,
  ],
  [
    'a fractional grid position',
    (diagram) => {
      diagram.nodes[1].row = 0.5
    },
    /integer row/,
  ],
  [
    'a negative grid position',
    (diagram) => {
      diagram.nodes[1].row = -1
    },
    /integer row/,
  ],
  [
    'an out-of-bounds grid position',
    (diagram) => {
      diagram.nodes[1].column = 8
    },
    /integer row/,
  ],
  [
    'a missing source quote',
    (diagram) => {
      delete diagram.edges[0].sources[0].quote
    },
    /source quote/,
  ],
  [
    'an unindexed diagram source',
    (diagram) => {
      diagram.edges[0].sources[0].path = 'other.ts'
    },
    /unindexed source/,
  ],
  [
    'a quote from a different line',
    (diagram) => {
      diagram.edges[0].sources[0].line = 2
      diagram.edges[0].sources[0].endLine = 2
    },
    /source quote does not match source.ts:2-2/,
  ],
  [
    'a source range beyond the file',
    (diagram) => {
      diagram.edges[0].sources[0].endLine = 3
    },
    /out of range/,
  ],
  [
    'an unsafe diagram ID',
    (diagram) => {
      diagram.id = 'a"b'
    },
    /unique id/,
  ],
  [
    'too many edges',
    (diagram) => {
      diagram.edges = Array(65).fill(diagram.edges[0])
    },
    /24 nodes and 64 edges/,
  ],
]
for (const [label, invalidate, error] of invalidDiagramCases) {
  test(`diagram publication rejects ${label} and preserves the readable Wiki`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-diagram-invalid-')),
    )
    const output = join(root, '.codebook/wiki'),
      stage = join(root, '.codebook/diagram-stage')
    try {
      const manifest = await diagramInput(root)
      invalidate(manifest.pages[0].diagrams[0])
      await mkdir(output, { recursive: true })
      await mkdir(stage)
      await writeFile(join(output, 'index.html'), 'Last readable site')
      await writeFile(join(output, 'manual.txt'), 'Keep this note')
      await writeFile(
        join(stage, 'codebook-wiki.json'),
        JSON.stringify(manifest),
      )
      // Act / Assert
      await assert.rejects(
        publishWiki({
          projectRoot: root,
          outputDirectory: output,
          stageDirectory: stage,
        }),
        error,
      )
      assert.equal(
        await readFile(join(output, 'index.html'), 'utf8'),
        'Last readable site',
      )
      assert.equal(
        await readFile(join(output, 'manual.txt'), 'utf8'),
        'Keep this note',
      )
      await assert.rejects(access(`${output}.publish-journal.json`))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('diagram quotes preserve an inclusive multiline range from a CRLF source file', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-quote-lines-')),
  )
  try {
    const manifest = await diagramInput(root),
      source = 'export const first = 1;\r\nexport const second = 2;'
    await writeFile(join(root, 'source.ts'), source)
    manifest.includedSources[0].sha256 = createHash('sha256')
      .update(source)
      .digest('hex')
    manifest.pages[0].diagrams[0].edges[0].sources[0] = {
      path: 'source.ts',
      line: 1,
      endLine: 2,
      quote: 'export const first = 1;\nexport const second = 2;',
    }
    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')
    // Assert
    assert.match(
      html,
      /source.ts:1–2<\/a><pre><code>export const first = 1;\nexport const second = 2;<\/code>/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const [label, content, error] of [
  ['missing slot', '<h2 id="flow">Flow</h2>', /exactly one empty figure slot/],
  [
    'duplicate slot',
    '<h2 id="flow">Flow</h2><figure data-codebook-diagram="flow"></figure><figure data-codebook-diagram="flow"></figure>',
    /exactly one empty figure slot/,
  ],
  [
    'wrong slot ID',
    '<h2 id="flow">Flow</h2><figure data-codebook-diagram="other"></figure>',
    /match exactly once/,
  ],
  [
    'nonempty slot',
    '<h2 id="flow">Flow</h2><figure data-codebook-diagram="flow">Old graph</figure>',
    /empty figure slot/,
  ],
  [
    'commented-out slot',
    '<h2 id="flow">Flow</h2><!-- <figure data-codebook-diagram="flow"></figure> -->',
    /inside HTML comments/,
  ],
  [
    'old authored SVG',
    '<h2 id="flow">Flow</h2><svg><text>Old label</text></svg>',
    /instead of authored SVG/,
  ],
]) {
  test(`reader refuses a ${label} instead of dropping or duplicating a diagram`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-diagram-slot-')),
    )
    try {
      const manifest = await diagramInput(root)
      manifest.pages[0].contentHtml = content
      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        error,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

// Value: protects=the rule that a page handed in as an article holds no document, form, script or authored SVG, which the publisher checks on the raw text of the page on purpose; fails_when=the check starts to skip comments or attribute values, so that a place it takes for a comment where a browser reads none could hide a real element from it, or the rule changes unnoticed in the other direction; why_new=Cycle 0046 row 192 (the rule was decided and is stated at the check; this pins it); seam=none
for (const [place, content, sentence] of [
  [
    'a comment that shows a script',
    '<h2 id="flow">Source flow</h2><!-- <script>track()</script> -->',
    'Wiki page index.html must contain article sections, not a document, form or script: it holds <script>.',
  ],
  [
    'an attribute value that shows a form',
    '<h2 id="flow">Source flow</h2><p title="put it into a <form> element">Where the question goes.</p>',
    'Wiki page index.html must contain article sections, not a document, form or script: it holds <form>.',
  ],
  [
    'a comment that shows authored SVG',
    '<h2 id="flow">Source flow</h2><!-- <svg><text>An old graph</text></svg> -->',
    'Wiki page index.html must use diagram records and figure slots instead of authored SVG.',
  ],
])
  test(`a page with ${place} is refused like a page that holds the element: the publisher reads the page as raw text`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-raw-text-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = content

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        { message: sentence },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the reader's origin, whose page may ask the editor's model, against markup an agent writes into a page's content when a repository's text steers it; fails_when=the publisher refuses script elements but accepts an event attribute or an address a browser runs as script (or one that a character reference, a tab or a number without its semicolon turns into one), so the published page runs script on the reader's origin or when opened from disk, or accepts an editor address that is not Codebook's own (another extension's URI handler, the editor's file handler), or an address that starts with two slashes or backslashes in any mix, which a page opened from disk on Windows reads as a network path (`file://host/…`), so an image fetches it over SMB without a click and may send the learner's NTLM credentials; why_new=Cycle 0046 /ship finding F2 (security, verified): render-wiki.mjs refused `<script>` and the like but no event attribute and no `javascript:` address; repeat review SC4: any vscode: or cursor: address was accepted; adversarial review AD5: `//host/x`, `\\host\share\x` and `/\host/x` were accepted as relative paths; seam=none
for (const [form, content, sentence] of [
  [
    'an event attribute on an image',
    '<h2 id="flow">Source flow</h2><p><img src="flow.png" alt="Flow" onerror="fetch(\'api/ask\')"></p>',
    'Wiki page index.html must contain article sections, not a document, form or script: its <img> holds the event attribute onerror.',
  ],
  [
    'an event attribute in capitals without quotes',
    '<h2 id="flow" ONCLICK=run()>Source flow</h2>',
    'Wiki page index.html must contain article sections, not a document, form or script: its <h2> holds the event attribute onclick.',
  ],
  [
    'a javascript: link',
    '<h2 id="flow">Source flow</h2><p><a href="javascript:run()">Run</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="javascript:run()".',
  ],
  [
    'a javascript: link in capitals with a tab and a space before it',
    '<h2 id="flow">Source flow</h2><p><a href=" JAVA&#9;SCRIPT:run()">Run</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href=" JAVA&#9;SCRIPT:run()".',
  ],
  [
    'a link whose colon is a named character reference',
    '<h2 id="flow">Source flow</h2><p><a href="javascript&colon;run()">Run</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="javascript&colon;run()".',
  ],
  [
    'a link whose colon is a number without its semicolon',
    '<h2 id="flow">Source flow</h2><p><a href="javascript&#58run()">Run</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="javascript&#58run()".',
  ],
  [
    'a data: address among the candidates of a srcset',
    '<h2 id="flow">Source flow</h2><p><img src="flow.png" srcset="flow.png 1x, data:image/svg+xml,x 2x" alt="Flow"></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <img> holds srcset="flow.png 1x, data:image/svg+xml,x 2x".',
  ],
  [
    'a button that submits the reader’s form to a javascript: address',
    '<h2 id="flow">Source flow</h2><p><button form="qa-form" formaction="javascript:run()">Ask</button></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <button> holds formaction="javascript:run()".',
  ],
  [
    'an xlink:href to a data: address',
    '<h2 id="flow">Source flow</h2><p><a xlink:href="data:text/html,x">Run</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds xlink:href="data:text/html,x".',
  ],
  [
    'an image from a file: address',
    '<h2 id="flow">Source flow</h2><p><img src="file:///etc/hosts" alt="Hosts"></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <img> holds src="file:///etc/hosts".',
  ],
  [
    'a vscode: address of the editor’s file handler',
    '<h2 id="flow">Source flow</h2><p><a href="vscode://file/etc/hosts">Hosts</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="vscode://file/etc/hosts".',
  ],
  [
    'a cursor: address of another extension’s URI handler',
    '<h2 id="flow">Source flow</h2><p><a href="cursor://other.extension/run?task=1">Run</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="cursor://other.extension/run?task=1".',
  ],
  [
    'a vscode: address whose authority only starts with Codebook’s',
    '<h2 id="flow">Source flow</h2><p><a href="vscode://laststance.codebook.evil/source">Source</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="vscode://laststance.codebook.evil/source".',
  ],
  [
    'an image whose address is a network share written with two backslashes',
    '<h2 id="flow">Source flow</h2><p><img src="\\\\attacker.example\\share\\x.png" alt=""></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <img> holds src="\\\\attacker.example\\share\\x.png".',
  ],
  [
    'a link whose address starts with two slashes',
    '<h2 id="flow">Source flow</h2><p><a href="//attacker.example/x">Notes</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href="//attacker.example/x".',
  ],
  [
    'an image whose address starts with a slash and a backslash',
    '<h2 id="flow">Source flow</h2><p><img src="/\\attacker.example/x.png" alt=""></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <img> holds src="/\\attacker.example/x.png".',
  ],
  [
    'a link whose address starts with a backslash and a slash after a space',
    '<h2 id="flow">Source flow</h2><p><a href=" \\/attacker.example/x">Notes</a></p>',
    'Wiki page index.html must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <a> holds href=" \\/attacker.example/x".',
  ],
])
  test(`a page with ${form} is refused with the sentence that names the element and its attribute`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-scripting-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = content

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        { message: sentence },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the learner who opens a published page from disk, where no reader sends a Content-Security-Policy; fails_when=the page carries no policy of its own, so an event attribute or a javascript: address its content holds (a page published before the publisher refused them, or edited by hand) runs, or the policy does not name the hash of the shell's own script, so the theme button and the offline question note stop working; why_new=Cycle 0046 /ship follow-up N5 (finding F2's offline side); seam=none
test('a published page carries a Content-Security-Policy that lets only the shell’s own script run, by its hash, before anything of its content', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-page-policy-')),
  )
  try {
    const manifest = await readerInput(root)

    // Act
    const pages = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    })

    // Assert: the policy stands in the head, before the title and the article, and the shell's one script is the one its hash names.
    const page = pages.get('index.html')
    const shellScript = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
    assert.deepEqual(
      {
        head: page.slice(0, page.indexOf('<title>')),
        scriptHash: createHash('sha256').update(shellScript).digest('base64'),
        scripts: page.match(/<script\b/g)?.length,
      },
      {
        head: "<!doctype html>\n<html lang=\"en\" data-codebook-reader=\"2\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data: file:; media-src 'self' file:; style-src 'self' 'unsafe-inline' file:; font-src 'self' file:; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'\">\n",
        scriptHash: 'yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=',
        scripts: 1,
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the theme button and the offline note of every page published from a Windows checkout with core.autocrlf=true, or from a VSIX packaged from one, where the reader shell has CRLF line endings; fails_when=the publisher hashes and writes the shell's script with its CRLF bytes, while a browser's HTML parser reads every CRLF and lone CR as LF before a Content-Security-Policy hashes an inline script, so the page's own policy names a hash that matches nothing and the shell's script is blocked, opened from disk and under the reader alike, and the reader's known hash no longer names it either; why_new=Cycle 0046 /ship Codex structured review CX5 (P2); seam=a copy of the page renderer whose `node:fs/promises` reads the reader shell with CRLF line endings, by the loader hook of scripts/tests/utils/markedCopyHooks.mjs (`?crlf-shell`)
test('a page rendered from a reader shell with CRLF line endings is written with LF line endings, and its policy names the hash of its script as a browser reads it, the known one', async () => {
  // Arrange: a copy of the page renderer that reads the shell as a Windows checkout with core.autocrlf=true holds it.
  const { renderWikiPages: renderFromCrlfShell } = await loadMarkedCopy(
    'render-wiki.mjs',
    '?crlf-shell',
  )
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-crlf-shell-')),
  )
  try {
    const manifest = await readerInput(root)

    // Act
    const page = (
      await renderFromCrlfShell(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert: no carriage return anywhere in the page, the policy in the head, and the script the policy names as a browser hashes it.
    const shellScript = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
    assert.deepEqual(
      {
        hasCarriageReturn: page.includes('\r'),
        policy:
          /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(
            page,
          )?.[1],
        scriptHash: createHash('sha256').update(shellScript).digest('base64'),
      },
      {
        hasCarriageReturn: false,
        policy:
          "default-src 'none'; img-src 'self' data: file:; media-src 'self' file:; style-src 'self' 'unsafe-inline' file:; font-src 'self' file:; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'",
        scriptHash: 'yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=',
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the links and images an article is written with, which the refusal of script must not take; fails_when=the check refuses a relative path, a fragment, a web, mail or editor address, a Codebook address whose scheme and authority are written in another case (a browser compares them without case), a path with an ampersand that begins no reference, or reads an escaped code example or a comment as markup; why_new=Cycle 0046 /ship finding F2: the new refusal reads start tags and addresses; repeat testing review TC7: no test held the comparison without case; seam=none
test('a page that links to a relative path, a fragment, a web, mail or editor address, and shows an event attribute and a javascript: link only as escaped text or in a comment, is published as authored', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-addresses-')),
  )
  const content =
    '<h2 id="flow">Source flow</h2>' +
    '<p><a href="pages/a&amp;b.html#start">A page</a> <a href="#flow">Up</a> <a href="../outside.html">Out</a> ' +
    '<a href="https://example.com/?a=1&amp;b=2#c">Web</a> <a href="mailto:team@example.com">Mail</a> ' +
    '<a href="vscode://laststance.codebook/source?root=%2Frepo">VS Code</a> <a href="cursor://laststance.codebook/source?root=%2Frepo">Cursor</a> ' +
    '<a href="VSCode://LastStance.Codebook/source?path=a.ts">VS Code in another case</a> ' +
    '<img src="flow.png" srcset="flow.png 1x, flow@2x.png 2x" alt="Flow"></p>' +
    '<pre><code>&lt;img onerror="run()"&gt; &lt;a href="javascript:run()"&gt;</code></pre>' +
    '<!-- <a href="javascript:run()" onclick="run()">old</a> -->'
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml = content

    // Act: the article as published, or the refusal.
    const published = await renderWikiPages(manifest, {
      projectRoot: root,
      outputDirectory: join(root, '.codebook/wiki'),
    }).then(
      (pages) =>
        /<\/details>(.*)<\/article>/.exec(pages.get('index.html'))?.[1],
      (error) => error.message,
    )

    // Assert
    assert.equal(published, content)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a page that uses a custom element whose name starts with the name of an element a page must not hold; fails_when=the check takes the hyphen for the end of the name again, so `<link-card>`, `<main-nav>`, `<template-part>` or `<svg-icon>` is refused as a link, a main, a template or authored SVG; why_new=Cycle 0046 row 207 (the names ended at a word boundary, and a hyphen is one); seam=none
test('a page with custom elements whose names start with the name of an element a page must not hold is published: a name is matched whole', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-custom-element-')),
  )
  try {
    const manifest = await readerInput(root)
    const content =
      '<h2 id="flow">Source flow</h2><link-card>A card</link-card><main-nav>Parts</main-nav><template-part>One part</template-part><svg-icon></svg-icon>'
    manifest.pages[0].contentHtml = content

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.ok(html.includes(content))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the rule that a page holds no document part, link or authored SVG, however the tag goes on after its name; fails_when=matching a name whole lets through a tag whose name is followed by a slash, a line end or the tag's end; why_new=Cycle 0046 row 207; seam=none
for (const [element, sentence] of [
  [
    '<main>',
    'Wiki page index.html must contain article sections, not a document, form or script: it holds <main>.',
  ],
  [
    '<link/>',
    'Wiki page index.html must contain article sections, not a document, form or script: it holds <link>.',
  ],
  [
    '<svg\nwidth="10">',
    'Wiki page index.html must use diagram records and figure slots instead of authored SVG.',
  ],
])
  test(`a page that holds ${JSON.stringify(element)} is still refused: the name is whole there`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-whole-name-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = `<h2 id="flow">Source flow</h2>${element}`

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        { message: sentence },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the agent's way from the refusal to the place in a long page; fails_when=the refusal for an element a page must not hold no longer names the element it found, so the agent has to search the page for two dozen names, or names another than the first one, or copies the page's capitals or the slash of an end tag into the name; why_new=Cycle 0046 row 205 (the sentence named the page alone); seam=none
test('the refusal for an element a page must not hold names the first one it found, in small letters and without the slash of an end tag', async () => {
  // Arrange: a page whose first such tag is the end tag of a form in capitals inside a comment, with a template after it; and a page that holds a meta element.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-names-element-')),
  )
  try {
    const endTagInCapitals = await readerInput(root)
    endTagInCapitals.pages[0].contentHtml =
      '<h2 id="flow">Source flow</h2><!-- </FORM> --><template></template>'
    const metaElement = await readerInput(root)
    metaElement.pages[0].contentHtml =
      '<h2 id="flow">Source flow</h2><meta charset="utf-8">'

    // Act
    const refusals = []
    for (const manifest of [endTagInCapitals, metaElement])
      refusals.push(
        await renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }).then(
          () => 'published',
          (error) => error.message,
        ),
      )

    // Assert
    assert.deepEqual(refusals, [
      'Wiki page index.html must contain article sections, not a document, form or script: it holds <form>.',
      'Wiki page index.html must contain article sections, not a document, form or script: it holds <meta>.',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a page that writes about such elements in an escaped code example, as the bundled skill asks for source code; fails_when=the raw-text check takes escaped text for a tag, so an article about a form or a script can no longer be published; why_new=Cycle 0046 row 192; seam=none
test('a page that shows a form, a script and authored SVG as escaped text is published with the text as authored', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-escaped-text-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id="flow">Source flow</h2><pre><code>&lt;form&gt;&lt;script&gt;send()&lt;/script&gt;&lt;/form&gt;&lt;svg&gt;&lt;/svg&gt;</code></pre>'

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.ok(
      html.includes(
        '<h2 id="flow">Source flow</h2><pre><code>&lt;form&gt;&lt;script&gt;send()&lt;/script&gt;&lt;/form&gt;&lt;svg&gt;&lt;/svg&gt;</code></pre>',
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a published page, on whose tags and ids the publisher and a browser must agree: the publisher follows a browser's reading of markup by a pattern, which holds only for markup written plainly; fails_when=a page is published although a `<` of its content begins something a browser reads by other rules (a `<?` or `<!` that is no comment, a CDATA section, a quotation mark that is no attribute's value, a tag or a quoted value that never ends, a bare value with a character a browser takes for an error, an end tag with an attribute, an attribute named twice, an id written with a character reference the publisher does not read), so an id of the reader could stand twice unseen, an outline entry could lead nowhere, or the rest of the page could be taken into an attribute; why_new=Cycle 0046 row 206 (the class of rows 134, 184, 193 and 194, closed by refusing what is not read exactly; it replaces row 193's allowance of a `<` in a bare attribute value); seam=none
for (const [what, markup, place] of [
  [
    'a `<?` that a browser reads as a comment up to the next `>`',
    '<? <b <h3 id="after">After</h3>',
    '<? <b <h3 id="after">After</h3>',
  ],
  ['a `<!` that is no comment', '<!x <b>', '<!x <b>'],
  [
    'a CDATA section',
    '<math><![CDATA[<h3 id="inside">Inside</h3>]]></math>',
    '<![CDATA[<h3 id="inside">Inside</h3>]]><',
  ],
  [
    'a quotation mark that is no attribute’s value',
    '<p a"b>The text says id=fake here" </p>',
    '<p a"b>The text says id=fake here" </p>',
  ],
  [
    'a quoted attribute value that never ends',
    '<a href="pages/details.html>More</a>',
    '<a href="pages/details.html>More</a>',
  ],
  [
    'a bare attribute value that holds a `<`',
    '<p title=<!-- >A note</p><h3 id="qa-form">The form</h3>',
    '<p title=<!-- >A note</p><h3 id="qa-form',
  ],
  [
    'a bare attribute value that holds an `=`',
    '<p title=a=b>A note</p>',
    '<p title=a=b>A note</p>',
  ],
  ['an end tag with an attribute', '<p>A note</p id="note">', '</p id="note">'],
  [
    'a tag that never ends',
    '<p>A note</p><div class="more"',
    '<div class="more"',
  ],
  [
    'an attribute named twice',
    '<h3 id="note" id="qa-form">A note</h3>',
    '<h3 id="note" id="qa-form">A note</h3>',
  ],
  [
    'an id written with a character reference without its semicolon',
    '<h3 id="qa&#45form">The form</h3>',
    '<h3 id="qa&#45form">The form</h3>',
  ],
  [
    'an id written with a named character reference the publisher does not read',
    '<p id="a&lowbar;b">A note</p>',
    '<p id="a&lowbar;b">A note</p>',
  ],
  [
    'an id that ends with a name of the references without its semicolon',
    '<p id="read&amp">A note</p>',
    '<p id="read&amp">A note</p>',
  ],
])
  test(`a page with ${what} is refused with the sentence that names the place and says what to write`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-read-exactly-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = `<h2 id="flow">Source flow</h2>${markup}`

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        {
          message: `Wiki page index.html has markup the publisher cannot read exactly as a browser does; write a < of the text as &lt;, close every tag and every quotation mark, quote an attribute value, name an attribute once and write an id as plain text, with & as &amp;; it starts: ${place}`,
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the ids the publisher reads in a tag that holds a space character a browser does not separate at; fails_when=the publisher separates a tag's name and attributes at every character JavaScript calls white space, so for `<h2\u00a0id="ghost">` it reads an id where a browser reads a tag named `h2\u00a0id="ghost"` without one, and an outline entry for that id is accepted and leads nowhere; why_new=Cycle 0046 row 234 (the patterns used JavaScript's white space class); seam=none
test('a tag whose name is followed by a no-break space is refused: a browser separates a tag at tab, line feed, form feed, carriage return and space alone', async () => {
  // Arrange: a heading whose id follows a no-break space, named by the outline; and the same heading with a form feed there, which a browser does separate at.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-tag-space-')),
  )
  try {
    const withNoBreakSpace = await readerInput(root)
    withNoBreakSpace.pages[0].contentHtml = '<h2\u00a0id="ghost">A ghost</h2>'
    withNoBreakSpace.pages[0].outline = [{ id: 'ghost', label: 'A ghost' }]
    const withFormFeed = await readerInput(root)
    withFormFeed.pages[0].contentHtml = '<h2\fid="real">A heading</h2>'
    withFormFeed.pages[0].outline = [{ id: 'real', label: 'A heading' }]

    // Act
    const outcomes = []
    for (const manifest of [withNoBreakSpace, withFormFeed])
      outcomes.push(
        await renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }).then(
          (pages) =>
            pages.get('index.html').includes('<a href="#real">A heading</a>'),
          (error) => error.message,
        ),
      )

    // Assert
    assert.deepEqual(outcomes, [
      'Wiki page index.html has markup the publisher cannot read exactly as a browser does; write a < of the text as &lt;, close every tag and every quotation mark, quote an attribute value, name an attribute once and write an id as plain text, with & as &amp;; it starts: <h2\u00a0id="ghost">A ghost</h2>',
      true,
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the reader's question form, its rail and its layout on a page whose content leaves an element open or closes one too many; fails_when=the publisher publishes content that is not balanced, so a table left open takes the question form's field and button out of the form and the rail into the article, an end tag too many closes the reader's layout, and a link or an emphasis left open is opened again around everything after the article; why_new=Cycle 0046 row 233 (the publisher read tags and not which elements are open); seam=none
test('a page whose content leaves a table or an inline element open, or closes a div it did not open, is refused with the tag and what to do', async () => {
  // Arrange: the three pages of the review, the third with each of its inline elements.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-unbalanced-')),
  )
  try {
    const contents = [
      '<h2 id="flow">Source flow</h2><table><tr><td>cell</td></tr>',
      '<h2 id="flow">Source flow</h2><div><p>x</p></div></div><p>After the section.</p>',
      '<h2 id="flow">Source flow</h2><p>Explained.</p><a href="#flow">A link',
      '<h2 id="flow">Source flow</h2><p>Explained with <strong>emphasis.</p>',
      '<h2 id="flow">Source flow</h2><p>Explained with <code>code',
    ]

    // Act
    const messages = []
    for (const contentHtml of contents) {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = contentHtml
      messages.push(
        await renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }).then(
          () => 'published',
          (error) => error.message,
        ),
      )
    }

    // Assert
    assert.deepEqual(messages, [
      "Wiki page index.html opens <table> and never closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html has </div> without a <div> it opens; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <a> and never closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <strong> and does not close it before </p>; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <code> and never closes it; close every element inside the page's content, the last opened first.",
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the reader's layout on a page whose every start tag has an end tag, but in an order a browser does not keep; fails_when=the publisher counts tags instead of following which element is open, so it publishes elements closed out of order, or an element that a browser closes by force at a list item, a button, a link, a heading or a table inside it, whose own end tag then closes the reader's layout or whose id then stands twice in the page; why_new=Cycle 0046 row 233 (found by comparing the rule with the browser's own parser on generated pages); seam=none
test('a page whose elements are closed out of order, or which a browser would close by force at a list item, a button, a link, a heading or a table, is refused with the element left open and the tag it is open at', async () => {
  // Arrange: in each content every start tag has its end tag.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-out-of-order-')),
  )
  try {
    const contents = [
      '<h2 id="flow">Source flow</h2><p><b><i>x</b></i></p>',
      '<h2 id="flow">Source flow</h2><ul><li><div>a<li>b</div></ul>',
      '<h2 id="flow">Source flow</h2><button type="button"><span>a<button type="button">b</button></span></button>',
      '<h2 id="flow">Source flow</h2><table><tr><table><tr><td>x</td></tr></table></tr></table>',
      '<h2 id="flow">Source flow</h2><table><tr><td><div>a<tr><td>b</div></table>',
      '<h2 id="flow">Source flow</h2><math><mrow><mi>x</mi></math>',
      '<h2 id="flow">Source flow</h2><p><a href="#flow" id="more">More <span>with <a href="#flow">a link inside</a></span></a></p>',
      '<h2 id="flow">Source flow<h3>A part</h3></h2>',
    ]

    // Act
    const messages = []
    for (const contentHtml of contents) {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = contentHtml
      messages.push(
        await renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }).then(
          () => 'published',
          (error) => error.message,
        ),
      )
    }

    // Assert
    assert.deepEqual(messages, [
      "Wiki page index.html opens <i> and does not close it before </b>; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <div> and does not close it before <li>, where a browser closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <button> and does not close it before <button>, where a browser closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <table> and does not close it before <table>, where a browser closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <div> and does not close it before <tr>, where a browser closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <mrow> and does not close it before </math>; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <a> and does not close it before <a>, where a browser closes it; close every element inside the page's content, the last opened first.",
      "Wiki page index.html opens <h2> and does not close it before <h3>, where a browser closes it; close every element inside the page's content, the last opened first.",
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the reader's layout on a page that writes an HTML block in the markup of mathematics; fails_when=the publisher takes everything between <math> and </math> for nested markup, while a browser ends the mathematics at an HTML start tag such as <li> or <div> and reads it in the page around it, where a list item closes a div by force and that div's own end tag then closes the reader's layout; or it takes an element a page names `mi` outside mathematics for the boundary that a text element of mathematics is; why_new=Cycle 0046 row 233 (found while checking the rule against the parsing rules of mathematics); seam=none
test('an HTML element in the markup of mathematics, where a browser ends the mathematics, is refused; in a text element of mathematics it is published', async () => {
  // Arrange: a list item in the markup of mathematics; the same nesting with an element named `mi` and no mathematics; and HTML inside `mtext`, with a line break as HTML has it and a paragraph that does not end the one around the mathematics.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-math-')),
  )
  try {
    const contents = [
      '<h2 id="flow">Source flow</h2><ul><li><div><math><li>x</li></math></div></li></ul>',
      '<h2 id="flow">Source flow</h2><ul><li><div><mi><li>x</li></mi></div></li></ul>',
      '<h2 id="flow">Source flow</h2><p>With <math><mrow><mtext>a <b>bold</b> word<br><p>and a paragraph</p></mtext><mi>x</mi></mrow></math></p>',
    ]

    // Act
    const outcomes = []
    for (const contentHtml of contents) {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = contentHtml
      outcomes.push(
        await renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }).then(
          (pages) => pages.get('index.html').includes(contentHtml),
          (error) => error.message,
        ),
      )
    }

    // Assert
    assert.deepEqual(outcomes, [
      'Wiki page index.html has <li> inside <math> outside its text; inside mathematics write HTML elements only in <mi>, <mo>, <mn>, <ms> or <mtext>.',
      "Wiki page index.html opens <div> and does not close it before <li>, where a browser closes it; close every element inside the page's content, the last opened first.",
      true,
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=an outline entry that names a table part written outside a table; fails_when=the publisher reads `<td id="part">` outside a table as an element with that id, which a browser drops when it builds the page, so the outline entry is accepted and leads nowhere, and the dropped part counts as a boundary that hides an element left open behind it; why_new=Cycle 0046 row 233 (the first line of the limit stated with row 215); seam=none
test('a table part outside a table is refused: a browser drops its tag, so an outline entry for its id would lead nowhere', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-table-part-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id="flow">Source flow</h2><td id="part">A cell</td>'
    manifest.pages[0].outline = [{ id: 'part', label: 'A cell' }]

    // Act / Assert
    await assert.rejects(
      renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }),
      {
        message:
          "Wiki page index.html has <td> outside a table; write a table's parts inside a <table>.",
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=pages written the way HTML allows, without the end tags of paragraphs, list items, description terms and details, table parts, options and the parts of a ruby, and with void elements, mathematics and an element of any name; fails_when=the balance rule asks for an end tag HTML lets an author leave out, takes a void element for an open one, or closes inside a table cell or a nested list what belongs to the table or list around it, so the publisher refuses a page a browser builds exactly as written; why_new=Cycle 0046 row 233 (the rule may refuse no page that is balanced); seam=none
test('a page that leaves out the end tags HTML lets an author leave out is published as written, with void elements, nested lists and tables, and mathematics', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-optional-end-tags-')),
  )
  try {
    const manifest = await readerInput(root)
    const contentHtml =
      '<h2 id="flow">Source flow</h2>' +
      '<p>one<p>two<ul><li>a<li>b<p>c<ul><li>inner</ul><li>d</ul>' +
      '<dl><dt>term<dd>detail<dt>second term<dd>second detail</dl>' +
      '<table><caption>Calls<colgroup><col><col><thead><tr><th>from<th>to<tbody><tr><td>a<td>b<tr><td>c<td><p>d<table><tr><td>inner</table></table>' +
      '<div><p>with <a href="#flow"><strong>a link</strong> and <code>code</code></a><br><img src="assets/a.png" alt="A"><image src="assets/b.png" alt="B"><hr></div>' +
      '<blockquote><p>quoted</blockquote><details><summary>More</summary><p>detail</details>' +
      '<ruby>漢<rp>(<rt>kan<rp>)</ruby><button type="button">Go</button>' +
      '<datalist id="names"><option value="a"><option value="b"></datalist>' +
      '<constructor>an element of a name JavaScript objects have</constructor>' +
      '<math><mrow><mi>x</mi><mo>+</mo><mspace width="1em"/><mn>1</mn></mrow></math>' +
      '<p>the last paragraph'
    manifest.pages[0].contentHtml = contentHtml

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.equal(html.includes(contentHtml), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=an id that holds an ampersand which begins no character reference, as a section about "R&D" may have; fails_when=the publisher refuses such an id although it and a browser read the same text, and tells the author to write as plain text what is plain text; why_new=Cycle 0046 row 236 (every ampersand before a letter, a digit or `#` was refused); seam=none
test('an id with an ampersand that begins no character reference is published as authored: before one letter, a digit, another character or the id’s end', async () => {
  // Arrange: no name of a browser's table of references has one character or begins with a digit, and `&#` begins a number only before a digit.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-ampersand-id-')),
  )
  try {
    const manifest = await readerInput(root)
    const content =
      '<h2 id="flow">Source flow</h2><p id="q&a">One</p><p id="R&D">Two</p><p id="a&1b">Three</p>' +
      '<p id="x&-y">Four</p><p id="a&#b">Five</p><p id="a&#xg">Six</p><p id="end&">Seven</p>'
    manifest.pages[0].contentHtml = content

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.ok(html.includes(content))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the markup an article is written in, which the rule above must not refuse; fails_when=the publisher refuses a `<` that is text for a browser (before a space, a digit or the page's end), a tag with a slash before its end, a bare attribute value, an attribute directly after a closing quote, an ampersand in an address, an id written with `&amp;` or a numeric reference, a custom element, or mathematics with an id inside, whose id it must read and rename like any other; why_new=Cycle 0046 row 206 (the rule was run over the 104 pages of the real Wikis on this machine first and refused none); seam=none
test('a page whose every < is text, a comment that ends, an end tag or a plainly written start tag is published as authored, and an id inside mathematics is read like any other', async () => {
  // Arrange: the forms an article uses, and a mathematics element one of whose parts carries an id of the reader.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-read-exactly-ok-')),
  )
  try {
    const manifest = await readerInput(root)
    const authored =
      '<h2 class="title"id="flow">Source flow</h2><p>When a < b and 1 <2, see <!-- a note --> the list.</p>' +
      '<p data-level=2 title=\'it says "a > b"\'>A line<br/>and <img src=pages/a.png alt="A figure" /> a figure.</p>' +
      '<p id="read&amp;write"><a href="pages/details.html?from=overview&part=2#more">More</a> <code-sample language=ts>let a</code-sample></p>' +
      '<math><mi id="qa-form">x</mi></math><p>The end <'
    manifest.pages[0].contentHtml = authored
    manifest.pages.push({
      path: 'pages/details.html',
      title: 'Details',
      section: 'Guide & concepts',
      contentHtml: '<h2 id="more">More</h2><p>Explained from source.</p>',
      sources: [{ path: 'source.ts', line: 1 }],
      outline: [{ id: 'more', label: 'More' }],
    })

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert: everything as authored, but for the id of the reader inside the mathematics, which is renamed.
    assert.ok(
      html.includes(
        authored.replace(
          '<mi id="qa-form">x</mi>',
          '<mi id="page-qa-form">x</mi>',
        ),
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=the reader's own controls and the publisher's reading of a page that holds a select element; fails_when=a select is published: a browser drops or rearranges tags inside it by rules of its own, so an id the publisher reads there may be no element; why_new=Cycle 0046 row 206; seam=none
test('a page that holds <select> is refused like a page that holds a form or a script', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-select-')),
  )
  try {
    const manifest = await readerInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id="flow">Source flow</h2><select><option>One</option></select>'

    // Act / Assert
    await assert.rejects(
      renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }),
      {
        message:
          'Wiki page index.html must contain article sections, not a document, form or script: it holds <select>.',
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a published page, whose tags and ids the publisher and a browser must read alike, and the reader's own form, rail and script after the article; fails_when=a page with an element whose content a browser reads as text (or keeps out of the document, as a template's) is published: the publisher reads tags in that content that are none, and one such element that is never closed takes everything after it; why_new=Cycle 0046 row 193; seam=none
for (const [name, element] of [
  ['textarea', '<textarea>Notes</textarea>'],
  ['xmp', '<xmp><b>shown as text</b></xmp>'],
  ['noembed', '<noembed>No plug-in</noembed>'],
  ['noframes', '<noframes>No frames</noframes>'],
  ['plaintext', '<plaintext>'],
  ['noscript', '<noscript><p>No script</p></noscript>'],
  ['template', '<template><h3 id="hidden">Not in the page</h3></template>'],
  ['frame', '<frame src="other.html" id="pane"></frame>'],
  ['frameset', '<frameset><frame src="other.html"></frameset>'],
])
  test(`a page that holds <${name}> is refused like a page that holds a form or a script`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-text-element-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = `<h2 id="flow">Source flow</h2>${element}`

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        {
          message: `Wiki page index.html must contain article sections, not a document, form or script: it holds <${name}>.`,
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=a page that explains the reader's own markup, for example a section about how diagrams are published; fails_when=the diagram renderer reads the page's text again, so a page that only shows a generated diagram id in an escaped code example or inside a comment is refused as if an element carried it; why_new=Cycle 0046 row 184 (the check looked for the text id="codebook-diagram-…" anywhere in the page's content); seam=none
test('a page that only shows a generated diagram id in an escaped code example or inside a comment is published', async () => {
  // Arrange: the diagram "flow" generates the ids codebook-diagram-4-flow, …-title and …-arrow; the page shows two of them as text and none on an element.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-id-shown-')),
  )
  try {
    const manifest = await diagramInput(root)
    manifest.pages[0].contentHtml +=
      '<pre><code>&lt;figure id="codebook-diagram-4-flow"&gt;</code></pre>' +
      '<!-- <p id="codebook-diagram-4-flow-title">An old note</p> -->'

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert: the figure is generated once, and the example and the comment are printed as authored.
    assert.equal(
      html.split(
        '<figure class="codebook-diagram" id="codebook-diagram-4-flow">',
      ).length - 1,
      1,
    )
    assert.ok(
      html.includes(
        '<pre><code>&lt;figure id="codebook-diagram-4-flow"&gt;</code></pre><!-- <p id="codebook-diagram-4-flow-title">An old note</p> -->',
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a published page with a diagram, whose figure, title and arrow marker are found by their ids; fails_when=an element of the page's content carries one of those ids and the page is published all the same, with the id twice, because the id is written without quotes or with a character reference; why_new=Cycle 0046 row 184 (the check accepted quoted ids only); seam=none
for (const [form, element] of [
  ['in quotes', '<p id="codebook-diagram-4-flow">A note</p>'],
  ['without quotes', '<p id=codebook-diagram-4-flow-title>A note</p>'],
  [
    'with a character reference',
    '<p id="codebook&#45;diagram-4-flow-arrow">A note</p>',
  ],
])
  test(`a page whose element carries a generated diagram id ${form} is refused, because the id would stand twice`, async () => {
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-diagram-id-carried-')),
    )
    try {
      const manifest = await diagramInput(root)
      manifest.pages[0].contentHtml += element

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        { message: 'Article IDs must not collide with generated diagram IDs.' },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=the figure of a diagram, which the learner must see; fails_when=a slot inside a comment that never ends is taken for a slot, so the figure is generated into a comment and the page is published without it; why_new=Cycle 0046 row 184 (the comment check knew closed comments only), and row 194, since which such a page is refused for its comment before any diagram is read; seam=none
test('a slot inside a comment that never ends is not rendered into the comment: the page is refused for its comment', async () => {
  // Arrange: the page's only slot stands after the start of a comment that has no end.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-slot-open-comment-')),
  )
  try {
    const manifest = await diagramInput(root)
    manifest.pages[0].contentHtml =
      '<h2 id="flow">Flow</h2><!-- <figure data-codebook-diagram="flow"></figure>'

    // Act / Assert
    await assert.rejects(
      renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      }),
      {
        message:
          'Wiki page index.html has a comment that never ends; close it with -->.',
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a published page's question form, rail and script, which stand after the article; fails_when=a page whose content holds a comment that never ends is published: a browser reads the rest of the article and everything after it as comment, so the page has no question form, no rail and runs no script (observed in the DOM check's browser on the page as published before); why_new=Cycle 0046 row 194; seam=none
for (const [form, comment] of [
  ['has no end', '<!-- to do'],
  ['has a space inside its end', '<!-- to do -- >'],
  ['has another character inside its end', '<!-- to do --!->'],
])
  test(`a page whose comment ${form} is refused with the sentence that says how to close it`, async () => {
    // Arrange: the comment stands after the page's last paragraph.
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-reader-endless-comment-')),
    )
    try {
      const manifest = await readerInput(root)
      manifest.pages[0].contentHtml = `<h2 id="flow">Source flow</h2><p>Explained from source.</p>${comment}`

      // Act / Assert
      await assert.rejects(
        renderWikiPages(manifest, {
          projectRoot: root,
          outputDirectory: join(root, '.codebook/wiki'),
        }),
        {
          message:
            'Wiki page index.html has a comment that never ends; close it with -->.',
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

// Value: protects=a page with comments in every form a browser ends, and the headings after them; fails_when=the publisher takes a comment that ends with "--!>", or the comments "<!-->" and "<!--->", or a "<!--" inside an attribute value for a comment that runs on, so it refuses a page a browser reads whole, or no longer sees the anchors after such a place; why_new=Cycle 0046 row 194 (each form was run in the DOM check's browser); seam=none
test('a page whose comments end is published in every form a browser takes for the end of a comment, and the anchors after each are read', async () => {
  // Arrange: a comment that ends with -->, one that ends with --!>, the comments <!--> and <!--->, and a title that only shows the start of a comment; a heading follows each.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reader-closed-comments-')),
  )
  try {
    const manifest = await readerInput(root)
    const content =
      '<!-- one --><h2 id="one">One</h2><!-- two --!><h2 id="two">Two</h2>' +
      '<!--><h2 id="three">Three</h2><!---><h2 id="four">Four</h2>' +
      '<p title="<!--">A title that shows the start of a comment.</p><h2 id="five">Five</h2>'
    manifest.pages[0].contentHtml = content
    manifest.pages[0].outline = ['one', 'two', 'three', 'four', 'five'].map(
      (id) => ({ id, label: `Part ${id}` }),
    )

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.ok(html.includes(content))
    assert.ok(
      html.includes(
        '<ul class="outline"><li><a href="#one">Part one</a></li><li><a href="#two">Part two</a></li><li><a href="#three">Part three</a></li><li><a href="#four">Part four</a></li><li><a href="#five">Part five</a></li></ul>',
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Value: protects=a page with a diagram that also writes about slots; fails_when=the diagram renderer counts the slot attribute or a slot in the page's text again, so a comment that shows another element with the attribute, or an attribute value that quotes a slot, gets the page refused or gets a figure written into the attribute; why_new=Cycle 0046 row 184 (the slots and the slot attribute were counted in the raw text); seam=none
test('a comment that shows an element with the slot attribute and an attribute value that quotes a slot are no slots: the page is published with its one figure', async () => {
  // Arrange: the page's slot, a commented-out element that carries the slot attribute, and a paragraph whose title quotes a slot.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-diagram-slot-shown-')),
  )
  try {
    const manifest = await diagramInput(root)
    manifest.pages[0].contentHtml +=
      '<!-- <div data-codebook-diagram="flow">An old graph</div> -->' +
      `<p title='Write <figure data-codebook-diagram="flow"></figure> here'>How a diagram is placed.</p>`

    // Act
    const html = (
      await renderWikiPages(manifest, {
        projectRoot: root,
        outputDirectory: join(root, '.codebook/wiki'),
      })
    ).get('index.html')

    // Assert
    assert.equal(html.split('<figure class="codebook-diagram"').length - 1, 1)
    assert.ok(
      html.includes(
        `</figure><!-- <div data-codebook-diagram="flow">An old graph</div> --><p title='Write <figure data-codebook-diagram="flow"></figure> here'>How a diagram is placed.</p>`,
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a stray file left in a prepared stage cannot be published as Wiki content', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-stray-stage-file-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/next')
  try {
    await writeStage(stage, root, '<h1>Candidate</h1>', undefined, output)
    await writeFile(join(stage, 'scratch-notes.md'), 'Agent working notes')

    // Act
    const publishing = publishWiki({
      projectRoot: root,
      outputDirectory: output,
      stageDirectory: stage,
    })

    // Assert
    await assert.rejects(publishing, /outside its published manifest/)
    await assert.rejects(access(output))
    await assert.rejects(access(output + '.publish-journal.json'))
    assert.equal(
      await readFile(join(stage, 'scratch-notes.md'), 'utf8'),
      'Agent working notes',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recovering an interrupted first publication reports the retained stage without inventing a prior Wiki', async () => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-first-publication-recovery-')),
  )
  const output = join(root, '.codebook/wiki'),
    stage = join(root, '.codebook/next')
  try {
    await writeStage(stage, root, '<h1>First article</h1>', undefined, output)
    const record = JSON.stringify({
      projectRoot: root,
      output,
      stage,
      pid: 99999999,
      id: '00000000-0000-4000-8000-000000000000',
      operation: 'publish',
      manifestSha256: '1'.repeat(64),
      priorLegacy: false,
    })
    await writeFile(output + '.publish-journal.json', record)

    // Act
    const recovered = await recoverWikiPublication({
      projectRoot: root,
      outputDirectory: output,
    })

    // Assert
    assert.deepEqual(recovered, { status: 'no-prior-wiki', stage })
    await assert.rejects(access(output))
    await assert.rejects(access(output + '.publish-journal.json'))
    await assert.rejects(
      access(
        output +
          '.publish-journal.json.recovery-' +
          createHash('sha256').update(record).digest('hex'),
      ),
    )
    assert.equal(
      await readFile(join(stage, 'index.html'), 'utf8'),
      '<h1>First article</h1>',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
