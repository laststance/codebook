import type { z } from 'zod'

import type { ExtensionSeedBookmark } from '../chromeExtensionContracts'
import {
  EXTENSION_SEED_BOOKMARK_LIMIT,
  EXTENSION_SEED_DEPTH_LIMIT,
  EXTENSION_SEED_STORAGE_KEY_LIMIT,
  EXTENSION_SEED_STORAGE_LIMIT_BYTES,
} from '../constants'

/** The seed object as the schema hands it to the refinement. */
interface SeedUnderCheck {
  bookmarks?: readonly ExtensionSeedBookmark[]
  storage?: Record<string, unknown>
}

/** True when the text parses as an absolute http or https url. */
function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Checks one seed node and, below it, its children; records each edge (SR5) as a custom issue worded as the refusal table words it.
 * @param titlePath - The titles from the top to this node, joined with `/` in the sentence.
 * @param issuePath - The node's position inside the seed (`['bookmarks', 0, 'children', 1]`).
 * @param depth - 1 for a top-level node.
 * @returns How many nodes this node and its descendants hold.
 */
function checkNode(
  node: ExtensionSeedBookmark,
  titlePath: readonly string[],
  issuePath: readonly PropertyKey[],
  depth: number,
  context: z.RefinementCtx,
): number {
  const where = titlePath.join('/')
  if (depth > EXTENSION_SEED_DEPTH_LIMIT) {
    context.addIssue({
      code: 'custom',
      path: [...issuePath],
      message: `Seed node ${where} is nested deeper than ${EXTENSION_SEED_DEPTH_LIMIT} levels.`,
    })
    // Descendants of a refused node add no further sentence.
    return 1
  }
  if (node.url !== undefined && node.children !== undefined)
    context.addIssue({
      code: 'custom',
      path: [...issuePath],
      message: `Seed node ${where} has both a url and children.`,
    })
  else if (node.url !== undefined && !isHttpUrl(node.url))
    context.addIssue({
      code: 'custom',
      path: [...issuePath, 'url'],
      message: `Seed node ${where} needs an http or https url.`,
    })
  let count = 1
  node.children?.forEach((child, index) => {
    count += checkNode(
      child,
      [...titlePath, child.title],
      [...issuePath, 'children', index],
      depth + 1,
      context,
    )
  })
  return count
}

/**
 * Adds the seed's structural issues to a configuration parse: node count, depth, url/children conflicts, non-http urls, storage key count and JSON size.
 * Called as a refinement of the seed object in {@link chromeExtensionConfigSchema}; the issues' paths start with `seed`, which {@link parseChromeExtensionConfiguration} turns into `SEED_INVALID`.
 * @param seed - The parsed seed.
 * @param context - The refinement context receiving the issues.
 * @example
 * addExtensionSeedIssues({ bookmarks: [{ title: 'A', url: 'file:///x' }] }, context) // adds "Seed node A needs an http or https url."
 */
export function addExtensionSeedIssues(
  seed: SeedUnderCheck,
  context: z.RefinementCtx,
): void {
  let total = 0
  seed.bookmarks?.forEach((node, index) => {
    total += checkNode(node, [node.title], ['bookmarks', index], 1, context)
  })
  if (total > EXTENSION_SEED_BOOKMARK_LIMIT)
    context.addIssue({
      code: 'custom',
      path: ['bookmarks'],
      message: `The seed holds more than ${EXTENSION_SEED_BOOKMARK_LIMIT} bookmark nodes.`,
    })
  if (seed.storage === undefined) return
  if (Object.keys(seed.storage).length > EXTENSION_SEED_STORAGE_KEY_LIMIT)
    context.addIssue({
      code: 'custom',
      path: ['storage'],
      message: `The seed storage holds more than ${EXTENSION_SEED_STORAGE_KEY_LIMIT} keys.`,
    })
  if (
    Buffer.byteLength(JSON.stringify(seed.storage)) >
    EXTENSION_SEED_STORAGE_LIMIT_BYTES
  )
    // The sentence says "larger than", so exactly the limit is accepted.
    context.addIssue({
      code: 'custom',
      path: ['storage'],
      message: `The seed storage is larger than ${EXTENSION_SEED_STORAGE_LIMIT_BYTES} bytes as JSON.`,
    })
}
