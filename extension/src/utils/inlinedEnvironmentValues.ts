import { isSecretName } from './isSecretName'

/**
 * Lists the settled environment values a run must mask: every secret-named value and every value whose name the dev server inlines into the bundle the run archives.
 *
 * Why it exists: react-scripts inlines `REACT_APP_*` and Expo inlines `EXPO_PUBLIC_*`, so the mask list needs the values the server settles, not the text of the files. Called by {@link launchReactScriptsDevelopmentServer} and {@link launchExpoWebDevelopmentServer}.
 * @param environment - The settled environment (the child's own with the `.env` files loaded over it).
 * @param inlinedName - Matches the names the server inlines.
 * @returns The values, in environment order.
 * @example inlinedEnvironmentValues({ EXPO_PUBLIC_A: 'x', PATH: '/bin' }, /^EXPO_PUBLIC_/i) // => ['x']
 */
export function inlinedEnvironmentValues(
  environment: Readonly<Record<string, string>>,
  inlinedName: RegExp,
): string[] {
  return Object.entries(environment)
    .filter(([name]) => isSecretName(name) || inlinedName.test(name))
    .map(([, value]) => value)
}
