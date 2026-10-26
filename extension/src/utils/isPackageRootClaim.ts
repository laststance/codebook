import type {
  NodeTestRootClaim,
  PackageRootClaim,
} from './decideNodeTestRootClaim'

/** Every root claim that leaves a run in its package; typed as a record so a new package claim of {@link PackageRootClaim} cannot be left out. */
const PACKAGE_ROOT_CLAIMS: Record<PackageRootClaim, true> = {
  'not-selected': true,
  'several-projects': true,
  'listing-failed': true,
}

/**
 * Tells whether a plan's root claim was made and left the run in its package, so the launch asks the opened root again before its package listing.
 * Called by {@link prepareNodeTestLaunch}; a `selected-once` run already lists from the root at launch, and a `not-applicable` run made no claim.
 * @param rootClaim - The plan's `summary.rootClaim`.
 * @returns `true` for `not-selected`, `several-projects` and `listing-failed`; `false` for `selected-once` and `not-applicable`.
 * @example
 * isPackageRootClaim('not-selected')   // => true
 * isPackageRootClaim('selected-once')  // => false
 */
export function isPackageRootClaim(
  rootClaim: NodeTestRootClaim,
): rootClaim is PackageRootClaim {
  return Object.hasOwn(PACKAGE_ROOT_CLAIMS, rootClaim)
}
