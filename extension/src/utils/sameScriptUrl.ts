/** Placeholder that survives URL dot-segment collapsing so `..` depth stays in the identity. */
const PARENT_SEGMENT_PLACEHOLDER = '%00PARENT%00'

/**
 * Canonical identity of a script URL for {@link sameScriptUrl}.
 *
 * Why: `new URL(...).href` collapses `..` segments and drops the webpack layer
 * `(pages-dir-node)`, so a library module reached as `../../packages/q/a.js`
 * and `../../../packages/q/a.js`, or in the node and browser layers, looked
 * identical. `webpack-internal` URLs keep the layer and the module path as
 * written (only leading `./` is dropped); every other URL keeps `href`.
 *
 * @param url - Emitted or CDP script URL.
 * @returns Comparable identity string, or undefined when the URL is invalid.
 */
function scriptIdentity(url: string): string | undefined {
  try {
    const webpack = /^webpack-internal:\/\/\/(\([^)/]*\)\/)?(.*)$/s.exec(url)
    if (!webpack) return new URL(url).href
    const layer = webpack[1] ?? ''
    // Drop leading `./` (Chrome omits it) but never `../`
    const modulePath = webpack[2]!.replace(/^(?:\.\/)+/, '')
    const protectedPath = modulePath
      .split('/')
      .map((segment) =>
        segment === '..' ? PARENT_SEGMENT_PLACEHOLDER : segment,
      )
      .join('/')
    // Reuse URL percent-encoding so encoded and raw spellings stay equal
    const encoded = new URL(`webpack-internal:///${protectedPath}`).pathname
      .slice(1)
      .split(PARENT_SEGMENT_PLACEHOLDER)
      .join('..')
    return `webpack-internal:///${layer}${encoded}`
  } catch {
    return undefined
  }
}

/** Matches the full emitted/CDP script URL for {@link ConfiguredBrowserRun}, retaining target identity (webpack layer and `../` depth included) across URL normalization. @example sameScriptUrl('webpack-internal:///./theme.tsx', 'webpack-internal:///theme.tsx') // true */
export function sameScriptUrl(expected: string, actual: string): boolean {
  const left = scriptIdentity(expected)
  return left !== undefined && left === scriptIdentity(actual)
}
