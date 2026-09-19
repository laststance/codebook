/** Matches the full emitted/CDP script URL for {@link ConfiguredBrowserRun}, retaining target identity across URL normalization. @example sameScriptUrl('webpack-internal:///./theme.tsx', 'webpack-internal:///theme.tsx') // true */
export function sameScriptUrl(expected: string, actual: string): boolean {
  try { return new URL(expected).href === new URL(actual).href; }
  catch { return false; }
}
