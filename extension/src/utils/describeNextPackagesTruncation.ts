import type { NextPackageTruncationReason } from './scanNextPackages'

const REASON_WORDS: Record<NextPackageTruncationReason, string> = {
  limit: 'more than 50 Next apps matched, so only the first 50 are listed',
  'manifest-cap':
    'more than 500 package.json files were found, so only the first 500 were read',
  deadline: 'the 5 second discovery deadline passed',
  'skipped-path':
    'a package.json path was too long or held a control character, or a package.json could not be read safely (a link, a special file or a file over 256 KiB)',
  'git-failed': 'Git could not list the tracked files',
}

/**
 * Words why the list of Next apps below the repository root is incomplete, for the root's `missing` (DX-14, DX-20).
 *
 * Called by {@link readStatusAdapterReadiness} when `packagesTruncated` is true and the root has no Next app. It states the scope too: only Git-tracked `package.json` files are listed, and the recovery is to declare `packageRoot` from the repository's files, which the start then checks.
 *
 * @param reason - Why the discovery stopped.
 * @returns One sentence the chat can relay.
 * @example describeNextPackagesTruncation('deadline') // => 'The list of Next apps below the repository root is incomplete: the 5 second discovery deadline passed. …'
 */
export function describeNextPackagesTruncation(
  reason: NextPackageTruncationReason,
): string {
  return `The list of Next apps below the repository root is incomplete: ${REASON_WORDS[reason]}. Only Git-tracked package.json files are listed; if the app the question names is not in packages, declare its packageRoot from the repository's files and let the start check it.`
}
