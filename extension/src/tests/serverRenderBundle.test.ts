import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { readDevelopmentBundle } from '../utils/readDevelopmentBundle'

/** The real `(rsc)` modules cut from the spike's chunks of two Next versions (Issue 179, version 2.1 comment). */
const FIXTURES = join(__dirname, '../../src/tests/fixtures/next-rsc')

/** A Next version's cut: a client component's stub and a server module, with the absolute prefix the spike's build wrote into the server module's map. */
const NEXT_VERSIONS = [
  {
    version: '16.1.4',
    stubPath: 'app/ui/invoices/touch-button.tsx',
    serverPath: 'app/lib/shared-helper.ts',
    originalPrefix: '/Users/lume/qa/c71-spike/nextjs-dashboard/',
  },
  {
    version: '16.3.4',
    stubPath: 'app/ClientThing.tsx',
    serverPath: 'app/layout.tsx',
    originalPrefix:
      '/Users/lume/qa/c71-spike/react-redux/examples/publish-ci/rr-rsc-context/',
  },
] as const

/** The `sourcesContent` entry of a module's inline map: the original text the build saw. */
function originalOf(moduleText: string): string {
  const encoded = moduleText.match(/base64,([A-Za-z\d+/=]+)/)![1]!
  return JSON.parse(Buffer.from(encoded, 'base64').toString()).sourcesContent[0]
}

/**
 * Points a cut module's map at the test workspace, as the build points it at the project folder.
 * @param moduleText - The real module text.
 * @param originalPrefix - The absolute project folder the spike's build wrote.
 * @param root - The test workspace.
 * @returns The module text whose inline map names the workspace file.
 */
function moduleInWorkspace(
  moduleText: string,
  originalPrefix: string,
  root: string,
): string {
  const encoded = moduleText.match(/base64,([A-Za-z\d+/=]+)/)![1]!
  const map = Buffer.from(encoded, 'base64')
    .toString()
    .replaceAll(originalPrefix, `${root}/`)
  return moduleText.replace(encoded, Buffer.from(map).toString('base64'))
}

/**
 * Writes a workspace with the stop's source file and an entry route chunk.
 * @param context - The test, which removes the folder when it ends.
 * @param sourcePath - The workspace-relative file the stop cites.
 * @param source - The file's text.
 * @returns The workspace folder, the selected source and a writer for the route chunk's modules.
 */
async function routeChunkWorkspace(
  context: TestContext,
  sourcePath: string,
  source: string,
) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-rsc-seal-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(join(directory, path), text)
  }
  await write(sourcePath, source)
  await write(
    '.next/dev/server/app-paths-manifest.json',
    JSON.stringify({ '/page': 'app/page.js' }),
  )
  return {
    directory,
    selected: { path: sourcePath, hash: sha256(source), line: 1, column: 1 },
    writeChunk: (modules: string[]): Promise<void> =>
      write(
        '.next/dev/server/app/page.js',
        modules.map((text) => `eval(${JSON.stringify(text)});\n`).join(''),
      ),
  }
}

/** Seals a server stop of the entry route as the run does. */
function sealServerStop(
  workspace: Awaited<ReturnType<typeof routeChunkWorkspace>>,
) {
  return readDevelopmentBundle(
    workspace.directory,
    workspace.selected,
    undefined,
    '/',
    'server-action',
  )
}

for (const next of NEXT_VERSIONS) {
  // Value: protects=a server stop in a file only the (rsc) layer holds is sealed from that layer and reports it; fails_when=the (rsc) module is refused as absent or the layer is not reported; no_claim=a live Next build (the module is cut from a real chunk)
  test(`Next ${next.version}: a server stop in a file only the (rsc) layer holds is sealed from the (rsc) module and reports the rsc layer`, async (context) => {
    // Arrange
    const raw = await readFile(
      join(FIXTURES, `next-${next.version}-server-module.txt`),
      'utf8',
    )
    const workspace = await routeChunkWorkspace(
      context,
      next.serverPath,
      originalOf(raw),
    )
    await workspace.writeChunk([
      moduleInWorkspace(raw, next.originalPrefix, workspace.directory),
    ])
    // Act
    const sealed = await sealServerStop(workspace)
    // Assert
    assert.equal(sealed.layer, 'rsc')
    assert.equal(
      sealed.bundle.scriptUrl,
      `webpack-internal:///(rsc)/./${next.serverPath}`,
    )
  })

  // Value: protects=a client component's reference stub is refused before any input with the client-component reason and the stop; fails_when=the stub is sealed as a server module, refused with a mapping error, or the reason or stop is missing; no_claim=a live Next build (the stub is cut from a real chunk)
  test(`Next ${next.version}: a server stop in a 'use client' file is refused as a client component with its stop`, async (context) => {
    // Arrange
    const raw = await readFile(
      join(FIXTURES, `next-${next.version}-client-stub.txt`),
      'utf8',
    )
    const workspace = await routeChunkWorkspace(
      context,
      next.stubPath,
      originalOf(raw),
    )
    await workspace.writeChunk([raw])
    // Act
    const failure = await sealServerStop(workspace).then(
      () => undefined,
      (error: unknown) => error,
    )
    // Assert
    assert.ok(failure instanceof StudyError, String(failure))
    assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
    assert.deepEqual(failure.details, {
      reason: 'client-component',
      stop: `${next.stubPath}:1`,
    })
    assert.equal(
      failure.message,
      `This location runs only in the browser: declare it as a browser stop. ${next.stubPath}:1 is a client component file ('use client'); the server holds only a reference to it. Declare it with participant "browser", or choose a server file this page renders.`,
    )
  })
}

// Value: protects=a file both layers hold is sealed from (action-browser), as before the (rsc) fallback existed; fails_when=the (rsc) module wins or the layer is not reported; no_claim=a live Next build
test('a server stop in a file both layers hold is sealed from the (action-browser) module', async (context) => {
  // Arrange
  const next = NEXT_VERSIONS[1]
  const raw = await readFile(
    join(FIXTURES, `next-${next.version}-server-module.txt`),
    'utf8',
  )
  const workspace = await routeChunkWorkspace(
    context,
    next.serverPath,
    originalOf(raw),
  )
  const rscModule = moduleInWorkspace(
    raw,
    next.originalPrefix,
    workspace.directory,
  )
  const actionModule = rscModule.replace(
    'webpack-internal:///(rsc)/',
    'webpack-internal:///(action-browser)/',
  )
  await workspace.writeChunk([rscModule, actionModule])
  // Act
  const sealed = await sealServerStop(workspace)
  // Assert
  assert.equal(sealed.layer, 'action-browser')
  assert.equal(
    sealed.bundle.scriptUrl,
    `webpack-internal:///(action-browser)/./${next.serverPath}`,
  )
})

// Value: protects=a file in neither server layer of the route chunk keeps today's refusal; fails_when=it is sealed from a shared chunk or refused with another sentence; no_claim=vendor chunks (absent here)
test('a server stop in a file neither layer holds keeps the absent-module refusal', async (context) => {
  // Arrange
  const next = NEXT_VERSIONS[0]
  const raw = await readFile(
    join(FIXTURES, `next-${next.version}-server-module.txt`),
    'utf8',
  )
  const workspace = await routeChunkWorkspace(
    context,
    'app/lib/other.ts',
    'export const other = 1\n',
  )
  await workspace.writeChunk([raw])
  // Act / Assert
  await assert.rejects(
    sealServerStop(workspace),
    /SSR reference is not a server implementation/,
  )
})
