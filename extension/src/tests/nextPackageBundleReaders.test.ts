import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { createNextPagesDiscoveryCache } from '../utils/createNextPagesDiscoveryCache'
import { readDevelopmentBundle } from '../utils/readDevelopmentBundle'
import { readPagesDevelopmentBundle } from '../utils/readPagesDevelopmentBundle'
import { readPagesServerBundle } from '../utils/readPagesServerBundle'
import { rootNextPackage } from '../utils/resolveNextPackage'
import { sealPagesServerStop } from '../utils/sealPagesServerStop'

import {
  installNextApp,
  nestedPagesRepository,
  putFile,
} from './utils/nestedNextPagesHarness'
import { nextPagesBuild, serverChunk } from './utils/nextPagesBuildHarness'

// Value: protects=a server stop of a nested Pages app is sealed from the package's own server compile and the module Next prints as ./src/pages/index.tsx, while the sealed source keeps the SHA-256 of the repository-relative stop's bytes and its absolute location; fails_when=the reader reads <repository>/.next (the decoy compile, which holds a module named by the repository-relative path) or names the module by the repository-relative path; no_claim=a real Next server compile
test('a nested Pages server stop is sealed from the package server compile by its package-relative module path', async (context) => {
  // Arrange
  const fixture = await nestedPagesRepository(context)
  // Act
  const result = await readPagesServerBundle({
    workspace: fixture.repository,
    nextPackage: fixture.nextPackage,
    selected: { ...fixture.page, line: 5 },
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx',
  )
  assert.equal(
    result.bundle.chunkPath,
    join(fixture.packageRoot, '.next/dev/server/pages/index.js'),
  )
  assert.equal(
    result.bundle.sourcePath,
    join(fixture.repository, 'examples/app/src/pages/index.tsx'),
  )
  assert.equal(sha256(result.bundle.source), fixture.page.hash)
})

// Value: protects=a nested Pages browser stop is sealed from the package's entry chunks by the package-relative module path; fails_when=the reader takes the decoy chunks of <repository>/.next/dev/static or the repository-relative module name; no_claim=a real browser chunk
test('a nested Pages browser stop is sealed from the package entry chunks by its package-relative module path', async (context) => {
  // Arrange
  const fixture = await nestedPagesRepository(context)
  // Act
  const result = await readPagesDevelopmentBundle({
    workspace: fixture.repository,
    nextPackage: fixture.nextPackage,
    selected: fixture.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx',
  )
  assert.equal(
    result.bundle.chunkPath,
    join(fixture.packageRoot, '.next/dev/static/chunks/pages/index.js'),
  )
  assert.equal(sha256(result.bundle.source), fixture.page.hash)
})

// Value: protects=a stop file beside the package (a ../shared/x.ts module of Next) never seals a package file, even when the package's compile holds a module under that exact id; fails_when=the reader normalizes the stop to a path inside the package or builds the module id from the repository-relative path and returns a seal; no_claim=that Next names such a module ../shared/x.ts in every version
test('a stop outside the package is not sealed even when the package compile holds a ../ module', async (context) => {
  // Arrange
  const fixture = await nestedPagesRepository(context)
  await putFile(
    join(fixture.packageRoot, '.next/dev/server/pages/index.js'),
    serverChunk({
      '../shared/x.ts':
        '/*outside*/\n//# sourceURL=webpack-internal:///(pages-dir-node)/../shared/x.ts\n',
    }),
  )
  const request = {
    workspace: fixture.repository,
    nextPackage: fixture.nextPackage,
    selected: fixture.shared,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  }
  // Act
  const server = await readPagesServerBundle(request)
  const browser = readPagesDevelopmentBundle(request)
  // Assert
  assert.deepEqual(server, { kind: 'not-a-workspace-source' })
  await assert.rejects(browser, /outside the Next package/)
  assert.equal(
    fixture.nextPackage.classifyModuleId(
      'webpack-internal:///(pages-dir-node)/../shared/x.ts',
    ).kind,
    'outside',
  )
})

// Value: protects=a nested server stop on the data function line passes the whole seal (server compile, entry-page client check) against the package's own build, with the entry page named by its repository-relative path; fails_when=the seal reads the decoy root build for the server compile or for the client mapping, or compares the entry page in package-relative form; no_claim=the run's debugger binding
test('a nested server stop on the entry page data function is sealed through the package builds', async (context) => {
  // Arrange
  const fixture = await nestedPagesRepository(context)
  // Act
  const sealed = await sealPagesServerStop({
    workspace: fixture.repository,
    nextPackage: fixture.nextPackage,
    selected: { ...fixture.page, line: 5, column: 1 },
    citationEndLine: 5,
    route: '/',
    entrySource: fixture.page.path,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.equal(sealed.layer, 'pages-dir-node')
  assert.equal(
    sealed.bundle.chunkPath,
    join(fixture.packageRoot, '.next/dev/server/pages/index.js'),
  )
  assert.equal(sealed.evidence, undefined)
})

// Value: protects=a nested server stop on a line the package's client compile also maps is refused as a client component, so the entry-page client check reads the package's browser chunk; fails_when=the client check reads the decoy chunk or the stop is not matched to the entry page; no_claim=every refusal sentence
test('a nested server stop on a client-mapped entry page line is refused from the package client compile', async (context) => {
  // Arrange
  const fixture = await nestedPagesRepository(context)
  // Act
  const failure = await sealPagesServerStop({
    workspace: fixture.repository,
    nextPackage: fixture.nextPackage,
    selected: { ...fixture.page, line: 2, column: 3 },
    citationEndLine: 2,
    route: '/',
    entrySource: fixture.page.path,
    cache: createNextPagesDiscoveryCache(),
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(failure.details?.reason, 'client-component')
})

// Value: protects=a root run seals the same module whether the caller passes the root package explicitly or nothing (today's behavior, AC 6); fails_when=the default package changes the module names or the build location of a root run; no_claim=a nested run
test('a root Pages stop seals identically with the root package given explicitly and without it', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild()
  const request = {
    workspace: build.workspace,
    selected: { ...build.page, line: 5 },
    route: '/',
  }
  // Act
  const implicit = await readPagesServerBundle({
    ...request,
    cache: createNextPagesDiscoveryCache(),
  })
  const explicit = await readPagesServerBundle({
    ...request,
    nextPackage: rootNextPackage(build.workspace),
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.equal(implicit.kind, 'sealed')
  assert.equal(
    implicit.bundle.chunkPath,
    join(build.workspace, '.next/dev/server/pages/index.js'),
  )
  assert.deepEqual(
    explicit.kind === 'sealed' ? explicit.bundle : undefined,
    implicit.bundle,
  )
})

/**
 * Writes a nested App Router app (`examples/app`) with a server operation module in its `/login` route chunk, and a decoy root app whose own manifest and chunk hold the same module under its repository-relative name.
 * @param context - The test.
 * @returns The roots, the stop and the chunk paths.
 */
async function nestedAppRouterRepository(
  context: Parameters<typeof nestedPagesRepository>[0],
) {
  const fixture = await nestedPagesRepository(context)
  const source = 'export async function execute() { return true; }\n'
  const module = (workspace: string, path: string, layer: string): string => {
    const map = {
      version: 3,
      sources: [join(workspace, path)],
      sourcesContent: [source],
      names: [],
      mappings: 'AAAA',
    }
    const javascript = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=webpack-internal:///(${layer})/./${path}\n`
    return `eval(${JSON.stringify(javascript)});`
  }
  await putFile(join(fixture.packageRoot, 'src/operation.ts'), source)
  for (const [workspace, path] of [
    [fixture.packageRoot, 'src/operation.ts'],
    [fixture.repository, 'examples/app/src/operation.ts'],
  ] as const) {
    await putFile(
      join(workspace, '.next/dev/server/app-paths-manifest.json'),
      JSON.stringify({ '/login/page': 'app/login/page.js' }),
    )
    await putFile(
      join(workspace, '.next/dev/server/app/login/page.js'),
      module(workspace, path, 'action-browser'),
    )
  }
  return {
    ...fixture,
    stop: {
      path: 'examples/app/src/operation.ts',
      hash: sha256(source),
      line: 1,
      column: 1,
    },
  }
}

// Value: protects=a nested App Router server stop is sealed from the package's app-paths manifest and route chunk by the package-relative module id; fails_when=the reader takes <repository>/.next (the decoy manifest and chunk, which name the repository-relative module) or builds the module id from the repository-relative path; no_claim=a real Next build
test('a nested App Router server stop is sealed from the package route chunk by its package-relative module path', async (context) => {
  // Arrange
  const fixture = await nestedAppRouterRepository(context)
  // Act
  const result = await readDevelopmentBundle(
    fixture.repository,
    fixture.stop,
    undefined,
    '/login',
    'server-action',
    fixture.nextPackage,
  )
  // Assert
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(action-browser)/./src/operation.ts',
  )
  assert.equal(
    result.bundle.chunkPath,
    join(fixture.packageRoot, '.next/dev/server/app/login/page.js'),
  )
  assert.equal(
    result.bundle.sourcePath,
    join(fixture.packageRoot, 'src/operation.ts'),
  )
  assert.equal(sha256(result.bundle.source), fixture.stop.hash)
})

// Value: protects=an App Router stop outside the package is refused before any build file is read; fails_when=the reader joins the ../ path into the package or reads the decoy root; no_claim=the wording of the refusal for the learner (the run refuses earlier)
test('an App Router stop outside the package is rejected without sealing', async (context) => {
  // Arrange
  const fixture = await nestedAppRouterRepository(context)
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(
      fixture.repository,
      fixture.shared,
      undefined,
      '/login',
      'server-action',
      fixture.nextPackage,
    ),
    /outside the Next package/,
  )
})

// Value: protects=a root App Router run reads exactly as 0.2.74.0 (AC 6); fails_when=the default root package changes the root run's module id or build location; no_claim=a nested run
test('a root App Router stop seals the same with the root package given explicitly and without it', async (context) => {
  // Arrange
  const fixture = await nestedAppRouterRepository(context)
  await installNextApp(fixture.packageRoot)
  const stop = { ...fixture.stop, path: 'src/operation.ts' }
  // Act
  const implicit = await readDevelopmentBundle(
    fixture.packageRoot,
    stop,
    undefined,
    '/login',
    'server-action',
  )
  const explicit = await readDevelopmentBundle(
    fixture.packageRoot,
    stop,
    undefined,
    '/login',
    'server-action',
    rootNextPackage(fixture.packageRoot),
  )
  // Assert
  assert.equal(
    implicit.bundle.chunkPath,
    join(fixture.packageRoot, '.next/dev/server/app/login/page.js'),
  )
  assert.deepEqual(explicit.bundle, implicit.bundle)
})
