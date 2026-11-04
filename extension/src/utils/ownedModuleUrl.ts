/**
 * Joins the owned Vite origin and a served module path, or says the path is not a module of that origin.
 *
 * Why it exists: a library module path comes from the launcher's walk, and `${origin}${path}` would let a path such as `@evil.test/x` or `//evil.test/x` point the fetch at another host. Called by {@link createViteLibraryModuleSource} before every fetch, by {@link selectViteLibraryCandidate} to skip paths that are not library modules, and by {@link sealViteLibraryStop} for the sealed address.
 * @param ownedOrigin - The origin the ready Vite server reported.
 * @param modulePath - The served path with its query, as the walk listed it.
 * @returns The absolute address, or `undefined` when the path does not start with a single `/` or resolves to another origin.
 * @example
 * ownedModuleUrl('http://127.0.0.1:4321', '/@fs/r/a.js?v=1') // => 'http://127.0.0.1:4321/@fs/r/a.js?v=1'
 * ownedModuleUrl('http://127.0.0.1:4321', '//evil.test/a.js') // => undefined
 */
export function ownedModuleUrl(
  ownedOrigin: string,
  modulePath: string,
): string | undefined {
  // A path must be absolute and not scheme-relative (`//host`) or backslash-relative (`/\host`).
  if (!/^\/(?![/\\])/.test(modulePath)) return undefined
  const url = `${ownedOrigin}${modulePath}`
  // The parsed origin must still be the owned one.
  return URL.canParse(url) &&
    new URL(url).origin === new URL(ownedOrigin).origin
    ? url
    : undefined
}
