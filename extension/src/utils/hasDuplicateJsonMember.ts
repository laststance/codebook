/**
 * Finds the end of the string literal that starts at `start`; called by {@link hasDuplicateJsonMember}.
 * @param text - Valid JSON text.
 * @param start - Index of the opening quote.
 * @returns The index just after the closing quote.
 * @example
 * endOfJsonString('"a\\"b":1', 0) // => 6
 */
function endOfJsonString(text: string, start: number): number {
  let index = start + 1
  while (index < text.length && text[index] !== '"') {
    // A backslash keeps the next character (a quote included) inside the string.
    index += text[index] === '\\' ? 2 : 1
  }
  return index + 1
}

/** Index of the first character from `from` on that is no JSON whitespace. */
function skipJsonWhitespace(text: string, from: number): number {
  let index = from
  while (index < text.length && ' \t\r\n'.includes(text.charAt(index))) index++
  return index
}

/**
 * Tells whether any object in a JSON text names one member twice, which `JSON.parse` hides by keeping only the last one; called by the Devin MCP config reader before a rewrite could drop the earlier value.
 * Member names are compared after their escapes are decoded, so `"a"` and `"a"` are one name.
 * @param text - JSON text that `JSON.parse` already accepted.
 * @returns `true` when some object holds a name twice; `false` otherwise.
 * @example
 * hasDuplicateJsonMember('{"a":1,"a":2}')        // => true
 * hasDuplicateJsonMember('{"a":{"a":1},"b":[]}') // => false
 */
export function hasDuplicateJsonMember(text: string): boolean {
  // One entry per open container: the member names seen in an object, undefined for an array.
  const scopes: Array<Set<string> | undefined> = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '{') scopes.push(new Set())
    else if (character === '[') scopes.push(undefined)
    else if (character === '}' || character === ']') scopes.pop()
    if (character !== '"') {
      index++
      continue
    }
    const end = endOfJsonString(text, index)
    const names = scopes[scopes.length - 1]
    // A string followed by a colon inside an object is a member name.
    if (names && text[skipJsonWhitespace(text, end)] === ':') {
      const name: string = JSON.parse(text.slice(index, end))
      if (names.has(name)) return true
      names.add(name)
    }
    index = end
  }
  return false
}
