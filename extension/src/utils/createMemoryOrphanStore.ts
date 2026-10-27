import type { NodeServerOrphanStore } from './nodeServerOrphanRecords'

/**
 * Keeps node-server process records in memory, for an environment created without the window's workspace storage (unit tests, a host that gives none): records then last only for this extension host.
 * Called by `createEnvironment` when its context has no `workspaceState`.
 * @returns A store with the `Memento` shape {@link rememberNodeServerProcess} and {@link forgetNodeServerProcess} use.
 * @example
 * const store = createMemoryOrphanStore()
 * await store.update('key', [1])
 * store.get('key') // => [1]
 */
export function createMemoryOrphanStore(): NodeServerOrphanStore {
  const values = new Map<string, unknown>()
  return {
    get: (key) => values.get(key),
    update: async (key, value): Promise<void> => {
      values.set(key, value)
    },
  }
}
