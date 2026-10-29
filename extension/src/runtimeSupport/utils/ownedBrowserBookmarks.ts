import type { ExtensionSeedBookmark } from '../../chromeExtensionContracts'

/** Chrome's own fixed ids and guids of the three bookmark roots; a Bookmarks file that names others is rejected. */
const BOOKMARK_ROOTS = {
  bookmark_bar: {
    id: '1',
    name: 'Bookmarks bar',
    guid: '0bc5d13f-2cba-5d74-951f-3f233fe6c908',
  },
  other: {
    id: '2',
    name: 'Other bookmarks',
    guid: '82b081ec-3dd3-529c-8475-ab6c344590dd',
  },
  synced: {
    id: '3',
    name: 'Mobile bookmarks',
    guid: '4cf2e351-0e85-532b-bb37-df045d8f8d0f',
  },
} as const

/** The first node id after the three roots. */
const FIRST_SEED_NODE_ID = 4

/** One serialised bookmark node, as Chrome's `Default/Bookmarks` holds it. */
type BookmarkNode = {
  id: string
  name: string
  type: 'folder' | 'url'
  date_added: '0'
  date_last_used: '0'
  date_modified?: '0'
  url?: string
  children?: BookmarkNode[]
}

/**
 * Builds the `Default/Bookmarks` file of an owned profile from one fixed template (ER12).
 * Called by the owned launch before Chrome starts, so the seed exists without any extension API; roots keep Chrome's fixed ids, seeded nodes get sequential ids in depth-first order under "Other bookmarks", every date is '0' and no checksum is written.
 * @param bookmarks - The seeded tree.
 * @returns The file's JSON text.
 * @example
 * ownedBrowserBookmarks([{ title: 'A', url: 'https://a.example/' }]) // => '{"roots":{…"other":{…"children":[{"id":"4","name":"A",…}]}},"version":1}'
 */
export function ownedBrowserBookmarks(
  bookmarks: readonly ExtensionSeedBookmark[],
): string {
  let nextId = FIRST_SEED_NODE_ID
  // Depth-first, so a folder's id precedes its children's.
  const toNode = (bookmark: ExtensionSeedBookmark): BookmarkNode => {
    const id = String(nextId++)
    if (bookmark.children === undefined)
      return {
        id,
        name: bookmark.title,
        type: 'url',
        url: bookmark.url ?? '',
        date_added: '0',
        date_last_used: '0',
      }
    return {
      id,
      name: bookmark.title,
      type: 'folder',
      date_added: '0',
      date_last_used: '0',
      date_modified: '0',
      children: bookmark.children.map(toNode),
    }
  }
  const root = (
    key: keyof typeof BOOKMARK_ROOTS,
    children: BookmarkNode[],
  ) => ({
    ...BOOKMARK_ROOTS[key],
    type: 'folder',
    date_added: '0',
    date_last_used: '0',
    date_modified: '0',
    children,
  })
  return JSON.stringify({
    roots: {
      bookmark_bar: root('bookmark_bar', []),
      other: root('other', bookmarks.map(toNode)),
      synced: root('synced', []),
    },
    version: 1,
  })
}
