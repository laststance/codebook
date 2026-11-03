import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

import { sha256 } from '../../runtimeSupport/utils/sha256'
import {
  resolveNextPackage,
  type ResolvedNextPackage,
} from '../../utils/resolveNextPackage'

import {
  APP_SOURCE,
  PAGE_SOURCE,
  browserChunk,
  pagesEvalModule,
  writePagesServerBuild,
} from './nextPagesBuildHarness'

/** The package folder every nested fixture uses, relative to the repository. */
export const NESTED_APP_FOLDER = 'examples/app'

/** What the repository root's own page holds: a decoy whose text differs from the package's page, so a read of the wrong root yields another value. */
export const DECOY_PAGE_SOURCE =
  'export default function Decoy() {\n' +
  '  return null\n' +
  '}\n' +
  'export const getStaticProps = () => ({ props: { decoy: true } })\n'

/** A module outside the package that Next would print as `../shared/x.ts`. */
export const SHARED_SOURCE = 'export const shared = 1\n'

const MEASURED_BUILD_MANIFEST = join(
  __dirname,
  '../../../src/tests/fixtures/next-pages/nextjs/build-manifest.json',
)

/**
 * Writes a file, creating its folders.
 * @param path - Absolute path.
 * @param text - File text.
 * @example await putFile('/tmp/x/a.txt', 'a')
 */
export async function putFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/**
 * Installs a Next app at `folder`: a `package.json` naming `next` and a `node_modules/next` with an executable.
 * @param folder - The app's folder.
 * @example await installNextApp('/repo/examples/app')
 */
export async function installNextApp(folder: string): Promise<void> {
  await putFile(
    join(folder, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { next: '16.4.3' } }),
  )
  await putFile(
    join(folder, 'node_modules/next/package.json'),
    '{"name":"next","version":"16.4.3"}',
  )
  await putFile(join(folder, 'node_modules/next/dist/bin/next'), '#\n')
}

/**
 * Creates a temporary repository that holds a nested Pages app (`examples/app`) and, at its root, a decoy Next app with its own `package.json`, `node_modules/next`, `src/pages` and `.next/dev` build, so a reader that reads the repository root instead of the package gets visibly different bytes.
 *
 * The decoy build also carries a module for the package's page under its repository-relative name (`./examples/app/src/pages/index.tsx`), holding the package page's real text: a reader that takes the root build and the repository-relative module name seals it, and the tests see it by the chunk's location.
 * @param context - The test, which removes the repository afterwards.
 * @returns The canonical repository and package roots, the resolved package, the file writer and the stops of the package's page and of a shared module outside the package.
 * @example const fixture = await nestedPagesRepository(context)
 */
export async function nestedPagesRepository(context: TestContext) {
  const repository = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-nested-pages-')),
  )
  context.after(() => rm(repository, { recursive: true, force: true }))
  const packageRoot = join(repository, NESTED_APP_FOLDER)
  /** Writes one app's browser and server build, with the sources named below `workspace`. */
  const writeBuild = async (
    workspace: string,
    pagePath: string,
    pageText: string,
    appPath: string,
  ): Promise<void> => {
    const at = (path: string, text: string): Promise<void> =>
      putFile(join(workspace, path), text)
    await mkdir(join(workspace, '.next/dev/static/chunks/webpack.js'), {
      recursive: true,
    })
    await mkdir(join(workspace, '.next/dev/static/chunks/main.js'), {
      recursive: true,
    })
    await copyFile(
      MEASURED_BUILD_MANIFEST,
      join(workspace, '.next/dev/build-manifest.json'),
    )
    await at(
      '.next/dev/static/chunks/pages/index.js',
      browserChunk('pages/index', {
        [`./${pagePath}`]: pagesEvalModule(
          workspace,
          pagePath,
          pageText,
          'pages-dir-browser',
          4,
        ),
      }),
    )
    await at(
      '.next/dev/static/chunks/pages/_app.js',
      browserChunk('pages/_app', {
        [`./${appPath}`]: pagesEvalModule(
          workspace,
          appPath,
          APP_SOURCE,
          'pages-dir-browser',
          3,
        ),
      }),
    )
    await writePagesServerBuild(at, workspace, {
      path: pagePath,
      text: pageText,
    })
  }
  // The package: sources, install and build as Next lays them out below the package root.
  await installNextApp(packageRoot)
  await putFile(join(packageRoot, 'src/pages/index.tsx'), PAGE_SOURCE)
  await putFile(join(packageRoot, 'src/pages/_app.tsx'), APP_SOURCE)
  await putFile(join(repository, 'examples/shared/x.ts'), SHARED_SOURCE)
  await writeBuild(
    packageRoot,
    'src/pages/index.tsx',
    PAGE_SOURCE,
    'src/pages/_app.tsx',
  )
  // The decoy: another app at the repository root, plus a module for the package's page under its repository-relative name.
  await installNextApp(repository)
  await putFile(join(repository, 'src/pages/index.tsx'), DECOY_PAGE_SOURCE)
  await putFile(join(repository, 'src/pages/_app.tsx'), APP_SOURCE)
  await writeBuild(
    repository,
    `${NESTED_APP_FOLDER}/src/pages/index.tsx`,
    PAGE_SOURCE,
    `${NESTED_APP_FOLDER}/src/pages/_app.tsx`,
  )
  const nextPackage: ResolvedNextPackage = await resolveNextPackage(
    repository,
    NESTED_APP_FOLDER,
  )
  return {
    repository,
    packageRoot,
    nextPackage,
    /** The package's page as a stop: repository-relative path, the hash of the package's bytes. */
    page: {
      path: `${NESTED_APP_FOLDER}/src/pages/index.tsx`,
      hash: sha256(PAGE_SOURCE),
      line: 2,
      column: 3,
    },
    /** A tracked file beside the package, which Next prints as a `../shared/x.ts` module. */
    shared: {
      path: 'examples/shared/x.ts',
      hash: sha256(SHARED_SOURCE),
      line: 1,
      column: 1,
    },
  }
}
