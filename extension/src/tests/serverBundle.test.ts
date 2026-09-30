import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDevelopmentBundle } from '../utils/readDevelopmentBundle'
import { sha256 } from '../runtimeSupport/utils/sha256'

/** Supplies inert compiler bytes for acquisition tests; no application is installed or executed. @example await serverBundleFixture(context) */
async function serverBundleFixture(context: TestContext) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-server-source-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const source = 'export async function execute() { return true; }\n'
  const sourcePath = join(directory, 'src/operation.ts')
  const chunkPath = join(directory, '.next/dev/server/app/login/page.js')
  const manifestPath = join(
    directory,
    '.next/dev/server/app-paths-manifest.json',
  )
  await mkdir(join(directory, 'src'), { recursive: true })
  await mkdir(join(directory, '.next/dev/server/app/login'), {
    recursive: true,
  })
  await writeFile(sourcePath, source)
  await writeFile(
    manifestPath,
    JSON.stringify({ '/login/page': 'app/login/page.js' }),
  )
  const module = (layer: string, original = source) => {
    const map = {
      version: 3,
      sources: [sourcePath],
      sourcesContent: [original],
      names: [],
      mappings: 'AAAA',
    }
    const javascript = `throw new Error('acquisition must never execute module bytes');\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=webpack-internal:///(${layer})/./src/operation.ts\n`
    return `eval(${JSON.stringify(javascript)});`
  }
  const selected = {
    path: 'src/operation.ts',
    hash: sha256(source),
    line: 1,
    column: 1,
  }
  await writeFile(chunkPath, module('ssr') + module('action-browser'))
  return {
    directory,
    source,
    sourcePath,
    chunkPath,
    manifestPath,
    selected,
    module,
  }
}

test('server acquisition selects the executable action layer without evaluating its bytes or selecting the SSR proxy', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context)
  // Act
  const result = await readDevelopmentBundle(
    fixture.directory,
    fixture.selected,
    undefined,
    '/login',
    'server-action',
  )
  // Assert
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(action-browser)/./src/operation.ts',
  )
  assert.equal(
    result.bundle.source,
    'export async function execute() { return true; }\n',
  )
  assert.deepEqual(result.discovery.candidates, ['server/app/login/page.js'])
})

test('an SSR reference alone cannot qualify a server action source', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context)
  await writeFile(fixture.chunkPath, fixture.module('ssr'))
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      undefined,
      '/login',
      'server-action',
    ),
    /SSR reference is not a server implementation/,
  )
})

test('a server map containing a different original is rejected before debugger acquisition', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context)
  await writeFile(
    fixture.chunkPath,
    fixture.module('action-browser', 'export const different = true;\n'),
  )
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      undefined,
      '/login',
      'server-action',
    ),
    /Map original differs from frozen source/,
  )
})

test('a source edit after configuration cannot be sealed from an older server build', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context)
  await writeFile(fixture.sourcePath, 'export const changed = true;\n')
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      undefined,
      '/login',
      'server-action',
    ),
    /Selected source differs from the accepted article/,
  )
})

test('duplicate executable server modules cannot silently choose an implementation', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context)
  await writeFile(
    fixture.chunkPath,
    fixture.module('action-browser') + fixture.module('action-browser'),
  )
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      undefined,
      '/login',
      'server-action',
    ),
    /Ambiguous evaluated module/,
  )
})

test('server route ambiguity and traversal are rejected before reading a compiled module', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context)
  await writeFile(
    fixture.manifestPath,
    JSON.stringify({ '/login/page': 'app/../../outside/page.js' }),
  )
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      undefined,
      '/login',
      'server-action',
    ),
    /no unique compiled Next page/,
  )
  await writeFile(
    fixture.manifestPath,
    JSON.stringify({
      '/(first)/login/page': 'app/first/page.js',
      '/(second)/login/page': 'app/second/page.js',
    }),
  )
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      undefined,
      '/login',
      'server-action',
    ),
    /no unique compiled Next page/,
  )
})

test('cancelled server preparation cannot return a sealed executable', async (context) => {
  // Arrange
  const fixture = await serverBundleFixture(context),
    controller = new AbortController()
  controller.abort()
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.directory,
      fixture.selected,
      controller.signal,
      '/login',
      'server-action',
    ),
    { name: 'AbortError' },
  )
})
