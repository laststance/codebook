import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Finds a page source that Next reads only with a custom `pageExtensions`: a regular file beside a source candidate, with the candidate's stem and another extension (`page.mdx` beside the missing `page.tsx`), so a route whose source Codebook cannot read is told apart from a stale listing whose source is gone.
 * Called by {@link findNextPagesSource} for a Pages page without a `.tsx`, `.ts`, `.jsx` or `.js` source and by {@link nextAppPageSourceKindOf} for such an App page. The stem comes from untrusted manifest data: only a path of plain segments (no empty, `.` or `..` segment, no backslash or NUL) is looked at, its folder only when every component is a real folder reached without a link, and only a regular file in it counts.
 * @param workspace - The opened workspace (the Next project root).
 * @param stem - The workspace-relative candidate without its extension, e.g. `app/about/page` or `src/pages/posts/index`.
 * @param signal - Ends the lookup with the abort reason when the run is cancelled.
 * @returns The workspace-relative path of the first such file in name order, e.g. `app/about/page.mdx`; `undefined` when none exists, its folder cannot be listed, or the stem is not a plain path.
 * @throws The abort reason when `signal` aborts before the folder is listed.
 * @example
 * await findNextSourceWithOtherExtension('/repo', 'app/about/page') // => 'app/about/page.mdx' in a project with app/about/page.mdx
 * await findNextSourceWithOtherExtension('/repo', 'pages/gone')     // => undefined when no pages/gone.* file exists
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
  // A link or a folder with the stem's name is no source; the folder itself was reached without a link.
  const name = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()[0]
  return name === undefined ? undefined : `${folder}/${name}`
}

/**
 * Says whether every component of a workspace-relative path is a real folder, none of them a link, asking only `lstat`; called by {@link findNextSourceWithOtherExtension} before it lists the folder, so no listing ever passes a link.
 * @param workspace - The opened workspace.
 * @param relativePath - A workspace-relative folder with `/` separators.
 * @returns `true` when each component is a folder that is no link; `false` otherwise, also when a component cannot be read.
 * @example
 * await isUnlinkedFolder('/repo', 'src/pages') // => true for a real src/pages folder
 */
async function isUnlinkedFolder(
  workspace: string,
  relativePath: string,
): Promise<boolean> {
  const components = relativePath.split('/')
  const statuses = await Promise.all(
    components.map((_, index) =>
      lstat(join(workspace, ...components.slice(0, index + 1))).catch(
        () => undefined,
      ),
    ),
  )
  return statuses.every((status) => status?.isDirectory() === true)
}
