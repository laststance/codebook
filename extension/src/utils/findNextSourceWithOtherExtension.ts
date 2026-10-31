import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Endings of files that can carry a page's stem but are never a page source: styles, declarations and source maps (`page.module.css`, `page.d.ts`, `page.js.map`). */
const NON_PAGE_ENDINGS = [
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.d.ts',
  '.map',
] as const

/** Name parts of test, spec and stories files that can carry a page's stem but are never a page source (`page.test.tsx`, `page.stories.tsx`). */
const NON_PAGE_INFIXES = ['.test.', '.spec.', '.stories.'] as const

/**
 * Finds a page source that Next reads only with a custom `pageExtensions`: a regular file beside a source candidate, with the candidate's stem and another extension (`page.mdx` beside the missing `page.tsx`), so a route whose source Codebook cannot read is told apart from a stale listing whose source is gone.
 * Called by {@link findNextPagesSource} for a Pages page without a `.tsx`, `.ts`, `.jsx` or `.js` source and by {@link nextAppPageSourceKindOf} for such an App page. The stem comes from untrusted manifest data: only a path of plain segments (no empty, `.` or `..` segment, no backslash or NUL) is looked at, its folder only when every component is a real folder reached without a link, and only a regular file in it counts. A style, declaration, source map, test, spec or stories file with the stem (`page.module.css`, `page.test.tsx`) is no page source ({@link isNonPageSuffix}), so it never keeps a gone page's listing from being called stale.
 * @param workspace - The opened workspace (the Next project root).
 * @param stem - The workspace-relative candidate without its extension, e.g. `app/about/page` or `src/pages/posts/index`.
 * @param signal - Ends the lookup with the abort reason when the run is cancelled.
 * @returns The workspace-relative path of the first such file in name order, e.g. `app/about/page.mdx`; `undefined` when none exists (only non-page files such as `page.module.css` carry the stem), its folder cannot be listed, or the stem is not a plain path.
 * @throws The abort reason when `signal` aborts before the folder is listed.
 * @example
 * await findNextSourceWithOtherExtension('/repo', 'app/about/page') // => 'app/about/page.mdx' in a project with app/about/page.mdx
 * await findNextSourceWithOtherExtension('/repo', 'pages/gone')     // => undefined when no pages/gone.* file exists
 * await findNextSourceWithOtherExtension('/repo', 'app/page')       // => undefined in a project whose app folder holds only page.module.css
 */
export async function findNextSourceWithOtherExtension(
  workspace: string,
  stem: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const segments = stem.split('/')
  if (
    segments.length < 2 ||
    /[\\\0]/.test(stem) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  )
    return undefined
  const folder = segments.slice(0, -1).join('/'),
    prefix = `${segments.at(-1)}.`
  if (!(await isUnlinkedFolder(workspace, folder))) return undefined
  signal?.throwIfAborted()
  const entries = await readdir(join(workspace, folder), {
    withFileTypes: true,
  }).catch(() => [])
  // A link or a folder with the stem's name is no source, nor is a style, test or other non-page file; the folder itself was reached without a link.
  const name = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        !isNonPageSuffix(entry.name.slice(prefix.length - 1)),
    )
    .map((entry) => entry.name)
    .sort()[0]
  return name === undefined ? undefined : `${folder}/${name}`
}

/**
 * Says whether the part of a file name after a page's stem marks a file that sits beside pages but is never one: a style, declaration or source map ending ({@link NON_PAGE_ENDINGS}) or a test, spec or stories part ({@link NON_PAGE_INFIXES}); called by {@link findNextSourceWithOtherExtension} for each file with the stem.
 * Only the part after the stem is read, so a stem whose own name holds `.test.` (`pages/a.test`, the page `/a.test`) still finds its `a.test.mdx`.
 * @param suffix - The file name after the stem, from its first dot, e.g. `.module.css` for `page.module.css`.
 * @returns Whether the file is no page source.
 * @example
 * isNonPageSuffix('.module.css') // => true
 * isNonPageSuffix('.test.tsx')   // => true
 * isNonPageSuffix('.mdx')        // => false
 */
function isNonPageSuffix(suffix: string): boolean {
  return (
    NON_PAGE_ENDINGS.some((ending) => suffix.endsWith(ending)) ||
    NON_PAGE_INFIXES.some((infix) => suffix.includes(infix))
  )
}

/**
 * Says whether every component of a workspace-relative path is a real folder, none of them a link, asking only `lstat` one component at a time, as {@link isUnlinkedRegularFile} does; called by {@link findNextSourceWithOtherExtension} before it lists the folder, so no listing ever passes a link.
 * The walk stops at the first component that is missing, no folder or a link, so a deep stem from untrusted manifest data costs one `lstat` per component up to there, never one per prefix of the whole path at once.
 * @param workspace - The opened workspace.
 * @param relativePath - A workspace-relative folder with `/` separators.
 * @returns `true` when each component is a folder that is no link; `false` otherwise, also when a component cannot be read.
 * @example
 * await isUnlinkedFolder('/repo', 'src/pages')     // => true for a real src/pages folder
 * await isUnlinkedFolder('/repo', 'pages/a/b/c/d') // => false after two lstat calls when pages/a is missing
 */
async function isUnlinkedFolder(
  workspace: string,
  relativePath: string,
): Promise<boolean> {
  let current = workspace
  for (const component of relativePath.split('/')) {
    current = join(current, component)
    const status = await lstat(current).catch(() => undefined)
    // `lstat` never follows a link, so a linked component reads as no folder and ends the walk with a missing or file one.
    if (!status?.isDirectory()) return false
  }
  return true
}
