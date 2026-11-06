/** The longest name npm accepts, scope included. */
const NPM_PACKAGE_NAME_MAX_LENGTH = 214

/** One name part: starts with a letter or digit, then letters, digits, `.`, `_`, `~` or `-` (no control characters, no `/`, no leading dot). */
const NAME_PART = '[A-Za-z0-9][A-Za-z0-9._~-]*'
const NPM_PACKAGE_NAME = new RegExp(`^(?:@${NAME_PART}/)?${NAME_PART}$`)

/**
 * Says whether a text has the shape of an npm package name: an optional `@scope/` and a name, at most 214 characters, with no control characters, spaces, extra path separators or leading dots.
 *
 * Why it exists: a library's `package.json` name becomes a folder name in the pack extraction and the hook paths, and is quoted in the dialog and the history header, so a name that is not a plain package name must never reach them.
 * Called by {@link assertLibraryRouteSupported} (refuses as `not-a-package`) and {@link readLibraryPackageName} (falls back to the declared folder).
 * @param value - The `name` field read from a `package.json`.
 * @returns `true` when the text is a valid package name shape.
 * @example
 * isNpmPackageName('@reduxjs/toolkit') // => true
 * isNpmPackageName('../evil')          // => false
 */
export function isNpmPackageName(value: string): boolean {
  return (
    value.length <= NPM_PACKAGE_NAME_MAX_LENGTH && NPM_PACKAGE_NAME.test(value)
  )
}
