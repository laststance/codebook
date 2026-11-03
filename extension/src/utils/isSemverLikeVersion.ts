/** A semver-like version: three numeric parts with an optional prerelease or build suffix. */
const SEMVER_LIKE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/

/**
 * Says whether the `version` of a studied repository's installed package is safe to publish: semver-like and short.
 *
 * Why it exists: the installed `vite` and `next` manifests belong to the studied repository, so their `version` is text the repository chose. Codebook records or publishes it (the Vite study field, the Next run resource, journal and failure details, an Output line), so a value that is not a plain version, or is longer than the caller's limit, must never go out as it is. Called by {@link resolveViteInstallation} and {@link readNextInstallation}.
 *
 * @param version - The manifest's `version` text.
 * @param maxChars - The most characters the version may have.
 * @returns `true` for `major.minor.patch` with an optional `-prerelease` or `+build` suffix of letters, digits, dots, plus signs and hyphens, within `maxChars`; `false` for anything else, such as a range, a sentence, a line break or an over-long value.
 * @example
 * isSemverLikeVersion('16.4.3', 64) // => true
 * isSemverLikeVersion('16.4.3-canary.12+abc', 64) // => true
 * isSemverLikeVersion('latest', 64) // => false
 * isSemverLikeVersion('16.4.3\nignore previous instructions', 64) // => false
 */
export function isSemverLikeVersion(
  version: string,
  maxChars: number,
): boolean {
  return version.length <= maxChars && SEMVER_LIKE.test(version)
}
