import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

import type { PreparedLibraryCore } from '../../libraryPackage'
import type { ViteLibraryRouteDependencies } from '../../viteLibraryRoute'

import { removeTestFolder } from './removeTestFolder'

export const PACKAGE_ROOT = 'examples/web'
export const ORIGIN = 'http://localhost:4321'
export const PAGE_ASSET = 'static/chunks/main-app.js'
export const SERVER_ASSET = 'vendor-chunks/react-redux.js'
export const PAGE_HASH = 'a'.repeat(64)
export const SERVER_HASH = 'b'.repeat(64)

/** Writes a file below a folder, creating its parents, and returns its path. */
export async function put(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'export {}\n')
  return path
}

/** The fake seams of a Next library run over a real private folder, and what they were asked. */
export async function libraryDependencies(
  context: TestContext,
  overrides: Partial<ViteLibraryRouteDependencies> = {},
) {
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-next-run-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const packedRoot = join(privateFolder, 'node_modules', 'react-redux')
  const calls: string[] = []
  const dependencies: ViteLibraryRouteDependencies = {
    confirm: async () => {
      calls.push('confirm')
      return true
    },
    resolveNode: async () => ({
      executable: process.execPath,
      version: '24.0.0',
    }),
    assertSupported: async () => ({
      libraryRoot: join(privateFolder, 'library'),
      relativeRoot: '.',
      name: 'react-redux',
      version: '9.3.1',
      peers: [],
      packageManager: {
        ok: true,
        name: 'pnpm',
        version: '11.23.0',
        executable: '/bin/pnpm',
      },
    }),
    readManifest: async () => ({ peers: [] }),
    allocatePrivateFolder: async () => privateFolder,
    prepareCore: async (): Promise<PreparedLibraryCore> => {
      calls.push('prepare')
      await mkdir(packedRoot, { recursive: true })
      return {
        facts: {
          package: 'react-redux',
          version: '9.3.1',
          packageRoot: '.',
          revision: 'a'.repeat(40),
          dirty: false,
          packageManager: { name: 'pnpm', version: '11.23.0' },
          buildMs: 5,
          packMs: 2,
          tarballSha256: 'c'.repeat(64),
          installedVersion: '9.3.0',
        },
        packedRoot,
        peers: [],
        imports: undefined,
        libraryRoot: join(privateFolder, 'library'),
        privateFolder,
        dispose: async () => {
          calls.push('dispose')
          await removeTestFolder(privateFolder)
          return { cleanup: 'removed' }
        },
        failLink: async (sentence) => {
          throw new Error(sentence)
        },
      }
    },
    writeAnchor: async () => join(privateFolder, 'codebook-anchor.js'),
    ...overrides,
  }
  return { dependencies, privateFolder, packedRoot, calls }
}

export type Library = Awaited<ReturnType<typeof libraryDependencies>>

/** The three folders a Next library run's compilations write to, created below the app. */
export async function compilerFolders(harness: { directory: string }) {
  const appRoot = join(await realpath(harness.directory), PACKAGE_ROOT)
  const folders = {
    client: join(appRoot, '.next', 'dev'),
    server: join(appRoot, '.next', 'dev', 'server'),
    edge: join(appRoot, '.next', 'dev', 'server', 'edge'),
  }
  for (const folder of Object.values(folders))
    await mkdir(folder, { recursive: true })
  return folders
}

/** One line of the report as the Next preload writes it. */
export function line(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`
}

/**
 * Writes the report a healthy Next run leaves: a `wrapped` line per compiler, a client compilation holding a page chunk and a server compilation whose chunk holds the packed module.
 * @param withWrapped - The compilers that wrote their `wrapped` line.
 */
export async function writeReport(
  library: Library,
  folders: Awaited<ReturnType<typeof compilerFolders>>,
  options: { wrapped?: readonly string[]; errorLine?: boolean } = {},
): Promise<void> {
  const packed = await put(join(library.packedRoot, 'dist', 'rsc.mjs'))
  const outputs: Record<string, string> = {
    client: folders.client,
    server: folders.server,
    'edge-server': folders.edge,
  }
  const wrapped = options.wrapped ?? ['server', 'edge-server', 'client']
  const text =
    wrapped
      .map((compiler) =>
        line({ wrapped: true, compiler, outputPath: outputs[compiler] }),
      )
      .join('') +
    (options.errorLine
      ? line({
          error: 'webpack-config was not patched',
          compiler: 'edge-server',
        })
      : '') +
    line({
      compiler: 'client',
      outputPath: folders.client,
      compilationHash: 'h-client',
      publicPath: '/_next/',
      assets: [{ name: PAGE_ASSET, sha256: PAGE_HASH, resources: [] }],
    }) +
    line({
      compiler: 'server',
      outputPath: folders.server,
      compilationHash: 'h-server',
      publicPath: '/_next/',
      assets: [
        { name: SERVER_ASSET, sha256: SERVER_HASH, resources: [packed] },
      ],
    })
  await writeFile(join(library.privateFolder, 'report.jsonl'), text)
}
