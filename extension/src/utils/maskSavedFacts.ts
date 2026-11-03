import { maskFactString } from './maskFactString'

/** What a saved fact collection is made of: the strings, numbers, booleans, nulls, lists and records a history or a study keeps its facts as. */
type SavedFactsValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly SavedFactsValue[]
  | { readonly [name: string]: SavedFactsValue }

/**
 * Masks every string of a saved fact collection again ({@link maskFactString}), so a history or a study saved before the shape rules serves no Cookie, Authorization or secret URL query value as a fact.
 * Why: the capture masks what it saves, but a history on disk keeps what its version saved; the lean events lists and detail entries of the three histories, the saved-stop resource and the recording context call this just before they serve facts. Names, numbers and the recorded source text are never touched.
 * @param facts - A fact list (`[{ path, mode, display }]`), a fact record (`{ 'value:id': "'7'" }`), a fact value or any nesting of them.
 * @returns A copy with the same shape and every string masked; the numbers, booleans and nulls are returned as they are.
 * @example
 * maskSavedFacts({ 'value:cookie': "'sid=abc; theme=dark'", 'value:page': "'page=2'" }) // => { 'value:cookie': '[masked]', 'value:page': "'page=2'" }
 * maskSavedFacts([{ path: 'next', mode: 'value', display: '3' }]) // => [{ path: 'next', mode: 'value', display: '3' }]
 */
export function maskSavedFacts<Facts extends SavedFactsValue>(
  facts: Facts,
): Facts
export function maskSavedFacts(facts: SavedFactsValue): SavedFactsValue {
  if (typeof facts === 'string') return maskFactString(facts)
  if (Array.isArray(facts)) return facts.map((fact) => maskSavedFacts(fact))
  if (facts === null || typeof facts !== 'object') return facts
  return Object.fromEntries(
    Object.entries(facts).map(([name, fact]) => [name, maskSavedFacts(fact)]),
  )
}
