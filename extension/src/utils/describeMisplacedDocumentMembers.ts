/**
 * Words the refusal of a `codebook_publish_book` call that gives a member of the published document beside `document` instead of inside it, so the agent moves the member instead of guessing why the key is unknown; the error map of {@link publishBookSchema} calls it for the call's unknown keys.
 * @param keys - The unknown keys of the call, in the order they were given.
 * @param documentMembers - The members a published document has ({@link bookDocumentSchema}).
 * @returns
 * - Keys among which at least one is a document member: one sentence naming those members and where they belong (`document.<member>`), followed by the usual unknown-key text for the other keys
 * - No key that is a document member: `undefined`, so the schema keeps its usual unknown-key text
 * @example
 * describeMisplacedDocumentMembers(['edges'], ['title', 'summary', 'nodes', 'edges'])
 * // => 'edges is a member of the published document, not of the call: give it inside document, as document.edges.'
 * describeMisplacedDocumentMembers(['edges', 'draft'], ['title', 'summary', 'nodes', 'edges'])
 * // => 'edges is a member of the published document, not of the call: give it inside document, as document.edges. Unrecognized key: "draft"'
 * describeMisplacedDocumentMembers(['draft'], ['title', 'summary', 'nodes', 'edges']) // => undefined
 */
export function describeMisplacedDocumentMembers(
  keys: readonly string[],
  documentMembers: readonly string[],
): string | undefined {
  const misplaced = keys.filter((key) => documentMembers.includes(key)),
    unknown = keys.filter((key) => !documentMembers.includes(key))
  // A key that is no document member keeps the usual refusal.
  if (misplaced.length === 0) return undefined
  // Other unknown keys are named as the schema names them, after the sentence.
  if (unknown.length === 0) return misplacedMembersSentence(misplaced)
  return `${misplacedMembersSentence(misplaced)} ${unrecognizedKeysText(unknown)}`
}

/**
 * Says where members of the published document given beside `document` belong, for {@link describeMisplacedDocumentMembers}.
 * @param members - One or more document members the call gave at its top level.
 * @returns One sentence that names them and their places `document.<member>`.
 * @example
 * misplacedMembersSentence(['edges', 'title'])
 * // => 'edges and title are members of the published document, not of the call: give them inside document, as document.edges and document.title.'
 */
function misplacedMembersSentence(members: readonly string[]): string {
  const names = joinWithAnd(members),
    places = joinWithAnd(members.map((member) => `document.${member}`))
  // One member is "it", several are "them".
  return members.length === 1
    ? `${names} is a member of the published document, not of the call: give it inside document, as ${places}.`
    : `${names} are members of the published document, not of the call: give them inside document, as ${places}.`
}

/**
 * Names unknown keys as the strict schema names them, for {@link describeMisplacedDocumentMembers} when they come beside misplaced document members.
 * @param keys - One or more unknown keys.
 * @returns `Unrecognized key: "a"` for one key, `Unrecognized keys: "a", "b"` for several.
 * @example
 * unrecognizedKeysText(['draft']) // => 'Unrecognized key: "draft"'
 */
function unrecognizedKeysText(keys: readonly string[]): string {
  const quoted = keys.map((key) => JSON.stringify(key)).join(', ')
  return keys.length === 1
    ? `Unrecognized key: ${quoted}`
    : `Unrecognized keys: ${quoted}`
}

/**
 * Joins names into an English list for {@link describeMisplacedDocumentMembers}.
 * @param names - One or more names.
 * @returns
 * - One name: the name
 * - Two names: both joined with "and"
 * - More: commas, and "and" before the last
 * @example
 * joinWithAnd(['edges', 'title', 'nodes']) // => 'edges, title and nodes'
 */
function joinWithAnd(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
