import { NODE_SERVER_MISSING_LIST_LIMIT } from '../constants'

/**
 * Caps a missing-evidence list for an answer: the first {@link NODE_SERVER_MISSING_LIST_LIMIT} items and how many there were, so thirty unreadable values never flood a reply while the seal keeps every one.
 * Called wherever an answer lists `learningMissing` or `captureMissing` of a server history.
 * @param items - The whole list.
 * @returns The leading items and the whole list's length.
 * @example capMissingList(thirtyReasons) // => { items: [first twenty], count: 30 }
 */
export function capMissingList<Item>(items: readonly Item[]): {
  items: Item[]
  count: number
} {
  return {
    items: items.slice(0, NODE_SERVER_MISSING_LIST_LIMIT),
    count: items.length,
  }
}
