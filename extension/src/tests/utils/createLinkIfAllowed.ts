import { symlink } from 'node:fs/promises'

/** Why a test of a link was skipped; printed in the test run's output. */
export const LINK_NOT_ALLOWED =
  'creating a symbolic link was refused with EPERM: this user lacks the right (on Windows: no administrator and no developer mode)'

/**
 * Creates a symbolic link for a test, and says so when this user may not: Windows refuses the creation with `EPERM` for a user without the privilege (an administrator and a user in developer mode have it).
 * @param targetPath - The file the link points to.
 * @param linkPath - Where the link is created.
 * @returns `true` when the link exists; `false` when the system refused it for a missing right, so the test skips with {@link LINK_NOT_ALLOWED} instead of failing.
 * @throws Every other error of the creation.
 * @example
 * if (!(await createLinkIfAllowed(targetPath, linkPath))) return context.skip(LINK_NOT_ALLOWED)
 */
export async function createLinkIfAllowed(
  targetPath: string,
  linkPath: string,
): Promise<boolean> {
  try {
    await symlink(targetPath, linkPath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM')
      return false
    throw error
  }
}
