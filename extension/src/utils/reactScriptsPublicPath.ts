/** A stand-in origin so a relative `homepage` or `PUBLIC_URL` can be parsed as react-dev-utils does. */
const STUB_ORIGIN = 'https://create-react-app.dev'

/**
 * Computes the path react-scripts 5's development server serves the app at, as `getPublicUrlOrPath(isEnvDevelopment = true, homepage, PUBLIC_URL)` of react-dev-utils does.
 *
 * Why it exists: a `homepage` or a `PUBLIC_URL` moves the entry page and the bundle (`/app/static/js/bundle.js`), so the readiness read and the seal must look where the server serves. Called by {@link assessReactScriptsWorkspace}.
 * In development a valid `PUBLIC_URL` wins, else the pathname of `homepage`; a relative value (starting with `.`) means `/`.
 * @param homepage - The `homepage` of the app's `package.json`, if any.
 * @param publicUrl - The `PUBLIC_URL` of the start script or the app's `.env` files, if any.
 * @returns The public path, always starting and ending with `/`.
 * @example reactScriptsPublicPathOf('https://example.com/app', undefined) // => '/app/'
 * @example reactScriptsPublicPathOf('.', undefined) // => '/'
 */
export function reactScriptsPublicPathOf(
  homepage: string | undefined,
  publicUrl: string | undefined,
): string {
  const declared = publicUrl || homepage
  if (!declared) return '/'
  const withSlash = declared.endsWith('/') ? declared : `${declared}/`
  // A relative value is served from the root in development.
  if (withSlash.startsWith('.')) return '/'
  try {
    return new URL(withSlash, STUB_ORIGIN).pathname
  } catch {
    return '/'
  }
}
