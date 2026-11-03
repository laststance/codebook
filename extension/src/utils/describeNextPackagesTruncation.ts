import {
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  REPOSITORY_GIT_TIMEOUT_MS,
} from '../constants'

import type { NextPackageTruncationReason } from './scanNextPackages'

/** The limits are built from the discovery's constants so the sentence cannot drift from what the scan does. */
const REASON_WORDS: Record<NextPackageTruncationReason, string> = {
  limit: `more than ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT} Next apps matched, so only the first ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT} are listed`,
  'manifest-cap': `more than ${NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT} package.json files were found, so only the first ${NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT} were read`,
  deadline: `the ${REPOSITORY_GIT_TIMEOUT_MS / 1_000} second discovery deadline passed`,
  'skipped-path': `a package.json path was too long or held a control character, or a package.json could not be read safely (a link, a special file or a file over ${NEXT_PACKAGE_DISCOVERY_MANIFEST_BYTES / 1024} KiB)`,
  'git-failed': 'Git could not list the tracked files',
}

/** Says that a folder deeper than the scan reads is never listed, so a list that looks complete is not proof that no app lies deeper. */
export const NEXT_PACKAGE_DEPTH_SENTENCE = `Folders deeper than ${NEXT_PACKAGE_DISCOVERY_MAX_DEPTH} levels are not listed.`

/**
 * Words why the list of Next apps below the repository root is incomplete, for the root's `missing` (DX-14, DX-20).
 *
 * Called by {@link readStatusAdapterReadiness} when `packagesTruncated` is true and the root has no Next app. It states the scope too: only Git-tracked `package.json` files up to the discovery's depth are listed, and the recovery is to declare `packageRoot` from the repository's files, which the start then checks.
 *
 * @param reason - Why the discovery stopped.
 * @returns One sentence the chat can relay.
 * @example describeNextPackagesTruncation('deadline') // => 'The list of Next apps below the repository root is incomplete: the 5 second discovery deadline passed. …'
 */
export function describeNextPackagesTruncation(
  reason: NextPackageTruncationReason,
): string {
  return `The list of Next apps below the repository root is incomplete: ${REASON_WORDS[reason]}. Only Git-tracked package.json files are listed. ${NEXT_PACKAGE_DEPTH_SENTENCE} If the app the question names is not in packages, declare its packageRoot from the repository's files and let the start check it.`
}
