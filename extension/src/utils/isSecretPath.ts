import { isSecretName } from './isSecretName'

/**
 * Tells whether any step of a declared inspection path names a secret, so the value at the end of the path is masked.
 * Why: `session.user.id` lies inside a secret-named object; called by {@link inspectNodeTestVariables} and {@link inspectConfiguredValues}.
 * @param path - A declared path such as `user.accessToken`, `headers["set-cookie"]` or `items[0].id`.
 * @returns `true` when at least one step is a secret name ({@link isSecretName}).
 * @example
 * isSecretPath('auth.accessToken.length') // => true
 * isSecretPath('items[0].sortKey') // => false
 */
export function isSecretPath(path: string): boolean {
  // Steps are separated by dots, brackets, quotes and optional-chaining marks.
  return path.split(/[.[\]'"`?]+/).some((step) => isSecretName(step))
}
