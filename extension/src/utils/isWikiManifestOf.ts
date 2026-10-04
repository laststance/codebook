/**
 * Says whether a parsed JSON object carries a field with exactly this value, for the two fields {@link isWikiManifestOf} reads.
 * @param value - A parsed JSON object.
 * @param key - The field's name.
 * @param expected - The value the field must hold.
 * @returns `true` when the field exists and holds that value; `false` when it is absent or holds another.
 * @example
 * holdsField({ schemaVersion: 1 }, 'schemaVersion', 1) // => true
 */
function holdsField(value: object, key: string, expected: unknown): boolean {
  return key in value && Reflect.get(value, key) === expected
}

/**
 * Says whether a parsed Wiki manifest is one of this schema that names the opened project; called by the extension before the browser entry or an update uses a Wiki folder, so a generated page from another checkout does not pass for this project's Wiki.
 * @param manifest - What the manifest file parsed to.
 * @param projectRoot - Canonical opened project.
 * @returns `true` for a JSON object with `schemaVersion` 1 and this `repositoryRoot`; `false` for anything else, a manifest of another checkout among them.
 * @example
 * isWikiManifestOf({ schemaVersion: 1, repositoryRoot: '/repo' }, '/repo')  // => true
 * isWikiManifestOf({ schemaVersion: 1, repositoryRoot: '/other' }, '/repo') // => false
 */
export function isWikiManifestOf(
  manifest: unknown,
  projectRoot: string,
): boolean {
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    holdsField(manifest, 'schemaVersion', 1) &&
    holdsField(manifest, 'repositoryRoot', projectRoot)
  )
}
