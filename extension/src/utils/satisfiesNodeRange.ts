/** A parsed `major.minor.patch`. */
type Triplet = [number, number, number]

/** Reads `v20.19.0`, `20.19` or `20` as a triplet; `undefined` for anything else. */
function parseTriplet(text: string): Triplet | undefined {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(text)
  if (!match) return undefined
  const part = (value: string | undefined): number =>
    value === undefined || value === 'x' || value === '*' ? 0 : Number(value)
  return [part(match[1]), part(match[2]), part(match[3])]
}

/** Compares two triplets: negative when `left` is lower. */
function compareTriplets(left: Triplet, right: Triplet): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/** Whether a version satisfies one comparator (`^20.19.0`, `>=22.12.0`, `<25`, `~20.1.0`, `20.19.0`); `undefined` for syntax this reader does not know. */
function satisfiesComparator(
  comparator: string,
  version: Triplet,
): boolean | undefined {
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(comparator)
  const bound = match ? parseTriplet(match[2]!) : undefined
  if (!match || !bound) return undefined
  const order = compareTriplets(version, bound)
  switch (match[1]) {
    case '>=':
      return order >= 0
    case '>':
      return order > 0
    case '<=':
      return order <= 0
    case '<':
      return order < 0
    case '^':
      return order >= 0 && version[0] === bound[0]
    case '~':
      return order >= 0 && version[0] === bound[0] && version[1] === bound[1]
    default:
      return order === 0
  }
}

/**
 * Tells whether a Node version is inside an `engines.node` range, for the Node gate of {@link assessViteWorkspace}.
 *
 * Why it exists: the extension has no semver dependency and only the range forms package engines use are needed: `||` alternatives of space-separated comparators.
 * A range with syntax this reader does not know does not exclude the version, so an unusual range never blocks a start by itself.
 *
 * @param range - The `engines.node` text, such as `^20.19.0 || >=22.12.0`.
 * @param version - The running Node's version, such as `v24.22.1`.
 * @returns `false` only when every alternative is read and none contains the version.
 * @example
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v24.22.1') // => true
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v18.20.0') // => false
 */
export function satisfiesNodeRange(range: string, version: string): boolean {
  const running = parseTriplet(version)
  if (!running) return true
  let unknownSyntax = false
  for (const alternative of range.split('||')) {
    const results = alternative
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((comparator) => satisfiesComparator(comparator, running))
    if (results.includes(undefined)) {
      unknownSyntax = true
      continue
    }
    if (results.every(Boolean)) return true
  }
  return unknownSyntax
}
