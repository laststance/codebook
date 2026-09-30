/** Finds the selected Next page in its generated route map without evaluating manifests or inventing a source route. @example resolveNextClientManifest({'/login/page':'app/login/page.js'}, '/login').key // '/login/page' */
export function resolveNextClientManifest(
  routes: Record<string, string>,
  entryPath: string,
): { key: string; path: string } {
  const requested = new URL(entryPath, 'http://codebook.invalid').pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  const candidates: { key: string; path: string; score: number }[] = []
  for (const [key, path] of Object.entries(routes)) {
    if (
      !key.endsWith('/page') ||
      !path.startsWith('app/') ||
      !path.endsWith('/page.js') ||
      path.includes('\\') ||
      path.split('/').some((segment) => segment === '..' || segment === '.')
    )
      continue
    const segments = key
      .slice(0, -'/page'.length)
      .split('/')
      .filter(
        (segment) =>
          segment && !(segment.startsWith('(') && segment.endsWith(')')),
      )
    let offset = 0,
      score = 0,
      matched = true
    for (const segment of segments) {
      if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        offset = requested.length
        score -= 2
        break
      }
      if (segment.startsWith('[...') && segment.endsWith(']')) {
        matched = offset < requested.length
        offset = requested.length
        score--
        break
      }
      if (segment.startsWith('[') && segment.endsWith(']')) {
        if (offset >= requested.length) {
          matched = false
          break
        }
        offset++
        continue
      }
      if (segment !== requested[offset++]) {
        matched = false
        break
      }
      score++
    }
    if (matched && offset === requested.length)
      candidates.push({
        key,
        path: `.next/dev/server/${path.slice(0, -'.js'.length)}_client-reference-manifest.js`,
        score,
      })
  }
  candidates.sort((left, right) => right.score - left.score)
  const first = candidates[0]
  if (!first || candidates[1]?.score === first.score)
    throw new Error(
      'Selected route has no unique compiled Next page. Check its path and redirects.',
    )
  return { key: first.key, path: first.path }
}
