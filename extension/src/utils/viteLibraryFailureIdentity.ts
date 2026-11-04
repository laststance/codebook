import type { ViteLibraryStopIdentity } from '../viteLibraryRefusals'

/** Separates a Vite library failure variant from the encoded identity of its stop (`vite-library-build-changed:<encoded>`). */
const IDENTITY_SEPARATOR = ':'

/**
 * Encodes the app, library and stop file of a Vite library refusal into the variant of a run's failure text.
 *
 * Why it exists: a library failure raised at an event or inside a tracked activity survives only as text, and the lead of that text allows no parenthesis and no line break in its variant, so the three fields are written as percent-encoded JSON with the parentheses escaped. Called by {@link viteLibraryFailureText}.
 * @param variant - The variant name (`vite-library-build-changed` or `lazy-import`).
 * @param identity - The app's package root, the library name and the stop file.
 * @returns The variant followed by `:` and the encoded identity.
 * @example
 * encodeViteLibraryVariant('lazy-import', { packageRoot: 'app', library: '@s/core', file: 'a.ts' }) // => 'lazy-import:%5B%22app%22%2C%22%40s%2Fcore%22%2C%22a.ts%22%5D'
 */
export function encodeViteLibraryVariant(
  variant: string,
  identity: ViteLibraryStopIdentity,
): string {
  const json = JSON.stringify([
    identity.packageRoot,
    identity.library,
    identity.file,
  ])
  // encodeURIComponent leaves parentheses alone; the failure lead cannot hold them.
  const encoded = encodeURIComponent(json)
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
  return `${variant}${IDENTITY_SEPARATOR}${encoded}`
}

/**
 * Reads the stop identity back from a variant written by {@link encodeViteLibraryVariant}.
 *
 * Why it exists: {@link refusalFailureOf} restores `details.packageRoot`, `details.library` and `details.file` of a library failure from its text, as the thrown refusal carries them.
 * @param variant - The variant of a failure text's lead.
 * @param expectedVariant - The variant name the identity must follow.
 * @returns The identity; `undefined` when the variant is another one, has no identity or holds one that is not three strings.
 * @example
 * decodeViteLibraryVariant(encodeViteLibraryVariant('lazy-import', identity), 'lazy-import') // => identity
 */
export function decodeViteLibraryVariant(
  variant: string | undefined,
  expectedVariant: string,
): ViteLibraryStopIdentity | undefined {
  const prefix = `${expectedVariant}${IDENTITY_SEPARATOR}`
  if (variant === undefined || !variant.startsWith(prefix)) return undefined
  try {
    const parsed: unknown = JSON.parse(
      decodeURIComponent(variant.slice(prefix.length)),
    )
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((field) => typeof field === 'string')
    ) {
      const [packageRoot, library, file] = parsed as [string, string, string]
      return { packageRoot, library, file }
    }
  } catch {
    // A variant that is not valid percent-encoded JSON restores no identity.
  }
  return undefined
}
