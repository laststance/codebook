import { runOpenedFolderGit } from './runOpenedFolderGit'

/** How long Git may take to read one remote. */
const ORIGIN_READ_TIMEOUT_MS = 5_000

/** The largest answer of `git remote get-url`: a URL is far shorter. */
const ORIGIN_READ_MAX_BUFFER_BYTES = 8 * 1024

/**
 * Reads the URL of the opened repository's `origin` remote through the hardened opened-folder Git invocation.
 *
 * Why it exists: a `node-script` run without `library` discloses the installed copies of the repository's own packages, and it compares each copy's `repository` with this URL ({@link listRepositoryPackageCopies}).
 * Called by the product dependencies of a `node-script` run before it lists installed copies.
 * @param repositoryRoot - The opened repository's root.
 * @returns The `origin` URL, or `null` when the repository has no `origin` remote or Git could not answer.
 * @example
 * await readRepositoryOrigin('/repo') // => 'https://github.com/acme/tool.git'
 */
export async function readRepositoryOrigin(
  repositoryRoot: string,
): Promise<string | null> {
  try {
    const output = await runOpenedFolderGit(
      repositoryRoot,
      ['remote', 'get-url', 'origin'],
      {
        timeoutMs: ORIGIN_READ_TIMEOUT_MS,
        maxBuffer: ORIGIN_READ_MAX_BUFFER_BYTES,
      },
    )
    const url = output.trim()
    return url === '' ? null : url
  } catch {
    // No origin remote (or no Git) lists nothing.
    return null
  }
}
