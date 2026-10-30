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

/** Splits a range into its `||` alternatives, each a list of comparator texts. */
function alternativesOf(range: string): string[][] {
  return range
    .split('||')
    .map((alternative) => alternative.trim().split(/\s+/).filter(Boolean))
}

/**
 * Tells whether every comparator of an `engines.node` range is syntax this reader knows, for the refusal of {@link readViteWorkspaceGaps} that names a range it cannot judge.
 *
 * @param range - The `engines.node` text, such as `>=18 <=bad`.
 * @returns `false` when the range is empty or any comparator is unknown, so {@link satisfiesNodeRange} cannot judge it.
 * @example
 * isReadableNodeRange('^20.19.0 || >=22.12.0') // => true
 * isReadableNodeRange('>=18 <=bad') // => false
 */
export function isReadableNodeRange(range: string): boolean {
  const alternatives = alternativesOf(range)
  return alternatives.every(
    (comparators) =>
      comparators.length > 0 &&
      // The parse of a comparator does not depend on the version, so any fixed version tells known from unknown syntax.
      comparators.every(
        (comparator) =>
          satisfiesComparator(comparator, [0, 0, 0]) !== undefined,
      ),
  )
}

/**
 * Tells whether a Node version is inside an `engines.node` range, for the Node gate of {@link readViteWorkspaceGaps}.
 *
 * Why it exists: the extension has no semver dependency and only the range forms package engines use are needed: `||` alternatives of space-separated comparators (`>=`, `>`, `<=`, `<`, `^`, `~`, `=` or a bare version).
 * A range with syntax this reader does not know contains no version, so the gate refuses it and names it (see {@link isReadableNodeRange}) instead of letting an unusual range pass unchecked.
 *
 * @param range - The `engines.node` text, such as `^20.19.0 || >=22.12.0`.
 * @param version - The running Node's version, such as `v24.22.1`.
 * @returns `true` only when the whole range is read and one alternative contains the version.
 * @example
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v24.22.1') // => true
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v18.20.0') // => false
 * satisfiesNodeRange('>=18 <=bad', 'v24.22.1') // => false
 */
export function satisfiesNodeRange(range: string, version: string): boolean {
  const running = parseTriplet(version)
  if (!running || !isReadableNodeRange(range)) return false
  return alternativesOf(range).some((comparators) =>
    comparators.every(
      (comparator) => satisfiesComparator(comparator, running) === true,
    ),
  )
}
