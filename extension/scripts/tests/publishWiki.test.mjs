import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  prepareWikiStage,
  publishWiki,
  recoverWikiPublication,
} from '../../skills/codebook/publish-wiki.mjs'
import { renderWikiPages } from '../../skills/codebook/render-wiki.mjs'

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
    manifest.assets = ['assets/note.txt']
    await mkdir(join(first, 'assets'))
    await writeFile(join(first, 'assets/note.txt'), 'Owned asset')
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
    assert.equal(
      await readFile(join(next, 'assets/note.txt'), 'utf8'),
      'Owned asset',
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

    // Assert: the link's content is its accessible name, "Open in VS Code", exactly as 0.2.29.0 published it; the target beside it is the link's description, "src/utils/a&b.ts:12".
    const entry = pages
      .get('index.html')
      .match(/<p class="open-in-editor">.*?<\/p>/)?.[0]
    assert.ok(entry)
    assert.equal(
      entry.replace(/href="[^"]+"/, 'href="…"'),
      '<p class="open-in-editor"><a href="…" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" id="codebook-open-target">src/<wbr>utils/<wbr>a&amp;b.ts<wbr>:12</span></p>',
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
      '<h2 ID=page-theme-toggle>The theme</h2><p><a href="../index.html#page-qa-form-2">The form</a></p>',
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

// Value: protects=the list of ids the publisher keeps a page's content apart from; fails_when=the shell's template or one of the reader's page scripts gives an element an id the publisher does not know, so a page whose content carries that id is published with it twice; why_new=Cycle 0046 row 84; seam=none
test('the publisher keeps a page’s content apart from every id the shell’s template and the reader’s page scripts give an element', async () => {
  // Arrange: the shell, the publisher, and the sources of the reader that run in a served page or add to it.
  const textOf = (path) =>
    readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
  const shell = await textOf('skills/codebook/reader-shell.html')
  const renderer = await textOf('skills/codebook/render-wiki.mjs')
  const constants = await textOf('src/constants.ts')
  const statusScript = await textOf('src/utils/installWikiUpdateStatus.ts')
  const helpScript = await textOf('src/utils/installShortcutHelp.ts')
  const questionScript = await textOf('src/deepWikiReader.ts')

  // Act: the ids of the template (the publisher reads them from it), the ids the reader's scripts assign, and the ids the publisher names for them.
  const idsOfTheTemplate = [...shell.matchAll(/\sid="([^"]+)"/g)].map(
    ([, id]) => id,
  )
  const idsOfTheScripts = {
    entryTarget: /WIKI_OPEN_TARGET_ELEMENT_ID = '([^']+)'/.exec(constants)?.[1],
    statusRegion: /let id = '([^']+)'/.exec(statusScript)?.[1],
    keyboardHelp: [...helpScript.matchAll(/\.id = '([^']+)'/g)].map(
      ([, id]) => id,
    ),
    // The script of the question form looks its elements up and gives none an id.
    questionForm: [...questionScript.matchAll(/\.id = /g)].length,
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
  assert.deepEqual(idsOfTheScripts, {
    entryTarget: 'codebook-open-target',
    statusRegion: 'codebook-update-status',
    keyboardHelp: ['shortcut-title', 'shortcut-tooltip'],
    questionForm: 0,
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
