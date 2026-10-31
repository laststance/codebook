import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

import {
  findNextRouteFolder,
  type NextRouteFolder,
} from './findNextRouteFolder'
import { findNextSourceWithOtherExtension } from './findNextSourceWithOtherExtension'
import { isUnlinkedRegularFile } from './isUnlinkedRegularFile'

/** What {@link findNextPagesSource} found for a compiled Pages path. */
export type NextPagesSourceLookup =
  | {
      kind: 'found'
      /** The page's source, workspace-relative with `/` separators, e.g. `src/pages/posts/[id].tsx`. */
      path: string
      folder: NextRouteFolder<'pages'>
    }
  | {
      kind: 'missing'
      folder: NextRouteFolder<'pages'>
      /** Every workspace-relative candidate, in the order Next tries them. */
      tried: string[]
      /** A file with a candidate's stem and another extension, e.g. `pages/about.mdx`: a custom `pageExtensions` source, so the listing is not stale. Absent when no such file exists. */
      otherExtension?: string
    }

/**
 * Finds the source file of a compiled Pages page the way Next does (`findPageFile`): in the root `pages/` folder when it exists, else in `src/pages/`, trying `.tsx`, `.ts`, `.jsx`, `.js` and, for each, the page file before its folder's `index` file.
 * Called by the Pages run after {@link resolveNextPagesRoute} matched the entry path, to name the page's source, or the candidates tried when none exists, and by the router contest of {@link readNextRouteManifests} for a more specific Pages route. Only `lstat` is asked; a link, or a file under a linked folder, is never followed and never found.
 * @param workspace - The opened workspace (the Next project root).
 * @param compiledPath - The Pages manifest value of the route, e.g. `pages/posts/[id].js`.
 * @param signal - Ends the lookup with the abort reason when the run is cancelled.
 * @returns
 * - `found` with the first existing regular file and its folder
 * - `missing` with the folder and every candidate tried, and `otherExtension` when a file with a candidate's stem has another extension ({@link findNextSourceWithOtherExtension})
 * @throws When the compiled path is not a contained `pages/….js` path, so no candidate could leave the workspace; the abort reason when `signal` aborts before a candidate is looked up.
 * @example
 * await findNextPagesSource('/repo', 'pages/posts.js')
 * // => { kind: 'found', path: 'src/pages/posts/index.tsx', folder: 'src/pages' } in a project whose page is src/pages/posts/index.tsx
 */
export async function findNextPagesSource(
  workspace: string,
  compiledPath: string,
  signal?: AbortSignal,
): Promise<NextPagesSourceLookup> {
  const pagePath = pagePathOfCompiled(compiledPath)
  // Next's rule: the root folder wins; without it Next reads src/pages, so that is where a missing page is looked for.
  const folder = (await findNextRouteFolder(workspace, 'pages')) ?? 'src/pages'
  const stems = pageSourceStems(folder, pagePath)
  const tried = NEXT_PAGES_SOURCE_EXTENSIONS.flatMap((extension) =>
    stems.map((stem) => `${stem}.${extension}`),
  )
  for (const candidate of tried) {
    signal?.throwIfAborted()
    if (await isUnlinkedRegularFile(workspace, candidate))
      return { kind: 'found', path: candidate, folder }
  }
  // Without a default-extension source, a file with a candidate's stem tells a custom pageExtensions apart from a gone page.
  for (const stem of stems) {
    const otherExtension = await findNextSourceWithOtherExtension(
      workspace,
      stem,
      signal,
    )
    if (otherExtension)
      return { kind: 'missing', folder, tried, otherExtension }
  }
  return { kind: 'missing', folder, tried }
}

/**
 * Reads the page path a compiled Pages path stands for (Next's normalized page path without its leading `/`); called by {@link findNextPagesSource}.
 * @param compiledPath - A Pages manifest value.
 * @returns The page path, e.g. `posts/[id]` for `pages/posts/[id].js` and `index` for `pages/index.js`.
 * @throws When the value is not under `pages/`, not `.js`, or has an empty, `.` or `..` segment, a backslash or a NUL.
 * @example
 * pagePathOfCompiled('pages/posts/[id].js') // => 'posts/[id]'
 */
function pagePathOfCompiled(compiledPath: string): string {
  const pagePath = compiledPath.slice('pages/'.length, -'.js'.length)
  if (
    !compiledPath.startsWith('pages/') ||
    !compiledPath.endsWith('.js') ||
    /[\\\0]/.test(compiledPath) ||
    pagePath
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    throw new Error('Compiled Pages path escapes the pages folder')
  return pagePath
}

/**
 * Lists the source stems of a page in Next's order (`getPagePaths`): the page file, then its folder's `index` file; a page path that already ends in `index` has only the first. Called by {@link findNextPagesSource}, which tries each stem with every extension in turn (all stems with `.tsx` first).
 * @param folder - The Pages folder.
 * @param pagePath - The normalized page path, e.g. `posts`, `index` (the root page) or `index/index` (the page `/index`).
 * @returns Workspace-relative stems without an extension, with `/` separators.
 * @example
 * pageSourceStems('pages', 'posts') // => ['pages/posts', 'pages/posts/index']
 * pageSourceStems('pages', 'index') // => ['pages/index']
 */
function pageSourceStems(
  folder: NextRouteFolder<'pages'>,
  pagePath: string,
): string[] {
  const page = denormalizedPagePathOf(pagePath)
  // Next keeps a normalized `…/index` path as one prefix: the folder's index file of the denormalized page.
  const prefixes =
    pagePath === 'index' || pagePath.endsWith('/index')
      ? [page ? `${page}/index` : 'index']
      : [page, `${page}/index`]
  return prefixes.map((prefix) => `${folder}/${prefix}`)
}

/**
 * Undoes Next's page path normalization (`denormalizePagePath`): `index` is the root page, and a static path under `index/` drops that first segment. Called by {@link pageSourceStems}.
 * @param pagePath - The normalized page path without its leading `/`.
 * @returns The page path without its leading `/`; the root page is the empty string.
 * @example
 * denormalizedPagePathOf('index')       // => ''
 * denormalizedPagePathOf('index/index') // => 'index'
 * denormalizedPagePathOf('index/[id]')  // => 'index/[id]'
 */
function denormalizedPagePathOf(pagePath: string): string {
  if (pagePath === 'index') return ''
  const isDynamic = pagePath
    .split('/')
    .some((segment) => segment.startsWith('[') && segment.endsWith(']'))
  return pagePath.startsWith('index/') && !isDynamic
    ? pagePath.slice('index/'.length)
    : pagePath
}
