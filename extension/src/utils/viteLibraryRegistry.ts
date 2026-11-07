import type { LibraryPackage } from './libraryBuildStop'
import type { ViteLibraryModuleSource } from './selectViteLibraryCandidate'

/** The place a stop is declared at: the key a run keeps its per-stop library facts under. */
type StopPlace = Readonly<{ path: string; line: number; column: number }>

/** Where the run's packed copy of the declared library is, as the route planned it. */
type PackedRoute = Readonly<{
  /** The library's package name. */
  name: string
  /** The packed copy's real folder: the folder the launcher's walk looks at. */
  packedFolder: string
  /** The revision the library was built from; `undefined` before the build finished. */
  revision: () => string | undefined
}>

/**
 * Keeps what a nested Vite run knows about its library stops: which declared stop lies in which workspace library, and one module source per page generation and library folder.
 *
 * Why it exists: {@link ConfiguredBrowserRun} is already very large; the registry holds the Vite library state (decision D13: all library stops of one page generation share one walk per library folder) so the run only asks it. Created once per run; written by the run's package resolution and read by the seal, the arming and the integrity checks.
 * @example
 * const registry = new ViteLibraryRegistry()
 * registry.register({ path: 'packages/core/src/a.ts', line: 3, column: 1 }, library)
 * registry.libraryOf({ path: 'packages/core/src/a.ts', line: 3, column: 1 })?.name // => '@scope/core'
 */
export class ViteLibraryRegistry {
  private readonly libraries = new Map<string, LibraryPackage>()
  private readonly moduleSources = new Map<
    string,
    { generation: number; source: ViteLibraryModuleSource }
  >()

  /** Keys a stop by its declared place. @example ViteLibraryRegistry.keyOf({ path: 'a.ts', line: 3, column: 1 }) // 'a.ts:3:1' */
  private static keyOf(place: StopPlace): string {
    return `${place.path}:${place.line}:${place.column}`
  }

  /**
   * Records that a declared stop lies in a workspace library the app reaches.
   * @param place - The stop's declared place.
   * @param library - The library holding the stop file.
   * @example registry.register(stop.source, library)
   */
  register(place: StopPlace, library: LibraryPackage): void {
    this.libraries.set(ViteLibraryRegistry.keyOf(place), library)
  }

  private readonly packedPlaces = new Set<string>()
  private packedRoute?: PackedRoute

  /**
   * Records that a declared stop lies in the checked-out source of the library the run builds and packs; its walk folder is the run's packed copy once {@link setPackedRoute} was called.
   * @param place - The stop's declared place.
   * @param library - The declared library with its checked-out real folder.
   * @example registry.registerPacked(stop.source, library)
   */
  registerPacked(place: StopPlace, library: LibraryPackage): void {
    this.register(place, library)
    this.packedPlaces.add(ViteLibraryRegistry.keyOf(place))
  }

  /**
   * Tells the registry where the run's packed copy is, once the route has planned it.
   * @param route - The package name, the packed copy's real folder and the revision the build was made from (read when a refusal is worded).
   * @example registry.setPackedRoute({ name: '@acme/core', packedFolder, revision: () => facts.revision })
   */
  setPackedRoute(route: PackedRoute): void {
    this.packedRoute = route
  }

  /**
   * Gives the packed-build facts of a stop on the packed route.
   * @param place - The stop's declared place.
   * @returns The facts a refusal names; `undefined` for any stop that is not on the packed route.
   * @example registry.packedFactsOf(stop.source) // => { revision: 'abc…' }
   */
  packedFactsOf(place: StopPlace): { revision?: string } | undefined {
    if (!this.packedPlaces.has(ViteLibraryRegistry.keyOf(place)))
      return undefined
    const revision = this.packedRoute?.revision()
    return revision === undefined ? {} : { revision }
  }

  /**
   * Gives the library a declared stop lies in.
   * @param place - The stop's declared place.
   * @returns The library, or `undefined` for a stop inside the app. A stop on the packed route gets the package name and the packed folder as its walk folder once the route is planned.
   * @example registry.libraryOf(stop.source)?.name // => '@scope/core'
   */
  libraryOf(place: StopPlace): LibraryPackage | undefined {
    const key = ViteLibraryRegistry.keyOf(place)
    const library = this.libraries.get(key)
    if (!library || !this.packedPlaces.has(key) || !this.packedRoute)
      return library
    return {
      ...library,
      name: this.packedRoute.name,
      realFolder: this.packedRoute.packedFolder,
    }
  }

  /**
   * Gives the module source of one library for one page generation, creating it on first use so every stop of that generation shares one walk; asking for a newer generation drops the sources of older ones.
   * @param generation - The page generation (0 for the first seal).
   * @param library - The library.
   * @param create - Builds the source when this generation has none for the library.
   * @returns The shared source.
   * @example registry.moduleSourceFor(0, library, () => createViteLibraryModuleSource(request))
   */
  moduleSourceFor(
    generation: number,
    library: LibraryPackage,
    create: () => ViteLibraryModuleSource,
  ): ViteLibraryModuleSource {
    // A newer generation replaces the older ones: their served `?v=` addresses are stale and their texts only cost memory.
    for (const [held, entry] of this.moduleSources)
      if (entry.generation < generation) this.moduleSources.delete(held)
    const key = `${generation}|${library.realFolder}`
    let entry = this.moduleSources.get(key)
    if (!entry) {
      entry = { generation, source: create() }
      this.moduleSources.set(key, entry)
    }
    return entry.source
  }
}
