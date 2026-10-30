/** A parsed `major.minor.patch`. */
type Triplet = [number, number, number]

/** A partial version as a range writes it: `20`, `20.x`, `20.19`, `20.19.x`, `20.19.0`, `*`; a wildcard or missing part is `undefined`, and so is every part after it. */
type PartialVersion = {
  major: number | undefined
  minor: number | undefined
  patch: number | undefined
}

/** The versions one comparator accepts: from `lower` (inclusive) to `upper` (exclusive); a missing bound is open, and `empty` accepts nothing. */
type Bounds = { lower?: Triplet; upper?: Triplet; empty?: boolean }

/** Reads a full running version such as `v20.19.0`; `undefined` for anything else. */
function parseTriplet(text: string): Triplet | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Reads `20`, `20.x`, `20.19.*`, `v20.19.0`, `*` or `x` as a partial version; `undefined` for anything else. */
function parsePartial(text: string): PartialVersion | undefined {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(text)
  if (!match) return undefined
  const parts = [match[1], match[2], match[3]].map((part) =>
    part === undefined || /^[xX*]$/.test(part) ? undefined : Number(part),
  )
  // A wildcard makes every later part a wildcard too (`1.x.3` reads as `1.x`).
  const wildcardAt = parts.findIndex((part) => part === undefined)
  const cleaned = parts.map((part, index) =>
    wildcardAt !== -1 && index >= wildcardAt ? undefined : part,
  )
  return { major: cleaned[0], minor: cleaned[1], patch: cleaned[2] }
}

/** The lowest version a partial version names: missing parts are zero. */
function lowestOf(partial: PartialVersion): Triplet {
  return [partial.major ?? 0, partial.minor ?? 0, partial.patch ?? 0]
}

/** The first version after every version a partial version names (`20` → `21.0.0`, `20.19` → `20.20.0`, `20.19.0` → `20.19.1`); `undefined` for `*`, which has no end. */
function afterOf(partial: PartialVersion): Triplet | undefined {
  if (partial.major === undefined) return undefined
  if (partial.minor === undefined) return [partial.major + 1, 0, 0]
  if (partial.patch === undefined) return [partial.major, partial.minor + 1, 0]
  return [partial.major, partial.minor, partial.patch + 1]
}

/** The first version a caret range excludes (`^20.1` → `21.0.0`, `^0.2.3` → `0.3.0`, `^0.0.3` → `0.0.4`), following npm's semver. */
function caretUpperOf(partial: PartialVersion): Triplet | undefined {
  const { major, minor, patch } = partial
  if (major === undefined) return undefined
  if (major > 0 || minor === undefined) return [major + 1, 0, 0]
  if (minor > 0 || patch === undefined) return [0, minor + 1, 0]
  return [0, 0, patch + 1]
}

/** The first version a tilde range excludes (`~20` → `21.0.0`, `~20.1.0` → `20.2.0`). */
function tildeUpperOf(partial: PartialVersion): Triplet | undefined {
  if (partial.major === undefined) return undefined
  if (partial.minor === undefined) return [partial.major + 1, 0, 0]
  return [partial.major, partial.minor + 1, 0]
}

/** Reads one comparator (`^20.19.0`, `>=22.12.0`, `<25`, `~20.1.0`, `20.x`, `20.19.0`, `*`) as the versions it accepts; `undefined` for syntax this reader does not know. */
function boundsOfComparator(comparator: string): Bounds | undefined {
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(comparator)
  const partial = match ? parsePartial(match[2]!) : undefined
  if (!match || !partial) return undefined
  const after = afterOf(partial)
  switch (match[1]) {
    case '>=':
      return { lower: lowestOf(partial) }
    // `>20` means from 21.0.0 on, `>*` nothing.
    case '>':
      return after ? { lower: after } : { empty: true }
    case '<=':
      return after ? { upper: after } : {}
    // `<*` accepts nothing.
    case '<':
      return partial.major === undefined
        ? { empty: true }
        : { upper: lowestOf(partial) }
    case '^':
      return { lower: lowestOf(partial), upper: caretUpperOf(partial) }
    case '~':
      return { lower: lowestOf(partial), upper: tildeUpperOf(partial) }
    default:
      return { lower: lowestOf(partial), upper: after }
  }
}

/** Reads `20.19.0 - 22` as the versions from the first to the last, the last one partial (`22` ends before `23.0.0`); `undefined` when either end is unknown syntax. */
function boundsOfHyphen(from: string, to: string): Bounds | undefined {
  const start = parsePartial(from)
  const end = parsePartial(to)
  if (!start || !end) return undefined
  return { lower: lowestOf(start), upper: afterOf(end) }
}

/** Compares two triplets: negative when `left` is lower. */
function compareTriplets(left: Triplet, right: Triplet): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/** Whether a version is inside bounds. */
function isInside(bounds: Bounds, version: Triplet): boolean {
  if (bounds.empty) return false
  if (bounds.lower && compareTriplets(version, bounds.lower) < 0) return false
  if (bounds.upper && compareTriplets(version, bounds.upper) >= 0) return false
  return true
}

/** Splits a range into its `||` alternatives, each a list of comparator texts (a hyphen range keeps its `-` as a token). */
function alternativesOf(range: string): string[][] {
  return range
    .split('||')
    .map((alternative) => alternative.trim().split(/\s+/).filter(Boolean))
}

/** Reads one alternative as the bounds every one of its parts must satisfy; `undefined` when any part is unknown syntax or the alternative is empty. */
function boundsOfAlternative(comparators: string[]): Bounds[] | undefined {
  if (comparators.length === 0) return undefined
  // A hyphen range is the whole alternative: `from - to`.
  if (comparators.includes('-')) {
    const [from, hyphen, to] = comparators
    const bounds =
      comparators.length === 3 && hyphen === '-' && from && to
        ? boundsOfHyphen(from, to)
        : undefined
    return bounds ? [bounds] : undefined
  }
  const bounds = comparators.map(boundsOfComparator)
  return bounds.every((entry) => entry !== undefined) ? bounds : undefined
}

/**
 * Tells whether every part of an `engines.node` range is syntax this reader knows, for the refusal of {@link readViteWorkspaceGaps} that names a range it cannot judge.
 *
 * @param range - The `engines.node` text, such as `>=18 <=bad`.
 * @returns `false` when the range is empty or any part is unknown, so {@link satisfiesNodeRange} cannot judge it.
 * @example
 * isReadableNodeRange('^20.19.0 || >=22.12.0') // => true
 * isReadableNodeRange('20.x || 22.0.0 - 24') // => true
 * isReadableNodeRange('>=18 <=bad') // => false
 */
export function isReadableNodeRange(range: string): boolean {
  return alternativesOf(range).every(
    (comparators) => boundsOfAlternative(comparators) !== undefined,
  )
}

/**
 * Tells whether a Node version is inside an `engines.node` range, for the Node gate of {@link readViteWorkspaceGaps}.
 *
 * Why it exists: the extension has no semver dependency and only the range forms package engines use are needed: `||` alternatives of space-separated comparators (`>=`, `>`, `<=`, `<`, `^`, `~`, `=` or a bare version), partial versions and x-ranges (`20`, `20.x`, `20.19.x`, `*`) and hyphen ranges (`20.19.0 - 22`), read as npm's semver reads them (prerelease tags are not read).
 * A range with syntax this reader does not know contains no version, so the gate refuses it and names it (see {@link isReadableNodeRange}) instead of letting an unusual range pass unchecked.
 *
 * @param range - The `engines.node` text, such as `^20.19.0 || >=22.12.0`.
 * @param version - The running Node's version, such as `v24.22.1`.
 * @returns `true` only when the whole range is read and one alternative contains the version.
 * @example
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v24.22.1') // => true
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v18.20.0') // => false
 * satisfiesNodeRange('20.x', 'v20.19.0') // => true
 * satisfiesNodeRange('20.19.0 - 22', 'v22.5.0') // => true
 * satisfiesNodeRange('>=18 <=bad', 'v24.22.1') // => false
 */
export function satisfiesNodeRange(range: string, version: string): boolean {
  const running = parseTriplet(version)
  if (!running || !isReadableNodeRange(range)) return false
  return alternativesOf(range).some((comparators) =>
    (boundsOfAlternative(comparators) ?? []).every((bounds) =>
      isInside(bounds, running),
    ),
  )
}
