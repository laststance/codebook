/** A parsed `major.minor.patch`. */
type Triplet = [number, number, number]

/** A version with the prerelease tag semver orders below its release (`25.0.0-rc.1` is below `25.0.0`); build metadata is dropped because it never affects order. */
type Version = { core: Triplet; prerelease: string[] }

/** A partial version as a range writes it: `20`, `20.x`, `20.19`, `20.19.x`, `20.19.0`, `20.19.0-0`, `*`; a wildcard or missing part is `undefined`, and so is every part after it. A prerelease tag is only read on a full triplet. */
type PartialVersion = {
  major: number | undefined
  minor: number | undefined
  patch: number | undefined
  prerelease: string[]
}

/** The versions one comparator accepts, from `lower` to `upper` (each exclusive unless flagged); a missing bound is open, and `empty` accepts nothing. `prereleaseOf` is the triplet of a prerelease the comparator names, which is what lets a prerelease version of that triplet in (semver's rule). */
type Bounds = {
  lower?: Version
  lowerExclusive?: boolean
  upper?: Version
  upperInclusive?: boolean
  empty?: boolean
  prereleaseOf?: Triplet
}

/** The prerelease tag that sorts below every other tag, so {@link upperBefore} ends a range before any prerelease of its first excluded release (`<25` is `<25.0.0-0`). */
const LOWEST_PRERELEASE = '0'

const VERSION_PATTERN =
  /^[=v]*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/**
 * Reads a full running version such as `v20.19.0` or `v25.0.0-nightly2026`, with an optional prerelease tag and build tag.
 *
 * Why it exists: Node's nightly and release-candidate builds report such versions; semver orders a prerelease below its release.
 *
 * @param text - The running Node's version text.
 * @returns The version, or `undefined` for anything else.
 * @example
 * parseVersion('v25.0.0-rc.1') // => { core: [25, 0, 0], prerelease: ['rc', '1'] }
 */
function parseVersion(text: string): Version | undefined {
  const match = VERSION_PATTERN.exec(text)
  if (!match) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/**
 * Tells whether a running Node version can be placed in an `engines.node` range at all.
 *
 * Called by {@link readViteWorkspaceGaps} so an unreadable version gets its own sentence instead of the one saying the range excludes it.
 *
 * @param version - The running Node's version text.
 * @returns `true` for `major.minor.patch` with an optional prerelease or build tag.
 * @example
 * isReadableNodeVersion('v25.0.0-nightly20261030') // => true
 * isReadableNodeVersion('node-latest') // => false
 */
export function isReadableNodeVersion(version: string): boolean {
  return parseVersion(version) !== undefined
}

/**
 * Reads `20`, `20.x`, `20.19.*`, `v20.19.0`, `20.19.0-0` or `*` as a partial version.
 *
 * Why it exists: every comparator of a range writes its version as a partial version; {@link boundsOfComparator} and {@link boundsOfHyphen} call it first.
 *
 * @param text - One version as written in a range, without its operator.
 * @returns The parts, `undefined` for wildcards, or `undefined` for anything else.
 * @example
 * parsePartial('20.x') // => { major: 20, minor: undefined, patch: undefined, prerelease: [] }
 * parsePartial('20.19.0-0') // => { major: 20, minor: 19, patch: 0, prerelease: ['0'] }
 */
function parsePartial(text: string): PartialVersion | undefined {
  const full = parseVersion(text)
  if (full)
    return {
      major: full.core[0],
      minor: full.core[1],
      patch: full.core[2],
      prerelease: full.prerelease,
    }
  const match = /^[=v]*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(
    text,
  )
  if (!match) return undefined
  const parts = [match[1], match[2], match[3]].map((part) =>
    part === undefined || /^[xX*]$/.test(part) ? undefined : Number(part),
  )
  // A wildcard makes every later part a wildcard too (`1.x.3` reads as `1.x`).
  const wildcardAt = parts.findIndex((part) => part === undefined)
  const cleaned = parts.map((part, index) =>
    wildcardAt !== -1 && index >= wildcardAt ? undefined : part,
  )
  return {
    major: cleaned[0],
    minor: cleaned[1],
    patch: cleaned[2],
    prerelease: [],
  }
}

/**
 * Names the lowest version a partial version stands for, missing parts being zero.
 *
 * Called by {@link boundsOfPartial} and {@link boundsOfHyphen} for the inclusive lower end of a range.
 *
 * @param partial - The partial version.
 * @returns The lowest version it names, keeping its prerelease tag.
 * @example
 * lowestOf(parsePartial('20.19')!) // => { core: [20, 19, 0], prerelease: [] }
 */
function lowestOf(partial: PartialVersion): Version {
  return {
    core: [partial.major ?? 0, partial.minor ?? 0, partial.patch ?? 0],
    prerelease: partial.prerelease,
  }
}

/**
 * Names the first release after every version a partial version names.
 *
 * Called by {@link boundsOfPartial} for `>`, `<=`, a bare version and by {@link boundsOfHyphen} for the end of a hyphen range.
 *
 * @param partial - The partial version.
 * @returns `20` gives `21.0.0`, `20.19` gives `20.20.0`, `20.19.0` gives `20.19.1`; `undefined` for `*`, which has no end.
 * @example
 * afterOf(parsePartial('20.19')!) // => [20, 20, 0]
 */
function afterOf(partial: PartialVersion): Triplet | undefined {
  if (partial.major === undefined) return undefined
  if (partial.minor === undefined) return [partial.major + 1, 0, 0]
  if (partial.patch === undefined) return [partial.major, partial.minor + 1, 0]
  return [partial.major, partial.minor, partial.patch + 1]
}

/**
 * Names the first release a caret range excludes, following npm's semver.
 *
 * Called by {@link boundsOfPartial} for `^` comparators.
 *
 * @param partial - The partial version after the caret.
 * @returns `^20.1` gives `21.0.0`, `^0.2.3` gives `0.3.0`, `^0.0.3` gives `0.0.4`; `undefined` for `^*`.
 * @example
 * caretUpperOf(parsePartial('0.2.3')!) // => [0, 3, 0]
 */
function caretUpperOf(partial: PartialVersion): Triplet | undefined {
  const { major, minor, patch } = partial
  if (major === undefined) return undefined
  if (major > 0 || minor === undefined) return [major + 1, 0, 0]
  if (minor > 0 || patch === undefined) return [0, minor + 1, 0]
  return [0, 0, patch + 1]
}

/**
 * Names the first release a tilde range excludes.
 *
 * Called by {@link boundsOfPartial} for `~` comparators.
 *
 * @param partial - The partial version after the tilde.
 * @returns `~20` gives `21.0.0`, `~20.1.0` gives `20.2.0`; `undefined` for `~*`.
 * @example
 * tildeUpperOf(parsePartial('20.1.0')!) // => [20, 2, 0]
 */
function tildeUpperOf(partial: PartialVersion): Triplet | undefined {
  if (partial.major === undefined) return undefined
  if (partial.minor === undefined) return [partial.major + 1, 0, 0]
  return [partial.major, partial.minor + 1, 0]
}

/**
 * Makes the exclusive upper end that also excludes every prerelease of a release, as semver ends `<25` and `^20` (`<25.0.0-0`).
 *
 * Called by {@link boundsOfPartial} and {@link boundsOfHyphen}.
 *
 * @param release - The first excluded release, or `undefined` when the range has no end.
 * @returns Bounds with that upper end, or open bounds.
 * @example
 * upperBefore([25, 0, 0]) // => { upper: { core: [25, 0, 0], prerelease: ['0'] } }
 */
function upperBefore(release: Triplet | undefined): Bounds {
  return release
    ? { upper: { core: release, prerelease: [LOWEST_PRERELEASE] } }
    : {}
}

/**
 * Gives the bounds of one operator applied to a parsed partial version, with semver's meaning.
 *
 * Called by {@link boundsOfComparator} once the comparator is split into operator and version.
 *
 * @param operator - `^`, `~`, `>=`, `<=`, `>`, `<`, `=` or `undefined` for a bare version.
 * @param partial - The version after the operator.
 * @returns The accepted versions.
 * @example
 * boundsOfPartial('>=', parsePartial('22.12.0')!) // => { lower: { core: [22, 12, 0], prerelease: [] } }
 */
function boundsOfPartial(
  operator: string | undefined,
  partial: PartialVersion,
): Bounds {
  const after = afterOf(partial)
  const lowest = lowestOf(partial)
  const hasPrerelease = partial.prerelease.length > 0
  switch (operator) {
    case '>=':
      return { lower: lowest }
    // `>20` means from 21.0.0 on, `>*` nothing; `>20.19.0-rc.1` is strictly above that version.
    case '>':
      if (hasPrerelease) return { lower: lowest, lowerExclusive: true }
      return after
        ? { lower: { core: after, prerelease: [] } }
        : { empty: true }
    case '<=':
      if (hasPrerelease) return { upper: lowest, upperInclusive: true }
      return upperBefore(after)
    // `<*` accepts nothing; `<20` ends before any 20.0.0 prerelease.
    case '<':
      if (partial.major === undefined) return { empty: true }
      return partial.patch === undefined
        ? upperBefore(lowest.core)
        : { upper: lowest }
    case '^':
      return { lower: lowest, ...upperBefore(caretUpperOf(partial)) }
    case '~':
      return { lower: lowest, ...upperBefore(tildeUpperOf(partial)) }
    default:
      // A bare full version is exactly that version.
      if (partial.patch !== undefined)
        return { lower: lowest, upper: lowest, upperInclusive: true }
      return { lower: lowest, ...upperBefore(after) }
  }
}

/** The triplet a partial version names when it carries a prerelease tag, which lets prereleases of that triplet in; `undefined` otherwise. */
function prereleaseTripletOf(partial: PartialVersion): Triplet | undefined {
  if (partial.prerelease.length === 0 || partial.major === undefined)
    return undefined
  return [partial.major, partial.minor ?? 0, partial.patch ?? 0]
}

/**
 * Reads one comparator as the versions it accepts, with semver's meaning.
 *
 * Why it exists: {@link boundsOfAlternative} reads every part of an alternative through it; {@link satisfiesNodeRange} and {@link isReadableNodeRange} call that.
 *
 * @param comparator - One comparator with its operator attached: `^20.19.0`, `>=22.12.0`, `<25`, `~20.1.0`, `20.x`, `20.19.0`, `>=20.19.0-0`, `*`.
 * @returns The accepted versions, or `undefined` for syntax this reader does not know.
 * @example
 * boundsOfComparator('>=22.12.0') // => { lower: { core: [22, 12, 0], prerelease: [] } }
 */
function boundsOfComparator(comparator: string): Bounds | undefined {
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(comparator)
  const partial = match ? parsePartial(match[2]!) : undefined
  if (!match || !partial) return undefined
  const bounds = boundsOfPartial(match[1], partial)
  const prereleaseOf = prereleaseTripletOf(partial)
  return prereleaseOf ? { ...bounds, prereleaseOf } : bounds
}

/**
 * Reads `20.19.0 - 22` as the versions from the first to the last, the last one partial (`22` ends before `23.0.0`).
 *
 * Called by {@link boundsOfAlternative} for a hyphen range.
 *
 * @param from - The first version.
 * @param to - The last version.
 * @returns The accepted versions; `undefined` when either end is unknown syntax.
 * @example
 * boundsOfHyphen('20.19.0', '22') // => { lower: { core: [20, 19, 0], prerelease: [] }, upper: { core: [23, 0, 0], prerelease: ['0'] } }
 */
function boundsOfHyphen(from: string, to: string): Bounds | undefined {
  const start = parsePartial(from)
  const end = parsePartial(to)
  if (!start || !end) return undefined
  // A full last version is included itself; a partial one ends before the next release.
  const upper: Bounds =
    end.patch !== undefined
      ? { upper: lowestOf(end), upperInclusive: true }
      : upperBefore(afterOf(end))
  const prereleaseOf = prereleaseTripletOf(start) ?? prereleaseTripletOf(end)
  return {
    lower: lowestOf(start),
    ...upper,
    ...(prereleaseOf ? { prereleaseOf } : {}),
  }
}

/** Orders two prerelease identifiers as semver does: numbers by value and below words, words by text. */
function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  // A number sorts below a word.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Orders two prerelease tags the way semver does: identifier by identifier, a shorter tag below a longer one it begins; no tag (the release) is above any tag. */
function comparePrereleases(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return right.length - left.length
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifiers(left[index]!, right[index]!)
    if (order !== 0) return order
  }
  return left.length - right.length
}

/** Compares two versions: negative when `left` is lower. */
function compareVersions(left: Version, right: Version): number {
  return (
    left.core[0] - right.core[0] ||
    left.core[1] - right.core[1] ||
    left.core[2] - right.core[2] ||
    comparePrereleases(left.prerelease, right.prerelease)
  )
}

/**
 * Tells whether a version is inside the bounds of one comparator.
 *
 * Called by {@link satisfiesNodeRange} for every part of the alternative being tried.
 *
 * @param bounds - The comparator's accepted versions.
 * @param version - The running version.
 * @returns `true` when it is above the lower end and below the upper end.
 * @example
 * isInside({ lower: { core: [20, 0, 0], prerelease: [] } }, { core: [22, 1, 0], prerelease: [] }) // => true
 */
function isInside(bounds: Bounds, version: Version): boolean {
  if (bounds.empty) return false
  if (bounds.lower) {
    const order = compareVersions(version, bounds.lower)
    if (order < 0 || (order === 0 && bounds.lowerExclusive)) return false
  }
  if (bounds.upper) {
    const order = compareVersions(version, bounds.upper)
    if (order > 0 || (order === 0 && !bounds.upperInclusive)) return false
  }
  return true
}

/**
 * Splits a range into its `||` alternatives, each a list of comparator texts (a hyphen range keeps its `-` as a token).
 *
 * Called by {@link isReadableNodeRange} and {@link satisfiesNodeRange}. A space between an operator and its version (`>= 20.19.0`) is closed first, as npm reads it.
 *
 * @param range - The `engines.node` text.
 * @returns One list of comparator texts per `||` alternative.
 * @example
 * alternativesOf('>= 20.19.0 < 22 || ^24') // => [['>=20.19.0', '<22'], ['^24']]
 */
function alternativesOf(range: string): string[][] {
  return range.split('||').map((alternative) =>
    alternative
      .trim()
      // Close the space after an operator so `>= 20.19.0` is one comparator.
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean),
  )
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
 * Why it exists: the extension has no semver dependency and only the range forms package engines use are needed: `||` alternatives of space-separated comparators (`>=`, `>`, `<=`, `<`, `^`, `~`, `=` or a bare version, with or without a space after the operator), partial versions and x-ranges (`20`, `20.x`, `20.19.x`, `*`), hyphen ranges (`20.19.0 - 22`) and prerelease comparators (`>=20.19.0-0`), read as npm's semver reads them.
 * A prerelease version is below its release and is let in only by a comparator that names a prerelease of the same triplet, as semver does.
 * A range with syntax this reader does not know contains no version, so the gate refuses it and names it (see {@link isReadableNodeRange}) instead of letting an unusual range pass unchecked.
 *
 * @param range - The `engines.node` text, such as `^20.19.0 || >=22.12.0`.
 * @param version - The running Node's version, such as `v24.22.1` or `v25.0.0-nightly2026`.
 * @returns `true` only when the version is readable, the whole range is read and one alternative contains the version.
 * @example
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v24.22.1') // => true
 * satisfiesNodeRange('^20.19.0 || >=22.12.0', 'v18.20.0') // => false
 * satisfiesNodeRange('20.x', 'v20.19.0') // => true
 * satisfiesNodeRange('20.19.0 - 22', 'v22.5.0') // => true
 * satisfiesNodeRange('>= 20.19.0', 'v24.0.0') // => true
 * satisfiesNodeRange('>=25', 'v25.0.0-rc.1') // => false
 * satisfiesNodeRange('>=18 <=bad', 'v24.22.1') // => false
 */
export function satisfiesNodeRange(range: string, version: string): boolean {
  const running = parseVersion(version)
  if (!running || !isReadableNodeRange(range)) return false
  return alternativesOf(range).some((comparators) => {
    const alternative = boundsOfAlternative(comparators) ?? []
    // Semver lets a prerelease in only when a comparator names a prerelease of the same triplet.
    if (
      running.prerelease.length > 0 &&
      !alternative.some(
        (bounds) => bounds.prereleaseOf?.join('.') === running.core.join('.'),
      )
    )
      return false
    return alternative.every((bounds) => isInside(bounds, running))
  })
}
