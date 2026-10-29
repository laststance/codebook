/**
 * Serializes a JSON value with the keys of every object in sorted order, so two reads of the same data compare equal whatever order the browser listed the keys in.
 * Called by the chrome-extension observation to decide whether two reads agree and whether the result changed.
 * @param value - Any JSON value.
 * @returns The canonical JSON text; `undefined` for a value JSON cannot hold.
 * @example
 * canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) // => '{"a":[2,{"c":2,"d":1}],"b":1}'
 */
export function canonicalJson(value: unknown): string | undefined {
  const sortKeys = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sortKeys)
    if (typeof node !== 'object' || node === null) return node
    return Object.fromEntries(
      Object.entries(node)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, member]) => [key, sortKeys(member)]),
    )
  }
  return JSON.stringify(sortKeys(value))
}
