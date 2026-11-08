import {
  API_PROXY_PATH_MAX_CHARS,
  API_PROXY_PATHS_MAX_ENTRIES,
} from '../constants'

/** The characters a prefix cannot hold: a wildcard, a query and a fragment would make it a pattern, not a literal prefix. */
const FORBIDDEN_PROXY_PATH_CHARACTER = /[*?#]/

/** One character of a URL path (RFC 3986 `pchar` without `%`, plus "/"); a `%` is checked apart because it must start a well-formed `%XX`. */
const URL_PATH_CHARACTER = /[A-Za-z0-9\-._~!$&'()+,;=:@/]/

/**
 * Finds the first character a path prefix may not hold: not a URL path character, or a `%` not followed by two hex digits.
 * @returns The character as {@link JSON.stringify} shows it (so a space or newline is visible), or `undefined` when every character is allowed.
 * @example firstForbiddenPathCharacterOf('/api v1') // => '" "'
 */
function firstForbiddenPathCharacterOf(value: string): string | undefined {
  for (const [index, character] of Array.from(value).entries()) {
    // A "%" is allowed only as the start of "%XX".
    if (character === '%') {
      if (!/^%[0-9A-Fa-f]{2}/.test(value.slice(index))) return '"%"'
      continue
    }
    if (!URL_PATH_CHARACTER.test(character)) return JSON.stringify(character)
  }
  return undefined
}

/** One refusal of `apiServer.proxyPaths`. */
export interface ProxyPathIssue {
  /** The entry index, or `undefined` for a refusal about the whole list (its size). */
  readonly index: number | undefined
  /** The sentence, naming the entry as `apiServer.proxyPaths[i]` with its value. */
  readonly message: string
}

/** One row of the entry rule table: what breaks the rule and how the refusal reads. The first row an entry breaks decides its refusal. */
interface ProxyPathRule {
  readonly isBroken: (value: string) => boolean
  /** The refusal without the entry label; names the corrected value only when it can be derived from the entry. */
  readonly describe: (value: string) => string
}

/**
 * Removes the trailing slashes of an entry.
 * @example withoutTrailingSlashes('/api//') // => '/api'
 */
function withoutTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/** The entry rules in the order they are checked. */
const PROXY_PATH_RULES: readonly ProxyPathRule[] = [
  {
    isBroken: (value) => value === '',
    describe: () =>
      'is empty; declare a path prefix that starts with "/", for example "/api".',
  },
  {
    isBroken: (value) => value === '/',
    describe: () =>
      'is the root, which matches every request; declare the API\'s own prefix, for example "/api".',
  },
  {
    isBroken: (value) => value.length > API_PROXY_PATH_MAX_CHARS,
    describe: (value) =>
      `is ${value.length} characters long; a prefix holds at most ${API_PROXY_PATH_MAX_CHARS}.`,
  },
  {
    isBroken: (value) => FORBIDDEN_PROXY_PATH_CHARACTER.test(value),
    describe: () =>
      'holds "*", "?" or "#"; declare a literal path prefix without a wildcard, query or fragment.',
  },
  {
    isBroken: (value) => firstForbiddenPathCharacterOf(value) !== undefined,
    describe: (value) =>
      `holds ${firstForbiddenPathCharacterOf(value)}, which a URL path does not; write the path as the page sends it (percent-encoded, for example "%20" for a space).`,
  },
  {
    isBroken: (value) => !value.startsWith('/'),
    describe: (value) =>
      `must start with "/"; declare ${JSON.stringify(`/${withoutTrailingSlashes(value)}`)}.`,
  },
  {
    isBroken: (value) => value.endsWith('/'),
    // Slashes only (for example "//") strip to nothing: no corrected value can be named.
    describe: (value) =>
      withoutTrailingSlashes(value) === ''
        ? 'must not end with "/"; declare the API\'s own prefix, for example "/api".'
        : `must not end with "/"; declare ${JSON.stringify(withoutTrailingSlashes(value))}.`,
  },
]

/**
 * Lists every way `apiServer.proxyPaths` of a `vite-dev` configuration breaks its rules: 1 to 8 entries, each a literal path prefix that starts with "/", is not "/", holds no "*", "?" or "#", does not end with "/", is at most 256 characters, and is declared once.
 * Why it exists: a malformed prefix would tie (or fail to tie) a page request to the API by accident, so the schema refuses it before a run; the corrected value is named when it can be derived (`"/api/"` becomes `"/api"`).
 * Called by `validateApiServer` in the repository configuration schemas for an `apiServer` that declares `proxyPaths`.
 * @param proxyPaths - The declared prefixes, in declared order.
 * @returns The list-size issue first, then one issue per broken entry rule and per repeated entry in entry order; an empty array when every rule holds.
 * @example proxyPathIssueOf(['/api/']) // => [{ index: 0, message: 'apiServer.proxyPaths[0] "/api/" must not end with "/"; declare "/api".' }]
 */
export function proxyPathIssueOf(
  proxyPaths: readonly string[],
): ProxyPathIssue[] {
  const issues: ProxyPathIssue[] = []
  // The size rule: an empty list declares nothing, a long one is not a prefix list a person wrote.
  if (proxyPaths.length === 0)
    issues.push({
      index: undefined,
      message: `apiServer.proxyPaths is empty; declare 1 to ${API_PROXY_PATHS_MAX_ENTRIES} prefixes or omit it.`,
    })
  else if (proxyPaths.length > API_PROXY_PATHS_MAX_ENTRIES)
    issues.push({
      index: undefined,
      message: `apiServer.proxyPaths declares ${proxyPaths.length} entries; declare at most ${API_PROXY_PATHS_MAX_ENTRIES}.`,
    })
  const firstIndexOf = new Map<string, number>()
  for (const [index, value] of proxyPaths.entries()) {
    const label = `apiServer.proxyPaths[${index}] ${JSON.stringify(value)}`
    const brokenRule = PROXY_PATH_RULES.find((rule) => rule.isBroken(value))
    if (brokenRule !== undefined)
      issues.push({ index, message: `${label} ${brokenRule.describe(value)}` })
    // A repeated entry names both indexes, so the person knows which one to drop.
    const firstIndex = firstIndexOf.get(value)
    if (firstIndex === undefined) firstIndexOf.set(value, index)
    else
      issues.push({
        index,
        message: `${label} repeats apiServer.proxyPaths[${firstIndex}]; declare each prefix once.`,
      })
  }
  return issues
}
